# Drivers, trucks and devices

Design source: [VHH driver creation](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=10-917), [driver profile](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=7-1194), [truck creation](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=10-1060), and [truck list](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=7-1344).

`/admin/drivers` and `/admin/trucks` provide searchable, paginated lists, status filters, creation, and editable detail pages. Forms extend the Figma layout with operational fields; prototype-only instructions, example data, simulated telemetry, PIN preparation and session records are omitted. Truck assignment history is explicitly distinct from actual driving/shift sessions.

## Driver onboarding

Create a profile for an existing active company user or create a new account inside the driver form. The same user may also be an administrator or terminal operator. A user can have only one driver profile. The profile records a unique driver identifier, phone, licence number/code/issuing country/expiry, optional paired PrDP number/expiry, paired emergency contact name/phone, driver status, current truck and notes.

Creating a new account additionally requires `users.create`. Kratos stores the credentials and requires email verification. New application users have no roles. Use **Manage account access** on the saved profile to grant the Driver role, or a combination of roles, through the existing access-management flow. The account card shows the actual Driver app permission separately from account status. Profile creation neither replaces existing roles nor grants administrative access.

Driver status is operational profile status. Set it to Inactive and save to release the truck; account-wide status and role changes remain in user access management. The [native app](mobile-device-setup.md) checks active user, `driver.access`, profile status and eligibility for truck confirmation. It implements online Kratos sign-in and administrator device enrollment. Offline PIN credentials, password resets and shift records remain outside this phase.

Assigning a truck requires an active profile, active user, active truck, unexpired licence and a complete, unexpired PrDP. These are operational checks, not a determination that a licence code legally permits a particular vehicle; record and verify licence suitability separately. Unassigned profiles may retain expired credentials so they can be renewed. Expired dates are labelled in the list/profile. Each truck has at most one current assigned driver. Historical assignment rows retain truck, driver, actor and start/end timestamps.

## Trucks and devices

Required fields: identifier, registration, country, make, model, type, fuel, odometer and availability. Optional fields: year, VIN, engine number, transmission, axles, gross vehicle mass, tare, payload, tank capacity, licence disc/roadworthy/insurance expiries, insurer/policy, service interval/next service reading, device identifier/serial and notes. Mass, mileage and service readings are integer kg/km; fuel capacity is litres. VINs use 17 characters excluding I, O and Q. Registration, identifiers, VINs, licence numbers and device identifiers are normalized for case. VIN, registration, identifier, device identifier/serial and country+licence number conflicts are rejected.

Odometers cannot decrease. Tare plus payload cannot exceed recorded gross vehicle mass. A truck cannot enter maintenance/inactive status while a driver remains assigned; first release it on the driver profile. Compliance dates are recorded and expired dates highlighted; they do not automatically change availability. Service status compares the current reading with the next recorded service reading. Recording a past expiry is allowed for accurate fleet records.

Device identifier and serial are inventory facts, not authentication credentials. A device belongs to a truck. Changing a binding closes its prior history row and opens a new association; removing the identifier unbinds it. Reusing a device on another truck requires explicitly unbinding it from the old truck first. The device's globally unique identifier identifies the inventory record. Device association history remains on each truck after transfer. This does not enroll or authenticate hardware, provision devices, track last contact, or integrate a tracker.

## Storage and authorization

Apply `pnpm db:migrate`. The explicit `FleetProfiles1792368003000` migration creates `app.trucks`, `app.truck_devices`, `app.driver_profiles`, `app.driver_truck_assignments`, and `app.device_truck_associations`. TypeORM synchronization remains disabled; Kratos schema/role isolation is unchanged. Foreign keys retain history and actors. Unique constraints and partial unique indexes back current assignments/bindings. Related mutations serialize under a transaction-scoped advisory lock. New-account provisioning saves the user and driver in one database transaction and attempts to delete only its newly created Kratos identity if that transaction fails.

`drivers.read`/`trucks.read` control list/detail access. Creation and editing additionally require `drivers.write`/`trucks.write`; the migration grants these to Owner and Administrator. Dispatchers retain read-only access. Existing `users.access` and `users.owners` restrictions apply through user access management. Driver write access includes minimal user and available-truck selectors without granting the entire user-management catalog. Selectors search up to 20 records at a time. Protected requests re-check the Kratos session and local permissions, use private/no-store responses, and require origin plus session-bound CSRF tokens for writes.

| API | Operation |
| --- | --- |
| `GET /api/admin/drivers?q=&page=1&status=` | Search profiles, 20 per page |
| `POST /api/admin/drivers` | Create using exactly one of `userId` or `account` |
| `GET/PATCH /api/admin/drivers/:id` | Read or replace editable profile fields |
| `GET /api/admin/drivers/users?q=` | Active users without a driver profile |
| `GET /api/admin/drivers/trucks?q=&driverId=` | Active, available trucks (including this driver's current truck) |
| `GET /api/admin/trucks?q=&page=1&status=` | Search trucks, 20 per page |
| `POST /api/admin/trucks` | Create truck and optional device binding |
| `GET/PATCH /api/admin/trucks/:id` | Read or replace editable truck fields and binding |

PATCH inputs are complete editable form payloads. Unknown fields are rejected. User identity/roles cannot be changed through profile PATCH. Assignment and binding transitions append/close history within the same transaction; no deletion APIs are provided. Operational dates use Africa/Johannesburg for expiry checks and displayed history times.

## Verification

Run from the repository root: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:admin`, `pnpm infra:test`, and `pnpm test:fleet`. Live checks require the migrated local stack and gateway. Fleet tests create random disposable data, use runtime-generated passwords, and remove their own application records, identities and mail. They cover account/profile atomicity, validation, duplicates, CSRF, concurrent assignment conflicts, device transfers, history, role-based write protection, and server-rendered routes.
