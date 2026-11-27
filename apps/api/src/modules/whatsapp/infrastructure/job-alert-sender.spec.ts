import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobAlertSender } from './job-alert-sender.js';
import type { WhatsAppCloudService } from './whatsapp-cloud.service.js';

const dummyCloud = {
  configured: false,
  alertTemplate: 'vhh_service_job_alert',
  recipientNumbers: null,
  sendJobAlert: vi.fn(),
} as unknown as WhatsAppCloudService;

const envKeys = [
  'SERVICE_JOB_ALERT_TRANSPORT',
  'OPENWA_DEMO_URL',
  'OPENWA_DEMO_SESSION_ID',
  'OPENWA_DEMO_API_KEY',
  'OPENWA_DEMO_SENDER',
  'OPENWA_DEMO_RECIPIENTS',
  'OPENWA_DEMO_GROUP_ID',
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of envKeys) {
  savedEnv.set(key, process.env[key]);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of envKeys) {
    const val = savedEnv.get(key);
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

describe('createJobAlertSender (openwa-demo)', () => {
  it('sends to the configured WhatsApp group chat ID with provider links', async () => {
    process.env.SERVICE_JOB_ALERT_TRANSPORT = 'openwa-demo';
    process.env.OPENWA_DEMO_URL = 'http://127.0.0.1:12785';
    process.env.OPENWA_DEMO_SESSION_ID = 'sess-123';
    process.env.OPENWA_DEMO_API_KEY = 'secret-key';
    process.env.OPENWA_DEMO_GROUP_ID = '120363414856243140@g.us';
    delete process.env.OPENWA_DEMO_SENDER;
    delete process.env.OPENWA_DEMO_RECIPIENTS;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'wamid-group-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const sender = createJobAlertSender(dummyCloud);
    expect(sender.configured).toBe(true);
    expect(sender.groupChatId).toBe('120363414856243140@g.us');
    expect(sender.recipientNumbers).toBeNull();

    const result = await sender.sendJobAlert({
      to: '120363414856243140@g.us',
      idempotencyKey: 'fleet-group-job1-abc',
      link: 'http://127.0.0.1:3042/j/offer-a',
      links: [
        {
          providerCompany: 'Cape Town Towing',
          link: 'http://127.0.0.1:3042/j/offer-a',
        },
        {
          providerCompany: 'VHH Roadside',
          link: 'http://127.0.0.1:3042/j/offer-b',
        },
      ],
      reference: 'SJ-000042',
      registration: 'GP 24 VH GP',
      identifier: 'VHH-012',
      serviceTypeLabel: 'Mechanical',
      issueSummary: 'Engine overheating near Polokwane',
      locationText: 'N1 North',
    });

    expect(result).toEqual({ wamid: 'wamid-group-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url instanceof URL ? url.href : url).toBe(
      'http://127.0.0.1:12785/api/sessions/sess-123/messages/send-text',
    );
    const body = JSON.parse(init?.body as string) as {
      chatId: string;
      text: string;
      linkPreview: boolean;
    };
    expect(body.chatId).toBe('120363414856243140@g.us');
    expect(body.linkPreview).toBe(false);
    expect(body.text).toContain('VHH Fleet service request SJ-000042');
    expect(body.text).toContain('• Cape Town Towing: http://127.0.0.1:3042/j/offer-a');
    expect(body.text).toContain('• VHH Roadside: http://127.0.0.1:3042/j/offer-b');
  });

  it('uses single-link copy when only one provider offer is included in group mode', async () => {
    process.env.SERVICE_JOB_ALERT_TRANSPORT = 'openwa-demo';
    process.env.OPENWA_DEMO_URL = 'http://127.0.0.1:12785';
    process.env.OPENWA_DEMO_SESSION_ID = 'sess-123';
    process.env.OPENWA_DEMO_API_KEY = 'secret-key';
    process.env.OPENWA_DEMO_GROUP_ID = '120363414856243140@g.us';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'wamid-group-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const sender = createJobAlertSender(dummyCloud);
    await sender.sendJobAlert({
      to: '120363414856243140@g.us',
      idempotencyKey: 'fleet-group-job2-abc',
      link: 'http://127.0.0.1:3042/j/offer-only',
      links: [
        {
          providerCompany: 'VHH Roadside',
          link: 'http://127.0.0.1:3042/j/offer-only',
        },
      ],
      reference: 'SJ-000043',
      registration: 'GP 99 VH GP',
      identifier: 'VHH-099',
      serviceTypeLabel: 'Tyres',
      issueSummary: 'Rear tyre puncture',
      locationText: null,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      chatId: string;
      text: string;
    };
    expect(body.chatId).toBe('120363414856243140@g.us');
    expect(body.text).toContain('View this job to accept or decline:\nhttp://127.0.0.1:3042/j/offer-only');
  });

  it('preserves individual recipient allowlist mode when OPENWA_DEMO_GROUP_ID is unset', async () => {
    process.env.SERVICE_JOB_ALERT_TRANSPORT = 'openwa-demo';
    process.env.OPENWA_DEMO_URL = 'http://127.0.0.1:12785';
    process.env.OPENWA_DEMO_SESSION_ID = 'sess-123';
    process.env.OPENWA_DEMO_API_KEY = 'secret-key';
    process.env.OPENWA_DEMO_SENDER = '27738849358';
    process.env.OPENWA_DEMO_RECIPIENTS = '27738849358,27821112222';
    delete process.env.OPENWA_DEMO_GROUP_ID;

    const sender = createJobAlertSender(dummyCloud);
    expect(sender.configured).toBe(true);
    expect(sender.groupChatId).toBeNull();
    expect(sender.recipientNumbers).toEqual(['27821112222']);
  });
});
