import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
const root = new URL("../", import.meta.url);
Object.assign(
  process.env,
  parseEnv(await readFile(new URL(".env", root), "utf8")),
);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw new Error("Repair stack tests require a local database.");
const require = createRequire(new URL("apps/api/package.json", root));
const { NestFactory } = require("@nestjs/core"),
  { DataSource } = require("typeorm");
const { AppModule } = await import("../apps/api/dist/app.module.js");
const { IssuesService } =
  await import("../apps/api/dist/issues/issues.service.js");
const { OpenWaService } =
  await import("../apps/api/dist/issues/openwa.service.js");
const { RepairsService } =
  await import("../apps/api/dist/issues/repairs.service.js");
const { OperationsEventsService } =
  await import("../apps/api/dist/operations/operations-events.service.js");
const { User } = await import("../apps/api/dist/users/user.entity.js");
const { DriverProfile, Truck } =
  await import("../apps/api/dist/fleet/fleet.entity.js");
const { DriverIssue } = await import("../apps/api/dist/issues/issue.entity.js");
const directory = await mkdtemp(join(tmpdir(), "fleet-repair-stack-"));
const sent = [],
  phone = "27821234567",
  groupId = "123456789@g.us";
let member = true,
  app,
  db,
  proxy,
  web,
  auditCreated = false;
const gateway = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url?.includes("/groups/"))
    return res.end(
      JSON.stringify({
        id: groupId,
        participants: member ? [{ id: `${phone}@c.us` }] : [],
      }),
    );
  if (req.url?.endsWith("/messages/send-text")) {
    let body = "";
    for await (const part of req) body += part;
    const message = JSON.parse(body);
    sent.push(message);
    return res
      .writeHead(201)
      .end(
        JSON.stringify({
          messageId: randomUUID(),
          timestamp: Date.now() / 1000,
        }),
      );
  }
  res.writeHead(404).end("{}");
});
await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
Object.assign(process.env, {
  WHATSAPP_ENABLED: "true",
  OPENWA_URL: `http://127.0.0.1:${gateway.address().port}`,
  OPENWA_API_KEY: randomBytes(32).toString("hex"),
  OPENWA_SESSION_ID: "test-session",
  OPENWA_MECHANICS_GROUP_ID: groupId,
  REPAIR_LINK_SECRET: randomBytes(48).toString("hex"),
  REPAIR_DATA_DIR: directory,
  MQTT_ENABLED: "false",
  APP_URL: "http://127.0.0.1:3170",
});
const ids = {
  audit: randomUUID(),
  user: randomUUID(),
  driver: randomUUID(),
  truck: randomUUID(),
  issue: randomUUID(),
  other: randomUUID(),
};
const tag = `REPAIR-${randomBytes(5).toString("hex")}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2sAAAAASUVORK5CYII=",
  "base64",
);
try {
  app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await app.listen(0, "127.0.0.1");
  db = app.get(DataSource);
  const user = await db
    .getRepository(User)
    .save({
      id: ids.user,
      kratosIdentityId: randomUUID(),
      email: `${tag.toLowerCase()}@example.test`,
      firstName: "POC",
      lastName: "Test driver",
      isActive: true,
    });
  const existingAudit = await db
    .getRepository(User)
    .findOneBy({ email: "whatsapp-repairs@fleet.invalid" });
  if (existingAudit) {
    assert.equal(existingAudit.isActive, false);
    ids.audit = existingAudit.id;
  } else {
    await db
      .getRepository(User)
      .save({
        id: ids.audit,
        kratosIdentityId: randomUUID(),
        email: "whatsapp-repairs@fleet.invalid",
        firstName: "WhatsApp",
        lastName: "repairs",
        isActive: false,
      });
    auditCreated = true;
  }
  const truck = await db
    .getRepository(Truck)
    .save({
      id: ids.truck,
      identifier: tag,
      registration: tag,
      registrationCountry: "ZA",
      make: "Volvo",
      model: "FH",
      category: "tractor",
      fuelType: "diesel",
      odometerKm: 100,
      status: "active",
    });
  const driver = await db
    .getRepository(DriverProfile)
    .save({
      id: ids.driver,
      userId: user.id,
      identifier: tag,
      phone: "+27820000000",
      licenceNumber: tag,
      licenceCode: "EC",
      licenceCountry: "ZA",
      licenceExpiresOn: "2099-01-01",
      status: "active",
      currentTruckId: truck.id,
    });
  const wa = app.get(OpenWaService);
  wa.onModuleDestroy();
  const originalFlush = wa.flush.bind(wa);
  wa.flush = async () => {};
  const service = new IssuesService(
    db,
    { context: async () => ({ driver, truck }) },
    app.get(OperationsEventsService),
    wa,
  );
  const report = {
    id: ids.issue,
    category: "vehicle",
    truckId: truck.id,
    description: "Front brake pads worn. Please inspect and replace.",
  };
  await service.report({}, report);
  await service.report({}, report);
  await service.report(
    {},
    {
      ...report,
      id: ids.other,
      category: "safety",
      description: "Loading bay light needs attention.",
    },
  );
  wa.flush = originalFlush;
  await wa.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, groupId);
  assert.equal(
    await db.getRepository(DriverIssue).countBy({ id: ids.issue }),
    1,
  );
  console.log(
    "PASS driver report commits once; only vehicle issues alert the group",
  );
  const link = new URL(sent[0].text.match(/http:\/\/\S+/)[0]);
  const token = new URLSearchParams(link.hash.slice(1)).get("token");
  const apiUrl = await app.getUrl();
  const api = async (path = "", options = {}, bearer = token) =>
    fetch(`${apiUrl}/repairs/${ids.issue}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${bearer}`, ...options.headers },
    });
  assert.equal((await fetch(`${apiUrl}/repairs/${ids.issue}`)).status, 401);
  assert.equal((await api()).status, 200);
  assert.equal((await api("/resolve", { method: "POST" })).status, 401);
  const otp = await api("/otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: `+${phone}` }),
  });
  assert.equal(otp.status, 200);
  const { challengeId } = await otp.json();
  const code = sent.at(-1).text.match(/code: (\d{6})/)[1];
  assert.equal(sent.at(-1).chatId, `${phone}@c.us`);
  const verified = await api("/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });
  assert.equal(verified.status, 200);
  const grant = (await verified.json()).token;
  const form = new FormData();
  form.set("name", "Workshop test mechanic");
  form.set("note", "Front brake pads replaced and checked.");
  form.append("photos", new Blob([png], { type: "image/png" }), "repair.png");
  member = false;
  assert.equal(
    (await api("/resolve", { method: "POST", body: form }, grant)).status,
    403,
  );
  member = true;
  const done = await api("/resolve", { method: "POST", body: form }, grant);
  assert.equal(done.status, 200, await done.text());
  const row = await db
    .getRepository(DriverIssue)
    .findOneByOrFail({ id: ids.issue });
  assert.ok(row.resolvedAt);
  assert.equal(row.resolvedById, ids.audit);
  assert.equal(row.resolutionNote, "Front brake pads replaced and checked.");
  const history = await app.get(RepairsService).history();
  const repair = history.items.find((i) => i.id === ids.issue);
  assert.equal(repair.verifiedPhone, phone);
  assert.equal(repair.photos.length, 1);
  assert.match(repair.resolutionNote, /Front brake pads replaced/);
  const image = await api(`/photos/${repair.photos[0]}`);
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const repeated = await api("/resolve", { method: "POST", body: form }, grant);
  assert.equal(repeated.status, 200);
  const changedForm = new FormData();
  changedForm.set("note", "Overwrite");
  assert.equal(
    (await api("/resolve", { method: "POST", body: changedForm }, grant))
      .status,
    409,
  );
  assert.equal((await fetch(`${apiUrl}/admin/repairs`)).status, 401);
  console.log(
    "PASS OTP checks current membership; web photos/comment and resolution persist in PostgreSQL and admin history",
  );
  console.log(
    "PASS issue links cannot resolve directly, read another issue, expose private photos or overwrite a repair",
  );
  if (process.argv.includes("--preview")) {
    // Keep a new, unresolved test issue for manual browser QA; all data is removed on exit.
    wa.flush = async () => {};
    await service.report(
      {},
      {
        ...report,
        id: randomUUID(),
        description:
          "Air leak near the rear brake line. Truck parked for inspection.",
      },
    );
    wa.flush = originalFlush;
    await wa.flush();
    const preview = sent
      .filter((m) => m.chatId === groupId)
      .at(-1)
      .text.match(/http:\/\/\S+/)[0];
    web = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        PORT: "3171",
        NITRO_PORT: "3171",
        NITRO_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    proxy = createServer(async (req, res) => {
      try {
        const target = req.url.startsWith("/api/")
          ? `${apiUrl}${req.url.slice(4)}`
          : `http://127.0.0.1:3171${req.url}`;
        const headers = { ...req.headers };
        delete headers.host;
        const response = await fetch(target, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
          duplex: "half",
          redirect: "manual",
        });
        const responseHeaders = Object.fromEntries(response.headers);
        delete responseHeaders["content-encoding"];
        delete responseHeaders["content-length"];
        delete responseHeaders["transfer-encoding"];
        res.writeHead(response.status, responseHeaders);
        if (response.body)
          for await (const part of response.body) res.write(part);
        res.end();
      } catch {
        res.writeHead(502).end();
      }
    });
    await new Promise((resolve) => proxy.listen(3170, "127.0.0.1", resolve));
    console.log(`PREVIEW ${preview}`);
    // For the local fake gateway only; never print real OTPs.
    const monitor = setInterval(() => {
      const message = sent.at(-1);
      if (message?.chatId === `${phone}@c.us` && !message.shown) {
        console.log(`LOCAL TEST OTP ${message.text.match(/code: (\d{6})/)[1]}`);
        message.shown = true;
      }
    }, 1000);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    clearInterval(monitor);
  }
} finally {
  proxy?.close();
  web?.kill();
  if (db?.isInitialized) {
    await db.getRepository(DriverIssue).delete({ driverId: ids.driver });
    await db.getRepository(DriverProfile).delete({ id: ids.driver });
    await db.getRepository(Truck).delete({ id: ids.truck });
    await db.getRepository(User).delete({ id: ids.user });
    if (auditCreated) await db.getRepository(User).delete({ id: ids.audit });
  }
  await app?.close();
  gateway.close();
  await rm(directory, { recursive: true, force: true });
}
