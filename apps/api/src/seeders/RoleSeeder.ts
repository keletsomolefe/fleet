import type { EntityManager } from '@mikro-orm/postgresql';
import { Seeder } from '@mikro-orm/seeder';
import { configureRoles } from '../modules/identity/domain/permissions.js';

/** Seeds/refreshes the permission and role catalogue. Never removes users or data. */
export class RoleSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    await em.transactional((tx) => configureRoles(tx));
  }
}
