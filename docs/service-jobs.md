# Service jobs and provider dispatch

Service jobs cover mechanical work, towing, tyres, electrical work, body damage, fuel and other roadside assistance. They replace the narrow “completed repairs” workflow: a driver report creates one job, every active service provider is alerted through Meta WhatsApp, the first provider to accept is assigned, and the office closes the work after the provider marks it completed.

## Current scope

- Driver reports a **Breakdown or damage** issue with a service type, description and optional location.
- Fleet creates the driver issue and a service job in one transaction, then queues one WhatsApp template per active, opted-in service provider.
- The first provider to accept wins. The office can assign or reassign a provider manually.
- Providers update progress and mark the job completed from WhatsApp buttons or the signed web link. Completion requires a note and can include photos and an amount charged.
- The office reviews the completed job and closes it. Closing can resolve the linked driver report.
- The dashboard lists jobs, provider alerts, delivery/read state, progress and the full audit timeline.
- Meta WhatsApp is the only provider alert channel. Administrators can still resolve an older vehicle issue with a note and up to three photos from **Exceptions**. Existing records and evidence are retained.

## Permissions

| Permission | Purpose |
| --- | --- |
| `service_jobs.read` | View jobs, provider alerts and timelines |
| `service_jobs.write` | Create, assign, alert, cancel, close, reopen and revoke links |
| `service_providers.read` | View the provider directory |
| `service_providers.write` | Add, edit, pause and record consent for providers |

Owner and Administrator receive all four permissions. The existing Truck mechanic role remains limited to issue read/resolve and cannot manage service jobs.

Resolving a driver report while it still has an active service job is blocked. Close the job first.

## Provider directory

Each provider records:

- Company name, contact person, WhatsApp number, other phone and email.
- Services offered and coverage area (captured now for future targeted routing).
- Operational status: active or paused.
- WhatsApp alert consent, opt-out time and reason.
- Notes.

A provider receives alerts only while all of these are true: status is active, alerts are enabled, current consent is recorded, no opt-out is recorded, and a WhatsApp number exists. The **Receives alerts** filter shows these providers. Providers are never deleted, so their job history remains.

Changing a provider’s WhatsApp number or re-enabling alerts requires a new consent confirmation. A provider can opt out by replying `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPT OUT` or `REVOKE`. The office must record new consent before re-enabling alerts.

## Job lifecycle

| State | Meaning |
| --- | --- |
| `open` | Alerts are queued/sent; no provider has accepted |
| `assigned` | One provider accepted or was assigned |
| `in_progress` | Provider is on the way, on site or working |
| `completed` | Provider recorded what was done; awaiting office check |
| `closed` | Office checked and closed the job |
| `cancelled` | Job withdrawn with a reason |

Progress stages are `en_route`, `arrived` and `working`. They do not regress.

Each new breakdown report gets its own job reference and provider offers. A truck can have several open jobs at once. Retrying a submission with the same report ID returns the existing job. A provider’s response applies only to the job in their link.

## Driver flow

1. Driver chooses **Get help**.
2. Chooses **Breakdown or damage**, **Safety concern** or **Other issue**.
3. For breakdowns, chooses the service type: mechanic, tyres, towing, electrical, body damage, fuel, accident or other.
4. Describes what happened and can add a landmark. The app shares the phone’s last-known/current location when permission is available; GPS is never required.
5. Sends the report. The screen shows the job reference and the latest provider status. The report list refreshes while it is open.

Safety and other reports stay office-only and do not create service jobs.

## Dashboard

- **Service jobs** under Operations: active/waiting/completed/all filters, search, summary counts, and a provider alert panel.
- **Service providers** under Operations: directory, alert eligibility, consent state, jobs handled and last job. The directory and job pages refresh when the office receives an operations update.
- The fleet overview shows waiting, in-progress and awaiting-check counts.
- A job detail shows the vehicle, driver, issue, location, assigned provider, alert delivery states, responder name/channel, completion proof and the full timeline.
- The office can alert again, assign/reassign, cancel, close, reopen, add an internal note, and resend, revoke or copy a provider link.

The attention bell continues to represent unresolved driver issues and vehicle disputes; resolve or close the job to clear the linked issue.

## Provider web link

Each alert includes a signed link in the template’s **View job** button. The link is:

`https://<APP_URL>/j/<offerId>.<signature>`

The signature covers the offer and its link version with `SERVICE_JOB_LINK_SECRET`. Nothing sensitive is stored in the database. Revoking a link invalidates the previous URL and stops WhatsApp actions on that offer. The office can copy the current signed URL or reissue the offer.

The provider page requires no Fleet account. It shows only that provider’s job, not other providers, internal notes or the driver’s phone number. Actions are recorded with the provider, channel, timestamp, WhatsApp profile name or optional self-reported name. The link is a bearer credential; anyone who receives a forwarded link can act for that provider. WhatsApp actions also verify the sender’s current provider number and assignment.

## Failure handling

- WhatsApp unavailable or unconfigured: the job and driver report are still saved. The dashboard shows that alerts were not sent and the office can alert again after configuration is fixed.
- A single provider’s send fails: other providers still receive theirs. Failed sends are isolated and resendable.
- No active providers: the job remains open with a visible warning.
- Ambiguous Meta send outcome: the offer is not automatically retried, to avoid duplicate alerts. The office checks with the provider and resends deliberately.
- Template not approved or token expired: the offer records the Meta error code/title; fix the configuration and resend.
- Duplicate webhook: idempotent by WhatsApp message ID and status rank.
- Two providers accept at once: one wins; the other gets a friendly “already assigned” response.
- A closed/cancelled job makes the provider page read-only.

## Local development

After the database is recreated:

```sh
pnpm db:migrate        # create/update the app schema
pnpm db:seed:run       # role and permission catalogue (MikroORM seeder)
pnpm db:seed           # development owner through Kratos
pnpm dev
```

Provider alerts stay disabled until this is set in the root `.env`:

```sh
SERVICE_JOB_ALERTS_ENABLED=true
```

Meta credentials and the approved template are documented in [WhatsApp service jobs](whatsapp-service-jobs.md). For local UI work without sending messages, leave alerts disabled; jobs and provider links still work.

## Verification

- Unit tests cover input validation, link signing/revocation, template payloads, webhook signatures and job transitions.
- Stack test: `pnpm test:service-jobs` (local PostgreSQL and a fake Meta Graph server; no live messages).
- WhatsApp/webhook test: `pnpm test:whatsapp-jobs`.
- Web: `pnpm --filter web typecheck`, `pnpm --filter web test`, `pnpm --filter web build`.
- Driver app: `pnpm mobile:check`.
- Use the Fleet UI workflow for the jobs list, job detail, provider page and driver report at desktop, narrow web and Android sizes.
