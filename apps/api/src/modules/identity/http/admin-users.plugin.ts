import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { BadRequestError } from '../../../shared/errors.js';
import { uuidIdParamsSchema } from '../../../shared/validation.js';
import type { AdminUsersService } from '../application/admin-users.service.js';
import type { AuthService } from '../application/auth.service.js';
import type { RbacService } from '../application/rbac.service.js';

export interface AdminUsersPluginOptions {
  auth: AuthService;
  users: AdminUsersService;
  rbac: RbacService;
}

export const adminUsersPlugin: FastifyPluginAsync<AdminUsersPluginOptions> =
  async (app, { auth, users, rbac }) => {
    app.get('/roles', { config: { permissions: ['users.read'] } }, async () =>
      rbac.catalog(),
    );

    app.post(
      '/users',
      { config: { permissions: ['users.create'] } },
      async (request, reply) => {
        reply.code(201);
        const user = await users.create(request.body, requireAdmin(request).user);
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
      async (request) => users.list(request.query.q, request.query.page),
    );

    app.get<{ Params: { id: string } }>(
      '/users/:id',
      {
        schema: { params: uuidIdParamsSchema },
        config: { permissions: ['users.read'] },
      },
      async (request) => users.get(request.params.id),
    );

    app.post<{ Params: { id: string } }>(
      '/users/:id/account-link',
      {
        schema: { params: uuidIdParamsSchema },
        config: { permissions: ['users.access'] },
      },
      async (request, reply) => {
        reply.code(201);
        const { body } = request;
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length
        ) {
          throw new BadRequestError('Invalid setup-link request.');
        }
        return users.accountLink(requireAdmin(request).user.id, request.params.id);
      },
    );

    app.patch<{ Params: { id: string } }>(
      '/users/:id/access',
      {
        schema: { params: uuidIdParamsSchema },
        config: { permissions: ['users.access'] },
      },
      async (request) =>
        users.setAccess(
          requireAdmin(request).user.id,
          request.params.id,
          request.body,
        ),
    );
  };
