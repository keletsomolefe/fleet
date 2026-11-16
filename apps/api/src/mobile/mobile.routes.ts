import type { FastifyInstance } from 'fastify';
import { GoneError } from '../http/errors.js';
import { AuthService } from '../auth/auth.service.js';
import { MobileAuthService } from './mobile-auth.service.js';
import { bearer, nativeRequest } from './mobile.input.js';
export function registerMobileAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  mobileAuth: MobileAuthService,
) {
  app.post('/mobile/auth/login', async (req) => {
    const { body } = req;
    nativeRequest(req);
    return mobileAuth.login(body, req.ip);
  });
  app.delete('/mobile/auth/session', async (req, reply) => {
    await mobileAuth.logout(bearer(req));
    return reply.code(204).send();
  });
  app.get('/mobile/auth/session', async (req) => {
    const c = await auth.authenticateNative(bearer(req));
    return {
      user: auth.profile(c.user),
      mode: await mobileAuth.resolveMode(c),
      permissions: c.permissions,
      expiresAt: c.session.expires_at ?? null,
    };
  });
  for (const path of [
    '/mobile/device',
    '/mobile/setup/trucks',
    '/mobile/setup/device',
    '/mobile/driver/truck',
    '/mobile/driver/truck/confirm',
  ]) {
    app.all(path, { exposeHeadRoute: false }, async (req) => {
      nativeRequest(req);
      throw new GoneError('Update Fleet to choose a vehicle on your phone.');
    });
  }
}
