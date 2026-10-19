# Native device setup and driver login

Design source: [native setup and driver sign-in](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=140-5332). The section contains 12 editable VHH screens covering admin sign-in, truck selection, attachment review, replacement, success, empty search, connection failure, driver sign-in, registration confirmation and mismatch recovery. Screen IDs, construction recipe and prototype destinations are saved in [the design ledger](../design/mobile-device-setup-state.json).

## Device and account lifecycle

1. On the installed app, choose **Set up this device**, then **Administrator sign in**. Use an active, email-verified account with `admin.access`, `trucks.read` and `trucks.write`.
2. Search or browse active trucks and select the registration physically present. The app creates and retains a random installation identifier automatically; the setup screen does not ask for a device ID.
3. Review the registration and attach. Replacing an enrolled installation or moving a device requires explicit confirmation. A stale truck/device selection returns a conflict and must be refreshed.
4. **Driver sign in** revokes the administrator’s Kratos session. A driver uses their Driver ID and Kratos password. They need an active account, `driver.access` and an active driver profile; profiles and roles remain separate.
5. The driver checks the device’s current registration and confirms it. The API requires an active truck, current licence and complete, current PrDP. Confirmation records the driver, Kratos session and exact binding. A new login or changed binding requires confirmation again. Mismatch recovery asks the administrator to correct device setup.

Confirmation does not change the driver’s administrative truck assignment or create a shift, odometer reading or offline PIN. Confirmed drivers can explicitly start [background location sharing](background-location.md). Truck/driver record creation and editing remain in the [admin application](drivers-and-trucks.md).

## Authentication and persistence

Kratos creates, validates and revokes native session tokens. Passwords are forwarded only to its native password flow and never persisted. Native endpoints require bearer tokens, reject browser Origin/fetch metadata/cookie requests, and never accept a browser cookie as a fallback. Existing browser authentication and CSRF protection remain intact. Every protected request validates the active local user and current permissions; driver requests also check profile status and confirmation eligibility.

Session and device credentials use Expo SecureStore. The web preview does not store or submit them. The installation credential is 256 random bits; only its SHA-256 digest is stored on `app.truck_devices`, excluded from normal entity selection and all responses. Enrollment persists a pending secure credential before transmission so an interrupted response can be recovered by checking that credential on retry or restart. Changing truck bindings retains the existing association history. Replacing an installation clears the previous credential immediately.

No truck confirmation is trusted offline. Connection failures clear loaded driver confirmation; foregrounding the app revalidates it. Logout revokes the Kratos token before removing secure storage, keeping it available for retry if the server is unavailable. Native login has a bounded process-local per-source/identifier throttle (10 attempts/minute); deployments with multiple API processes should enforce a shared limit at the edge as well.

The migration `1792368004000-MobileDeviceEnrollment` adds enrollment metadata and `app.driver_truck_confirmations`. All application persistence uses TypeORM in `app`, with schema synchronization disabled. Kratos tables and its database role remain separate.

## Native API

All responses are private/no-store. The app calls these through the gateway:

| Endpoint | Access and purpose |
| --- | --- |
| `POST /api/mobile/auth/login` | Native password flow; `{identifier,password,mode: driver\|setup}` |
| `GET /api/mobile/auth/session` | Validated local user and current permissions |
| `DELETE /api/mobile/auth/session` | Revoke the bearer session |
| `GET /api/mobile/device` | Device credential; minimal truck context before sign-in |
| `GET /api/mobile/setup/trucks?q=&page=1` | Setup permissions; active trucks, 20/page, device availability |
| `POST /api/mobile/setup/device` | Setup permissions; truck ID, inventory identifier, installation secret, expected device ID and explicit replacement flag |
| `GET /api/mobile/driver/truck` | Driver permission/profile and installation credential; current eligibility/confirmation |
| `POST /api/mobile/driver/truck/confirm` | Same access; expected current association ID; idempotent per Kratos session/binding |

## Running and validation

Use pnpm from the root. `pnpm mobile:android` generates/builds/installs the native development client, and `pnpm mobile:ios` does the same for iOS. Use `pnpm mobile:reverse` to forward 8081 plus the configured gateway, Kratos public/admin/UI, Mailpit, PostgreSQL and MQTT ports. Root `.env` is the shared config; only the allowlisted public `EXPO_PUBLIC_API_URL` is exposed to the app. Loopback is the development default for Android with ADB forwarding and iOS Simulator. Physical iOS needs a reachable API URL. Release configuration requires HTTPS; the native development client allows local HTTP.

`pnpm mobile:check` runs lint and TypeScript checks. `pnpm test` includes request-boundary and credential validation tests. `pnpm test:mobile` creates random temporary fixtures and verifies native login, role isolation, enrollment, digest storage, replacement/rebinding, stale-state protection, idempotency, expired licences, inactive profiles/users, role revocation and logout. It removes its own identities, profiles, trucks, devices and confirmations. No reusable test account or credential is committed.
