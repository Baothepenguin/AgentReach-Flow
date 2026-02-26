import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;
const localDatabase = /localhost|127\.0\.0\.1/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
  allowExitOnIdle: true,
  ssl:
    localDatabase || process.env.PGSSLMODE === "disable"
      ? undefined
      : { rejectUnauthorized: false },
});
export const db = drizzle(pool, { schema });

async function tableExists(tableName: string): Promise<boolean> {
  const result = await pool.query<{ exists: string | null }>(
    "select to_regclass($1) as exists",
    [`public.${tableName}`]
  );
  return Boolean(result.rows[0]?.exists);
}

async function ensureContactsArchiveColumns(): Promise<void> {
  if (!(await tableExists("contacts"))) {
    return;
  }

  await pool.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS archived_at timestamp,
      ADD COLUMN IF NOT EXISTS archived_by_id varchar
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contacts_archived_by_id_users_id_fk'
      ) THEN
        ALTER TABLE contacts
          ADD CONSTRAINT contacts_archived_by_id_users_id_fk
          FOREIGN KEY (archived_by_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
}

async function ensureNewsletterLinkColumns(): Promise<void> {
  if (!(await tableExists("newsletters"))) {
    return;
  }

  await pool.query(`
    ALTER TABLE newsletters
      ADD COLUMN IF NOT EXISTS invoice_id varchar,
      ADD COLUMN IF NOT EXISTS subscription_id varchar
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'newsletters_invoice_id_invoices_id_fk'
      ) THEN
        ALTER TABLE newsletters
          ADD CONSTRAINT newsletters_invoice_id_invoices_id_fk
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'newsletters_subscription_id_subscriptions_id_fk'
      ) THEN
        ALTER TABLE newsletters
          ADD CONSTRAINT newsletters_subscription_id_subscriptions_id_fk
          FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
}

async function ensureClientPostmarkColumnsAndTables(): Promise<void> {
  if (await tableExists("clients")) {
    await pool.query(`
      ALTER TABLE clients
        ADD COLUMN IF NOT EXISTS postmark_server_id integer,
        ADD COLUMN IF NOT EXISTS postmark_message_stream_id text,
        ADD COLUMN IF NOT EXISTS postmark_domain text,
        ADD COLUMN IF NOT EXISTS postmark_domain_verification_state text NOT NULL DEFAULT 'not_configured',
        ADD COLUMN IF NOT EXISTS postmark_sender_verification_state text NOT NULL DEFAULT 'missing',
        ADD COLUMN IF NOT EXISTS postmark_quality_state text NOT NULL DEFAULT 'healthy',
        ADD COLUMN IF NOT EXISTS postmark_auto_paused_at timestamp,
        ADD COLUMN IF NOT EXISTS postmark_auto_pause_reason text,
        ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'dfy_active',
        ADD COLUMN IF NOT EXISTS default_delivery_provider text NOT NULL DEFAULT 'postmark',
        ADD COLUMN IF NOT EXISTS default_audience_tag text NOT NULL DEFAULT 'all'
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_postmark_tenants (
      id serial PRIMARY KEY,
      client_id varchar NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
      server_id integer NOT NULL,
      server_token text NOT NULL,
      broadcast_stream_id text NOT NULL,
      webhook_id integer,
      webhook_url text,
      sender_signature_id integer,
      sender_email text,
      sender_confirmed boolean NOT NULL DEFAULT false,
      domain text,
      domain_verification_state text NOT NULL DEFAULT 'not_configured',
      quality_state text NOT NULL DEFAULT 'healthy',
      auto_paused_at timestamp,
      auto_pause_reason text,
      last_bounce_rate decimal(6,4),
      last_complaint_rate decimal(6,4),
      last_health_check_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS client_postmark_tenants_quality_idx
      ON client_postmark_tenants(quality_state)
  `);
}

async function ensureSupportAuditTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_action_audits (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
      target_client_id varchar REFERENCES clients(id) ON DELETE SET NULL,
      action text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_action_audits_actor_idx
      ON support_action_audits(actor_user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_action_audits_client_idx
      ON support_action_audits(target_client_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_action_audits_action_created_idx
      ON support_action_audits(action, created_at)
  `);
}

async function ensureNewsletterSendQueueTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_send_jobs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      newsletter_id varchar NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
      client_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      requested_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
      provider text NOT NULL DEFAULT 'postmark',
      audience_tag text NOT NULL DEFAULT 'all',
      idempotency_key text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      scheduled_for timestamp NOT NULL DEFAULT now(),
      started_at timestamp,
      completed_at timestamp,
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS newsletter_send_jobs_newsletter_idempotency_uq
      ON newsletter_send_jobs(newsletter_id, idempotency_key)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS newsletter_send_jobs_status_scheduled_idx
      ON newsletter_send_jobs(status, scheduled_for)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS newsletter_send_jobs_client_idx
      ON newsletter_send_jobs(client_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS newsletter_send_jobs_newsletter_idx
      ON newsletter_send_jobs(newsletter_id)
  `);
}

async function ensureNewsletterAnalyticsIndexes(): Promise<void> {
  if (await tableExists("newsletter_deliveries")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletter_deliveries_newsletter_status_idx
        ON newsletter_deliveries(newsletter_id, status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletter_deliveries_client_status_idx
        ON newsletter_deliveries(client_id, status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletter_deliveries_message_id_idx
        ON newsletter_deliveries(postmark_message_id)
    `);
  }

  if (await tableExists("newsletter_events")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletter_events_newsletter_event_idx
        ON newsletter_events(newsletter_id, event_type)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletter_events_client_occurred_idx
        ON newsletter_events(client_id, occurred_at)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletter_events_message_id_idx
        ON newsletter_events(postmark_message_id)
    `);
  }
}

async function ensureCoreQueryIndexes(): Promise<void> {
  if (await tableExists("users")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS users_account_type_idx
        ON users(account_type)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS users_diy_client_idx
        ON users(diy_client_id)
    `);
  }

  if (await tableExists("clients")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS clients_service_mode_status_idx
        ON clients(service_mode, subscription_status)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS clients_primary_email_idx
        ON clients(primary_email)
    `);
  }

  if (await tableExists("contacts")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS contacts_client_active_archived_idx
        ON contacts(client_id, is_active, archived_at)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS contacts_client_email_idx
        ON contacts(client_id, email)
    `);
  }

  if (await tableExists("subscriptions")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS subscriptions_client_status_idx
        ON subscriptions(client_id, status)
    `);
  }

  if (await tableExists("invoices")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS invoices_client_status_paid_idx
        ON invoices(client_id, status, paid_at)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS invoices_subscription_idx
        ON invoices(subscription_id)
    `);
  }

  if (await tableExists("newsletters")) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletters_client_status_senddate_idx
        ON newsletters(client_id, status, expected_send_date)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletters_invoice_idx
        ON newsletters(invoice_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS newsletters_subscription_idx
        ON newsletters(subscription_id)
    `);
  }
}

async function ensureUsersTimezoneColumn(): Promise<void> {
  if (!(await tableExists("users"))) {
    return;
  }

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York',
      ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'internal_operator',
      ADD COLUMN IF NOT EXISTS diy_client_id varchar,
      ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false
  `);
}

async function ensureClientCrmConnectionsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_crm_connections (
      id serial PRIMARY KEY,
      client_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider text NOT NULL,
      status text NOT NULL DEFAULT 'connected',
      access_token text NOT NULL,
      account_label text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at timestamp,
      last_sync_status text NOT NULL DEFAULT 'idle',
      last_sync_message text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS client_crm_connections_client_provider_uq
      ON client_crm_connections(client_id, provider)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS client_crm_connections_client_provider_idx
      ON client_crm_connections(client_id, provider)
  `);
}

async function ensureDiyFunnelAndCrmSyncTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS diy_funnel_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      user_id varchar REFERENCES users(id) ON DELETE SET NULL,
      event_type text NOT NULL,
      occurred_at timestamp NOT NULL DEFAULT now(),
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS diy_funnel_events_client_event_created_idx
      ON diy_funnel_events(client_id, event_type, created_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS diy_funnel_events_user_created_idx
      ON diy_funnel_events(user_id, created_at)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_sync_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id varchar NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider text NOT NULL,
      external_event_id text NOT NULL,
      event_type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      processed_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_sync_events_client_provider_external_uq
      ON crm_sync_events(client_id, provider, external_event_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS crm_sync_events_client_created_idx
      ON crm_sync_events(client_id, created_at)
  `);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isSafeSqlIdentifier(value: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(value);
}

async function ensureSupabasePublicApiLockdown(): Promise<void> {
  const { rows } = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);

  for (const row of rows) {
    const tableName = String(row.table_name || "").trim();
    if (!tableName || !isSafeSqlIdentifier(tableName)) {
      continue;
    }
    const fullTable = `public.${quoteIdentifier(tableName)}`;
    await pool.query(`ALTER TABLE ${fullTable} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`REVOKE ALL PRIVILEGES ON TABLE ${fullTable} FROM anon`);
    await pool.query(`REVOKE ALL PRIVILEGES ON TABLE ${fullTable} FROM authenticated`);
  }
}

let schemaReadyPromise: Promise<void> | null = null;

export async function ensureRuntimeSchemaCompatibility(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await ensureContactsArchiveColumns();
      await ensureNewsletterLinkColumns();
      await ensureClientPostmarkColumnsAndTables();
      await ensureSupportAuditTable();
      await ensureNewsletterSendQueueTables();
      await ensureNewsletterAnalyticsIndexes();
      await ensureUsersTimezoneColumn();
      await ensureClientCrmConnectionsTable();
      await ensureDiyFunnelAndCrmSyncTables();
      await ensureCoreQueryIndexes();
      await ensureSupabasePublicApiLockdown();
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}
