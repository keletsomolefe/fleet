# Driver location logging

The native app uses free, open-source Expo Location, TaskManager, SQLite, BackgroundTask and MQTT.js. The API runs an Aedes WebSocket broker. No paid background-location licence or hosted broker is required. The editable [location-sharing designs](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=144-4641) cover stopped, online, offline and permission recovery states.

## Capture and durability

After signing in on a personal phone and starting a driving session, the driver explicitly starts sharing and grants precise foreground and background location access. Android displays an ongoing foreground-service notification. The target interval is ten seconds; operating-system scheduling and GPS availability determine actual delivery. Stop sharing, finish driving, vehicle change, logout, another account login or a validated loss of access stops capture. A network outage alone does not stop it. Kratos session validity is checked for active-stream uploads. Expired/revoked access ends server capture acceptance; saved records remain available for upload within their original session boundary. Stop and sync controls remain available on the login screen.

Each callback is written to the app-private SQLite database before upload. WAL, full synchronous writes, transactional sequence allocation, immutable event UUIDs and stream ownership preserve delivered fixes across process restarts. Original Expo payloads retain timestamps, altitude, accuracy, speed, heading and mock-location indicators. Poor-quality fixes are preserved. Delayed callbacks use their capture timestamps to retain the original driver attribution; records that cannot be attributed are retained locally for investigation.

MQTT uses QoS 1 and a receipt topic scoped to the immutable tracking stream. A broker PUBACK does not acknowledge local records: only an application receipt returned after the PostgreSQL transaction commits does. HTTP fallback sends the same IDs, making unknown-result retries idempotent. Persisted exponential backoff, foreground/network retry, background upload opportunities and **Sync location log** drain the queue. Batches are bounded by record count and payload size. Rejected records remain locally blocked with a visible review message. Unacknowledged and unattributed records are never automatically pruned; acknowledged local records are retained for seven days. Backend history has no automatic retention deletion.

Each stream closes with a final sequence number. The integrity endpoint reports missing sequences separately from complete uploads. Complete upload means every sequenced record arrived; it does not prove continuous GPS coverage. Gaps longer than two minutes between delivered fixes create explicit status records. Storage failures stop collection and surface an error rather than silently acknowledging records.

## Authentication and backend

Kratos owns driver login. Starting a stream requires a currently authorized driver and that sign-in's active driving session. The phone persists a random upload capability in SecureStore before starting; only its SHA-256 hash is stored on the server. It can upload only to that exact stream. Each historical stream retains its capability across logout and vehicle changes, so later uploads cannot be relabelled as the new driver or vehicle. No passwords or capabilities enter SQLite. Android backup is disabled. Legacy installation credentials are used only to drain historical streams; old device-enrollment endpoints are retired.

The consolidated `LaunchBaseline1793188800000` migration creates `app.tracking_streams` and `app.tracking_events`, with schema synchronization disabled. Each event stores capture/receipt times, sequence, original payload and a canonical digest. It includes a driving-session link and upload capability hash, with optional legacy device/association fields. A database constraint requires one complete source model. Existing streams, associations and events are preserved. Foreign keys retain driver and vehicle ownership. Application receipts require synchronous PostgreSQL commit. PostgreSQL backup, disk capacity and disaster recovery remain deployment responsibilities.

| Endpoint under `/api` | Purpose |
| --- | --- |
| `GET mobile/telemetry/config` | Stream-capability MQTT connection settings |
| `POST mobile/telemetry/streams` | Authorized driver starts an idempotent stream for the active driving session |
| `POST mobile/telemetry/batches` | Stream-capability HTTP fallback and durable receipts |
| `GET admin/telemetry/latest` | Latest valid-session fix per vehicle, with stale flag |
| `GET admin/telemetry/trucks/:id/streams` | Recent streams and counts |
| `GET admin/telemetry/streams/:id/integrity` | Final sequence, received count and missing ranges |
| `GET admin/telemetry/trucks/:id/history?from=&to=&cursor=` | Chronological raw records and GeoJSON, 1,000 per page |

Admin endpoints require `fleet_map.read`. History supports a maximum 31-day date window and snapshot-bound keyset pagination, retaining fixes that arrive late. It exposes original driving-session or legacy binding dates. Releases close associated streams at the server timestamp. Fresh uploads outside that interval are rejected and retained locally for review. Delayed records captured before release can still upload with their original attribution. Historical legacy out-of-interval records remain visible with flags; latest positions exclude them. These endpoints provide map data; a new live admin map renderer is not included.

## Local development and deployment

Keep configuration in the root `.env`: `MQTT_ENABLED`, `MQTT_WS_PORT` (1884), `MQTT_BIND_HOST` (127.0.0.1) and `MQTT_PUBLIC_URL` (`ws://127.0.0.1:1884/mqtt` locally). `pnpm mobile:reverse` forwards MQTT along with Metro, API and infrastructure ports. Re-run it after an ADB reconnect. The mobile config exposes only the public API URL; stream-authenticated config supplies the broker address.

Production requires HTTPS for the API and WSS for MQTT. Put a TLS WebSocket reverse proxy in front of the loopback broker's `/mqtt` path and set the public WSS URL. The embedded broker runs in one API process; multi-process broker routing/high availability is not configured. Its memory is transport state, while SQLite and PostgreSQL hold durable records. Provision monitoring, database backups and storage alerts for a production deployment.

## Platform limits and validation

Expo does not provide the paid native SDK's complete terminated-process/reboot behavior. Android force-stop, device shutdown, permission removal, vendor battery restrictions, GPS loss, full storage and uninstall can prevent new fixes. Reopening the app reconciles an existing sharing intent when permissions remain available. BackgroundTask scheduling is opportunistic, not a precise upload timer. Never describe this implementation as guaranteed continuous tracking or zero data loss.

`pnpm test:tracking-queue` exercises actual SQLite persistence, reopen/retry, receipt validation, disk transaction rollback, delayed callback attribution and gap preservation. `pnpm test:mobile` exercises real local Kratos, PostgreSQL, HTTP and MQTT, including personal-phone session ownership, blocked concurrent vehicle selection, persisted disputes, administrator-only resolution, idempotent starts, per-stream upload credentials, durable receipts and unconfirmed capture-time classification after release. The Android development build includes all native modules. Synthetic integration tests do not replace a physical driving/background/battery/reboot acceptance test.

Delivery checks on 19 October 2026: 62 API and 10 web unit tests, API/web types, mobile lint/types, SQLite durability scenarios and the production API/web build passed. Live telemetry integration passed before the final refinements; its final rerun was blocked by an unresponsive Docker daemon. Android was built and installed with Java 17. iOS was built and installed on an iPhone 17 Pro simulator; fresh startup, toolbar logo and launcher icon were visually verified, and the final iOS production bundle passed. Tasks register synchronously through `apps/mobile/index.js`, before Expo Router. Physical route capture, permission transitions and terminated/reboot behavior still need device acceptance testing.

Official platform references: [Expo Location SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/location/), [SQLite](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/), [TaskManager](https://docs.expo.dev/versions/v58.0.0/sdk/task-manager/) and [BackgroundTask](https://docs.expo.dev/versions/v58.0.0/sdk/background-task/).

Personal-phone update, 26 October 2026: selecting, changing or releasing a vehicle requires the server; starting a new session offline is not permitted. Local capture stops before driver-initiated release/switch/logout. An offline phone cannot learn an administrator's release immediately; on reconnect the server retains post-cutoff personal-phone samples as unconfirmed and the receipt stops local capture. Those samples remain attributed to their original context and are excluded from normal latest positions. Location sharing on a newly selected vehicle always needs an explicit start. Physical-phone background and privacy acceptance still needs validation on the supported devices.
