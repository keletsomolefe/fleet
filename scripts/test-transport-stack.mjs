// End-to-end live PostgreSQL integration test for logistics tracking, shift odometer
// mileage, POD/receipt photos, office expenses, ServiceJob repair rollup, month-end
// Truck earnings + CSV export, and the chronological Driver Journey Timeline.
// Uses disposable fixtures and cleans them up completely in `finally`.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const root = new URL('../', import.meta.url);
Object.assign(
  process.env,
  parseEnv(await readFile(new URL('.env', root), 'utf8')),
);
process.env.SERVICE_JOB_ALERTS_ENABLED = 'false';
process.env.MQTT_ENABLED = 'false';

const { createApi } = await import('../apps/api/dist/app.js');
const { transportAttachmentDir } = await import(
  '../apps/api/dist/shared/storage/private-storage.js'
);
const { User } = await import(
  '../apps/api/dist/modules/identity/domain/user.entity.js'
);
const { Truck } = await import(
  '../apps/api/dist/modules/fleet/domain/truck.entity.js'
);
const { DriverProfile } = await import(
  '../apps/api/dist/modules/fleet/domain/driver.entity.js'
);
const { DrivingSession } = await import(
  '../apps/api/dist/modules/driving/domain/driving-session.entity.js'
);
const { ServiceJob } = await import(
  '../apps/api/dist/modules/service-jobs/domain/service-job.entity.js'
);

// Minimal valid 1x1 PNG buffer for photo upload tests
const tinyPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex',
);

const { app, services } = await createApi({ logger: { level: 'warn' } });
const { orm, transport } = services;
const tag = `TRN-${randomUUID().slice(0, 8)}`;

const createdIds = {
  userId: null,
  driverId: null,
  truckId: null,
  sessionId: null,
  customerId: null,
  productId: null,
  customerProductId: null,
  originId: null,
  destinationId: null,
  rateId: null,
  dispatchId: null,
  contextId: null,
  recordIds: [],
  expenseId: null,
  serviceJobId: null,
};

try {
  const em = orm.em.fork();
  const kratosSessionId = randomUUID();
  const user = em.create(User, {
    kratosIdentityId: randomUUID(),
    email: `${tag.toLowerCase()}@fleet.test`,
    firstName: 'Test',
    lastName: 'Logistics',
    isActive: true,
    createdBy: null,
    lastLoginAt: null,
  });
  const truck = em.create(Truck, {
    identifier: tag,
    registration: `GP-${tag.slice(-6)}`,
    registrationCountry: 'ZA',
    make: 'Scania',
    model: 'R500',
    category: 'tractor',
    fuelType: 'diesel',
    odometerKm: 284500,
    status: 'active',
    year: 2024,
    vin: null,
    engineNumber: null,
    transmission: null,
    axleCount: null,
    grossVehicleMassKg: null,
    tareKg: null,
    payloadCapacityKg: null,
    tankCapacityLitres: null,
    licenceDiscExpiresOn: null,
    roadworthyExpiresOn: null,
    insuranceProvider: null,
    insurancePolicyNumber: null,
    insuranceExpiresOn: null,
    serviceIntervalKm: null,
    nextServiceDueKm: null,
    notes: null,
    createdBy: null,
  });
  const driver = em.create(DriverProfile, {
    user,
    identifier: tag,
    phone: '+27820001122',
    licenceNumber: tag,
    licenceCode: 'EC',
    licenceCountry: 'ZA',
    licenceExpiresOn: '2030-01-01',
    prdpNumber: null,
    prdpExpiresOn: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    status: 'active',
    currentTruck: null,
    notes: null,
    createdBy: null,
  });
  await em.persist([user, truck, driver]).flush();
  createdIds.userId = user.id;
  createdIds.truckId = truck.id;
  createdIds.driverId = driver.id;

  const adminCtx = {
    session: {
      id: kratosSessionId,
      active: true,
      authenticated_at: new Date().toISOString(),
      identity: {
        id: user.kratosIdentityId,
        traits: { email: user.email, name: { first: user.firstName, last: user.lastName } },
      },
    },
    user,
    roles: [],
    permissions: [
      'admin.access',
      'driver.access',
      'customers.read',
      'customers.write',
      'locations.read',
      'locations.write',
      'products.read',
      'products.write',
      'pricing.read',
      'pricing.write',
      'dispatch.read',
      'dispatch.write',
      'activities.read',
      'activities.write',
      'activities.review',
      'revenue.read',
      'expenses.read',
      'expenses.write',
      'shifts.read',
    ],
  };

  // 1. Master data: Customer (with industry), Product, CustomerProduct, Locations, Rate
  const customer = await transport.catalogue.saveMaster(adminCtx, 'customers', {
    name: `${tag} Mining Co`,
    industry: 'Mining & Chrome',
    contact: 'Sipho',
    phone: '+27821112233',
  });
  createdIds.customerId = customer.id;

  const product = await transport.catalogue.saveMaster(adminCtx, 'products', {
    name: `${tag} Chrome Ore`,
    unit: 'tonne',
  });
  createdIds.productId = product.id;

  const cp = await transport.catalogue.saveMaster(
    adminCtx,
    'customer-products',
    {
      customerId: customer.id,
      productId: product.id,
      supplies: true,
      receives: true,
    },
  );
  createdIds.customerProductId = cp.id;

  const origin = await transport.catalogue.saveMaster(adminCtx, 'locations', {
    name: `${tag} North Pit`,
    siteType: 'collection',
    customerIds: [customer.id],
    directions: 'Weighbridge Gate 2',
  });
  createdIds.originId = origin.id;

  const destination = await transport.catalogue.saveMaster(
    adminCtx,
    'locations',
    {
      name: `${tag} Port Terminal`,
      siteType: 'delivery',
      customerIds: [customer.id],
    },
  );
  createdIds.destinationId = destination.id;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const month = today.slice(0, 7);

  // R200.00 per delivered tonne on North Pit -> Port Terminal
  const rate = await transport.pricing.createRate(adminCtx, {
    customerProductId: cp.id,
    originId: origin.id,
    destinationId: destination.id,
    method: 'quantity',
    basis: 'delivered',
    unit: 'tonne',
    price: '200.00',
    startsOn: `${month}-01`,
  });
  createdIds.rateId = rate.id;

  // 2. Dispatch
  const collectionId = randomUUID();
  const deliveryId = randomUUID();
  const dispatch = await transport.dispatch.save(adminCtx, {
    date: today,
    driverId: driver.id,
    truckId: truck.id,
    status: 'dispatched',
    plan: {
      customer: { id: customer.id, name: customer.name },
      supplier: { id: customer.id, name: customer.name },
      product: { id: product.id, name: product.name },
      origin: { id: origin.id, name: origin.name },
      quantity: '34.0',
      unit: 'tonne',
      instructions: 'Keep weighbridge slip',
      collectionId,
      deliveries: [
        {
          id: deliveryId,
          destination: { id: destination.id, name: destination.name },
          receiver: { id: customer.id, name: customer.name },
          quantity: '34.0',
          collectedQuantity: '34.0',
        },
      ],
    },
  });
  createdIds.dispatchId = dispatch.id;

  // 3. Driving session with start odometer (284560 km) + start odometer photo
  const sessionId = randomUUID();
  const startedAt = new Date(Date.now() - 3 * 3600_000);
  const session = em.create(DrivingSession, {
    id: sessionId,
    driver,
    truck,
    kratosSessionId,
    confirmedDate: today,
    startedAt,
    startOdometerKm: '284560.0',
    startOdometerAt: startedAt,
    mileageFlags: ['missing_start_photo'],
  });
  await em.persist(session).flush();
  createdIds.sessionId = session.id;

  // Uploading start odometer photo automatically clears `missing_start_photo`
  await transport.activity.saveAttachments(
    'shift',
    session.id,
    [{ buffer: tinyPng, mimetype: 'image/png', size: tinyPng.length }],
    'start_odometer_photo',
    { mode: 'mobile', context: adminCtx },
  );
  const refreshedSession = await orm.em.fork().findOneOrFail(DrivingSession, {
    id: session.id,
  });
  assert.deepEqual(refreshedSession.mileageFlags, []);

  // 4. Offline Recording Context & Batch Upload (Collection, Delivery with >2% variance, Fuel, Toll)
  const token = randomBytes(32).toString('hex');
  const contextId = randomUUID();
  await transport.activity.createRecordingContext(adminCtx, {
    id: contextId,
    token,
  });
  createdIds.contextId = contextId;

  const fuelId = randomUUID();
  const tollId = randomUUID();
  createdIds.recordIds.push(collectionId, deliveryId, fuelId, tollId);

  const nowIso = new Date().toISOString();
  const batchRes = await transport.activity.uploadBatch(
    {
      contextId,
      events: [
        {
          id: randomUUID(),
          recordId: collectionId,
          baseVersion: 0,
          data: {
            kind: 'collection',
            occurredAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
            dispatchId: dispatch.id,
            customer: { id: customer.id, name: customer.name },
            supplier: { id: customer.id, name: customer.name },
            product: { id: product.id, name: product.name },
            origin: { id: origin.id, name: origin.name },
            quantity: '34.0',
            unit: 'tonne',
            waybillNumber: 'WB-100',
            note: 'Loaded at North Pit',
          },
        },
        {
          id: randomUUID(),
          recordId: deliveryId,
          baseVersion: 0,
          data: {
            kind: 'delivery',
            occurredAt: new Date(Date.now() - 3600_000).toISOString(),
            dispatchId: dispatch.id,
            runId: collectionId,
            customer: { id: customer.id, name: customer.name },
            receiver: { id: customer.id, name: customer.name },
            product: { id: product.id, name: product.name },
            origin: { id: origin.id, name: origin.name },
            destination: { id: destination.id, name: destination.name },
            quantity: '33.0',
            collectedQuantity: '34.0',
            unit: 'tonne',
            waybillNumber: 'POD-100',
            outcome: 'completed',
            note: '1 tonne moisture/spill variance',
          },
        },
        {
          id: randomUUID(),
          recordId: fuelId,
          baseVersion: 0,
          data: {
            kind: 'fuel',
            occurredAt: new Date(Date.now() - 1800_000).toISOString(),
            fuelLitres: '100.0',
            fuelTotalCost: '2200.00',
            fuelStation: 'Engen N4',
            receiptNumber: 'FL-55',
            odometerKm: '284700',
          },
        },
        {
          id: randomUUID(),
          recordId: tollId,
          baseVersion: 0,
          data: {
            kind: 'expense',
            occurredAt: nowIso,
            expenseCategory: 'toll',
            expenseAmount: '350.00',
            vendorName: 'Middelburg Toll Plaza',
            receiptNumber: 'TL-88',
          },
        },
      ],
    },
    token,
  );
  assert.equal(batchRes.accepted.length, 4);
  assert.equal(batchRes.rejected.length, 0);

  // Attach POD photo via recording token (offline-capable)
  const podUpload = await transport.activity.saveAttachments(
    'record',
    deliveryId,
    [{ buffer: tinyPng, mimetype: 'image/png', size: tinyPng.length }],
    'pod',
    { mode: 'recording', contextId, tokenHeader: token },
  );
  assert.equal(podUpload.items.length, 1);

  // Check delivery detail: priced at 33.0 * R200 = R6600.00, flagged with weight_variance_alert (>2%)
  const detail = await transport.activity.recordDetail(adminCtx, deliveryId);
  assert.equal(detail.charge?.status, 'priced');
  assert.equal(detail.charge?.amount, '6600.00');
  assert.ok(detail.record.flags.includes('weight_variance_alert'));
  assert.equal(detail.attachments.length, 1);

  // Validate delivery with audit reason
  const reviewed = await transport.activity.reviewRecord(adminCtx, deliveryId, {
    version: detail.record.version,
    action: 'validated',
    reason: 'Verified against signed POD photo',
  });
  assert.equal(reviewed.review, 'validated');

  // 5. Close shift with end odometer (284760 km => 200 km driven)
  const emEnd = orm.em.fork();
  const sEnd = await emEnd.findOneOrFail(DrivingSession, { id: session.id });
  sEnd.endedAt = new Date();
  sEnd.endOdometerKm = '284760.0';
  sEnd.endOdometerAt = sEnd.endedAt;
  sEnd.endReason = 'driver_released';
  await emEnd.flush();

  // 6. Add Office Workshop Repair Expense (R1000) + Completed ServiceJob Repair (R500 = 50000 cents)
  const officeExp = await transport.expenses.create(adminCtx, {
    truckId: truck.id,
    occurredOn: today,
    category: 'repair',
    vendor: 'Witbank Workshop',
    invoiceNumber: 'INV-999',
    amount: '1000.00',
    notes: 'Brake chamber replacement',
  });
  createdIds.expenseId = officeExp.id;

  const emJob = orm.em.fork();
  const serviceJob = emJob.create(ServiceJob, {
    reference: `SJ-${String(Math.floor(100000 + Math.random() * 899999))}`,
    truck: emJob.getReference(Truck, truck.id),
    driver: emJob.getReference(DriverProfile, driver.id),
    serviceType: 'tyres',
    title: 'Roadside tyre repair',
    description: 'Replaced rear outer tyre',
    urgency: 'urgent',
    status: 'closed',
    completedAt: new Date(),
    closedAt: new Date(),
    completionNote: 'Replaced tyre on N4',
    completionCostCents: 50000,
    currency: 'ZAR',
    source: 'driver',
  });
  await emJob.persist(serviceJob).flush();
  createdIds.serviceJobId = serviceJob.id;

  // 7. Verify Month-End Truck Earnings & P&L Math:
  // Revenue: 6600.00 (validated)
  // Fuel: 2200.00 (100 L -> R22.00/L, 200 km -> 2.00 km/L)
  // Repairs: 1000.00 (workshop) + 500.00 (service job) = 1500.00
  // Other: 350.00 (toll)
  // Total Spend: 2200 + 1500 + 350 = 4050.00
  // Estimated Net Margin: 6600 - 4050 = 2550.00
  const report = await transport.earnings.monthlyReport(
    adminCtx,
    month,
    truck.id,
  );
  assert.equal(report.totals.length, 1);
  const row = report.totals[0];
  assert.equal(row.deliveries, 1);
  assert.equal(row.tonnesDelivered, '33.00');
  assert.equal(row.kmDriven, '200.0');
  assert.equal(row.revenue, '6600.00');
  assert.equal(row.validated, '6600.00');
  assert.equal(row.fuelLitres, '100.00');
  assert.equal(row.fuelSpend, '2200.00');
  assert.equal(row.kmPerLitre, '2.00');
  assert.equal(row.repairSpend, '1500.00');
  assert.equal(row.serviceJobCount, 1);
  assert.equal(row.otherExpenseSpend, '350.00');
  assert.equal(row.totalSpend, '4050.00');
  assert.equal(row.estimatedNetMargin, '2550.00');

  const csvOut = await transport.earnings.exportMonthlyCsv(
    adminCtx,
    month,
    truck.id,
  );
  assert.ok(csvOut.csv.includes('6600.00'));
  assert.ok(csvOut.csv.includes('2550.00'));

  // 8. Verify Unified Expenses & Chronological Driver Journey Timeline
  const expList = await transport.expenses.list(adminCtx, {
    month,
    truckId: truck.id,
  });
  assert.equal(expList.items.length, 4); // fuel, toll, workshop repair, service job

  const timeline = await transport.earnings.timeline(adminCtx, {
    truckId: truck.id,
    from: today,
    to: today,
  });
  const types = new Set(timeline.items.map((e) => e.eventType));
  for (const expected of [
    'shift_start',
    'shift_end',
    'collection',
    'delivery',
    'fuel',
    'expense',
    'service_job',
  ]) {
    assert.ok(types.has(expected), `Timeline missing ${expected}`);
  }

  console.log(
    'PASS full logistics, shift mileage, expenses, timeline, and month-end earnings stack test',
  );
} finally {
  const cleanEm = orm.em.fork();
  const cleanupSql = [
    createdIds.recordIds.length
      ? [
          `DELETE FROM app.transport_audits WHERE "recordId" = ANY($1::uuid[])`,
          [
            [
              ...createdIds.recordIds,
              createdIds.expenseId,
              createdIds.sessionId,
            ].filter(Boolean),
          ],
        ]
      : null,
    createdIds.recordIds.length
      ? [
          `DELETE FROM app.transport_attachments WHERE "recordId" = ANY($1::uuid[]) OR "truckExpenseId" = $2::uuid OR "drivingSessionId" = $3::uuid`,
          [createdIds.recordIds, createdIds.expenseId, createdIds.sessionId],
        ]
      : null,
    createdIds.recordIds.length
      ? [
          `DELETE FROM app.transport_charges WHERE "recordId" = ANY($1::uuid[])`,
          [createdIds.recordIds],
        ]
      : null,
    createdIds.recordIds.length
      ? [
          `DELETE FROM app.activity_revisions WHERE "recordId" = ANY($1::uuid[])`,
          [createdIds.recordIds],
        ]
      : null,
    createdIds.recordIds.length
      ? [
          `DELETE FROM app.transport_records WHERE id = ANY($1::uuid[])`,
          [createdIds.recordIds],
        ]
      : null,
    createdIds.contextId
      ? [`DELETE FROM app.recording_contexts WHERE id = $1::uuid`, [createdIds.contextId]]
      : null,
    createdIds.expenseId
      ? [`DELETE FROM app.truck_expenses WHERE id = $1::uuid`, [createdIds.expenseId]]
      : null,
    createdIds.serviceJobId
      ? [`DELETE FROM app.service_jobs WHERE id = $1::uuid`, [createdIds.serviceJobId]]
      : null,
    createdIds.dispatchId
      ? [`DELETE FROM app.dispatches WHERE id = $1::uuid`, [createdIds.dispatchId]]
      : null,
    createdIds.rateId
      ? [`DELETE FROM app.transport_rates WHERE id = $1::uuid`, [createdIds.rateId]]
      : null,
    createdIds.customerProductId
      ? [`DELETE FROM app.customer_products WHERE id = $1::uuid`, [createdIds.customerProductId]]
      : null,
    createdIds.originId || createdIds.destinationId
      ? [
          `DELETE FROM app.locations WHERE id = ANY($1::uuid[])`,
          [[createdIds.originId, createdIds.destinationId].filter(Boolean)],
        ]
      : null,
    createdIds.productId
      ? [`DELETE FROM app.products WHERE id = $1::uuid`, [createdIds.productId]]
      : null,
    createdIds.customerId
      ? [`DELETE FROM app.customers WHERE id = $1::uuid`, [createdIds.customerId]]
      : null,
    createdIds.sessionId
      ? [`DELETE FROM app.driving_sessions WHERE id = $1::uuid`, [createdIds.sessionId]]
      : null,
    createdIds.driverId
      ? [`DELETE FROM app.driver_profiles WHERE id = $1::uuid`, [createdIds.driverId]]
      : null,
    createdIds.truckId
      ? [`DELETE FROM app.trucks WHERE id = $1::uuid`, [createdIds.truckId]]
      : null,
    createdIds.userId
      ? [`DELETE FROM app.users WHERE id = $1::uuid`, [createdIds.userId]]
      : null,
  ].filter(Boolean);

  for (const [sql, params] of cleanupSql) {
    try {
      await cleanEm.execute(sql.replace(/\$\d+/g, '?'), params);
    } catch {
      // best-effort cleanup
    }
  }
  for (const ownerId of [createdIds.sessionId, ...createdIds.recordIds].filter(
    Boolean,
  )) {
    await rm(transportAttachmentDir(ownerId), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
  await app.close();
}
