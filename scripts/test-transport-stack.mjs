import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
Object.assign(
  process.env,
  parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8")),
);
const { default: db } = await import("../apps/api/src/database/data-source.ts");
const { TransportService } =
  await import("../apps/api/src/transport/transport.service.ts");
const { Truck, DriverProfile } =
  await import("../apps/api/src/fleet/fleet.entity.ts");
const { User } = await import("../apps/api/src/users/user.entity.ts");
const { DrivingSession } =
  await import("../apps/api/src/mobile/driving.entity.ts");
const { localDate } =
  await import("../apps/api/src/transport/transport.input.ts");
await db.initialize();
const service = new TransportService(db, { changed() {} }),
  tag = `T-${randomBytes(5).toString("hex")}`,
  artifacts = [],
  contexts = [];
let truck, driver, user, drive;
const at = new Date().toISOString(),
  today = localDate(at),
  month = today.slice(0, 7),
  token = randomBytes(32).toString("hex");
const ref = (x) => ({ id: x.id, name: x.name });
const submit = async (
  contextId,
  data,
  recordId = randomUUID(),
  baseVersion = 0,
) => {
  artifacts.push(recordId);
  const event = { id: randomUUID(), recordId, baseVersion, data };
  const receipt = await service.upload({ contextId, events: [event] }, token);
  assert.equal(receipt.rejected.length, 0, JSON.stringify(receipt));
  return { event, receipt, recordId };
};
const pass = (message) => console.log(`PASS ${message}`);
const cookies = new Map();
async function http(base, path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: {
      Accept: "application/json",
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...options.headers,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(";")[0],
      i = first.indexOf("=");
    cookies.set(first.slice(0, i), first.slice(i + 1));
  }
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: response.status, body };
}
try {
  const owner = (
    await db.query(
      `SELECT u.* FROM app.users u JOIN app.user_roles ur ON ur."userId"=u.id JOIN app.roles r ON r.id=ur."roleId" WHERE r.key='owner' LIMIT 1`,
    )
  )[0];
  assert.ok(owner, "Run pnpm db:seed first");
  const admin = {
    user: owner,
    permissions: (await db.query("SELECT key FROM app.permissions")).map(
      (x) => x.key,
    ),
    session: { id: randomUUID() },
  };
  const flow = await http(
    process.env.KRATOS_PUBLIC_URL,
    "self-service/login/browser",
  );
  const csrf = flow.body.ui.nodes.find(
    (n) => n.attributes.name === "csrf_token",
  )?.attributes.value;
  assert.equal(
    (
      await http(process.env.KRATOS_PUBLIC_URL, flow.body.ui.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "password",
          identifier: process.env.BOOTSTRAP_ADMIN_EMAIL,
          password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
          csrf_token: csrf,
        }),
      })
    ).status,
    200,
  );
  const session = await http(process.env.APP_URL, "api/auth/session");
  assert.equal(session.status, 200);
  for (const [section, heading] of [
    ["customers", "Customer products"],
    ["locations", "Locations"],
    ["products", "Products"],
    ["pricing", "Add agreed rate"],
    ["dispatch", "Plan a job"],
    ["activities", "Activities &amp; review"],
    ["earnings", "Truck earnings"],
  ]) {
    const page = await http(process.env.APP_URL, `admin/${section}`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(page.status, 200, `SSR ${section}`);
    assert.ok(
      page.body.includes(heading),
      `SSR ${section} includes ${heading}`,
    );
  }
  const denied = await http(
    process.env.APP_URL,
    "api/admin/transport/master/customers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tag }),
    },
  );
  assert.equal(denied.status, 403);
  assert.equal(
    (await http(process.env.APP_URL, "api/mobile/transport/catalogue")).status,
    403,
  );
  pass(
    "Authenticated transport screens render and browser/native endpoints retain CSRF and session protection",
  );
  const add = async (kind, data) => {
    const row = await service.saveMaster(admin, kind, data);
    artifacts.push(row.id);
    return row;
  };
  const customer = await add("customers", { name: `${tag} Eskom` }),
    product = await add("products", { name: `${tag} Coal`, unit: "tonne" }),
    origin = await add("locations", { name: `${tag} Mine`, customerIds: [] }),
    destination = await add("locations", {
      name: `${tag} Eskom site`,
      customerIds: [customer.id],
    }),
    otherSite = await add("locations", {
      name: `${tag} Other site`,
      customerIds: [customer.id],
    });
  const link = await add("customer-products", {
    customerId: customer.id,
    productId: product.id,
    receives: true,
  });
  const defaultRate = await service.saveRate(admin, {
    customerProductId: link.id,
    method: "quantity",
    basis: "delivered",
    unit: "tonne",
    price: "250",
    startsOn: "2020-01-01",
  });
  artifacts.push(defaultRate.id);
  await assert.rejects(
    () =>
      service.saveRate(admin, {
        customerProductId: link.id,
        method: "delivery",
        unit: "tonne",
        price: "1",
        startsOn: today,
      }),
    /already covers/,
  );
  const route = await service.saveRate(admin, {
    customerProductId: link.id,
    originId: origin.id,
    destinationId: destination.id,
    method: "quantity",
    basis: "collected",
    unit: "tonne",
    price: "300",
    startsOn: "2020-01-01",
  });
  artifacts.push(route.id);
  user = await db.getRepository(User).save({
    kratosIdentityId: randomUUID(),
    email: `${tag.toLowerCase()}@example.test`,
    firstName: "Test",
    lastName: "Driver",
    isActive: true,
  });
  truck = await db.getRepository(Truck).save({
    identifier: tag,
    registration: tag,
    registrationCountry: "ZA",
    make: "Test",
    model: "Truck",
    category: "tipper",
    fuelType: "diesel",
    odometerKm: 100,
    status: "active",
    payloadCapacityKg: 40000,
  });
  driver = await db.getRepository(DriverProfile).save({
    userId: user.id,
    identifier: tag,
    phone: "+27821234567",
    licenceNumber: tag,
    licenceCode: "EC",
    licenceCountry: "ZA",
    licenceExpiresOn: "2099-01-01",
    prdpNumber: tag,
    prdpExpiresOn: "2099-01-01",
    status: "active",
  });
  await db.query(
    `INSERT INTO app.user_roles("userId","roleId") SELECT $1,id FROM app.roles WHERE key='driver'`,
    [user.id],
  );
  const driverContext = {
    user,
    permissions: ["driver.access"],
    session: { id: randomUUID() },
  };
  drive = await db.getRepository(DrivingSession).save({
    id: randomUUID(),
    driverId: driver.id,
    truckId: truck.id,
    kratosSessionId: driverContext.session.id,
    confirmedDate: today,
    startedAt: new Date(today + "T00:00:00+02:00"),
  });
  const contextId = randomUUID();
  contexts.push(contextId);
  await service.recordingContext(driverContext, { id: contextId, token });
  const base = {
    kind: "delivery",
    occurredAt: at,
    customer: ref(customer),
    product: ref(product),
    destination: ref(destination),
    quantity: "34000",
    unit: "kg",
  };
  const httpRecord = randomUUID();
  artifacts.push(httpRecord);
  const uploaded = await http(
    process.env.APP_URL,
    "api/mobile/transport/batches",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fleet-Recording-Token": token,
      },
      body: JSON.stringify({
        contextId,
        events: [
          {
            id: randomUUID(),
            recordId: httpRecord,
            baseVersion: 0,
            data: { kind: "collection", occurredAt: at },
          },
        ],
      }),
    },
  );
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.accepted.length, 1);
  assert.equal(uploaded.body.rejected.length, 0);
  const standalone = await submit(contextId, base);
  let detail = await service.record(admin, standalone.recordId);
  assert.equal(detail.charge.amount, "8500.00");
  assert.equal(detail.record.review, "pending");
  const retry = await service.upload(
    { contextId, events: [standalone.event] },
    token,
  );
  assert.equal(retry.accepted.length, 1);
  assert.equal(
    (await service.earnings(admin, month, truck.id)).totals[0].revenue,
    "8500.00",
  );
  pass(
    "Eskom coal estimate, unit conversion and idempotent upload without double counting",
  );
  const runId = randomUUID(),
    aId = randomUUID(),
    bId = randomUUID();
  await submit(
    contextId,
    {
      ...base,
      kind: "collection",
      origin: ref(origin),
      quantity: "34",
      unit: "tonne",
      allocations: [
        { deliveryId: aId, quantity: "20" },
        { deliveryId: bId, quantity: "14" },
      ],
    },
    runId,
  );
  await submit(
    contextId,
    {
      ...base,
      runId,
      origin: ref(origin),
      quantity: "19",
      unit: "tonne",
      outcome: "partial",
    },
    aId,
  );
  await submit(
    contextId,
    {
      ...base,
      runId,
      origin: ref(origin),
      destination: ref(otherSite),
      quantity: "14",
      unit: "tonne",
    },
    bId,
  );
  assert.equal((await service.record(admin, aId)).charge.amount, "6000.00");
  assert.equal((await service.record(admin, bId)).charge.amount, "3500.00");
  assert.equal(
    (await service.earnings(admin, month, truck.id)).totals[0].revenue,
    "18000.00",
  );
  pass(
    "One collection, multiple offloads, explicit loaded shares and route-specific pricing",
  );
  const typed = await submit(contextId, {
    ...base,
    customer: { name: "Customer typed offline" },
  });
  detail = await service.record(admin, typed.recordId);
  assert.equal(detail.charge.status, "needs_pricing");
  await service.review(admin, typed.recordId, {
    version: detail.record.version,
    action: "validated",
    reason: "Matched customer",
    data: { ...detail.record.data, customer: ref(customer) },
  });
  detail = await service.record(admin, typed.recordId);
  assert.equal(detail.charge.amount, "8500.00");
  assert.equal(detail.record.review, "validated");
  assert.equal(
    detail.revisions[0].submission.data.customer.name,
    "Customer typed offline",
  );
  await assert.rejects(
    () =>
      service.review(admin, typed.recordId, {
        version: 1,
        action: "void",
        reason: "Stale review",
      }),
    /changed/,
  );
  pass(
    "Typed references, original submission retained, matching and stale review protection",
  );
  const conflict = await submit(
    contextId,
    { ...base, quantity: "35000" },
    standalone.recordId,
    0,
  );
  assert.equal(conflict.receipt.accepted[0].conflict, true);
  detail = await service.record(admin, standalone.recordId);
  assert.equal(detail.record.data.quantity, "34000");
  await service.review(admin, standalone.recordId, {
    version: detail.record.version,
    action: "validated",
    reason: "Confirmed original delivery",
  });
  const yesterday = localDate(
    new Date(Date.parse(today + "T12:00:00+02:00") - 86400000),
  );
  await service.endRate(admin, defaultRate.id, {
    endsOn: yesterday,
    expectedEndsOn: null,
    reason: "New agreed rate",
  });
  const next = await service.saveRate(admin, {
    customerProductId: link.id,
    method: "quantity",
    basis: "delivered",
    unit: "tonne",
    price: "275",
    startsOn: today,
  });
  artifacts.push(next.id);
  assert.equal(
    (await service.record(admin, standalone.recordId)).charge.amount,
    "8500.00",
  );
  detail = await service.record(admin, standalone.recordId);
  await service.review(admin, standalone.recordId, {
    version: detail.record.version,
    action: "validated",
    reason: "Apply new agreement",
    reprice: true,
  });
  detail = await service.record(admin, standalone.recordId);
  assert.equal(detail.charge.amount, "9350.00");
  assert.equal(detail.audits.at(-1).before.charge.amount, "8500.00");
  pass(
    "Conflict retention, historical rate snapshots and explicitly audited repricing",
  );
  const fuel = await submit(contextId, {
    kind: "fuel",
    occurredAt: at,
    fuelLitres: "180",
    fuelTotalCost: "3960",
  });
  await submit(contextId, { kind: "fuel", occurredAt: at, fuelLitres: "10" });
  const own = await submit(contextId, { ...base, transportCharge: false });
  assert.equal(
    (await service.record(admin, own.recordId)).charge.status,
    "uncharged",
  );
  const failed = await submit(contextId, { ...base, outcome: "failed" });
  assert.equal(
    (await service.record(admin, failed.recordId)).charge.status,
    "uncharged",
  );
  const boundary = new Date(
    Date.parse(month + "-01T00:00:00+02:00") - 1,
  ).toISOString();
  const late = await submit(contextId, { ...base, occurredAt: boundary });
  assert.ok(
    (await service.record(admin, late.recordId)).record.flags.includes(
      "unconfirmed_allocation",
    ),
  );
  const report = await service.earnings(admin, month, truck.id);
  assert.equal(report.totals[0].fuelSpend, "3960");
  assert.equal(Number(report.totals[0].fuelLitres), 190);
  assert.equal(report.totals[0].missingFuelPrices, 1);
  assert.ok(!report.records.some((x) => x.id === late.recordId));
  assert.ok(report.records.some((x) => x.id === fuel.recordId));
  pass(
    "Fuel totals, uncharged own goods, failed deliveries and local month boundaries",
  );
  const job = await service.saveDispatch(admin, {
    reference: tag,
    date: today,
    driverId: driver.id,
    truckId: truck.id,
    status: "dispatched",
    plan: {
      customer: ref(customer),
      product: ref(product),
      origin: ref(origin),
      supplier: ref(customer),
      unit: "tonne",
      quantity: "34",
      deliveries: [
        {
          destination: ref(destination),
          receiver: ref(customer),
          quantity: "20",
          collectedQuantity: "20",
        },
        {
          destination: ref(otherSite),
          receiver: ref(customer),
          quantity: "14",
          collectedQuantity: "14",
        },
      ],
    },
  });
  artifacts.push(job.id);
  assert.equal(
    (await service.dispatches(driverContext, true))[0].plan.deliveries.length,
    2,
  );
  await assert.rejects(() => service.rates(driverContext), /access/);
  await assert.rejects(() => service.earnings(driverContext, month), /access/);
  assert.equal(
    "rates" in (await service.catalogue(driverContext, true)),
    false,
  );
  await assert.rejects(
    () =>
      service.upload(
        { contextId, events: [] },
        randomBytes(32).toString("hex"),
      ),
    /upload/,
  );
  pass(
    "Dispatch downloads, financial isolation and recording-capability isolation",
  );
  await assert.rejects(
    () =>
      service.endRate(admin, defaultRate.id, {
        endsOn: today,
        expectedEndsOn: yesterday,
        reason: "Overlapping extension",
      }),
    /overlap/,
  );
  const badRun = randomUUID(),
    badA = randomUUID(),
    badB = randomUUID();
  await submit(
    contextId,
    {
      ...base,
      kind: "collection",
      origin: ref(origin),
      quantity: "34",
      unit: "tonne",
      allocations: [
        { deliveryId: badA, quantity: "19" },
        { deliveryId: badB, quantity: "14" },
      ],
    },
    badRun,
  );
  await submit(
    contextId,
    {
      ...base,
      runId: badRun,
      origin: ref(origin),
      quantity: "18",
      unit: "tonne",
    },
    badA,
  );
  const invalid = await service.record(admin, badA);
  await assert.rejects(
    () =>
      service.review(admin, badA, {
        version: invalid.record.version,
        action: "validated",
        reason: "Cannot approve mismatched shares",
      }),
    /load shares/,
  );
  const collection = await service.record(admin, badRun);
  await service.review(admin, badRun, {
    version: collection.record.version,
    action: "pending",
    reason: "Correct loaded shares",
    data: {
      ...collection.record.data,
      allocations: [
        { deliveryId: badA, quantity: "20" },
        { deliveryId: badB, quantity: "14" },
      ],
    },
  });
  assert.equal((await service.record(admin, badA)).charge.amount, "6000.00");
  const flat = await service.saveRate(admin, {
    customerProductId: link.id,
    originId: origin.id,
    destinationId: otherSite.id,
    method: "delivery",
    unit: "item",
    price: "999.99",
    startsOn: today,
  });
  artifacts.push(flat.id);
  const fixed = await submit(contextId, {
    ...base,
    origin: ref(origin),
    destination: ref(otherSite),
    quantity: null,
  });
  let fixedRecord = await service.record(admin, fixed.recordId);
  assert.equal(fixedRecord.charge.amount, "999.99");
  await service.review(admin, fixed.recordId, {
    version: fixedRecord.record.version,
    action: "void",
    reason: "Duplicate delivery",
  });
  fixedRecord = await service.record(admin, fixed.recordId);
  assert.equal(fixedRecord.record.review, "void");
  assert.equal(fixedRecord.charge.status, "uncharged");
  assert.ok((await service.earnings(admin, month, truck.id)).byCustomer.length);
  pass(
    "Load-share validation and corrections, fixed delivery charges, duplicate voiding and customer/product breakdowns",
  );
} finally {
  try {
    const logout = await http(
      process.env.KRATOS_PUBLIC_URL,
      "self-service/logout/browser",
    );
    if (logout.status === 200)
      await http(process.env.KRATOS_PUBLIC_URL, logout.body.logout_url);
  } catch {}
  await db.transaction(async (m) => {
    await m.query("SET CONSTRAINTS ALL DEFERRED");
    for (const table of ["transport_audits", "activity_revisions"])
      await m.query(
        `DELETE FROM app.${table} WHERE "recordId"=ANY($1::uuid[])`,
        [artifacts],
      );
    await m.query(
      'DELETE FROM app.transport_charges WHERE "recordId"=ANY($1::uuid[])',
      [artifacts],
    );
    await m.query(
      "DELETE FROM app.transport_records WHERE id=ANY($1::uuid[])",
      [artifacts],
    );
    for (const table of [
      "recording_contexts",
      "dispatches",
      "transport_rates",
      "customer_products",
      "locations",
      "products",
      "customers",
    ])
      await m.query(`DELETE FROM app.${table} WHERE id=ANY($1::uuid[])`, [
        [...artifacts, ...contexts],
      ]);
    if (drive) await m.delete(DrivingSession, drive.id);
    if (driver) await m.delete(DriverProfile, driver.id);
    if (truck) await m.delete(Truck, truck.id);
    if (user) await m.delete(User, user.id);
  });
  await db.destroy();
}
