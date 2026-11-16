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
const { Truck } = await import('../apps/api/dist/fleet/fleet.entity.js');
const { ServiceProvider } = await import('../apps/api/dist/service-jobs/service-provider.entity.js');
const { ServiceJob, ServiceJobEvent } = await import('../apps/api/dist/service-jobs/service-job.entity.js');
const { app, services } = await createApi({ logger: { level: 'warn' } });
try {
  const { serviceJobs, database } = services;
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
  const arbitrary = await database.query(
    'SELECT $1::text AS label, $2::int AS value, $1::text AS repeated',
    ['ok', 7],
  );
  assert.deepEqual(arbitrary[0], { label: 'ok', value: 7, repeated: 'ok' });

  // Contract coverage for detail rows and stage filters using disposable fixtures.
  const tag = 'SJQ-' + randomUUID().slice(0, 8);
  const truckRepo = database.getRepository(Truck);
  const providerRepo = database.getRepository(ServiceProvider);
  const jobRepo = database.getRepository(ServiceJob);
  const eventRepo = database.getRepository(ServiceJobEvent);
  let truck;
  let provider;
  let job;
  try {
    truck = await truckRepo.save({
      identifier: tag,
      registration: tag,
      registrationCountry: 'ZA',
      make: 'Test',
      model: 'Fixture',
      category: 'tractor',
      fuelType: 'diesel',
      odometerKm: 1,
      status: 'active',
    });
    provider = await providerRepo.save({
      companyName: tag,
      contactName: 'Test Provider',
      whatsappNumber: '27820000001',
      services: [],
      status: 'active',
      alertsEnabled: false,
    });
    job = await jobRepo.save({
      reference: 'SJ-999001',
      truck: truck.id,
      provider: provider.id,
      driver: null,
      serviceType: 'mechanical',
      title: 'Fixture job',
      description: 'Contract fixture',
      latitude: -26.2,
      longitude: 28.0,
      urgency: 'urgent',
      status: 'completed',
      source: 'admin',
    });
    await eventRepo.save({
      job: job.id,
      kind: 'working',
      actorType: 'admin',
      channel: 'dashboard',
    });
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
    assert.ok(completedFilter.items.every((item) => ['completed', 'closed'].includes(item.status)));
  } finally {
    if (job) await database.getRepository(ServiceJobEvent).delete({ job: job.id });
    if (job) await jobRepo.delete({ id: job.id });
    if (provider) await providerRepo.delete({ id: provider.id });
    if (truck) await truckRepo.delete({ id: truck.id });
  }
  console.log('PASS service job raw queries (dueAlertOffers, latestStages, listProviders, listJobs) and $n placeholder translation');
  console.log('PASS contract: detail + provider latestStage, job coordinates, awaiting status filter');
} finally {
  await app.close();
}
