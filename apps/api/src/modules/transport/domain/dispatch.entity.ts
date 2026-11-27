import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';
import type { Unit } from './pricing.js';

export const dispatchStatuses = [
  'draft',
  'dispatched',
  'completed',
  'cancelled',
] as const;

export type DispatchStatus = (typeof dispatchStatuses)[number];

export interface CatalogueRef {
  id: string | null;
  name: string;
}

export interface DispatchDeliveryStop {
  id: string;
  destination: CatalogueRef;
  receiver: CatalogueRef;
  quantity: string;
  collectedQuantity: string | null;
}

export interface DispatchPlan {
  customer: CatalogueRef;
  product: CatalogueRef;
  supplier: CatalogueRef;
  origin: CatalogueRef;
  quantity: string;
  unit: Unit;
  instructions: string;
  collectionId: string;
  deliveries: DispatchDeliveryStop[];
}

export const Dispatch = defineEntity({
  name: 'Dispatch',
  tableName: 'dispatches',
  schema: 'app',
  indexes: [
    {
      name: 'ix_dispatch_driver',
      properties: ['driver', 'date'],
    },
    {
      name: 'ix_dispatch_truck',
      properties: ['truck', 'date'],
    },
  ],
  uniques: [
    {
      name: 'dispatches_reference_unique',
      properties: ['reference'],
    },
  ],
  checks: [
    {
      name: 'dispatches_status_check',
      expression: `status IN ('draft', 'dispatched', 'completed', 'cancelled')`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    reference: p.string().length(80),
    date: p.type(CalendarDateType).$type<string>(),
    driver: () =>
      p.manyToOne(DriverProfile).fieldName('driverId').deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    plan: p.json<DispatchPlan>(),
    status: p.string().length(20).$type<DispatchStatus>().default('dispatched'),
    version: p.integer().default(1),
    createdBy: () =>
      p.manyToOne(User).fieldName('createdById').deleteRule('restrict'),
    ...timestampColumns(),
  },
});

export type Dispatch = InferEntity<typeof Dispatch>;
