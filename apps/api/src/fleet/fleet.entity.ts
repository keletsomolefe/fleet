import { entityId } from '../database/database.js';
import {
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import type { Rel } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../database/calendar-date.type.js';
import { User } from '../users/user.entity.js';

@Entity({ tableName: 'trucks', schema: 'app' })
export class Truck {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 40, unique: true })
  identifier!: string;

  @Property({ type: 'string', length: 30, unique: true })
  registration!: string;

  @Property({ type: 'string', length: 2 })
  registrationCountry!: string;

  @Property({ type: 'string', length: 80 })
  make!: string;

  @Property({ type: 'string', length: 80 })
  model!: string;

  @Property({ type: 'integer', nullable: true })
  year!: number | null;

  @Property({ type: 'string', length: 17, nullable: true, unique: true })
  vin!: string | null;

  @Property({ type: 'string', length: 80, nullable: true })
  engineNumber!: string | null;

  @Property({ type: 'string', length: 30 })
  category!: string;

  @Property({ type: 'string', length: 20 })
  fuelType!: string;

  @Property({ type: 'string', length: 20, nullable: true })
  transmission!: string | null;

  @Property({ type: 'integer', nullable: true })
  axleCount!: number | null;

  @Property({ type: 'integer', nullable: true })
  grossVehicleMassKg!: number | null;

  @Property({ type: 'integer', nullable: true })
  tareKg!: number | null;

  @Property({ type: 'integer', nullable: true })
  payloadCapacityKg!: number | null;

  @Property({ type: 'integer' })
  odometerKm!: number;

  @Property({ type: 'integer', nullable: true })
  tankCapacityLitres!: number | null;

  @Property({ type: CalendarDateType, nullable: true })
  licenceDiscExpiresOn!: string | null;

  @Property({ type: CalendarDateType, nullable: true })
  roadworthyExpiresOn!: string | null;

  @Property({ type: 'string', length: 100, nullable: true })
  insuranceProvider!: string | null;

  @Property({ type: 'string', length: 100, nullable: true })
  insurancePolicyNumber!: string | null;

  @Property({ type: CalendarDateType, nullable: true })
  insuranceExpiresOn!: string | null;

  @Property({ type: 'integer', nullable: true })
  serviceIntervalKm!: number | null;

  @Property({ type: 'integer', nullable: true })
  nextServiceDueKm!: number | null;

  @Property({ type: 'string', length: 20 })
  status!: string;

  @Property({ type: 'text', nullable: true })
  notes!: string | null;

  @Property({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}

@Entity({ tableName: 'truck_devices', schema: 'app' })
export class TruckDevice {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 80, unique: true })
  identifier!: string;

  @Property({ type: 'string', length: 100, nullable: true, unique: true })
  serialNumber!: string | null;

  @Property({ type: 'string', length: 64, nullable: true, unique: true })
  credentialHash!: string | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  enrolledAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @ManyToOne(() => User, {
    fieldName: 'enrolledById',
    nullable: true,
    deleteRule: 'set null',
  })
  enrolledBy!: Rel<User> | null;

  @ManyToOne(() => Truck, {
    fieldName: 'currentTruckId',
    nullable: true,
    deleteRule: 'restrict',
    unique: true,
  })
  currentTruck!: Rel<Truck> | null;

  get enrolledById(): string | null {
    return entityId(this.enrolledBy);
  }

  get currentTruckId(): string | null {
    return entityId(this.currentTruck);
  }

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}

@Entity({ tableName: 'driver_profiles', schema: 'app' })
@Unique({
  name: 'driver_profiles_licenceCountry_licenceNumber_key',
  properties: ['licenceCountry', 'licenceNumber'],
})
export class DriverProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => User, {
    fieldName: 'userId',
    deleteRule: 'restrict',
    unique: true,
  })
  user!: Rel<User>;

  @Property({ type: 'string', length: 40, unique: true })
  identifier!: string;

  @Property({ type: 'string', length: 30 })
  phone!: string;

  @Property({ type: 'string', length: 80 })
  licenceNumber!: string;

  @Property({ type: 'string', length: 10 })
  licenceCode!: string;

  @Property({ type: 'string', length: 2 })
  licenceCountry!: string;

  @Property({ type: CalendarDateType })
  licenceExpiresOn!: string;

  @Property({ type: 'string', length: 80, nullable: true })
  prdpNumber!: string | null;

  @Property({ type: CalendarDateType, nullable: true })
  prdpExpiresOn!: string | null;

  @Property({ type: 'string', length: 100, nullable: true })
  emergencyContactName!: string | null;

  @Property({ type: 'string', length: 30, nullable: true })
  emergencyContactPhone!: string | null;

  @Property({ type: 'string', length: 20 })
  status!: string;

  @ManyToOne(() => Truck, {
    fieldName: 'currentTruckId',
    nullable: true,
    deleteRule: 'restrict',
    unique: true,
  })
  currentTruck!: Rel<Truck> | null;

  get userId(): string {
    return entityId(this.user);
  }

  get currentTruckId(): string | null {
    return entityId(this.currentTruck);
  }

  @Property({ type: 'text', nullable: true })
  notes!: string | null;

  @Property({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}

@Entity({ tableName: 'driver_truck_assignments', schema: 'app' })
@Index({
  name: 'idx_driver_assignment_history',
  properties: ['driver', 'startedAt'],
})
@Unique({
  name: 'uq_driver_current_assignment',
  properties: ['driver'],
  where: '"endedAt" IS NULL',
})
@Unique({
  name: 'uq_truck_current_assignment',
  properties: ['truck'],
  where: '"endedAt" IS NULL',
})
export class DriverTruckAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => DriverProfile, {
    fieldName: 'driverId',
    deleteRule: 'restrict',
  })
  driver!: Rel<DriverProfile>;

  @ManyToOne(() => Truck, { fieldName: 'truckId', deleteRule: 'restrict' })
  truck!: Rel<Truck>;

  get driverId(): string {
    return entityId(this.driver);
  }

  get truckId(): string {
    return entityId(this.truck);
  }

  @Property({ type: 'uuid', nullable: true })
  changedById!: string | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  startedAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}

@Entity({ tableName: 'device_truck_associations', schema: 'app' })
@Index({
  name: 'idx_device_association_history',
  properties: ['truck', 'startedAt'],
})
@Unique({
  name: 'uq_device_current_association',
  properties: ['device'],
  where: '"endedAt" IS NULL',
})
@Unique({
  name: 'uq_truck_current_device',
  properties: ['truck'],
  where: '"endedAt" IS NULL',
})
export class DeviceTruckAssociation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => TruckDevice, {
    fieldName: 'deviceId',
    deleteRule: 'restrict',
  })
  device!: Rel<TruckDevice>;

  @ManyToOne(() => Truck, { fieldName: 'truckId', deleteRule: 'restrict' })
  truck!: Rel<Truck>;

  get deviceId(): string {
    return entityId(this.device);
  }

  get truckId(): string {
    return entityId(this.truck);
  }

  @Property({ type: 'uuid', nullable: true })
  changedById!: string | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  startedAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}

export const fleetEntities = [
  Truck,
  TruckDevice,
  DriverProfile,
  DriverTruckAssignment,
  DeviceTruckAssociation,
];
