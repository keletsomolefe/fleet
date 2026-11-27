import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { unitKeys, type Unit } from './pricing.js';

export const siteTypes = [
  'collection',
  'delivery',
  'both',
  'fuel_station',
  'yard',
] as const;

export type SiteType = (typeof siteTypes)[number];

const siteTypesSql = siteTypes.map((value) => `'${value}'`).join(', ');
const unitsSql = unitKeys.map((value) => `'${value}'`).join(', ');

export const Customer = defineEntity({
  name: 'Customer',
  tableName: 'customers',
  schema: 'app',
  properties: {
    id: uuidPrimaryKey(),
    name: p.string().length(200),
    industry: p.string().length(120).default(''),
    contact: p.string().length(200).default(''),
    email: p.string().length(200).default(''),
    phone: p.string().length(40).default(''),
    notes: p.text().default(''),
    active: p.boolean().default(true),
    version: p.integer().default(1),
    ...timestampColumns(),
  },
});

export type Customer = InferEntity<typeof Customer>;

export const Location = defineEntity({
  name: 'Location',
  tableName: 'locations',
  schema: 'app',
  checks: [
    {
      name: 'locations_site_type_check',
      expression: `"siteType" IN (${siteTypesSql})`,
    },
    {
      name: 'locations_latitude_check',
      expression: 'latitude IS NULL OR (latitude >= -90 AND latitude <= 90)',
    },
    {
      name: 'locations_longitude_check',
      expression:
        'longitude IS NULL OR (longitude >= -180 AND longitude <= 180)',
    },
    {
      name: 'locations_coordinates_pair_check',
      expression: '(latitude IS NULL) = (longitude IS NULL)',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    name: p.string().length(200),
    siteType: p.string().length(20).$type<SiteType>().default('both'),
    directions: p.text().default(''),
    contact: p.string().length(200).default(''),
    phone: p.string().length(40).default(''),
    customerIds: p.uuid().array().$type<string>().default([]),
    latitude: p.double().strictNullable(),
    longitude: p.double().strictNullable(),
    active: p.boolean().default(true),
    version: p.integer().default(1),
    ...timestampColumns(),
  },
});

export type Location = InferEntity<typeof Location>;

export const Product = defineEntity({
  name: 'Product',
  tableName: 'products',
  schema: 'app',
  checks: [
    {
      name: 'products_unit_check',
      expression: `unit IN (${unitsSql})`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    name: p.string().length(200),
    unit: p.string().length(20).$type<Unit>(),
    active: p.boolean().default(true),
    version: p.integer().default(1),
    ...timestampColumns(),
  },
});

export type Product = InferEntity<typeof Product>;

export const CustomerProduct = defineEntity({
  name: 'CustomerProduct',
  tableName: 'customer_products',
  schema: 'app',
  uniques: [
    {
      name: 'uq_customer_products_pair',
      properties: ['customer', 'product'],
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    customer: () =>
      p.manyToOne(Customer).fieldName('customerId').deleteRule('restrict'),
    product: () =>
      p.manyToOne(Product).fieldName('productId').deleteRule('restrict'),
    supplies: p.boolean().default(false),
    receives: p.boolean().default(false),
    active: p.boolean().default(true),
    version: p.integer().default(1),
    ...timestampColumns(),
  },
});

export type CustomerProduct = InferEntity<typeof CustomerProduct>;
