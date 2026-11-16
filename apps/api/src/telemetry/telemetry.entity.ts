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
import {
  DeviceTruckAssociation,
  DriverProfile,
  TruckDevice,
} from '../fleet/fleet.entity.js';
import { DrivingSession } from '../mobile/driving.entity.js';

@Entity({ tableName: 'tracking_streams', schema: 'app' })
@Index({
  name: 'idx_tracking_stream_device',
  properties: ['device', 'startedAt'],
})
@Index({
  name: 'idx_tracking_driving_session',
  properties: ['drivingSession'],
})
@Unique({
  name: 'uq_tracking_upload_token',
  properties: ['uploadTokenHash'],
  where: '"uploadTokenHash" IS NOT NULL',
})
export class TrackingStream {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @ManyToOne(() => TruckDevice, {
    fieldName: 'deviceId',
    nullable: true,
    deleteRule: 'restrict',
  })
  device!: Rel<TruckDevice> | null;

  @ManyToOne(() => DriverProfile, {
    fieldName: 'driverId',
    deleteRule: 'restrict',
  })
  driver!: Rel<DriverProfile>;

  @ManyToOne(() => DeviceTruckAssociation, {
    fieldName: 'associationId',
    nullable: true,
    deleteRule: 'restrict',
  })
  association!: Rel<DeviceTruckAssociation> | null;

  @ManyToOne(() => DrivingSession, {
    fieldName: 'drivingSessionId',
    nullable: true,
    deleteRule: 'restrict',
  })
  drivingSession!: Rel<DrivingSession> | null;

  get deviceId(): string | null {
    return entityId(this.device);
  }

  get driverId(): string {
    return entityId(this.driver);
  }

  get associationId(): string | null {
    return entityId(this.association);
  }

  get drivingSessionId(): string | null {
    return entityId(this.drivingSession);
  }

  @Property({ type: 'string', length: 64, nullable: true })
  uploadTokenHash!: string | null;

  @Property({ type: 'uuid' })
  kratosSessionId!: string;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  startedAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Property({ type: 'integer', nullable: true })
  finalSequence!: number | null;
}

@Entity({ tableName: 'tracking_events', schema: 'app' })
@Unique({
  name: 'uq_tracking_stream_sequence',
  properties: ['stream', 'sequence'],
})
@Index({
  name: 'idx_tracking_event_time',
  properties: ['recordedAt', 'id'],
})
export class TrackingEvent {
  @Property({ type: 'boolean', default: false })
  unconfirmed!: boolean;

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @ManyToOne(() => TrackingStream, {
    fieldName: 'streamId',
    deleteRule: 'restrict',
  })
  stream!: Rel<TrackingStream>;

  get streamId(): string {
    return entityId(this.stream);
  }

  @Property({ type: 'integer' })
  sequence!: number;

  @Property({ type: 'string', length: 16 })
  kind!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  recordedAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  receivedAt!: Date;

  @Property({ type: 'double', nullable: true })
  latitude!: number | null;

  @Property({ type: 'double', nullable: true })
  longitude!: number | null;

  @Property({ type: 'double', nullable: true })
  accuracy!: number | null;

  @Property({ type: 'double', nullable: true })
  speed!: number | null;

  @Property({ type: 'double', nullable: true })
  heading!: number | null;

  @Property({ type: 'boolean', nullable: true })
  mocked!: boolean | null;

  @Property({ type: 'string', length: 64 })
  digest!: string;

  @Property({ type: 'json', columnType: 'jsonb' })
  raw!: Record<string, unknown>;
}
