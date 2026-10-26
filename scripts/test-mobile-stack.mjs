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
const tag = `PHONE-${randomBytes(5).toString("hex").toUpperCase()}`,
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
await db.connect();
try {
  for (const name of ["Origin", "Cookie", "Sec-Fetch-Site"])
    assert.equal(
      (
        await mobile("auth/login", {
          method: "POST",
          headers: { [name]: "browser" },
          body: {},
        })
      ).status,
      403,
    );
  assert.equal((await mobile("driver/vehicles")).status, 401);
  assert.equal((await mobile("device")).status, 410);
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
  assert.equal(adminLogin.body.mode, "admin");
  const a = await fixture(1),
    b = await fixture(2);
  for (let n = 0; n < 3; n++)
    trucks.push(
      (
        await db.query(
          "INSERT INTO app.trucks (identifier,registration,\"registrationCountry\",make,model,category,\"fuelType\",\"odometerKm\",status) VALUES ($1,$1,'ZA','Volvo','FH','tractor','diesel',0,$2) RETURNING id",
          [`${tag}-${n}`, n === 2 ? "maintenance" : "active"],
        )
      ).rows[0].id,
    );
  const list = await mobile(`driver/vehicles?q=${tag}`, {
    token: a.sessionToken,
  });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 2);
  assert.ok(list.body.items.every((t) => !t.activeSession));
  assert.equal(
    (await mobile("driver/context", { token: a.sessionToken })).body.truck,
    null,
  );
  assert.equal((await mobile("driver/vehicles", { token: admin })).status, 403);
  assert.equal((await start(a.sessionToken, trucks[2])).status, 404);
  pass(
    "Personal-phone sign-in, permission boundaries and searchable active vehicles without enrollment",
  );
  const race = await Promise.all([
    start(a.sessionToken, trucks[0]),
    start(b.sessionToken, trucks[0]),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const winner = race[0].status === 200 ? a : b,
    loser = winner === a ? b : a;
  let session = race.find((r) => r.status === 200).body.drivingSession.id;
  const flagged = await mobile("admin/vehicle-disputes", { token: admin });
  assert.equal(flagged.status, 200);
  let flag = flagged.body.items.find((d) => d.truck.id === trucks[0]);
  assert.ok(flag);
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: loser.sessionToken,
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
        method: "POST",
        token: admin,
        body: {
          expectedActiveSessionId: randomUUID(),
          resolution: "release_vehicle",
          note: "Stale selection",
        },
      })
    ).status,
    409,
  );
  assert.equal((await start(loser.sessionToken, trucks[0])).status, 409);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app.vehicle_disputes WHERE "truckId"=$1 AND "resolvedAt" IS NULL',
        [trucks[0]],
      )
    ).rows[0].n,
    1,
  );
  pass(
    "Concurrent requests allow one driver, persist a deduplicated flag and deny driver takeover/admin spoofing",
  );
  assert.equal((await end(winner.sessionToken, session)).status, 200);
  assert.equal(
    (await start(loser.sessionToken, trucks[0])).status,
    409,
    "Open flags continue to require administrator resolution",
  );
  const clear = await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
    method: "POST",
    token: admin,
    body: {
      expectedActiveSessionId: null,
      resolution: "release_vehicle",
      note: "Both drivers contacted; vehicle is parked.",
    },
  });
  assert.equal(clear.status, 200, JSON.stringify(clear.body));
  const id = randomUUID();
  let started = await start(loser.sessionToken, trucks[0], null, id);
  assert.equal(started.status, 200);
  session = started.body.drivingSession.id;
  assert.equal(
    (await start(loser.sessionToken, trucks[0], null, id)).body.drivingSession
      .id,
    session,
  );
  assert.equal(
    (await start(loser.sessionToken, trucks[1], randomUUID())).status,
    409,
  );
  assert.equal(
    (await start(loser.sessionToken, trucks[1], session)).status,
    200,
  );
  const old = (
    await db.query(
      'SELECT "endedAt","endReason" FROM app.driving_sessions WHERE id=$1',
      [session],
    )
  ).rows[0];
  assert.ok(old.endedAt);
  assert.equal(old.endReason, "vehicle_changed");
  session = (await mobile("driver/context", { token: loser.sessionToken })).body
    .drivingSession.id;
  const successor = (
    await db.query('SELECT "startedAt" FROM app.driving_sessions WHERE id=$1', [
      session,
    ])
  ).rows[0];
  assert.equal(
    successor.startedAt.getTime(),
    old.endedAt.getTime(),
    "Vehicle switch uses one shared boundary",
  );
  pass(
    "Driver release, administrator resolution, idempotent starts and atomic vehicle switching preserve history",
  );
  const streamId = randomUUID(),
    credential = randomBytes(32).toString("hex");
  const streamInput = {
    streamId,
    drivingSessionId: session,
    uploadToken: credential,
  };
  const stream = await mobile("telemetry/streams", {
    method: "POST",
    token: loser.sessionToken,
    body: streamInput,
  });
  assert.equal(stream.status, 200, JSON.stringify(stream.body));
  assert.equal(
    (
      await mobile("telemetry/streams", {
        method: "POST",
        token: loser.sessionToken,
        body: streamInput,
      })
    ).body.id,
    streamId,
  );
  assert.equal(
    (
      await db.query(
        'SELECT "uploadTokenHash" FROM app.tracking_streams WHERE id=$1',
        [streamId],
      )
    ).rows[0].uploadTokenHash,
    createHash("sha256").update(credential).digest("hex"),
  );
  const sample = (sequence, time = Date.now()) => ({
    eventId: randomUUID(),
    sequence,
    kind: "location",
    recordedAt: new Date(time).toISOString(),
    data: {
      coords: { latitude: -26.2, longitude: 28.04, accuracy: 5 },
      mocked: false,
    },
  });
  const config = await mobile("telemetry/config", { device: credential });
  assert.equal(config.status, 200);
  assert.equal(config.body.deviceId, streamId);
  if (config.body.mqttUrl) {
    const mqttRequire = createRequire(
      new URL("apps/mobile/package.json", root),
    );
    const mqtt = mqttRequire("mqtt");
    const socket = mqtt.connect(config.body.mqttUrl, {
      username: streamId,
      password: credential,
      clientId: `fleet-${streamId}-test`,
      reconnectPeriod: 0,
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MQTT connect timeout")),
          10000,
        );
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      await new Promise((resolve, reject) =>
        socket.subscribe(
          `fleet/devices/${streamId}/receipts`,
          { qos: 1 },
          (error) => (error ? reject(error) : resolve()),
        ),
      );
      const mqttPoint = sample(100),
        mqttBatch = { batchId: randomUUID(), streamId, events: [mqttPoint] };
      const receipt = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MQTT receipt timeout")),
          10000,
        );
        socket.on("message", (_topic, payload) => {
          const r = JSON.parse(payload.toString());
          if (r.batchId === mqttBatch.batchId) {
            clearTimeout(timer);
            resolve(r);
          }
        });
        socket.publish(
          `fleet/devices/${streamId}/locations`,
          JSON.stringify(mqttBatch),
          { qos: 1, retain: false },
        );
      });
      assert.deepEqual(receipt.acceptedIds, [mqttPoint.eventId]);
    } finally {
      await new Promise((resolve) => socket.end(true, resolve));
    }
    pass(
      "Personal driving streams authenticate MQTT and receive database-committed receipts",
    );
  }
  const point = sample(1),
    batch = { batchId: randomUUID(), streamId, events: [point] };
  let receipt = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: batch,
  });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  assert.deepEqual(receipt.body.acceptedIds, [point.eventId]);
  assert.deepEqual(
    (
      await mobile("telemetry/batches", {
        method: "POST",
        device: credential,
        body: batch,
      })
    ).body.acceptedIds,
    [point.eventId],
  );
  const offlinePoint = sample(2);
  assert.equal((await end(loser.sessionToken, session)).status, 200);
  const cutoff = (
    await db.query('SELECT "endedAt" FROM app.tracking_streams WHERE id=$1', [
      streamId,
    ])
  ).rows[0].endedAt;
  const afterRelease = sample(3, cutoff.getTime() + 1000);
  receipt = await mobile("telemetry/batches", {
    method: "POST",
    device: credential,
    body: {
      batchId: randomUUID(),
      streamId,
      events: [offlinePoint, afterRelease],
    },
  });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  assert.deepEqual(receipt.body.acceptedIds, [offlinePoint.eventId]);
  assert.equal(receipt.body.rejected[0].eventId, afterRelease.eventId);
  assert.equal(receipt.body.captureAllowed, false);
  assert.equal(
    (
      await mobile("telemetry/batches", {
        method: "POST",
        device: randomBytes(32).toString("hex"),
        body: batch,
      })
    ).status,
    401,
  );
  pass(
    "Per-session tracking credentials, durable receipts, duplicate retries and delayed uploads respect the release boundary",
  );
  const current = await start(a.sessionToken, trucks[0]);
  assert.equal(current.status, 200);
  const own = current.body.drivingSession.id;
  assert.equal(
    (
      await mobile(`driver/vehicles/${trucks[0]}/flag`, {
        method: "POST",
        token: b.sessionToken,
        body: { sessionId: randomUUID() },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await mobile(`driver/vehicles/${trucks[0]}/flag`, {
        method: "POST",
        token: b.sessionToken,
        body: { sessionId: own },
      })
    ).status,
    200,
  );
  flag = (
    await mobile("admin/vehicle-disputes", { token: admin })
  ).body.items.find((d) => d.truck.id === trucks[0]);
  const resolved = await mobile(`admin/vehicle-disputes/${flag.id}/resolve`, {
    method: "POST",
    token: admin,
    body: {
      expectedActiveSessionId: own,
      resolution: "release_vehicle",
      note: "Dispute investigated; current driver has left the vehicle.",
    },
  });
  assert.equal(resolved.status, 200);
  assert.ok(
    (
      await db.query('SELECT "endedAt" FROM app.driving_sessions WHERE id=$1', [
        own,
      ])
    ).rows[0].endedAt,
  );
  assert.equal(
    (await mobile("driver/context", { token: a.sessionToken })).body
      .drivingSession,
    null,
  );
  const audit = (
    await db.query(
      'SELECT "resolvedById",note FROM app.vehicle_disputes WHERE id=$1',
      [flag.id],
    )
  ).rows[0];
  assert.ok(audit.resolvedById);
  assert.ok(audit.note);
  await db.query(
    "UPDATE app.driver_profiles SET \"licenceExpiresOn\"='2000-01-01' WHERE id=$1",
    [a.id],
  );
  assert.equal((await start(a.sessionToken, trucks[0])).status, 400);
  await db.query(
    "UPDATE app.driver_profiles SET \"licenceExpiresOn\"='2099-01-01' WHERE id=$1",
    [a.id],
  );
  const original = await start(b.sessionToken, trucks[0]);
  assert.equal(original.status, 200);
  const renewed = await login(`${tag}-D2`);
  const resumed = await start(
    renewed.sessionToken,
    trucks[0],
    original.body.drivingSession.id,
  );
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.notEqual(
    resumed.body.drivingSession.id,
    original.body.drivingSession.id,
  );
  assert.equal(
    (await end(a.sessionToken, resumed.body.drivingSession.id)).status,
    403,
    "Another driver cannot release this vehicle",
  );
  assert.equal(
    (await mobile("auth/session", { method: "DELETE", token: b.sessionToken }))
      .status,
    204,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app.driving_sessions WHERE "driverId"=$1 AND "endedAt" IS NULL',
        [b.id],
      )
    ).rows[0].n,
    1,
    "Logout of an older sign-in cannot release its successor",
  );
  assert.equal(
    (
      await mobile("auth/session", {
        method: "DELETE",
        token: renewed.sessionToken,
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app.driving_sessions WHERE "driverId"=$1 AND "endedAt" IS NULL',
        [b.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await mobile("auth/session", { token: b.sessionToken })).status,
    401,
  );
  pass(
    "Administrator resolution is audited; current eligibility and logout release remain enforced",
  );
} finally {
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
      'DELETE FROM app.vehicle_disputes WHERE "truckId"=ANY($1::uuid[])',
      [trucks],
    );
    await db.query(
      'DELETE FROM app.driving_sessions WHERE "driverId"=ANY($1::uuid[])',
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
