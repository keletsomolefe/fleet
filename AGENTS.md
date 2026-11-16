# Fleet development conventions

- Use pnpm from the repository root and keep shared configuration in the root `.env`.
- Fleet is pre-production. Local development data is disposable; migrations may be rewritten and the local database reset when changes call for it. Production migration compatibility is not required yet.
- Application schema changes use explicit, additive MikroORM migrations (`pnpm db:migrate`, `docs/database.md`). Use the existing `app` schema, retain data during deployment, and preserve Kratos, database roles and other services. Never reset or drop existing application data. Fresh databases are initialized with the baseline migration plus the role/permission seeder. Follow https://mikro-orm.io/docs/migrations and https://mikro-orm.io/docs/seeding.
- Keep UI copy concise. Do not put developer notes, implementation status, account-policy explanations, or repeated instructions on product screens. Keep those details in repository documentation. Retain labels, validation requirements, necessary recovery steps, and meaningful outcome/status messages.
- Write for everyday employees. Use plain language and short actions such as “Sign in”. Use “Welcome to VHH Fleet” for the sign-in heading, and keep technical connection, authentication and storage terms out of employee-facing copy.
- Use the existing shadcn/ui components and VHH theme for interface changes. The design source is linked in `docs/admin-authentication.md`.
- Use TanStack Form for form values, validation and submission in the web and driver apps. Keep using the existing UI components for fields.
- For new screens or material layout, interaction, or design system changes in the web dashboard or mobile app, follow the [Fleet UI workflow](.agents/skills/fleet-ui/SKILL.md). [DESIGN.md](DESIGN.md) records the shared visual rules and points to the running components.
- Kratos owns authentication sessions and credentials. Application users and authorization belong in the `app` schema through MikroORM entities. Keep the Fastify-native API pattern (plain services, `*.routes.ts` functions, `createApi()`), not NestJS modules or decorator DI.
- Fleet currently serves one company. Keep a single user model; roles and permissions determine admin, driver and terminal access. Do not introduce workspaces, tenancy, or a fixed admin/driver user type.
- Never commit credentials, local Kratos hook configuration, or test accounts. Preserve database schema/role isolation and keep synchronization disabled. Add explicit migrations for schema changes.
