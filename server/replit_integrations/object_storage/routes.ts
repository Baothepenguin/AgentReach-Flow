import type { Express } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import { storage } from "../../storage";

type UploadAuthContext =
  | { type: "user"; userId: string }
  | { type: "review"; reviewToken: string; newsletterId: string };

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const PUBLIC_ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

type UploadTokenPayload = {
  objectPath: string;
  contentType: string;
  expiresAt: number;
  auth:
    | { type: "user"; id: string }
    | { type: "review"; id: string; newsletterId: string };
};

type SupabaseStorageConfig = {
  url: string;
  serviceKey: string;
  bucket: string;
};

const SUPABASE_FALLBACK_PREFIX = "/supabase-objects/";
const supabaseBucketReady = new Set<string>();

function getUploadTokenSecret(): string {
  return process.env.UPLOAD_TOKEN_SECRET || process.env.SESSION_SECRET || "dev-upload-secret";
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

function signUploadTokenPayload(payloadPart: string): string {
  return createHmac("sha256", getUploadTokenSecret())
    .update(payloadPart)
    .digest("base64url");
}

function encodeUploadToken(payload: UploadTokenPayload): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signaturePart = signUploadTokenPayload(payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

function decodeUploadToken(token: string): UploadTokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  const expectedSignature = signUploadTokenPayload(payloadPart);
  if (!timingSafeEqualString(signaturePart, expectedSignature)) return null;
  try {
    const rawPayload = Buffer.from(payloadPart, "base64url").toString("utf8");
    const parsed = JSON.parse(rawPayload) as UploadTokenPayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.objectPath !== "string" || !parsed.objectPath) return null;
    if (typeof parsed.contentType !== "string" || !parsed.contentType) return null;
    if (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt)) return null;
    if (!parsed.auth || typeof parsed.auth !== "object") return null;
    if (parsed.auth.type === "user" && typeof parsed.auth.id === "string") return parsed;
    if (
      parsed.auth.type === "review" &&
      typeof parsed.auth.id === "string" &&
      typeof parsed.auth.newsletterId === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function getSupabaseStorageConfig(): SupabaseStorageConfig | null {
  const rawUrl = (process.env.SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || "flow-assets").trim();

  if (!rawUrl || !serviceKey || !bucket) return null;
  return {
    url: rawUrl.replace(/\/+$/, ""),
    serviceKey,
    bucket,
  };
}

function encodeObjectName(objectName: string): string {
  return objectName
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseSupabaseObjectPath(path: string): { bucket: string; objectName: string } | null {
  if (!path.startsWith(SUPABASE_FALLBACK_PREFIX)) return null;
  const parts = path.split("/").filter(Boolean);
  // /supabase-objects/:bucket/:objectPath(*)
  if (parts.length < 3 || parts[0] !== "supabase-objects") return null;
  const bucket = parts[1];
  const objectName = parts.slice(2).join("/");
  if (!bucket || !objectName) return null;
  return { bucket, objectName };
}

function buildSupabasePublicUrl(baseUrl: string, bucket: string, objectName: string): string {
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectName(objectName)}`;
}

function guessFileExtension(name: string, contentType: string): string {
  const directMatch = name.toLowerCase().match(/(\.[a-z0-9]{1,10})$/);
  if (directMatch) return directMatch[1];

  switch (contentType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "application/pdf":
      return ".pdf";
    case "application/msword":
      return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    default:
      return "";
  }
}

function buildSupabaseObjectPath(bucket: string, name: string, contentType: string): string {
  const extension = guessFileExtension(name, contentType);
  return `${SUPABASE_FALLBACK_PREFIX}${bucket}/uploads/${randomUUID()}${extension}`;
}

async function ensureSupabaseBucket(config: SupabaseStorageConfig): Promise<void> {
  const cacheKey = `${config.url}|${config.bucket}`;
  if (supabaseBucketReady.has(cacheKey)) return;

  const headers = {
    Authorization: `Bearer ${config.serviceKey}`,
    apikey: config.serviceKey,
    "Content-Type": "application/json",
  };

  const bucketUrl = `${config.url}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`;
  const getBucketRes = await fetch(bucketUrl, { headers });

  if (getBucketRes.status === 404) {
    const createRes = await fetch(`${config.url}/storage/v1/bucket`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: config.bucket,
        name: config.bucket,
        public: true,
        file_size_limit: `${MAX_UPLOAD_BYTES}`,
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => "");
      throw new Error(`Supabase bucket create failed (${createRes.status}): ${body.slice(0, 240)}`);
    }
    supabaseBucketReady.add(cacheKey);
    return;
  }

  if (!getBucketRes.ok) {
    const body = await getBucketRes.text().catch(() => "");
    throw new Error(`Supabase bucket check failed (${getBucketRes.status}): ${body.slice(0, 240)}`);
  }

  const bucketData = await getBucketRes.json().catch(() => null as any);
  if (!bucketData?.public) {
    const updateRes = await fetch(bucketUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        id: config.bucket,
        name: config.bucket,
        public: true,
        file_size_limit: `${MAX_UPLOAD_BYTES}`,
      }),
    });
    if (!updateRes.ok) {
      const body = await updateRes.text().catch(() => "");
      throw new Error(`Supabase bucket update failed (${updateRes.status}): ${body.slice(0, 240)}`);
    }
  }

  supabaseBucketReady.add(cacheKey);
}

async function uploadToSupabase(
  config: SupabaseStorageConfig,
  bucket: string,
  objectName: string,
  contentType: string,
  body: Buffer
): Promise<void> {
  const uploadUrl = `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectName(objectName)}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceKey}`,
      apikey: config.serviceKey,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body,
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Supabase upload failed (${res.status}): ${bodyText.slice(0, 240)}`);
  }
}

async function readRequestBodyBuffer(req: any, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer | string) => {
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += chunkBuffer.length;
      if (total > maxBytes) {
        reject(new Error(`File too large (max ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunkBuffer);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (error: Error) => {
      reject(error);
    });
  });
}

function getClientIp(req: any): string {
  const header = req.headers?.["x-forwarded-for"];
  if (typeof header === "string" && header.trim()) {
    return header.split(",")[0]?.trim() || "unknown";
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function checkRateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= max) return false;
  existing.count += 1;
  return true;
}

function isAllowedPublicContentType(type: string): boolean {
  if (!type) return false;
  if (type.startsWith("image/")) return true;
  return PUBLIC_ALLOWED_TYPES.has(type);
}

function validateUploadMetadata(input: any, auth: UploadAuthContext): { name: string; size: number; contentType: string } {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const size = typeof input?.size === "number" ? input.size : Number(input?.size);
  const contentType = typeof input?.contentType === "string" ? input.contentType.trim() : "";

  if (!name) {
    throw new Error("Missing required field: name");
  }
  if (name.length > 200) {
    throw new Error("Filename is too long");
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("Invalid file size");
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`);
  }
  if (!contentType) {
    throw new Error("Missing required field: contentType");
  }

  if (auth.type === "review" && !isAllowedPublicContentType(contentType)) {
    throw new Error("Unsupported file type for public upload");
  }

  return { name, size, contentType };
}

async function getUploadAuthContext(req: any): Promise<UploadAuthContext | null> {
  const userId = req.session?.userId;
  if (typeof userId === "string" && userId) {
    return { type: "user", userId };
  }
  const reviewToken = typeof req.params?.token === "string" ? req.params.token : "";
  if (!reviewToken) return null;
  const tokenRow = await storage.getValidReviewToken(reviewToken);
  if (!tokenRow) return null;
  return { type: "review", reviewToken, newsletterId: tokenRow.newsletterId };
}

async function canDownloadObject(req: any, objectPath: string): Promise<boolean> {
  const userId = req.session?.userId;
  if (typeof userId === "string" && userId) return true;

  // Public objects are readable without session/review-token auth.
  try {
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const isPublic = await objectStorageService.canAccessObjectEntity({
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (isPublic) return true;
  } catch {
    // Ignore lookup failures here; downstream download handler returns canonical errors.
  }

  const reviewToken =
    typeof req.query?.reviewToken === "string" ? req.query.reviewToken : "";
  if (!reviewToken) return false;

  const tokenRow = await storage.getValidReviewToken(reviewToken);
  if (!tokenRow) return false;

  // Only allow downloads of attachments actually referenced by this newsletter's review comments.
  const comments = await storage.getReviewCommentsByNewsletter(tokenRow.newsletterId);
  return comments.some((c: any) => Array.isArray(c.attachments) && c.attachments.includes(objectPath));
}

async function handleObjectDownload(objectStorageService: ObjectStorageService, req: any, res: any, objectPath: string) {
  if (!(await canDownloadObject(req, objectPath))) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
  await objectStorageService.downloadObject(objectFile, res);
}

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const auth = await getUploadAuthContext(req);
      if (!auth || auth.type !== "user") {
        return res.status(401).json({ error: "Authentication required" });
      }

      const ip = getClientIp(req);
      if (!checkRateLimit(`upload-url:user:${auth.userId}:${ip}`, 60_000, 60)) {
        return res.status(429).json({ error: "Too many upload requests" });
      }

      const { name, size, contentType } = validateUploadMetadata(req.body, auth);

      let uploadURL: string;
      let objectPath: string;
      let uploadToken: string | undefined;
      try {
        uploadURL = await objectStorageService.getObjectEntityUploadURL();
        objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      } catch (e: any) {
        // Fallback: Supabase Storage direct upload route.
        const supabaseConfig = getSupabaseStorageConfig();
        if (!supabaseConfig) {
          return res.status(503).json({
            error:
              e instanceof Error
                ? e.message
                : "Uploads not configured (object storage unavailable)",
          });
        }

        objectPath = buildSupabaseObjectPath(supabaseConfig.bucket, name, contentType);
        uploadToken = encodeUploadToken({
          objectPath,
          contentType,
          expiresAt: Date.now() + 15 * 60_000,
          auth: { type: "user", id: auth.userId },
        });
        uploadURL = `/api/uploads/direct?token=${encodeURIComponent(uploadToken)}`;
      }

      res.json({
        uploadURL,
        objectPath,
        ...(uploadToken ? { uploadToken } : {}),
        // Echo back the metadata for client convenience
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to generate upload URL",
      });
    }
  });

  // Direct upload endpoint used by Supabase fallback mode (token-authenticated).
  app.put("/api/uploads/direct", async (req, res) => {
    try {
      const tokenRaw = req.query?.token;
      const uploadToken =
        typeof tokenRaw === "string"
          ? tokenRaw
          : Array.isArray(tokenRaw) && typeof tokenRaw[0] === "string"
            ? tokenRaw[0]
            : "";
      if (!uploadToken) {
        return res.status(400).json({ error: "Missing upload token" });
      }

      const tokenPayload = decodeUploadToken(uploadToken);
      if (!tokenPayload) {
        return res.status(401).json({ error: "Invalid upload token" });
      }
      if (tokenPayload.expiresAt <= Date.now()) {
        return res.status(401).json({ error: "Upload token expired" });
      }

      if (tokenPayload.auth.type === "user") {
        const userId = (req.session as { userId?: string } | undefined)?.userId;
        if (typeof userId !== "string" || userId !== tokenPayload.auth.id) {
          return res.status(401).json({ error: "Authentication required" });
        }
      } else {
        const tokenRow = await storage.getValidReviewToken(tokenPayload.auth.id);
        if (!tokenRow || tokenRow.newsletterId !== tokenPayload.auth.newsletterId) {
          return res.status(401).json({ error: "Invalid or expired review token" });
        }
      }

      const supabaseConfig = getSupabaseStorageConfig();
      if (!supabaseConfig) {
        return res.status(503).json({ error: "Supabase storage is not configured" });
      }

      const parsedPath = parseSupabaseObjectPath(tokenPayload.objectPath);
      if (!parsedPath) {
        return res.status(400).json({ error: "Invalid objectPath in upload token" });
      }
      if (parsedPath.bucket !== supabaseConfig.bucket) {
        return res.status(400).json({ error: "Upload bucket mismatch" });
      }

      const contentLengthHeader = req.headers?.["content-length"];
      const contentLength = Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: `File too large (max ${MAX_UPLOAD_BYTES} bytes)` });
      }

      const bodyBuffer = await readRequestBodyBuffer(req, MAX_UPLOAD_BYTES);
      if (!bodyBuffer.length) {
        return res.status(400).json({ error: "Empty upload payload" });
      }

      await ensureSupabaseBucket(supabaseConfig);
      await uploadToSupabase(
        supabaseConfig,
        parsedPath.bucket,
        parsedPath.objectName,
        tokenPayload.contentType,
        bodyBuffer
      );

      return res.status(204).send();
    } catch (error) {
      console.error("Error uploading via direct endpoint:", error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to upload file",
      });
    }
  });

  // Finalize an upload by applying ACL and returning a stable URL for rendered content.
  app.post("/api/uploads/complete", async (req, res) => {
    try {
      const auth = await getUploadAuthContext(req);
      if (!auth || auth.type !== "user") {
        return res.status(401).json({ error: "Authentication required" });
      }

      const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
      const uploadToken =
        typeof req.body?.uploadToken === "string" ? req.body.uploadToken.trim() : "";
      const visibility = req.body?.visibility === "public" ? "public" : "private";
      if (
        !objectPath ||
        (!objectPath.startsWith("/objects/") && !objectPath.startsWith(SUPABASE_FALLBACK_PREFIX))
      ) {
        return res.status(400).json({ error: "Invalid objectPath" });
      }

      if (objectPath.startsWith(SUPABASE_FALLBACK_PREFIX)) {
        const parsedPath = parseSupabaseObjectPath(objectPath);
        if (!parsedPath) {
          return res.status(400).json({ error: "Invalid objectPath" });
        }

        let contentType = "";
        if (uploadToken) {
          const tokenPayload = decodeUploadToken(uploadToken);
          if (!tokenPayload) {
            return res.status(401).json({ error: "Invalid upload token" });
          }
          if (tokenPayload.expiresAt <= Date.now()) {
            return res.status(401).json({ error: "Upload token expired" });
          }
          if (tokenPayload.auth.type !== "user" || tokenPayload.auth.id !== auth.userId) {
            return res.status(401).json({ error: "Invalid upload token owner" });
          }
          if (tokenPayload.objectPath !== objectPath) {
            return res.status(400).json({ error: "Upload token/objectPath mismatch" });
          }
          contentType = tokenPayload.contentType;
        }

        if (visibility === "public" && contentType && !isAllowedPublicContentType(contentType)) {
          return res.status(400).json({ error: "Only images and allowed document types can be public" });
        }
        if (visibility !== "public") {
          return res.status(400).json({
            error: "Supabase fallback currently supports public visibility only",
          });
        }

        const supabaseConfig = getSupabaseStorageConfig();
        if (!supabaseConfig) {
          return res.status(503).json({ error: "Supabase storage is not configured" });
        }

        const objectUrl = buildSupabasePublicUrl(
          supabaseConfig.url,
          parsedPath.bucket,
          parsedPath.objectName
        );

        return res.json({
          objectPath,
          objectUrl,
          visibility,
          contentType,
        });
      }

      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const [metadata] = await objectFile.getMetadata();
      const contentType = typeof metadata?.contentType === "string" ? metadata.contentType : "";

      if (visibility === "public" && !isAllowedPublicContentType(contentType)) {
        return res.status(400).json({ error: "Only images and allowed document types can be public" });
      }

      const normalizedObjectPath = await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: auth.userId,
        visibility,
      });

      const forwardedProto = typeof req.headers?.["x-forwarded-proto"] === "string"
        ? req.headers["x-forwarded-proto"].split(",")[0]?.trim()
        : "";
      const protocol = forwardedProto || req.protocol || "https";
      const host = req.get("host");
      const objectSuffix = normalizedObjectPath.startsWith("/objects/")
        ? normalizedObjectPath.slice("/objects/".length)
        : normalizedObjectPath;
      const objectUrl = `${protocol}://${host}/api/objects/${objectSuffix}`;

      return res.json({
        objectPath: normalizedObjectPath,
        objectUrl,
        visibility,
        contentType,
      });
    } catch (error) {
      console.error("Error finalizing upload:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to finalize upload",
      });
    }
  });

  // Public review upload URL issuance. Requires a valid review token.
  app.post("/api/review/:token/uploads/request-url", async (req, res) => {
    try {
      const auth = await getUploadAuthContext(req);
      if (!auth || auth.type !== "review") {
        return res.status(404).json({ error: "Invalid or expired token" });
      }

      const ip = getClientIp(req);
      if (!checkRateLimit(`upload-url:review:${auth.reviewToken}:${ip}`, 60_000, 20)) {
        return res.status(429).json({ error: "Too many upload requests" });
      }

      const { name, size, contentType } = validateUploadMetadata(req.body, auth);

      let uploadURL: string;
      let objectPath: string;
      let uploadToken: string | undefined;
      let objectUrl: string | undefined;
      try {
        uploadURL = await objectStorageService.getObjectEntityUploadURL();
        objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      } catch (e: any) {
        const supabaseConfig = getSupabaseStorageConfig();
        if (!supabaseConfig) {
          return res.status(503).json({
            error:
              e instanceof Error
                ? e.message
                : "Uploads not configured (object storage unavailable)",
          });
        }

        objectPath = buildSupabaseObjectPath(supabaseConfig.bucket, name, contentType);
        uploadToken = encodeUploadToken({
          objectPath,
          contentType,
          expiresAt: Date.now() + 15 * 60_000,
          auth: { type: "review", id: auth.reviewToken, newsletterId: auth.newsletterId },
        });
        uploadURL = `/api/uploads/direct?token=${encodeURIComponent(uploadToken)}`;

        const parsedPath = parseSupabaseObjectPath(objectPath);
        if (parsedPath) {
          objectUrl = buildSupabasePublicUrl(
            supabaseConfig.url,
            parsedPath.bucket,
            parsedPath.objectName
          );
        }
      }

      res.json({
        uploadURL,
        objectPath,
        ...(uploadToken ? { uploadToken } : {}),
        ...(objectUrl ? { objectUrl } : {}),
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating review upload URL:", error);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to generate upload URL",
      });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   *
   * This serves files from object storage. For public files, no auth needed.
   * For protected files, add authentication middleware and ACL checks.
   */
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      await handleObjectDownload(objectStorageService, req, res, req.path);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  // Serverless-friendly alias (Vercel routes /api/* to the function).
  app.get("/api/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectPath = `/objects/${req.params.objectPath}`;
      await handleObjectDownload(objectStorageService, req, res, objectPath);
    } catch (error) {
      console.error("Error serving api object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}
