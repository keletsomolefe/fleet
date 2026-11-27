import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { BadRequestError } from '../../../shared/errors.js';
import { User } from '../../identity/domain/user.entity.js';

export const providerServices = [
  'mechanical',
  'tyres',
  'towing',
  'electrical',
  'bodywork',
  'fuel',
  'accident',
  'other',
] as const;

export type ProviderService = (typeof providerServices)[number];

const serviceListSql = providerServices
  .map((service) => `'${service}'`)
  .join(', ');

export const ServiceProvider = defineEntity({
  name: 'ServiceProvider',
  tableName: 'service_providers',
  schema: 'app',
  indexes: [
    {
      name: 'service_providers_status_name',
      properties: ['status', 'companyName'],
    },
  ],
  uniques: [
    {
      name: 'service_providers_whatsapp_key',
      properties: ['whatsappNumber'],
    },
  ],
  checks: [
    {
      name: 'service_providers_company_check',
      expression: `((length(btrim(("companyName")::text)) >= 1) AND (length(btrim(("companyName")::text)) <= 120))`,
    },
    {
      name: 'service_providers_contact_check',
      expression: `((length(btrim(("contactName")::text)) >= 1) AND (length(btrim(("contactName")::text)) <= 80))`,
    },
    {
      name: 'service_providers_whatsapp_check',
      expression: `"whatsappNumber" ~ '^[1-9][0-9]{7,14}$'`,
    },
    {
      name: 'service_providers_status_check',
      expression: `status IN ('active', 'paused')`,
    },
    {
      name: 'service_providers_services_check',
      expression: `services <@ ARRAY[${serviceListSql}]::text[]`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    companyName: p.string().length(120),
    contactName: p.string().length(80),
    whatsappNumber: p.string().length(15),
    phone: p.string().length(30).strictNullable(),
    email: p.string().length(320).strictNullable(),
    services: p
      .string()
      .array()
      .$type<ProviderService>()
      .columnType('text[]')
      .defaultRaw(`'{}'`),
    coverageArea: p.string().length(120).strictNullable(),
    notes: p.text().strictNullable(),
    status: p.string().length(16).$type<'active' | 'paused'>().default('active'),
    alertsEnabled: p.boolean().default(true),
    optedInAt: p.datetime().columnType('timestamptz').strictNullable(),
    optInBy: () =>
      p
        .manyToOne(User)
        .fieldName('optInById')
        .strictNullable()
        .deleteRule('set null'),
    optedOutAt: p.datetime().columnType('timestamptz').strictNullable(),
    optOutReason: p.text().strictNullable(),
    createdBy: () =>
      p
        .manyToOne(User)
        .fieldName('createdById')
        .strictNullable()
        .deleteRule('set null'),
    ...timestampColumns(),
  },
});

export type ServiceProvider = InferEntity<typeof ServiceProvider>;

export function canProviderReceiveAlerts(
  provider: Pick<
    ServiceProvider,
    'status' | 'alertsEnabled' | 'optedInAt' | 'optedOutAt' | 'whatsappNumber'
  >,
  audience?: readonly string[] | null,
): boolean {
  return (
    provider.status === 'active' &&
    provider.alertsEnabled &&
    provider.optedInAt !== null &&
    provider.optedOutAt === null &&
    Boolean(provider.whatsappNumber) &&
    (audience ? audience.includes(provider.whatsappNumber) : true)
  );
}

export function recordProviderConsent(
  provider: ServiceProvider,
  actor: User,
  at: Date = new Date(),
): void {
  provider.alertsEnabled = true;
  provider.status = 'active';
  provider.optedInAt = at;
  provider.optInBy = actor;
  provider.optedOutAt = null;
  provider.optOutReason = null;
}

export function optOutServiceProvider(
  provider: ServiceProvider,
  reason: string,
  at: Date = new Date(),
): boolean {
  if (provider.optedOutAt) return false;
  provider.alertsEnabled = false;
  provider.optedOutAt = at;
  provider.optOutReason = reason;
  return true;
}

export function updateProviderStatus(
  provider: ServiceProvider,
  status: 'active' | 'paused',
): void {
  if (status === 'active' && !provider.optedInAt) {
    throw new BadRequestError(
      'Record the provider’s WhatsApp consent before activating alerts.',
    );
  }
  provider.status = status;
}
