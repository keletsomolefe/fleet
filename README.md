# VHH Fleet POC

## Development

This repository uses pnpm workspaces and Watt to run three applications:

| Workspace | Stack | Gateway route |
| --- | --- | --- |
| `apps/api` | NestJS 12 | `/api` |
| `apps/web` | TanStack Start v1 / React | `/` |
| `apps/gateway` | Platformatic Gateway | Public entrypoint |

The native Expo app in `apps/mobile` runs separately. Root `pnpm dev`, `pnpm build`
and `pnpm start` exclude it from Watt; root tests and typechecks also skip it.
Use `pnpm mobile:reverse` and `pnpm mobile:android` from the repository root to build/install on Android, then `pnpm mobile:start` for subsequent runs. See [native device setup and driver login](docs/mobile-device-setup.md). `pnpm mobile:check` runs its lint and type checks.

Use Node.js 22.19 or newer, pnpm and Docker Compose. From the repository root:

```sh
make setup # install dependencies and generate local development secrets
make up    # PostgreSQL, Ory Kratos, login UI and Mailpit
make dev   # Fleet API, web and gateway
```

Set `BOOTSTRAP_ADMIN_PASSWORD` in the root `.env` before `make up`.
Open <http://127.0.0.1:3042> (or <http://localhost:3042>) for Fleet admin.
Change `GATEWAY_PORT` in `.env`
if that port is already in use.

```sh
make build         # build all applications through Watt
make start         # run the production build through the gateway
make typecheck     # check API and web TypeScript
make test          # run API unit tests
make test-e2e      # run API end-to-end tests
make infra-test    # check database isolation and Kratos authentication
make help          # show all commands
```

Development login is at <http://127.0.0.1:3042/login>; verification and recovery
emails appear at <http://127.0.0.1:18025>. PostgreSQL uses one `fleet` database
with isolated `kratos` and `app` schemas and separate roles. See the
[development infrastructure guide](docker/README.md) for ports, migrations,
database access and authentication behavior.

See [admin authentication and UI foundation](docs/admin-authentication.md) for
account provisioning, TypeORM migrations, Kratos sessions/hooks, shadcn/ui and live tests.

The apps were added using `wattpm add`, with the latest NestJS and TanStack
CLIs generating the framework starters. TanStack packages stay on stable v1.
Watt 3.72's Nest adapter accepts NestJS 11 only, so the API uses Watt's Node
adapter with a Nest application factory in `apps/api/src/watt.ts` to support
NestJS 12, including rebuilding on changes and closing the app on shutdown. The
gateway forwards `/api` to NestJS and all other routes to TanStack Start.
The API uses the latest TypeScript 6 because Nest CLI requires its compiler API;
the web app uses TypeScript 7. Nitro writes the web production build to `.output/`.
Existing design documentation and assets remain at the repository root.

## Prototype documentation

Final agreed requirements, reconstructed brand assets and an editable Figma prototype for one fleet business. Updated 17 October 2026.

Latest extension: the native app supports admin device enrollment, truck attachment/replacement, driver sign-in and registration confirmation. Its [12 new editable Figma states](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=140-5332) are recorded in [the native design ledger](design/mobile-device-setup-state.json). The preceding Customers and Locations extension remains recorded in [customer/location state](design/customer-location-state.json) and [its journey checks](design/customer-location-audit.json).

## Documents

- [Functional specification](FUNCTIONAL_PLAN.md) — numbered requirements, permissions, fields, states, offline rules and acceptance scenarios.
- [Market research](MARKET_RESEARCH.md) — six fleet products, official sources and specific offline limitations.
- [Design direction](DESIGN_DIRECTION.md) — LinkAToday and Mobbin references, approved B + C layouts, typography and SVG icons.
- [Full visual review](design/VISUAL_REVIEW.md) — all 128 screens, refinement details and before/after evidence.
- [Verification record](design/VALIDATION.md) — prototype journeys, native-layer checks and limits of this phase.
- [Design files and state](design/README.md) — build recipes and final Figma node ledger.

## Figma

[Editable design file](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=5-1864): Foundations, Driver App and Web Admin. There are 87 driver screens/states and 87 admin screens/states, plus reusable foundations and exploration/reference boards.

The 174 screens are grouped in 25 journey sections: 11 driver and 14 admin. The driver prototype has 13 named starting points; admin has 14. Read each row left to right, then continue on the next row; recovery states follow their main journey. The [organization baseline](design/organization-validation.json) records the earlier 19 passing journey checks. The [latest admin audit](design/customer-location-audit.json) covers the customer/location extension, with no invalid destinations, unreachable screens or overlapping frames.

The driver checks the truck already assigned to the device by admin before a new session, then continues to clock-in. This does not select another truck. If the registration does not match the physical truck, the driver asks the fleet administrator to correct the device assignment. PIN unlock resumes an existing active session directly.

| Entry | Open prototype |
| --- | --- |
| Native admin device setup | [Set up a truck device](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=140-5333&starting-point-node-id=140%3A5333&scaling=contain) |
| Native driver sign-in / confirmation | [Confirm assigned truck](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=140-6059&starting-point-node-id=140%3A6059&scaling=contain) |
| Driver sign in / delivery | [Start driver journey](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=5-1555&starting-point-node-id=5%3A1555&scaling=contain) |
| Customers / contacts / sites | [Open Customers](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=76-5610&starting-point-node-id=76%3A5610&scaling=contain) |
| Saved customer and shared locations | [Open Locations](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=76-11006&starting-point-node-id=76%3A11006&scaling=contain) |
| Customer dropdown in job planning | [Try customer selection](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=76-12652&starting-point-node-id=76%3A12652&scaling=contain) |
| Admin sign in / dispatch | [Start admin journey](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=7-21&starting-point-node-id=7%3A21&scaling=contain) |
| Offline capture / retry | [Start offline journey](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=5-1744&starting-point-node-id=5%3A1744&scaling=contain) |
| Driver handover | [Start handover journey](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=5-2889&starting-point-node-id=5%3A2889&scaling=contain) |
| Admin investigation | [Start investigation](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=7-814&starting-point-node-id=7%3A814&scaling=contain) |
| Vehicle issue / ad hoc report | [Choose a report type](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=5-2711&starting-point-node-id=5%3A2711&scaling=contain) |
| Start shift / mileage proof | [Record clock-in](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=34-2523&starting-point-node-id=34%3A2523&scaling=contain) |
| Admin shift readings / photos | [Review mileage](https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=36-2276&starting-point-node-id=36%3A2276&scaling=contain) |
| Truck context scroll states | [Open the behaviour board](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=40-3191) |

Use the labelled controls and prefilled fictional scenario. Cross-role demonstration links open the other role in a new tab. Editable inputs and signatures are visual prototype states, not live data entry or credential validation.

The approved driver direction combines a Todoist-inspired Today list with clear stop details. Small Montserrat type, black-and-white controls and SVG icons remain platform-neutral for Android and iOS. Driver touch targets stay at least 48 pixels.

## Brand and icons

- [Cropped logo SVG](assets/brand/vhh-lockup-vector.svg) · [transparent 4096px PNG](assets/brand/vhh-lockup-4096.png) · [white-background preview](assets/brand/vhh-lockup-preview.png)
- [Monogram SVG](assets/brand/vhh-monogram-vector.svg) · [inverse SVG](assets/brand/vhh-inverse-vector.svg) · [original-canvas SVG](assets/brand/vhh-full-vector.svg)
- [Original supplied image](assets/brand/vhh-reference.png) · [conversion record](assets/brand/CONVERSION.md)
- [Editable SVG icon set](assets/icons/README.md)

Logo lettering is outlined; the original typeface was not supplied, so the conversion record identifies the approximation. No font is needed to render the master SVGs.

## Demonstrated scope

Truck-owned devices, personal driver sessions and PIN access, manual multi-stop dispatch, loading/offloading, fuel, proof/signatures, offline queues, handover authorship, source-aware movement, exception review and CSV/PDF/ZIP selection.

Drivers can report stuck vehicles, punctures, other faults or custom ad hoc events without a job. Clock-in/out captures odometer readings and photo proof, with offline saving and missing-proof exceptions. Admin has Vehicle reports and Shifts & mileage views. See the [extension record](design/REPORTS_SHIFTS_CONTEXT.md).

GPS, password validation, storage, syncing and exports are simulated prototype states. Existing tracking was reported as **cmdv7**, with CMSV7 only an unconfirmed possible match. Hardware/API integration and production services remain subsequent work.

Route optimization, item/barcode inventory, customer portals, automated messages, billing, OCR, maintenance, camera streaming, driver scoring and multiple companies remain excluded.

