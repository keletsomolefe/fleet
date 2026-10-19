# Fleet management market research

Research date: **16 October 2026**. This comparison informs VHH Fleet's driver app and web admin POC. Official documentation establishes advertised functionality; no vendor has been tested hands-on or selected for purchase.

| Product | Verified relevant functionality | Our recommendation |
| --- | --- | --- |
| Samsara | Driver/dashboard forms, saved driver drafts, signatures, issue notes and submission history. | Structured activity forms, resumable drafts and linked evidence. |
| Geotab | Timestamped GO-device data stored during coverage gaps, upload on reconnection, and hardware-dependent offline access. Its guide documents driver login/logout limitations. | Separate truck telemetry from driver sessions; specify offline boundaries. |
| Fleetio | Fuel time, volume, total/price, odometer, vendor, reference and attachments. Its official February 2026 offline guide limits offline support to inspection submissions. | Simple fuel records; offline fuel capture is our requirement, not a Fleetio capability claim. |
| Webfleet | Scheduling, ordered assignments, dispatch, rescheduling, reassignment, attachments, driver updates and reports. | Manually sequenced multi-stop dispatch linked to driver progress. |
| Cartrack | Driver/vehicle/job assignment, task progress, completion photos/signatures and back-office reporting. | A timeline connecting assignment, activity and evidence. |
| Track-POD | Pickup/collection, arrival/departure, actual quantities, photo/signature proof, issues, offline sync, search and report exports. | Stop outcomes, proof requirements, exceptions and downloadable evidence. |

## Official sources

1. [Samsara — Complete a Digital Form](https://kb.samsara.com/hc/en-us/articles/18423476632589-Complete-a-Digital-Form).
2. [Geotab — Offline Mode Setup Guide](https://support.geotab.com/geotab-drive/doc/offline-mode).
3. [Fleetio — Fuel Entries](https://help.fleetio.com/en_US/fuel-entries-in-fleetio-go).
4. [Fleetio — Offline Guide](https://help.fleetio.com/en_US/fleetio-go-for-account-owners-admins/use-fleetio-go-offline). It also requires the app open/active for pending inspection uploads.
5. [Webfleet — Dispatching](https://www.webfleet.com/en_za/webfleet/products/webfleet/features/order-dispatching-optimisation/).
6. [Cartrack — Task Management](https://cartrack.co.za/platform/features/workforce-optimisation/task-management).
7. [Track-POD — Features](https://track-pod.com/features.php).

## Tracking and offline implementation considerations

Specific vendor limits must not be confused with VHH requirements. Geotab's linked guide says an initial login is needed; without the tethered solution, offline logs are available only up to loss of coverage. Its IOX-USB solution is Android-only, requires compatible GO hardware and a Regulatory-or-higher plan, and still needs cellular coverage to log out. The guide lists screen sleep/off as disconnecting IOX, and no automatic vehicle assignment when connecting it after losing network. These restrictions apply to that documented solution, not every Geotab product.

Fleetio's linked offline guide supports inspection submissions only, requires an initial data/form resync, and uploads pending inspections only while the app is open and active. Event submission time is retained separately from synchronization time; out-of-sequence meter readings may be auto-voided for review. We do not infer offline fuel capture or prepared-driver handover from it. The Samsara, Webfleet and Cartrack pages above do not establish VHH's full offline handover/file-retry behavior; those remain our own requirements.

The business reports using **cmdv7**. [CMSV7's developer listing](https://play.google.com/store/apps/details?id=com.babelstar.cmsv7baidu) describes positioning, trajectories and video monitoring. It is a possible, unconfirmed match. The installed hardware and service/API access remain unidentified. The installed-tracker stream is simulated in this POC; all Figma map points are demonstrative.

[Cartrack's position services](https://developer.cartrack.com/docs/fleet-api-general/services/positions-route-services/) distinguish latest-position polling from historical event trails. [Geotab's data feed](https://developers.geotab.com/myGeotab/guides/dataFeed/index.html) uses incremental synchronization. A future connector must match the actual provider rather than assume a generic socket. [Android location guidance](https://developer.android.com/develop/sensors-and-location/location/background) documents background restrictions: actual screen-off tracking needs real-device validation.

## Recommended product direction

Our synthesis is **dispatch → driver and truck session → stop activity → proof → exception review → extraction**. Prioritize offline reliability and correct authorship. Include one business, truck-owned devices, prepared-driver PIN access, multi-stop jobs, load summaries, fuel receipts, job-specific proof, issues, source-aware maps, and CSV/PDF/ZIP extraction. Following the latest design decision, the mobile interface is platform-neutral for Android and iOS; native permissions and background tracking require later validation on each platform. Defer route optimization, inventory/barcodes, customer portal/messages, billing, OCR, maintenance, video, driver scoring and multi-company accounts. Pricing and market-share rankings are outside this study.
