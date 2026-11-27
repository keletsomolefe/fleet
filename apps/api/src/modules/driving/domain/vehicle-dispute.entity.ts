import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';
import { DriverSchedule } from '../../scheduling/domain/driver-schedule.entity.js';
import { DrivingSession } from './driving-session.entity.js';

export const disputeKinds = ['occupancy', 'schedule'] as const;
export type DisputeKind = (typeof disputeKinds)[number];

const kindSql = disputeKinds.map((v) => `'${v}'`).join(', ');

export const VehicleDispute = defineEntity({
  name: 'VehicleDispute',
  tableName: 'vehicle_disputes',
  schema: 'app',
  indexes: [
    {
      name: 'idx_vehicle_dispute_open',
      properties: ['createdAt'],
      where: '"resolvedAt" IS NULL',
    },
  ],
  uniques: [
    {
      name: 'uq_schedule_open_dispute',
      properties: ['driver', 'scheduleDate'],
      where: `"resolvedAt" IS NULL AND kind = 'schedule'`,
    },
    {
      name: 'uq_vehicle_open_dispute',
      properties: ['truck', 'driver'],
      where: `"resolvedAt" IS NULL AND kind = 'occupancy'`,
    },
  ],
  checks: [
    {
      name: 'vehicle_disputes_kind_check',
      expression: `kind IN (${kindSql})`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    kind: p.string().length(24).$type<DisputeKind>().default('occupancy'),
    schedule: () =>
      p
        .manyToOne(DriverSchedule)
        .fieldName('scheduleId')
        .strictNullable()
        .deleteRule('set null'),
    scheduleDate: p.type(CalendarDateType).$type<string>().strictNullable(),
    requestedTruck: () =>
      p
        .manyToOne(Truck)
        .fieldName('requestedTruckId')
        .strictNullable()
        .deleteRule('restrict'),
    driverNote: p.text().strictNullable(),
    activeSession: () =>
      p
        .manyToOne(DrivingSession)
        .fieldName('activeSessionId')
        .strictNullable()
        .deleteRule('restrict'),
    createdAt: createdAtColumn(),
    resolvedAt: p.datetime().columnType('timestamptz').strictNullable(),
    resolvedBy: () =>
      p
        .manyToOne(User)
        .fieldName('resolvedById')
        .strictNullable()
        .deleteRule('restrict'),
    resolution: p.string().length(32).strictNullable(),
    note: p.text().strictNullable(),
  },
});

export type VehicleDispute = InferEntity<typeof VehicleDispute>;
