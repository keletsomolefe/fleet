import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { User } from '../../identity/domain/user.entity.js';
import {
  ServiceJob,
  type EventKind,
  type JobStatus,
} from './service-job.entity.js';
import { ServiceProvider } from './service-provider.entity.js';

export const ServiceJobEvent = defineEntity({
  name: 'ServiceJobEvent',
  tableName: 'service_job_events',
  schema: 'app',
  indexes: [
    {
      name: 'service_job_events_job_created',
      properties: ['job', 'createdAt'],
    },
  ],
  checks: [
    {
      name: 'service_job_events_actor_check',
      expression: `"actorType" IN ('driver', 'admin', 'provider', 'system')`,
    },
    {
      name: 'service_job_events_channel_check',
      expression: `channel IS NULL OR channel IN ('app', 'dashboard', 'web', 'whatsapp', 'system')`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    job: () =>
      p.manyToOne(ServiceJob).fieldName('jobId').deleteRule('cascade'),
    kind: p.string().length(32).$type<EventKind>(),
    actorType: p
      .string()
      .length(16)
      .$type<'driver' | 'admin' | 'provider' | 'system'>(),
    actorUser: () =>
      p
        .manyToOne(User)
        .fieldName('actorUserId')
        .strictNullable()
        .deleteRule('set null'),
    provider: () =>
      p
        .manyToOne(ServiceProvider)
        .fieldName('providerId')
        .strictNullable()
        .deleteRule('set null'),
    actorName: p.string().length(120).strictNullable(),
    channel: p
      .string()
      .length(16)
      .$type<'app' | 'dashboard' | 'web' | 'whatsapp' | 'system'>()
      .strictNullable(),
    fromStatus: p.string().length(24).$type<JobStatus>().strictNullable(),
    toStatus: p.string().length(24).$type<JobStatus>().strictNullable(),
    note: p.text().strictNullable(),
    metadata: p
      .json<Record<string, unknown>>()
      .columnType('jsonb')
      .strictNullable(),
    createdAt: createdAtColumn(),
  },
});

export type ServiceJobEvent = InferEntity<typeof ServiceJobEvent>;
