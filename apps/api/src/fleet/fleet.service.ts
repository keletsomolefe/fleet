import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { User } from '../users/user.entity.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AdminUsersService } from '../users/admin-users.service.js';
import {
  Truck,
  TruckDevice,
  DriverProfile,
  DriverTruckAssignment,
  DeviceTruckAssociation,
} from './fleet.entity.js';
import { parseDriver, parseSearch, parseTruck } from './fleet.input.js';

@Injectable()
export class FleetService {
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(AdminUsersService) private readonly users: AdminUsersService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  private async lock(m: EntityManager) {
    await m.query("SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))");
  }
  private async write<T>(work: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (m) => {
        await this.lock(m);
        return work(m);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }
  private rethrow(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if ((error as { code?: string })?.code === '23505')
      throw new ConflictException(
        'Identifier, registration, VIN, licence, device or user is already in use.',
      );
    throw error;
  }
  async listTrucks(q?: string, page?: string, status?: string) {
    const search = parseSearch(q, page, status);
    const b = this.db
      .getRepository(Truck)
      .createQueryBuilder('t')
      .orderBy('t.identifier', 'ASC');
    if (search.q)
      b.andWhere(
        '(t.identifier ILIKE :q OR t.registration ILIKE :q OR t.make ILIKE :q OR t.model ILIKE :q OR t.vin ILIKE :q)',
        { q: `%${search.q.replace(/[\\%_]/g, '\\$&')}%` },
      );
    if (search.status)
      b.andWhere('t.status=:status', { status: search.status });
    const [items, total] = await b
      .skip((search.page - 1) * 20)
      .take(20)
      .getManyAndCount();
    const devices = items.length
      ? await this.db
          .getRepository(TruckDevice)
          .createQueryBuilder('d')
          .where('d.currentTruckId IN (:...ids)', {
            ids: items.map((t) => t.id),
          })
          .getMany()
      : [];
    return {
      items: items.map((t) => ({
        ...t,
        device: devices.find((d) => d.currentTruckId === t.id) ?? null,
      })),
      total,
      page: search.page,
      pageSize: 20,
    };
  }
  async getTruck(id: string) {
    const truck = await this.db.getRepository(Truck).findOneBy({ id });
    if (!truck) throw new NotFoundException('Truck not found.');
    const [device, driver, deviceHistory] = await Promise.all([
      this.db.getRepository(TruckDevice).findOneBy({ currentTruckId: id }),
      this.db
        .getRepository(DriverProfile)
        .findOne({ where: { currentTruckId: id }, relations: { user: true } }),
      this.db.getRepository(DeviceTruckAssociation).find({
        where: { truckId: id },
        relations: { device: true },
        order: { startedAt: 'DESC' },
      }),
    ]);
    return {
      ...truck,
      device,
      driver: driver
        ? {
            id: driver.id,
            identifier: driver.identifier,
            name: `${driver.user.firstName} ${driver.user.lastName}`,
          }
        : null,
      deviceHistory,
    };
  }
  async saveTruck(raw: unknown, actor: User, id?: string) {
    const { deviceIdentifier, deviceSerialNumber, ...input } = parseTruck(raw);
    const truckId = await this.write(async (m) => {
      const current = id ? await m.findOneBy(Truck, { id }) : null;
      if (id && !current) throw new NotFoundException('Truck not found.');
      if (current && input.odometerKm < current.odometerKm)
        throw new BadRequestException('Odometer cannot decrease.');
      if (
        id &&
        input.status !== 'active' &&
        (await m.existsBy(DriverProfile, { currentTruckId: id }))
      )
        throw new ConflictException(
          'Unassign the driver before changing truck availability.',
        );
      const truck = await m.save(
        Truck,
        m.create(Truck, {
          ...current,
          ...input,
          ...(id ? {} : { createdById: actor.id }),
        }),
      );
      const old = await m.findOneBy(TruckDevice, { currentTruckId: truck.id });
      let next = deviceIdentifier
        ? await m.findOneBy(TruckDevice, { identifier: deviceIdentifier })
        : null;
      if (next?.currentTruckId && next.currentTruckId !== truck.id)
        throw new ConflictException(
          'This device is assigned to another truck. Unbind it there first.',
        );
      if (old && old.id !== next?.id) {
        await m.update(
          DeviceTruckAssociation,
          { truckId: truck.id, endedAt: IsNull() },
          { endedAt: new Date() },
        );
        await m.update(TruckDevice, { id: old.id }, { currentTruckId: null });
      }
      if (deviceIdentifier) {
        next = await m.save(
          TruckDevice,
          m.create(TruckDevice, {
            ...next,
            identifier: deviceIdentifier,
            serialNumber: deviceSerialNumber,
            currentTruckId: truck.id,
          }),
        );
        if (old?.id !== next.id)
          await m.save(
            DeviceTruckAssociation,
            m.create(DeviceTruckAssociation, {
              deviceId: next.id,
              truckId: truck.id,
              changedById: actor.id,
              endedAt: null,
            }),
          );
      }
      return truck.id;
    });
    return this.getTruck(truckId);
  }
  async listDrivers(q?: string, page?: string, status?: string) {
    const search = parseSearch(q, page, status);
    if (search.status === 'maintenance')
      throw new BadRequestException('Invalid driver status.');
    const b = this.db
      .getRepository(DriverProfile)
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.user', 'u')
      .leftJoinAndSelect('d.currentTruck', 't')
      .orderBy('d.identifier', 'ASC');
    if (search.q)
      b.andWhere(
        '(d.identifier ILIKE :q OR u.firstName ILIKE :q OR u.lastName ILIKE :q OR u.email ILIKE :q OR t.registration ILIKE :q)',
        { q: `%${search.q.replace(/[\\%_]/g, '\\$&')}%` },
      );
    if (search.status)
      b.andWhere('d.status=:status', { status: search.status });
    const [items, total] = await b
      .skip((search.page - 1) * 20)
      .take(20)
      .getManyAndCount();
    return {
      items: items.map((d) => this.driverView(d)),
      total,
      page: search.page,
      pageSize: 20,
    };
  }
  private driverView(d: DriverProfile) {
    return {
      ...d,
      user: {
        id: d.user.id,
        firstName: d.user.firstName,
        lastName: d.user.lastName,
        email: d.user.email,
        isActive: d.user.isActive,
      },
    };
  }
  async getDriver(id: string) {
    const driver = await this.db.getRepository(DriverProfile).findOne({
      where: { id },
      relations: { user: true, currentTruck: true },
    });
    if (!driver) throw new NotFoundException('Driver not found.');
    const assignments = await this.db
      .getRepository(DriverTruckAssignment)
      .find({
        where: { driverId: id },
        relations: { truck: true },
        order: { startedAt: 'DESC' },
      });
    const access = await this.rbac.access(driver.userId);
    return {
      ...this.driverView(driver),
      assignments,
      driverAccess: access.permissions.includes('driver.access'),
    };
  }
  async candidateUsers(query = '') {
    const { q } = parseSearch(query);
    const b = this.db
      .getRepository(User)
      .createQueryBuilder('u')
      .where(
        'NOT EXISTS (SELECT 1 FROM app.driver_profiles d WHERE d."userId"=u.id)',
      )
      .andWhere('u.isActive=true')
      .orderBy('u.firstName', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .take(20);
    if (q)
      b.andWhere(
        '(u.firstName ILIKE :q OR u.lastName ILIKE :q OR u.email ILIKE :q)',
        { q: `%${q.replace(/[\\%_]/g, '\\$&')}%` },
      );
    return (await b.getMany()).map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
    }));
  }
  async availableTrucks(query = '', currentDriverId?: string) {
    const { q } = parseSearch(query);
    const b = this.db
      .getRepository(Truck)
      .createQueryBuilder('t')
      .where("t.status='active'")
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM app.driver_profiles d WHERE d."currentTruckId"=t.id AND (:driverId::uuid IS NULL OR d.id<>:driverId::uuid))',
        { driverId: currentDriverId ?? null },
      )
      .orderBy('t.identifier', 'ASC')
      .take(20);
    if (q)
      b.andWhere('(t.identifier ILIKE :q OR t.registration ILIKE :q)', {
        q: `%${q.replace(/[\\%_]/g, '\\$&')}%`,
      });
    return b.getMany();
  }
  async saveDriver(
    raw: unknown,
    actor: User,
    id?: string,
    allowCreateUser = false,
  ) {
    const { profile, userId, account } = parseDriver(raw, !id);
    const persist = async (m: EntityManager, newUser?: User) => {
      const current = id ? await m.findOneBy(DriverProfile, { id }) : null;
      if (id && !current) throw new NotFoundException('Driver not found.');
      const user =
        newUser ??
        (await m.findOneBy(User, { id: current?.userId ?? userId! }));
      if (!user) throw new NotFoundException('User not found.');
      if (!current && !user.isActive)
        throw new BadRequestException('Select an active user.');
      if (profile.currentTruckId) {
        if (!user.isActive)
          throw new BadRequestException(
            'An inactive user cannot be assigned a truck.',
          );
        const truck = await m.findOneBy(Truck, { id: profile.currentTruckId });
        if (!truck || truck.status !== 'active')
          throw new BadRequestException('Select an active truck.');
        const assigned = await m.findOneBy(DriverProfile, {
          currentTruckId: truck.id,
        });
        if (assigned && assigned.id !== id)
          throw new ConflictException(
            'This truck is already assigned to another driver.',
          );
      }
      const driver = await m.save(
        DriverProfile,
        m.create(DriverProfile, {
          ...current,
          ...profile,
          userId: user.id,
          ...(id ? {} : { createdById: actor.id }),
        }),
      );
      if ((current?.currentTruckId ?? null) !== profile.currentTruckId) {
        await m.update(
          DriverTruckAssignment,
          { driverId: driver.id, endedAt: IsNull() },
          { endedAt: new Date() },
        );
        if (profile.currentTruckId)
          await m.save(
            DriverTruckAssignment,
            m.create(DriverTruckAssignment, {
              driverId: driver.id,
              truckId: profile.currentTruckId,
              changedById: actor.id,
              endedAt: null,
            }),
          );
      }
      return driver.id;
    };
    let driverId: string;
    if (account) {
      if (!allowCreateUser)
        throw new ForbiddenException(
          'Select an existing user. Creating an account requires user creation access.',
        );
      let createdId = '';
      await this.users.create(account, actor, async (m, user) => {
        await this.lock(m);
        createdId = await persist(m, user);
      });
      driverId = createdId;
    } else driverId = await this.write((m) => persist(m));
    return this.getDriver(driverId);
  }
}
