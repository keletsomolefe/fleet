import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../../../plugins/admin-auth.plugin.js';
import { requireMobile } from '../../../plugins/mobile-auth.plugin.js';
import type { IssuesService } from '../application/issues.service.js';

export interface IssuesPluginOptions {
  issues: IssuesService;
}

export const mobileIssuesPlugin: FastifyPluginAsync<IssuesPluginOptions> =
  async (app, { issues }) => {
    app.post('/mobile/driver/issues', async (request) =>
      issues.report(requireMobile(request), request.body),
    );

    app.get('/mobile/driver/issues', async (request) =>
      issues.list(requireMobile(request), true),
    );

    app.get('/mobile/admin/issues', async (request) =>
      issues.list(requireMobile(request)),
    );

    app.post<{ Params: { id: string } }>(
      '/mobile/admin/issues/:id/resolve',
      async (request) =>
        issues.resolve(requireMobile(request), request.params.id, request.body),
    );
  };

export const adminIssuesPlugin: FastifyPluginAsync<IssuesPluginOptions> =
  async (app, { issues }) => {
    app.get(
      '/issues',
      { config: { permissions: ['admin.access', 'issues.read'] } },
      async (request) => issues.list(requireAdmin(request)),
    );

    app.post<{ Params: { id: string } }>(
      '/issues/:id/resolve',
      {
        config: {
          permissions: ['admin.access', 'issues.read', 'issues.resolve'],
        },
      },
      async (request) =>
        issues.resolve(requireAdmin(request), request.params.id, request.body),
    );
  };
