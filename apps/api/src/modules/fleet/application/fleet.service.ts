import type { EntityManager, FilterQuery, MikroORM } from '@mikro-orm/postgresql';
import {
  acquireAdvisoryLock,
  getEm,
  pgErrorCode,
  rawQuery,
} from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
} from '../../../shared/errors.js';
import { escapeLikePattern } from '../../../shared/validation.js';
import { DrivingSession } from '../../driving/domain/driving-session.entity.js';
import type { AdminUsersService } from '../../identity/application/admin-users.service.js';
import type { RbacService } from '../../identity/application/rbac.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import { DriverTruckAssignment } from '../domain/assignment.entity.js';
import {
  DeviceTruckAssociation,
  TruckDevice,
} from '../domain/device.entity.js';
import { DriverProfile } from '../domain/driver.entity.js';
import {
  assertOdometerNotDecreasing,
  isTruckActive,
  Truck,
  type TruckStatus,
} from '../domain/truck.entity.js';
import {
  parseDriver,
  parseSearch,
  parseTruck,
  toDeviceAssociationDto,
  toDriverAssignmentDto,
  toDriverDto,
  toTruckDeviceDto,
  toTruckDto,
} from '../http/fleet.dto.js';

export class FleetService {
  constructor(
    private readonly orm: MikroORM,
    private readonly users: AdminUsersService,
    private readonly rbac: RbacService,
  ) {}

  private async write<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await getEm(this.orm).transactional(async (tx) => {
        await acquireAdvisoryLock(tx, 'fleet-assets-v1');
        return work(tx);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof HttpError) throw error;
    if (pgErrorCode(error) === '23505') {
      throw new ConflictError(
        'Identifier, registration, VIN, licence, device or user is already in use.',
      );
    }
    throw error;
  }

  private drivingView(session: DrivingSession | null) {
    return session
      ? {
          id: session.id,
          driverName: userFullName(session.driver.user),
          startedAt: session.startedAt,
        }
      : null;
  }

  async listTrucks(q?: string, page?: string, status?: string) {
    const search = parseSearch(q, page, status);
    const em = getEm(this.orm);
    const where: FilterQuery<Truck> = {};
    if (search.status) where.status = search.status as TruckStatus;
    if (search.q) {
      const pattern = escapeLikePattern(search.q);
      where.$or = [
        { identifier: { $ilike: pattern } },
        { registration: { $ilike: pattern } },
        { make: { $ilike: pattern } },
        { model: { $ilike: pattern } },
        { vin: { $ilike: pattern } },
      ];
    }

    const [items, total] = await em.findAndCount(Truck, where, {
      orderBy: { identifier: 'asc' },
      limit: 20,
      offset: (search.page - 1) * 20,
    });

    const truckIds = items.map((truck) => truck.id);
    const [devices, driving] = truckIds.length
      ? await Promise.all([
          em.find(TruckDevice, { currentTruck: { $in: truckIds } }),
          em.find(
            DrivingSession,
            { truck: { $in: truckIds }, endedAt: null },
            { populate: ['driver.user'] },
          ),
        ])
      : [[], []];

    const deviceByTruck = new Map(
      devices
        .filter((device) => device.currentTruck)
        .map((device) => [device.currentTruck!.id, device]),
    );
    const drivingByTruck = new Map(
      driving.map((session) => [session.truck.id, session]),
    );

    return {
      items: items.map((truck) => {
        const device = deviceByTruck.get(truck.id) ?? null;
        return {
          ...toTruckDto(truck),
          currentDriving: this.drivingView(drivingByTruck.get(truck.id) ?? null),
          device: device ? toTruckDeviceDto(device) : null,
        };
      }),
      total,
      page: search.page,
      pageSize: 20,
    };
  }

  async getTruck(id: string) {
    const em = getEm(this.orm);
    const truck = await em.findOne(Truck, { id });
    if (!truck) throw new NotFoundError('Truck not found.');

    const [device, driver, deviceHistory, currentDriving] = await Promise.all([
      em.findOne(TruckDevice, { currentTruck: id }),
      em.findOne(
        DriverProfile,
        { currentTruck: id },
        { populate: ['user'] },
      ),
      em.find(
        DeviceTruckAssociation,
        { truck: id },
        { populate: ['device'], orderBy: { startedAt: 'desc' } },
      ),
      em.findOne(
        DrivingSession,
        { truck: id, endedAt: null },
        { populate: ['driver.user'] },
      ),
    ]);

    return {
      ...toTruckDto(truck),
      currentDriving: this.drivingView(currentDriving),
      device: device ? toTruckDeviceDto(device) : null,
      driver: driver
        ? {
            id: driver.id,
            identifier: driver.identifier,
            name: userFullName(driver.user),
          }
        : null,
      deviceHistory: deviceHistory.map(toDeviceAssociationDto),
    };
  }

  async saveTruck(raw: unknown, actor: User, id?: string) {
    const { deviceIdentifier, deviceSerialNumber, ...input } = parseTruck(raw);
    const truckId = await this.write(async (tx) => {
      const current = id ? await tx.findOne(Truck, { id }) : null;
      if (id && !current) throw new NotFoundError('Truck not found.');
      if (current) assertOdometerNotDecreasing(current, input.odometerKm);

      if (
        id &&
        input.status !== 'active' &&
        (await tx.count(DriverProfile, { currentTruck: id })) > 0
      ) {
        throw new ConflictError(
          'Unassign the driver before changing truck availability.',
        );
      }
      if (
        id &&
        input.status !== 'active' &&
        (await tx.count(DrivingSession, { truck: id, endedAt: null })) > 0
      ) {
        throw new ConflictError(
          'Finish the driving session before changing vehicle availability.',
        );
      }

      let truck: Truck;
      if (current) {
        tx.assign(current, input);
        truck = current;
      } else {
        truck = tx.create(Truck, {
          ...input,
          createdBy: tx.getReference(User, actor.id),
        });
        tx.persist(truck);
      }
      await tx.flush();

      const oldDevice = await tx.findOne(TruckDevice, { currentTruck: truck.id });
      let nextDevice = deviceIdentifier
        ? await tx.findOne(TruckDevice, { identifier: deviceIdentifier })
        : null;
      if (nextDevice?.currentTruck && nextDevice.currentTruck.id !== truck.id) {
        throw new ConflictError(
          'This device is assigned to another truck. Unbind it there first.',
        );
      }

      if (oldDevice && oldDevice.id !== nextDevice?.id) {
        await tx.nativeUpdate(
          DeviceTruckAssociation,
          { truck: truck.id, endedAt: null },
          { endedAt: new Date() },
        );
        oldDevice.currentTruck = null;
        await tx.flush();
      }

      if (deviceIdentifier) {
        if (nextDevice) {
          nextDevice.identifier = deviceIdentifier;
          nextDevice.serialNumber = deviceSerialNumber;
          nextDevice.currentTruck = truck;
        } else {
          nextDevice = tx.create(TruckDevice, {
            identifier: deviceIdentifier,
            serialNumber: deviceSerialNumber,
            currentTruck: truck,
          });
          tx.persist(nextDevice);
        }
        await tx.flush();

        if (oldDevice?.id !== nextDevice.id) {
          const association = tx.create(DeviceTruckAssociation, {
            device: nextDevice,
            truck,
            changedBy: tx.getReference(User, actor.id),
            endedAt: null,
          });
          tx.persist(association);
          await tx.flush();
        }
      }

      return truck.id;
    });
    return this.getTruck(truckId);
  }

  async listDrivers(q?: string, page?: string, status?: string) {
    const search = parseSearch(q, page, status);
    if (search.status === 'maintenance') {
      throw new BadRequestError('Invalid driver status.');
    }
    const em = getEm(this.orm);
    const where: FilterQuery<DriverProfile> = {};
    if (search.status) where.status = search.status as 'active' | 'inactive';
    if (search.q) {
      const pattern = escapeLikePattern(search.q);
      where.$or = [
        { identifier: { $ilike: pattern } },
        { user: { firstName: { $ilike: pattern } } },
        { user: { lastName: { $ilike: pattern } } },
        { user: { email: { $ilike: pattern } } },
        { currentTruck: { registration: { $ilike: pattern } } },
      ];
    }

    const [items, total] = await em.findAndCount(DriverProfile, where, {
      populate: ['user', 'currentTruck'],
      orderBy: { identifier: 'asc' },
      limit: 20,
      offset: (search.page - 1) * 20,
    });

    return {
      items: items.map(toDriverDto),
      total,
      page: search.page,
      pageSize: 20,
    };
  }

  async getDriver(id: string) {
    const em = getEm(this.orm);
    const driver = await em.findOne(
      DriverProfile,
      { id },
      { populate: ['user', 'currentTruck'] },
    );
    if (!driver) throw new NotFoundError('Driver not found.');

    const [assignments, access] = await Promise.all([
      em.find(
        DriverTruckAssignment,
        { driver: id },
        { populate: ['truck'], orderBy: { startedAt: 'desc' } },
      ),
      this.rbac.access(driver.user.id, em),
    ]);

    return {
      ...toDriverDto(driver),
      assignments: assignments.map(toDriverAssignmentDto),
      driverAccess: access.permissions.includes('driver.access'),
    };
  }

  async candidateUsers(query = '') {
    const { q } = parseSearch(query);
    const em = getEm(this.orm);
    const pattern = q ? escapeLikePattern(q) : null;
    return rawQuery<{
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    }>(
      em,
      `SELECT u.id, u."firstName", u."lastName", u.email
       FROM app.users u
       WHERE u."isActive" = true
         AND NOT EXISTS (SELECT 1 FROM app.driver_profiles d WHERE d."userId" = u.id)
         AND ($1::text IS NULL OR u."firstName" ILIKE $1 OR u."lastName" ILIKE $1 OR u.email ILIKE $1)
       ORDER BY u."firstName" ASC, u.id ASC
       LIMIT 20`,
      [pattern],
    );
  }

  async availableTrucks(query = '', currentDriverId?: string) {
    const { q } = parseSearch(query);
    const em = getEm(this.orm);
    const pattern = q ? escapeLikePattern(q) : null;
    const rows = await rawQuery<{ id: string }>(
      em,
      `SELECT t.id
       FROM app.trucks t
       WHERE t.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM app.driver_profiles d
           WHERE d."currentTruckId" = t.id
             AND ($1::uuid IS NULL OR d.id <> $1::uuid)
         )
         AND ($2::text IS NULL OR t.identifier ILIKE $2 OR t.registration ILIKE $2)
       ORDER BY t.identifier ASC
       LIMIT 20`,
      [currentDriverId ?? null, pattern],
    );
    if (!rows.length) return [];
    const trucks = await em.find(
      Truck,
      { id: { $in: rows.map((row) => row.id) } },
      { orderBy: { identifier: 'asc' } },
    );
    return trucks.map(toTruckDto);
  }

  async saveDriver(
    raw: unknown,
    actor: User,
    id?: string,
    allowCreateUser = false,
  ) {
    const { profile, userId, account } = parseDriver(raw, !id);
    const { currentTruckId, ...profileFields } = profile;

    const persist = async (tx: EntityManager, newUser?: User) => {
      const current = id ? await tx.findOne(DriverProfile, { id }) : null;
      if (id && !current) throw new NotFoundError('Driver not found.');

      const targetUserId = current?.user.id ?? userId!;
      const user = newUser ?? (await tx.findOne(User, { id: targetUserId }));
      if (!user) throw new NotFoundError('User not found.');
      if (!current && !user.isActive) {
        throw new BadRequestError('Select an active user.');
      }

      let truck: Truck | null = null;
      if (currentTruckId) {
        if (!user.isActive) {
          throw new BadRequestError(
            'An inactive user cannot be assigned a truck.',
          );
        }
        truck = await tx.findOne(Truck, { id: currentTruckId });
        if (!truck || !isTruckActive(truck)) {
          throw new BadRequestError('Select an active truck.');
        }
        const assigned = await tx.findOne(DriverProfile, {
          currentTruck: truck.id,
        });
        if (assigned && assigned.id !== id) {
          throw new ConflictError(
            'This truck is already assigned to another driver.',
          );
        }
      }

      const previousTruckId = current?.currentTruck?.id ?? null;
      let driver: DriverProfile;
      if (current) {
        tx.assign(current, profileFields);
        current.currentTruck = truck;
        driver = current;
      } else {
        driver = tx.create(DriverProfile, {
          ...profileFields,
          user,
          currentTruck: truck,
          createdBy: tx.getReference(User, actor.id),
        });
        tx.persist(driver);
      }
      await tx.flush();

      if (previousTruckId !== currentTruckId) {
        await tx.nativeUpdate(
          DriverTruckAssignment,
          { driver: driver.id, endedAt: null },
          { endedAt: new Date() },
        );
        if (truck) {
          tx.persist(
            tx.create(DriverTruckAssignment, {
              driver,
              truck,
              changedBy: tx.getReference(User, actor.id),
              endedAt: null,
            }),
          );
          await tx.flush();
        }
      }
      return driver.id;
    };

    let driverId = '';
    if (account) {
      if (!allowCreateUser) {
        throw new ForbiddenError(
          'Select an existing user. Creating an account requires user creation access.',
        );
      }
      await this.users.create(account, actor, async (tx, user) => {
        await acquireAdvisoryLock(tx, 'fleet-assets-v1');
        driverId = await persist(tx, user);
      });
    } else {
      driverId = await this.write((tx) => persist(tx));
    }

    return this.getDriver(driverId);
  }
}
