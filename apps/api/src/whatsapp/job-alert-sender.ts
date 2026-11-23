import {
  templateText,
  WhatsAppCloudError,
  type WhatsAppCloudService,
} from './whatsapp-cloud.service.js';

export interface JobAlertInput {
  to: string;
  link: string;
  reference: string;
  registration: string;
  identifier: string;
  serviceTypeLabel: string;
  issueSummary: string;
  locationText: string | null;
  idempotencyKey: string;
}

export interface JobAlertSender {
  readonly configured: boolean;
  readonly alertTemplate: string | null;
  readonly recipientNumbers: string[] | null;
  sendJobAlert(input: JobAlertInput): Promise<{ wamid: string }>;
}

class OpenWaDemoSender implements JobAlertSender {
  readonly alertTemplate = null;
  private readonly base = process.env.OPENWA_DEMO_URL;
  private readonly session = process.env.OPENWA_DEMO_SESSION_ID;
  private readonly key = process.env.OPENWA_DEMO_API_KEY;

  private readonly senderNumber =
    process.env.OPENWA_DEMO_SENDER?.trim().replace(/^\+/, '');
  readonly recipientNumbers = (process.env.OPENWA_DEMO_RECIPIENTS ?? '')
    .split(',')
    .map((phone) => phone.trim().replace(/^\+/, ''))
    .filter(
      (phone) => /^[1-9]\d{7,14}$/.test(phone) && phone !== this.senderNumber,
    );

  get configured() {
    return !!(
      this.base &&
      this.session &&
      this.key &&
      this.senderNumber &&
      /^[1-9]\d{7,14}$/.test(this.senderNumber) &&
      this.recipientNumbers.length
    );
  }

  async sendJobAlert(input: JobAlertInput) {
    if (!this.configured || !this.base || !this.session || !this.key)
      throw new WhatsAppCloudError(
        'OpenWA demo sending is not configured.',
        null,
        'CONFIG',
        true,
      );
    if (!this.recipientNumbers.includes(input.to))
      throw new WhatsAppCloudError(
        'This number is outside the demo audience.',
        null,
        'RECIPIENT',
        true,
      );
    const url = new URL(
      `api/sessions/${encodeURIComponent(this.session)}/messages/send-text`,
      this.base.replace(/\/+$/, '') + '/',
    );
    const text = [
      `VHH Fleet service request ${input.reference}`,
      `Vehicle: ${templateText(input.registration, 40)} (${templateText(input.identifier, 40)})`,
      `Issue: ${input.serviceTypeLabel} — ${templateText(input.issueSummary, 2000)}`,
      `Location: ${templateText(input.locationText || 'See the job page', 250)}`,
      '',
      'View this job to accept or decline:',
      input.link,
    ].join('\n');
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.key,
          'Idempotency-Key': input.idempotencyKey,
        },
        body: JSON.stringify({
          chatId: `${input.to}@c.us`,
          text,
          linkPreview: false,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new WhatsAppCloudError(
        'Could not confirm the OpenWA send.',
        null,
        'AMBIGUOUS',
        false,
        true,
      );
    }
    const result = (await response.json().catch(() => null)) as {
      code?: string;
      messageId?: string;
    } | null;
    if (!response.ok) {
      const code =
        typeof result?.code === 'string' &&
        /^[A-Z_0-9]{1,32}$/.test(result.code)
          ? result.code
          : `OPENWA_${response.status}`;
      const mayHaveSent =
        code === 'IDEMPOTENCY_OUTCOME_UNKNOWN' || response.status >= 500;
      const retryable =
        response.status === 429 || code === 'IDEMPOTENCY_IN_PROGRESS';
      throw new WhatsAppCloudError(
        `OpenWA send failed (${code}).`,
        response.status,
        code,
        !retryable,
        mayHaveSent,
      );
    }
    const wamid = result?.messageId;
    if (typeof wamid !== 'string' || !wamid.trim() || wamid.length > 128)
      throw new WhatsAppCloudError(
        'OpenWA returned no usable message ID.',
        response.status,
        'NO_MESSAGE_ID',
        false,
        true,
      );
    return { wamid };
  }
}

export function createJobAlertSender(
  cloud: WhatsAppCloudService,
): JobAlertSender {
  switch (process.env.SERVICE_JOB_ALERT_TRANSPORT ?? 'meta') {
    case 'meta':
      return cloud;
    case 'openwa-demo':
      return new OpenWaDemoSender();
    default:
      throw new Error('Unknown service job alert transport.');
  }
}
