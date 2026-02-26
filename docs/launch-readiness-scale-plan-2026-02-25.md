# Flow Launch Readiness + Scale Plan (2026-02-25)

## What to do with remaining weekly usage
Use it on four high-leverage tracks, in this order:
1. Activation conversion (first 15 minutes).
2. Sending reliability and deliverability safety.
3. CRM ingestion (Follow Up Boss first) with idempotent sync.
4. Competitive positioning proof (why $49 wins).

## Competitor snapshot (what matters for Flow)
- Mailchimp is still broad and cheap at entry (Free plan for small lists, paid tiers starting around $13/$20).
- Brevo leads on low entry price ($9 starter) and contact-import simplicity.
- Kit is creator-first (Free newsletter plan, paid automation plans at $33+).
- Flodesk is template-led and simple, now tiered by subscriber count.

Implication: Flow cannot win as a generic email tool. It wins as a **real-estate operating system**:
- Fast onboarding (< 5 min to first send).
- Real-estate template defaults and AI-assisted copy workflow.
- CRM-connected list sync + clean send pipeline.
- Internal team assist mode for done-for-you fulfillment.

## Conversion strategy (MVP)
Target: DIY user sends first newsletter in under 15 minutes.

### Onboarding steps (mandatory)
1. Verify sender email (inbox click).
2. Import contacts (CSV or CRM sync).
3. Complete brand basics (name, logo, colors, city).
4. Pick template style.
5. Generate first newsletter and send test.
6. Schedule or send now.

### Instrumentation events (must ship)
- `onboarding_started`
- `sender_verified`
- `contacts_imported`
- `template_selected`
- `newsletter_generated`
- `test_sent`
- `first_send_scheduled`
- `first_send_completed`

Activation KPI:
- `first_send_completed / onboarding_started` >= 45% for week 1 cohort.
- Median `onboarding_started -> first_send_completed` < 15 minutes.

## Scale architecture (Postmark + Supabase)

### Tenant isolation
- 1 Postmark server per client.
- 1 Broadcast stream per client server for newsletters.
- Store in Supabase:
  - `postmark_server_id`
  - `postmark_server_name`
  - `postmark_stream_id`
  - `sender_signature_status`
  - `domain_auth_status`

### Sending pipeline
- Do not send in request/response cycle.
- Queue recipient jobs in DB (pgmq-backed queue).
- Worker pulls jobs and calls Postmark `/email/batch` in chunks up to 500.
- Persist per-recipient delivery record with `postmark_message_id`.
- Idempotency key: `(newsletter_id, recipient_email, send_mode)` unique.

### Webhook truth model
Enable modular webhooks and write directly to event table:
- Delivery
- Open
- Click
- Subscription Change
- (Transactional streams also: Bounce + Spam Complaint)

### Guardrails
- Warn at bounce >= 8% or spam complaint >= 0.08%.
- Auto-pause sending at bounce >= 10% or spam complaint >= 0.1%.
- Enforce unsubscribe handling for broadcast sends.
- Keep transactional and broadcast streams separate.

### Supabase hygiene
- Strong indexes: `(client_id, created_at)` on every large tenant table.
- RLS on all tenant data via `client_id` scoping.
- Use connection pooling for app traffic.
- Partition high-volume event tables by month when needed.

## CRM roadmap (priority)

### P0: Follow Up Boss (now)
- Webhook-first ingest (`peopleCreated`, `peopleUpdated`, `peopleDeleted`, tag/stage updates).
- Initial backfill with paginated API pull.
- One-way default behavior:
  - FUB -> Flow always.
  - Flow -> FUB only when user explicitly edits mapped fields in Flow.

### P1: Real Geeks + BoomTown
- Real Geeks has inbound/outbound API patterns and is straightforward to wire.
- BoomTown supports API integrations with newer API versions and partner ecosystem.

### P2: BoldTrail/kvCORE
- Treat as partner-gated/public-doc-limited integration; plan discovery sprint before build.

## 4-week execution plan

### Week 1
- Ship onboarding instrumentation + funnel dashboard.
- Ship sender verification UX hardening (clear failure reasons and retry paths).
- Validate first-send flow end-to-end with 3 live pilot clients.

### Week 2
- Move all newsletter sends to queue worker path.
- Enable modular webhooks and reconciliation jobs.
- Add deliverability guardrails + auto-pause.

### Week 3
- Finish FUB incremental sync reliability (idempotency + retry + conflict logs).
- Add admin visibility: client -> Postmark server link + stream status + verification badge.

### Week 4
- Run launch cohort test (20-30 users).
- Measure activation + first-send completion.
- Fix top 5 drop-off causes and lock release.

## Non-negotiable release gates
- No cross-tenant leakage under RLS tests.
- No inline bulk send in API route handlers.
- Every sent recipient has a stored Postmark message ID.
- Webhook retries are idempotent.
- First-send flow completes in <15 min for a fresh DIY account.

## Sources
- Postmark batch sending and limits: https://postmarkapp.com/developer/user-guide/send-email-with-api/batch-emails
- Postmark API overview/auth: https://postmarkapp.com/developer/api/overview
- Postmark message streams API: https://postmarkapp.com/developer/api/message-streams-api
- Postmark modular webhooks: https://postmarkapp.com/support/article/1115-how-do-modular-webhooks-work
- Postmark broadcast unsubscribe requirement: https://postmarkapp.com/support/article/1217-why-broadcasts-require-an-unsubscribe-link
- Postmark no daily send limit + quality thresholds: https://postmarkapp.com/support/article/1111-does-postmark-have-a-daily-send-limit
- Postmark servers API (create/edit/delete): https://postmarkapp.com/developer/api/servers-api
- Postmark sender signatures: https://postmarkapp.com/developer/api/signatures-api
- Postmark domain verification: https://postmarkapp.com/support/article/how-do-i-verify-a-domain
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase connection methods/pooling: https://supabase.com/docs/reference/postgres/connection-strings
- Supabase queues overview: https://supabase.com/docs/guides/queues
- Supabase PGMQ extension: https://supabase.com/docs/guides/queues/pgmq
- Supabase partitioning: https://supabase.com/docs/guides/database/partitions
- Follow Up Boss API getting started: https://docs.followupboss.com/
- Follow Up Boss auth: https://docs.followupboss.com/docs/authentication
- Follow Up Boss webhooks: https://docs.followupboss.com/reference/webhooks-guide
- Follow Up Boss rate limits: https://docs.followupboss.com/reference/rate-limiting
- Follow Up Boss pagination: https://docs.followupboss.com/reference/pagination
- Mailchimp pricing: https://mailchimp.com/pricing/marketing/
- Mailchimp import contacts: https://mailchimp.com/help/import-subscribers-to-a-list/
- Brevo pricing: https://www.brevomarketing.com/pricing/
- Kit pricing: https://kit.com/pricing
- Kit first newsletter flow: https://help.kit.com/en/articles/5379931-how-to-create-your-first-newsletter-in-kit
- Flodesk pricing: https://flodesk.com/pricing
- Flodesk email onboarding summary: https://flodesk.com/email
- BoomTown API docs entry: https://developers.goboomtown.com/api-v2
- Real Geeks developer portal: https://developers.realgeeks.com/
- BoldTrail product site: https://boldtrail.com/
