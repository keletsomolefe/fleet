import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { createHttpServer } from '../http/server.js';
import { DriverIssue } from './issue.entity.js';
import { RepairAccess } from './repair-access.js';
import { RepairOtpService } from './repair-otp.service.js';
import { OpenWaService, OpenWaError } from './openwa.service.js';
import { RepairsService, photoType } from './repairs.service.js';
import { registerPublicRepairRoutes } from './repairs.routes.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const phone = '27821234567';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2sAAAAASUVORK5CYII=',
  'base64',
);
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fleet-repairs-'));
  vi.stubEnv('REPAIR_DATA_DIR', directory);
  vi.stubEnv(
    'REPAIR_LINK_SECRET',
    'test-only-secret-with-more-than-thirty-two-characters',
  );
  vi.stubEnv('APP_URL', 'https://fleet.example.test');
  vi.stubEnv('WHATSAPP_ENABLED', 'true');
  vi.stubEnv('OPENWA_MECHANICS_GROUP_ID', '12345@g.us');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
function issue() {
  return {
    id,
    truckId: other,
    category: 'vehicle',
    description: 'Brake fault',
    truck: { registration: 'TEST 1', identifier: 'T1' },
    resolvedAt: null,
    resolvedById: null,
    resolutionNote: null,
    createdAt: new Date(),
  } as DriverIssue;
}

describe('Repair capability links', () => {
  it('scopes links to an issue, purpose and expiry, and keeps credentials in the fragment', () => {
    const access = new RepairAccess(),
      link = new URL(access.link(id));
    const token = new URLSearchParams(link.hash.slice(1)).get('token')!;
    expect(link.pathname).toBe(`/repairs/${id}`);
    expect(link.search).toBe('');
    expect(access.verify(token, id).purpose).toBe('view');
    expect(() => access.verify(token, other)).toThrow();
    expect(() => access.verify(token, id, 'repair')).toThrow();
    expect(() => access.verify(token.slice(0, -8) + 'modified', id)).toThrow();
    const expired = access.sign({
      issueId: id,
      purpose: 'view',
      expires: Date.now() - 1,
    });
    expect(() => access.verify(expired, id)).toThrow();
    vi.stubEnv(
      'REPAIR_LINK_SECRET',
      'a-different-secret-with-thirty-two-characters',
    );
    expect(() => access.verify(token, id)).toThrow();
  });
});
describe('WhatsApp OTP', () => {
  it('checks membership, sends privately, consumes a code once and grants only this issue', async () => {
    const wa = {
      isMember: vi.fn().mockResolvedValue(true),
      send: vi.fn().mockResolvedValue('message'),
    };
    const access = new RepairAccess(),
      service = new RepairOtpService(wa as unknown as OpenWaService, access);
    const { challengeId } = await service.request(id, { phone: `+${phone}` });
    const [destination, text] = wa.send.mock.calls[0];
    expect(destination).toBe(`${phone}@c.us`);
    const code = String(text).match(/code: (\d{6})/)![1];
    expect(() => service.verify(other, { challengeId, code })).toThrow();
    const { token } = service.verify(id, { challengeId, code });
    expect(access.verify(token, id, 'repair').phone).toBe(phone);
    expect(() => service.verify(id, { challengeId, code })).toThrow();
    await expect(service.request(id, { phone: `+${phone}` })).rejects.toThrow(
      'wait',
    );
  });
  it('refuses non-members and stops brute force after five guesses', async () => {
    const wa = {
      isMember: vi.fn().mockResolvedValue(false),
      send: vi.fn().mockResolvedValue('message'),
    };
    const service = new RepairOtpService(
      wa as unknown as OpenWaService,
      new RepairAccess(),
    );
    await expect(
      service.request(id, { phone: '+27820000000' }),
    ).rejects.toThrow('mechanics group');
    expect(wa.send).not.toHaveBeenCalled();
    wa.isMember.mockResolvedValue(true);
    const { challengeId } = await service.request(id, { phone: `+${phone}` });
    const code = String(wa.send.mock.calls[0][1]).match(/code: (\d{6})/)![1];
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      expect(() => service.verify(id, { challengeId, code: wrong })).toThrow();
    expect(() => service.verify(id, { challengeId, code })).toThrow();
  });
  it('expires codes and denies a removed group member at submission', async () => {
    const wa = {
      isMember: vi.fn().mockResolvedValue(true),
      send: vi.fn().mockResolvedValue('message'),
    };
    const service = new RepairOtpService(
      wa as unknown as OpenWaService,
      new RepairAccess(),
    );
    const { challengeId } = await service.request(id, { phone: `+${phone}` });
    const code = String(wa.send.mock.calls[0][1]).match(/code: (\d{6})/)![1];
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    expect(() => service.verify(id, { challengeId, code })).toThrow();
    wa.isMember.mockResolvedValue(false);
    await expect(service.requireMember(phone)).rejects.toThrow();
  });
});
describe('OpenWA integration', () => {
  it('does not mistake privacy IDs for phone numbers', async () => {
    const wa = new OpenWaService({} as DataSource, new RepairAccess());
    const api = vi
      .spyOn(wa, 'request')
      .mockResolvedValueOnce({
        id: '12345@g.us',
        participants: [{ id: `${phone}@lid`, number: phone }],
      })
      .mockResolvedValueOnce({ number: phone, lid: null });
    expect(await wa.isMember(phone)).toBe(false);
    api
      .mockResolvedValueOnce({
        id: '12345@g.us',
        participants: [{ id: '999@lid' }],
      })
      .mockResolvedValueOnce({ number: phone, lid: '999@lid' });
    expect(await wa.isMember(phone)).toBe(true);
  });
  it('queues vehicle reports only, survives restart and reuses the same idempotency key', async () => {
    const record = issue(),
      repo = {
        findOne: vi.fn().mockResolvedValue(record),
        findOneBy: vi.fn().mockResolvedValue(record),
      };
    const db = { getRepository: () => repo } as unknown as DataSource;
    const wa = new OpenWaService(db, new RepairAccess());
    const flush = vi.spyOn(wa, 'flush').mockResolvedValue();
    await wa.enqueue(id);
    await wa.enqueue(id);
    const path = join(directory, 'jobs', `${id}.json`);
    expect((await readdir(join(directory, 'jobs'))).length).toBe(1);
    const before = JSON.parse(await readFile(path, 'utf8'));
    expect(before.text).toContain('TEST 1');
    expect(before.text).toContain('/repairs/');
    flush.mockRestore();
    const send = vi
      .spyOn(wa, 'send')
      .mockRejectedValueOnce(new OpenWaError(503));
    await wa.flush();
    expect(JSON.parse(await readFile(path, 'utf8')).status).toBe('pending');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
    const restarted = new OpenWaService(db, new RepairAccess());
    const sendAgain = vi
      .spyOn(restarted, 'send')
      .mockResolvedValue('message-1');
    await restarted.flush();
    await restarted.flush();
    expect(sendAgain).toHaveBeenCalledTimes(1);
    expect(sendAgain.mock.calls[0]).toEqual(send.mock.calls[0]);
    expect(JSON.parse(await readFile(path, 'utf8')).status).toBe('sent');
    record.category = 'safety';
    record.id = other;
    await wa.enqueue(other);
    expect((await readdir(join(directory, 'jobs'))).length).toBe(1);
  });
  it('stops ambiguous sends rather than sending duplicate alerts', async () => {
    const repo = {
      findOne: vi.fn().mockResolvedValue(issue()),
      findOneBy: vi.fn().mockResolvedValue(issue()),
    };
    const wa = new OpenWaService(
      { getRepository: () => repo } as unknown as DataSource,
      new RepairAccess(),
    );
    const initial = vi.spyOn(wa, 'flush').mockResolvedValue();
    await wa.enqueue(id);
    initial.mockRestore();
    const send = vi
      .spyOn(wa, 'send')
      .mockRejectedValue(new OpenWaError(409, 'IDEMPOTENCY_OUTCOME_UNKNOWN'));
    await wa.flush();
    await wa.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(directory, 'jobs', `${id}.json`), 'utf8'))
        .status,
    ).toBe('stopped');
  });
});
describe('Repair HTTP flow', () => {
  let app: FastifyInstance,
    access: RepairAccess,
    row: DriverIssue,
    wa: { isMember: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> },
    events: { changed: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    row = issue();
    wa = {
      isMember: vi.fn().mockResolvedValue(true),
      send: vi.fn().mockResolvedValue('message'),
    };
    events = { changed: vi.fn() };
    const manager = {
      findOne: vi.fn().mockImplementation(async () => row),
      save: vi.fn().mockImplementation(async (value) => {
        row = value;
      }),
    };
    const db = {
      getRepository: () => ({
        findOne: async () => row,
        findOneBy: async () => ({ id: other, isActive: false }),
      }),
      transaction: async (cb: (m: unknown) => Promise<unknown>) => cb(manager),
    };
    access = new RepairAccess();
    const otp = new RepairOtpService(wa as unknown as OpenWaService, access);
    const repairs = new RepairsService(
      db as unknown as DataSource,
      otp,
      events as unknown as OperationsEventsService,
    );
    app = createHttpServer();
    app.register(multipart);
    registerPublicRepairRoutes(app, repairs, access, otp);
  });
  afterEach(async () => {
    await app.close();
  });
  function form(note: string, photos: Blob[] = [], name?: string) {
    const form = new FormData();
    form.set('note', note);
    if (name) form.set('name', name);
    for (const photo of photos) form.append('photos', photo, 'repair.png');
    return form;
  }

  function imageFile(content: Buffer<ArrayBuffer> | string = png) {
    return new Blob([content], { type: 'image/png' });
  }

  function get(path: string, token?: string) {
    return app.inject({
      url: path,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  function post(path: string, token: string, payload: FormData | object) {
    return app.inject({
      method: 'POST',
      url: `/repairs/${id}/${path}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  it('requires OTP to change data, saves evidence and exposes the committed repair', async () => {
    const link = access.sign({
      issueId: id,
      purpose: 'view',
      expires: Date.now() + 60000,
    });
    const path = `/repairs/${id}`;
    expect((await get(path)).statusCode).toBe(401);
    expect((await get(path, link)).statusCode).toBe(200);
    expect(row.resolvedAt).toBeNull();
    const denied = await post('resolve', link, form('Repaired', [imageFile()]));
    expect(denied.statusCode).toBe(401);

    const challenge = await post('otp', link, { phone: `+${phone}` });
    expect(challenge.statusCode).toBe(200);
    const code = String(wa.send.mock.calls[0][1]).match(/code: (\d{6})/)![1];
    const verified = await post('otp/verify', link, {
      challengeId: challenge.json().challengeId,
      code,
    });
    expect(verified.statusCode).toBe(200);
    const grant = verified.json().token;
    const done = await post(
      'resolve',
      grant,
      form(
        'Brake pads replaced',
        [imageFile(), imageFile(), imageFile()],
        'Test mechanic',
      ),
    );
    expect(done.statusCode).toBe(200);
    expect(row.resolvedAt).not.toBeNull();
    expect(row.resolvedById).toBe(other);
    expect(row.resolutionNote).toBe('Brake pads replaced');
    expect(events.changed).toHaveBeenCalledTimes(1);
    const saved = await get(path, grant);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().photos).toHaveLength(3);
    const [photo] = saved.json().photos;
    expect((await get(`${path}/photos/${photo}`)).statusCode).toBe(401);
    const image = await get(`${path}/photos/${photo}`, grant);
    expect(image.statusCode).toBe(200);
    expect(image.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    expect(image.rawPayload).toEqual(png);
    expect(
      (await get(`/repairs/${other}/photos/${photo}`, grant)).statusCode,
    ).toBe(401);
    expect((await post('resolve', grant, form('Overwrite'))).statusCode).toBe(
      409,
    );
  });

  it('refuses invalid uploads and membership revoked after verification', async () => {
    const grant = access.sign({
      issueId: id,
      purpose: 'repair',
      phone,
      expires: Date.now() + 60000,
    });
    const forged = await post(
      'resolve',
      grant,
      form('Fixed', [imageFile('<script>alert(1)</script>')]),
    );
    expect(forged.statusCode).toBe(400);
    const oversized = await post(
      'resolve',
      grant,
      form('Fixed', [imageFile(Buffer.alloc(5 * 1024 * 1024 + 1))]),
    );
    expect(oversized.statusCode).toBe(413);
    const tooMany = await post(
      'resolve',
      grant,
      form(
        'Fixed',
        Array.from({ length: 4 }, () => imageFile()),
      ),
    );
    expect(tooMany.statusCode).toBe(400);

    wa.isMember.mockResolvedValue(false);
    expect((await post('resolve', grant, form('Fixed'))).statusCode).toBe(403);
    expect(row.resolvedAt).toBeNull();
    expect(events.changed).not.toHaveBeenCalled();
  });
});
it('limits uploaded image sizes and rejects executable file types', () => {
  expect(() =>
    photoType({
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      mimetype: 'image/png',
      size: 0,
    }),
  ).toThrow();
  expect(() =>
    photoType({
      buffer: Buffer.from('<svg/>'),
      mimetype: 'image/svg+xml',
      size: 6,
    }),
  ).toThrow();
});
