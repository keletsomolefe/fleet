import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { ServiceJobOffer } from '../../service-jobs/domain/service-job-offer.entity.js';
import { ServiceJob } from '../../service-jobs/domain/service-job.entity.js';
import { ServiceProvider } from '../../service-jobs/domain/service-provider.entity.js';

export const whatsappMessageKinds = [
  'template',
  'interactive',
  'text',
  'status',
  'unknown',
] as const;
export type WhatsAppMessageKind = (typeof whatsappMessageKinds)[number];

export const whatsappMessageStatuses = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'received',
] as const;
export type WhatsAppMessageStatus =
  (typeof whatsappMessageStatuses)[number];

const kindListSql = whatsappMessageKinds.map((kind) => `'${kind}'`).join(', ');
const statusListSql = whatsappMessageStatuses
  .map((status) => `'${status}'`)
  .join(', ');

export const WhatsAppMessage = defineEntity({
  name: 'WhatsAppMessage',
  tableName: 'whatsapp_messages',
  schema: 'app',
  indexes: [
    {
      name: 'whatsapp_messages_job_created',
      properties: ['job', 'createdAt'],
    },
    {
      name: 'whatsapp_messages_provider_created',
      properties: ['provider', 'createdAt'],
    },
  ],
  uniques: [
    {
      name: 'whatsapp_messages_wamid_key',
      properties: ['wamid'],
      where: 'wamid IS NOT NULL',
    },
  ],
  checks: [
    {
      name: 'whatsapp_messages_direction_check',
      expression: `direction IN ('inbound', 'outbound')`,
    },
    {
      name: 'whatsapp_messages_kind_check',
      expression: `kind IN (${kindListSql})`,
    },
    {
      name: 'whatsapp_messages_status_check',
      expression: `status IS NULL OR status IN (${statusListSql})`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    wamid: p.string().length(128).strictNullable(),
    direction: p.string().length(8).$type<'inbound' | 'outbound'>(),
    kind: p.string().length(20).$type<WhatsAppMessageKind>(),
    job: () =>
      p
        .manyToOne(ServiceJob)
        .fieldName('jobId')
        .strictNullable()
        .deleteRule('set null'),
    offer: () =>
      p
        .manyToOne(ServiceJobOffer)
        .fieldName('offerId')
        .strictNullable()
        .deleteRule('set null'),
    provider: () =>
      p
        .manyToOne(ServiceProvider)
        .fieldName('providerId')
        .strictNullable()
        .deleteRule('set null'),
    fromNumber: p.string().length(15).strictNullable(),
    profileName: p.string().length(120).strictNullable(),
    status: p.string().length(20).$type<WhatsAppMessageStatus>().strictNullable(),
    templateName: p.string().length(80).strictNullable(),
    errorCode: p.string().length(32).strictNullable(),
    errorTitle: p.text().strictNullable(),
    contextWamid: p.string().length(128).strictNullable(),
    ...timestampColumns(),
  },
});

export type WhatsAppMessage = InferEntity<typeof WhatsAppMessage>;
