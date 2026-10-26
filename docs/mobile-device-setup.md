# Personal phones and vehicle selection

Drivers use Fleet on their personal Android or iOS phones. A phone is never enrolled onto a vehicle. Kratos owns authentication; the application stores driving sessions, vehicle conflicts and authorization in the `app` schema.

Fleet is pre-production. The local database may be reset and migrations rewritten as the model evolves; existing development records do not require a production compatibility layer.

Design: [Personal phones, vehicle selection and dispute review](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=214-5367). The 14 editable screens cover sign-in, searchable vehicle selection, review, active driving, release, no selection, occupied vehicles, flagged conflicts, empty results, offline recovery, administrator flags, resolution and location sharing. The earlier device-enrollment designs remain as historical references.

## Driver workflow

1. Sign in with an email or Driver ID and Kratos password on the driver's own phone. Active driver permission and an active driver profile open driving. An administrator without a driver profile opens vehicle flags; an administrator who also has an active driver profile can drive and open flags from the driving screen.
2. Search the vehicle list by registration, fleet identifier, make or model. Only active vehicles appear, with Available, In use or Flagged for review status. Selection and changes require a connection. Driver licence and PrDP eligibility are checked again when driving starts.
3. Review the registration and choose **Start driving**. The server creates an immutable driving-session ID. At most one active driving session exists per vehicle and per driver. A lost response can be retried with the same request ID.
4. **Change vehicle** closes the old session and starts the selected available vehicle atomically. A stale selection fails without replacing the server's current session. Location sharing stops locally before switching; sharing on the next vehicle requires an explicit start.
5. **Finish driving** stops local capture, closes the server session and its tracking streams, and releases the vehicle. Sign-out also closes sessions belonging to that sign-in. Logout does not release a newer sign-in's session. After signing in again, the same authenticated driver may explicitly confirm and continue their own vehicle or finish their own session. Continuing closes the old segment and creates a new one, stopping capture on the older sign-in when it reconnects. This never permits takeover of another driver's session or bypasses an open dispute.

Administrative truck assignments remain planning records. Choosing a vehicle does not rewrite them. Driving sessions do not create mileage photos, shift records, trips or jobs; those prototype workflows remain separate features.

## Occupied vehicles and disputes

Drivers cannot force a takeover. An occupied vehicle's review screen offers **Flag for review** and **Choose another vehicle**. The flag operation checks the exact session reviewed. If a vehicle becomes occupied between selection and submission, the API denies the start and commits a conflict flag before returning HTTP 409. Repeated attempts share the same open flag for that driver and vehicle.

An open flag prevents new driving sessions even after the previous driver releases the vehicle. The current driver is not automatically displaced by someone else's report. Vehicle flags are available to administrators in the native app and at `/admin/vehicle-disputes`. Resolving requires `admin.access`, `trucks.read`, `trucks.write`, a resolution note and the expected current session ID. The administrator may retain the current driver or release the vehicle. The server records resolver, time, action and note, resolves the vehicle's open flags together, and never assigns the reporting driver automatically. That driver must refresh and explicitly select the vehicle again.

Session changes, releases, conflict flags and resolution serialize with the same transaction-scoped lock as fleet asset edits. Partial unique indexes enforce active driver and vehicle exclusivity independently of application code. All application persistence uses TypeORM with synchronization disabled. Migration `1793016000000-PersonalPhoneDriving` adds the new tables and tracking links while preserving existing device, binding, confirmation and location history. Reverting refuses to discard personal-phone tracking history.

## Authentication and storage

Native endpoints require bearer authentication, reject browser Origin/fetch metadata/cookie requests, and validate current local user status and permissions. Browser authentication and its CSRF protection are unchanged. Web dispute resolution additionally requires the browser session-bound CSRF token and allowed origin.

Kratos tokens use Expo SecureStore. Passwords are never persisted. The provider revalidates on foreground and periodically while active. An unreachable server prevents selecting a new vehicle; confirmed local tracking may retain records offline until the server can revalidate it. See [location capture, boundaries and platform limits](background-location.md).

Legacy device-enrollment and truck-confirmation endpoints return HTTP 410 with an update message. Legacy mobile routes redirect to the new workflows. Existing app identifiers and SecureStore namespace remain stable. The upgrade stops legacy capture without relabelling queued history or deleting the old installation credential needed to upload older records.

## Native API under `/api/mobile`

| Endpoint | Purpose |
| --- | --- |
| `POST auth/login` | `{identifier,password}`; server returns permission/profile-derived navigation mode |
| `GET/DELETE auth/session` | Validate access or end this sign-in's driving sessions and revoke Kratos authentication |
| `GET driver/context` | Current driver, selected vehicle, session ownership and eligibility |
| `GET driver/vehicles?q=&page=` | Search active vehicles and occupancy, 20 per page |
| `POST driver/driving-sessions` | `{id,truckId,expectedOwnSessionId}`; start or atomically switch |
| `POST driver/driving-sessions/end` | `{sessionId}`; idempotent release of the authenticated driver's own session |
| `POST driver/vehicles/:id/flag` | `{sessionId}`; flag the reviewed occupied session |
| `GET driver/vehicle-disputes` | The driver's open flags |
| `GET admin/vehicle-disputes` | Administrator review queue |
| `POST admin/vehicle-disputes/:id/resolve` | Expected current session, resolution and required note |

The browser administrator API exposes the last two operations under `/api/admin/vehicle-disputes`. All responses are private/no-store. Driver selectors expose only the operational vehicle and occupant details needed to choose or flag a vehicle; credentials are excluded.

## Running and verification

Use pnpm from the repository root and the root `.env` for shared configuration. Run `pnpm db:migrate`, `pnpm mobile:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:tracking-queue`, `pnpm test:mobile` and `pnpm build`. Live tests require the local Kratos, PostgreSQL, gateway and MQTT broker. They create random temporary identities, users, drivers, vehicles and records, then remove their own fixtures; no reusable account or password is committed.

Use `pnpm mobile:android` or `pnpm mobile:ios` for an installed native build. `pnpm mobile:reverse` forwards the configured development ports for Android. Only `EXPO_PUBLIC_API_URL` is exposed from the root `.env`; release builds require HTTPS. Physical-phone background/battery/permission acceptance remains a separate device check.

## Daily schedules

Administrators can now [schedule drivers by date and weekdays](driver-scheduling.md). Drivers confirm today’s planned vehicle, or report a mismatch for administrator resolution. Needs attention badges and MQTT updates cover both schedule and occupied-vehicle disputes. The earlier Figma snapshot shows the manual-selection journey before scheduling was added.
