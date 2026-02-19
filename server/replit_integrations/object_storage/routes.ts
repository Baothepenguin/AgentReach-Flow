import type { Express } from "express";
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
      try {
        uploadURL = await objectStorageService.getObjectEntityUploadURL();
      } catch (e: any) {
        return res.status(503).json({
          error:
            e instanceof Error
              ? e.message
              : "Uploads not configured (object storage unavailable)",
        });
      }

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
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

  // Finalize an upload by applying ACL and returning a stable URL for rendered content.
  app.post("/api/uploads/complete", async (req, res) => {
    try {
      const auth = await getUploadAuthContext(req);
      if (!auth || auth.type !== "user") {
        return res.status(401).json({ error: "Authentication required" });
      }

      const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath.trim() : "";
      const visibility = req.body?.visibility === "public" ? "public" : "private";
      if (!objectPath || !objectPath.startsWith("/objects/")) {
        return res.status(400).json({ error: "Invalid objectPath" });
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
      try {
        uploadURL = await objectStorageService.getObjectEntityUploadURL();
      } catch (e: any) {
        return res.status(503).json({
          error:
            e instanceof Error
              ? e.message
              : "Uploads not configured (object storage unavailable)",
        });
      }

      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
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
