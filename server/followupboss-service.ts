type FollowUpBossProviderConfig = {
  apiKey: string;
  system?: string;
  systemKey?: string;
};

export interface FollowUpBossProfile {
  id?: number | string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface FollowUpBossPerson {
  id: number | string;
  firstName?: string;
  lastName?: string;
  emails: string[];
  tags: string[];
}

const FOLLOW_UP_BOSS_API_BASE = "https://api.followupboss.com/v1";

function buildAuthHeaders(config: FollowUpBossProviderConfig): HeadersInit {
  const token = String(config.apiKey || "").trim();
  const encoded = Buffer.from(`${token}:`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${encoded}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const system = String(config.system || "").trim();
  if (system) {
    headers["X-System"] = system;
  }
  const systemKey = String(config.systemKey || "").trim();
  if (systemKey) {
    headers["X-System-Key"] = systemKey;
  }
  return headers;
}

async function fetchFollowUpBoss<T = any>(
  pathOrUrl: string,
  config: FollowUpBossProviderConfig,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: unknown;
  } = {}
): Promise<T> {
  const base = FOLLOW_UP_BOSS_API_BASE.endsWith("/")
    ? FOLLOW_UP_BOSS_API_BASE
    : `${FOLLOW_UP_BOSS_API_BASE}/`;
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : new URL(pathOrUrl.replace(/^\//, ""), base).toString();

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: buildAuthHeaders(config),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new Error(`Follow Up Boss API ${response.status}: ${detail || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function normalizeEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      const candidate =
        (entry as any).value ||
        (entry as any).email ||
        (entry as any).address ||
        (entry as any).Email ||
        (entry as any).Address;
      return typeof candidate === "string" ? candidate : "";
    })
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes("@"));
  return Array.from(new Set(values));
}

function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      const candidate = (entry as any).name || (entry as any).label || (entry as any).value;
      return typeof candidate === "string" ? candidate : "";
    })
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeId(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return undefined;
}

export async function verifyFollowUpBossApiKey(
  config: FollowUpBossProviderConfig
): Promise<FollowUpBossProfile> {
  const payload = asRecord(await fetchFollowUpBoss<unknown>("me", config));
  return {
    id: normalizeId(payload.id) ?? normalizeId(payload.ID),
    firstName: String(payload.firstName || payload.FirstName || "").trim(),
    lastName: String(payload.lastName || payload.LastName || "").trim(),
    email: String(payload.email || payload.Email || "").trim(),
  };
}

export async function listFollowUpBossPeople(
  config: FollowUpBossProviderConfig,
  maxPeople = 5000,
  options: {
    updatedSince?: string | Date | null;
  } = {}
): Promise<FollowUpBossPerson[]> {
  const people: FollowUpBossPerson[] = [];
  const updatedSinceRaw = options.updatedSince;
  const updatedSince =
    updatedSinceRaw instanceof Date
      ? updatedSinceRaw.toISOString()
      : typeof updatedSinceRaw === "string"
        ? updatedSinceRaw.trim()
        : "";
  const firstPath =
    updatedSince.length > 0
      ? `people?limit=100&updatedSince=${encodeURIComponent(updatedSince)}`
      : "people?limit=100";
  let nextPath: string | null = firstPath;

  while (nextPath && people.length < maxPeople) {
    const payload = asRecord(await fetchFollowUpBoss<unknown>(nextPath, config));
    const rows = Array.isArray(payload.people)
      ? payload.people
      : Array.isArray(payload.People)
        ? payload.People
        : [];

    for (const row of rows) {
      const person = asRecord(row);
      const id = normalizeId(person.id) ?? normalizeId(person.ID);
      if (id === undefined) continue;
      const emails = normalizeEmailList(person.emails || person.Emails);
      const tags = normalizeTagList(person.tags || person.Tags);
      people.push({
        id,
        firstName: String(person.firstName || person.FirstName || "").trim(),
        lastName: String(person.lastName || person.LastName || "").trim(),
        emails,
        tags,
      });
      if (people.length >= maxPeople) break;
    }

    const metadata = asRecord(payload._metadata || payload.metadata);
    const candidateNext = metadata.next || metadata.Next || payload.next || payload.Next;
    nextPath = typeof candidateNext === "string" && candidateNext.trim() ? candidateNext.trim() : null;
  }

  return people;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function resolveExistingPersonId(payload: Record<string, unknown>): string | number | undefined {
  const direct =
    normalizeId(payload.personId) ||
    normalizeId(payload.id) ||
    normalizeId(payload.ID);
  if (direct !== undefined) return direct;

  const candidates: unknown[] = [];
  if (Array.isArray(payload.duplicates)) candidates.push(...payload.duplicates);
  if (Array.isArray(payload.people)) candidates.push(...payload.people);
  if (Array.isArray(payload.matches)) candidates.push(...payload.matches);
  if (payload.person) candidates.push(payload.person);
  if (payload.duplicate) candidates.push(payload.duplicate);
  for (const item of candidates) {
    const record = asRecord(item);
    const id = normalizeId(record.id) || normalizeId(record.ID) || normalizeId(record.personId);
    if (id !== undefined) return id;
  }
  return undefined;
}

export async function upsertFollowUpBossPersonByEmail(
  config: FollowUpBossProviderConfig,
  input: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    tags?: string[];
    isActive?: boolean;
    archived?: boolean;
  }
): Promise<{ personId?: string | number; mode: "created" | "updated" }> {
  const email = String(input.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Valid email is required for Follow Up Boss sync");
  }

  const duplicatePayload = asRecord(
    await fetchFollowUpBoss<unknown>(`people/checkDuplicate?email=${encodeURIComponent(email)}`, config)
  );
  const existingPersonId = resolveExistingPersonId(duplicatePayload);

  const syncTags = uniq([
    ...(Array.isArray(input.tags) ? input.tags : []),
    "flow",
    input.archived ? "flow-archived" : "",
    input.isActive === false ? "flow-unsubscribed" : "",
  ]).map((value) => value.toLowerCase());

  const payload = {
    firstName: input.firstName || "",
    lastName: input.lastName || "",
    emails: [{ value: email }],
    tags: syncTags,
  };

  if (existingPersonId !== undefined) {
    const response = asRecord(
      await fetchFollowUpBoss<unknown>(`people/${encodeURIComponent(String(existingPersonId))}?mergeTags=true`, config, {
        method: "PUT",
        body: payload,
      })
    );
    return {
      personId:
        normalizeId(response.id) ||
        normalizeId(response.ID) ||
        normalizeId(response.personId) ||
        existingPersonId,
      mode: "updated",
    };
  }

  const created = asRecord(
    await fetchFollowUpBoss<unknown>("people", config, {
      method: "POST",
      body: payload,
    })
  );
  return {
    personId: normalizeId(created.id) || normalizeId(created.ID) || normalizeId(created.personId),
    mode: "created",
  };
}
