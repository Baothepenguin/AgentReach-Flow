import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

let schemaReadyPromise: Promise<void> | null = null;

export async function ensureRuntimeSchemaCompatibility(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await ensureContactsArchiveColumns();
      await ensureNewsletterLinkColumns();
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}
