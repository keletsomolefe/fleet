import type { FastifyPluginAsync } from 'fastify';
import {
  assertNativeRequest,
  extractBearerToken,
  mobileSessionHook,
  requireMobile,
} from '../../../plugins/mobile-auth.plugin.js';
import { GoneError } from '../../../shared/errors.js';
import type { AuthService } from '../../identity/application/auth.service.js';
import type { MobileAuthService } from '../application/mobile-auth.service.js';

export interface MobileAuthPluginOptions {
  auth: AuthService;
  mobileAuth: MobileAuthService;
}

const retiredDevicePaths = [
  '/mobile/device',
  '/mobile/setup/trucks',
  '/mobile/setup/device',
  '/mobile/driver/truck',
  '/mobile/driver/truck/confirm',
] as const;

export const mobileAuthPlugin: FastifyPluginAsync<MobileAuthPluginOptions> =
  async (app, { auth, mobileAuth }) => {
    app.post('/mobile/auth/login', async (request) => {
      assertNativeRequest(request);
      return mobileAuth.login(request.body, request.ip);
    });

    app.delete('/mobile/auth/session', async (request, reply) => {
      await mobileAuth.logout(extractBearerToken(request));
      return reply.code(204).send();
    });

    app.get(
      '/mobile/auth/session',
      { preHandler: mobileSessionHook(auth) },
      async (request) => {
        const context = requireMobile(request);
        return {
          user: auth.profile(context.user),
          mode: await mobileAuth.resolveMode(context),
          permissions: context.permissions,
          expiresAt: context.session.expires_at ?? null,
        };
      },
    );

    for (const path of retiredDevicePaths) {
      app.all(path, { exposeHeadRoute: false }, async (request) => {
        assertNativeRequest(request);
        throw new GoneError('Update Fleet to choose a vehicle on your phone.');
      });
    }
  };
