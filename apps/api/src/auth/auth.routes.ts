import type { FastifyInstance } from 'fastify';
import { privateResponse } from '../http/request.js';
import { adminSession, requireAdmin } from './admin-session.js';
import type { AuthService } from './auth.service.js';

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  app.get('/auth/config', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const publicUrl = new URL(process.env.KRATOS_PUBLIC_URL!);
    const recoveryUrl = new URL('recovery', process.env.KRATOS_UI_URL);
    // Both loopback names are supported in development; cookies must stay on the app's host.
    const loopback = new Set(['localhost', '127.0.0.1']);
    if (
      process.env.NODE_ENV !== 'production' &&
      loopback.has(request.hostname)
    ) {
      if (loopback.has(publicUrl.hostname))
        publicUrl.hostname = request.hostname;
      if (loopback.has(recoveryUrl.hostname))
        recoveryUrl.hostname = request.hostname;
    }
    return {
      kratosPublicUrl: publicUrl.toString(),
      recoveryUrl: recoveryUrl.toString(),
    };
  });

  app.get(
    '/auth/session',
    { onRequest: [privateResponse, adminSession(auth)] },
    async (request) => {
      const context = requireAdmin(request);
      return {
        user: auth.profile(context.user),
        roles: context.roles,
        permissions: context.permissions,
        csrfToken: auth.csrfToken(context),
      };
    },
  );
}
