import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'driver_schedules' })
export class DriverSchedule {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') driverId: string;
  @Column('uuid') truckId: string;
  @Column('date') date: string;
  @Column('uuid') createdById: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) cancelledAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) cancelledById: string | null;
  @Column({ type: 'text', default: '' }) note: string;
}
