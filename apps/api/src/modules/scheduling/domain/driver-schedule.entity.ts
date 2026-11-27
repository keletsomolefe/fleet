import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';

export const DriverSchedule = defineEntity({
  name: 'DriverSchedule',
  tableName: 'driver_schedules',
  schema: 'app',
  indexes: [
    {
      name: 'idx_driver_schedules_active_date',
      properties: ['date'],
      where: '"cancelledAt" IS NULL',
    },
  ],
  uniques: [
    {
      name: 'uq_schedule_driver_day',
      properties: ['driver', 'date'],
      where: '"cancelledAt" IS NULL',
    },
    {
      name: 'uq_schedule_truck_day',
      properties: ['truck', 'date'],
      where: '"cancelledAt" IS NULL',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    date: p.type(CalendarDateType).$type<string>(),
    createdBy: () =>
      p.manyToOne(User).fieldName('createdById').deleteRule('restrict'),
    createdAt: createdAtColumn(),
    cancelledAt: p.datetime().columnType('timestamptz').strictNullable(),
    cancelledBy: () =>
      p
        .manyToOne(User)
        .fieldName('cancelledById')
        .strictNullable()
        .deleteRule('set null'),
    note: p.text().default(''),
  },
});

export type DriverSchedule = InferEntity<typeof DriverSchedule>;

export function cancelDriverSchedule(
  schedule: DriverSchedule,
  actor: User,
  reason: string,
  at: Date = new Date(),
): void {
  schedule.cancelledAt = at;
  schedule.cancelledBy = actor;
  schedule.note = `${schedule.note}\nCancelled: ${reason}`.trim();
}
