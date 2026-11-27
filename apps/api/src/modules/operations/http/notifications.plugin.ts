import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { requireMobile } from '../../../plugins/mobile-auth.plugin.js';
import type { OperationsEventsService } from '../application/operations-events.service.js';

export interface NotificationsPluginOptions {
  events: OperationsEventsService;
}

export const adminNotificationsPlugin: FastifyPluginAsync<
  NotificationsPluginOptions
> = async (app, { events }) => {
  app.get(
    '/notifications',
    { config: { permissions: ['admin.access'] } },
    async (request) => events.snapshot(requireAdmin(request)),
  );

  app.post(
    '/notifications/connection',
    { config: { permissions: ['admin.access'] } },
    async (request) =>
      events.ticket(requireAdmin(request), { cookie: request.headers.cookie }),
  );
};

export const mobileNotificationsPlugin: FastifyPluginAsync<
  NotificationsPluginOptions
> = async (app, { events }) => {
  app.get('/mobile/admin/notifications', async (request) =>
    events.snapshot(requireMobile(request)),
  );

  app.post('/mobile/admin/notifications/connection', async (request) =>
    events.ticket(requireMobile(request), {
      native: request.mobileToken ?? undefined,
    }),
  );
};
