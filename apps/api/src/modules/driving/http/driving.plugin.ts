import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { requireMobile } from '../../../plugins/mobile-auth.plugin.js';
import { uuidIdParamsSchema } from '../../../shared/validation.js';
import type { DrivingService } from '../application/driving.service.js';

export interface DrivingPluginOptions {
  driving: DrivingService;
}

export const mobileDrivingPlugin: FastifyPluginAsync<DrivingPluginOptions> =
  async (app, { driving }) => {
    app.get('/mobile/driver/context', async (request) =>
      driving.context(requireMobile(request)),
    );

    app.get<{ Querystring: { q?: string; page?: string } }>(
      '/mobile/driver/vehicles',
      async (request) =>
        driving.vehicles(
          requireMobile(request),
          request.query.q,
          request.query.page,
        ),
    );

    app.post('/mobile/driver/driving-sessions', async (request) =>
      driving.start(requireMobile(request), request.body),
    );

    app.post('/mobile/driver/driving-sessions/end', async (request) =>
      driving.end(requireMobile(request), request.body),
    );

    app.post<{ Params: { id: string } }>(
      '/mobile/driver/vehicles/:id/flag',
      async (request) =>
        driving.flag(requireMobile(request), request.params.id, request.body),
    );

    app.get('/mobile/driver/vehicle-disputes', async (request) =>
      driving.disputes(requireMobile(request), true),
    );

    app.get('/mobile/admin/vehicle-disputes', async (request) =>
      driving.disputes(requireMobile(request)),
    );

    app.post<{ Params: { id: string } }>(
      '/mobile/admin/vehicle-disputes/:id/resolve',
      async (request) =>
        driving.resolve(
          requireMobile(request),
          request.params.id,
          request.body,
        ),
    );
  };

export const adminVehicleDisputesPlugin: FastifyPluginAsync<
  DrivingPluginOptions
> = async (app, { driving }) => {
  app.get(
    '/vehicle-disputes',
    {
      config: { permissions: ['admin.access', 'trucks.read', 'trucks.write'] },
    },
    async (request) => driving.disputes(requireAdmin(request)),
  );

  app.post<{ Params: { id: string } }>(
    '/vehicle-disputes/:id/resolve',
    {
      config: { permissions: ['admin.access', 'trucks.read', 'trucks.write'] },
    },
    async (request) =>
      driving.resolve(requireAdmin(request), request.params.id, request.body),
  );
};

export const adminShiftsPlugin: FastifyPluginAsync<DrivingPluginOptions> =
  async (app, { driving }) => {
    app.get<{ Querystring: Record<string, string | undefined> }>(
      '/shifts',
      {
        config: { permissions: ['admin.access', 'shifts.read'] },
      },
      async (request) => driving.shifts(requireAdmin(request), request.query),
    );

    app.post<{ Params: { id: string } }>(
      '/shifts/:id/review',
      {
        schema: { params: uuidIdParamsSchema },
        config: {
          permissions: ['admin.access', 'shifts.read', 'activities.review'],
        },
      },
      async (request) =>
        driving.reviewShift(
          requireAdmin(request),
          request.params.id,
          request.body,
        ),
    );
  };
