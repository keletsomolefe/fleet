# Driver scheduling and administrator attention

Administrators can plan a driver on a vehicle by date, select weekdays in a week/month (or a range of up to 93 days), and cancel or override individual dates. The web schedule lives at `/admin/schedules`; the native administrator app includes the same range and weekday controls. This is a daily plan in Africa/Johannesburg, rather than an hourly shift roster. It uses the existing company, users and permissions.

There is one current planned vehicle per driver per date and one planned driver per vehicle per date. Database partial unique indexes enforce both rules. Requests serialize with driving/vehicle mutations. Saving an identical plan is idempotent. A conflicting plan first returns the exact assignments that would be replaced; an explicit override requires those IDs and a note. A stale preview is rejected. Old assignments retain their dates, creation/cancellation actors and timestamps; replacement assignments retain the override note.

## Driver confirmation

After sign-in, the driver sees today's scheduled vehicle and confirms its registration before starting a driving session. Restoring an already confirmed session on the same phone does not prompt again during that day. A renewed sign-in or a new calendar day requires confirmation. A schedule is never sufficient to start location sharing by itself.

If there is no schedule, manual selection remains available for unreserved vehicles. A driver cannot select a vehicle reserved for somebody else. Occupied vehicles still require the current driver to release them or administrator intervention. Existing vehicle flags continue to hold the vehicle until resolved.

A driver reports a schedule mismatch with a note and, optionally, an alternative vehicle from the searchable list. The report is saved once per driver/date. It ends that driver's current capture/driving segment and blocks further starts for that date until an administrator resolves it. Other drivers are not automatically removed from their vehicles.

The administrator can keep the current schedule, or assign the requested vehicle for the disputed date. A resolution requires a note plus snapshots of the driver's current plan, the requested vehicle's plan, and its active driving session. A changed plan or active handover prevents an unsafe override. If the requested vehicle has an active driver, that handover must be resolved first. If no alternative was requested, the administrator can edit the plan and then resolve the report by keeping the updated plan. The driver then refreshes and confirms the resulting allocation.

Changing today's plan pauses affected driving/location segments and requires a fresh confirmation. Future dates do not affect today's driving. A schedule change does not automatically resolve an open dispute.

Server-confirmed driving still requires daily confirmation. Offline capture can continue after midnight under the last known driver and truck; later samples are retained as unconfirmed history and excluded from normal latest positions. Operational logs also remain available across days and are reconciled after sync. This continuation does not extend a confirmed allocation. See [customer products and revenue](customer-products-and-revenue.md).

## Needs attention and MQTT

The administrator's **Needs attention** inbox combines unresolved driver issues, vehicle flags and schedule disputes, newest first. A red badge displays the total unresolved count; opening the inbox does not mark an unresolved item as fixed. The web menu shows the latest 20 items. Native administrators see the badge in the common header. The count and preview come from one database snapshot, and the full inbox includes all unresolved items.

Drivers use **Report an issue** on their vehicle screen for a vehicle problem, safety concern or other issue, with a required description of up to 2,000 characters. The report may refer to their current or today's scheduled vehicle; a report without a vehicle is also supported. Schedule problems retain the separate schedule-mismatch action and its driving controls. General issues do not automatically end driving or pause location sharing.

The report is committed through the authenticated mobile API before MQTT alerts are emitted. A client-generated report ID makes retries idempotent; the mobile form retains the same ID and payload after an uncertain response until it receives confirmation. Unsent reports are not queued for offline delivery and the draft does not survive closing the screen. Drivers see their latest 50 reports and can check for resolution notes. Both web and native administrators resolve an issue with a required note of up to 1,000 characters. The API retains the original report, resolution time and administrator, and rejects conflicting attempts to overwrite a resolution.

The consolidated `LaunchBaseline1793188800000` creates `app.driver_issues` with driver, optional vehicle and resolver foreign keys plus unresolved/history indexes. Existing vehicle-management permissions (`admin.access`, `trucks.read`, `trucks.write`) protect review, resolution and notification connections. Driver reporting/history requires an active driver profile and `driver.access`. Browser writes require the existing origin and session-bound CSRF checks; native writes use Kratos bearer sessions.

| API | Operation |
| --- | --- |
| `GET/POST /api/mobile/driver/issues` | Read own latest reports or submit `{ id, truckId, category, description }` |
| `GET /api/admin/issues` | List all unresolved driver issues |
| `POST /api/admin/issues/:id/resolve` | Resolve with `{ note }` |
| `GET /api/mobile/admin/issues` | Native administrator inbox |
| `POST /api/mobile/admin/issues/:id/resolve` | Native administrator resolution |

`category` is `vehicle`, `safety` or `other`; `truckId` is a current/scheduled vehicle UUID or explicit `null`. Caller-supplied driver, resolver and status fields are rejected. Own history includes `resolvedAt` and `resolutionNote`; review lists omit resolved issues. General issues and existing disputes remain separate records with their own resolution actions inside the combined inbox.

The existing MQTT WebSocket broker sends `attention.changed` invalidations to the administrator's own `fleet/admin/{userId}/attention` topic after a committed change. The API remains the source of the count and content. Notifications contain no driver or vehicle data. Clients fetch the current snapshot on subscribe, reconnect, foreground/focus and every 20 seconds, recovering missed messages and broker/API restarts. This is an in-app notification; it does not send an operating-system push notification when the app is closed.

A short-lived, single-use MQTT connection ticket is issued only to an authenticated administrator with vehicle-management permission. It is scoped to that user's topic, rechecks Kratos and local permissions at connection, and allows subscription only. Clients cannot publish administrator events, subscribe to another user's topic, or use a location-upload token for administrator subscriptions. Connections expire after two minutes and reconnect with a fresh ticket. Production uses WSS; native session credentials and browser cookies are not sent to the MQTT broker as its password.

Application data remains in `app` through TypeORM with synchronization disabled. The consolidated `LaunchBaseline1793188800000` creates the date plan, daily confirmation fields and schedule-dispute fields. Kratos continues to own sign-in and credentials. Fleet is pre-production, so local development migrations/data may be rewritten/reset.

## Verification

Run from the repository root:

- `pnpm db:migrate`
- `pnpm typecheck`, `pnpm mobile:check`, `pnpm test`
- `pnpm test:schedules` for live Kratos/PostgreSQL/HTTP/MQTT checks
- `pnpm test:issues` for driver reports, combined counts, MQTT delivery, native/web resolution, CSRF, access boundaries and concurrent retries
- `pnpm test:mobile` for the personal-phone and telemetry regression flow
- `pnpm test:tracking-queue` for real SQLite persistence and offline day boundaries
- `pnpm build`

Live tests create and remove random disposable accounts, profiles, schedules, vehicles and disputes. They cover confirmation, exact conflict previews, idempotence, permissions, stale resolutions, active handovers, MQTT topic isolation, durable counts and the midnight recording boundary. Real-device background and overnight acceptance still need an installed app on physical phones.

## Relationship to dispatch

A schedule reserves a driver/vehicle pair for a date. A dispatch assigns a particular trip, collection, delivery or other job to that pair. Several dispatches can use the same daily allocation. Creating a dispatch should suggest the scheduled driver after the planner selects its date and truck, while still recording the dispatch's own planned driver and vehicle.

Driver confirmation records the actual driving segment. A dispatch should later reference that segment for execution and location history; a schedule alone must not count as proof that the driver performed the job. Completed dispatches retain their original planned and actual resources.

A schedule override must not silently reassign dispatch work. Once dispatch is implemented, changes should flag affected unstarted dispatches for administrator review and explicitly reassign them when approved. Active work needs a controlled handover. Schedule mismatches and dispatch-allocation conflicts belong in the shared Needs attention inbox, with MQTT invalidation and the same unresolved-count badge.

The Dispatch route is currently a placeholder. This scheduling implementation does not create trips, jobs, dispatch reservations or automatic dispatch reassignment.

Verified locally on 2026-10-26: 93 API unit tests and 18 web unit tests; live driver-issue, scheduling/MQTT and personal-phone flows; five SQLite queue checks; application type checks/lint; full application build; Android/iOS exports. Authenticated Firefox review confirmed a driver report appears with a red count badge, opens in the shared inbox, and clears only after resolution. The issue flow covers concurrent duplicate reports, cross-driver isolation, vehicle checks, browser CSRF/origin checks, native/web resolution, audit history and counts beyond the 20-item preview. Temporary test accounts and reports are removed after verification. Physical-phone issue reporting and overnight/background acceptance have not been run.
