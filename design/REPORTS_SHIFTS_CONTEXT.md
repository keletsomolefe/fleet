# Vehicle reports, shift mileage and truck context

Historical extension snapshot, added 16 October 2026 following user feedback. The subsequent [full visual refinement](VISUAL_REVIEW.md) is the current design record (75 driver / 53 admin states). This extends the existing Figma POC; no production backend, camera, sync or assistance service is claimed.

## Vehicle and ad hoc reports

Entry points: Today → Report issue; offline home → Report a vehicle issue; More; Lerato's own home/session. A job is optional, so a driver can report before/after a delivery or while unassigned.

Predefined types: stuck/bogged down, puncture/tyre, engine/brakes/vehicle fault, road/access blocked, delay/queue, damage/load/delivery issue, accident/safety concern, and Something else. Something else requires a short title plus description. A required-description error/recovery state is included.

Report fields: type, description, stopped/assistance-needed or can-continue status, optional job/stop, available location, optional photos/documents, and automatic driver/truck/session/time attribution. Photos and GPS are not prerequisites for quickly recording a vehicle problem.

Saved offline is distinct from received by operations. Admin then acknowledges and records follow-up/resolution. The example REP-1062 is Thabo, VHH-012, stuck in soft ground, event 14:10, receipt 14:17, acknowledgment 14:20 and recovery 14:55. It has no job link. Review preserves the original report.

Lerato has her own reporting states and navigation. Her reports never switch into Thabo's private session. No automated message, emergency dispatch or maintenance work order is introduced.

## Clock-in/out and mileage proof

Truck confirmation now leads to Start shift. The driver enters/reads the odometer in km, keeps an odometer photo, and clocks in. End shift is available in More. Handover first captures the outgoing end reading and proof; the prepared incoming driver supplies their own start reading/proof.

Full-shift scenario: 07:56 / 284,560 km → 16:20 / 284,742 km = **182 km**. Admin shows both photos in Shifts & mileage.

Alternative handover scenario: Thabo ends at 09:14 / 284,612 km, then Lerato starts at 09:15 / 284,612 km. Lerato's end example is 17:10 / 284,650 km, 38 km for her segment. These are separate prototype branches from the full-day Thabo scenario, not simultaneous assignments to the same truck. The outgoing mileage record makes three earlier Thabo records pending; those retain Thabo's author ID after handover.

If a photo is unavailable, a reason is required and admin sees a proof exception. Readings, timestamps and reasons remain intact when review is resolved. Production validation must flag lower end readings, avoid negative derived distances and preserve corrections. Segments are operational truck-session records, not payroll.

## Registration bar on scroll

The VHH header is now 48px. GP 24 VH GP moved into a reusable 32px Truck context bar directly below it, alongside VHH-012. Both have a 1px neutral divider.

On entry / at top: show the context bar. On downward scrolling: hide it. On upward scrolling: reveal it under the fixed header. Use a small direction threshold to prevent jitter and preserve form contents while changing the visible state.

The connector exposes no working scroll-direction trigger for this file. Figma supplies separate editable shown/collapsed states and a [linked reference board](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=40-3191). Actual direction detection remains for application implementation. The collapsed state can return to Today through navigation.

## Verification

The current design contains **73 driver** and **53 admin** screens/states, with 1,166 native prototype actions. Audits found no unknown/self destinations, no content/action overlaps, no small wired driver targets, no raster UI fills and no unexpected interface font. All interface text remains Montserrat.

Thirty graph checks passed, covering the original four journeys plus both drivers' eight report categories, custom validation, queued/received reports, start/end photos, missing-proof branches, handover mileage, admin acknowledgment/resolution and all 24 existing proof-policy toggles.

Representative renders were inspected for Today/context bar, collapsed context, report categories, puncture details, shift photo-ready, admin report review and admin mileage proof. A sidebar fill/contrast defect on new admin screens was fixed and the resulting render and all eight new sidebars passed the targeted contrast check.

See [feature state](feature-state.json), [journey checks](feature-journey-checks.json), [driver audit](final-driver-audit.json), [admin audit](final-admin-audit.json) and the [main requirements](../FUNCTIONAL_PLAN.md).

