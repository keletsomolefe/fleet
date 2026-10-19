# Figma design source and state

The delivered artifact is [the editable Figma file](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=5-1864). These JavaScript files are saved Figma Plugin API construction/refinement recipes, not a production application or a standalone local preview.

## Current source of truth

- [Customer/location state](customer-location-state.json) and [current route/contrast audit](customer-location-audit.json): latest extension, with 87 admin screens, 14 admin flow starts and 13 passing customer/location journey checks. Customers and Locations are linked from every admin sidebar. Job and stop selection use native editable dropdown states. All 87 admin screens passed the dark-control label check, and Fleet map/Customers were visually verified after the colour correction.
- Executed extension recipes: customer-location-builders.js (requires CONFIG), customer-location-navigation.js (requires CONFIG), customer-location-layout-fix.js, wire-customer-locations.js, customer-location-contrast-fix.js and audit-customer-locations.js. The state file retains screen IDs, per-batch construction records and route intents. These scripts describe existing state-dependent work; do not replay construction onto finished screens.
- [Driver organization](driver-organization-state.json) and [admin organization](admin-organization-state.json): numbered screen-order baseline before the customer/location extension, with 21 native journey sections and 22 prototype starting points, updated 17 October 2026. Screen IDs and existing reactions are preserved.
- [Driver route audit](driver-organized-audit.json), [admin route audit](admin-organized-audit.json) and [organization validation](organization-validation.json): 19 passing journey checks; every screen reachable; no broken destinations, frame overlaps or frames outside their sections. Pre-session truck context and mismatch recovery wording are clarified.
- [Final state ledger](final-state.json): pages, component/token IDs, 75 driver screens, 53 admin screens, selected B + C refinement and navigation changes.
- [Driver graph and audit](final-driver-audit.json) and [admin graph and audit](final-admin-audit.json): actual final native reactions, geometry and typography checks.
- [Journey checks](journey-checks.json) and [validation record](VALIDATION.md).
- [Foundation inventory](foundation-audit.json).
- [Vehicle reports, shifts and context](REPORTS_SHIFTS_CONTEXT.md), [extension ledger](feature-state.json) and [extension journey checks](feature-journey-checks.json).

The reporting/mileage extension adds report-thabo.js, report-lerato.js, build-shift-mileage.js, integrate-reports-shifts.js, build-admin-reports-shifts.js, feature-navigation.js, create-truck-context.js, apply-truck-context.js, scroll-context-board.js and fix-report-sidebar-contrast.js. These are state-dependent edit records, with current routes captured in the final audits.

The original figma-state.json, driver-state.json and admin-state.json are intermediate construction ledgers. Some earlier child IDs were deliberately replaced during refinement. Use the final audit graphs for current routes.

## Latest full visual pass

[Visual review](VISUAL_REVIEW.md), [polish ledger](polish-state.json), [current journey checks](polish-journey-checks.json) and [text bounds](polish-bounds.json) record the 75-driver/53-admin refinement. Full-resolution screen exports and before/after contact sheets are in review/. Final home/overview samples include the last shared SVG scaling fix.

Executed refinement records: polish-foundations.js, polish-svg-icons.js, polish-driver-template.js, polish-driver-fixes.js, polish-admin-template.js and polish-admin-fixes-template.js. The templates require their saved batch inputs; inspect existing nodes before reusing them. The proportional icon correction is recorded in polish-svg-scaling.json.

## Recipes

Latest organization: organize-driver-prototype.js, organize-admin-prototype.js, then clarify-truck-assignment-context.js. The matching audit-organized-driver-prototype.js and audit-organized-admin-prototype.js inspect actual native routes and section geometry. The *-organization-before.json files preserve the previous screen positions and flow starts. Earlier ledgers and audits remain historical records; screens now sit inside sections rather than directly on the page.

Initial assembly: build-foundations.js, ui-helpers.js, build-driver.js, driver-addons.js, build-admin.js, admin-addons.js and wire-prototype.js.

Later passes: proof-policy-variants.js; compact-foundations.js, compact-driver.js and compact-admin.js; exploration.js; icon-components.js; apply-selected-direction.js; apply-svg-navigation.js; apply-proof-icon.js.

audit-screens.js expects PAGE_ID and SCREENS supplied by the caller. It reads actual screen data and reactions.

These are state-dependent records of executed edits. Do not replay all scripts on the finished file: early scripts create screens and initial wiring that later passes replace. Resume by inspecting the final ledger and relevant existing nodes. Figma fonts must be loaded before text mutations, and every call must select its target page explicitly.

Logo regeneration lives in ../scripts/redraw-logo.swift and ../scripts/render-brand.cjs. Brand and icon SVGs are the font-independent source assets.
