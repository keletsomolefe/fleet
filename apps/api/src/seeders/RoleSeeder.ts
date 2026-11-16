import type { EntityManager as MikroEntityManager } from '@mikro-orm/postgresql';
import { Seeder } from '@mikro-orm/seeder';
import { EntityManager } from '../database/database.js';
import { configureRoles } from '../rbac/role-catalogue.js';

/** Seeds/refreshes the permission and role catalogue. Never removes users or data. */
export class RoleSeeder extends Seeder {
  async run(em: MikroEntityManager): Promise<void> {
    await em.transactional((tx) => configureRoles(new EntityManager(tx)));
  }
}
