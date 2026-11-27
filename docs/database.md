# Application database (MikroORM)

Fleet's API stores application data in the `app` schema of the shared PostgreSQL
database using [MikroORM 7](https://mikro-orm.io/docs/) with `defineEntity()`
schemas (no legacy decorators or `reflect-metadata`). Kratos and other services
keep their own schemas and are unaffected.

## Configuration

The configuration lives in `apps/api/src/database/database.config.ts`; the
MikroORM CLI loads it through `apps/api/mikro-orm.config.ts`. Both the CLI and
the compiled runtime share the exact same configuration and explicit entity list
(`apps/api/src/database/entities.ts`), so they work identically from any working
directory across runtime, CLI, tsx, and Vitest.

- `clientUrl` comes from `DATABASE_URL` (root `.env`).
- `schema: 'app'` for every entity and for migrations.
- `namingStrategy: EntityCaseNamingStrategy` keeps the existing camelCase table
  columns (`driverId`, `createdAt`, ...). Do not add snake-case naming.
- `entities: appEntities` (`defineEntity()` schemas in `src/modules/*/domain/*.entity.ts`).
- `extensions: [Migrator, SeedManager]`.
- `allowGlobalContext: false`. HTTP requests get one EntityManager from the
  Fastify `mikroOrmPlugin` `onRequest` hook (`RequestContext.create(orm.em, done)`);
  background workers and scripts fork explicitly (`orm.em.fork()`).
- Connection pool: max 8 (2 for maintenance scripts), min 0, 60s idle timeout,
  10s connection timeout.
- `debug: false`.

Migrations use their own tracking table `app.mikro_orm_migrations` with
`dropTables: false`, `safe: true`, snapshots enabled (`.snapshot-fleet-orm.json`)
and transactions enabled. `app.migrations` is legacy TypeORM history; it is no
longer read or written by the application. The baseline
`src/migrations/*_baseline.ts` is idempotent so it can also be applied to the
pre-MikroORM local database without deleting data; fresh databases get the full
schema from it plus subsequent additive migrations (each implementing both `up()`
and `down()`).

## Migrations

```sh
pnpm --filter api migrate                             # apply pending migrations (or: pnpm db:migrate)
pnpm --filter api migration:create --name=<name>      # create a migration from entity/schema diff
pnpm --filter api migration:pending                   # list pending migrations
pnpm --filter api migration:list                      # list applied migrations
pnpm --filter api migration:check                     # verify entities match the migration snapshot
```

`migrate` is idempotent: a second run prints `Application schema is up to date.`.
Migrations never create or drop the `app` schema itself. The schema is created by
the database initialization (Docker init scripts) or by a database administrator
for a manual reset; `migrate` stops with a clear message when it is missing.

## Seeding

```sh
pnpm --filter api seed        # default DatabaseSeeder (or: pnpm db:seed:run)
pnpm --filter api seed:roles  # only the RoleSeeder
```

Seeders only add or refresh reference data (the permission/role catalogue). They
never reset the database or delete application rows. The seeder configuration is
`seeder: { path: 'dist/seeders', pathTs: 'src/seeders',
defaultSeeder: 'DatabaseSeeder' }` per the official seeding docs.

## Fresh database setup

1. Start PostgreSQL: `pnpm infra:up` (the init scripts create the `app` schema
   owned by the application role).
2. Apply the schema: `pnpm db:migrate`.
3. Seed reference data: `pnpm db:seed:run`.
4. Configure the catalogue explicitly if needed: `pnpm db:roles`.
5. Bootstrap the first owner: `pnpm db:seed` (development) or the deployment
   owner-bootstrap job (`deploy/bootstrap-owner.mjs`).
6. Start the API: `pnpm dev` (or deploy).

For a local reset, recreate only the `app` schema as a database administrator
(for example with `fleet_admin`) and keep `mikro_orm_migrations` in it; do not
drop the database or the Kratos schema.

## Local development and production

- Local development reads the root `.env`; `pnpm --filter api migrate` and the
  API dev server both load it.
- Production builds compile the API to `dist` and run
  `node apps/api/dist/database/migrate.js` before the read-only preflight
  (`check-schema.js`). Compiled migrations and seeders are read from `dist`.
- `check-schema` is read-only: it compares mapped entity columns with
  `information_schema` and fails the deployment when the schema is incomplete.
- Never enable schema synchronization; never reset application data in a
  deployment.

## Verification

```sh
pnpm --filter api migrate        # twice: second run is a no-op
pnpm --filter api check-schema   # read-only column check
pnpm --filter api migration:check
pnpm --filter api typecheck
pnpm --filter api lint
pnpm --filter api test
pnpm --filter api build
```
