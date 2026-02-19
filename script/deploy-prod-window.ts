import { appendFile, readFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RELEASE_LOG_PATH = "/tmp/flow-release.log";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function log(message: string): void {
  console.log(`[release:prod] ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function sanitizeLogValue(value: unknown): string {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9._:/+-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

async function appendReleaseLog(record: Record<string, unknown>): Promise<void> {
  const line = Object.entries(record)
    .map(([key, value]) => `${key}=${sanitizeLogValue(value)}`)
    .join(" ");
  await appendFile(RELEASE_LOG_PATH, `${line}\n`, "utf8");
}

async function parseEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const parsed: Record<string, string> = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
      const equalsIndex = normalized.indexOf("=");
      if (equalsIndex <= 0) continue;

      const key = normalized.slice(0, equalsIndex).trim();
      if (!key) continue;

      let value = normalized.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\n/g, "\n");
      parsed[key] = value;
    }

    return parsed;
  } catch {
    return {};
  }
}

async function loadProjectEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const vercelEnv = await parseEnvFile(path.join(PROJECT_ROOT, ".env.vercel.local"));
  const localEnv = await parseEnvFile(path.join(PROJECT_ROOT, ".env.local"));

  return {
    ...vercelEnv,
    ...localEnv,
    ...process.env,
    ...extra,
  };
}

async function runCommand(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: { stream?: boolean; allowFailure?: boolean } = {}
): Promise<CommandResult> {
  const stream = options.stream ?? true;
  const allowFailure = options.allowFailure ?? false;

  const result = await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      if (stream) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      if (stream) process.stderr.write(text);
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });

  if (!allowFailure && result.code !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")} (code=${result.code})`);
  }

  return result;
}

async function getCommitSha(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const result = await runCommand("git", ["rev-parse", "--short", "HEAD"], env, {
      stream: false,
      allowFailure: true,
    });

    if (result.code !== 0) return "unknown";
    const sha = result.stdout.trim();
    return sha || "unknown";
  } catch {
    return "unknown";
  }
}

function parseWindowTime(value: string, label: string): number {
  const normalized = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) {
    fail(`${label} must be in HH:MM format (received "${value}")`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    fail(`${label} must be a valid 24-hour time (received "${value}")`);
  }

  return hours * 60 + minutes;
}

function resolveReleaseTimezone(value: string): string {
  const normalized = value.trim();
  const map: Record<string, string> = {
    MST: "America/Phoenix",
    "UTC-07:00": "Etc/GMT+7",
    "UTC-07": "Etc/GMT+7",
  };

  return map[normalized] || normalized;
}

function validateTimezone(timezone: string): void {
  try {
    // Throws if timezone is invalid.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    fail(`Invalid RELEASE_TIMEZONE value: "${timezone}"`);
  }
}

function getZonedParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const read = (type: string): number => {
    const part = parts.find((entry) => entry.type === type)?.value;
    if (!part) {
      fail(`Failed to resolve ${type} for timezone ${timezone}`);
    }
    return Number(part);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function formatDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

function formatDateOnly(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function extractDeployUrl(output: string): string | null {
  const urls = output.match(/https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g) || [];
  const vercelUrls = urls.filter((url) => url.includes("vercel.app") || url.includes("vercel.com"));
  if (vercelUrls.length === 0) return null;
  return vercelUrls[vercelUrls.length - 1];
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const emergency = args.has("--emergency");

  const env = await loadProjectEnv();
  const sha = await getCommitSha(env);
  const now = new Date();

  const configuredTimezone = env.RELEASE_TIMEZONE || "MST";
  const releaseTimezone = resolveReleaseTimezone(configuredTimezone);
  validateTimezone(releaseTimezone);

  const windowStart = env.RELEASE_WINDOW_START || "14:00";
  const windowEnd = env.RELEASE_WINDOW_END || "15:00";
  const startMinutes = parseWindowTime(windowStart, "RELEASE_WINDOW_START");
  const endMinutes = parseWindowTime(windowEnd, "RELEASE_WINDOW_END");

  if (endMinutes <= startMinutes) {
    fail("RELEASE_WINDOW_END must be later than RELEASE_WINDOW_START");
  }

  const releaseNowParts = getZonedParts(now, releaseTimezone);
  const nowMinutes = releaseNowParts.hour * 60 + releaseNowParts.minute;
  const inWindow = nowMinutes >= startMinutes && nowMinutes < endMinutes;

  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "system";
  const localNowDisplay = formatDateTime(now, systemTimezone);
  const releaseNowDisplay = formatDateTime(now, releaseTimezone);
  const attemptTs = now.toISOString();

  log(
    `release_attempt ts=${attemptTs} sha=${sha} mode=${emergency ? "emergency" : "window"} window=${windowStart}-${windowEnd} tz=${releaseTimezone}`
  );

  await appendReleaseLog({
    ts: attemptTs,
    event: "release_attempt",
    sha,
    mode: emergency ? "emergency" : "window",
    tz_config: configuredTimezone,
    tz_effective: releaseTimezone,
    window_start: windowStart,
    window_end: windowEnd,
    local_now: localNowDisplay,
    release_now: releaseNowDisplay,
  });

  if (emergency) {
    const reason = (env.RELEASE_EMERGENCY_REASON || "").trim();
    if (!reason) {
      const message = "Emergency release blocked: set RELEASE_EMERGENCY_REASON with a non-empty value.";
      await appendReleaseLog({
        ts: new Date().toISOString(),
        event: "release_blocked",
        sha,
        reason: "missing_emergency_reason",
      });
      fail(message);
    }

    log(`Emergency override enabled. Reason: ${reason}`);
  } else if (!inWindow) {
    const nextWindowDate = nowMinutes < startMinutes
      ? now
      : new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWindowDateLabel = formatDateOnly(nextWindowDate, releaseTimezone);

    const message = [
      "Production release blocked by release window.",
      `Current local time: ${localNowDisplay}`,
      `Current ${releaseTimezone} time: ${releaseNowDisplay}`,
      `Allowed daily window: ${windowStart}:00 to ${windowEnd}:00 ${releaseTimezone} (end exclusive).`,
      `Next allowed window: ${nextWindowDateLabel} ${windowStart}:00 to ${windowEnd}:00 ${releaseTimezone}.`,
      "Use --emergency with RELEASE_EMERGENCY_REASON for urgent overrides.",
    ].join("\n");

    await appendReleaseLog({
      ts: new Date().toISOString(),
      event: "release_blocked",
      sha,
      reason: "outside_window",
      release_now: releaseNowDisplay,
      next_window_date: nextWindowDateLabel,
    });

    fail(message);
  }

  log("Running deep QA before production deploy...");
  const qaStart = Date.now();
  const qaResult = await runCommand("npm", ["run", "qa:deep"], env, {
    stream: true,
    allowFailure: true,
  });

  const qaDurationMs = Date.now() - qaStart;
  if (qaResult.code !== 0) {
    await appendReleaseLog({
      ts: new Date().toISOString(),
      event: "qa_result",
      sha,
      status: "fail",
      duration_ms: qaDurationMs,
    });
    fail("Deep QA failed. Production deploy aborted.");
  }

  await appendReleaseLog({
    ts: new Date().toISOString(),
    event: "qa_result",
    sha,
    status: "pass",
    duration_ms: qaDurationMs,
  });
  log(`qa_result ts=${new Date().toISOString()} sha=${sha} status=pass duration_ms=${qaDurationMs}`);

  log("Deep QA passed. Deploying to production via Vercel...");
  const deployResult = await runCommand("vercel", ["deploy", "--prod", "--yes"], env, {
    stream: true,
    allowFailure: true,
  });

  if (deployResult.code !== 0) {
    await appendReleaseLog({
      ts: new Date().toISOString(),
      event: "deploy_result",
      sha,
      status: "fail",
      code: deployResult.code,
    });
    fail("Vercel production deploy failed.");
  }

  const deployUrl = extractDeployUrl(`${deployResult.stdout}\n${deployResult.stderr}`) || "unknown";

  await appendReleaseLog({
    ts: new Date().toISOString(),
    event: "deploy_result",
    sha,
    status: "pass",
    deploy_url: deployUrl,
  });

  log(`deploy_result ts=${new Date().toISOString()} sha=${sha} status=pass deploy_url=${deployUrl}`);
  log(`Production deploy succeeded: ${deployUrl}`);
  log(`Release log updated: ${RELEASE_LOG_PATH}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release:prod] FAILED: ${message}`);
  process.exit(1);
});
