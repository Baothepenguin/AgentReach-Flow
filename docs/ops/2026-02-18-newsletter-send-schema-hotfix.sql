-- Hotfix applied on 2026-02-18 to production DB.
-- Reason: send/schedule/cron paths failed due to missing columns/tables.

ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS preview_text text;
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS from_email text;
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS send_mode text DEFAULT 'ai_recommended';
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/New_York';
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS scheduled_at timestamp;
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS sent_at timestamp;
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS editor_version text DEFAULT 'v1';

CREATE TABLE IF NOT EXISTS client_onboarding_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_id uuid NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email text NOT NULL,
  audience_tag text DEFAULT 'all',
  postmark_message_id text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_id uuid NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email text,
  postmark_message_id text,
  event_type text NOT NULL,
  occurred_at timestamp,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletters_scheduled_at ON newsletters(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_newsletter_deliveries_newsletter_id ON newsletter_deliveries(newsletter_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_events_newsletter_id ON newsletter_events(newsletter_id);
