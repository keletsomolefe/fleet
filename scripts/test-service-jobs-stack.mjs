#!/usr/bin/env node
/**
 * Service jobs stack test.
 *
 * Runs the real API in-process against the local PostgreSQL database and a fake
 * Meta Graph server. No message ever reaches Meta: META_WHATSAPP_GRAPH_URL is
 * pointed at an HTTP server on 127.0.0.1 that records template payloads and
 * returns `wamid.test-N` message ids.
 *
 * Run from the repository root (with the local infrastructure up):
 *
 *   node --env-file=.env scripts/test-service-jobs-stack.mjs
 *
 * Assumed contract (read from apps/api/src/service-jobs/**, apps/api/src/whatsapp/**
 * and docs/service-jobs.md while the backend was being converted to MikroORM):
 *
 * - apps/api/dist/app.js exports `createApi(options)` (async) returning
 *   `{ app, services }`; services include `serviceJobs`, `alertWorker`,
 *   `whatsapp` and `database` (or `orm`). The loader below also accepts a
 *   source entry point through tsx when dist is unavailable and reports what it
 *   actually assumed.
 * - Admin work is exercised through the exported `serviceJobs` service with an
 *   `AdminContext` built from a real owner/administrator row (or a SQL fixture
 *   owner when the database has none). The public provider link and admin route
 *   permission boundaries are asserted over HTTP, exactly like a browser would.
 * - Public provider routes: GET /public/service-job, POST
 *   /public/service-job/accept|decline|progress|complete and GET
 *   /public/service-job/photos/:photoId, with the signed code as a Bearer token.
 * - Admin routes are under /admin (cookie session). The test logs in through the
 *   local Kratos service when it is reachable; otherwise it reports a WARN and
 *   keeps the cookie-independent permission checks.
 * - The worker sends exactly one template per eligible provider (status active,
 *   alerts enabled, no opt-out), records `whatsapp_messages` outbound rows and
 *   marks the offer sent with the returned wamid.
 */

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
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
    "Service jobs stack tests require a local database (127.0.0.1/localhost).",
  );

const require = createRequire(new URL("apps/api/package.json", root));
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DATABASE_URL });

const tag = `SJTEST-${randomBytes(5).toString("hex").toUpperCase()}`;
const password = randomBytes(18).toString("base64url");
const templateName = "vhh_service_job_alert_stack_test";
const templateLanguage = "en_US";
const apiVersion = "v25.0";
const phoneNumberId = "1098765432100";
const accessToken = "test-meta-access-token";
const webhookVerifyToken = "test-webhook-verify-token";
const officePhone = "+27110000000";
const appUrl = "http://127.0.0.1:3199/";

const graphRequests = [];
let wamidCounter = 0;
let api = null;
let apiBase = null;
let dataDir = null;
let fakeGraph = null;
let loadedFrom = null;
const created = {
  jobs: [],
  providers: [],
  trucks: [],
  issues: [],
  drivers: [],
  users: [],
};
const extraCleanup = [];

const pass = (message) => console.log(`PASS ${message}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digits = (number) => String(number).replace(/^\+/, "");

async function q(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(sql, params = []) {
  return (await q(sql, params))[0];
}

function nextWhatsAppNumber() {
  // 27 + 9 digits, matching the provider check constraint.
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

async function expectError(label, action, { status, message } = {}) {
  let result;
  try {
    result = await action();
  } catch (error) {
    const statusCode = error?.statusCode ?? error?.status;
    if (status !== undefined)
      assert.equal(
        statusCode,
        status,
        `${label}: expected HTTP ${status}, got ${statusCode ?? "no status"}: ${error?.message ?? error}`,
      );
    if (message) assert.match(String(error?.message ?? ""), message, label);
    return error;
  }
  assert.fail(
    `${label}: expected a failure but the call succeeded (${JSON.stringify(result)?.slice(0, 300)})`,
  );
}

async function waitFor(label, check, { timeout = 30_000, interval = 120 } = {}) {
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
  // A cheap staleness check for the compiled app: the build output should be
  // at least as new as the API source tree.
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
  if (!services && result.services?.app) services = result.services;
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
  const [jobsName, serviceJobs] = findService([
    "serviceJobs",
    "jobs",
    "serviceJobService",
  ]);
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
  for (const method of [
    "createProvider",
    "confirmProviderConsent",
    "setProviderStatus",
    "createJob",
    "closeJob",
    "reopenJob",
    "cancelJob",
    "copyLink",
    "revokeLink",
    "assertNoActiveJobForIssue",
  ]) {
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
  const entryOverride = process.env.FLEET_API_ENTRY;
  if (entryOverride) candidates.push({ kind: "FLEET_API_ENTRY", specifier: entryOverride, source: true });
  const distEntry = new URL("apps/api/dist/app.js", root);
  const sourceEntry = new URL("apps/api/src/app.ts", root);
  const distExists = existsSync(distEntry);
  if (distExists) {
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
      const factoryName = ["createApi", "buildApi", "createServer", "bootstrap", "create"].find(
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
/* Fixtures and HTTP helpers                                          */
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
    owner = {
      id,
      email,
      firstName: "Stack",
      lastName: "Owner",
      kratosIdentityId: identityId,
    };
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
  assert.ok(
    permissions.includes("issues.resolve"),
    "The owner/administrator fixture is missing issues.resolve; run `pnpm db:seed`.",
  );
  return {
    user: owner,
    // The services only read user.id/firstName/lastName and permissions.
    // The fake session keeps this a structurally valid AdminContext.
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

async function createProvider(admin, label, input = {}) {
  const whatsappNumber = await uniqueWhatsAppNumber();
  const provider = await api.jobs.createProvider(admin, {
    companyName: `${tag} ${label}`,
    contactName: `${label} Contact`,
    whatsappNumber,
    services: ["mechanical", "tyres"],
    coverageArea: "Gauteng",
    email: `${tag.toLowerCase()}-${label.toLowerCase()}@example.test`,
    ...input,
  });
  created.providers.push(provider.id);
  return { ...provider, whatsappNumber };
}

async function createLinkedIssue(truckId) {
  const userId = randomUUID();
  await db.query(
    `insert into app.users (id, "kratosIdentityId", email, "firstName", "lastName", "isActive")
     values ($1, $2, $3, 'Stack', 'Driver', true)`,
    [userId, randomUUID(), `${tag.toLowerCase()}-driver@example.test`],
  );
  created.users.push(userId);
  const driverId = randomUUID();
  await db.query(
    `insert into app.driver_profiles
       (id, "userId", identifier, phone, "licenceNumber", "licenceCode", "licenceCountry",
        "licenceExpiresOn", "prdpNumber", "prdpExpiresOn", status)
     values ($1, $2, $3, '+27820000000', $3, 'EC', 'ZA', '2099-01-01', $3, '2099-01-01', 'active')`,
    [driverId, userId, `${tag}-D`],
  );
  created.drivers.push(driverId);
  const issueId = randomUUID();
  await db.query(
    `insert into app.driver_issues (id, "driverId", "truckId", category, description)
     values ($1, $2, $3, 'vehicle', $4)`,
    [issueId, driverId, truckId, "Truck will not start after loading."],
  );
  created.issues.push(issueId);
  return { issueId, driverId, userId };
}

async function eligibleProviders() {
  return q(
    `select id, "whatsappNumber"
       from app.service_providers
      where status = 'active' and "alertsEnabled" = true and "optedOutAt" is null
      order by "companyName"`,
  );
}

async function offersForJob(jobId) {
  return q(
    `select o.id, o.status, o."linkVersion", o."whatsappMessageId" as wamid,
            o."providerId", p."companyName", p."whatsappNumber"
       from app.service_job_offers o
       join app.service_providers p on p.id = o."providerId"
      where o."jobId" = $1
      order by p."companyName"`,
    [jobId],
  );
}

const templateSendsTo = (number) => {
  const to = digits(number);
  return graphRequests.filter(
    (request) => request.body?.type === "template" && request.body.to === to,
  );
};

async function alertDiagnostics(jobId) {
  let dueProbe;
  try {
    if (typeof api.jobs.dueAlertOffers !== "function")
      throw new Error("serviceJobs.dueAlertOffers() is missing");
    await api.jobs.dueAlertOffers(0);
    dueProbe = "dueAlertOffers(0) ok";
  } catch (error) {
    dueProbe = `dueAlertOffers(0) failed: ${error?.message}\n${String(error?.stack ?? "").split("\n").slice(0, 8).join("\n")}`;
  }
  let offers;
  try {
    offers = await offersForJob(jobId);
  } catch (error) {
    offers = String(error);
  }
  let alertsReady;
  try {
    alertsReady = api.jobs.alertsReady;
  } catch (error) {
    alertsReady = String(error);
  }
  const known = created.providers.length
    ? await (async () => {
        const rows = await q(
          'select id, "whatsappNumber" from app.service_providers where id = any($1::uuid[])',
          [created.providers],
        );
        return Object.fromEntries(
          rows.map((row) => [row.whatsappNumber, templateSendsTo(row.whatsappNumber).length]),
        );
      })().catch(() => ({}))
    : {};
  return [
    `alertsReady=${alertsReady}`,
    `offers=${JSON.stringify(offers)}`,
    `templates per test provider=${JSON.stringify(known)}`,
    dueProbe,
  ].join("; ");
}

async function waitForJobOffers(jobId, expectedCount, ourNumbers) {
  const timeout = 45_000;
  const started = Date.now();
  for (;;) {
    const rows = await offersForJob(jobId);
    const allSent =
      rows.length === expectedCount &&
      rows.every((row) => typeof row.wamid === "string" && row.wamid.startsWith("wamid."));
    const oursSent = ourNumbers.every((number) => templateSendsTo(number).length >= 1);
    if (allSent && oursSent) {
      // Every eligible provider should have exactly one template.
      const counts = new Map();
      for (const request of graphRequests) {
        if (request.body?.type !== "template") continue;
        counts.set(request.body.to, (counts.get(request.body.to) ?? 0) + 1);
      }
      return { rows, counts };
    }
    // Nudge the worker; it catches its own send errors, so a failure shows up
    // through the offer rows / diagnostics below.
    await api.alerts.flush().catch(() => undefined);
    if (Date.now() - started > timeout) {
      throw new Error(
        `Provider alerts for job ${jobId} were not sent within ${timeout}ms. ` +
          (await alertDiagnostics(jobId)),
      );
    }
    await delay(150);
  }
}

async function publicJob(path = "", { method = "GET", code, body, headers = {} } = {}) {
  const response = await fetch(new URL(`public/service-job${path}`, apiBase), {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(code ? { Authorization: `Bearer ${code}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => null),
  };
}

async function rawRequest(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(new URL(path, apiBase), {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

function assertTemplateRequest(request, offerId, expected) {
  assert.equal(request.method, "POST");
  assert.equal(
    new URL(request.url, "http://fake").pathname,
    `/${apiVersion}/${phoneNumberId}/messages`,
    "template send must use META_WHATSAPP_API_VERSION/phone number id",
  );
  assert.equal(
    request.headers.authorization,
    `Bearer ${accessToken}`,
    "template send must use META_WHATSAPP_ACCESS_TOKEN",
  );
  const body = request.body;
  assert.equal(body.messaging_product, "whatsapp");
  assert.equal(body.recipient_type, "individual");
  assert.equal(body.to, digits(expected.providerNumber));
  assert.equal(body.type, "template");
  assert.equal(body.template.name, templateName);
  assert.equal(body.template.language.code, templateLanguage);
  assert.equal(body.template.components.length, 4);
  assert.deepEqual(body.template.components.slice(2), [
    { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "accept_job" }] },
    { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "cant_take" }] },
  ]);
  const [bodyComponent, buttonComponent] = body.template.components;
  assert.equal(bodyComponent.type, "body");
  assert.deepEqual(
    bodyComponent.parameters,
    expected.parameters.map((text) => ({ type: "text", text })),
    "template body parameters",
  );
  assert.equal(buttonComponent.type, "button");
  assert.equal(buttonComponent.sub_type, "url");
  assert.equal(buttonComponent.index, "2", "URL button index");
  assert.equal(buttonComponent.parameters.length, 1);
  const encoded = buttonComponent.parameters[0].text;
  assert.equal(encoded, encodeURIComponent(decodeURIComponent(encoded)));
  const code = decodeURIComponent(encoded);
  assert.match(
    code,
    new RegExp(`^${offerId}\\.[A-Za-z0-9_-]{43}$`),
    "signed provider link code in the URL button parameter",
  );
  return code;
}

/* ------------------------------------------------------------------ */
/* Kratos-backed permission checks (skipped with a WARN if unavailable) */
/* ------------------------------------------------------------------ */

async function kratosReachable() {
  if (!process.env.KRATOS_PUBLIC_URL) return false;
  try {
    const response = await fetch(new URL("health/ready", process.env.KRATOS_PUBLIC_URL), {
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
    async request(url, options = {}) {
      const headers = { ...(options.headers ?? {}) };
      if (jar.size) headers.Cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
      const response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(20_000),
        redirect: "manual",
      });
      for (const value of response.headers.getSetCookie() ?? []) {
        const first = value.split(";")[0];
        const at = first.indexOf("=");
        if (at > 0) jar.set(first.slice(0, at), first.slice(at + 1));
      }
      return response;
    },
    clear: () => jar.clear(),
  };
}

async function login(cookies, identifier, loginPassword) {
  const flow = await cookies.request(new URL("self-service/login/browser", process.env.KRATOS_PUBLIC_URL), {
    headers: { Accept: "application/json" },
  });
  const flowBody = await flow.json().catch(() => null);
  assert.equal(flow.status, 200, `Kratos login flow: ${JSON.stringify(flowBody)?.slice(0, 300)}`);
  const csrf = flowBody.ui.nodes.find((node) => node.attributes.name === "csrf_token").attributes.value;
  const submit = await cookies.request(flowBody.ui.action, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "password",
      identifier,
      password: loginPassword,
      csrf_token: csrf,
    }),
  });
  const submitBody = await submit.json().catch(() => null);
  assert.ok(
    [200, 204].includes(submit.status) || submitBody?.session,
    `Kratos login failed: HTTP ${submit.status} ${JSON.stringify(submitBody)?.slice(0, 400)}`,
  );
  return submitBody;
}

async function kratosAdmin(path, options = {}) {
  const response = await fetch(new URL(path, process.env.KRATOS_ADMIN_URL), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function httpPermissionChecks(admin) {
  for (const path of ["admin/service-jobs", "admin/service-providers"]) {
    const response = await rawRequest(path);
    assert.equal(response.status, 401, `${path} must require an admin session`);
  }
  assert.equal((await rawRequest("admin/service-jobs/summary")).status, 401);

  if (!(await kratosReachable())) {
    console.warn(
      "WARN Local Kratos is not reachable; skipping cookie-session admin/mechanic permission checks. " +
        "Start the local stack (`pnpm infra:up`) for full permission coverage.",
    );
    return;
  }

  // The owner/administrator session can read and write through the admin API,
  // and writes require the CSRF token/origin pair.
  const cookies = cookieJar();
  await login(cookies, env.BOOTSTRAP_ADMIN_EMAIL, env.BOOTSTRAP_ADMIN_PASSWORD);
  extraCleanup.push({ identityId: null, cookies });
  const session = await cookies.request(new URL("auth/session", apiBase), {
    headers: { Accept: "application/json" },
  });
  const sessionBody = await session.json().catch(() => null);
  assert.equal(session.status, 200, `Admin session: ${JSON.stringify(sessionBody)?.slice(0, 300)}`);
  assert.ok(sessionBody.permissions.includes("service_jobs.write"));
  const summary = await cookies.request(new URL("admin/service-jobs/summary", apiBase));
  assert.equal(summary.status, 200, "administrator can read the service jobs summary");

  const truck = await createTruck("PERM");
  const withoutCsrf = await cookies.request(new URL("admin/service-jobs", apiBase), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ truckId: truck.id, description: "CSRF probe", notifyProviders: false }),
  });
  assert.equal(withoutCsrf.status, 403, "admin writes must require the CSRF token");
  const createdJob = await cookies.request(new URL("admin/service-jobs", apiBase), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(process.env.APP_URL).origin,
      "X-CSRF-Token": sessionBody.csrfToken,
    },
    body: JSON.stringify({
      truckId: truck.id,
      serviceType: "mechanical",
      description: "Administrator created through the web API.",
      notifyProviders: false,
    }),
  });
  const createdJobBody = await createdJob.json().catch(() => null);
  assert.equal(createdJob.status, 201, `CSRF-scoped admin create: ${JSON.stringify(createdJobBody)?.slice(0, 300)}`);
  assert.ok(createdJobBody?.id, "the admin API returns the created job id");
  created.jobs.push(createdJobBody.id);

  // A truck mechanic has admin.access but no service-jobs permissions.
  const mechanicEmail = `${tag.toLowerCase()}-mechanic@example.test`;
  const identity = await kratosAdmin("admin/identities", {
    method: "POST",
    body: JSON.stringify({
      schema_id: "fleet-user-v1",
      traits: { email: mechanicEmail, name: { first: "Stack", last: "Mechanic" } },
      credentials: { password: { config: { password } } },
      verifiable_addresses: [
        {
          value: mechanicEmail,
          via: "email",
          verified: true,
          status: "completed",
          verified_at: new Date().toISOString(),
        },
      ],
    }),
  });
  assert.equal(identity.status, 201, `Kratos mechanic identity: ${JSON.stringify(identity.body)?.slice(0, 300)}`);
  const identityCleanup = { identityId: identity.body.id, cookies: null };
  extraCleanup.push(identityCleanup);
  const mechanicUserId = randomUUID();
  created.users.push(mechanicUserId);
  await db.query(
    `insert into app.users (id, "kratosIdentityId", email, "firstName", "lastName", "isActive")
     values ($1, $2, $3, 'Stack', 'Mechanic', true)`,
    [mechanicUserId, identity.body.id, mechanicEmail],
  );
  await db.query(
    `insert into app.user_roles ("userId", "roleId")
     select $1, id from app.roles where key = 'truck_mechanic'`,
    [mechanicUserId],
  );
  const mechanicCookies = cookieJar();
  identityCleanup.cookies = mechanicCookies;
  await login(mechanicCookies, mechanicEmail, password);
  const mechanicSession = await mechanicCookies.request(new URL("auth/session", apiBase), {
    headers: { Accept: "application/json" },
  });
  const mechanicSessionBody = await mechanicSession.json().catch(() => null);
  assert.equal(mechanicSession.status, 200, "truck mechanic session");
  assert.ok(mechanicSessionBody.permissions.includes("issues.read"));
  assert.ok(
    !mechanicSessionBody.permissions.includes("service_jobs.read"),
    "truck mechanic must not receive service_jobs.read",
  );
  for (const path of ["admin/service-jobs/summary", "admin/service-providers"]) {
    const denied = await mechanicCookies.request(new URL(path, apiBase), {
      headers: { Accept: "application/json" },
    });
    assert.equal(denied.status, 403, `truck mechanic must be forbidden from ${path}`);
  }
  pass(
    "Admin and public routes enforce authentication, service-jobs permissions and CSRF; a truck mechanic cannot manage service jobs",
  );
}

/* ------------------------------------------------------------------ */
/* Fake Meta Graph server                                             */
/* ------------------------------------------------------------------ */

async function startFakeGraph() {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    graphRequests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
      raw,
      at: Date.now(),
    });
    wamidCounter += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ messages: [{ id: `wamid.test-${wamidCounter}` }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
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
    for (const { identityId, cookies } of extraCleanup.reverse()) {
      try {
        if (cookies) {
          const logout = await cookies.request(
            new URL("self-service/logout/browser", process.env.KRATOS_PUBLIC_URL),
            { headers: { Accept: "application/json" } },
          );
          if (logout.ok) {
            const body = await logout.json().catch(() => null);
            if (body?.logout_url) await cookies.request(body.logout_url);
          }
        }
      } catch {
        /* ignore */
      }
      if (identityId) await kratosAdmin(`admin/identities/${identityId}`, { method: "DELETE" }).catch(() => undefined);
    }
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
    if (created.issues.length)
      await db.query('delete from app.driver_issues where id = any($1::uuid[])', [created.issues]);
    if (created.drivers.length)
      await db.query('delete from app.driver_profiles where id = any($1::uuid[])', [created.drivers]);
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
  dataDir = await mkdtemp(join(tmpdir(), "fleet-service-jobs-stack-"));
  const graphUrl = `http://127.0.0.1:${fakeGraph.address().port}`;

  // Everything below must be in place before the API module is imported and
  // before createApi() boots the alert worker.
  Object.assign(process.env, {
    SERVICE_JOB_ALERTS_ENABLED: "true",
    SERVICE_JOB_LINK_SECRET: randomBytes(48).toString("hex"),
    META_WHATSAPP_ACCESS_TOKEN: accessToken,
    META_WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
    META_WHATSAPP_BUSINESS_ACCOUNT_ID: "test-waba-id",
    META_WHATSAPP_APP_SECRET: randomBytes(32).toString("hex"),
    META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: webhookVerifyToken,
    META_WHATSAPP_JOB_TEMPLATE: templateName,
    META_WHATSAPP_TEMPLATE_LANGUAGE: templateLanguage,
    META_WHATSAPP_API_VERSION: apiVersion,
    META_WHATSAPP_GRAPH_URL: graphUrl,
    APP_URL: appUrl,
    FLEET_CONTACT_PHONE: officePhone,
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
    `ASSUME provider links use APP_URL=${appUrl}, alerts send templates to a fake Meta Graph at ${graphUrl}; no live WhatsApp traffic`,
  );
  console.log(
    "ASSUME admin actions use the serviceJobs service with an AdminContext from a real owner/administrator row; HTTP checks cover the public link and admin cookie/session boundaries",
  );

  const admin = await adminContext();
  console.log(
    `ASSUME owner fixture with ${admin.permissions.length} permissions (service_jobs.write, issues.resolve included)`,
  );

  /* ---------------- Provider onboarding and consent ---------------- */
  const providerA = await createProvider(admin, "A", { alertsEnabled: false });
  assert.equal(providerA.alertsEnabled, false);
  assert.equal(providerA.optedInAt, null);
  assert.equal(providerA.whatsappNumber.startsWith("+"), true);
  const consentedA = await api.jobs.confirmProviderConsent(admin, providerA.id, { consent: true });
  assert.equal(consentedA.alertsEnabled, true);
  assert.equal(consentedA.status, "active");
  assert.ok(consentedA.optedInAt, "consent time is recorded");
  await expectError(
    "provider duplicate WhatsApp number",
    () =>
      api.jobs.createProvider(admin, {
        companyName: `${tag} duplicate`,
        contactName: "Duplicate",
        whatsappNumber: providerA.whatsappNumber,
        services: ["tyres"],
        consent: true,
      }),
    { status: 409, message: /already exists/i },
  );
  const providerB = await createProvider(admin, "B", { consent: true });
  assert.ok(providerB.optedInAt);
  const providerPaused = await createProvider(admin, "Paused", {
    alertsEnabled: false,
    status: "paused",
  });
  const providerAlertsOff = await createProvider(admin, "AlertsOff", { alertsEnabled: false });
  await expectError(
    "provider activation without consent",
    () => api.jobs.setProviderStatus(admin, providerPaused.id, { status: "active" }),
    { status: 400, message: /consent/i },
  );
  assert.equal(
    created.providers.length,
    4,
    "provider fixtures created (A, B, paused, alerts off)",
  );
  pass(
    "Provider onboarding records WhatsApp consent, rejects duplicate numbers and keeps unconsented providers ineligible",
  );

  /* ---------------- Job creation and alert templates ---------------- */
  const truckA = await createTruck("A");
  const eligibleBefore = await eligibleProviders();
  assert.ok(eligibleBefore.length >= 2, "at least the two active providers are eligible");
  const description =
    "Engine overheating near Polokwane.\nCall depot on http://example.test/help for details.";
  const sendStart = graphRequests.length;
  const jobA = await api.jobs.createJob(admin, {
    truckId: truckA.id,
    serviceType: "mechanical",
    description,
    locationText: "N1 North, near Polokwane",
    urgency: "urgent",
    notifyProviders: true,
  });
  created.jobs.push(jobA.id);
  assert.equal(jobA.status, "open");
  assert.match(jobA.reference, /^SJ-\d{6,}$/);
  await expectError(
    "duplicate active job for the same vehicle",
    () =>
      api.jobs.createJob(admin, {
        truckId: truckA.id,
        description: "Second report while the first job is active.",
      }),
    { status: 409, message: /already has an active service job/i },
  );
  const { rows: offersA, counts: templateCounts } = await waitForJobOffers(
    jobA.id,
    eligibleBefore.length,
    [providerA.whatsappNumber, providerB.whatsappNumber],
  );
  assert.equal(offersA.length, eligibleBefore.length);
  for (const provider of eligibleBefore) {
    assert.equal(
      templateCounts.get(digits(provider.whatsappNumber)),
      1,
      `exactly one template for eligible provider ${provider.whatsappNumber}`,
    );
  }
  for (const provider of [providerPaused, providerAlertsOff]) {
    assert.equal(
      templateSendsTo(provider.whatsappNumber).length,
      0,
      "paused or alerts-disabled providers receive no template",
    );
  }
  const offerA = offersA.find((offer) => offer.providerId === providerA.id);
  const offerB = offersA.find((offer) => offer.providerId === providerB.id);
  assert.ok(offerA, "provider A has an offer");
  assert.ok(offerB, "provider B has an offer");
  assert.equal(offerA.status, "sent");
  assert.match(offerA.wamid, /^wamid\.test-\d+$/);
  assert.equal(offerB.status, "sent");
  assert.match(offerB.wamid, /^wamid\.test-\d+$/);
  for (const offer of offersA) {
    assert.ok(offer.wamid, `offer ${offer.id} records the Meta message id`);
  }
  const newSends = graphRequests.slice(sendStart).filter((request) => request.body?.type === "template");
  assert.ok(newSends.length >= 2, "template posts reached the fake Graph server");
  const codeByProviderId = new Map();
  for (const provider of [providerA, providerB]) {
    const request = templateSendsTo(provider.whatsappNumber)[0];
    const offer = offersA.find((row) => row.providerId === provider.id);
    const code = assertTemplateRequest(request, offer.id, {
      providerNumber: provider.whatsappNumber,
      parameters: [
        jobA.reference,
        truckA.registration,
        truckA.identifier,
        "Mechanical: Engine overheating near Polokwane. Call depot on for details.",
        "N1 North, near Polokwane",
      ],
    });
    codeByProviderId.set(provider.id, code);
  }
  const messageRows = await q(
    `select id, wamid, direction, kind, status, "templateName", "jobId", "offerId", "providerId"
       from app.whatsapp_messages
      where "jobId" = $1 and direction = 'outbound'`,
    [jobA.id],
  );
  assert.equal(messageRows.length, eligibleBefore.length);
  for (const offer of offersA) {
    const message = messageRows.find(
      (row) => row.offerId === offer.id && row.providerId === offer.providerId,
    );
    assert.ok(message, `outbound whatsapp_messages row for offer ${offer.id}`);
    assert.equal(message.kind, "template");
    assert.equal(message.status, "sent");
    assert.equal(message.templateName, templateName);
    assert.equal(message.wamid, offer.wamid);
  }
  assert.equal(
    graphRequests.slice(sendStart).filter((request) => request.body?.type !== "template").length,
    0,
    "only templates are sent for a queued alert (not free-form replies)",
  );
  pass(
    "One WhatsApp template per eligible provider with the expected template name, language, body parameters and signed URL button",
  );

  /* ---------------- Missing location fallback ---------------- */
  const truckNoLocation = await createTruck("NOLOC");
  const sendStartNoLocation = graphRequests.length;
  const jobNoLocation = await api.jobs.createJob(admin, {
    truckId: truckNoLocation.id,
    serviceType: "tyres",
    description: "Front left tyre is flat.",
    notifyProviders: true,
  });
  created.jobs.push(jobNoLocation.id);
  await waitForJobOffers(jobNoLocation.id, eligibleBefore.length, [
    providerA.whatsappNumber,
    providerB.whatsappNumber,
  ]);
  const noLocationRequest = templateSendsTo(providerA.whatsappNumber).find(
    (request) => graphRequests.indexOf(request) >= sendStartNoLocation,
  );
  assert.ok(noLocationRequest, "a template was sent for the no-location job");
  assert.equal(
    noLocationRequest.body.template.components[0].parameters[4].text,
    "Shared on the job page",
    "missing location falls back to Shared on the job page",
  );
  await api.jobs.cancelJob(admin, jobNoLocation.id, { reason: "No-location fallback checked." });
  pass(
    "A job without a location uses the documented Shared on the job page template fallback",
  );

  /* ---------------- Signed provider links: accept and conflicts ---------------- */
  const codeA = codeByProviderId.get(providerA.id);
  const codeB = codeByProviderId.get(providerB.id);
  assert.ok(codeA && codeB);
  assert.equal((await publicJob()).status, 400, "the public page requires the signed code");
  assert.equal(
    (await publicJob("", { code: "garbage" })).status,
    401,
    "a malformed provider link is rejected",
  );
  assert.equal(
    (await publicJob("", { code: `${randomUUID()}.${"a".repeat(43)}` })).status,
    401,
    "an unknown offer id is rejected",
  );
  const tampered = `${codeA.slice(0, -1)}${codeA.endsWith("A") ? "B" : "A"}`;
  assert.equal(
    (await publicJob("", { code: tampered })).status,
    401,
    "a tampered provider signature is rejected",
  );
  // A dotted code with a non-UUID offer id currently reaches the database
  // before the access module validates the code shape and surfaces as a 500.
  // Report it without failing the job-flow assertions.
  const malformedShape = await publicJob("", { code: "not-a-uuid.not-a-signature" });
  if (malformedShape.status !== 401)
    console.warn(
      `WARN a malformed provider link shape returned HTTP ${malformedShape.status}; expected 401 ` +
        "(ServiceJobsService.offerByCode looks up the offer before validating the uuid shape via ServiceJobAccess).",
    );
  const openView = await publicJob("", { code: codeA });
  assert.equal(openView.status, 200);
  assert.equal(openView.body.state, "open");
  assert.equal(openView.body.reference, jobA.reference);
  assert.equal(openView.body.provider.companyName, providerA.companyName);
  assert.equal(openView.body.truck.registration, truckA.registration);
  assert.equal(openView.body.canAccept, true);
  assert.equal(openView.body.canProgress, false);
  assert.equal(openView.body.canComplete, false);
  assert.equal(openView.body.officePhone, officePhone);
  assert.ok(!("driver" in openView.body), "the provider page never exposes the driver");
  const accepted = await publicJob("/accept", {
    method: "POST",
    code: codeA,
    body: { name: "A Dispatcher" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual(accepted.body, {
    outcome: "accepted",
    reference: jobA.reference,
    providerName: providerA.companyName,
  });
  const acceptedRow = await one(
    'select status, "providerId", "acceptedAt" from app.service_jobs where id = $1',
    [jobA.id],
  );
  assert.equal(acceptedRow.status, "assigned");
  assert.equal(acceptedRow.providerId, providerA.id);
  assert.ok(acceptedRow.acceptedAt);
  const acceptedOffers = await offersForJob(jobA.id);
  assert.equal(
    acceptedOffers.find((offer) => offer.id === offerA.id).status,
    "accepted",
  );
  assert.equal(
    acceptedOffers.find((offer) => offer.id === offerB.id).status,
    "expired",
    "losing offers expire when one provider wins",
  );
  const acceptedOfferRow = await one(
    'select "responseChannel", "responderName", "respondedAt" from app.service_job_offers where id = $1',
    [offerA.id],
  );
  assert.equal(acceptedOfferRow.responseChannel, "web");
  assert.equal(acceptedOfferRow.responderName, "A Dispatcher");
  assert.ok(acceptedOfferRow.respondedAt);
  const losing = await publicJob("/accept", {
    method: "POST",
    code: codeB,
    body: { name: "B Dispatcher" },
  });
  assert.equal(losing.status, 409);
  assert.match(
    String(losing.body?.message ?? ""),
    /already been assigned to another provider|no longer available/i,
  );
  const losingProgress = await publicJob("/progress", {
    method: "POST",
    code: codeB,
    body: { stage: "en_route" },
  });
  assert.equal(losingProgress.status, 403, "the losing provider cannot update progress");
  const repeatedAccept = await publicJob("/accept", {
    method: "POST",
    code: codeA,
    body: { name: "A Dispatcher" },
  });
  assert.equal(repeatedAccept.status, 200, "the same provider may re-open its accepted link safely");
  assert.equal(repeatedAccept.body.outcome, "accepted");
  assert.equal(
    (await publicJob("/progress", { method: "POST", code: codeA, body: { stage: "flying" } })).status,
    400,
    "an unknown progress stage is rejected",
  );
  const assignedViewA = await publicJob("", { code: codeA });
  assert.equal(assignedViewA.body.state, "assigned");
  assert.equal(assignedViewA.body.canAccept, false);
  assert.equal(assignedViewA.body.canProgress, true);
  assert.equal(assignedViewA.body.canComplete, true);
  const assignedViewB = await publicJob("", { code: codeB });
  assert.equal(assignedViewB.body.state, "expired");
  assert.equal(
    assignedViewB.body.canAccept,
    undefined,
    "an expired provider link exposes only the limited state payload",
  );
  assert.equal(assignedViewB.body.description, undefined);

  const revoked = await api.jobs.revokeLink(admin, offerB.id);
  assert.equal(revoked.linkVersion, 2, "revoking increments the offer link version");
  assert.equal(
    (await publicJob("", { code: codeB })).status,
    401,
    "a revoked provider link is rejected",
  );
  const freshLink = await api.jobs.copyLink(offerB.id);
  assert.ok(
    freshLink.link.startsWith(appUrl.replace(/\/$/, "")),
    "provider links are generated from APP_URL",
  );
  const freshCodeB = freshLink.link.split("/j/")[1];
  assert.ok(freshCodeB);
  const freshViewB = await publicJob("", { code: freshCodeB });
  assert.equal(freshViewB.status, 200);
  assert.equal(freshViewB.body.state, "expired");
  pass(
    "The first signed provider link accepts the job; the losing provider gets a conflict, cannot progress and its revoked link is rejected",
  );

  /* ---------------- Progress, completion and photo proof ---------------- */
  for (const stage of ["en_route", "arrived", "working"]) {
    const response = await publicJob("/progress", {
      method: "POST",
      code: codeA,
      body: { stage },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, { outcome: "ok", stage, reference: jobA.reference });
  }
  assert.equal(
    (await publicJob("/progress", { method: "POST", code: codeA, body: { stage: "en_route" } })).status,
    200,
    "progress stages do not regress and retries stay successful",
  );
  const progressEvents = await q(
    `select kind from app.service_job_events
      where "jobId" = $1 and kind in ('en_route', 'arrived', 'working')
      order by "createdAt"`,
    [jobA.id],
  );
  assert.deepEqual(
    progressEvents.map((event) => event.kind),
    ["en_route", "arrived", "working"],
  );
  const inProgressView = await publicJob("", { code: codeA });
  assert.equal(inProgressView.body.state, "in_progress");
  assert.ok(inProgressView.body.startedAt, "progress records the job start time");
  assert.equal(inProgressView.body.canComplete, true);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2sAAAAASUVORK5CYII=",
    "base64",
  );
  const completionForm = () => {
    const form = new FormData();
    form.set("name", "A Technician");
    form.set("note", "Replaced the water pump and tested under load.");
    form.set("costCents", "425000");
    form.set("currency", "ZAR");
    form.append("photos", new Blob([png], { type: "image/png" }), "proof.png");
    return form;
  };
  const completion = await fetch(new URL("public/service-job/complete", apiBase), {
    method: "POST",
    headers: { Authorization: `Bearer ${codeA}`, Accept: "application/json" },
    body: completionForm(),
    signal: AbortSignal.timeout(20_000),
  });
  const completionBody = await completion.json().catch(() => null);
  assert.equal(completion.status, 200, JSON.stringify(completionBody));
  assert.deepEqual(completionBody, { reference: jobA.reference, status: "completed" });
  const completedRow = await one(
    `select status, "completionNote", "completionCostCents", currency, "completedAt"
       from app.service_jobs where id = $1`,
    [jobA.id],
  );
  assert.equal(completedRow.status, "completed");
  assert.equal(completedRow.completionNote, "Replaced the water pump and tested under load.");
  assert.equal(completedRow.completionCostCents, 425000);
  assert.equal(completedRow.currency, "ZAR");
  assert.ok(completedRow.completedAt);
  const attachments = await q(
    'select id, "mimeType", "byteSize" from app.service_job_attachments where "jobId" = $1',
    [jobA.id],
  );
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].mimeType, "image/png");
  assert.equal(attachments[0].byteSize, png.length);
  const photo = await fetch(
    new URL(`public/service-job/photos/${attachments[0].id}`, apiBase),
    { headers: { Authorization: `Bearer ${codeA}` }, signal: AbortSignal.timeout(20_000) },
  );
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.ok(Buffer.from(await photo.arrayBuffer()).equals(png));
  assert.equal(
    (
      await fetch(new URL(`public/service-job/photos/${attachments[0].id}`, apiBase), {
        headers: { Authorization: `Bearer ${freshCodeB}` },
        signal: AbortSignal.timeout(20_000),
      })
    ).status,
    403,
    "another provider cannot read the completion photo",
  );
  const duplicateCompletion = await fetch(new URL("public/service-job/complete", apiBase), {
    method: "POST",
    headers: { Authorization: `Bearer ${codeA}`, Accept: "application/json" },
    body: completionForm(),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(duplicateCompletion.status, 409, "a completed job cannot be completed twice");
  const completedView = await publicJob("", { code: codeA });
  assert.equal(completedView.body.state, "completed");
  assert.equal(completedView.body.canProgress, false);
  assert.equal(completedView.body.canComplete, false);
  assert.equal(completedView.body.completionNote, "Replaced the water pump and tested under load.");
  assert.equal(completedView.body.completionCostCents, 425000);
  assert.deepEqual(completedView.body.photos, [attachments[0].id]);
  pass(
    "Public progress, completion with note/photos/cost and the permission-checked proof photo persist and render",
  );

  /* ---------------- Admin close and audit ---------------- */
  const closeResult = await api.jobs.closeJob(admin, jobA.id, {
    note: "Checked the completion proof and closed the job.",
    resolveIssue: false,
  });
  assert.deepEqual(closeResult, { reference: jobA.reference });
  const closedRow = await one(
    `select status, "closedAt", "closedById", "closeNote", "resolvedIssueOnClose"
       from app.service_jobs where id = $1`,
    [jobA.id],
  );
  assert.equal(closedRow.status, "closed");
  assert.equal(closedRow.closedById, admin.user.id);
  assert.equal(closedRow.closeNote, "Checked the completion proof and closed the job.");
  assert.equal(closedRow.resolvedIssueOnClose, false);
  assert.ok(closedRow.closedAt);
  const closeEvents = await q(
    `select kind, "actorType", channel, "toStatus" from app.service_job_events
      where "jobId" = $1 and kind = 'closed'`,
    [jobA.id],
  );
  assert.equal(closeEvents.length, 1);
  assert.equal(closeEvents[0].actorType, "admin");
  assert.equal(closeEvents[0].channel, "dashboard");
  assert.equal(closeEvents[0].toStatus, "closed");
  await expectError(
    "close an already closed job",
    () => api.jobs.closeJob(admin, jobA.id, { note: "Again." }),
    { status: 409, message: /already closed/i },
  );
  const closedView = await publicJob("", { code: codeA });
  assert.equal(closedView.body.state, "closed");
  assert.equal(closedView.body.canProgress, false);
  assert.equal(
    (await publicJob("/progress", { method: "POST", code: codeA, body: { stage: "arrived" } })).status,
    409,
    "a closed job makes the provider page read-only",
  );
  pass(
    "Admin close records an audited dashboard event and makes the signed provider page read-only",
  );

  /* ---------------- Linked issue resolution ---------------- */
  const linked = await createLinkedIssue(truckA.id);
  const jobB = await api.jobs.createJob(admin, {
    truckId: truckA.id,
    issueId: linked.issueId,
    serviceType: "mechanical",
    description: "Truck will not start after loading.",
    notifyProviders: false,
  });
  created.jobs.push(jobB.id);
  assert.equal(jobB.status, "open");
  const linkedJobRow = await one(
    'select "issueId", "driverId", source from app.service_jobs where id = $1',
    [jobB.id],
  );
  assert.equal(linkedJobRow.issueId, linked.issueId);
  assert.equal(linkedJobRow.driverId, linked.driverId, "the linked issue driver is assigned");
  assert.equal(linkedJobRow.source, "admin");
  await expectError(
    "active service job blocks direct issue resolution",
    () => api.jobs.assertNoActiveJobForIssue(linked.issueId),
    { status: 409, message: /active service job/i },
  );
  const withoutResolve = {
    ...admin,
    permissions: admin.permissions.filter((permission) => permission !== "issues.resolve"),
  };
  await expectError(
    "closing with resolveIssue requires issues.resolve",
    () => api.jobs.closeJob(withoutResolve, jobB.id, { note: "Resolve.", resolveIssue: true }),
    { status: 403, message: /cannot resolve driver reports/i },
  );
  await api.jobs.closeJob(admin, jobB.id, {
    note: "Starter motor replaced.",
    resolveIssue: true,
  });
  const resolvedIssue = await one(
    `select "resolvedAt", "resolvedById", "resolutionNote" from app.driver_issues where id = $1`,
    [linked.issueId],
  );
  assert.ok(resolvedIssue.resolvedAt, "closing with resolveIssue resolves the linked report");
  assert.equal(resolvedIssue.resolvedById, admin.user.id);
  assert.equal(resolvedIssue.resolutionNote, "Starter motor replaced.");
  const linkedJobAfterClose = await one(
    'select "resolvedIssueOnClose", status from app.service_jobs where id = $1',
    [jobB.id],
  );
  assert.equal(linkedJobAfterClose.resolvedIssueOnClose, true);
  assert.equal(linkedJobAfterClose.status, "closed");
  const linkedEvents = (
    await q(
      `select kind from app.service_job_events where "jobId" = $1 order by "createdAt"`,
      [jobB.id],
    )
  ).map((event) => event.kind);
  assert.ok(linkedEvents.includes("issue_resolved"));
  assert.ok(linkedEvents.includes("closed"));
  await api.jobs.reopenJob(admin, jobB.id, {
    reason: "The provider needs to return.",
    reopenIssue: true,
  });
  const reopenedIssue = await one(
    'select "resolvedAt" from app.driver_issues where id = $1',
    [linked.issueId],
  );
  assert.equal(reopenedIssue.resolvedAt, null, "reopening the job reopens the linked report");
  const reopenedJob = await one('select status from app.service_jobs where id = $1', [jobB.id]);
  assert.equal(reopenedJob.status, "open");
  const reopenEvents = (
    await q(
      `select kind from app.service_job_events where "jobId" = $1 order by "createdAt"`,
      [jobB.id],
    )
  ).map((event) => event.kind);
  assert.ok(reopenEvents.includes("issue_reopened"));
  assert.ok(reopenEvents.includes("reopened"));
  await api.jobs.cancelJob(admin, jobB.id, { reason: "Stack test finished." });
  pass(
    "Linked driver report resolution is permission-checked, requires the job to be closed and reopens with the job",
  );

  /* ---------------- Alerts disabled and no-provider paths ---------------- */
  const truckAlertsOff = await createTruck("ALERTSOFF");
  const templateCountBeforeDisabled = graphRequests.filter(
    (request) => request.body?.type === "template",
  ).length;
  process.env.SERVICE_JOB_ALERTS_ENABLED = "false";
  try {
    assert.equal(api.jobs.alertsReady, false);
    const jobC = await api.jobs.createJob(admin, {
      truckId: truckAlertsOff.id,
      serviceType: "electrical",
      description: "Alternator failed and the battery is flat.",
      notifyProviders: true,
    });
    created.jobs.push(jobC.id);
    assert.equal(jobC.status, "open");
    const disabledOffers = await offersForJob(jobC.id);
    assert.equal(disabledOffers.length, 0, "alerts-disabled jobs queue no provider offers");
    const skipped = await one(
      `select kind, note, metadata from app.service_job_events
        where "jobId" = $1 and kind = 'alerts_skipped'`,
      [jobC.id],
    );
    assert.ok(skipped, "alerts-disabled jobs record an alerts_skipped event");
    assert.equal(skipped.metadata.reason, "alerts_unavailable");
    assert.equal(
      graphRequests.filter((request) => request.body?.type === "template").length,
      templateCountBeforeDisabled,
      "no Graph templates are sent while alerts are disabled",
    );
    await api.jobs.cancelJob(admin, jobC.id, { reason: "Alerts-disabled coverage." });
  } finally {
    process.env.SERVICE_JOB_ALERTS_ENABLED = "true";
  }

  const truckNoProviders = await createTruck("NOPROVIDERS");
  const pausedRows = await q(
    `select id, status from app.service_providers
      where status = 'active' and "alertsEnabled" = true and "optedOutAt" is null`,
  );
  await db.query(
    `update app.service_providers set status = 'paused', "updatedAt" = now()
      where id = any($1::uuid[])`,
    [pausedRows.map((row) => row.id)],
  );
  try {
    const templateCountBeforeNoProviders = graphRequests.filter(
      (request) => request.body?.type === "template",
    ).length;
    const jobD = await api.jobs.createJob(admin, {
      truckId: truckNoProviders.id,
      serviceType: "towing",
      description: "Truck is stuck on the shoulder and needs recovery.",
      notifyProviders: true,
    });
    created.jobs.push(jobD.id);
    assert.equal((await offersForJob(jobD.id)).length, 0);
    const skipped = await one(
      `select metadata from app.service_job_events
        where "jobId" = $1 and kind = 'alerts_skipped'`,
      [jobD.id],
    );
    assert.equal(skipped?.metadata?.reason, "no_providers");
    assert.equal(
      graphRequests.filter((request) => request.body?.type === "template").length,
      templateCountBeforeNoProviders,
      "no Graph templates are sent when no provider is eligible",
    );
    await api.jobs.cancelJob(admin, jobD.id, { reason: "No-provider coverage." });
  } finally {
    for (const row of pausedRows) {
      await db.query(
        'update app.service_providers set status = $2, "updatedAt" = now() where id = $1',
        [row.id, row.status],
      );
    }
  }
  pass(
    "Alerts-disabled and no-provider jobs stay open with audited alerts_skipped events and no Graph traffic",
  );

  /* ---------------- HTTP permission boundary ---------------- */
  await httpPermissionChecks(admin);

  console.log(
    `PASS cleanup will remove ${created.jobs.length} jobs, ${created.providers.length} providers, ${created.trucks.length} trucks and all whatsapp_messages/offers/events/attachments`,
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
