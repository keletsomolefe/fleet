import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import {
  offerStatuses,
  ServiceJob,
  type OfferStatus,
} from './service-job.entity.js';
import { ServiceProvider } from './service-provider.entity.js';

const offerStatusListSql = offerStatuses
  .map((status) => `'${status}'`)
  .join(', ');

const deliveryStatusRank: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export const ServiceJobOffer = defineEntity({
  name: 'ServiceJobOffer',
  tableName: 'service_job_offers',
  schema: 'app',
  indexes: [
    { name: 'service_job_offers_job', properties: ['job'] },
    { name: 'service_job_offers_provider', properties: ['provider'] },
    {
      name: 'service_job_offers_due',
      properties: ['nextAttemptAt'],
      where: `status = 'queued'`,
    },
    {
      name: 'service_job_offers_chat_completion_due',
      properties: ['chatCompletionExpiresAt'],
      where:
        '"chatCompletionExpiresAt" IS NOT NULL AND "chatCompletionRemindedAt" IS NULL',
    },
  ],
  uniques: [
    {
      name: 'service_job_offers_jobId_providerId_key',
      properties: ['job', 'provider'],
    },
    {
      name: 'service_job_offers_accepted',
      properties: ['job'],
      where: `status = 'accepted'`,
    },
    {
      name: 'service_job_offers_message_key',
      properties: ['whatsappMessageId'],
      where: '"whatsappMessageId" IS NOT NULL',
    },
  ],
  checks: [
    {
      name: 'service_job_offers_status_check',
      expression: `status IN (${offerStatusListSql})`,
    },
    {
      name: 'service_job_offers_channel_check',
      expression: `"responseChannel" IS NULL OR "responseChannel" IN ('web', 'whatsapp', 'admin')`,
    },
    {
      name: 'service_job_offers_attempts_check',
      expression: 'attempts >= 0',
    },
    {
      name: 'service_job_offers_link_version_check',
      expression: '"linkVersion" >= 1',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    job: () =>
      p.manyToOne(ServiceJob).fieldName('jobId').deleteRule('cascade'),
    provider: () =>
      p
        .manyToOne(ServiceProvider)
        .fieldName('providerId')
        .deleteRule('restrict'),
    revokedAt: p.datetime().columnType('timestamptz').strictNullable(),
    chatCompletionPhone: p.string().length(15).strictNullable(),
    chatCompletionStartedAt: p.datetime().columnType('timestamptz').strictNullable(),
    chatCompletionExpiresAt: p.datetime().columnType('timestamptz').strictNullable(),
    chatCompletionRemindedAt: p.datetime().columnType('timestamptz').strictNullable(),
    chatCompletionMediaIds: p.json<string[]>().columnType('jsonb').strictNullable(),
    chatCompletionCostCents: p.integer().strictNullable(),
    linkVersion: p.integer().default(1),
    status: p.string().length(20).$type<OfferStatus>().default('queued'),
    attempts: p.integer().default(0),
    nextAttemptAt: p
      .datetime()
      .columnType('timestamptz')
      .defaultRaw('now()')
      .onCreate(() => new Date()),
    sendingAt: p.datetime().columnType('timestamptz').strictNullable(),
    sentAt: p.datetime().columnType('timestamptz').strictNullable(),
    deliveredAt: p.datetime().columnType('timestamptz').strictNullable(),
    readAt: p.datetime().columnType('timestamptz').strictNullable(),
    respondedAt: p.datetime().columnType('timestamptz').strictNullable(),
    whatsappMessageId: p.string().length(128).strictNullable(),
    lastErrorCode: p.string().length(32).strictNullable(),
    lastErrorTitle: p.text().strictNullable(),
    responderName: p.string().length(80).strictNullable(),
    responseChannel: p
      .string()
      .length(16)
      .$type<'web' | 'whatsapp' | 'admin'>()
      .strictNullable(),
    ...timestampColumns(),
  },
});

export type ServiceJobOffer = InferEntity<typeof ServiceJobOffer>;

export function clearOfferChatCompletion(offer: ServiceJobOffer): void {
  offer.chatCompletionPhone = null;
  offer.chatCompletionStartedAt = null;
  offer.chatCompletionExpiresAt = null;
  offer.chatCompletionRemindedAt = null;
  offer.chatCompletionMediaIds = null;
  offer.chatCompletionCostCents = null;
}

export function requeueOffer(
  offer: ServiceJobOffer,
  at: Date = new Date(),
): void {
  offer.status = 'queued';
  offer.linkVersion += 1;
  offer.revokedAt = null;
  clearOfferChatCompletion(offer);
  offer.attempts = 0;
  offer.nextAttemptAt = at;
  offer.sendingAt = null;
  offer.sentAt = null;
  offer.deliveredAt = null;
  offer.readAt = null;
  offer.respondedAt = null;
  offer.whatsappMessageId = null;
  offer.lastErrorCode = null;
  offer.lastErrorTitle = null;
  offer.responderName = null;
  offer.responseChannel = null;
}

export function revokeOffer(
  offer: ServiceJobOffer,
  at: Date = new Date(),
): void {
  offer.linkVersion += 1;
  offer.revokedAt = at;
  clearOfferChatCompletion(offer);
}

export function recordOfferResponse(
  offer: ServiceJobOffer,
  status: 'accepted' | 'declined',
  channel: 'web' | 'whatsapp' | 'admin',
  responderName: string,
  at: Date = new Date(),
): void {
  offer.status = status;
  offer.respondedAt = at;
  offer.responseChannel = channel;
  offer.responderName = responderName;
}

export function assignOfferByAdmin(
  offer: ServiceJobOffer,
  adminName: string,
  at: Date = new Date(),
): void {
  offer.status = 'accepted';
  offer.linkVersion += 1;
  offer.revokedAt = null;
  clearOfferChatCompletion(offer);
  offer.respondedAt = at;
  offer.responseChannel = 'admin';
  offer.responderName = adminName;
  offer.lastErrorCode = null;
  offer.lastErrorTitle = null;
  offer.sendingAt = null;
}

export function recordOfferDeliveryStatus(
  offer: ServiceJobOffer,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  error?: { code?: string; title?: string },
  at: Date = new Date(),
): void {
  const finalized = ['accepted', 'declined', 'expired'].includes(offer.status);
  if (status === 'failed') {
    offer.lastErrorCode = error?.code ?? null;
    offer.lastErrorTitle = error?.title ?? null;
    if (!finalized) offer.status = 'failed';
    return;
  }
  const current = deliveryStatusRank[offer.status] ?? 0;
  if (deliveryStatusRank[status] > current && !finalized) {
    offer.status = status;
  }
  if (status === 'sent') offer.sentAt ??= at;
  if (status === 'delivered') offer.deliveredAt ??= at;
  if (status === 'read') offer.readAt ??= at;
}
