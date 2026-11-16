# VHH Fleet design

VHH Fleet has two surfaces with different jobs. On the web dashboard, staff scan work, compare records and resolve exceptions. On the phone, a driver needs to know which vehicle they are using, whether they are ready to drive, and what to do next. Use the same visual language and operational terms on both surfaces.

Put the next action beside the information needed to take it. The web overview groups links to everyday work; the driver home pairs the vehicle and its status with the next available action. Use the editable [Fleet Patterns board](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=228-314) and the [selected Mobbin references](design/mobbin-references.md).

## Sources

The running app and the relevant feature docs define current behavior. See the [current scope](README.md#current-scope) before using a prototype as a brief. The [VHH web design](docs/admin-authentication.md) and [personal-phone design](docs/mobile-device-setup.md) link to the relevant Figma work. [Earlier design direction](DESIGN_DIRECTION.md) and the [Figma archive](design/README.md) preserve decisions and prototypes from earlier phases, including features outside the current app.

| | Web dashboard | Mobile app |
| --- | --- | --- |
| Theme and typography | [CSS tokens](apps/web/src/styles.css), Tailwind and shadcn/ui | [Native tokens and primitives](apps/mobile/src/components/ui.tsx), [font loading and routes](apps/mobile/src/app/_layout.tsx) |
| Building blocks | [Admin shell](apps/web/src/components/admin-shell.tsx), [page header](apps/web/src/components/page-header.tsx), [fleet list](apps/web/src/components/fleet-list.tsx), [UI primitives](apps/web/src/components/ui) | `Screen`, `Heading`, `Copy`, `Button`, `Field`, `Notice`, `TruckCard` and [TrackingCard](apps/mobile/src/components/tracking-card.tsx) |
| Start here | [Vehicles](apps/web/src/routes/admin.trucks.index.tsx), [Driver schedule](apps/web/src/routes/admin.schedules.tsx), [Exceptions](apps/web/src/routes/admin.vehicle-disputes.tsx) | [Driver home](apps/mobile/src/app/truck.tsx), [Vehicle review](apps/mobile/src/app/vehicle-review.tsx), [Issue reporting](apps/mobile/src/app/issues.tsx) |

## Shared visual language

- Use Montserrat Medium for body text and SemiBold for headings and action labels. The baseline is 20/28 for page titles and 14/20 for body text. Use 12/18 on mobile for supporting text; the web shell also uses 11/16 for compact labels. Keep critical information at body size and allow it to wrap.
- Use the existing monochrome surfaces, light borders, black primary actions and VHH artwork. Use the platform's existing danger styles for errors and urgent attention. Pair status colors with words. Keep focus, selected and disabled states distinct.
- Use semantic web utilities such as `bg-background`, `text-muted-foreground` and `border-border`. On mobile, use exported `colors` and `styles`; `Screen` already provides safe areas, keyboard handling and 20-point content padding. Native cards use 12-point corners and 16-point padding. Native buttons and inputs have a 48-point minimum height. Reuse the defaults before adding variations.
- Use plain action labels and keep operational terms consistent: **vehicle**, **registration**, **Driver schedule**, **Exceptions**, **Sign in**. The sign-in heading is **Welcome to VHH Fleet**. Put a recovery action next to the problem it addresses.

## Web dashboard

- Use the existing desktop sidebar and header; keep the narrow-screen navigation drawer. Give each page one title and put its main action in the header when appropriate.
- Put search and filters directly above the results. Use existing list or table patterns so vehicle registrations, driver names, dates and statuses can be compared. Keep row actions close to the record; use the narrower layout to prioritize the identity, status and next action without hiding essential information.
- Put unresolved items where staff can act on them. The Exceptions count means unresolved work; opening the menu does not resolve anything. Keep empty results, loading and failed requests distinct. For scheduling and handovers, show the affected date and vehicle before the user commits. [Scheduling and exceptions](docs/driver-scheduling.md) define the details.
- Service jobs lead with the action that changes the state: alert again while waiting, assign while open, close once completed. Show the assigned provider, per-provider alert state and the audited timeline together so staff can see who is handling the work. The provider web link is a mobile-first, login-free page; show only that provider's job and make accept, decline, progress and complete obvious without exposing internal notes or other providers.

## Driver app

- Use the shared header and vehicle context bar on operational screens. Lead with the driver's current state or today's vehicle, then make the next action easy to find. Use registration as the main vehicle identifier and fleet number as supporting context.
- Keep a single visually primary action for the current state. Keep confirmation and release explicit; do not treat a scheduled vehicle as confirmation that driving or location sharing has started. Keep schedule problems and general issue reporting distinct. Follow the [vehicle selection](docs/mobile-device-setup.md) and [location sharing](docs/background-location.md) contracts for blocked, reconnecting and offline states.
- Use platform-neutral Fleet components with native keyboard, scrolling, accessibility and safe-area behavior. Check long names, larger text and reachability of actions on a small phone. Avoid relying on swipe, color, or an unlabeled icon to communicate or finish a required action.

Use the [Mobbin reference library](design/mobbin-references.md) for a new interaction pattern and the [visual QA checklist](design/quality-checklist.md) to verify rendered changes. Add lasting rules here when the team approves a pattern for reuse.
