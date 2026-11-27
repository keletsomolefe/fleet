import type { FastifyPluginAsync } from 'fastify';
import {
  assertNativeRequest,
  mobileSessionHook,
  requireMobile,
} from '../../../plugins/mobile-auth.plugin.js';
import { header } from '../../../shared/http.js';
import type { AuthService } from '../../identity/application/auth.service.js';
import type { TelemetryService } from '../application/telemetry.service.js';

export interface MobileTelemetryPluginOptions {
  auth: AuthService;
  telemetry: TelemetryService;
}

export const mobileTelemetryPlugin: FastifyPluginAsync<
  MobileTelemetryPluginOptions
> = async (app, { auth, telemetry }) => {
  app.get('/mobile/telemetry/config', async (request) => {
    assertNativeRequest(request);
    return telemetry.config(header(request, 'x-fleet-device-token') ?? '');
  });

  app.post(
    '/mobile/telemetry/streams',
    { preHandler: mobileSessionHook(auth) },
    async (request) => telemetry.start(requireMobile(request), request.body),
  );

  app.post('/mobile/telemetry/batches', async (request) => {
    assertNativeRequest(request);
    return telemetry.ingest(
      header(request, 'x-fleet-device-token') ?? '',
      request.body,
    );
  });
};

export interface AdminTelemetryPluginOptions {
  telemetry: TelemetryService;
}

export const adminTelemetryPlugin: FastifyPluginAsync<
  AdminTelemetryPluginOptions
> = async (app, { telemetry }) => {
  app.get(
    '/telemetry/latest',
    { config: { permissions: ['fleet_map.read'] } },
    async () => telemetry.latest(),
  );

  app.get<{ Params: { id: string } }>(
    '/telemetry/trucks/:id/streams',
    { config: { permissions: ['fleet_map.read'] } },
    async (request) => telemetry.streams(request.params.id),
  );

  app.get<{ Params: { id: string } }>(
    '/telemetry/streams/:id/integrity',
    { config: { permissions: ['fleet_map.read'] } },
    async (request) => telemetry.integrity(request.params.id),
  );

  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; cursor?: string };
  }>(
    '/telemetry/trucks/:id/history',
    { config: { permissions: ['fleet_map.read'] } },
    async (request) =>
      telemetry.history(
        request.params.id,
        request.query.from,
        request.query.to,
        request.query.cursor,
      ),
  );
};
