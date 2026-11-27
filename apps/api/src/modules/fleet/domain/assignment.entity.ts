import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { User } from '../../identity/domain/user.entity.js';
import { DriverProfile } from './driver.entity.js';
import { Truck } from './truck.entity.js';

export const DriverTruckAssignment = defineEntity({
  name: 'DriverTruckAssignment',
  tableName: 'driver_truck_assignments',
  schema: 'app',
  indexes: [
    {
      name: 'idx_driver_assignment_history',
      properties: ['driver', 'startedAt'],
    },
  ],
  uniques: [
    {
      name: 'uq_driver_current_assignment',
      properties: ['driver'],
      where: '"endedAt" IS NULL',
    },
    {
      name: 'uq_truck_current_assignment',
      properties: ['truck'],
      where: '"endedAt" IS NULL',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
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

export type DriverTruckAssignment = InferEntity<typeof DriverTruckAssignment>;
