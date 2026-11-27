import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import { operationalToday } from '../../../shared/calendar-date.js';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { BadRequestError } from '../../../shared/errors.js';
import { User } from '../../identity/domain/user.entity.js';
import { Truck } from './truck.entity.js';

export const driverStatuses = ['active', 'inactive'] as const;
export type DriverStatus = (typeof driverStatuses)[number];

const statusSql = driverStatuses.map((v) => `'${v}'`).join(', ');

/** Domain invariant: checks whether a driver's status, licence, and PrDP permit truck assignment. */
export function assertDriverEligibleForAssignment(
  profile: {
    status: string;
    licenceExpiresOn: string;
    prdpNumber: string | null;
    prdpExpiresOn: string | null;
  },
  today: string = operationalToday(),
): void {
  if (profile.status !== 'active') {
    throw new BadRequestError('Only active drivers can be assigned a truck.');
  }
  if (
    profile.licenceExpiresOn < today ||
    !profile.prdpNumber ||
    !profile.prdpExpiresOn ||
    profile.prdpExpiresOn < today
  ) {
    throw new BadRequestError(
      'A current licence and PrDP are required for truck assignment.',
    );
  }
}

export const DriverProfile = defineEntity({
  name: 'DriverProfile',
  tableName: 'driver_profiles',
  schema: 'app',
  indexes: [{ name: 'idx_driver_profiles_status', properties: ['status'] }],
  uniques: [
    {
      name: 'driver_profiles_licenceCountry_licenceNumber_key',
      properties: ['licenceCountry', 'licenceNumber'],
    },
  ],
  checks: [
    {
      name: 'driver_profiles_status_check',
      expression: `status IN (${statusSql})`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    user: () =>
      p
        .manyToOne(User)
        .fieldName('userId')
        .deleteRule('restrict')
        .unique(),
    identifier: p.string().length(40).unique(),
    phone: p.string().length(30),
    licenceNumber: p.string().length(80),
    licenceCode: p.string().length(10),
    licenceCountry: p.string().length(2),
    licenceExpiresOn: p.type(CalendarDateType).$type<string>(),
    prdpNumber: p.string().length(80).strictNullable(),
    prdpExpiresOn: p.type(CalendarDateType).$type<string>().strictNullable(),
    emergencyContactName: p.string().length(100).strictNullable(),
    emergencyContactPhone: p.string().length(30).strictNullable(),
    status: p.string().length(20).$type<DriverStatus>(),
    currentTruck: () =>
      p
        .manyToOne(Truck)
        .fieldName('currentTruckId')
        .strictNullable()
        .deleteRule('restrict')
        .unique(),
    notes: p.text().strictNullable(),
    createdBy: () =>
      p
        .manyToOne(User)
        .fieldName('createdById')
        .strictNullable()
        .deleteRule('set null'),
    ...timestampColumns(),
  },
});

export type DriverProfile = InferEntity<typeof DriverProfile>;
