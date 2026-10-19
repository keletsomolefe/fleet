# VHH Fleet POC verification

Customer/location extension verified 17 October 2026: 34 new admin screens/states, 87 admin screens total, 14 admin starting points and 1,430 admin actions. All 13 extension journey checks pass. No invalid or self destinations, unreachable screens, missing sidebar entries, frames outside section/workspace bounds, overlapping screen frames, or full-screen raster imports were found. All admin instance controls with dark backgrounds were checked for visible dark labels; none remain after the navigation colour fix. Final Fleet map and Customers screenshots show readable black/white active states and white inactive states. See customer-location-audit.json.

Customers, site forms, the customer dropdown, ordered stops, location dropdown and new-customer dispatch review were visually checked. Text, inputs, buttons, tables, icons and navigation remain editable native layers. The original BuildCo driver journey remains separate from the new Northside Aggregates bulk-material example. Data entry/search and saving are prototype states rather than implemented storage or backend validation.

Organization baseline verified 17 October 2026 before the customer/location extension: all 128 existing screens grouped into 21 numbered sections, with 11 driver and 11 admin flow starts. All 1,180 native actions were valid; 19 driver/admin journey checks passed. Every screen was reachable from a named flow, with no overlapping frames or screens outside their section bounds. See organization-validation.json and the *-organized-audit.json files for the baseline evidence.

Visually checked the new-session truck check, truck mismatch recovery, active-session PIN unlock, handover action, ordered driver access section and ordered admin dispatch section. Truck bars say “assigned truck” before clock-in and “current truck” during an active session. The driver verifies the admin-assigned registration, continues to clock-in, or asks operations to correct a mismatch. PIN unlock resumes an active session without repeating the check. Existing static assets remain native component instances.

The following full visual-pass record is historical; its screen IDs and dimensions remain applicable after reordering.

Verified 16 October 2026 against the edited Figma file and local deliverables.

## Final native structure

| Check | Result |
| --- | --- |
| Pages | Foundations, Driver App, Web Admin |
| Screens / states | 75 driver at 412 × 915; 53 admin at 1440 × 1024 |
| Actual prototype actions | 438 driver + 742 admin = 1,180 |
| Invalid / self destinations | 0 |
| Driver content/action overlaps | 0 |
| Interface text family | Montserrat throughout driver/admin |
| Full-screen raster imports / image fills | 0 |
| Reuse | 3,005 component instances across driver/admin screens |
| Variable bindings | 9,498 bound nodes across driver/admin screens |
| Foundation inventory | 25 variables, 10 text styles, 47 component nodes (including variants), 2 component sets |
| SVG icons | 21 editable masters on Foundations; no icon font |
| Wired driver touch targets | At least 48 × 48; navigation tabs 93 × 56 |

Actual reactions were read from Figma rather than inferred from the original construction scripts. Cross-page role switches use prototype URLs opening a new tab. Every known internal destination exists on the correct role page.

## Four journey walkthroughs

1. **Dispatch and delivery:** admin sign in → overview → job creation → ordered pickup/two delivery stops → assignment → proof policy → dispatch. The driver entry is linked from the dispatched result. Driver sign in → PIN setup → truck confirmation → shift-start mileage/photo → Today → City Deep → loading → Midrand offloading → proof → recipient signature → delivered. Job, driver, truck and quantities agree.
2. **Offline work:** PIN unlock → offline home → fuel → saved locally → queue → failed attachment → retry → synced → history. The event time stays 09:12; metadata receipt and proof upload are later. Missing GPS does not prevent save. A record can be uploaded while its attachment remains incomplete.
3. **Handover:** More → handover → outgoing mileage/photo → prepared drivers → Lerato PIN → incoming mileage/photo → Lerato home/history/session. Pending Thabo records retain Thabo as author; Lerato's history shows her own shift start. Her navigation stays in her session. The unprepared-driver branch returns to prepared selection or online sign in.
4. **Investigation:** fleet map → VHH-012 history → Pretoria partial-delivery review → resolve with follow-up → exports → demonstration export pack. The 11/12 pallet outcome is preserved. CSV, individual proof PDF and ZIP bundle are represented explicitly.

The original journey-checks.json and feature-journey-checks.json are historical checks. The current [polish-journey-checks.json](polish-journey-checks.json) contains 27 passing graph checks, including both drivers' report categories, blank/validation/filled custom-report recovery, shift/handover proof, admin review and all 24 proof-policy transitions. No real export files are generated by the prototype.

## Visual review

The earlier divider pass is recorded in header-divider-state.json. The latest refinement uses a 48px header and a separate 32px Truck context bar across the current driver screens. A collapsed context state and linked Foundations board specify hide-on-down/reveal-on-up behaviour. Scroll direction itself is not wired by this connector.

The vehicle-report and shift extension was visually checked and is detailed in REPORTS_SHIFTS_CONTEXT.md. Sidebar contrast on the new admin views was corrected and verified after the fix.

All 128 screens were rendered and visually reviewed in the latest full pass. The [visual review](VISUAL_REVIEW.md) links before/after contact sheets and final native home/overview exports. Grouped forms, report tiles, PIN keypad, outcome receipts, admin context rails, tables and maps were refined throughout. Corrected SVG backgrounds/scaling, dispatch-step sizing, metric widths, duplicate actions and operator-caption overflow. [Text bounds](polish-bounds.json) records the targeted recheck of all 52 corrected operator profiles; no remaining detected overflow. The final relevant renders show aligned icons and unclipped controls. Status remains clear in monochrome and wired driver actions retain 48px targets.

The logo was rendered and compared with the supplied reference for monogram geometry, divider, lettering, rule and tagline. SVG masters are grouped path artwork with no raster, live text or external dependency. Transparent exports are 4096px on the longest edge. Exact original brand-font identity remains unconfirmed; see ../assets/brand/CONVERSION.md.

## Evidence and limits

The native graph walkthrough checks actual destinations and representative rendered states; it is not a claim of end-to-end production or device testing. Password/PIN validation, touch drawing, cameras, file access, durable local storage, synchronization, GPS and downloads remain demonstrations. Real restart durability, idempotency, background tracking, authorization and hardware integration require subsequent implementation and device tests.

Market research distinguishes vendor claims from recommendations and retains the Geotab/Fleetio offline restrictions. Requirements and README reflect the latest platform-neutral Android/iOS direction and the user's B + C selection.
