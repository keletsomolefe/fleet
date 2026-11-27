import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { assertUuid } from '../../../shared/identifiers.js';
import { uuidIdParamsSchema } from '../../../shared/validation.js';
import type { FleetService } from '../application/fleet.service.js';

export interface FleetPluginOptions {
  fleet: FleetService;
}

export const fleetAdminPlugin: FastifyPluginAsync<FleetPluginOptions> = async (
  app,
  { fleet },
) => {
  app.get<{ Querystring: { q?: string; page?: string; status?: string } }>(
    '/trucks',
    { config: { permissions: ['trucks.read'] } },
    async (request) =>
      fleet.listTrucks(
        request.query.q,
        request.query.page,
        request.query.status,
      ),
  );

  app.get<{ Params: { id: string } }>(
    '/trucks/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['trucks.read'] },
    },
    async (request) => fleet.getTruck(request.params.id),
  );

  app.post(
    '/trucks',
    { config: { permissions: ['trucks.read', 'trucks.write'] } },
    async (request, reply) => {
      reply.code(201);
      return fleet.saveTruck(request.body, requireAdmin(request).user);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/trucks/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['trucks.read', 'trucks.write'] },
    },
    async (request) =>
      fleet.saveTruck(
        request.body,
        requireAdmin(request).user,
        request.params.id,
      ),
  );

  app.get<{ Querystring: { q?: string; page?: string; status?: string } }>(
    '/drivers',
    { config: { permissions: ['drivers.read'] } },
    async (request) =>
      fleet.listDrivers(
        request.query.q,
        request.query.page,
        request.query.status,
      ),
  );

  app.get<{ Querystring: { q?: string } }>(
    '/drivers/users',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request) => fleet.candidateUsers(request.query.q),
  );

  app.get<{ Querystring: { q?: string; driverId?: string } }>(
    '/drivers/trucks',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request) => {
      const driverId =
        request.query.driverId === undefined
          ? undefined
          : assertUuid(request.query.driverId);
      return fleet.availableTrucks(request.query.q, driverId);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/drivers/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['drivers.read'] },
    },
    async (request) => fleet.getDriver(request.params.id),
  );

  app.post(
    '/drivers',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request, reply) => {
      reply.code(201);
      const admin = requireAdmin(request);
      return fleet.saveDriver(
        request.body,
        admin.user,
        undefined,
        admin.permissions.includes('users.create'),
      );
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/drivers/:id',
    {
      schema: { params: uuidIdParamsSchema },
      config: { permissions: ['drivers.read', 'drivers.write'] },
    },
    async (request) =>
      fleet.saveDriver(
        request.body,
        requireAdmin(request).user,
        request.params.id,
      ),
  );
};
