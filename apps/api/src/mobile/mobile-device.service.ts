import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { AdminContext } from '../auth/auth.service.js';
import {
  Truck,
  TruckDevice,
  DriverProfile,
  DeviceTruckAssociation,
} from '../fleet/fleet.entity.js';
import { parseSearch, validateAssignment } from '../fleet/fleet.input.js';
import { DriverTruckConfirmation } from './mobile.entity.js';
import { parseConfirmation, parseEnrollment } from './mobile.input.js';

export function hashDeviceToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new UnauthorizedException(
      'Location sharing access has ended. Start sharing again.',
    );
  return createHash('sha256').update(token).digest('hex');
}
@Injectable()
export class MobileDeviceService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  private async lock(m: EntityManager) {
    await m.query("SELECT pg_advisory_xact_lock(hashtext('fleet-assets-v1'))");
  }
  private async driver(context: AdminContext, m = this.db.manager) {
    if (!context.permissions.includes('driver.access'))
      throw new ForbiddenException('Driver access is not enabled.');
    const profile = await m.findOneBy(DriverProfile, {
      userId: context.user.id,
      status: 'active',
    });
    if (!profile)
      throw new ForbiddenException(
        'Driver access is not active. Contact your fleet administrator.',
      );
    return profile;
  }
  private async device(token: string, m = this.db.manager) {
    const device = await m.findOne(TruckDevice, {
      where: { credentialHash: hashDeviceToken(token) },
      relations: { currentTruck: true },
    });
    if (!device)
      throw new UnauthorizedException(
        'Set up this device with a fleet administrator.',
      );
    const association = device.currentTruckId
      ? await m.findOneBy(DeviceTruckAssociation, {
          deviceId: device.id,
          truckId: device.currentTruckId,
          endedAt: IsNull(),
        })
      : null;
    return { device, association };
  }
  private view(
    device: TruckDevice,
    association: DeviceTruckAssociation | null,
  ) {
    const truck = device.currentTruck;
    return {
      device: { id: device.id, identifier: device.identifier },
      associationId: association?.id ?? null,
      truck:
        truck && association
          ? {
              id: truck.id,
              identifier: truck.identifier,
              registration: truck.registration,
              make: truck.make,
              model: truck.model,
              status: truck.status,
            }
          : null,
    };
  }
  async deviceContext(token: string) {
    const { device, association } = await this.device(token);
    await this.db
      .getRepository(TruckDevice)
      .update({ id: device.id }, { lastSeenAt: new Date() });
    return this.view(device, association);
  }
  async driverContext(context: AdminContext, token: string) {
    const [profile, { device, association }] = await Promise.all([
      this.driver(context),
      this.device(token),
    ]);
    let reason: string | null = null;
    try {
      validateAssignment(profile);
    } catch (error) {
      reason =
        error instanceof BadRequestException
          ? error.message
          : 'Your licence details need review.';
    }
    if (device.currentTruck?.status !== 'active')
      reason = 'This truck is unavailable. Contact your fleet administrator.';
    if (!association) reason = 'No truck is assigned to this device.';
    const confirmation = association
      ? await this.db.getRepository(DriverTruckConfirmation).findOneBy({
          kratosSessionId: context.session.id,
          associationId: association.id,
          driverId: profile.id,
        })
      : null;
    return {
      ...this.view(device, association),
      driver: {
        id: profile.id,
        identifier: profile.identifier,
        name: `${context.user.firstName} ${context.user.lastName}`,
      },
      canConfirm: !reason,
      reason,
      confirmedAt: confirmation?.confirmedAt ?? null,
    };
  }
  async trucks(q?: string, page?: string) {
    const search = parseSearch(q, page);
    const b = this.db
      .getRepository(Truck)
      .createQueryBuilder('t')
      .where("t.status='active'")
      .orderBy('t.identifier', 'ASC');
    if (search.q)
      b.andWhere('(t.identifier ILIKE :q OR t.registration ILIKE :q)', {
        q: `%${search.q.replace(/[\\%_]/g, '\\$&')}%`,
      });
    const [trucks, total] = await b
      .skip((search.page - 1) * 20)
      .take(20)
      .getManyAndCount();
    const devices = trucks.length
      ? await this.db
          .getRepository(TruckDevice)
          .createQueryBuilder('d')
          .addSelect('d.credentialHash')
          .where('d.currentTruckId IN (:...ids)', {
            ids: trucks.map((t) => t.id),
          })
          .getMany()
      : [];
    return {
      items: trucks.map((t) => {
        const d = devices.find((v) => v.currentTruckId === t.id);
        return {
          id: t.id,
          identifier: t.identifier,
          registration: t.registration,
          make: t.make,
          model: t.model,
          device: d
            ? {
                id: d.id,
                identifier: d.identifier,
                enrolled: !!d.credentialHash,
              }
            : null,
        };
      }),
      total,
      page: search.page,
      pageSize: 20,
    };
  }
  async enroll(raw: unknown, context: AdminContext) {
    const input = parseEnrollment(raw),
      credentialHash = hashDeviceToken(input.deviceToken);
    try {
      return await this.db.transaction(async (m) => {
        await this.lock(m);
        const truck = await m.findOneBy(Truck, {
          id: input.truckId,
          status: 'active',
        });
        if (!truck) throw new NotFoundException('Select an active truck.');
        const repo = m.getRepository(TruckDevice);
        const old = await repo
          .createQueryBuilder('d')
          .addSelect('d.credentialHash')
          .where('d.currentTruckId=:id', { id: truck.id })
          .getOne();
        let device = await repo
          .createQueryBuilder('d')
          .addSelect('d.credentialHash')
          .where('d.identifier=:identifier', {
            identifier: input.deviceIdentifier,
          })
          .getOne();
        if ((old?.id ?? null) !== input.expectedDeviceId)
          throw new ConflictException(
            'This truck’s device changed. Refresh the truck list.',
          );
        const tokenOwner = await m.findOneBy(TruckDevice, { credentialHash });
        if (tokenOwner && tokenOwner.id !== device?.id)
          throw new ConflictException(
            'Device credentials are already in use. Restart device setup.',
          );
        const replacing = !!(
          (old?.credentialHash && old.credentialHash !== credentialHash) ||
          (device?.credentialHash &&
            device.credentialHash !== credentialHash) ||
          (device?.currentTruckId && device.currentTruckId !== truck.id)
        );
        if (replacing && !input.replaceExisting)
          throw new ConflictException(
            'Confirm replacement to change this device’s truck or access.',
          );
        if (old && old.id !== device?.id) {
          await m.update(
            DeviceTruckAssociation,
            { deviceId: old.id, endedAt: IsNull() },
            { endedAt: new Date() },
          );
          await m.update(
            TruckDevice,
            { id: old.id },
            { currentTruckId: null, credentialHash: null },
          );
        }
        if (device?.currentTruckId && device.currentTruckId !== truck.id) {
          await m.update(
            DeviceTruckAssociation,
            { deviceId: device.id, endedAt: IsNull() },
            { endedAt: new Date() },
          );
        }
        const sameBinding = device?.currentTruckId === truck.id;
        device = await m.save(
          TruckDevice,
          m.create(TruckDevice, {
            ...(device ? { id: device.id } : {}),
            identifier: input.deviceIdentifier,
            currentTruckId: truck.id,
            credentialHash,
            enrolledAt: new Date(),
            enrolledById: context.user.id,
            lastSeenAt: new Date(),
          }),
        );
        if (!sameBinding)
          await m.save(
            DeviceTruckAssociation,
            m.create(DeviceTruckAssociation, {
              deviceId: device.id,
              truckId: truck.id,
              changedById: context.user.id,
              endedAt: null,
            }),
          );
        const association = await m.findOneByOrFail(DeviceTruckAssociation, {
          deviceId: device.id,
          truckId: truck.id,
          endedAt: IsNull(),
        });
        device.currentTruck = truck;
        return this.view(device, association);
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505')
        throw new ConflictException(
          'Device identifier or credentials are already in use.',
        );
      throw error;
    }
  }
  async confirm(context: AdminContext, token: string, raw: unknown) {
    const expected = parseConfirmation(raw);
    return this.db.transaction(async (m) => {
      await this.lock(m);
      const profile = await this.driver(context, m),
        { device, association } = await this.device(token, m);
      if (!association || association.id !== expected)
        throw new ConflictException(
          'The assigned truck changed. Check the registration again.',
        );
      if (device.currentTruck?.status !== 'active')
        throw new ConflictException(
          'This truck is unavailable. Contact your fleet administrator.',
        );
      validateAssignment(profile);
      const repo = m.getRepository(DriverTruckConfirmation);
      let confirmation = await repo.findOneBy({
        kratosSessionId: context.session.id,
        associationId: association.id,
      });
      if (!confirmation)
        confirmation = await repo.save(
          repo.create({
            driverId: profile.id,
            associationId: association.id,
            kratosSessionId: context.session.id,
          }),
        );
      return {
        ...this.view(device, association),
        confirmedAt: confirmation.confirmedAt,
      };
    });
  }
}
