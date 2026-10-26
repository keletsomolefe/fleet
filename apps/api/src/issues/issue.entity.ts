import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { User } from '../users/user.entity.js';

@Entity({ name: 'driver_issues' })
export class DriverIssue {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') driverId: string;
  @ManyToOne(() => DriverProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverProfile>;
  @Column({ type: 'uuid', nullable: true }) truckId: string | null;
  @ManyToOne(() => Truck, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truckId' })
  truck: Relation<Truck> | null;
  @Column({ type: 'varchar', length: 24 }) category:
    'vehicle' | 'safety' | 'other';
  @Column('text') description: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) resolvedById: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resolvedById' })
  resolvedBy: Relation<User> | null;
  @Column({ type: 'text', nullable: true }) resolutionNote: string | null;
}
