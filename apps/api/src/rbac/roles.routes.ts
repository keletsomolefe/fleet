import type { FastifyInstance } from 'fastify';
import { RbacService } from './rbac.service.js';
export function registerRoleRoutes(app: FastifyInstance, rbac: RbacService) {
  app.get('/roles', { config: { permissions: ['users.read'] } }, async () => {
    return rbac.catalog();
  });
}
