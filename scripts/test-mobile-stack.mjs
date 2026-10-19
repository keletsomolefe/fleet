import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { testTelemetry } from "./test-telemetry-flow.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url),
  env = parseEnv(await readFile(new URL(".env", root), "utf8"));
const require = createRequire(new URL("apps/api/package.json", root)),
  { Client } = require("pg");
const db = new Client({ connectionString: env.DATABASE_URL });
const tag = `MOBILE-${randomBytes(5).toString("hex").toUpperCase()}`,
  password = randomBytes(24).toString("base64url");
const truckIds = [],
  identities = [],
  userIds = [],
  tokens = [];
let driverId;
async function request(
  path,
  { method = "GET", body, token, device, headers = {} } = {},
  base = env.APP_URL,
) {
  const response = await fetch(new URL(path, base), {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { "X-Fleet-Device-Token": device } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    headers: response.headers,
  };
}
const mobile = (path, options) => request(`api/mobile/${path}`, options);
async function login(identifier, credential) {
  return mobile("auth/login", {
    method: "POST",
    body: { identifier, password: credential },
  });
}
const pass = (label) => console.log(`PASS ${label}`);
await db.connect();
try {
  for (const header of ["Origin", "Cookie", "Sec-Fetch-Site"])
    assert.equal(
      (
        await mobile("auth/login", {
          method: "POST",
          headers: { [header]: "browser" },
          body: { identifier: "x", password: "x" },
        })
      ).status,
      403,
    );
  assert.equal((await mobile("setup/trucks")).status, 401);
  assert.equal((await mobile("device")).status, 401);
  assert.equal(
    (await login(env.BOOTSTRAP_ADMIN_EMAIL, "incorrect-password")).status,
    401,
  );
  const admin = await login(
    env.BOOTSTRAP_ADMIN_EMAIL,
    env.BOOTSTRAP_ADMIN_PASSWORD,
  );
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  const adminToken = admin.body.sessionToken;
  tokens.push(adminToken);
  assert.ok(adminToken);
  assert.equal(admin.body.mode, "setup");
  assert.match(admin.headers.get("cache-control"), /no-store/);
  assert.equal(
    (await mobile("auth/session", { token: adminToken })).status,
    200,
  );
  assert.equal(
    (await request("api/admin/trucks", { token: adminToken })).status,
    401,
    "Native bearer cannot replace browser cookie authorization",
  );
  pass(
    "Native login, no-store sessions, browser rejection and browser/native credential separation",
  );

  const email = `${tag.toLowerCase()}@example.test`;
  const identity = await request(
    "admin/identities",
    {
      method: "POST",
      body: {
        schema_id: "fleet-user-v1",
        state: "active",
        traits: { email, name: { first: "Mobile", last: "Integration" } },
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
  assert.equal(identity.status, 201, JSON.stringify(identity.body));
  identities.push(identity.body.id);
  const user = (
    await db.query(
      'INSERT INTO app.users ("kratosIdentityId",email,"firstName","lastName","isActive") VALUES ($1,$2,$3,$4,true) RETURNING id',
      [identity.body.id, email, "Mobile", "Integration"],
    )
  ).rows[0].id;
  userIds.push(user);
  await db.query(
    'INSERT INTO app.user_roles ("userId","roleId") SELECT $1,id FROM app.roles WHERE key=\'driver\'',
    [user],
  );
  driverId = (
    await db.query(
      'INSERT INTO app.driver_profiles ("userId",identifier,phone,"licenceNumber","licenceCode","licenceCountry","licenceExpiresOn","prdpNumber","prdpExpiresOn",status) VALUES ($1,$2,$3,$4,\'EC\',\'ZA\',\'2099-01-01\',$4,\'2099-01-01\',\'active\') RETURNING id',
      [user, `${tag}-D`, "+27 82 123 4567", tag],
    )
  ).rows[0].id;
  for (let n = 1; n <= 2; n++)
    truckIds.push(
      (
        await db.query(
          "INSERT INTO app.trucks (identifier,registration,\"registrationCountry\",make,model,category,\"fuelType\",\"odometerKm\",status) VALUES ($1,$1,'ZA','Volvo','FH','tractor','diesel',0,'active') RETURNING id",
          [`${tag}-${n}`],
        )
      ).rows[0].id,
    );
  const emailLogin = await login(email, password);
  assert.equal(emailLogin.status, 200);
  assert.equal(emailLogin.body.mode, "driver");
  tokens.push(emailLogin.body.sessionToken);
  const spoofed = await mobile("auth/login", {
    method: "POST",
    body: { identifier: email, password, mode: "setup" },
  });
  assert.equal(spoofed.status, 200);
  assert.equal(spoofed.body.mode, "driver");
  tokens.push(spoofed.body.sessionToken);
  const driverLogin = await login(`${tag}-D`, password);
  assert.equal(driverLogin.status, 200);
  assert.equal(driverLogin.body.mode, "driver");
  const driverToken = driverLogin.body.sessionToken;
  tokens.push(driverToken);
  assert.equal(
    (await mobile("setup/trucks", { token: driverToken })).status,
    403,
  );
  assert.equal(
    (
      await mobile("setup/device", {
        method: "POST",
        token: driverToken,
        body: {},
      })
    ).status,
    403,
  );
  const list = await mobile(`setup/trucks?q=${tag}`, { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 2);
  assert.ok(list.body.items.every((t) => t.device === null));
  const credential = randomBytes(32).toString("hex");
  const enroll = {
    truckId: truckIds[0],
    deviceIdentifier: `${tag}-TAB`,
    deviceToken: credential,
    expectedDeviceId: null,
    replaceExisting: false,
  };
  const enrolled = await mobile("setup/device", {
    method: "POST",
    token: adminToken,
    body: enroll,
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body));
  const deviceId = enrolled.body.device.id,
    association = enrolled.body.associationId;
  assert.ok(association);
  assert.equal(enrolled.body.truck.id, truckIds[0]);
  assert.ok(!JSON.stringify(enrolled.body).includes(credential));
  const stored = (
    await db.query(
      'SELECT "credentialHash" FROM app.truck_devices WHERE id=$1',
      [deviceId],
    )
  ).rows[0];
  assert.notEqual(stored.credentialHash, credential);
  assert.equal(stored.credentialHash.length, 64);
  assert.equal((await mobile("device", { device: credential })).status, 200);
  assert.equal(
    (await mobile("device", { device: randomBytes(32).toString("hex") }))
      .status,
    401,
  );
  const context = await mobile("driver/truck", {
    token: driverToken,
    device: credential,
  });
  assert.equal(context.status, 200);
  assert.equal(context.body.canConfirm, true);
  assert.equal(context.body.confirmedAt, null);
  const confirmed = await mobile("driver/truck/confirm", {
    method: "POST",
    token: driverToken,
    device: credential,
    body: { associationId: association },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.ok(confirmed.body.confirmedAt);
  assert.equal(
    (
      await mobile("driver/truck/confirm", {
        method: "POST",
        token: driverToken,
        device: credential,
        body: { associationId: association },
      })
    ).body.confirmedAt,
    confirmed.body.confirmedAt,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app.driver_truck_confirmations WHERE "driverId"=$1',
        [driverId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        'SELECT "currentTruckId" FROM app.driver_profiles WHERE id=$1',
        [driverId],
      )
    ).rows[0].currentTruckId,
    null,
    "Confirmation is not driver assignment or a shift",
  );
  pass(
    "Verified Driver ID login, role checks, device enrollment, hashed credentials and idempotent registration confirmation",
  );
  await testTelemetry({
    mobile,
    request,
    db,
    env,
    driverToken,
    credential,
    deviceId,
    truckId: truckIds[0],
    driverId,
  });

  const moved = { ...enroll, truckId: truckIds[1] };
  assert.equal(
    (
      await mobile("setup/device", {
        method: "POST",
        token: adminToken,
        body: moved,
      })
    ).status,
    409,
    "Moving a device requires explicit replacement",
  );
  const rebound = await mobile("setup/device", {
    method: "POST",
    token: adminToken,
    body: { ...moved, replaceExisting: true },
  });
  assert.equal(rebound.status, 200, JSON.stringify(rebound.body));
  assert.notEqual(rebound.body.associationId, association);
  assert.equal(
    (
      await mobile("driver/truck/confirm", {
        method: "POST",
        token: driverToken,
        device: credential,
        body: { associationId: association },
      })
    ).status,
    409,
    "Reject stale registration confirmation",
  );
  assert.equal(
    (await mobile("driver/truck", { token: driverToken, device: credential }))
      .body.confirmedAt,
    null,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app.device_truck_associations WHERE "deviceId"=$1 AND "endedAt" IS NOT NULL',
        [deviceId],
      )
    ).rows[0].n,
    1,
  );
  const replacementCredential = randomBytes(32).toString("hex");
  const replacement = {
    ...moved,
    deviceIdentifier: `${tag}-NEW`,
    deviceToken: replacementCredential,
    expectedDeviceId: deviceId,
  };
  assert.equal(
    (
      await mobile("setup/device", {
        method: "POST",
        token: adminToken,
        body: { ...replacement, expectedDeviceId: null, replaceExisting: true },
      })
    ).status,
    409,
    "Reject stale inventory selection",
  );
  assert.equal(
    (
      await mobile("setup/device", {
        method: "POST",
        token: adminToken,
        body: replacement,
      })
    ).status,
    409,
  );
  const replaced = await mobile("setup/device", {
    method: "POST",
    token: adminToken,
    body: { ...replacement, replaceExisting: true },
  });
  assert.equal(replaced.status, 200);
  assert.equal(
    (await mobile("device", { device: credential })).status,
    401,
    "Previous installation loses access",
  );
  assert.equal(
    (await mobile("device", { device: replacementCredential })).status,
    200,
  );
  const retry = await mobile("setup/device", {
    method: "POST",
    token: adminToken,
    body: {
      ...replacement,
      expectedDeviceId: replaced.body.device.id,
      replaceExisting: true,
    },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.associationId, replaced.body.associationId);
  pass(
    "Explicit device replacement, revoked old credentials, stale-state conflicts and immutable binding history",
  );

  await db.query(
    "UPDATE app.driver_profiles SET \"licenceExpiresOn\"='2000-01-01' WHERE id=$1",
    [driverId],
  );
  const expired = await mobile("driver/truck", {
    token: driverToken,
    device: replacementCredential,
  });
  assert.equal(expired.body.canConfirm, false);
  assert.equal(
    (
      await mobile("driver/truck/confirm", {
        method: "POST",
        token: driverToken,
        device: replacementCredential,
        body: { associationId: replaced.body.associationId },
      })
    ).status,
    400,
  );
  await db.query(
    "UPDATE app.driver_profiles SET status='inactive' WHERE id=$1",
    [driverId],
  );
  assert.equal(
    (
      await mobile("driver/truck", {
        token: driverToken,
        device: replacementCredential,
      })
    ).status,
    403,
  );
  await db.query(
    "UPDATE app.driver_profiles SET status='active',\"licenceExpiresOn\"='2099-01-01' WHERE id=$1",
    [driverId],
  );
  await db.query('DELETE FROM app.user_roles WHERE "userId"=$1', [user]);
  assert.equal(
    (
      await mobile("driver/truck", {
        token: driverToken,
        device: replacementCredential,
      })
    ).status,
    403,
  );
  await db.query('UPDATE app.users SET "isActive"=false WHERE id=$1', [user]);
  assert.equal(
    (await mobile("auth/session", { token: driverToken })).status,
    403,
  );
  assert.equal(
    (await mobile("auth/session", { method: "DELETE", token: driverToken }))
      .status,
    204,
  );
  assert.equal(
    (await mobile("auth/session", { token: driverToken })).status,
    401,
  );
  pass(
    "Expired eligibility, deactivation and role revocation take effect immediately; logout revokes the Kratos token",
  );
} finally {
  for (const token of tokens)
    await mobile("auth/session", { method: "DELETE", token }).catch(
      () => undefined,
    );
  if (driverId) {
    await db.query(
      'DELETE FROM app.tracking_events WHERE "streamId" IN (SELECT id FROM app.tracking_streams WHERE "driverId"=$1)',
      [driverId],
    );
    await db.query('DELETE FROM app.tracking_streams WHERE "driverId"=$1', [
      driverId,
    ]);
    await db.query(
      'DELETE FROM app.driver_truck_confirmations WHERE "driverId"=$1',
      [driverId],
    );
    await db.query("DELETE FROM app.driver_profiles WHERE id=$1", [driverId]);
  }
  if (truckIds.length) {
    await db.query(
      'DELETE FROM app.device_truck_associations WHERE "truckId"=ANY($1::uuid[])',
      [truckIds],
    );
    await db.query("DELETE FROM app.truck_devices WHERE identifier LIKE $1", [
      `${tag}%`,
    ]);
    await db.query("DELETE FROM app.trucks WHERE id=ANY($1::uuid[])", [
      truckIds,
    ]);
  }
  for (const id of userIds)
    await db.query("DELETE FROM app.users WHERE id=$1", [id]);
  for (const id of identities)
    await request(
      `admin/identities/${id}`,
      { method: "DELETE" },
      env.KRATOS_ADMIN_URL,
    );
  await db.end();
}
