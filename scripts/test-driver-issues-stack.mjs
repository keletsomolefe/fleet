import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
const root = new URL("../", import.meta.url),
  env = parseEnv(await readFile(new URL(".env", root), "utf8"));
const require = createRequire(new URL("apps/api/package.json", root)),
  { Client } = require("pg");
const db = new Client({ connectionString: env.DATABASE_URL });
const tag = `ISSUE-${randomBytes(5).toString("hex").toUpperCase()}`,
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

let socket;
await db.connect();
try {
  const adminSession = await mobile("auth/login", {
    method: "POST",
    body: {
      identifier: env.BOOTSTRAP_ADMIN_EMAIL,
      password: env.BOOTSTRAP_ADMIN_PASSWORD,
    },
  });
  assert.equal(adminSession.status, 200);
  const admin = adminSession.body.sessionToken;
  tokens.push(admin);
  const a = await fixture(1),
    b = await fixture(2);
  const baseline = (await mobile("admin/notifications", { token: admin })).body
    .count;
  for (let n = 0; n < 2; n++) {
    const truck = await db.query(
      `INSERT INTO app.trucks
      (identifier,registration,"registrationCountry",make,model,category,"fuelType","odometerKm",status)
      VALUES ($1,$1,'ZA','Volvo','FH','tractor','diesel',100,'active') RETURNING id`,
      [`${tag}-T${n}`],
    );
    trucks.push(truck.rows[0].id);
  }
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.equal(
    (
      await mobile("admin/schedules", {
        method: "POST",
        token: admin,
        body: {
          driverId: a.id,
          truckId: trucks[0],
          from: date,
          to: date,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        },
      })
    ).status,
    200,
  );
  assert.equal((await request("api/admin/issues")).status, 401);
  assert.equal(
    (await mobile("admin/issues", { token: a.sessionToken })).status,
    403,
  );
  assert.equal((await mobile("driver/issues", { token: admin })).status, 403);
  assert.equal(
    (
      await mobile("admin/notifications/connection", {
        method: "POST",
        token: a.sessionToken,
      })
    ).status,
    403,
  );

  const connection = await mobile("admin/notifications/connection", {
    method: "POST",
    token: admin,
  });
  assert.equal(connection.status, 200);
  assert.ok(
    connection.body.mqttUrl,
    "Enable MQTT to run the live attention checks",
  );
  const mqtt = createRequire(new URL("apps/mobile/package.json", root))("mqtt");
  socket = mqtt.connect(connection.body.mqttUrl, {
    username: connection.body.username,
    password: connection.body.password,
    clientId: connection.body.clientPrefix + "issues-test",
    reconnectPeriod: 0,
    connectTimeout: 8000,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("MQTT connect timeout")),
      10000,
    );
    socket.once("error", reject);
    socket.once("connect", () =>
      socket.subscribe(connection.body.topic, { qos: 1 }, (error, granted) => {
        clearTimeout(timer);
        if (error || granted[0].qos === 128)
          reject(error ?? Error("Subscription denied"));
        else resolve();
      }),
    );
  });
  const denied = await new Promise((resolve) =>
    socket.subscribe(
      `fleet/admin/${a.user}/attention`,
      { qos: 1 },
      (error, granted) => resolve(!!error || granted[0].qos === 128),
    ),
  );
  assert.ok(denied, "Cannot subscribe to another user");
  function change() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive);
        reject(Error("MQTT attention timeout"));
      }, 10000);
      const receive = async (_topic, payload) => {
        clearTimeout(timer);
        socket.off("message", receive);
        try {
          assert.deepEqual(JSON.parse(payload.toString()), {
            type: "attention.changed",
          });
          const snapshot = await mobile("admin/notifications", {
            token: admin,
          });
          assert.equal(snapshot.status, 200);
          resolve(snapshot.body);
        } catch (error) {
          reject(error);
        }
      };
      socket.on("message", receive);
    });
  }
  const report = (body, token = a.sessionToken) =>
    mobile("driver/issues", { method: "POST", token, body });
  const issue = {
    id: randomUUID(),
    truckId: trucks[0],
    category: "vehicle",
    description: "Front tyre is damaged.",
  };
  assert.equal((await report({ ...issue, description: "  " })).status, 400);
  assert.equal((await report({ ...issue, resolvedById: a.user })).status, 400);
  assert.equal((await report({ ...issue, truckId: trucks[1] })).status, 409);
  const createdEvent = change();
  assert.equal((await report(issue)).status, 200);
  const createdSnapshot = await createdEvent;
  assert.equal(
    createdSnapshot.count,
    baseline + 1,
    "MQTT event follows the committed report",
  );
  assert.ok(
    createdSnapshot.latest.some(
      (i) =>
        i.id === issue.id &&
        i.kind === "issue" &&
        i.registration === `${tag}-T0`,
    ),
  );
  const duplicates = await Promise.all([report(issue), report(issue)]);
  assert.ok(
    duplicates.every((r) => r.status === 200 && r.body.id === issue.id),
  );
  assert.equal(
    (await report({ ...issue, description: "Changed content" })).status,
    409,
  );
  assert.equal((await report(issue, b.sessionToken)).status, 409);
  assert.equal(
    (await mobile("admin/notifications", { token: admin })).body.count,
    baseline + 1,
  );
  assert.ok(
    !(await mobile("driver/issues", { token: b.sessionToken })).body.items.some(
      (i) => i.id === issue.id,
    ),
  );
  pass(
    "Mobile issue reporting validates vehicle access, isolates driver history and deduplicates retries; MQTT follows commit",
  );

  const second = {
    id: randomUUID(),
    truckId: null,
    category: "safety",
    description: "Loading bay light is broken.",
  };
  const concurrent = await Promise.all([report(second), report(second)]);
  assert.ok(concurrent.every((r) => r.status === 200));
  assert.equal(
    (await mobile("admin/notifications", { token: admin })).body.count,
    baseline + 2,
  );
  const started = await mobile("driver/driving-sessions", {
    method: "POST",
    token: b.sessionToken,
    body: {
      id: randomUUID(),
      truckId: trucks[1],
      expectedOwnSessionId: null,
      expectedScheduleId: null,
    },
  });
  assert.equal(started.status, 200);
  assert.equal(
    (
      await mobile(`driver/vehicles/${trucks[1]}/flag`, {
        method: "POST",
        token: a.sessionToken,
        body: { sessionId: started.body.drivingSession.id },
      })
    ).status,
    200,
  );
  const combined = (await mobile("admin/notifications", { token: admin })).body;
  assert.equal(combined.count, baseline + 3);
  assert.ok(
    combined.latest.some(
      (i) => i.kind === "occupancy" && i.registration === `${tag}-T1`,
    ),
  );
  assert.equal(
    (await mobile("admin/issues", { token: admin })).body.items.find(
      (i) => i.id === second.id,
    ).truck,
    null,
  );
  pass(
    "General issues and existing vehicle flags share one durable unresolved count",
  );

  // Exercise the browser's cookie/CSRF path separately from native bearer sessions.
  const jar = new Map();
  const cookies = () =>
    [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  async function browser(path, options = {}, base = env.APP_URL) {
    const result = await request(
      path,
      { ...options, headers: { Cookie: cookies(), ...options.headers } },
      base,
    );
    for (const value of result.headers.getSetCookie()) {
      const first = value.split(";")[0],
        at = first.indexOf("=");
      jar.set(first.slice(0, at), first.slice(at + 1));
    }
    return result;
  }
  const flow = await browser(
    "self-service/login/browser",
    {},
    env.KRATOS_PUBLIC_URL,
  );
  assert.equal(flow.status, 200);
  const csrf = flow.body.ui.nodes.find(
    (n) => n.attributes.name === "csrf_token",
  ).attributes.value;
  assert.equal(
    (
      await browser(
        flow.body.ui.action,
        {
          method: "POST",
          body: {
            method: "password",
            identifier: env.BOOTSTRAP_ADMIN_EMAIL,
            password: env.BOOTSTRAP_ADMIN_PASSWORD,
            csrf_token: csrf,
          },
        },
        env.KRATOS_PUBLIC_URL,
      )
    ).status,
    200,
  );
  const browserSession = await browser("api/auth/session");
  assert.equal(browserSession.status, 200);
  const webList = await browser("api/admin/issues");
  assert.equal(webList.status, 200);
  assert.match(webList.headers.get("cache-control"), /no-store/);
  assert.ok(
    webList.body.items.some(
      (i) => i.id === issue.id && i.description === issue.description,
    ),
  );
  const resolvePath = `api/admin/issues/${issue.id}/resolve`;
  const note = "Tyre replaced and checked.";
  assert.equal(
    (await browser(resolvePath, { method: "POST", body: { note } })).status,
    403,
  );
  assert.equal(
    (
      await browser(resolvePath, {
        method: "POST",
        body: { note },
        headers: {
          Origin: "https://invalid.example",
          "X-CSRF-Token": browserSession.body.csrfToken,
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await mobile(`admin/issues/${issue.id}/resolve`, {
        method: "POST",
        token: a.sessionToken,
        body: { note },
      })
    ).status,
    403,
  );
  const resolvedEvent = change();
  const resolveOptions = {
    method: "POST",
    body: { note },
    headers: {
      Origin: new URL(env.APP_URL).origin,
      "X-CSRF-Token": browserSession.body.csrfToken,
    },
  };
  assert.equal((await browser(resolvePath, resolveOptions)).status, 200);
  assert.equal((await resolvedEvent).count, baseline + 2);
  assert.equal(
    (await browser(resolvePath, resolveOptions)).status,
    200,
    "Same resolution retries safely",
  );
  assert.equal(
    (
      await browser(resolvePath, {
        ...resolveOptions,
        body: { note: "Overwrite" },
      })
    ).status,
    409,
  );
  const history = (
    await mobile("driver/issues", { token: a.sessionToken })
  ).body.items.find((i) => i.id === issue.id);
  assert.ok(history.resolvedAt);
  assert.equal(history.resolutionNote, note);
  const audit = (
    await db.query('SELECT "resolvedById" FROM app.driver_issues WHERE id=$1', [
      issue.id,
    ])
  ).rows[0];
  assert.equal(audit.resolvedById, browserSession.body.user.id);
  assert.ok(
    !(await browser("api/admin/issues")).body.items.some(
      (i) => i.id === issue.id,
    ),
  );
  pass(
    "Web admins review and resolve with cookie/CSRF protection; badges decrease and the driver sees the audited outcome",
  );

  const nativeEvent = change();
  assert.equal(
    (
      await mobile(`admin/issues/${second.id}/resolve`, {
        method: "POST",
        token: admin,
        body: { note: "Light replaced." },
      })
    ).status,
    200,
  );
  assert.equal((await nativeEvent).count, baseline + 1);
  const ids = [];
  for (let n = 0; n < 21; n++) {
    const id = randomUUID();
    ids.push(id);
    assert.equal(
      (
        await report({
          id,
          truckId: null,
          category: "other",
          description: `Report ${n}`,
        })
      ).status,
      200,
    );
  }
  const limited = (await mobile("admin/notifications", { token: admin })).body;
  assert.equal(limited.count, baseline + 22);
  assert.equal(limited.latest.length, 20);
  assert.equal(limited.latest[0].id, ids.at(-1));
  const reopened = await mobile("admin/notifications/connection", {
    method: "POST",
    token: admin,
  });
  assert.equal(reopened.status, 200);
  assert.equal(
    (await browser("api/admin/notifications")).body.count,
    limited.count,
  );
  pass(
    "Native admins can resolve issues; reconnect snapshots retain the full count beyond the 20-item preview",
  );

  const logout = await browser(
    "self-service/logout/browser",
    {},
    env.KRATOS_PUBLIC_URL,
  );
  await browser(logout.body.logout_url, {}, env.KRATOS_PUBLIC_URL);
} finally {
  socket?.end(true);
  for (const token of tokens)
    await mobile("auth/session", { method: "DELETE", token }).catch(
      () => undefined,
    );
  if (drivers.length) {
    await db.query(
      'DELETE FROM app.driver_issues WHERE "driverId"=ANY($1::uuid[])',
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
