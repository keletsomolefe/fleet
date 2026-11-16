import { entityId } from '../database/database.js';
import {
  Check,
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import type { Rel } from '@mikro-orm/postgresql';
import { DriverIssue } from '../issues/issue.entity.js';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { User } from '../users/user.entity.js';
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
const offerStatusListSql = offerStatuses
  .map((status) => `'${status}'`)
  .join(', ');

@Entity({ tableName: 'service_jobs', schema: 'app' })
@Index({
  name: 'service_jobs_status_created',
  properties: ['status', 'createdAt'],
})
@Index({
  name: 'service_jobs_truck_created',
  properties: ['truck', 'createdAt'],
})
@Index({
  name: 'service_jobs_issue',
  properties: ['issue'],
  where: '"issueId" IS NOT NULL',
})
@Index({
  name: 'service_jobs_provider',
  properties: ['provider'],
  where: '"providerId" IS NOT NULL',
})
@Unique({
  name: 'service_jobs_active_truck',
  properties: ['truck'],
  where: `status IN ('open', 'assigned', 'in_progress')`,
})
@Unique({
  name: 'service_jobs_reference_key',
  properties: ['reference'],
})
@Check({
  name: 'service_jobs_reference_check',
  expression: `reference ~ '^SJ-[0-9]{6,}$'`,
})
@Check({
  name: 'service_jobs_service_type_check',
  expression: `"serviceType" IN (${serviceListSql})`,
})
@Check({
  name: 'service_jobs_title_check',
  expression: `((length(btrim((title)::text)) >= 1) AND (length(btrim((title)::text)) <= 120))`,
})
@Check({
  name: 'service_jobs_description_check',
  expression: `((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 2000))`,
})
@Check({
  name: 'service_jobs_urgency_check',
  expression: `urgency IN ('urgent', 'normal')`,
})
@Check({
  name: 'service_jobs_status_check',
  expression: `status IN (${statusListSql})`,
})
@Check({
  name: 'service_jobs_source_check',
  expression: `source IN ('driver', 'admin')`,
})
@Check({
  name: 'service_jobs_latitude_check',
  expression: `latitude IS NULL OR (latitude >= -90 AND latitude <= 90)`,
})
@Check({
  name: 'service_jobs_longitude_check',
  expression: `longitude IS NULL OR (longitude >= -180 AND longitude <= 180)`,
})
@Check({
  name: 'service_jobs_accuracy_check',
  expression: `"locationAccuracyM" IS NULL OR "locationAccuracyM" >= 0`,
})
@Check({
  name: 'service_jobs_cost_check',
  expression: `"completionCostCents" IS NULL OR "completionCostCents" >= 0`,
})
@Check({
  name: 'service_jobs_currency_check',
  expression: `currency ~ '^[A-Z]{3}$'`,
})
export class ServiceJob {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'string', length: 24 })
  reference!: string;

  @ManyToOne(() => DriverIssue, {
    fieldName: 'issueId',
    nullable: true,
    deleteRule: 'restrict',
  })
  issue!: Rel<DriverIssue> | null;

  @ManyToOne(() => Truck, { fieldName: 'truckId', deleteRule: 'restrict' })
  truck!: Rel<Truck>;

  @ManyToOne(() => DriverProfile, {
    fieldName: 'driverId',
    nullable: true,
    deleteRule: 'restrict',
  })
  driver!: Rel<DriverProfile> | null;

  get issueId(): string | null {
    return entityId(this.issue);
  }

  get truckId(): string {
    return entityId(this.truck);
  }

  get driverId(): string | null {
    return entityId(this.driver);
  }

  @Property({ type: 'string', length: 24 })
  serviceType!: ServiceType;

  @Property({ type: 'string', length: 120 })
  title!: string;

  @Property({ type: 'text' })
  description!: string;

  @Property({ type: 'string', length: 300, nullable: true })
  locationText!: string | null;

  @Property({ type: 'double', nullable: true })
  latitude!: number | null;

  @Property({ type: 'double', nullable: true })
  longitude!: number | null;

  @Property({ type: 'double', nullable: true })
  locationAccuracyM!: number | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  locationCapturedAt!: Date | null;

  @Property({ type: 'string', length: 16, default: 'urgent' })
  urgency!: 'urgent' | 'normal';

  @Property({ type: 'string', length: 24, default: 'open' })
  status!: JobStatus;

  @ManyToOne(() => ServiceProvider, {
    fieldName: 'providerId',
    nullable: true,
    deleteRule: 'restrict',
  })
  provider!: Rel<ServiceProvider> | null;

  get providerId(): string | null {
    return entityId(this.provider);
  }

  set providerId(value: string | null) {
    this.provider = (value as unknown as Rel<ServiceProvider> | null);
  }

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  broadcastAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Property({ type: 'text', nullable: true })
  completionNote!: string | null;

  @Property({ type: 'integer', nullable: true })
  completionCostCents!: number | null;

  @Property({ type: 'string', length: 3, default: 'ZAR' })
  currency!: string;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @ManyToOne(() => User, {
    fieldName: 'closedById',
    nullable: true,
    deleteRule: 'restrict',
  })
  closedBy!: Rel<User> | null;

  get closedById(): string | null {
    return entityId(this.closedBy);
  }

  set closedById(value: string | null) {
    this.closedBy = (value as unknown as Rel<User> | null);
  }

  @Property({ type: 'text', nullable: true })
  closeNote!: string | null;

  @Property({ type: 'boolean', default: false })
  resolvedIssueOnClose!: boolean;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @ManyToOne(() => User, {
    fieldName: 'cancelledById',
    nullable: true,
    deleteRule: 'restrict',
  })
  cancelledBy!: Rel<User> | null;

  get cancelledById(): string | null {
    return entityId(this.cancelledBy);
  }

  set cancelledById(value: string | null) {
    this.cancelledBy = (value as unknown as Rel<User> | null);
  }

  @Property({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @Property({ type: 'string', length: 16 })
  source!: 'driver' | 'admin';

  @ManyToOne(() => User, {
    fieldName: 'createdById',
    nullable: true,
    deleteRule: 'set null',
  })
  createdBy!: Rel<User> | null;

  get createdById(): string | null {
    return entityId(this.createdBy);
  }

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}

@Entity({ tableName: 'service_job_offers', schema: 'app' })
@Index({ name: 'service_job_offers_job', properties: ['job'] })
@Index({
  name: 'service_job_offers_provider',
  properties: ['provider'],
})
@Index({
  name: 'service_job_offers_due',
  properties: ['nextAttemptAt'],
  where: `status = 'queued'`,
})
@Index({
  name: 'service_job_offers_chat_completion_due',
  properties: ['chatCompletionExpiresAt'],
  where: '"chatCompletionExpiresAt" IS NOT NULL AND "chatCompletionRemindedAt" IS NULL',
})
@Unique({
  name: 'service_job_offers_jobId_providerId_key',
  properties: ['job', 'provider'],
})
@Unique({
  name: 'service_job_offers_accepted',
  properties: ['job'],
  where: `status = 'accepted'`,
})
@Unique({
  name: 'service_job_offers_message_key',
  properties: ['whatsappMessageId'],
  where: '"whatsappMessageId" IS NOT NULL',
})
@Check({
  name: 'service_job_offers_status_check',
  expression: `status IN (${offerStatusListSql})`,
})
@Check({
  name: 'service_job_offers_channel_check',
  expression: `"responseChannel" IS NULL OR "responseChannel" IN ('web', 'whatsapp', 'admin')`,
})
@Check({
  name: 'service_job_offers_attempts_check',
  expression: 'attempts >= 0',
})
@Check({
  name: 'service_job_offers_link_version_check',
  expression: '"linkVersion" >= 1',
})
export class ServiceJobOffer {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => ServiceJob, { fieldName: 'jobId', deleteRule: 'cascade' })
  job!: Rel<ServiceJob>;

  @ManyToOne(() => ServiceProvider, {
    fieldName: 'providerId',
    deleteRule: 'restrict',
  })
  provider!: Rel<ServiceProvider>;

  get jobId(): string {
    return entityId(this.job);
  }

  get providerId(): string {
    return entityId(this.provider);
  }

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Property({ type: 'string', length: 15, nullable: true })
  chatCompletionPhone!: string | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  chatCompletionStartedAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  chatCompletionExpiresAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  chatCompletionRemindedAt!: Date | null;

  @Property({ type: 'json', nullable: true })
  chatCompletionMediaIds!: string[] | null;

  @Property({ type: 'integer', nullable: true })
  chatCompletionCostCents!: number | null;

  @Property({ type: 'integer', default: 1 })
  linkVersion!: number;

  @Property({ type: 'string', length: 20, default: 'queued' })
  status!: OfferStatus;

  @Property({ type: 'integer', default: 0 })
  attempts!: number;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
  })
  nextAttemptAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  sendingAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  respondedAt!: Date | null;

  @Property({ type: 'string', length: 128, nullable: true })
  whatsappMessageId!: string | null;

  @Property({ type: 'string', length: 32, nullable: true })
  lastErrorCode!: string | null;

  @Property({ type: 'text', nullable: true })
  lastErrorTitle!: string | null;

  @Property({ type: 'string', length: 80, nullable: true })
  responderName!: string | null;

  @Property({ type: 'string', length: 16, nullable: true })
  responseChannel!: 'web' | 'whatsapp' | 'admin' | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}

@Entity({ tableName: 'service_job_events', schema: 'app' })
@Index({
  name: 'service_job_events_job_created',
  properties: ['job', 'createdAt'],
})
@Check({
  name: 'service_job_events_actor_check',
  expression: `"actorType" IN ('driver', 'admin', 'provider', 'system')`,
})
@Check({
  name: 'service_job_events_channel_check',
  expression: `channel IS NULL OR channel IN ('app', 'dashboard', 'web', 'whatsapp', 'system')`,
})
export class ServiceJobEvent {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => ServiceJob, { fieldName: 'jobId', deleteRule: 'cascade' })
  job!: Rel<ServiceJob>;

  get jobId(): string {
    return entityId(this.job);
  }

  @Property({ type: 'string', length: 32 })
  kind!: EventKind;

  @Property({ type: 'string', length: 16 })
  actorType!: 'driver' | 'admin' | 'provider' | 'system';

  @ManyToOne(() => User, {
    fieldName: 'actorUserId',
    nullable: true,
    deleteRule: 'set null',
  })
  actorUser!: Rel<User> | null;

  @ManyToOne(() => ServiceProvider, {
    fieldName: 'providerId',
    nullable: true,
    deleteRule: 'set null',
  })
  provider!: Rel<ServiceProvider> | null;

  get actorUserId(): string | null {
    return entityId(this.actorUser);
  }

  get providerId(): string | null {
    return entityId(this.provider);
  }

  @Property({ type: 'string', length: 120, nullable: true })
  actorName!: string | null;

  @Property({ type: 'string', length: 16, nullable: true })
  channel!: 'app' | 'dashboard' | 'web' | 'whatsapp' | 'system' | null;

  @Property({ type: 'string', length: 24, nullable: true })
  fromStatus!: JobStatus | null;

  @Property({ type: 'string', length: 24, nullable: true })
  toStatus!: JobStatus | null;

  @Property({ type: 'text', nullable: true })
  note!: string | null;

  @Property({ type: 'json', columnType: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;
}

@Entity({ tableName: 'service_job_attachments', schema: 'app' })
@Index({ name: 'service_job_attachments_job', properties: ['job'] })
@Unique({
  name: 'service_job_attachments_jobId_storageName_key',
  properties: ['job', 'storageName'],
})
@Check({
  name: 'service_job_attachments_kind_check',
  expression: `"kind" in ('completion_photo')`,
})
@Check({
  name: 'service_job_attachments_size_check',
  expression: '"byteSize" > 0',
})
export class ServiceJobAttachment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => ServiceJob, { fieldName: 'jobId', deleteRule: 'cascade' })
  job!: Rel<ServiceJob>;

  @ManyToOne(() => ServiceJobEvent, {
    fieldName: 'eventId',
    nullable: true,
    deleteRule: 'set null',
  })
  event!: Rel<ServiceJobEvent> | null;

  get jobId(): string {
    return entityId(this.job);
  }

  get eventId(): string | null {
    return entityId(this.event);
  }

  @Property({ type: 'string', length: 24, default: 'completion_photo' })
  kind!: 'completion_photo';

  @Property({ type: 'string', length: 64 })
  mimeType!: string;

  @Property({ type: 'integer' })
  byteSize!: number;

  @Property({ type: 'string', length: 80 })
  storageName!: string;

  @Property({ type: 'uuid', nullable: true })
  uploadedByProviderId!: string | null;

  @Property({ type: 'uuid', nullable: true })
  uploadedByUserId!: string | null;

  @Property({
    type: 'datetime',
    columnType: 'timestamptz',
    defaultRaw: 'now()',
    onCreate: () => new Date(),
  })
  createdAt!: Date;
}
