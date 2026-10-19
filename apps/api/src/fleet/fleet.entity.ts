import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { User } from '../users/user.entity.js';

@Entity({ name: 'trucks' })
export class Truck {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40, unique: true }) identifier: string;
  @Column({ type: 'varchar', length: 30, unique: true }) registration: string;
  @Column({ type: 'varchar', length: 2 }) registrationCountry: string;
  @Column({ type: 'varchar', length: 80 }) make: string;
  @Column({ type: 'varchar', length: 80 }) model: string;
  @Column({ type: 'int', nullable: true }) year: number | null;
  @Column({ type: 'varchar', length: 17, nullable: true, unique: true }) vin:
    string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) engineNumber:
    string | null;
  @Column({ type: 'varchar', length: 30 }) category: string;
  @Column({ type: 'varchar', length: 20 }) fuelType: string;
  @Column({ type: 'varchar', length: 20, nullable: true }) transmission:
    string | null;
  @Column({ type: 'int', nullable: true }) axleCount: number | null;
  @Column({ type: 'int', nullable: true }) grossVehicleMassKg: number | null;
  @Column({ type: 'int', nullable: true }) tareKg: number | null;
  @Column({ type: 'int', nullable: true }) payloadCapacityKg: number | null;
  @Column({ type: 'int' }) odometerKm: number;
  @Column({ type: 'int', nullable: true }) tankCapacityLitres: number | null;
  @Column({ type: 'date', nullable: true }) licenceDiscExpiresOn: string | null;
  @Column({ type: 'date', nullable: true }) roadworthyExpiresOn: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) insuranceProvider:
    string | null;
  @Column({ type: 'varchar', length: 100, nullable: true })
  insurancePolicyNumber: string | null;
  @Column({ type: 'date', nullable: true }) insuranceExpiresOn: string | null;
  @Column({ type: 'int', nullable: true }) serviceIntervalKm: number | null;
  @Column({ type: 'int', nullable: true }) nextServiceDueKm: number | null;
  @Column({ type: 'varchar', length: 20 }) status: string;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'uuid', nullable: true }) createdById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'truck_devices' })
export class TruckDevice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80, unique: true }) identifier: string;
  @Column({ type: 'varchar', length: 100, nullable: true, unique: true })
  serialNumber: string | null;
  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    unique: true,
    select: false,
  })
  credentialHash: string | null;
  @Column({ type: 'timestamptz', nullable: true }) enrolledAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) lastSeenAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) enrolledById: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'enrolledById' })
  enrolledBy: Relation<User> | null;
  @Column({ type: 'uuid', nullable: true, unique: true }) currentTruckId:
    string | null;
  @ManyToOne(() => Truck, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'currentTruckId' })
  currentTruck: Relation<Truck> | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'driver_profiles' })
export class DriverProfile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', unique: true }) userId: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;
  @Column({ type: 'varchar', length: 40, unique: true }) identifier: string;
  @Column({ type: 'varchar', length: 30 }) phone: string;
  @Column({ type: 'varchar', length: 80 }) licenceNumber: string;
  @Column({ type: 'varchar', length: 10 }) licenceCode: string;
  @Column({ type: 'varchar', length: 2 }) licenceCountry: string;
  @Column({ type: 'date' }) licenceExpiresOn: string;
  @Column({ type: 'varchar', length: 80, nullable: true }) prdpNumber:
    string | null;
  @Column({ type: 'date', nullable: true }) prdpExpiresOn: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true })
  emergencyContactName: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true })
  emergencyContactPhone: string | null;
  @Column({ type: 'varchar', length: 20 }) status: string;
  @Column({ type: 'uuid', nullable: true, unique: true }) currentTruckId:
    string | null;
  @ManyToOne(() => Truck, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'currentTruckId' })
  currentTruck: Relation<Truck> | null;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'uuid', nullable: true }) createdById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity({ name: 'driver_truck_assignments' })
export class DriverTruckAssignment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) driverId: string;
  @ManyToOne(() => DriverProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverProfile>;
  @Column({ type: 'uuid' }) truckId: string;
  @ManyToOne(() => Truck, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truckId' })
  truck: Relation<Truck>;
  @Column({ type: 'uuid', nullable: true }) changedById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null;
}

@Entity({ name: 'device_truck_associations' })
export class DeviceTruckAssociation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) deviceId: string;
  @ManyToOne(() => TruckDevice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device: Relation<TruckDevice>;
  @Column({ type: 'uuid' }) truckId: string;
  @ManyToOne(() => Truck, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'truckId' })
  truck: Relation<Truck>;
  @Column({ type: 'uuid', nullable: true }) changedById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null;
}

export const fleetEntities = [
  Truck,
  TruckDevice,
  DriverProfile,
  DriverTruckAssignment,
  DeviceTruckAssociation,
];
