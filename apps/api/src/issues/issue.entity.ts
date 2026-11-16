import { entityId } from '../database/database.js';
import {
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import type { Rel } from '@mikro-orm/postgresql';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { User } from '../users/user.entity.js';

@Entity({ tableName: 'driver_issues', schema: 'app' })
@Index({
  name: 'ix_driver_issues_driver',
  properties: ['driver', 'createdAt'],
})
@Index({
  name: 'ix_driver_issues_open',
  properties: ['createdAt', 'id'],
  where: '"resolvedAt" IS NULL',
})
export class DriverIssue {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @ManyToOne(() => DriverProfile, {
    fieldName: 'driverId',
    deleteRule: 'restrict',
  })
  driver!: Rel<DriverProfile>;

  @ManyToOne(() => Truck, {
    fieldName: 'truckId',
    nullable: true,
    deleteRule: 'restrict',
  })
  truck!: Rel<Truck> | null;

  get driverId(): string {
    return entityId(this.driver);
  }

  get truckId(): string | null {
    return entityId(this.truck);
  }

  @Property({ type: 'string', length: 24 })
  category!: 'vehicle' | 'safety' | 'other';

  @Property({ type: 'text' })
  description!: string;

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

  set resolvedById(value: string | null) {
    this.resolvedBy = (value as unknown as Rel<User> | null);
  }

  @Property({ type: 'text', nullable: true })
  resolutionNote!: string | null;
}
