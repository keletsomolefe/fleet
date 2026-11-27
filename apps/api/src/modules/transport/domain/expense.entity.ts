import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';
import { ServiceJob } from '../../service-jobs/domain/service-job.entity.js';

export const truckExpenseCategories = [
  'fuel',
  'repair',
  'tyres',
  'toll',
  'weighbridge',
  'maintenance',
  'insurance',
  'licence',
  'permits',
  'parking',
  'other',
] as const;

export type TruckExpenseCategory = (typeof truckExpenseCategories)[number];

/** Expense categories counted under Repairs & Maintenance spend in month-end P&L. */
export const repairExpenseCategories: readonly TruckExpenseCategory[] = [
  'repair',
  'tyres',
  'maintenance',
];

const categoriesSql = truckExpenseCategories
  .map((value) => `'${value}'`)
  .join(', ');

export const TruckExpense = defineEntity({
  name: 'TruckExpense',
  tableName: 'truck_expenses',
  schema: 'app',
  indexes: [
    {
      name: 'ix_truck_expenses_truck_date',
      properties: ['truck', 'occurredOn'],
      where: '"voidedAt" IS NULL',
    },
    {
      name: 'ix_truck_expenses_date_category',
      properties: ['occurredOn', 'category'],
      where: '"voidedAt" IS NULL',
    },
  ],
  checks: [
    {
      name: 'truck_expenses_category_check',
      expression: `category IN (${categoriesSql})`,
    },
    {
      name: 'truck_expenses_amount_check',
      expression: 'amount >= 0',
    },
    {
      name: 'truck_expenses_litres_check',
      expression: 'litres IS NULL OR litres >= 0',
    },
    {
      name: 'truck_expenses_odometer_check',
      expression: '"odometerKm" IS NULL OR "odometerKm" >= 0',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    driver: () =>
      p
        .manyToOne(DriverProfile)
        .fieldName('driverId')
        .strictNullable()
        .deleteRule('set null'),
    serviceJob: () =>
      p
        .manyToOne(ServiceJob)
        .fieldName('serviceJobId')
        .strictNullable()
        .deleteRule('set null'),
    occurredOn: p.type(CalendarDateType).$type<string>(),
    category: p.string().length(24).$type<TruckExpenseCategory>(),
    vendor: p.string().length(160).default(''),
    invoiceNumber: p.string().length(80).default(''),
    amount: p.decimal('string').precision(20).scale(2),
    litres: p.decimal('string').precision(12).scale(3).strictNullable(),
    odometerKm: p.decimal('string').precision(12).scale(1).strictNullable(),
    notes: p.text().default(''),
    voidedAt: p.datetime().columnType('timestamptz').strictNullable(),
    voidedBy: () =>
      p
        .manyToOne(User)
        .fieldName('voidedById')
        .strictNullable()
        .deleteRule('set null'),
    voidReason: p.text().strictNullable(),
    createdBy: () =>
      p.manyToOne(User).fieldName('createdById').deleteRule('restrict'),
    ...timestampColumns(),
  },
});

export type TruckExpense = InferEntity<typeof TruckExpense>;
