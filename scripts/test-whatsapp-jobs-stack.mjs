#!/usr/bin/env node
/**
 * WhatsApp service-job webhook stack test.
 *
 * Runs the real API in-process against the local PostgreSQL database and a fake
 * Meta Graph server. No message ever reaches Meta: META_WHATSAPP_GRAPH_URL is
 * pointed at an HTTP server on 127.0.0.1 that records every outbound payload
 * and returns `wamid.test-N` message ids. The test submits genuinely signed
 * webhook requests to /whatsapp/webhook, exactly as Meta would.
 *
 * Run from the repository root (with the local infrastructure up):
 *
 *   node --env-file=.env scripts/test-whatsapp-jobs-stack.mjs
 *
 * Assumed contract (read from apps/api/src/whatsapp/**, apps/api/src/service-jobs/**
 * and docs/whatsapp-service-jobs.md while the backend was being converted to
 * MikroORM):
 *
 * - apps/api/dist/app.js exports `createApi(options)` (async) returning
 *   `{ app, services }` with `serviceJobs`, `alertWorker`, `whatsapp` and
 *   `database` (or `orm`). A tsx source fallback is included and the loader
 *   reports what it actually assumed.
 * - The initial job alert is an approved template. Every reply is free-form
 *   (text/interactive), which Meta only allows inside the 24-hour customer
 *   service window opened by the provider's inbound message.
 * - POST /whatsapp/webhook verifies `X-Hub-Signature-256` (HMAC-SHA256 over the
 *   raw body with META_WHATSAPP_APP_SECRET). Invalid/unsigned requests return
 *   403; duplicate message ids are idempotent.
 * - Template quick reply `Accept job` resolves the offer from `context.id` (the
 *   alert wamid) and verifies the sender number. Interactive ids are
 *   `offer:<offerId>:en_route|arrived|working|complete`; text `STOP` opts out.
 */

import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);
const env = parseEnv(await readFile(new URL(".env", root), "utf8"));
Object.assign(process.env, env);

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is missing from the root .env file.");
const databaseHost = new URL(process.env.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseHost))
  throw new Error(
    "WhatsApp service jobs stack tests require a local database (127.0.0.1/localhost).",
  );

const require = createRequire(new URL("apps/api/package.json", root));
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DATABASE_URL });

const tag = `WATEST-${randomBytes(5).toString("hex").toUpperCase()}`;
const templateName = "vhh_service_job_alert_stack_test";
const templateLanguage = "en_US";
const apiVersion = "v25.0";
const phoneNumberId = "1098765432100";
const accessToken = "test-meta-access-token";
const appSecret = randomBytes(32).toString("hex");
const webhookVerifyToken = "test-webhook-verify-token";
const businessAccountId = "test-waba-id";
const appUrl = "http://127.0.0.1:3199/";

const graphRequests = [];
const fakePhoto = Buffer.from("89504e470d0a1a0a0000", "hex");
let wamidCounter = 0;
let api = null;
let apiBase = null;
let dataDir = null;
let fakeGraph = null;
let loadedFrom = null;
const created = { jobs: [], providers: [], trucks: [], users: [] };

const pass = (message) => console.log(`PASS ${message}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digits = (number) => String(number).replace(/^\+/, "");
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

async function q(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(sql, params = []) {
  return (await q(sql, params))[0];
}

function nextWhatsAppNumber() {
  return `+27${String(100_000_000 + randomBytes(4).readUInt32BE(0) % 900_000_000)}`;
}

async function uniqueWhatsAppNumber() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const number = nextWhatsAppNumber();
    if (!(await one('select 1 as found from app.service_providers where "whatsappNumber" = $1', [digits(number)])))
      return number;
  }
  throw new Error("Could not allocate a unique service provider WhatsApp number.");
}

async function waitFor(label, check, { timeout = 30_000, interval = 100 } = {}) {
  const started = Date.now();
  let lastError = null;
  for (;;) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - started > timeout) {
      throw new Error(
        `${label}: timed out after ${timeout}ms${lastError ? ` (last error: ${lastError.message})` : ""}`,
      );
    }
    await delay(interval);
  }
}

/* ------------------------------------------------------------------ */
/* API loader: supports the compiled app and a tsx source fallback.   */
/* ------------------------------------------------------------------ */

async function sourceTimestamp() {
  let newest = 0;
  const visit = async (url) => {
    const entries = await readdir(url, { withFileTypes: true });
    for (const entry of entries) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
      if (entry.isDirectory()) await visit(child);
      else if (entry.name.endsWith(".ts")) {
        const info = await stat(child);
        newest = Math.max(newest, info.mtimeMs);
      }
    }
  };
  await visit(new URL("apps/api/src/", root));
  return newest;
}

async function importSource(specifier) {
  const tsxPath = require.resolve("tsx/esm/api");
  const { tsImport } = await import(new URL(`file://${tsxPath}`).href);
  return tsImport(specifier, { parentURL: root.href });
}

function normalizeApi(result, module, kind) {
  if (!result || (typeof result !== "object" && typeof result !== "function"))
    throw new Error(
      `${kind}: the API factory returned ${typeof result}; expected { app, services }.`,
    );
  let app = result.app;
  let services = result.services;
  if (!app && typeof result.decorate === "function" && result.server) app = result;
  if (!app && result.app?.app) app = result.app.app;
  if (!services && app?.services) services = app.services;
  if (!app && result.services?.app) {
    app = result.services.app;
    services = result.services;
  }
  if (!app || typeof app.listen !== "function")
    throw new Error(
      `${kind}: could not find a Fastify app in the factory result. Result keys: ${Object.keys(result ?? {}).join(", ") || "(none)"}; module exports: ${Object.keys(module).join(", ")}.`,
    );
  if (!services || typeof services !== "object")
    throw new Error(
      `${kind}: the factory result has no services object. Result keys: ${Object.keys(result).join(", ")}.`,
    );
  const findService = (names) => {
    for (const name of names) if (services[name]) return [name, services[name]];
    return [null, null];
  };
  const [jobsName, serviceJobs] = findService(["serviceJobs", "jobs", "serviceJobService"]);
  const [alertsName, alertWorker] = findService([
    "alertWorker",
    "jobAlertWorker",
    "worker",
    "alerts",
  ]);
  const [whatsappName, whatsapp] = findService([
    "whatsapp",
    "whatsappCloud",
    "whatsappCloudService",
    "cloud",
  ]);
  const [databaseName, database] = findService(["database", "db"]);
  const [ormName, orm] = findService(["orm", "mikroOrm", "mikro"]);
  const missing = [
    !serviceJobs && "serviceJobs",
    !alertWorker && "alertWorker",
    !whatsapp && "whatsapp",
    !(database || orm) && "database/orm",
  ].filter(Boolean);
  if (missing.length)
    throw new Error(
      `${kind}: the API services are missing ${missing.join(", ")}. Found services: ${Object.keys(services).join(", ")}. The conversion changed the exported service shape; update loadApi()/the assumptions in this test.`,
    );
  for (const method of ["createProvider", "createJob", "cancelJob", "providerByPhone"]) {
    if (typeof serviceJobs[method] !== "function")
      throw new Error(
        `${kind}: serviceJobs.${method}() is missing (the service API changed). serviceJobs keys: ${Object.keys(serviceJobs).join(", ")}.`,
      );
  }
  if (typeof alertWorker.flush !== "function")
    throw new Error(
      `${kind}: alertWorker.flush() is missing, so the alert worker cannot be nudged. alertWorker keys: ${Object.keys(alertWorker).join(", ")}.`,
    );
  return {
    app,
    services,
    jobs: serviceJobs,
    alerts: alertWorker,
    whatsapp,
    database,
    orm,
    aliases: {
      serviceJobs: jobsName,
      alertWorker: alertsName,
      whatsapp: whatsappName,
      database: databaseName,
      orm: ormName,
    },
  };
}

async function loadApi() {
  const candidates = [];
  if (process.env.FLEET_API_ENTRY)
    candidates.push({ kind: "FLEET_API_ENTRY", specifier: process.env.FLEET_API_ENTRY, source: true });
  const distEntry = new URL("apps/api/dist/app.js", root);
  const sourceEntry = new URL("apps/api/src/app.ts", root);
  if (existsSync(distEntry)) {
    const distStat = await stat(distEntry);
    const sourceStat = await sourceTimestamp();
    if (sourceStat > distStat.mtimeMs)
      console.warn(
        `WARN apps/api/dist is older than the API source tree (dist ${new Date(distStat.mtimeMs).toISOString()}). ` +
          "Run `pnpm --filter api build` for the stack test to exercise the current API. Trying dist first, then source via tsx.",
      );
    candidates.push({ kind: "apps/api/dist/app.js", specifier: distEntry.href, source: false });
  }
  candidates.push({ kind: "apps/api/src/app.ts (tsx)", specifier: sourceEntry.href, source: true });

  const failures = [];
  for (const candidate of candidates) {
    try {
      const module = candidate.source
        ? await importSource(candidate.specifier)
        : await import(candidate.specifier);
      const factoryName =
        ["createApi", "buildApi", "createServer", "bootstrap", "create"].find(
          (name) => typeof module[name] === "function",
        ) ?? (typeof module.default === "function" ? "default" : null);
      if (!factoryName)
        throw new Error(
          `no factory export. Module exports: ${Object.keys(module).join(", ") || "(none)"}. Expected one of createApi/buildApi/createServer/bootstrap/create.`,
        );
      const factory = factoryName === "default" ? module.default : module[factoryName];
      const result = await factory({ logger: { level: "silent" } });
      const normalized = normalizeApi(result, module, candidate.kind);
      loadedFrom = { kind: candidate.kind, factoryName, aliases: normalized.aliases };
      return normalized;
    } catch (error) {
      failures.push(`${candidate.kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Could not load the Fleet API bootstrap.\n${failures.map((failure) => `  - ${failure}`).join("\n")}\n` +
      "Expected apps/api/dist/app.js (pnpm --filter api build) or apps/api/src/app.ts with tsx installed, exporting createApi() async returning { app, services }. " +
      "If a build just started, wait for `pnpm --filter api build` to finish and run the script again.",
  );
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

async function adminContext() {
  let owner = await one(
    `select u.id, u.email, u."firstName", u."lastName", u."kratosIdentityId"
       from app.users u
       join app.user_roles ur on ur."userId" = u.id
       join app.roles r on r.id = ur."roleId"
      where u."isActive" = true and r.key in ('owner', 'administrator')
      order by (r.key = 'owner') desc, u."createdAt"
      limit 1`,
  );
  if (!owner) {
    const role = await one("select id from app.roles where key = 'owner'");
    if (!role)
      throw new Error(
        "No owner/administrator user exists and the owner role is not seeded. Run `pnpm db:migrate` and `pnpm db:seed`, then `pnpm db:seed:admin`.",
      );
    const id = randomUUID();
    const identityId = randomUUID();
    const email = `${tag.toLowerCase()}-owner@example.test`;
    await db.query(
      `insert into app.users (id, "kratosIdentityId", email, "firstName", "lastName", "isActive")
       values ($1, $2, $3, 'Stack', 'Owner', true)`,
      [id, identityId, email],
    );
    await db.query('insert into app.user_roles ("userId", "roleId") values ($1, $2)', [id, role.id]);
    created.users.push(id);
    owner = { id, email, firstName: "Stack", lastName: "Owner", kratosIdentityId: identityId };
  }
  const roles = await q(
    `select r.id, r.key, r.name
       from app.roles r join app.user_roles ur on ur."roleId" = r.id
      where ur."userId" = $1`,
    [owner.id],
  );
  const permissions = (
    await q(
      `select distinct p.key
         from app.user_roles ur
         join app.role_permissions rp on rp."roleId" = ur."roleId"
         join app.permissions p on p.id = rp."permissionId"
        where ur."userId" = $1`,
      [owner.id],
    )
  ).map((row) => row.key);
  assert.ok(
    permissions.includes("service_jobs.write"),
    "The owner/administrator fixture is missing service_jobs.write; run `pnpm db:seed`.",
  );
  return {
    user: owner,
    session: {
      id: `stack-test-${tag}`,
      active: true,
      authenticated_at: new Date().toISOString(),
      identity: {
        id: owner.kratosIdentityId,
        state: "active",
        traits: { email: owner.email },
        verifiable_addresses: [],
      },
    },
    roles,
    permissions,
  };
}

async function createTruck(label) {
  const identifier = `${tag}-${label}`;
  const row = await one(
    `insert into app.trucks
       (identifier, registration, "registrationCountry", make, model, category, "fuelType", "odometerKm", status)
     values ($1, $1, 'ZA', 'Volvo', 'FH', 'tractor', 'diesel', 100, 'active')
     returning id, identifier, registration`,
    [identifier],
  );
  created.trucks.push(row.id);
  return row;
}

async function createProvider(admin, label) {
  const whatsappNumber = await uniqueWhatsAppNumber();
  const provider = await api.jobs.createProvider(admin, {
    companyName: `${tag} ${label}`,
    contactName: `${label} Contact`,
    whatsappNumber,
    services: ["mechanical", "tyres"],
    coverageArea: "Gauteng",
    email: `${tag.toLowerCase()}-provider@example.test`,
    alertsEnabled: true,
    consent: true,
  });
  created.providers.push(provider.id);
  return { ...provider, whatsappNumber };
}

const templateSendsTo = (number) => {
  const to = digits(number);
  return graphRequests.filter(
    (request) => request.body?.type === "template" && request.body.to === to,
  );
};

async function alertDiagnostics(provider) {
  let dueProbe;
  try {
    if (typeof api.jobs.dueAlertOffers !== "function")
      throw new Error("serviceJobs.dueAlertOffers() is missing");
    await api.jobs.dueAlertOffers(0);
    dueProbe = "dueAlertOffers(0) ok";
  } catch (error) {
    dueProbe = `dueAlertOffers(0) failed: ${error?.message}\n${String(error?.stack ?? "").split("\n").slice(0, 8).join("\n")}`;
  }
  const offers = await q(
    `select o.id, o.status, o."whatsappMessageId" as wamid, o."lastErrorCode", o."lastErrorTitle"
       from app.service_job_offers o where o."providerId" = $1 order by o."createdAt" desc limit 5`,
    [provider.id],
  ).catch((error) => String(error));
  return `provider offers=${JSON.stringify(offers)}; ${dueProbe}`;
}

async function waitForAlert(provider) {
  let request;
  try {
    request = await waitFor(
      "job alert template",
      () => templateSendsTo(provider.whatsappNumber)[0],
      { timeout: 45_000 },
    );
  } catch (error) {
    throw new Error(`${error.message}; ${await alertDiagnostics(provider)}`);
  }
  // The worker marks the offer sent after the fake Graph responds.
  let offer;
  try {
    offer = await waitFor(
      "offer marked sent with the alert wamid",
      async () => {
        const row = await one(
          `select o.id, o.status, o."whatsappMessageId" as wamid, o."linkVersion"
             from app.service_job_offers o
            where o."providerId" = $1
              and o."whatsappMessageId" is not null
              and o.status in ('sent', 'delivered', 'read')
            order by o."createdAt" desc
            limit 1`,
          [provider.id],
        );
        return row?.wamid === request.wamid ? row : null;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    throw new Error(`${error.message}; ${await alertDiagnostics(provider)}`);
  }
  return { request, offer };
}

/* ------------------------------------------------------------------ */
/* Fake Meta Graph server                                             */
/* ------------------------------------------------------------------ */

async function startFakeGraph() {
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      if (request.headers.authorization !== `Bearer ${accessToken}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.url === `/${apiVersion}/123456789?phone_number_id=${phoneNumberId}`) {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          url: `http://127.0.0.1:${server.address().port}/test-media`,
          mime_type: "image/png",
          file_size: fakePhoto.length,
        }));
        return;
      }
      if (request.url === "/test-media") {
        response.writeHead(200, { "Content-Type": "image/png" }).end(fakePhoto);
        return;
      }
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    wamidCounter += 1;
    const wamid = `wamid.test-${wamidCounter}`;
    graphRequests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
      raw,
      wamid,
      at: Date.now(),
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ messages: [{ id: wamid }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

/* ------------------------------------------------------------------ */
/* Webhook payloads and helpers                                       */
/* ------------------------------------------------------------------ */

function eventWithValue(value) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: businessAccountId, changes: [{ field: "messages", value }] }],
  };
}

const metadata = () => ({
  display_phone_number: "27000000000",
  phone_number_id: phoneNumberId,
});

function inboundEvent(providerPhone, messages, profileName = "P Dispatcher") {
  return eventWithValue({
    messaging_product: "whatsapp",
    metadata: metadata(),
    contacts: [{ wa_id: digits(providerPhone), profile: { name: profileName } }],
    messages,
  });
}

function statusEvent(statuses) {
  return eventWithValue({
    messaging_product: "whatsapp",
    metadata: metadata(),
    statuses,
  });
}

const buttonMessage = (providerPhone, wamid, { contextWamid, text = "Accept job" }) => ({
  from: digits(providerPhone),
  id: wamid,
  timestamp: nowSeconds(),
  type: "button",
  ...(contextWamid ? { context: { id: contextWamid, from: digits(providerPhone) } } : {}),
  button: { payload: text, text },
});

const interactiveMessage = (providerPhone, wamid, id, title = "On my way") => ({
  from: digits(providerPhone),
  id: wamid,
  timestamp: nowSeconds(),
  type: "interactive",
  interactive: { type: "button_reply", button_reply: { id, title } },
});

const textMessage = (providerPhone, wamid, body) => ({
  from: digits(providerPhone),
  id: wamid,
  timestamp: nowSeconds(),
  type: "text",
  text: { body },
});

function signatureFor(raw) {
  return `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
}

async function postWebhook(payload, { signature, raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const headers = { "Content-Type": "application/json", Accept: "text/plain" };
  const provided = signature === null ? null : (signature ?? signatureFor(body));
  if (provided) headers["X-Hub-Signature-256"] = provided;
  const response = await fetch(new URL("whatsapp/webhook", apiBase), {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, text: await response.text() };
}

function repliesSince(index) {
  return graphRequests.slice(index).map((request) => request.body);
}

function assertReplyRecipient(reply, providerPhone) {
  assert.equal(reply.messaging_product, "whatsapp");
  assert.equal(reply.recipient_type, "individual");
  assert.equal(reply.to, digits(providerPhone));
}

function assertCtaReply(reply, providerPhone, { body, displayText, url }) {
  assertReplyRecipient(reply, providerPhone);
  assert.equal(reply.type, "interactive");
  assert.equal(reply.interactive.type, "cta_url");
  if (body) assert.match(reply.interactive.body.text, body);
  assert.equal(reply.interactive.action.name, "cta_url");
  assert.equal(reply.interactive.action.parameters.display_text, displayText);
  if (url instanceof RegExp) assert.match(reply.interactive.action.parameters.url, url);
  else if (url) assert.equal(reply.interactive.action.parameters.url, url);
}

function assertButtonReply(reply, providerPhone, { body, buttons }) {
  assertReplyRecipient(reply, providerPhone);
  assert.equal(reply.type, "interactive");
  assert.equal(reply.interactive.type, "button");
  assert.equal(reply.interactive.body.text, body);
  assert.deepEqual(
    reply.interactive.action.buttons.map((button) => button.reply),
    buttons,
  );
}

function assertTextReply(reply, providerPhone, pattern) {
  assertReplyRecipient(reply, providerPhone);
  assert.equal(reply.type, "text");
  assert.match(reply.text.body, pattern);
}

async function whatsappMessage(wamid) {
  return one('select * from app.whatsapp_messages where wamid = $1', [wamid]);
}

/* ------------------------------------------------------------------ */
/* Cleanup                                                            */
/* ------------------------------------------------------------------ */

async function cleanup() {
  try {
    if (api?.app) await api.app.close().catch(() => undefined);
  } catch {
    /* ignore */
  }
  try {
    if (created.jobs.length) {
      await db.query('delete from app.whatsapp_messages where "jobId" = any($1::uuid[])', [created.jobs]);
      await db.query('delete from app.service_job_attachments where "jobId" = any($1::uuid[])', [created.jobs]);
      await db.query('delete from app.service_job_events where "jobId" = any($1::uuid[])', [created.jobs]);
      await db.query('delete from app.service_job_offers where "jobId" = any($1::uuid[])', [created.jobs]);
      await db.query('delete from app.service_jobs where id = any($1::uuid[])', [created.jobs]);
    }
    if (created.providers.length) {
      await db.query('delete from app.whatsapp_messages where "providerId" = any($1::uuid[])', [created.providers]);
      await db.query('delete from app.service_providers where id = any($1::uuid[])', [created.providers]);
    }
    if (created.users.length)
      await db.query('delete from app.users where id = any($1::uuid[])', [created.users]);
    if (created.trucks.length)
      await db.query('delete from app.trucks where id = any($1::uuid[])', [created.trucks]);
  } catch (error) {
    console.error(`WARN cleanup could not remove every row: ${error.message}`);
  }
  try {
    await db.end();
  } catch {
    /* ignore */
  }
  if (fakeGraph) await new Promise((resolve) => fakeGraph.close(resolve));
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ */
/* Test                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  await db.connect();
  fakeGraph = await startFakeGraph();
  dataDir = await mkdtemp(join(tmpdir(), "fleet-whatsapp-jobs-stack-"));
  const graphUrl = `http://127.0.0.1:${fakeGraph.address().port}`;

  Object.assign(process.env, {
    SERVICE_JOB_ALERTS_ENABLED: "true",
    SERVICE_JOB_ALERT_TRANSPORT: "meta",
    SERVICE_JOB_LINK_SECRET: randomBytes(48).toString("hex"),
    META_WHATSAPP_ACCESS_TOKEN: accessToken,
    META_WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
    META_WHATSAPP_BUSINESS_ACCOUNT_ID: businessAccountId,
    META_WHATSAPP_APP_SECRET: appSecret,
    META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: webhookVerifyToken,
    META_WHATSAPP_JOB_TEMPLATE: templateName,
    META_WHATSAPP_TEMPLATE_LANGUAGE: templateLanguage,
    META_WHATSAPP_API_VERSION: apiVersion,
    META_WHATSAPP_GRAPH_URL: graphUrl,
    APP_URL: appUrl,
    MQTT_ENABLED: "false",
    FLEET_DATA_DIR: dataDir,
  });

  api = await loadApi();
  apiBase = await api.app.listen({ port: 0, host: "127.0.0.1" });
  console.log(
    `ASSUME API loaded from ${loadedFrom.kind} via ${loadedFrom.factoryName}(); ` +
      `services ${Object.entries(loadedFrom.aliases)
        .map(([role, name]) => `${role}=${name}`)
        .join(", ")}`,
  );
  console.log(
    `ASSUME webhook at POST /whatsapp/webhook, 403 for invalid signatures, replies are free-form interactive/text inside the 24h window; fake Meta Graph at ${graphUrl}`,
  );
  console.log(
    "ASSUME initial alert template name/language from META_WHATSAPP_JOB_TEMPLATE / META_WHATSAPP_TEMPLATE_LANGUAGE; no live WhatsApp traffic",
  );

  const admin = await adminContext();
  const provider = await createProvider(admin, "P");
  const otherProvider = await createProvider(admin, "Q");
  const providerPhone = provider.whatsappNumber;
  const providerDigits = digits(providerPhone);
  const truck = await createTruck("W1");
  const job = await api.jobs.createJob(admin, {
    truckId: truck.id,
    serviceType: "mechanical",
    description: "Gearbox warning light and no drive.",
    locationText: "Depot gate, Johannesburg",
    urgency: "urgent",
    notifyProviders: true,
  });
  created.jobs.push(job.id);
  console.log(`ASSUME job ${job.reference} created for a local test provider`);
  const { request: alertRequest, offer } = await waitForAlert(provider);
  assert.equal(alertRequest.body.type, "template");
  assert.equal(alertRequest.body.template.name, templateName);
  assert.equal(alertRequest.body.template.language.code, templateLanguage);
  const alertWamid = offer.wamid;
  assert.match(alertWamid, /^wamid\.test-\d+$/);
  const alertMessage = await whatsappMessage(alertWamid);
  assert.ok(alertMessage, "outbound template metadata is stored in whatsapp_messages");
  assert.equal(alertMessage.direction, "outbound");
  assert.equal(alertMessage.kind, "template");
  assert.equal(alertMessage.templateName, templateName);
  assert.equal(alertMessage.offerId, offer.id);
  assert.equal(alertMessage.providerId, provider.id);
  const linkButton = alertRequest.body.template.components.find(
    (component) => component.type === "button",
  );
  assert.equal(linkButton.index, "2");
  const linkCode = decodeURIComponent(linkButton.parameters[0].text);
  assert.match(linkCode, new RegExp(`^${offer.id}\\.[A-Za-z0-9_-]{43}$`));

  /* ---------------- Webhook verification ---------------- */
  const verify = await fetch(
    new URL(
      `whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(webhookVerifyToken)}&hub.challenge=challenge-${tag}`,
      apiBase,
    ),
    { signal: AbortSignal.timeout(15_000) },
  );
  assert.equal(verify.status, 200);
  assert.equal(await verify.text(), `challenge-${tag}`);
  const wrongVerify = await fetch(
    new URL("whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x", apiBase),
    { signal: AbortSignal.timeout(15_000) },
  );
  assert.equal(wrongVerify.status, 403, "webhook GET verification rejects a wrong verify token");

  const acceptEvent = inboundEvent(providerPhone, [
    buttonMessage(providerPhone, `wamid.in-accept-${tag}`, {
      contextWamid: alertWamid,
      text: "Accept job",
    }),
  ]);
  const acceptRaw = JSON.stringify(acceptEvent);
  const noSignature = await postWebhook(acceptEvent, { signature: null, raw: acceptRaw });
  assert.equal(noSignature.status, 403, "an unsigned webhook is rejected");
  const tamperedBody = await postWebhook(acceptEvent, {
    signature: `sha256=${"0".repeat(64)}`,
    raw: acceptRaw,
  });
  assert.equal(tamperedBody.status, 403, "a tampered webhook signature is rejected");
  assert.equal((await postWebhook({}, { raw: "{", signature: null })).status, 403,
    "signature is verified before parsing malformed JSON");
  assert.equal((await postWebhook({}, { raw: "{" })).status, 400);
  const wrongAccount = structuredClone(acceptEvent);
  wrongAccount.entry[0].id = "another-business-account";
  assert.equal((await postWebhook(wrongAccount)).status, 200);
  assert.equal(
    (await one('select 1 as found from app.whatsapp_messages where wamid = $1', [`wamid.in-accept-${tag}`])),
    undefined,
    "rejected webhooks do not store inbound messages",
  );
  assert.equal(
    (await one('select status from app.service_jobs where id = $1', [job.id])).status,
    "open",
    "rejected webhooks do not change the job",
  );
  pass(
    "Webhook verification and HMAC signatures reject unsigned/tampered requests with 403 without side effects",
  );

  /* ---------------- Delivery and read statuses ---------------- */
  let statusIndex = graphRequests.length;
  const delivered = await postWebhook(
    statusEvent([
      { id: alertWamid, status: "delivered", timestamp: nowSeconds(), recipient_id: providerDigits },
    ]),
  );
  assert.equal(delivered.status, 200);
  assert.equal(delivered.text, "EVENT_RECEIVED");
  assert.equal((await whatsappMessage(alertWamid)).status, "delivered");
  let offerRow = await one(
    'select status, "deliveredAt", "readAt" from app.service_job_offers where id = $1',
    [offer.id],
  );
  assert.equal(offerRow.status, "delivered");
  assert.ok(offerRow.deliveredAt);
  assert.equal(offerRow.readAt, null);
  const read = await postWebhook(
    statusEvent([
      { id: alertWamid, status: "read", timestamp: nowSeconds(), recipient_id: providerDigits },
    ]),
  );
  assert.equal(read.status, 200);
  assert.equal((await whatsappMessage(alertWamid)).status, "read");
  offerRow = await one(
    'select status, "deliveredAt", "readAt" from app.service_job_offers where id = $1',
    [offer.id],
  );
  assert.equal(offerRow.status, "read", "delivery state advances the offer");
  assert.ok(offerRow.readAt);
  assert.equal(Array.from(repliesSince(statusIndex)).length, 0, "status events send no replies");
  pass(
    "Delivery and read status webhooks advance whatsapp_messages and offer timestamps without sending replies",
  );

  /* ---------------- Template quick reply Accept job ---------------- */
  let replyIndex = graphRequests.length;
  const accepted = await postWebhook(acceptEvent, { raw: acceptRaw });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.text, "EVENT_RECEIVED");
  const acceptReplies = await waitFor(
    "accept confirmation replies",
    () => (graphRequests.length - replyIndex >= 2 ? repliesSince(replyIndex) : null),
    { timeout: 10_000 },
  );
  assert.equal(acceptReplies.length, 3, "accept sends the link and in-chat progress and completion buttons");
  const [confirmation, progressButtons] = acceptReplies;
  assertCtaReply(confirmation, providerPhone, {
    body: new RegExp(`You have job ${job.reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    displayText: "Open job",
    url: new RegExp(`^${appUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}j/${offer.id}\\.`),
  });
  assertButtonReply(progressButtons, providerPhone, {
    body: "Update the job",
    buttons: [
      { id: `offer:${offer.id}:en_route`, title: "On my way" },
      { id: `offer:${offer.id}:arrived`, title: "Arrived" },
      { id: `offer:${offer.id}:working`, title: "Working" },
    ],
  });
  for (const reply of acceptReplies) {
    assert.notEqual(
      reply.type,
      "template",
      "replies inside the 24-hour customer-service window are free-form, not templates",
    );
  }
  const assigned = await one(
    'select status, "providerId", "acceptedAt" from app.service_jobs where id = $1',
    [job.id],
  );
  assert.equal(assigned.status, "assigned");
  assert.equal(assigned.providerId, provider.id);
  assert.ok(assigned.acceptedAt);
  const acceptedOffer = await one(
    'select status, "responseChannel", "responderName", "respondedAt" from app.service_job_offers where id = $1',
    [offer.id],
  );
  assert.equal(acceptedOffer.status, "accepted");
  assert.equal(acceptedOffer.responseChannel, "whatsapp");
  assert.equal(acceptedOffer.responderName, "P Dispatcher");
  assert.ok(acceptedOffer.respondedAt);
  const inboundAccepted = await one(
    'select direction, kind, "fromNumber", "contextWamid", "providerId", "profileName" from app.whatsapp_messages where wamid = $1',
    [`wamid.in-accept-${tag}`],
  );
  assert.ok(inboundAccepted, "the inbound quick reply metadata is stored");
  assert.equal(inboundAccepted.direction, "inbound");
  assert.equal(inboundAccepted.kind, "interactive");
  assert.equal(inboundAccepted.fromNumber, providerDigits);
  assert.equal(inboundAccepted.contextWamid, alertWamid);
  assert.equal(inboundAccepted.providerId, provider.id);
  assert.equal(inboundAccepted.profileName, "P Dispatcher");
  const outboundReplies = await q(
    `select wamid, kind, status, "jobId", "offerId", "providerId"
       from app.whatsapp_messages
      where "jobId" = $1 and direction = 'outbound' and kind = 'interactive'
      order by "createdAt"`,
    [job.id],
  );
  assert.equal(outboundReplies.length, 3, "all replies are recorded in whatsapp_messages");
  assert.ok(outboundReplies.every((row) => row.status === "sent" && row.providerId === provider.id));
  assert.ok(outboundReplies.every((row) => row.offerId === offer.id));
  pass(
    "A signed template quick reply with context.id accepts the job and sends free-form confirmation and progress buttons inside the 24h window",
  );

  /* ---------------- Duplicate delivery is idempotent ---------------- */
  const acceptedEventsBefore = await one(
    `select count(*)::int as count from app.service_job_events where "jobId" = $1 and kind = 'accepted'`,
    [job.id],
  );
  const duplicateReplyIndex = graphRequests.length;
  const duplicate = await postWebhook(acceptEvent, { raw: acceptRaw });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.text, "EVENT_RECEIVED");
  await delay(500);
  assert.equal(
    graphRequests.length - duplicateReplyIndex,
    0,
    "a duplicate webhook delivery sends no duplicate replies",
  );
  const acceptedEventsAfter = await one(
    `select count(*)::int as count from app.service_job_events where "jobId" = $1 and kind = 'accepted'`,
    [job.id],
  );
  assert.equal(acceptedEventsAfter.count, acceptedEventsBefore.count);
  assert.equal(acceptedEventsAfter.count, 1, "the job is accepted exactly once");
  const duplicateInbound = await one(
    'select count(*)::int as count from app.whatsapp_messages where wamid = $1',
    [`wamid.in-accept-${tag}`],
  );
  assert.equal(duplicateInbound.count, 1, "duplicate message ids are stored once");
  pass(
    "Duplicate webhook delivery is idempotent: one accepted event, one inbound row and no duplicate replies",
  );

  /* ---------------- Status updates do not regress acceptance ---------------- */
  const replyWamid = outboundReplies[0].wamid;
  assert.ok(replyWamid);
  const lateRead = await postWebhook(
    statusEvent([{ id: alertWamid, status: "read", timestamp: nowSeconds(), recipient_id: providerDigits }]),
  );
  assert.equal(lateRead.status, 200);
  assert.equal(
    (await one('select status from app.service_job_offers where id = $1', [offer.id])).status,
    "accepted",
    "status updates never regress an accepted offer",
  );
  const replyDelivered = await postWebhook(
    statusEvent([{ id: replyWamid, status: "delivered", timestamp: nowSeconds(), recipient_id: providerDigits }]),
  );
  assert.equal(replyDelivered.status, 200);
  assert.equal((await whatsappMessage(replyWamid)).status, "delivered");
  pass(
    "Delivery/read status updates advance reply metadata without regressing an accepted offer",
  );

  /* ---------------- Interactive progress button ids ---------------- */
  const link = confirmation.interactive.action.parameters.url;
  const progressSteps = [
    { stage: "en_route", title: "On my way", body: "Updated: On the way.", next: [["arrived", "Arrived"], ["working", "Working"]] },
    { stage: "arrived", title: "Arrived", body: "Updated: Arrived.", next: [["working", "Working"]] },
    { stage: "working", title: "Working", body: "Updated: Working.", next: [] },
  ];
  for (const step of progressSteps) {
    const before = graphRequests.length;
    const response = await postWebhook(
      inboundEvent(providerPhone, [
        interactiveMessage(
          providerPhone,
          `wamid.in-${step.stage}-${tag}`,
          `offer:${offer.id}:${step.stage}`,
          step.title,
        ),
      ]),
    );
    assert.equal(response.status, 200);
    assert.equal(response.text, "EVENT_RECEIVED");
    const replies = await waitFor(
      `progress reply for ${step.stage}`,
      () => (graphRequests.length - before >= 1 ? repliesSince(before) : null),
      { timeout: 10_000 },
    );
    assert.equal(replies.length, 1, `progress ${step.stage} sends one confirmation reply`);
    assertButtonReply(replies[0], providerPhone, {
      body: step.body,
      buttons: [...step.next, ["complete", "Complete job"]].map(([id, title]) => ({ id: `offer:${offer.id}:${id}`, title })),
    });
  }
  const progressEventRows = await q(
    `select kind from app.service_job_events
      where "jobId" = $1 and kind in ('en_route', 'arrived', 'working')
      order by "createdAt"`,
    [job.id],
  );
  assert.deepEqual(
    progressEventRows.map((row) => row.kind),
    ["en_route", "arrived", "working"],
    "progress stages are recorded once each and in order",
  );
  const progressJob = await one('select status, "startedAt" from app.service_jobs where id = $1', [job.id]);
  assert.equal(progressJob.status, "in_progress");
  assert.ok(progressJob.startedAt);
  const unknownIdBefore = graphRequests.length;
  const unknownInteractive = await postWebhook(
    inboundEvent(providerPhone, [
      interactiveMessage(
        providerPhone,
        `wamid.in-unknown-${tag}`,
        `offer:${offer.id}:not_a_stage`,
        "Bogus",
      ),
    ]),
  );
  assert.equal(unknownInteractive.status, 200);
  await delay(300);
  assert.equal(
    graphRequests.length - unknownIdBefore,
    0,
    "an unknown interactive id is ignored without a reply",
  );
  pass(
    "Interactive progress button ids record en_route/arrived/working once and offer the in-chat Complete job button",
  );

  /* ---------------- Signed webhook direct completion ---------------- */
  const replyFor = async (phone, message) => {
    const before = graphRequests.length;
    const result = await postWebhook(inboundEvent(phone, [message]));
    assert.equal(result.status, 200, result.text);
    return repliesSince(before).at(-1);
  };
  const otherPhone = otherProvider.whatsappNumber;
  const losingOffer = await waitFor("losing provider alert", async () => {
    const row = await one('select * from app.service_job_offers where "jobId" = $1 and "providerId" = $2', [job.id, otherProvider.id]);
    return row?.whatsappMessageId ? row : null;
  });
  assertTextReply(await replyFor(otherPhone, buttonMessage(otherPhone, `wamid.in-loser-${tag}`, {
    contextWamid: losingOffer.whatsappMessageId, text: "accept_job",
  })), otherPhone, /already been assigned/);
  assertTextReply(await replyFor(otherPhone,
    interactiveMessage(otherPhone, `wamid.in-wrong-complete-${tag}`, `offer:${offer.id}:complete`, "Complete job")),
    otherPhone, /no longer available/);
  assert.equal((await one('select "chatCompletionStartedAt" as started from app.service_job_offers where id = $1', [offer.id])).started, null);

  const prompt = await replyFor(providerPhone,
    interactiveMessage(providerPhone, `wamid.in-complete-${tag}`, `offer:${offer.id}:complete`, "Complete job"));
  assertCtaReply(prompt, providerPhone, {
    body: /reply with a note/i, displayText: "Complete on web", url: `${link}#complete`,
  });
  await api.app.close();
  api = await loadApi();
  apiBase = await api.app.listen({ port: 0, host: "127.0.0.1" });
  assertTextReply(await replyFor(providerPhone, textMessage(providerPhone, `wamid.in-blank-${tag}`, "   ")),
    providerPhone, /reply with a note/i);

  const image = { from: providerDigits, id: `wamid.in-photo-${tag}`, type: "image",
    timestamp: nowSeconds(), image: { id: "123456789", mime_type: "text/plain" } };
  assertTextReply(await replyFor(providerPhone, image), providerPhone, /photo added/i);
  const beforeDuplicatePhoto = graphRequests.length;
  assert.equal((await postWebhook(inboundEvent(providerPhone, [image]))).status, 200);
  assert.equal(graphRequests.length, beforeDuplicatePhoto, "duplicate media does not send another reply");
  assertTextReply(await replyFor(providerPhone, textMessage(providerPhone, `wamid.in-cost-${tag}`, "AMOUNT 550.25")),
    providerPhone, /amount added/i);

  const note = "Patched the tyre and tested the vehicle.";
  const completionMessage = textMessage(providerPhone, `wamid.in-note-${tag}`, note);
  const completionWebhook = inboundEvent(providerPhone, [completionMessage], "P Mechanic");
  const firstCompletion = graphRequests.length;
  const submissions = await Promise.all([postWebhook(completionWebhook), postWebhook(completionWebhook)]);
  assert.ok(submissions.every((result) => result.status === 200), JSON.stringify(submissions));
  const confirmations = repliesSince(firstCompletion);
  assert.equal(confirmations.length, 1, "duplicate completion sends only one confirmation");
  assertTextReply(confirmations[0], providerPhone, /is complete/);
  assertTextReply(await replyFor(providerPhone, textMessage(providerPhone, `wamid.in-completed-again-${tag}`, "DONE")),
    providerPhone, /already complete/);

  const completed = await api.jobs.getJob(job.id);
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.completionNote, note);
  assert.equal(completed.job.completionCostCents, 55025);
  assert.equal(completed.events.filter((event) => event.kind === "completed").length, 1);
  assert.deepEqual(completed.events.filter((event) => event.kind === "completed")
    .map(({ channel, actorName }) => ({ channel, actorName })), [{ channel: "whatsapp", actorName: "P Mechanic" }]);
  assert.equal(completed.attachments.length, 1);
  assert.deepEqual((await api.jobs.adminPhoto(job.id, completed.attachments[0].id)).buffer, fakePhoto);
  pass("Signed webhooks complete in chat after an API restart, with note, photo and amount; wrong provider and duplicates are safe");

  /* ---------------- Expiry and signed web fallback ---------------- */
  const fallbackTruck = await createTruck("WF");
  const fallbackJob = await api.jobs.createJob(admin, {
    truckId: fallbackTruck.id, serviceType: "towing", description: "Towing needed.", notifyProviders: true,
  });
  created.jobs.push(fallbackJob.id);
  const fallbackOffer = await waitFor("fallback job offer", async () => {
    const row = await one('select * from app.service_job_offers where "jobId" = $1 and "providerId" = $2', [fallbackJob.id, provider.id]);
    return row?.whatsappMessageId ? row : null;
  });
  await replyFor(providerPhone, buttonMessage(providerPhone, `wamid.in-fallback-accept-${tag}`, { contextWamid: fallbackOffer.whatsappMessageId, text: "accept_job" }));
  const fallbackPrompt = await replyFor(providerPhone, textMessage(providerPhone, `wamid.in-fallback-done-${tag}`, "COMPLETE"));
  const fallbackLink = fallbackPrompt.interactive.action.parameters.url;
  await q('update app.service_job_offers set "chatCompletionExpiresAt" = now() where id = $1', [fallbackOffer.id]);

  const reminderSince = graphRequests.length;
  await api.app.close();
  api = await loadApi();
  apiBase = await api.app.listen({ port: 0, host: "127.0.0.1" });
  const reminder = await waitFor("unanswered completion reminder", () => repliesSince(reminderSince).find(
    (reply) => reply?.interactive?.action?.parameters?.url === fallbackLink));
  assertCtaReply(reminder, providerPhone, { body: /record what was done/i, displayText: "Complete on web", url: fallbackLink });
  const expired = await replyFor(providerPhone, textMessage(providerPhone, `wamid.in-expired-note-${tag}`, "This late note must not complete the job."));
  assertCtaReply(expired, providerPhone, { body: /record what was done/i, displayText: "Complete on web", url: fallbackLink });
  assert.equal((await api.jobs.getJob(fallbackJob.id)).job.status, "assigned");
  const form = new FormData();
  form.set("note", "Finished on the fallback page.");
  const code = new URL(fallbackLink).pathname.slice(3);
  const viaWeb = await fetch(new URL("public/service-job/complete", apiBase), {
    method: "POST", headers: { Authorization: `Bearer ${code}` }, body: form,
  });
  assert.equal(viaWeb.status, 200, await viaWeb.text());
  const checked = await api.jobs.getJob(fallbackJob.id);
  assert.equal(checked.events.find((event) => event.kind === "completed").channel, "web");
  pass("Expired chats send the signed fallback link; the web form records the same audited completion event");

  /* ---------------- Text STOP opts the provider out ---------------- */
  const templatesBeforeStop = templateSendsTo(providerPhone).length;
  const stopBefore = graphRequests.length;
  const stop = await postWebhook(
    inboundEvent(providerPhone, [textMessage(providerPhone, `wamid.in-stop-${tag}`, "STOP")]),
  );
  assert.equal(stop.status, 200);
  const stopReplies = await waitFor(
    "STOP confirmation",
    () => (graphRequests.length - stopBefore >= 1 ? repliesSince(stopBefore) : null),
    { timeout: 10_000 },
  );
  assert.equal(stopReplies.length, 1);
  assertTextReply(stopReplies[0], providerPhone, /no longer receive VHH Fleet job alerts/);
  const optedOut = await one(
    'select "alertsEnabled", "optedOutAt", "optOutReason" from app.service_providers where id = $1',
    [provider.id],
  );
  assert.equal(optedOut.alertsEnabled, false);
  assert.ok(optedOut.optedOutAt);
  assert.equal(optedOut.optOutReason, "WhatsApp STOP");
  const optedOutOffer = await one(
    'select status from app.service_job_offers where id = $1',
    [offer.id],
  );
  assert.equal(optedOutOffer.status, "accepted", "opt-out leaves accepted work untouched");
  const stopOutbound = await one(
    `select "providerId", kind from app.whatsapp_messages
      where "providerId" = $1 and direction = 'outbound' and kind = 'text'
      order by "createdAt" desc limit 1`,
    [provider.id],
  );
  assert.ok(stopOutbound, "the opt-out confirmation is recorded in whatsapp_messages");
  assert.equal(stopOutbound.kind, "text");

  // An opted-out provider is excluded from later alerts.
  const truck2 = await createTruck("W2");
  const job2 = await api.jobs.createJob(admin, {
    truckId: truck2.id,
    serviceType: "towing",
    description: "Truck is stuck on the N3 shoulder.",
    notifyProviders: true,
  });
  created.jobs.push(job2.id);
  await waitFor(
    "job 2 alert queue decision",
    async () => {
      const row = await one(
        `select 1 as found from app.service_job_events
          where "jobId" = $1 and kind in ('alerts_queued', 'alerts_skipped')`,
        [job2.id],
      );
      return row?.found === 1;
    },
    { timeout: 20_000 },
  );
  const optedOutOfferForJob2 = await one(
    'select 1 as found from app.service_job_offers where "jobId" = $1 and "providerId" = $2',
    [job2.id, provider.id],
  );
  assert.equal(
    optedOutOfferForJob2,
    undefined,
    "an opted-out provider receives no offer for later jobs",
  );
  await delay(500);
  assert.equal(
    templateSendsTo(providerPhone).length,
    templatesBeforeStop,
    "an opted-out provider receives no later alert template",
  );
  const providerAgain = await api.jobs.providerByPhone(providerDigits);
  assert.equal(providerAgain.alertsEnabled, false);
  pass(
    "Text STOP disables provider alerts, stores the opt-out and excludes the provider from later job alerts",
  );

  const declineOffer = await waitFor("second provider alert for decline", async () => {
    const row = await one('select * from app.service_job_offers where "jobId" = $1 and "providerId" = $2', [job2.id, otherProvider.id]);
    return row?.whatsappMessageId ? row : null;
  });
  assertTextReply(await replyFor(otherPhone, buttonMessage(otherPhone, `wamid.in-decline-${tag}`, {
    contextWamid: declineOffer.whatsappMessageId, text: "cant_take",
  })), otherPhone, /ask another provider/);
  const declineAudit = (await api.jobs.getJob(job2.id)).events.find((event) => event.kind === "declined");
  assert.equal(declineAudit.channel, "whatsapp");
  pass("Template quick replies report covered work to the losing provider and audit a decline");

  console.log(
    `PASS cleanup will remove ${created.jobs.length} jobs, ${created.providers.length} providers, ${created.trucks.length} trucks and all whatsapp_messages/offers/events`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`FAIL ${error?.message ?? error}`);
  if (error?.stack) console.error(error.stack);
  process.exitCode = 1;
} finally {
  await cleanup();
}
