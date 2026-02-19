import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createServer } from "net";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, JsonValue>;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");

interface ApiRequestOptions {
  body?: JsonRecord | Buffer;
  expectedStatus?: number | number[];
  headers?: Record<string, string>;
  includeCookies?: boolean;
  label?: string;
}

interface ApiResponse {
  status: number;
  text: string;
  json: JsonValue;
}

function log(message: string): void {
  console.log(`[qa:deep] ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runCommand(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      env,
      stdio: "inherit",
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${cmd} ${args.join(" ")} (code=${code ?? "null"}, signal=${signal ?? "none"})`));
    });
  });
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();

    probe.once("error", (error) => reject(error));
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Failed to resolve open port")));
        return;
      }

      const port = address.port;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function prefixPipe(stream: NodeJS.ReadableStream | null, prefix: string, target: NodeJS.WriteStream): void {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length === 0) continue;
      target.write(`${prefix}${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.trim().length > 0) {
      target.write(`${prefix}${buffer.trim()}\n`);
    }
  });
}

async function startLocalServer(baseEnv: NodeJS.ProcessEnv): Promise<{ child: ChildProcessWithoutNullStreams; baseUrl: string }> {
  const port = await findFreePort();
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    NODE_ENV: "development",
    PORT: String(port),
    // Keep deep QA deterministic and local; sender verification is covered in dedicated send tests.
    POSTMARK_ACCOUNT_API_TOKEN: "",
    POSTMARK_SERVER_TOKEN: "",
  };

  const child = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  prefixPipe(child.stdout, "[qa:deep:server] ", process.stdout);
  prefixPipe(child.stderr, "[qa:deep:server] ", process.stderr);

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);

  return { child, baseUrl };
}

async function waitForServer(baseUrl: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  const timeoutAt = Date.now() + 90_000;
  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`Local server exited before becoming ready (code=${child.exitCode})`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/auth/me`, {
        method: "GET",
      });
      if (response.status === 200 || response.status === 401) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(1000);
  }

  throw new Error("Timed out waiting for local server to become ready");
}

async function stopLocalServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

class ApiSession {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async request(method: string, path: string, options: ApiRequestOptions = {}): Promise<ApiResponse> {
    const url = `${this.baseUrl}${path}`;
    return this.requestAbsolute(method, url, {
      ...options,
      includeCookies: options.includeCookies ?? true,
    });
  }

  async requestAbsolute(method: string, absoluteUrl: string, options: ApiRequestOptions = {}): Promise<ApiResponse> {
    const expected = Array.isArray(options.expectedStatus)
      ? options.expectedStatus
      : [options.expectedStatus ?? 200];

    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };

    let body: string | Buffer | undefined;
    if (options.body !== undefined) {
      if (Buffer.isBuffer(options.body)) {
        body = options.body;
      } else {
        if (!headers["content-type"]) {
          headers["content-type"] = "application/json";
        }
        body = JSON.stringify(options.body);
      }
    }

    if (options.includeCookies ?? false) {
      const cookieHeader = this.getCookieHeader();
      if (cookieHeader) {
        headers.cookie = cookieHeader;
      }
    }

    const response = await fetch(absoluteUrl, {
      method,
      headers,
      body,
    });

    this.captureCookies(response.headers);

    const text = await response.text();
    let json: JsonValue = null;
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text) as JsonValue;
      } catch {
        json = text;
      }
    }

    if (!expected.includes(response.status)) {
      const label = options.label ? `${options.label}: ` : "";
      throw new Error(
        `${label}${method} ${absoluteUrl} expected status ${expected.join("/")} but got ${response.status}. Response: ${text.slice(0, 1000)}`
      );
    }

    return {
      status: response.status,
      text,
      json,
    };
  }

  private captureCookies(headers: Headers): void {
    const headerAny = headers as any;
    const setCookies: string[] =
      typeof headerAny.getSetCookie === "function"
        ? headerAny.getSetCookie()
        : headers.get("set-cookie")
          ? [String(headers.get("set-cookie"))]
          : [];

    for (const value of setCookies) {
      const firstPart = value.split(";")[0]?.trim();
      if (!firstPart) continue;
      const separator = firstPart.indexOf("=");
      if (separator <= 0) continue;
      const name = firstPart.slice(0, separator).trim();
      const cookieValue = firstPart.slice(separator + 1).trim();
      if (!name) continue;
      this.cookies.set(name, cookieValue);
    }
  }

  private getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function requireObject(json: JsonValue, context: string): JsonRecord {
  assert(!!json && typeof json === "object" && !Array.isArray(json), `${context}: expected JSON object`);
  return json as JsonRecord;
}

function getString(value: JsonValue, context: string): string {
  assert(typeof value === "string" && value.trim().length > 0, `${context}: expected non-empty string`);
  return value;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toAbsoluteUrl(baseUrl: string, maybeRelative: string): string {
  if (/^https?:\/\//i.test(maybeRelative)) {
    return maybeRelative;
  }
  if (maybeRelative.startsWith("/")) {
    return `${baseUrl}${maybeRelative}`;
  }
  return `${baseUrl}/${maybeRelative}`;
}

async function runSmokeSuite(baseUrl: string): Promise<void> {
  const session = new ApiSession(baseUrl);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const userEmail = `qa-${unique}@agentreach.test`;
  const userPassword = "FlowDeepQa123!";

  log("API smoke 1/6: auth register/login/me");
  const registerResp = await session.request("POST", "/api/auth/register", {
    label: "auth register",
    expectedStatus: 200,
    body: {
      email: userEmail,
      password: userPassword,
      name: `QA User ${unique}`,
    },
  });
  const registerJson = requireObject(registerResp.json, "auth register response");
  const registerUser = requireObject(registerJson.user ?? null, "auth register user");
  assert(getString(registerUser.email ?? null, "auth register user email") === userEmail, "auth register email mismatch");

  const meAfterRegister = await session.request("GET", "/api/auth/me", {
    label: "auth me after register",
    expectedStatus: 200,
  });
  const meRegisterJson = requireObject(meAfterRegister.json, "auth me response");
  const meRegisterUser = requireObject(meRegisterJson.user ?? null, "auth me user");
  assert(getString(meRegisterUser.email ?? null, "auth me user email") === userEmail, "auth me email mismatch");

  await session.request("POST", "/api/auth/logout", {
    label: "auth logout",
    expectedStatus: 200,
  });

  await session.request("POST", "/api/auth/login", {
    label: "auth login",
    expectedStatus: 200,
    body: {
      email: userEmail,
      password: userPassword,
    },
  });

  await session.request("GET", "/api/auth/me", {
    label: "auth me after login",
    expectedStatus: 200,
  });

  log("API smoke 2/6: create client");
  const clientResp = await session.request("POST", "/api/clients", {
    label: "create client",
    expectedStatus: 201,
    body: {
      name: `QA Client ${unique}`,
      primaryEmail: `client-${unique}@example.com`,
      phone: "602-555-0199",
      locationCity: "Phoenix",
      locationRegion: "AZ",
      newsletterFrequency: "monthly",
      subscriptionStatus: "canceled",
    },
  });
  const clientJson = requireObject(clientResp.json, "create client response");
  const clientId = getString(clientJson.id ?? null, "create client id");

  log("API smoke 3/6: create subscription + invoice auto-newsletter");
  const subscriptionResp = await session.request("POST", "/api/subscriptions", {
    label: "create subscription",
    expectedStatus: 201,
    body: {
      clientId,
      frequency: "monthly",
      amount: "149.00",
      currency: "USD",
      status: "active",
    },
  });
  const subscriptionJson = requireObject(subscriptionResp.json, "create subscription response");
  const subscriptionId = getString(subscriptionJson.id ?? null, "create subscription id");

  const expectedSendDate = toIsoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const invoiceResp = await session.request("POST", `/api/clients/${clientId}/invoices`, {
    label: "create invoice",
    expectedStatus: 201,
    body: {
      amount: "149.00",
      currency: "USD",
      subscriptionId,
      expectedSendDate,
    },
  });
  const invoiceJson = requireObject(invoiceResp.json, "create invoice response");
  const invoiceObj = requireObject(invoiceJson.invoice ?? null, "invoice payload");
  const newsletterObj = requireObject(invoiceJson.newsletter ?? null, "invoice newsletter payload");
  const invoiceId = getString(invoiceObj.id ?? null, "invoice id");
  const newsletterId = getString(newsletterObj.id ?? null, "invoice newsletter id");
  const linkedInvoiceId = getString(newsletterObj.invoiceId ?? null, "newsletter invoice id");
  const linkedSubscriptionId = getString(newsletterObj.subscriptionId ?? null, "newsletter subscription id");
  assert(linkedInvoiceId === invoiceId, "auto-created newsletter must link to invoice");
  assert(linkedSubscriptionId === subscriptionId, "auto-created newsletter must link to subscription");

  const createDuplicateResp = await session.request("POST", `/api/clients/${clientId}/newsletters`, {
    label: "create second newsletter from invoice linkage",
    expectedStatus: 201,
    body: {
      invoiceId,
      subscriptionId,
      expectedSendDate,
      importedHtml: "<html><body><h1>QA Newsletter</h1><p>Hello world</p></body></html>",
    },
  });
  const createDuplicateJson = requireObject(createDuplicateResp.json, "manual newsletter create response");
  assert(getString(createDuplicateJson.invoiceId ?? null, "manual newsletter invoice id") === invoiceId, "manual newsletter should keep invoice linkage");
  assert(
    getString(createDuplicateJson.subscriptionId ?? null, "manual newsletter subscription id") === subscriptionId,
    "manual newsletter should keep subscription linkage"
  );

  log("API smoke 4/6: audience contact + archive/restore/delete sanity");
  const contactResp = await session.request("POST", `/api/clients/${clientId}/contacts`, {
    label: "create contact",
    expectedStatus: [200, 201],
    body: {
      email: `contact-${unique}@example.com`,
      firstName: "Alex",
      lastName: "Morgan",
      tags: ["all", "past-clients"],
      isActive: true,
    },
  });
  const contactJson = requireObject(contactResp.json, "create contact response");
  const contactId = getString(contactJson.id ?? null, "create contact id");

  await session.request("PATCH", `/api/contacts/${contactId}`, {
    label: "update contact",
    expectedStatus: 200,
    body: {
      firstName: "Taylor",
      tags: ["all", "referral-partners"],
      isActive: true,
    },
  });

  const contactsResp = await session.request("GET", `/api/clients/${clientId}/contacts?view=all`, {
    label: "list contacts",
    expectedStatus: 200,
  });
  assert(Array.isArray(contactsResp.json), "list contacts: expected array response");
  const hasContact = (contactsResp.json as JsonValue[]).some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return (entry as JsonRecord).id === contactId;
  });
  assert(hasContact, "list contacts: created contact not found");

  await session.request("PATCH", `/api/contacts/${contactId}/archive`, {
    label: "archive contact",
    expectedStatus: 200,
    body: {},
  });

  const afterArchiveResp = await session.request("GET", `/api/clients/${clientId}/contacts?view=all`, {
    label: "list contacts after archive",
    expectedStatus: 200,
  });
  const archivedStillInAll = (afterArchiveResp.json as JsonValue[]).some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return (entry as JsonRecord).id === contactId;
  });
  assert(!archivedStillInAll, "archived contact should not appear in all view");

  const deleteBeforeArchiveResp = await session.request("DELETE", `/api/contacts/${contactId}`, {
    label: "delete archived contact should pass",
    expectedStatus: 204,
  });
  assert(deleteBeforeArchiveResp.status === 204, "delete archived contact should return 204");

  const contactResp2 = await session.request("POST", `/api/clients/${clientId}/contacts`, {
    label: "create contact for restore cycle",
    expectedStatus: [200, 201],
    body: {
      email: `contact-restore-${unique}@example.com`,
      firstName: "Restore",
      lastName: "User",
      tags: ["all"],
      isActive: true,
    },
  });
  const contactJson2 = requireObject(contactResp2.json, "create contact2 response");
  const contactId2 = getString(contactJson2.id ?? null, "create contact2 id");
  await session.request("PATCH", `/api/contacts/${contactId2}/archive`, {
    label: "archive contact2",
    expectedStatus: 200,
    body: {},
  });
  await session.request("PATCH", `/api/contacts/${contactId2}/restore`, {
    label: "restore contact2",
    expectedStatus: 200,
    body: {},
  });
  const deleteNonArchivedResp = await session.request("DELETE", `/api/contacts/${contactId2}`, {
    label: "delete non-archived contact should fail",
    expectedStatus: 409,
  });
  const deleteNonArchivedJson = requireObject(deleteNonArchivedResp.json, "delete non-archived response");
  assert(
    getString(deleteNonArchivedJson.error ?? null, "delete non-archived error").toLowerCase().includes("archive"),
    "deleting non-archived contact should require archive first"
  );

  const segmentResp = await session.request("POST", `/api/clients/${clientId}/segments`, {
    label: "create segment",
    expectedStatus: 201,
    body: {
      name: "Past Clients",
      tags: ["past-clients"],
      isDefault: false,
    },
  });
  const segmentJson = requireObject(segmentResp.json, "create segment response");
  const segmentId = getString(segmentJson.id ?? null, "create segment id");

  await session.request("PATCH", `/api/segments/${segmentId}`, {
    label: "update segment",
    expectedStatus: 200,
    body: {
      name: "Referral Partners",
      tags: ["referral-partners"],
    },
  });

  await session.request("GET", `/api/clients/${clientId}/segments`, {
    label: "list segments",
    expectedStatus: 200,
  });

  await session.request("DELETE", `/api/segments/${segmentId}`, {
    label: "delete segment",
    expectedStatus: 204,
  });

  log("API smoke 5/6: status transition guard + send-test no mutation");
  const invalidSentResp = await session.request("PATCH", `/api/newsletters/${newsletterId}`, {
    label: "guard draft->sent",
    expectedStatus: 400,
    body: {
      status: "sent",
    },
  });
  const invalidSentJson = requireObject(invalidSentResp.json, "guard draft->sent response");
  const invalidSentError = getString(invalidSentJson.error ?? null, "guard draft->sent error");
  assert(
    invalidSentError.toLowerCase().includes("automatically") || invalidSentError.toLowerCase().includes("status 'sent'"),
    `guard draft->sent did not return expected message: ${invalidSentError}`
  );

  const invalidScheduledResp = await session.request("PATCH", `/api/newsletters/${newsletterId}`, {
    label: "guard draft->scheduled",
    expectedStatus: 400,
    body: {
      status: "scheduled",
    },
  });
  const invalidScheduledJson = requireObject(invalidScheduledResp.json, "guard draft->scheduled response");
  const invalidScheduledError = getString(invalidScheduledJson.error ?? null, "guard draft->scheduled error");
  assert(
    invalidScheduledError.toLowerCase().includes("schedule") && invalidScheduledError.toLowerCase().includes("use"),
    `guard draft->scheduled did not return expected message: ${invalidScheduledError}`
  );

  await session.request("PATCH", `/api/newsletters/${newsletterId}`, {
    label: "set newsletter in_review",
    expectedStatus: 200,
    body: {
      status: "in_review",
    },
  });

  await session.request("PATCH", `/api/newsletters/${newsletterId}`, {
    label: "set newsletter approved",
    expectedStatus: 200,
    body: {
      status: "approved",
    },
  });

  const testSendResp = await session.request("POST", `/api/newsletters/${newsletterId}/send-test`, {
    label: "send test email",
    expectedStatus: [200, 400],
    body: {
      toEmail: "bao@sansu.ca",
    },
  });
  if (testSendResp.status === 400) {
    const testSendErr = requireObject(testSendResp.json, "send-test 400 response");
    const message = getString(testSendErr.error ?? null, "send-test error");
    assert(
      message.toLowerCase().includes("postmark") || message.toLowerCase().includes("blocker"),
      `unexpected send-test error: ${message}`
    );
  }
  const postTestNewsletterResp = await session.request("GET", `/api/newsletters/${newsletterId}`, {
    label: "newsletter status after send-test",
    expectedStatus: 200,
  });
  const postTestNewsletterJson = requireObject(postTestNewsletterResp.json, "newsletter status after test response");
  const postTestNewsletter = requireObject(postTestNewsletterJson.newsletter ?? null, "newsletter after test");
  assert(getString(postTestNewsletter.status ?? null, "newsletter status after test") === "approved", "send-test must not change newsletter status");

  log("API smoke 6/6: upload request-url -> upload -> complete (fallback-aware)");
  const uploadFile = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2B9kAAAAASUVORK5CYII=",
    "base64"
  );
  const uploadRequestResp = await session.request("POST", "/api/uploads/request-url", {
    label: "upload request-url",
    expectedStatus: 200,
    body: {
      name: `deep-qa-${unique}.png`,
      size: uploadFile.byteLength,
      contentType: "image/png",
    },
  });
  const uploadRequestJson = requireObject(uploadRequestResp.json, "upload request-url response");
  const uploadURL = getString(uploadRequestJson.uploadURL ?? null, "uploadURL");
  const objectPath = getString(uploadRequestJson.objectPath ?? null, "objectPath");
  const uploadToken =
    typeof uploadRequestJson.uploadToken === "string" && uploadRequestJson.uploadToken.trim().length > 0
      ? uploadRequestJson.uploadToken.trim()
      : null;

  const absoluteUploadURL = toAbsoluteUrl(baseUrl, uploadURL);
  const uploadIsLocal = absoluteUploadURL.startsWith(baseUrl);
  await session.requestAbsolute("PUT", absoluteUploadURL, {
    label: "upload file body",
    expectedStatus: [200, 201, 204],
    includeCookies: uploadIsLocal,
    headers: {
      "content-type": "image/png",
      "content-length": String(uploadFile.byteLength),
    },
    body: uploadFile,
  });

  const completeBody: JsonRecord = {
    objectPath,
    visibility: "public",
  };
  if (uploadToken) {
    completeBody.uploadToken = uploadToken;
  }

  const uploadCompleteResp = await session.request("POST", "/api/uploads/complete", {
    label: "upload complete",
    expectedStatus: 200,
    body: completeBody,
  });
  const uploadCompleteJson = requireObject(uploadCompleteResp.json, "upload complete response");
  const objectUrl = getString(uploadCompleteJson.objectUrl ?? null, "upload complete objectUrl");

  if (objectPath.startsWith("/supabase-objects/")) {
    assert(uploadURL.includes("/api/uploads/direct"), "fallback upload should use /api/uploads/direct endpoint");
    assert(Boolean(uploadToken), "fallback upload should return uploadToken");
    assert(objectUrl.includes("/storage/v1/object/public/"), "fallback upload should resolve to Supabase public URL");
  } else if (objectPath.startsWith("/objects/")) {
    assert(!uploadURL.includes("/api/uploads/direct") || Boolean(uploadToken), "primary upload should not require fallback token path");
    assert(objectUrl.includes("/api/objects/") || objectUrl.includes("/objects/"), "primary upload should resolve to object endpoint");
  } else {
    throw new Error(`Unexpected objectPath prefix: ${objectPath}`);
  }

  log("API smoke suite passed");
}

async function main(): Promise<void> {
  const startAt = Date.now();
  const args = new Set(process.argv.slice(2));
  const ciMode = args.has("--ci");

  const baseEnv = await loadProjectEnv();

  log("Running TypeScript check");
  await runCommand("npm", ["run", "check"], baseEnv);

  log("Running production build");
  await runCommand("npm", ["run", "build"], baseEnv);

  log("Starting local API server for smoke tests");
  const { child, baseUrl } = await startLocalServer(baseEnv);

  try {
    await runSmokeSuite(baseUrl);
  } finally {
    await stopLocalServer(child);
  }

  const elapsedSec = ((Date.now() - startAt) / 1000).toFixed(1);
  log(`Deep QA complete in ${elapsedSec}s${ciMode ? " (ci)" : ""}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[qa:deep] FAILED: ${message}`);
  process.exit(1);
});
