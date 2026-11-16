import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { DataSource } from 'typeorm';
import { DriverIssue } from './issue.entity.js';
import { RepairAccess } from './repair-access.js';

export function repairDataDir() {
  if (process.env.NODE_ENV === 'production' && !process.env.REPAIR_DATA_DIR)
    throw new Error(
      'REPAIR_DATA_DIR must point to persistent private storage.',
    );
  return resolve(process.env.REPAIR_DATA_DIR || '../../.fleet-data/repairs');
}
export async function writePrivateJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}
export class OpenWaError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`OpenWA request failed (${status})`);
  }
}
type Job = {
  id: string;
  text: string;
  chatId: string;
  createdAt: number;
  nextAt: number;
  attempts: number;
  status: 'pending' | 'sent' | 'stopped';
  messageId?: string;
};

@Injectable()
export class OpenWaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpenWaService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(RepairAccess) private readonly access: RepairAccess,
  ) {}
  get enabled() {
    return process.env.WHATSAPP_ENABLED === 'true';
  }
  get groupId() {
    const id = process.env.OPENWA_MECHANICS_GROUP_ID ?? '';
    if (!/^\d+(?:-\d+)?@g\.us$/.test(id))
      throw new Error('Configure the mechanics WhatsApp group ID.');
    return id;
  }
  async request(path: string, body?: unknown, key?: string): Promise<unknown> {
    const base = process.env.OPENWA_URL,
      apiKey = process.env.OPENWA_API_KEY,
      session = process.env.OPENWA_SESSION_ID;
    if (!this.enabled || !base || !apiKey || !session)
      throw new OpenWaError(503);
    const response = await fetch(
      new URL(
        `api/sessions/${encodeURIComponent(session)}/${path}`,
        `${base.replace(/\/$/, '')}/`,
      ),
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'X-API-Key': apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      },
    );
    const value = await response.json().catch(() => null);
    if (!response.ok)
      throw new OpenWaError(
        response.status,
        typeof value?.code === 'string' ? value.code : undefined,
      );
    return value;
  }
  async send(chatId: string, text: string, key: string) {
    const value = (await this.request(
      'messages/send-text',
      { chatId, text, linkPreview: false },
      key,
    )) as { messageId?: string };
    if (!value?.messageId) throw new OpenWaError(502);
    return value.messageId;
  }
  async isMember(phone: string): Promise<boolean> {
    const group = (await this.request(
      `groups/${encodeURIComponent(this.groupId)}`,
    )) as { id?: string; participants?: { id: string }[] };
    if (group.id !== this.groupId || !Array.isArray(group.participants))
      throw new OpenWaError(502);
    if (group.participants.some((p) => p.id === `${phone}@c.us`)) return true;
    // A privacy LID is not a phone number. Only trust the gateway's explicit mapping.
    if (!group.participants.some((p) => p.id.endsWith('@lid'))) return false;
    const mapping = (await this.request(`contacts/${phone}/lid`)) as {
      number?: string;
      lid?: string | null;
    };
    return (
      mapping.number === phone &&
      typeof mapping.lid === 'string' &&
      mapping.lid.endsWith('@lid') &&
      group.participants.some((p) => p.id === mapping.lid)
    );
  }
  async onModuleInit() {
    if (!this.enabled) return;
    void this.groupId;
    if (
      !process.env.OPENWA_URL ||
      !process.env.OPENWA_API_KEY ||
      !process.env.OPENWA_SESSION_ID
    )
      throw new Error(
        'Configure the OpenWA URL, session and API key before enabling WhatsApp.',
      );
    this.access.link('00000000-0000-4000-8000-000000000001');
    await mkdir(join(repairDataDir(), 'jobs'), {
      recursive: true,
      mode: 0o700,
    });
    this.timer = setInterval(() => {
      void this.flush();
    }, 10000);
    this.timer.unref();
    void this.flush();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async enqueue(id: string) {
    if (!this.enabled) return;
    try {
      const issue = await this.db
        .getRepository(DriverIssue)
        .findOne({ where: { id }, relations: { truck: true } });
      if (
        !issue ||
        issue.category !== 'vehicle' ||
        !issue.truck ||
        issue.resolvedAt
      )
        return;
      const dir = join(repairDataDir(), 'jobs');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, `${id}.json`);
      try {
        await readFile(path);
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const text = [
        `VHH Fleet · Truck issue`,
        `Truck: ${issue.truck.registration} (${issue.truck.identifier})`,
        issue.description,
        '',
        'View issue and record the repair:',
        this.access.link(id),
      ].join('\n');
      await writePrivateJson(path, {
        id,
        text,
        chatId: this.groupId,
        createdAt: Date.now(),
        nextAt: 0,
        attempts: 0,
        status: 'pending',
      } satisfies Job);
      void this.flush();
    } catch {
      this.logger.error(
        `Issue ${id} saved, but its WhatsApp alert could not be queued.`,
      );
    }
  }
  async flush() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const dir = join(repairDataDir(), 'jobs');
      for (const file of await readdir(dir)) {
        if (!/^[\da-f-]{36}\.json$/.test(file)) continue;
        const path = join(dir, file),
          job = JSON.parse(await readFile(path, 'utf8')) as Job;
        if (job.status !== 'pending' || job.nextAt > Date.now()) continue;
        // Never automatically retry beyond OpenWA's 24-hour deduplication window.
        const issue = await this.db
          .getRepository(DriverIssue)
          .findOneBy({ id: job.id });
        if (
          !issue ||
          issue.resolvedAt ||
          Date.now() - job.createdAt > 23 * 3600000 ||
          job.chatId !== this.groupId
        ) {
          job.status = 'stopped';
        } else {
          try {
            job.messageId = await this.send(
              job.chatId,
              job.text,
              `fleet-issue-${job.id}`,
            );
            job.status = 'sent';
          } catch (error) {
            job.attempts++;
            job.nextAt =
              Date.now() +
              Math.min(900000, 60000 * 2 ** Math.min(job.attempts - 1, 4));
            if (
              error instanceof OpenWaError &&
              ([
                'IDEMPOTENCY_OUTCOME_UNKNOWN',
                'IDEMPOTENCY_KEY_REUSED',
              ].includes(error.code ?? '') ||
                [400, 401, 403, 404, 422].includes(error.status))
            )
              job.status = 'stopped';
            this.logger.warn(
              `WhatsApp alert ${job.id}: ${job.status === 'stopped' ? 'needs operator attention' : 'retry scheduled'}.`,
            );
          }
        }
        await writePrivateJson(path, job);
      }
    } catch {
      this.logger.error(
        'WhatsApp alert queue is unavailable. Issue records are retained.',
      );
    } finally {
      this.running = false;
    }
  }
}
