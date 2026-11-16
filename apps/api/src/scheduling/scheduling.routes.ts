import { requireAdmin } from '../auth/admin-session.js';
import type { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { bearer } from '../mobile/mobile.input.js';
import { SchedulingService } from './scheduling.service.js';
import { OperationsEventsService } from '../operations/operations-events.service.js';
const schedulePermissions = [
  'admin.access',
  'drivers.read',
  'drivers.write',
  'trucks.read',
  'trucks.write',
];

export function registerAdminScheduleRoutes(
  app: FastifyInstance,
  schedules: SchedulingService,
) {
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/schedules',
    { config: { permissions: schedulePermissions } },
    async (r) => {
      const { from, to } = r.query;
      return schedules.list(requireAdmin(r), from, to);
    },
  );
  app.post(
    '/schedules',
    { config: { permissions: schedulePermissions } },
    async (r) => {
      const { body } = r;

      return schedules.save(requireAdmin(r), body);
    },
  );
  app.post<{ Params: { id: string } }>(
    '/schedules/:id/cancel',
    { config: { permissions: schedulePermissions } },
    async (r) => {
      const { id } = r.params;
      const { body } = r;

      return schedules.cancel(requireAdmin(r), id, body);
    },
  );
}
export function registerAdminNotificationRoutes(
  app: FastifyInstance,
  events: OperationsEventsService,
) {
  app.get(
    '/notifications',
    { config: { permissions: ['admin.access'] } },
    async (r) => {
      return events.snapshot(requireAdmin(r));
    },
  );
  app.post(
    '/notifications/connection',
    { config: { permissions: ['admin.access'] } },
    async (r) => {
      return events.ticket(requireAdmin(r), { cookie: r.headers.cookie });
    },
  );
}
export function registerMobileScheduleRoutes(
  app: FastifyInstance,
  schedules: SchedulingService,
  events: OperationsEventsService,
  auth: AuthService,
) {
  app.post('/mobile/driver/schedule-mismatch', async (r) => {
    const { body } = r;
    return schedules.mismatch(await auth.authenticateNative(bearer(r)), body);
  });
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/mobile/admin/schedules',
    async (r) => {
      const { from, to } = r.query;
      return schedules.list(await auth.authenticateNative(bearer(r)), from, to);
    },
  );
  app.get<{ Querystring: { q?: string } }>(
    '/mobile/admin/schedules/options',
    async (r) => {
      const { q } = r.query;
      return schedules.options(await auth.authenticateNative(bearer(r)), q);
    },
  );
  app.post<{ Params: { id: string } }>(
    '/mobile/admin/schedules/:id/cancel',
    async (r) => {
      const { id } = r.params;
      const { body } = r;
      return schedules.cancel(
        await auth.authenticateNative(bearer(r)),
        id,
        body,
      );
    },
  );
  app.post('/mobile/admin/schedules', async (r) => {
    const { body } = r;
    return schedules.save(await auth.authenticateNative(bearer(r)), body);
  });
  app.get('/mobile/admin/notifications', async (r) => {
    return events.snapshot(await auth.authenticateNative(bearer(r)));
  });
  app.post('/mobile/admin/notifications/connection', async (r) => {
    const native = bearer(r);
    return events.ticket(await auth.authenticateNative(native), {
      native,
    });
  });
}
