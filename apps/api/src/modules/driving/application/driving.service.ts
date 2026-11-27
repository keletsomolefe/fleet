import type { EntityManager, FilterQuery, MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  dbClockTimestamp,
  getEm,
} from '../../../database/context.js';
import { operationalToday } from '../../../shared/calendar-date.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors.js';
import { escapeLikePattern } from '../../../shared/validation.js';
import {
  assertDriverEligibleForAssignment,
  DriverProfile,
} from '../../fleet/domain/driver.entity.js';
import { isTruckActive, Truck } from '../../fleet/domain/truck.entity.js';
import { parseSearch } from '../../fleet/http/fleet.dto.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import type { SchedulingService } from '../../scheduling/application/scheduling.service.js';
import { DriverSchedule } from '../../scheduling/domain/driver-schedule.entity.js';
import { TrackingStream } from '../../telemetry/domain/tracking-stream.entity.js';
import {
  TransportAttachment,
  TransportAudit,
} from '../../transport/domain/activity.entity.js';
import {
  computeShiftDistanceKm,
  DrivingSession,
  evaluateShiftMileageFlags,
} from '../domain/driving-session.entity.js';
import { VehicleDispute } from '../domain/vehicle-dispute.entity.js';
import {
  drivingId,
  parseDisputeResolution,
  parseDrivingEnd,
  parseDrivingEndInput,
  parseDrivingStart,
  parseShiftFilter,
  parseShiftReview,
} from '../http/driving.dto.js';

export class DrivingService {
  constructor(
    private readonly orm: MikroORM,
    private readonly scheduling: SchedulingService,
    private readonly events: OperationsEventsService,
  ) {}

  private async driver(
    context: AdminContext,
    em: EntityManager = getEm(this.orm),
  ) {
    if (!context.permissions.includes('driver.access')) {
      throw new ForbiddenError('Driver access is not enabled.');
    }
    const profile = await em.findOne(
      DriverProfile,
      { user: context.user.id, status: 'active' },
      { populate: ['user'] },
    );
    if (!profile || !profile.user.isActive) {
      throw new ForbiddenError(
        'Driver access is not active. Contact your fleet administrator.',
      );
    }
    return profile;
  }

  requireAdmin(context: AdminContext) {
    if (
      !['admin.access', 'trucks.read', 'trucks.write'].every((permission) =>
        context.permissions.includes(permission),
      )
    ) {
      throw new ForbiddenError('Vehicle management access is required.');
    }
  }

  private vehicle(truck: Truck) {
    return {
      id: truck.id,
      identifier: truck.identifier,
      registration: truck.registration,
      make: truck.make,
      model: truck.model,
      status: truck.status,
      odometerKm: truck.odometerKm,
    };
  }

  private async activeSession(
    truckId: string,
    em: EntityManager = getEm(this.orm),
  ) {
    return em.findOne(
      DrivingSession,
      { truck: truckId, endedAt: null },
      { populate: ['driver.user'] },
    );
  }

  private occupant(session: DrivingSession | null) {
    return session
      ? {
          id: session.id,
          driverId: session.driver.id,
          driverName: userFullName(session.driver.user),
          startedAt: session.startedAt,
        }
      : null;
  }

  async context(context: AdminContext, em: EntityManager = getEm(this.orm)) {
    const profile = await this.driver(context, em);
    const session = await em.findOne(
      DrivingSession,
      { driver: profile.id, endedAt: null },
      { populate: ['truck'] },
    );
    const [schedule, pending] = await Promise.all([
      this.scheduling.current(profile.id, em),
      this.scheduling.pending(profile.id, em),
    ]);
    const scheduledTruck = schedule
      ? await em.findOne(Truck, { id: schedule.truck.id })
      : null;

    let reason: string | null = pending
      ? 'Your schedule mismatch is awaiting administrator review.'
      : null;
    try {
      assertDriverEligibleForAssignment(profile);
    } catch (error) {
      reason =
        error instanceof BadRequestError
          ? error.message
          : 'Your licence details need review.';
    }
    if (session && !isTruckActive(session.truck)) {
      reason =
        'This vehicle is unavailable. Finish driving and contact your administrator.';
    }

    const todayDate = operationalToday();
    const onThisPhone =
      Boolean(session) && session!.kratosSessionId === context.session.id;
    const confirmed =
      onThisPhone &&
      session!.confirmedDate === todayDate &&
      (session!.schedule?.id ?? null) === (schedule?.id ?? null) &&
      (!schedule || schedule.truck.id === session!.truck.id);

    const disputed = session
      ? (await em.count(VehicleDispute, {
          truck: session.truck.id,
          kind: 'occupancy',
          resolvedAt: null,
        })) > 0
      : false;

    return {
      date: todayDate,
      schedule:
        schedule && scheduledTruck
          ? {
              id: schedule.id,
              date: schedule.date,
              truck: this.vehicle(scheduledTruck),
            }
          : null,
      pendingDispute: pending
        ? { id: pending.id, note: pending.driverNote }
        : null,
      driver: {
        id: profile.id,
        identifier: profile.identifier,
        name: userFullName(context.user),
      },
      truck: session
        ? {
            ...this.vehicle(session.truck),
            disputed,
          }
        : null,
      drivingSession: session
        ? {
            id: session.id,
            startedAt: session.startedAt,
            onThisPhone,
            startOdometerKm: session.startOdometerKm,
            mileageFlags: session.mileageFlags,
          }
        : null,
      canDrive: !reason,
      reason,
      confirmedAt: confirmed && !reason ? session!.startedAt : null,
    };
  }

  async vehicles(context: AdminContext, q?: string, page?: string) {
    const em = getEm(this.orm);
    await this.driver(context, em);
    const search = parseSearch(q, page);
    const where: FilterQuery<Truck> = { status: 'active' };
    if (search.q) {
      const pattern = escapeLikePattern(search.q);
      where.$or = [
        { identifier: { $ilike: pattern } },
        { registration: { $ilike: pattern } },
        { make: { $ilike: pattern } },
        { model: { $ilike: pattern } },
      ];
    }

    const [trucks, total] = await em.findAndCount(Truck, where, {
      orderBy: { registration: 'asc' },
      limit: 20,
      offset: (search.page - 1) * 20,
    });

    const truckIds = trucks.map((truck) => truck.id);
    const todayDate = operationalToday();

    // Batch-load active sessions, today's schedules, and open occupancy disputes (3 queries instead of 3*N).
    const [activeSessions, schedules, openDisputes] = truckIds.length
      ? await Promise.all([
          em.find(
            DrivingSession,
            { truck: { $in: truckIds }, endedAt: null },
            { populate: ['driver.user'] },
          ),
          em.find(DriverSchedule, {
            truck: { $in: truckIds },
            date: todayDate,
            cancelledAt: null,
          }),
          em.find(VehicleDispute, {
            truck: { $in: truckIds },
            kind: 'occupancy',
            resolvedAt: null,
          }),
        ])
      : [[], [], []];

    const sessionByTruck = new Map(
      activeSessions.map((session) => [session.truck.id, session]),
    );
    const scheduledTruckIds = new Set(
      schedules.map((schedule) => schedule.truck.id),
    );
    const disputedTruckIds = new Set(
      openDisputes.map((dispute) => dispute.truck.id),
    );

    const items = trucks.map((truck) => ({
      ...this.vehicle(truck),
      activeSession: this.occupant(sessionByTruck.get(truck.id) ?? null),
      scheduled: scheduledTruckIds.has(truck.id),
      disputed: disputedTruckIds.has(truck.id),
    }));
    return { items, total, page: search.page, pageSize: 20 };
  }

  async flag(context: AdminContext, truckId: string, raw: unknown) {
    const expected = parseDrivingEnd(raw);
    const validTruckId = drivingId(truckId);
    const dispute = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const profile = await this.driver(context, tx);
      const active = await this.activeSession(validTruckId, tx);
      if (!active) {
        throw new ConflictError(
          'The vehicle is now available. Refresh the vehicle list.',
        );
      }
      if (active.id !== expected) {
        throw new ConflictError(
          'The vehicle session changed. Refresh the list before flagging it.',
        );
      }
      const existing = await tx.findOne(VehicleDispute, {
        truck: validTruckId,
        driver: profile.id,
        kind: 'occupancy',
        resolvedAt: null,
      });
      if (existing) return existing;
      const created = tx.create(VehicleDispute, {
        truck: tx.getReference(Truck, validTruckId),
        driver: profile,
        activeSession: active,
      });
      await tx.persist(created).flush();
      return created;
    });
    this.events.changed();
    return {
      id: dispute.id,
      truckId: dispute.truck.id,
      driverId: dispute.driver.id,
      kind: dispute.kind,
      activeSessionId: dispute.activeSession?.id ?? null,
      createdAt: dispute.createdAt,
    };
  }

  async start(context: AdminContext, raw: unknown) {
    const input = parseDrivingStart(raw);
    const todayDate = operationalToday();
    const result = await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const profile = await this.driver(context, tx);
      assertDriverEligibleForAssignment(profile, todayDate);

      const schedule = await this.scheduling.current(profile.id, tx);
      if (await this.scheduling.pending(profile.id, tx)) {
        throw new ConflictError(
          'Your schedule mismatch is awaiting administrator review.',
        );
      }
      if ((schedule?.id ?? null) !== input.expectedScheduleId) {
        throw new ConflictError(
          'Your schedule changed. Refresh and confirm the scheduled vehicle.',
        );
      }
      if (schedule && schedule.truck.id !== input.truckId) {
        throw new ConflictError(
          'Report a schedule mismatch for administrator review before changing vehicles.',
        );
      }

      const truck = await tx.findOne(Truck, {
        id: input.truckId,
        status: 'active',
      });
      if (!truck) throw new NotFoundError('Select an active vehicle.');

      const reserved = await tx.findOne(DriverSchedule, {
        truck: truck.id,
        date: todayDate,
        cancelledAt: null,
      });
      if (reserved && reserved.driver.id !== profile.id) {
        throw new ConflictError(
          'This vehicle is scheduled for another driver. Contact your administrator.',
        );
      }

      const existing = await tx.findOne(DrivingSession, { id: input.id });
      if (existing) {
        if (
          existing.driver.id !== profile.id ||
          existing.truck.id !== truck.id ||
          existing.kratosSessionId !== context.session.id ||
          existing.endedAt
        ) {
          throw new ConflictError('Refresh the vehicle selection.');
        }
        return { started: true as const };
      }

      const occupant = await this.activeSession(truck.id, tx);
      if (occupant && occupant.driver.id !== profile.id) {
        let dispute = await tx.findOne(VehicleDispute, {
          truck: truck.id,
          driver: profile.id,
          kind: 'occupancy',
          resolvedAt: null,
        });
        if (!dispute) {
          dispute = tx.create(VehicleDispute, {
            truck,
            driver: profile,
            activeSession: occupant,
          });
          await tx.persist(dispute).flush();
        }
        // Return before throwing: the flag must commit even though driving is denied.
        return { disputeId: dispute.id };
      }

      if (
        (await tx.count(VehicleDispute, {
          truck: truck.id,
          kind: 'occupancy',
          resolvedAt: null,
        })) > 0
      ) {
        throw new ConflictError(
          'This vehicle is flagged for administrator review. Choose another vehicle.',
        );
      }

      const own = await tx.findOne(DrivingSession, {
        driver: profile.id,
        endedAt: null,
      });
      if ((own?.id ?? null) !== input.expectedOwnSessionId) {
        throw new ConflictError(
          'Your driving session changed. Refresh and choose again.',
        );
      }
      if (
        own?.truck.id === truck.id &&
        own.kratosSessionId === context.session.id &&
        own.confirmedDate === todayDate &&
        (own.schedule?.id ?? null) === (schedule?.id ?? null)
      ) {
        return { started: true as const };
      }

      const startedAt = own
        ? await this.closeSession(
            tx,
            own,
            context.user.id,
            own.truck.id === truck.id ? 'daily_confirmation' : 'vehicle_changed',
            {
              endOdometerKm: input.previousEndOdometerKm,
              endOdometerMissingPhotoReason:
                input.previousEndOdometerMissingPhotoReason,
              endOdometerLowerReason: input.previousEndOdometerLowerReason,
              hasEndPhoto: input.hasPreviousEndPhoto,
            },
          )
        : await dbClockTimestamp(tx);

      const startFlags = evaluateShiftMileageFlags({
        startOdometerKm: input.startOdometerKm,
        hasStartPhoto: input.hasStartPhoto,
        ended: false,
        endOdometerKm: null,
        hasEndPhoto: false,
        truckLastOdometerKm: truck.odometerKm,
      });

      if (
        input.startOdometerKm != null &&
        Math.round(Number(input.startOdometerKm)) > truck.odometerKm
      ) {
        truck.odometerKm = Math.round(Number(input.startOdometerKm));
      }

      tx.persist(
        tx.create(DrivingSession, {
          id: input.id,
          driver: profile,
          truck,
          kratosSessionId: context.session.id,
          startedAt,
          confirmedDate: todayDate,
          schedule: schedule ?? null,
          startOdometerKm: input.startOdometerKm,
          startOdometerAt: input.startOdometerKm != null ? startedAt : null,
          startOdometerMissingPhotoReason:
            input.startOdometerMissingPhotoReason,
          mileageFlags: startFlags,
        }),
      );
      await tx.flush();
      return { started: true as const };
    });

    this.events.changed();
    if ('disputeId' in result) {
      throw new ConflictError({
        message: 'Vehicle in use. Flagged for administrator review.',
        disputeId: result.disputeId,
      });
    }
    return this.context(context);
  }

  private async closeSession(
    tx: EntityManager,
    session: DrivingSession,
    userId: string,
    reason: string,
    endMileage?: {
      endOdometerKm?: string | null;
      endOdometerMissingPhotoReason?: string | null;
      endOdometerLowerReason?: string | null;
      hasEndPhoto?: boolean;
    },
  ): Promise<Date> {
    const at = await dbClockTimestamp(tx);
    const endKm = endMileage?.endOdometerKm ?? null;
    if (
      endKm != null &&
      session.startOdometerKm != null &&
      Number(endKm) < Number(session.startOdometerKm) &&
      !endMileage?.endOdometerLowerReason
    ) {
      throw new BadRequestError(
        'End odometer reading is lower than the start reading. Enter a reason.',
      );
    }

    const existingPhotos = await tx.find(TransportAttachment, {
      drivingSession: session.id,
    });
    const hasStartPhoto =
      existingPhotos.some((p) => p.kind === 'start_odometer_photo') ||
      (session.startOdometerKm != null &&
        !session.mileageFlags.includes('missing_start_photo'));
    const hasEndPhoto =
      Boolean(endMileage?.hasEndPhoto) ||
      existingPhotos.some((p) => p.kind === 'end_odometer_photo');

    const flags = evaluateShiftMileageFlags({
      startOdometerKm: session.startOdometerKm,
      hasStartPhoto,
      ended: true,
      endOdometerKm: endKm,
      hasEndPhoto,
    });

    if (endKm != null) {
      const truck = await tx.findOne(Truck, { id: session.truck.id });
      if (truck && Math.round(Number(endKm)) > truck.odometerKm) {
        truck.odometerKm = Math.round(Number(endKm));
      }
    }

    await tx.nativeUpdate(
      DrivingSession,
      { id: session.id, endedAt: null },
      {
        endedAt: at,
        endedBy: userId,
        endReason: reason,
        endOdometerKm: endKm,
        endOdometerAt: endKm != null ? at : null,
        endOdometerMissingPhotoReason:
          endMileage?.endOdometerMissingPhotoReason ?? null,
        endOdometerLowerReason: endMileage?.endOdometerLowerReason ?? null,
        mileageFlags: flags,
      },
    );
    await tx.nativeUpdate(
      TrackingStream,
      { drivingSession: session.id, endedAt: null },
      { endedAt: at },
    );
    return at;
  }

  async end(context: AdminContext, raw: unknown) {
    const input = parseDrivingEndInput(raw);
    await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const profile = await this.driver(context, tx);
      const session = await tx.findOne(DrivingSession, {
        id: input.sessionId,
        driver: profile.id,
      });
      if (!session) {
        throw new ForbiddenError(
          'You can only finish your own driving session.',
        );
      }
      if (!session.endedAt) {
        await this.closeSession(tx, session, context.user.id, 'driver_released', {
          endOdometerKm: input.endOdometerKm,
          endOdometerMissingPhotoReason: input.endOdometerMissingPhotoReason,
          endOdometerLowerReason: input.endOdometerLowerReason,
          hasEndPhoto: input.hasEndPhoto,
        });
      }
    });
    this.events.changed();
    return this.context(context);
  }

  async endForLogout(context: AdminContext) {
    await getEm(this.orm).transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const sessions = await tx.find(
        DrivingSession,
        { kratosSessionId: context.session.id, endedAt: null },
        { populate: ['driver'] },
      );
      for (const session of sessions) {
        if (session.driver.user.id === context.user.id) {
          await this.closeSession(tx, session, context.user.id, 'signed_out');
        }
      }
    });
  }

  async disputes(context: AdminContext, own = false) {
    const em = getEm(this.orm);
    const profile = own ? await this.driver(context, em) : null;
    if (!own) this.requireAdmin(context);

    const rows = await em.find(
      VehicleDispute,
      { ...(profile ? { driver: profile.id } : {}), resolvedAt: null },
      {
        populate: [
          'truck',
          'requestedTruck',
          'driver.user',
          'activeSession.driver.user',
        ],
        orderBy: { createdAt: 'desc' },
        limit: 100,
      },
    );

    if (!rows.length) return { items: [] };

    const todayDate = operationalToday();
    const truckIds = new Set<string>();
    const scheduleDates = new Set<string>();
    const driverIds = new Set<string>();
    for (const dispute of rows) {
      truckIds.add(dispute.truck.id);
      if (dispute.requestedTruck) truckIds.add(dispute.requestedTruck.id);
      if (dispute.kind === 'schedule' && dispute.scheduleDate) {
        scheduleDates.add(dispute.scheduleDate);
        driverIds.add(dispute.driver.id);
      }
      if (dispute.requestedTruck) {
        scheduleDates.add(dispute.scheduleDate ?? todayDate);
      }
    }

    // Batch-load active driving sessions and matching schedules (2 queries instead of 5*N).
    const [activeSessions, schedules] = await Promise.all([
      em.find(
        DrivingSession,
        { truck: { $in: [...truckIds] }, endedAt: null },
        { populate: ['driver.user'] },
      ),
      scheduleDates.size
        ? em.find(
            DriverSchedule,
            {
              date: { $in: [...scheduleDates] },
              cancelledAt: null,
              $or: [
                ...(driverIds.size
                  ? [{ driver: { $in: [...driverIds] } }]
                  : []),
                { truck: { $in: [...truckIds] } },
              ],
            },
            { populate: ['driver.user'] },
          )
        : Promise.resolve([]),
    ]);

    const activeByTruck = new Map(
      activeSessions.map((session) => [session.truck.id, session]),
    );
    const scheduleByDriverDate = new Map(
      schedules.map((s) => [`${s.driver.id}:${s.date}`, s]),
    );
    const scheduleByTruckDate = new Map(
      schedules.map((s) => [`${s.truck.id}:${s.date}`, s]),
    );

    return {
      items: rows.map((dispute) => {
        const requestedTruck = dispute.requestedTruck;
        const scheduleDate = dispute.scheduleDate;
        const driverSchedule =
          dispute.kind === 'schedule' && scheduleDate
            ? (scheduleByDriverDate.get(`${dispute.driver.id}:${scheduleDate}`) ??
              null)
            : null;
        const requestedSchedule = requestedTruck
          ? (scheduleByTruckDate.get(
              `${requestedTruck.id}:${scheduleDate ?? todayDate}`,
            ) ?? null)
          : null;

        return {
          id: dispute.id,
          kind: dispute.kind,
          scheduleDate,
          driverNote: dispute.driverNote,
          requestedTruck: requestedTruck ? this.vehicle(requestedTruck) : null,
          schedule: driverSchedule
            ? {
                id: driverSchedule.id,
                driverId: driverSchedule.driver.id,
                truckId: driverSchedule.truck.id,
                date: driverSchedule.date,
                createdById: driverSchedule.createdBy.id,
                createdAt: driverSchedule.createdAt,
                cancelledAt: driverSchedule.cancelledAt,
                cancelledById: driverSchedule.cancelledBy?.id ?? null,
                note: driverSchedule.note,
              }
            : null,
          requestedScheduleId: requestedSchedule?.id ?? null,
          requestedScheduledDriver: requestedSchedule
            ? userFullName(requestedSchedule.driver.user)
            : null,
          requestedTruckSession:
            requestedTruck && scheduleDate === todayDate
              ? this.occupant(activeByTruck.get(requestedTruck.id) ?? null)
              : null,
          truck: this.vehicle(dispute.truck),
          requestedBy: userFullName(dispute.driver.user),
          currentDriver: this.occupant(activeByTruck.get(dispute.truck.id) ?? null),
          createdAt: dispute.createdAt,
        };
      }),
    };
  }

  async resolve(context: AdminContext, id: string, raw: unknown) {
    this.requireAdmin(context);
    const validId = drivingId(id);
    const em = getEm(this.orm);
    const flag = await em.findOne(VehicleDispute, { id: validId });
    if (flag?.kind === 'schedule') {
      return this.scheduling.resolve(context, validId, raw);
    }

    const input = parseDisputeResolution(raw);
    const result = await em.transactional(async (tx) => {
      await acquireAdvisoryLock(tx, 'fleet-assets-v1');
      const dispute = await tx.findOne(VehicleDispute, { id: validId });
      if (!dispute) throw new NotFoundError('Vehicle flag not found.');
      if (dispute.resolvedAt) {
        throw new ConflictError(
          'This flag has already been resolved. Refresh the list.',
        );
      }
      const current = await this.activeSession(dispute.truck.id, tx);
      if ((current?.id ?? null) !== input.expectedActiveSessionId) {
        throw new ConflictError('The vehicle session changed. Review it again.');
      }
      if (input.resolution === 'keep_current' && !current) {
        throw new ConflictError(
          'No driver is active. Resolve and release this vehicle instead.',
        );
      }
      if (input.resolution === 'release_vehicle' && current) {
        await this.closeSession(tx, current, context.user.id, 'admin_resolved');
      }
      // All flags on the same vehicle are resolved together, with a shared audit note.
      await tx.nativeUpdate(
        VehicleDispute,
        { truck: dispute.truck.id, kind: 'occupancy', resolvedAt: null },
        {
          resolvedAt: new Date(),
          resolvedBy: context.user.id,
          resolution: input.resolution,
          note: input.note,
        },
      );
      return { ok: true };
    });
    this.events.changed();
    return result;
  }

  async shifts(
    context: AdminContext,
    query: Record<string, string | undefined> = {},
  ) {
    if (!context.permissions.includes('shifts.read')) {
      throw new ForbiddenError('Shifts and mileage access is required.');
    }
    const filter = parseShiftFilter(query);
    const em = getEm(this.orm);
    const where: FilterQuery<DrivingSession> = {};
    if (filter.truckId) where.truck = filter.truckId;
    if (filter.driverId) where.driver = filter.driverId;
    if (filter.from && filter.to) {
      where.confirmedDate = { $gte: filter.from, $lte: filter.to };
    } else if (filter.from) {
      where.confirmedDate = { $gte: filter.from };
    } else if (filter.to) {
      where.confirmedDate = { $lte: filter.to };
    }

    const sessions = await em.find(DrivingSession, where, {
      populate: ['truck', 'driver.user', 'mileageReviewedBy'],
      orderBy: { startedAt: 'desc' },
      limit: 200,
    });

    const filtered = filter.flaggedOnly
      ? sessions.filter((s) => s.mileageFlags.length > 0 && !s.mileageReviewedAt)
      : sessions;

    const sessionIds = filtered.map((s) => s.id);
    const attachments = sessionIds.length
      ? await em.find(TransportAttachment, {
          drivingSession: { $in: sessionIds },
        })
      : [];

    const photosBySession = new Map<
      string,
      Array<{ id: string; kind: string; mimeType: string; createdAt: Date }>
    >();
    for (const attachment of attachments) {
      const sid = attachment.drivingSession?.id;
      if (!sid) continue;
      const list = photosBySession.get(sid) ?? [];
      list.push({
        id: attachment.id,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        createdAt: attachment.createdAt,
      });
      photosBySession.set(sid, list);
    }

    return {
      items: filtered.map((session) => {
        const photos = photosBySession.get(session.id) ?? [];
        const startPhoto =
          photos.find((p) => p.kind === 'start_odometer_photo') ?? null;
        const endPhoto =
          photos.find((p) => p.kind === 'end_odometer_photo') ?? null;
        return {
          id: session.id,
          confirmedDate: session.confirmedDate,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          endReason: session.endReason,
          truck: this.vehicle(session.truck),
          driver: {
            id: session.driver.id,
            identifier: session.driver.identifier,
            name: userFullName(session.driver.user),
          },
          startOdometerKm: session.startOdometerKm,
          startOdometerAt: session.startOdometerAt,
          startOdometerMissingPhotoReason:
            session.startOdometerMissingPhotoReason,
          endOdometerKm: session.endOdometerKm,
          endOdometerAt: session.endOdometerAt,
          endOdometerMissingPhotoReason: session.endOdometerMissingPhotoReason,
          endOdometerLowerReason: session.endOdometerLowerReason,
          distanceKm: computeShiftDistanceKm(
            session.startOdometerKm,
            session.endOdometerKm,
          ),
          mileageFlags: session.mileageFlags,
          mileageReviewedAt: session.mileageReviewedAt,
          mileageReviewedByName: session.mileageReviewedBy
            ? userFullName(session.mileageReviewedBy)
            : null,
          mileageReviewNote: session.mileageReviewNote,
          startPhoto,
          endPhoto,
        };
      }),
    };
  }

  async reviewShift(context: AdminContext, sessionId: string, raw: unknown) {
    if (
      !context.permissions.includes('shifts.read') ||
      !context.permissions.includes('activities.review')
    ) {
      throw new ForbiddenError('Shift review access is required.');
    }
    const validId = drivingId(sessionId);
    const input = parseShiftReview(raw);

    const updated = await getEm(this.orm).transactional(async (tx) => {
      const session = await tx.findOne(
        DrivingSession,
        { id: validId },
        { populate: ['truck', 'driver.user'] },
      );
      if (!session) throw new NotFoundError('Driving shift not found.');

      const before = {
        startOdometerKm: session.startOdometerKm,
        endOdometerKm: session.endOdometerKm,
        mileageFlags: [...session.mileageFlags],
        mileageReviewedAt: session.mileageReviewedAt,
        mileageReviewNote: session.mileageReviewNote,
      };

      if (input.startOdometerKm !== undefined) {
        session.startOdometerKm = input.startOdometerKm;
        session.startOdometerAt ??= session.startedAt;
      }
      if (input.endOdometerKm !== undefined) {
        session.endOdometerKm = input.endOdometerKm;
        if (session.endedAt) session.endOdometerAt ??= session.endedAt;
      }

      const attachments = await tx.find(TransportAttachment, {
        drivingSession: session.id,
      });
      let flags = evaluateShiftMileageFlags({
        startOdometerKm: session.startOdometerKm,
        hasStartPhoto:
          input.clearMissingPhotoFlags ||
          attachments.some((a) => a.kind === 'start_odometer_photo'),
        ended: Boolean(session.endedAt),
        endOdometerKm: session.endOdometerKm,
        hasEndPhoto:
          input.clearMissingPhotoFlags ||
          attachments.some((a) => a.kind === 'end_odometer_photo'),
      });
      if (input.clearMissingPhotoFlags) {
        flags = flags.filter(
          (f) => f !== 'missing_start_photo' && f !== 'missing_end_photo',
        );
      }

      session.mileageFlags = flags;
      session.mileageReviewedAt = new Date();
      session.mileageReviewedBy = tx.getReference(User, context.user.id);
      session.mileageReviewNote = input.reason;

      const maxKm = Math.max(
        session.truck.odometerKm,
        session.startOdometerKm ? Math.round(Number(session.startOdometerKm)) : 0,
        session.endOdometerKm ? Math.round(Number(session.endOdometerKm)) : 0,
      );
      if (maxKm > session.truck.odometerKm) {
        session.truck.odometerKm = maxKm;
      }

      tx.persist(
        tx.create(TransportAudit, {
          recordId: session.id,
          entityType: 'driving_session',
          actor: context.user.id,
          action: 'shift_mileage_review',
          reason: input.reason,
          before,
          after: {
            startOdometerKm: session.startOdometerKm,
            endOdometerKm: session.endOdometerKm,
            mileageFlags: [...session.mileageFlags],
            mileageReviewNote: session.mileageReviewNote,
          },
        }),
      );
      await tx.flush();
      return session;
    });

    this.events.changed();
    return {
      id: updated.id,
      startOdometerKm: updated.startOdometerKm,
      endOdometerKm: updated.endOdometerKm,
      distanceKm: computeShiftDistanceKm(
        updated.startOdometerKm,
        updated.endOdometerKm,
      ),
      mileageFlags: updated.mileageFlags,
      mileageReviewedAt: updated.mileageReviewedAt,
      mileageReviewNote: updated.mileageReviewNote,
    };
  }
}
