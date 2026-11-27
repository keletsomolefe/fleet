# Fleet API — AI Agent Architecture & Conventions Guide

This document explains how `apps/api` is structured and the rules every AI agent and developer must follow when adding or modifying backend features.

**Stack**: Node 22+ ESM (`"type": "module"`), TypeScript (strict, no legacy decorators), **Fastify 5**, **MikroORM 7** (`@mikro-orm/postgresql` with `defineEntity()` + `p` property builders), **PostgreSQL** (`app` schema), **Vitest**, and **oxlint**.

---

## 1. Directory Layout (DDD Modular Monolith)

```text
apps/api/
  mikro-orm.config.ts           # MikroORM CLI entrypoint (re-exports databaseConfig())
  scripts/mikro-orm-cli.mjs     # Loads root .env and forwards arguments to mikro-orm CLI
  src/
    app.ts                      # Fastify composition root (`createApi()`)
    main.ts                     # Standalone Node server entrypoint
    watt.ts                     # Platformatic Watt runtime entrypoint
    database/                   # MikroORM config, connection helpers, and deploy/maintenance CLIs
      database.config.ts        # `defineConfig()` — schema: 'app', EntityCaseNamingStrategy, explicit entities
      entities.ts               # Explicit entity registry (`appEntities`) used by runtime, CLI & Vitest
      orm.ts                    # `createOrm()` & `withMaintenanceOrm()`
      context.ts                # `getEm(orm)`, `rawQuery()`, `acquireAdvisoryLock()`, `dbClockTimestamp()`, `pgErrorCode()`
      calendar-date.type.ts     # Custom MikroORM Type mapping Postgres `date` <-> `YYYY-MM-DD`
      migrate.ts                # Deploy/CLI migration runner (called by deploy/deploy.sh)
      check-schema.ts           # Read-only deploy preflight verifying mapped columns exist
      configure-roles.ts        # Refreshes permission/role catalogue (called by deploy/deploy.sh)
      bootstrap-owner.ts        # Initial production owner bootstrap
      seed-admin.ts             # Local development admin bootstrap
    plugins/                    # Fastify 5 infrastructure & auth plugins
      plugin.ts                 # `rootPlugin()` helper (`Symbol.for('skip-override')`)
      server.ts                 # `createHttpServer()` — JSON parser, Ajv validation error formatter, error/404 handlers
      mikro-orm.plugin.ts       # Decorates `fastify.orm`, opens per-request `RequestContext`, closes ORM on shutdown
      admin-auth.plugin.ts      # Encapsulated `/admin` auth, RBAC (`config.permissions`), and CSRF hooks
      mobile-auth.plugin.ts     # Native Bearer session hook (`mobileSessionHook`, `assertNativeRequest`)
    shared/                     # Shared Kernel (pure domain primitives, validation, HTTP helpers, private storage)
      entity-columns.ts         # Reusable `defineEntity()` column builders (`uuidPrimaryKey`, `timestampColumns`, etc.)
      calendar-date.ts          # Operational date helpers (`Africa/Johannesburg` timezone)
      errors.ts                 # `HttpError` hierarchy (`BadRequestError`, `ConflictError`, `NotFoundError`, ...)
      identifiers.ts            # `uuidPattern`, `isUuid()`, `assertUuid()`, `secretEqual()`, `hashDeviceToken()`
      validation.ts             # Shared DTO validation primitives + Fastify JSON Schema UUID params helpers
      http.ts                   # `header()`, `privateResponse`, `sendPrivatePhoto()`, `readPhotoUpload()`
      storage/                  # Photo magic-byte validation (`photo.ts`) and private disk storage (`private-storage.ts`)
    migrations/                 # MikroORM migrations (all must implement both `up()` and `down()`) + `.snapshot-fleet-orm.json`
    seeders/                    # MikroORM seeders (`DatabaseSeeder`, `RoleSeeder`)
    modules/                    # DDD Bounded Contexts (see below)
      identity/                 # Users, Kratos auth, RBAC roles & permissions
      fleet/                    # Trucks, TruckDevices, DriverProfiles, assignments & associations
      scheduling/               # Daily DriverSchedules and schedule mismatch workflows
      driving/                  # DrivingSessions (with shift start/end odometer & mileage proof), VehicleDisputes, mobile sign-in & mode resolution
      issues/                   # DriverIssues and mechanic Repairs (with photo receipts)
      service-jobs/             # ServiceProviders, ServiceJobs, ServiceJobOffers, Events, Attachments, signed public links
      telemetry/                # TrackingStreams, TrackingEvents, live MQTT WebSocket broker
      transport/                # Customers, locations, products, effective-dated rates, dispatches, offline activities, proof photos, expenses & month-end earnings/timeline
      whatsapp/                 # WhatsApp Cloud API, OpenWA demo transport, alert worker, inbound webhook
      operations/               # Live attention snapshot & MQTT notification tickets
  test/
    app.e2e-spec.ts             # End-to-end HTTP smoke test using `app.inject()`
```

---

## 2. DDD Bounded Context Structure

Every bounded context under `src/modules/<context>/` is split by layer:

| Folder | Responsibility | Allowed Dependencies |
| --- | --- | --- |
| `domain/` | MikroORM `defineEntity()` schemas, inferred entity types, domain union types, and **pure domain functions** enforcing invariants & state transitions | `shared/`, `database/calendar-date.type.ts`, other contexts' `domain/` types (for FK relations only) |
| `application/` | Use-case orchestration, transaction boundaries (`em.transactional`), advisory locks, coordination with external services/workers | Own `domain/`, `http/*.dto.ts`, `database/context.ts`, `shared/`, other contexts' application/domain services |
| `infrastructure/` | External I/O adapters (Kratos HTTP client, WhatsApp Cloud/OpenWA HTTP clients, Aedes MQTT broker) | `shared/`, own `domain/`/`application/` |
| `http/` | Fastify plugins (`FastifyPluginAsync`), route JSON schemas (`schema: { params }`), request DTO parsers, and explicit response DTO mappers | `plugins/`, `shared/`, own `application/` & `domain/` |

### Pragmatic DDD Guidelines
- **Do not create classes when plain modules or pure functions suffice.**
  - Entities are defined with MikroORM 7 `defineEntity()` + `InferEntity<typeof Entity>`, with pure domain functions exported alongside them (e.g., `assertOdometerNotDecreasing()`, `assertDriverEligibleForAssignment()`, `resolveIssue()`, `acceptServiceJob()`, `completeServiceJob()`, `requeueOffer()`).
  - Domain services without mutable runtime state should be plain exported objects/functions (see `serviceJobAccess` in `modules/service-jobs/domain/service-job-access.ts`).
  - Only use classes when an object holds injected dependencies or stateful runtime resources (timers, sockets, in-memory rate-limit/ticket maps).
- **Keep domain invariants in `domain/`**: Never duplicate state transition checks or eligibility rules in HTTP routes or across multiple services.

---

## 3. MikroORM 7 Standards (No Legacy Decorators, No TypeORM Shim)

- **Always use `defineEntity()` + `p` property builders** from `@mikro-orm/postgresql`.
  - **NEVER** import `@mikro-orm/decorators/legacy` or `reflect-metadata`.
  - **NEVER** re-enable `experimentalDecorators` or `emitDecoratorMetadata` in `tsconfig.json`.
  - Use dual value+type exports so entities work seamlessly in both runtime queries and TypeScript annotations:
    ```ts
    export const Truck = defineEntity({ name: 'Truck', tableName: 'trucks', schema: 'app', ... });
    export type Truck = InferEntity<typeof Truck>;
    ```
- **Always register new entities in `src/database/entities.ts`** (`appEntities`).
- **Schema & naming**:
  - Every table lives in `schema: 'app'`.
  - `namingStrategy: EntityCaseNamingStrategy` preserves camelCase column names verbatim (`driverId`, `createdAt`, etc.). Always set explicit `fieldName: '<name>Id'` on `manyToOne` relations.
  - Use `.strictNullable()` for nullable columns so inferred types are `T | null` (not `T | null | undefined`).
  - Use `hidden: true` on any credential/token hash column (e.g. `TruckDevice.credentialHash`, `TrackingStream.uploadTokenHash`).
  - Declare DB-level `checks`, `indexes`, and `uniques` directly in `defineEntity()` so `migration:create` and `migration:check` keep PostgreSQL constraints synchronized with TypeScript domain types.
- **Native `EntityManager` usage**:
  - `allowGlobalContext: false` is strictly enforced. Always obtain the request-scoped `EntityManager` via `getEm(this.orm)` (which uses `RequestContext.getEntityManager() ?? orm.em.fork()`).
  - Background workers (`JobAlertWorker`, `WhatsAppWebhookService` background helpers) and maintenance scripts fork explicitly (`orm.em.fork()`).
  - **Relations**: Read FK IDs via `entity.relation?.id ?? null` (MikroORM populates PKs on unloaded reference proxies). Assign relations by ID using `em.getReference(TargetEntity, id)` — never cast raw strings to entity types.
  - **Updates**: Mutate the loaded managed entity (or use `em.assign(entity, fields)`) and `await em.flush()`. Never spread a managed entity into `em.create()`.
  - **Unit of Work**: Inside loops, call `em.persist(entity)` for each new entity and flush **once** at the end (`await em.flush()`).
  - **Batch queries**: Avoid N+1 queries inside `Promise.all(rows.map(...))`; fetch related records in batch using `{ $in: ids }` and index into a `Map`.
  - **Raw SQL**: Use `rawQuery<Row>(em, sql, params)` from `src/database/context.ts` for complex PostgreSQL-only queries (`DISTINCT ON`, `FOR UPDATE SKIP LOCKED`, `WITH` CTEs, `nextval()`). Use `acquireAdvisoryLock(tx, key)` for transaction-scoped advisory locks.

---

## 4. Fastify 5 Patterns

- **Composition root**: `createApi()` in `src/app.ts` wires services, registers infrastructure plugins (`mikroOrmPlugin`, `@fastify/cookie`), and mounts bounded-context plugins inside encapsulated scopes:
  - `/admin/*` — protected by `protectAdminScope(admin, auth, rbac)` (session cookie, per-route `config: { permissions: [...] }`, CSRF on non-GET/HEAD).
  - `/mobile/*` — sets `Cache-Control: private, no-store`; authenticated mobile routes share a nested scope with `preHandler: mobileSessionHook(auth)`.
  - `/public/service-job/*` — registers `@fastify/multipart` locally and validates Bearer job link codes in a scoped `preHandler`.
  - `/whatsapp/webhook` — encapsulated plugin replacing content-type parsers with raw `Buffer` so HMAC signatures are verified on exact bytes.
- **Encapsulation**:
  - Write route modules as `FastifyPluginAsync<Options>` functions (`*.plugin.ts`).
  - Only skip encapsulation (via `rootPlugin()` in `src/plugins/plugin.ts`) for true app-wide infrastructure plugins like `mikroOrmPlugin`.
  - Register `@fastify/multipart` only inside the narrow route scopes that accept file uploads (`adminRepairsPlugin`, `publicServiceJobsPlugin`).
- **Route schema validation**:
  - Attach `schema: { params: uuidIdParamsSchema }` (or `uuidParamsSchema([...])` from `src/shared/validation.ts`) on routes with UUID path parameters so Fastify's compiled Ajv validates them before handlers execute.
  - `createHttpServer()` in `src/plugins/server.ts` formats both `HttpError` instances and Fastify Ajv validation errors into the standard `{ message, error, statusCode }` JSON envelope.
- **Lifecycle**:
  - Start background workers (`alertWorker`, `whatsappWebhook`, `mqtt`) in `onReady` and stop them in `onClose`.
  - `mikroOrmPlugin` owns `RequestContext.create(orm.em, done)` in `onRequest` and `orm.close(true)` in `onClose`.

---

## 5. DTOs & Validation

- **Centralized primitives**: Reuse `src/shared/validation.ts` (`strictObject`, `requiredText`, `optionalText`, `requiredNote`, `boundedInteger`, `optionalFiniteNumber`, `enumChoice`, `parseCalendarDateField`, `uuidField`, `phoneField`, `optionalTimestamp`, `booleanOrDefault`, `escapeLikePattern`). Never copy-paste helper functions into module DTO files.
- **Plain-language errors**: Validation messages are shown directly to employees. Keep them concise, actionable, and free of technical jargon.
- **Explicit response DTO mappers**: Never spread raw ORM entities (`{ ...truck }`, `{ ...driver }`) into HTTP responses. Map entities explicitly in `http/*.dto.ts` (e.g. `toTruckDto()`, `toDriverDto()`, `toUserProfileDto()`) so hidden/internal properties and unloaded proxies are never accidentally serialized.

---

## 6. Migrations & Seeding

- **Workflow**:
  1. Edit or add a `defineEntity()` schema in `src/modules/<context>/domain/*.entity.ts` (and register new entities in `src/database/entities.ts`).
  2. Generate an additive migration via MikroORM CLI:
     ```sh
     pnpm --filter api migration:create --name=<short_snake_case_name>
     ```
  3. Inspect the generated migration in `src/migrations/`: ensure both `up()` and `down()` are clean, additive, and never drop tables or existing data.
  4. Verify snapshot parity: `pnpm --filter api migration:check` must print `No changes required, schema is up-to-date`.
- **Deployment safety**: `deploy/deploy.sh` executes `dist/database/migrate.js`, then `dist/database/check-schema.js`, then `dist/database/configure-roles.js`. Keep those entrypoints in `src/database/` and run `pnpm test:deployment` after database config or migration changes.

---

## 7. How to Add a New Feature or Bounded Context

1. Create `src/modules/<context>/{domain,application,http}/` (add `infrastructure/` only if talking to external I/O).
2. Define entities in `domain/*.entity.ts` with `defineEntity()`, pure domain functions for invariants, and register them in `src/database/entities.ts`.
3. Create and review the MikroORM migration (`pnpm --filter api migration:create --name=...`) and confirm `pnpm --filter api migration:check`.
4. Add request parsers + response mappers in `http/<context>.dto.ts` using `src/shared/validation.ts`, plus unit tests in `http/<context>.dto.spec.ts` and `domain/<context>.domain.spec.ts`.
5. Implement use cases in `application/<context>.service.ts` using `getEm(this.orm)` and `em.transactional()`.
6. Expose endpoints via a `FastifyPluginAsync` in `http/<context>.plugin.ts` with `schema: { params }` and explicit `config: { permissions }` (for `/admin` routes).
7. Register the service and plugin in `src/app.ts` inside the appropriate auth scope.

---

## 8. Verification Checklist

Run these checks from the repository root after backend changes:

```sh
pnpm --filter api typecheck        # Strict TypeScript check (0 errors)
pnpm --filter api lint             # Type-aware oxlint (0 warnings, 0 errors)
pnpm --filter api test             # Vitest unit & plugin contract tests
pnpm --filter api build            # Clean dist/ compilation
pnpm --filter api migration:check  # Verifies entities match .snapshot-fleet-orm.json
pnpm test:deployment               # Verifies deploy safety & MikroORM config invariants
```

When PostgreSQL is running locally, also run:

```sh
pnpm db:migrate                    # Apply pending migrations (idempotent)
pnpm db:check-schema               # Verify information_schema columns match metadata
pnpm --filter api test:e2e         # Full Fastify + Postgres smoke test
pnpm test:db-queries               # Service-job raw SQL & contract verification
```
