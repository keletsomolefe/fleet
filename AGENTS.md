# Fleet development conventions

## Monorepo layout

Fleet is a pnpm workspace managed by Platformatic Watt (`watt.json`):

```text
fleet/
  apps/
    api/          # Fastify 5 + MikroORM 7 backend API (DDD modular monolith — see apps/api/AGENTS.md)
    web/          # TanStack Start + TanStack Query + TanStack Form + shadcn/ui admin dashboard
    gateway/      # Platformatic Watt HTTP gateway composing web + api
    mobile/       # Expo React Native driver & field-admin app
  docker/         # Local PostgreSQL init scripts & Ory Kratos configuration
  deploy/         # Production Docker Compose, Caddyfile, rollout & bootstrap scripts
  docs/           # Architecture, database, auth, scheduling, mobile, and WhatsApp documentation
  scripts/        # Dev runner (`dev.mjs`), setup (`setup-dev.mjs`), and stack integration tests
  DESIGN.md       # Shared visual rules for web & mobile
```

For backend architecture, DDD module layout, MikroORM 7 (`defineEntity`) conventions, Fastify 5 plugin patterns, DTOs, and migrations, **always read [`apps/api/AGENTS.md`](apps/api/AGENTS.md)** before editing `apps/api/`.

## Core engineering rules

- Use `pnpm` from the repository root and keep shared configuration in the root `.env`.
- Fleet is pre-production. Local development data is disposable; migrations may be rewritten and the local database reset when changes call for it. Production migration compatibility is not required yet.
- Application schema changes use explicit, additive MikroORM migrations (`pnpm db:migrate`, `docs/database.md`). Use the existing `app` schema, retain data during deployment, and preserve Kratos, database roles and other services. Never reset or drop existing application data. Fresh databases are initialized with the baseline migration plus the role/permission seeder. Follow https://mikro-orm.io/docs/migrations and https://mikro-orm.io/docs/seeding.
- Keep UI copy concise. Do not put developer notes, implementation status, account-policy explanations, or repeated instructions on product screens. Keep those details in repository documentation. Retain labels, validation requirements, necessary recovery steps, and meaningful outcome/status messages.
- Write for everyday employees. Use plain language and short actions such as “Sign in”. Use “Welcome to VHH Fleet” for the sign-in heading, and keep technical connection, authentication and storage terms out of employee-facing copy.
- Use the existing shadcn/ui components and VHH theme for interface changes. The design source is linked in `docs/admin-authentication.md`.
- Use TanStack Form for form values, validation and submission in the web and driver apps. Keep using the existing UI components for fields.
- For new screens or material layout, interaction, or design system changes in the web dashboard or mobile app, follow the [Fleet UI workflow](.agents/skills/fleet-ui/SKILL.md). [DESIGN.md](DESIGN.md) records the shared visual rules and points to the running components.
- Kratos owns authentication sessions and credentials. Application users and authorization belong in the `app` schema through MikroORM 7 `defineEntity()` schemas (no legacy decorators, no `reflect-metadata`, no NestJS modules or decorator DI).
- Fleet currently serves one company. Keep a single user model; roles and permissions determine admin, driver and terminal access. Do not introduce workspaces, tenancy, or a fixed admin/driver user type.
- Never commit credentials, local Kratos hook configuration, or test accounts. Preserve database schema/role isolation and keep synchronization disabled. Add explicit migrations for schema changes.
