import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import type { AdminContext } from '../auth/auth.service.js';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { DrivingSession, VehicleDispute } from '../mobile/driving.entity.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import { DriverSchedule } from './schedule.entity.js';
import {
  date,
  note,
  object,
  parseMismatch,
  parseSchedule,
  today,
} from './schedule.input.js';
import { drivingId } from '../mobile/driving.input.js';

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(OperationsEventsService)
    private readonly events: OperationsEventsService,
  ) {}
  private require(c: AdminContext) {
    this.events.require(c);
    if (
      !c.permissions.includes('drivers.read') ||
      !c.permissions.includes('drivers.write')
    )
      throw new ForbiddenException('Driver scheduling access is required.');
  }
  current(driverId: string, m = this.db.manager) {
    return m.findOneBy(DriverSchedule, {
      driverId,
      date: today(),
      cancelledAt: IsNull(),
    });
  }
  pending(driverId: string, m = this.db.manager) {
    return m.findOneBy(VehicleDispute, {
      driverId,
      kind: 'schedule',
      scheduleDate: today(),
      resolvedAt: IsNull(),
    });
  }
  async options(c: AdminContext, q = '') {
    this.require(c);
    const search = '%' + q.slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';
    return {
      drivers: await this.db.query(
        `SELECT p.id,p.identifier,concat(u."firstName",' ',u."lastName") AS name FROM app.driver_profiles p JOIN app.users u ON u.id=p."userId" WHERE p.status='active' AND u."isActive" AND (p.identifier ILIKE $1 OR u."firstName" ILIKE $1 OR u."lastName" ILIKE $1) ORDER BY p.identifier LIMIT 20`,
        [search],
      ),
      trucks: await this.db.query(
        `SELECT id,identifier,registration,make,model FROM app.trucks WHERE status='active' AND (identifier ILIKE $1 OR registration ILIKE $1) ORDER BY registration LIMIT 20`,
        [search],
      ),
    };
  }
  async list(c: AdminContext, from?: string, to?: string) {
    this.require(c);
    const start = date(from ?? today()),
      end = date(to ?? start);
    if (end < start || (Date.parse(end) - Date.parse(start)) / 86400000 > 92)
      throw new BadRequestException('Choose a range of up to 93 days.');
    return {
      items: await this.db.query(
        `SELECT s.*, to_char(s.date,'YYYY-MM-DD') AS date, t.registration, t.identifier AS "truckIdentifier", concat(u."firstName",' ',u."lastName") AS "driverName"
      FROM app.driver_schedules s JOIN app.trucks t ON t.id=s."truckId" JOIN app.driver_profiles p ON p.id=s."driverId" JOIN app.users u ON u.id=p."userId"
      WHERE s."cancelledAt" IS NULL AND s.date BETWEEN $1 AND $2 ORDER BY s.date,t.registration`,
        [start, end],
      ),
    };
  }
  async save(c: AdminContext, raw: unknown) {
    this.require(c);
    const v = parseSchedule(raw);
    const result = await this.db.transaction(async (m) => {
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const p = await m.findOne(DriverProfile, {
        where: { id: v.driverId, status: 'active' },
        relations: { user: true },
      });
      if (
        !p?.user.isActive ||
        !(await m.existsBy(Truck, { id: v.truckId, status: 'active' }))
      )
        throw new BadRequestException('Choose an active driver and vehicle.');
      const conflicts = await m
        .getRepository(DriverSchedule)
        .createQueryBuilder('s')
        .where(
          's."cancelledAt" IS NULL AND s.date IN (:...dates) AND (s."driverId"=:driver OR s."truckId"=:truck)',
          { dates: v.dates, driver: v.driverId, truck: v.truckId },
        )
        .getMany();
      const changed = conflicts.filter(
        (s) => s.driverId !== v.driverId || s.truckId !== v.truckId,
      );
      if (changed.length && !v.override)
        throw new ConflictException({
          message: 'Review the conflicting dates before overriding.',
          conflicts: await Promise.all(
            changed.map(async (s) => {
              const driver = await m.findOneOrFail(DriverProfile, {
                where: { id: s.driverId },
                relations: { user: true },
              });
              const truck = await m.findOneByOrFail(Truck, { id: s.truckId });
              return {
                id: s.id,
                date: s.date,
                driverId: s.driverId,
                truckId: s.truckId,
                driverName: `${driver.user.firstName} ${driver.user.lastName}`,
                registration: truck.registration,
              };
            }),
          ),
        });
      if (
        v.override &&
        JSON.stringify(changed.map((s) => s.id).sort()) !==
          JSON.stringify(v.expectedConflicts)
      )
        throw new ConflictException(
          'The schedule changed. Review the conflicts again.',
        );
      if (changed.length)
        await m.update(
          DriverSchedule,
          { id: In(changed.map((s) => s.id)) },
          { cancelledAt: new Date(), cancelledById: c.user.id },
        );
      const identical = new Set(
        conflicts
          .filter((s) => s.driverId === v.driverId && s.truckId === v.truckId)
          .map((s) => s.date),
      );
      for (const d of v.dates)
        if (!identical.has(d))
          await m.save(
            DriverSchedule,
            m.create(DriverSchedule, {
              driverId: v.driverId,
              truckId: v.truckId,
              date: d,
              createdById: c.user.id,
              note: v.note,
            }),
          );
      if (v.dates.includes(today()) && !identical.has(today()))
        await this.closeDriver(m, v.driverId, c.user.id, 'schedule_changed');
      // A changed plan ends the displaced driver's capture now; it never transfers an active vehicle.
      for (const s of changed.filter((s) => s.date === today()))
        await this.closeDriver(m, s.driverId, c.user.id, 'schedule_changed');
      return {
        ok: true,
        created: v.dates.length - identical.size,
        overridden: changed.length,
      };
    });
    this.events.changed();
    return result;
  }
  async cancel(c: AdminContext, id: string, raw: unknown) {
    this.require(c);
    const v = object(raw, ['note']),
      reason = note(v.note);
    await this.db.transaction(async (m) => {
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const s = await m.findOneBy(DriverSchedule, {
        id: drivingId(id),
        cancelledAt: IsNull(),
      });
      if (!s) throw new ConflictException('The schedule changed. Refresh it.');
      await m.update(
        DriverSchedule,
        { id: s.id },
        {
          cancelledAt: new Date(),
          cancelledById: c.user.id,
          note: `${s.note}\nCancelled: ${reason}`.trim(),
        },
      );
      if (s.date === today())
        await this.closeDriver(m, s.driverId, c.user.id, 'schedule_changed');
    });
    this.events.changed();
    return { ok: true };
  }
  async closeDriver(
    m: EntityManager,
    driverId: string,
    actor: string,
    reason: string,
  ) {
    const at = (await m.query('SELECT clock_timestamp() AS at'))[0].at;
    const drives = await m.findBy(DrivingSession, {
      driverId,
      endedAt: IsNull(),
    });
    for (const s of drives) {
      await m.update(
        DrivingSession,
        { id: s.id },
        { endedAt: at, endedById: actor, endReason: reason },
      );
      await m.query(
        'UPDATE app.tracking_streams SET "endedAt"=$2 WHERE "drivingSessionId"=$1 AND "endedAt" IS NULL',
        [s.id, at],
      );
    }
  }
  async mismatch(c: AdminContext, raw: unknown) {
    const v = parseMismatch(raw);
    const result = await this.db.transaction(async (m) => {
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      if (!c.permissions.includes('driver.access'))
        throw new ForbiddenException();
      const p = await m.findOneBy(DriverProfile, {
        userId: c.user.id,
        status: 'active',
      });
      if (!p) throw new ForbiddenException();
      const s = await this.current(p.id, m);
      if (!s || s.id !== v.expectedScheduleId)
        throw new ConflictException(
          'Your schedule changed. Refresh before reporting a mismatch.',
        );
      if (v.requestedTruckId === s.truckId)
        throw new BadRequestException(
          'Choose a different vehicle or leave it blank.',
        );
      if (
        v.requestedTruckId &&
        !(await m.existsBy(Truck, { id: v.requestedTruckId, status: 'active' }))
      )
        throw new NotFoundException('Choose an active vehicle.');
      const existing = await this.pending(p.id, m);
      if (existing) return existing;
      await this.closeDriver(m, p.id, c.user.id, 'schedule_dispute');
      return m.save(
        VehicleDispute,
        m.create(VehicleDispute, {
          kind: 'schedule',
          truckId: s.truckId,
          driverId: p.id,
          activeSessionId: null,
          scheduleId: s.id,
          scheduleDate: s.date,
          requestedTruckId: v.requestedTruckId,
          driverNote: v.note,
        }),
      );
    });
    this.events.changed();
    return result;
  }
  async resolve(c: AdminContext, id: string, raw: unknown) {
    this.require(c);
    const v = object(raw, [
      'resolution',
      'note',
      'expectedScheduleId',
      'expectedActiveSessionId',
      'expectedRequestedScheduleId',
    ]);
    if (!['keep_schedule', 'change_schedule'].includes(String(v.resolution)))
      throw new BadRequestException('Choose a schedule resolution.');
    const requestedExpected =
      v.expectedRequestedScheduleId === null
        ? null
        : drivingId(v.expectedRequestedScheduleId);
    const reason = note(v.note),
      expected =
        v.expectedScheduleId === null ? null : drivingId(v.expectedScheduleId);
    const activeExpected =
      v.expectedActiveSessionId === null
        ? null
        : drivingId(v.expectedActiveSessionId);
    await this.db.transaction(async (m) => {
      await m.query(
        "SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))",
      );
      const d = await m.findOneBy(VehicleDispute, {
        id: drivingId(id),
        kind: 'schedule',
        resolvedAt: IsNull(),
      });
      if (!d)
        throw new ConflictException(
          'This item has already been resolved. Refresh the list.',
        );
      const current = await m.findOneBy(DriverSchedule, {
        driverId: d.driverId,
        date: d.scheduleDate!,
        cancelledAt: IsNull(),
      });
      if ((current?.id ?? null) !== expected)
        throw new ConflictException('The schedule changed. Review it again.');
      if (v.resolution === 'change_schedule') {
        if (!d.requestedTruckId)
          throw new BadRequestException(
            'Update the schedule first, then keep the updated schedule.',
          );
        if (
          !(await m.existsBy(Truck, {
            id: d.requestedTruckId,
            status: 'active',
          }))
        )
          throw new ConflictException('The requested vehicle is unavailable.');
        const active =
          d.scheduleDate === today()
            ? await m.findOneBy(DrivingSession, {
                truckId: d.requestedTruckId,
                endedAt: IsNull(),
              })
            : null;
        if ((active?.id ?? null) !== activeExpected)
          throw new ConflictException(
            'The vehicle session changed. Review it again.',
          );
        if (active && active.driverId !== d.driverId)
          throw new ConflictException(
            'Resolve the active vehicle handover before changing the schedule.',
          );
        if (
          await m.existsBy(VehicleDispute, {
            truckId: d.requestedTruckId,
            kind: 'occupancy',
            resolvedAt: IsNull(),
          })
        )
          throw new ConflictException('Resolve the vehicle flag first.');
        const displaced = await m.findBy(DriverSchedule, {
          truckId: d.requestedTruckId,
          date: d.scheduleDate!,
          cancelledAt: IsNull(),
        });
        if ((displaced[0]?.id ?? null) !== requestedExpected)
          throw new ConflictException(
            'The requested vehicle schedule changed. Review it again.',
          );
        for (const s of [...displaced, ...(current ? [current] : [])]) {
          await m.update(
            DriverSchedule,
            { id: s.id },
            { cancelledAt: new Date(), cancelledById: c.user.id },
          );
          if (s.date === today())
            await this.closeDriver(
              m,
              s.driverId,
              c.user.id,
              'schedule_changed',
            );
        }
        await m.save(
          DriverSchedule,
          m.create(DriverSchedule, {
            driverId: d.driverId,
            truckId: d.requestedTruckId,
            date: d.scheduleDate!,
            createdById: c.user.id,
            note: reason,
          }),
        );
      }
      if (!current && v.resolution === 'keep_schedule')
        throw new ConflictException(
          'Create a replacement schedule before resolving this item.',
        );
      await m.update(
        VehicleDispute,
        { id: d.id },
        {
          resolvedAt: new Date(),
          resolvedById: c.user.id,
          resolution: String(v.resolution),
          note: reason,
        },
      );
    });
    this.events.changed();
    return { ok: true };
  }
}
