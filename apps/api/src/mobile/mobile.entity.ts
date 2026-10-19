import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import {
  DriverProfile,
  DeviceTruckAssociation,
} from '../fleet/fleet.entity.js';

@Entity({ name: 'driver_truck_confirmations' })
@Index(
  'uq_driver_session_truck_confirmation',
  ['kratosSessionId', 'associationId'],
  { unique: true },
)
export class DriverTruckConfirmation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) driverId: string;
  @ManyToOne(() => DriverProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverProfile>;
  @Column({ type: 'uuid' }) associationId: string;
  @ManyToOne(() => DeviceTruckAssociation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'associationId' })
  association: Relation<DeviceTruckAssociation>;
  @Column({ type: 'uuid' }) kratosSessionId: string;
  @CreateDateColumn({ type: 'timestamptz' }) confirmedAt: Date;
}
