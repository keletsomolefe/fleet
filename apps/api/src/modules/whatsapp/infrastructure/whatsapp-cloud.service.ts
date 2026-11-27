import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestError } from '../../../shared/errors.js';
import { photoType, type UploadedPhoto } from '../../../shared/storage/photo.js';
import type { JobAlertInput } from './job-alert-sender.js';

export type WhatsAppButton = { id: string; title: string };

export class WhatsAppCloudError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly permanent: boolean,
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = 'WhatsAppCloudError';
  }
}

type SendResult = { wamid: string };

function normalizedGraphUrl() {
  return (process.env.META_WHATSAPP_GRAPH_URL || 'https://graph.facebook.com')
    .replace(/\/+$/, '');
}
function apiVersion() {
  return process.env.META_WHATSAPP_API_VERSION ?? 'v25.0';
}
function phoneNumberId() {
  return process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? '';
}
function accessToken() {
  return process.env.META_WHATSAPP_ACCESS_TOKEN ?? '';
}
export function templateName() {
  return process.env.META_WHATSAPP_JOB_TEMPLATE ?? 'vhh_service_job_alert';
}
export function templateLanguage() {
  return process.env.META_WHATSAPP_TEMPLATE_LANGUAGE ?? 'en_US';
}
export function templateText(raw: string | null | undefined, max: number) {
  const value = String(raw ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (value || 'Not provided').slice(0, max).trim();
}

export class WhatsAppCloudService {
  readonly recipientNumbers = null;
  constructor(
    private readonly logger: Pick<Console, 'info' | 'warn' | 'error'> = console,
  ) {}

  get configured() {
    return Boolean(accessToken() && phoneNumberId());
  }
  get alertTemplate() {
    return templateName();
  }
  get verifyToken() {
    return process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '';
  }
  get appSecret() {
    return process.env.META_WHATSAPP_APP_SECRET ?? '';
  }
  get businessAccountId() {
    return process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  }

  private async request(payload: Record<string, unknown>): Promise<SendResult> {
    if (!this.configured) {
      throw new WhatsAppCloudError(
        'WhatsApp sending is not configured.',
        503,
        'CONFIG',
        true,
      );
    }
    const url = `${normalizedGraphUrl()}/${apiVersion()}/${encodeURIComponent(phoneNumberId())}/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new WhatsAppCloudError(
        'Could not confirm the WhatsApp send request.',
        null,
        'AMBIGUOUS',
        false,
        true,
      );
    }
    const result = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
      error?: {
        code?: number;
        message?: string;
        error_data?: { details?: string };
      };
    } | null;
    if (!response.ok) {
      const code = result?.error?.code;
      const codeText = Number.isInteger(code) ? String(code) : null;
      const title =
        result?.error?.error_data?.details ??
        result?.error?.message ??
        `Meta rejected the request (HTTP ${response.status}).`;
      const transient = response.status === 429 || response.status >= 500;
      throw new WhatsAppCloudError(title, response.status, codeText, !transient);
    }
    const wamid = result?.messages?.[0]?.id;
    if (typeof wamid !== 'string' || !wamid.startsWith('wamid.')) {
      throw new WhatsAppCloudError(
        'Meta returned no message ID.',
        response.status,
        'NO_MESSAGE_ID',
        false,
        true,
      );
    }
    return { wamid };
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    return this.request({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4096) },
    });
  }

  async sendButtons(
    to: string,
    body: string,
    buttons: WhatsAppButton[],
  ): Promise<SendResult> {
    if (buttons.length < 1 || buttons.length > 3) {
      throw new Error('WhatsApp button replies support one to three buttons.');
    }
    return this.request({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body.slice(0, 1024) },
        action: {
          buttons: buttons.map((button) => ({
            type: 'reply',
            reply: {
              id: button.id.slice(0, 256),
              title: button.title.slice(0, 20),
            },
          })),
        },
      },
    });
  }

  async sendCtaUrl(
    to: string,
    body: string,
    displayText: string,
    url: string,
  ): Promise<SendResult> {
    return this.request({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: body.slice(0, 1024) },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: displayText.slice(0, 20),
            url,
          },
        },
      },
    });
  }

  async sendJobAlert(input: JobAlertInput): Promise<SendResult> {
    const suffix = (() => {
      try {
        const path = new URL(input.link).pathname;
        return path.startsWith('/j/') ? path.slice(3) : path.replace(/^\//, '');
      } catch {
        return '';
      }
    })();
    if (!suffix) {
      throw new WhatsAppCloudError(
        'The provider link is invalid.',
        null,
        'LINK',
        true,
      );
    }
    return this.request({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'template',
      template: {
        name: templateName(),
        language: { code: templateLanguage() },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: templateText(input.reference, 40) },
              { type: 'text', text: templateText(input.registration, 40) },
              { type: 'text', text: templateText(input.identifier, 40) },
              {
                type: 'text',
                text: templateText(
                  `${input.serviceTypeLabel}: ${input.issueSummary}`,
                  160,
                ),
              },
              {
                type: 'text',
                text: templateText(
                  input.locationText ?? 'Shared on the job page',
                  120,
                ),
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '2',
            parameters: [{ type: 'text', text: encodeURIComponent(suffix) }],
          },
          ...['accept_job', 'cant_take'].map((payload, index) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(index),
            parameters: [{ type: 'payload', payload }],
          })),
        ],
      },
    });
  }

  async downloadPhoto(mediaId: string): Promise<UploadedPhoto> {
    if (!/^\d{1,32}$/.test(mediaId) || !this.configured) {
      throw new BadRequestError('Could not read this WhatsApp photo.');
    }
    const graph = new URL(normalizedGraphUrl());
    const headers = { Authorization: `Bearer ${accessToken()}` };
    const signal = AbortSignal.timeout(10_000);
    const metadata = await fetch(
      `${normalizedGraphUrl()}/${apiVersion()}/${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId())}`,
      { headers, redirect: 'error', signal },
    );
    if (metadata.status >= 500 || metadata.status === 429) {
      throw new Error('WhatsApp photo metadata is temporarily unavailable.');
    }
    if (!metadata.ok) {
      throw new BadRequestError('Could not read this WhatsApp photo.');
    }
    const info = (await metadata.json()) as {
      url?: string;
      file_size?: number;
      mime_type?: string;
    };
    let url: URL;
    try {
      url = new URL(info.url ?? '');
    } catch {
      throw new BadRequestError('Could not read this WhatsApp photo.');
    }
    if (
      url.username ||
      url.password ||
      (url.origin !== 'https://lookaside.fbsbx.com' &&
        !(
          graph.origin !== 'https://graph.facebook.com' &&
          url.origin === graph.origin
        ))
    ) {
      throw new BadRequestError('Could not read this WhatsApp photo.');
    }
    const max = 5 * 1024 * 1024;
    if (typeof info.file_size === 'number' && info.file_size > max) {
      throw new BadRequestError('Each photo must be 5 MB or smaller.');
    }
    const response = await fetch(url, { headers, redirect: 'error', signal });
    if (response.status >= 500 || response.status === 429) {
      throw new Error('WhatsApp photo download is temporarily unavailable.');
    }
    if (!response.ok || !response.body) {
      throw new BadRequestError('Could not read this WhatsApp photo.');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel();
          throw new BadRequestError('Each photo must be 5 MB or smaller.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const file = {
      buffer: Buffer.concat(chunks, size),
      mimetype: String(info.mime_type ?? '').split(';')[0],
      size,
    };
    photoType(file);
    return file;
  }

  verifySignature(raw: Buffer, signature: string | undefined): boolean {
    if (
      !this.appSecret ||
      !signature ||
      !/^sha256=[0-9a-f]{64}$/i.test(signature)
    ) {
      return false;
    }
    const supplied = Buffer.from(signature.slice(7), 'hex');
    const expected = createHmac('sha256', this.appSecret).update(raw).digest();
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }

  verifyWebhookToken(token: string | undefined): boolean {
    if (!this.verifyToken || !token) return false;
    const supplied = Buffer.from(token);
    const expected = Buffer.from(this.verifyToken);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }

  logError(message: string) {
    this.logger.error(message);
  }
}
