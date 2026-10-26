# Admin authentication and UI foundation

Design source: [VHH Web Admin](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=3-3&m=dev).

The web application uses shadcn/ui with Radix, Tailwind CSS 4, local Montserrat fonts and the existing monochrome theme. The active product name is Fleet; its editable SVG logos are in `assets/brand/fleet`, with web copies in `apps/web/public/brand`. Original VHH artwork and Figma SVG exports remain in `apps/web/public/design`. The desktop sidebar is 240px and the header is 64px. Small screens use a drawer; stacked authentication cards and branding are centred.

## Account access

Fleet currently serves one company. All users belong to that company; there is no workspace, tenant, company selector, or company-scoped authorization model.

Users are created through `/admin/users/new` by someone with `users.create`. Creation stores a neutral user with no roles or access. `/admin/users` lists all application users, including drivers and terminal operators; `/admin/users/:id` manages their roles and active status. `/admin/signup` redirects to user creation for existing bookmarks. Public Kratos registration does not grant application access. Newly created accounts must verify their email, using `/verify-email`, before login. Driver and truck management are implemented; other operational pages remain empty shells. See [Drivers, trucks and devices](drivers-and-trucks.md).

A user can hold several roles. Effective permissions are the union of their roles, loaded from PostgreSQL on every protected request. There is no `userType`, `isAdmin`, or separate administrator account. Credentials and identity remain in Kratos. Driver-specific facts, licence details and vehicle assignments live in a driver profile linked to the same user; a role alone does not establish driver eligibility.

| Role | Initial access |
| --- | --- |
| Owner | All catalog permissions, including owner management |
| Administrator | All admin pages and user creation/access management, excluding owner management |
| Dispatcher | Operational pages, excluding exports, vehicle reports and user management |
| Driver | `driver.access` |
| Terminal operator | `terminal.access` |

The Driver role enables the [personal-phone sign-in and vehicle selection flow](mobile-device-setup.md). Terminal operator access remains reserved for its future surface. Neither role grants admin access on its own. For example, Driver + Administrator combines driving and administration permissions on one user.

`/admin/roles` displays the role bundles and their permission catalog. Initial bundles are maintained through explicit migrations; custom role editing and per-user permission overrides are not included. Add new capability keys only when their corresponding feature is introduced, and enforce them on its API as well as its UI. Role names are presentation; normal authorization checks permission keys.

User access changes require `users.access` and session-bound CSRF/origin checks. Changes involving an Owner require `users.owners`; an Administrator cannot grant themselves this permission. Access edits serialize with a PostgreSQL transaction advisory lock and re-check the actor inside the transaction. They cannot remove the last active Owner or disable/remove their own admin access. Revocations and deactivations apply on the next request without waiting for the Kratos session to expire. The login webhook never assigns roles.

The RBAC migration preserves previous administrators as Administrator role holders, maps previous drivers to Driver, and assigns Owner to the earliest active legacy administrator. New bootstrap accounts receive Owner. Bootstrap reruns leave existing roles and account status untouched.

Kratos owns passwords, browser CSRF, the HTTP-only `fleet_kratos_session` cookie, its 24-hour expiry and logout/revocation. There is no `express-session`, secondary session store, or browser-stored authentication token. On each protected request, Nest forwards the incoming cookie to Kratos `/sessions/whoami`, then checks for a linked, active local user with `admin.access`. The server-rendered web routes perform the same validation through the API.

Login and verification route loaders retrieve or initialize browser flows on the server. The first HTML response contains the form and CSRF token; no preparation loader or hydration fetch is needed. TanStack server functions submit flows and perform logout, forwarding the original Cookie header and every returned Set-Cookie header. The browser only calls its own application origin. Responses are private/no-store, forms are not shared between users, and only recognized local destinations can be returned after authentication. Password values and Kratos flow IDs are never returned in page data or form fields. The loader pattern was informed by `~/Dev/till` and `~/Dev/ticketflow`.

Flow IDs and their CSRF tokens live in separate, short-lived `fleet_login_flow` and `fleet_verification_flow` cookies, encrypted with authenticated AES-GCM, bound to their flow kind, HTTP-only and SameSite=Lax. These are temporary flow references, not authentication sessions or an additional session store. Existing Kratos callback URLs are consumed server-side and redirected to clean local URLs. Expired flows refresh silently on load; on submission the server replaces the flow, merges newly issued CSRF cookies, and retries once with the original input. Changed flow state from another tab also recovers privately. Logout clears the flow cookies. Native Kratos CSRF validation, same-origin server actions and explicit origin validation protect submissions.

`app.users` stores the application UUID, unique Kratos identity UUID, name/email snapshot, active status, creator and timestamps. It does not store passwords or sessions. Local deactivation is effective on the next request. Authentication or database outages deny protected access.

User creation requires a same-origin request and an HMAC CSRF token bound to both the current user and Kratos session. Kratos's Admin API remains server-only. If local persistence fails after identity creation, only that new identity is eligible for cleanup; a surviving identity without local access cannot enter admin.

## Setup and database commands

Run `make setup`, set `BOOTSTRAP_ADMIN_PASSWORD` in the root `.env`, then run `make up` and `make dev`. `make up` waits for Docker readiness, applies application migrations and runs the default administrator bootstrap.

The default development email is `patrickkeletso@gmail.com`, with display name Patrick Keletso. The password is supplied only through local configuration. Bootstrap creates a verified identity tagged with a private bootstrap marker and a linked user with the Owner role. Reruns do not reset credentials or reactivate users, and refuse to adopt unrelated matching identities. Development bootstrap is disabled when `NODE_ENV=production`.

| Command | Purpose |
| --- | --- |
| `pnpm db:migrate` / `make db-migrate` | Apply application migrations |
| `pnpm db:seed` / `make seed-admin` | Create or reconcile the default development admin |
| `pnpm --filter api migration:generate src/database/migrations/Name` | Generate a migration against local PostgreSQL |
| `pnpm --filter api migration:create src/database/migrations/Name` | Create an empty migration |
| `pnpm --filter api migration:revert` | Revert the latest application migration |
| `pnpm --filter api migration:run:prod` | Run compiled migrations with deployment environment variables |

Database options are shared between Nest and the TypeORM CLI. The runtime pool has a maximum of eight connections; maintenance uses two. Application tables and migration history use `app`, `synchronize` is disabled, and TypeORM cannot install extensions. Kratos's database role/schema remain separate. Configuration and repository patterns were adapted from `~/Dev/brocabs` without modifying that repository.

## Login hook and local URLs

An authenticated Kratos password-login hook calls `POST /api/internal/kratos/after-login`. Its Jsonnet body contains only identity ID, name/email and authentication time. It updates existing user snapshots and advances `lastLoginAt` only for newer events. It cannot create users, grant access or reactivate accounts. Profile synchronization is best effort; request-time authorization remains mandatory.

`pnpm dev:setup` generates `APP_CSRF_SECRET`, `KRATOS_HOOK_SECRET`, and the ignored, mode-600 `docker/kratos/kratos.local.json` override. The hook uses `X-Kratos-Hook-Secret`. `KRATOS_HOOK_URL` defaults to Docker Desktop's `host.docker.internal` gateway URL. The development gateway binds to `0.0.0.0` so the container can reach it. Operators using another Docker host must configure that reachable URL. Rerun setup and recreate Kratos after changing hook settings.

Both `http://127.0.0.1:3042` and `http://localhost:3042` work in development. Server functions forward Kratos cookies onto the requesting app host, avoiding cross-origin browser requests. Production uses the configured URLs and exact allowed origin. Recovery/settings retain the reference Kratos UI on port 14455; development emails appear in Mailpit on port 18025.

## API and verification

- `GET /api/auth/config`: public browser URLs only.
- `GET /api/auth/session`: admin-authorized user profile, roles, effective permissions and session-bound CSRF token; never cached.
- `GET /api/admin/users?q=&page=1`: permission-checked search and pagination (20 users/page).
- `GET /api/admin/users/:id`: user profile, assigned roles and effective permissions.
- `POST /api/admin/users`: user creation without role assignment; requires `users.create`.
- `PATCH /api/admin/users/:id/access`: atomic role/status replacement; requires `users.access` and CSRF protection.
- `GET /api/admin/roles`: role bundles with permission labels; requires `users.read`.
- `POST /api/internal/kratos/after-login`: secret-authenticated profile synchronization.

Run `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:e2e`, `pnpm test:admin` and `pnpm infra:test`. The live tests require the local infrastructure, migrations and gateway to be running. They remove only their own temporary identities, application rows and emails. UI copy guidance is maintained in the root `AGENTS.md`.
