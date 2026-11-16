import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { EntityCaseNamingStrategy, defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { SeedManager } from '@mikro-orm/seeder';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { appEntities } from './entities.js';

// Both `src/database` (tsx) and `dist/database` (compiled) resolve to the api
// package root, so CLI and runtime discovery agree on where entities, migrations
// and seeders live regardless of the process working directory.
export const apiRoot = fileURLToPath(new URL('../..', import.meta.url));

export function databaseConfig(maintenance = false) {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required. Run pnpm dev:setup.');
  if (process.env.DATABASE_SCHEMA && process.env.DATABASE_SCHEMA !== 'app') {
    throw new Error('Fleet application data must use the app schema.');
  }

  // Vitest runs entities through its own transform; folder discovery would ask
  // Node to import TypeScript sources directly. Use explicit classes there.
  const discovery: { entities: any; entitiesTs: any } = process.env.VITEST
    ? { entities: appEntities, entitiesTs: appEntities }
    : {
        entities: [resolve(apiRoot, 'dist/**/*.entity.js')],
        entitiesTs: [resolve(apiRoot, 'src/**/*.entity.ts')],
      };

  return defineConfig({
    clientUrl: process.env.DATABASE_URL,
    schema: 'app',
    baseDir: apiRoot,
    // The app tables use camelCase columns; keep property names verbatim.
    // v7 takes the naming strategy constructor, not an instance.
    namingStrategy: EntityCaseNamingStrategy,
    ...discovery,
    extensions: [Migrator, SeedManager],
    metadataProvider: ReflectMetadataProvider,
    debug: false,
    // A shared mutable EntityManager is only safe inside a RequestContext; HTTP
    // requests get one from the Fastify `onRequest` hook and background work
    // forks explicitly.
    allowGlobalContext: false,
    pool: {
      min: 0,
      max: maintenance ? 2 : 8,
      idleTimeoutMillis: 60_000,
    },
    driverOptions: {
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      application_name: maintenance ? 'fleet-maintenance' : 'fleet-api',
    },
    migrations: {
      schema: 'app',
      tableName: 'mikro_orm_migrations',
      path: resolve(apiRoot, 'dist/migrations'),
      pathTs: resolve(apiRoot, 'src/migrations'),
      transactional: true,
      allOrNothing: true,
      dropTables: false,
      safe: true,
      snapshot: true,
      snapshotName: '.snapshot-fleet-orm',
      emit: 'ts',
    },
    seeder: {
      path: resolve(apiRoot, 'dist/seeders'),
      pathTs: resolve(apiRoot, 'src/seeders'),
      defaultSeeder: 'DatabaseSeeder',
      emit: 'ts',
    },
  });
}
