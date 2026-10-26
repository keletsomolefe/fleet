import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { AdminContext } from '../auth/auth.service.js';
import { DrivingService } from '../mobile/driving.service.js';
import { drivingId } from '../mobile/driving.input.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import { DriverIssue } from './issue.entity.js';
import { parseIssue, parseIssueResolution } from './issue.input.js';

@Injectable()
export class IssuesService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(DrivingService) private readonly driving: DrivingService,
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
  ) {}
  private view(i: DriverIssue) {
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
    };
  }
  async report(c: AdminContext, raw: unknown) {
    const v = parseIssue(raw);
    const result = await this.db.transaction(async (m) => {
      // Use the same lock as vehicle/schedule changes when validating the report's vehicle.
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const context = await this.driving.context(c, m);
      const previous = await m.findOneBy(DriverIssue, { id: v.id });
      if (previous) {
        if (
          previous.driverId !== context.driver.id ||
          previous.truckId !== v.truckId ||
          previous.category !== v.category ||
          previous.description !== v.description
        )
          throw new ConflictException(
            'This report has already been sent. Start a new report.',
          );
        return { id: previous.id, created: false };
      }
      if (
        v.truckId &&
        ![context.truck?.id, context.schedule?.truck.id].includes(v.truckId)
      )
        throw new ConflictException(
          'Your vehicle changed. Refresh and try again.',
        );
      await m.save(
        DriverIssue,
        m.create(DriverIssue, {
          ...v,
          driverId: context.driver.id,
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
        }),
      );
      return { id: v.id, created: true };
    });
    if (result.created) this.events.changed();
    return { id: result.id };
  }
  async list(c: AdminContext, own = false) {
    const driverId = own
      ? (await this.driving.context(c)).driver.id
      : undefined;
    if (!own) this.events.require(c);
    const issues = await this.db.getRepository(DriverIssue).find({
      where: own ? { driverId } : { resolvedAt: IsNull() },
      relations: { truck: true, driver: { user: true } },
      order: { createdAt: 'DESC', id: 'DESC' },
      ...(own ? { take: 50 } : {}),
    });
    return { items: issues.map((i) => this.view(i)) };
  }
  async resolve(c: AdminContext, id: string, raw: unknown) {
    this.events.require(c);
    drivingId(id);
    const note = parseIssueResolution(raw);
    const changed = await this.db.transaction(async (m) => {
      const issue = await m.findOne(DriverIssue, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!issue) throw new NotFoundException('Issue not found.');
      if (issue.resolvedAt) {
        if (issue.resolvedById === c.user.id && issue.resolutionNote === note)
          return false;
        throw new ConflictException(
          'This issue was already resolved. Refresh the list.',
        );
      }
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
