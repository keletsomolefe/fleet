import { SchedulingService } from '../scheduling/scheduling.service.js';
import { today } from '../scheduling/schedule.input.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import { DriverSchedule } from '../scheduling/schedule.entity.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { AdminContext } from '../auth/auth.service.js';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { parseSearch, validateAssignment } from '../fleet/fleet.input.js';
import { TrackingStream } from '../telemetry/telemetry.entity.js';
import { DrivingSession, VehicleDispute } from './driving.entity.js';
import {
  drivingId,
  parseDisputeResolution,
  parseDrivingEnd,
  parseDrivingStart,
} from './driving.input.js';

@Injectable()
export class DrivingService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
  ) {}
  private lock(m: EntityManager) {
    return m.query("SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))");
  }
  private async driver(c: AdminContext, m = this.db.manager) {
    if (!c.permissions.includes('driver.access'))
      throw new ForbiddenException('Driver access is not enabled.');
    const p = await m.findOne(DriverProfile, {
      where: { userId: c.user.id, status: 'active' },
      relations: { user: true },
    });
    if (!p || !p.user.isActive)
      throw new ForbiddenException(
        'Driver access is not active. Contact your fleet administrator.',
      );
    return p;
  }
  requireAdmin(c: AdminContext) {
    if (
      !['admin.access', 'trucks.read', 'trucks.write'].every((p) =>
        c.permissions.includes(p),
      )
    )
      throw new ForbiddenException('Vehicle management access is required.');
  }
  private vehicle(t: Truck) {
    return {
      id: t.id,
      identifier: t.identifier,
      registration: t.registration,
      make: t.make,
      model: t.model,
      status: t.status,
    };
  }
  private async active(truckId: string, m = this.db.manager) {
    return m.findOne(DrivingSession, {
      where: { truckId, endedAt: IsNull() },
      relations: { driver: { user: true } },
    });
  }
  private occupant(s: DrivingSession | null) {
    return s
      ? {
          id: s.id,
          driverId: s.driverId,
          driverName: `${s.driver.user.firstName} ${s.driver.user.lastName}`,
          startedAt: s.startedAt,
        }
      : null;
  }
  async context(c: AdminContext, m = this.db.manager) {
    const p = await this.driver(c, m);
    const s = await m.findOne(DrivingSession, {
      where: { driverId: p.id, endedAt: IsNull() },
      relations: { truck: true },
    });
    const schedule = await this.scheduling.current(p.id, m),
      pending = await this.scheduling.pending(p.id, m);
    const scheduledTruck = schedule
      ? await m.findOneBy(Truck, { id: schedule.truckId })
      : null;
    let reason: string | null = pending
      ? 'Your schedule mismatch is awaiting administrator review.'
      : null;
    try {
      validateAssignment(p);
    } catch (e) {
      reason =
        e instanceof BadRequestException
          ? e.message
          : 'Your licence details need review.';
    }
    if (s && s.truck.status !== 'active')
      reason =
        'This vehicle is unavailable. Finish driving and contact your administrator.';
    const onThisPhone = !!s && s.kratosSessionId === c.session.id;
    const confirmed =
      onThisPhone &&
      s.confirmedDate === today() &&
      (s.scheduleId ?? null) === (schedule?.id ?? null) &&
      (!schedule || schedule.truckId === s.truckId);
    return {
      date: today(),
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
        id: p.id,
        identifier: p.identifier,
        name: `${c.user.firstName} ${c.user.lastName}`,
      },
      truck: s
        ? {
            ...this.vehicle(s.truck),
            disputed: await m.existsBy(VehicleDispute, {
              truckId: s.truckId,
              kind: 'occupancy',
              resolvedAt: IsNull(),
            }),
          }
        : null,
      drivingSession: s
        ? { id: s.id, startedAt: s.startedAt, onThisPhone }
        : null,
      canDrive: !reason,
      reason,
      confirmedAt: confirmed && !reason ? s!.startedAt : null,
    };
  }
  async vehicles(c: AdminContext, q?: string, page?: string) {
    await this.driver(c);
    const search = parseSearch(q, page);
    const b = this.db
      .getRepository(Truck)
      .createQueryBuilder('t')
      .where("t.status='active'")
      .orderBy('t.registration', 'ASC');
    if (search.q)
      b.andWhere(
        '(t.identifier ILIKE :q OR t.registration ILIKE :q OR t.make ILIKE :q OR t.model ILIKE :q)',
        { q: `%${search.q.replace(/[\\%_]/g, '\\$&')}%` },
      );
    const [trucks, total] = await b
      .skip((search.page - 1) * 20)
      .take(20)
      .getManyAndCount();
    const items = await Promise.all(
      trucks.map(async (t) => ({
        ...this.vehicle(t),
        activeSession: this.occupant(await this.active(t.id)),
        scheduled: await this.db.manager.existsBy(DriverSchedule, {
          truckId: t.id,
          date: today(),
          cancelledAt: IsNull(),
        }),
        disputed: await this.db
          .getRepository(VehicleDispute)
          .existsBy({ truckId: t.id, kind: 'occupancy', resolvedAt: IsNull() }),
      })),
    );
    return { items, total, page: search.page, pageSize: 20 };
  }
  async flag(c: AdminContext, truckId: string, raw: unknown) {
    const expected = parseDrivingEnd(raw);
    const result = await this.db.transaction(async (m) => {
      await this.lock(m);
      const p = await this.driver(c, m),
        active = await this.active(drivingId(truckId), m);
      if (!active)
        throw new ConflictException(
          'The vehicle is now available. Refresh the vehicle list.',
        );
      if (active.id !== expected)
        throw new ConflictException(
          'The vehicle session changed. Refresh the list before flagging it.',
        );
      const existing = await m.findOneBy(VehicleDispute, {
        truckId,
        driverId: p.id,
        kind: 'occupancy',
        resolvedAt: IsNull(),
      });
      return (
        existing ??
        m.save(
          VehicleDispute,
          m.create(VehicleDispute, {
            truckId,
            driverId: p.id,
            activeSessionId: active.id,
          }),
        )
      );
    });
    this.events.changed();
    return result;
  }
  async start(c: AdminContext, raw: unknown) {
    const input = parseDrivingStart(raw);
    const result = await this.db.transaction(async (m) => {
      await this.lock(m);
      const p = await this.driver(c, m);
      validateAssignment(p);
      const schedule = await this.scheduling.current(p.id, m);
      if (await this.scheduling.pending(p.id, m))
        throw new ConflictException(
          'Your schedule mismatch is awaiting administrator review.',
        );
      if ((schedule?.id ?? null) !== input.expectedScheduleId)
        throw new ConflictException(
          'Your schedule changed. Refresh and confirm the scheduled vehicle.',
        );
      if (schedule && schedule.truckId !== input.truckId)
        throw new ConflictException(
          'Report a schedule mismatch for administrator review before changing vehicles.',
        );
      const t = await m.findOneBy(Truck, {
        id: input.truckId,
        status: 'active',
      });
      if (!t) throw new NotFoundException('Select an active vehicle.');
      const reserved = await m.findOneBy(DriverSchedule, {
        truckId: t.id,
        date: today(),
        cancelledAt: IsNull(),
      });
      if (reserved && reserved.driverId !== p.id)
        throw new ConflictException(
          'This vehicle is scheduled for another driver. Contact your administrator.',
        );
      const existing = await m.findOneBy(DrivingSession, { id: input.id });
      if (existing) {
        if (
          existing.driverId !== p.id ||
          existing.truckId !== t.id ||
          existing.kratosSessionId !== c.session.id ||
          existing.endedAt
        )
          throw new ConflictException('Refresh the vehicle selection.');
        return { started: true as const };
      }
      const occupant = await this.active(t.id, m);
      if (occupant && occupant.driverId !== p.id) {
        let dispute = await m.findOneBy(VehicleDispute, {
          truckId: t.id,
          driverId: p.id,
          kind: 'occupancy',
          resolvedAt: IsNull(),
        });
        dispute ??= await m.save(
          VehicleDispute,
          m.create(VehicleDispute, {
            truckId: t.id,
            driverId: p.id,
            activeSessionId: occupant.id,
          }),
        );
        // Return before throwing: the flag must commit even though driving is denied.
        return { disputeId: dispute.id };
      }
      if (
        await m.existsBy(VehicleDispute, {
          truckId: t.id,
          kind: 'occupancy',
          resolvedAt: IsNull(),
        })
      )
        throw new ConflictException(
          'This vehicle is flagged for administrator review. Choose another vehicle.',
        );
      const own = await m.findOneBy(DrivingSession, {
        driverId: p.id,
        endedAt: IsNull(),
      });
      if ((own?.id ?? null) !== input.expectedOwnSessionId)
        throw new ConflictException(
          'Your driving session changed. Refresh and choose again.',
        );
      if (
        own?.truckId === t.id &&
        own.kratosSessionId === c.session.id &&
        own.confirmedDate === today() &&
        (own.scheduleId ?? null) === (schedule?.id ?? null)
      )
        return { started: true as const };
      const startedAt: Date = own
        ? await this.close(
            m,
            own,
            c.user.id,
            own.truckId === t.id ? 'daily_confirmation' : 'vehicle_changed',
          )
        : (await m.query('SELECT clock_timestamp() AS at'))[0].at;
      await m.save(
        DrivingSession,
        m.create(DrivingSession, {
          id: input.id,
          driverId: p.id,
          truckId: t.id,
          kratosSessionId: c.session.id,
          startedAt,
          confirmedDate: today(),
          scheduleId: schedule?.id ?? null,
        }),
      );
      return { started: true as const };
    });
    this.events.changed();
    if ('disputeId' in result)
      throw new ConflictException({
        message: 'Vehicle in use. Flagged for administrator review.',
        disputeId: result.disputeId,
      });
    return this.context(c);
  }
  private async close(
    m: EntityManager,
    s: DrivingSession,
    userId: string,
    reason: string,
  ) {
    const at: Date = (await m.query('SELECT clock_timestamp() AS at'))[0].at;
    await m.update(
      DrivingSession,
      { id: s.id, endedAt: IsNull() },
      { endedAt: at, endedById: userId, endReason: reason },
    );
    await m.update(
      TrackingStream,
      { drivingSessionId: s.id, endedAt: IsNull() },
      { endedAt: at },
    );
    return at;
  }
  async end(c: AdminContext, raw: unknown) {
    const id = parseDrivingEnd(raw);
    await this.db.transaction(async (m) => {
      await this.lock(m);
      const p = await this.driver(c, m),
        s = await m.findOneBy(DrivingSession, { id, driverId: p.id });
      if (!s)
        throw new ForbiddenException(
          'You can only finish your own driving session.',
        );
      if (!s.endedAt) await this.close(m, s, c.user.id, 'driver_released');
    });
    this.events.changed();
    return this.context(c);
  }
  async endForLogout(c: AdminContext) {
    await this.db.transaction(async (m) => {
      await this.lock(m);
      const sessions = await m.find(DrivingSession, {
        where: { kratosSessionId: c.session.id, endedAt: IsNull() },
        relations: { driver: true },
      });
      for (const s of sessions)
        if (s.driver.userId === c.user.id)
          await this.close(m, s, c.user.id, 'signed_out');
    });
  }
  async disputes(c: AdminContext, own = false) {
    const p = own ? await this.driver(c) : null;
    if (!own) this.requireAdmin(c);
    const rows = await this.db.getRepository(VehicleDispute).find({
      where: { ...(p ? { driverId: p.id } : {}), resolvedAt: IsNull() },
      relations: {
        truck: true,
        driver: { user: true },
        activeSession: { driver: { user: true } },
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return {
      items: await Promise.all(
        rows.map(async (d) => ({
          id: d.id,
          kind: d.kind,
          scheduleDate: d.scheduleDate,
          driverNote: d.driverNote,
          requestedTruck: d.requestedTruckId
            ? this.vehicle(
                await this.db.manager.findOneByOrFail(Truck, {
                  id: d.requestedTruckId,
                }),
              )
            : null,
          schedule:
            d.kind === 'schedule'
              ? await this.db.manager.findOneBy(DriverSchedule, {
                  driverId: d.driverId,
                  date: d.scheduleDate!,
                  cancelledAt: IsNull(),
                })
              : null,
          requestedScheduleId: d.requestedTruckId
            ? ((
                await this.db.manager.findOneBy(DriverSchedule, {
                  truckId: d.requestedTruckId,
                  date: d.scheduleDate ?? today(),
                  cancelledAt: IsNull(),
                })
              )?.id ?? null)
            : null,
          requestedScheduledDriver: d.requestedTruckId
            ? ((
                await this.db.query(
                  `SELECT concat(u."firstName",' ',u."lastName") AS name FROM app.driver_schedules s JOIN app.driver_profiles p ON p.id=s."driverId" JOIN app.users u ON u.id=p."userId" WHERE s."truckId"=$1 AND s.date=$2 AND s."cancelledAt" IS NULL`,
                  [d.requestedTruckId, d.scheduleDate ?? today()],
                )
              )[0]?.name ?? null)
            : null,
          requestedTruckSession:
            d.requestedTruckId && d.scheduleDate === today()
              ? this.occupant(await this.active(d.requestedTruckId))
              : null,
          truck: this.vehicle(d.truck),
          requestedBy: `${d.driver.user.firstName} ${d.driver.user.lastName}`,
          currentDriver: this.occupant(await this.active(d.truckId)),
          createdAt: d.createdAt,
        })),
      ),
    };
  }
  async resolve(c: AdminContext, id: string, raw: unknown) {
    this.requireAdmin(c);
    const flag = await this.db.manager.findOneBy(VehicleDispute, {
      id: drivingId(id),
    });
    if (flag?.kind === 'schedule') return this.scheduling.resolve(c, id, raw);
    const input = parseDisputeResolution(raw);
    const result = await this.db.transaction(async (m) => {
      await this.lock(m);
      const d = await m.findOneBy(VehicleDispute, { id: drivingId(id) });
      if (!d) throw new NotFoundException('Vehicle flag not found.');
      if (d.resolvedAt)
        throw new ConflictException(
          'This flag has already been resolved. Refresh the list.',
        );
      const current = await this.active(d.truckId, m);
      if ((current?.id ?? null) !== input.expectedActiveSessionId)
        throw new ConflictException(
          'The vehicle session changed. Review it again.',
        );
      if (input.resolution === 'keep_current' && !current)
        throw new ConflictException(
          'No driver is active. Resolve and release this vehicle instead.',
        );
      if (input.resolution === 'release_vehicle' && current)
        await this.close(m, current, c.user.id, 'admin_resolved');
      // All flags on the same vehicle are resolved together, with a shared audit note.
      await m.update(
        VehicleDispute,
        { truckId: d.truckId, kind: 'occupancy', resolvedAt: IsNull() },
        {
          resolvedAt: new Date(),
          resolvedById: c.user.id,
          resolution: input.resolution,
          note: input.note,
        },
      );
      return { ok: true };
    });
    this.events.changed();
    return result;
  }
}
