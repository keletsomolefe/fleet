import { LockMode, type MikroORM } from '@mikro-orm/postgresql';
import { acquireAdvisoryLock, getEm } from '../../../database/context.js';
import { ConflictError, NotFoundError } from '../../../shared/errors.js';
import type { DrivingService } from '../../driving/application/driving.service.js';
import { drivingId } from '../../driving/http/driving.dto.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { requireIssues } from '../../identity/domain/permissions.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import type { ServiceJobsService } from '../../service-jobs/application/service-jobs.service.js';
import {
  DriverIssue,
  isIssueResolved,
  resolveIssue,
} from '../domain/driver-issue.entity.js';
import { parseIssue, parseIssueResolution } from '../http/issue.dto.js';

export class IssuesService {
  constructor(
    private readonly orm: MikroORM,
    private readonly driving: DrivingService,
    private readonly events: OperationsEventsService,
    private readonly jobs: ServiceJobsService,
  ) {}

  private view(
    issue: DriverIssue,
    job: ReturnType<ServiceJobsService['summaryForJob']> | null,
  ) {
    return {
      id: issue.id,
      kind: 'issue' as const,
      category: issue.category,
      description: issue.description,
      truck: issue.truck
        ? {
            id: issue.truck.id,
            identifier: issue.truck.identifier,
            registration: issue.truck.registration,
            make: issue.truck.make,
            model: issue.truck.model,
          }
        : null,
      requestedBy: userFullName(issue.driver.user),
      createdAt: issue.createdAt,
      resolvedAt: issue.resolvedAt,
      resolutionNote: issue.resolutionNote,
      job,
    };
  }

  async report(context: AdminContext, raw: unknown) {
    const input = parseIssue(raw);
    const result = await getEm(this.orm).transactional(async (tx) => {
      // Use the same lock as vehicle/schedule changes when validating the report's vehicle.
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const state = await this.driving.context(context, tx);
      const previous = await tx.findOne(
        DriverIssue,
        { id: input.id },
        { populate: ['truck', 'driver.user'] },
      );
      if (previous) {
        if (
          previous.driver.id !== state.driver.id ||
          (previous.truck?.id ?? null) !== input.truckId ||
          previous.category !== input.category ||
          previous.description !== input.description
        ) {
          throw new ConflictError(
            'This report has already been sent. Start a new report.',
          );
        }
        return {
          id: previous.id as string | null,
          created: false,
          duplicate: false,
          alerts: 'none' as const,
          job: await this.jobs.jobSummaryForIssue(previous.id),
        };
      }

      if (
        input.truckId &&
        ![state.truck?.id, state.schedule?.truck.id].includes(input.truckId)
      ) {
        throw new ConflictError('Your vehicle changed. Refresh and try again.');
      }

      const issue = tx.create(DriverIssue, {
        id: input.id,
        driver: tx.getReference(DriverProfile, state.driver.id),
        truck: input.truckId ? tx.getReference(Truck, input.truckId) : null,
        category: input.category,
        description: input.description,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      });
      await tx.persist(issue).flush();

      if (input.category === 'vehicle' && input.truckId) {
        const created = await this.jobs.createForIssue(tx, {
          issueId: issue.id,
          truckId: input.truckId,
          driverId: state.driver.id,
          driverName: state.driver.name,
          serviceType: input.serviceType ?? 'mechanical',
          description: input.description,
          locationText: input.locationText,
          latitude: input.latitude,
          longitude: input.longitude,
          locationAccuracyM: input.locationAccuracyM,
          locationCapturedAt: input.locationCapturedAt,
          notifyProviders: true,
        });
        return {
          id: issue.id,
          created: true,
          duplicate: created.duplicate,
          alerts: created.alerts,
          job: this.jobs.summaryForJob(created.job),
        };
      }

      return {
        id: issue.id,
        created: true,
        duplicate: false,
        alerts: 'none' as const,
        job: null,
      };
    });

    if (result.created) {
      this.events.changed();
      if (result.job) this.jobs.wakeWorker();
    }
    return {
      id: result.id,
      job: result.job,
      duplicate: result.duplicate,
      alerts: result.alerts,
    };
  }

  async list(context: AdminContext, own = false) {
    const em = getEm(this.orm);
    const driverId = own
      ? (await this.driving.context(context, em)).driver.id
      : undefined;
    if (!own) requireIssues(context);

    const issues = await em.find(
      DriverIssue,
      own ? { driver: driverId } : { resolvedAt: null },
      {
        populate: ['truck', 'driver.user'],
        orderBy: { createdAt: 'desc', id: 'desc' },
      },
    );
    const jobs = await this.jobs.jobSummariesForIssues(
      issues.map((issue) => issue.id),
    );
    return {
      items: issues.map((issue) => this.view(issue, jobs.get(issue.id) ?? null)),
    };
  }

  async resolve(context: AdminContext, id: string, raw: unknown) {
    requireIssues(context, true);
    drivingId(id);
    const note = parseIssueResolution(raw);

    const changed = await getEm(this.orm).transactional(async (tx) => {
      const issue = await tx.findOne(
        DriverIssue,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!issue) throw new NotFoundError('Issue not found.');
      if (isIssueResolved(issue)) {
        if (
          issue.resolvedBy?.id === context.user.id &&
          issue.resolutionNote === note
        ) {
          return false;
        }
        throw new ConflictError(
          'This issue was already resolved. Refresh the list.',
        );
      }
      await this.jobs.assertNoActiveJobForIssue(id, tx);
      resolveIssue(issue, tx.getReference(User, context.user.id), note);
      await tx.flush();
      return true;
    });

    if (changed) this.events.changed();
    return { id };
  }
}
