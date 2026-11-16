import { requireAdmin } from '../auth/admin-session.js';
import type { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { bearer } from './mobile.input.js';
import { DrivingService } from './driving.service.js';
export function registerMobileDrivingRoutes(
  app: FastifyInstance,
  auth: AuthService,
  driving: DrivingService,
) {
  app.get('/mobile/driver/context', async (req) => {
    return driving.context(await auth.authenticateNative(bearer(req)));
  });
  app.get<{ Querystring: { q?: string; page?: string } }>(
    '/mobile/driver/vehicles',
    async (req) => {
      const { q, page } = req.query;
      return driving.vehicles(
        await auth.authenticateNative(bearer(req)),
        q,
        page,
      );
    },
  );
  app.post('/mobile/driver/driving-sessions', async (req) => {
    const { body } = req;
    return driving.start(await auth.authenticateNative(bearer(req)), body);
  });
  app.post('/mobile/driver/driving-sessions/end', async (req) => {
    const { body } = req;
    return driving.end(await auth.authenticateNative(bearer(req)), body);
  });
  app.post<{ Params: { id: string } }>(
    '/mobile/driver/vehicles/:id/flag',
    async (req) => {
      const { id } = req.params;
      const { body } = req;
      return driving.flag(await auth.authenticateNative(bearer(req)), id, body);
    },
  );
  app.get('/mobile/driver/vehicle-disputes', async (req) => {
    return driving.disputes(await auth.authenticateNative(bearer(req)), true);
  });
  app.get('/mobile/admin/vehicle-disputes', async (req) => {
    return driving.disputes(await auth.authenticateNative(bearer(req)));
  });
  app.post<{ Params: { id: string } }>(
    '/mobile/admin/vehicle-disputes/:id/resolve',
    async (req) => {
      const { id } = req.params;
      const { body } = req;
      return driving.resolve(
        await auth.authenticateNative(bearer(req)),
        id,
        body,
      );
    },
  );
}
export function registerAdminVehicleDisputeRoutes(
  app: FastifyInstance,
  driving: DrivingService,
) {
  app.get(
    '/vehicle-disputes',
    {
      config: { permissions: ['admin.access', 'trucks.read', 'trucks.write'] },
    },
    async (req) => {
      return driving.disputes(requireAdmin(req));
    },
  );
  app.post<{ Params: { id: string } }>(
    '/vehicle-disputes/:id/resolve',
    {
      config: { permissions: ['admin.access', 'trucks.read', 'trucks.write'] },
    },
    async (req) => {
      const { id } = req.params;
      const { body } = req;

      return driving.resolve(requireAdmin(req), id, body);
    },
  );
}
