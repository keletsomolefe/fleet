import { header } from '../http/request.js';
import type { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { bearer, nativeRequest } from '../mobile/mobile.input.js';
import { TelemetryService } from './telemetry.service.js';
export function registerMobileTelemetryRoutes(
  app: FastifyInstance,
  auth: AuthService,
  telemetry: TelemetryService,
) {
  app.get('/mobile/telemetry/config', async (req) => {
    nativeRequest(req);
    return telemetry.config(header(req, 'x-fleet-device-token') ?? '');
  });
  app.post('/mobile/telemetry/streams', async (req) => {
    const { body } = req;
    const c = await auth.authenticateNative(bearer(req));
    return telemetry.start(c, body);
  });
  app.post('/mobile/telemetry/batches', async (req) => {
    const { body } = req;
    nativeRequest(req);
    return telemetry.ingest(header(req, 'x-fleet-device-token') ?? '', body);
  });
}
export function registerAdminTelemetryRoutes(
  app: FastifyInstance,
  telemetry: TelemetryService,
) {
  app.get(
    '/telemetry/latest',
    { config: { permissions: ['fleet_map.read'] } },
    async () => {
      return telemetry.latest();
    },
  );
  app.get<{ Params: { id: string } }>(
    '/telemetry/trucks/:id/streams',
    { config: { permissions: ['fleet_map.read'] } },
    async (request) => {
      const { id } = request.params;
      return telemetry.streams(id);
    },
  );
  app.get<{ Params: { id: string } }>(
    '/telemetry/streams/:id/integrity',
    { config: { permissions: ['fleet_map.read'] } },
    async (request) => {
      const { id } = request.params;
      return telemetry.integrity(id);
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; cursor?: string };
  }>(
    '/telemetry/trucks/:id/history',
    { config: { permissions: ['fleet_map.read'] } },
    async (request) => {
      const { id } = request.params;
      const { from, to, cursor } = request.query;
      return telemetry.history(id, from, to, cursor);
    },
  );
}
