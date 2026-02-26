import { pool } from "../server/db";

function assertSafeMode() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--confirm")) {
    throw new Error("Refusing to reset demo data without --confirm");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset demo data in production");
  }
}

async function tableExists(table: string): Promise<boolean> {
  const result = await pool.query("select to_regclass($1) as relation_name", [`public.${table}`]);
  return !!result.rows[0]?.relation_name;
}

async function main() {
  assertSafeMode();

  const resetOrder = [
    "crm_sync_events",
    "diy_funnel_events",
    "newsletter_events",
    "newsletter_deliveries",
    "review_comments",
    "review_tokens",
    "tasks_flags",
    "ai_drafts",
    "newsletter_versions",
    "newsletters",
    "invoices",
    "subscriptions",
    "contact_import_jobs",
    "client_crm_connections",
    "client_postmark_tenants",
    "contact_segments",
    "contacts",
    "client_notes",
    "branding_kits",
    "clients",
  ];

  for (const table of resetOrder) {
    if (!(await tableExists(table))) continue;
    await pool.query(`DELETE FROM ${table}`);
    console.log(`[seed:reset] cleared ${table}`);
  }

  console.log("[seed:reset] demo data reset complete");
}

main()
  .catch((error) => {
    console.error("[seed:reset] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
