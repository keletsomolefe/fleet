# Codex handover prompt: Meta WhatsApp service jobs

This is the original handover for reviewing the WhatsApp integration. See [WhatsApp service jobs](whatsapp-service-jobs.md) for the current setup and behaviour. The feature is already implemented in the repository; Codex should verify it, fix concrete defects, and add missing tests rather than rebuilding it.

```text
You are reviewing and hardening the Meta WhatsApp Cloud API integration in the VHH Fleet repository at /Users/keletso/Dev/fleet.

Read first:
- AGENTS.md, README.md, docs/service-jobs.md, docs/whatsapp-service-jobs.md
- docs/database.md (the API uses MikroORM 7; migrations and seeders are native, Fastify-native services/routes, no NestJS patterns)
- apps/api/src/whatsapp/**
- apps/api/src/service-jobs/**
- apps/api/src/issues/issue.input.ts and issues.service.ts
- apps/api/src/database/database.ts and mikro-orm.config.ts
- apps/api/src/app.ts and the route registration
- scripts/test-service-jobs-stack.mjs, scripts/test-whatsapp-jobs-stack.mjs, scripts/test-service-job-queries.mjs
- scripts/demo-whatsapp-alert.mjs and docs/whatsapp-cloud-api-demo.md for the existing Meta test sender

Goal:
Independently verify that the Service jobs WhatsApp integration is correct and production-safe. Fix concrete defects you find. Do not rewrite the UI. Do not replace MikroORM or introduce NestJS-style modules. Keep the existing route paths and response shapes.

Check and fix:

1. Template send
- Initial alert is a Meta template named by META_WHATSAPP_JOB_TEMPLATE (default vhh_service_job_alert), language META_WHATSAPP_TEMPLATE_LANGUAGE (default en_US).
- Body parameters: job reference, registration, fleet number, "service type: issue summary", location or "Shared on the job page".
- URL button is index 2, sub_type url, parameter is the signed provider-link suffix. Quick replies are index 0 Accept job and 1 Can't take.
- Parameters are clipped, newline-collapsed and URL-free. No link/token appears in a body parameter.
- One template per eligible provider. Never a group message. Bounded concurrency/pacing and no live Meta calls in tests.
- Error classification: 429/5xx transient, permanent 4xx, ambiguous network/timeout. Never auto-retry an ambiguous send (duplicate-alert risk). Store code/title/wamid in whatsapp_messages and the offer.

2. Webhook
- GET /whatsapp/webhook verifies hub.mode/hub.verify_token and returns hub.challenge.
- POST /whatsapp/webhook verifies X-Hub-Signature-256 over the raw request bytes with META_WHATSAPP_APP_SECRET before JSON parsing. Missing/invalid secret or signature fails closed. WABA id is checked when configured.
- Template quick replies map context.id (the original alert wamid) to the offer, verify the sender phone matches the provider, and accept/decline idempotently. If context is missing, only act when the provider has exactly one open offer; otherwise send an instruction.
- Interactive custom ids are offer:<offerId>:en_route|arrived|working|complete. Verify provider and job state.
- Text STOP/UNSUBSCRIBE/etc disables alerts; ACCEPT/DECLINE works only with one open offer; DONE/COMPLETE returns the completion link; unknown text gets a short instruction.
- Status events update sent/delivered/read/failed without regressing accepted/declined.
- Duplicate webhooks are idempotent. Real processing failures return 500 so Meta retries; verified duplicates return 200. Invalid signatures return 403.
- Replies are free-form interactive/text only inside the 24-hour window; initial alerts are templates. The completion page is linked with #complete.

3. Provider links and attribution
- Link is `https://<APP_URL>/j/<offerId>.<hmac>`; signature covers `offerId:linkVersion` with SERVICE_JOB_LINK_SECRET. Incrementing linkVersion revokes old links.
- Malformed links (wrong UUID/signature length) return 401, never 500.
- The provider page/API exposes only that provider's job: no driver phone, other providers or internal notes. Losing/expired offers get a minimal payload. Actions record provider, channel, timestamp and WhatsApp profile name/self-reported name.
- No plaintext link code is stored in the database.

4. Queue and worker
- Offers are the durable outbox. Claim due offers transactionally; skip if job accepted/cancelled/closed or provider paused/opted out.
- Stale `sending` claims are recovered conservatively (no silent duplicate send).
- The worker wakes immediately after a report/broadcast and drains more than one small batch when several providers are eligible.
- Failed alerts are visible in the admin job detail and can be resent. Alerts-disabled/no-provider jobs record alerts_skipped and do not send.

5. Secrets and consent
- Access token, app secret and verify token are server-only, never logged, never in web/mobile. Production requires HTTPS.
- Provider consent is required on creation/re-enable/number change; STOP records opt-out; re-enabling requires new consent.
- Alerts are sent only to active, alerts-enabled, non-opted-out providers with a number.

6. Tests and docs
- Extend the existing stack tests rather than adding a parallel harness. Run:
  - pnpm --filter api typecheck
  - pnpm --filter api test
  - pnpm --filter api build
  - pnpm test:service-jobs
  - pnpm test:whatsapp-jobs
  - pnpm test:db-queries
- Add regression tests for any defect you fix. Never call live Meta in automated tests; use META_WHATSAPP_GRAPH_URL to a local fake Graph server.
- Update docs/whatsapp-service-jobs.md if a material behavior or setup step changes.

Write scope: you may edit apps/api/src/whatsapp/**, apps/api/src/service-jobs/**, docs/whatsapp-service-jobs.md, and the existing stack tests. Do not edit apps/web, apps/mobile, database migrations or unrelated services. Do not commit credentials. Report changed files, commands/results, and any remaining operational prerequisites (template approval, permanent token, webhook registration, test allowlist).
```

## Current implementation notes

- Use only Meta service jobs for provider dispatch. The old group repair proof of concept and public repair links have since been removed.
- The code lives in `apps/api/src/whatsapp/` and `apps/api/src/service-jobs/`.
- The two stack tests use a fake Meta Graph server and signed webhook requests; no live messages are sent.
- The template copy and setup checklist are in [whatsapp-service-jobs.md](whatsapp-service-jobs.md).
