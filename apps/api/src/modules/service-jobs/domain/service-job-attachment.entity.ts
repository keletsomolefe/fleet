import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  createdAtColumn,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { User } from '../../identity/domain/user.entity.js';
import { ServiceJobEvent } from './service-job-event.entity.js';
import { ServiceJob } from './service-job.entity.js';
import { ServiceProvider } from './service-provider.entity.js';

export const ServiceJobAttachment = defineEntity({
  name: 'ServiceJobAttachment',
  tableName: 'service_job_attachments',
  schema: 'app',
  indexes: [{ name: 'service_job_attachments_job', properties: ['job'] }],
  uniques: [
    {
      name: 'service_job_attachments_jobId_storageName_key',
      properties: ['job', 'storageName'],
    },
  ],
  checks: [
    {
      name: 'service_job_attachments_kind_check',
      expression: `"kind" in ('completion_photo')`,
    },
    {
      name: 'service_job_attachments_size_check',
      expression: '"byteSize" > 0',
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    job: () =>
      p.manyToOne(ServiceJob).fieldName('jobId').deleteRule('cascade'),
    event: () =>
      p
        .manyToOne(ServiceJobEvent)
        .fieldName('eventId')
        .strictNullable()
        .deleteRule('set null'),
    kind: p.string().length(24).$type<'completion_photo'>().default('completion_photo'),
    mimeType: p.string().length(64),
    byteSize: p.integer(),
    storageName: p.string().length(80),
    uploadedByProvider: () =>
      p
        .manyToOne(ServiceProvider)
        .fieldName('uploadedByProviderId')
        .strictNullable()
        .deleteRule('set null'),
    uploadedByUser: () =>
      p
        .manyToOne(User)
        .fieldName('uploadedByUserId')
        .strictNullable()
        .deleteRule('set null'),
    createdAt: createdAtColumn(),
  },
});

export type ServiceJobAttachment = InferEntity<typeof ServiceJobAttachment>;
