import {
  templateText,
  WhatsAppCloudError,
  type WhatsAppCloudService,
} from './whatsapp-cloud.service.js';

export interface JobAlertLink {
  providerCompany: string;
  link: string;
}

export interface JobAlertInput {
  to: string;
  link: string;
  links?: JobAlertLink[];
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
  readonly groupChatId?: string | null;
  sendJobAlert(input: JobAlertInput): Promise<{ wamid: string }>;
}

const groupChatPattern = /^[0-9-]+@g\.us$/;

function createOpenWaDemoSender(): JobAlertSender {
  const base = process.env.OPENWA_DEMO_URL;
  const session = process.env.OPENWA_DEMO_SESSION_ID;
  const key = process.env.OPENWA_DEMO_API_KEY;
  const rawGroupChatId = process.env.OPENWA_DEMO_GROUP_ID?.trim() ?? '';
  const groupChatId = groupChatPattern.test(rawGroupChatId)
    ? rawGroupChatId
    : null;
  const senderNumber = process.env.OPENWA_DEMO_SENDER?.trim().replace(/^\+/, '');
  const recipientNumbers = (process.env.OPENWA_DEMO_RECIPIENTS ?? '')
    .split(',')
    .map((phone) => phone.trim().replace(/^\+/, ''))
    .filter(
      (phone) => /^[1-9]\d{7,14}$/.test(phone) && phone !== senderNumber,
    );

  const isConfigured = () =>
    Boolean(
      base &&
        session &&
        key &&
        (groupChatId ||
          (senderNumber &&
            /^[1-9]\d{7,14}$/.test(senderNumber) &&
            recipientNumbers.length)),
    );

  return {
    alertTemplate: null,
    recipientNumbers: groupChatId ? null : recipientNumbers,
    groupChatId,
    get configured() {
      return isConfigured();
    },
    async sendJobAlert(input: JobAlertInput) {
      if (!isConfigured() || !base || !session || !key) {
        throw new WhatsAppCloudError(
          'OpenWA demo sending is not configured.',
          null,
          'CONFIG',
          true,
        );
      }
      if (!groupChatId && !recipientNumbers.includes(input.to)) {
        throw new WhatsAppCloudError(
          'This number is outside the demo audience.',
          null,
          'RECIPIENT',
          true,
        );
      }
      const url = new URL(
        `api/sessions/${encodeURIComponent(session)}/messages/send-text`,
        base.replace(/\/+$/, '') + '/',
      );
      const linkLines =
        groupChatId && input.links && input.links.length > 1
          ? [
              'Service providers — open your link to accept or decline:',
              ...input.links.map(
                (entry) =>
                  `• ${templateText(entry.providerCompany, 80)}: ${entry.link}`,
              ),
            ]
          : ['View this job to accept or decline:', input.link];
      const text = [
        `VHH Fleet service request ${input.reference}`,
        `Vehicle: ${templateText(input.registration, 40)} (${templateText(input.identifier, 40)})`,
        `Issue: ${input.serviceTypeLabel} — ${templateText(input.issueSummary, 2000)}`,
        `Location: ${templateText(input.locationText || 'See the job page', 250)}`,
        '',
        ...linkLines,
      ].join('\n');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': key,
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify({
            chatId: groupChatId ?? `${input.to}@c.us`,
            text,
            linkPreview: false,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(25_000),
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
      if (typeof wamid !== 'string' || !wamid.trim() || wamid.length > 128) {
        throw new WhatsAppCloudError(
          'OpenWA returned no usable message ID.',
          response.status,
          'NO_MESSAGE_ID',
          false,
          true,
        );
      }
      return { wamid };
    },
  };
}

export function createJobAlertSender(
  cloud: WhatsAppCloudService,
): JobAlertSender {
  switch (process.env.SERVICE_JOB_ALERT_TRANSPORT ?? 'meta') {
    case 'meta':
      return cloud;
    case 'openwa-demo':
      return createOpenWaDemoSender();
    default:
      throw new Error('Unknown service job alert transport.');
  }
}
