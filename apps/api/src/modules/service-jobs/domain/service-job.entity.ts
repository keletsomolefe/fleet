import { defineEntity, p, type InferEntity } from '@mikro-orm/postgresql';
import {
  timestampColumns,
  uuidPrimaryKey,
} from '../../../shared/entity-columns.js';
import { ConflictError } from '../../../shared/errors.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import { User } from '../../identity/domain/user.entity.js';
import { DriverIssue } from '../../issues/domain/driver-issue.entity.js';
import { ServiceProvider } from './service-provider.entity.js';

export const serviceTypes = [
  'mechanical',
  'tyres',
  'towing',
  'electrical',
  'bodywork',
  'fuel',
  'accident',
  'other',
] as const;
export type ServiceType = (typeof serviceTypes)[number];

export const jobStatuses = [
  'open',
  'assigned',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const activeJobStatuses: readonly JobStatus[] = [
  'open',
  'assigned',
  'in_progress',
];
export const assignedJobStatuses: readonly JobStatus[] = [
  'assigned',
  'in_progress',
];

export const offerStatuses = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'accepted',
  'declined',
  'failed',
  'expired',
] as const;
export type OfferStatus = (typeof offerStatuses)[number];

export const progressStages = ['en_route', 'arrived', 'working'] as const;
export type ProgressStage = (typeof progressStages)[number];

export const eventKinds = [
  'created',
  'alerts_queued',
  'alerts_skipped',
  'alert_requeued',
  'accepted',
  'declined',
  'en_route',
  'arrived',
  'working',
  'completed',
  'closed',
  'reopened',
  'cancelled',
  'reassigned',
  'assigned',
  'admin_note',
  'issue_resolved',
  'issue_reopened',
  'link_revoked',
  'provider_opted_out',
] as const;
export type EventKind = (typeof eventKinds)[number];

const serviceListSql = serviceTypes.map((type) => `'${type}'`).join(', ');
const statusListSql = jobStatuses.map((status) => `'${status}'`).join(', ');

export const ServiceJob = defineEntity({
  name: 'ServiceJob',
  tableName: 'service_jobs',
  schema: 'app',
  indexes: [
    {
      name: 'service_jobs_status_created',
      properties: ['status', 'createdAt'],
    },
    {
      name: 'service_jobs_truck_created',
      properties: ['truck', 'createdAt'],
    },
    {
      name: 'service_jobs_issue',
      properties: ['issue'],
      where: '"issueId" IS NOT NULL',
    },
    {
      name: 'service_jobs_provider',
      properties: ['provider'],
      where: '"providerId" IS NOT NULL',
    },
  ],
  uniques: [
    {
      name: 'service_jobs_active_issue',
      properties: ['issue'],
      where: `"issueId" IS NOT NULL AND status IN ('open', 'assigned', 'in_progress')`,
    },
    {
      name: 'service_jobs_reference_key',
      properties: ['reference'],
    },
  ],
  checks: [
    {
      name: 'service_jobs_reference_check',
      expression: `reference ~ '^SJ-[0-9]{6,}$'`,
    },
    {
      name: 'service_jobs_service_type_check',
      expression: `"serviceType" IN (${serviceListSql})`,
    },
    {
      name: 'service_jobs_title_check',
      expression: `((length(btrim((title)::text)) >= 1) AND (length(btrim((title)::text)) <= 120))`,
    },
    {
      name: 'service_jobs_description_check',
      expression: `((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 2000))`,
    },
    {
      name: 'service_jobs_urgency_check',
      expression: `urgency IN ('urgent', 'normal')`,
    },
    {
      name: 'service_jobs_status_check',
      expression: `status IN (${statusListSql})`,
    },
    {
      name: 'service_jobs_source_check',
      expression: `source IN ('driver', 'admin')`,
    },
    {
      name: 'service_jobs_latitude_check',
      expression: `latitude IS NULL OR (latitude >= -90 AND latitude <= 90)`,
    },
    {
      name: 'service_jobs_longitude_check',
      expression: `longitude IS NULL OR (longitude >= -180 AND longitude <= 180)`,
    },
    {
      name: 'service_jobs_accuracy_check',
      expression: `"locationAccuracyM" IS NULL OR "locationAccuracyM" >= 0`,
    },
    {
      name: 'service_jobs_cost_check',
      expression: `"completionCostCents" IS NULL OR "completionCostCents" >= 0`,
    },
    {
      name: 'service_jobs_currency_check',
      expression: `currency ~ '^[A-Z]{3}$'`,
    },
  ],
  properties: {
    id: uuidPrimaryKey(),
    reference: p.string().length(24),
    issue: () =>
      p
        .manyToOne(DriverIssue)
        .fieldName('issueId')
        .strictNullable()
        .deleteRule('restrict'),
    truck: () =>
      p.manyToOne(Truck).fieldName('truckId').deleteRule('restrict'),
    driver: () =>
      p
        .manyToOne(DriverProfile)
        .fieldName('driverId')
        .strictNullable()
        .deleteRule('restrict'),
    serviceType: p.string().length(24).$type<ServiceType>(),
    title: p.string().length(120),
    description: p.text(),
    locationText: p.string().length(300).strictNullable(),
    latitude: p.double().strictNullable(),
    longitude: p.double().strictNullable(),
    locationAccuracyM: p.double().strictNullable(),
    locationCapturedAt: p.datetime().columnType('timestamptz').strictNullable(),
    urgency: p.string().length(16).$type<'urgent' | 'normal'>().default('urgent'),
    status: p.string().length(24).$type<JobStatus>().default('open'),
    provider: () =>
      p
        .manyToOne(ServiceProvider)
        .fieldName('providerId')
        .strictNullable()
        .deleteRule('restrict'),
    broadcastAt: p.datetime().columnType('timestamptz').strictNullable(),
    acceptedAt: p.datetime().columnType('timestamptz').strictNullable(),
    startedAt: p.datetime().columnType('timestamptz').strictNullable(),
    completedAt: p.datetime().columnType('timestamptz').strictNullable(),
    completionNote: p.text().strictNullable(),
    completionCostCents: p.integer().strictNullable(),
    currency: p.string().length(3).default('ZAR'),
    closedAt: p.datetime().columnType('timestamptz').strictNullable(),
    closedBy: () =>
      p
        .manyToOne(User)
        .fieldName('closedById')
        .strictNullable()
        .deleteRule('restrict'),
    closeNote: p.text().strictNullable(),
    resolvedIssueOnClose: p.boolean().default(false),
    cancelledAt: p.datetime().columnType('timestamptz').strictNullable(),
    cancelledBy: () =>
      p
        .manyToOne(User)
        .fieldName('cancelledById')
        .strictNullable()
        .deleteRule('restrict'),
    cancelReason: p.text().strictNullable(),
    source: p.string().length(16).$type<'driver' | 'admin'>(),
    createdBy: () =>
      p
        .manyToOne(User)
        .fieldName('createdById')
        .strictNullable()
        .deleteRule('set null'),
    ...timestampColumns(),
  },
});

export type ServiceJob = InferEntity<typeof ServiceJob>;

export function isServiceJobActive(job: Pick<ServiceJob, 'status'>): boolean {
  return activeJobStatuses.includes(job.status);
}

export function assignServiceJobProvider(
  job: ServiceJob,
  provider: ServiceProvider,
  at: Date = new Date(),
): JobStatus {
  if (!activeJobStatuses.includes(job.status)) {
    throw new ConflictError('This job cannot be reassigned.');
  }
  const previous = job.status;
  job.provider = provider;
  job.status = 'assigned';
  job.acceptedAt = at;
  return previous;
}

export function acceptServiceJob(
  job: ServiceJob,
  provider: ServiceProvider,
  at: Date = new Date(),
): void {
  job.status = 'assigned';
  job.provider = provider;
  job.acceptedAt = at;
}

export function markServiceJobInProgress(
  job: ServiceJob,
  at: Date = new Date(),
): JobStatus {
  if (!assignedJobStatuses.includes(job.status)) {
    throw new ConflictError('This job is no longer in progress.');
  }
  const previous = job.status;
  job.status = 'in_progress';
  job.startedAt ??= at;
  return previous;
}

export function completeServiceJob(
  job: ServiceJob,
  note: string,
  costCents: number | null,
  currency: string,
  at: Date = new Date(),
): JobStatus {
  if (!assignedJobStatuses.includes(job.status)) {
    throw new ConflictError('This job cannot be completed.');
  }
  const previous = job.status;
  job.status = 'completed';
  job.completedAt = at;
  job.completionNote = note;
  job.completionCostCents = costCents;
  job.currency = currency;
  return previous;
}

export function closeServiceJob(
  job: ServiceJob,
  byUser: User,
  note: string,
  at: Date = new Date(),
): JobStatus {
  if (job.status === 'closed') {
    throw new ConflictError('This job is already closed.');
  }
  if (job.status === 'cancelled') {
    throw new ConflictError('This job was cancelled.');
  }
  const previous = job.status;
  job.status = 'closed';
  job.closedAt = at;
  job.closedBy = byUser;
  job.closeNote = note;
  job.resolvedIssueOnClose = false;
  return previous;
}

export function reopenServiceJob(job: ServiceJob): {
  wasIssueResolved: boolean;
  nextStatus: JobStatus;
} {
  if (job.status !== 'closed') {
    throw new ConflictError('Only a closed job can be reopened.');
  }
  const wasIssueResolved = job.resolvedIssueOnClose;
  job.status = job.provider ? 'in_progress' : 'open';
  job.closedAt = null;
  job.closedBy = null;
  job.closeNote = null;
  job.resolvedIssueOnClose = false;
  return { wasIssueResolved, nextStatus: job.status };
}

export function cancelServiceJob(
  job: ServiceJob,
  byUser: User,
  reason: string,
  at: Date = new Date(),
): JobStatus {
  if (!activeJobStatuses.includes(job.status)) {
    throw new ConflictError('This job cannot be cancelled.');
  }
  const previous = job.status;
  job.status = 'cancelled';
  job.cancelledAt = at;
  job.cancelledBy = byUser;
  job.cancelReason = reason;
  return previous;
}
