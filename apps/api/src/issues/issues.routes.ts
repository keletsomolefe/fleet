import { requireAdmin } from '../auth/admin-session.js';
import type { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { bearer } from '../mobile/mobile.input.js';
import { IssuesService } from './issues.service.js';
export function registerMobileIssueRoutes(
  app: FastifyInstance,
  auth: AuthService,
  issues: IssuesService,
) {
  app.post('/mobile/driver/issues', async (r) => {
    const { body } = r;
    return issues.report(await auth.authenticateNative(bearer(r)), body);
  });
  app.get('/mobile/driver/issues', async (r) => {
    return issues.list(await auth.authenticateNative(bearer(r)), true);
  });
  app.get('/mobile/admin/issues', async (r) => {
    return issues.list(await auth.authenticateNative(bearer(r)));
  });
  app.post<{ Params: { id: string } }>(
    '/mobile/admin/issues/:id/resolve',
    async (r) => {
      const { id } = r.params;
      const { body } = r;
      return issues.resolve(await auth.authenticateNative(bearer(r)), id, body);
    },
  );
}
export function registerAdminIssueRoutes(
  app: FastifyInstance,
  issues: IssuesService,
) {
  app.get(
    '/issues',
    { config: { permissions: ['admin.access', 'issues.read'] } },
    async (r) => {
      return issues.list(requireAdmin(r));
    },
  );
  app.post<{ Params: { id: string } }>(
    '/issues/:id/resolve',
    {
      config: {
        permissions: ['admin.access', 'issues.read', 'issues.resolve'],
      },
    },
    async (r) => {
      const { id } = r.params;
      const { body } = r;

      return issues.resolve(requireAdmin(r), id, body);
    },
  );
}
