import { requireAdmin } from '../auth/admin-session.js';
import { uuidParam } from '../http/request.js';
import type { FastifyInstance } from 'fastify';
import { FleetService } from './fleet.service.js';
export function registerTruckRoutes(app: FastifyInstance, fleet: FleetService) {
  app.get<{ Querystring: { q?: string; page?: string; status?: string } }>(
    '/trucks',
    { config: { permissions: ['trucks.read'] } },
    async (request) => {
      const { q, page, status } = request.query;
      return fleet.listTrucks(q, page, status);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/trucks/:id',
    { config: { permissions: ['trucks.read'] } },
    async (request) => {
      const id = uuidParam(request.params.id);
      return fleet.getTruck(id);
    },
  );
  app.post(
    '/trucks',
    { config: { permissions: ['trucks.read', 'trucks.write'] } },
    async (request, reply) => {
      reply.code(201);
      const { body: input } = request;

      return fleet.saveTruck(input, requireAdmin(request).user);
    },
  );
  app.patch<{ Params: { id: string } }>(
    '/trucks/:id',
    { config: { permissions: ['trucks.read', 'trucks.write'] } },
    async (request) => {
      const id = uuidParam(request.params.id);
      const { body: input } = request;

      return fleet.saveTruck(input, requireAdmin(request).user, id);
    },
  );
}
export function registerDriverRoutes(
  app: FastifyInstance,
  fleet: FleetService,
) {
  app.get<{ Querystring: { q?: string; page?: string; status?: string } }>(
    '/drivers',
    { config: { permissions: ['drivers.read'] } },
    async (request) => {
      const { q, page, status } = request.query;
      return fleet.listDrivers(q, page, status);
    },
  );
  app.get<{ Querystring: { q?: string } }>(
    '/drivers/users',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request) => {
      const { q } = request.query;
      return fleet.candidateUsers(q);
    },
  );
  app.get<{ Querystring: { q?: string; driverId?: string } }>(
    '/drivers/trucks',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request) => {
      const { q } = request.query;
      const driverId =
        request.query.driverId === undefined
          ? undefined
          : uuidParam(request.query.driverId);
      return fleet.availableTrucks(q, driverId);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/drivers/:id',
    { config: { permissions: ['drivers.read'] } },
    async (request) => {
      const id = uuidParam(request.params.id);
      return fleet.getDriver(id);
    },
  );
  app.post(
    '/drivers',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request, reply) => {
      reply.code(201);
      const { body: input } = request;

      return fleet.saveDriver(
        input,
        requireAdmin(request).user,
        undefined,
        requireAdmin(request).permissions.includes('users.create'),
      );
    },
  );
  app.patch<{ Params: { id: string } }>(
    '/drivers/:id',
    { config: { permissions: ['drivers.read', 'drivers.write'] } },
    async (request) => {
      const id = uuidParam(request.params.id);
      const { body: input } = request;

      return fleet.saveDriver(input, requireAdmin(request).user, id);
    },
  );
}
