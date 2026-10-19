# Development database and authentication

The root `compose.yaml` runs PostgreSQL, Ory Kratos, Ory's reference login UI
and Mailpit. API, web and gateway run on the host through Watt for development.

```sh
make setup        # pnpm install and local .env generation
make up           # start services and wait for readiness
make dev          # run Fleet through Watt
```

`make help` lists all commands. Setup preserves existing `.env` values and
generates missing passwords, cookie secrets and a 32-byte cipher key. It keeps
the local file readable only by your account. `.env.sample` has no credentials.

## Services

| Service | Default address | Purpose |
| --- | --- | --- |
| Fleet | <http://127.0.0.1:3042> | API, web and gateway, started with `make dev` |
| Login UI | <http://127.0.0.1:14455/login> | Sign in, register, verify, recover and manage an account |
| Kratos public | <http://127.0.0.1:14433> | Browser and native authentication flows, session validation |
| Kratos admin | <http://127.0.0.1:14434> | Local identity administration and health checks |
| Mailpit | <http://127.0.0.1:18025> | Captured verification and recovery emails |
| PostgreSQL | `127.0.0.1:55432` | Shared `fleet` database |

Use **127.0.0.1 consistently** when opening the UI and Kratos. Mixing it with
`localhost` changes the cookie host. Ports are separate from the running
Brocabs development stack, and every published container port binds to loopback.
SMTP stays inside the Compose network.

Kratos and its UI are pinned to `v26.2.0`, the
[latest Kratos release verified on 19 October 2026](https://github.com/ory/kratos/releases/tag/v26.2.0).
PostgreSQL uses `18.6-alpine`; Mailpit uses `v1.31.6`.

## One database, separate schemas and roles

| Schema | Owner | Contents |
| --- | --- | --- |
| `kratos` | `fleet_kratos` | Identities, credentials, sessions, flows and Kratos migration history |
| `app` | `fleet_app` | Fleet business tables and future app migrations |
| `extensions` | `fleet_admin` | `pg_trgm` and `btree_gin`, required by Kratos migrations |

The app and Kratos roles can create objects only in their own schema. Neither
can read the other's schema, create a new schema, create objects in `public`,
or administer the database. Both have read access to the administrator-managed
extensions. Their default search paths start with their own schema, then
`extensions`; Kratos's DSN also specifies `search_path=kratos,extensions`.
The database administrator is used only to provision the development database.

`DATABASE_URL` in `.env` connects the host API to PostgreSQL using `fleet_app`;
`DATABASE_SCHEMA=app` identifies the application schema. `KRATOS_DSN` connects
the Kratos containers to the same database using `fleet_kratos`.

Kratos owns login identities and password storage. When application profiles,
drivers and administrator records are added, reference the Kratos identity UUID
from app-owned tables. Keep business fields and migrations in `app` rather than
modifying Kratos-owned tables.

This step provisions the database and authentication service. The current Fleet
starter has no ORM, business tables or protected routes yet. The reference UI
provides working authentication while Fleet's own screens are implemented.

## Initialization and migrations

PostgreSQL runs the numbered SQL files in `docker/postgres` on its first start.
They create the roles and schemas and install the extensions as the administrator.
The `kratos-migrate` job waits for PostgreSQL, applies Kratos migrations using the
Kratos role, and exits. Kratos starts only after that job succeeds. The login UI
waits for Kratos to report ready. Failed migrations remain visible in
`make status` and stop dependent services from starting.

```sh
make status
make logs SERVICE=kratos
make migrate              # apply pending Kratos migrations explicitly
make db-shell             # administrator psql inside the local database
make infra-test           # exercise schema isolation and authentication
make down                 # stop containers; keep database data
```

The smoke test checks the real database roles and schema permissions, then
registers a temporary user, requires email verification, reads the verification
message from Mailpit, verifies the account, signs in, checks the session and
logs out. It deletes only its own test identity and messages afterward.

Database data persists in `fleet-dev_postgres_data`. Initialization SQL does not
rerun against an existing volume. Changing a password in `.env` does not rotate
the corresponding PostgreSQL role password; use `ALTER ROLE` for existing data,
then update the matching connection URL. Changing a host port also requires
updating its URL in `.env`. Keep the same cookie and cipher secrets when reusing
an existing database.

For a deliberate clean reset, `docker compose down --volumes` deletes this
development stack's database and all its users. `make down` preserves them.

## Development authentication behavior

The identity schema requires an email address and first/last name. Email and
password registration, code-based email verification and account recovery are
enabled. Login requires a verified email. Passwords use Argon2; sessions use an
HTTP-only, project-specific cookie. Sensitive-value logging is disabled.

This is a local HTTP setup: Kratos runs with `--dev`, the reference UI permits
HTTP CSRF cookies, and the database connection disables TLS. These settings
belong to this development Compose stack. Production requires HTTPS and a
separate deployment configuration. The Kratos admin API has no built-in
authentication; its local-only binding is intentional.

Relevant Ory documentation:

- [PostgreSQL DSN parameters and schema search paths](https://www.ory.com/docs/oss/deployment)
- [Reference UI configuration and cookie behavior](https://github.com/ory/kratos-selfservice-ui-node#configuration)
