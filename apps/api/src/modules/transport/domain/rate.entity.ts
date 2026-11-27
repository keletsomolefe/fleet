import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import { CalendarDateType } from '../../../database/calendar-date.type.js';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { User } from '../../identity/domain/user.entity.js';
import { CustomerProduct, Location } from './catalogue.entity.js';
import { unitKeys, type Unit } from './pricing.js';

export const rateMethods = ['quantity', 'delivery'] as const;
export type RateMethod = (typeof rateMethods)[number];

export const rateBases = ['collected', 'delivered'] as const;
export type RateBasis = (typeof rateBases)[number];

const unitsSql = unitKeys.map((value) => `'${value}'`).join(', ');

export const TransportRate = defineEntity({
  name: 'TransportRate',
  tableName: 'transport_rates',
  schema: 'app',
  indexes: [
    {
      name: 'ix_transport_rate_scope',
      properties: ['customerProduct', 'origin', 'destination', 'startsOn'],
    },
  ],
  checks: [
    {
      name: 'transport_rates_method_check',
      expression: `method IN ('quantity', 'delivery')`,
    },
    {
      name: 'transport_rates_basis_check',
      expression: `basis IN ('collected', 'delivered')`,
    },
    {
      name: 'transport_rates_unit_check',
      expression: `unit IN (${unitsSql})`,
    },
    {
      name: 'transport_rates_price_check',
      expression: 'price >= 0',
    },
    {
      name: 'transport_rates_window_check',
      expression: '"endsOn" IS NULL OR "endsOn" >= "startsOn"',
    },
    {
      name: 'transport_rates_route_pair_check',
      expression: '("originId" IS NULL) = ("destinationId" IS NULL)',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    customerProduct: () =>
      p
        .manyToOne(CustomerProduct)
        .fieldName('customerProductId')
        .deleteRule('restrict'),
    origin: () =>
      p
        .manyToOne(Location)
        .fieldName('originId')
        .strictNullable()
        .deleteRule('restrict'),
    destination: () =>
      p
        .manyToOne(Location)
        .fieldName('destinationId')
        .strictNullable()
        .deleteRule('restrict'),
    method: p.string().length(20).$type<RateMethod>(),
    basis: p.string().length(20).$type<RateBasis>(),
    unit: p.string().length(20).$type<Unit>(),
    price: p.decimal('string').precision(20).scale(6),
    startsOn: p.type(CalendarDateType).$type<string>(),
    endsOn: p.type(CalendarDateType).$type<string | null>().strictNullable(),
    createdBy: () =>
      p.manyToOne(User).fieldName('createdById').deleteRule('restrict'),
    createdAt: createdAtColumn(),
  },
});

export type TransportRate = InferEntity<typeof TransportRate>;
