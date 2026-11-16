import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../http/errors.js';
import { header, privateResponse } from '../http/request.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { AdminContext, AuthService } from './auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminContext: AdminContext | null;
  }

  interface FastifyContextConfig {
    permissions?: readonly string[];
  }
}

// This name is set by both the development and deployment Kratos configs.
const sessionCookie = 'fleet_kratos_session';

export function adminSession(auth: AuthService) {
  return async (request: FastifyRequest) => {
    if (!request.cookies[sessionCookie])
      throw new UnauthorizedError('Please sign in.');
    request.adminContext = await auth.authenticate(header(request, 'cookie'));
  };
}

export function requireAdmin(request: FastifyRequest): AdminContext {
  if (!request.adminContext) throw new ForbiddenError('Access denied.');
  return request.adminContext;
}

export function protectAdminRoutes(
  app: FastifyInstance,
  auth: AuthService,
  rbac: RbacService,
) {
  app.addHook('onRequest', privateResponse);
  app.addHook('onRequest', adminSession(auth));
  app.addHook('preHandler', async (request) => {
    // The administrator scope authenticates unknown routes before returning 404.
    if (request.is404) return;
    const permissions = request.routeOptions.config.permissions;
    if (!permissions?.length) throw new ForbiddenError('Access denied.');
    rbac.require(requireAdmin(request), ...permissions);
    if (request.method !== 'GET' && request.method !== 'HEAD')
      auth.verifyCsrf(request);
  });
}
