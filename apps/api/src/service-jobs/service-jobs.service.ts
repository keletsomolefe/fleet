import { Database, EntityManager, In, IsNull, Not, save, saveNew, exists } from '../database/database.js';
import { LockMode } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  UnauthorizedError,
} from '../http/errors.js';
import type { AdminContext } from '../auth/auth.service.js';
import { DriverIssue } from '../issues/issue.entity.js';
import { DriverProfile, Truck } from '../fleet/fleet.entity.js';
import { User } from '../users/user.entity.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
import type { JobAlertSender } from '../whatsapp/job-alert-sender.js';
import { ServiceJobAccess } from './service-job-access.js';
import {
  ServiceProvider,
  type ProviderService,
} from './service-provider.entity.js';
import {
  ServiceJob,
  ServiceJobAttachment,
  ServiceJobEvent,
  ServiceJobOffer,
  type JobStatus,
  type OfferStatus,
  type ProgressStage,
  type ServiceType,
  eventKinds,
} from './service-job.entity.js';
import {
  displayWhatsAppNumber,
  parseCancelInput,
  parseCloseInput,
  parseCompletionInput,
  parseJobInput,
  parseNoteInput,
  parseProgressInput,
  parseProviderConsentInput,
  parseProviderInput,
  parseProviderStatusInput,
  parseReassignInput,
  parseReopenInput,
  serviceTypeLabels,
} from './service-job.input.js';
import {
  ensurePrivateDirectory,
  readPrivateFile,
  serviceJobDir,
  writePrivateFile,
} from '../storage/private-storage.js';
import { photoType, type UploadedPhoto } from '../storage/photo.js';
import { join } from 'node:path';

const pageSize = 20;
const activeStatuses: JobStatus[] = ['open', 'assigned', 'in_progress'];
const progressRank: Record<ProgressStage, number> = {
  en_route: 1,
  arrived: 2,
  working: 3,
};
const offerRespondedStatuses: OfferStatus[] = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
];

export type ProviderActor = {
  providerId: string;
  phone?: string;
  linkVersion?: number;
  profileName?: string;
  responderName?: string;
  channel: 'web' | 'whatsapp';
};
type ChatCompletionEdit =
  | { mediaId: string }
  | { clearPhotos: true }
  | { costCents: number };
const chatCompletionMinutes = 30;
const assignedStatuses: JobStatus[] = ['assigned', 'in_progress'];

function clearChatCompletion(offer: ServiceJobOffer) {
  offer.chatCompletionPhone = null;
  offer.chatCompletionStartedAt = null;
  offer.chatCompletionExpiresAt = null;
  offer.chatCompletionRemindedAt = null;
  offer.chatCompletionMediaIds = null;
  offer.chatCompletionCostCents = null;
}
type AdminActor = { admin: AdminContext };
type Actor = {
  actorType: 'driver' | 'admin' | 'provider' | 'system';
  actorUserId?: string | null;
  providerId?: string | null;
  actorName?: string | null;
  channel: 'app' | 'dashboard' | 'web' | 'whatsapp' | 'system';
};
type AlertOffer = {
  offerId: string;
  jobId: string;
  providerId: string;
  attempts: number;
  linkVersion: number;
  reference: string;
  providerPhone: string;
  providerCompany: string;
  truckRegistration: string;
  truckIdentifier: string;
  serviceType: ServiceType;
  issueSummary: string;
  locationText: string | null;
  link: string;
};
type JobSummary = {
  id: string;
  reference: string;
  status: JobStatus;
  serviceType: ServiceType;
  title: string;
  provider: { id: string; companyName: string } | null;
  latestStage: ProgressStage | null;
  createdAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  isActive: boolean;
};

function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
}
function pageNumber(raw: unknown) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 999999 ? value : 1;
}
function statusFilter(status: string | undefined): JobStatus[] | null {
  switch (status) {
    case 'waiting':
      return ['open'];
    case 'working':
      return ['assigned', 'in_progress'];
    case 'active':
      return ['open', 'assigned', 'in_progress', 'completed'];
    case 'awaiting':
      return ['completed'];
    case 'completed':
      return ['completed', 'closed'];
    case 'closed':
      return ['closed'];
    case 'cancelled':
      return ['cancelled'];
    case 'all':
    case '':
    case undefined:
      return null;
    default:
      return ['open'];
  }
}
function stageFromEvents(events: ServiceJobEvent[]): ProgressStage | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const kind = events[index].kind;
    if (kind === 'en_route' || kind === 'arrived' || kind === 'working')
      return kind;
  }
  return null;
}
function isActive(status: JobStatus) {
  return activeStatuses.includes(status);
}
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class ServiceJobsService {
  onAlertsQueued?: () => void;
  constructor(
    private readonly db: Database,
    private readonly events: OperationsEventsService,
    private readonly access: ServiceJobAccess,
    private readonly alertSender: Pick<JobAlertSender, 'configured' | 'recipientNumbers'>,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  get alertsReady() {
    return (
      process.env.SERVICE_JOB_ALERTS_ENABLED === 'true' &&
      !!process.env.SERVICE_JOB_LINK_SECRET &&
      this.alertSender.configured
    );
  }
  wakeWorker() {
    this.onAlertsQueued?.();
  }
  private changed() {
    this.events.changed();
  }
  private async reference(manager: EntityManager | Database) {
    const [row] = (await manager.execute(
      `SELECT nextval('app.service_job_reference_seq') AS value`,
    )) as Array<{ value: string | number }>;
    return `SJ-${String(row.value).padStart(6, '0')}`;
  }
  private providerView(provider: ServiceProvider) {
    return {
      id: provider.id,
      companyName: provider.companyName,
      contactName: provider.contactName,
      whatsappNumber: displayWhatsAppNumber(provider.whatsappNumber),
      phone: provider.phone,
      email: provider.email,
      services: provider.services,
      coverageArea: provider.coverageArea,
      notes: provider.notes,
      status: provider.status,
      alertsEnabled: provider.alertsEnabled,
      receivesAlerts: provider.status === 'active' && provider.alertsEnabled &&
        !!provider.optedInAt && !provider.optedOutAt && !!provider.whatsappNumber &&
        (this.alertSender.recipientNumbers?.includes(provider.whatsappNumber) ?? true),
      optedInAt: provider.optedInAt,
      optedOutAt: provider.optedOutAt,
      optOutReason: provider.optOutReason,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }
  private jobSummary(
    job: ServiceJob,
    latestStage: ProgressStage | null = null,
  ): JobSummary {
    return {
      id: job.id,
      reference: job.reference,
      status: job.status,
      serviceType: job.serviceType,
      title: job.title,
      provider: job.provider
        ? { id: job.provider.id, companyName: job.provider.companyName }
        : null,
      latestStage,
      createdAt: job.createdAt,
      acceptedAt: job.acceptedAt,
      completedAt: job.completedAt,
      closedAt: job.closedAt,
      cancelledAt: job.cancelledAt,
      isActive: isActive(job.status),
    };
  }
  private jobListRow(job: ServiceJob) {
    return {
      ...this.jobSummary(job),
      truck: job.truck
        ? {
            id: job.truck.id,
            registration: job.truck.registration,
            identifier: job.truck.identifier,
            make: job.truck.make,
            model: job.truck.model,
          }
        : null,
      driver: job.driver
        ? {
            id: job.driver.id,
            name: `${job.driver.user.firstName} ${job.driver.user.lastName}`,
          }
        : null,
      description: job.description,
      urgency: job.urgency,
      locationText: job.locationText,
      updatedAt: job.updatedAt,
    };
  }
  private async latestStages(ids: string[]) {
    if (!ids.length) return new Map<string, ProgressStage>();
    const rows: Array<{ jobId: string; kind: ProgressStage }> =
      await this.db.execute(
        `SELECT DISTINCT ON ("jobId") "jobId", kind
         FROM app.service_job_events
         WHERE "jobId" = ANY($1::uuid[])
           AND kind IN ('en_route', 'arrived', 'working')
         ORDER BY "jobId", "createdAt" DESC`,
        [ids],
      );
    return new Map(rows.map((row) => [row.jobId, row.kind]));
  }

  async listProviders(query: Record<string, unknown>) {
    const page = pageNumber(query.page),
      q = text(query.q, 200) ?? '',
      status = text(query.status, 16) ?? '';
    const qb = this.db
      .getRepository(ServiceProvider)
      .createQueryBuilder('provider');
    if (q)
      qb.andWhere(
        `(provider."companyName" ILIKE :q OR provider."contactName" ILIKE :q
          OR provider."whatsappNumber" ILIKE :q OR provider."coverageArea" ILIKE :q)`,
        { q: `%${q}%` },
      );
    if (status === 'active' || status === 'paused')
      qb.andWhere('provider.status = :status', { status });
    else if (status === 'receives_alerts' || status === 'alerts_off') {
      const audience = this.alertSender.recipientNumbers;
      const phones = audience?.length ? audience : [''];
      if (status === 'receives_alerts') {
        qb.andWhere(`provider.status = 'active' AND provider."alertsEnabled" = true
          AND provider."optedInAt" IS NOT NULL AND provider."optedOutAt" IS NULL`);
        if (audience) qb.andWhere('provider."whatsappNumber" IN (:...phones)', { phones });
      } else {
        qb.andWhere(
          `(provider."alertsEnabled" = false OR provider."optedInAt" IS NULL OR provider."optedOutAt" IS NOT NULL
            ${audience ? 'OR provider."whatsappNumber" NOT IN (:...phones)' : ''})`,
          { phones },
        );
      }
    }
    const [providers, total] = await qb
      .orderBy('provider."companyName"', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const metrics = providers.length
      ? ((await this.db.execute(
          `SELECT "providerId",
             count(*) FILTER (WHERE status IN ('completed', 'closed'))::int AS handled,
             max("acceptedAt") AS "lastJobAt"
           FROM app.service_jobs
           WHERE "providerId" = ANY($1::uuid[])
           GROUP BY "providerId"`,
          [providers.map((provider) => provider.id)],
        )) as Array<{
          providerId: string;
          handled: number;
          lastJobAt: Date | null;
        }>)
      : [];
    const byProvider = new Map(metrics.map((metric) => [metric.providerId, metric]));
    return {
      items: providers.map((provider) => ({
        ...this.providerView(provider),
        jobsHandled: byProvider.get(provider.id)?.handled ?? 0,
        lastJobAt: byProvider.get(provider.id)?.lastJobAt ?? null,
      })),
      total,
      page,
      pageSize,
      alertsReady: this.alertsReady,
    };
  }
  async getProvider(id: string, includeJobs = true) {
    const provider = await this.db
      .getRepository(ServiceProvider)
      .findOneBy({ id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    if (!includeJobs) return { provider: this.providerView(provider), jobs: [] };
    const jobs = await this.db
      .getRepository(ServiceJob)
      .find({
        where: { providerId: id },
        relations: { truck: true, provider: true, driver: { user: true } },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 10,
      });
    const stages = await this.latestStages(jobs.map((job) => job.id));
    return {
      provider: this.providerView(provider),
      jobs: jobs.map((job) => ({
        ...this.jobListRow(job),
        latestStage: stages.get(job.id) ?? null,
      })),
    };
  }
  async createProvider(admin: AdminContext, raw: unknown) {
    const input = parseProviderInput(raw);
    if (input.alertsEnabled && !input.consent)
      throw new BadRequestError(
        'Confirm that the provider agreed to receive WhatsApp job alerts.',
      );
    const now = new Date();
    try {
      const provider = await save(this.db.em,
        this.db.getRepository(ServiceProvider).create({
          companyName: input.companyName,
          contactName: input.contactName,
          whatsappNumber: input.whatsappNumber,
          phone: input.phone,
          email: input.email,
          services: input.services,
          coverageArea: input.coverageArea,
          notes: input.notes,
          status: input.status,
          alertsEnabled: input.alertsEnabled,
          optedInAt: input.alertsEnabled ? now : null,
          optInById: input.alertsEnabled ? admin.user.id : null,
          optedOutAt: null,
          optOutReason: null,
          createdById: admin.user.id,
        }),
      );
      this.changed();
      return this.providerView(provider);
    } catch (error) {
      if (errorCode(error) === '23505')
        throw new ConflictError(
          'A service provider with this WhatsApp number already exists.',
        );
      throw error;
    }
  }
  async updateProvider(admin: AdminContext, id: string, raw: unknown) {
    const input = parseProviderInput(raw);
    const provider = await this.db
      .getRepository(ServiceProvider)
      .findOneBy({ id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    const numberChanged = provider.whatsappNumber !== input.whatsappNumber;
    const reEnabling = input.alertsEnabled && (!provider.alertsEnabled || !!provider.optedOutAt);
    const needsConsent = numberChanged || reEnabling || (input.alertsEnabled && !provider.optedInAt);
    if (needsConsent && !input.consent)
      throw new BadRequestError(
        'Confirm that the provider agreed to receive WhatsApp job alerts.',
      );
    const now = new Date();
    provider.companyName = input.companyName;
    provider.contactName = input.contactName;
    provider.whatsappNumber = input.whatsappNumber;
    provider.phone = input.phone;
    provider.email = input.email;
    provider.services = input.services;
    provider.coverageArea = input.coverageArea;
    provider.notes = input.notes;
    provider.status = input.status;
    provider.alertsEnabled = input.alertsEnabled;
    if (needsConsent) {
      provider.optedInAt = now;
      provider.optInById = admin.user.id;
      provider.optedOutAt = null;
      provider.optOutReason = null;
    }
    try {
      await this.db.transaction(async (manager) => {
        await manager.save(provider);
        if (numberChanged || reEnabling)
          await manager.execute(
            `UPDATE app.service_job_offers
             SET "linkVersion" = "linkVersion" + 1, "updatedAt" = now()
             WHERE "providerId" = $1
               AND status NOT IN ('accepted', 'declined', 'expired')`,
            [provider.id],
          );
      });
      this.changed();
      return this.providerView(provider);
    } catch (error) {
      if (errorCode(error) === '23505')
        throw new ConflictError(
          'A service provider with this WhatsApp number already exists.',
        );
      throw error;
    }
  }
  async setProviderStatus(admin: AdminContext, id: string, raw: unknown) {
    const { status } = parseProviderStatusInput(raw);
    const provider = await this.db
      .getRepository(ServiceProvider)
      .findOneBy({ id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    if (status === 'active' && !provider.optedInAt)
      throw new BadRequestError(
        'Record the provider’s WhatsApp consent before activating alerts.',
      );
    provider.status = status;
    await save(this.db.em, provider);
    this.changed();
    return this.providerView(provider);
  }
  async confirmProviderConsent(admin: AdminContext, id: string, raw: unknown) {
    parseProviderConsentInput(raw);
    const provider = await this.db
      .getRepository(ServiceProvider)
      .findOneBy({ id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    provider.alertsEnabled = true;
    provider.status = 'active';
    provider.optedInAt = new Date();
    provider.optInById = admin.user.id;
    provider.optedOutAt = null;
    provider.optOutReason = null;
    await save(this.db.em, provider);
    this.changed();
    return this.providerView(provider);
  }

  async summary() {
    const [row] = (await this.db.execute(
      `SELECT
        count(*) FILTER (WHERE status = 'open')::int AS waiting,
        count(*) FILTER (WHERE status IN ('assigned', 'in_progress'))::int AS working,
        count(*) FILTER (WHERE status = 'completed')::int AS "awaitingClose",
        count(*) FILTER (
          WHERE status = 'closed'
            AND "closedAt" >= (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')
        )::int AS "closedToday"
       FROM app.service_jobs`,
    )) as Array<{
      waiting: number;
      working: number;
      awaitingClose: number;
      closedToday: number;
    }>;
    return {
      ...row,
      alertsReady: this.alertsReady,
    };
  }
  async listJobs(query: Record<string, unknown>) {
    const page = pageNumber(query.page),
      q = text(query.q, 200) ?? '',
      providerId = text(query.providerId, 36) ?? '',
      statuses = statusFilter(text(query.status, 16) ?? undefined);
    const qb = this.db
      .getRepository(ServiceJob)
      .createQueryBuilder('job')
      .leftJoinAndSelect('job.truck', 'truck')
      .leftJoinAndSelect('job.provider', 'provider')
      .leftJoinAndSelect('job.driver', 'driver')
      .leftJoinAndSelect('driver.user', 'driverUser')
      .leftJoinAndSelect('job.issue', 'issue');
    if (statuses) qb.andWhere('job.status IN (:...statuses)', { statuses });
    if (providerId) qb.andWhere('job."providerId" = :providerId', { providerId });
    if (q)
      qb.andWhere(
        `(job.reference ILIKE :q OR truck.registration ILIKE :q
          OR truck.identifier ILIKE :q OR provider."companyName" ILIKE :q
          OR job.description ILIKE :q)`,
        { q: `%${q}%` },
      );
    const [jobs, total] = await qb
      .orderBy('job.createdAt', 'DESC')
      .addOrderBy('job.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const stages = await this.latestStages(jobs.map((job) => job.id));
    const counts = await this.summary();
    return {
      items: jobs.map((job) => ({
        ...this.jobListRow(job),
        latestStage: stages.get(job.id) ?? null,
      })),
      total,
      page,
      pageSize,
      counts,
      alertsReady: this.alertsReady,
    };
  }
  async getJob(id: string) {
    const job = await this.db.em.findOne(ServiceJob, { id }, {
      populate: ['truck', 'provider', 'driver.user', 'issue', 'closedBy', 'cancelledBy', 'createdBy'],
    });
    if (!job) throw new NotFoundError('Service job not found.');
    const [offers, events, attachments] = await Promise.all([
      this.db.em.find(ServiceJobOffer, { job: id }, { populate: ['provider'], orderBy: { createdAt: 'asc' } }),
      this.db.em.find(ServiceJobEvent, { job: id }, { populate: ['actorUser', 'provider'], orderBy: { createdAt: 'asc' } }),
      this.db.em.find(ServiceJobAttachment, { job: id }, { orderBy: { createdAt: 'asc' } }),
    ]);
    const stage = stageFromEvents(events);
    return {
      job: {
        ...this.jobListRow(job),
        latestStage: stage,
        issueId: job.issueId,
        issue: job.issue
          ? {
              id: job.issue.id,
              category: job.issue.category,
              description: job.issue.description,
              createdAt: job.issue.createdAt,
              resolvedAt: job.issue.resolvedAt,
              resolutionNote: job.issue.resolutionNote,
            }
          : null,
        source: job.source,
        latitude: job.latitude,
        longitude: job.longitude,
        broadcastAt: job.broadcastAt,
        startedAt: job.startedAt,
        completionNote: job.completionNote,
        completionCostCents: job.completionCostCents,
        currency: job.currency,
        closeNote: job.closeNote,
        resolvedIssueOnClose: job.resolvedIssueOnClose,
        cancelReason: job.cancelReason,
        closedBy: job.closedBy
          ? `${job.closedBy.firstName} ${job.closedBy.lastName}`
          : null,
        cancelledBy: job.cancelledBy
          ? `${job.cancelledBy.firstName} ${job.cancelledBy.lastName}`
          : null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      offers: offers.map((offer) => ({
        id: offer.id,
        provider: {
          id: offer.provider.id,
          companyName: offer.provider.companyName,
          contactName: offer.provider.contactName,
          whatsappNumber: displayWhatsAppNumber(offer.provider.whatsappNumber),
        },
        status: offer.status,
        attempts: offer.attempts,
        linkVersion: offer.linkVersion,
        sentAt: offer.sentAt,
        deliveredAt: offer.deliveredAt,
        readAt: offer.readAt,
        respondedAt: offer.respondedAt,
        responderName: offer.responderName,
        responseChannel: offer.responseChannel,
        lastErrorCode: offer.lastErrorCode,
        lastErrorTitle: offer.lastErrorTitle,
        createdAt: offer.createdAt,
      })),
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        actorType: event.actorType,
        actorName:
          event.actorName ??
          (event.actorUser
            ? `${event.actorUser.firstName} ${event.actorUser.lastName}`
            : event.provider?.companyName) ??
          null,
        channel: event.channel,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        createdAt: event.createdAt,
      })),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        createdAt: attachment.createdAt,
      })),
      activeProviderCount: await this.db
        .getRepository(ServiceProvider)
        .count({
          where: this.eligibleProviderWhere(),
        }),
      alertsReady: this.alertsReady,
    };
  }

  private eligibleProviderWhere() {
    return {
      status: 'active',
      alertsEnabled: true,
      optedOutAt: IsNull(),
      optedInAt: Not(IsNull()),
      ...(this.alertSender.recipientNumbers && { whatsappNumber: In(this.alertSender.recipientNumbers) }),
    };
  }
  private async eligibleProviders(manager: EntityManager) {
    return manager.find(ServiceProvider, this.eligibleProviderWhere(), { orderBy: { companyName: 'asc' } });
  }
  private async queueOffers(
    manager: EntityManager,
    job: ServiceJob,
    eventActor: Actor,
    retry: boolean,
  ) {
    if (!this.alertsReady) {
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'alerts_skipped',
          actorType: 'system',
          channel: 'system',
          note: 'Provider alerts are not configured.',
          metadata: { reason: 'alerts_unavailable' },
        }),
      );
      return 0;
    }
    const providers = await this.eligibleProviders(manager);
    if (!providers.length) {
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'alerts_skipped',
          actorType: 'system',
          channel: 'system',
          note: 'No active service providers are configured.',
          metadata: { reason: 'no_providers' },
        }),
      );
      return 0;
    }
    const existing = await manager.find(ServiceJobOffer, { job: job.id });
    const byProvider = new Map(
      existing.map((offer) => [offer.providerId, offer]),
    );
    let queued = 0;
    for (const provider of providers) {
      const offer = byProvider.get(provider.id);
      if (offer) {
        if (offer.status === 'accepted' || offer.status === 'sending') continue;
        if (
          offer.status === 'queued' ||
          (offer.status === 'sent' && !retry) ||
          (offer.status === 'delivered' && !retry) ||
          (offer.status === 'read' && !retry)
        )
          continue;
        if (offer.status === 'declined' || offer.status === 'expired' || offer.status === 'failed') {
          if (!retry) continue;
          offer.status = 'queued';
          offer.linkVersion += 1;
          offer.revokedAt = null;
          clearChatCompletion(offer);
          offer.attempts = 0;
          offer.nextAttemptAt = new Date();
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
          await manager.save(offer);
          queued += 1;
          continue;
        }
        continue;
      }
      await manager.save(
        manager.create(ServiceJobOffer, {
          jobId: job.id,
          providerId: provider.id,
          linkVersion: 1,
          status: 'queued',
          nextAttemptAt: new Date(),
        }),
      );
      queued += 1;
    }
    if (queued) {
      job.broadcastAt ??= new Date();
      await manager.save(job);
      await saveNew(manager, ServiceJobEvent, {
        jobId: job.id,
        kind: 'alerts_queued',
        actorType: eventActor.actorType,
        actorUserId: eventActor.actorUserId ?? null,
        providerId: null,
        actorName: eventActor.actorName ?? null,
        channel: eventActor.channel,
        note: `Alert sent to ${queued} service provider${queued === 1 ? '' : 's'}.`,
        metadata: { count: queued },
      });
    }
    return queued;
  }
  async createJob(admin: AdminContext, raw: unknown) {
    const input = parseJobInput(raw);
    const truck = await this.db.em.findOne(Truck, { id: input.truckId });
    if (!truck) throw new NotFoundError('Vehicle not found.');
    let issue: DriverIssue | null = null;
    if (input.issueId) {
      issue = await this.db.em.findOne(DriverIssue, { id: input.issueId }, { populate: ['driver'] });
      if (!issue) throw new NotFoundError('Driver report not found.');
      if (issue.truckId !== truck.id)
        throw new BadRequestError('The report belongs to another vehicle.');
    }
    const driver =
      issue?.driver ??
      (await this.db.em.findOne(DriverProfile, { currentTruckId: truck.id }));
    const result = await this.db.transaction(async (manager) => {
      const active = await manager.findOne(ServiceJob, { truck: truck.id, status: In(activeStatuses) });
      if (active) {
        throw new ConflictError(
          `This vehicle already has an active service job (${active.reference}).`,
        );
      }
      const job = manager.create(ServiceJob, {
        id: input.id ?? randomUUID(),
        reference: await this.reference(manager),
        issueId: issue?.id ?? null,
        truckId: truck.id,
        driverId: driver?.id ?? null,
        serviceType: input.serviceType,
        title: input.title ?? serviceTypeLabels[input.serviceType],
        description: input.description,
        locationText: input.locationText,
        latitude: input.latitude,
        longitude: input.longitude,
        locationAccuracyM: input.locationAccuracyM,
        locationCapturedAt: input.locationCapturedAt,
        urgency: input.urgency,
        status: 'open',
        source: 'admin',
        createdById: admin.user.id,
      });
      await manager.save(job);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'created',
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
          toStatus: 'open',
          note: input.description,
        }),
      );
      if (input.notifyProviders)
        await this.queueOffers(
          manager,
          job,
          {
            actorType: 'admin',
            actorUserId: admin.user.id,
            actorName: `${admin.user.firstName} ${admin.user.lastName}`,
            channel: 'dashboard',
          },
          false,
        );
      return job;
    });
    this.changed();
    if (input.notifyProviders) this.wakeWorker();
    return this.jobSummary(result);
  }
  async createForIssue(
    manager: EntityManager,
    input: {
      issueId: string;
      truckId: string;
      driverId: string;
      driverName: string;
      serviceType: ServiceType;
      description: string;
      title?: string | null;
      locationText?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      locationAccuracyM?: number | null;
      locationCapturedAt?: Date | null;
      notifyProviders: boolean;
    },
  ) {
    const active = await manager.findOne(
      ServiceJob,
      { truck: input.truckId, status: In(activeStatuses) },
      { populate: ['truck', 'provider'] },
    );
    if (active)
      return {
        job: active,
        duplicate: true,
        alerts: input.notifyProviders ? ('skipped' as const) : ('none' as const),
      };
    const job = manager.create(ServiceJob, {
      reference: await this.reference(manager),
      issueId: input.issueId,
      truckId: input.truckId,
      driverId: input.driverId,
      serviceType: input.serviceType,
      title: input.title ?? serviceTypeLabels[input.serviceType],
      description: input.description,
      locationText: input.locationText ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      locationAccuracyM: input.locationAccuracyM ?? null,
      locationCapturedAt: input.locationCapturedAt ?? null,
      urgency: 'urgent',
      status: 'open',
      source: 'driver',
    });
    await manager.save(job);
    await manager.save(
      manager.create(ServiceJobEvent, {
        jobId: job.id,
        kind: 'created',
        actorType: 'driver',
        actorName: input.driverName,
        channel: 'app',
        toStatus: 'open',
        note: input.description,
      }),
    );
    let alerts: 'queued' | 'skipped' | 'none' = 'none';
    if (input.notifyProviders) {
      const queued = await this.queueOffers(
        manager,
        job,
        {
          actorType: 'driver',
          actorName: input.driverName,
          channel: 'app',
        },
        false,
      );
      alerts = queued > 0 ? 'queued' : 'skipped';
    }
    return { job, duplicate: false, alerts };
  }
  async broadcast(admin: AdminContext, id: string) {
    const result = await this.db.transaction(async (manager) => {
      const job = await manager.findOne(ServiceJob, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!job) throw new NotFoundError('Service job not found.');
      if (job.status !== 'open')
        throw new ConflictError('This job is no longer waiting for a provider.');
      const queued = await this.queueOffers(
        manager,
        job,
        {
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
        },
        true,
      );
      return queued;
    });
    this.changed();
    if (result) this.wakeWorker();
    return { queued: result };
  }
  private async offerWithJob(manager: EntityManager, offerId: string) {
    const initial = await manager.findOne(ServiceJobOffer, { id: offerId });
    if (!initial) throw new NotFoundError('Provider request not found.');
    // All provider mutations take the job lock first, including concurrent web
    // and chat completion, so only the winner can write evidence or events.
    const job = await manager.findOne(ServiceJob, { id: initial.jobId }, {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      refresh: true,
    });
    const offer = await manager.findOne(ServiceJobOffer, { id: offerId }, {
      populate: ['provider'],
      refresh: true,
    });
    if (!job || !offer) throw new NotFoundError('Provider request not found.');
    return { offer, job };
  }

  private assertOfferActor(offer: ServiceJobOffer, actor: ProviderActor) {
    if (
      offer.providerId !== actor.providerId ||
      (actor.channel === 'whatsapp' &&
        (!actor.phone || actor.phone !== offer.provider.whatsappNumber || offer.revokedAt)) ||
      (actor.linkVersion !== undefined && offer.linkVersion !== actor.linkVersion)
    )
      throw new ForbiddenError('This provider request is no longer available.');
  }

  private assertAssignedOffer(offer: ServiceJobOffer, job: ServiceJob, actor: ProviderActor) {
    this.assertOfferActor(offer, actor);
    if (offer.status !== 'accepted' || job.providerId !== actor.providerId)
      throw new ForbiddenError('This provider request is no longer available.');
  }

  async beginChatCompletion(offerId: string, actor: ProviderActor, receivedAt: Date) {
    return this.db.transaction(async (manager) => {
      const { offer, job } = await this.offerWithJob(manager, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (job.status === 'completed' || job.status === 'closed')
        return 'completed' as const;
      if (!assignedStatuses.includes(job.status))
        throw new ConflictError('This job cannot be completed.');
      const now = new Date();
      if (offer.chatCompletionPhone === actor.phone && offer.chatCompletionExpiresAt)
        return offer.chatCompletionExpiresAt <= now ? 'expired' as const : 'collecting' as const;
      const expiresAt = new Date(receivedAt.getTime() + chatCompletionMinutes * 60_000);
      if (expiresAt <= now) return 'expired' as const;
      clearChatCompletion(offer);
      offer.chatCompletionPhone = actor.phone!;
      offer.chatCompletionStartedAt = receivedAt;
      offer.chatCompletionExpiresAt = expiresAt;
      await manager.save(offer);
      return 'collecting' as const;
    });
  }

  async editChatCompletion(offerId: string, actor: ProviderActor, edit: ChatCompletionEdit) {
    return this.db.transaction(async (manager) => {
      const { offer, job } = await this.offerWithJob(manager, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (!assignedStatuses.includes(job.status) ||
          offer.chatCompletionPhone !== actor.phone ||
          !offer.chatCompletionExpiresAt || offer.chatCompletionExpiresAt <= new Date())
        throw new ConflictError('This completion request has ended.');
      if ('mediaId' in edit) {
        const ids = offer.chatCompletionMediaIds ?? [];
        if (ids.includes(edit.mediaId)) return ids.length;
        if (ids.length >= 3) throw new BadRequestError('You can add up to 3 photos.');
        offer.chatCompletionMediaIds = [...ids, edit.mediaId];
      } else if ('clearPhotos' in edit) {
        offer.chatCompletionMediaIds = null;
      } else {
        offer.chatCompletionCostCents = parseCompletionInput({ note: 'Amount', costCents: edit.costCents }).costCents;
      }
      await manager.save(offer);
      return offer.chatCompletionMediaIds?.length ?? 0;
    });
  }

  async claimChatCompletionReminders() {
    return this.db.query<{ offerId: string; jobId: string; providerId: string; phone: string; linkVersion: number }>(
      `WITH due AS (
         SELECT o.id FROM app.service_job_offers o
         JOIN app.service_jobs j ON j.id = o."jobId"
         JOIN app.service_providers p ON p.id = o."providerId"
         WHERE o.status = 'accepted' AND o."revokedAt" IS NULL
           AND j."providerId" = o."providerId" AND j.status IN ('assigned', 'in_progress')
           AND p."whatsappNumber" = o."chatCompletionPhone" AND p."optedOutAt" IS NULL
           AND o."chatCompletionExpiresAt" <= now() AND o."chatCompletionRemindedAt" IS NULL
           AND o."chatCompletionStartedAt" > now() - interval '23 hours'
         ORDER BY o."chatCompletionExpiresAt" LIMIT 10 FOR UPDATE OF o SKIP LOCKED
       )
       UPDATE app.service_job_offers o SET "chatCompletionRemindedAt" = now()
       FROM due WHERE o.id = due.id
       RETURNING o.id AS "offerId", o."jobId", o."providerId", o."chatCompletionPhone" AS phone, o."linkVersion"`,
    );
  }

  private async finishOffer(
    offer: ServiceJobOffer,
    status: 'accepted' | 'declined',
    actor: ProviderActor,
    now = new Date(),
  ) {
    offer.status = status;
    offer.respondedAt = now;
    offer.responseChannel = actor.channel;
    offer.responderName =
      actor.responderName ?? actor.profileName ?? offer.provider.contactName;
  }
  async acceptOffer(offerId: string, actor: ProviderActor) {
    const result = await this.db.transaction(async (manager) => {
      const { offer, job } = await this.offerWithJob(manager, offerId);
      this.assertOfferActor(offer, actor);
      if (
        offer.status === 'accepted' && job.providerId === offer.providerId &&
        ['assigned', 'in_progress', 'completed', 'closed'].includes(job.status)
      )
        return {
          outcome: 'accepted' as const,
          reference: job.reference,
          providerName: offer.provider.companyName,
        };
      if (job.status !== 'open' || !offerRespondedStatuses.includes(offer.status))
        throw new ConflictError(
          'This job has already been assigned to another provider.',
        );
      const now = new Date();
      job.status = 'assigned';
      job.providerId = offer.providerId;
      job.acceptedAt = now;
      await manager.save(job);
      await this.finishOffer(offer, 'accepted', actor, now);
      await manager.save(offer);
      await manager
        .createQueryBuilder()
        .update(ServiceJobOffer)
        .set({ status: 'expired', updatedAt: now })
        .where('"jobId" = :jobId AND id <> :offerId', {
          jobId: job.id,
          offerId: offer.id,
        })
        .andWhere('status IN (:...statuses)', {
          statuses: offerRespondedStatuses,
        })
        .execute();
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'accepted',
          actorType: 'provider',
          providerId: offer.providerId,
          actorName:
            offer.responderName ??
            actor.responderName ??
            actor.profileName ??
            offer.provider.contactName,
          channel: actor.channel,
          fromStatus: 'open',
          toStatus: 'assigned',
          metadata: { providerName: offer.provider.companyName },
        }),
      );
      return {
        outcome: 'accepted' as const,
        reference: job.reference,
        providerName: offer.provider.companyName,
      };
    });
    this.changed();
    return result;
  }
  async declineOffer(offerId: string, actor: ProviderActor) {
    const result = await this.db.transaction(async (manager) => {
      const { offer, job } = await this.offerWithJob(manager, offerId);
      this.assertOfferActor(offer, actor);
      if (offer.status === 'declined') return { outcome: 'declined' as const };
      if (job.status !== 'open' || !offerRespondedStatuses.includes(offer.status))
        return { outcome: 'not_open' as const };
      const now = new Date();
      await this.finishOffer(offer, 'declined', actor, now);
      await manager.save(offer);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'declined',
          actorType: 'provider',
          providerId: offer.providerId,
          actorName: offer.responderName,
          channel: actor.channel,
          metadata: { providerName: offer.provider.companyName },
        }),
      );
      return { outcome: 'declined' as const };
    });
    this.changed();
    return result;
  }
  async recordProgress(offerId: string, stage: ProgressStage, actor: ProviderActor) {
    const result = await this.db.transaction(async (manager) => {
      const { offer, job } = await this.offerWithJob(manager, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (!assignedStatuses.includes(job.status))
        throw new ConflictError('This job is no longer in progress.');
      const events = await manager.find(ServiceJobEvent, { job: job.id }, { orderBy: { createdAt: 'asc' } });
      const current = stageFromEvents(events);
      if (current && progressRank[stage] <= progressRank[current])
        return { outcome: 'ok' as const, stage: current, reference: job.reference };
      const now = new Date();
      const previous = job.status;
      job.status = 'in_progress';
      job.startedAt ??= now;
      await manager.save(job);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: stage,
          actorType: 'provider',
          providerId: offer.providerId,
          actorName:
            actor.responderName ?? actor.profileName ?? offer.provider.contactName,
          channel: actor.channel,
          fromStatus: previous,
          toStatus: 'in_progress',
          metadata: { providerName: offer.provider.companyName },
        }),
      );
      return { outcome: 'ok' as const, stage, reference: job.reference };
    });
    this.changed();
    return result;
  }
  private async writeCompletionPhotos(
    jobId: string,
    files: UploadedPhoto[],
  ) {
    if (files.length > 3) throw new BadRequestError('Choose up to 3 photos.');
    const photos = files.map((file) => ({
      id: randomUUID(),
      type: photoType(file),
      buffer: file.buffer,
      size: file.buffer.length,
    }));
    await ensurePrivateDirectory(serviceJobDir(jobId));
    for (const photo of photos)
      await writePrivateFile(join(serviceJobDir(jobId), photo.id), photo.buffer);
    return photos;
  }
  async completeOffer(
    offerId: string,
    raw: unknown,
    files: UploadedPhoto[],
    actor: ProviderActor,
    chat?: { startedAt: Date; mediaIds: string[] },
  ) {
    const result = await this.db.transaction(async (manager) => {
      const { offer, job } = await this.offerWithJob(manager, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (job.status === 'completed' || job.status === 'closed') {
        if (chat) return { reference: job.reference, status: job.status, alreadyCompleted: true };
        throw new ConflictError('This job has already been completed.');
      }
      if (!assignedStatuses.includes(job.status))
        throw new ConflictError('This job cannot be completed.');
      if (chat && (
        !offer.chatCompletionExpiresAt || offer.chatCompletionExpiresAt <= new Date() ||
        offer.chatCompletionPhone !== actor.phone ||
        offer.chatCompletionStartedAt?.getTime() !== chat.startedAt.getTime() ||
        JSON.stringify(chat.mediaIds) !== JSON.stringify(offer.chatCompletionMediaIds ?? [])
      ))
        throw new ConflictError('This completion request has changed. Please try again.');
      const input = parseCompletionInput(chat
        ? { ...(raw as object), costCents: offer.chatCompletionCostCents }
        : raw);
      const photos = await this.writeCompletionPhotos(job.id, files);
      const now = new Date();
      const previous = job.status;
      job.status = 'completed';
      clearChatCompletion(offer);
      await manager.save(offer);
      job.completedAt = now;
      job.completionNote = input.note;
      job.completionCostCents = input.costCents;
      job.currency = input.currency;
      await manager.save(job);
      const event = await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'completed',
          actorType: 'provider',
          providerId: offer.providerId,
          actorName:
            input.name ??
            actor.responderName ??
            actor.profileName ??
            offer.provider.contactName,
          channel: actor.channel,
          fromStatus: previous,
          toStatus: 'completed',
          note: input.note,
          metadata: { photos: photos.length },
        }),
      );
      for (const photo of photos)
        await manager.save(
          manager.create(ServiceJobAttachment, {
            jobId: job.id,
            eventId: event.id,
            kind: 'completion_photo',
            mimeType: photo.type,
            byteSize: photo.size,
            storageName: photo.id,
            uploadedByProviderId: offer.providerId,
            uploadedByUserId: null,
          }),
        );
      return { reference: job.reference, status: job.status, alreadyCompleted: false };
    });
    if (!result.alreadyCompleted) this.changed();
    return result;
  }
  async closeJob(admin: AdminContext, id: string, raw: unknown) {
    const input = parseCloseInput(raw);
    if (input.resolveIssue && !admin.permissions.includes('issues.resolve'))
      throw new ForbiddenError('You cannot resolve driver reports.');
    const result = await this.db.transaction(async (manager) => {
      const job = await manager.findOne(ServiceJob, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!job) throw new NotFoundError('Service job not found.');
      const linkedIssue = job.issueId
        ? await manager.findOne(DriverIssue, { id: job.issueId })
        : null;
      if (job.status === 'closed')
        throw new ConflictError('This job is already closed.');
      if (job.status === 'cancelled')
        throw new ConflictError('This job was cancelled.');
      const now = new Date();
      const previous = job.status;
      job.status = 'closed';
      job.closedAt = now;
      job.closedById = admin.user.id;
      job.closeNote = input.note;
      job.resolvedIssueOnClose = false;
      if (input.resolveIssue && job.issueId && linkedIssue) {
        const other = await manager.findOne(ServiceJob, {
          issue: job.issueId,
          id: Not(job.id),
          status: In(activeStatuses),
        });
        if (other)
          throw new ConflictError(
            'Another service job is still active for this driver report.',
          );
        const issue = await manager.findOne(DriverIssue, { id: job.issueId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!issue) throw new NotFoundError('Driver report not found.');
        if (issue.resolvedAt)
          throw new ConflictError('This driver report is already resolved.');
        issue.resolvedAt = now;
        issue.resolvedById = admin.user.id;
        issue.resolutionNote = input.note;
        await manager.save(issue);
        job.resolvedIssueOnClose = true;
        await manager.save(
          manager.create(ServiceJobEvent, {
            jobId: job.id,
            kind: 'issue_resolved',
            actorType: 'admin',
            actorUserId: admin.user.id,
            actorName: `${admin.user.firstName} ${admin.user.lastName}`,
            channel: 'dashboard',
            note: input.note,
          }),
        );
      }
      await manager.save(job);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'closed',
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
          fromStatus: previous,
          toStatus: 'closed',
          note: input.note,
        }),
      );
      await manager
        .createQueryBuilder()
        .update(ServiceJobOffer)
        .set({ status: 'expired', updatedAt: now })
        .where('"jobId" = :jobId', { jobId: job.id })
        .andWhere('status IN (:...statuses)', {
          statuses: offerRespondedStatuses,
        })
        .execute();
      return { reference: job.reference };
    });
    this.changed();
    return result;
  }
  async reopenJob(admin: AdminContext, id: string, raw: unknown) {
    const input = parseReopenInput(raw);
    const result = await this.db.transaction(async (manager) => {
      const job = await manager.findOne(ServiceJob, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!job) throw new NotFoundError('Service job not found.');
      if (job.status !== 'closed')
        throw new ConflictError('Only a closed job can be reopened.');
      const now = new Date();
      const wasResolved = job.resolvedIssueOnClose;
      job.status = job.providerId ? 'in_progress' : 'open';
      job.closedAt = null;
      job.closedById = null;
      job.closeNote = null;
      job.resolvedIssueOnClose = false;
      if (input.reopenIssue && wasResolved && job.issueId) {
        const issue = await manager.findOne(DriverIssue, { id: job.issueId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (issue?.resolvedAt) {
          issue.resolvedAt = null;
          issue.resolvedById = null;
          issue.resolutionNote = null;
          await manager.save(issue);
          await manager.save(
            manager.create(ServiceJobEvent, {
              jobId: job.id,
              kind: 'issue_reopened',
              actorType: 'admin',
              actorUserId: admin.user.id,
              actorName: `${admin.user.firstName} ${admin.user.lastName}`,
              channel: 'dashboard',
              note: input.reason,
            }),
          );
        }
      }
      await manager.save(job);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'reopened',
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
          fromStatus: 'closed',
          toStatus: job.status,
          note: input.reason,
        }),
      );
      return { reference: job.reference };
    });
    this.changed();
    return result;
  }
  async cancelJob(admin: AdminContext, id: string, raw: unknown) {
    const input = parseCancelInput(raw);
    const result = await this.db.transaction(async (manager) => {
      const job = await manager.findOne(ServiceJob, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!job) throw new NotFoundError('Service job not found.');
      if (!['open', 'assigned', 'in_progress'].includes(job.status))
        throw new ConflictError('This job cannot be cancelled.');
      const now = new Date();
      const previous = job.status;
      job.status = 'cancelled';
      job.cancelledAt = now;
      job.cancelledById = admin.user.id;
      job.cancelReason = input.reason;
      await manager.save(job);
      await manager
        .createQueryBuilder()
        .update(ServiceJobOffer)
        .set({ status: 'expired', updatedAt: now })
        .where('"jobId" = :jobId', { jobId: job.id })
        .andWhere('status IN (:...statuses)', {
          statuses: offerRespondedStatuses,
        })
        .execute();
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: 'cancelled',
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
          fromStatus: previous,
          toStatus: 'cancelled',
          note: input.reason,
        }),
      );
      return { reference: job.reference };
    });
    this.changed();
    return result;
  }
  async assignProvider(admin: AdminContext, id: string, raw: unknown) {
    const input = parseReassignInput(raw);
    const result = await this.db.transaction(async (manager) => {
      const job = await manager.findOne(ServiceJob, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!job) throw new NotFoundError('Service job not found.');
      if (!['open', 'assigned', 'in_progress'].includes(job.status))
        throw new ConflictError('This job cannot be reassigned.');
      const provider = await manager.findOne(ServiceProvider, { id: input.providerId });
      if (!provider) throw new NotFoundError('Service provider not found.');
      if (provider.status !== 'active' || provider.optedOutAt)
        throw new BadRequestError('That service provider is not available.');
      const now = new Date();
      await manager
        .createQueryBuilder()
        .update(ServiceJobOffer)
        .set({ status: 'expired', updatedAt: now })
        .where('"jobId" = :jobId AND "providerId" <> :providerId', { jobId: job.id, providerId: provider.id })
        .andWhere('status IN (:...statuses)', {
          statuses: [...offerRespondedStatuses, 'accepted'],
        })
        .execute();
      let offer = await manager.findOne(ServiceJobOffer, { job: job.id, provider: provider.id });
      if (offer) {
        offer.status = 'accepted';
        offer.linkVersion += 1;
        offer.revokedAt = null;
        clearChatCompletion(offer);
        offer.respondedAt = now;
        offer.responseChannel = 'admin';
        offer.responderName = `${admin.user.firstName} ${admin.user.lastName}`;
        offer.lastErrorCode = null;
        offer.lastErrorTitle = null;
        offer.sendingAt = null;
        await manager.save(offer);
      } else {
        offer = await manager.save(
          manager.create(ServiceJobOffer, {
            jobId: job.id,
            providerId: provider.id,
            linkVersion: 1,
            status: 'accepted',
            attempts: 0,
            nextAttemptAt: now,
            respondedAt: now,
            responseChannel: 'admin',
            responderName: `${admin.user.firstName} ${admin.user.lastName}`,
          }),
        );
      }
      const previous = job.status;
      job.providerId = provider.id;
      job.status = 'assigned';
      job.acceptedAt = now;
      await manager.save(job);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: job.id,
          kind: previous === 'open' ? 'assigned' : 'reassigned',
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
          fromStatus: previous,
          toStatus: 'assigned',
          note: input.reason,
          metadata: { providerName: provider.companyName },
        }),
      );
      return {
        reference: job.reference,
        provider: {
          id: provider.id,
          companyName: provider.companyName,
        },
      };
    });
    this.changed();
    return result;
  }
  async addNote(admin: AdminContext, id: string, raw: unknown) {
    const input = parseNoteInput(raw);
    const job = await this.db.em.findOne(ServiceJob, { id });
    if (!job) throw new NotFoundError('Service job not found.');
    await this.db.getRepository(ServiceJobEvent).save({
      job: id,
      kind: 'admin_note',
      actorType: 'admin',
      actorUserId: admin.user.id,
      actorName: `${admin.user.firstName} ${admin.user.lastName}`,
      channel: 'dashboard',
      note: input.note,
    });
    return { id };
  }
  async copyLink(id: string) {
    const offer = await this.db.em.findOne(ServiceJobOffer, { id });
    if (!offer) throw new NotFoundError('Provider request not found.');
    return { link: this.access.link(offer.id, offer.linkVersion) };
  }
  async revokeLink(admin: AdminContext, offerId: string) {
    const result = await this.db.transaction(async (manager) => {
      const { offer } = await this.offerWithJob(manager, offerId);
      offer.linkVersion += 1;
      offer.revokedAt = new Date();
      clearChatCompletion(offer);
      await manager.save(offer);
      await manager.save(ServiceJobEvent, {
        job: offer.jobId,
        kind: 'link_revoked',
        actorType: 'admin',
        actorUserId: admin.user.id,
        actorName: `${admin.user.firstName} ${admin.user.lastName}`,
        channel: 'dashboard',
        note: 'Provider link revoked.',
      });
      return { id: offer.id, linkVersion: offer.linkVersion };
    });
    this.changed();
    return result;
  }
  async resendOffer(admin: AdminContext, offerId: string) {
    const result = await this.db.transaction(async (manager) => {
      const offer = await manager.findOne(ServiceJobOffer, { id: offerId }, { populate: ['job', 'provider'] });
      if (!offer) throw new NotFoundError('Provider request not found.');
      if (offer.status === 'accepted')
        throw new ConflictError('The provider has already accepted this job.');
      if (this.alertSender.recipientNumbers && !this.alertSender.recipientNumbers.includes(offer.provider.whatsappNumber))
        throw new ConflictError('This provider is outside the demo alert audience.');
      if (offer.job.status !== 'open')
        throw new ConflictError('This job is no longer waiting for a provider.');
      const now = new Date();
      offer.status = 'queued';
      offer.linkVersion += 1;
      offer.revokedAt = null;
      clearChatCompletion(offer);
      offer.attempts = 0;
      offer.nextAttemptAt = now;
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
      await manager.save(offer);
      await manager.save(
        manager.create(ServiceJobEvent, {
          jobId: offer.jobId,
          kind: 'alert_requeued',
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: `${admin.user.firstName} ${admin.user.lastName}`,
          channel: 'dashboard',
          note: `Alert queued again for ${offer.provider.contactName}.`,
          metadata: { providerId: offer.providerId },
        }),
      );
      return { id: offer.id };
    });
    this.changed();
    this.wakeWorker();
    return result;
  }

  summaryForJob(job: ServiceJob) {
    return this.jobSummary(job);
  }
  async jobSummaryForIssue(issueId: string): Promise<JobSummary | null> {
    const job = await this.db.em.findOne(ServiceJob, { issue: issueId }, {
      populate: ['provider', 'truck', 'driver.user'],
      orderBy: { createdAt: 'desc', id: 'desc' },
    });
    if (!job) return null;
    const events = await this.db.em.find(ServiceJobEvent, { job: job.id }, { orderBy: { createdAt: 'asc' } });
    return this.jobSummary(job, stageFromEvents(events));
  }
  async jobSummariesForIssues(issueIds: string[]) {
    if (!issueIds.length) return new Map<string, JobSummary>();
    const jobs = await this.db.em.find(
      ServiceJob,
      { issue: { $in: issueIds } },
      { populate: ['provider'], orderBy: { createdAt: 'desc', id: 'desc' } },
    );
    const latest = new Map<string, ServiceJob>();
    for (const job of jobs)
      if (job.issueId && !latest.has(job.issueId)) latest.set(job.issueId, job);
    const stages = await this.latestStages([...latest.values()].map((job) => job.id));
    return new Map(
      [...latest.entries()].map(([issueId, job]) => [
        issueId,
        this.jobSummary(job, stages.get(job.id) ?? null),
      ]),
    );
  }
  async assertNoActiveJobForIssue(
    issueId: string,
    manager: EntityManager | Database = this.db,
  ) {
    const job = (await manager.findOne(ServiceJob, {
      issue: issueId,
      status: In(activeStatuses),
    })) as ServiceJob | null;
    if (job)
      throw new ConflictError(
        `This report has an active service job (${job.reference}). Close the job before resolving it.`,
      );
  }
  async activeJobForTruck(
    manager: EntityManager,
    truckId: string,
  ): Promise<ServiceJob | null> {
    return manager.findOne(
      ServiceJob,
      { truck: truckId, status: In(activeStatuses) },
      { populate: ['truck', 'provider'], orderBy: { createdAt: 'desc', id: 'desc' } },
    );
  }

  private async offerByCode(code: string) {
    const offerId = this.access.offerIdFromCode(code);
    const offer = await this.db.em.findOne(ServiceJobOffer, { id: offerId }, { populate: ['provider'] });
    if (!offer) throw new UnauthorizedError('This link is no longer available.');
    this.access.verifySignature(code, offer.linkVersion);
    const job = await this.db.em.findOne(ServiceJob, { id: offer.jobId }, {
      populate: ['truck', 'provider', 'driver.user', 'issue'],
    });
    if (!job) throw new NotFoundError('Service job not found.');
    return { offer, job };
  }
  async providerViewByCode(code: string) {
    const { offer, job } = await this.offerByCode(code);
    const provider = offer.provider;
    const assignedToProvider = job.providerId === offer.providerId;
    const full =
      assignedToProvider ||
      (job.status === 'open' &&
        ['queued', 'sent', 'delivered', 'read', 'failed'].includes(offer.status));
    const state = assignedToProvider
      ? job.status === 'completed'
        ? 'completed'
        : job.status === 'closed'
          ? 'closed'
          : job.status === 'cancelled'
            ? 'cancelled'
            : job.status === 'in_progress'
              ? 'in_progress'
              : 'assigned'
      : job.status === 'open'
        ? offer.status === 'declined'
          ? 'declined'
          : 'open'
        : offer.status === 'expired'
          ? 'expired'
          : 'assigned_elsewhere';
    const events = assignedToProvider
      ? await this.db.em.find(
          ServiceJobEvent,
          { job: job.id },
          { orderBy: { createdAt: 'asc' } },
        )
      : [];
    const latestStage = stageFromEvents(events);
    if (!full)
      return {
        state,
        reference: job.reference,
        latestStage: null,
        provider: { companyName: provider.companyName },
        officePhone: process.env.FLEET_CONTACT_PHONE ?? null,
      };
    const attachments = assignedToProvider
      ? await this.db.em.find(ServiceJobAttachment, { job: job.id }, { orderBy: { createdAt: 'asc' } })
      : [];
    return {
      state,
      reference: job.reference,
      latestStage,
      status: job.status,
      serviceType: job.serviceType,
      title: job.title,
      urgency: job.urgency,
      description: job.description,
      locationText: job.locationText,
      latitude: job.latitude,
      longitude: job.longitude,
      createdAt: job.createdAt,
      acceptedAt: job.acceptedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      completionNote: assignedToProvider ? job.completionNote : null,
      completionCostCents: assignedToProvider ? job.completionCostCents : null,
      currency: job.currency,
      provider: {
        companyName: provider.companyName,
        contactName: provider.contactName,
      },
      truck: {
        registration: job.truck.registration,
        identifier: job.truck.identifier,
        make: job.truck.make,
        model: job.truck.model,
      },
      canAccept: job.status === 'open' && !assignedToProvider && offer.status !== 'declined',
      canProgress:
        assignedToProvider && ['assigned', 'in_progress'].includes(job.status),
      canComplete:
        assignedToProvider && ['assigned', 'in_progress'].includes(job.status),
      photos: attachments.map((attachment) => attachment.id),
      officePhone: process.env.FLEET_CONTACT_PHONE ?? null,
    };
  }
  async acceptByCode(code: string, actor?: { responderName?: string }) {
    const { offer } = await this.offerByCode(code);
    return this.acceptOffer(offer.id, {
      providerId: offer.providerId,
      channel: 'web',
      linkVersion: offer.linkVersion,
      responderName: actor?.responderName,
    });
  }
  async declineByCode(code: string, actor?: { responderName?: string }) {
    const { offer } = await this.offerByCode(code);
    return this.declineOffer(offer.id, {
      providerId: offer.providerId,
      channel: 'web',
      linkVersion: offer.linkVersion,
      responderName: actor?.responderName,
    });
  }
  async progressByCode(
    code: string,
    stage: ProgressStage,
    actor?: { responderName?: string },
  ) {
    const { offer } = await this.offerByCode(code);
    return this.recordProgress(offer.id, stage, {
      providerId: offer.providerId,
      channel: 'web',
      linkVersion: offer.linkVersion,
      responderName: actor?.responderName,
    });
  }
  async completeByCode(
    code: string,
    raw: unknown,
    files: UploadedPhoto[],
  ) {
    const { offer } = await this.offerByCode(code);
    const { reference, status } = await this.completeOffer(offer.id, raw, files, {
      providerId: offer.providerId,
      channel: 'web',
      linkVersion: offer.linkVersion,
    });
    return { reference, status };
  }
  async providerPhoto(code: string, photoId: string) {
    const { offer, job } = await this.offerByCode(code);
    if (job.providerId !== offer.providerId)
      throw new ForbiddenError('This photo belongs to another provider.');
    const attachment = await this.db
      .getRepository(ServiceJobAttachment)
      .findOneBy({ id: photoId, jobId: job.id });
    if (!attachment) throw new NotFoundError('Photo not found.');
    return {
      type: attachment.mimeType,
      buffer: await readPrivateFile(
        join(serviceJobDir(job.id), attachment.storageName),
      ),
    };
  }
  async adminPhoto(jobId: string, photoId: string) {
    const attachment = await this.db
      .getRepository(ServiceJobAttachment)
      .findOneBy({ id: photoId, jobId });
    if (!attachment) throw new NotFoundError('Photo not found.');
    return {
      type: attachment.mimeType,
      buffer: await readPrivateFile(
        join(serviceJobDir(jobId), attachment.storageName),
      ),
    };
  }

  private offerContext(offer: ServiceJobOffer) {
    if (!offer.job || !offer.provider) return null;
    return {
      offerId: offer.id,
      jobId: offer.jobId,
      jobReference: offer.job.reference,
      jobStatus: offer.job.status,
      providerId: offer.providerId,
      providerPhone: offer.provider.whatsappNumber,
      providerCompany: offer.provider.companyName,
      assignedProviderId: offer.job.providerId,
      revokedAt: offer.revokedAt,
      completionStartedAt: offer.chatCompletionStartedAt,
      completionExpiresAt: offer.chatCompletionExpiresAt,
      completionPhone: offer.chatCompletionPhone,
      completionMediaIds: offer.chatCompletionMediaIds ?? [],
      offerStatus: offer.status,
    };
  }
  async offerById(offerId: string) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(offerId)) return null;
    const offer = await this.db.em.findOne(ServiceJobOffer, { id: offerId }, { populate: ['job', 'provider'] });
    return offer ? this.offerContext(offer) : null;
  }
  async offerByMessageId(wamid: string) {
    const offer = await this.db.em.findOne(ServiceJobOffer, { whatsappMessageId: wamid }, { populate: ['job', 'provider'] });
    return offer ? this.offerContext(offer) : null;
  }
  async completionOffersByProvider(providerId: string) {
    const base = { provider: providerId, status: 'accepted' as const, revokedAt: null };
    const [active, latestCompleted] = await Promise.all([
      this.db.em.find(ServiceJobOffer,
        { ...base, job: { provider: providerId, status: { $in: assignedStatuses } } },
        { populate: ['job', 'provider'], orderBy: { updatedAt: 'desc' } }),
      this.db.em.findOne(ServiceJobOffer,
        { ...base, job: { provider: providerId, status: { $in: ['completed', 'closed'] } } },
        { populate: ['job', 'provider'], orderBy: { updatedAt: 'desc' } }),
    ]);
    return [...active, ...(latestCompleted ? [latestCompleted] : [])].flatMap((offer) => {
      const context = this.offerContext(offer);
      return context ? [context] : [];
    });
  }
  async openOffersByPhone(phone: string) {
    const provider = await this.db
      .getRepository(ServiceProvider)
      .findOneBy({ whatsappNumber: phone });
    if (!provider) return [];
    const offers = await this.db.em.find(
      ServiceJobOffer,
      { provider: provider.id, status: { $in: ['queued', 'sent', 'delivered', 'read', 'failed'] } },
      { populate: ['job'], orderBy: { createdAt: 'desc' } },
    );
    return offers
      .filter((offer) => offer.job?.status === 'open')
      .map((offer) => ({
        offerId: offer.id,
        jobId: offer.jobId,
        reference: offer.job.reference,
        status: offer.status,
      }));
  }
  async providerByPhone(phone: string) {
    return this.db
      .getRepository(ServiceProvider)
      .findOneBy({ whatsappNumber: phone });
  }
  async optOutProvider(phone: string, reason: string) {
    const provider = await this.db
      .getRepository(ServiceProvider)
      .findOneBy({ whatsappNumber: phone });
    if (!provider) return false;
    if (provider.optedOutAt) return true;
    provider.alertsEnabled = false;
    provider.optedOutAt = new Date();
    provider.optOutReason = reason;
    await save(this.db.em, provider);
    this.changed();
    return true;
  }
  async recordMessageStatus(
    wamid: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    error?: { code?: string; title?: string },
  ) {
    const offer = await this.db.em.findOne(ServiceJobOffer, { whatsappMessageId: wamid });
    if (!offer) return;
    const rank: Record<string, number> = {
      queued: 0,
      sent: 1,
      delivered: 2,
      read: 3,
      failed: 4,
    };
    if (status === 'failed') {
      offer.lastErrorCode = error?.code ?? null;
      offer.lastErrorTitle = error?.title ?? null;
      if (!['accepted', 'declined', 'expired'].includes(offer.status)) offer.status = 'failed';
    } else {
      const current = rank[offer.status] ?? 0;
      if (rank[status] > current && !['accepted', 'declined', 'expired'].includes(offer.status))
        offer.status = status;
      if (status === 'sent') offer.sentAt ??= new Date();
      if (status === 'delivered') offer.deliveredAt ??= new Date();
      if (status === 'read') offer.readAt ??= new Date();
    }
    await save(this.db.em, offer);
    this.changed();
  }
  async dueAlertOffers(limit = 10): Promise<AlertOffer[]> {
    const claimed = (await this.db.execute(
      `WITH due AS (
         SELECT o.id
         FROM app.service_job_offers o
         JOIN app.service_jobs j ON j.id = o."jobId"
         JOIN app.service_providers p ON p.id = o."providerId"
         WHERE o.status = 'queued' AND o."revokedAt" IS NULL
           AND o."nextAttemptAt" <= now()
           AND j.status = 'open'
           AND p.status = 'active'
           AND p."alertsEnabled" = true
           AND p."optedInAt" IS NOT NULL
           AND p."optedOutAt" IS NULL
           AND ($2::text[] IS NULL OR p."whatsappNumber" = ANY($2::text[]))
         ORDER BY o."nextAttemptAt"
         LIMIT $1
         FOR UPDATE OF o SKIP LOCKED
       )
       UPDATE app.service_job_offers o
       SET status = 'sending', "sendingAt" = now(), attempts = o.attempts + 1,
           "updatedAt" = now()
       FROM due
       WHERE o.id = due.id
       RETURNING o.id`,
      [limit, this.alertSender.recipientNumbers],
    )) as Array<{ id: string }>;
    if (!claimed.length) return [];
    const ids = claimed.map((row) => row.id);
    const offers = await this.db.em.find(ServiceJobOffer, { id: { $in: ids } }, {
      populate: ['provider', 'job.truck'],
    });
    return offers.map((offer) => {
      const provider = offer.provider;
      const job = offer.job;
      return {
        offerId: offer.id,
        jobId: offer.jobId,
        providerId: offer.providerId,
        attempts: offer.attempts,
        linkVersion: offer.linkVersion,
        reference: job.reference,
        providerPhone: provider.whatsappNumber,
        providerCompany: provider.companyName,
        truckRegistration: job.truck.registration,
        truckIdentifier: job.truck.identifier,
        serviceType: job.serviceType,
        issueSummary: job.description,
        locationText: job.locationText,
        link: this.access.link(offer.id, offer.linkVersion),
      } satisfies AlertOffer;
    });
  }
  async markAlertSent(offerId: string, linkVersion: number, wamid: string) {
    // Acceptance/assignment may expire the offer while a concurrent send is
    // in flight. Keep the WhatsApp receipt without reopening that offer.
    await this.db.execute(
      `UPDATE app.service_job_offers
       SET status = CASE WHEN status = 'sending' THEN 'sent' ELSE status END,
           "sentAt" = now(), "sendingAt" = NULL, "whatsappMessageId" = $3,
           "lastErrorCode" = NULL, "lastErrorTitle" = NULL, "updatedAt" = now()
       WHERE id = $1 AND "linkVersion" = $2`,
      [offerId, linkVersion, wamid],
    );
    this.changed();
  }
  async markAlertFailed(
    offerId: string,
    linkVersion: number,
    error: { code?: string; title?: string },
    permanent: boolean,
    retryAt?: Date,
  ) {
    await this.db.update(ServiceJobOffer,
      { id: offerId, linkVersion, status: 'sending' },
      {
        status: permanent ? 'failed' : 'queued',
        sendingAt: null,
        nextAttemptAt: retryAt ?? new Date(),
        lastErrorCode: error.code ?? null,
        lastErrorTitle: error.title ?? null,
      },
    );
    this.changed();
  }
  async recoverStaleAlerts() {
    await this.db.execute(
      `UPDATE app.service_job_offers
       SET status = 'failed',
           "lastErrorCode" = 'STALE_SEND',
           "lastErrorTitle" = 'Send outcome unknown. Check with the provider before resending.',
           "sendingAt" = NULL,
           "updatedAt" = now()
       WHERE status = 'sending' AND "sendingAt" < now() - interval '5 minutes'`,
    );
  }
  async jobDetailsForProvider(offerId: string) {
    const offer = await this.db.em.findOne(ServiceJobOffer, { id: offerId }, { populate: ['job', 'provider'] });
    if (!offer?.job) return null;
    return {
      reference: offer.job.reference,
      status: offer.job.status,
      providerName: offer.provider.companyName,
      providerPhone: offer.provider.whatsappNumber,
      revokedAt: offer.revokedAt,
      linkVersion: offer.linkVersion,
      link: this.access.link(offer.id, offer.linkVersion),
    };
  }
}
