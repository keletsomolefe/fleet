import { Database } from '../database/database.js';
import { WhatsAppMessage } from './whatsapp-message.entity.js';
import {
  WhatsAppCloudError,
  WhatsAppCloudService,
  templateName,
} from './whatsapp-cloud.service.js';
import type { ServiceJobsService } from '../service-jobs/service-jobs.service.js';
import { serviceTypeLabels } from '../service-jobs/service-job.input.js';

export class JobAlertWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private started = false;
  private wakeRequested = false;
  constructor(
    private readonly db: Database,
    private readonly jobs: ServiceJobsService,
    private readonly whatsapp: WhatsAppCloudService,
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
        'Service job alerts are enabled but Meta WhatsApp is not configured.',
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
      // Drain several small batches immediately so a new breakdown reaches all
      // eligible providers without waiting for the five-second interval.
      for (let batch = 0; batch < 5; batch += 1) {
        const offers = await this.jobs.dueAlertOffers(10);
        if (!offers.length) break;
        for (let i = 0; i < offers.length; i += 5) {
          if (!this.enabled) return;
          const results = await Promise.allSettled(
            offers.slice(i, i + 5).map((offer) => this.sendOffer(offer)),
          );
          if (results.some((result) => result.status === 'rejected'))
            this.logger.error('Could not record a service job alert outcome.');
        }
        if (offers.length < 10) break;
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

  private async sendOffer(offer: Awaited<
    ReturnType<ServiceJobsService['dueAlertOffers']>
  >[number]) {
    const messages = this.db.getRepository(WhatsAppMessage);
    const message = messages.create({
      direction: 'outbound',
      kind: 'template',
      jobId: offer.jobId,
      offerId: offer.offerId,
      providerId: offer.providerId,
      fromNumber: null,
      profileName: null,
      status: 'queued',
      templateName: templateName(),
      errorCode: null,
      errorTitle: null,
      contextWamid: null,
      wamid: null,
    });
    await messages.save(message);
    let wamid: string;
    try {
      ({ wamid } = await this.whatsapp.sendJobAlert({
        to: offer.providerPhone,
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
      await messages.save(message);
      const attempts = offer.attempts;
      if (!cloudError || cloudError.permanent || cloudError?.ambiguous || attempts >= 6) {
        await this.jobs.markAlertFailed(
          offer.offerId,
          offer.linkVersion,
          { code, title },
          true,
        );
      } else {
        const delay = Math.min(30 * 60000, 60000 * 2 ** Math.max(0, attempts - 1));
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
    await messages.save(message);
    await this.jobs.markAlertSent(offer.offerId, offer.linkVersion, wamid);
  }
}
