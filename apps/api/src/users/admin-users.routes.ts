import { requireAdmin } from '../auth/admin-session.js';
import { uuidParam } from '../http/request.js';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/auth.service.js';
import { BadRequestError } from '../http/errors.js';
import { AdminUsersService } from './admin-users.service.js';
export function registerAdminUserRoutes(
  app: FastifyInstance,
  auth: AuthService,
  users: AdminUsersService,
) {
  app.post(
    '/users',
    { config: { permissions: ['users.create'] } },
    async (request, reply) => {
      reply.code(201);
      const { body: input } = request;

      const user = await users.create(input, requireAdmin(request).user);
      return {
        user: auth.profile(user),
        requiresEmailVerification:
          process.env.AUTH_REQUIRE_VERIFIED_EMAIL !== 'false',
      };
    },
  );
  app.get<{ Querystring: { q?: string; page?: string } }>(
    '/users',
    { config: { permissions: ['users.read'] } },
    async (request) => {
      const { q: query, page } = request.query;
      return users.list(query, page);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/users/:id',
    { config: { permissions: ['users.read'] } },
    async (request) => {
      const id = uuidParam(request.params.id);
      return users.get(id);
    },
  );
  app.post<{ Params: { id: string } }>(
    '/users/:id/account-link',
    { config: { permissions: ['users.access'] } },
    async (request, reply) => {
      reply.code(201);
      const id = uuidParam(request.params.id);
      const { body } = request;

      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length
      )
        throw new BadRequestError('Invalid setup-link request.');
      return users.accountLink(requireAdmin(request).user.id, id);
    },
  );
  app.patch<{ Params: { id: string } }>(
    '/users/:id/access',
    { config: { permissions: ['users.access'] } },
    async (request) => {
      const id = uuidParam(request.params.id);
      const { body: input } = request;

      return users.setAccess(requireAdmin(request).user.id, id, input);
    },
  );
}
