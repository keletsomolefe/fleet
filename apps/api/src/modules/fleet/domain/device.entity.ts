import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { User } from '../../identity/domain/user.entity.js';
import { Truck } from './truck.entity.js';

export const TruckDevice = defineEntity({
  name: 'TruckDevice',
  tableName: 'truck_devices',
  schema: 'app',
  properties: {
    id: uuidPrimaryKey(),
    identifier: p.string().length(80).unique(),
    serialNumber: p.string().length(100).strictNullable().unique(),
    /** SHA-256 device credential hash; hidden from default serialization. */
    credentialHash: p.string().length(64).strictNullable().unique().hidden(),
    enrolledAt: p.datetime().columnType('timestamptz').strictNullable(),
    lastSeenAt: p.datetime().columnType('timestamptz').strictNullable(),
    enrolledBy: () =>
      p
        .manyToOne(User)
        .fieldName('enrolledById')
        .strictNullable()
        .deleteRule('set null'),
    currentTruck: () =>
      p
        .manyToOne(Truck)
        .fieldName('currentTruckId')
        .strictNullable()
        .deleteRule('restrict')
        .unique(),
    ...timestampColumns(),
  },
});

export type TruckDevice = InferEntity<typeof TruckDevice>;

export const DeviceTruckAssociation = defineEntity({
  name: 'DeviceTruckAssociation',
  tableName: 'device_truck_associations',
  schema: 'app',
  indexes: [
    {
      name: 'idx_device_association_history',
      properties: ['truck', 'startedAt'],
    },
  ],
  uniques: [
    {
      name: 'uq_device_current_association',
      properties: ['device'],
      where: '"endedAt" IS NULL',
    },
    {
      name: 'uq_truck_current_device',
      properties: ['truck'],
      where: '"endedAt" IS NULL',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    device: () =>
      p.manyToOne(TruckDevice).fieldName('deviceId').deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    changedBy: () =>
      p
        .manyToOne(User)
        .fieldName('changedById')
        .strictNullable()
        .deleteRule('set null'),
    startedAt: createdAtColumn(),
    endedAt: p.datetime().columnType('timestamptz').strictNullable(),
  },
});

export type DeviceTruckAssociation = InferEntity<typeof DeviceTruckAssociation>;
