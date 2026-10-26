import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);
const env = parseEnv(await readFile(new URL(".env", root), "utf8"));
const require = createRequire(new URL("apps/api/package.json", root));
const { Client } = require("pg");
const db = new Client({ connectionString: env.DATABASE_URL });
const app = new URL(env.APP_URL);
const publicUrl = new URL(env.KRATOS_PUBLIC_URL);
const adminUrl = new URL(env.KRATOS_ADMIN_URL);
const inbox = new URL(`http://127.0.0.1:${env.MAILPIT_PORT}/`);
const identities = new Set();
const emails = new Set();
const password = randomBytes(24).toString("base64url");
const cookies = new Map();
const cookie = (jar) =>
  [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
const pass = (label) => console.log(`PASS ${label}`);

async function request(base, path, options = {}, jar) {
  const response = await fetch(new URL(path, base), {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      ...(jar ? { Cookie: cookie(jar) } : {}),
      ...options.headers,
    },
  });
  if (jar)
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}
const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
async function login(email, credential, jar) {
  const flow = await request(publicUrl, "self-service/login/browser", {}, jar);
  assert.equal(flow.status, 200, "Initialize browser login");
  const csrf = flow.body.ui.nodes.find(
    (n) => n.attributes.name === "csrf_token",
  )?.attributes.value;
  assert.ok(csrf);
  const missing = await request(
    publicUrl,
    flow.body.ui.action,
    json({ method: "password", identifier: email, password: credential }),
    jar,
  );
  assert.ok(
    [400, 403].includes(missing.status),
    "Reject browser login without CSRF",
  );
  return request(
    publicUrl,
    flow.body.ui.action,
    json({
      method: "password",
      identifier: email,
      password: credential,
      csrf_token: csrf,
    }),
    jar,
  );
}
const tag = `FLEET-${randomBytes(5).toString("hex").toUpperCase()}`;
const truckIds = [],
  driverIds = [];
const requestJson = (method, body, headers) => ({
  method,
  headers,
  body: JSON.stringify(body),
});
await db.connect();
try {
  for (const path of ["drivers", "trucks", "drivers/users", "drivers/trucks"]) {
    assert.equal((await request(app, `api/admin/${path}`)).status, 401);
    assert.equal(
      (await request(app, `api/admin/${path}`, json({}))).status,
      401,
    );
  }
  assert.equal(
    (
      await login(
        env.BOOTSTRAP_ADMIN_EMAIL,
        env.BOOTSTRAP_ADMIN_PASSWORD,
        cookies,
      )
    ).status,
    200,
  );
  const session = await request(app, "api/auth/session", {}, cookies);
  assert.equal(session.status, 200);
  assert.ok(session.body.permissions.includes("drivers.write"));
  assert.ok(session.body.permissions.includes("trucks.write"));
  const headers = {
    "Content-Type": "application/json",
    Origin: app.origin,
    "X-CSRF-Token": session.body.csrfToken,
  };
  const api = (path, method = "GET", body, overrides = {}) =>
    request(
      app,
      `api/admin/${path}`,
      method === "GET"
        ? {}
        : requestJson(method, body, { ...headers, ...overrides }),
      cookies,
    );
  const truck = {
    identifier: tag,
    registration: tag,
    registrationCountry: "ZA",
    make: "Volvo",
    model: "FH",
    year: 2025,
    vin: `YV2A4A1A1SB${tag.slice(-6)}`.replace(/[IOQ]/g, "X"),
    category: "tractor",
    fuelType: "diesel",
    transmission: "automated",
    axleCount: 3,
    grossVehicleMassKg: 26000,
    tareKg: 9000,
    payloadCapacityKg: 17000,
    odometerKm: 100000,
    tankCapacityLitres: 600,
    licenceDiscExpiresOn: "2099-01-01",
    roadworthyExpiresOn: "2099-01-01",
    insuranceProvider: "Test insurer",
    insurancePolicyNumber: tag,
    insuranceExpiresOn: "2099-01-01",
    serviceIntervalKm: 15000,
    nextServiceDueKm: 110000,
    status: "active",
    deviceIdentifier: `${tag}-TAB`,
    deviceSerialNumber: `${tag}-SERIAL`,
  };
  assert.equal(truck.vin.length, 17);
  assert.equal(
    (await api("trucks", "POST", truck, { "X-CSRF-Token": "" })).status,
    403,
  );
  assert.equal(
    (await api("trucks", "POST", truck, { Origin: "https://invalid.example" }))
      .status,
    403,
  );
  let saved = await api("trucks", "POST", truck);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const t1 = saved.body.id;
  truckIds.push(t1);
  assert.equal(saved.body.deviceHistory.length, 1);
  assert.equal(saved.body.device.identifier, truck.deviceIdentifier);
  assert.equal(saved.body.payloadCapacityKg, 17000);
  assert.equal((await api("trucks", "POST", truck)).status, 409);
  assert.equal(
    (await api(`trucks/${t1}`, "PATCH", { ...truck, odometerKm: 99999 }))
      .status,
    400,
  );
  const truck2 = {
    ...truck,
    identifier: `${tag}-2`,
    registration: `${tag}-2`,
    vin: null,
    deviceIdentifier: null,
    deviceSerialNumber: null,
  };
  saved = await api("trucks", "POST", truck2);
  assert.equal(saved.status, 201);
  const t2 = saved.body.id;
  truckIds.push(t2);
  assert.equal(
    (
      await api(`trucks/${t2}`, "PATCH", {
        ...truck2,
        deviceIdentifier: truck.deviceIdentifier,
      })
    ).status,
    409,
  );
  assert.equal((await api(`trucks?q=${tag}`)).body.total, 2);
  assert.equal((await api("trucks?page=0")).status, 400);
  assert.equal((await api("trucks?status=invalid")).status, 400);
  pass(
    "Protected truck creation, complete field persistence, normalization, duplicates and odometer validation",
  );

  const profile = {
    identifier: `${tag}-D`,
    phone: "+27 82 123 4567",
    licenceNumber: tag,
    licenceCode: "EC",
    licenceCountry: "ZA",
    licenceExpiresOn: "2099-01-01",
    prdpNumber: tag,
    prdpExpiresOn: "2099-01-01",
    emergencyContactName: "Test Contact",
    emergencyContactPhone: "+27 82 765 4321",
    status: "active",
    currentTruckId: t1,
  };
  const email = `${tag.toLowerCase()}@example.test`;
  emails.add(email);
  const account = {
    email,
    firstName: "Fleet",
    lastName: "Integration",
    password,
  };
  assert.equal(
    (
      await api(
        "drivers",
        "POST",
        { ...profile, account },
        { "X-CSRF-Token": "" },
      )
    ).status,
    403,
  );
  saved = await api("drivers", "POST", { ...profile, account });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const d1 = saved.body.id;
  driverIds.push(d1);
  const user = (
    await db.query("SELECT * FROM app.users WHERE id=$1", [saved.body.userId])
  ).rows[0];
  identities.add(user.kratosIdentityId);
  assert.equal(saved.body.user.email, email);
  assert.equal(saved.body.currentTruck.id, t1);
  assert.equal(saved.body.assignments.length, 1);
  assert.equal(saved.body.assignments[0].endedAt, null);
  assert.equal(saved.body.password, undefined);
  assert.equal(saved.body.account, undefined);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM app.user_roles WHERE "userId"=$1',
        [user.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await api("drivers", "POST", { ...profile, userId: user.id })).status,
    409,
  );
  assert.equal(
    (await api(`trucks/${t1}`, "PATCH", { ...truck, status: "maintenance" }))
      .status,
    409,
  );
  assert.equal(
    (
      await api(`drivers/${d1}`, "PATCH", {
        ...profile,
        licenceExpiresOn: "2000-01-01",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(`drivers/${d1}`, "PATCH", {
        ...profile,
        prdpExpiresOn: null,
        prdpNumber: null,
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(`drivers/${d1}`, "PATCH", { ...profile, userId: user.id }))
      .status,
    400,
  );
  assert.equal((await api(`drivers?q=${tag}`)).body.total, 1);
  assert.equal(
    (await api(`drivers/users?q=${encodeURIComponent(email)}`)).body.length,
    0,
  );
  assert.equal((await api(`drivers/trucks?q=${tag}`)).body.length, 1);
  pass(
    "Atomic user and driver onboarding, neutral role model, eligibility checks and available-truck selection",
  );

  const email2 = `${tag.toLowerCase()}-2@example.test`;
  emails.add(email2);
  const createdUser = await api("users", "POST", { ...account, email: email2 });
  assert.equal(createdUser.status, 201);
  const u2 = createdUser.body.user;
  identities.add(u2.identityId);
  const profile2 = {
    ...profile,
    identifier: `${tag}-D2`,
    licenceNumber: `${tag}-DL2`,
    currentTruckId: null,
  };
  saved = await api("drivers", "POST", { ...profile2, userId: u2.id });
  assert.equal(saved.status, 201);
  const d2 = saved.body.id;
  driverIds.push(d2);
  const concurrent = await Promise.all([
    api(`drivers/${d1}`, "PATCH", { ...profile, currentTruckId: t2 }),
    api(`drivers/${d2}`, "PATCH", { ...profile2, currentTruckId: t2 }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM app.driver_profiles WHERE "currentTruckId"=$1',
        [t2],
      )
    ).rows[0].n,
    1,
  );
  for (const [id, p] of [
    [d1, profile],
    [d2, profile2],
  ]) {
    assert.equal(
      (
        await api(`drivers/${id}`, "PATCH", {
          ...p,
          currentTruckId: null,
          status: "inactive",
        })
      ).status,
      200,
    );
  }
  saved = await api(`drivers/${d1}`);
  assert.ok(saved.body.assignments.every((a) => a.endedAt));
  saved = await api(`trucks/${t1}`, "PATCH", {
    ...truck,
    status: "maintenance",
    deviceIdentifier: null,
    deviceSerialNumber: null,
  });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.deviceHistory[0].endedAt);
  saved = await api(`trucks/${t2}`, "PATCH", {
    ...truck2,
    deviceIdentifier: truck.deviceIdentifier,
    deviceSerialNumber: truck.deviceSerialNumber,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.deviceHistory.length, 1);
  assert.equal((await api(`trucks/${t1}`)).body.device, null);
  pass(
    "Concurrent assignment conflict, reassignment/unassignment history, driver deactivation and explicit device rebinding",
  );

  const failedEmail = `${tag.toLowerCase()}-rollback@example.test`;
  emails.add(failedEmail);
  const failed = await api("drivers", "POST", {
    ...profile,
    identifier: `${tag}-D3`,
    currentTruckId: null,
    account: { ...account, email: failedEmail },
  });
  assert.equal(failed.status, 409, JSON.stringify(failed.body));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM app.users WHERE email=$1",
        [failedEmail],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM app.driver_profiles WHERE identifier=$1",
        [`${tag}-D3`],
      )
    ).rows[0].n,
    0,
  );
  pass("Failed profile provisioning rolls back the new application account");

  const roles = await api("roles");
  const dispatcher = roles.body.find((r) => r.key === "dispatcher");
  assert.ok(dispatcher);
  assert.equal(
    (
      await api(`users/${u2.id}/access`, "PATCH", {
        roleIds: [dispatcher.id],
        isActive: true,
      })
    ).status,
    200,
  );
  await request(adminUrl, `admin/identities/${u2.identityId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify([
      {
        op: "replace",
        path: "/verifiable_addresses",
        value: [
          {
            value: email2,
            via: "email",
            verified: true,
            status: "completed",
            verified_at: new Date().toISOString(),
          },
        ],
      },
    ]),
  });
  const readOnly = new Map();
  assert.equal((await login(email2, password, readOnly)).status, 200);
  const readSession = await request(app, "api/auth/session", {}, readOnly);
  assert.equal(readSession.status, 200);
  const readHeaders = {
    ...headers,
    "X-CSRF-Token": readSession.body.csrfToken,
  };
  for (const kind of ["drivers", "trucks"]) {
    assert.equal(
      (await request(app, `api/admin/${kind}`, {}, readOnly)).status,
      200,
    );
    assert.equal(
      (
        await request(
          app,
          `api/admin/${kind}`,
          requestJson("POST", {}, readHeaders),
          readOnly,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          app,
          `api/admin/${kind}/${kind === "drivers" ? d1 : t1}`,
          requestJson("PATCH", {}, readHeaders),
          readOnly,
        )
      ).status,
      403,
    );
    const page = await request(
      app,
      `admin/${kind}`,
      { headers: { Accept: "text/html" } },
      readOnly,
    );
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes(`href="/admin/${kind}/new"`));
    assert.equal(
      (
        await request(
          app,
          `admin/${kind}/new`,
          { headers: { Accept: "text/html" } },
          readOnly,
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (await request(app, "api/admin/drivers/users", {}, readOnly)).status,
    403,
  );
  for (const [path, expected] of [
    ["admin/drivers/new", "Add a driver"],
    ["admin/trucks/new", "Add vehicle"],
    [`admin/drivers/${d1}`, "Driver profile"],
    [`admin/trucks/${t2}`, "Previous device history"],
  ]) {
    const page = await request(
      app,
      path,
      { headers: { Accept: "text/html" } },
      cookies,
    );
    assert.equal(
      page.status,
      200,
      `SSR ${path}: ${page.headers.get("location")}`,
    );
    assert.ok(page.body.includes(expected), `SSR ${path}: expected ${expected}`);
  }
  pass(
    "Dispatcher read-only permissions, protected write APIs, direct-route protection and populated server-rendered screens",
  );
} finally {
  if (driverIds.length) {
    await db.query(
      'DELETE FROM app.driver_truck_assignments WHERE "driverId"=ANY($1::uuid[])',
      [driverIds],
    );
    await db.query("DELETE FROM app.driver_profiles WHERE id=ANY($1::uuid[])", [
      driverIds,
    ]);
  }
  if (truckIds.length) {
    await db.query(
      'DELETE FROM app.device_truck_associations WHERE "truckId"=ANY($1::uuid[])',
      [truckIds],
    );
    await db.query(
      'DELETE FROM app.truck_devices WHERE "currentTruckId"=ANY($1::uuid[]) OR identifier LIKE $2',
      [truckIds, `${tag}%`],
    );
    await db.query("DELETE FROM app.trucks WHERE id=ANY($1::uuid[])", [
      truckIds,
    ]);
  }
  for (const id of identities) {
    await db.query('DELETE FROM app.users WHERE "kratosIdentityId"=$1', [id]);
    await request(adminUrl, `admin/identities/${id}`, { method: "DELETE" });
  }
  const messages = await request(inbox, "api/v1/messages");
  const ids = (messages.body.messages ?? [])
    .filter((m) => m.To?.some((r) => emails.has(r.Address)))
    .map((m) => m.ID);
  if (ids.length)
    await request(inbox, "api/v1/messages", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ IDs: ids }),
    });
  await db.end();
}
