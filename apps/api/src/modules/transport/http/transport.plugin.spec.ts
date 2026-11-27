import cookie from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import { protectAdminScope } from '../../../plugins/admin-auth.plugin.js';
import { createHttpServer } from '../../../plugins/server.js';
import { ForbiddenError } from '../../../shared/errors.js';
import { privateResponse } from '../../../shared/http.js';
import type {
  AdminContext,
  AuthService,
} from '../../identity/application/auth.service.js';
import type { RbacService } from '../../identity/application/rbac.service.js';
import {
  adminTransportPlugin,
  mobileTransportPlugin,
  type TransportServices,
} from './transport.plugin.js';

function makeContext(permissions: string[]): AdminContext {
  return {
    session: {
      id: '11111111-1111-4111-8111-111111111111',
      active: true,
      authenticated_at: new Date().toISOString(),
      identity: {
        id: '22222222-2222-4222-8222-222222222222',
        traits: {
          email: 'admin@fleet.test',
          name: { first: 'Admin', last: 'User' },
        },
      },
    },
    user: {
      id: '33333333-3333-4333-8333-333333333333',
      kratosIdentityId: '22222222-2222-4222-8222-222222222222',
      email: 'admin@fleet.test',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      createdBy: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    roles: [],
    permissions,
  };
}

describe('Transport Fastify plugin contracts', () => {
  async function buildServer(permissions: string[]) {
    const app = createHttpServer({ logger: false });
    app.decorateRequest('adminContext', null);
    app.decorateRequest('mobileContext', null);
    app.decorateRequest('mobileToken', null);
    await app.register(cookie);

    const ctx = makeContext(permissions);
    const auth = {
      authenticate: vi.fn().mockResolvedValue(ctx),
      authenticateNative: vi.fn().mockResolvedValue(ctx),
      verifyCsrf: vi.fn(),
    } as unknown as AuthService;
    const rbac = {
      require: vi.fn((_c: AdminContext, ...req: string[]) => {
        for (const key of req) {
          if (!permissions.includes(key)) {
            throw new ForbiddenError('Forbidden');
          }
        }
      }),
    } as unknown as RbacService;

    const recordDetailSpy = vi.fn().mockResolvedValue({ record: {} });
    const uploadBatchSpy = vi.fn().mockResolvedValue({
      accepted: [],
      rejected: [],
      stopCapture: false,
      receivedAt: new Date().toISOString(),
    });

    const transport = {
      catalogue: {
        catalogue: vi.fn().mockResolvedValue({ customers: [] }),
        saveMaster: vi.fn().mockResolvedValue({ id: 'ok' }),
      },
      pricing: {
        listRates: vi.fn().mockResolvedValue([]),
        createRate: vi.fn().mockResolvedValue({ id: 'rate-1' }),
        endRate: vi.fn().mockResolvedValue({ id: 'rate-1' }),
      },
      dispatch: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        save: vi.fn().mockResolvedValue({ id: 'dsp-1' }),
      },
      activity: {
        createRecordingContext: vi.fn().mockResolvedValue({ id: 'ctx-1' }),
        uploadBatch: uploadBatchSpy,
        saveAttachments: vi.fn().mockResolvedValue({ items: [] }),
        readAttachment: vi.fn(),
        listRecords: vi.fn().mockResolvedValue([]),
        recordDetail: recordDetailSpy,
        reviewRecord: vi.fn().mockResolvedValue({ id: 'rec-1' }),
        driverReviewResults: vi.fn().mockResolvedValue([]),
      },
      expenses: {
        list: vi.fn().mockResolvedValue({ items: [], officeExpenses: [] }),
        create: vi.fn().mockResolvedValue({ id: 'exp-1' }),
        voidExpense: vi.fn().mockResolvedValue({ id: 'exp-1' }),
      },
      earnings: {
        monthlyReport: vi.fn().mockResolvedValue({ month: '2026-11' }),
        exportMonthlyCsv: vi.fn().mockResolvedValue({
          filename: 'fleet-earnings-2026-11.csv',
          csv: 'Month\r\n2026-11\r\n',
        }),
        timeline: vi.fn().mockResolvedValue({ items: [] }),
      },
      reports: {
        preview: vi.fn().mockResolvedValue({
          dataset: 'activities',
          title: 'Driver Activity Ledger',
          totalRows: 1,
          columns: [],
          rows: [],
          kpis: [],
          activeFilters: [],
          truncated: false,
        }),
        exportReport: vi.fn().mockImplementation(
          async (_ctx: AdminContext, q: Record<string, string | undefined>) =>
            q.format === 'xlsx'
              ? {
                  filename: `vhh-fleet-${q.dataset ?? 'earnings'}-2026-11.xlsx`,
                  contentType:
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  buffer: Buffer.from('PK\x03\x04test-xlsx'),
                }
              : {
                  filename: `vhh-fleet-${q.dataset ?? 'earnings'}-2026-11.csv`,
                  contentType: 'text/csv; charset=utf-8',
                  buffer: Buffer.from('\uFEFFMonth\r\n2026-11\r\n'),
                },
        ),
      },
    } as unknown as TransportServices;

    app.register(
      async (admin) => {
        protectAdminScope(admin, auth, rbac);
        admin.register(adminTransportPlugin, { transport });
      },
      { prefix: '/admin' },
    );

    app.register(async (mobile) => {
      mobile.addHook('onRequest', privateResponse);
      mobile.register(mobileTransportPlugin, { auth, transport });
    });

    await app.ready();
    return { app, auth, transport, recordDetailSpy, uploadBatchSpy };
  }

  const adminCookie = { cookie: 'fleet_kratos_session=test-session' };

  it('enforces RBAC and private cache headers on admin earnings and CSV export', async () => {
    const allowed = await buildServer(['admin.access', 'revenue.read']);
    const res = await allowed.app.inject({
      method: 'GET',
      url: '/admin/transport/earnings?month=2026-11',
      headers: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');

    const csvRes = await allowed.app.inject({
      method: 'GET',
      url: '/admin/transport/earnings/export?month=2026-11',
      headers: adminCookie,
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.headers['content-disposition']).toContain(
      'vhh-fleet-earnings-2026-11.csv',
    );

    const xlsxRes = await allowed.app.inject({
      method: 'GET',
      url: '/admin/transport/reports/export?dataset=earnings&format=xlsx&month=2026-11',
      headers: adminCookie,
    });
    expect(xlsxRes.statusCode).toBe(200);
    expect(xlsxRes.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(xlsxRes.headers['content-disposition']).toContain(
      'vhh-fleet-earnings-2026-11.xlsx',
    );
    expect(xlsxRes.headers['x-content-type-options']).toBe('nosniff');

    const previewRes = await allowed.app.inject({
      method: 'GET',
      url: '/admin/transport/reports/preview?dataset=activities',
      headers: adminCookie,
    });
    expect(previewRes.statusCode).toBe(200);
    await allowed.app.close();

    const denied = await buildServer(['admin.access', 'activities.read']);
    const deniedRes = await denied.app.inject({
      method: 'GET',
      url: '/admin/transport/earnings?month=2026-11',
      headers: adminCookie,
    });
    expect(deniedRes.statusCode).toBe(403);
    await denied.app.close();
  });

  it('rejects malformed UUID route params via Fastify Ajv schema before hitting services', async () => {
    const { app, recordDetailSpy } = await buildServer([
      'admin.access',
      'activities.read',
      'activities.review',
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/transport/records/not-a-uuid',
      headers: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect(recordDetailSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows capability-token mobile batch uploads without requiring a Kratos Bearer header', async () => {
    const { app, uploadBatchSpy } = await buildServer(['driver.access']);
    const res = await app.inject({
      method: 'POST',
      url: '/mobile/transport/batches',
      headers: {
        'x-fleet-recording-token': 'a'.repeat(64),
      },
      payload: {
        contextId: '11111111-1111-4111-8111-111111111111',
        events: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(uploadBatchSpy).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
