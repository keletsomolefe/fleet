# VHH Fleet visual direction

Updated 16 October 2026. The user prefers the small typography and simple components in LinkAToday, with further refinement informed by Mobbin references. Mobile styling is **platform-neutral for Android and iOS**: use VHH headers, navigation, fields and panels rather than OS-specific controls, glass effects or imitation system chrome.

## Local reference inspected

Read `~/Dev/linkatoday/DESIGN_LANGUAGE.md`, `src/components/ui/app-text.tsx`, `app-button.tsx`, `app-text-field.tsx` and the discovery `job-card.tsx`.

Observed: Montserrat Medium/SemiBold; 12px metadata and labels, 14px buttons, 20px screen titles, 48px pill buttons, 54px input wells, 12px card radii and compact spacing. These are reference facts, not an instruction to copy the blue palette or every layout. No LinkAToday source files were changed.

## Mobbin references inspected

| Reference | Pattern retained | Adaptation for VHH |
| --- | --- | --- |
| [Snapchat account settings](https://mobbin.com/screens/6e865432-942a-492a-85ab-8c0abf67da63) | Compact rows, small section labels and rounded groups. | Simple account/session sections; no Snapchat branding, yellow or OS-specific controls. |
| [Todoist grouped task list](https://mobbin.com/screens/72a63d08-af72-40e9-a73e-52e222379894) | Primary task title separated from quieter metadata. | A stop title, time/load details and evidence status. |
| [Todoist Today](https://mobbin.com/screens/7ff218cf-1ddd-47ee-9123-72535e5f9283) | A clear day view and grouped work. | Today’s assigned run and upcoming pickup/delivery stops. |
| [Todoist task editing flow](https://mobbin.com/flows/af549573-dc62-4efc-8187-55c72ad4bdd0) | Secondary properties grouped in a focused detail panel. | Stop location, quantity, schedule and proof together; use generic panels, not an iOS replica. |
| [Things 3 task details](https://mobbin.com/screens/e8da8594-ca98-443a-b6b4-6e3cd939c80c) | Quiet separators and restrained hierarchy. | Clear stop/evidence grouping without a large card for every small field. |
| [Qatalog task list](https://mobbin.com/screens/30809519-838b-4e37-a535-8f7cce2a7b57) | Compact table rows and small supporting controls. | Denser dispatch/admin tables with visible states and filters. |

The search for Linear returned Relevance AI and Qatalog screens, so no Linear screen is claimed as a reviewed reference. Mobbin images were inspected as references, not embedded in the delivered UI. All VHH screens use native editable layers.

## Applied foundations

| Role | Font / size / line height |
| --- | --- |
| Display | Montserrat SemiBold / 32 / 40 |
| Screen title | Montserrat SemiBold / 20 / 28 |
| Section title | Montserrat SemiBold / 16 / 24 |
| Row/card title | Montserrat SemiBold / 14 / 20 |
| Body / field value | Montserrat Medium / 14 / 20 |
| Label / metadata | Montserrat Medium / 12 / 18 |
| Caption / status | Montserrat Medium / 11 / 16 |
| Metric | Montserrat SemiBold / 28 / 36 |
| PIN | Montserrat Medium / 24 / 32 |

Black primary actions, white surfaces, #F8F8F8 secondary surfaces, #EBEBEB borders, and #595959 secondary text. Status always includes text or an icon. Buttons retain 48px height with pill corners. Inputs retain a 48px interactive well. Compact driver text never implies tiny hit areas. Cards use 12px corners, operational rows 72px, web table rows 56px and smaller gaps where useful.

## Editable exploration

The Foundations page contains three native VHH studies: **A Compact cards**, **B Today and stops**, and **C Clear detail panel**. They use the same truck, job and load data. The user selected **B + C**. The main Today screen now uses ordered stop rows and quieter metadata; pickup and offloading screens group place, quantity, schedule and proof. Functional requirements, evidence rules and attribution stay consistent.

## Icons and alignment

Driver app headers now use a compact 48px VHH row with a full-width 1px #EBEBEB bottom divider. Registration moved into a reusable 32px Truck context bar directly below it. It shows GP 24 VH GP and VHH-012, separate from network status.

Show the truck bar on entry and at the top of a page; hide it while scrolling down and reveal it when scrolling up. The main header stays fixed. Foundations includes linked shown/collapsed examples. The connector cannot attach native scroll-direction triggers, so those are separate editable design states rather than a claim of implemented scrolling logic.

Vehicle reporting and start/end shift forms reuse the compact inputs, buttons, proof rows and navigation. Category choices retain 48px targets. Stopped/assistance needed, saved offline and received/acknowledged states use explicit text.

Navigation and attachment icons use editable SVG paths, with a 24px viewBox, 1.5px strokes and rounded line caps/joins. No icon font, emoji or platform-specific symbol font is required. Navigation icon instances remain 24 × 24 inside 93 × 56 auto-layout tabs, centred above an 11px label with a 4px gap. Attachment icons are centred next to a two-line text group. The reusable navigation component exposes an icon instance-swap property and editable label.

The VHH logo is also editable vector artwork, including outlined lettering. Interface typography remains Montserrat; brand lettering is preserved separately as paths rather than replaced with the interface font. See assets/brand/CONVERSION.md for the original-font limitation.

## Full visual refinement

All 75 driver and 53 admin states received a visual pass. Driver forms now use grouped fields, report icon tiles, native PIN slots/keypad, numbered stops and contextual outcome receipts. Admin screens use grouped icon navigation, aligned tables, four-step dispatch and useful context rails. Evidence data is visually distinct from editable follow-up. Twenty-one consistent SVG icon masters scale proportionally at 16/20/24/32px. See the [visual review](design/VISUAL_REVIEW.md) for changes and rendered evidence.
