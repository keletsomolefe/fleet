import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import { createdAtColumn } from '../../../shared/entity-columns.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';
import { DriverSchedule } from '../../scheduling/domain/driver-schedule.entity.js';

export const shiftMileageFlags = [
  'missing_start_odometer',
  'missing_start_photo',
  'missing_end_odometer',
  'missing_end_photo',
  'lower_end_odometer',
  'odometer_below_truck_last',
] as const;

export type ShiftMileageFlag = (typeof shiftMileageFlags)[number];

export const DrivingSession = defineEntity({
  name: 'DrivingSession',
  tableName: 'driving_sessions',
  schema: 'app',
  indexes: [
    {
      name: 'idx_driving_sessions_kratos_active',
      properties: ['kratosSessionId'],
      where: '"endedAt" IS NULL',
    },
    {
      name: 'idx_driving_sessions_truck_started',
      properties: ['truck', 'startedAt'],
    },
    {
      name: 'idx_driving_sessions_driver_started',
      properties: ['driver', 'startedAt'],
    },
  ],
  uniques: [
    {
      name: 'uq_driving_active_driver',
      properties: ['driver'],
      where: '"endedAt" IS NULL',
    },
    {
      name: 'uq_driving_active_truck',
      properties: ['truck'],
      where: '"endedAt" IS NULL',
    },
  ],
  checks: [
    {
      name: 'driving_sessions_start_odometer_check',
      expression: '"startOdometerKm" IS NULL OR "startOdometerKm" >= 0',
    },
    {
      name: 'driving_sessions_end_odometer_check',
      expression: '"endOdometerKm" IS NULL OR "endOdometerKm" >= 0',
    },
  ],
  properties: {
    /** Client-generated UUID used as an idempotency key for offline mobile retries. */
    id: p.uuid().primary(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    kratosSessionId: p.uuid(),
    confirmedDate: p.type(CalendarDateType).$type<string>(),
    schedule: () =>
      p
        .manyToOne(DriverSchedule)
        .fieldName('scheduleId')
        .strictNullable()
        .deleteRule('set null'),
    startedAt: createdAtColumn(),
    endedAt: p.datetime().columnType('timestamptz').strictNullable(),
    endedBy: () =>
      p
        .manyToOne(User)
        .fieldName('endedById')
        .strictNullable()
        .deleteRule('set null'),
    endReason: p.string().length(32).strictNullable(),
    startOdometerKm: p
      .decimal('string')
      .precision(12)
      .scale(1)
      .strictNullable(),
    startOdometerAt: p.datetime().columnType('timestamptz').strictNullable(),
    startOdometerMissingPhotoReason: p.text().strictNullable(),
    endOdometerKm: p.decimal('string').precision(12).scale(1).strictNullable(),
    endOdometerAt: p.datetime().columnType('timestamptz').strictNullable(),
    endOdometerMissingPhotoReason: p.text().strictNullable(),
    endOdometerLowerReason: p.text().strictNullable(),
    mileageFlags: p.string().array().$type<string>().default([]),
    mileageReviewedAt: p.datetime().columnType('timestamptz').strictNullable(),
    mileageReviewedBy: () =>
      p
        .manyToOne(User)
        .fieldName('mileageReviewedById')
        .strictNullable()
        .deleteRule('set null'),
    mileageReviewNote: p.text().strictNullable(),
  },
});

export type DrivingSession = InferEntity<typeof DrivingSession>;

/**
 * Pure domain distance calculation for a single truck driving segment.
 * Never returns a negative distance; returns `null` when either reading is missing
 * or when the end reading is lower than the start reading.
 */
export function computeShiftDistanceKm(
  startOdometerKm: string | number | null | undefined,
  endOdometerKm: string | number | null | undefined,
): number | null {
  if (startOdometerKm == null || endOdometerKm == null) return null;
  const start = Number(startOdometerKm);
  const end = Number(endOdometerKm);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) {
    return null;
  }
  if (end < start) return null;
  return Math.round((end - start) * 10) / 10;
}

export interface ShiftMileageFlagInput {
  startOdometerKm: string | null;
  hasStartPhoto: boolean;
  ended: boolean;
  endOdometerKm: string | null;
  hasEndPhoto: boolean;
  truckLastOdometerKm?: number | null;
}

/** Computes operational and proof exception flags for a driving session's odometer records. */
export function evaluateShiftMileageFlags(
  input: ShiftMileageFlagInput,
): ShiftMileageFlag[] {
  const flags: ShiftMileageFlag[] = [];
  if (input.startOdometerKm == null) {
    flags.push('missing_start_odometer');
  } else {
    if (!input.hasStartPhoto) flags.push('missing_start_photo');
    if (
      input.truckLastOdometerKm != null &&
      Number(input.startOdometerKm) < input.truckLastOdometerKm
    ) {
      flags.push('odometer_below_truck_last');
    }
  }
  if (input.ended) {
    if (input.endOdometerKm == null) {
      flags.push('missing_end_odometer');
    } else {
      if (!input.hasEndPhoto) flags.push('missing_end_photo');
      if (
        input.startOdometerKm != null &&
        Number(input.endOdometerKm) < Number(input.startOdometerKm)
      ) {
        flags.push('lower_end_odometer');
      }
    }
  }
  return flags;
}
