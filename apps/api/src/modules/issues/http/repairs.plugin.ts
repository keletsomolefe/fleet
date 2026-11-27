import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { readPhotoUpload } from '../../../shared/http.js';
import type { RepairsService } from '../application/repairs.service.js';

const resolvePermissions = [
  'admin.access',
  'issues.read',
  'issues.resolve',
] as const;

export interface RepairsPluginOptions {
  repairs: RepairsService;
}

export const adminRepairsPlugin: FastifyPluginAsync<RepairsPluginOptions> =
  async (app, { repairs }) => {
    app.register(multipart);

    app.post<{ Params: { id: string } }>(
      '/issues/:id/repair/resolve',
      { config: { permissions: resolvePermissions } },
      async (request) => {
        const { body, files } = await readPhotoUpload(request, {
          maxFields: 1,
          maxParts: 5,
          invalidMessage: 'Invalid repair form.',
        });
        return repairs.resolve(request.params.id, body, files, {
          admin: requireAdmin(request),
        });
      },
    );
  };
