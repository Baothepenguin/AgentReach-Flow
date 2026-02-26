# AgentReach FLOW — Media-First + Lead Revival Spec (2026-02-19)

## 1) Goal
Turn Flow from a newsletter ops tool into a growth operating system that helps agents:
- generate local attention ("media company that sells real estate")
- capture and own first-party audience
- reactivate stale leads into booked calls

Primary commercial wedge:
- **Lead Revival Engine**
- Price model: **$500 setup + $497-$997/month + optional pay-per-booked-call**

## 2) Product Thesis
If Flow combines:
1. media content creation (top of funnel),
2. database capture + nurture (middle),
3. stale lead reactivation + booking (bottom),

then AgentReach owns the full demand loop and is not dependent on rented portal leads.

## 3) Scope to Add Inside Flow

### 3.1 Pillar A: Lead Revival Engine (MVP first)
Purpose: pull stale leads and run personalized multi-touch outreach that books calls directly.

MVP capabilities:
- Segment stale contacts by inactivity window (`30/60/90+ days`).
- AI-personalized outreach sequence generator (email + SMS copy).
- Sequence scheduler with safety limits and quiet hours.
- Booking CTA insertion (Calendly or internal booking URL).
- Lead state transitions: `stale -> warming -> engaged -> booked -> do_not_contact`.
- Revenue tracking: booked calls, show rate, closings (manual first).

### 3.2 Pillar B: Digital Mayor Content Engine
Purpose: generate hyper-local content ideas and scripts that build authority.

MVP capabilities:
- Local source ingest queue (RSS/feed URLs or manual links first).
- AI summary into 5 "cliffhangers".
- Auto script drafts for short-form video + newsletter blurb.
- Publish checklist and repurposing queue (shorts, email, blog, social post).

### 3.3 Pillar C: Owned Media Funnel
Purpose: move from social reach to owned database.

MVP capabilities:
- Lead magnet library (city guides, vibe guides, relocation handbooks).
- Capture forms with source attribution (manual embed/URL params first).
- Auto-tagging by magnet + neighborhood.
- Weekly nurture automation ("This Week in [City]").

### 3.4 Pillar D: Hyper-Local Niche System
Purpose: enable sub-market specialization.

MVP capabilities:
- Per-client "Primary Niche" profile (town/neighborhood/persona).
- Content ratio target tracking (80% local lifestyle/news, 20% listings).
- Niche dashboard: content output, list growth, booking rate.

## 4) Fit with Current Codebase
Existing Flow primitives already support this direction:
- contacts, imports, and segments in `/Users/bao/Documents/Flow/AgentReach-Flow/shared/schema.ts`
- audience and client management pages in `/Users/bao/Documents/Flow/AgentReach-Flow/client/src/pages/audience-manager.tsx` and `/Users/bao/Documents/Flow/AgentReach-Flow/client/src/pages/clients-list.tsx`
- AI prompt stack in `/Users/bao/Documents/Flow/AgentReach-Flow/shared/schema.ts` (`ai_prompts`)
- send/schedule and analytics routes in `/Users/bao/Documents/Flow/AgentReach-Flow/server/routes.ts`

Gap today:
- no outreach sequence orchestration model
- no SMS pipeline
- no booking attribution data model
- no local content-source ingestion workflow

## 5) Data Model Additions (Proposed)
Add to `/Users/bao/Documents/Flow/AgentReach-Flow/shared/schema.ts`:

1. `lead_profiles`
- `contactId`, `leadStage`, `lastEngagedAt`, `staleBucket`, `priorityScore`, `ownerId`

2. `outreach_sequences`
- `clientId`, `name`, `channelMix`, `goal`, `isActive`

3. `outreach_sequence_steps`
- `sequenceId`, `stepOrder`, `channel` (`sms|email|task|voicemail`), `delayHours`, `template`

4. `outreach_enrollments`
- `sequenceId`, `contactId`, `status`, `currentStep`, `nextRunAt`, `stopReason`

5. `outreach_messages`
- `enrollmentId`, `stepId`, `channel`, `content`, `sentAt`, `deliveryStatus`, `replyDetected`

6. `booking_events`
- `contactId`, `newsletterId` (nullable), `source`, `bookedAt`, `showedAt`, `outcomeValue`

7. `media_sources`
- `clientId`, `sourceType`, `url`, `active`, `lastFetchedAt`

8. `media_ideas`
- `clientId`, `sourceId`, `headline`, `summary`, `hookPoints`, `format`, `status`

## 6) API Surface (Proposed)
Add routes in `/Users/bao/Documents/Flow/AgentReach-Flow/server/routes.ts`:

- `POST /api/clients/:id/lead-revival/run-scan`
- `GET /api/clients/:id/lead-revival/stale-leads`
- `POST /api/clients/:id/sequences`
- `POST /api/sequences/:id/enroll`
- `POST /api/enrollments/:id/pause`
- `POST /api/enrollments/:id/resume`
- `POST /api/enrollments/:id/mark-booked`
- `GET /api/clients/:id/lead-revival/metrics`
- `POST /api/clients/:id/media-sources`
- `POST /api/clients/:id/media-ideas/generate`
- `GET /api/clients/:id/media-ideas`

## 7) UX Additions (Proposed)
Add pages:
- `/lead-revival` (pipeline + enrollments + booked calls)
- `/media-engine` (sources -> hooks -> scripts -> publish queue)
- `/lead-magnets` (asset library + capture attribution)

Reuse patterns from existing newsletter editor/review state handling.

## 8) Delivery Plan (8 Weeks)

### Phase 1 (Weeks 1-2): Lead Revival Core
- schema + migrations for lead profile and sequence tables
- stale-lead scan job and manual run endpoint
- basic sequence builder (email-only first)
- KPI panel: enrolled, replied, booked

### Phase 2 (Weeks 3-4): SMS + Booking
- SMS provider integration (Twilio or equivalent)
- quiet-hour and rate-limit enforcement
- booking URL attribution + booked-call event capture
- per-client sequence templates

### Phase 3 (Weeks 5-6): Digital Mayor Engine
- media source registry + fetch worker
- AI cliffhanger generation
- script and newsletter block draft creation
- approval and publish checklist UI

### Phase 4 (Weeks 7-8): Owned Funnel + Reporting
- lead magnet catalog and attribution tagging
- weekly nurture automation templates
- funnel dashboard:
  - content published
  - leads captured
  - stale leads revived
  - calls booked
  - estimated pipeline value

## 9) Success Metrics (North Star + Guardrails)

North Star:
- `Booked calls per 1,000 stale contacts per month`

Supporting:
- stale lead reactivation rate
- response rate by channel
- show-up rate
- close rate on revived leads
- list growth rate from owned channels
- 90-day retention of paying clients

Guardrails:
- unsubscribe/opt-out rate
- complaint/spam rate
- SMS compliance violations

## 10) Commercial Packaging in Flow
Core offer:
- Setup: $500
- Monthly platform + managed ops: $497 (single market) / $997 (multi-market)
- Performance add-on: pay-per-booked-call

Add-ons:
- Digital Mayor Engine
- Newsletter + nurture production
- Local partner interview pipeline

## 11) Risks and Controls
1. Compliance risk (SMS/email outreach)
- enforce opt-out handling, quiet hours, and suppression lists by default

2. Data quality risk (old CRM data)
- run enrichment/normalization before enrollment

3. Attribution risk
- default to conservative attribution windows and expose manual override

4. Fulfillment bottleneck
- template libraries + standardized sequence playbooks before scaling clients

## 12) Definition of Done
- A client can enroll stale leads into a sequence in under 10 minutes.
- Sequence can send email + SMS with personalization tokens.
- Booking events automatically map back to enrollments.
- Dashboard shows booked calls, show rate, and revenue estimate.
- Team can run weekly media idea generation from local sources.
