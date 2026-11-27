import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import {
  mobileSessionHook,
  requireMobile,
} from '../../../plugins/mobile-auth.plugin.js';
import {
  header,
  readPhotoUpload,
  sendPrivatePhoto,
} from '../../../shared/http.js';
import { uuidIdParamsSchema } from '../../../shared/validation.js';
import type { AuthService } from '../../identity/application/auth.service.js';
import type { ActivityService } from '../application/activity.service.js';
import type { CatalogueService } from '../application/catalogue.service.js';
import type { DispatchService } from '../application/dispatch.service.js';
import type { EarningsService } from '../application/earnings.service.js';
import type { ExpensesService } from '../application/expenses.service.js';
import type { PricingService } from '../application/pricing.service.js';
import type { ReportsService } from '../application/reports.service.js';

export interface TransportServices {
  catalogue: CatalogueService;
  pricing: PricingService;
  dispatch: DispatchService;
  activity: ActivityService;
  expenses: ExpensesService;
  earnings: EarningsService;
  reports: ReportsService;
}

export const adminTransportPlugin: FastifyPluginAsync<{
  transport: TransportServices;
}> = async (app, { transport }) => {
  await app.register(multipart);

  // Catalogue (Customers, Locations, Products, Customer-Products)
  app.get(
    '/transport/catalogue',
    { config: { permissions: ['admin.access'] } },
    async (request) => transport.catalogue.catalogue(requireAdmin(request)),
  );

  app.post<{ Params: { kind: string } }>(
    '/transport/master/:kind',
    { config: { permissions: ['admin.access'] } },
    async (request) =>
      transport.catalogue.saveMaster(
        requireAdmin(request),
        request.params.kind,
        request.body,
      ),
  );

  app.patch<{ Params: { kind: string; id: string } }>(
    '/transport/master/:kind/:id',
    {
      config: { permissions: ['admin.access'] },
      schema: {
        params: {
          type: 'object',
          required: ['kind', 'id'],
          properties: {
            kind: { type: 'string' },
            id: uuidIdParamsSchema.properties.id,
          },
        },
      },
    },
    async (request) =>
      transport.catalogue.saveMaster(
        requireAdmin(request),
        request.params.kind,
        request.body,
        request.params.id,
      ),
  );

  // Transport rates
  app.get(
    '/transport/rates',
    { config: { permissions: ['admin.access', 'pricing.read'] } },
    async (request) => transport.pricing.listRates(requireAdmin(request)),
  );

  app.post(
    '/transport/rates',
    { config: { permissions: ['admin.access', 'pricing.write'] } },
    async (request) =>
      transport.pricing.createRate(requireAdmin(request), request.body),
  );

  app.patch<{ Params: { id: string } }>(
    '/transport/rates/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['admin.access', 'pricing.write'] },
    },
    async (request) =>
      transport.pricing.endRate(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );

  // Dispatches
  app.get(
    '/transport/dispatches',
    { config: { permissions: ['admin.access', 'dispatch.read'] } },
    async (request) => transport.dispatch.list(requireAdmin(request)),
  );

  app.post(
    '/transport/dispatches',
    { config: { permissions: ['admin.access', 'dispatch.write'] } },
    async (request) =>
      transport.dispatch.save(requireAdmin(request), request.body),
  );

  app.patch<{ Params: { id: string } }>(
    '/transport/dispatches/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['admin.access', 'dispatch.write'] },
    },
    async (request) =>
      transport.dispatch.save(
        requireAdmin(request),
        request.body,
        request.params.id,
      ),
  );

  // Driver activity records & review workbench
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/transport/records',
    { config: { permissions: ['admin.access', 'activities.read'] } },
    async (request) =>
      transport.activity.listRecords(requireAdmin(request), request.query),
  );

  app.get<{ Params: { id: string } }>(
    '/transport/records/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['admin.access', 'activities.read'] },
    },
    async (request) =>
      transport.activity.recordDetail(requireAdmin(request), request.params.id),
  );

  app.post<{ Params: { id: string } }>(
    '/transport/records/:id/review',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['admin.access', 'activities.review'] },
    },
    async (request) =>
      transport.activity.reviewRecord(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );

  // End-to-end chronological driver journey timeline
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/transport/timeline',
    { config: { permissions: ['admin.access', 'activities.read'] } },
    async (request) =>
      transport.earnings.timeline(requireAdmin(request), request.query),
  );

  // Unified vehicle expenses + office invoice entry
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/transport/expenses',
    { config: { permissions: ['admin.access', 'expenses.read'] } },
    async (request) =>
      transport.expenses.list(requireAdmin(request), request.query),
  );

  app.post(
    '/transport/expenses',
    { config: { permissions: ['admin.access', 'expenses.write'] } },
    async (request) =>
      transport.expenses.create(requireAdmin(request), request.body),
  );

  app.post<{ Params: { id: string } }>(
    '/transport/expenses/:id/void',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['admin.access', 'expenses.write'] },
    },
    async (request) =>
      transport.expenses.voidExpense(
        requireAdmin(request),
        request.params.id,
        request.body,
      ),
  );

  // Proof & receipt attachments (POD, weighbridge, fuel, expense, odometer)
  app.post<{ Params: { ownerType: string; id: string } }>(
    '/transport/attachments/:ownerType/:id',
    {
      config: { permissions: ['admin.access'] },
      schema: {
        params: {
          type: 'object',
          required: ['ownerType', 'id'],
          properties: {
            ownerType: { type: 'string', enum: ['record', 'expense', 'shift'] },
            id: uuidIdParamsSchema.properties.id,
          },
        },
      },
    },
    async (request) => {
      const { body, files } = await readPhotoUpload(request, {
        maxFields: 4,
        maxParts: 8,
        invalidMessage: 'Upload valid JPG, PNG or WebP photos.',
      });
      const kind =
        body && typeof body === 'object' && 'kind' in body
          ? (body as { kind?: unknown }).kind
          : undefined;
      return transport.activity.saveAttachments(
        request.params.ownerType as 'record' | 'expense' | 'shift',
        request.params.id,
        files,
        kind,
        { mode: 'admin', context: requireAdmin(request) },
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    '/transport/attachments/:id',
    {
      config: { permissions: ['admin.access'] },
      schema: { params: uuidIdParamsSchema },
    },
    async (request, reply) => {
      const photo = await transport.activity.readAttachment(
        requireAdmin(request),
        request.params.id,
      );
      return sendPrivatePhoto(reply, photo);
    },
  );

  // Month-end Truck Earnings & P&L Report + CSV Export
  app.get<{ Querystring: { month?: string; truckId?: string } }>(
    '/transport/earnings',
    { config: { permissions: ['admin.access', 'revenue.read'] } },
    async (request) =>
      transport.earnings.monthlyReport(
        requireAdmin(request),
        request.query.month ?? '',
        request.query.truckId,
      ),
  );

  app.get<{ Querystring: { month?: string; truckId?: string; format?: string } }>(
    '/transport/earnings/export',
    { config: { permissions: ['admin.access', 'revenue.read'] } },
    async (request, reply) => {
      const format = request.query.format === 'xlsx' ? 'xlsx' : 'csv';
      const { filename, contentType, buffer } =
        await transport.reports.exportReport(requireAdmin(request), {
          dataset: 'earnings',
          format,
          month: request.query.month,
          truckId: request.query.truckId,
        });
      return reply
        .headers({
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(buffer);
    },
  );

  // Filter-based Report Preview & Excel (.xlsx) / CSV (.csv) Exports across all datasets
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/transport/reports/preview',
    { config: { permissions: ['admin.access'] } },
    async (request) =>
      transport.reports.preview(requireAdmin(request), request.query),
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/transport/reports/export',
    { config: { permissions: ['admin.access'] } },
    async (request, reply) => {
      const { filename, contentType, buffer } =
        await transport.reports.exportReport(
          requireAdmin(request),
          request.query,
        );
      return reply
        .headers({
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(buffer);
    },
  );
};

export const mobileTransportPlugin: FastifyPluginAsync<{
  auth: AuthService;
  transport: TransportServices;
}> = async (app, { auth, transport }) => {
  await app.register(multipart);

  // Offline capability-token endpoints (work even after Kratos session expires during multi-day trips)
  app.post('/mobile/transport/batches', async (request) =>
    transport.activity.uploadBatch(
      request.body,
      header(request, 'x-fleet-recording-token'),
    ),
  );

  app.post<{ Params: { id: string } }>(
    '/mobile/transport/records/:id/attachments',
    { schema: { params: uuidIdParamsSchema } },
    async (request) => {
      const { body, files } = await readPhotoUpload(request, {
        maxFields: 6,
        maxParts: 10,
        invalidMessage: 'Upload valid JPG, PNG or WebP photos.',
      });
      const fields =
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {};
      const tokenHeader = header(request, 'x-fleet-recording-token');
      const contextId =
        header(request, 'x-fleet-recording-context') ?? fields.contextId;
      return transport.activity.saveAttachments(
        'record',
        request.params.id,
        files,
        fields.kind,
        { mode: 'recording', contextId, tokenHeader },
      );
    },
  );

  // Authenticated mobile driver endpoints
  app.register(async (authenticated) => {
    authenticated.addHook('preHandler', mobileSessionHook(auth));

    authenticated.get('/mobile/transport/catalogue', async (request) =>
      transport.catalogue.catalogue(requireMobile(request), true),
    );

    authenticated.get('/mobile/transport/dispatches', async (request) =>
      transport.dispatch.list(requireMobile(request), true),
    );

    authenticated.post('/mobile/transport/contexts', async (request) =>
      transport.activity.createRecordingContext(
        requireMobile(request),
        request.body,
      ),
    );

    authenticated.get<{ Querystring: { ids?: string } }>(
      '/mobile/transport/reviews',
      async (request) =>
        transport.activity.driverReviewResults(
          requireMobile(request),
          request.query.ids ?? '',
        ),
    );

    authenticated.post<{ Params: { id: string } }>(
      '/mobile/transport/shifts/:id/attachments',
      { schema: { params: uuidIdParamsSchema } },
      async (request) => {
        const { body, files } = await readPhotoUpload(request, {
          maxFields: 4,
          maxParts: 8,
          invalidMessage: 'Upload valid JPG, PNG or WebP photos.',
        });
        const kind =
          body && typeof body === 'object' && 'kind' in body
            ? (body as { kind?: unknown }).kind
            : undefined;
        return transport.activity.saveAttachments(
          'shift',
          request.params.id,
          files,
          kind,
          { mode: 'mobile', context: requireMobile(request) },
        );
      },
    );
  });
};
