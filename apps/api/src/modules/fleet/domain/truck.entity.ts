import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { BadRequestError } from '../../../shared/errors.js';
import { User } from '../../identity/domain/user.entity.js';

export const truckCategories = [
  'rigid',
  'tractor',
  'tipper',
  'tanker',
  'flatbed',
  'other',
] as const;
export type TruckCategory = (typeof truckCategories)[number];

export const fuelTypes = [
  'diesel',
  'petrol',
  'electric',
  'hybrid',
  'other',
] as const;
export type FuelType = (typeof fuelTypes)[number];

export const transmissionTypes = [
  'manual',
  'automatic',
  'automated',
] as const;
export type TransmissionType = (typeof transmissionTypes)[number];

export const truckStatuses = ['active', 'maintenance', 'inactive'] as const;
export type TruckStatus = (typeof truckStatuses)[number];

const categorySql = truckCategories.map((v) => `'${v}'`).join(', ');
const fuelSql = fuelTypes.map((v) => `'${v}'`).join(', ');
const transmissionSql = transmissionTypes.map((v) => `'${v}'`).join(', ');
const statusSql = truckStatuses.map((v) => `'${v}'`).join(', ');

export const Truck = defineEntity({
  name: 'Truck',
  tableName: 'trucks',
  schema: 'app',
  indexes: [{ name: 'idx_trucks_status', properties: ['status'] }],
  checks: [
    { name: 'trucks_category_check', expression: `category IN (${categorySql})` },
    { name: 'trucks_fuel_type_check', expression: `"fuelType" IN (${fuelSql})` },
    {
      name: 'trucks_transmission_check',
      expression: `transmission IS NULL OR transmission IN (${transmissionSql})`,
    },
    { name: 'trucks_status_check', expression: `status IN (${statusSql})` },
    { name: 'trucks_odometer_check', expression: '"odometerKm" >= 0' },
  ],
  properties: {
    id: uuidPrimaryKey(),
    identifier: p.string().length(40).unique(),
    registration: p.string().length(30).unique(),
    registrationCountry: p.string().length(2),
    make: p.string().length(80),
    model: p.string().length(80),
    year: p.integer().strictNullable(),
    vin: p.string().length(17).strictNullable().unique(),
    engineNumber: p.string().length(80).strictNullable(),
    category: p.string().length(30).$type<TruckCategory>(),
    fuelType: p.string().length(20).$type<FuelType>(),
    transmission: p.string().length(20).$type<TransmissionType>().strictNullable(),
    axleCount: p.integer().strictNullable(),
    grossVehicleMassKg: p.integer().strictNullable(),
    tareKg: p.integer().strictNullable(),
    payloadCapacityKg: p.integer().strictNullable(),
    odometerKm: p.integer(),
    tankCapacityLitres: p.integer().strictNullable(),
    licenceDiscExpiresOn: p.type(CalendarDateType).$type<string>().strictNullable(),
    roadworthyExpiresOn: p.type(CalendarDateType).$type<string>().strictNullable(),
    insuranceProvider: p.string().length(100).strictNullable(),
    insurancePolicyNumber: p.string().length(100).strictNullable(),
    insuranceExpiresOn: p.type(CalendarDateType).$type<string>().strictNullable(),
    serviceIntervalKm: p.integer().strictNullable(),
    nextServiceDueKm: p.integer().strictNullable(),
    status: p.string().length(20).$type<TruckStatus>(),
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

export type Truck = InferEntity<typeof Truck>;

export function isTruckActive(truck: Pick<Truck, 'status'>): boolean {
  return truck.status === 'active';
}

export function assertOdometerNotDecreasing(
  truck: Pick<Truck, 'odometerKm'>,
  nextOdometerKm: number,
): void {
  if (nextOdometerKm < truck.odometerKm) {
    throw new BadRequestError('Odometer cannot decrease.');
  }
}
