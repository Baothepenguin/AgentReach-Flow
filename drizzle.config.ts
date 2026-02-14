import { defineConfig } from "drizzle-kit";
import fs from "node:fs";
import path from "node:path";

function tryLoadDotEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

if (!process.env.DATABASE_URL) {
  // drizzle-kit doesn't always auto-load .env; load it ourselves for local dev.
  tryLoadDotEnvFile(path.resolve(process.cwd(), ".env"));
  tryLoadDotEnvFile(path.resolve(process.cwd(), ".env.local"));
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set (set env var or add it to .env/.env.local)");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
