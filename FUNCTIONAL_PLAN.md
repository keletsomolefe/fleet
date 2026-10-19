# VHH Fleet functional specification

Agreed MVP · 16 October 2026 · One fleet business · Platform-neutral mobile driver app for Android and iOS, plus web admin.

This phase delivers editable Figma screens, a clickable prototype and brand assets. Password checks, network changes, GPS, files and exports demonstrate behavior. Production services are a subsequent phase.

## 1 Ownership and permissions

| ID | Requirement |
| --- | --- |
| OWN-01 | Devices belong to trucks. Admin binds each device to its truck and retains association history. Drivers cannot change this binding. |
| OWN-02 | Drivers own personal accounts and may change trucks. One active session per truck device; retain session start/end times. |
| OWN-03 | Events preserve driver, truck, device, session, optional job/stop, event time and server receipt time, including after handover and delayed upload. |
| OWN-04 | Before a new session, the driver checks that the device’s assigned registration matches the physical truck, then continues to clock-in. This verifies the admin assignment; it does not select or rebind another truck. A mismatch directs the driver to fleet administration. PIN unlock resumes an already active session without repeating this check. |
| AUTH-01 | Initial login on each device requires network, driver identifier and password. Admin provisions, deactivates and resets accounts. |
| AUTH-02 | A driver establishes a personal PIN after online verification. Prepared drivers can start/unlock sessions offline. First use of a different device needs internet. |
| AUTH-03 | Drivers see their relevant jobs/records, not another driver's private session. Admin manages the fleet, dispatch, review and exports. |
| AUTH-04 | Deactivation/resets apply at next online verification. Show last verified/synced time; cached offline access cannot reflect newer server changes. |

## 2 Jobs and dispatch

| ID | Requirement |
| --- | --- |
| JOB-01 | Admin creates a scheduled run with unique reference, customer/contact, date/time, assigned driver/truck, instructions and ordered pickup/delivery stops. |
| JOB-02 | Stop fields: type, address/location, contact, scheduled window, load summary, planned/actual quantity and unit, notes and job proof policy. No item inventory. |
| JOB-03 | Admin manually orders, dispatches, reschedules and reassigns work. Automatic optimization is excluded. |
| JOB-04 | Driver downloads assigned jobs and attachments; sees stops, contacts, instructions and last sync. Navigation opens an external navigation app. |
| JOB-05 | Record arrival, loading/offloading, completion and departure. Partial/failed stops require reasons and actual quantities where applicable. Missing GPS does not prevent logging. |
| JOB-06 | Unstarted work is editable. Active reassignment requires acknowledgment when connected. Late offline events retain the original assignment/version and enter conflict review. |
| JOB-07 | A job finishes when every stop has a terminal outcome. Open evidence exceptions remain visible independently. |
| CUST-01 | Admin manages reusable customer records with a name, stable reference, primary contact, optional email/phone, notes and active status. Customer is selected separately from the job reference through a dropdown. |
| LOC-01 | Saved locations have a name, customer association or shared availability, address/coordinates/site directions, site use, contact and access instructions. One customer can have multiple locations. Shared sites may serve more than one customer. |
| LOC-02 | Each stop selects a saved location through a dropdown. Site contact and access instructions populate the stop; job quantities, activity and scheduled window remain on the stop. Jobs preserve a snapshot of selected customer/location details so later record edits cannot silently alter dispatched work. |
| LOC-03 | The prototype demonstrates customer selection, no-results/add-customer recovery, adding a location, missing-required-details recovery and a separate bulk-material collection/delivery example. Search, editing, persistence and filtering remain simulated Figma states. |

Job states: Draft → Dispatched → In progress → Completed / Completed with exceptions; admin can cancel uncompleted work with a reason.

Stop states: Pending → Arrived → Loading or offloading → Completed / Partially completed / Failed. Admin cancellation is terminal. Departure is a timestamped event after service. Follow-up work is recorded separately rather than rewriting failed outcomes.

Proof policy is selected before dispatch and downloaded with the job. Active work retains its policy version until a job update is acknowledged.

## 3 Activities, shifts and proof

| ID | Requirement and fields |
| --- | --- |
| ACT-01 | Fuel: litres, total cost/currency, odometer, station, time, receipt, notes and optional job link. A missing receipt creates an exception. |
| ACT-02 | Loading/offloading: job/stop, time, planned/actual quantity and unit, outcome, notes and photos/documents. |
| POD-01 | Admin selects photo/document, recipient-name and signature requirements per job. Support camera, images and PDFs. Review attachments before submission. |
| POD-02 | Missing required evidence needs an explicit reason and exception; never label it accepted proof. Link signatures to recipient and event. |
| POD-03 | Preserve submitted originals. Corrections retain old/new values, editor, time and reason. |
| ISSUE-01 | Report vehicle issues or other ad hoc events at any time, including with no assigned job. Predefined choices: stuck/bogged down; puncture/tyre problem; engine/brakes/vehicle fault; road/access blocked; delay/queue; damage/load/delivery issue; accident/safety concern; Something else. All other vehicle faults can be described through Something else. |
| ISSUE-02 | Capture category, required description, vehicle status (stopped/assistance needed or can continue), original driver/truck/session, event time, optional job/stop, available location and optional photos/documents. Something else also requires a short title. Missing GPS or proof never prevents a basic issue report. |
| ISSUE-03 | Distinguish Saved offline, Received by operations, Acknowledged, In progress and Resolved. An offline report is not yet received or acknowledged. Admin records reviewer, follow-up, resolution and time without rewriting the driver's report. This is issue reporting, not a maintenance/work-order system or an automatic assistance service. |
| SHIFT-01 | After password/PIN and truck confirmation, start the truck session with clock-in time, odometer in km and an odometer photo. Record clock-out time, end reading and photo at end of shift or handover. Each record belongs to its original driver and truck. |
| SHIFT-02 | A driver changing trucks closes the old truck segment and begins another. Handover records the outgoing end reading and the incoming start reading separately; earlier pending records retain their author. These are operational truck-session logs, not payroll timesheets. |
| SHIFT-03 | Require nonnegative numeric readings and start/end photos. If a photo is unavailable, require a reason and save a visible proof exception. Lower end readings require a reason and review; never silently calculate a negative distance or discard the original reading. |
| SHIFT-04 | Calculate distance only from compatible start/end readings on the same truck segment. Preserve event, upload and photo timestamps separately. Clock-in/out and proof remain usable offline and retry through the existing queue. |
| SHIFT-05 | Admin views start/end times, readings, distance, photos, author, truck, sync and review status. Corrections retain an audit trail. Open sessions show no final distance; unavailable or invalid readings are labelled rather than estimated. |
| HISTORY-01 | Driver history shows relevant records, drafts, proof and synchronization state. Admin searches fleet history. |

Positive fuel litres/cost; nonnegative load quantities; units always visible. Lower odometer readings produce review flags rather than silently discarding evidence. Missing location is visible but never blocks saving.

## 4 Offline and synchronization

| ID | Requirement |
| --- | --- |
| OFF-01 | Offline: prepared-driver PIN access, downloaded jobs, drafts, activities, issues, images/PDFs/signatures and available GPS-point capture. New jobs and server changes require reconnecting. |
| OFF-02 | Save durably before local success. Preserve records/files through restart, sign-out and driver handover with original authorship. |
| OFF-03 | Automatic sync when connectivity/execution permits; manual retry; stable client event IDs prevent duplicate submissions. |
| OFF-04 | Sync metadata and attachments independently. An event with pending/failed proof remains visibly incomplete. |
| OFF-05 | Transport states: Draft, Saved offline, Uploading, Uploaded, Needs retry. Keep evidence/review status separate. |
| OFF-06 | Preserve event time and receipt/upload time separately. Display pending count, last sync and retry feedback. |
| OFF-07 | Storage failure must not produce a false saved confirmation. Old assignments and unsupported first-time offline login have clear recovery. |

## 5 Tracking

| ID | Requirement |
| --- | --- |
| GPS-01 | Truck tracking is separate from driver identity. PIN lock/sign-out do not themselves end authorized tracking. Validate background behavior on both Android and iOS truck devices later. |
| GPS-02 | Support Device GPS and an installed-tracker feed; installed feed is simulated for POC. All Figma map points are demonstrative. |
| GPS-03 | Retain source, truck/device, capture/receipt timestamps, coordinates and available accuracy. Do not silently merge conflicting streams. |
| GPS-04 | Default POC source is Device GPS; provide a simulated-source selector. Simulated points are excluded from ordinary operational exports. |
| GPS-05 | Latest position, source, age, stale/unavailable state and history by date. Do not infer ignition from phone GPS. Retain available points offline. |

Current app reported as cmdv7, possibly CMSV7; identity/hardware unconfirmed. Live integration deferred. Offline means last-known location on admin until a source reconnects.

## 6 Web admin

| ID | Requirement |
| --- | --- |
| ADM-01 | Dashboard: scheduled/active jobs, completed stops, issues, proof exceptions, stale locations and device sync health for selected filters. |
| ADM-02 | Create/view/update/deactivate drivers; reset access; inspect session history. |
| ADM-03 | Manage trucks/devices, binding history, health and last contact. |
| ADM-04 | Dispatch board, job form, stop sequencing, assignment, proof policy, progress and reassignment acknowledgment. |
| ADM-05 | Fleet map and truck timelines connect movement, activities, driver/session and evidence. |
| ADM-06 | Filter by dates, driver, truck, job/reference, activity, issue, review status and proof availability. |
| ADM-07 | Exceptions-only review: missing proof/signature, partial/failed delivery, conflicts and issues. Store reviewer, resolution, notes and time. Normal proof is immediately available. |
| ADM-08 | Vehicle reports have their own searchable list and stopped/assistance-needed state. Admin acknowledges, records follow-up and resolves reports; these also appear in exceptions and truck history where applicable. |
| ADM-09 | Shifts & mileage provides truck/driver/date filters, paired odometer photos, calculated distance and missing-proof/readings review. |
| EXP-01 | Filtered CSV with stable references, timestamps, units, truck/driver/job and evidence status. |
| EXP-02 | Individual delivery PDF with job/stop, driver/truck, recipient, event/receipt times, outcome, proof and exceptions. |
| EXP-03 | ZIP proof bundle plus manifest mapping files to records. Identify missing files explicitly. |
| EXP-04 | Include vehicle reports and truck-session mileage in filtered CSV and evidence bundles, retaining original authorship, times, readings, reasons and proof availability. |

Review: Needs review → Resolved / Follow-up required. Resolving an exception never silently changes an operational delivery outcome.

## 7 Records and service capabilities

Records: Customer, SavedLocation, Driver, Truck, TruckDevice, DeviceTruckAssociation, DriverSession, ShiftMileageSegment, Job, Stop, AssignmentVersion, ActivityEvent, Attachment, Issue, LocationPoint, ReviewAction, ExportRequest and AuditEntry.

Later services: authentication/prepared-device PIN access, dispatch download/acknowledgment, event sync, attachment upload/retry, source-aware location ingestion, admin search/review, exports and audit. This inventory does not assert an implemented backend or fixed API wire contract.

Defaults: English, kilometres, litres, ZAR; UTC storage and Africa/Johannesburg display. Protect evidence access and cached credentials.

## 8 Screens and visual system

Driver frames 412 × 915; admin 1440 × 1024. VHH Group logo, VHH Fleet product label, Montserrat Medium/SemiBold, black/white and neutral greys, textual/icon status labels, compact 12–14px text, 20px screen titles, 48px pill actions and 48px minimum driver targets. See DESIGN_DIRECTION.md for reference evidence and tokens. Use native editable auto-layout, variables and reusable components.

Driver: login, PIN setup/unlock, prepared drivers, truck confirmation, home, assigned jobs, job details, stop progress, loading, offloading, fuel, proof capture/review, signature, issues, history, sync queue and handover.

Admin: login, dashboard, dispatch, job create/edit, stops, assignment, proof settings, job progress, fleet map/history, drivers, trucks/devices, activity/proof search, exception review/resolution and exports.

States: offline, missing GPS, validation, required/missing proof, signature exception, partial delivery, pending upload, failed upload/retry, stale location, simulation, empty search and cancel/back recovery.

Vehicle reports add category selection, Something else, required-description validation, saved-offline and received states, plus admin acknowledgment/resolution. Shift screens add start/end mileage, photo-ready states, proof-unavailable reasons, handover readings and mileage history.

The fixed VHH header is 48px, followed by a separate 32px registration/truck bar. Show the bar on screen entry and at the top; hide on downward scrolling and reveal on upward scrolling. Keep the main header fixed, use a small direction threshold to avoid flicker, and do not discard form state when the bar collapses. Figma contains shown/hidden states; actual scroll-direction detection is a later app implementation task.

## 9 Acceptance scenarios

| ID | Passing result |
| --- | --- |
| AC-01 | Admin creates VHH-1042, orders pickup/two deliveries, assigns Thabo Mokoena and VHH-012 (GP 24 VH GP), chooses proof and dispatches. Driver sees matching data. |
| AC-02 | Driver logs in, sets/unlocks PIN, confirms truck, records shift-start odometer/photo, arrives, loads 24 pallets and records delivery/photo/signature. |
| AC-03 | Offline fuel and proof remain saved. Reconnect syncs once; failed attachment is visibly incomplete and retryable. Restart durability is a later production test. |
| AC-04 | Outgoing Thabo records end mileage/photo; prepared Lerato takes over offline and records her start mileage/photo. Pending Thabo records stay authored by Thabo. Unprepared login requires network. |
| AC-05 | Partial delivery (11/12 pallets) and missing signature enter review. Admin records follow-up and resolves an exception without rewriting quantities. |
| AC-06 | Device GPS and simulated tracker sources remain distinct; stale/missing location is visible. |
| AC-07 | Admin selects matching CSV, PDF and ZIP evidence extracts; prototype outcomes explicitly identify demonstration files. |
| AC-08 | Four journeys have reachable entries, next/back/cancel and recovery routes; no clipped text or false live-data claims. |
| AC-09 | A driver selects Puncture or Stuck, or supplies a custom title/description, without linking a job. Offline save is visibly not yet received; after sync admin can acknowledge and resolve with original details retained. |
| AC-10 | Thabo clocks in at 07:56 with 284,560 km and out at 16:20 with 284,742 km. Admin sees both photos and 182 km. Missing-photo branches retain a reason and a proof exception. |
| AC-11 | Registration is in the bar below the header. Shown and collapsed designs preserve the same truck; production scrolling hides downward and reveals upward without losing captured data. |

Production follow-up tests: persistence, idempotency, revocation after reconnect, cross-driver privacy, protected files and real screen-off tracking. Figma demonstrates states rather than validating these services.

## 10 Exclusions

Route optimization; item/barcode inventory; customer portals/messages; billing; fuel-card integration; OCR; maintenance; camera streaming; driver scoring; multi-company accounts; live existing-tracker integration. OS-specific permission and background execution behavior requires later native validation.
