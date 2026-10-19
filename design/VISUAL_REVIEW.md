# Full visual refinement

Completed 16 October 2026 in the existing editable [Figma file](https://www.figma.com/design/LEbt69of7SErhXVRHps0B3/Untitled?node-id=5-1864). Reviewed all **75 driver and 53 admin screens/states**. The compact Montserrat typography, monochrome palette and approved Today-list/detail-panel direction remain the foundation.

## Driver screens

- Entry screens have a stronger brand hierarchy, framed credential fields, six native PIN slots and a platform-neutral numeric keypad.
- Today and job screens use numbered stop markers, consistent separators, aligned chevrons and quieter schedule/proof metadata.
- Loading, delivery, fuel, issue and shift forms group related fields into restrained white panels. Proof rows share aligned icons, filenames and status copy. Signatures have a clearer paper-like canvas.
- Vehicle reports use eight icon tiles. Custom reports now include blank, validation and filled states for both drivers, with working recovery paths.
- Offline, queued, retry, received and completed screens use explicit status copy, contextual emblems and driver/truck receipts. Saved locally remains distinct from admin receipt.
- Read-only shift and vehicle records use data typography instead of editable-looking wells. Primary, secondary and back actions have clearer hierarchy.
- The divided 48px header and separate 32px registration bar remain consistent. The shown/collapsed context examples still specify reveal-on-up behaviour.

## Admin screens

- Navigation has consistent outline icons, grouped sections, a clear selected state and an operator profile.
- Overview metrics, scheduled jobs and linked attention/dispatch cards create a more useful operational hierarchy.
- Dispatch uses four numbered steps, aligned proof requirement controls and a persistent job context rail.
- Tables share consistent column widths, heading/count bars, 44px headers and 56px data rows. Search, filters, empty states and result actions follow the same hierarchy.
- Driver/device forms, evidence reviews, vehicle reports and mileage screens use two-column layouts with focused context panels. Original evidence is visually distinct from editable follow-up fields.
- Maps are editable schematics with labelled stops. The outdated-location screen shows a last-known marker; installed-tracker simulation remains explicitly labelled.
- Confirmation, review outcome and export states have clearer emblems, receipts and next actions.

## Shared foundations and corrections

The file contains 47 component nodes (including variants), two component sets, 25 variables, ten text styles and 21 editable SVG icon masters. New reusable elements include the PIN keypad, report tile and state emblem. Screen text is Montserrat; logo lettering remains outlined artwork. Icons use one 24px grid and 1.5px stroke, with proportional constraints for 16/20/24/32px slots.

During review, corrected sidebar icon backgrounds, narrow dispatch-step sizing, metric widths, operator-caption overflow, duplicate dialog/empty-state actions and inconsistent custom-report validation. The final home/dashboard exports confirm icon alignment after the shared scaling correction.

## Verification evidence

- [Native driver audit](final-driver-audit.json) and [admin audit](final-admin-audit.json): 1,180 actual prototype actions; no invalid/self destinations or detected content/action overlaps. There are 3,005 component instances and 9,498 nodes with variable bindings across the screen roots; zero image fills and no unexpected interface fonts.
- [Current journey checks](polish-journey-checks.json): 27 passing graph checks covering delivery, offline/retry, handover, shift proof, both drivers' report categories/custom-report recovery, admin investigation and all 24 proof-policy toggle transitions.
- [Text-bound review](polish-bounds.json): all 128 roots inspected; the repeated operator-caption issue was corrected and all 52 affected profiles rechecked. Wired driver actions retain at least 48px targets.
- All 128 screen PNGs are in [review/after](review/after). Before/after contact sheets cover every screen. The two new custom-report filled states appear in the after set only.
- [Final driver home](review/driver-home-final.png) and [final admin overview](review/admin-dashboard-final.png) were exported after the last shared icon constraint fix. The full contact sheets capture the preceding complete screen pass.

| Screen family | After contact sheets |
| --- | --- |
| Driver: access, Today, delivery, offline, reports, shifts | [1](review/driver-after-01.png), [2](review/driver-after-02.png), [3](review/driver-after-03.png), [4](review/driver-after-04.png), [5](review/driver-after-05.png), [6](review/driver-after-06.png), [7](review/driver-after-07.png) |
| Admin: dispatch, tracking, people/devices, evidence, exports, reports, mileage | [1](review/admin-after-01.png), [2](review/admin-after-02.png), [3](review/admin-after-03.png), [4](review/admin-after-04.png), [5](review/admin-after-05.png), [6](review/admin-after-06.png), [7](review/admin-after-07.png) |

The graph checks inspect actual native reactions; rendered review inspects layout and hierarchy. This is a Figma prototype: keypad entry, credentials, camera/signature capture, storage, sync, GPS and exports are demonstrated states. Scroll-direction triggers are specified with separate shown/collapsed frames. These checks do not substitute for production service or device testing.
