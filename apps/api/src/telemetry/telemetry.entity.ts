import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import {
  DeviceTruckAssociation,
  DriverProfile,
  TruckDevice,
} from '../fleet/fleet.entity.js';
import { DrivingSession } from '../mobile/driving.entity.js';

@Entity({ name: 'tracking_streams' })
@Index('idx_tracking_stream_device', ['deviceId', 'startedAt'])
export class TrackingStream {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) deviceId: string | null;
  @ManyToOne(() => TruckDevice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device: Relation<TruckDevice>;
  @Column('uuid') driverId: string;
  @ManyToOne(() => DriverProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverProfile>;
  @Column({ type: 'uuid', nullable: true }) associationId: string | null;
  @ManyToOne(() => DeviceTruckAssociation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'associationId' })
  association: Relation<DeviceTruckAssociation>;
  @Column({ type: 'uuid', nullable: true }) drivingSessionId: string | null;
  @ManyToOne(() => DrivingSession, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'drivingSessionId' })
  drivingSession: Relation<DrivingSession> | null;
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  uploadTokenHash: string | null;
  @Column('uuid') kratosSessionId: string;
  @CreateDateColumn({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null;
  @Column({ type: 'int', nullable: true }) finalSequence: number | null;
}

@Entity({ name: 'tracking_events' })
@Index('uq_tracking_stream_sequence', ['streamId', 'sequence'], {
  unique: true,
})
@Index('idx_tracking_event_time', ['recordedAt', 'id'])
export class TrackingEvent {
  @Column({ type: 'boolean', default: false }) unconfirmed: boolean;
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') streamId: string;
  @ManyToOne(() => TrackingStream, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'streamId' })
  stream: Relation<TrackingStream>;
  @Column('int') sequence: number;
  @Column({ type: 'varchar', length: 16 }) kind: string;
  @Column('timestamptz') recordedAt: Date;
  @CreateDateColumn({ type: 'timestamptz' }) receivedAt: Date;
  @Column({ type: 'double precision', nullable: true }) latitude: number | null;
  @Column({ type: 'double precision', nullable: true }) longitude:
    number | null;
  @Column({ type: 'double precision', nullable: true }) accuracy: number | null;
  @Column({ type: 'double precision', nullable: true }) speed: number | null;
  @Column({ type: 'double precision', nullable: true }) heading: number | null;
  @Column({ type: 'boolean', nullable: true }) mocked: boolean | null;
  @Column({ type: 'varchar', length: 64 }) digest: string;
  @Column('jsonb') raw: Record<string, unknown>;
}
