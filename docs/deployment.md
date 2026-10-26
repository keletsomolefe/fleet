# Fleet deployment

Fleet runs at **https://fleet.nativesounds.co.za/** on the existing nativesounds VPS. Pushes to `main` trigger `.github/workflows/deploy.yml`; manual runs use GitHub Actions **Deploy Fleet**. The workflow is intentionally small: build/test a Linux image, publish its full commit-SHA tag to GHCR, then invoke the server deployment over SSH. Mobile application binaries are built separately.

The dedicated Ed25519 key is stored as the repository Actions secret `FLEET_SSH_PRIVATE_KEY`; `FLEET_SSH_KNOWN_HOSTS` pins the server's verified Ed25519 host key. The GitHub connector does not manage Actions secrets, so setup uses `gh secret set`. No private key, runtime credential, account password, local `.env` or Kratos hook secret belongs in Git.

The key's server-side `authorized_keys` entry has `restrict` and a forced `/usr/local/sbin/fleet-receive` command. It accepts only `check` or `deploy <40-character SHA>` for this fixed Fleet repository/image. It grants no general SSH shell or forwarding. Other authorized SSH keys remain untouched. The one-time GHCR token is supplied through SSH stdin and used in a temporary Docker credential directory removed after the deployment.

## Server layout

- `/opt/fleet/.env`: root-only runtime credentials and initial owner credentials; generated once by `deploy/init-env.py`.
- `/opt/fleet/private/kratos.local.json`: secret-bearing hook configuration in a root-only directory; mounted individually read-only for Kratos UID 10000.
- `/opt/fleet/releases/<SHA>/`: deployment files downloaded from that exact GitHub commit.
- `/opt/fleet/config/`: stable bind-mount paths; unchanged pushes do not restart Postgres or Kratos just because the release directory changed.
- `/opt/fleet/current`: last deployment that passed container and public HTTPS checks.
- Docker project `fleet`: application, edge router, Postgres, Kratos, fallback account UI and private test email inbox.

The existing shared Caddy proxy supplies HTTPS through the `caddy` Docker network. Fleet's small internal edge router handles `/auth/*` (Kratos public API), `/account/*` (fallback recovery/settings UI), `/mqtt` (secure WebSocket transport) and the application. `/api/internal/*` is blocked at the edge; Kratos calls the hook directly on the private Docker network. Fleet exposes no database, Kratos admin, application or MQTT host ports. The test email UI is bound only to `127.0.0.1:18026`.

Application sessions/credentials remain in Kratos. The application and Kratos have separate PostgreSQL roles and `app`/`kratos` schemas. Compose passes only each service's required environment variables. Secrets stay on the server across deployments; volumes are retained. Memory limits account for the shared 4 GB VPS. Kratos has 512 MiB of RAM headroom (1 GiB including swap) for its default 128 MB Argon2 hashing; an initial 192 MiB limit was too small during password processing.

## Deployment and recovery

`deploy/receive.sh` serializes server deployments with `flock`, pulls the immutable image and downloads matching configuration. `deploy/deploy.sh` starts dependencies, applies Kratos and explicit TypeORM migrations, initializes an owner only when there are no owners, then starts the application and verifies public HTTPS. Existing owner passwords and roles are never reset on a later push.

The launch baseline replaces the former application migrations. The user authorized wiping staging application data for this deployment. Before applying `LaunchBaseline1793188800000`, `deploy/prepare-baseline.sh` recognizes the retired migration chain, stops the old application, and transactionally drops and recreates only the `app` schema, including its migration history, with the existing application role as owner and public access revoked. Kratos identities, passwords, sessions, extensions, roles and other services remain. Owner bootstrap reconnects the marked original owner identity. The reset is skipped when the baseline is already recorded; unknown migration histories stop deployment without deleting data. `pnpm db:reset --yes` remains local-only.

Run `pnpm test:deployment` with the local Docker stack to verify this transition in a temporary database, including repeat deployment and schema isolation checks.

If application health fails, the script attempts to restore the previous application's image/configuration only when that release records the same database baseline. It cannot restore a release from the retired migration chain after the reset. Database migrations are retained. Fleet remains pre-production; this is not a guarantee of database-compatible rollback. Old Fleet image tags are pruned while preserving the current and previous releases. No other project's containers, images or volumes are pruned.

To redeploy an existing SHA manually as the normal server operator:

```bash
ssh root@nativesounds.co.za
sha=$(cat /opt/fleet/current/release-sha)
bash /opt/fleet/releases/"$sha"/deploy.sh "$sha"
```

The initial owner uses the email configured during server initialization. Its generated password is available only to the server operator in `/opt/fleet/.env` as `INITIAL_OWNER_PASSWORD`; retrieve it over your existing administrative SSH access and change it through account settings. It is never printed by the deployment.

Email OTP is disabled for this deployment (`AUTH_REQUIRE_VERIFIED_EMAIL=false`). Administrators provision users and copy a one-time 30-minute setup/reset link from the user profile. `users.access` is required; owner accounts also require `users.owners`. Active local users and role permissions remain mandatory. Kratos owns the link, password update and session. Optional emails currently go to the private Mailpit inbox. Access it through an administrative SSH tunnel:

```bash
ssh -L 18026:127.0.0.1:18026 root@nativesounds.co.za
# Open http://127.0.0.1:18026 locally.
```

To deliver real email, update `SMTP_CONNECTION_URI` and `SMTP_FROM_ADDRESS` in `/opt/fleet/.env`, then recreate Kratos. Use the provider's TLS settings. This does not change Fleet's application credentials or migrate identities.

For installed staging mobile builds, run `pnpm mobile:build:staging --platform android` (or `ios`) from the repository root. The `staging` EAS profile sets `APP_ENV=staging`, which fixes the public API to `https://fleet.nativesounds.co.za/api` without changing local development's root `.env`. EAS login, project linking and signing must be configured for the first cloud build. Other release profiles require an HTTPS `EXPO_PUBLIC_API_URL`. The deployed API supplies `wss://fleet.nativesounds.co.za/mqtt`; existing installed binaries retain their previous endpoint until rebuilt.

Reference configuration was checked against [Caddy Docker Proxy](https://github.com/lucaslorentz/caddy-docker-proxy), the pinned [Kratos UI source](https://github.com/ory/kratos-selfservice-ui-node/blob/v26.2.0/src/index.ts), and [GitHub Actions triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
