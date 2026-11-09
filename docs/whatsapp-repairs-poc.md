# WhatsApp repairs proof of concept

Driver reports still commit to `app.driver_issues` first. New `vehicle` reports with an assigned truck queue one alert for the configured mechanics WhatsApp group. Safety/general reports are not sent to the group. The alert contains the truck, problem and a seven-day issue link.

All repair work happens on the web. The link opens that issue without a Fleet login. To resolve it, a mechanic supplies their WhatsApp number, receives a private six-digit OTP, then submits a repair comment and up to three JPG/PNG/WebP photos (5 MB each). The server checks current group membership before sending an OTP and again before saving the repair. The OTP lasts five minutes and allows five guesses; codes are hashed in memory, one use, limited to one per minute/five per hour per number and thirty per hour overall. Restarting the API invalidates unfinished OTPs. The resulting permission lasts thirty minutes and only resolves that one issue. No mechanic account, role grant or Kratos session is created by the OTP flow. Deployment provisions one disabled, credential-free WhatsApp repairs identity solely for the existing database audit foreign key; it cannot sign in.

The Truck mechanic role is limited to `admin.access`, `issues.read`, `issues.resolve`. Signed-in mechanics can also record repairs on the web using their existing session and CSRF protection. They cannot manage users, trucks, schedules or vehicle allocations. Phone verification is for the no-login link flow; existing authenticated mechanics already have the resolve permission.

Admins receive the existing operations change event when a repair commits, the open issue count falls, and **Completed repairs** shows the latest 100 truck repairs, comments, reporting driver, resolution time and photos. A logged-in resolution records the user ID. An OTP resolution records the verified number/name in the private receipt, uses the disabled WhatsApp repairs audit identity for `resolvedById`, and treats the supplied name as self-reported. The driver sees the existing resolved status/comment in issue history.

## Setup

The POC uses [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA), pinned to `0.29.1`, with its documented `/api/sessions/{sessionId}/messages/send-text` API. This is an unofficial linked-device integration, not Meta Cloud API. Use a dedicated test number: the project documents a nonzero restriction/ban risk. Its sender must be in the test group and able to send messages. Do not enable it for an existing live mechanics group without agreeing the test scope.

From the repository root:

```sh
python3 deploy/init-repairs.py .env
# Set REPAIR_DATA_DIR to an absolute private directory, e.g. <repo>/.fleet-data/repairs.
docker compose --env-file .env -f compose.yaml -f deploy/compose.openwa.yaml up -d openwa
```

OpenWA's dashboard is bound only to `127.0.0.1:2785`. Sign in using the generated `OPENWA_MASTER_KEY` from the root `.env`, create one session, start it and scan the QR with WhatsApp > Linked devices. It does not require Meta WABA onboarding. Add the sender to the mechanics test group. Copy the session ID and select the group's **ID** from `GET /api/sessions/{sessionId}/groups`; names can collide.

Create a separate **operator** API key restricted to that session. It needs group metadata, contact LID lookup and sending to the group and members. A group-only chat allowlist would prevent private OTP delivery; include all approved member chats if using chat scopes, and update that allowlist when test members change. Fleet itself only sends alerts to its configured group and OTPs to confirmed members. Never expose this key in the mobile bundle or browser.

Set in root `.env`:

- `OPENWA_URL`: `http://127.0.0.1:2785` for the host dev server, `http://openwa:2785` for deployed Fleet on the same Docker network.
- `OPENWA_API_KEY`: the session-scoped operator key.
- `OPENWA_SESSION_ID`: the connected session ID.
- `OPENWA_MECHANICS_GROUP_ID`: exact group ID ending `@g.us`.
- `REPAIR_DATA_DIR`: an absolute private path locally; production Compose uses `/app/.fleet-data/repairs` on the `repair_data` volume.
- `APP_URL`: Fleet's reachable HTTPS address for a phone test.
- `WHATSAPP_ENABLED=true`: only after pairing and selecting the test group.

Restart Fleet after configuration. On the server secrets are generated once during deployment, WhatsApp remains disabled by default, and the existing `.env` is retained. Start OpenWA separately with the same project, then recreate the app after setting the operator key/session/group:

```sh
cd /opt/fleet/current
FLEET_IMAGE="ghcr.io/keletsomolefe/fleet:$(cat release-sha)" docker compose --env-file /opt/fleet/.env -f compose.yaml -f compose.openwa.yaml up -d openwa
# Use a local SSH tunnel for the dashboard; do not publish it through Caddy.
ssh -L 2785:127.0.0.1:2785 root@nativesounds.co.za
```

OpenWA has its own SQLite/session volume. It is not given a Docker socket, Fleet DB credentials, or Kratos access. Back up `repair_data` and OpenWA's data volume; do not use `down -v`.

## POC boundaries and recovery

No app schema migrations, resets or synchronization are introduced. Issue state, timestamp and comment remain in the existing DB columns; repair photos/receipts and alert jobs live on the private persistent volume. Photos are served only through permission-checked or issue-capability endpoints, never by a public file server. A receipt is shown only when its timestamp and note match the committed DB resolution. A failed transaction may leave private orphan files; it cannot expose them as a completed repair.

Link tokens are HMAC-signed with a dedicated key, issue/purpose/expiry-bound and carried in the URL fragment. The web page removes the fragment, sends tokens in Authorization headers, uses no browser persistent storage and sets no-referrer/noindex. GET and WhatsApp previews never resolve anything. Anyone with a group link can view that issue; saving requires an OTP to a current member. Group admins therefore control who can authenticate; this does not independently verify employment. LID identifiers are resolved explicitly through OpenWA; LID digits are never treated as telephone numbers. If membership cannot be confirmed, access fails closed.

Alert jobs are written **after** the issue commits so WhatsApp failures cannot lose a driver report. Retries use one stable OpenWA idempotency key and exact payload, survive API restarts, back off to 15 minutes and stop after 23 hours (inside OpenWA's 24-hour deduplication window). Ambiguous send outcomes and configuration/access errors stop for operator review. `sent` means accepted by OpenWA, not proven delivery/read. Inspect private `jobs/<issue-id>.json` and API warnings for pending/stopped alerts; never publish these files because they contain issue links. This is a single-instance POC queue. There is a small crash window between DB commit and writing the job; no database outbox is claimed. Resolve that by checking the saved issue and deliberately requeueing only after confirming no alert was delivered. No historical reports are automatically broadcast when enabled.

Future production work: transactional DB outbox, database-backed verification attempts, stronger mechanic identity and retention for photos. None is required for this scoped demonstration.

## Verification

`pnpm --filter api exec vitest run src/issues/repairs.spec.ts` exercises scoped/tampered/expired links, OTP membership/limits/expiry/replay, LID mapping, queue persistence/idempotency and HTTP photo/resolve authorization. `pnpm test:repairs` exercises a real PostgreSQL issue, the HTTP flow with a local fake WhatsApp gateway, and receipt/history persistence without sending real messages. `pnpm test`, `pnpm typecheck`, `pnpm mobile:check` and `pnpm build` cover the application build.

Final live test after pairing: report a vehicle issue from the Android app; confirm exactly one group alert; open its link on a phone; receive the private OTP; add a photo/comment; resolve; confirm Completed repairs and the driver's history update. Also confirm a non-member number cannot receive a code and another issue cannot be changed with the verified token.
