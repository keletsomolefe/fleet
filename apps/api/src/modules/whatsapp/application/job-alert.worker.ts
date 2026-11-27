import { createHash } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { ServiceJobsService } from '../../service-jobs/application/service-jobs.service.js';
import { ServiceJobOffer } from '../../service-jobs/domain/service-job-offer.entity.js';
import { ServiceJob } from '../../service-jobs/domain/service-job.entity.js';
import { ServiceProvider } from '../../service-jobs/domain/service-provider.entity.js';
import { serviceTypeLabels } from '../../service-jobs/http/service-job.dto.js';
import { WhatsAppMessage } from '../domain/whatsapp-message.entity.js';
import type { JobAlertSender } from '../infrastructure/job-alert-sender.js';
import { WhatsAppCloudError } from '../infrastructure/whatsapp-cloud.service.js';

export class JobAlertWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private started = false;
  private wakeRequested = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly jobs: ServiceJobsService,
    private readonly whatsapp: JobAlertSender,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  get enabled() {
    return process.env.SERVICE_JOB_ALERTS_ENABLED === 'true';
  }

  async start() {
    if (this.started || !this.enabled) return;
    this.started = true;
    if (!this.whatsapp.configured) {
      this.logger.error(
        'Service job alerts are enabled but the WhatsApp sender is not configured.',
      );
      return;
    }
    await this.jobs.recoverStaleAlerts();
    this.timer = setInterval(() => void this.flush(), 5000);
    this.timer.unref();
    void this.flush();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  wake() {
    if (!this.enabled) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    void this.flush();
  }

  async flush() {
    if (!this.enabled || !this.whatsapp.configured || this.running) return;
    this.running = true;
    try {
      const batchLimit = this.whatsapp.groupChatId ? 50 : 10;
      for (let batch = 0; batch < 5; batch += 1) {
        const offers = await this.jobs.dueAlertOffers(batchLimit);
        if (!offers.length) break;
        if (this.whatsapp.groupChatId) {
          const byJob = new Map<string, typeof offers>();
          for (const offer of offers) {
            const list = byJob.get(offer.jobId);
            if (list) list.push(offer);
            else byJob.set(offer.jobId, [offer]);
          }
          for (const jobOffers of byJob.values()) {
            if (!this.enabled) return;
            try {
              await this.sendGroupOffers(jobOffers);
            } catch {
              this.logger.error('Could not record a service job alert outcome.');
            }
          }
        } else {
          for (let i = 0; i < offers.length; i += 5) {
            if (!this.enabled) return;
            const results = await Promise.allSettled(
              offers.slice(i, i + 5).map((offer) => this.sendOffer(offer)),
            );
            if (results.some((result) => result.status === 'rejected')) {
              this.logger.error('Could not record a service job alert outcome.');
            }
          }
        }
        if (offers.length < batchLimit) break;
      }
    } catch (error) {
      this.logger.error(
        `Service job alert worker stopped: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    } finally {
      this.running = false;
      if (this.wakeRequested && this.enabled) {
        this.wakeRequested = false;
        setImmediate(() => void this.flush());
      }
    }
  }

  private async sendOffer(
    offer: Awaited<ReturnType<ServiceJobsService['dueAlertOffers']>>[number],
  ) {
    const em = this.orm.em.fork();
    const message = em.create(WhatsAppMessage, {
      direction: 'outbound',
      kind: this.whatsapp.alertTemplate ? 'template' : 'text',
      job: em.getReference(ServiceJob, offer.jobId),
      offer: em.getReference(ServiceJobOffer, offer.offerId),
      provider: em.getReference(ServiceProvider, offer.providerId),
      fromNumber: null,
      profileName: null,
      status: 'queued',
      templateName: this.whatsapp.alertTemplate,
      errorCode: null,
      errorTitle: null,
      contextWamid: null,
      wamid: null,
    });
    await em.persist(message).flush();

    let wamid: string;
    try {
      ({ wamid } = await this.whatsapp.sendJobAlert({
        to: offer.providerPhone,
        idempotencyKey: `fleet-offer-${offer.offerId}-${offer.linkVersion}`,
        link: offer.link,
        reference: offer.reference,
        registration: offer.truckRegistration,
        identifier: offer.truckIdentifier,
        serviceTypeLabel: serviceTypeLabels[offer.serviceType],
        issueSummary: offer.issueSummary,
        locationText: offer.locationText,
      }));
    } catch (error) {
      const cloudError =
        error instanceof WhatsAppCloudError ? error : null;
      const code = cloudError?.code ?? 'SEND_FAILED';
      const title =
        cloudError?.message ??
        (error instanceof Error ? error.message : 'WhatsApp send failed.');
      message.status = 'failed';
      message.errorCode = code;
      message.errorTitle = title;
      await em.flush();

      const attempts = offer.attempts;
      if (
        !cloudError ||
        cloudError.permanent ||
        cloudError.ambiguous ||
        attempts >= 6
      ) {
        await this.jobs.markAlertFailed(
          offer.offerId,
          offer.linkVersion,
          { code, title },
          true,
        );
      } else {
        const delay = Math.min(
          30 * 60_000,
          60_000 * 2 ** Math.max(0, attempts - 1),
        );
        await this.jobs.markAlertFailed(
          offer.offerId,
          offer.linkVersion,
          { code, title },
          false,
          new Date(Date.now() + delay),
        );
      }
      this.logger.warn(
        `Service job alert ${offer.reference} failed (${code}).`,
      );
      return;
    }

    // A database error after a successful send must never requeue the message.
    message.wamid = wamid;
    message.status = 'sent';
    await em.flush();
    await this.jobs.markAlertSent(offer.offerId, offer.linkVersion, wamid);
  }

  private async sendGroupOffers(
    offers: Awaited<ReturnType<ServiceJobsService['dueAlertOffers']>>,
  ) {
    const primary = offers[0];
    if (!primary || !this.whatsapp.groupChatId) return;

    const single = offers.length === 1;
    const em = this.orm.em.fork();
    const message = em.create(WhatsAppMessage, {
      direction: 'outbound',
      kind: this.whatsapp.alertTemplate ? 'template' : 'text',
      job: em.getReference(ServiceJob, primary.jobId),
      offer: single ? em.getReference(ServiceJobOffer, primary.offerId) : null,
      provider: single
        ? em.getReference(ServiceProvider, primary.providerId)
        : null,
      fromNumber: null,
      profileName: null,
      status: 'queued',
      templateName: this.whatsapp.alertTemplate,
      errorCode: null,
      errorTitle: null,
      contextWamid: null,
      wamid: null,
    });
    await em.persist(message).flush();

    const batchHash = createHash('sha256')
      .update(
        offers
          .map((offer) => `${offer.offerId}:${offer.linkVersion}`)
          .sort()
          .join(','),
      )
      .digest('hex')
      .slice(0, 24);

    let wamid: string;
    try {
      ({ wamid } = await this.whatsapp.sendJobAlert({
        to: this.whatsapp.groupChatId,
        idempotencyKey: `fleet-group-${primary.jobId}-${batchHash}`,
        link: primary.link,
        links: offers.map((offer) => ({
          providerCompany: offer.providerCompany,
          link: offer.link,
        })),
        reference: primary.reference,
        registration: primary.truckRegistration,
        identifier: primary.truckIdentifier,
        serviceTypeLabel: serviceTypeLabels[primary.serviceType],
        issueSummary: primary.issueSummary,
        locationText: primary.locationText,
      }));
    } catch (error) {
      const cloudError =
        error instanceof WhatsAppCloudError ? error : null;
      const code = cloudError?.code ?? 'SEND_FAILED';
      const title =
        cloudError?.message ??
        (error instanceof Error ? error.message : 'WhatsApp send failed.');
      message.status = 'failed';
      message.errorCode = code;
      message.errorTitle = title;
      await em.flush();

      for (const offer of offers) {
        const attempts = offer.attempts;
        if (
          !cloudError ||
          cloudError.permanent ||
          cloudError.ambiguous ||
          attempts >= 6
        ) {
          await this.jobs.markAlertFailed(
            offer.offerId,
            offer.linkVersion,
            { code, title },
            true,
          );
        } else {
          const delay = Math.min(
            30 * 60_000,
            60_000 * 2 ** Math.max(0, attempts - 1),
          );
          await this.jobs.markAlertFailed(
            offer.offerId,
            offer.linkVersion,
            { code, title },
            false,
            new Date(Date.now() + delay),
          );
        }
      }
      this.logger.warn(
        `Service job group alert ${primary.reference} failed (${code}).`,
      );
      return;
    }

    // A database error after a successful send must never requeue the message.
    message.wamid = wamid;
    message.status = 'sent';
    await em.flush();
    for (let i = 0; i < offers.length; i += 1) {
      const offer = offers[i];
      await this.jobs.markAlertSent(
        offer.offerId,
        offer.linkVersion,
        i === 0 ? wamid : null,
      );
    }
  }
}
