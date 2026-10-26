import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { User } from '../users/user.entity.js';

@Entity({ name: 'driving_sessions' })
export class DrivingSession {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') driverId: string;
  @ManyToOne(() => DriverProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverProfile>;
  @Column('uuid') truckId: string;
  @ManyToOne(() => Truck, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truckId' })
  truck: Relation<Truck>;
  @Column('uuid') kratosSessionId: string;
  @Column('date') confirmedDate: string;
  @Column({ type: 'uuid', nullable: true }) scheduleId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) endedById: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) endReason:
    string | null;
}

@Entity({ name: 'vehicle_disputes' })
export class VehicleDispute {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') truckId: string;
  @ManyToOne(() => Truck, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truckId' })
  truck: Relation<Truck>;
  @Column('uuid') driverId: string;
  @ManyToOne(() => DriverProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverProfile>;
  @Column({ type: 'uuid', nullable: true }) activeSessionId: string | null;
  @Column({ type: 'varchar', length: 24, default: 'occupancy' }) kind:
    'occupancy' | 'schedule';
  @Column({ type: 'uuid', nullable: true }) scheduleId: string | null;
  @Column({ type: 'date', nullable: true }) scheduleDate: string | null;
  @Column({ type: 'uuid', nullable: true }) requestedTruckId: string | null;
  @Column({ type: 'text', nullable: true }) driverNote: string | null;
  @ManyToOne(() => DrivingSession, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'activeSessionId' })
  activeSession: Relation<DrivingSession>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) resolvedById: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resolvedById' })
  resolvedBy: Relation<User> | null;
  @Column({ type: 'varchar', length: 32, nullable: true }) resolution:
    string | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
}
