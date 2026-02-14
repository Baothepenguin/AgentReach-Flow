# Flow Newsletter V1 Spec (2026-02-13)

## 1) Product Goal
Flow should let internal VAs produce, review, revise, schedule, send, and analyze client newsletters with minimal friction.

Primary outcome:
- VAs can generate and ship quality newsletters fast.
- Clients can review through secure links without account creation.
- Sending, audience setup, and analytics happen inside Flow.

## 2) Confirmed Product Decisions

From founder interview (locked):
- AI generation mode: `Hybrid` (full draft first, section-level regenerate after)
- Review comments: `Inline + general campaign comments`
- Review link security: `Private unguessable link only`
- VA changes workflow: `Auto-create tasks from comments + manual tasks`
- QA gate: `Mixed blockers + warnings`
- Scheduling: `AI recommends send time, VA confirms`, with per-client overrides:
  - fixed send time
  - send immediately after approval
  - AI-recommended time
- CSV minimum required: `email` only
- Missing CSV tags: auto-assign `all` silently
- Status machine: `Draft -> In Review -> Changes Requested -> Approved -> Scheduled -> Sent`
- Analytics depth: `Campaign + contact-level timeline`
- Send confirmation UI: `Minimal clean confirmation`

Must-have list chosen:
- AI draft generation
- Block editor + drag-and-drop
- Client review link with inline comments
- One-click schedule/send
- Sender verification via Postmark
- CSV import + smart mapping

Also included in V1 (requested):
- Mobile preview
- Brand-kit constrained styling
- Pre-send QA checks
- Campaign metadata and post-send analytics

## 3) Current Codebase Reality (What Exists)

Relevant current implementation:
- Newsletter editor is HTML-first and hard to control:
  - `client/src/pages/newsletter-editor.tsx`
  - `client/src/components/HTMLPreviewFrame.tsx`
- Public review exists, but comments are mostly general:
  - `client/src/pages/review.tsx`
  - `server/routes.ts` review endpoints
  - `shared/schema.ts` `review_comments.section_id` already exists (good base)
- AI chat + prompts exist:
  - `client/src/components/GeminiChatPanel.tsx`
  - `server/routes.ts` chat/prompt endpoints
  - `shared/schema.ts` `ai_prompts`, `newsletter_chat_messages`
- Sender signature creation exists at client creation:
  - `server/routes.ts` client create + verification status routes
  - `server/postmark-service.ts`
- No real send engine, no contacts/segments schema, no campaign event analytics model yet.

## 4) V1 Experience Blueprint

### 4.1 VA Workflow
1. Open campaign.
2. Choose template/module set.
3. Click `Generate Draft` (uses master + client prompt + brand kit).
4. Edit via block canvas (drag, reorder, block-level edit, section regenerate).
5. Run QA gate.
6. Send review link to client.
7. Resolve inline/general comments (task list auto-generated).
8. Approve.
9. `Schedule` or `Send now`.
10. Track campaign + contact-level results.

### 4.2 Client Workflow (No Login)
1. Open secure review link.
2. Switch desktop/mobile preview.
3. Click block to add inline comment or add general comment.
4. Approve or request changes.

### 4.3 Onboarding Workflow (No Login)
1. Open secure onboarding link.
2. Confirm sender email (Postmark verification email resend available).
3. Upload CSV.
4. Smart mapping suggests email/first_name/last_name/tags columns.
5. If tags absent, all contacts receive tag `all`.
6. Done.

## 5) Editor Architecture (V1)

### 5.1 Editing Model
Use structured block document as source of truth, compile to HTML for preview/send/export.

Document shape:
- `templateId`
- `theme` (brand-derived)
- `blocks[]` (ordered)
- `meta` (subject, preview text, fromEmail, send settings)
- compiled `html` cache

Implementation strategy:
- Re-activate and extend module architecture in `shared/schema.ts` and `server/email-compiler.ts`.
- Keep HTML fallback for migrated campaigns.

### 5.2 Block Types for V1
Required:
- text
- image
- button
- divider
- socials
- grid (1/2/3 column)
- image+button combo

Template modules to ship:
- featured listings
- welcome message
- mortgage rate block
- local/hobby block (golf/cooking/recipes/cocktails)

### 5.3 Layout UX
- Left: template and block library
- Center: canvas preview with desktop/mobile switch
- Right: properties inspector + task/QA panel
- Drag/drop reorder with `@dnd-kit` (already in dependencies)

## 6) AI Spec (V1 Bridge to Full AI)

### 6.1 Draft Generation
`Generate Draft` builds full campaign from:
- master prompt
- client prompt
- brand kit values
- selected template structure

### 6.2 Section Regenerate
For each block:
- `Regenerate section`
- `Rewrite shorter/longer`
- `Adjust tone`

### 6.3 Prompt Governance
- Master and client prompt remain editable from AI panel.
- Client-specific prompt can be stored in brand kit profile metadata (logical view), backed by existing `ai_prompts`.

## 7) Review + Task Loop

### 7.1 Inline Comments
- Each block rendered with stable `data-block-id`.
- Review UI allows selecting block and posting comment linked to `sectionId = blockId`.

### 7.2 General Comments
- Campaign-level comment stream remains available.

### 7.3 VA Task System
- New client comments auto-create unresolved tasks.
- VA can add manual tasks.
- Completing all required tasks can auto-suggest status change to `In Review`.

## 8) Status Machine (V1)

Replace status set with:
- `draft`
- `in_review`
- `changes_requested`
- `approved`
- `scheduled`
- `sent`

Transition rules:
- New campaign -> `draft`
- Send review link -> `in_review`
- New client comment -> `changes_requested`
- Client approve -> `approved`
- Schedule set -> `scheduled`
- Successful delivery kickoff -> `sent`

## 9) QA Gate (Mixed Blockers and Warnings)

### 9.1 Blockers (cannot send/schedule)
- sender email not verified
- missing subject line
- missing from email
- zero valid recipients
- malformed URL(s)
- unresolved required change requests

### 9.2 Warnings (send allowed with confirmation)
- missing alt text
- long subject line
- missing preview text
- low personalization coverage (no first-name tokens)
- suspected grammar/style issues

## 10) Sending + Scheduling

### 10.1 Send Modes per Client
- `fixed_time`
- `immediate_after_approval`
- `ai_recommended`

Per-campaign override allowed by VA.

### 10.2 One-Click Send/Schedule
Send panel must show before confirm:
- from email
- audience list + segment
- subject line
- preview text
- schedule timestamp/timezone
- estimated recipient count

### 10.3 Postmark
- Use Postmark send API for campaign dispatch.
- Use metadata on each message (`newsletterId`, `clientId`, `contactId`) for event reconciliation.

## 11) Contacts, CSV, and Segments

### 11.1 CSV Rules
- Required: `email`
- Optional: `first_name`, `last_name`, `tags`
- If tags absent -> assign `all`
- Smart mapper suggests column matching and lets VA confirm

### 11.2 Segmentation V1
- Start with tag-based segments:
  - `all`
  - custom tag filters

## 12) Analytics (Campaign + Contact Timeline)

Campaign-level metrics:
- sent
- delivered
- opens
- clicks
- bounces
- unsubscribes

Contact-level timeline:
- per recipient event stream with timestamps and event type
- surfaced in campaign analytics drawer

Data source:
- Postmark webhooks -> persisted events.

## 13) Data Model Changes

Update `shared/schema.ts` with:
- `contacts`
- `contact_import_jobs`
- `contact_lists` (or per-client list abstraction)
- `contact_segments` (tag/filter based)
- `newsletter_sends` (send jobs)
- `newsletter_recipients`
- `newsletter_events`
- onboarding token table (`client_onboarding_tokens`)
- optional `status_history` table for audit trail

Extend existing tables:
- `newsletters`
  - subject
  - previewText
  - fromEmail
  - scheduledAt
  - sentAt
  - sendMode
  - timezone
  - editorVersion/document version marker

## 14) API Changes

Add endpoints in `server/routes.ts`:
- `POST /api/clients/:id/onboarding-link`
- `GET /api/onboarding/:token`
- `POST /api/onboarding/:token/verify-sender/resend`
- `POST /api/onboarding/:token/contacts/import-csv`
- `GET /api/clients/:id/contacts`
- `GET /api/clients/:id/segments`
- `POST /api/newsletters/:id/qa-check`
- `POST /api/newsletters/:id/schedule`
- `POST /api/newsletters/:id/send-now`
- `GET /api/newsletters/:id/analytics`
- `GET /api/newsletters/:id/contacts/:contactId/timeline`
- `POST /api/webhooks/postmark/events`

Evolve existing endpoints:
- `/api/newsletters/:id` to return structured block document + campaign metadata
- review comment routes to support explicit inline anchors (`sectionId`)

## 15) Frontend Changes

Primary files to replace/extend:
- `client/src/pages/newsletter-editor.tsx`
- `client/src/components/HTMLPreviewFrame.tsx`
- `client/src/components/RightPanel.tsx`
- `client/src/pages/review.tsx`
- `client/src/pages/client-profile.tsx` (onboarding + sender status entry points)
- `client/src/components/GeminiChatPanel.tsx` (section regenerate actions)

New screens/components:
- block canvas editor
- block property inspector
- QA panel
- send/schedule drawer
- onboarding portal page
- contact import mapper
- analytics dashboard panel

## 16) Delivery Plan (All Features Included)

### Phase 1: Foundation
- schema updates + status migration
- newsletter metadata fields
- contacts/segments/event tables
- onboarding tokens

### Phase 2: Onboarding + Audience
- sender verification flow (resend + status polling)
- CSV import with smart mapping and defaults
- basic segment manager

### Phase 3: Block Editor + AI Hybrid
- block document persistence
- drag/drop editor shell
- template/module library
- full draft generation + section regenerate

### Phase 4: Review + Task Loop
- inline comment anchors
- general comments
- auto-generated VA tasks + manual tasks
- status transition automation

### Phase 5: QA + Send/Schedule
- blocker/warning validator
- one-click schedule/send
- send modes (fixed/immediate/AI recommended)

### Phase 6: Analytics
- Postmark event webhook ingestion
- campaign metrics
- contact-level timeline UI

## 17) Acceptance Criteria

V1 is done when:
- VA can create draft from AI in one action.
- VA can edit with drag/drop blocks and mobile preview.
- Client can leave inline + general comments via secure link.
- VA sees comment tasks and resolves them in-editor.
- Sender verification and CSV onboarding are completed without client login.
- Campaign can be scheduled/sent in one flow with QA gate.
- Dashboard shows campaign metrics and contact-level event timelines.

## 18) Technical Notes for Migration

- Keep legacy HTML campaigns readable; only new campaigns require block document.
- Compiler should support both:
  - structured document -> HTML
  - raw HTML pass-through
- Migrate status labels carefully across:
  - `client/src/pages/newsletters.tsx`
  - `client/src/components/RightPanel.tsx`
  - `client/src/pages/master-dashboard.tsx`
  - `shared/schema.ts`

