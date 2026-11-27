import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { requireMobile } from '../../../plugins/mobile-auth.plugin.js';
import type { SchedulingService } from '../application/scheduling.service.js';

const schedulePermissions = [
  'admin.access',
  'drivers.read',
  'drivers.write',
  'trucks.read',
  'trucks.write',
] as const;

export interface SchedulingPluginOptions {
  schedules: SchedulingService;
}

export const adminSchedulingPlugin: FastifyPluginAsync<
  SchedulingPluginOptions
> = async (app, { schedules }) => {
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/schedules',
    { config: { permissions: schedulePermissions } },
    async (request) =>
      schedules.list(requireAdmin(request), request.query.from, request.query.to),
  );

  app.post(
    '/schedules',
    { config: { permissions: schedulePermissions } },
    async (request) => schedules.save(requireAdmin(request), request.body),
  );

  app.post<{ Params: { id: string } }>(
    '/schedules/:id/cancel',
    { config: { permissions: schedulePermissions } },
    async (request) =>
      schedules.cancel(requireAdmin(request), request.params.id, request.body),
  );
};

export const mobileSchedulingPlugin: FastifyPluginAsync<
  SchedulingPluginOptions
> = async (app, { schedules }) => {
  app.post('/mobile/driver/schedule-mismatch', async (request) =>
    schedules.mismatch(requireMobile(request), request.body),
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/mobile/admin/schedules',
    async (request) =>
      schedules.list(requireMobile(request), request.query.from, request.query.to),
  );

  app.get<{ Querystring: { q?: string } }>(
    '/mobile/admin/schedules/options',
    async (request) => schedules.options(requireMobile(request), request.query.q),
  );

  app.post<{ Params: { id: string } }>(
    '/mobile/admin/schedules/:id/cancel',
    async (request) =>
      schedules.cancel(requireMobile(request), request.params.id, request.body),
  );

  app.post('/mobile/admin/schedules', async (request) =>
    schedules.save(requireMobile(request), request.body),
  );
};
