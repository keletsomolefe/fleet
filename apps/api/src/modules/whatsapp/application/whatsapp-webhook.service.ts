import type { MikroORM } from '@mikro-orm/postgresql';
import { getEm, pgErrorCode } from '../../../database/context.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
} from '../../../shared/errors.js';
import type {
  ProviderActor,
  ServiceJobsService,
} from '../../service-jobs/application/service-jobs.service.js';
import { ServiceJobOffer } from '../../service-jobs/domain/service-job-offer.entity.js';
import {
  ServiceJob,
  type ProgressStage,
} from '../../service-jobs/domain/service-job.entity.js';
import { ServiceProvider } from '../../service-jobs/domain/service-provider.entity.js';
import { jobReplies } from '../domain/job-replies.js';
import { WhatsAppMessage } from '../domain/whatsapp-message.entity.js';
import type { WhatsAppCloudService } from '../infrastructure/whatsapp-cloud.service.js';

type ReplyTarget = {
  jobId?: string | null;
  offerId?: string | null;
  providerId?: string | null;
  phone: string;
};
type Offer = NonNullable<Awaited<ReturnType<ServiceJobsService['offerById']>>>;
type InboundMessage = {
  from: string;
  wamid: string;
  type: string;
  contextWamid: string | null;
  profileName: string | null;
  buttonText: string | null;
  interactiveId: string | null;
  text: string | null;
  mediaId: string | null;
  receivedAt: Date;
};

const optOutWords = new Set([
  'STOP',
  'STOP ALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPT OUT',
  'OPTOUT',
  'REVOKE',
]);

function actionWord(value: string | null) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function statusRank(status: string | null | undefined) {
  return (
    { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 }[status ?? ''] ?? 0
  );
}
const stages: ProgressStage[] = ['en_route', 'arrived', 'working'];
const stageLabels = {
  en_route: 'On my way',
  arrived: 'Arrived',
  working: 'Working',
};
const completeWords = new Set(['DONE', 'COMPLETE', 'COMPLETED']);
const isActionError = (error: unknown) =>
  error instanceof HttpError && [403, 404, 409].includes(error.statusCode);
function isAssigned(offer: Offer, providerId: string) {
  return (
    offer.assignedProviderId === providerId &&
    ['assigned', 'in_progress'].includes(offer.jobStatus)
  );
}
function sentAt(timestamp: unknown) {
  const now = Date.now();
  const value =
    typeof timestamp === 'string' && /^\d{1,12}$/.test(timestamp)
      ? Number(timestamp) * 1000
      : now;
  return new Date(Math.min(value, now));
}

export class WhatsAppWebhookService {
  private timer?: ReturnType<typeof setInterval>;
  private reminding = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly jobs: ServiceJobsService,
    private readonly whatsapp: WhatsAppCloudService,
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  start() {
    if (!this.whatsapp.configured || this.timer) return;
    this.timer = setInterval(() => void this.sendDueReminders(), 30_000);
    this.timer.unref();
    void this.sendDueReminders();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sendDueReminders() {
    if (this.reminding) return;
    this.reminding = true;
    try {
      const reminders = await this.jobs.claimChatCompletionReminders();
      await Promise.all(
        reminders.map(async (target) => {
          const offer = await this.jobs.offerById(target.offerId);
          if (
            offer &&
            isAssigned(offer, target.providerId) &&
            offer.completionPhone === target.phone
          ) {
            await this.sendCompletionLink(offer, target, target.linkVersion);
          }
        }),
      );
    } catch {
      this.logger.error('Could not process WhatsApp completion reminders.');
    } finally {
      this.reminding = false;
    }
  }

  handleGet(query: URLSearchParams): string {
    const mode = query.get('hub.mode');
    const token = query.get('hub.verify_token');
    const challenge = query.get('hub.challenge');
    if (
      mode === 'subscribe' &&
      challenge &&
      this.whatsapp.verifyWebhookToken(token ?? undefined)
    ) {
      return challenge;
    }
    throw new ForbiddenError('Webhook verification failed.');
  }

  async handlePost(raw: Buffer, signature: string | undefined) {
    if (!this.whatsapp.verifySignature(raw, signature)) {
      throw new ForbiddenError('Invalid webhook signature.');
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestError('Invalid webhook body.');
    }
    if (
      !body ||
      typeof body !== 'object' ||
      (body as { object?: unknown }).object !== 'whatsapp_business_account'
    ) {
      return 'EVENT_RECEIVED';
    }
    const entries = (body as { entry?: unknown }).entry;
    if (!Array.isArray(entries)) return 'EVENT_RECEIVED';

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (
        this.whatsapp.businessAccountId &&
        String((entry as { id?: unknown }).id) !==
          this.whatsapp.businessAccountId
      ) {
        continue;
      }
      const changes = (entry as { changes?: unknown }).changes;
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        const value = (change as { value?: unknown })?.value as
          | {
              messages?: unknown[];
              statuses?: unknown[];
              contacts?: Array<{
                wa_id?: string;
                profile?: { name?: string };
              }>;
            }
          | undefined;
        if (!value) continue;
        const profiles = new Map(
          (Array.isArray(value.contacts) ? value.contacts : []).map(
            (contact) => [
              String(contact?.wa_id ?? ''),
              typeof contact?.profile?.name === 'string'
                ? contact.profile.name.trim().slice(0, 80)
                : null,
            ],
          ),
        );
        for (const message of Array.isArray(value.messages)
          ? value.messages
          : []) {
          if (!message || typeof message !== 'object') continue;
          await this.processMessage(
            message as Record<string, unknown>,
            profiles,
          );
        }
        for (const status of Array.isArray(value.statuses)
          ? value.statuses
          : []) {
          if (!status || typeof status !== 'object') continue;
          await this.processStatus(status as Record<string, unknown>);
        }
      }
    }
    return 'EVENT_RECEIVED';
  }

  private async processMessage(
    message: Record<string, unknown>,
    profiles: Map<string, string | null>,
  ) {
    const from = typeof message.from === 'string' ? message.from : '';
    const wamid = typeof message.id === 'string' ? message.id : '';
    if (!/^\d{1,15}$/.test(from) || !wamid || wamid.length > 128) return;
    const provider = await this.jobs.providerByPhone(from);
    const inbound: InboundMessage = {
      from,
      wamid,
      receivedAt: sentAt(message.timestamp),
      mediaId:
        typeof (message.image as { id?: unknown } | undefined)?.id === 'string'
          ? (message.image as { id: string }).id
          : null,
      type: typeof message.type === 'string' ? message.type : 'unknown',
      contextWamid:
        typeof (message.context as { id?: unknown } | undefined)?.id ===
        'string'
          ? (message.context as { id: string }).id
          : null,
      profileName: profiles.get(from) ?? null,
      buttonText:
        typeof (message.button as { payload?: unknown } | undefined)?.payload ===
        'string'
          ? (message.button as { payload: string }).payload
          : typeof (message.button as { text?: unknown } | undefined)?.text ===
              'string'
            ? (message.button as { text: string }).text
            : null,
      interactiveId:
        typeof (
          message.interactive as
            | { button_reply?: { id?: unknown } }
            | undefined
        )?.button_reply?.id === 'string'
          ? (message.interactive as { button_reply: { id: string } })
              .button_reply.id
          : null,
      text:
        typeof (message.text as { body?: unknown } | undefined)?.body ===
        'string'
          ? (message.text as { body: string }).body
          : null,
    };

    const stored = await this.storeInbound(inbound, provider?.id ?? null);
    if (!stored) return;
    try {
      if (!provider) return;
      await this.handleInbound(inbound, provider.id);
    } catch (error) {
      // Allow Meta to retry an event we could not store.
      await getEm(this.orm).nativeDelete(WhatsAppMessage, { id: stored.id });
      throw error;
    }
  }

  private async storeInbound(
    message: InboundMessage,
    providerId: string | null,
  ) {
    const em = this.orm.em.fork();
    try {
      const entity = em.create(WhatsAppMessage, {
        wamid: message.wamid,
        direction: 'inbound',
        kind:
          message.type === 'text'
            ? 'text'
            : message.type === 'button' || message.type === 'interactive'
              ? 'interactive'
              : 'unknown',
        job: null,
        offer: null,
        provider: providerId
          ? em.getReference(ServiceProvider, providerId)
          : null,
        fromNumber: message.from,
        profileName: message.profileName,
        status: 'received',
        templateName: null,
        errorCode: null,
        errorTitle: null,
        contextWamid: message.contextWamid,
      });
      await em.persist(entity).flush();
      return entity;
    } catch (error) {
      if (pgErrorCode(error) === '23505') return null;
      throw error;
    }
  }

  private async handleInbound(message: InboundMessage, providerId: string) {
    const actor: ProviderActor = {
      providerId,
      phone: message.from,
      channel: 'whatsapp',
      profileName: message.profileName ?? undefined,
    };
    const sender = { phone: message.from, providerId };
    const unavailable = () =>
      this.sendText(message.from, jobReplies.unavailable, sender);

    if (message.type === 'button') {
      const action = actionWord(message.buttonText);
      const offer =
        message.contextWamid &&
        (await this.jobs.offerByMessageId(message.contextWamid));
      if (
        !offer ||
        offer.providerId !== providerId ||
        offer.providerPhone !== message.from
      ) {
        return unavailable();
      }
      if (action === 'accept job' || action === 'accept') {
        return this.acceptAndReply(
          offer.offerId,
          offer.jobId,
          actor,
          message.from,
        );
      }
      if (['cant take', 'cannot take', 'decline'].includes(action)) {
        return this.declineAndReply(
          offer.offerId,
          offer.jobId,
          actor,
          message.from,
        );
      }
      return this.sendText(message.from, jobReplies.openLatest, sender);
    }

    if (message.type === 'interactive' && message.interactiveId) {
      const [prefix, offerId, action, ...rest] =
        message.interactiveId.split(':');
      if (prefix !== 'offer' || rest.length || !offerId) return;
      const offer = await this.jobs.offerById(offerId);
      if (
        !offer ||
        offer.providerId !== providerId ||
        offer.providerPhone !== message.from
      ) {
        return unavailable();
      }
      if (action === 'complete') {
        return this.startCompletion(offer, actor, message);
      }
      if (!stages.includes(action as ProgressStage)) return;
      const target = { ...sender, jobId: offer.jobId, offerId };
      try {
        const result = await this.jobs.recordProgress(
          offerId,
          action as ProgressStage,
          actor,
        );
        await this.sendButtons(
          message.from,
          jobReplies.progress(result.stage),
          this.progressButtons(offerId, result.stage),
          target,
        );
      } catch (error) {
        if (!isActionError(error)) throw error;
        await unavailable();
      }
      return;
    }

    const word = (message.text ?? '').trim().toUpperCase();
    if (message.type !== 'text' && message.type !== 'image') return;
    if (message.type === 'text' && optOutWords.has(word)) {
      await this.jobs.optOutProvider(message.from, 'WhatsApp STOP');
      return this.sendText(
        message.from,
        'You will no longer receive VHH Fleet job alerts on WhatsApp. Contact VHH Fleet to opt back in.',
        sender,
      );
    }
    if (message.type === 'text' && (word === 'ACCEPT' || word === 'DECLINE')) {
      const offers = await this.jobs.openOffersByPhone(message.from);
      if (offers.length === 1) {
        const { offerId, jobId } = offers[0];
        return word === 'ACCEPT'
          ? this.acceptAndReply(offerId, jobId, actor, message.from)
          : this.declineAndReply(offerId, jobId, actor, message.from);
      }
      return this.sendText(
        message.from,
        word === 'ACCEPT' && offers.length > 1
          ? 'You have more than one open VHH Fleet request. Open the latest alert to choose.'
          : jobReplies.openLatest,
        sender,
      );
    }

    const context = message.contextWamid
      ? await this.contextOffer(message.contextWamid, providerId)
      : null;
    if (
      context &&
      (context.providerPhone !== message.from || context.revokedAt)
    ) {
      return unavailable();
    }
    const offers = context
      ? [context]
      : await this.jobs.completionOffersByProvider(providerId);
    const pending = offers.filter(
      (offer) =>
        isAssigned(offer, providerId) && offer.completionPhone === message.from,
    );
    const live = pending.filter(
      (offer) =>
        offer.completionExpiresAt && offer.completionExpiresAt > new Date(),
    );
    if (message.type === 'text' && completeWords.has(word)) {
      if (context) return this.startCompletion(context, actor, message);
      const active = offers.filter((offer) => isAssigned(offer, providerId));
      if (active.length === 1) {
        return this.startCompletion(active[0], actor, message);
      }
      if (active.length > 1) {
        return this.sendText(
          message.from,
          'You have more than one VHH Fleet job. Tap Complete job in the message for that job.',
          sender,
        );
      }
      const completed = offers[0];
      if (completed) return this.startCompletion(completed, actor, message);
      return unavailable();
    }

    const candidates = live.length ? live : pending;
    if (candidates.length > 1) {
      return this.sendText(
        message.from,
        'Reply directly to the completion message for the job you worked on.',
        sender,
      );
    }
    const offer = candidates[0];
    if (offer) {
      const target = { ...sender, jobId: offer.jobId, offerId: offer.offerId };
      if (!offer.completionExpiresAt || offer.completionExpiresAt <= new Date()) {
        return this.sendCompletionLink(offer, target);
      }
      if (
        offer.completionStartedAt &&
        message.receivedAt <
          new Date(
            Math.floor(offer.completionStartedAt.getTime() / 1000) * 1000,
          )
      ) {
        return;
      }
      return this.finishCompletion(offer, actor, message, word, target);
    }

    if (message.type === 'text') {
      await this.sendText(message.from, jobReplies.openLatest, sender);
    }
  }

  private async contextOffer(wamid: string, providerId: string) {
    const outbound = await getEm(this.orm).findOne(WhatsAppMessage, {
      wamid,
      direction: 'outbound',
      provider: providerId,
    });
    return outbound?.offer
      ? this.jobs.offerById(outbound.offer.id)
      : this.jobs.offerByMessageId(wamid);
  }

  private progressButtons(offerId: string, stage?: ProgressStage) {
    const next =
      stage === undefined ? stages : stages.slice(stages.indexOf(stage) + 1);
    return [
      ...next.map((value) => ({
        id: `offer:${offerId}:${value}`,
        title: stageLabels[value],
      })),
      ...(stage
        ? [{ id: `offer:${offerId}:complete`, title: 'Complete job' }]
        : []),
    ];
  }

  private async acceptAndReply(
    offerId: string,
    jobId: string,
    actor: ProviderActor,
    phone: string,
  ) {
    const target = { phone, jobId, offerId, providerId: actor.providerId };
    try {
      const result = await this.jobs.acceptOffer(offerId, actor);
      const details = await this.jobs.jobDetailsForProvider(offerId);
      if (!details) return;
      await this.sendCta(
        phone,
        jobReplies.accepted(result.reference),
        'Open job',
        details.link,
        target,
      );
      if (details.status === 'assigned' || details.status === 'in_progress') {
        await this.sendButtons(
          phone,
          'Update the job',
          this.progressButtons(offerId),
          target,
        );
        await this.sendButtons(
          phone,
          'Finished the work?',
          [{ id: `offer:${offerId}:complete`, title: 'Complete job' }],
          target,
        );
      }
    } catch (error) {
      if (!isActionError(error)) throw error;
      await this.sendText(
        phone,
        error instanceof ConflictError
          ? jobReplies.covered
          : jobReplies.unavailable,
        target,
      );
    }
  }

  private async declineAndReply(
    offerId: string,
    jobId: string,
    actor: ProviderActor,
    phone: string,
  ) {
    const target = { phone, jobId, offerId, providerId: actor.providerId };
    try {
      const result = await this.jobs.declineOffer(offerId, actor);
      await this.sendText(
        phone,
        result.outcome === 'declined'
          ? jobReplies.declined
          : jobReplies.covered,
        target,
      );
    } catch (error) {
      if (!isActionError(error)) throw error;
      await this.sendText(phone, jobReplies.unavailable, target);
    }
  }

  private async startCompletion(
    offer: Offer,
    actor: ProviderActor,
    message: InboundMessage,
  ) {
    const target = {
      phone: message.from,
      jobId: offer.jobId,
      offerId: offer.offerId,
      providerId: actor.providerId,
    };
    try {
      const result = await this.jobs.beginChatCompletion(
        offer.offerId,
        actor,
        message.receivedAt,
      );
      if (result === 'completed') {
        return this.sendText(
          message.from,
          jobReplies.alreadyCompleted(offer.jobReference),
          target,
        );
      }
      if (result === 'expired') return this.sendCompletionLink(offer, target);
      const details = await this.jobs.jobDetailsForProvider(offer.offerId);
      if (details) {
        await this.sendCta(
          message.from,
          jobReplies.completePrompt(details.reference),
          'Complete on web',
          `${details.link}#complete`,
          target,
        );
      }
    } catch (error) {
      if (!isActionError(error)) throw error;
      await this.sendText(message.from, jobReplies.unavailable, target);
    }
  }

  private async finishCompletion(
    offer: Offer,
    actor: ProviderActor,
    message: InboundMessage,
    word: string,
    target: ReplyTarget,
  ) {
    const answer = (text: string) => this.sendText(message.from, text, target);
    try {
      if (message.type === 'image') {
        if (!message.mediaId) {
          return answer(
            'Send the photo again, or reply with your completion note.',
          );
        }
        if (offer.completionMediaIds.includes(message.mediaId)) return;
        if (offer.completionMediaIds.length >= 3) {
          return answer(
            'You can add up to 3 photos. Reply with your completion note.',
          );
        }
        await this.whatsapp.downloadPhoto(message.mediaId);
        const count = await this.jobs.editChatCompletion(offer.offerId, actor, {
          mediaId: message.mediaId,
        });
        return answer(
          `Photo added (${count}/3). Reply with your completion note when ready.`,
        );
      }
      if (word === 'SKIP PHOTOS') {
        await this.jobs.editChatCompletion(offer.offerId, actor, {
          clearPhotos: true,
        });
        return answer('Photos removed. Reply with your completion note.');
      }
      if (/^AMOUNT(?:\s|$)/.test(word)) {
        const amount = /^AMOUNT\s+(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(word);
        if (!amount) return answer('Enter an amount like AMOUNT 1500.00.');
        const costCents =
          Number(amount[1]) * 100 + Number((amount[2] ?? '').padEnd(2, '0'));
        await this.jobs.editChatCompletion(offer.offerId, actor, { costCents });
        return answer('Amount added. Reply with your completion note.');
      }
      const note = message.text?.trim() ?? '';
      if (!note || note.length > 1000) {
        return answer(
          'Reply with a note of 1 to 1,000 characters about the work.',
        );
      }
      const files = await Promise.all(
        offer.completionMediaIds.map((id) => this.whatsapp.downloadPhoto(id)),
      ).catch((error: unknown) => {
        if (error instanceof BadRequestError) return null;
        throw error;
      });
      if (!files) {
        return answer(
          'A photo could not be read. Reply SKIP PHOTOS and send your note again, or complete the job on the web.',
        );
      }
      const result = await this.jobs.completeOffer(
        offer.offerId,
        { note },
        files,
        actor,
        {
          startedAt: offer.completionStartedAt!,
          mediaIds: offer.completionMediaIds,
        },
      );
      await answer(
        result.alreadyCompleted
          ? jobReplies.alreadyCompleted(result.reference)
          : jobReplies.completed(result.reference),
      );
    } catch (error) {
      if (error instanceof BadRequestError) return answer(error.message);
      if (!isActionError(error)) throw error;
      const latest = await this.jobs.offerById(offer.offerId);
      if (latest && !latest.revokedAt && latest.providerPhone === message.from) {
        if (latest.jobStatus === 'completed' || latest.jobStatus === 'closed') {
          return answer(jobReplies.alreadyCompleted(latest.jobReference));
        }
        if (isAssigned(latest, actor.providerId)) {
          if (
            latest.completionExpiresAt &&
            latest.completionExpiresAt > new Date()
          ) {
            return answer(
              'The completion details changed. Please send your note again.',
            );
          }
          return this.sendCompletionLink(latest, target);
        }
      }
      await answer(jobReplies.unavailable);
    }
  }

  private async sendCompletionLink(
    offer: Offer,
    target: ReplyTarget,
    expectedLinkVersion?: number,
  ) {
    const details = await this.jobs.jobDetailsForProvider(offer.offerId);
    if (
      !details ||
      details.revokedAt ||
      details.providerPhone !== target.phone ||
      (expectedLinkVersion !== undefined &&
        details.linkVersion !== expectedLinkVersion)
    ) {
      return;
    }
    await this.sendCta(
      target.phone,
      jobReplies.completeFallback,
      'Complete on web',
      `${details.link}#complete`,
      target,
    );
  }

  private async processStatus(status: Record<string, unknown>) {
    const wamid = typeof status.id === 'string' ? status.id : '';
    const value = typeof status.status === 'string' ? status.status : '';
    if (!wamid || !['sent', 'delivered', 'read', 'failed'].includes(value)) {
      return;
    }
    const errors = Array.isArray(status.errors) ? status.errors : [];
    const first = errors[0] as
      | { code?: number; title?: string; message?: string }
      | undefined;
    const error =
      value === 'failed'
        ? {
            code: Number.isInteger(first?.code) ? String(first?.code) : undefined,
            title: first?.title ?? first?.message ?? 'WhatsApp delivery failed.',
          }
        : undefined;

    const em = getEm(this.orm);
    const message = await em.findOne(WhatsAppMessage, { wamid });
    if (message) {
      if (error) {
        message.errorCode = error.code ?? null;
        message.errorTitle = error.title ?? null;
      }
      if (value === 'failed') message.status = 'failed';
      else if (statusRank(value) > statusRank(message.status)) {
        message.status = value as 'sent' | 'delivered' | 'read';
      }
      await em.flush();
    }
    await this.jobs.recordMessageStatus(
      wamid,
      value as 'sent' | 'delivered' | 'read' | 'failed',
      error,
    );
  }

  private async logOutbound(
    target: ReplyTarget,
    kind: 'text' | 'interactive',
    wamid: string | null,
    status: 'sent' | 'failed',
    error?: { code?: string; title?: string },
  ) {
    const em = this.orm.em.fork();
    const entity = em.create(WhatsAppMessage, {
      wamid,
      direction: 'outbound',
      kind,
      job: target.jobId ? em.getReference(ServiceJob, target.jobId) : null,
      offer: target.offerId
        ? em.getReference(ServiceJobOffer, target.offerId)
        : null,
      provider: target.providerId
        ? em.getReference(ServiceProvider, target.providerId)
        : null,
      fromNumber: null,
      profileName: null,
      status,
      templateName: null,
      errorCode: error?.code ?? null,
      errorTitle: error?.title ?? null,
      contextWamid: null,
    });
    await em.persist(entity).flush();
  }

  private async sendText(phone: string, text: string, target: ReplyTarget) {
    try {
      const result = await this.whatsapp.sendText(phone, text);
      await this.logOutbound(target, 'text', result.wamid, 'sent');
    } catch {
      this.logger.warn('WhatsApp text reply failed.');
      await this.logOutbound(target, 'text', null, 'failed', {
        code: 'REPLY_FAILED',
        title: 'Reply failed.',
      });
    }
  }

  private async sendCta(
    phone: string,
    body: string,
    displayText: string,
    url: string,
    target: ReplyTarget,
  ) {
    try {
      const result = await this.whatsapp.sendCtaUrl(
        phone,
        body,
        displayText,
        url,
      );
      await this.logOutbound(target, 'interactive', result.wamid, 'sent');
    } catch {
      this.logger.warn('WhatsApp link reply failed.');
      await this.logOutbound(target, 'interactive', null, 'failed', {
        code: 'REPLY_FAILED',
        title: 'Reply failed.',
      });
    }
  }

  private async sendButtons(
    phone: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
    target: ReplyTarget,
  ) {
    try {
      const result = await this.whatsapp.sendButtons(phone, body, buttons);
      await this.logOutbound(target, 'interactive', result.wamid, 'sent');
    } catch {
      this.logger.warn('WhatsApp progress reply failed.');
      await this.logOutbound(target, 'interactive', null, 'failed', {
        code: 'REPLY_FAILED',
        title: 'Reply failed.',
      });
    }
  }
}
