# Logistics tracking, shift mileage, expenses and month-end earnings

Fleet tracks each vehicle's full operational day — from clock-in odometer reading through pickups, deliveries, fuel purchases, road expenses, and breakdown repairs — into an audited month-end revenue and spend estimate in ZAR.

## Domain model (`apps/api/src/modules/transport/` & `apps/api/src/modules/driving/`)

- **Master catalogue (`catalogue.entity.ts`)**:
  - `Customer`: companies hauled for, including `industry` (what they deal in), contacts, and archive state.
  - `Product`: shared commodity catalogue (`tonne`, `kg`, `litre`, `m3`, `pallet`, `item`).
  - `CustomerProduct`: links customers to products with `supplies` and `receives` flags.
  - `Location`: reusable collection, delivery, fuel station, and yard sites linked to one or more customers (or shared sites), with directions and optional GPS coordinates.
- **Effective-dated transport rates (`rate.entity.ts`)**:
  - Scoped to a `CustomerProduct` and optional exact `origin → destination` route (exact route takes precedence over default).
  - Supports quantity-based (`collected` or `delivered` basis) or fixed per-delivery pricing using scaled BigInt arithmetic (`1_000_000n`) rounded half-up to cents.
  - Transaction-scoped advisory lock (`fleet-transport-rates-v1`) prevents overlapping date windows.
- **Dispatches (`dispatch.entity.ts`)**:
  - Multi-stop load plans assigned to a driver and vehicle, downloaded to the driver app for one-tap pickup and delivery logging.
- **Shift odometer & mileage proof (`driving-session.entity.ts`)**:
  - Drivers capture `startOdometerKm` + dashboard photo (or missing-photo reason) when starting work on a vehicle, and `endOdometerKm` + photo (plus required reason if lower than start) when finishing or switching vehicles.
  - `computeShiftDistanceKm()` never computes negative distances; `evaluateShiftMileageFlags()` flags missing photos, missing readings, or lower end readings for office review in **Shifts & mileage** (`/admin/shifts`).
- **Offline driver activities & proof photos (`activity.entity.ts`)**:
  - Four activity kinds: `collection`, `delivery`, `fuel`, and `expense` (`toll`, `repair`, `tyres`, `weighbridge`, `parking`, `permits`, `other`).
  - Captures waybill/POD/weighbridge ticket numbers, collected vs. delivered tonnage (flagging `>2%` shrinkage/overage via `weight_variance_alert`), optional dwell timestamps (`arrivedAt`/`departedAt`), odometer km, GPS, and private photos (`TransportAttachment` in `.fleet-data/transport/`).
  - Immutable `ActivityRevision` history and `TransportAudit` trail preserve original driver entries and office review decisions.
- **Expenses & month-end P&L (`expense.entity.ts`, `earnings.service.ts`)**:
  - Office/admin staff record workshop invoices, fuel statements, tyre replacements, tolls, insurance, and licensing in `TruckExpense` (`/admin/expenses`).
  - Month-end **Truck earnings** (`/admin/earnings`, plus CSV export) automatically aggregates by `Africa/Johannesburg` operational month:
    - **Estimated Revenue**: priced deliveries (`validated` + `awaitingReview`, with unpriced count surfaced separately).
    - **Fuel / Petrol Spend**: driver fuel records + office fuel expenses + fuel-type service jobs (litres, R/L, km/L).
    - **Repairs & Maintenance Spend**: completed/closed `service_jobs.completionCostCents` + driver road repair/tyre expenses + office repair/tyre/maintenance invoices.
    - **Other Operating Spend**: tolls, weighbridge, permits, parking, insurance, licence, and other expenses.
    - **Estimated Net Margin**: `Estimated Revenue − (Fuel + Repairs + Other Spend)` alongside total tonnes moved, valid shift km driven, and R/km.

## Mobile offline synchronization (`apps/mobile/src/activities/`)

- Local SQLite database `fleet-activities-v1.db` (`WAL`, `synchronous=FULL`) stores contexts, events, records, queued photos (`activity_attachments`), cached catalogue/dispatches (without rates or revenue), and form drafts.
- Capability tokens (`X-Fleet-Recording-Token`) are stored in `expo-secure-store` (only SHA-256 hashes enter PostgreSQL with `.hidden()`), allowing delayed background sync (`fleet-activity-upload-v1`) even after a driver's login session expires.
- Photos are copied into persistent app document storage (`fleet-photos/`) and uploaded via multipart after their parent activity record has synced.
