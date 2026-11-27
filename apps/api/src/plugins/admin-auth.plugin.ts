import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AdminContext,
  AuthService,
} from '../modules/identity/application/auth.service.js';
import type { RbacService } from '../modules/identity/application/rbac.service.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors.js';
import { header, privateResponse } from '../shared/http.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminContext: AdminContext | null;
  }

  interface FastifyContextConfig {
    permissions?: readonly string[];
  }
}

const sessionCookie = 'fleet_kratos_session';

export function adminSessionHook(auth: AuthService) {
  return async (request: FastifyRequest) => {
    if (!request.cookies[sessionCookie]) {
      throw new UnauthorizedError('Please sign in.');
    }
    request.adminContext = await auth.authenticate(header(request, 'cookie'));
  };
}

export function requireAdmin(request: FastifyRequest): AdminContext {
  if (!request.adminContext) throw new ForbiddenError('Access denied.');
  return request.adminContext;
}

/**
 * Registers authentication, RBAC permission checks, and CSRF verification on
 * an encapsulated Fastify admin scope (`/admin`).
 */
export function protectAdminScope(
  app: FastifyInstance,
  auth: AuthService,
  rbac: RbacService,
) {
  app.addHook('onRequest', privateResponse);
  app.addHook('onRequest', adminSessionHook(auth));
  app.addHook('preHandler', async (request) => {
    // The administrator scope authenticates unknown routes before returning 404.
    if (request.is404) return;
    const permissions = request.routeOptions.config.permissions;
    if (!permissions?.length) throw new ForbiddenError('Access denied.');
    rbac.require(requireAdmin(request), ...permissions);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      auth.verifyCsrf(request);
    }
  });
}
