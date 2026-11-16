# Codex handover: remove OpenWA and finish WhatsApp-native job actions

The approved product plan is [FUNCTIONAL_PLAN.md](../FUNCTIONAL_PLAN.md), section **Service jobs and provider dispatch (2026-11-16)**, especially requirement **SVC-10**: the old OpenWA group repair flow is not used for new reports; Meta WhatsApp service jobs replace it. The implementation map is [service-jobs.md](service-jobs.md).

This document is the prompt to give Codex. It covers two connected deliverables:

1. Remove the obsolete OpenWA repair POC.
2. Keep and finish the Meta WhatsApp webhook and in-chat job actions so a provider can accept, progress **and complete** a job from WhatsApp, with the signed web page as a fallback.

Historical handover. The prompt and inventory below describe the starting point. For the current workflow and setup, see [WhatsApp service jobs](whatsapp-service-jobs.md) and [deployment](deployment.md).

## What to hand to Codex

```text
You are removing the obsolete OpenWA repair POC from the VHH Fleet repository at /Users/keletso/Dev/fleet, and finishing the Meta WhatsApp webhook so providers can accept, progress and complete jobs from WhatsApp.

Read first:
- AGENTS.md, FUNCTIONAL_PLAN.md (Service jobs and provider dispatch, especially SVC-10), docs/service-jobs.md
- docs/whatsapp-service-jobs.md and docs/whatsapp-repairs-poc.md
- apps/api/src/app.ts, apps/api/src/issues/**, apps/web/src/routes/repairs.$issueId.tsx, apps/web/src/components/repair-form.tsx
- deploy/compose.openwa.yaml, deploy/compose.yaml, deploy/deploy.sh, deploy/init-repairs.py, deploy/Caddyfile
- scripts/test-repairs-stack.mjs, scripts/test-deploy-safety.mjs, apps/api/src/database/configure-repairs.ts
- apps/api/src/storage/private-storage.ts and the service-jobs attachment usage

Goal:
Deliver both parts together:
A. Remove the OpenWA WhatsApp gateway, the mechanics-group alert flow, the public no-login repair link, the WhatsApp OTP flow, and their deployment configuration.
B. Keep and finish the Meta Cloud API webhook and provider actions: accepting, declining, progress updates and **direct completion from WhatsApp**. The provider web page remains a fallback. Meta service jobs are the only provider-alert mechanism.

Do not rebuild the service-jobs domain. Extend the existing `WhatsAppWebhookService`, `WhatsAppCloudService` and `ServiceJobsService`. Do not use OpenWA for any part of the new flow. Do not remove the provider web page.

Keep this scope:
- Keep the admin-only repair evidence form used from Exceptions for a vehicle issue that has no active service job. It may still record a note and up to three photos against the issue. It must use the normal signed-in administrator session, not OpenWA, OTPs, group membership or a signed public link.
- Keep `/api/admin/issues/:id/repair`, `/api/admin/issues/:id/repair/photos/:photoId` and `/api/admin/issues/:id/repair/resolve` only if the Exceptions UI still calls them. Remove any endpoint with no caller.
- Keep service-job attachments and the private storage they use.
- Keep Meta Cloud API provider alerts, `whatsapp_webhook`, `whatsapp_messages`, service-job offers and the provider portal.
- Keep the current webhook GET/POST receiver and its raw-body signature checks; extend it rather than creating a second webhook.
- Keep the signed provider web page as the fallback completion path. Both web and WhatsApp completions must write the same audited job events.

WhatsApp webhook and in-chat job actions (add/verify):
1. **Webhook receiver.** Keep the public `GET/POST /api/whatsapp/webhook` (gateway path `/api/whatsapp/webhook`). GET must verify `hub.mode=subscribe`, `hub.verify_token` and return `hub.challenge`. POST must verify `X-Hub-Signature-256` over the raw request bytes with `META_WHATSAPP_APP_SECRET` before parsing JSON, fail closed on missing/invalid secrets or signatures, validate the WABA id when configured, and be idempotent on duplicate `wamid`/event ids. Real processing failures return 500 so Meta retries; verified duplicates return 200.
2. **Accept from WhatsApp.** The approved template quick replies `Accept job` and `Can't take` must still accept/decline after OpenWA is removed. Text `ACCEPT`/`DECLINE` works when the provider has exactly one open offer. Resolve the offer from `context.id` (the alert message id) and verify the sender phone belongs to that provider. First accept still wins atomically; losing providers receive a covered reply. Record provider, channel `whatsapp`, timestamp, WhatsApp profile name and the reply.
3. **Progress from WhatsApp.** Keep interactive actions `offer:<offerId>:en_route`, `arrived` and `working`, verify the assigned provider and valid job state, and do not regress stages. Confirm each change in the chat.
4. **Complete from WhatsApp (the missing piece).** A provider must be able to finish the job without opening the web page:
   - Tapping **Complete job** or sending `DONE`/`COMPLETE` starts a durable completion conversation for that offer and provider.
   - Ask for the required completion note in a free-form reply inside the 24-hour customer-service window. Do not mark the job complete without a non-empty note. If the provider does not answer, or the window/flow expires, reply with the signed web completion link as fallback.
   - Persist the conversation state in PostgreSQL, not in memory, keyed by offer/provider and timestamps. It must survive an API restart and allow only the assigned provider to continue. Add a small migration if new columns/table are needed.
   - Optionally accept up to the existing limit of completion photos sent as WhatsApp media. Download them with the Graph media endpoint using the server token, validate type/size with the existing photo rules, and store them with the service-job attachment storage. Do not accept arbitrary URLs or trust MIME types.
   - Optionally parse an amount charged if the product keeps that field; validate it with the same rules as the web form.
   - Call the existing service-job completion path with channel `whatsapp`, note, photos and amount. Write the same audited completion event and provider attribution as the web form. Reply with a clear confirmation, then send the office an operations event.
   - Duplicate completion messages/events must be idempotent: no duplicate photos, events or notifications. A second COMPLETE after completion replies that the job is already complete, without changing data.
   - Reject completion from the wrong number, a provider who lost the offer, a revoked/expired offer, or a job that is not assigned/in progress. Reply safely without exposing internal details.
   - Keep the existing web completion form working. It must remain the fallback when the 24-hour window has expired and must not be removed by the OpenWA cleanup.
5. **Admin visibility.** The job detail must show whether acceptance, progress and completion came from WhatsApp or the web, plus the completion note, photos, amount and actor. The timeline and driver-report resolution rules must remain unchanged.
6. **Tests and docs.** Extend `scripts/test-whatsapp-jobs-stack.mjs` with a signed-webhook direct-completion case: accept, progress, COMPLETE, note collection, optional photo, duplicate completion, wrong-provider rejection and web fallback. Never call live Meta; use the fake Graph server and `META_WHATSAPP_GRAPH_URL`. Update `docs/whatsapp-service-jobs.md` with the callback URL, subscription, signature requirements and the in-chat completion flow.

Remove:
1. `apps/api/src/issues/openwa.service.ts` and every import/construction/start/stop of `OpenWaService`.
2. `apps/api/src/issues/repair-otp.service.ts`, `repair-access.ts`, `repair-audit.ts` and `apps/api/src/database/configure-repairs.ts`.
3. The public repair routes in `apps/api/src/issues/repairs.routes.ts`: `/repairs/:id`, OTP request/verify, public photo and public resolve. Remove `registerPublicRepairRoutes`.
4. The OpenWA/OTP branch of `RepairsService.resolve`; keep only the `admin: AdminContext` path. Remove the disabled `whatsapp-repairs@fleet.invalid` audit identity and the phone-verification receipt fields.
5. The public web route `apps/web/src/routes/repairs.$issueId.tsx`; regenerate the TanStack route tree. Remove any links to `/repairs/...`.
6. `deploy/compose.openwa.yaml`, the OpenWA service/volume/env from `deploy/compose.yaml`, and OpenWA/repair keys from `deploy/init-repairs.py`.
7. Repair-link headers from `deploy/Caddyfile` if they only protect the removed public flow.
8. `pnpm test:repairs` and `scripts/test-repairs-stack.mjs`, plus OpenWA-specific unit tests in `apps/api/src/issues/repairs.spec.ts`. Rewrite the unit file to cover only the remaining admin repair evidence path, or remove it if another test covers that path.
9. `docs/whatsapp-repairs-poc.md` and its links from README/deployment/service-jobs docs. Update the docs to state that the legacy flow has been removed and Meta service jobs are the only provider flow.
10. OpenWA/repair keys from `.env.sample` and local setup scripts. Never commit or print real credentials.

Storage/env migration:
- Private storage is still needed for service-job attachments and the admin repair form. Rename the environment variable `REPAIR_DATA_DIR` to `FLEET_DATA_DIR` (or another clear neutral name) and update `privateDataDir()` in `apps/api/src/storage/private-storage.ts`.
- In `deploy/compose.yaml`, set the app volume to `/app/.fleet-data`, rename the Docker volume `repair_data` to `fleet_data`, and keep service-job files under `<FLEET_DATA_DIR>/service-jobs/...`.
- Update deployment init, deploy safety tests and stack tests to the new variable. Existing local data may be wiped; do not silently delete production data. If a volume rename would orphan existing photos, add a documented manual copy step instead of deleting them.
- Rename `deploy/init-repairs.py` to a neutral name such as `deploy/init-messaging.py` and update `deploy/deploy.sh`. Keep generating `SERVICE_JOB_LINK_SECRET`, `SERVICE_JOB_ALERTS_ENABLED`, the Meta secrets and `FLEET_CONTACT_PHONE`; remove `REPAIR_LINK_SECRET`, `OPENWA_MASTER_KEY`, `OPENWA_KEY_PEPPER` and `WHATSAPP_ENABLED`.

Acceptance criteria:
- `rg -n "OpenWA|openwa|OPENWA|RepairOtp|repair-otp|RepairAccess|repair-audit|REPAIR_LINK_SECRET|WHATSAPP_ENABLED|/repairs/" apps deploy README.md docs scripts .env.sample` returns no live OpenWA/public-repair references. Historical docs/QA reports may mention the removed POC only as history; do not leave broken route imports.
- No route, UI page or test expects the public repair link, OTP, group message or OpenWA gateway.
- The webhook still passes GET verification, rejects bad signatures, is idempotent and handles accept/decline/progress.
- A provider can complete a job entirely from WhatsApp with a required note; the web completion form still works as fallback. Duplicate/wrong-provider/expired cases are covered by tests.
- The admin Exceptions flow can still resolve a vehicle issue with a note and optional photos, with permission and CSRF checks.
- Service jobs, Meta webhook, provider portal and service-job attachments still pass their tests after OpenWA is removed.
- No credentials, secrets or `.env` values are printed or committed.
- Do not drop database tables or delete private files automatically. The database wipe is a separate, explicit operation. Fresh databases must still migrate and seed cleanly.

Verification (run all):
- pnpm typecheck
- pnpm test
- pnpm --filter api build
- pnpm --filter web build
- pnpm test:service-jobs
- pnpm test:whatsapp-jobs
- pnpm test:db-queries
- pnpm test:issues
- pnpm test:admin
- pnpm test:fleet
- pnpm test:schedules
- pnpm test:mobile
- pnpm mobile:check
- pnpm test:deployment

Report:
- Files removed/changed.
- Which admin repair endpoints and UI paths remain, and why.
- The new storage variable/volume name and any manual data migration step.
- Test commands and results, including the direct-WhatsApp completion proof.
- Any references intentionally left as historical documentation.
```

## WhatsApp implementation before the handover

Already present before this handover:

- `GET/POST /api/whatsapp/webhook` with raw-body HMAC verification, WABA check and duplicate handling.
- Template quick replies for **Accept job** and **Can't take**.
- Text `ACCEPT`/`DECLINE` with exactly one open offer.
- Interactive **On my way**, **Arrived** and **Working** progress actions.
- Delivery/read/failed status updates and persisted `whatsapp_messages` metadata.
- Web completion at `/j/<offerId>.<signature>`, including note, photos and optional amount.

Still missing: **completion from WhatsApp itself**. Today the **Complete job** button and `DONE`/`COMPLETE` only send the provider the web completion link. Codex must add the durable note/photo completion conversation described above, keep the web page as fallback, and prove the whole accept-to-complete flow over a signed webhook.

## OpenWA touchpoints before removal

| Area | Files |
| --- | --- |
| API wiring | `apps/api/src/app.ts` (constructor, services, start/stop, route registration) |
| OpenWA client | `apps/api/src/issues/openwa.service.ts` |
| OTP/link/audit | `apps/api/src/issues/repair-otp.service.ts`, `repair-access.ts`, `repair-audit.ts`, `apps/api/src/database/configure-repairs.ts` |
| Public repair routes | `apps/api/src/issues/repairs.routes.ts` |
| Repair evidence | `apps/api/src/issues/repairs.service.ts`, `apps/web/src/components/repair-form.tsx`, `apps/web/src/routes/admin.vehicle-disputes.tsx` |
| Public web page | `apps/web/src/routes/repairs.$issueId.tsx`, generated route tree |
| Deployment | `deploy/compose.openwa.yaml`, `deploy/compose.yaml`, `deploy/deploy.sh`, `deploy/init-repairs.py`, `deploy/Caddyfile` |
| Env | `.env.sample`: `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `OPENWA_MECHANICS_GROUP_ID`, `OPENWA_MASTER_KEY`, `OPENWA_KEY_PEPPER`, `REPAIR_LINK_SECRET`, `WHATSAPP_ENABLED`, `REPAIR_DATA_DIR` |
| Tests | `scripts/test-repairs-stack.mjs`, `apps/api/src/issues/repairs.spec.ts`, `scripts/test-deploy-safety.mjs` |
| Docs | `docs/whatsapp-repairs-poc.md`, README, `docs/deployment.md`, `docs/service-jobs.md` |

## Important distinction

The public repair link and OTP flow are the OpenWA-era mechanism for a mechanic to open an issue without a Fleet account. They are not used by new breakdown reports. Removing them does **not** mean removing the administrator’s ability to resolve a vehicle issue from **Exceptions**; that should remain a normal signed-in action.

Likewise, removing OpenWA does **not** remove the Meta webhook or provider WhatsApp actions. The OpenWA cleanup and the webhook/in-chat completion work must land together so the application still has exactly one working provider channel: Meta WhatsApp plus the signed web page.
