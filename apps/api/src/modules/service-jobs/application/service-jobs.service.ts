import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  LockMode,
  type EntityManager,
  type FilterQuery,
  type MikroORM,
} from '@mikro-orm/postgresql';
import { getEm, pgErrorCode, rawQuery } from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../shared/errors.js';
import { isUuid } from '../../../shared/identifiers.js';
import { photoType, type UploadedPhoto } from '../../../shared/storage/photo.js';
import {
  ensurePrivateDirectory,
  readPrivateFile,
  serviceJobDir,
  writePrivateFile,
} from '../../../shared/storage/private-storage.js';
import { escapeLikePattern } from '../../../shared/validation.js';
import { DriverProfile } from '../../fleet/domain/driver.entity.js';
import { Truck } from '../../fleet/domain/truck.entity.js';
import type { AdminContext } from '../../identity/application/auth.service.js';
import { User, userFullName } from '../../identity/domain/user.entity.js';
import {
  DriverIssue,
  isIssueResolved,
  reopenIssue,
  resolveIssue,
} from '../../issues/domain/driver-issue.entity.js';
import type { OperationsEventsService } from '../../operations/application/operations-events.service.js';
import type { JobAlertSender } from '../../whatsapp/infrastructure/job-alert-sender.js';
import type { ServiceJobAccess } from '../domain/service-job-access.js';
import { ServiceJobAttachment } from '../domain/service-job-attachment.entity.js';
import { ServiceJobEvent } from '../domain/service-job-event.entity.js';
import {
  assignOfferByAdmin,
  clearOfferChatCompletion,
  recordOfferDeliveryStatus,
  recordOfferResponse,
  requeueOffer,
  revokeOffer,
  ServiceJobOffer,
} from '../domain/service-job-offer.entity.js';
import {
  acceptServiceJob,
  activeJobStatuses,
  assignedJobStatuses,
  assignServiceJobProvider,
  cancelServiceJob,
  closeServiceJob,
  completeServiceJob,
  isServiceJobActive,
  markServiceJobInProgress,
  reopenServiceJob,
  ServiceJob,
  type JobStatus,
  type OfferStatus,
  type ProgressStage,
  type ServiceType,
} from '../domain/service-job.entity.js';
import {
  canProviderReceiveAlerts,
  optOutServiceProvider,
  recordProviderConsent,
  ServiceProvider,
  updateProviderStatus,
} from '../domain/service-provider.entity.js';
import {
  displayWhatsAppNumber,
  parseCancelInput,
  parseCloseInput,
  parseCompletionInput,
  parseJobInput,
  parseNoteInput,
  parseProviderConsentInput,
  parseProviderInput,
  parseProviderStatusInput,
  parseReassignInput,
  parseReopenInput,
  serviceTypeLabels,
} from '../http/service-job.dto.js';

const pageSize = 20;
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
const chatCompletionMinutes = 30;

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

function queryText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function pageNumber(raw: unknown) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 999_999 ? value : 1;
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
    if (kind === 'en_route' || kind === 'arrived' || kind === 'working') {
      return kind;
    }
  }
  return null;
}

export class ServiceJobsService {
  onAlertsQueued?: () => void;

  constructor(
    private readonly orm: MikroORM,
    private readonly events: OperationsEventsService,
    private readonly access: ServiceJobAccess,
    private readonly alertSender: Pick<
      JobAlertSender,
      'configured' | 'recipientNumbers'
    >,
  ) {}

  get alertsReady() {
    return (
      process.env.SERVICE_JOB_ALERTS_ENABLED === 'true' &&
      Boolean(process.env.SERVICE_JOB_LINK_SECRET) &&
      this.alertSender.configured
    );
  }

  wakeWorker() {
    this.onAlertsQueued?.();
  }

  private changed() {
    this.events.changed();
  }

  private async nextReference(em: EntityManager): Promise<string> {
    const [row] = await rawQuery<{ value: string | number }>(
      em,
      `SELECT nextval('app.service_job_reference_seq') AS value`,
    );
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
      receivesAlerts: canProviderReceiveAlerts(
        provider,
        this.alertSender.recipientNumbers,
      ),
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
      isActive: isServiceJobActive(job),
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
            name: userFullName(job.driver.user),
          }
        : null,
      description: job.description,
      urgency: job.urgency,
      locationText: job.locationText,
      updatedAt: job.updatedAt,
    };
  }

  async latestStages(ids: string[]) {
    if (!ids.length) return new Map<string, ProgressStage>();
    const rows = await rawQuery<{ jobId: string; kind: ProgressStage }>(
      getEm(this.orm),
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
    const page = pageNumber(query.page);
    const q = queryText(query.q, 200) ?? '';
    const status = queryText(query.status, 16) ?? '';
    const em = getEm(this.orm);

    const where: FilterQuery<ServiceProvider> = {};
    const conditions: FilterQuery<ServiceProvider>[] = [];
    if (q) {
      const pattern = escapeLikePattern(q);
      conditions.push({
        $or: [
          { companyName: { $ilike: pattern } },
          { contactName: { $ilike: pattern } },
          { whatsappNumber: { $ilike: pattern } },
          { coverageArea: { $ilike: pattern } },
        ],
      });
    }
    if (status === 'active' || status === 'paused') {
      conditions.push({ status });
    } else if (status === 'receives_alerts' || status === 'alerts_off') {
      const audience = this.alertSender.recipientNumbers;
      const phones = audience?.length ? audience : [''];
      if (status === 'receives_alerts') {
        conditions.push({
          status: 'active',
          alertsEnabled: true,
          optedInAt: { $ne: null },
          optedOutAt: null,
          ...(audience ? { whatsappNumber: { $in: phones } } : {}),
        });
      } else {
        conditions.push({
          $or: [
            { alertsEnabled: false },
            { optedInAt: null },
            { optedOutAt: { $ne: null } },
            ...(audience ? [{ whatsappNumber: { $nin: phones } }] : []),
          ],
        });
      }
    }
    if (conditions.length) where.$and = conditions;

    const [providers, total] = await em.findAndCount(ServiceProvider, where, {
      orderBy: { companyName: 'asc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const metrics = providers.length
      ? await rawQuery<{
          providerId: string;
          handled: number;
          lastJobAt: Date | null;
        }>(
          em,
          `SELECT "providerId",
             count(*) FILTER (WHERE status IN ('completed', 'closed'))::int AS handled,
             max("acceptedAt") AS "lastJobAt"
           FROM app.service_jobs
           WHERE "providerId" = ANY($1::uuid[])
           GROUP BY "providerId"`,
          [providers.map((provider) => provider.id)],
        )
      : [];

    const byProvider = new Map(
      metrics.map((metric) => [metric.providerId, metric]),
    );
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
    const em = getEm(this.orm);
    const provider = await em.findOne(ServiceProvider, { id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    if (!includeJobs) return { provider: this.providerView(provider), jobs: [] };

    const jobs = await em.find(
      ServiceJob,
      { provider: id },
      {
        populate: ['truck', 'provider', 'driver.user'],
        orderBy: { createdAt: 'desc', id: 'desc' },
        limit: 10,
      },
    );
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
    if (input.alertsEnabled && !input.consent) {
      throw new BadRequestError(
        'Confirm that the provider agreed to receive WhatsApp job alerts.',
      );
    }
    const em = getEm(this.orm);
    const now = new Date();
    try {
      const provider = em.create(ServiceProvider, {
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
        optInBy: input.alertsEnabled ? em.getReference(User, admin.user.id) : null,
        optedOutAt: null,
        optOutReason: null,
        createdBy: em.getReference(User, admin.user.id),
      });
      await em.persist(provider).flush();
      this.changed();
      return this.providerView(provider);
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new ConflictError(
          'A service provider with this WhatsApp number already exists.',
        );
      }
      throw error;
    }
  }

  async updateProvider(admin: AdminContext, id: string, raw: unknown) {
    const input = parseProviderInput(raw);
    const em = getEm(this.orm);
    try {
      const updated = await em.transactional(async (tx) => {
        const provider = await tx.findOne(ServiceProvider, { id });
        if (!provider) throw new NotFoundError('Service provider not found.');
        const numberChanged = provider.whatsappNumber !== input.whatsappNumber;
        const reEnabling =
          input.alertsEnabled &&
          (!provider.alertsEnabled || Boolean(provider.optedOutAt));
        const needsConsent =
          numberChanged ||
          reEnabling ||
          (input.alertsEnabled && !provider.optedInAt);
        if (needsConsent && !input.consent) {
          throw new BadRequestError(
            'Confirm that the provider agreed to receive WhatsApp job alerts.',
          );
        }

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
          provider.optInBy = tx.getReference(User, admin.user.id);
          provider.optedOutAt = null;
          provider.optOutReason = null;
        }
        await tx.flush();

        if (numberChanged || reEnabling) {
          await rawQuery(
            tx,
            `UPDATE app.service_job_offers
             SET "linkVersion" = "linkVersion" + 1, "updatedAt" = now()
             WHERE "providerId" = $1
               AND status NOT IN ('accepted', 'declined', 'expired')`,
            [provider.id],
          );
        }
        return provider;
      });
      this.changed();
      return this.providerView(updated);
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new ConflictError(
          'A service provider with this WhatsApp number already exists.',
        );
      }
      throw error;
    }
  }

  async setProviderStatus(_admin: AdminContext, id: string, raw: unknown) {
    const { status } = parseProviderStatusInput(raw);
    const em = getEm(this.orm);
    const provider = await em.findOne(ServiceProvider, { id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    updateProviderStatus(provider, status);
    await em.flush();
    this.changed();
    return this.providerView(provider);
  }

  async confirmProviderConsent(admin: AdminContext, id: string, raw: unknown) {
    parseProviderConsentInput(raw);
    const em = getEm(this.orm);
    const provider = await em.findOne(ServiceProvider, { id });
    if (!provider) throw new NotFoundError('Service provider not found.');
    recordProviderConsent(provider, em.getReference(User, admin.user.id));
    await em.flush();
    this.changed();
    return this.providerView(provider);
  }

  async summary() {
    const [row] = await rawQuery<{
      waiting: number;
      working: number;
      awaitingClose: number;
      closedToday: number;
    }>(
      getEm(this.orm),
      `SELECT
        count(*) FILTER (WHERE status = 'open')::int AS waiting,
        count(*) FILTER (WHERE status IN ('assigned', 'in_progress'))::int AS working,
        count(*) FILTER (WHERE status = 'completed')::int AS "awaitingClose",
        count(*) FILTER (
          WHERE status = 'closed'
            AND "closedAt" >= (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')
        )::int AS "closedToday"
       FROM app.service_jobs`,
    );
    return {
      ...row,
      alertsReady: this.alertsReady,
    };
  }

  async listJobs(query: Record<string, unknown>) {
    const page = pageNumber(query.page);
    const q = queryText(query.q, 200) ?? '';
    const providerId = queryText(query.providerId, 36) ?? '';
    const statuses = statusFilter(queryText(query.status, 16) ?? undefined);
    const em = getEm(this.orm);

    const where: FilterQuery<ServiceJob> = {};
    if (statuses) where.status = { $in: statuses };
    if (providerId && isUuid(providerId)) where.provider = providerId;
    if (q) {
      const pattern = escapeLikePattern(q);
      where.$or = [
        { reference: { $ilike: pattern } },
        { description: { $ilike: pattern } },
        { truck: { registration: { $ilike: pattern } } },
        { truck: { identifier: { $ilike: pattern } } },
        { provider: { companyName: { $ilike: pattern } } },
      ];
    }

    const [jobs, total] = await em.findAndCount(ServiceJob, where, {
      populate: ['truck', 'provider', 'driver.user', 'issue'],
      orderBy: { createdAt: 'desc', id: 'desc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const [stages, counts] = await Promise.all([
      this.latestStages(jobs.map((job) => job.id)),
      this.summary(),
    ]);

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
    const em = getEm(this.orm);
    const job = await em.findOne(
      ServiceJob,
      { id },
      {
        populate: [
          'truck',
          'provider',
          'driver.user',
          'issue',
          'closedBy',
          'cancelledBy',
          'createdBy',
        ],
      },
    );
    if (!job) throw new NotFoundError('Service job not found.');

    const [offers, events, attachments, activeProviderCount] =
      await Promise.all([
        em.find(
          ServiceJobOffer,
          { job: id },
          { populate: ['provider'], orderBy: { createdAt: 'asc' } },
        ),
        em.find(
          ServiceJobEvent,
          { job: id },
          { populate: ['actorUser', 'provider'], orderBy: { createdAt: 'asc' } },
        ),
        em.find(
          ServiceJobAttachment,
          { job: id },
          { orderBy: { createdAt: 'asc' } },
        ),
        em.count(ServiceProvider, this.eligibleProviderWhere()),
      ]);

    return {
      job: {
        ...this.jobListRow(job),
        latestStage: stageFromEvents(events),
        issueId: job.issue?.id ?? null,
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
        closedBy: job.closedBy ? userFullName(job.closedBy) : null,
        cancelledBy: job.cancelledBy ? userFullName(job.cancelledBy) : null,
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
            ? userFullName(event.actorUser)
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
      activeProviderCount,
      alertsReady: this.alertsReady,
    };
  }

  private eligibleProviderWhere(): FilterQuery<ServiceProvider> {
    return {
      status: 'active',
      alertsEnabled: true,
      optedOutAt: null,
      optedInAt: { $ne: null },
      ...(this.alertSender.recipientNumbers
        ? { whatsappNumber: { $in: this.alertSender.recipientNumbers } }
        : {}),
    };
  }

  private async queueOffers(
    tx: EntityManager,
    job: ServiceJob,
    eventActor: Actor,
    retry: boolean,
  ): Promise<number> {
    if (!this.alertsReady) {
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'alerts_skipped',
          actorType: 'system',
          actorUser: null,
          provider: null,
          actorName: null,
          channel: 'system',
          fromStatus: null,
          toStatus: null,
          note: 'Provider alerts are not configured.',
          metadata: { reason: 'alerts_unavailable' },
        }),
      );
      await tx.flush();
      return 0;
    }

    const providers = await tx.find(
      ServiceProvider,
      this.eligibleProviderWhere(),
      { orderBy: { companyName: 'asc' } },
    );
    if (!providers.length) {
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'alerts_skipped',
          actorType: 'system',
          actorUser: null,
          provider: null,
          actorName: null,
          channel: 'system',
          fromStatus: null,
          toStatus: null,
          note: 'No active service providers are configured.',
          metadata: { reason: 'no_providers' },
        }),
      );
      await tx.flush();
      return 0;
    }

    const existing = await tx.find(ServiceJobOffer, { job: job.id });
    const byProvider = new Map(
      existing.map((offer) => [offer.provider.id, offer]),
    );
    let queued = 0;
    const now = new Date();

    for (const provider of providers) {
      const offer = byProvider.get(provider.id);
      if (offer) {
        if (offer.status === 'accepted' || offer.status === 'sending') continue;
        if (
          offer.status === 'queued' ||
          ((offer.status === 'sent' ||
            offer.status === 'delivered' ||
            offer.status === 'read') &&
            !retry)
        ) {
          continue;
        }
        if (
          (offer.status === 'declined' ||
            offer.status === 'expired' ||
            offer.status === 'failed') &&
          retry
        ) {
          requeueOffer(offer, now);
          queued += 1;
        }
        continue;
      }

      tx.persist(
        tx.create(ServiceJobOffer, {
          job,
          provider,
          linkVersion: 1,
          status: 'queued',
          nextAttemptAt: now,
          revokedAt: null,
          chatCompletionPhone: null,
          chatCompletionStartedAt: null,
          chatCompletionExpiresAt: null,
          chatCompletionRemindedAt: null,
          chatCompletionMediaIds: null,
          chatCompletionCostCents: null,
          sendingAt: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          respondedAt: null,
          whatsappMessageId: null,
          lastErrorCode: null,
          lastErrorTitle: null,
          responderName: null,
          responseChannel: null,
        }),
      );
      queued += 1;
    }

    if (queued) {
      job.broadcastAt ??= now;
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'alerts_queued',
          actorType: eventActor.actorType,
          actorUser: eventActor.actorUserId
            ? tx.getReference(User, eventActor.actorUserId)
            : null,
          provider: null,
          actorName: eventActor.actorName ?? null,
          channel: eventActor.channel,
          fromStatus: null,
          toStatus: null,
          note: `Alert sent to ${queued} service provider${queued === 1 ? '' : 's'}.`,
          metadata: { count: queued },
        }),
      );
    }
    await tx.flush();
    return queued;
  }

  async createJob(admin: AdminContext, raw: unknown) {
    const input = parseJobInput(raw);
    const em = getEm(this.orm);
    const truck = await em.findOne(Truck, { id: input.truckId });
    if (!truck) throw new NotFoundError('Vehicle not found.');

    const result = await em.transactional(async (tx) => {
      const issue = input.issueId
        ? await this.reportForNewJob(tx, input.issueId)
        : null;
      if (issue && issue.truck?.id !== truck.id) {
        throw new BadRequestError('The report belongs to another vehicle.');
      }
      const driverId =
        issue?.driver.id ??
        (await tx.findOne(DriverProfile, { currentTruck: truck.id }))?.id ??
        null;

      const job = tx.create(ServiceJob, {
        id: input.id ?? randomUUID(),
        reference: await this.nextReference(tx),
        issue: issue ?? null,
        truck: tx.getReference(Truck, truck.id),
        driver: driverId ? tx.getReference(DriverProfile, driverId) : null,
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
        provider: null,
        broadcastAt: null,
        acceptedAt: null,
        startedAt: null,
        completedAt: null,
        completionNote: null,
        completionCostCents: null,
        closedAt: null,
        closedBy: null,
        closeNote: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        source: 'admin',
        createdBy: tx.getReference(User, admin.user.id),
      });
      tx.persist(job);
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'created',
          actorType: 'admin',
          actorUser: tx.getReference(User, admin.user.id),
          provider: null,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
          fromStatus: null,
          toStatus: 'open',
          note: input.description,
          metadata: null,
        }),
      );
      await tx.flush();

      if (input.notifyProviders) {
        await this.queueOffers(
          tx,
          job,
          {
            actorType: 'admin',
            actorUserId: admin.user.id,
            actorName: userFullName(admin.user),
            channel: 'dashboard',
          },
          false,
        );
      }
      return job;
    });

    this.changed();
    if (input.notifyProviders) this.wakeWorker();
    return this.jobSummary(result);
  }

  async createForIssue(
    tx: EntityManager,
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
    const active = await tx.findOne(
      ServiceJob,
      { issue: input.issueId, status: { $in: [...activeJobStatuses] } },
      { populate: ['truck', 'provider'] },
    );
    if (active) {
      return {
        job: active,
        duplicate: true,
        alerts: input.notifyProviders
          ? ('skipped' as const)
          : ('none' as const),
      };
    }

    const job = tx.create(ServiceJob, {
      reference: await this.nextReference(tx),
      issue: tx.getReference(DriverIssue, input.issueId),
      truck: tx.getReference(Truck, input.truckId),
      driver: tx.getReference(DriverProfile, input.driverId),
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
      provider: null,
      broadcastAt: null,
      acceptedAt: null,
      startedAt: null,
      completedAt: null,
      completionNote: null,
      completionCostCents: null,
      closedAt: null,
      closedBy: null,
      closeNote: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      source: 'driver',
      createdBy: null,
    });
    tx.persist(job);
    tx.persist(
      tx.create(ServiceJobEvent, {
        job,
        kind: 'created',
        actorType: 'driver',
        actorUser: null,
        provider: null,
        actorName: input.driverName,
        channel: 'app',
        fromStatus: null,
        toStatus: 'open',
        note: input.description,
        metadata: null,
      }),
    );
    await tx.flush();

    let alerts: 'queued' | 'skipped' | 'none' = 'none';
    if (input.notifyProviders) {
      const queued = await this.queueOffers(
        tx,
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
    const queued = await getEm(this.orm).transactional(async (tx) => {
      const job = await tx.findOne(
        ServiceJob,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!job) throw new NotFoundError('Service job not found.');
      if (job.status !== 'open') {
        throw new ConflictError('This job is no longer waiting for a provider.');
      }
      return this.queueOffers(
        tx,
        job,
        {
          actorType: 'admin',
          actorUserId: admin.user.id,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
        },
        true,
      );
    });
    this.changed();
    if (queued) this.wakeWorker();
    return { queued };
  }

  private async offerWithJob(tx: EntityManager, offerId: string) {
    const initial = await tx.findOne(ServiceJobOffer, { id: offerId });
    if (!initial) throw new NotFoundError('Provider request not found.');
    // All provider mutations take the job lock first so only the winner writes evidence/events.
    const job = await tx.findOne(
      ServiceJob,
      { id: initial.job.id },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    const offer = await tx.findOne(
      ServiceJobOffer,
      { id: offerId },
      { populate: ['provider'], refresh: true },
    );
    if (!job || !offer) throw new NotFoundError('Provider request not found.');
    return { offer, job };
  }

  private assertOfferActor(offer: ServiceJobOffer, actor: ProviderActor) {
    if (
      offer.provider.id !== actor.providerId ||
      (actor.channel === 'whatsapp' &&
        (!actor.phone ||
          actor.phone !== offer.provider.whatsappNumber ||
          offer.revokedAt)) ||
      (actor.linkVersion !== undefined &&
        offer.linkVersion !== actor.linkVersion)
    ) {
      throw new ForbiddenError('This provider request is no longer available.');
    }
  }

  private assertAssignedOffer(
    offer: ServiceJobOffer,
    job: ServiceJob,
    actor: ProviderActor,
  ) {
    this.assertOfferActor(offer, actor);
    if (offer.status !== 'accepted' || job.provider?.id !== actor.providerId) {
      throw new ForbiddenError('This provider request is no longer available.');
    }
  }

  async beginChatCompletion(
    offerId: string,
    actor: ProviderActor,
    receivedAt: Date,
  ) {
    return getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (job.status === 'completed' || job.status === 'closed') {
        return 'completed' as const;
      }
      if (!assignedJobStatuses.includes(job.status)) {
        throw new ConflictError('This job cannot be completed.');
      }
      const now = new Date();
      if (
        offer.chatCompletionPhone === actor.phone &&
        offer.chatCompletionExpiresAt
      ) {
        return offer.chatCompletionExpiresAt <= now
          ? ('expired' as const)
          : ('collecting' as const);
      }
      const expiresAt = new Date(
        receivedAt.getTime() + chatCompletionMinutes * 60_000,
      );
      if (expiresAt <= now) return 'expired' as const;
      clearOfferChatCompletion(offer);
      offer.chatCompletionPhone = actor.phone!;
      offer.chatCompletionStartedAt = receivedAt;
      offer.chatCompletionExpiresAt = expiresAt;
      await tx.flush();
      return 'collecting' as const;
    });
  }

  async editChatCompletion(
    offerId: string,
    actor: ProviderActor,
    edit: ChatCompletionEdit,
  ) {
    return getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (
        !assignedJobStatuses.includes(job.status) ||
        offer.chatCompletionPhone !== actor.phone ||
        !offer.chatCompletionExpiresAt ||
        offer.chatCompletionExpiresAt <= new Date()
      ) {
        throw new ConflictError('This completion request has ended.');
      }
      if ('mediaId' in edit) {
        const ids = offer.chatCompletionMediaIds ?? [];
        if (ids.includes(edit.mediaId)) return ids.length;
        if (ids.length >= 3) {
          throw new BadRequestError('You can add up to 3 photos.');
        }
        offer.chatCompletionMediaIds = [...ids, edit.mediaId];
      } else if ('clearPhotos' in edit) {
        offer.chatCompletionMediaIds = null;
      } else {
        offer.chatCompletionCostCents = parseCompletionInput({
          note: 'Amount',
          costCents: edit.costCents,
        }).costCents;
      }
      await tx.flush();
      return offer.chatCompletionMediaIds?.length ?? 0;
    });
  }

  async claimChatCompletionReminders() {
    return rawQuery<{
      offerId: string;
      jobId: string;
      providerId: string;
      phone: string;
      linkVersion: number;
    }>(
      getEm(this.orm),
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

  async acceptOffer(offerId: string, actor: ProviderActor) {
    const result = await getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      this.assertOfferActor(offer, actor);
      if (
        offer.status === 'accepted' &&
        job.provider?.id === offer.provider.id &&
        ['assigned', 'in_progress', 'completed', 'closed'].includes(job.status)
      ) {
        return {
          outcome: 'accepted' as const,
          reference: job.reference,
          providerName: offer.provider.companyName,
        };
      }
      if (
        job.status !== 'open' ||
        !offerRespondedStatuses.includes(offer.status)
      ) {
        throw new ConflictError(
          'This job has already been assigned to another provider.',
        );
      }

      const now = new Date();
      acceptServiceJob(job, offer.provider, now);
      const responderName =
        actor.responderName ?? actor.profileName ?? offer.provider.contactName;
      recordOfferResponse(offer, 'accepted', actor.channel, responderName, now);

      await tx.nativeUpdate(
        ServiceJobOffer,
        {
          job: job.id,
          id: { $ne: offer.id },
          status: { $in: offerRespondedStatuses },
        },
        { status: 'expired', updatedAt: now },
      );

      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'accepted',
          actorType: 'provider',
          actorUser: null,
          provider: offer.provider,
          actorName: responderName,
          channel: actor.channel,
          fromStatus: 'open',
          toStatus: 'assigned',
          note: null,
          metadata: { providerName: offer.provider.companyName },
        }),
      );
      await tx.flush();
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
    const result = await getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      this.assertOfferActor(offer, actor);
      if (offer.status === 'declined') return { outcome: 'declined' as const };
      if (
        job.status !== 'open' ||
        !offerRespondedStatuses.includes(offer.status)
      ) {
        return { outcome: 'not_open' as const };
      }
      const now = new Date();
      const responderName =
        actor.responderName ?? actor.profileName ?? offer.provider.contactName;
      recordOfferResponse(offer, 'declined', actor.channel, responderName, now);
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'declined',
          actorType: 'provider',
          actorUser: null,
          provider: offer.provider,
          actorName: responderName,
          channel: actor.channel,
          fromStatus: null,
          toStatus: null,
          note: null,
          metadata: { providerName: offer.provider.companyName },
        }),
      );
      await tx.flush();
      return { outcome: 'declined' as const };
    });
    this.changed();
    return result;
  }

  async recordProgress(
    offerId: string,
    stage: ProgressStage,
    actor: ProviderActor,
  ) {
    const result = await getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (!assignedJobStatuses.includes(job.status)) {
        throw new ConflictError('This job is no longer in progress.');
      }
      const events = await tx.find(
        ServiceJobEvent,
        { job: job.id },
        { orderBy: { createdAt: 'asc' } },
      );
      const current = stageFromEvents(events);
      if (current && progressRank[stage] <= progressRank[current]) {
        return {
          outcome: 'ok' as const,
          stage: current,
          reference: job.reference,
        };
      }
      const now = new Date();
      const previous = markServiceJobInProgress(job, now);
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: stage,
          actorType: 'provider',
          actorUser: null,
          provider: offer.provider,
          actorName:
            actor.responderName ??
            actor.profileName ??
            offer.provider.contactName,
          channel: actor.channel,
          fromStatus: previous,
          toStatus: 'in_progress',
          note: null,
          metadata: { providerName: offer.provider.companyName },
        }),
      );
      await tx.flush();
      return { outcome: 'ok' as const, stage, reference: job.reference };
    });
    this.changed();
    return result;
  }

  private async writeCompletionPhotos(jobId: string, files: UploadedPhoto[]) {
    if (files.length > 3) throw new BadRequestError('Choose up to 3 photos.');
    const photos = files.map((file) => ({
      id: randomUUID(),
      type: photoType(file),
      buffer: file.buffer,
      size: file.buffer.length,
    }));
    await ensurePrivateDirectory(serviceJobDir(jobId));
    for (const photo of photos) {
      await writePrivateFile(join(serviceJobDir(jobId), photo.id), photo.buffer);
    }
    return photos;
  }

  async completeOffer(
    offerId: string,
    raw: unknown,
    files: UploadedPhoto[],
    actor: ProviderActor,
    chat?: { startedAt: Date; mediaIds: string[] },
  ) {
    const result = await getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      this.assertAssignedOffer(offer, job, actor);
      if (job.status === 'completed' || job.status === 'closed') {
        if (chat) {
          return {
            reference: job.reference,
            status: job.status,
            alreadyCompleted: true,
          };
        }
        throw new ConflictError('This job has already been completed.');
      }
      if (!assignedJobStatuses.includes(job.status)) {
        throw new ConflictError('This job cannot be completed.');
      }
      if (
        chat &&
        (!offer.chatCompletionExpiresAt ||
          offer.chatCompletionExpiresAt <= new Date() ||
          offer.chatCompletionPhone !== actor.phone ||
          offer.chatCompletionStartedAt?.getTime() !==
            chat.startedAt.getTime() ||
          JSON.stringify(chat.mediaIds) !==
            JSON.stringify(offer.chatCompletionMediaIds ?? []))
      ) {
        throw new ConflictError(
          'This completion request has changed. Please try again.',
        );
      }

      const input = parseCompletionInput(
        chat
          ? { ...(raw as object), costCents: offer.chatCompletionCostCents }
          : raw,
      );
      const photos = await this.writeCompletionPhotos(job.id, files);
      const now = new Date();
      clearOfferChatCompletion(offer);
      const previous = completeServiceJob(
        job,
        input.note,
        input.costCents,
        input.currency,
        now,
      );

      const event = tx.create(ServiceJobEvent, {
        job,
        kind: 'completed',
        actorType: 'provider',
        actorUser: null,
        provider: offer.provider,
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
      });
      tx.persist(event);

      for (const photo of photos) {
        tx.persist(
          tx.create(ServiceJobAttachment, {
            job,
            event,
            kind: 'completion_photo',
            mimeType: photo.type,
            byteSize: photo.size,
            storageName: photo.id,
            uploadedByProvider: offer.provider,
            uploadedByUser: null,
          }),
        );
      }
      await tx.flush();
      return {
        reference: job.reference,
        status: job.status,
        alreadyCompleted: false,
      };
    });
    if (!result.alreadyCompleted) this.changed();
    return result;
  }

  async closeJob(admin: AdminContext, id: string, raw: unknown) {
    const input = parseCloseInput(raw);
    if (input.resolveIssue && !admin.permissions.includes('issues.resolve')) {
      throw new ForbiddenError('You cannot resolve driver reports.');
    }

    const result = await getEm(this.orm).transactional(async (tx) => {
      const job = await tx.findOne(
        ServiceJob,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!job) throw new NotFoundError('Service job not found.');
      const linkedIssue = job.issue
        ? await tx.findOne(DriverIssue, { id: job.issue.id })
        : null;

      const now = new Date();
      const adminRef = tx.getReference(User, admin.user.id);
      const previous = closeServiceJob(job, adminRef, input.note, now);

      if (input.resolveIssue && job.issue && linkedIssue) {
        const other = await tx.findOne(ServiceJob, {
          issue: job.issue.id,
          id: { $ne: job.id },
          status: { $in: [...activeJobStatuses] },
        });
        if (other) {
          throw new ConflictError(
            'Another service job is still active for this driver report.',
          );
        }
        const issue = await tx.findOne(
          DriverIssue,
          { id: job.issue.id },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!issue) throw new NotFoundError('Driver report not found.');
        if (isIssueResolved(issue)) {
          throw new ConflictError('This driver report is already resolved.');
        }
        resolveIssue(issue, adminRef, input.note, now);
        job.resolvedIssueOnClose = true;
        tx.persist(
          tx.create(ServiceJobEvent, {
            job,
            kind: 'issue_resolved',
            actorType: 'admin',
            actorUser: adminRef,
            provider: null,
            actorName: userFullName(admin.user),
            channel: 'dashboard',
            fromStatus: null,
            toStatus: null,
            note: input.note,
            metadata: null,
          }),
        );
      }

      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'closed',
          actorType: 'admin',
          actorUser: adminRef,
          provider: null,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
          fromStatus: previous,
          toStatus: 'closed',
          note: input.note,
          metadata: null,
        }),
      );
      await tx.flush();

      await tx.nativeUpdate(
        ServiceJobOffer,
        { job: job.id, status: { $in: offerRespondedStatuses } },
        { status: 'expired', updatedAt: now },
      );
      return { reference: job.reference };
    });

    this.changed();
    return result;
  }

  async reopenJob(admin: AdminContext, id: string, raw: unknown) {
    const input = parseReopenInput(raw);
    const result = await getEm(this.orm).transactional(async (tx) => {
      const job = await tx.findOne(
        ServiceJob,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!job) throw new NotFoundError('Service job not found.');
      const issue = job.issue
        ? await this.reportForNewJob(tx, job.issue.id)
        : null;
      const { wasIssueResolved, nextStatus } = reopenServiceJob(job);
      const adminRef = tx.getReference(User, admin.user.id);

      if (input.reopenIssue && wasIssueResolved && issue && isIssueResolved(issue)) {
        reopenIssue(issue);
        tx.persist(
          tx.create(ServiceJobEvent, {
            job,
            kind: 'issue_reopened',
            actorType: 'admin',
            actorUser: adminRef,
            provider: null,
            actorName: userFullName(admin.user),
            channel: 'dashboard',
            fromStatus: null,
            toStatus: null,
            note: input.reason,
            metadata: null,
          }),
        );
      }

      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'reopened',
          actorType: 'admin',
          actorUser: adminRef,
          provider: null,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
          fromStatus: 'closed',
          toStatus: nextStatus,
          note: input.reason,
          metadata: null,
        }),
      );
      await tx.flush();
      return { reference: job.reference };
    });
    this.changed();
    return result;
  }

  async cancelJob(admin: AdminContext, id: string, raw: unknown) {
    const input = parseCancelInput(raw);
    const result = await getEm(this.orm).transactional(async (tx) => {
      const job = await tx.findOne(
        ServiceJob,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!job) throw new NotFoundError('Service job not found.');
      const now = new Date();
      const adminRef = tx.getReference(User, admin.user.id);
      const previous = cancelServiceJob(job, adminRef, input.reason, now);

      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'cancelled',
          actorType: 'admin',
          actorUser: adminRef,
          provider: null,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
          fromStatus: previous,
          toStatus: 'cancelled',
          note: input.reason,
          metadata: null,
        }),
      );
      await tx.flush();

      await tx.nativeUpdate(
        ServiceJobOffer,
        { job: job.id, status: { $in: offerRespondedStatuses } },
        { status: 'expired', updatedAt: now },
      );
      return { reference: job.reference };
    });
    this.changed();
    return result;
  }

  async assignProvider(admin: AdminContext, id: string, raw: unknown) {
    const input = parseReassignInput(raw);
    const result = await getEm(this.orm).transactional(async (tx) => {
      const job = await tx.findOne(
        ServiceJob,
        { id },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!job) throw new NotFoundError('Service job not found.');
      if (!activeJobStatuses.includes(job.status)) {
        throw new ConflictError('This job cannot be reassigned.');
      }
      const provider = await tx.findOne(ServiceProvider, {
        id: input.providerId,
      });
      if (!provider) throw new NotFoundError('Service provider not found.');
      if (provider.status !== 'active' || provider.optedOutAt) {
        throw new BadRequestError('That service provider is not available.');
      }

      const now = new Date();
      await tx.nativeUpdate(
        ServiceJobOffer,
        {
          job: job.id,
          provider: { $ne: provider.id },
          status: { $in: [...offerRespondedStatuses, 'accepted'] },
        },
        { status: 'expired', updatedAt: now },
      );

      const adminName = userFullName(admin.user);
      const existingOffer = await tx.findOne(ServiceJobOffer, {
        job: job.id,
        provider: provider.id,
      });
      if (existingOffer) {
        assignOfferByAdmin(existingOffer, adminName, now);
      } else {
        tx.persist(
          tx.create(ServiceJobOffer, {
            job,
            provider,
            linkVersion: 1,
            status: 'accepted',
            attempts: 0,
            nextAttemptAt: now,
            respondedAt: now,
            responseChannel: 'admin',
            responderName: adminName,
            revokedAt: null,
            chatCompletionPhone: null,
            chatCompletionStartedAt: null,
            chatCompletionExpiresAt: null,
            chatCompletionRemindedAt: null,
            chatCompletionMediaIds: null,
            chatCompletionCostCents: null,
            sendingAt: null,
            sentAt: null,
            deliveredAt: null,
            readAt: null,
            whatsappMessageId: null,
            lastErrorCode: null,
            lastErrorTitle: null,
          }),
        );
      }

      const previous = assignServiceJobProvider(job, provider, now);
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: previous === 'open' ? 'assigned' : 'reassigned',
          actorType: 'admin',
          actorUser: tx.getReference(User, admin.user.id),
          provider: null,
          actorName: adminName,
          channel: 'dashboard',
          fromStatus: previous,
          toStatus: 'assigned',
          note: input.reason,
          metadata: { providerName: provider.companyName },
        }),
      );
      await tx.flush();
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
    const em = getEm(this.orm);
    const job = await em.findOne(ServiceJob, { id });
    if (!job) throw new NotFoundError('Service job not found.');
    const event = em.create(ServiceJobEvent, {
      job,
      kind: 'admin_note',
      actorType: 'admin',
      actorUser: em.getReference(User, admin.user.id),
      provider: null,
      actorName: userFullName(admin.user),
      channel: 'dashboard',
      fromStatus: null,
      toStatus: null,
      note: input.note,
      metadata: null,
    });
    await em.persist(event).flush();
    return { id };
  }

  async copyLink(id: string) {
    const offer = await getEm(this.orm).findOne(ServiceJobOffer, { id });
    if (!offer) throw new NotFoundError('Provider request not found.');
    return { link: this.access.link(offer.id, offer.linkVersion) };
  }

  async revokeLink(admin: AdminContext, offerId: string) {
    const result = await getEm(this.orm).transactional(async (tx) => {
      const { offer, job } = await this.offerWithJob(tx, offerId);
      revokeOffer(offer);
      tx.persist(
        tx.create(ServiceJobEvent, {
          job,
          kind: 'link_revoked',
          actorType: 'admin',
          actorUser: tx.getReference(User, admin.user.id),
          provider: null,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
          fromStatus: null,
          toStatus: null,
          note: 'Provider link revoked.',
          metadata: null,
        }),
      );
      await tx.flush();
      return { id: offer.id, linkVersion: offer.linkVersion };
    });
    this.changed();
    return result;
  }

  async resendOffer(admin: AdminContext, offerId: string) {
    const result = await getEm(this.orm).transactional(async (tx) => {
      const offer = await tx.findOne(
        ServiceJobOffer,
        { id: offerId },
        { populate: ['job', 'provider'] },
      );
      if (!offer) throw new NotFoundError('Provider request not found.');
      if (offer.status === 'accepted') {
        throw new ConflictError('The provider has already accepted this job.');
      }
      if (
        this.alertSender.recipientNumbers &&
        !this.alertSender.recipientNumbers.includes(
          offer.provider.whatsappNumber,
        )
      ) {
        throw new ConflictError(
          'This provider is outside the demo alert audience.',
        );
      }
      if (offer.job.status !== 'open') {
        throw new ConflictError('This job is no longer waiting for a provider.');
      }
      requeueOffer(offer);
      tx.persist(
        tx.create(ServiceJobEvent, {
          job: offer.job,
          kind: 'alert_requeued',
          actorType: 'admin',
          actorUser: tx.getReference(User, admin.user.id),
          provider: null,
          actorName: userFullName(admin.user),
          channel: 'dashboard',
          fromStatus: null,
          toStatus: null,
          note: `Alert queued again for ${offer.provider.contactName}.`,
          metadata: { providerId: offer.provider.id },
        }),
      );
      await tx.flush();
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
    const em = getEm(this.orm);
    const job = await em.findOne(
      ServiceJob,
      { issue: issueId },
      {
        populate: ['provider', 'truck', 'driver.user'],
        orderBy: { createdAt: 'desc', id: 'desc' },
      },
    );
    if (!job) return null;
    const events = await em.find(
      ServiceJobEvent,
      { job: job.id },
      { orderBy: { createdAt: 'asc' } },
    );
    return this.jobSummary(job, stageFromEvents(events));
  }

  async jobSummariesForIssues(issueIds: string[]) {
    if (!issueIds.length) return new Map<string, JobSummary>();
    const em = getEm(this.orm);
    const jobs = await em.find(
      ServiceJob,
      { issue: { $in: issueIds } },
      { populate: ['provider'], orderBy: { createdAt: 'desc', id: 'desc' } },
    );
    const latest = new Map<string, ServiceJob>();
    for (const job of jobs) {
      if (job.issue && !latest.has(job.issue.id)) {
        latest.set(job.issue.id, job);
      }
    }
    const stages = await this.latestStages(
      [...latest.values()].map((job) => job.id),
    );
    return new Map(
      [...latest.entries()].map(([issueId, job]) => [
        issueId,
        this.jobSummary(job, stages.get(job.id) ?? null),
      ]),
    );
  }

  async assertNoActiveJobForIssue(
    issueId: string,
    em: EntityManager = getEm(this.orm),
  ) {
    const job = await em.findOne(ServiceJob, {
      issue: issueId,
      status: { $in: [...activeJobStatuses] },
    });
    if (job) {
      throw new ConflictError(
        `This report has an active service job (${job.reference}). Close the job before resolving it.`,
      );
    }
  }

  private async reportForNewJob(tx: EntityManager, issueId: string) {
    const issue = await tx.findOne(
      DriverIssue,
      { id: issueId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!issue) throw new NotFoundError('Driver report not found.');
    const active = await tx.findOne(ServiceJob, {
      issue: issueId,
      status: { $in: [...activeJobStatuses] },
    });
    if (active) {
      throw new ConflictError(
        `This report already has an active service job (${active.reference}).`,
      );
    }
    return issue;
  }

  private async offerByCode(code: string) {
    const offerId = this.access.offerIdFromCode(code);
    const em = getEm(this.orm);
    const offer = await em.findOne(
      ServiceJobOffer,
      { id: offerId },
      { populate: ['provider'] },
    );
    if (!offer) throw new UnauthorizedError('This link is no longer available.');
    this.access.verifySignature(code, offer.linkVersion);
    const job = await em.findOne(
      ServiceJob,
      { id: offer.job.id },
      { populate: ['truck', 'provider', 'driver.user', 'issue'] },
    );
    if (!job) throw new NotFoundError('Service job not found.');
    return { offer, job };
  }

  async providerViewByCode(code: string) {
    const { offer, job } = await this.offerByCode(code);
    const provider = offer.provider;
    const assignedToProvider = job.provider?.id === offer.provider.id;
    const full =
      assignedToProvider ||
      (job.status === 'open' &&
        ['queued', 'sent', 'delivered', 'read', 'failed'].includes(
          offer.status,
        ));
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

    const em = getEm(this.orm);
    const events = assignedToProvider
      ? await em.find(
          ServiceJobEvent,
          { job: job.id },
          { orderBy: { createdAt: 'asc' } },
        )
      : [];
    const latestStage = stageFromEvents(events);
    if (!full) {
      return {
        state,
        reference: job.reference,
        latestStage: null,
        provider: { companyName: provider.companyName },
        officePhone: process.env.FLEET_CONTACT_PHONE ?? null,
      };
    }

    const attachments = assignedToProvider
      ? await em.find(
          ServiceJobAttachment,
          { job: job.id },
          { orderBy: { createdAt: 'asc' } },
        )
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
      canAccept:
        job.status === 'open' &&
        !assignedToProvider &&
        offer.status !== 'declined',
      canProgress:
        assignedToProvider && assignedJobStatuses.includes(job.status),
      canComplete:
        assignedToProvider && assignedJobStatuses.includes(job.status),
      photos: attachments.map((attachment) => attachment.id),
      officePhone: process.env.FLEET_CONTACT_PHONE ?? null,
    };
  }

  async acceptByCode(code: string, actor?: { responderName?: string }) {
    const { offer } = await this.offerByCode(code);
    return this.acceptOffer(offer.id, {
      providerId: offer.provider.id,
      channel: 'web',
      linkVersion: offer.linkVersion,
      responderName: actor?.responderName,
    });
  }

  async declineByCode(code: string, actor?: { responderName?: string }) {
    const { offer } = await this.offerByCode(code);
    return this.declineOffer(offer.id, {
      providerId: offer.provider.id,
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
      providerId: offer.provider.id,
      channel: 'web',
      linkVersion: offer.linkVersion,
      responderName: actor?.responderName,
    });
  }

  async completeByCode(code: string, raw: unknown, files: UploadedPhoto[]) {
    const { offer } = await this.offerByCode(code);
    const { reference, status } = await this.completeOffer(
      offer.id,
      raw,
      files,
      {
        providerId: offer.provider.id,
        channel: 'web',
        linkVersion: offer.linkVersion,
      },
    );
    return { reference, status };
  }

  async providerPhoto(code: string, photoId: string) {
    const { offer, job } = await this.offerByCode(code);
    if (job.provider?.id !== offer.provider.id) {
      throw new ForbiddenError('This photo belongs to another provider.');
    }
    const attachment = await getEm(this.orm).findOne(ServiceJobAttachment, {
      id: photoId,
      job: job.id,
    });
    if (!attachment) throw new NotFoundError('Photo not found.');
    return {
      type: attachment.mimeType,
      buffer: await readPrivateFile(
        join(serviceJobDir(job.id), attachment.storageName),
      ),
    };
  }

  async adminPhoto(jobId: string, photoId: string) {
    const attachment = await getEm(this.orm).findOne(ServiceJobAttachment, {
      id: photoId,
      job: jobId,
    });
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
      jobId: offer.job.id,
      jobReference: offer.job.reference,
      jobStatus: offer.job.status,
      providerId: offer.provider.id,
      providerPhone: offer.provider.whatsappNumber,
      providerCompany: offer.provider.companyName,
      assignedProviderId: offer.job.provider?.id ?? null,
      revokedAt: offer.revokedAt,
      completionStartedAt: offer.chatCompletionStartedAt,
      completionExpiresAt: offer.chatCompletionExpiresAt,
      completionPhone: offer.chatCompletionPhone,
      completionMediaIds: offer.chatCompletionMediaIds ?? [],
      offerStatus: offer.status,
    };
  }

  async offerById(offerId: string) {
    if (!isUuid(offerId)) return null;
    const offer = await getEm(this.orm).findOne(
      ServiceJobOffer,
      { id: offerId },
      { populate: ['job', 'provider'] },
    );
    return offer ? this.offerContext(offer) : null;
  }

  async offerByMessageId(wamid: string) {
    const offer = await getEm(this.orm).findOne(
      ServiceJobOffer,
      { whatsappMessageId: wamid },
      { populate: ['job', 'provider'] },
    );
    return offer ? this.offerContext(offer) : null;
  }

  async completionOffersByProvider(providerId: string) {
    const em = getEm(this.orm);
    const base = {
      provider: providerId,
      status: 'accepted' as const,
      revokedAt: null,
    };
    const [active, latestCompleted] = await Promise.all([
      em.find(
        ServiceJobOffer,
        {
          ...base,
          job: { provider: providerId, status: { $in: [...assignedJobStatuses] } },
        },
        { populate: ['job', 'provider'], orderBy: { updatedAt: 'desc' } },
      ),
      em.findOne(
        ServiceJobOffer,
        {
          ...base,
          job: { provider: providerId, status: { $in: ['completed', 'closed'] } },
        },
        { populate: ['job', 'provider'], orderBy: { updatedAt: 'desc' } },
      ),
    ]);
    return [...active, ...(latestCompleted ? [latestCompleted] : [])].flatMap(
      (offer) => {
        const context = this.offerContext(offer);
        return context ? [context] : [];
      },
    );
  }

  async openOffersByPhone(phone: string) {
    const em = getEm(this.orm);
    const provider = await em.findOne(ServiceProvider, {
      whatsappNumber: phone,
    });
    if (!provider) return [];
    const offers = await em.find(
      ServiceJobOffer,
      {
        provider: provider.id,
        status: { $in: ['queued', 'sent', 'delivered', 'read', 'failed'] },
      },
      { populate: ['job'], orderBy: { createdAt: 'desc' } },
    );
    return offers
      .filter((offer) => offer.job?.status === 'open')
      .map((offer) => ({
        offerId: offer.id,
        jobId: offer.job.id,
        reference: offer.job.reference,
        status: offer.status,
      }));
  }

  async providerByPhone(phone: string) {
    return getEm(this.orm).findOne(ServiceProvider, { whatsappNumber: phone });
  }

  async optOutProvider(phone: string, reason: string) {
    const em = getEm(this.orm);
    const provider = await em.findOne(ServiceProvider, {
      whatsappNumber: phone,
    });
    if (!provider) return false;
    if (!optOutServiceProvider(provider, reason)) return true;
    await em.flush();
    this.changed();
    return true;
  }

  async recordMessageStatus(
    wamid: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
    error?: { code?: string; title?: string },
  ) {
    const em = getEm(this.orm);
    const offer = await em.findOne(ServiceJobOffer, {
      whatsappMessageId: wamid,
    });
    if (!offer) return;
    recordOfferDeliveryStatus(offer, status, error);
    await em.flush();
    this.changed();
  }

  async dueAlertOffers(limit = 10): Promise<AlertOffer[]> {
    const em = getEm(this.orm);
    const claimed = await rawQuery<{ id: string }>(
      em,
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
    );
    if (!claimed.length) return [];

    const offers = await em.find(
      ServiceJobOffer,
      { id: { $in: claimed.map((row) => row.id) } },
      { populate: ['provider', 'job.truck'] },
    );
    return offers.map((offer) => ({
      offerId: offer.id,
      jobId: offer.job.id,
      providerId: offer.provider.id,
      attempts: offer.attempts,
      linkVersion: offer.linkVersion,
      reference: offer.job.reference,
      providerPhone: offer.provider.whatsappNumber,
      providerCompany: offer.provider.companyName,
      truckRegistration: offer.job.truck.registration,
      truckIdentifier: offer.job.truck.identifier,
      serviceType: offer.job.serviceType,
      issueSummary: offer.job.description,
      locationText: offer.job.locationText,
      link: this.access.link(offer.id, offer.linkVersion),
    }));
  }

  async markAlertSent(
    offerId: string,
    linkVersion: number,
    wamid: string | null,
  ) {
    // Acceptance/assignment may expire the offer while a concurrent send is
    // in flight. Keep the WhatsApp receipt without reopening that offer.
    await rawQuery(
      getEm(this.orm),
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
    await getEm(this.orm).nativeUpdate(
      ServiceJobOffer,
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
    await rawQuery(
      getEm(this.orm),
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
    const offer = await getEm(this.orm).findOne(
      ServiceJobOffer,
      { id: offerId },
      { populate: ['job', 'provider'] },
    );
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
