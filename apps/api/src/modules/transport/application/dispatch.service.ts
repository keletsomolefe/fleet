import { randomInt } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { getEm, pgErrorCode } from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors.js';
import { assertUuid } from '../../../shared/identifiers.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import { DriverSchedule } from '../../scheduling/domain/driver-schedule.entity.js';
import { Dispatch } from '../domain/dispatch.entity.js';
import { scaled } from '../domain/pricing.js';
import { parseDispatchInput, toDispatchDto } from '../http/transport.dto.js';

export class DispatchService {
  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
  ) {}

  async list(context: AdminContext, mobile = false) {
    const em = getEm(this.orm);

    if (mobile) {
      if (!context.permissions.includes('driver.access')) {
        throw new ForbiddenError('Driver access is not enabled.');
      }
      const profile = await em.findOne(DriverProfile, {
        user: context.user.id,
        status: 'active',
      });
      if (!profile) {
        throw new ForbiddenError('Driver access is not active.');
      }
      const dispatches = await em.find(
        Dispatch,
        { driver: profile.id, status: 'dispatched' },
        { orderBy: { date: 'desc', createdAt: 'desc' }, limit: 50 },
      );
      return dispatches.map((d) => toDispatchDto(d));
    }

    if (!context.permissions.includes('dispatch.read')) {
      throw new ForbiddenError('Dispatch access is required.');
    }

    const [dispatches, drivers, trucks, schedules] = await Promise.all([
      em.find(Dispatch, {}, { orderBy: { date: 'desc', createdAt: 'desc' }, limit: 200 }),
      em.find(
        DriverProfile,
        { status: 'active' },
        { populate: ['user'], orderBy: { identifier: 'asc' } },
      ),
      em.find(Truck, { status: 'active' }, { orderBy: { identifier: 'asc' } }),
      em.find(DriverSchedule, { cancelledAt: null }),
    ]);

    const scheduleByDriverDate = new Map(
      schedules.map((s) => [`${s.driver.id}:${s.date}`, s.truck.id]),
    );

    return {
      items: dispatches.map((d) => {
        const scheduledTruckId = scheduleByDriverDate.get(
          `${d.driver.id}:${d.date}`,
        );
        const allocationConflict =
          d.status === 'dispatched' &&
          Boolean(scheduledTruckId) &&
          scheduledTruckId !== d.truck.id;
        return toDispatchDto(d, allocationConflict);
      }),
      drivers: drivers.map((d) => ({
        id: d.id,
        identifier: d.identifier,
        name: userFullName(d.user),
      })),
      trucks: trucks.map((t) => ({
        id: t.id,
        identifier: t.identifier,
        registration: t.registration,
      })),
    };
  }

  async save(context: AdminContext, raw: unknown, rawId?: string) {
    if (!context.permissions.includes('dispatch.write')) {
      throw new ForbiddenError('Dispatch management access is required.');
    }
    const input = parseDispatchInput(raw);
    const id = rawId ? assertUuid(rawId, 'Choose a valid dispatch.') : undefined;

    if (input.plan.deliveries.length > 1) {
      const shares = input.plan.deliveries
        .map((d) => d.collectedQuantity)
        .filter((q): q is string => q != null);
      if (shares.length > 0 && shares.length === input.plan.deliveries.length) {
        const sum = shares.reduce((acc, q) => acc + scaled(q), 0n);
        if (sum !== scaled(input.plan.quantity)) {
          throw new BadRequestError(
            'Delivery collected shares must add up to the planned collection quantity.',
          );
        }
      }
    }

    try {
      const saved = await getEm(this.orm).transactional(async (tx) => {
        const [driver, truck] = await Promise.all([
          tx.findOne(DriverProfile, { id: input.driverId }),
          tx.findOne(Truck, { id: input.truckId }),
        ]);
        if (!driver) throw new BadRequestError('Choose a valid driver.');
        if (!truck) throw new BadRequestError('Choose a valid vehicle.');

        if (id) {
          const existing = await tx.findOne(Dispatch, { id });
          if (!existing) throw new NotFoundError('Dispatch not found.');
          if (input.version !== null && existing.version !== input.version) {
            throw new ConflictError(
              'This dispatch changed. Refresh and try again.',
            );
          }
          if (input.reference) existing.reference = input.reference;
          existing.date = input.date;
          existing.driver = driver;
          existing.truck = truck;
          existing.status = input.status;
          existing.plan = input.plan;
          existing.version += 1;
          await tx.flush();
          return existing;
        }

        const reference =
          input.reference ??
          `DSP-${input.date.replace(/-/g, '').slice(2)}-${String(randomInt(1000, 9999))}`;

        const created = tx.create(Dispatch, {
          reference,
          date: input.date,
          driver,
          truck,
          status: input.status,
          plan: input.plan,
          version: 1,
          createdBy: tx.getReference(User, context.user.id),
        });
        await tx.persist(created).flush();
        return created;
      });

      this.events.changed();
      return toDispatchDto(saved);
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new ConflictError(
          'A dispatch with that reference already exists.',
        );
      }
      throw error;
    }
  }
}
