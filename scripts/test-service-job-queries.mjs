// Exercises the raw-SQL paths of ServiceJobsService against the local database:
// dueAlertOffers, latestStages, listProviders, listJobs and summary. It never
// writes application data (empty tables are sufficient to run every query).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
Object.assign(process.env, parseEnv(await readFile(new URL('.env', root), 'utf8')));
process.env.SERVICE_JOB_ALERTS_ENABLED = 'false';
process.env.MQTT_ENABLED = 'false';

const { createApi } = await import('../apps/api/dist/app.js');
const { rawQuery } = await import('../apps/api/dist/database/context.js');
const { Truck } = await import('../apps/api/dist/modules/fleet/domain/truck.entity.js');
const { ServiceProvider } = await import('../apps/api/dist/modules/service-jobs/domain/service-provider.entity.js');
const { ServiceJob } = await import('../apps/api/dist/modules/service-jobs/domain/service-job.entity.js');
const { ServiceJobEvent } = await import('../apps/api/dist/modules/service-jobs/domain/service-job-event.entity.js');

const { app, services } = await createApi({ logger: { level: 'warn' } });
try {
  const { serviceJobs, orm } = services;
  const em = orm.em.fork();
  const due = await serviceJobs.dueAlertOffers(5);
  assert.ok(Array.isArray(due));
  const stages = await serviceJobs.latestStages([randomUUID(), randomUUID()]);
  assert.ok(stages instanceof Map);
  const providers = await serviceJobs.listProviders({});
  assert.ok(Array.isArray(providers.items));
  assert.equal(typeof providers.total, 'number');
  const jobs = await serviceJobs.listJobs({});
  assert.ok(Array.isArray(jobs.items));
  assert.ok(jobs.counts && typeof jobs.counts.waiting === 'number');
  const summary = await serviceJobs.summary();
  assert.equal(typeof summary.waiting, 'number');
  assert.equal(typeof summary.alertsReady, 'boolean');
  const arbitrary = await rawQuery(
    em,
    'SELECT $1::text AS label, $2::int AS value, $1::text AS repeated',
    ['ok', 7],
  );
  assert.deepEqual(arbitrary[0], { label: 'ok', value: 7, repeated: 'ok' });

  // Contract coverage for detail rows and stage filters using disposable fixtures.
  const tag = 'SJQ-' + randomUUID().slice(0, 8);
  let truck;
  let provider;
  let job;
  try {
    truck = em.create(Truck, {
      identifier: tag,
      registration: tag,
      registrationCountry: 'ZA',
      make: 'Test',
      model: 'Fixture',
      category: 'tractor',
      fuelType: 'diesel',
      odometerKm: 1,
      status: 'active',
      year: null,
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
    provider = em.create(ServiceProvider, {
      companyName: tag,
      contactName: 'Test Provider',
      whatsappNumber: '27820000001',
      services: [],
      status: 'active',
      alertsEnabled: false,
      phone: null,
      email: null,
      coverageArea: null,
      notes: null,
      optedInAt: null,
      optInBy: null,
      optedOutAt: null,
      optOutReason: null,
      createdBy: null,
    });
    job = em.create(ServiceJob, {
      reference: 'SJ-999001',
      issue: null,
      truck,
      provider,
      driver: null,
      serviceType: 'mechanical',
      title: 'Fixture job',
      description: 'Contract fixture',
      locationText: null,
      latitude: -26.2,
      longitude: 28.0,
      locationAccuracyM: null,
      locationCapturedAt: null,
      urgency: 'urgent',
      status: 'completed',
      broadcastAt: null,
      acceptedAt: null,
      startedAt: null,
      completedAt: null,
      completionNote: null,
      completionCostCents: null,
      closedAt: null,
      closedBy: null,
      closeNote: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      source: 'admin',
      createdBy: null,
    });
    const event = em.create(ServiceJobEvent, {
      job,
      kind: 'working',
      actorType: 'admin',
      actorUser: null,
      provider: null,
      actorName: null,
      channel: 'dashboard',
      fromStatus: null,
      toStatus: null,
      note: null,
      metadata: null,
    });
    em.persist([truck, provider, job, event]);
    await em.flush();

    const providerView = await serviceJobs.getProvider(provider.id);
    assert.equal(providerView.jobs[0].latestStage, 'working');
    const detail = await serviceJobs.getJob(job.id);
    assert.equal(detail.job.latestStage, 'working');
    assert.equal(detail.job.latitude, -26.2);
    assert.equal(detail.job.longitude, 28.0);
    const awaiting = await serviceJobs.listJobs({ status: 'awaiting' });
    assert.ok(awaiting.items.some((item) => item.id === job.id));
    assert.ok(awaiting.items.every((item) => item.status === 'completed'));
    const completedFilter = await serviceJobs.listJobs({ status: 'completed' });
    assert.ok(
      completedFilter.items.every((item) =>
        ['completed', 'closed'].includes(item.status),
      ),
    );
  } finally {
    const cleanup = orm.em.fork();
    if (job) await cleanup.nativeDelete(ServiceJobEvent, { job: job.id });
    if (job) await cleanup.nativeDelete(ServiceJob, { id: job.id });
    if (provider) await cleanup.nativeDelete(ServiceProvider, { id: provider.id });
    if (truck) await cleanup.nativeDelete(Truck, { id: truck.id });
  }
  console.log('PASS service job raw queries (dueAlertOffers, latestStages, listProviders, listJobs) and $n placeholder translation');
  console.log('PASS contract: detail + provider latestStage, job coordinates, awaiting status filter');
} finally {
  await app.close();
}
