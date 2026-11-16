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
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { User } from '../users/user.entity.js';

@Entity({ tableName: 'driving_sessions', schema: 'app' })
@Unique({
  name: 'uq_driving_active_driver',
  properties: ['driver'],
  where: '"endedAt" IS NULL',
})
@Unique({
  name: 'uq_driving_active_truck',
  properties: ['truck'],
  where: '"endedAt" IS NULL',
})
export class DrivingSession {
  @PrimaryKey({ type: 'uuid' })
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

  @Property({ type: 'uuid' })
  kratosSessionId!: string;

  @Property({ type: CalendarDateType })
  confirmedDate!: string;

  @Property({ type: 'uuid', nullable: true })
  scheduleId!: string | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  startedAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Property({ type: 'uuid', nullable: true })
  endedById!: string | null;

  @Property({ type: 'string', length: 32, nullable: true })
  endReason!: string | null;
}

@Entity({ tableName: 'vehicle_disputes', schema: 'app' })
@Index({
  name: 'idx_vehicle_dispute_open',
  properties: ['createdAt'],
  where: '"resolvedAt" IS NULL',
})
@Unique({
  name: 'uq_schedule_open_dispute',
  properties: ['driver', 'scheduleDate'],
  where: `"resolvedAt" IS NULL AND kind = 'schedule'`,
})
@Unique({
  name: 'uq_vehicle_open_dispute',
  properties: ['truck', 'driver'],
  where: `"resolvedAt" IS NULL AND kind = 'occupancy'`,
})
export class VehicleDispute {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => Truck, { fieldName: 'truckId', deleteRule: 'restrict' })
  truck!: Rel<Truck>;

  @ManyToOne(() => DriverProfile, {
    fieldName: 'driverId',
    deleteRule: 'restrict',
  })
  driver!: Rel<DriverProfile>;

  get truckId(): string {
    return entityId(this.truck);
  }

  get driverId(): string {
    return entityId(this.driver);
  }

  @Property({ type: 'string', length: 24, default: 'occupancy' })
  kind!: 'occupancy' | 'schedule';

  @Property({ type: 'uuid', nullable: true })
  scheduleId!: string | null;

  @Property({ type: CalendarDateType, nullable: true })
  scheduleDate!: string | null;

  @Property({ type: 'uuid', nullable: true })
  requestedTruckId!: string | null;

  @Property({ type: 'text', nullable: true })
  driverNote!: string | null;

  @ManyToOne(() => DrivingSession, {
    fieldName: 'activeSessionId',
    nullable: true,
    deleteRule: 'restrict',
  })
  activeSession!: Rel<DrivingSession> | null;

  get activeSessionId(): string | null {
    return entityId(this.activeSession);
  }

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @ManyToOne(() => User, {
    fieldName: 'resolvedById',
    nullable: true,
    deleteRule: 'restrict',
  })
  resolvedBy!: Rel<User> | null;

  get resolvedById(): string | null {
    return entityId(this.resolvedBy);
  }

  @Property({ type: 'string', length: 32, nullable: true })
  resolution!: string | null;

  @Property({ type: 'text', nullable: true })
  note!: string | null;
}
