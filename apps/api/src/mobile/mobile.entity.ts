import { entityId } from '../database/database.js';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import type { Rel } from '@mikro-orm/postgresql';
import {
  DeviceTruckAssociation,
  DriverProfile,
} from '../fleet/fleet.entity.js';

@Entity({ tableName: 'driver_truck_confirmations', schema: 'app' })
@Unique({
  name: 'uq_driver_session_truck_confirmation',
  properties: ['kratosSessionId', 'association'],
})
export class DriverTruckConfirmation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => DriverProfile, {
    fieldName: 'driverId',
    deleteRule: 'restrict',
  })
  driver!: Rel<DriverProfile>;

  @ManyToOne(() => DeviceTruckAssociation, {
    fieldName: 'associationId',
    deleteRule: 'restrict',
  })
  association!: Rel<DeviceTruckAssociation>;

  @Property({ type: 'uuid' })
  kratosSessionId!: string;

  get driverId(): string {
    return entityId(this.driver);
  }

  get associationId(): string {
    return entityId(this.association);
  }

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  confirmedAt!: Date;
}
