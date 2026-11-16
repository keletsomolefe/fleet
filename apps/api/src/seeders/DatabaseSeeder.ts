import type { EntityManager } from '@mikro-orm/postgresql';
import { Seeder } from '@mikro-orm/seeder';
import { RoleSeeder } from './RoleSeeder.js';

/**
 * Default seeder run by `pnpm --filter api seed` / `mikro-orm seeder:run`.
 * Seeders only add or refresh reference data; they never reset the database.
 */
export class DatabaseSeeder extends Seeder {
  run(em: EntityManager): Promise<void> {
    return this.call(em, [RoleSeeder]);
  }
}
