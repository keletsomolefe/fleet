# Customer products, driver activity and truck earnings

Fleet uses a shared product catalogue. A customer-product association records whether that company supplies or receives the product, and links its transport agreements. The paying customer is independent of the supplier and receiver. Locations may belong to several customers, or be shared sites. Archive catalogue records rather than deleting referenced history.

## Rates and quantities

Owners and authorised administrators use **Transport rates**. Rates are effective-dated versions, with an optional exact collection/delivery route. A matching route rate takes precedence over the customer-product default. A transaction-scoped lock prevents overlapping periods. End an existing period before adding its replacement; price, route, method and unit are immutable once created.

Quantity rates use collected or delivered quantities. Compatible conversions are tonnes/kilograms and litres/cubic metres. Pallets and items are distinct measures. There are no inferred densities, pallet weights or capacity-based earnings. Fixed rates apply once per delivery. Calculations use scaled integer arithmetic and round half-up to cents; PostgreSQL stores financial values as numeric decimals.

Collection is operational activity, not a second charge. Each offload has a stable record ID and one current charge. Multi-stop collections have explicit destination shares. Standalone offloads may carry their own collected share. Missing or inconsistent shares are flagged without preventing capture. Failed, cancelled, voided and explicitly uncharged deliveries do not contribute automatic revenue.

A delivery snapshots the applicable rate using its Africa/Johannesburg event date. Subsequent agreement changes leave that snapshot intact. An authorised reviewer can explicitly reprice, with the previous and new charge retained in the audit. Company-owned goods without an agreed transport charge remain uncharged; product selling prices are not transport income.

## Logging and review

The native **Jobs & activity** screen supports collections, offloads and fuel, from downloaded dispatches or manual entries. Drivers can change actual operational details and type missing customer, product or site names. Those names stay in the original revision; operations matches the reviewed record to the catalogue. Drivers do not receive rates or revenue.

`activity_revisions` preserves submissions and conflict evidence. `transport_records` holds the reviewed operational interpretation. `transport_charges` holds the separate financial projection. Office actions require the expected version, decision and reason. Conflicting revisions never silently replace corrections. Linked collection changes refresh affected estimates and return financially changed deliveries to review.

Estimated revenue includes priced, completed and partial deliveries awaiting review. Validated revenue is a subtotal, not additional revenue. Unpriced deliveries stay visible outside monetary totals. Fuel litres and amount paid are separate purchase totals; no per-delivery fuel consumption or profit is inferred.

Monthly reports include customer, product and delivery breakdowns. Revenue uses delivery time, fuel uses purchase time, and late uploads return to their original operational month. Reports cover synced records and show the latest stored update per truck. Currency is ZAR.

## Offline recording and synchronisation

Operational logs and drafts use `fleet-activities-v1.db`, alongside the existing GPS queue. Save commits the entry and upload event in one SQLite transaction before reporting success. Reference data, dispatches and site directions are cached without rates. Typed entries remain available when the catalogue is incomplete. GPS capture does not need network coverage; an unavailable fix does not block an operational log. Offline road-map tiles and navigation are outside this version.

First sign-in and vehicle changes require the server. A previously signed-in driver can reopen offline with the cached driver/vehicle context and continue over midnight. This does not create or extend a confirmed driving session or reserve a truck. Records outside the confirmed interval are marked unconfirmed. Personal-phone GPS beyond its confirmed interval is retained with `unconfirmed=true` and excluded from normal latest-position results. A valid server response ending access stops new capture; an offline phone learns changes on reconnection.

Recording capabilities are random, append-only, scoped to one immutable driver/truck context and stored in SecureStore. Only their hashes enter PostgreSQL. They support delayed uploads after sign-in expires and do not allow catalogue reads, account access or financial changes. Logout and vehicle transitions stop the current context while retaining older capabilities for pending uploads.

Sync runs after saving, on launch/foreground, on network reconnection, every 15 seconds while foregrounded, and through Expo background opportunities. Persisted retries are capped at five minutes. **Sync now** bypasses retry delays. Batches are bounded; immutable IDs and per-event receipts make unknown-result retries idempotent. PostgreSQL commits before acknowledgement. Rejected records remain for correction/retry. Background scheduling and GPS delivery remain subject to the operating system; physical-device acceptance is required.

## Interfaces and access

Browser APIs under `/api/admin/transport`: `catalogue`, `master/:kind`, `rates`, `dispatches`, `records`, `records/:id/review`, and `earnings?month=YYYY-MM&truckId=`. They use existing Kratos authentication, current permissions, private responses and origin/session-bound CSRF protection.

Native APIs under `/api/mobile/transport`: authenticated catalogue/dispatch downloads, context creation and review-result downloads; capability-authenticated `batches` use `X-Fleet-Recording-Token`. Drivers retain operational access; pricing and revenue permissions default to Owner and Administrator. Dispatchers manage plans and operational catalogue entries without rates or revenue.

## Pre-launch baseline and local reset

`LaunchBaseline1793188800000` replaces the earlier application migration chain, including driver issues. It contains the final existing schema plus transport tables and permissions. TypeORM synchronization stays disabled. A database with the former migration history must be reset before applying it.

From the repository root:

```sh
pnpm db:reset --yes
```

This deletes only the local `app` schema, recreates it with the existing application role, applies the baseline and reuses the marked Kratos bootstrap identity. Kratos identities, credentials, schema, extensions and database-role isolation remain intact. Other disposable test identities may remain in Kratos without application profiles. Historical phone queues referring to deleted development profiles require an explicit development reset; normal app restarts and updates preserve pending data.

## Verification

```sh
pnpm typecheck
pnpm mobile:check
pnpm test
pnpm test:transport
pnpm test:activity-queue
pnpm test:tracking-queue
pnpm test:admin
pnpm test:fleet
pnpm test:schedules
pnpm test:mobile
pnpm test:issues
pnpm infra:test
pnpm build
```

Transport tests use random disposable records and clean them up. Queue tests use real SQLite files and simulate restart, failed commits, unknown-result retries, rejected entries and multi-day capture. Before release, use installed Android and iOS apps for a real route without coverage, overnight continuation, reconnect/drain, permissions, battery restrictions, app termination and storage pressure.

Verified locally on 26 October 2026: 98 API and 18 web unit tests, two API end-to-end tests, authenticated transport rendering/upload checks, transport database scenarios, both SQLite queue suites, admin/fleet/scheduling/MQTT/mobile/driver-issue regressions, infrastructure isolation, type checks, mobile lint, full build and Android/iOS exports. No Android device was connected and the paired iPhone was unavailable; physical route and overnight acceptance remain outstanding.
