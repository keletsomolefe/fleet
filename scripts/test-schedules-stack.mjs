import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
const root = new URL("../", import.meta.url),
  env = parseEnv(await readFile(new URL(".env", root), "utf8"));
const require = createRequire(new URL("apps/api/package.json", root)),
  { Client } = require("pg");
const db = new Client({ connectionString: env.DATABASE_URL });
const tag = `PLAN-${randomBytes(5).toString("hex").toUpperCase()}`,
  password = randomBytes(24).toString("base64url");
const users = [],
  drivers = [],
  trucks = [],
  identities = [],
  tokens = [];
async function request(
  path,
  { method = "GET", body, token, device, headers = {} } = {},
  base = env.APP_URL,
) {
  const r = await fetch(new URL(path, base), {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { "X-Fleet-Device-Token": device } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    body: await r.json().catch(() => null),
    headers: r.headers,
  };
}
const mobile = (path, options) => request(`api/mobile/${path}`, options);
const login = async (identifier) => {
  const r = await mobile("auth/login", {
    method: "POST",
    body: { identifier, password },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  tokens.push(r.body.sessionToken);
  return r.body;
};
const start = (
  token,
  truckId,
  expectedOwnSessionId = null,
  id = randomUUID(),
) =>
  mobile("driver/driving-sessions", {
    method: "POST",
    token,
    body: { id, truckId, expectedOwnSessionId },
  });
const end = (token, sessionId) =>
  mobile("driver/driving-sessions/end", {
    method: "POST",
    token,
    body: { sessionId },
  });
const pass = (message) => console.log(`PASS ${message}`);
async function fixture(n) {
  const email = `${tag.toLowerCase()}-${n}@example.test`;
  const identity = await request(
    "admin/identities",
    {
      method: "POST",
      body: {
        schema_id: "fleet-user-v1",
        traits: { email, name: { first: "Personal", last: `Driver ${n}` } },
        credentials: { password: { config: { password } } },
        verifiable_addresses: [
          {
            value: email,
            via: "email",
            verified: true,
            status: "completed",
            verified_at: new Date().toISOString(),
          },
        ],
      },
    },
    env.KRATOS_ADMIN_URL,
  );
  assert.equal(identity.status, 201);
  identities.push(identity.body.id);
  const user = (
    await db.query(
      'INSERT INTO app.users ("kratosIdentityId",email,"firstName","lastName","isActive") VALUES ($1,$2,\'Personal\',$3,true) RETURNING id',
      [identity.body.id, email, `Driver ${n}`],
    )
  ).rows[0].id;
  users.push(user);
  await db.query(
    'INSERT INTO app.user_roles ("userId","roleId") SELECT $1,id FROM app.roles WHERE key=\'driver\'',
    [user],
  );
  const id = (
    await db.query(
      'INSERT INTO app.driver_profiles ("userId",identifier,phone,"licenceNumber","licenceCode","licenceCountry","licenceExpiresOn","prdpNumber","prdpExpiresOn",status) VALUES ($1,$2,\'+27 82 123 4567\',$2,\'EC\',\'ZA\',\'2099-01-01\',$2,\'2099-01-01\',\'active\') RETURNING id',
      [user, `${tag}-D${n}`],
    )
  ).rows[0].id;
  drivers.push(id);
  return { id, user, ...(await login(email)) };
}
const date = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const later = new Date(Date.parse(date) + 6 * 86400000)
  .toISOString()
  .slice(0, 10);
const allDays = [0, 1, 2, 3, 4, 5, 6];
let socket;
await db.connect();
try {
  const adminLogin = await mobile("auth/login", {
    method: "POST",
    body: {
      identifier: env.BOOTSTRAP_ADMIN_EMAIL,
      password: env.BOOTSTRAP_ADMIN_PASSWORD,
    },
  });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
  const admin = adminLogin.body.sessionToken;
  tokens.push(admin);
  const a = await fixture(1),
    b = await fixture(2);
  for (let n = 0; n < 3; n++)
    trucks.push(
      (
        await db.query(
          `INSERT INTO app.trucks (identifier,registration,"registrationCountry",make,model,category,"fuelType","odometerKm",status) VALUES ($1,$1,'ZA','Volvo','FH','tractor','diesel',0,'active') RETURNING id`,
          [`${tag}-${n}`],
        )
      ).rows[0].id,
    );
  const save = (body) =>
    mobile("admin/schedules", { method: "POST", token: admin, body });
  const plan = (driverId, truckId, from = date, to = later) => ({
    driverId,
    truckId,
    from,
    to,
    weekdays: allDays,
  });
  const context = async (who) =>
    (await mobile("driver/context", { token: who.sessionToken })).body;
  const confirm = async (
    who,
    truckId,
    expectedOwnSessionId = null,
    expectedScheduleId = undefined,
  ) =>
    mobile("driver/driving-sessions", {
      method: "POST",
      token: who.sessionToken,
      body: {
        id: randomUUID(),
        truckId,
        expectedOwnSessionId,
        expectedScheduleId:
          expectedScheduleId ?? (await context(who)).schedule?.id ?? null,
      },
    });
  const baseline = (await mobile("admin/notifications", { token: admin })).body
    .count;
  assert.equal(
    (
      await mobile("admin/schedules", {
        method: "POST",
        token: a.sessionToken,
        body: plan(a.id, trucks[0]),
      })
    ).status,
    403,
  );
  assert.equal(
    (await mobile("admin/notifications", { token: a.sessionToken })).status,
    403,
  );
  const webDenied = await request("api/admin/schedules", {
    method: "POST",
    body: plan(a.id, trucks[0]),
  });
  assert.equal(webDenied.status, 401);
  assert.equal((await save(plan(a.id, trucks[0]))).status, 200);
  assert.equal((await save(plan(b.id, trucks[1]))).status, 200);
  const list = await mobile(`admin/schedules?from=${date}&to=${later}`, {
    token: admin,
  });
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some(s=>s.date===date),"Schedule list returns date-only values for calendar matching");
  assert.equal(
    list.body.items.filter((s) => [a.id, b.id].includes(s.driverId)).length,
    14,
  );
  assert.equal((await context(a)).schedule.truck.id, trucks[0]);
  assert.equal((await context(a)).confirmedAt, null);
  assert.equal((await confirm(a, trucks[1])).status, 409);
  const started = await confirm(a, trucks[0]);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.ok(started.body.confirmedAt);
  pass(
    "Week schedules expand to daily assignments; sign-in requires a current schedule confirmation and drivers cannot edit plans",
  );
  const duplicate = await save(plan(a.id, trucks[0]));
  assert.equal(duplicate.body.created, 0);
  const conflict = await save(plan(a.id, trucks[1], date, date));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.conflicts.length, 2);
  assert.equal(
    (
      await save({
        ...plan(a.id, trucks[1], date, date),
        override: true,
        note: "Approved change",
        expectedConflicts: [randomUUID()],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await save({
        ...plan(a.id, trucks[1], date, date),
        override: true,
        note: "Confirmed with both drivers",
        expectedConflicts: conflict.body.conflicts.map((s) => s.id),
      })
    ).status,
    200,
  );
  assert.equal((await context(a)).drivingSession, null);
  assert.equal((await context(b)).schedule, null);
  assert.equal(
    (await confirm(b, trucks[1])).status,
    409,
    "An unassigned driver cannot use a reserved vehicle",
  );
  const history = await db.query(
    'SELECT count(*)::int n FROM app.driver_schedules WHERE "driverId"=ANY($1::uuid[]) AND "cancelledAt" IS NOT NULL',
    [drivers],
  );
  assert.equal(history.rows[0].n, 2);
  pass(
    "Overrides use exact conflict snapshots, remain audited and end displaced capture without transferring an active truck",
  );
  // Subscribe before flagging and ensure the MQTT event follows the committed dispute.
  const conn = await mobile("admin/notifications/connection", {
    method: "POST",
    token: admin,
  });
  assert.equal(conn.status, 200);
  let message;
  if (conn.body.mqttUrl) {
    const mqtt = createRequire(new URL("apps/mobile/package.json", root))(
      "mqtt",
    );
    socket = mqtt.connect(conn.body.mqttUrl, {
      username: conn.body.username,
      password: conn.body.password,
      clientId: conn.body.clientPrefix + "test",
      reconnectPeriod: 0,
      connectTimeout: 8000,
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(Error("MQTT connection timeout")),
        10000,
      );
      socket.once("error", reject);
      socket.once("connect", () =>
        socket.subscribe(conn.body.topic, { qos: 1 }, (e, g) => {
          clearTimeout(t);
          if (e) reject(e);
          else if (g[0].qos === 128) reject(Error("Subscription denied"));
          else resolve();
        }),
      );
    });
    const denied = await new Promise((resolve, reject) =>
      socket.subscribe(
        "fleet/admin/another-user/attention",
        { qos: 1 },
        (e, g) => (e ? resolve(true) : resolve(g?.[0]?.qos === 128)),
      ),
    );
    assert.ok(denied);
    message = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Error("MQTT change timeout")), 10000);
      socket.once("message", (_topic, payload) => {
        clearTimeout(t);
        resolve(JSON.parse(payload.toString()));
      });
    });
  }
  const current = await context(a);
  const report = {
    expectedScheduleId: current.schedule.id,
    requestedTruckId: trucks[2],
    note: "The allocated truck is not the vehicle provided today.",
  };
  const mismatch = await mobile("driver/schedule-mismatch", {
    method: "POST",
    token: a.sessionToken,
    body: report,
  });
  assert.equal(mismatch.status, 200, JSON.stringify(mismatch.body));
  if (message) assert.equal((await message).type, "attention.changed");
  assert.equal(
    (await mobile("admin/notifications", { token: admin })).body.count,
    baseline + 1,
  );
  assert.equal(
    (
      await mobile("driver/schedule-mismatch", {
        method: "POST",
        token: a.sessionToken,
        body: report,
      })
    ).body.id,
    mismatch.body.id,
  );
  assert.equal(
    (await mobile("admin/notifications", { token: admin })).body.count,
    baseline + 1,
  );
  assert.ok((await context(a)).pendingDispute);
  assert.equal((await confirm(a, trucks[1])).status, 409);
  let queue = (await mobile("admin/vehicle-disputes", { token: admin })).body
    .items;
  let flag = queue.find((d) => d.id === mismatch.body.id);
  assert.equal(flag.kind, "schedule");
  assert.equal(flag.requestedTruck.id, trucks[2]);
  const resolution = (d) => ({
    resolution: "change_schedule",
    note: "Alternative approved after review",
    expectedScheduleId: d.schedule?.id ?? null,
    expectedActiveSessionId: d.requestedTruckSession?.id ?? null,
    expectedRequestedScheduleId: d.requestedScheduleId,
  });
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: admin,
        body: { ...resolution(flag), expectedScheduleId: randomUUID() },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: a.sessionToken,
        body: resolution(flag),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: admin,
        body: resolution(flag),
      })
    ).status,
    200,
  );
  assert.equal((await context(a)).schedule.truck.id, trucks[2]);
  assert.equal((await context(a)).pendingDispute, null);
  assert.equal((await context(a)).confirmedAt, null);
  assert.equal(
    (await mobile("admin/notifications", { token: admin })).body.count,
    baseline,
  );
  pass(
    "Schedule mismatches persist once, block driving, notify the administrator over MQTT, and clear the badge count only after audited resolution",
  );
  // Late snapshots of another driver's plan cannot be overwritten while resolving.
  assert.equal((await save(plan(b.id, trucks[0], date, date))).status, 200);
  const aPlan = (await context(a)).schedule;
  const second = await mobile("driver/schedule-mismatch", {
    method: "POST",
    token: a.sessionToken,
    body: {
      expectedScheduleId: aPlan.id,
      requestedTruckId: trucks[0],
      note: "Requesting the replacement vehicle.",
    },
  });
  assert.equal(second.status, 200);
  flag = (
    await mobile("admin/vehicle-disputes", { token: admin })
  ).body.items.find((d) => d.id === second.body.id);
  const oldResolution = resolution(flag);
  const bPlan = (await context(b)).schedule;
  assert.equal(
    (
      await mobile(`admin/schedules/${bPlan.id}/cancel`, {
        method: "POST",
        token: admin,
        body: { note: "Plan updated" },
      })
    ).status,
    200,
  );
  assert.equal((await save(plan(b.id, trucks[0], date, date))).status, 200);
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: admin,
        body: oldResolution,
      })
    ).status,
    409,
  );
  flag = (
    await mobile("admin/vehicle-disputes", { token: admin })
  ).body.items.find((d) => d.id === second.body.id);
  const bStarted = await confirm(b, trucks[0]);
  assert.equal(bStarted.status, 200);
  flag = (
    await mobile("admin/vehicle-disputes", { token: admin })
  ).body.items.find((d) => d.id === second.body.id);
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: admin,
        body: resolution(flag),
      })
    ).status,
    409,
    "Resolving a plan cannot silently take over another active driver",
  );
  await end(b.sessionToken, bStarted.body.drivingSession.id);
  flag = (
    await mobile("admin/vehicle-disputes", { token: admin })
  ).body.items.find((d) => d.id === second.body.id);
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: admin,
        body: { ...resolution(flag), resolution: "keep_schedule" },
      })
    ).status,
    200,
  );
  pass(
    "Stale requested-vehicle schedules and active handovers prevent an unsafe dispute override",
  );
  // Daily confirmation and delayed telemetry use the midnight boundary in Johannesburg.
  const daily = await confirm(a, trucks[2]);
  assert.equal(daily.status, 200);
  const drive = daily.body.drivingSession.id,
    streamId = randomUUID(),
    credential = randomBytes(32).toString("hex");
  assert.equal(
    (
      await mobile("telemetry/streams", {
        method: "POST",
        token: a.sessionToken,
        body: { streamId, drivingSessionId: drive, uploadToken: credential },
      })
    ).status,
    200,
  );
  const yesterday = new Date(Date.parse(date) - 86400000)
      .toISOString()
      .slice(0, 10),
    oldStart = new Date(Date.parse(yesterday) + 10 * 3600000),
    cutoff = new Date(Date.parse(date) - 2 * 3600000);
  await db.query(
    'UPDATE app.driving_sessions SET "confirmedDate"=$2,"startedAt"=$3 WHERE id=$1',
    [drive, yesterday, oldStart],
  );
  await db.query('UPDATE app.tracking_streams SET "startedAt"=$2 WHERE id=$1', [
    streamId,
    oldStart,
  ]);
  assert.equal((await context(a)).confirmedAt, null);
  const sample = (sequence, time) => ({
    eventId: randomUUID(),
    sequence,
    kind: "location",
    recordedAt: new Date(time).toISOString(),
    data: { coords: { latitude: -26.2, longitude: 28.04 } },
  });
  const samples = [
    sample(1, cutoff.getTime() - 1000),
    sample(2, cutoff.getTime() + 1000),
  ];
  const receipt = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: { batchId: randomUUID(), streamId, events: samples },
  });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  assert.equal(receipt.body.captureAllowed, false);
  assert.ok(receipt.body.acceptedIds.includes(samples[0].eventId));
  assert.ok(
    receipt.body.rejected.some((r) => r.eventId === samples[1].eventId),
  );
  const endAt = (
    await db.query('SELECT "endedAt" FROM app.tracking_streams WHERE id=$1', [
      streamId,
    ])
  ).rows[0].endedAt;
  assert.equal(endAt.getTime(), cutoff.getTime());
  const renewed = await confirm(a, trucks[2], drive);
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.ok(renewed.body.confirmedAt);
  assert.notEqual(renewed.body.drivingSession.id, drive);
  pass(
    "Each day requires confirmation; delayed pre-midnight samples stay attributed and unconfirmed next-day samples are rejected",
  );
} finally {
  socket?.end(true);
  for (const token of tokens)
    await mobile("auth/session", { method: "DELETE", token }).catch(
      () => undefined,
    );
  if (drivers.length) {
    await db.query(
      'DELETE FROM app.tracking_events WHERE "streamId" IN (SELECT id FROM app.tracking_streams WHERE "driverId"=ANY($1::uuid[]))',
      [drivers],
    );
    await db.query(
      'DELETE FROM app.tracking_streams WHERE "driverId"=ANY($1::uuid[])',
      [drivers],
    );
    await db.query(
      'DELETE FROM app.vehicle_disputes WHERE "driverId"=ANY($1::uuid[])',
      [drivers],
    );
    await db.query(
      'DELETE FROM app.driving_sessions WHERE "driverId"=ANY($1::uuid[])',
      [drivers],
    );
    await db.query(
      'DELETE FROM app.driver_schedules WHERE "driverId"=ANY($1::uuid[])',
      [drivers],
    );
    await db.query("DELETE FROM app.driver_profiles WHERE id=ANY($1::uuid[])", [
      drivers,
    ]);
  }
  if (trucks.length)
    await db.query("DELETE FROM app.trucks WHERE id=ANY($1::uuid[])", [trucks]);
  for (const id of users)
    await db.query("DELETE FROM app.users WHERE id=$1", [id]);
  for (const id of identities)
    await request(
      `admin/identities/${id}`,
      { method: "DELETE" },
      env.KRATOS_ADMIN_URL,
    );
  await db.end();
}
