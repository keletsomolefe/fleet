import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ActivityData, DispatchPlan } from './transport.input.js';

@Entity({ name: 'customers' })
export class Customer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('varchar') name: string;
  @Column('varchar') contact: string;
  @Column('varchar') email: string;
  @Column('varchar') phone: string;
  @Column('text') notes: string;
  @Column('boolean') active: boolean;
  @Column('int') version: number;
}
@Entity({ name: 'locations' })
export class Location {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('varchar') name: string;
  @Column('text') directions: string;
  @Column('varchar') contact: string;
  @Column('varchar') phone: string;
  @Column('uuid', { array: true }) customerIds: string[];
  @Column('double precision', { nullable: true }) latitude: number | null;
  @Column('double precision', { nullable: true }) longitude: number | null;
  @Column('boolean') active: boolean;
  @Column('int') version: number;
}
@Entity({ name: 'products' })
export class Product {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('varchar') name: string;
  @Column('varchar') unit: string;
  @Column('boolean') active: boolean;
  @Column('int') version: number;
}
@Entity({ name: 'customer_products' })
export class CustomerProduct {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') customerId: string;
  @Column('uuid') productId: string;
  @Column('boolean') supplies: boolean;
  @Column('boolean') receives: boolean;
  @Column('boolean') active: boolean;
  @Column('int') version: number;
}
@Entity({ name: 'transport_rates' })
export class TransportRate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') customerProductId: string;
  @Column('uuid', { nullable: true }) originId: string | null;
  @Column('uuid', { nullable: true }) destinationId: string | null;
  @Column('varchar') method: 'quantity' | 'delivery';
  @Column('varchar') basis: 'collected' | 'delivered';
  @Column('varchar') unit: string;
  @Column('numeric', { precision: 20, scale: 6 }) price: string;
  @Column('date') startsOn: string;
  @Column('date', { nullable: true }) endsOn: string | null;
  @Column('uuid') createdById: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
@Entity({ name: 'dispatches' })
export class Dispatch {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('varchar') reference: string;
  @Column('date') date: string;
  @Column('uuid') driverId: string;
  @Column('uuid') truckId: string;
  @Column('jsonb') plan: DispatchPlan;
  @Column('varchar') status: 'draft' | 'dispatched' | 'cancelled';
  @Column('int') version: number;
  @Column('uuid') createdById: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
@Entity({ name: 'recording_contexts' })
export class RecordingContext {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') driverId: string;
  @Column('uuid') truckId: string;
  @Column('uuid') drivingSessionId: string;
  @Column('varchar', { select: false }) tokenHash: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
@Entity({ name: 'transport_records' })
export class TransportRecord {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') driverId: string;
  @Column('uuid') truckId: string;
  @Column('uuid') contextId: string;
  @Column('uuid', { nullable: true }) dispatchId: string | null;
  @Column('uuid') currentActivityId: string;
  @Column('varchar') kind: 'collection' | 'delivery' | 'fuel';
  @Column('timestamptz') occurredAt: Date;
  @Column('jsonb') data: ActivityData;
  @Column('int') version: number;
  @Column('varchar') review: 'pending' | 'validated' | 'clarification' | 'void';
  @Column('text', { array: true }) flags: string[];
  @Column('uuid', { nullable: true }) reviewedById: string | null;
  @Column('timestamptz', { nullable: true }) reviewedAt: Date | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
@Entity({ name: 'activity_revisions' })
export class ActivityRevision {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') recordId: string;
  @Column('uuid') contextId: string;
  @Column('varchar') digest: string;
  @Column('int') baseVersion: number;
  @Column('jsonb') submission: Record<string, unknown>;
  @Column('boolean') conflict: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) receivedAt: Date;
}
@Entity({ name: 'transport_charges' })
export class TransportCharge {
  @PrimaryColumn('uuid') recordId: string;
  @Column('uuid', { nullable: true }) rateId: string | null;
  @Column('varchar') status: 'priced' | 'needs_pricing' | 'uncharged';
  @Column('numeric', { precision: 20, scale: 2, nullable: true }) amount:
    string | null;
  @Column('jsonb', { nullable: true }) snapshot: Record<string, unknown> | null;
}
@Entity({ name: 'transport_audits' })
export class TransportAudit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') recordId: string;
  @Column('uuid') actorId: string;
  @Column('varchar') action: string;
  @Column('text') reason: string;
  @Column('jsonb') before: Record<string, unknown>;
  @Column('jsonb') after: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
export const transportEntities = [
  Customer,
  Location,
  Product,
  CustomerProduct,
  TransportRate,
  Dispatch,
  RecordingContext,
  TransportRecord,
  ActivityRevision,
  TransportCharge,
  TransportAudit,
];
