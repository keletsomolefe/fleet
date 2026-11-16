import { Database, EntityManager, In, IsNull, Not, save, saveNew, exists } from '../database/database.js';
import { LockMode } from '@mikro-orm/postgresql';
import { ConflictError, NotFoundError } from '../http/errors.js';
import type { AdminContext } from '../auth/auth.service.js';
import { DrivingService } from '../mobile/driving.service.js';
import { drivingId } from '../mobile/driving.input.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import { DriverIssue } from './issue.entity.js';
import { parseIssue, parseIssueResolution } from './issue.input.js';
import { requireIssues } from '../rbac/issue-access.js';
import { ServiceJobsService } from '../service-jobs/service-jobs.service.js';

export class IssuesService {
  constructor(
    private readonly db: Database,
    private readonly driving: DrivingService,
    private readonly events: OperationsEventsService,
    private readonly jobs: ServiceJobsService,
  ) {}
  private view(i: DriverIssue, job: ReturnType<ServiceJobsService['summaryForJob']> | null) {
    return {
      id: i.id,
      kind: 'issue' as const,
      category: i.category,
      description: i.description,
      truck: i.truck
        ? {
            id: i.truck.id,
            identifier: i.truck.identifier,
            registration: i.truck.registration,
            make: i.truck.make,
            model: i.truck.model,
          }
        : null,
      requestedBy: `${i.driver.user.firstName} ${i.driver.user.lastName}`,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
      resolutionNote: i.resolutionNote,
      job,
    };
  }
  async report(c: AdminContext, raw: unknown) {
    const v = parseIssue(raw);
    let duplicate = false;
    let alerts: 'queued' | 'skipped' | 'none' = 'none';
    const result = await this.db.transaction(async (m) => {
      // Use the same lock as vehicle/schedule changes when validating the report's vehicle.
      await m.execute(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const context = await this.driving.context(c, m);
      const previous = await m.findOne(DriverIssue, { id: v.id }, { populate: ['truck', 'driver.user'] });
      if (previous) {
        if (
          previous.driverId !== context.driver.id ||
          previous.truckId !== v.truckId ||
          previous.category !== v.category ||
          previous.description !== v.description
        )
          throw new ConflictError(
            'This report has already been sent. Start a new report.',
          );
        return {
          id: previous.id as string | null,
          created: false,
          duplicate: false,
          alerts: 'none' as const,
          job: await this.jobs.jobSummaryForIssue(previous.id),
        };
      }
      if (
        v.truckId &&
        ![context.truck?.id, context.schedule?.truck.id].includes(v.truckId)
      )
        throw new ConflictError('Your vehicle changed. Refresh and try again.');

      if (v.category === 'vehicle' && v.truckId) {
        const active = await this.jobs.activeJobForTruck(m, v.truckId);
        if (active) {
          duplicate = true;
          return {
            id: active.issueId,
            created: false,
            duplicate: true,
            alerts: 'skipped' as const,
            job: this.jobs.summaryForJob(active),
          };
        }
      }

      const issue = m.create(DriverIssue, {
        id: v.id,
        driverId: context.driver.id,
        truckId: v.truckId,
        category: v.category,
        description: v.description,
        resolvedAt: null,
        resolvedById: null,
        resolutionNote: null,
      });
      await m.save(issue);
      let job = null;
      if (v.category === 'vehicle' && v.truckId) {
        const created = await this.jobs.createForIssue(m, {
          issueId: issue.id,
          truckId: v.truckId,
          driverId: context.driver.id,
          driverName: context.driver.name,
          serviceType: v.serviceType ?? 'mechanical',
          description: v.description,
          locationText: v.locationText,
          latitude: v.latitude,
          longitude: v.longitude,
          locationAccuracyM: v.locationAccuracyM,
          locationCapturedAt: v.locationCapturedAt,
          notifyProviders: true,
        });
        duplicate = created.duplicate;
        alerts = created.alerts;
        job = this.jobs.summaryForJob(created.job);
      }
      return { id: issue.id as string | null, created: true, duplicate, alerts, job };
    });
    if (result.created) {
      this.events.changed();
      if (result.job) this.jobs.wakeWorker();
    }
    return { id: result.id, job: result.job, duplicate, alerts: result.alerts };
  }
  async list(c: AdminContext, own = false) {
    const driverId = own
      ? (await this.driving.context(c)).driver.id
      : undefined;
    if (!own) requireIssues(c);
    const issues = await this.db.em.find(DriverIssue, own ? { driverId } : { resolvedAt: IsNull() }, { populate: ['truck', 'driver.user'], orderBy: { createdAt: 'desc', id: 'desc' } });
    const jobs = await this.jobs.jobSummariesForIssues(
      issues.map((issue) => issue.id),
    );
    return {
      items: issues.map((issue) => this.view(issue, jobs.get(issue.id) ?? null)),
    };
  }
  async resolve(c: AdminContext, id: string, raw: unknown) {
    requireIssues(c, true);
    drivingId(id);
    const note = parseIssueResolution(raw);
    const changed = await this.db.transaction(async (m) => {
      const issue = await m.findOne(DriverIssue, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!issue) throw new NotFoundError('Issue not found.');
      if (issue.resolvedAt) {
        if (issue.resolvedById === c.user.id && issue.resolutionNote === note)
          return false;
        throw new ConflictError(
          'This issue was already resolved. Refresh the list.',
        );
      }
      await this.jobs.assertNoActiveJobForIssue(id, m);
      issue.resolvedAt = new Date();
      issue.resolvedById = c.user.id;
      issue.resolutionNote = note;
      await m.save(issue);
      return true;
    });
    if (changed) this.events.changed();
    return { id };
  }
}
