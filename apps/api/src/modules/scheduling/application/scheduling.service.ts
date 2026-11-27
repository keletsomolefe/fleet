import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  dbClockTimestamp,
  getEm,
  rawQuery,
} from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import { escapeLikePattern } from '../../../shared/validation.js';
import { DrivingSession } from '../../driving/domain/driving-session.entity.js';
import { VehicleDispute } from '../../driving/domain/vehicle-dispute.entity.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import { TrackingStream } from '../../telemetry/domain/tracking-stream.entity.js';
import {
  cancelDriverSchedule,
  DriverSchedule,
} from '../domain/driver-schedule.entity.js';
import {
  parseCancelSchedule,
  parseMismatch,
  parseSchedule,
  parseScheduleResolution,
  scheduleDate,
  today,
} from '../http/schedule.dto.js';

export class SchedulingService {
  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
  ) {}

  private require(context: AdminContext) {
    this.events.require(context);
    if (
      !context.permissions.includes('drivers.read') ||
      !context.permissions.includes('drivers.write')
    ) {
      throw new ForbiddenError('Driver scheduling access is required.');
    }
  }

  current(driverId: string, em: EntityManager = getEm(this.orm)) {
    return em.findOne(DriverSchedule, {
      driver: driverId,
      date: today(),
      cancelledAt: null,
    });
  }

  pending(driverId: string, em: EntityManager = getEm(this.orm)) {
    return em.findOne(VehicleDispute, {
      driver: driverId,
      kind: 'schedule',
      scheduleDate: today(),
      resolvedAt: null,
    });
  }

  async options(context: AdminContext, q = '') {
    this.require(context);
    const em = getEm(this.orm);
    const search = escapeLikePattern(q.slice(0, 100));
    const [drivers, trucks] = await Promise.all([
      rawQuery(
        em,
        `SELECT p.id, p.identifier, concat(u."firstName", ' ', u."lastName") AS name
         FROM app.driver_profiles p
         JOIN app.users u ON u.id = p."userId"
         WHERE p.status = 'active' AND u."isActive"
           AND (p.identifier ILIKE $1 OR u."firstName" ILIKE $1 OR u."lastName" ILIKE $1)
         ORDER BY p.identifier
         LIMIT 20`,
        [search],
      ),
      rawQuery(
        em,
        `SELECT id, identifier, registration, make, model
         FROM app.trucks
         WHERE status = 'active'
           AND (identifier ILIKE $1 OR registration ILIKE $1)
         ORDER BY registration
         LIMIT 20`,
        [search],
      ),
    ]);
    return { drivers, trucks };
  }

  async list(context: AdminContext, from?: string, to?: string) {
    this.require(context);
    const start = scheduleDate(from ?? today());
    const end = scheduleDate(to ?? start);
    if (end < start || (Date.parse(end) - Date.parse(start)) / 86_400_000 > 92) {
      throw new BadRequestError('Choose a range of up to 93 days.');
    }
    const em = getEm(this.orm);
    const items = await rawQuery(
      em,
      `SELECT s.*, to_char(s.date, 'YYYY-MM-DD') AS date,
         t.registration, t.identifier AS "truckIdentifier",
         concat(u."firstName", ' ', u."lastName") AS "driverName"
       FROM app.driver_schedules s
       JOIN app.trucks t ON t.id = s."truckId"
       JOIN app.driver_profiles p ON p.id = s."driverId"
       JOIN app.users u ON u.id = p."userId"
       WHERE s."cancelledAt" IS NULL AND s.date BETWEEN $1 AND $2
       ORDER BY s.date, t.registration`,
      [start, end],
    );
    return { items };
  }

  async save(context: AdminContext, raw: unknown) {
    this.require(context);
    const input = parseSchedule(raw);
    const result = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const driver = await tx.findOne(
        DriverProfile,
        { id: input.driverId, status: 'active' },
        { populate: ['user'] },
      );
      if (
        !driver?.user.isActive ||
        (await tx.count(Truck, { id: input.truckId, status: 'active' })) === 0
      ) {
        throw new BadRequestError('Choose an active driver and vehicle.');
      }

      const conflicts = await tx.find(
        DriverSchedule,
        {
          cancelledAt: null,
          date: { $in: input.dates },
          $or: [{ driver: input.driverId }, { truck: input.truckId }],
        },
        { populate: ['driver.user', 'truck'] },
      );

      const changed = conflicts.filter(
        (schedule) =>
          schedule.driver.id !== input.driverId ||
          schedule.truck.id !== input.truckId,
      );

      if (changed.length && !input.override) {
        throw new ConflictError({
          message: 'Review the conflicting dates before overriding.',
          conflicts: changed.map((schedule) => ({
            id: schedule.id,
            date: schedule.date,
            driverId: schedule.driver.id,
            truckId: schedule.truck.id,
            driverName: userFullName(schedule.driver.user),
            registration: schedule.truck.registration,
          })),
        });
      }

      if (
        input.override &&
        JSON.stringify(changed.map((s) => s.id).sort()) !==
          JSON.stringify(input.expectedConflicts)
      ) {
        throw new ConflictError(
          'The schedule changed. Review the conflicts again.',
        );
      }

      if (changed.length) {
        await tx.nativeUpdate(
          DriverSchedule,
          { id: { $in: changed.map((s) => s.id) } },
          { cancelledAt: new Date(), cancelledBy: context.user.id },
        );
      }

      const identical = new Set(
        conflicts
          .filter(
            (s) =>
              s.driver.id === input.driverId && s.truck.id === input.truckId,
          )
          .map((s) => s.date),
      );

      const driverRef = tx.getReference(DriverProfile, input.driverId);
      const truckRef = tx.getReference(Truck, input.truckId);
      const creatorRef = tx.getReference(User, context.user.id);
      for (const calendarDate of input.dates) {
        if (!identical.has(calendarDate)) {
          tx.persist(
            tx.create(DriverSchedule, {
              driver: driverRef,
              truck: truckRef,
              date: calendarDate,
              createdBy: creatorRef,
              note: input.note,
            }),
          );
        }
      }
      await tx.flush();

      const todayDate = today();
      if (input.dates.includes(todayDate) && !identical.has(todayDate)) {
        await this.closeDriver(
          tx,
          input.driverId,
          context.user.id,
          'schedule_changed',
        );
      }
      // A changed plan ends the displaced driver's capture now; it never transfers an active vehicle.
      for (const displaced of changed.filter((s) => s.date === todayDate)) {
        await this.closeDriver(
          tx,
          displaced.driver.id,
          context.user.id,
          'schedule_changed',
        );
      }

      return {
        ok: true,
        created: input.dates.length - identical.size,
        overridden: changed.length,
      };
    });

    this.events.changed();
    return result;
  }

  async cancel(context: AdminContext, id: string, raw: unknown) {
    this.require(context);
    const scheduleId = assertUuid(
      id,
      'Refresh the vehicle list and try again.',
    );
    const { note: reason } = parseCancelSchedule(raw);
    await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const schedule = await tx.findOne(DriverSchedule, {
        id: scheduleId,
        cancelledAt: null,
      });
      if (!schedule) {
        throw new ConflictError('The schedule changed. Refresh it.');
      }
      cancelDriverSchedule(
        schedule,
        tx.getReference(User, context.user.id),
        reason,
      );
      await tx.flush();
      if (schedule.date === today()) {
        await this.closeDriver(
          tx,
          schedule.driver.id,
          context.user.id,
          'schedule_changed',
        );
      }
    });
    this.events.changed();
    return { ok: true };
  }

  async closeDriver(
    tx: EntityManager,
    driverId: string,
    actorId: string,
    reason: string,
  ) {
    const at = await dbClockTimestamp(tx);
    const activeSessions = await tx.find(DrivingSession, {
      driver: driverId,
      endedAt: null,
    });
    for (const session of activeSessions) {
      await tx.nativeUpdate(
        DrivingSession,
        { id: session.id },
        { endedAt: at, endedBy: actorId, endReason: reason },
      );
      await tx.nativeUpdate(
        TrackingStream,
        { drivingSession: session.id, endedAt: null },
        { endedAt: at },
      );
    }
  }

  async mismatch(context: AdminContext, raw: unknown) {
    const input = parseMismatch(raw);
    const result = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      if (!context.permissions.includes('driver.access')) {
        throw new ForbiddenError();
      }
      const driver = await tx.findOne(DriverProfile, {
        user: context.user.id,
        status: 'active',
      });
      if (!driver) throw new ForbiddenError();

      const schedule = await this.current(driver.id, tx);
      if (!schedule || schedule.id !== input.expectedScheduleId) {
        throw new ConflictError(
          'Your schedule changed. Refresh before reporting a mismatch.',
        );
      }
      if (input.requestedTruckId === schedule.truck.id) {
        throw new BadRequestError(
          'Choose a different vehicle or leave it blank.',
        );
      }
      if (
        input.requestedTruckId &&
        (await tx.count(Truck, {
          id: input.requestedTruckId,
          status: 'active',
        })) === 0
      ) {
        throw new NotFoundError('Choose an active vehicle.');
      }

      const existing = await this.pending(driver.id, tx);
      if (existing) return existing;

      await this.closeDriver(tx, driver.id, context.user.id, 'schedule_dispute');
      const dispute = tx.create(VehicleDispute, {
        kind: 'schedule',
        truck: schedule.truck,
        driver,
        activeSession: null,
        schedule,
        scheduleDate: schedule.date,
        requestedTruck: input.requestedTruckId
          ? tx.getReference(Truck, input.requestedTruckId)
          : null,
        driverNote: input.note,
      });
      await tx.persist(dispute).flush();
      return dispute;
    });
    this.events.changed();
    return {
      id: result.id,
      kind: result.kind,
      truckId: result.truck.id,
      driverId: result.driver.id,
      scheduleId: result.schedule?.id ?? null,
      scheduleDate: result.scheduleDate,
      requestedTruckId: result.requestedTruck?.id ?? null,
      driverNote: result.driverNote,
      createdAt: result.createdAt,
    };
  }

  async resolve(context: AdminContext, id: string, raw: unknown) {
    this.require(context);
    const disputeId = assertUuid(
      id,
      'Refresh the vehicle list and try again.',
    );
    const input = parseScheduleResolution(raw);

    await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const dispute = await tx.findOne(VehicleDispute, {
        id: disputeId,
        kind: 'schedule',
        resolvedAt: null,
      });
      if (!dispute) {
        throw new ConflictError(
          'This item has already been resolved. Refresh the list.',
        );
      }
      const current = await tx.findOne(DriverSchedule, {
        driver: dispute.driver.id,
        date: dispute.scheduleDate!,
        cancelledAt: null,
      });
      if ((current?.id ?? null) !== input.expectedScheduleId) {
        throw new ConflictError('The schedule changed. Review it again.');
      }

      if (input.resolution === 'change_schedule') {
        const requestedTruckId = dispute.requestedTruck?.id ?? null;
        if (!requestedTruckId) {
          throw new BadRequestError(
            'Update the schedule first, then keep the updated schedule.',
          );
        }
        if (
          (await tx.count(Truck, {
            id: requestedTruckId,
            status: 'active',
          })) === 0
        ) {
          throw new ConflictError('The requested vehicle is unavailable.');
        }

        const todayDate = today();
        const active =
          dispute.scheduleDate === todayDate
            ? await tx.findOne(DrivingSession, {
                truck: requestedTruckId,
                endedAt: null,
              })
            : null;
        if ((active?.id ?? null) !== input.expectedActiveSessionId) {
          throw new ConflictError(
            'The vehicle session changed. Review it again.',
          );
        }
        if (active && active.driver.id !== dispute.driver.id) {
          throw new ConflictError(
            'Resolve the active vehicle handover before changing the schedule.',
          );
        }
        if (
          (await tx.count(VehicleDispute, {
            truck: requestedTruckId,
            kind: 'occupancy',
            resolvedAt: null,
          })) > 0
        ) {
          throw new ConflictError('Resolve the vehicle flag first.');
        }

        const displaced = await tx.find(DriverSchedule, {
          truck: requestedTruckId,
          date: dispute.scheduleDate!,
          cancelledAt: null,
        });
        if ((displaced[0]?.id ?? null) !== input.expectedRequestedScheduleId) {
          throw new ConflictError(
            'The requested vehicle schedule changed. Review it again.',
          );
        }

        const toCancel = [...displaced, ...(current ? [current] : [])];
        if (toCancel.length) {
          await tx.nativeUpdate(
            DriverSchedule,
            { id: { $in: toCancel.map((s) => s.id) } },
            { cancelledAt: new Date(), cancelledBy: context.user.id },
          );
          for (const item of toCancel) {
            if (item.date === todayDate) {
              await this.closeDriver(
                tx,
                item.driver.id,
                context.user.id,
                'schedule_changed',
              );
            }
          }
        }

        tx.persist(
          tx.create(DriverSchedule, {
            driver: dispute.driver,
            truck: tx.getReference(Truck, requestedTruckId),
            date: dispute.scheduleDate!,
            createdBy: tx.getReference(User, context.user.id),
            note: input.note,
          }),
        );
      }

      if (!current && input.resolution === 'keep_schedule') {
        throw new ConflictError(
          'Create a replacement schedule before resolving this item.',
        );
      }

      dispute.resolvedAt = new Date();
      dispute.resolvedBy = tx.getReference(User, context.user.id);
      dispute.resolution = input.resolution;
      dispute.note = input.note;
      await tx.flush();
    });

    this.events.changed();
    return { ok: true };
  }
}
