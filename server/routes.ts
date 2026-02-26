import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { compileNewsletterToHtml } from "./email-compiler";
import { processHtmlCommand } from "./ai-service";
import { generateEmailFromPrompt, editEmailWithAI, suggestSubjectLines } from "./gemini-email-service";
import { renderMjml, validateMjml } from "./mjml-service";
import {
  ensureClientPostmarkTenant,
  getSenderSignature,
  isLikelyPublicMailboxDomain,
  resendConfirmation,
} from "./postmark-service";
import {
  listFollowUpBossPeople,
  upsertFollowUpBossPersonByEmail,
  verifyFollowUpBossApiKey,
} from "./followupboss-service";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { pool as dbPool } from "./db";
import {
  DEFAULT_NEWSLETTER_DOCUMENT,
  createNewsletterDocumentFromHtml,
  getNewsletterDocumentHtml,
  insertClientSchema,
  type BlockEditOperation,
  type BlockEditSuggestion,
  type NewsletterBlock,
  type NewsletterBlockType,
  type BrandingKit,
  type Client,
  type NewsletterDocument,
  type LegacyNewsletterDocument,
  type NewsletterStatus,
  type User,
} from "@shared/schema";
import { createHash, randomUUID } from "crypto";
import session from "express-session";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import { addDays, addWeeks, addMonths, format } from "date-fns";
import pLimit from "p-limit";

function getNextSendDates(frequency: string, lastSendDate: Date | null, count: number = 1): Date[] {
  const dates: Date[] = [];
  let baseDate = lastSendDate || new Date();
  
  for (let i = 0; i < count; i++) {
    let nextDate: Date;
    switch (frequency) {
      case "weekly":
        nextDate = addWeeks(baseDate, 1);
        break;
      case "biweekly":
        nextDate = addWeeks(baseDate, 2);
        break;
      case "monthly":
      default:
        nextDate = addMonths(baseDate, 1);
        break;
    }
    dates.push(nextDate);
    baseDate = nextDate;
  }
  
  return dates;
}

function getNewsletterCountByFrequency(frequency: string): number {
  switch (frequency) {
    case "weekly":
      return 4;
    case "biweekly":
      return 2;
    case "monthly":
    default:
      return 1;
  }
}

function cloneDefaultNewsletterDocument(): NewsletterDocument {
  return {
    ...DEFAULT_NEWSLETTER_DOCUMENT,
    blocks: [...(DEFAULT_NEWSLETTER_DOCUMENT.blocks || [])],
    meta: { ...(DEFAULT_NEWSLETTER_DOCUMENT.meta || {}) },
  };
}

function cloneNewsletterDocument(document: NewsletterDocument): NewsletterDocument {
  return JSON.parse(JSON.stringify(document)) as NewsletterDocument;
}

function normalizeNewsletterDocument(
  document: NewsletterDocument | LegacyNewsletterDocument | null | undefined
): NewsletterDocument {
  if (!document) {
    return cloneDefaultNewsletterDocument();
  }

  const modernDoc = document as NewsletterDocument;
  const normalized = cloneDefaultNewsletterDocument();
  const html = getNewsletterDocumentHtml(document);

  return {
    ...normalized,
    ...modernDoc,
    blocks: Array.isArray(modernDoc.blocks) ? modernDoc.blocks : normalized.blocks,
    meta: {
      ...normalized.meta,
      ...(modernDoc.meta || {}),
    },
    html: typeof modernDoc.html === "string" ? modernDoc.html : html,
  };
}

const ALLOWED_BLOCK_TYPES: NewsletterBlockType[] = [
  "text",
  "image",
  "button",
  "divider",
  "socials",
  "grid",
  "image_button",
];

const PROFESSIONAL_SENDER_EMAIL_ERROR =
  "Use a professional sender email on your own domain (not gmail/outlook/hotmail/live).";

const DEFAULT_INTERNAL_OPERATOR_DOMAINS = "sansu.ca";
const AUTH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 15;
const authRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function getInternalOperatorDomains(): string[] {
  const raw = String(process.env.INTERNAL_OPERATOR_EMAIL_DOMAINS || DEFAULT_INTERNAL_OPERATOR_DOMAINS);
  return raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function isInternalOperatorEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex < 0) return false;
  const domain = normalized.slice(atIndex + 1);
  return getInternalOperatorDomains().includes(domain);
}

function canSelfServeCreateInternalOperator(email: string): boolean {
  if (process.env.ALLOW_INTERNAL_SELF_SIGNUP === "1") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return isInternalOperatorEmail(email);
}

function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || "").trim() || "unknown";
  }
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function consumeAuthRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = authRateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    authRateLimitBuckets.set(key, { count: 1, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSec: Math.ceil(AUTH_RATE_LIMIT_WINDOW_MS / 1000) };
  }

  existing.count += 1;
  authRateLimitBuckets.set(key, existing);
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    allowed: existing.count <= AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    retryAfterSec,
  };
}

function clearAuthRateLimit(key: string): void {
  authRateLimitBuckets.delete(key);
}

function sanitizeBlockEditOperations(
  operationsRaw: unknown,
  existingBlocks: NewsletterBlock[]
): BlockEditOperation[] {
  if (!Array.isArray(operationsRaw)) return [];
  const allowedBlockTypeSet = new Set<string>(ALLOWED_BLOCK_TYPES);
  const existingIds = new Set(existingBlocks.map((b) => b.id));

  const sanitized: BlockEditOperation[] = [];
  for (const operation of operationsRaw.slice(0, 12)) {
    if (!operation || typeof operation !== "object") continue;
    const op = typeof (operation as any).op === "string" ? (operation as any).op.trim() : "";
    const reason = typeof (operation as any).reason === "string" ? (operation as any).reason.trim() : undefined;

    if (op === "update_block_data") {
      const blockId = typeof (operation as any).blockId === "string" ? (operation as any).blockId.trim() : "";
      const patch = (operation as any).patch;
      if (!existingIds.has(blockId)) continue;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
      sanitized.push({ op: "update_block_data", blockId, patch, reason });
      continue;
    }

    if (op === "insert_block_after") {
      const afterBlockId =
        typeof (operation as any).afterBlockId === "string" ? (operation as any).afterBlockId.trim() : "";
      const blockType =
        typeof (operation as any).blockType === "string" ? (operation as any).blockType.trim() : "";
      const data = (operation as any).data;
      if (!existingIds.has(afterBlockId)) continue;
      if (!allowedBlockTypeSet.has(blockType)) continue;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      sanitized.push({
        op: "insert_block_after",
        afterBlockId,
        blockType: blockType as NewsletterBlockType,
        data,
        reason,
      });
      continue;
    }

    if (op === "remove_block") {
      const blockId = typeof (operation as any).blockId === "string" ? (operation as any).blockId.trim() : "";
      if (!existingIds.has(blockId)) continue;
      sanitized.push({ op: "remove_block", blockId, reason });
      continue;
    }

    if (op === "move_block") {
      const blockId = typeof (operation as any).blockId === "string" ? (operation as any).blockId.trim() : "";
      const direction =
        typeof (operation as any).direction === "string" ? (operation as any).direction.trim().toLowerCase() : "";
      if (!existingIds.has(blockId)) continue;
      if (direction !== "up" && direction !== "down") continue;
      sanitized.push({ op: "move_block", blockId, direction: direction as "up" | "down", reason });
    }
  }

  return sanitized;
}

function applyBlockEditOperations(
  document: NewsletterDocument,
  operations: BlockEditOperation[]
): { document: NewsletterDocument; appliedCount: number } {
  let blocks = [...(Array.isArray(document.blocks) ? document.blocks : [])];
  let appliedCount = 0;

  for (const operation of operations) {
    if (operation.op === "update_block_data") {
      const index = blocks.findIndex((b) => b.id === operation.blockId);
      if (index < 0) continue;
      const current = blocks[index];
      const next = [...blocks];
      next[index] = {
        ...current,
        data: {
          ...(current.data || {}),
          ...(operation.patch || {}),
        },
      };
      blocks = next;
      appliedCount += 1;
      continue;
    }

    if (operation.op === "insert_block_after") {
      const index = blocks.findIndex((b) => b.id === operation.afterBlockId);
      if (index < 0) continue;
      const next = [...blocks];
      next.splice(index + 1, 0, {
        id: randomUUID(),
        type: operation.blockType,
        data: operation.data || {},
      });
      blocks = next;
      appliedCount += 1;
      continue;
    }

    if (operation.op === "remove_block") {
      const index = blocks.findIndex((b) => b.id === operation.blockId);
      if (index < 0) continue;
      const next = [...blocks];
      next.splice(index, 1);
      blocks = next;
      appliedCount += 1;
      continue;
    }

    if (operation.op === "move_block") {
      const sourceIndex = blocks.findIndex((b) => b.id === operation.blockId);
      if (sourceIndex < 0) continue;
      const targetIndex = operation.direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
      if (targetIndex < 0 || targetIndex >= blocks.length) continue;
      const next = [...blocks];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      blocks = next;
      appliedCount += 1;
    }
  }

  return {
    document: {
      ...document,
      version: "v1",
      blocks,
    },
    appliedCount,
  };
}

function mergeNewsletterDocument(
  existingDocument: NewsletterDocument,
  patchDocument: Partial<NewsletterDocument>
): NewsletterDocument {
  return {
    ...existingDocument,
    ...patchDocument,
    blocks: Array.isArray(patchDocument.blocks) ? patchDocument.blocks : existingDocument.blocks,
    meta: {
      ...(existingDocument.meta || {}),
      ...(patchDocument.meta || {}),
    },
  };
}

function normalizeNewsletterStatus(status: unknown): NewsletterStatus | undefined {
  if (typeof status !== "string") return undefined;

  const normalized = status.trim();
  const map: Record<string, NewsletterStatus> = {
    draft: "draft",
    in_review: "in_review",
    changes_requested: "changes_requested",
    approved: "approved",
    scheduled: "scheduled",
    sent: "sent",
    not_started: "draft",
    in_progress: "draft",
    internal_review: "in_review",
    client_review: "in_review",
    revisions: "changes_requested",
  };

  return map[normalized];
}

function normalizeSendMode(mode: unknown): "fixed_time" | "immediate_after_approval" | "ai_recommended" | undefined {
  if (typeof mode !== "string") return undefined;
  if (mode === "fixed_time" || mode === "immediate_after_approval" || mode === "ai_recommended") {
    return mode;
  }
  return undefined;
}

function normalizeReviewCommentType(value: unknown): "change" | "addition" | "removal" {
  const raw = typeof value === "string" ? value.trim() : "";
  const allowed = new Set(["change", "addition", "removal"]);
  return allowed.has(raw) ? (raw as any) : "change";
}

function buildNewsletterTitle(clientName: string): string {
  const normalizedName = clientName.trim() || "Client";
  return `${normalizedName} Newsletter`;
}

function normalizeContactView(value: unknown): "all" | "active" | "unsubscribed" | "archived" {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "active" || raw === "unsubscribed" || raw === "archived") {
    return raw;
  }
  return "all";
}

type ContactImportSource =
  | "internal_app"
  | "onboarding_portal"
  | "mailchimp_csv"
  | "brevo_csv"
  | "kit_csv"
  | "flodesk_csv"
  | "follow_up_boss";

const CONTACT_IMPORT_SOURCE_SET = new Set<ContactImportSource>([
  "internal_app",
  "onboarding_portal",
  "mailchimp_csv",
  "brevo_csv",
  "kit_csv",
  "flodesk_csv",
  "follow_up_boss",
]);

function normalizeContactImportSource(value: unknown, fallback: ContactImportSource = "internal_app"): ContactImportSource {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (CONTACT_IMPORT_SOURCE_SET.has(raw as ContactImportSource)) {
    return raw as ContactImportSource;
  }
  return fallback;
}

function getContactImportSourceLabel(source: ContactImportSource): string {
  switch (source) {
    case "onboarding_portal":
      return "Client Onboarding";
    case "mailchimp_csv":
      return "Mailchimp CSV";
    case "brevo_csv":
      return "Brevo CSV";
    case "kit_csv":
      return "Kit CSV";
    case "flodesk_csv":
      return "Flodesk CSV";
    case "follow_up_boss":
      return "Follow Up Boss";
    case "internal_app":
    default:
      return "Team";
  }
}

const FOLLOW_UP_BOSS_SYNC_CONCURRENCY = 12;
const FOLLOW_UP_BOSS_MAX_ERROR_MESSAGES = 100;

const DIY_MONTHLY_PLAN = Object.freeze({
  code: "diy_49_monthly",
  label: "DIY Monthly",
  priceUsd: 49,
  sendingLimits: {
    maxRecipientsPerSend: 2000,
  },
});

const DIY_ALLOWED_BILLING_STATUSES = new Set(["trialing", "active"]);
const DIY_FUNNEL_EVENT_TYPES = [
  "onboarding_started",
  "sender_verified",
  "contacts_imported",
  "template_selected",
  "newsletter_generated",
  "test_sent",
  "first_send_scheduled",
  "first_send_completed",
  "onboarding_completed",
] as const;
type DiyFunnelEventType = (typeof DIY_FUNNEL_EVENT_TYPES)[number];

async function findPreferredSubscription(clientId: string, preferredSubscriptionId?: string | null) {
  const subscriptions = await storage.getSubscriptionsByClient(clientId);
  if (preferredSubscriptionId) {
    const requested = subscriptions.find((sub) => sub.id === preferredSubscriptionId);
    if (!requested) {
      const error = new Error("Subscription not found for this client.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    return requested;
  }

  const active = subscriptions.find((sub) => sub.status === "active");
  if (active) return active;

  if (subscriptions.length === 0) {
    const error = new Error(
      "No subscription found for this client. Create or sync a subscription before creating newsletters."
    );
    (error as Error & { status?: number }).status = 409;
    throw error;
  }

  const error = new Error("Client has no active subscription. Activate a subscription first.");
  (error as Error & { status?: number }).status = 409;
  throw error;
}

async function ensureSubscriptionHasInvoice(subscriptionId: string) {
  const subscription = await storage.getSubscription(subscriptionId);
  if (!subscription) return null;

  const invoices = await storage.getInvoicesByClient(subscription.clientId);
  const linked = invoices.find((invoice) => invoice.subscriptionId === subscription.id);
  if (linked) return linked;

  return storage.createInvoice({
    clientId: subscription.clientId,
    subscriptionId: subscription.id,
    amount: subscription.amount,
    currency: subscription.currency || "USD",
    status: "paid",
    paidAt: new Date(),
    stripePaymentId: null,
  });
}

async function resolveOrCreateNewsletterInvoice(clientId: string, subscriptionId: string, preferredInvoiceId?: string | null) {
  if (preferredInvoiceId) {
    const invoice = await storage.getInvoice(preferredInvoiceId);
    if (!invoice || invoice.clientId !== clientId) {
      const error = new Error("Invoice not found for this client.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    if (invoice.subscriptionId && invoice.subscriptionId !== subscriptionId) {
      const error = new Error("Invoice belongs to a different subscription.");
      (error as Error & { status?: number }).status = 409;
      throw error;
    }
    if (!invoice.subscriptionId) {
      await storage.updateInvoice(invoice.id, { subscriptionId });
      const updated = await storage.getInvoice(invoice.id);
      return updated || invoice;
    }
    return invoice;
  }

  const invoices = await storage.getInvoicesByClient(clientId);
  const latestLinked = invoices.find((invoice) => invoice.subscriptionId === subscriptionId);
  if (latestLinked) return latestLinked;

  const subscription = await storage.getSubscription(subscriptionId);
  if (!subscription) {
    const error = new Error("Subscription not found.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  return storage.createInvoice({
    clientId,
    subscriptionId,
    amount: subscription.amount,
    currency: subscription.currency || "USD",
    status: "paid",
    paidAt: new Date(),
    stripePaymentId: null,
  });
}

async function getLatestNewsletterDocumentForClient(clientId: string): Promise<NewsletterDocument> {
  const allNewsletters = await storage.getNewslettersByClient(clientId);
  if (!allNewsletters.length) {
    return cloneDefaultNewsletterDocument();
  }

  const latest = allNewsletters
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return normalizeNewsletterDocument(
    (latest?.documentJson as NewsletterDocument | LegacyNewsletterDocument | null | undefined) ||
      DEFAULT_NEWSLETTER_DOCUMENT
  );
}

async function applyBrandingToDocument(clientId: string, document: NewsletterDocument): Promise<NewsletterDocument> {
  const brandingKit = await storage.getBrandingKit(clientId);
  if (!brandingKit) {
    return document;
  }

  return {
    ...document,
    theme: {
      ...(document.theme || {}),
      ...(brandingKit.primaryColor ? { accent: brandingKit.primaryColor } : {}),
      ...(brandingKit.secondaryColor ? { text: brandingKit.secondaryColor } : {}),
    },
  };
}

async function createDraftNewsletterForInvoice(
  invoiceId: string,
  userId: string | null,
  expectedSendDate?: string | null
) {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) {
    const error = new Error("Invoice not found.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }
  if (!invoice.subscriptionId) {
    const error = new Error("Invoice must be attached to a subscription before creating newsletters.");
    (error as Error & { status?: number }).status = 409;
    throw error;
  }

  const allNewsletters = await storage.getNewslettersByClient(invoice.clientId);
  const existingForInvoice = allNewsletters
    .filter((newsletter) => newsletter.invoiceId === invoice.id)
    .sort((a, b) => {
      const aDate = a.expectedSendDate ? new Date(a.expectedSendDate).getTime() : 0;
      const bDate = b.expectedSendDate ? new Date(b.expectedSendDate).getTime() : 0;
      return aDate - bDate;
    });
  if (existingForInvoice.length > 0) {
    return {
      newsletter: existingForInvoice[0],
      newsletters: existingForInvoice,
      created: false,
      createdCount: 0,
    };
  }

  const client = await storage.getClient(invoice.clientId);
  if (!client) {
    const error = new Error("Client not found for invoice.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  const subscription = await storage.getSubscription(invoice.subscriptionId);
  const frequency = subscription?.frequency || "monthly";
  const targetCount = Math.max(1, getNewsletterCountByFrequency(frequency));

  const sendDates: Date[] = [];
  const normalizedExpectedSendDate =
    typeof expectedSendDate === "string" && expectedSendDate.trim().length > 0
      ? expectedSendDate.trim()
      : null;

  if (normalizedExpectedSendDate) {
    const firstDate = new Date(normalizedExpectedSendDate);
    if (!Number.isNaN(firstDate.getTime())) {
      sendDates.push(firstDate);
      if (targetCount > 1) {
        sendDates.push(...getNextSendDates(frequency, firstDate, targetCount - 1));
      }
    }
  }

  if (sendDates.length === 0) {
    const previousSendDates = allNewsletters
      .filter((newsletter) => newsletter.invoiceId !== invoice.id && !!newsletter.expectedSendDate)
      .map((newsletter) => new Date(newsletter.expectedSendDate as string))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());
    const previousSendDate = previousSendDates.length > 0 ? previousSendDates[0] : null;
    sendDates.push(...getNextSendDates(frequency, previousSendDate, targetCount));
  }

  while (sendDates.length < targetCount) {
    const anchor = sendDates.length > 0 ? sendDates[sendDates.length - 1] : new Date();
    sendDates.push(...getNextSendDates(frequency, anchor, 1));
  }

  const baseDocument = await getLatestNewsletterDocumentForClient(client.id);
  const themedDocument = await applyBrandingToDocument(client.id, baseDocument);
  const createdNewsletters = [];

  for (const sendDate of sendDates.slice(0, targetCount)) {
    const documentJson = cloneNewsletterDocument(themedDocument);
    const createdNewsletter = await storage.createNewsletter({
      clientId: client.id,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      title: buildNewsletterTitle(client.name),
      expectedSendDate: format(sendDate, "yyyy-MM-dd"),
      status: "draft",
      documentJson,
      createdById: userId,
      fromEmail: client.primaryEmail,
    });

    const version = await storage.createVersion({
      newsletterId: createdNewsletter.id,
      versionNumber: 1,
      snapshotJson: documentJson,
      createdById: userId,
      changeSummary: "Initial version from invoice",
    });

    const finalizedNewsletter = await storage.updateNewsletter(createdNewsletter.id, { currentVersionId: version.id });
    createdNewsletters.push(finalizedNewsletter || { ...createdNewsletter, currentVersionId: version.id });
  }

  return {
    newsletter: createdNewsletters[0],
    newsletters: createdNewsletters,
    created: createdNewsletters.length > 0,
    createdCount: createdNewsletters.length,
  };
}

const PATCH_FORBIDDEN_STATUSES = new Set<NewsletterStatus>(["scheduled", "sent"]);
const ALLOWED_STATUS_TRANSITIONS: Record<NewsletterStatus, readonly NewsletterStatus[]> = {
  draft: ["draft", "in_review", "approved"],
  in_review: ["draft", "in_review", "changes_requested", "approved"],
  changes_requested: ["draft", "in_review", "changes_requested", "approved"],
  approved: ["in_review", "changes_requested", "approved", "scheduled", "sent"],
  scheduled: ["in_review", "changes_requested", "approved", "scheduled", "sent"],
  sent: ["sent"],
};

function canTransitionNewsletterStatus(
  currentStatus: NewsletterStatus,
  nextStatus: NewsletterStatus
): boolean {
  const allowedTargets = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  return !!allowedTargets && allowedTargets.includes(nextStatus);
}

function getPatchStatusTransitionError(
  currentStatusRaw: unknown,
  nextStatus: NewsletterStatus | undefined
): string | null {
  if (!nextStatus) return null;

  const currentStatus = normalizeNewsletterStatus(currentStatusRaw) || "draft";
  if (currentStatus === "sent" && nextStatus !== "sent") {
    return "Sent newsletters are locked and cannot move back to earlier stages.";
  }
  if (PATCH_FORBIDDEN_STATUSES.has(nextStatus)) {
    return nextStatus === "scheduled"
      ? "Use Schedule Delivery to move a newsletter into 'scheduled'."
      : "Status 'sent' is set automatically only after a successful send.";
  }
  if (!canTransitionNewsletterStatus(currentStatus, nextStatus)) {
    return `Invalid status transition from '${currentStatus}' to '${nextStatus}'.`;
  }
  return null;
}

function applyNewsletterStatusSideEffects(
  status: NewsletterStatus | undefined,
  updateData: Record<string, unknown>,
  expectedSendDate?: string | null
): void {
  if (!status) return;

  if (status !== "scheduled" && status !== "sent" && updateData.scheduledAt === undefined) {
    updateData.scheduledAt = null;
  }

  if (status === "scheduled" && !updateData.scheduledAt) {
    if (expectedSendDate) {
      updateData.scheduledAt = new Date(`${expectedSendDate}T09:00:00`);
    } else {
      updateData.scheduledAt = new Date();
    }
  }

  if (status === "sent") {
    if (!updateData.sentAt) {
      updateData.sentAt = new Date();
    }
    if (!updateData.sendDate) {
      updateData.sendDate = new Date().toISOString().split("T")[0];
    }
  }
}

function isLikelyValidUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("#")) return true;
  if (url.startsWith("mailto:")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function extractUrlsFromHtml(html: string): string[] {
  return Array.from(html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi))
    .map((match) => match[1]?.trim() || "")
    .filter((url) => !!url);
}

function normalizeTagList(input: unknown, fallback: string[] = ["all"]): string[] {
  const raw =
    Array.isArray(input)
      ? input
      : typeof input === "string"
        ? input.split(",")
        : [];
  const normalized = Array.from(
    new Set(
      raw
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  return normalized.length ? normalized : fallback;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvContent(csvContent: string): { headers: string[]; rows: string[][] } {
  const lines = csvContent
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => parseCsvLine(line));
  return { headers, rows };
}

function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function suggestCsvMapping(headers: string[]): {
  email?: string;
  firstName?: string;
  lastName?: string;
  tags?: string;
} {
  const normalized = headers.map((header) => ({
    original: header,
    key: header.toLowerCase().replace(/[^a-z0-9]/g, ""),
  }));

  const pick = (keys: string[]) => normalized.find((item) => keys.includes(item.key))?.original;
  return {
    email: pick(["email", "emailaddress", "eaddress"]),
    firstName: pick(["firstname", "fname", "first"]),
    lastName: pick(["lastname", "lname", "last"]),
    tags: pick(["tags", "tag", "segment", "segments", "group", "groups"]),
  };
}

function normalizeTags(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return ["all"];
  const tokens = raw
    .split(/[;,|]/g)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  return tokens.length > 0 ? Array.from(new Set(tokens)) : ["all"];
}

function normalizeSegmentCandidates(input: unknown): string[] {
  const values =
    Array.isArray(input)
      ? input
      : typeof input === "string"
        ? input.split(",")
        : [];

  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value.length > 0 && value !== "all")
    )
  );
}

function parseStripeDateRangeFilters(
  rawFrom: unknown,
  rawTo: unknown
): {
  fromDate: string | null;
  toDate: string | null;
  fromMs: number | null;
  toMs: number | null;
  error: string | null;
} {
  const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

  const normalizeDate = (
    raw: unknown,
    boundary: "start" | "end",
    label: "fromDate" | "toDate"
  ): { value: string | null; ms: number | null; error: string | null } => {
    if (raw === undefined || raw === null) {
      return { value: null, ms: null, error: null };
    }
    if (typeof raw !== "string") {
      return { value: null, ms: null, error: `${label} must be a YYYY-MM-DD string` };
    }
    const value = raw.trim();
    if (!value) {
      return { value: null, ms: null, error: null };
    }
    if (!DATE_ONLY_RE.test(value)) {
      return { value: null, ms: null, error: `${label} must match YYYY-MM-DD` };
    }
    const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const ms = Date.parse(`${value}${suffix}`);
    if (Number.isNaN(ms)) {
      return { value: null, ms: null, error: `${label} is not a valid date` };
    }
    return { value, ms, error: null };
  };

  const from = normalizeDate(rawFrom, "start", "fromDate");
  if (from.error) {
    return {
      fromDate: null,
      toDate: null,
      fromMs: null,
      toMs: null,
      error: from.error,
    };
  }

  const to = normalizeDate(rawTo, "end", "toDate");
  if (to.error) {
    return {
      fromDate: from.value,
      toDate: null,
      fromMs: from.ms,
      toMs: null,
      error: to.error,
    };
  }

  if (from.ms !== null && to.ms !== null && from.ms > to.ms) {
    return {
      fromDate: from.value,
      toDate: to.value,
      fromMs: from.ms,
      toMs: to.ms,
      error: "fromDate must be on or before toDate",
    };
  }

  return {
    fromDate: from.value,
    toDate: to.value,
    fromMs: from.ms,
    toMs: to.ms,
    error: null,
  };
}

async function importContactsFromCsv(
  clientId: string,
  csvContent: string,
  requestedMapping: Record<string, unknown>,
  options: {
    createSegmentsFromTags?: boolean;
    segmentTags?: unknown;
    importedByUserId?: string;
    importedBySource?: ContactImportSource;
  } = {}
) {
  const { headers, rows } = parseCsvContent(csvContent);
  if (headers.length === 0) {
    throw new Error("CSV appears empty");
  }

  const suggestedMapping = suggestCsvMapping(headers);
  const mapping = {
    email: typeof requestedMapping.email === "string" ? requestedMapping.email : suggestedMapping.email,
    firstName: typeof requestedMapping.firstName === "string" ? requestedMapping.firstName : suggestedMapping.firstName,
    lastName: typeof requestedMapping.lastName === "string" ? requestedMapping.lastName : suggestedMapping.lastName,
    tags: typeof requestedMapping.tags === "string" ? requestedMapping.tags : suggestedMapping.tags,
  };

  if (!mapping.email || !headers.includes(mapping.email)) {
    const error = new Error("Email column is required");
    (error as Error & { meta?: unknown }).meta = { suggestedMapping, headers };
    throw error;
  }

  const mappingWithMeta: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(mapping).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    ),
  };
  if (options.importedByUserId) {
    mappingWithMeta.importedByUserId = options.importedByUserId;
  }
  if (options.importedBySource) {
    mappingWithMeta.importedBySource = options.importedBySource;
  }

  const importJob = await storage.createContactImportJob({
    clientId,
    status: "running",
    totalRows: rows.length,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errors: [],
    mapping: mappingWithMeta,
  });

  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  const errors: string[] = [];
  const discoveredTags = new Set<string>();
  const invalidRows: Array<{
    lineNumber: number;
    email: string;
    firstName: string;
    lastName: string;
    tags: string[];
    reason: string;
  }> = [];
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const shouldCreateSegmentsFromTags = !!options.createSegmentsFromTags;
  const selectedSegmentTags = normalizeSegmentCandidates(options.segmentTags);
  const createdSegments: string[] = [];

  const emailIndex = indexByHeader.get(mapping.email);
  const firstNameIndex = mapping.firstName ? indexByHeader.get(mapping.firstName) : undefined;
  const lastNameIndex = mapping.lastName ? indexByHeader.get(mapping.lastName) : undefined;
  const tagsIndex = mapping.tags ? indexByHeader.get(mapping.tags) : undefined;

  try {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rawEmail = emailIndex !== undefined ? (row[emailIndex] || "") : "";
      const email = rawEmail.trim().toLowerCase();
      const firstName = firstNameIndex !== undefined ? (row[firstNameIndex] || "").trim() : "";
      const lastName = lastNameIndex !== undefined ? (row[lastNameIndex] || "").trim() : "";
      const rawTags = tagsIndex !== undefined ? (row[tagsIndex] || "").trim() : "";
      const tags = normalizeTags(rawTags);

      if (!email || !email.includes("@")) {
        skippedCount += 1;
        const reason = "invalid email";
        errors.push(`Row ${rowIndex + 2}: ${reason}`);
        invalidRows.push({
          lineNumber: rowIndex + 2,
          email,
          firstName,
          lastName,
          tags,
          reason,
        });
        continue;
      }
      for (const tag of tags) {
        if (tag && tag !== "all") discoveredTags.add(tag);
      }

      const upsert = await storage.upsertContactByEmail(clientId, email, {
        firstName: firstName || null,
        lastName: lastName || null,
        tags,
        isActive: true,
      });

      if (upsert.created) {
        importedCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    const existingSegments = await storage.getContactSegmentsByClient(clientId);
    const segmentNameSet = new Set(existingSegments.map((segment) => segment.name.trim().toLowerCase()));

    if (!segmentNameSet.has("all")) {
      await storage.createContactSegment({
        clientId,
        name: "all",
        tags: ["all"],
        isDefault: true,
      });
      segmentNameSet.add("all");
    }

    if (shouldCreateSegmentsFromTags) {
      const tagsToCreate = selectedSegmentTags.length > 0 ? selectedSegmentTags : Array.from(discoveredTags);

      for (const tag of tagsToCreate) {
        const normalizedTag = tag.trim().toLowerCase();
        if (!normalizedTag || normalizedTag === "all" || segmentNameSet.has(normalizedTag)) {
          continue;
        }
        await storage.createContactSegment({
          clientId,
          name: normalizedTag,
          tags: [normalizedTag],
          isDefault: false,
        });
        segmentNameSet.add(normalizedTag);
        createdSegments.push(normalizedTag);
      }
    }

    const updatedJob = await storage.updateContactImportJob(importJob.id, {
      status: "completed",
      importedCount,
      updatedCount,
      skippedCount,
      errors,
    });

    const invalidRowsCsv = invalidRows.length
      ? [
          "line_number,email,first_name,last_name,tags,reason",
          ...invalidRows.map((row) =>
            [
              row.lineNumber,
              row.email,
              row.firstName,
              row.lastName,
              row.tags.join(";"),
              row.reason,
            ]
              .map((cell) => escapeCsvCell(cell))
              .join(",")
          ),
        ].join("\n")
      : "";

    return {
      job: updatedJob,
      summary: {
        totalRows: rows.length,
        importedCount,
        updatedCount,
        skippedCount,
        errorCount: errors.length,
        invalidRowsCount: invalidRows.length,
        discoveredTags: Array.from(discoveredTags),
        createdSegmentsCount: createdSegments.length,
        createdSegments,
      },
      invalidRows,
      invalidRowsCsv,
      mapping,
      suggestedMapping,
      headers,
    };
  } catch (error) {
    await storage.updateContactImportJob(importJob.id, {
      status: "failed",
      errors: [error instanceof Error ? error.message : "Import failed unexpectedly"],
    });
    throw error;
  }
}

const SessionStore = MemoryStore(session);
const PgSessionStore = connectPgSimple(session);

function createSessionStore() {
  // Production/serverless should use a shared store so sessions survive across instances.
  if (process.env.DATABASE_URL) {
    try {
      return new PgSessionStore({
        pool: dbPool,
        tableName: "sessions",
        createTableIfMissing: true,
      });
    } catch (error) {
      console.warn("Falling back to in-memory session store:", error);
    }
  }

  return new SessionStore({ checkPeriod: 86400000 });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const sessionSecret = String(process.env.SESSION_SECRET || "").trim();
  if (process.env.NODE_ENV === "production" && !sessionSecret) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  // Required for secure cookies behind Vercel/edge proxies.
  app.set("trust proxy", 1);

  app.use(
    session({
      secret: sessionSecret || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      store: createSessionStore(),
      proxy: true,
      name: process.env.NODE_ENV === "production" ? "__Host-flow.sid" : "flow.sid",
      cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  registerObjectStorageRoutes(app);

  const serializeUser = (
    user: Pick<
      User,
      "id" | "email" | "name" | "role" | "timezone" | "accountType" | "diyClientId" | "billingStatus" | "onboardingCompleted"
    >
  ) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone || "America/New_York",
    accountType: user.accountType || "internal_operator",
    diyClientId: user.diyClientId || null,
    billingStatus: user.billingStatus || "active",
    onboardingCompleted: Boolean(user.onboardingCompleted),
  });

  const diyClientCache = new Map<string, boolean>();

  const isDiyManagedClient = async (clientId: string): Promise<boolean> => {
    if (!clientId) return false;
    if (diyClientCache.has(clientId)) {
      return diyClientCache.get(clientId) as boolean;
    }
    const { db } = await import("./db");
    const { users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select({ id: (users as any).id })
      .from(users)
      .where(eq((users as any).diyClientId, clientId))
      .limit(1);
    const value = rows.length > 0;
    diyClientCache.set(clientId, value);
    return value;
  };

  const recordDiyFunnelEvent = async (params: {
    clientId: string;
    userId?: string | null;
    eventType: DiyFunnelEventType;
    payload?: Record<string, unknown>;
    dedupeKey?: string;
  }) => {
    if (!(await isDiyManagedClient(params.clientId))) {
      return { recorded: false, reason: "not_diy_client" as const };
    }
    const { db } = await import("./db");
    const { diyFunnelEvents } = await import("@shared/schema");
    const { and, desc, eq, sql } = await import("drizzle-orm");
    const dedupeKey = String(params.dedupeKey || "").trim();
    if (dedupeKey) {
      const existing = await db
        .select({ id: (diyFunnelEvents as any).id })
        .from(diyFunnelEvents)
        .where(
          and(
            eq((diyFunnelEvents as any).clientId, params.clientId),
            eq((diyFunnelEvents as any).eventType, params.eventType),
            sql`${(diyFunnelEvents as any).payload} ->> 'dedupeKey' = ${dedupeKey}`
          )
        )
        .orderBy(desc((diyFunnelEvents as any).createdAt))
        .limit(1);
      if (existing.length > 0) {
        return { recorded: false, reason: "duplicate" as const };
      }
    }

    await db.insert(diyFunnelEvents).values({
      clientId: params.clientId,
      userId: params.userId || null,
      eventType: params.eventType,
      occurredAt: new Date(),
      payload: {
        ...(params.payload || {}),
        ...(dedupeKey ? { dedupeKey } : {}),
      },
    } as any);
    return { recorded: true };
  };

  const recordCrmSyncEventIfNew = async (params: {
    clientId: string;
    provider: "follow_up_boss" | "kvcore" | "boldtrail";
    externalEventId: string;
    eventType: string;
    payload?: Record<string, unknown>;
  }) => {
    const externalEventId = String(params.externalEventId || "").trim();
    if (!externalEventId) return { recorded: false, duplicate: false };
    const { db } = await import("./db");
    const { crmSyncEvents } = await import("@shared/schema");
    try {
      await db.insert(crmSyncEvents).values({
        clientId: params.clientId,
        provider: params.provider,
        externalEventId,
        eventType: String(params.eventType || "unknown"),
        payload: params.payload || {},
        processedAt: new Date(),
      } as any);
      return { recorded: true, duplicate: false };
    } catch (error: any) {
      if (error?.code === "23505") {
        return { recorded: false, duplicate: true };
      }
      throw error;
    }
  };

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { password, name, accountType: requestedAccountType } = req.body || {};
      const email = normalizeEmail(req.body?.email);
      if (!email || !password || !name) {
        return res.status(400).json({ error: "Email, password, and name required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const clientIp = extractClientIp(req);
      const authRateLimitKey = `register:${clientIp}:${email}`;
      const authRateLimit = consumeAuthRateLimit(authRateLimitKey);
      if (!authRateLimit.allowed) {
        return res
          .status(429)
          .set("Retry-After", String(authRateLimit.retryAfterSec))
          .json({ error: "Too many sign-up attempts. Please try again shortly." });
      }

      const requestedInternal = requestedAccountType === "internal_operator";
      if (requestedInternal && !canSelfServeCreateInternalOperator(email)) {
        return res.status(403).json({ error: "Internal operator signup is restricted." });
      }

      const accountType = requestedInternal ? "internal_operator" : "diy_customer";
      if (accountType === "diy_customer" && isLikelyPublicMailboxDomain(email)) {
        return res.status(400).json({
          error: PROFESSIONAL_SENDER_EMAIL_ERROR,
          requiresCustomSenderDomain: true,
        });
      }
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "Email already registered" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        email,
        passwordHash,
        name,
        role: "producer",
        accountType,
        billingStatus: accountType === "diy_customer" ? "trialing" : "active",
        onboardingCompleted: accountType === "diy_customer" ? false : true,
      });

      if (accountType === "diy_customer") {
        const diyClient = await storage.createClient({
          name,
          primaryEmail: email,
          serviceMode: "diy_active",
          newsletterFrequency: "monthly",
          subscriptionStatus: "active",
          locationCity: "",
          locationRegion: "",
        } as any);

        await storage.upsertBrandingKit({
          clientId: diyClient.id,
          title: name,
          email,
        } as any);

        const diySubscription = await storage.createSubscription({
          clientId: diyClient.id,
          amount: "49.00",
          currency: "USD",
          status: "active",
          frequency: "monthly",
          startDate: format(new Date(), "yyyy-MM-dd"),
        } as any);
        await ensureSubscriptionHasInvoice(diySubscription.id);
        await storage.recalculateClientSubscriptionStatus(diyClient.id);
        await tryAutoProvisionPostmarkInfrastructure(diyClient.id, req);

        const updated = await storage.updateUser(user.id, {
          diyClientId: diyClient.id,
        } as any);
        await recordDiyFunnelEvent({
          clientId: diyClient.id,
          userId: user.id,
          eventType: "onboarding_started",
          payload: {
            source: "signup",
            billingStatus: user.billingStatus,
            email: user.email,
          },
          dedupeKey: `onboarding_started:${user.id}`,
        });
        (req.session as any).supportClientId = null;
        (req.session as { userId?: string }).userId = user.id;
        clearAuthRateLimit(authRateLimitKey);
        return res.json({ user: serializeUser((updated || user) as any) });
      }

      (req.session as { userId?: string }).userId = user.id;
      (req.session as any).supportClientId = null;
      clearAuthRateLimit(authRateLimitKey);
      res.json({ user: serializeUser(user) });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const clientIp = extractClientIp(req);
      const authRateLimitKey = `login:${clientIp}:${email || "unknown"}`;
      const authRateLimit = consumeAuthRateLimit(authRateLimitKey);
      if (!authRateLimit.allowed) {
        return res
          .status(429)
          .set("Retry-After", String(authRateLimit.retryAfterSec))
          .json({ error: "Too many login attempts. Please wait a bit and try again." });
      }
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      (req.session as { userId?: string }).userId = user.id;
      (req.session as any).supportClientId = null;
      clearAuthRateLimit(authRateLimitKey);
      res.json({ user: serializeUser(user) });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const userId = (req.session as { userId?: string }).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    res.json({ user: serializeUser(user) });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.patch("/api/auth/account", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as { userId?: string }).userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const {
        name,
        timezone,
        currentPassword,
        newPassword,
      } = req.body || {};

      const patch: Partial<{
        name: string;
        timezone: string;
        passwordHash: string;
      }> = {};

      if (typeof name === "string" && name.trim()) {
        patch.name = name.trim();
      }

      if (typeof timezone === "string" && timezone.trim()) {
        patch.timezone = timezone.trim();
      }

      if (typeof newPassword === "string" && newPassword.trim()) {
        if (newPassword.trim().length < 6) {
          return res.status(400).json({ error: "Password must be at least 6 characters" });
        }
        if (typeof currentPassword !== "string" || !currentPassword.trim()) {
          return res.status(400).json({ error: "Current password is required to change password" });
        }

        const validCurrent = await bcrypt.compare(currentPassword, existingUser.passwordHash);
        if (!validCurrent) {
          return res.status(401).json({ error: "Current password is incorrect" });
        }

        patch.passwordHash = await bcrypt.hash(newPassword.trim(), 12);
      }

      if (Object.keys(patch).length === 0) {
        return res.json({ user: serializeUser(existingUser) });
      }

      const updated = await storage.updateUser(userId, patch as any);
      if (!updated) {
        return res.status(500).json({ error: "Failed to update account" });
      }

      res.json({ user: serializeUser(updated) });
    } catch (error) {
      console.error("Update account error:", error);
      res.status(500).json({ error: "Failed to update account" });
    }
  });

  app.post("/api/auth/switch-account-type", async (req: Request, res: Response) => {
    try {
      const userId = (req.session as { userId?: string }).userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const existingUser = await storage.getUser(userId);
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const targetTypeRaw = typeof req.body?.accountType === "string" ? req.body.accountType.trim() : "";
      if (targetTypeRaw !== "internal_operator" && targetTypeRaw !== "diy_customer") {
        return res.status(400).json({ error: "accountType must be internal_operator or diy_customer" });
      }
      if (targetTypeRaw === "diy_customer" && isLikelyPublicMailboxDomain(String(existingUser.email || "").trim())) {
        return res.status(400).json({
          error: PROFESSIONAL_SENDER_EMAIL_ERROR,
          requiresCustomSenderDomain: true,
        });
      }

      if (
        targetTypeRaw === "internal_operator" &&
        existingUser.accountType !== "internal_operator" &&
        !canSelfServeCreateInternalOperator(existingUser.email)
      ) {
        return res.status(403).json({ error: "Switching to internal mode is restricted." });
      }

      if (existingUser.accountType === targetTypeRaw) {
        return res.json({ user: serializeUser(existingUser) });
      }

      let updatedUser = await storage.updateUser(existingUser.id, {
        accountType: targetTypeRaw,
        billingStatus: targetTypeRaw === "diy_customer" ? (existingUser.billingStatus || "trialing") : "active",
        onboardingCompleted:
          targetTypeRaw === "diy_customer" ? Boolean(existingUser.onboardingCompleted) : true,
      } as any);

      if (!updatedUser) {
        return res.status(500).json({ error: "Failed to switch account type" });
      }

      if (targetTypeRaw === "diy_customer" && !updatedUser.diyClientId) {
        const diyClient = await storage.createClient({
          name: updatedUser.name,
          primaryEmail: updatedUser.email,
          serviceMode: "diy_active",
          newsletterFrequency: "monthly",
          subscriptionStatus: "active",
          locationCity: "",
          locationRegion: "",
        } as any);

        await storage.upsertBrandingKit({
          clientId: diyClient.id,
          title: updatedUser.name,
          email: updatedUser.email,
        } as any);

        const diySubscription = await storage.createSubscription({
          clientId: diyClient.id,
          amount: "49.00",
          currency: "USD",
          status: "active",
          frequency: "monthly",
          startDate: format(new Date(), "yyyy-MM-dd"),
        } as any);
        await ensureSubscriptionHasInvoice(diySubscription.id);
        await storage.recalculateClientSubscriptionStatus(diyClient.id);
        await tryAutoProvisionPostmarkInfrastructure(diyClient.id, req);

        const withClient = await storage.updateUser(updatedUser.id, { diyClientId: diyClient.id } as any);
        if (withClient) updatedUser = withClient;
      }

      (req.session as any).supportClientId = null;
      return res.json({ user: serializeUser(updatedUser) });
    } catch (error) {
      console.error("Switch account type error:", error);
      return res.status(500).json({ error: "Failed to switch account type" });
    }
  });

  // Dev-only auto-login endpoint
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/auth/dev-login", async (req: Request, res: Response) => {
      try {
        const requestedEmail = typeof req.body?.email === "string" ? req.body.email.trim() : "";
        const requestedAccountTypeRaw = typeof req.body?.accountType === "string" ? req.body.accountType.trim() : "";
        const requestedAccountType =
          requestedAccountTypeRaw === "diy_customer" || requestedAccountTypeRaw === "internal_operator"
            ? requestedAccountTypeRaw
            : "internal_operator";
        const resetOnboarding = req.body?.resetOnboarding === true;

        const devEmail = (requestedEmail || process.env.DEV_AUTO_LOGIN_EMAIL || "dev@agentreach.test").toLowerCase();
        let user = await storage.getUserByEmail(devEmail);
        if (!user) {
          const passwordHash = await bcrypt.hash("devpassword123", 12);
          user = await storage.createUser({
            email: devEmail,
            passwordHash,
            name: requestedEmail ? requestedEmail.split("@")[0] || "Dev User" : "Dev User",
            role: "producer",
            accountType: requestedAccountType,
            billingStatus: requestedAccountType === "diy_customer" ? "trialing" : "active",
            onboardingCompleted: requestedAccountType === "diy_customer" ? false : true,
          });
          if (requestedAccountType === "diy_customer") {
            const diyClient = await storage.createClient({
              name: user.name,
              primaryEmail: user.email,
              serviceMode: "diy_active",
              newsletterFrequency: "monthly",
              subscriptionStatus: "active",
              locationCity: "",
              locationRegion: "",
            } as any);

            await storage.upsertBrandingKit({
              clientId: diyClient.id,
              title: user.name,
              email: user.email,
            } as any);

            const diySubscription = await storage.createSubscription({
              clientId: diyClient.id,
              amount: "49.00",
              currency: "USD",
              status: "active",
              frequency: "monthly",
              startDate: format(new Date(), "yyyy-MM-dd"),
            } as any);
            await ensureSubscriptionHasInvoice(diySubscription.id);
            await storage.recalculateClientSubscriptionStatus(diyClient.id);
            await tryAutoProvisionPostmarkInfrastructure(diyClient.id, req);

            const withClient = await storage.updateUser(user.id, { diyClientId: diyClient.id } as any);
            if (withClient) user = withClient;
          }
        }

        if (requestedAccountType === "diy_customer" && user.accountType !== "diy_customer") {
          user = (await storage.updateUser(user.id, {
            accountType: "diy_customer",
            billingStatus: "trialing",
            onboardingCompleted: false,
          } as any)) as User;
        }

        if (requestedAccountType === "internal_operator" && user.accountType !== "internal_operator") {
          user = (await storage.updateUser(user.id, {
            accountType: "internal_operator",
            onboardingCompleted: true,
          } as any)) as User;
        }

        if (requestedAccountType === "diy_customer" && !user.diyClientId) {
          const diyClient = await storage.createClient({
            name: user.name,
            primaryEmail: user.email,
            serviceMode: "diy_active",
            newsletterFrequency: "monthly",
            subscriptionStatus: "active",
            locationCity: "",
            locationRegion: "",
          } as any);

          await storage.upsertBrandingKit({
            clientId: diyClient.id,
            title: user.name,
            email: user.email,
          } as any);

          const diySubscription = await storage.createSubscription({
            clientId: diyClient.id,
            amount: "49.00",
            currency: "USD",
            status: "active",
            frequency: "monthly",
            startDate: format(new Date(), "yyyy-MM-dd"),
          } as any);
          await ensureSubscriptionHasInvoice(diySubscription.id);
          await storage.recalculateClientSubscriptionStatus(diyClient.id);
          await tryAutoProvisionPostmarkInfrastructure(diyClient.id, req);

          const withClient = await storage.updateUser(user.id, { diyClientId: diyClient.id } as any);
          if (withClient) user = withClient;
        }

        if (resetOnboarding && user.accountType === "diy_customer") {
          const resetUser = await storage.updateUser(user.id, { onboardingCompleted: false } as any);
          if (resetUser) user = resetUser;
        }

        if (requestedAccountType === "internal_operator") {
          user = (await storage.updateUser(user.id, { onboardingCompleted: true } as any)) as User;
        }
        if (!user) {
          throw new Error("Unable to initialize dev user");
        }
        (req.session as any).userId = user.id;
        (req.session as any).supportClientId = null;
        return res.json({ user: serializeUser(user) });
      } catch (error) {
        console.error("Dev login error:", error);
        res.status(500).json({ error: "Dev login failed" });
      }
    });
  }

  type AuthedRequest = Request & {
    userId: string;
    currentUser: User;
    scopedClientId: string | null;
  };

  type ServiceMode = "diy_active" | "dfy_requested" | "dfy_active" | "hybrid";
  type WorkspaceCapability =
    | "audience.manage"
    | "newsletter.edit"
    | "newsletter.send"
    | "branding.manage"
    | "subscriptions.configure"
    | "orders.configure"
    | "billing.manage"
    | "service.request";

  const normalizeServiceMode = (value: unknown): ServiceMode => {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === "diy_active" || raw === "dfy_requested" || raw === "dfy_active" || raw === "hybrid") {
      return raw;
    }
    return "dfy_active";
  };

  const DIY_CAPABILITIES_BY_MODE: Record<ServiceMode, Set<WorkspaceCapability>> = {
    diy_active: new Set<WorkspaceCapability>([
      "audience.manage",
      "newsletter.edit",
      "newsletter.send",
      "branding.manage",
      "subscriptions.configure",
      "orders.configure",
      "billing.manage",
      "service.request",
    ]),
    dfy_requested: new Set<WorkspaceCapability>([
      "audience.manage",
      "newsletter.edit",
      "newsletter.send",
      "branding.manage",
      "subscriptions.configure",
      "orders.configure",
      "billing.manage",
    ]),
    dfy_active: new Set<WorkspaceCapability>([
      "audience.manage",
      "newsletter.edit",
      "newsletter.send",
      "branding.manage",
      "subscriptions.configure",
      "orders.configure",
      "billing.manage",
    ]),
    hybrid: new Set<WorkspaceCapability>([
      "audience.manage",
      "newsletter.edit",
      "newsletter.send",
      "branding.manage",
      "subscriptions.configure",
      "orders.configure",
      "billing.manage",
      "service.request",
    ]),
  };

  const requireAuth = async (req: Request, res: Response, next: Function) => {
    const userId = (req.session as { userId?: string }).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const currentUser = await storage.getUser(userId);
    if (!currentUser) {
      return res.status(401).json({ error: "User not found" });
    }

    const supportClientId = (req.session as any).supportClientId as string | undefined;
    const scopedClientId =
      currentUser.accountType === "diy_customer"
        ? (currentUser.diyClientId || null)
        : (supportClientId || null);

    (req as AuthedRequest).userId = userId;
    (req as AuthedRequest).currentUser = currentUser;
    (req as AuthedRequest).scopedClientId = scopedClientId;
    next();
  };

  const ensureClientAccess = (req: Request, res: Response, clientId: string): boolean => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (scopedClientId && scopedClientId !== clientId) {
      res.status(403).json({ error: "Forbidden for this workspace" });
      return false;
    }
    return true;
  };

  const requireInternalOperator = (req: Request, res: Response): boolean => {
    const user = (req as AuthedRequest).currentUser;
    if (user.accountType === "diy_customer") {
      res.status(403).json({ error: "Internal access only" });
      return false;
    }
    return true;
  };

  const logSupportAuditAction = async (
    req: Request,
    action: string,
    targetClientId: string | null,
    metadata: Record<string, unknown> = {}
  ) => {
    try {
      const { db } = await import("./db");
      const { supportActionAudits } = await import("@shared/schema");
      await db.insert(supportActionAudits).values({
        actorUserId: (req as AuthedRequest).userId,
        targetClientId,
        action,
        metadata: {
          ...metadata,
          accountType: (req as AuthedRequest).currentUser.accountType,
          supportClientId: ((req.session as any).supportClientId as string | null) || null,
          path: req.path,
          method: req.method,
        },
      } as any);
    } catch (error) {
      console.warn("Support audit log write failed:", error);
    }
  };

  const resolveClientServiceMode = async (clientId: string): Promise<ServiceMode> => {
    const client = await storage.getClient(clientId);
    return normalizeServiceMode(client?.serviceMode);
  };

  const hasWorkspaceCapability = async (
    req: Request,
    clientId: string,
    capability: WorkspaceCapability
  ): Promise<boolean> => {
    const user = (req as AuthedRequest).currentUser;
    if (user.accountType === "internal_operator") {
      return true;
    }
    if (!user.diyClientId || user.diyClientId !== clientId) {
      return false;
    }
    const mode = await resolveClientServiceMode(clientId);
    return DIY_CAPABILITIES_BY_MODE[mode].has(capability);
  };

  const ensureWorkspaceCapability = async (
    req: Request,
    res: Response,
    clientId: string,
    capability: WorkspaceCapability
  ): Promise<boolean> => {
    if (!ensureClientAccess(req, res, clientId)) {
      return false;
    }
    const allowed = await hasWorkspaceCapability(req, clientId, capability);
    if (!allowed) {
      res.status(403).json({ error: "Action is not allowed for this workspace mode." });
      return false;
    }
    return true;
  };

  app.post("/api/support/impersonate", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const { clientId } = req.body || {};
      if (!clientId || typeof clientId !== "string") {
        return res.status(400).json({ error: "clientId is required" });
      }
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      (req.session as any).supportClientId = clientId;
      await logSupportAuditAction(req, "support_impersonation_started", clientId, {
        serviceMode: normalizeServiceMode((client as any).serviceMode),
      });
      res.json({ supportClientId: clientId });
    } catch (error) {
      console.error("Impersonate error:", error);
      res.status(500).json({ error: "Failed to enter support mode" });
    }
  });

  app.post("/api/support/stop-impersonation", requireAuth, async (req: Request, res: Response) => {
    if (!requireInternalOperator(req, res)) return;
    const currentSupportClientId = ((req.session as any).supportClientId as string | undefined) || null;
    (req.session as any).supportClientId = null;
    await logSupportAuditAction(req, "support_impersonation_stopped", currentSupportClientId, {});
    res.json({ supportClientId: null });
  });

  app.get("/api/support/status", requireAuth, async (req: Request, res: Response) => {
    if (!requireInternalOperator(req, res)) return;
    const supportClientId = ((req.session as any).supportClientId as string | undefined) || null;
    res.json({ supportClientId });
  });

  app.get("/api/diy/plan", requireAuth, async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).currentUser;
    if (user.accountType !== "diy_customer") {
      return res.status(403).json({ error: "DIY access only" });
    }
    res.json(DIY_MONTHLY_PLAN);
  });

  app.post("/api/diy/hire-us", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as AuthedRequest).currentUser;
      if (user.accountType !== "diy_customer") {
        return res.status(403).json({ error: "DIY access only" });
      }
      if (!user.diyClientId) {
        return res.status(409).json({ error: "DIY workspace is not configured." });
      }
      const client = await storage.getClient(user.diyClientId);
      if (!client) {
        return res.status(404).json({ error: "DIY workspace client not found." });
      }

      const currentMode = normalizeServiceMode((client as any).serviceMode);
      if (currentMode === "dfy_requested" || currentMode === "dfy_active") {
        return res.json({
          success: true,
          serviceMode: currentMode,
          message: currentMode === "dfy_active" ? "Service is already active." : "Service request is already in progress.",
        });
      }

      const updatedClient = await storage.updateClient(client.id, {
        serviceMode: "dfy_requested",
      } as any);

      const task = await storage.createProductionTask({
        title: `DFY handoff requested: ${client.name}`,
        description:
          "DIY client requested done-for-you fulfillment. Review brand kit, audience, and upcoming newsletters.",
        completed: false,
        createdById: user.id,
        clientId: client.id,
        priority: "high",
      } as any);

      await storage.createClientNote({
        clientId: client.id,
        type: "note",
        content: `Client requested DFY handoff from DIY on ${new Date().toISOString()}.`,
        priority: "high",
        createdById: user.id,
      } as any);

      await logSupportAuditAction(req, "diy_hire_us_requested", client.id, {
        previousServiceMode: currentMode,
        nextServiceMode: "dfy_requested",
        taskId: task.id,
      });

      res.json({
        success: true,
        serviceMode: normalizeServiceMode((updatedClient as any)?.serviceMode || "dfy_requested"),
        taskId: task.id,
      });
    } catch (error) {
      console.error("DIY hire-us request error:", error);
      res.status(500).json({ error: "Failed to request done-for-you service" });
    }
  });

  app.patch("/api/clients/:id/service-mode", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const requestedMode =
        typeof req.body?.serviceMode === "string" ? req.body.serviceMode.trim().toLowerCase() : "";
      if (!requestedMode || !["diy_active", "dfy_requested", "dfy_active", "hybrid"].includes(requestedMode)) {
        return res.status(400).json({
          error: "serviceMode must be one of: diy_active, dfy_requested, dfy_active, hybrid",
        });
      }

      const previousMode = normalizeServiceMode((client as any).serviceMode);
      if (previousMode === requestedMode) {
        return res.json({
          serviceMode: previousMode,
          client,
        });
      }

      const updatedClient = await storage.updateClient(client.id, {
        serviceMode: requestedMode as ServiceMode,
      } as any);

      await logSupportAuditAction(req, "client_service_mode_updated", client.id, {
        previousServiceMode: previousMode,
        nextServiceMode: requestedMode,
      });

      return res.json({
        serviceMode: normalizeServiceMode((updatedClient as any)?.serviceMode || requestedMode),
        client: updatedClient || client,
      });
    } catch (error) {
      console.error("Update client service mode error:", error);
      return res.status(500).json({ error: "Failed to update service mode" });
    }
  });

  app.get("/api/auth/diy/onboarding-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as AuthedRequest).currentUser;
      if (user.accountType !== "diy_customer") {
        return res.status(403).json({ error: "DIY access only" });
      }
      if (!user.diyClientId) {
        return res.status(409).json({ error: "DIY workspace is not configured." });
      }

      const [client, contacts, brandingKit, newsletters] = await Promise.all([
        storage.getClient(user.diyClientId),
        storage.getContactsByClient(user.diyClientId, "all"),
        storage.getBrandingKit(user.diyClientId),
        storage.getNewslettersByClient(user.diyClientId),
      ]);

      if (!client) {
        return res.status(404).json({ error: "DIY workspace client not found." });
      }

      const hasBrandBasics = Boolean(
        brandingKit &&
          String(brandingKit.companyName || "").trim() &&
          String(brandingKit.primaryColor || "").trim() &&
          String(brandingKit.secondaryColor || "").trim()
      );

      res.json({
        onboardingCompleted: Boolean(user.onboardingCompleted),
        billingStatus: user.billingStatus || "trialing",
        serviceMode: normalizeServiceMode((client as any).serviceMode),
        metrics: {
          contactCount: contacts.length,
          newsletterCount: newsletters.length,
          postmarkProvisioned: Boolean(client.postmarkServerId && client.postmarkMessageStreamId),
        },
        readyForFirstSend: Boolean(client.isVerified && contacts.length > 0 && hasBrandBasics),
        steps: {
          senderVerified: !!client.isVerified,
          contactsImported: contacts.length > 0,
          brandKitCompleted: hasBrandBasics,
          firstNewsletterCreated: newsletters.length > 0,
        },
      });
    } catch (error) {
      console.error("DIY onboarding status error:", error);
      res.status(500).json({ error: "Failed to fetch onboarding status" });
    }
  });

  app.get("/api/diy/funnel-summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as AuthedRequest).currentUser;
      let clientId = "";

      if (currentUser.accountType === "diy_customer") {
        if (!currentUser.diyClientId) {
          return res.status(409).json({ error: "DIY workspace is not configured." });
        }
        clientId = currentUser.diyClientId;
      } else {
        const requestedClientId =
          typeof req.query?.clientId === "string" ? req.query.clientId.trim() : "";
        if (!requestedClientId) {
          return res.status(400).json({ error: "clientId is required for internal users." });
        }
        if (!ensureClientAccess(req, res, requestedClientId)) return;
        clientId = requestedClientId;
      }

      const daysRaw = Number(req.query?.days || 30);
      const windowDays = Number.isFinite(daysRaw) ? Math.max(7, Math.min(Math.floor(daysRaw), 365)) : 30;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      const { db } = await import("./db");
      const { diyFunnelEvents } = await import("@shared/schema");
      const { and, asc, eq, gte } = await import("drizzle-orm");

      const events = await db
        .select()
        .from(diyFunnelEvents)
        .where(
          and(
            eq((diyFunnelEvents as any).clientId, clientId),
            gte((diyFunnelEvents as any).createdAt, since)
          )
        )
        .orderBy(asc((diyFunnelEvents as any).createdAt));

      const counts: Record<string, number> = Object.fromEntries(
        DIY_FUNNEL_EVENT_TYPES.map((eventType) => [eventType, 0])
      );
      const firstSeen: Record<string, string | null> = Object.fromEntries(
        DIY_FUNNEL_EVENT_TYPES.map((eventType) => [eventType, null])
      );

      for (const event of events as any[]) {
        const eventType = String(event?.eventType || "");
        if (!counts[eventType] && counts[eventType] !== 0) continue;
        counts[eventType] += 1;
        if (!firstSeen[eventType]) {
          firstSeen[eventType] = (event?.createdAt || event?.occurredAt || null)
            ? new Date(event.createdAt || event.occurredAt).toISOString()
            : null;
        }
      }

      const requiredSteps: DiyFunnelEventType[] = [
        "sender_verified",
        "contacts_imported",
        "newsletter_generated",
        "test_sent",
        "first_send_scheduled",
        "first_send_completed",
      ];
      const completedSteps = requiredSteps.filter((step) => (counts[step] || 0) > 0).length;
      const onboardingAtRaw = firstSeen.onboarding_started;
      const firstSendCompletedAtRaw = firstSeen.first_send_completed;
      const minutesToFirstSend =
        onboardingAtRaw && firstSendCompletedAtRaw
          ? Math.max(
              0,
              Math.round(
                (new Date(firstSendCompletedAtRaw).getTime() - new Date(onboardingAtRaw).getTime()) / 60000
              )
            )
          : null;

      res.json({
        clientId,
        windowDays,
        totalEvents: events.length,
        counts,
        firstSeen,
        completedSteps,
        totalSteps: requiredSteps.length,
        minutesToFirstSend,
        kpis: {
          hasStarted: (counts.onboarding_started || 0) > 0,
          senderVerified: (counts.sender_verified || 0) > 0,
          contactsImported: (counts.contacts_imported || 0) > 0,
          generatedNewsletter: (counts.newsletter_generated || 0) > 0,
          sentTest: (counts.test_sent || 0) > 0,
          scheduledFirstSend: (counts.first_send_scheduled || 0) > 0,
          completedFirstSend: (counts.first_send_completed || 0) > 0,
        },
      });
    } catch (error) {
      console.error("DIY funnel summary error:", error);
      res.status(500).json({ error: "Failed to fetch DIY funnel summary" });
    }
  });

  app.post("/api/auth/diy/onboarding-complete", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as AuthedRequest).currentUser;
      if (user.accountType !== "diy_customer") {
        return res.status(403).json({ error: "DIY access only" });
      }
      if (!user.diyClientId) {
        return res.status(409).json({ error: "DIY workspace is not configured." });
      }

      const [client, contacts, brandingKit] = await Promise.all([
        storage.getClient(user.diyClientId),
        storage.getContactsByClient(user.diyClientId, "all"),
        storage.getBrandingKit(user.diyClientId),
      ]);
      if (!client) {
        return res.status(404).json({ error: "DIY workspace client not found." });
      }
      if (!client.isVerified) {
        return res.status(409).json({ error: "Verify sender before completing onboarding." });
      }
      if (contacts.length === 0) {
        return res.status(409).json({ error: "Import at least one contact before completing onboarding." });
      }
      const hasBrandBasics = Boolean(
        brandingKit &&
          String(brandingKit.companyName || "").trim() &&
          String(brandingKit.primaryColor || "").trim() &&
          String(brandingKit.secondaryColor || "").trim()
      );
      if (!hasBrandBasics) {
        return res.status(409).json({ error: "Complete your brand kit basics before completing onboarding." });
      }

      const updated = await storage.updateUser(user.id, {
        onboardingCompleted: true,
      } as any);
      await recordDiyFunnelEvent({
        clientId: user.diyClientId,
        userId: user.id,
        eventType: "onboarding_completed",
        payload: {
          senderVerified: !!client.isVerified,
          contactsImported: contacts.length > 0,
          brandKitCompleted: hasBrandBasics,
        },
        dedupeKey: `onboarding_completed:${user.id}`,
      });

      res.json({
        user: serializeUser((updated || user) as any),
      });
    } catch (error) {
      console.error("DIY onboarding complete error:", error);
      res.status(500).json({ error: "Failed to complete onboarding" });
    }
  });

  const normalizeBaseUrl = (req?: Request): string => {
    if (req) {
      const host = req.get("host");
      if (host) {
        return `${req.protocol}://${host}`.replace(/\/+$/, "");
      }
    }
    const appBase = String(process.env.APP_BASE_URL || "").trim();
    if (appBase) return appBase.replace(/\/+$/, "");
    const vercel = String(process.env.VERCEL_URL || "").trim();
    if (vercel) return `https://${vercel}`.replace(/\/+$/, "");
    return "";
  };

  app.use("/api/clients/:id", requireAuth, async (req: Request, res: Response, next) => {
    if (!ensureClientAccess(req, res, req.params.id)) return;
    next();
  });

  app.use("/api/clients/:clientId", requireAuth, async (req: Request, res: Response, next) => {
    if (!ensureClientAccess(req, res, req.params.clientId)) return;
    next();
  });

  app.use("/api/newsletters/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const newsletter = await storage.getNewsletter(req.params.id);
    if (!newsletter) return next();
    if (newsletter.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/contacts/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const contact = await storage.getContact(req.params.id);
    if (!contact) return next();
    if (contact.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/subscriptions/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const subscription = await storage.getSubscription(req.params.id);
    if (!subscription) return next();
    if (subscription.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/invoices/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const invoice = await storage.getInvoice(req.params.id);
    if (!invoice) return next();
    if (invoice.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/segments/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const segment = await storage.getContactSegment(req.params.id);
    if (!segment) return next();
    if (segment.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/branding-kits/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const kit = await storage.getBrandingKitById(req.params.id);
    if (!kit) return next();
    if (kit.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/notes/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const note = await storage.getClientNote(req.params.id);
    if (!note) return next();
    if (note.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/review-comments/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const comment = await storage.getReviewComment(req.params.id);
    if (!comment) return next();
    const newsletter = await storage.getNewsletter(comment.newsletterId);
    if (!newsletter) return next();
    if (newsletter.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/projects/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const project = await storage.getProject(req.params.id);
    if (!project) return next();
    if (project.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  app.use("/api/tasks/:id", requireAuth, async (req: Request, res: Response, next) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) return next();
    const task = await storage.getProductionTask(req.params.id);
    if (!task) return next();
    if (!task.clientId || task.clientId !== scopedClientId) {
      return res.status(403).json({ error: "Forbidden for this workspace" });
    }
    next();
  });

  const getScopedClients = async (req: Request) => {
    const scopedClientId = (req as AuthedRequest).scopedClientId;
    if (!scopedClientId) {
      return storage.getClients();
    }
    const scoped = await storage.getClient(scopedClientId);
    return scoped ? [scoped] : [];
  };

  const enforceDiySendGuard = async (
    req: Request,
    qa: {
      newsletter: { clientId: string };
      recipientsCount: number;
    },
    mode: "test" | "schedule" | "send_now"
  ): Promise<{ ok: true } | { ok: false; status: number; payload: Record<string, unknown> }> => {
    const currentUser = (req as AuthedRequest).currentUser;
    if (currentUser.accountType !== "diy_customer") {
      return { ok: true };
    }

    const billingStatus = String(currentUser.billingStatus || "trialing");
    if (!DIY_ALLOWED_BILLING_STATUSES.has(billingStatus)) {
      return {
        ok: false,
        status: 402,
        payload: {
          error: "DIY billing is not active. Update billing to continue sending.",
          billingStatus,
        },
      };
    }

    if (!currentUser.diyClientId || currentUser.diyClientId !== qa.newsletter.clientId) {
      return {
        ok: false,
        status: 403,
        payload: { error: "DIY sending is only allowed for your workspace." },
      };
    }

    if (mode !== "test" && qa.recipientsCount > DIY_MONTHLY_PLAN.sendingLimits.maxRecipientsPerSend) {
      return {
        ok: false,
        status: 429,
        payload: {
          error: `Recipient count exceeds plan limit (${DIY_MONTHLY_PLAN.sendingLimits.maxRecipientsPerSend}).`,
          recipientsCount: qa.recipientsCount,
          limits: DIY_MONTHLY_PLAN.sendingLimits,
        },
      };
    }

    return { ok: true };
  };

  const readClientPostmarkTenant = async (clientId: string) => {
    const { db } = await import("./db");
    const { clientPostmarkTenants } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [tenant] = await db
      .select()
      .from(clientPostmarkTenants)
      .where(eq((clientPostmarkTenants as any).clientId, clientId));
    return tenant || null;
  };

  const getReservedPostmarkServerIds = async (excludeClientId?: string): Promise<number[]> => {
    const { db } = await import("./db");
    const { clientPostmarkTenants } = await import("@shared/schema");
    const { ne } = await import("drizzle-orm");

    const rows = excludeClientId
      ? await db
          .select({ serverId: (clientPostmarkTenants as any).serverId })
          .from(clientPostmarkTenants)
          .where(ne((clientPostmarkTenants as any).clientId, excludeClientId))
      : await db.select({ serverId: (clientPostmarkTenants as any).serverId }).from(clientPostmarkTenants);

    return rows
      .map((row: any) => Number(row?.serverId || 0))
      .filter((value: number) => Number.isFinite(value) && value > 0);
  };

  const upsertClientPostmarkTenant = async (
    clientId: string,
    patch: Record<string, unknown>
  ) => {
    const { db } = await import("./db");
    const { clientPostmarkTenants } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const existing = await readClientPostmarkTenant(clientId);
    if (existing) {
      const [updated] = await db
        .update(clientPostmarkTenants)
        .set({ ...(patch as any), updatedAt: new Date() } as any)
        .where(eq((clientPostmarkTenants as any).clientId, clientId))
        .returning();
      return updated || existing;
    }
    const hasRequiredCreateFields =
      typeof patch.serverId === "number" &&
      String(patch.serverToken || "").trim().length > 0 &&
      String(patch.broadcastStreamId || "").trim().length > 0;
    if (!hasRequiredCreateFields) {
      return null;
    }
    const [created] = await db
      .insert(clientPostmarkTenants)
      .values({ clientId, ...(patch as any) } as any)
      .returning();
    return created || null;
  };

  const syncClientPostmarkSnapshot = async (
    clientId: string,
    snapshot: {
      serverId?: number | null;
      streamId?: string | null;
      domain?: string | null;
      domainVerificationState?: "not_configured" | "pending" | "verified" | "failed";
      senderVerificationState?: "missing" | "pending" | "verified" | "failed";
      qualityState?: "healthy" | "watch" | "paused";
      autoPausedAt?: Date | null;
      autoPauseReason?: string | null;
      signatureId?: number | null;
      isVerified?: boolean;
    }
  ) => {
    await storage.updateClient(clientId, {
      postmarkServerId: typeof snapshot.serverId === "number" ? snapshot.serverId : undefined,
      postmarkMessageStreamId: snapshot.streamId || undefined,
      postmarkDomain: snapshot.domain || undefined,
      postmarkDomainVerificationState: snapshot.domainVerificationState || undefined,
      postmarkSenderVerificationState: snapshot.senderVerificationState || undefined,
      postmarkQualityState: snapshot.qualityState || undefined,
      postmarkAutoPausedAt:
        snapshot.autoPausedAt === undefined ? undefined : snapshot.autoPausedAt,
      postmarkAutoPauseReason:
        snapshot.autoPauseReason === undefined ? undefined : snapshot.autoPauseReason,
      postmarkSignatureId:
        typeof snapshot.signatureId === "number" ? snapshot.signatureId : undefined,
      isVerified: typeof snapshot.isVerified === "boolean" ? snapshot.isVerified : undefined,
    } as any);
  };

  const ensureClientPostmarkInfrastructure = async (clientId: string, req?: Request) => {
    const client = await storage.getClient(clientId);
    if (!client) {
      return { ok: false, error: "Client not found" };
    }

    const existingTenant = await readClientPostmarkTenant(clientId);
    const reservedServerIds = await getReservedPostmarkServerIds(clientId);
    const provisioned = await ensureClientPostmarkTenant({
      clientName: client.name,
      senderEmail: client.primaryEmail,
      replyToEmail: client.secondaryEmail || client.primaryEmail,
      baseUrl: normalizeBaseUrl(req),
      existing: {
        serverId: existingTenant?.serverId || client.postmarkServerId || null,
        serverToken: existingTenant?.serverToken || null,
        broadcastStreamId:
          existingTenant?.broadcastStreamId || client.postmarkMessageStreamId || null,
        webhookId: existingTenant?.webhookId || null,
        signatureId: existingTenant?.senderSignatureId || client.postmarkSignatureId || null,
        reservedServerIds,
      },
    });

    if (!provisioned.success || !provisioned.serverId || !provisioned.serverToken || !provisioned.broadcastStreamId) {
      return { ok: false, error: provisioned.error || "Failed to provision Postmark client tenant." };
    }

    const senderState = provisioned.senderConfirmed ? "verified" : "pending";
    const tenant = await upsertClientPostmarkTenant(clientId, {
      serverId: provisioned.serverId,
      serverToken: provisioned.serverToken,
      broadcastStreamId: provisioned.broadcastStreamId,
      webhookId: provisioned.webhookId ?? null,
      webhookUrl: provisioned.webhookUrl ?? null,
      senderSignatureId: provisioned.signatureId ?? null,
      senderEmail: client.primaryEmail,
      senderConfirmed: !!provisioned.senderConfirmed,
      domain: provisioned.domain || null,
      domainVerificationState: provisioned.domainVerificationState || "not_configured",
      qualityState: client.postmarkQualityState || "healthy",
    });

    await syncClientPostmarkSnapshot(clientId, {
      serverId: provisioned.serverId,
      streamId: provisioned.broadcastStreamId,
      domain: provisioned.domain || null,
      domainVerificationState: provisioned.domainVerificationState || "not_configured",
      senderVerificationState: senderState,
      qualityState: ((tenant as any)?.qualityState || client.postmarkQualityState || "healthy") as any,
      autoPausedAt: ((tenant as any)?.autoPausedAt as Date | null) || null,
      autoPauseReason: ((tenant as any)?.autoPauseReason as string | null) || null,
      signatureId: provisioned.signatureId ?? null,
      isVerified: !!provisioned.senderConfirmed,
    });

    return {
      ok: true,
      tenant: await readClientPostmarkTenant(clientId),
      senderVerified: !!provisioned.senderConfirmed,
    };
  };

  const tryAutoProvisionPostmarkInfrastructure = async (clientId: string, req?: Request) => {
    if (!process.env.POSTMARK_ACCOUNT_API_TOKEN) return;
    try {
      const result = await ensureClientPostmarkInfrastructure(clientId, req);
      if (!result.ok) {
        console.warn(`Postmark auto-provision warning for client ${clientId}: ${result.error}`);
      }
    } catch (error) {
      console.warn(`Postmark auto-provision failed for client ${clientId}:`, error);
    }
  };

  const formatPostmarkProvisioningError = (rawError: unknown) => {
    const message = String(rawError || "").trim();
    if (/limit of\s*10\s*servers/i.test(message)) {
      return {
        status: 409,
        error:
          "Postmark server limit reached for this account (10 servers on current tier). Free up a server or upgrade Postmark, then retry sender setup.",
      };
    }
    return {
      status: 400,
      error: message || "Failed to provision Postmark server for this client.",
    };
  };

  const getClientPostmarkSenderConfig = async (clientId: string) => {
    const client = await storage.getClient(clientId);
    if (!client) return null;
    const tenant = await readClientPostmarkTenant(clientId);
    if (!tenant) return null;
    return {
      client,
      tenant,
      serverId: tenant.serverId,
      serverToken: String(tenant.serverToken || "").trim(),
      messageStream: String(tenant.broadcastStreamId || client.postmarkMessageStreamId || "broadcast").trim(),
      qualityState: String(tenant.qualityState || client.postmarkQualityState || "healthy"),
      autoPausedAt: tenant.autoPausedAt || null,
      autoPauseReason: tenant.autoPauseReason || null,
      senderVerified: !!tenant.senderConfirmed && !!client.isVerified,
    };
  };

  const evaluateClientDeliverabilityGuard = async (clientId: string) => {
    const { db } = await import("./db");
    const { newsletterDeliveries, newsletterEvents } = await import("@shared/schema");
    const { and, eq, gte, sql } = await import("drizzle-orm");

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [deliveryStats] = await db
      .select({
        attempts: sql<number>`count(*)`,
        bounced: sql<number>`sum(case when ${(newsletterDeliveries as any).status} = 'bounced' then 1 else 0 end)`,
      })
      .from(newsletterDeliveries)
      .where(
        and(
          eq((newsletterDeliveries as any).clientId, clientId),
          gte((newsletterDeliveries as any).createdAt, since)
        )
      );

    const [eventStats] = await db
      .select({
        complaints: sql<number>`
          sum(
            case
              when lower(${(newsletterEvents as any).eventType}) like '%complaint%' then 1
              else 0
            end
          )
        `,
      })
      .from(newsletterEvents)
      .where(
        and(
          eq((newsletterEvents as any).clientId, clientId),
          gte((newsletterEvents as any).createdAt, since)
        )
      );

    const attempts = Number(deliveryStats?.attempts || 0);
    const bounced = Number(deliveryStats?.bounced || 0);
    const complaints = Number(eventStats?.complaints || 0);
    const bounceRate = attempts > 0 ? bounced / attempts : 0;
    const complaintRate = attempts > 0 ? complaints / attempts : 0;

    const pauseBounceThreshold = Number(process.env.POSTMARK_BOUNCE_PAUSE_THRESHOLD || 0.10);
    const pauseComplaintThreshold = Number(process.env.POSTMARK_COMPLAINT_PAUSE_THRESHOLD || 0.001);
    const watchBounceThreshold = Number(process.env.POSTMARK_BOUNCE_WATCH_THRESHOLD || 0.08);
    const watchComplaintThreshold = Number(process.env.POSTMARK_COMPLAINT_WATCH_THRESHOLD || 0.0008);

    let qualityState: "healthy" | "watch" | "paused" = "healthy";
    let autoPauseReason: string | null = null;
    let autoPausedAt: Date | null = null;

    const minSample = Number(process.env.POSTMARK_DELIVERABILITY_MIN_SAMPLE || 25);
    if (attempts >= minSample && (bounceRate >= pauseBounceThreshold || complaintRate >= pauseComplaintThreshold)) {
      qualityState = "paused";
      autoPausedAt = new Date();
      autoPauseReason = `Auto-paused: bounce ${(bounceRate * 100).toFixed(2)}%, complaints ${(complaintRate * 100).toFixed(2)}% (last 30d)`;
    } else if (attempts >= minSample && (bounceRate >= watchBounceThreshold || complaintRate >= watchComplaintThreshold)) {
      qualityState = "watch";
    }

    await upsertClientPostmarkTenant(clientId, {
      qualityState,
      autoPausedAt,
      autoPauseReason,
      lastBounceRate: bounceRate.toFixed(4),
      lastComplaintRate: complaintRate.toFixed(4),
      lastHealthCheckAt: new Date(),
    });

    const client = await storage.getClient(clientId);
    await syncClientPostmarkSnapshot(clientId, {
      serverId: client?.postmarkServerId || undefined,
      streamId: client?.postmarkMessageStreamId || undefined,
      domain: client?.postmarkDomain || undefined,
      domainVerificationState: (client?.postmarkDomainVerificationState as any) || undefined,
      senderVerificationState: (client?.postmarkSenderVerificationState as any) || undefined,
      qualityState,
      autoPausedAt,
      autoPauseReason,
      signatureId: client?.postmarkSignatureId || undefined,
      isVerified: client?.isVerified,
    });

    return {
      attempts,
      bounced,
      complaints,
      bounceRate,
      complaintRate,
      qualityState,
      autoPausedAt,
      autoPauseReason,
    };
  };

  // ============================================================================
  // USERS
  // ============================================================================
  app.get("/api/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as AuthedRequest).currentUser;
      if (currentUser.accountType === "diy_customer") {
        return res.json([serializeUser(currentUser as any)]);
      }
      const allUsers = await storage.getUsers();
      const currentUserId = (req as Request & { userId: string }).userId;
      const users = allUsers
        .filter((user) => {
          if (user.id === currentUserId) return true;
          const email = String(user.email || "").toLowerCase();
          const name = String(user.name || "").toLowerCase();
          const isSyntheticEmail =
            email.includes("@agentreach.test") ||
            email.includes("@example.com") ||
            email.startsWith("qa-");
          const isSyntheticName =
            name.startsWith("qa ") ||
            name.includes("qa client") ||
            name === "dev user";
          return !isSyntheticEmail && !isSyntheticName;
        })
        .map((user) => serializeUser(user as any));
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // ============================================================================
  // CLIENTS
  // ============================================================================
  app.get("/api/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      const clients = await getScopedClients(req);
      res.json(clients);
    } catch (error) {
      console.error("Get clients error:", error);
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await storage.getClientWithRelations(req.params.id);
      if (!data) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.get("/api/clients/:id/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;
      const view = normalizeContactView(req.query?.view);
      const contacts = await storage.getContactsByClient(client.id, view);
      res.json(contacts);
    } catch (error) {
      console.error("Get contacts error:", error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  app.get("/api/clients/:id/contact-import-jobs", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const jobs = await storage.getContactImportJobsByClient(client.id);
      const limitedJobs = jobs.slice(0, 20);

      const userIds = Array.from(
        new Set(
          limitedJobs
            .map((job) => (job.mapping && typeof job.mapping === "object" ? (job.mapping as Record<string, unknown>).importedByUserId : null))
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        )
      );

      const usersById = new Map<string, { id: string; name: string; email: string }>();
      await Promise.all(
        userIds.map(async (userId) => {
          const user = await storage.getUser(userId);
          if (user) {
            usersById.set(user.id, { id: user.id, name: user.name, email: user.email });
          }
        })
      );

      const enriched = limitedJobs.map((job) => {
        const mapping = (job.mapping || {}) as Record<string, unknown>;
        const importedByUserId =
          typeof mapping.importedByUserId === "string" ? mapping.importedByUserId : null;
        const importedBySource = normalizeContactImportSource(mapping.importedBySource, "internal_app");
        const importedByUser = importedByUserId ? usersById.get(importedByUserId) : null;

        return {
          ...job,
          importedByUserId,
          importedBySource,
          importedByLabel: importedByUser?.name || getContactImportSourceLabel(importedBySource),
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Get contact import jobs error:", error);
      res.status(500).json({ error: "Failed to fetch contact import history" });
    }
  });

  const getFollowUpBossConnectionContext = async (clientId: string) => {
    const connection = await storage.getClientCrmConnection(clientId, "follow_up_boss");
    if (!connection || connection.status !== "connected") {
      return null;
    }
    const metadata = (connection.metadata || {}) as Record<string, unknown>;
    return {
      connection,
      metadata,
      config: {
        apiKey: connection.accessToken,
        system: typeof metadata.system === "string" ? metadata.system : "Flow",
        systemKey: typeof metadata.systemKey === "string" ? metadata.systemKey : undefined,
      },
    };
  };

  const ensureFollowUpBossSegmentsForClient = async (clientId: string) => {
    const existingSegments = await storage.getContactSegmentsByClient(clientId);
    const segmentNames = new Set(
      existingSegments.map((segment) => String(segment.name || "").trim().toLowerCase()).filter(Boolean)
    );
    if (!segmentNames.has("all")) {
      await storage.createContactSegment({
        clientId,
        name: "all",
        tags: ["all"],
        isDefault: true,
      });
    }
    if (!segmentNames.has("follow up boss")) {
      await storage.createContactSegment({
        clientId,
        name: "follow up boss",
        tags: ["follow up boss"],
        isDefault: false,
      });
    }
  };

  type FollowUpBossSyncSummary = {
    totalFetched: number;
    importedCount: number;
    updatedCount: number;
    skippedCount: number;
    errorCount: number;
  };

  const followUpBossSyncInFlight = new Map<string, Promise<FollowUpBossSyncSummary>>();

  const syncFollowUpBossContactsIntoFlow = async (input: {
    clientId: string;
    userId: string;
    maxPeople: number;
    reason: "manual" | "auto";
    updatedSince?: string | Date | null;
    sourceEventId?: string | null;
  }): Promise<FollowUpBossSyncSummary> => {
    const context = await getFollowUpBossConnectionContext(input.clientId);
    if (!context) {
      throw new Error("Follow Up Boss is not connected for this client.");
    }

    const syncStartedAt = new Date();
    await storage.updateClientCrmConnection(input.clientId, "follow_up_boss", {
      lastSyncStatus: "idle",
      lastSyncMessage: input.reason === "auto" ? "Auto-sync in progress…" : "Sync in progress…",
    });

    let importJobId: string | null = null;
    try {
      const incrementalSince =
        input.updatedSince ??
        (input.reason === "auto" ? (context.connection.lastSyncedAt || null) : null);
      let people;
      try {
        people = await listFollowUpBossPeople(context.config, input.maxPeople, {
          updatedSince: incrementalSince,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (incrementalSince && /400|422|invalid|updatedsince/i.test(message)) {
          people = await listFollowUpBossPeople(context.config, input.maxPeople);
        } else {
          throw error;
        }
      }
      const importJob = await storage.createContactImportJob({
        clientId: input.clientId,
        status: "running",
        totalRows: people.length,
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        errors: [],
        mapping: {
          importedBySource: "follow_up_boss",
          importedByUserId: input.userId,
          crmProvider: "follow_up_boss",
          syncReason: input.reason,
          sourceEventId: input.sourceEventId || "",
          updatedSince:
            incrementalSince instanceof Date
              ? incrementalSince.toISOString()
              : typeof incrementalSince === "string"
                ? incrementalSince
                : "",
          syncedAt: syncStartedAt.toISOString(),
        },
      });
      importJobId = importJob.id;

      type ContactSyncResult =
        | { kind: "imported" }
        | { kind: "updated" }
        | { kind: "skipped" }
        | { kind: "error"; message: string };

      const limit = pLimit(FOLLOW_UP_BOSS_SYNC_CONCURRENCY);
      const results = await Promise.all(
        people.map((person) =>
          limit(async (): Promise<ContactSyncResult> => {
            const email = String(person.emails?.[0] || "").trim().toLowerCase();
            if (!email || !email.includes("@")) {
              return { kind: "skipped" };
            }

            try {
              const existing = await storage.getContactByEmail(input.clientId, email);
              const mergedTags = normalizeTagList([
                ...(existing?.tags || []),
                ...person.tags,
                "follow up boss",
                "all",
              ]);

              const upsert = await storage.upsertContactByEmail(input.clientId, email, {
                firstName: person.firstName || existing?.firstName || null,
                lastName: person.lastName || existing?.lastName || null,
                tags: mergedTags,
                isActive: existing?.isActive ?? true,
              });
              return { kind: upsert.created ? "imported" : "updated" };
            } catch (error) {
              const message = error instanceof Error ? error.message : `Failed to sync ${email}`;
              return { kind: "error", message };
            }
          })
        )
      );

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const result of results) {
        if (result.kind === "imported") {
          importedCount += 1;
          continue;
        }
        if (result.kind === "updated") {
          updatedCount += 1;
          continue;
        }
        if (result.kind === "skipped") {
          skippedCount += 1;
          continue;
        }
        errorCount += 1;
        skippedCount += 1;
        if (errors.length < FOLLOW_UP_BOSS_MAX_ERROR_MESSAGES) {
          errors.push(result.message);
        }
      }

      if (errorCount > errors.length) {
        errors.push(`...and ${errorCount - errors.length} more errors`);
      }

      await ensureFollowUpBossSegmentsForClient(input.clientId);

      await storage.updateContactImportJob(importJob.id, {
        status: "completed",
        importedCount,
        updatedCount,
        skippedCount,
        errors,
      });

      await storage.updateClientCrmConnection(input.clientId, "follow_up_boss", {
        lastSyncedAt: new Date(),
        lastSyncStatus: "success",
        lastSyncMessage: `Synced ${importedCount + updatedCount} contacts (${importedCount} new, ${updatedCount} updated).`,
      });

      return {
        totalFetched: people.length,
        importedCount,
        updatedCount,
        skippedCount,
        errorCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Follow Up Boss sync failed";
      if (importJobId) {
        await storage.updateContactImportJob(importJobId, {
          status: "failed",
          errors: [message],
        });
      }
      await storage.updateClientCrmConnection(input.clientId, "follow_up_boss", {
        lastSyncStatus: "error",
        lastSyncMessage: message,
      });
      throw error;
    }
  };

  const runFollowUpBossSyncLocked = (input: {
    clientId: string;
    userId: string;
    maxPeople: number;
    reason: "manual" | "auto";
    updatedSince?: string | Date | null;
    sourceEventId?: string | null;
  }): Promise<FollowUpBossSyncSummary> => {
    const existing = followUpBossSyncInFlight.get(input.clientId);
    if (existing) {
      return existing;
    }
    const pending = syncFollowUpBossContactsIntoFlow(input).finally(() => {
      followUpBossSyncInFlight.delete(input.clientId);
    });
    followUpBossSyncInFlight.set(input.clientId, pending);
    return pending;
  };

  const syncFlowContactToFollowUpBoss = async (contactId: string) => {
    try {
      const contact = await storage.getContact(contactId);
      if (!contact) return;
      const context = await getFollowUpBossConnectionContext(contact.clientId);
      if (!context) return;

      const tags = normalizeTagList([...(contact.tags || []), "follow up boss"]);
      await upsertFollowUpBossPersonByEmail(context.config, {
        email: contact.email,
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        tags,
        isActive: !!contact.isActive,
        archived: !!contact.archivedAt,
      });
    } catch (error) {
      console.warn("Follow Up Boss contact push warning:", error);
    }
  };

  app.get("/api/clients/:id/crm/follow-up-boss/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const connection = await storage.getClientCrmConnection(client.id, "follow_up_boss");
      if (!connection) {
        return res.json({
          provider: "follow_up_boss",
          connected: false,
          accountLabel: null,
          lastSyncedAt: null,
          lastSyncStatus: "idle",
          lastSyncMessage: null,
          autoSyncEnabled: false,
          autoSyncIntervalMinutes: 60,
          appUrl: "https://app.followupboss.com",
        });
      }

      const metadata = (connection.metadata || {}) as Record<string, unknown>;
      const autoSyncEnabled = !!metadata.autoSyncEnabled;
      const autoSyncIntervalMinutesRaw = Number(metadata.autoSyncIntervalMinutes ?? 60);
      const autoSyncIntervalMinutes = Number.isFinite(autoSyncIntervalMinutesRaw)
        ? Math.max(5, Math.min(Math.floor(autoSyncIntervalMinutesRaw), 1440))
        : 60;

      res.json({
        provider: "follow_up_boss",
        connected: connection.status === "connected",
        accountLabel: connection.accountLabel || null,
        lastSyncedAt: connection.lastSyncedAt || null,
        lastSyncStatus: connection.lastSyncStatus,
        lastSyncMessage: connection.lastSyncMessage || null,
        autoSyncEnabled,
        autoSyncIntervalMinutes,
        appUrl: "https://app.followupboss.com",
      });
    } catch (error) {
      console.error("Follow Up Boss status error:", error);
      res.status(500).json({ error: "Failed to fetch Follow Up Boss status" });
    }
  });

  app.post("/api/clients/:id/crm/follow-up-boss/connect", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const apiKey = String(req.body?.apiKey || "").trim();
      if (!apiKey) {
        return res.status(400).json({ error: "apiKey is required" });
      }

      const system = String(req.body?.system || "Flow").trim();
      const systemKey = String(req.body?.systemKey || process.env.FOLLOW_UP_BOSS_SYSTEM_KEY || "").trim();
      const profile = await verifyFollowUpBossApiKey({
        apiKey,
        system,
        systemKey: systemKey || undefined,
      });

      const profileName = `${String(profile.firstName || "").trim()} ${String(profile.lastName || "").trim()}`.trim();
      const accountLabel = String(req.body?.accountLabel || "").trim() || profileName || profile.email || client.name;

      const metadata: Record<string, unknown> = {
        profileId: profile.id ?? null,
        profileEmail: profile.email || null,
        system,
        systemKey: systemKey || null,
        autoSyncEnabled: req.body?.autoSyncEnabled === undefined ? false : !!req.body.autoSyncEnabled,
        autoSyncIntervalMinutes: 60,
      };

      const connection = await storage.upsertClientCrmConnection({
        clientId: client.id,
        provider: "follow_up_boss",
        status: "connected",
        accessToken: apiKey,
        accountLabel,
        metadata,
        lastSyncStatus: "idle",
        lastSyncMessage: null,
        lastSyncedAt: null,
      });

      res.json({
        provider: "follow_up_boss",
        connected: true,
        accountLabel: connection.accountLabel || accountLabel,
        lastSyncedAt: connection.lastSyncedAt || null,
        lastSyncStatus: connection.lastSyncStatus,
        lastSyncMessage: connection.lastSyncMessage || null,
        autoSyncEnabled: !!metadata.autoSyncEnabled,
      });
    } catch (error) {
      console.error("Follow Up Boss connect error:", error);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to connect Follow Up Boss",
      });
    }
  });

  app.patch("/api/clients/:id/crm/follow-up-boss/settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const connection = await storage.getClientCrmConnection(client.id, "follow_up_boss");
      if (!connection || connection.status !== "connected") {
        return res.status(409).json({ error: "Follow Up Boss is not connected for this client." });
      }

      const metadata = { ...((connection.metadata || {}) as Record<string, unknown>) };
      if (req.body?.autoSyncEnabled !== undefined) {
        metadata.autoSyncEnabled = !!req.body.autoSyncEnabled;
      }
      if (req.body?.autoSyncIntervalMinutes !== undefined) {
        const raw = Number(req.body.autoSyncIntervalMinutes);
        metadata.autoSyncIntervalMinutes = Number.isFinite(raw)
          ? Math.max(5, Math.min(Math.floor(raw), 1440))
          : 60;
      }

      const updated = await storage.updateClientCrmConnection(client.id, "follow_up_boss", {
        metadata,
      });

      res.json({
        provider: "follow_up_boss",
        connected: !!updated && updated.status === "connected",
        autoSyncEnabled: !!metadata.autoSyncEnabled,
        autoSyncIntervalMinutes: Number(metadata.autoSyncIntervalMinutes || 60),
      });
    } catch (error) {
      console.error("Follow Up Boss settings error:", error);
      res.status(500).json({ error: "Failed to update Follow Up Boss settings" });
    }
  });

  app.post("/api/clients/:id/crm/follow-up-boss/sync-contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const connection = await storage.getClientCrmConnection(client.id, "follow_up_boss");
      if (!connection || connection.status !== "connected") {
        return res.status(409).json({ error: "Follow Up Boss is not connected for this client." });
      }

      const maxPeopleRaw = Number(req.body?.maxPeople ?? req.query?.maxPeople ?? 3000);
      const maxPeople = Number.isFinite(maxPeopleRaw)
        ? Math.max(50, Math.min(Math.floor(maxPeopleRaw), 10000))
        : 3000;
      const fullResync = req.body?.fullResync === true;
      const updatedSince =
        !fullResync && typeof req.body?.updatedSince === "string" && req.body.updatedSince.trim().length > 0
          ? req.body.updatedSince.trim()
          : !fullResync
            ? connection.lastSyncedAt || null
            : null;
      const userId = (req as Request & { userId: string }).userId;
      const summary = await runFollowUpBossSyncLocked({
        clientId: client.id,
        userId,
        maxPeople,
        reason: "manual",
        updatedSince,
      });

      res.json({
        provider: "follow_up_boss",
        synced: true,
        fullResync,
        updatedSince,
        summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync Follow Up Boss contacts";
      console.error("Follow Up Boss sync error:", error);
      await storage.updateClientCrmConnection(req.params.id, "follow_up_boss", {
        lastSyncStatus: "error",
        lastSyncMessage: message,
      });
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/webhooks/follow-up-boss/:clientId/events", async (req: Request, res: Response) => {
    try {
      const expectedSecret = String(process.env.FOLLOW_UP_BOSS_WEBHOOK_SECRET || "").trim();
      const providedSecret = String(
        req.headers["x-flow-webhook-secret"] || req.query.secret || req.query.token || ""
      ).trim();
      if (expectedSecret && providedSecret !== expectedSecret) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const clientId = String(req.params.clientId || "").trim();
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const connection = await storage.getClientCrmConnection(client.id, "follow_up_boss");
      if (!connection || connection.status !== "connected") {
        return res.json({ ok: true, ignored: true, reason: "not_connected" });
      }

      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
      const eventType = String(
        body.event || body.type || body.action || body.Event || body.Type || "unknown"
      )
        .trim()
        .toLowerCase();
      const externalEventIdRaw =
        body.eventId ||
        body.id ||
        body.EventId ||
        body.webhookEventId ||
        req.headers["x-fub-event-id"] ||
        createHash("sha256").update(JSON.stringify(body)).digest("hex");
      const externalEventId = String(externalEventIdRaw || "").trim();
      const dedupeResult = await recordCrmSyncEventIfNew({
        clientId: client.id,
        provider: "follow_up_boss",
        externalEventId,
        eventType,
        payload: body,
      });
      if (dedupeResult.duplicate) {
        return res.json({ ok: true, duplicate: true });
      }

      const peopleRaw =
        (Array.isArray(body.people) && body.people) ||
        (Array.isArray(body.People) && body.People) ||
        (body.person ? [body.person] : body.Person ? [body.Person] : []);
      const people = Array.isArray(peopleRaw) ? peopleRaw : [];
      const isDeleteEvent = /delete|removed|archiv|trash/.test(eventType);
      let processedCount = 0;

      for (const personRaw of people) {
        if (!personRaw || typeof personRaw !== "object") continue;
        const person = personRaw as Record<string, unknown>;
        const emailsRaw =
          (Array.isArray(person.emails) && person.emails) ||
          (Array.isArray(person.Emails) && person.Emails) ||
          [];
        const email = emailsRaw
          .map((entry) => {
            if (typeof entry === "string") return entry;
            if (!entry || typeof entry !== "object") return "";
            const value =
              (entry as any).value ||
              (entry as any).email ||
              (entry as any).address ||
              (entry as any).Email ||
              (entry as any).Address;
            return typeof value === "string" ? value : "";
          })
          .map((value) => value.trim().toLowerCase())
          .find((value) => value.includes("@"));
        if (!email) continue;

        const firstName = String(person.firstName || person.FirstName || "").trim() || null;
        const lastName = String(person.lastName || person.LastName || "").trim() || null;
        const personTags = normalizeTagList(person.tags || person.Tags, ["all"]);
        const statusArchived =
          isDeleteEvent ||
          person.archived === true ||
          person.deleted === true ||
          person.isActive === false ||
          person.IsActive === false;

        const existing = await storage.getContactByEmail(client.id, email);
        const mergedTags = normalizeTagList(
          [
            ...(existing?.tags || []),
            ...personTags,
            "follow up boss",
            statusArchived ? "suppressed" : "all",
          ],
          ["all"]
        );

        await storage.upsertContactByEmail(client.id, email, {
          firstName: firstName || existing?.firstName || null,
          lastName: lastName || existing?.lastName || null,
          tags: mergedTags,
          isActive: !statusArchived,
        });
        processedCount += 1;
      }

      await storage.updateClientCrmConnection(client.id, "follow_up_boss", {
        lastSyncedAt: new Date(),
        lastSyncStatus: "success",
        lastSyncMessage: `Webhook ${eventType}: ${processedCount} contact(s) processed.`,
      });
      if (processedCount > 0) {
        await recordDiyFunnelEvent({
          clientId: client.id,
          userId: null,
          eventType: "contacts_imported",
          payload: {
            source: "follow_up_boss_webhook",
            processedCount,
            eventType,
          },
          dedupeKey: `contacts_imported:webhook:${externalEventId}`,
        });
      }

      return res.json({
        ok: true,
        eventType,
        processedCount,
      });
    } catch (error) {
      console.error("Follow Up Boss webhook error:", error);
      return res.status(500).json({ error: "Failed to process Follow Up Boss webhook event" });
    }
  });

  const followUpBossAutoSyncCronHandler = async (req: Request, res: Response) => {
    try {
      const expected = String(process.env.CRON_SECRET || "").trim();
      const authorization = String(req.headers["authorization"] || "").trim();
      if (!expected && process.env.NODE_ENV === "production") {
        return res.status(500).json({ error: "CRON_SECRET is not configured." });
      }
      if (expected && authorization !== `Bearer ${expected}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { db } = await import("./db");
      const { clientCrmConnections } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");
      const connections = await db
        .select()
        .from(clientCrmConnections)
        .where(
          and(
            eq((clientCrmConnections as any).provider, "follow_up_boss"),
            eq((clientCrmConnections as any).status, "connected")
          )
        );

      let checked = 0;
      let synced = 0;
      let skipped = 0;
      let failed = 0;
      const results: Array<Record<string, unknown>> = [];
      const now = Date.now();

      for (const connection of connections as any[]) {
        checked += 1;
        const metadata = (connection.metadata || {}) as Record<string, unknown>;
        const autoSyncEnabled = !!metadata.autoSyncEnabled;
        const intervalRaw = Number(metadata.autoSyncIntervalMinutes ?? 60);
        const intervalMinutes = Number.isFinite(intervalRaw)
          ? Math.max(5, Math.min(Math.floor(intervalRaw), 1440))
          : 60;
        if (!autoSyncEnabled) {
          skipped += 1;
          results.push({ clientId: connection.clientId, status: "skipped", reason: "disabled" });
          continue;
        }

        const lastSyncedAt = connection.lastSyncedAt ? new Date(connection.lastSyncedAt) : null;
        const nextDueAt =
          lastSyncedAt && !Number.isNaN(lastSyncedAt.getTime())
            ? new Date(lastSyncedAt.getTime() + intervalMinutes * 60 * 1000)
            : null;
        if (nextDueAt && nextDueAt.getTime() > now) {
          skipped += 1;
          results.push({
            clientId: connection.clientId,
            status: "skipped",
            reason: "not_due",
            nextDueAt: nextDueAt.toISOString(),
          });
          continue;
        }

        const maxPeopleRaw = Number(metadata.autoSyncMaxPeople ?? 3000);
        const maxPeople = Number.isFinite(maxPeopleRaw)
          ? Math.max(50, Math.min(Math.floor(maxPeopleRaw), 10000))
          : 3000;
        try {
          const summary = await runFollowUpBossSyncLocked({
            clientId: connection.clientId,
            userId: "system:auto",
            maxPeople,
            reason: "auto",
            updatedSince: connection.lastSyncedAt || null,
          });
          synced += 1;
          results.push({ clientId: connection.clientId, status: "synced", summary });
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : "Sync failed";
          results.push({ clientId: connection.clientId, status: "failed", error: message });
          await storage.updateClientCrmConnection(connection.clientId, "follow_up_boss", {
            lastSyncStatus: "error",
            lastSyncMessage: message,
          });
        }
      }

      return res.json({
        ok: true,
        checked,
        synced,
        skipped,
        failed,
        results,
      });
    } catch (error) {
      console.error("Follow Up Boss auto-sync cron error:", error);
      const detail = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "Failed to process Follow Up Boss auto-sync", detail });
    }
  };

  app.get("/api/internal/cron/follow-up-boss-auto-sync", followUpBossAutoSyncCronHandler);
  app.post("/api/internal/cron/follow-up-boss-auto-sync", followUpBossAutoSyncCronHandler);

  app.delete("/api/clients/:id/crm/follow-up-boss/connect", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;
      await storage.deleteClientCrmConnection(client.id, "follow_up_boss");
      res.status(204).send();
    } catch (error) {
      console.error("Follow Up Boss disconnect error:", error);
      res.status(500).json({ error: "Failed to disconnect Follow Up Boss" });
    }
  });

  app.post("/api/clients/:id/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const result = await storage.upsertContactByEmail(client.id, email, {
        firstName: req.body?.firstName ? String(req.body.firstName).trim() : null,
        lastName: req.body?.lastName ? String(req.body.lastName).trim() : null,
        tags: normalizeTagList(req.body?.tags),
        isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : true,
      });

      void syncFlowContactToFollowUpBoss(result.contact.id);
      res.status(result.created ? 201 : 200).json(result.contact);
    } catch (error) {
      console.error("Create contact error:", error);
      res.status(500).json({ error: "Failed to create contact" });
    }
  });

  app.patch("/api/contacts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContact(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Contact not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "audience.manage"))) return;

      const emailRaw = req.body?.email;
      const nextEmail =
        typeof emailRaw === "string" && emailRaw.trim().length > 0
          ? emailRaw.trim().toLowerCase()
          : undefined;

      const updated = await storage.updateContact(req.params.id, {
        ...(nextEmail ? { email: nextEmail } : {}),
        ...(req.body?.firstName !== undefined ? { firstName: req.body.firstName ? String(req.body.firstName).trim() : null } : {}),
        ...(req.body?.lastName !== undefined ? { lastName: req.body.lastName ? String(req.body.lastName).trim() : null } : {}),
        ...(req.body?.tags !== undefined ? { tags: normalizeTagList(req.body.tags) } : {}),
        ...(typeof req.body?.isActive === "boolean" ? { isActive: req.body.isActive } : {}),
      });

      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      void syncFlowContactToFollowUpBoss(updated.id);
      res.json(updated);
    } catch (error) {
      console.error("Update contact error:", error);
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  app.patch("/api/contacts/:id/archive", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContact(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Contact not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "audience.manage"))) return;

      const userId = (req as Request & { userId: string }).userId;
      const updated = await storage.updateContact(req.params.id, {
        archivedAt: new Date(),
        archivedById: userId,
      } as any);
      if (updated?.id) {
        void syncFlowContactToFollowUpBoss(updated.id);
      }
      res.json(updated);
    } catch (error) {
      console.error("Archive contact error:", error);
      res.status(500).json({ error: "Failed to archive contact" });
    }
  });

  app.patch("/api/contacts/:id/restore", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContact(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Contact not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "audience.manage"))) return;

      const updated = await storage.updateContact(req.params.id, {
        archivedAt: null,
        archivedById: null,
      } as any);
      if (updated?.id) {
        void syncFlowContactToFollowUpBoss(updated.id);
      }
      res.json(updated);
    } catch (error) {
      console.error("Restore contact error:", error);
      res.status(500).json({ error: "Failed to restore contact" });
    }
  });

  app.delete("/api/contacts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContact(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Contact not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "audience.manage"))) return;
      if (!existing.archivedAt) {
        return res.status(409).json({ error: "Archive contact before permanent deletion." });
      }
      void syncFlowContactToFollowUpBoss(existing.id);
      await storage.deleteContact(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete contact error:", error);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.post("/api/clients/:id/contacts/bulk-action", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const action = String(req.body?.action || "").trim().toLowerCase();
      const userId = (req as Request & { userId: string }).userId;
      const contactIds: string[] = Array.isArray(req.body?.contactIds)
        ? Array.from(
            new Set(
              (req.body.contactIds as unknown[])
                .map((value: unknown) => String(value || "").trim())
                .filter((value): value is string => value.length > 0)
            )
          )
        : [];

      if (contactIds.length === 0) {
        return res.status(400).json({ error: "contactIds are required" });
      }

      const [mainContacts, archivedContacts] = await Promise.all([
        storage.getContactsByClient(client.id, "all"),
        storage.getContactsByClient(client.id, "archived"),
      ]);
      const clientContacts = [...mainContacts, ...archivedContacts];
      const validContactSet = new Set(clientContacts.map((contact) => contact.id));
      const scopedIds = contactIds.filter((id) => validContactSet.has(id));

      if (scopedIds.length === 0) {
        return res.status(400).json({ error: "No contacts match this client" });
      }

      if (action === "activate" || action === "deactivate") {
        const isActive = action === "activate";
        await Promise.all(
          scopedIds.map((id) =>
            storage.updateContact(id, {
              isActive,
              archivedAt: null,
              archivedById: null,
            } as any)
          )
        );
        void Promise.all(scopedIds.map((id) => syncFlowContactToFollowUpBoss(id))).catch((error) => {
          console.warn("Follow Up Boss bulk push warning:", error);
        });
        return res.json({
          action,
          contactCount: scopedIds.length,
          skippedCount: contactIds.length - scopedIds.length,
        });
      }

      if (action === "archive") {
        await Promise.all(
          scopedIds.map((id) =>
            storage.updateContact(id, {
              archivedAt: new Date(),
              archivedById: userId,
            } as any)
          )
        );
        void Promise.all(scopedIds.map((id) => syncFlowContactToFollowUpBoss(id))).catch((error) => {
          console.warn("Follow Up Boss bulk push warning:", error);
        });
        return res.json({
          action,
          contactCount: scopedIds.length,
          skippedCount: contactIds.length - scopedIds.length,
        });
      }

      if (action === "restore") {
        await Promise.all(
          scopedIds.map((id) =>
            storage.updateContact(id, {
              archivedAt: null,
              archivedById: null,
            } as any)
          )
        );
        void Promise.all(scopedIds.map((id) => syncFlowContactToFollowUpBoss(id))).catch((error) => {
          console.warn("Follow Up Boss bulk push warning:", error);
        });
        return res.json({
          action,
          contactCount: scopedIds.length,
          skippedCount: contactIds.length - scopedIds.length,
        });
      }

      if (action === "delete") {
        const existingById = new Map(clientContacts.map((contact) => [contact.id, contact]));
        const archivedIds = scopedIds.filter((id) => !!existingById.get(id)?.archivedAt);
        if (archivedIds.length === 0) {
          return res.status(409).json({ error: "Only archived contacts can be permanently deleted." });
        }
        void Promise.all(archivedIds.map((id) => syncFlowContactToFollowUpBoss(id))).catch((error) => {
          console.warn("Follow Up Boss bulk push warning:", error);
        });
        await Promise.all(archivedIds.map((id) => storage.deleteContact(id)));
        return res.json({
          action,
          contactCount: archivedIds.length,
          skippedCount: contactIds.length - scopedIds.length,
        });
      }

      return res.status(400).json({ error: "Unsupported bulk action" });
    } catch (error) {
      console.error("Bulk contact action error:", error);
      res.status(500).json({ error: "Failed to process bulk contact action" });
    }
  });

  app.get("/api/clients/:id/segments", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const [segments, contacts] = await Promise.all([
        storage.getContactSegmentsByClient(client.id),
        storage.getContactsByClient(client.id),
      ]);

      const allTagSet = new Set<string>(["all"]);
      for (const contact of contacts) {
        for (const tag of contact.tags || []) {
          if (tag) allTagSet.add(tag.toLowerCase());
        }
      }

      const existingSegmentNames = new Set(segments.map((segment) => segment.name.toLowerCase()));
      const derivedSegments = Array.from(allTagSet)
        .filter((tag) => !existingSegmentNames.has(tag))
        .map((tag) => ({
          id: `derived-${tag}`,
          clientId: client.id,
          name: tag,
          tags: [tag],
          isDefault: tag === "all",
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

      res.json([
        ...segments,
        ...derivedSegments,
      ]);
    } catch (error) {
      console.error("Get segments error:", error);
      res.status(500).json({ error: "Failed to fetch segments" });
    }
  });

  app.post("/api/clients/:id/segments", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const name = String(req.body?.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Segment name is required" });
      }
      const tags = normalizeTagList(req.body?.tags, [name.toLowerCase()]);

      const segment = await storage.createContactSegment({
        clientId: client.id,
        name,
        tags,
        isDefault: !!req.body?.isDefault,
      });
      res.status(201).json(segment);
    } catch (error) {
      console.error("Create segment error:", error);
      res.status(500).json({ error: "Failed to create segment" });
    }
  });

  app.patch("/api/segments/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContactSegment(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Segment not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "audience.manage"))) return;

      const updateData: Record<string, unknown> = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) {
          return res.status(400).json({ error: "Segment name cannot be empty" });
        }
        updateData.name = name;
      }
      if (req.body?.tags !== undefined) {
        updateData.tags = normalizeTagList(req.body.tags);
      }
      if (req.body?.isDefault !== undefined) {
        updateData.isDefault = !!req.body.isDefault;
      }

      const updated = await storage.updateContactSegment(req.params.id, updateData as any);
      if (!updated) {
        return res.status(404).json({ error: "Segment not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update segment error:", error);
      res.status(500).json({ error: "Failed to update segment" });
    }
  });

  app.delete("/api/segments/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getContactSegment(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Segment not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "audience.manage"))) return;
      await storage.deleteContactSegment(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete segment error:", error);
      res.status(500).json({ error: "Failed to delete segment" });
    }
  });

  app.post("/api/clients/:id/segments/merge", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const sourceSegmentId = String(req.body?.sourceSegmentId || "").trim();
      const targetSegmentId = String(req.body?.targetSegmentId || "").trim();
      if (!sourceSegmentId || !targetSegmentId) {
        return res.status(400).json({ error: "sourceSegmentId and targetSegmentId are required" });
      }
      if (sourceSegmentId === targetSegmentId) {
        return res.status(400).json({ error: "Source and target segments must be different" });
      }

      const segments = await storage.getContactSegmentsByClient(client.id);
      const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
      const source = segmentById.get(sourceSegmentId);
      const target = segmentById.get(targetSegmentId);

      if (!source || !target) {
        return res.status(404).json({ error: "Segment not found for this client" });
      }

      const sourceName = source.name.trim().toLowerCase();
      const targetName = target.name.trim().toLowerCase();
      if (sourceName === "all" || targetName === "all") {
        return res.status(400).json({ error: "Segment 'all' cannot be merged" });
      }

      const sourceTagSet = new Set<string>([
        sourceName,
        ...(source.tags || []).map((tag) => String(tag || "").trim().toLowerCase()),
      ]);

      const contacts = await storage.getContactsByClient(client.id);
      let updatedContacts = 0;
      for (const contact of contacts) {
        const existingTags = (contact.tags || []).map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean);
        if (!existingTags.some((tag) => sourceTagSet.has(tag))) {
          continue;
        }

        const nextTags = Array.from(
          new Set(existingTags.map((tag) => (sourceTagSet.has(tag) ? targetName : tag)).filter(Boolean))
        );
        await storage.updateContact(contact.id, {
          tags: nextTags.length ? nextTags : ["all"],
        });
        updatedContacts += 1;
      }

      const targetTags = Array.from(
        new Set(
          [targetName, ...(target.tags || []).map((tag) => String(tag || "").trim().toLowerCase())].filter(Boolean)
        )
      );
      const mergedSegment = await storage.updateContactSegment(target.id, {
        tags: targetTags.length ? targetTags : [targetName],
      });

      await storage.deleteContactSegment(source.id);

      res.json({
        mergedInto: mergedSegment || target,
        removedSegmentId: source.id,
        updatedContacts,
      });
    } catch (error) {
      console.error("Merge segment error:", error);
      res.status(500).json({ error: "Failed to merge segments" });
    }
  });

  app.post("/api/clients/:id/contacts/import-csv", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "audience.manage"))) return;

      const csvContent = typeof req.body.csvContent === "string" ? req.body.csvContent : "";
      if (!csvContent.trim()) {
        return res.status(400).json({ error: "csvContent is required" });
      }

      const userId = (req as Request & { userId: string }).userId;
      const requestedMapping = req.body.mapping && typeof req.body.mapping === "object" ? req.body.mapping : {};
      const importSource = normalizeContactImportSource(req.body?.importSource, "internal_app");
      const result = await importContactsFromCsv(client.id, csvContent, requestedMapping, {
        createSegmentsFromTags: !!req.body?.createSegmentsFromTags,
        segmentTags: req.body?.segmentTags,
        importedByUserId: userId,
        importedBySource: importSource,
      });
      if ((result.summary.importedCount || 0) + (result.summary.updatedCount || 0) > 0) {
        await recordDiyFunnelEvent({
          clientId: client.id,
          userId,
          eventType: "contacts_imported",
          payload: {
            source: importSource,
            importedCount: result.summary.importedCount || 0,
            updatedCount: result.summary.updatedCount || 0,
            skippedCount: result.summary.skippedCount || 0,
          },
          dedupeKey: `contacts_imported:${client.id}:${result.job?.id || Date.now()}`,
        });
      }
      res.json(result);
    } catch (error) {
      console.error("Import CSV error:", error);
      const errorWithMeta = error as Error & { meta?: { suggestedMapping?: unknown; headers?: string[] } };
      if (errorWithMeta.message === "Email column is required") {
        return res.status(400).json({
          error: errorWithMeta.message,
          suggestedMapping: errorWithMeta.meta?.suggestedMapping,
          headers: errorWithMeta.meta?.headers || [],
        });
      }
      res.status(500).json({ error: "Failed to import CSV" });
    }
  });

  app.post("/api/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const payload = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

      const normalizedFrequency = (() => {
        const raw = String(payload.newsletterFrequency || "").trim().toLowerCase();
        if (raw === "weekly") return "weekly";
        if (raw === "biweekly" || raw === "bi-weekly") return "biweekly";
        return "monthly";
      })();

      const normalizedStatus = (() => {
        const raw = String(payload.subscriptionStatus || payload.status || "").trim().toLowerCase();
        if (raw === "active" || raw === "paused" || raw === "past_due" || raw === "canceled") return raw;
        if (raw === "inactive" || raw === "churned") return "canceled";
        return "canceled";
      })();

      const insertPayload = {
        name: String(payload.name || payload.contactName || "").trim(),
        primaryEmail: String(payload.primaryEmail || payload.email || "").trim(),
        secondaryEmail: payload.secondaryEmail ? String(payload.secondaryEmail).trim() : undefined,
        phone: payload.phone ? String(payload.phone).trim() : undefined,
        locationCity: payload.locationCity ? String(payload.locationCity).trim() : undefined,
        locationRegion: payload.locationRegion ? String(payload.locationRegion).trim() : undefined,
        newsletterFrequency: normalizedFrequency,
        subscriptionStatus: normalizedStatus,
        isVerified: false,
        assignedToId: payload.assignedToId ? String(payload.assignedToId).trim() : undefined,
      };

      const parsed = insertClientSchema.safeParse(insertPayload);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid client payload" });
      }
      if (isLikelyPublicMailboxDomain(parsed.data.primaryEmail)) {
        return res.status(400).json({
          error: PROFESSIONAL_SENDER_EMAIL_ERROR,
          requiresCustomSenderDomain: true,
        });
      }

      const client = await storage.createClient(parsed.data);
      await storage.upsertBrandingKit({ clientId: client.id });

      if (client.primaryEmail) {
        await tryAutoProvisionPostmarkInfrastructure(client.id, req);
      }
      
      await storage.recalculateClientSubscriptionStatus(client.id);
      const refreshed = await storage.getClient(client.id);
      res.status(201).json(refreshed || client);
    } catch (error) {
      console.error("Create client error:", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const previousClient = await storage.getClient(req.params.id);
      if (!previousClient) {
        return res.status(404).json({ error: "Client not found" });
      }
      const incomingPrimaryEmail =
        typeof req.body?.primaryEmail === "string" ? req.body.primaryEmail.trim().toLowerCase() : "";
      const previousPrimaryEmailNormalized = String(previousClient.primaryEmail || "").trim().toLowerCase();
      if (
        incomingPrimaryEmail &&
        incomingPrimaryEmail !== previousPrimaryEmailNormalized &&
        isLikelyPublicMailboxDomain(incomingPrimaryEmail)
      ) {
        return res.status(400).json({
          error: PROFESSIONAL_SENDER_EMAIL_ERROR,
          requiresCustomSenderDomain: true,
        });
      }

      const requestedStatus =
        typeof req.body?.subscriptionStatus === "string" ? req.body.subscriptionStatus.trim().toLowerCase() : "";
      if (requestedStatus === "active") {
        const subscriptions = await storage.getSubscriptionsByClient(req.params.id);
        const hasActive = subscriptions.some((sub) => sub.status === "active");
        if (!hasActive) {
          return res.status(409).json({
            error: "Client cannot be marked active without at least one active subscription.",
          });
        }
      }
      const client = await storage.updateClient(req.params.id, req.body);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const previousPrimaryEmail = String(previousClient.primaryEmail || "").trim().toLowerCase();
      const nextPrimaryEmail = String(client.primaryEmail || "").trim().toLowerCase();
      if (nextPrimaryEmail && nextPrimaryEmail !== previousPrimaryEmail) {
        await upsertClientPostmarkTenant(client.id, {
          senderSignatureId: null,
          senderEmail: client.primaryEmail,
          senderConfirmed: false,
        });
        await syncClientPostmarkSnapshot(client.id, {
          signatureId: null,
          senderVerificationState: "pending",
          isVerified: false,
        });

        const newsletters = await storage.getNewslettersByClient(client.id);
        for (const newsletter of newsletters) {
          if (newsletter.status !== "sent") {
            await storage.updateNewsletter(newsletter.id, { fromEmail: client.primaryEmail });
          }
        }

        await tryAutoProvisionPostmarkInfrastructure(client.id, req);
      }
      res.json(client);
    } catch (error) {
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  // ============================================================================
  // CLIENT NOTES
  // ============================================================================
  app.get("/api/clients/:clientId/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const notes = await storage.getClientNotes(req.params.clientId);
      res.json(notes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clients/:clientId/notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const note = await storage.createClientNote({
        clientId: req.params.clientId,
        type: req.body.type || "note",
        content: req.body.content,
        priority: req.body.priority || "medium",
        sourceEmailId: req.body.sourceEmailId || null,
        createdById: (req.session as any).userId,
      });
      res.json(note);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/notes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const note = await storage.updateClientNote(req.params.id, req.body);
      res.json(note);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/notes/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.deleteClientNote(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // BRANDING KITS
  // ============================================================================
  app.get("/api/branding-kits", requireAuth, async (req: Request, res: Response) => {
    try {
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      const kits = scopedClientId
        ? (await storage.getAllBrandingKits()).filter((kit) => kit.clientId === scopedClientId)
        : await storage.getAllBrandingKits();
      const enriched = await Promise.all(
        kits.map(async (kit) => {
          const client = await storage.getClient(kit.clientId);
          return { ...kit, client: client || { id: kit.clientId, name: "Unknown" } };
        })
      );
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch branding kits" });
    }
  });

  app.get("/api/clients/:clientId/branding-kit", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "branding.manage"))) return;
      const kit = await storage.getBrandingKit(req.params.clientId);
      res.json(kit || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch branding kit" });
    }
  });

  app.put("/api/clients/:clientId/branding-kit", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "branding.manage"))) return;
      const kit = await storage.upsertBrandingKit({
        clientId: req.params.clientId,
        ...req.body,
      });
      res.json(kit);
    } catch (error) {
      console.error("Update branding kit error:", error);
      res.status(500).json({ error: "Failed to update branding kit" });
    }
  });

  app.post("/api/branding-kits", requireAuth, async (req: Request, res: Response) => {
    try {
      const { clientId, ...rest } = req.body;
      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }
      if (!ensureClientAccess(req, res, String(clientId))) return;
      const kit = await storage.createBrandingKit({ clientId, ...rest });
      res.status(201).json(kit);
    } catch (error) {
      console.error("Create branding kit error:", error);
      res.status(500).json({ error: "Failed to create branding kit" });
    }
  });

  app.patch("/api/branding-kits/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const kit = await storage.updateBrandingKit(req.params.id, req.body);
      if (!kit) {
        return res.status(404).json({ error: "Branding kit not found" });
      }
      res.json(kit);
    } catch (error) {
      console.error("Update branding kit error:", error);
      res.status(500).json({ error: "Failed to update branding kit" });
    }
  });

  app.delete("/api/branding-kits/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.deleteBrandingKit(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete branding kit error:", error);
      res.status(500).json({ error: "Failed to delete branding kit" });
    }
  });

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================
  app.get("/api/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      const allSubscriptions = scopedClientId
        ? await storage.getSubscriptionsByClient(scopedClientId)
        : await storage.getAllSubscriptions();
      const enriched = await Promise.all(
        allSubscriptions.map(async (sub) => {
          const client = await storage.getClient(sub.clientId);
          return { ...sub, client: client || { id: sub.clientId, name: "Unknown" } };
        })
      );
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  });

  app.get("/api/clients/:clientId/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "subscriptions.configure"))) return;
      const subscriptions = await storage.getSubscriptionsByClient(req.params.clientId);
      res.json(subscriptions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  });

  app.post("/api/clients/:clientId/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const clientId = req.params.clientId;
      if (!(await ensureWorkspaceCapability(req, res, clientId, "subscriptions.configure"))) return;
      
      const subscription = await storage.createSubscription({
        clientId,
        ...req.body,
      });

      if (subscription.status === "active") {
        await ensureSubscriptionHasInvoice(subscription.id);
      }

      if (subscription.status === "active" && subscription.frequency) {
        const client = await storage.getClient(clientId);
        if (client) {
          const latestNewsletter = await storage.getLatestClientNewsletter(clientId);
          const lastSendDate = latestNewsletter?.expectedSendDate 
            ? new Date(latestNewsletter.expectedSendDate) 
            : null;
          
          const count = getNewsletterCountByFrequency(subscription.frequency);
          const sendDates = getNextSendDates(subscription.frequency, lastSendDate, count);
          
          const newsletters = [];
          for (const sendDate of sendDates) {
            const title = buildNewsletterTitle(client.name);
            const invoice = await storage.createInvoice({
              clientId,
              subscriptionId: subscription.id,
              amount: subscription.amount,
              currency: subscription.currency || "USD",
              status: "paid",
              paidAt: new Date(),
              stripePaymentId: null,
            });
            
            const themedDocument = await applyBrandingToDocument(clientId, cloneDefaultNewsletterDocument());

            const newsletter = await storage.createNewsletter({
              clientId,
              invoiceId: invoice.id,
              subscriptionId: subscription.id,
              title,
              expectedSendDate: format(sendDate, "yyyy-MM-dd"),
              status: "draft",
              documentJson: themedDocument,
              createdById: userId,
              fromEmail: client.primaryEmail,
            });
            
            const version = await storage.createVersion({
              newsletterId: newsletter.id,
              versionNumber: 1,
              snapshotJson: themedDocument,
              createdById: userId,
              changeSummary: "Initial version",
            });
            
            await storage.updateNewsletter(newsletter.id, { currentVersionId: version.id });
            newsletters.push({ ...newsletter, currentVersionId: version.id });
          }
          
          await storage.recalculateClientSubscriptionStatus(clientId);
          res.status(201).json({ subscription, newsletters });
          return;
        }
      }
      
      await storage.recalculateClientSubscriptionStatus(clientId);
      res.status(201).json({ subscription, newsletters: [] });
    } catch (error) {
      console.error("Create subscription error:", error);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  app.post("/api/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const { clientId, ...rest } = req.body;
      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }
      if (!ensureClientAccess(req, res, String(clientId))) return;
      const subscription = await storage.createSubscription({ clientId, ...rest });
      if (subscription.status === "active") {
        await ensureSubscriptionHasInvoice(subscription.id);
      }
      await storage.recalculateClientSubscriptionStatus(clientId);
      const refreshed = await storage.getSubscription(subscription.id);
      res.status(201).json(refreshed || subscription);
    } catch (error) {
      console.error("Create subscription error:", error);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  app.patch("/api/subscriptions/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getSubscription(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Subscription not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "subscriptions.configure"))) return;
      const subscription = await storage.updateSubscription(req.params.id, req.body);
      if (subscription?.status === "active") {
        await ensureSubscriptionHasInvoice(subscription.id);
      }
      await storage.recalculateClientSubscriptionStatus(existing.clientId);
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });

  app.delete("/api/subscriptions/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getSubscription(req.params.id);
      await storage.deleteSubscription(req.params.id);
      if (existing) {
        await storage.recalculateClientSubscriptionStatus(existing.clientId);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete subscription error:", error);
      res.status(500).json({ error: "Failed to delete subscription" });
    }
  });

  // ============================================================================
  // INVOICES
  // ============================================================================
  app.get("/api/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      const [invoices, clients, subscriptions, newsletters] = await Promise.all([
        scopedClientId ? storage.getInvoicesByClient(scopedClientId) : storage.getAllInvoices(),
        getScopedClients(req),
        scopedClientId ? storage.getSubscriptionsByClient(scopedClientId) : storage.getAllSubscriptions(),
        scopedClientId ? storage.getNewslettersByClient(scopedClientId) : storage.getAllNewsletters(),
      ]);
      const clientMap = new Map(clients.map(c => [c.id, c]));
      const subscriptionMap = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));
      const newslettersByInvoiceId = newsletters.reduce<Record<string, any[]>>((acc, newsletter) => {
        if (!newsletter.invoiceId) return acc;
        if (!acc[newsletter.invoiceId]) {
          acc[newsletter.invoiceId] = [];
        }
        acc[newsletter.invoiceId].push(newsletter);
        return acc;
      }, {});

      const enrichedInvoices = invoices.map(inv => ({
        ...inv,
        client: clientMap.get(inv.clientId),
        subscription: inv.subscriptionId ? subscriptionMap.get(inv.subscriptionId) || null : null,
        newsletters: newslettersByInvoiceId[inv.id] || [],
      }));

      res.json(enrichedInvoices);
    } catch (error) {
      console.error("Get all invoices error:", error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.get("/api/clients/:clientId/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "orders.configure"))) return;
      const invoices = await storage.getInvoicesByClient(req.params.clientId);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/clients/:clientId/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const clientId = req.params.clientId;
      if (!(await ensureWorkspaceCapability(req, res, clientId, "orders.configure"))) return;
      const { amount, currency, expectedSendDate, stripePaymentId, subscriptionId } = req.body;

      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      let linkedSubscriptionId = subscriptionId || null;
      if (linkedSubscriptionId) {
        const linked = await storage.getSubscription(linkedSubscriptionId);
        if (!linked || linked.clientId !== client.id) {
          return res.status(404).json({ error: "Subscription not found for this client" });
        }
      } else {
        const subscriptions = await storage.getSubscriptionsByClient(clientId);
        const activeSubscription = subscriptions.find((s) => s.status === "active");
        if (activeSubscription) {
          linkedSubscriptionId = activeSubscription.id;
        }
      }

      if (!linkedSubscriptionId) {
        return res.status(409).json({
          error: "Invoice requires an active subscription. Create or activate a subscription first.",
        });
      }

      const invoice = await storage.createInvoice({
        clientId,
        subscriptionId: linkedSubscriptionId,
        amount,
        currency: currency || "USD",
        stripePaymentId,
        status: "paid",
        paidAt: new Date(),
      });
      const draft = await createDraftNewsletterForInvoice(invoice.id, userId, expectedSendDate);
      res.status(201).json({
        invoice,
        newsletter: draft.newsletter || null,
        newsletters: draft.newsletters || (draft.newsletter ? [draft.newsletter] : []),
        createdNewsletter: draft.created,
        createdNewsletterCount: draft.createdCount ?? (draft.created ? 1 : 0),
      });
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.patch("/api/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getInvoice(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "orders.configure"))) return;
      const invoice = await storage.updateInvoice(req.params.id, req.body);
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  // ============================================================================
  // NEWSLETTERS
  // ============================================================================
  app.get("/api/newsletters", requireAuth, async (req: Request, res: Response) => {
    try {
      const { status } = req.query;
      let newsletters;
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      
      if (status && typeof status === "string") {
        const statuses = status
          .split(",")
          .map((s) => normalizeNewsletterStatus(s))
          .filter((s): s is NewsletterStatus => !!s);
        newsletters = statuses.length > 0 ? await storage.getNewslettersByStatus(statuses) : [];
      } else {
        newsletters = await storage.getAllNewsletters();
      }
      if (scopedClientId) {
        newsletters = newsletters.filter((newsletter) => newsletter.clientId === scopedClientId);
      }

      const clients = await getScopedClients(req);
      const clientMap = new Map(clients.map(c => [c.id, c]));

      const enrichedNewsletters = newsletters.map(nl => ({
        ...nl,
        client: clientMap.get(nl.clientId),
        isPaid: !!nl.invoiceId,
      }));

      res.json(enrichedNewsletters);
    } catch (error) {
      console.error("Get newsletters error:", error);
      res.status(500).json({ error: "Failed to fetch newsletters" });
    }
  });

  app.get("/api/clients/:clientId/newsletters", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "newsletter.edit"))) return;
      const newsletters = await storage.getNewslettersByClient(req.params.clientId);
      res.json(newsletters);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch newsletters" });
    }
  });

  app.post("/api/clients/:clientId/newsletters", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const currentUser = (req as AuthedRequest).currentUser;
      const { expectedSendDate, importedHtml, invoiceId, subscriptionId } = req.body;
      if (!(await ensureWorkspaceCapability(req, res, req.params.clientId, "newsletter.edit"))) return;

      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const resolvedExpectedSendDate =
        typeof expectedSendDate === "string" && expectedSendDate.trim().length > 0
          ? expectedSendDate.trim()
          : format(addDays(new Date(), 7), "yyyy-MM-dd");

      const subscription = await findPreferredSubscription(client.id, subscriptionId || null);
      const invoice = await resolveOrCreateNewsletterInvoice(client.id, subscription.id, invoiceId || null);

      const title = buildNewsletterTitle(client.name);

      let documentJson: NewsletterDocument;
      const existingNewsletters = await storage.getNewslettersByClient(client.id);
      const isFirstNewsletter = existingNewsletters.length === 0;
      const isDiyFirstNewsletter =
        currentUser.accountType === "diy_customer" &&
        currentUser.diyClientId === client.id &&
        isFirstNewsletter;

      if (isDiyFirstNewsletter && importedHtml && importedHtml.trim()) {
        documentJson = createNewsletterDocumentFromHtml(importedHtml.trim());
      } else if (isDiyFirstNewsletter) {
        documentJson = cloneDefaultNewsletterDocument();
      } else if (importedHtml && importedHtml.trim()) {
        documentJson = createNewsletterDocumentFromHtml(importedHtml.trim());
      } else {
        documentJson = await getLatestNewsletterDocumentForClient(client.id);
      }
      documentJson = await applyBrandingToDocument(client.id, documentJson);
      if (currentUser.accountType === "diy_customer" && currentUser.diyClientId === client.id) {
        documentJson = {
          ...documentJson,
          meta: {
            ...(documentJson.meta || {}),
            simpleMode: true,
            firstTemplateLocked: isDiyFirstNewsletter,
          },
        };
      }

      const newsletter = await storage.createNewsletter({
        clientId: req.params.clientId,
        invoiceId: invoice.id,
        subscriptionId: subscription.id,
        title,
        expectedSendDate: resolvedExpectedSendDate,
        status: "draft",
        documentJson,
        createdById: userId,
        fromEmail: client.primaryEmail,
      });

      const version = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: 1,
        snapshotJson: documentJson,
        createdById: userId,
        changeSummary: "Initial version",
      });

      await storage.updateNewsletter(newsletter.id, { currentVersionId: version.id });
      if (currentUser.accountType === "diy_customer" && currentUser.diyClientId === client.id) {
        const selectedTemplateId =
          typeof req.body?.templateId === "string" ? req.body.templateId.trim() : "";
        if (selectedTemplateId) {
          await recordDiyFunnelEvent({
            clientId: client.id,
            userId,
            eventType: "template_selected",
            payload: {
              templateId: selectedTemplateId,
              firstNewsletter: isDiyFirstNewsletter,
            },
            dedupeKey: `template_selected:${client.id}:${selectedTemplateId}:${isDiyFirstNewsletter ? "first" : newsletter.id}`,
          });
        } else if (isDiyFirstNewsletter) {
          await recordDiyFunnelEvent({
            clientId: client.id,
            userId,
            eventType: "template_selected",
            payload: {
              templateId: "default",
              firstNewsletter: true,
            },
            dedupeKey: `template_selected:${client.id}:default:first`,
          });
        }
        await recordDiyFunnelEvent({
          clientId: client.id,
          userId,
          eventType: "newsletter_generated",
          payload: {
            newsletterId: newsletter.id,
            firstNewsletter: isDiyFirstNewsletter,
            importedHtml: !!(importedHtml && importedHtml.trim()),
          },
          dedupeKey: `newsletter_generated:${newsletter.id}`,
        });
      }

      res.status(201).json({ ...newsletter, currentVersionId: version.id });
    } catch (error) {
      const status = (error as Error & { status?: number }).status || 500;
      if (status !== 500) {
        return res.status(status).json({ error: (error as Error).message || "Unable to create newsletter" });
      }
      console.error("Create newsletter error:", error);
      res.status(500).json({ error: "Failed to create newsletter" });
    }
  });

  app.get("/api/newsletters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const data = await storage.getNewsletterWithClient(req.params.id);
      if (!data) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const { newsletter, client } = data;
      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const flags = await storage.getFlagsByNewsletter(newsletter.id);
      const aiDrafts = await storage.getAiDraftsByNewsletter(newsletter.id);

      let document: NewsletterDocument = normalizeNewsletterDocument(
        newsletter.documentJson as NewsletterDocument | LegacyNewsletterDocument | null | undefined
      );
      if (newsletter.currentVersionId) {
        const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
        if (currentVersion) {
          document = normalizeNewsletterDocument(currentVersion.snapshotJson as NewsletterDocument);
        }
      }
      document = mergeNewsletterDocument(document, {
        meta: {
          subject: newsletter.subject || document.meta?.subject || undefined,
          previewText: newsletter.previewText || document.meta?.previewText || undefined,
          fromEmail: newsletter.fromEmail || document.meta?.fromEmail || undefined,
          sendMode: newsletter.sendMode || document.meta?.sendMode || undefined,
          timezone: newsletter.timezone || document.meta?.timezone || undefined,
        },
      });

      const html = compileNewsletterToHtml(document);
      const invoice = newsletter.invoiceId ? await storage.getInvoice(newsletter.invoiceId) : null;

      res.json({
        newsletter,
        client,
        document,
        versions,
        flags,
        aiDrafts,
        html,
        invoice,
        isPaid: !!newsletter.invoiceId,
      });
    } catch (error) {
      console.error("Get newsletter error:", error);
      res.status(500).json({ error: "Failed to fetch newsletter" });
    }
  });

  app.patch("/api/newsletters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { documentJson, designJson, ...otherFields } = req.body;
      const normalizedStatus = normalizeNewsletterStatus(otherFields.status);
      if (otherFields.status && !normalizedStatus) {
        return res.status(400).json({ error: "Invalid newsletter status" });
      }
      if (normalizedStatus) {
        otherFields.status = normalizedStatus;
      }

      if (documentJson) {
        const newsletter = await storage.getNewsletter(req.params.id);
        if (!newsletter) {
          return res.status(404).json({ error: "Newsletter not found" });
        }
        if (!(await ensureWorkspaceCapability(req, res, newsletter.clientId, "newsletter.edit"))) return;
        const transitionError = getPatchStatusTransitionError(newsletter.status, normalizedStatus);
        if (transitionError) {
          return res.status(400).json({ error: transitionError });
        }

        const versions = await storage.getVersionsByNewsletter(newsletter.id);
        const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
        const existingDoc = normalizeNewsletterDocument(
          (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
        );
        
        const newDoc = mergeNewsletterDocument(existingDoc, documentJson as Partial<NewsletterDocument>);
        const latestNum = await storage.getLatestVersionNumber(newsletter.id);

        const newVersion = await storage.createVersion({
          newsletterId: newsletter.id,
          versionNumber: latestNum + 1,
          snapshotJson: newDoc,
          createdById: userId,
          changeSummary: designJson ? "Visual editor save" : "Manual edit",
        });

        const updateData: any = {
          ...otherFields,
          documentJson: newDoc,
          currentVersionId: newVersion.id,
          lastEditedById: userId,
          lastEditedAt: new Date(),
        };
        
        if (designJson) {
          updateData.designJson = designJson;
        }
        if (!updateData.subject && newDoc.meta?.subject) {
          updateData.subject = newDoc.meta.subject;
        }
        if (!updateData.previewText && newDoc.meta?.previewText) {
          updateData.previewText = newDoc.meta.previewText;
        }
        if (!updateData.fromEmail && newDoc.meta?.fromEmail) {
          updateData.fromEmail = newDoc.meta.fromEmail;
        }
        if (!updateData.sendMode && newDoc.meta?.sendMode) {
          updateData.sendMode = newDoc.meta.sendMode;
        }
        if (!updateData.timezone && newDoc.meta?.timezone) {
          updateData.timezone = newDoc.meta.timezone;
        }

        applyNewsletterStatusSideEffects(normalizedStatus, updateData, newsletter.expectedSendDate);

        const updated = await storage.updateNewsletter(req.params.id, updateData);
        return res.json(updated);
      }

      const existingNewsletter = await storage.getNewsletter(req.params.id);
      if (!existingNewsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existingNewsletter.clientId, "newsletter.edit"))) return;
      const transitionError = getPatchStatusTransitionError(existingNewsletter.status, normalizedStatus);
      if (transitionError) {
        return res.status(400).json({ error: transitionError });
      }

      const updateData: any = {
        ...otherFields,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      };
      
      if (designJson) {
        updateData.designJson = designJson;
      }

      applyNewsletterStatusSideEffects(normalizedStatus, updateData, existingNewsletter.expectedSendDate);

      const newsletter = await storage.updateNewsletter(req.params.id, updateData);
      res.json(newsletter);
    } catch (error) {
      console.error("Failed to update newsletter:", error);
      res.status(500).json({ error: "Failed to update newsletter" });
    }
  });

  app.delete("/api/newsletters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getNewsletter(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, existing.clientId, "newsletter.edit"))) return;
      await storage.deleteNewsletter(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete newsletter" });
    }
  });

  app.post("/api/newsletters/:id/duplicate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const original = await storage.getNewsletter(req.params.id);
      if (!original) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, original.clientId, "newsletter.edit"))) return;

      const versions = await storage.getVersionsByNewsletter(original.id);
      const currentVersion = versions.find((v) => v.id === original.currentVersionId);
      const documentJson: NewsletterDocument = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || original.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );

      if (!original.subscriptionId) {
        return res.status(409).json({
          error: "Cannot duplicate newsletter without a linked subscription.",
        });
      }

      const linkedInvoice = await resolveOrCreateNewsletterInvoice(
        original.clientId,
        original.subscriptionId,
        original.invoiceId || null
      );

      let expectedSendDate: string;
      if (original.subscriptionId) {
        const subscription = await storage.getSubscription(original.subscriptionId);
        if (subscription?.frequency && original.expectedSendDate) {
          const dates = getNextSendDates(subscription.frequency, new Date(original.expectedSendDate), 1);
          expectedSendDate = format(dates[0], "yyyy-MM-dd");
        } else {
          expectedSendDate = format(addDays(new Date(), 7), "yyyy-MM-dd");
        }
      } else {
        expectedSendDate = format(addDays(new Date(), 7), "yyyy-MM-dd");
      }

      const newsletter = await storage.createNewsletter({
        clientId: original.clientId,
        invoiceId: linkedInvoice.id,
        subscriptionId: original.subscriptionId,
        title: original.title + " (Copy)",
        status: "draft",
        documentJson: normalizeNewsletterDocument(documentJson),
        expectedSendDate,
        createdById: userId,
        fromEmail: original.fromEmail,
        subject: original.subject,
        previewText: original.previewText,
        sendMode: original.sendMode,
        timezone: original.timezone,
      });

      const version = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: 1,
        snapshotJson: normalizeNewsletterDocument(documentJson),
        createdById: userId,
        changeSummary: "Initial version (duplicated)",
      });

      await storage.updateNewsletter(newsletter.id, { currentVersionId: version.id });

      res.status(201).json({ ...newsletter, currentVersionId: version.id });
    } catch (error) {
      console.error("Duplicate newsletter error:", error);
      res.status(500).json({ error: "Failed to duplicate newsletter" });
    }
  });

  app.post("/api/newsletters/:id/ai-command", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { command } = req.body;

      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(client.id) : null;

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );
      const currentHtml = compileNewsletterToHtml(document);

      if (!currentHtml) {
        return res.json({ type: "error", message: "No HTML content to edit" });
      }

      const htmlResponse = await processHtmlCommand(command, currentHtml, brandingKit || null);
      
      if (htmlResponse.type === "error") {
        return res.json({ type: "error", message: htmlResponse.message });
      }

      const trimmedHtml = htmlResponse.html?.trim() || "";
      if (!trimmedHtml || !trimmedHtml.includes("<") || trimmedHtml.length < 100) {
        return res.json({ type: "error", message: "AI returned invalid HTML. Please try a different command." });
      }

      const newDoc: NewsletterDocument = {
        ...document,
        html: trimmedHtml,
      };
      const latestNum = await storage.getLatestVersionNumber(newsletter.id);

      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: newDoc,
        createdById: userId,
        changeSummary: `AI: ${command.slice(0, 50)}...`,
      });

      await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: newDoc,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      return res.json({ type: "success", message: htmlResponse.message });
    } catch (error) {
      console.error("AI command error:", error);
      res.status(500).json({ error: "AI command failed" });
    }
  });

  app.post("/api/newsletters/:id/ai-generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(client.id) : null;

      const result = await generateEmailFromPrompt(prompt, brandingKit || null);

      const newDoc: NewsletterDocument = createNewsletterDocumentFromHtml(result.html);
      const latestNum = await storage.getLatestVersionNumber(newsletter.id);

      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: newDoc,
        createdById: userId,
        changeSummary: `AI generated: ${prompt.slice(0, 50)}`,
      });

      await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: newDoc,
        designJson: { mjml: result.mjml },
        subject: result.subject || newsletter.subject,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      return res.json({
        type: "success",
        html: result.html,
        mjml: result.mjml,
        subject: result.subject,
      });
    } catch (error) {
      console.error("AI generate error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "AI generation failed" });
    }
  });

  // Generate a block-document draft (used by the block editor) using master + client prompts.
  app.post("/api/newsletters/:id/ai-generate-blocks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(newsletter.clientId) : null;
      const masterPrompt = await storage.getMasterPrompt();
      const clientPrompt = await storage.getClientPrompt(newsletter.clientId);

      const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return res.status(400).json({
          error: "Gemini is not configured. Add AI_INTEGRATIONS_GEMINI_API_KEY (or GEMINI_API_KEY).",
        });
      }

      const systemParts: string[] = [];
      if (masterPrompt?.prompt) systemParts.push(masterPrompt.prompt);
      if (clientPrompt?.prompt) systemParts.push(`CLIENT-SPECIFIC INSTRUCTIONS:\n${clientPrompt.prompt}`);
      if (brandingKit) {
        const brandParts: string[] = [];
        if (brandingKit.title) brandParts.push(`Agent Name/Title: ${brandingKit.title}`);
        if (brandingKit.companyName) brandParts.push(`Company: ${brandingKit.companyName}`);
        if (brandingKit.tone) brandParts.push(`Tone of Voice: ${brandingKit.tone}`);
        if (brandingKit.mustInclude && brandingKit.mustInclude.length > 0) brandParts.push(`Must Include: ${brandingKit.mustInclude.join(", ")}`);
        if (brandingKit.avoidTopics && brandingKit.avoidTopics.length > 0) brandParts.push(`Avoid Topics: ${brandingKit.avoidTopics.join(", ")}`);
        if (brandingKit.localLandmarks && brandingKit.localLandmarks.length > 0) brandParts.push(`Local Landmarks: ${brandingKit.localLandmarks.join(", ")}`);
        if (brandingKit.notes) brandParts.push(`Additional Notes: ${brandingKit.notes}`);
        if (brandParts.length) systemParts.push(`CLIENT BRANDING KIT:\n${brandParts.join("\n")}`);
      }

      const systemInstruction =
        systemParts.length > 0
          ? systemParts.join("\n\n")
          : "You create real estate email newsletters. Output must be structured JSON for a block-based editor.";

      const city = client?.locationCity?.trim() || "";
      const region = client?.locationRegion?.trim() || "";
      const locationLabel = [city, region].filter(Boolean).join(", ") || "the client's local market";
      const todayIsoDate = new Date().toISOString().slice(0, 10);

      const userPrompt =
        (typeof req.body?.prompt === "string" && req.body.prompt.trim()) ||
        "Create a complete draft newsletter following the standard structure: header, welcome message, market update, one home tip, and a CTA.";

      const responseJsonSchema = {
        type: "object",
        required: ["subject", "previewText", "blocks"],
        properties: {
          subject: { type: "string" },
          previewText: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "data"],
              properties: {
                id: { type: "string" },
                type: {
                  type: "string",
                  enum: ["text", "image", "button", "divider", "socials", "grid", "image_button"],
                },
                data: { type: "object" },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: false,
      };

      const generationPrompt = [
        `You must return ONLY valid JSON (no markdown, no code fences).`,
        `Rules:`,
        `- Use only these block types: text, image, button, divider, socials, grid, image_button.`,
        `- For text blocks, set data.content to safe HTML (p, h2, h3, ul, li, strong, em, a).`,
        `- For grid blocks, set data.style = "classic" | "minimal" | "spotlight" and data.items = [{ address, price, details, imageUrl, href }].`,
        `- Include these core sections as blocks: Header, Welcome, Listings, Fun Things To Do, Market Update, CTA, Footer/Socials.`,
        `- The "Fun Things To Do" and "Market Update" sections MUST be specific to ${locationLabel}.`,
        `- Market update and market news facts must use sources published within the last 40 days.`,
        `- Fun things/events may use older source pages only if the event date is in the future.`,
        `- Never use paywalled sources.`,
        `- Never cite competing real-estate agent/broker marketing blogs or promotional real-estate partner content.`,
        `- Prefer local publications, city/county/state government pages, and major publications.`,
        `- For market update and market news claims, include source links and publish dates in-line (for example in bullet points).`,
        `- For fun/events content, source links are helpful but optional.`,
        `- If no verifiable source is available, write "Source needed" instead of inventing facts.`,
        `- Keep it concise and ready for review.`,
        `Context: Client name is "${client?.name || "Client"}".`,
        `Location context: city="${city || "unknown"}", region="${region || "unknown"}".`,
        `Expected send date is "${newsletter.expectedSendDate}". Today's date is "${todayIsoDate}".`,
        `User request: ${userPrompt}`,
      ].join("\n");

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        ...(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
          ? {
              httpOptions: {
                apiVersion: "",
                baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
              },
            }
          : {}),
      });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: generationPrompt }] }],
        config: {
          systemInstruction,
          maxOutputTokens: 4096,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseJsonSchema,
          tools: [{ googleSearch: {} }],
        },
      });

      const rawText = (response.text || "").trim();
      if (!rawText) {
        return res.status(500).json({ error: "AI returned an empty response." });
      }
      const jsonText = rawText.startsWith("{") ? rawText : rawText.slice(rawText.indexOf("{"));
      const parsed = JSON.parse(jsonText);

      const allowedTypes = new Set(["text", "image", "button", "divider", "socials", "grid", "image_button"]);
      const blocksIn = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
      const blocks = blocksIn
        .filter((b: any) => b && typeof b === "object" && allowedTypes.has(String(b.type)))
        .map((b: any) => ({
          id: typeof b.id === "string" && b.id.trim() ? b.id.trim() : randomUUID(),
          type: String(b.type),
          data: b.data && typeof b.data === "object" ? b.data : {},
        }));

      const subject = typeof parsed?.subject === "string" ? parsed.subject.trim() : "";
      const previewText = typeof parsed?.previewText === "string" ? parsed.previewText.trim() : "";

      const previousDoc = normalizeNewsletterDocument(newsletter.documentJson as NewsletterDocument | null | undefined);
      const fromEmail =
        previousDoc.meta?.fromEmail ||
        newsletter.fromEmail ||
        brandingKit?.email ||
        client?.primaryEmail ||
        "";

      const newDoc: NewsletterDocument = {
        ...previousDoc,
        version: "v1",
        blocks,
        meta: {
          ...(previousDoc.meta || {}),
          subject: subject || previousDoc.meta?.subject,
          previewText: previewText || previousDoc.meta?.previewText,
          fromEmail,
          audienceTag: previousDoc.meta?.audienceTag || "all",
        },
      };

      const latestNum = await storage.getLatestVersionNumber(newsletter.id);
      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: newDoc,
        createdById: userId,
        changeSummary: `AI blocks: ${userPrompt.slice(0, 60)}`,
      });

      await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: newDoc,
        subject: subject || newsletter.subject,
        previewText: previewText || newsletter.previewText,
        fromEmail: fromEmail || newsletter.fromEmail,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      const html = compileNewsletterToHtml(newDoc);
      const groundingChunks = Array.isArray(response.candidates?.[0]?.groundingMetadata?.groundingChunks)
        ? response.candidates?.[0]?.groundingMetadata?.groundingChunks
        : [];
      const seenSourceUrls = new Set<string>();
      const sources = groundingChunks
        .map((chunk: any) => {
          const uri = typeof chunk?.web?.uri === "string" ? chunk.web.uri : "";
          const title = typeof chunk?.web?.title === "string" ? chunk.web.title : "";
          return { url: uri, title };
        })
        .filter((source: any) => {
          if (!source.url || seenSourceUrls.has(source.url)) return false;
          seenSourceUrls.add(source.url);
          return true;
        })
        .slice(0, 12);

      return res.json({ type: "success", document: newDoc, html, subject, previewText, sources });
    } catch (error: any) {
      console.error("AI generate blocks error:", error);
      res.status(500).json({ error: error?.message || "AI blocks generation failed" });
    }
  });

  app.post("/api/newsletters/:id/ai-edit", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { command } = req.body;

      if (!command || typeof command !== "string") {
        return res.status(400).json({ error: "Command is required" });
      }

      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(client.id) : null;

      const currentMjml = (newsletter.designJson as any)?.mjml;
      if (!currentMjml) {
        return res.status(400).json({ error: "No MJML source found. Generate a newsletter first using AI." });
      }

      const result = await editEmailWithAI(command, currentMjml, brandingKit || null);

      const previousDoc = normalizeNewsletterDocument(newsletter.documentJson as NewsletterDocument | null | undefined);
      const newDoc: NewsletterDocument = {
        ...previousDoc,
        html: result.html,
      };
      const latestNum = await storage.getLatestVersionNumber(newsletter.id);

      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: newDoc,
        createdById: userId,
        changeSummary: `AI edit: ${command.slice(0, 50)}`,
      });

      await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: newDoc,
        designJson: { mjml: result.mjml },
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      return res.json({
        type: "success",
        html: result.html,
        mjml: result.mjml,
      });
    } catch (error) {
      console.error("AI edit error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "AI editing failed" });
    }
  });

  app.post("/api/newsletters/:id/suggest-subjects", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );
      const html = compileNewsletterToHtml(document);

      if (!html) {
        return res.status(400).json({ error: "No content to analyze" });
      }

      const subjects = await suggestSubjectLines(html);
      return res.json({ subjects });
    } catch (error) {
      console.error("Subject suggest error:", error);
      res.status(500).json({ error: "Failed to suggest subject lines" });
    }
  });

  app.post("/api/newsletters/:id/ai-suggest-block-edits", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const commandRaw = req.body?.message ?? req.body?.command;
      const command = typeof commandRaw === "string" ? commandRaw.trim() : "";
      if (!command) {
        return res.status(400).json({ error: "Message is required" });
      }

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );

      const blocks = Array.isArray(document.blocks) ? document.blocks : [];
      if (blocks.length === 0) {
        const emptySuggestion: BlockEditSuggestion = {
          summary: "No block edits available yet because this newsletter has no blocks.",
          operations: [],
        };
        return res.json({ ...emptySuggestion, operationCount: 0 });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(newsletter.clientId) : null;
      const masterPrompt = await storage.getMasterPrompt();
      const clientPrompt = await storage.getClientPrompt(newsletter.clientId);

      const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return res.status(400).json({
          error: "Gemini is not configured. Add AI_INTEGRATIONS_GEMINI_API_KEY (or GEMINI_API_KEY).",
        });
      }

      const systemParts: string[] = [];
      if (masterPrompt?.prompt) systemParts.push(masterPrompt.prompt);
      if (clientPrompt?.prompt) systemParts.push(`CLIENT-SPECIFIC INSTRUCTIONS:\n${clientPrompt.prompt}`);
      if (brandingKit) {
        const brandParts: string[] = [];
        if (brandingKit.title) brandParts.push(`Agent Name/Title: ${brandingKit.title}`);
        if (brandingKit.companyName) brandParts.push(`Company: ${brandingKit.companyName}`);
        if (brandingKit.tone) brandParts.push(`Tone of Voice: ${brandingKit.tone}`);
        if (brandingKit.primaryColor) brandParts.push(`Primary Color: ${brandingKit.primaryColor}`);
        if (brandingKit.secondaryColor) brandParts.push(`Secondary Color: ${brandingKit.secondaryColor}`);
        if (brandingKit.mustInclude && brandingKit.mustInclude.length > 0) {
          brandParts.push(`Must Include: ${brandingKit.mustInclude.join(", ")}`);
        }
        if (brandingKit.avoidTopics && brandingKit.avoidTopics.length > 0) {
          brandParts.push(`Avoid Topics: ${brandingKit.avoidTopics.join(", ")}`);
        }
        if (brandingKit.notes) brandParts.push(`Additional Notes: ${brandingKit.notes}`);
        if (brandParts.length > 0) systemParts.push(`CLIENT BRANDING KIT:\n${brandParts.join("\n")}`);
      }

      const systemInstruction =
        systemParts.length > 0
          ? systemParts.join("\n\n")
          : "You suggest concise, actionable edits for block-based real estate newsletters.";

      const blockCatalog = blocks
        .map((block, index) => {
          const dataPreview = JSON.stringify(block.data || {}).replace(/\s+/g, " ").slice(0, 320);
          return `${index + 1}. id=${block.id}; type=${block.type}; data=${dataPreview}`;
        })
        .join("\n");

      const responseJsonSchema = {
        type: "object",
        required: ["summary", "operations"],
        properties: {
          summary: { type: "string" },
          operations: {
            type: "array",
            items: {
              type: "object",
              required: ["op"],
              properties: {
                op: {
                  type: "string",
                  enum: ["update_block_data", "insert_block_after", "remove_block", "move_block"],
                },
                blockId: { type: "string" },
                patch: { type: "object" },
                afterBlockId: { type: "string" },
                blockType: { type: "string", enum: ALLOWED_BLOCK_TYPES },
                data: { type: "object" },
                direction: { type: "string", enum: ["up", "down"] },
                reason: { type: "string" },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: false,
      };

      const city = client?.locationCity?.trim() || "";
      const region = client?.locationRegion?.trim() || "";
      const locationLabel = [city, region].filter(Boolean).join(", ") || "the client's local market";

      const generationPrompt = [
        "Return ONLY JSON.",
        "You are editing an existing block newsletter. Suggest exact block operations that satisfy the user request.",
        "Rules:",
        "- Do not invent block IDs. Use IDs from the current block list only.",
        "- Prefer update_block_data operations when possible.",
        "- Use insert_block_after only when new content is required.",
        "- For move_block, use direction \"up\" or \"down\" only.",
        "- Keep operations minimal and practical (max 8).",
        "- For text block HTML use safe tags only: p, h2, h3, ul, li, strong, em, a.",
        "- Respect source policy: market/news within 40 days, no paywalls, no competing real-estate promo blogs.",
        `- Source context applies to sections about market news and local events for ${locationLabel}.`,
        "If no changes are needed, return operations as an empty array and explain why in summary.",
        "",
        `Client: ${client?.name || "Client"}`,
        `Current block list:\n${blockCatalog}`,
        `User request: ${command}`,
      ].join("\n");

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        ...(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
          ? {
              httpOptions: {
                apiVersion: "",
                baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
              },
            }
          : {}),
      });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: generationPrompt }] }],
        config: {
          systemInstruction,
          maxOutputTokens: 4096,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseJsonSchema,
          tools: [{ googleSearch: {} }],
        },
      });

      const rawText = (response.text || "").trim();
      if (!rawText) {
        return res.status(500).json({ error: "AI returned an empty response." });
      }

      const jsonText = rawText.startsWith("{") ? rawText : rawText.slice(rawText.indexOf("{"));
      const parsed = JSON.parse(jsonText);
      const summary =
        typeof parsed?.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : "AI prepared block edit suggestions.";
      const operations = sanitizeBlockEditOperations(parsed?.operations, blocks);
      const preview = applyBlockEditOperations(document, operations);

      return res.json({
        summary,
        operations,
        operationCount: operations.length,
        previewAppliedCount: preview.appliedCount,
      } as BlockEditSuggestion & { operationCount: number });
    } catch (error: any) {
      console.error("AI suggest block edits error:", error);
      res.status(500).json({ error: error?.message || "AI block edit suggestion failed" });
    }
  });

  app.post("/api/newsletters/:id/ai-apply-block-edits", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const previousDoc = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );
      const blocks = Array.isArray(previousDoc.blocks) ? previousDoc.blocks : [];

      const operations = sanitizeBlockEditOperations(req.body?.operations, blocks);
      if (operations.length === 0) {
        return res.status(400).json({ error: "No valid operations to apply." });
      }

      const applied = applyBlockEditOperations(previousDoc, operations);
      if (applied.appliedCount === 0) {
        return res.status(400).json({ error: "Operations did not affect current blocks." });
      }

      const summaryRaw = typeof req.body?.summary === "string" ? req.body.summary.trim() : "";
      const summary = summaryRaw || `Applied ${applied.appliedCount} AI block edit(s)`;

      const latestNum = await storage.getLatestVersionNumber(newsletter.id);
      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: applied.document,
        createdById: userId,
        changeSummary: `AI apply: ${summary.slice(0, 140)}`,
      });

      await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: applied.document,
        subject: applied.document.meta?.subject || newsletter.subject,
        previewText: applied.document.meta?.previewText || newsletter.previewText,
        fromEmail: applied.document.meta?.fromEmail || newsletter.fromEmail,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      const html = compileNewsletterToHtml(applied.document);
      return res.json({
        type: "success",
        document: applied.document,
        html,
        appliedCount: applied.appliedCount,
      });
    } catch (error: any) {
      console.error("AI apply block edits error:", error);
      res.status(500).json({ error: error?.message || "Failed to apply AI block edits" });
    }
  });

  // ============================================================================
  // NEWSLETTER CHAT - Persistent AI chat per newsletter
  // ============================================================================
  app.get("/api/newsletters/:id/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const messages = await storage.getChatMessages(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });

  app.post("/api/newsletters/:id/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const userMsg = await storage.addChatMessage({
        newsletterId: req.params.id,
        role: "user",
        content: message,
      });

      const masterPrompt = await storage.getMasterPrompt();
      const clientPrompt = newsletter.clientId 
        ? await storage.getClientPrompt(newsletter.clientId) 
        : undefined;

      const brandingKit = await storage.getBrandingKit(newsletter.clientId);

      const chatHistory = await storage.getChatMessages(req.params.id);
      
      const systemParts: string[] = [];
      if (masterPrompt) systemParts.push(masterPrompt.prompt);
      if (clientPrompt) systemParts.push(`CLIENT-SPECIFIC INSTRUCTIONS:\n${clientPrompt.prompt}`);
      if (brandingKit) {
        const brandParts: string[] = [];
        if (brandingKit.title) brandParts.push(`Agent Name/Title: ${brandingKit.title}`);
        if (brandingKit.companyName) brandParts.push(`Company: ${brandingKit.companyName}`);
        if (brandingKit.primaryColor) brandParts.push(`Primary Color: ${brandingKit.primaryColor}`);
        if (brandingKit.secondaryColor) brandParts.push(`Secondary Color: ${brandingKit.secondaryColor}`);
        if (brandingKit.tone) brandParts.push(`Tone of Voice: ${brandingKit.tone}`);
        if (brandingKit.logo) brandParts.push(`Logo URL: ${brandingKit.logo}`);
        if (brandingKit.headshot) brandParts.push(`Headshot URL: ${brandingKit.headshot}`);
        if (brandingKit.companyLogo) brandParts.push(`Company Logo URL: ${brandingKit.companyLogo}`);
        if (brandingKit.phone) brandParts.push(`Phone: ${brandingKit.phone}`);
        if (brandingKit.email) brandParts.push(`Email: ${brandingKit.email}`);
        if (brandingKit.website) brandParts.push(`Website: ${brandingKit.website}`);
        if (brandingKit.facebook) brandParts.push(`Facebook: ${brandingKit.facebook}`);
        if (brandingKit.instagram) brandParts.push(`Instagram: ${brandingKit.instagram}`);
        if (brandingKit.linkedin) brandParts.push(`LinkedIn: ${brandingKit.linkedin}`);
        if (brandingKit.youtube) brandParts.push(`YouTube: ${brandingKit.youtube}`);
        if (brandingKit.platform) brandParts.push(`Email Platform: ${brandingKit.platform}`);
        if (brandingKit.mustInclude && brandingKit.mustInclude.length > 0) brandParts.push(`Must Include: ${brandingKit.mustInclude.join(", ")}`);
        if (brandingKit.avoidTopics && brandingKit.avoidTopics.length > 0) brandParts.push(`Avoid Topics: ${brandingKit.avoidTopics.join(", ")}`);
        if (brandingKit.localLandmarks && brandingKit.localLandmarks.length > 0) brandParts.push(`Local Landmarks: ${brandingKit.localLandmarks.join(", ")}`);
        if (brandingKit.notes) brandParts.push(`Additional Notes: ${brandingKit.notes}`);
        if (brandParts.length) systemParts.push(`CLIENT BRANDING KIT:\n${brandParts.join("\n")}`);
      }

      const systemInstruction = systemParts.length > 0 
        ? systemParts.join("\n\n") 
        : "You are a helpful assistant for creating real estate email newsletters. Help the user with content ideas, writing, and newsletter strategy.";

      const conversationContents = chatHistory
        .filter(m => m.role !== "system")
        .map(m => ({
          role: (m.role === "assistant" ? "model" : m.role) as "user" | "model",
          parts: [{ text: m.content }],
        }));

      const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        const assistantMsg = await storage.addChatMessage({
          newsletterId: req.params.id,
          role: "assistant",
          content:
            "Gemini is not configured yet. Add `AI_INTEGRATIONS_GEMINI_API_KEY` (or `GEMINI_API_KEY`) in environment variables, then try again.",
        });
        return res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
      }

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: geminiApiKey,
        ...(process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
          ? {
              httpOptions: {
                apiVersion: "",
                baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
              },
            }
          : {}),
      });

      let assistantContent = "I'm sorry, I couldn't generate a response.";
      try {
        let workingContents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [
          ...conversationContents,
        ];
        let combined = "";

        for (let pass = 0; pass < 4; pass++) {
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: workingContents,
            config: {
              systemInstruction,
              maxOutputTokens: 8192,
              temperature: 0.7,
            },
          });

          const textChunk = (response.text || "").trim();
          if (textChunk) {
            combined = combined ? `${combined}\n\n${textChunk}` : textChunk;
          }

          const finishReasonRaw = (response as any)?.candidates?.[0]?.finishReason;
          const finishReason = typeof finishReasonRaw === "string" ? finishReasonRaw.toUpperCase() : "";
          const hitTokenLimit = finishReason.includes("MAX");

          if (!hitTokenLimit || pass === 3) {
            break;
          }

          workingContents = [
            ...workingContents,
            { role: "model", parts: [{ text: textChunk || "..." }] },
            { role: "user", parts: [{ text: "Continue exactly where you left off. Do not repeat prior text." }] },
          ];
        }

        assistantContent = combined || assistantContent;
      } catch (aiError) {
        console.error("Gemini chat generation failed:", aiError);
        assistantContent =
          "I couldn't reach Gemini right now. Please retry in a moment, or check AI integration settings.";
      }

      const assistantMsg = await storage.addChatMessage({
        newsletterId: req.params.id,
        role: "assistant",
        content: assistantContent,
      });

      res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ error: "Failed to process chat message" });
    }
  });

  app.delete("/api/newsletters/:id/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.clearChatMessages(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear chat" });
    }
  });

  // ============================================================================
  // AI PROMPTS - Master and client-level system prompts
  // ============================================================================
  app.get("/api/ai-prompts/master", requireAuth, async (req: Request, res: Response) => {
    try {
      const prompt = await storage.getMasterPrompt();
      res.json(prompt || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch master prompt" });
    }
  });

  app.get("/api/clients/:clientId/ai-prompt", requireAuth, async (req: Request, res: Response) => {
    try {
      const prompt = await storage.getClientPrompt(req.params.clientId);
      res.json(prompt || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client prompt" });
    }
  });

  app.put("/api/ai-prompts/master", requireAuth, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt text is required" });
      }
      const result = await storage.upsertAiPrompt({ type: "master", prompt });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to save master prompt" });
    }
  });

  app.put("/api/clients/:clientId/ai-prompt", requireAuth, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt text is required" });
      }
      const result = await storage.upsertAiPrompt({ 
        type: "client", 
        clientId: req.params.clientId, 
        prompt 
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to save client prompt" });
    }
  });

  app.post("/api/mjml/render", requireAuth, async (req: Request, res: Response) => {
    try {
      const { mjml } = req.body;
      if (!mjml || typeof mjml !== "string") {
        return res.status(400).json({ error: "MJML markup is required" });
      }
      const result = renderMjml(mjml);
      return res.json(result);
    } catch (error) {
      console.error("MJML render error:", error);
      res.status(500).json({ error: "MJML rendering failed" });
    }
  });

  app.post("/api/mjml/validate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { mjml } = req.body;
      if (!mjml || typeof mjml !== "string") {
        return res.status(400).json({ error: "MJML markup is required" });
      }
      const result = validateMjml(mjml);
      return res.json(result);
    } catch (error) {
      console.error("MJML validate error:", error);
      res.status(500).json({ error: "MJML validation failed" });
    }
  });

  // ============================================================================
  // POSTMARK WEBHOOKS
  // ============================================================================
  app.post("/api/webhooks/postmark/sender-confirmed", async (req: Request, res: Response) => {
    try {
      const webhookSecret = req.headers["x-postmark-webhook-secret"] || req.query.secret;
      const expectedSecret = process.env.POSTMARK_WEBHOOK_SECRET;
      
      if (expectedSecret && webhookSecret !== expectedSecret) {
        console.warn("Postmark webhook: unauthorized request attempt");
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const { FromEmail, Confirmed } = req.body;
      
      if (!FromEmail || !Confirmed) {
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
      
      const clients = await storage.getClients();
      const client = clients.find(c => c.primaryEmail === FromEmail);
      
      if (client) {
        await upsertClientPostmarkTenant(client.id, {
          senderEmail: client.primaryEmail,
          senderConfirmed: true,
        });
        await syncClientPostmarkSnapshot(client.id, {
          serverId: client.postmarkServerId || undefined,
          streamId: client.postmarkMessageStreamId || undefined,
          domain: client.postmarkDomain || undefined,
          domainVerificationState: (client.postmarkDomainVerificationState as any) || undefined,
          senderVerificationState: "verified",
          qualityState: (client.postmarkQualityState as any) || "healthy",
          autoPausedAt: client.postmarkAutoPausedAt || null,
          autoPauseReason: client.postmarkAutoPauseReason || null,
          signatureId: client.postmarkSignatureId || undefined,
          isVerified: true,
        });
        await recordDiyFunnelEvent({
          clientId: client.id,
          userId: null,
          eventType: "sender_verified",
          payload: {
            source: "postmark_webhook",
            senderEmail: FromEmail,
          },
          dedupeKey: `sender_verified:${client.id}`,
        });
        console.log(`Client ${client.name} verified via Postmark webhook`);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("Postmark webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Generic Postmark event webhook (opens/clicks/bounces/unsubscribes).
  // Configure Postmark to POST to this endpoint and set POSTMARK_WEBHOOK_SECRET.
  app.post("/api/webhooks/postmark/events", async (req: Request, res: Response) => {
    try {
      const webhookSecret = req.headers["x-postmark-webhook-secret"] || req.query.secret;
      const expectedSecret = process.env.POSTMARK_WEBHOOK_SECRET;
      if (expectedSecret && webhookSecret !== expectedSecret) {
        console.warn("Postmark events webhook: unauthorized request attempt");
        return res.status(401).json({ error: "Unauthorized" });
      }

      const body = req.body || {};
      const recordTypeRaw =
        (typeof body.RecordType === "string" && body.RecordType) ||
        (typeof body.Type === "string" && body.Type) ||
        (typeof body.Event === "string" && body.Event) ||
        "unknown";
      const recordType = String(recordTypeRaw).trim().toLowerCase();

      const messageId =
        (typeof body.MessageID === "string" && body.MessageID) ||
        (typeof body.MessageId === "string" && body.MessageId) ||
        (typeof body.MessageID === "string" && body.MessageID) ||
        null;

      const recipientEmail =
        (typeof body.Recipient === "string" && body.Recipient) ||
        (typeof body.Email === "string" && body.Email) ||
        (typeof body.OriginalRecipient === "string" && body.OriginalRecipient) ||
        null;

      const metadata = body.Metadata && typeof body.Metadata === "object" ? body.Metadata : {};
      const newsletterId =
        (typeof (metadata as any).newsletterId === "string" && (metadata as any).newsletterId) ||
        (typeof body.Tag === "string" && body.Tag) ||
        null;

      const clientIdFromMeta = typeof (metadata as any).clientId === "string" ? (metadata as any).clientId : null;
      const contactIdFromMeta = typeof (metadata as any).contactId === "string" ? (metadata as any).contactId : null;
      const serverIdFromPayloadRaw = (body as any).ServerID ?? (body as any).ServerId ?? null;
      const serverIdFromPayload = Number(serverIdFromPayloadRaw || 0);

      const { db } = await import("./db");
      const { clientPostmarkTenants, newsletterEvents, newsletterDeliveries } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      // If metadata didn't include clientId, derive it from the newsletter record.
      let clientId = clientIdFromMeta;
      if (!clientId) {
        const nl = newsletterId ? await storage.getNewsletter(newsletterId) : null;
        clientId = nl?.clientId || null;
      }
      if (!clientId && Number.isFinite(serverIdFromPayload) && serverIdFromPayload > 0) {
        const [tenant] = await db
          .select({ clientId: (clientPostmarkTenants as any).clientId })
          .from(clientPostmarkTenants)
          .where(eq((clientPostmarkTenants as any).serverId, serverIdFromPayload))
          .limit(1);
        clientId = (tenant as any)?.clientId || null;
      }
      if (!clientId) {
        // Can't store without a valid FK; still acknowledge to avoid retries.
        return res.json({ ok: true, ignored: true });
      }

      const occurredAtRaw =
        (typeof body.ReceivedAt === "string" && body.ReceivedAt) ||
        (typeof body.RecordedAt === "string" && body.RecordedAt) ||
        (typeof body.Timestamp === "string" && body.Timestamp) ||
        null;
      const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : null;

      if (newsletterId) {
        await db.insert(newsletterEvents).values({
          newsletterId,
          clientId,
          contactId: contactIdFromMeta,
          email: recipientEmail,
          postmarkMessageId: messageId,
          eventType: recordType,
          occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
          payload: body,
        } as any);
      }

      // Map delivery/provider webhook signals back onto deliveries + suppression.
      const isDelivery = recordType.includes("delivery") || recordType.includes("delivered");
      const isBounce = recordType.includes("bounce");
      const isUnsub =
        recordType.includes("unsubscribe") ||
        recordType.includes("subscriptionchange") ||
        recordType.includes("subscription_change");
      const isComplaint =
        recordType.includes("spamcomplaint") ||
        recordType.includes("spam_complaint") ||
        recordType.includes("complaint");

      if (messageId) {
        let statusUpdate: "sent" | "bounced" | "unsubscribed" | null = null;
        if (isBounce) statusUpdate = "bounced";
        else if (isUnsub || isComplaint) statusUpdate = "unsubscribed";
        else if (isDelivery) statusUpdate = "sent";

        if (statusUpdate) {
          await db
            .update(newsletterDeliveries)
            .set({
              status: statusUpdate,
              sentAt: statusUpdate === "sent" ? new Date() : null,
            } as any)
            .where(eq((newsletterDeliveries as any).postmarkMessageId, messageId));
        }
      }

      if ((isUnsub || isBounce || isComplaint) && clientId && recipientEmail) {
        const existingContact = await storage.getContactByEmail(clientId, recipientEmail);
        const existingTags = Array.isArray(existingContact?.tags) ? existingContact.tags : ["all"];
        const mergedTags = Array.from(new Set([...existingTags, "suppressed"]));
        await storage.upsertContactByEmail(clientId, recipientEmail, {
          isActive: false,
          tags: mergedTags,
        });
      }

      if (clientId && (isBounce || isComplaint || isUnsub || isDelivery)) {
        await evaluateClientDeliverabilityGuard(clientId);
      }

      if (newsletterId) {
        await syncNewsletterStatusFromDeliveries(newsletterId);
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Postmark events webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  app.get("/api/clients/:clientId/verification-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const clientId = req.params.clientId;
      const client = await storage.getClient(clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "branding.manage"))) return;

      const ensureResult = await ensureClientPostmarkInfrastructure(clientId, req);
      if (!ensureResult.ok) {
        const normalized = formatPostmarkProvisioningError(ensureResult.error);
        return res.status(normalized.status).json({
          isVerified: client.isVerified,
          pendingVerification: !client.isVerified,
          error: normalized.error,
          postmarkProvisioningBlocked: normalized.status === 409,
        });
      }

      const tenant = ensureResult.tenant;
      if (!tenant) {
        return res.status(500).json({ error: "Postmark tenant metadata unavailable for this client." });
      }

      let senderConfirmed = !!tenant.senderConfirmed;
      if (tenant.senderSignatureId) {
        const signature = await getSenderSignature(tenant.senderSignatureId);
        senderConfirmed = !!signature?.Confirmed;
        if (senderConfirmed !== !!tenant.senderConfirmed) {
          await upsertClientPostmarkTenant(clientId, { senderConfirmed });
        }
      }

      await syncClientPostmarkSnapshot(clientId, {
        serverId: tenant.serverId,
        streamId: tenant.broadcastStreamId,
        domain: tenant.domain || null,
        domainVerificationState: (tenant.domainVerificationState as any) || "not_configured",
        senderVerificationState: senderConfirmed ? "verified" : "pending",
        qualityState: (tenant.qualityState as any) || "healthy",
        autoPausedAt: (tenant.autoPausedAt as Date | null) || null,
        autoPauseReason: (tenant.autoPauseReason as string | null) || null,
        signatureId: tenant.senderSignatureId || null,
        isVerified: senderConfirmed,
      });

      const requiresCustomSenderDomain =
        !senderConfirmed &&
        !tenant.senderSignatureId &&
        isLikelyPublicMailboxDomain(client.primaryEmail || "");
      const senderRequirementMessage = requiresCustomSenderDomain
        ? "Use a professional sender email on your own domain. Postmark blocks sender verification for gmail/outlook/hotmail/live."
        : null;

      res.json({
        isVerified: senderConfirmed,
        pendingVerification: !senderConfirmed,
        signatureId: tenant.senderSignatureId || null,
        serverId: tenant.serverId,
        streamId: tenant.broadcastStreamId,
        domain: tenant.domain || null,
        domainVerificationState: tenant.domainVerificationState || "not_configured",
        qualityState: tenant.qualityState || "healthy",
        autoPausedAt: tenant.autoPausedAt || null,
        autoPauseReason: tenant.autoPauseReason || null,
        requiresCustomSenderDomain,
        senderRequirementMessage,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check verification status" });
    }
  });

  const sendClientVerificationEmail = async (clientId: string, req?: Request) => {
    const client = await storage.getClient(clientId);
    if (!client) {
      return { ok: false, status: 404, payload: { error: "Client not found" } };
    }
    if (!process.env.POSTMARK_ACCOUNT_API_TOKEN) {
      return {
        ok: false,
        status: 400,
        payload: { error: "Postmark account API token is not configured" },
      };
    }

    const infra = await ensureClientPostmarkInfrastructure(client.id, req);
    if (!infra.ok || !infra.tenant) {
      const normalized = formatPostmarkProvisioningError(infra.error);
      return {
        ok: false,
        status: normalized.status,
        payload: { error: normalized.error, postmarkProvisioningBlocked: normalized.status === 409 },
      };
    }

    const signatureId = infra.tenant.senderSignatureId || client.postmarkSignatureId;
    if (!signatureId) {
      const publicDomainBlocked = isLikelyPublicMailboxDomain(client.primaryEmail || "");
      return {
        ok: false,
        status: publicDomainBlocked ? 400 : 500,
        payload: publicDomainBlocked
          ? {
              error:
                "Postmark does not allow verification for public mailbox senders (gmail/outlook/hotmail/live). Use a professional sender email on your own domain.",
              requiresCustomSenderDomain: true,
              senderEmail: client.primaryEmail,
            }
          : { error: "Sender signature was not created for this client." },
      };
    }

    const signature = await getSenderSignature(signatureId);
    if (signature?.Confirmed) {
      await upsertClientPostmarkTenant(client.id, {
        senderSignatureId: signatureId,
        senderEmail: client.primaryEmail,
        senderConfirmed: true,
      });
      await syncClientPostmarkSnapshot(client.id, {
        signatureId,
        senderVerificationState: "verified",
        isVerified: true,
      });
      return {
        ok: true,
        status: 200,
        payload: {
          success: true,
          isVerified: true,
          signatureId,
          message: "Sender already verified",
        },
      };
    }

    const sent = await resendConfirmation(signatureId);
    if (!sent) {
      return {
        ok: false,
        status: 500,
        payload: { error: "Failed to send verification email." },
      };
    }

    await upsertClientPostmarkTenant(client.id, {
      senderSignatureId: signatureId,
      senderEmail: client.primaryEmail,
      senderConfirmed: false,
    });
    await syncClientPostmarkSnapshot(client.id, {
      signatureId,
      senderVerificationState: "pending",
      isVerified: false,
    });

    return {
      ok: true,
      status: 200,
      payload: {
        success: true,
        isVerified: false,
        signatureId,
        message: "Verification email sent. Confirm from inbox to enable sending.",
      },
    };
  };

  app.post("/api/clients/:id/verify-sender", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "branding.manage"))) return;
      const result = await sendClientVerificationEmail(req.params.id, req);
      if (result.ok) {
        const payload = (result.payload || {}) as Record<string, unknown>;
        const isVerified = payload.isVerified === true;
        if (isVerified) {
          await recordDiyFunnelEvent({
            clientId: client.id,
            userId: (req as Request & { userId: string }).userId,
            eventType: "sender_verified",
            payload: {
              source: "verify_sender_endpoint",
            },
            dedupeKey: `sender_verified:${client.id}`,
          });
        }
      }
      res.status(result.status).json(result.payload);
    } catch (error) {
      console.error("Client sender verification error:", error);
      res.status(500).json({ error: "Failed to send verification email" });
    }
  });

  app.post("/api/clients/:id/postmark/provision", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "branding.manage"))) return;
      const result = await ensureClientPostmarkInfrastructure(client.id, req);
      if (!result.ok || !result.tenant) {
        const normalized = formatPostmarkProvisioningError(result.error);
        return res
          .status(normalized.status)
          .json({ error: normalized.error, postmarkProvisioningBlocked: normalized.status === 409 });
      }
      res.json({
        success: true,
        clientId: client.id,
        serverId: result.tenant.serverId,
        streamId: result.tenant.broadcastStreamId,
        signatureId: result.tenant.senderSignatureId,
        senderVerified: !!result.tenant.senderConfirmed,
        domain: result.tenant.domain || null,
        domainVerificationState: result.tenant.domainVerificationState || "not_configured",
        qualityState: result.tenant.qualityState || "healthy",
      });
    } catch (error) {
      console.error("Postmark provision error:", error);
      res.status(500).json({ error: "Failed to provision Postmark infrastructure" });
    }
  });

  app.get("/api/clients/:id/postmark-tenant", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, client.id, "newsletter.send"))) return;
      const tenant = await readClientPostmarkTenant(client.id);
      const metrics = await evaluateClientDeliverabilityGuard(client.id);
      res.json({
        clientId: client.id,
        serverId: tenant?.serverId || client.postmarkServerId || null,
        streamId: tenant?.broadcastStreamId || client.postmarkMessageStreamId || null,
        signatureId: tenant?.senderSignatureId || client.postmarkSignatureId || null,
        senderVerified: !!(tenant?.senderConfirmed || client.isVerified),
        domain: tenant?.domain || client.postmarkDomain || null,
        domainVerificationState:
          tenant?.domainVerificationState || client.postmarkDomainVerificationState || "not_configured",
        qualityState: tenant?.qualityState || client.postmarkQualityState || "healthy",
        autoPausedAt: tenant?.autoPausedAt || client.postmarkAutoPausedAt || null,
        autoPauseReason: tenant?.autoPauseReason || client.postmarkAutoPauseReason || null,
        deliverability: metrics,
      });
    } catch (error) {
      console.error("Postmark tenant fetch error:", error);
      res.status(500).json({ error: "Failed to fetch Postmark tenant status" });
    }
  });

  app.post("/api/clients/:id/onboarding-link", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await storage.createOnboardingToken({
        clientId: client.id,
        token,
        expiresAt,
      });

      const onboardingUrl = `${req.protocol}://${req.get("host")}/onboarding/${token}`;
      res.json({ token, onboardingUrl, expiresAt });
    } catch (error) {
      console.error("Create onboarding link error:", error);
      res.status(500).json({ error: "Failed to create onboarding link" });
    }
  });

  app.get("/api/onboarding/:token", async (req: Request, res: Response) => {
    try {
      const onboardingToken = await storage.getValidOnboardingToken(req.params.token);
      if (!onboardingToken) {
        return res.json({ expired: true });
      }

      const client = await storage.getClient(onboardingToken.clientId);
      if (!client) {
        return res.json({ expired: true });
      }

      const contacts = await storage.getContactsByClient(client.id);
      const segments = await storage.getContactSegmentsByClient(client.id);

      res.json({
        expired: false,
        client: {
          id: client.id,
          name: client.name,
          primaryEmail: client.primaryEmail,
          isVerified: client.isVerified,
        },
        onboarding: {
          token: onboardingToken.token,
          expiresAt: onboardingToken.expiresAt,
        },
        audience: {
          contactsCount: contacts.length,
          segmentsCount: segments.length,
        },
      });
    } catch (error) {
      console.error("Get onboarding payload error:", error);
      res.status(500).json({ error: "Failed to load onboarding" });
    }
  });

  app.post("/api/onboarding/:token/verify-sender/resend", async (req: Request, res: Response) => {
    try {
      const onboardingToken = await storage.getValidOnboardingToken(req.params.token);
      if (!onboardingToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }

      const client = await storage.getClient(onboardingToken.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      const result = await sendClientVerificationEmail(client.id, req);
      if (result.ok && (result.payload as any)?.isVerified) {
        await recordDiyFunnelEvent({
          clientId: client.id,
          userId: null,
          eventType: "sender_verified",
          payload: { source: "onboarding_portal" },
          dedupeKey: `sender_verified:${client.id}`,
        });
      }
      res.status(result.status).json(result.payload);
    } catch (error) {
      console.error("Onboarding sender verification error:", error);
      res.status(500).json({ error: "Failed to send verification email" });
    }
  });

  app.post("/api/onboarding/:token/contacts/import-csv", async (req: Request, res: Response) => {
    try {
      const onboardingToken = await storage.getValidOnboardingToken(req.params.token);
      if (!onboardingToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }

      const client = await storage.getClient(onboardingToken.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const csvContent = typeof req.body.csvContent === "string" ? req.body.csvContent : "";
      if (!csvContent.trim()) {
        return res.status(400).json({ error: "csvContent is required" });
      }

      const requestedMapping = req.body.mapping && typeof req.body.mapping === "object" ? req.body.mapping : {};
      const result = await importContactsFromCsv(client.id, csvContent, requestedMapping, {
        createSegmentsFromTags: !!req.body?.createSegmentsFromTags,
        segmentTags: req.body?.segmentTags,
        importedBySource: "onboarding_portal",
      });
      if ((result.summary.importedCount || 0) + (result.summary.updatedCount || 0) > 0) {
        await recordDiyFunnelEvent({
          clientId: client.id,
          userId: null,
          eventType: "contacts_imported",
          payload: {
            source: "onboarding_portal",
            importedCount: result.summary.importedCount || 0,
            updatedCount: result.summary.updatedCount || 0,
            skippedCount: result.summary.skippedCount || 0,
          },
          dedupeKey: `contacts_imported:${client.id}:${result.job?.id || Date.now()}`,
        });
      }
      res.json(result);
    } catch (error) {
      console.error("Onboarding CSV import error:", error);
      const errorWithMeta = error as Error & { meta?: { suggestedMapping?: unknown; headers?: string[] } };
      if (errorWithMeta.message === "Email column is required") {
        return res.status(400).json({
          error: errorWithMeta.message,
          suggestedMapping: errorWithMeta.meta?.suggestedMapping,
          headers: errorWithMeta.meta?.headers || [],
        });
      }
      res.status(500).json({ error: "Failed to import CSV" });
    }
  });

  // ============================================================================
  // REVIEW TOKENS
  // ============================================================================
  app.get("/api/review/:token", async (req: Request, res: Response) => {
    try {
      const reviewToken = await storage.getValidReviewToken(req.params.token);
      if (!reviewToken) {
        return res.json({ expired: true });
      }

      const newsletter = await storage.getNewsletter(reviewToken.newsletterId);
      if (!newsletter) {
        return res.json({ expired: true });
      }

      const client = await storage.getClient(newsletter.clientId);
      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );
      const html = compileNewsletterToHtml(document);

      res.json({
        newsletter: {
          id: newsletter.id,
          title: newsletter.title,
          clientName: client?.name || "Client",
        },
        html,
        expired: false,
      });
    } catch (error) {
      console.error("Review page error:", error);
      res.status(500).json({ error: "Failed to load review page" });
    }
  });

  app.post("/api/review/:token/approve", async (req: Request, res: Response) => {
    try {
      const reviewToken = await storage.getValidReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }
      const newsletter = await storage.getNewsletter(reviewToken.newsletterId);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!canTransitionNewsletterStatus(newsletter.status as NewsletterStatus, "approved")) {
        return res.status(400).json({
          error: `Cannot approve while newsletter is in '${newsletter.status}' status.`,
        });
      }

      await storage.updateNewsletter(reviewToken.newsletterId, {
        status: "approved",
        scheduledAt: newsletter.status === "scheduled" ? null : newsletter.scheduledAt,
      });

      if (reviewToken.singleUse) {
        await storage.markTokenUsed(reviewToken.id);
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Approval failed" });
    }
  });

  app.post("/api/review/:token/request-changes", async (req: Request, res: Response) => {
    try {
      const { comment, sectionId, commentType } = req.body;
      const reviewToken = await storage.getValidReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }
      const newsletter = await storage.getNewsletter(reviewToken.newsletterId);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!canTransitionNewsletterStatus(newsletter.status as NewsletterStatus, "changes_requested")) {
        return res.status(400).json({
          error: `Cannot request changes while newsletter is in '${newsletter.status}' status.`,
        });
      }
      const users = await storage.getUsers();
      const fallbackCreatedById = newsletter?.createdById || newsletter?.lastEditedById || users[0]?.id;
      if (!fallbackCreatedById) {
        return res.status(500).json({ error: "Unable to resolve author for review comment" });
      }

      const baseComment = {
        newsletterId: reviewToken.newsletterId,
        commentType: normalizeReviewCommentType(commentType),
        content: comment || "Change requested",
        createdById: fallbackCreatedById,
      };
      let reviewComment;
      try {
        reviewComment = await storage.createReviewComment({
          ...baseComment,
          reviewTokenId: reviewToken.id,
          sectionId: sectionId || null,
          attachments: [],
        });
      } catch (insertError) {
        console.warn("Review request-changes fallback insert:", insertError);
        reviewComment = await storage.createReviewComment(baseComment as any);
      }

      await storage.updateNewsletter(reviewToken.newsletterId, {
        status: "changes_requested",
        scheduledAt: newsletter.status === "scheduled" ? null : newsletter.scheduledAt,
      });

      res.json({ success: true, comment: reviewComment });
    } catch (error) {
      console.error("Request changes error:", error);
      res.status(500).json({ error: "Request failed" });
    }
  });

  app.get("/api/review/:token/comments", async (req: Request, res: Response) => {
    try {
      const reviewToken = await storage.getValidReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }

      const comments = await storage.getReviewCommentsByNewsletter(reviewToken.newsletterId);
      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.post("/api/review/:token/comments", async (req: Request, res: Response) => {
    try {
      const { content, sectionId, commentType, attachments } = req.body;
      const reviewToken = await storage.getValidReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }
      const newsletter = await storage.getNewsletter(reviewToken.newsletterId);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!canTransitionNewsletterStatus(newsletter.status as NewsletterStatus, "changes_requested")) {
        return res.status(400).json({
          error: `Cannot request changes while newsletter is in '${newsletter.status}' status.`,
        });
      }
      const users = await storage.getUsers();
      const fallbackCreatedById = newsletter?.createdById || newsletter?.lastEditedById || users[0]?.id;
      if (!fallbackCreatedById) {
        return res.status(500).json({ error: "Unable to resolve author for review comment" });
      }

      const baseComment = {
        newsletterId: reviewToken.newsletterId,
        commentType: normalizeReviewCommentType(commentType),
        content,
        createdById: fallbackCreatedById,
      };
      let comment;
      try {
        comment = await storage.createReviewComment({
          ...baseComment,
          reviewTokenId: reviewToken.id,
          sectionId: sectionId || null,
          attachments: attachments || [],
        });
      } catch (insertError) {
        console.warn("Review comment fallback insert:", insertError);
        comment = await storage.createReviewComment(baseComment as any);
      }

      await storage.updateNewsletter(reviewToken.newsletterId, {
        status: "changes_requested",
        scheduledAt: newsletter.status === "scheduled" ? null : newsletter.scheduledAt,
      });
      res.status(201).json(comment);
    } catch (error) {
      console.error("Create review comment error:", error);
      res.status(500).json({ error: "Failed to create comment" });
    }
  });

  app.get("/api/newsletters/:id/review-comments", requireAuth, async (req: Request, res: Response) => {
    try {
      const comments = await storage.getReviewCommentsByNewsletter(req.params.id);
      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  });

  app.patch("/api/review-comments/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const comment = await storage.updateReviewComment(req.params.id, req.body);
      res.json(comment);
    } catch (error) {
      res.status(500).json({ error: "Failed to update comment" });
    }
  });

  app.post("/api/review-comments/:id/toggle-complete", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const comment = await storage.toggleReviewCommentComplete(req.params.id, userId);
      res.json(comment);
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle comment completion" });
    }
  });

  app.post("/api/newsletters/:id/internal-notes", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const comment = await storage.createReviewComment({
        newsletterId: req.params.id,
        content: req.body.content,
        commentType: "change",
        isInternal: true,
        createdById: userId,
      });
      res.status(201).json(comment);
    } catch (error) {
      res.status(500).json({ error: "Failed to create internal note" });
    }
  });

  app.delete("/api/review-comments/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.deleteReviewComment(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete comment" });
    }
  });

  type QaReportOptions = {
    audienceTag?: unknown;
    provider?: unknown;
    includeAudience?: boolean;
    requireRecipients?: boolean;
  };

  type DeliveryProvider = "postmark" | "mailchimp" | "html_export";
  type SenderProfile = {
    senderVerified: boolean;
    fromEmail: string;
    fromDomain: string;
    clientDomain: string;
    fromDomainMatchesClient: boolean;
    replyTo: string;
    audienceTag: string;
    postmarkServerId?: number | null;
    postmarkMessageStreamId?: string;
    postmarkQualityState?: string;
  };

  const DELIVERY_PROVIDERS: DeliveryProvider[] = ["postmark", "mailchimp", "html_export"];

  const normalizeAudienceTag = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed;
  };

  const normalizeDeliveryProvider = (value: unknown): DeliveryProvider | "" => {
    if (typeof value !== "string") return "";
    const normalized = value.trim().toLowerCase();
    if (normalized === "postmark" || normalized === "mailchimp" || normalized === "html_export") {
      return normalized;
    }
    return "";
  };

  const getEmailDomain = (emailRaw: string): string => {
    const email = String(emailRaw || "").trim().toLowerCase();
    const at = email.lastIndexOf("@");
    if (at <= 0 || at === email.length - 1) return "";
    return email.slice(at + 1);
  };

  const hasUnsubscribeControl = (html: string): boolean => {
    if (!html || !html.trim()) return false;
    return /unsubscribe|{{\s*unsubscribe_?url\s*}}|%UNSUBSCRIBE%/i.test(html);
  };

  const ensureComplianceFooter = (html: string, fromEmail: string): { html: string; injected: boolean } => {
    if (hasUnsubscribeControl(html)) {
      return { html, injected: false };
    }

    const footer = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#6b7280;font-size:12px;line-height:1.5;padding:16px 0;text-align:center;">
        You are receiving this email because you subscribed to updates from ${fromEmail || "our team"}.
        <br />
        <a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
      </div>
    `;

    const closingBodyIndex = html.toLowerCase().lastIndexOf("</body>");
    if (closingBodyIndex >= 0) {
      return {
        html: `${html.slice(0, closingBodyIndex)}${footer}${html.slice(closingBodyIndex)}`,
        injected: true,
      };
    }

    return { html: `${html}${footer}`, injected: true };
  };

  const unsubscribePlaceholderRegex = /{{\s*unsubscribe_?url\s*}}|%UNSUBSCRIBE%/gi;
  const fallbackUnsubscribeUrl = (fromEmail: string, replyTo: string): string => {
    const preferred = String(replyTo || "").trim();
    const fallback = String(fromEmail || "").trim();
    const target = preferred || fallback;
    if (target && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return `mailto:${target}?subject=${encodeURIComponent("Unsubscribe")}`;
    }
    return "https://agentreach-flow.vercel.app";
  };
  const applyUnsubscribeUrl = (html: string, unsubscribeUrl: string): string => {
    if (!html || !html.trim()) return html;
    return html.replace(unsubscribePlaceholderRegex, unsubscribeUrl);
  };

  const resolveAvailableProviders = (brandingKit?: BrandingKit | null): DeliveryProvider[] => {
    const out = new Set<DeliveryProvider>(["postmark", "html_export"]);
    if ((brandingKit?.platform || "").toLowerCase() === "mailchimp") {
      out.add("mailchimp");
    }
    return DELIVERY_PROVIDERS.filter((provider) => out.has(provider));
  };

  const resolveDefaultProvider = (
    requestedProviderRaw: unknown,
    document: NewsletterDocument,
    brandingKit?: BrandingKit | null,
    client?: Client | null
  ): DeliveryProvider => {
    const requestedProvider = normalizeDeliveryProvider(requestedProviderRaw);
    if (requestedProvider) return requestedProvider;

    const docProvider = normalizeDeliveryProvider((document?.meta as any)?.deliveryProvider);
    if (docProvider) return docProvider;

    const clientProvider = normalizeDeliveryProvider((client as any)?.defaultDeliveryProvider);
    if (clientProvider) return clientProvider;

    if ((brandingKit?.platform || "").toLowerCase() === "mailchimp") {
      return "mailchimp";
    }
    return "postmark";
  };

  const resolveAudienceRecipients = async (clientId: string, audienceTagRaw: unknown) => {
    const normalizedTag = normalizeAudienceTag(audienceTagRaw) || "all";
    const contacts = await storage.getContactsByClient(clientId);
    const recipients = contacts.filter((c: any) => {
      if (!c?.isActive) return false;
      if (normalizedTag === "all") return true;
      const tags = Array.isArray(c?.tags) ? c.tags : [];
      return tags.includes(normalizedTag);
    });
    return { audienceTag: normalizedTag, recipients };
  };

  const queueAudienceDeliveries = async (
    newsletterId: string,
    clientId: string,
    audienceTag: string,
    recipients: any[]
  ) => {
    const { db } = await import("./db");
    const { and, eq } = await import("drizzle-orm");
    const { newsletterDeliveries } = await import("@shared/schema");

    await db
      .delete(newsletterDeliveries)
      .where(
        and(
          eq((newsletterDeliveries as any).newsletterId, newsletterId),
          eq((newsletterDeliveries as any).status, "queued")
        )
      );

    if (!recipients.length) return [];

    const rows = recipients
      .map((contact: any) => ({
        newsletterId,
        clientId,
        contactId: contact.id || null,
        email: String(contact?.email || "").trim(),
        audienceTag,
        status: "queued" as const,
        error: null,
        sentAt: null,
        postmarkMessageId: null,
      }))
      .filter((row) => row.email.length > 0);

    if (!rows.length) return [];
    return db.insert(newsletterDeliveries).values(rows as any).returning();
  };

  const buildNewsletterQaReport = async (newsletterId: string, options: QaReportOptions = {}) => {
    const newsletter = await storage.getNewsletter(newsletterId);
    if (!newsletter) return null;

    const client = await storage.getClient(newsletter.clientId);
    const tenant = client ? await readClientPostmarkTenant(newsletter.clientId) : null;
    const brandingKit = client ? await storage.getBrandingKit(newsletter.clientId) : null;
    const versions = await storage.getVersionsByNewsletter(newsletter.id);
    const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
    const document = normalizeNewsletterDocument(
      (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
    );
    const html = compileNewsletterToHtml(document);
    const comments = await storage.getReviewCommentsByNewsletter(newsletter.id);
    const unresolvedClientChanges = comments.filter((c) => !c.isInternal && !c.isCompleted).length;

    const resolvedSubject =
      (newsletter.subject || document.meta?.subject || newsletter.title || "").trim();
    const resolvedPreviewText =
      (newsletter.previewText || document.meta?.previewText || "").trim();
    const resolvedFromEmail =
      (newsletter.fromEmail || document.meta?.fromEmail || client?.primaryEmail || "").trim();
    const resolvedReplyTo =
      (typeof (document.meta as any)?.replyTo === "string" && (document.meta as any).replyTo.trim()) ||
      (brandingKit?.secondaryEmail || brandingKit?.email || client?.secondaryEmail || client?.primaryEmail || "").trim();

    let audienceTag =
      normalizeAudienceTag(options.audienceTag) ||
      normalizeAudienceTag((document as any)?.meta?.audienceTag) ||
      normalizeAudienceTag((client as any)?.defaultAudienceTag) ||
      "all";
    const selectedProvider = resolveDefaultProvider(options.provider, document, brandingKit, client);
    const availableProviders = resolveAvailableProviders(brandingKit);
    const blockers: Array<{ code: string; message: string }> = [];
    const warnings: Array<{ code: string; message: string }> = [];

    const fromDomain = getEmailDomain(resolvedFromEmail);
    const clientDomain = getEmailDomain(client?.primaryEmail || "");
    const fromDomainMatchesClient = !fromDomain || !clientDomain || fromDomain === clientDomain;
    const senderProfile: SenderProfile = {
      senderVerified: !!client?.isVerified,
      fromEmail: resolvedFromEmail,
      fromDomain,
      clientDomain,
      fromDomainMatchesClient,
      replyTo: resolvedReplyTo,
      audienceTag,
      postmarkServerId: tenant?.serverId || client?.postmarkServerId || null,
      postmarkMessageStreamId: tenant?.broadcastStreamId || client?.postmarkMessageStreamId || "",
      postmarkQualityState: String(tenant?.qualityState || client?.postmarkQualityState || "healthy"),
    };

    if (newsletter.status === "sent") {
      blockers.push({
        code: "already_sent",
        message: "This newsletter has already been sent and is locked.",
      });
    }
    if (!senderProfile.senderVerified) {
      const verificationIssue = {
        code: "sender_not_verified",
        message: "Sender email is not verified in Postmark.",
      };
      if (selectedProvider === "postmark") {
        blockers.push(verificationIssue);
      } else {
        warnings.push(verificationIssue);
      }
    }
    if (selectedProvider === "postmark") {
      if (!tenant?.serverToken) {
        blockers.push({
          code: "postmark_tenant_missing",
          message: "Postmark client server is not configured. Run one-click sender setup first.",
        });
      }
      if (String(tenant?.qualityState || client?.postmarkQualityState || "healthy") === "paused") {
        blockers.push({
          code: "deliverability_paused",
          message:
            String(tenant?.autoPauseReason || client?.postmarkAutoPauseReason || "").trim() ||
            "Sending paused by deliverability guardrails.",
        });
      }
    }
    if (!resolvedSubject) {
      blockers.push({
        code: "missing_subject",
        message: "Subject line is required before send/schedule.",
      });
    }
    if (!resolvedFromEmail) {
      blockers.push({
        code: "missing_from_email",
        message: "From email is required before send/schedule.",
      });
    }
    if (!senderProfile.fromDomainMatchesClient) {
      blockers.push({
        code: "from_domain_mismatch",
        message: "From email domain must match the client sender domain.",
      });
    }
    if (!resolvedReplyTo) {
      blockers.push({
        code: "missing_reply_to",
        message: "Reply-to email is required in the sender profile.",
      });
    }
    if (!html || html.trim().length < 50) {
      blockers.push({
        code: "missing_content",
        message: "Newsletter content is empty.",
      });
    }
    if (unresolvedClientChanges > 0) {
      warnings.push({
        code: "pending_change_requests",
        message: `${unresolvedClientChanges} unresolved client change request(s) remain.`,
      });
    }

    const urls = extractUrlsFromHtml(html);
    const invalidUrls = urls.filter((url) => !isLikelyValidUrl(url));
    if (invalidUrls.length > 0) {
      blockers.push({
        code: "malformed_urls",
        message: `Found ${invalidUrls.length} malformed link or media URL(s).`,
      });
    }

    if (!resolvedPreviewText) {
      warnings.push({
        code: "missing_preview_text",
        message: "Preview text is missing.",
      });
    }
    if (resolvedSubject.length > 78) {
      warnings.push({
        code: "subject_too_long",
        message: "Subject line is likely too long for inbox display.",
      });
    }
    if (/<img\b(?![^>]*\balt=)/i.test(html)) {
      warnings.push({
        code: "missing_alt_text",
        message: "One or more images are missing alt text.",
      });
    }
    if (!/{{\s*first_?name\s*}}|%FIRSTNAME%|\[\[\s*first_?name\s*\]\]/i.test(html)) {
      warnings.push({
        code: "low_personalization",
        message: "No first-name personalization token detected.",
      });
    }
    if (!hasUnsubscribeControl(html)) {
      warnings.push({
        code: "missing_unsubscribe_link",
        message: "No unsubscribe control detected. Flow will inject a compliance footer at send time.",
      });
    }
    if (!availableProviders.includes(selectedProvider)) {
      warnings.push({
        code: "provider_not_enabled",
        message: `${selectedProvider} is not enabled for this client. Using postmark instead.`,
      });
    }

    let recipients: any[] = [];
    if (options.includeAudience || options.requireRecipients) {
      const audienceResolution = await resolveAudienceRecipients(newsletter.clientId, audienceTag);
      audienceTag = audienceResolution.audienceTag;
      recipients = audienceResolution.recipients;
      if (options.requireRecipients && recipients.length === 0) {
        blockers.push({
          code: "no_recipients",
          message: `No active contacts found for tag "${audienceTag}".`,
        });
      }
    }
    senderProfile.audienceTag = audienceTag;

    return {
      newsletter,
      client,
      brandingKit,
      document,
      html,
      subject: resolvedSubject,
      previewText: resolvedPreviewText,
      fromEmail: resolvedFromEmail,
      replyTo: resolvedReplyTo,
      blockers,
      warnings,
      canSend: blockers.length === 0,
      audienceTag,
      recipients,
      recipientsCount: recipients.length,
      senderProfile,
      deliveryProvider: availableProviders.includes(selectedProvider) ? selectedProvider : "postmark",
      availableProviders,
    };
  };

  const personalizeNewsletterHtml = (html: string, contact: any): string => {
    const firstName = typeof contact?.firstName === "string" ? contact.firstName : "";
    const lastName = typeof contact?.lastName === "string" ? contact.lastName : "";

    return html
      .replace(/{{\s*first_?name\s*}}/gi, firstName)
      .replace(/{{\s*last_?name\s*}}/gi, lastName)
      .replace(/%FIRSTNAME%/gi, firstName)
      .replace(/\[\[\s*first_?name\s*\]\]/gi, firstName);
  };

  const chunkArray = <T,>(items: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  };

  const buildSendIdempotencyKey = (
    newsletterId: string,
    audienceTag: string,
    provider: DeliveryProvider,
    subject: string,
    fromEmail: string,
    explicitKey?: unknown
  ): string => {
    const explicit = typeof explicitKey === "string" ? explicitKey.trim() : "";
    if (explicit) return explicit;

    return createHash("sha256")
      .update([newsletterId, audienceTag, provider, subject.trim().toLowerCase(), fromEmail.trim().toLowerCase()].join("|"))
      .digest("hex");
  };

  const recordCampaignEvent = async (
    newsletterId: string,
    clientId: string,
    eventType: string,
    payload: Record<string, unknown> = {}
  ) => {
    const { db } = await import("./db");
    const { newsletterEvents } = await import("@shared/schema");
    await db.insert(newsletterEvents).values({
      newsletterId,
      clientId,
      contactId: null,
      email: null,
      postmarkMessageId: null,
      eventType,
      occurredAt: new Date(),
      payload,
    } as any);
  };

  const getExistingSendRun = async (newsletterId: string, idempotencyKey: string) => {
    const { db } = await import("./db");
    const { and, desc, eq, sql } = await import("drizzle-orm");
    const { newsletterEvents } = await import("@shared/schema");
    const rows = await db
      .select()
      .from(newsletterEvents)
      .where(
        and(
          eq((newsletterEvents as any).newsletterId, newsletterId),
          sql`${(newsletterEvents as any).eventType} in ('send_requested', 'send_processing', 'send_completed', 'send_failed')`,
          sql`${(newsletterEvents as any).payload} ->> 'idempotencyKey' = ${idempotencyKey}`
        )
      )
      .orderBy(desc((newsletterEvents as any).createdAt))
      .limit(1);

    const latest = (rows[0] || null) as any;
    if (!latest) return null;
    // Allow re-run when the latest attempt with this key ended in failure.
    if (latest.eventType === "send_failed") return null;
    return latest;
  };

  const enqueueSendJob = async (params: {
    newsletterId: string;
    clientId: string;
    provider: DeliveryProvider;
    audienceTag: string;
    idempotencyKey: string;
    requestedById?: string | null;
    scheduledFor: Date;
    metadata?: Record<string, unknown>;
  }) => {
    const { db } = await import("./db");
    const { newsletterSendJobs } = await import("@shared/schema");
    const { and, eq, desc, or } = await import("drizzle-orm");

    const existing = await db
      .select()
      .from(newsletterSendJobs)
      .where(
        and(
          eq((newsletterSendJobs as any).newsletterId, params.newsletterId),
          eq((newsletterSendJobs as any).idempotencyKey, params.idempotencyKey),
          or(
            eq((newsletterSendJobs as any).status, "queued"),
            eq((newsletterSendJobs as any).status, "processing"),
            eq((newsletterSendJobs as any).status, "completed")
          )
        )
      )
      .orderBy(desc((newsletterSendJobs as any).createdAt))
      .limit(1);
    if (existing.length > 0) {
      return { duplicate: true, job: existing[0] };
    }

    const [job] = await db
      .insert(newsletterSendJobs)
      .values({
        newsletterId: params.newsletterId,
        clientId: params.clientId,
        requestedById: params.requestedById || null,
        provider: params.provider,
        audienceTag: params.audienceTag || "all",
        idempotencyKey: params.idempotencyKey,
        status: "queued",
        scheduledFor: params.scheduledFor,
        metadata: params.metadata || {},
      } as any)
      .returning();

    return { duplicate: false, job };
  };

  const hasActiveSendJobForNewsletter = async (newsletterId: string) => {
    const { db } = await import("./db");
    const { newsletterSendJobs } = await import("@shared/schema");
    const { and, eq, or } = await import("drizzle-orm");
    const rows = await db
      .select({ id: (newsletterSendJobs as any).id })
      .from(newsletterSendJobs)
      .where(
        and(
          eq((newsletterSendJobs as any).newsletterId, newsletterId),
          or(
            eq((newsletterSendJobs as any).status, "queued"),
            eq((newsletterSendJobs as any).status, "processing")
          )
        )
      )
      .limit(1);
    return rows.length > 0;
  };

  const markSendJobState = async (
    jobId: string,
    patch: {
      status: "queued" | "processing" | "completed" | "failed" | "canceled";
      attempts?: number;
      startedAt?: Date | null;
      completedAt?: Date | null;
      lastError?: string | null;
      metadata?: Record<string, unknown>;
    }
  ) => {
    const { db } = await import("./db");
    const { newsletterSendJobs } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [updated] = await db
      .update(newsletterSendJobs)
      .set({
        status: patch.status,
        attempts: patch.attempts,
        startedAt: patch.startedAt === undefined ? undefined : patch.startedAt,
        completedAt: patch.completedAt === undefined ? undefined : patch.completedAt,
        lastError: patch.lastError === undefined ? undefined : patch.lastError,
        metadata: patch.metadata === undefined ? undefined : patch.metadata,
        updatedAt: new Date(),
      } as any)
      .where(eq((newsletterSendJobs as any).id, jobId))
      .returning();
    return updated || null;
  };

  const processSendJob = async (job: any, source: string) => {
    const { db } = await import("./db");
    const { newsletterSendJobs } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");

    const [claimed] = await db
      .update(newsletterSendJobs)
      .set({
        status: "processing",
        startedAt: new Date(),
        attempts: (Number(job.attempts || 0) + 1),
        updatedAt: new Date(),
      } as any)
      .where(
        and(
          eq((newsletterSendJobs as any).id, job.id),
          eq((newsletterSendJobs as any).status, "queued")
        )
      )
      .returning();
    if (!claimed) {
      return { processed: false, skipped: true, reason: "already_claimed" };
    }

    const qa = await buildNewsletterQaReport(job.newsletterId, {
      audienceTag: job.audienceTag,
      provider: job.provider,
      includeAudience: true,
      requireRecipients: true,
    });
    if (!qa) {
      await markSendJobState(job.id, {
        status: "failed",
        completedAt: new Date(),
        lastError: "Newsletter not found.",
      });
      return { processed: false, skipped: true, reason: "missing_newsletter" };
    }

    if (!qa.canSend) {
      const reason = `QA blocked: ${qa.blockers.map((b: any) => b.code).join(", ")}`;
      await markSendJobState(job.id, {
        status: "failed",
        completedAt: new Date(),
        lastError: reason,
      });
      if (qa.newsletter.status === "scheduled") {
        await storage.updateNewsletter(qa.newsletter.id, {
          status: "approved",
          scheduledAt: null,
          lastEditedAt: new Date(),
        });
      }
      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_failed", {
        source,
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey: job.idempotencyKey,
        error: reason,
      });
      return { processed: false, skipped: true, reason: "qa_blocked", blockers: qa.blockers };
    }

    const sendResult = await sendNewsletterViaProvider(
      qa,
      qa.deliveryProvider,
      qa.audienceTag,
      qa.recipients,
      { idempotencyKey: job.idempotencyKey }
    );
    if (!sendResult.ok) {
      const errorMessage = sendResult.error || "Provider send failed";
      await markSendJobState(job.id, {
        status: "failed",
        completedAt: new Date(),
        lastError: errorMessage,
        metadata: {
          ...(job.metadata || {}),
          provider: qa.deliveryProvider,
          audienceTag: qa.audienceTag,
        },
      });
      if (qa.newsletter.status === "scheduled") {
        await storage.updateNewsletter(qa.newsletter.id, {
          status: "approved",
          scheduledAt: null,
          lastEditedAt: new Date(),
        });
      }
      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_failed", {
        source,
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey: job.idempotencyKey,
        error: errorMessage,
      });
      return { processed: false, failed: true, error: errorMessage };
    }

    const sendAt = new Date();
    const nextStatus: NewsletterStatus = qa.deliveryProvider === "postmark" ? "scheduled" : "sent";
    await storage.updateNewsletter(job.newsletterId, {
      status: nextStatus,
      sentAt: nextStatus === "sent" ? sendAt : null,
      scheduledAt: nextStatus === "scheduled" ? sendAt : null,
      sendDate: nextStatus === "sent" ? sendAt.toISOString().split("T")[0] : null,
      subject: qa.subject,
      previewText: qa.previewText || null,
      fromEmail: qa.fromEmail,
      documentJson: {
        ...qa.document,
        meta: {
          ...(qa.document.meta || {}),
          subject: qa.subject,
          previewText: qa.previewText || undefined,
          fromEmail: qa.fromEmail,
          replyTo: qa.replyTo || undefined,
          audienceTag: (sendResult as any).audienceTag || qa.audienceTag,
          deliveryProvider: qa.deliveryProvider,
        },
      },
      lastEditedAt: sendAt,
    });

    await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_processing", {
      source,
      audienceTag: (sendResult as any).audienceTag || qa.audienceTag,
      provider: qa.deliveryProvider,
      idempotencyKey: job.idempotencyKey,
      acceptedCount: (sendResult as any).acceptedCount || 0,
      failedCount: (sendResult as any).failedCount || 0,
      queuedCount: (sendResult as any).queuedCount || 0,
    });

    if (qa.deliveryProvider === "mailchimp") {
      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_completed", {
        source,
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey: job.idempotencyKey,
        acceptedCount: (sendResult as any).acceptedCount || 0,
      });
    } else {
      await syncNewsletterStatusFromDeliveries(qa.newsletter.id);
    }

    await markSendJobState(job.id, {
      status: "completed",
      completedAt: new Date(),
      lastError: null,
      metadata: {
        ...(job.metadata || {}),
        provider: qa.deliveryProvider,
        audienceTag: qa.audienceTag,
        acceptedCount: (sendResult as any).acceptedCount || 0,
        failedCount: (sendResult as any).failedCount || 0,
        queuedCount: (sendResult as any).queuedCount || 0,
      },
    });

    return { processed: true, sendResult, provider: qa.deliveryProvider };
  };

  const processQueuedSendJobs = async (source: string, limit = 10) => {
    const { db } = await import("./db");
    const { newsletterSendJobs } = await import("@shared/schema");
    const { and, asc, eq, lte } = await import("drizzle-orm");
    const now = new Date();
    const jobs = await db
      .select()
      .from(newsletterSendJobs)
      .where(
        and(
          eq((newsletterSendJobs as any).status, "queued"),
          lte((newsletterSendJobs as any).scheduledFor, now)
        )
      )
      .orderBy(asc((newsletterSendJobs as any).scheduledFor), asc((newsletterSendJobs as any).createdAt))
      .limit(Math.max(1, Math.min(limit, 50)));

    const results: any[] = [];
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const result = await processSendJob(job, source);
        results.push({ jobId: job.id, newsletterId: job.newsletterId, ...result });
        if (result.processed) processed += 1;
        else if (result.failed) failed += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        results.push({
          jobId: job.id,
          newsletterId: job.newsletterId,
          processed: false,
          failed: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      dueCount: jobs.length,
      processed,
      skipped,
      failed,
      results,
    };
  };

  const syncNewsletterStatusFromDeliveries = async (newsletterId: string) => {
    const { db } = await import("./db");
    const { eq } = await import("drizzle-orm");
    const { newsletterDeliveries } = await import("@shared/schema");

    const deliveries = await db
      .select()
      .from(newsletterDeliveries)
      .where(eq((newsletterDeliveries as any).newsletterId, newsletterId));

    if (!deliveries.length) return null;

    const newsletter = await storage.getNewsletter(newsletterId);
    if (!newsletter) return null;

    const queuedCount = deliveries.filter((item: any) => item.status === "queued").length;
    const sentCount = deliveries.filter((item: any) => item.status === "sent").length;
    const failedCount = deliveries.filter((item: any) => item.status === "failed").length;
    const bouncedCount = deliveries.filter((item: any) => item.status === "bounced").length;
    const unsubscribedCount = deliveries.filter((item: any) => item.status === "unsubscribed").length;

    const summary = { queuedCount, sentCount, failedCount, bouncedCount, unsubscribedCount };

    if (queuedCount === 0 && sentCount > 0 && newsletter.status !== "sent") {
      const sentAt = new Date();
      await storage.updateNewsletter(newsletterId, {
        status: "sent",
        sentAt,
        scheduledAt: null,
        sendDate: sentAt.toISOString().split("T")[0],
        lastEditedAt: sentAt,
      });
      await recordCampaignEvent(newsletterId, newsletter.clientId, "send_completed", summary);
      await recordDiyFunnelEvent({
        clientId: newsletter.clientId,
        userId: null,
        eventType: "first_send_completed",
        payload: {
          newsletterId,
          sentCount,
          failedCount,
          bouncedCount,
          unsubscribedCount,
        },
        dedupeKey: `first_send_completed:${newsletterId}`,
      });
      return { status: "sent", ...summary };
    }

    if (queuedCount === 0 && sentCount === 0 && (failedCount > 0 || bouncedCount > 0 || unsubscribedCount > 0)) {
      if (newsletter.status === "scheduled") {
        await storage.updateNewsletter(newsletterId, {
          status: "approved",
          scheduledAt: null,
          lastEditedAt: new Date(),
        });
        await recordCampaignEvent(newsletterId, newsletter.clientId, "send_failed", summary);
      }
      return { status: "approved", ...summary };
    }

    return { status: newsletter.status, ...summary };
  };

  const sendNewsletterViaPostmark = async (
    qa: any,
    audienceTag: string,
    recipientsHint: any[] = [],
    options: { idempotencyKey?: string } = {}
  ) => {
    const senderConfig = await getClientPostmarkSenderConfig(qa.newsletter.clientId);
    if (!senderConfig?.serverToken) {
      const ensured = await ensureClientPostmarkInfrastructure(qa.newsletter.clientId);
      if (!ensured.ok) {
        return {
          ok: false,
          error: ensured.error || "Postmark tenant provisioning failed for this client.",
        };
      }
    }

    const latestSenderConfig = await getClientPostmarkSenderConfig(qa.newsletter.clientId);
    const postmarkToken = String(latestSenderConfig?.serverToken || "").trim();
    if (!postmarkToken) {
      return {
        ok: false,
        error: "Client Postmark server is not configured.",
      };
    }
    if (latestSenderConfig?.qualityState === "paused") {
      return {
        ok: false,
        error:
          latestSenderConfig.autoPauseReason ||
          "Sending paused for this client due to deliverability guardrails.",
      };
    }

    const { ServerClient } = await import("postmark");
    const pm = new ServerClient(postmarkToken);
    const messageStream = String(latestSenderConfig?.messageStream || "broadcast").trim() || "broadcast";

    const { db } = await import("./db");
    const { and, eq } = await import("drizzle-orm");
    const { newsletterDeliveries } = await import("@shared/schema");
    const normalizedTag = audienceTag && audienceTag.trim() ? audienceTag.trim() : "all";

    let queuedDeliveries = await db
      .select()
      .from(newsletterDeliveries)
      .where(
        and(
          eq((newsletterDeliveries as any).newsletterId, qa.newsletter.id),
          eq((newsletterDeliveries as any).status, "queued"),
          eq((newsletterDeliveries as any).audienceTag, normalizedTag)
        )
      );

    if (!queuedDeliveries.length) {
      const recipients =
        recipientsHint.length > 0
          ? recipientsHint
          : (await resolveAudienceRecipients(qa.newsletter.clientId, normalizedTag)).recipients;
      if (!recipients.length) {
        return {
          ok: false,
          error: `No active contacts found for tag "${normalizedTag}".`,
        };
      }
      queuedDeliveries = await queueAudienceDeliveries(
        qa.newsletter.id,
        qa.newsletter.clientId,
        normalizedTag,
        recipients
      );
    }
    if (!queuedDeliveries.length) {
      return {
        ok: false,
        error: "No queued recipients available for delivery.",
      };
    }

    const contacts = await storage.getContactsByClient(qa.newsletter.clientId);
    const contactById = new Map(contacts.map((c: any) => [c.id, c]));
    const contactByEmail = new Map(
      contacts
        .filter((c: any) => typeof c?.email === "string" && c.email.trim())
        .map((c: any) => [String(c.email).toLowerCase(), c])
    );

    const complianceHtml = ensureComplianceFooter(qa.html, qa.fromEmail);
    const unsubscribeUrl = fallbackUnsubscribeUrl(qa.fromEmail, qa.replyTo || "");
    let acceptedCount = 0;
    let failedCount = 0;

    // Postmark batch API accepts up to 500 messages per call.
    const batches = chunkArray(queuedDeliveries as any[], 500);
    for (const batchDeliveries of batches) {
      const batchMessages = batchDeliveries.map((delivery: any) => {
        const contact =
          contactById.get(delivery.contactId) ||
          contactByEmail.get(String(delivery.email || "").toLowerCase()) ||
          null;
        return {
          From: qa.fromEmail,
          ReplyTo: qa.replyTo || undefined,
          To: delivery.email,
          Subject: qa.subject,
          HtmlBody: applyUnsubscribeUrl(
            personalizeNewsletterHtml(complianceHtml.html, contact),
            unsubscribeUrl
          ),
          MessageStream: messageStream,
          TrackOpens: true,
          TrackLinks: "HtmlAndText",
          Tag: qa.newsletter.id,
          Metadata: {
            newsletterId: qa.newsletter.id,
            clientId: qa.newsletter.clientId,
            contactId: delivery.contactId || contact?.id || null,
            audienceTag: normalizedTag,
            idempotencyKey: options.idempotencyKey || null,
          },
        };
      });

      const results = await pm.sendEmailBatch(batchMessages as any);
      const now = new Date();
      const writeOps = [];
      for (let i = 0; i < batchDeliveries.length; i++) {
        const delivery = batchDeliveries[i];
        const result = (results as any[])?.[i] || {};
        const errorCode = typeof result?.ErrorCode === "number" ? result.ErrorCode : 0;
        const isFailed = errorCode !== 0;
        const postmarkMessageId = typeof result?.MessageID === "string" ? result.MessageID : null;
        const message = typeof result?.Message === "string" ? result.Message : null;

        if (isFailed) failedCount += 1;
        else acceptedCount += 1;

        writeOps.push(
          db
            .update(newsletterDeliveries)
            .set({
              status: isFailed ? "failed" : "queued",
              error: isFailed ? message : null,
              postmarkMessageId,
              sentAt: null,
            } as any)
            .where(eq((newsletterDeliveries as any).id, delivery.id))
        );
      }
      if (writeOps.length) {
        await Promise.all(writeOps);
      }
    }

    return {
      ok: true,
      error: null,
      audienceTag: normalizedTag,
      complianceFooterInjected: complianceHtml.injected,
      recipientsCount: queuedDeliveries.length,
      acceptedCount,
      failedCount,
      queuedCount: acceptedCount,
    };
  };

  const sendNewsletterViaMailchimp = async (
    qa: any,
    audienceTag: string,
    _recipientsHint: any[] = []
  ) => {
    const apiKey = (process.env.MAILCHIMP_API_KEY || "").trim();
    const serverPrefix = (process.env.MAILCHIMP_SERVER_PREFIX || "").trim();
    const listId = (qa.brandingKit?.platformAccountName || "").trim();
    if (!apiKey || !serverPrefix || !listId) {
      return {
        ok: false,
        error:
          "Mailchimp delivery is not configured for this client. Set MAILCHIMP_API_KEY, MAILCHIMP_SERVER_PREFIX, and client Mailchimp audience/list id.",
      };
    }

    const complianceHtml = ensureComplianceFooter(qa.html, qa.fromEmail);
    const auth = `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`;
    const base = `https://${serverPrefix}.api.mailchimp.com/3.0`;

    const campaignResponse = await fetch(`${base}/campaigns`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "regular",
        recipients: { list_id: listId },
        settings: {
          subject_line: qa.subject,
          from_name: qa.client?.name || "Flow",
          reply_to: qa.replyTo || qa.fromEmail,
        },
      }),
    });
    const campaignPayload = await campaignResponse.json().catch(() => ({}));
    if (!campaignResponse.ok || typeof campaignPayload?.id !== "string") {
      return {
        ok: false,
        error: `Mailchimp campaign create failed: ${campaignPayload?.detail || campaignResponse.statusText}`,
      };
    }

    const campaignId = campaignPayload.id as string;
    const contentResponse = await fetch(`${base}/campaigns/${campaignId}/content`, {
      method: "PUT",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        html: complianceHtml.html,
      }),
    });
    if (!contentResponse.ok) {
      const detail = await contentResponse.text();
      return {
        ok: false,
        error: `Mailchimp content update failed: ${detail || contentResponse.statusText}`,
      };
    }

    const sendResponse = await fetch(`${base}/campaigns/${campaignId}/actions/send`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
    });
    if (!sendResponse.ok) {
      const detail = await sendResponse.text();
      return {
        ok: false,
        error: `Mailchimp send failed: ${detail || sendResponse.statusText}`,
      };
    }

    return {
      ok: true,
      error: null,
      provider: "mailchimp",
      audienceTag,
      campaignId,
      complianceFooterInjected: complianceHtml.injected,
      recipientsCount: qa.recipientsCount,
      acceptedCount: qa.recipientsCount,
      failedCount: 0,
      queuedCount: qa.recipientsCount,
    };
  };

  const sendNewsletterViaProvider = async (
    qa: any,
    provider: DeliveryProvider,
    audienceTag: string,
    recipientsHint: any[] = [],
    options: { idempotencyKey?: string } = {}
  ) => {
    if (provider === "html_export") {
      const complianceHtml = ensureComplianceFooter(qa.html, qa.fromEmail);
      return {
        ok: true,
        error: null,
        provider: "html_export" as const,
        exportOnly: true,
        audienceTag,
        html: complianceHtml.html,
        complianceFooterInjected: complianceHtml.injected,
        recipientsCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        queuedCount: 0,
      };
    }
    if (provider === "mailchimp") {
      return sendNewsletterViaMailchimp(qa, audienceTag, recipientsHint);
    }
    return sendNewsletterViaPostmark(qa, audienceTag, recipientsHint, options);
  };

  app.post("/api/newsletters/:id/qa-check", requireAuth, async (req: Request, res: Response) => {
    try {
      const qa = await buildNewsletterQaReport(req.params.id);
      if (!qa) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, qa.newsletter.clientId, "newsletter.send"))) return;
      res.json({
        blockers: qa.blockers,
        warnings: qa.warnings,
        canSend: qa.canSend,
      });
    } catch (error) {
      console.error("QA check error:", error);
      res.status(500).json({ error: "Failed to run QA check" });
    }
  });

  // Used by the send/schedule confirmation UI to show QA results and recipient count before sending.
  app.post("/api/newsletters/:id/send-preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const requestedAudienceTag = normalizeAudienceTag(req.body.audienceTag) || normalizeAudienceTag(req.body.segmentTag);
      const requestedProvider = normalizeDeliveryProvider(req.body.provider);
      const qa = await buildNewsletterQaReport(req.params.id, {
        audienceTag: requestedAudienceTag,
        provider: requestedProvider,
        includeAudience: true,
      });
      if (!qa) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, qa.newsletter.clientId, "newsletter.send"))) return;

      res.json({
        newsletterId: qa.newsletter.id,
        status: qa.newsletter.status,
        audienceTag: qa.audienceTag,
        recipientsCount: qa.recipientsCount,
        blockers: qa.blockers,
        warnings: qa.warnings,
        canSend: qa.canSend,
        subject: qa.subject,
        previewText: qa.previewText,
        fromEmail: qa.fromEmail,
        replyTo: qa.replyTo || "",
        senderProfile: qa.senderProfile,
        deliveryProvider: qa.deliveryProvider,
        availableProviders: qa.availableProviders,
      });
    } catch (error) {
      console.error("Send preview error:", error);
      res.status(500).json({ error: "Failed to build send preview" });
    }
  });

  app.post("/api/newsletters/:id/send-test", requireAuth, async (req: Request, res: Response) => {
    try {
      const toEmail = typeof req.body?.toEmail === "string" ? req.body.toEmail.trim() : "";
      if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        return res.status(400).json({ error: "Valid toEmail is required." });
      }

      const qa = await buildNewsletterQaReport(req.params.id);
      if (!qa) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, qa.newsletter.clientId, "newsletter.send"))) return;
      const diyGuard = await enforceDiySendGuard(req, qa, "test");
      if (!diyGuard.ok) {
        return res.status(diyGuard.status).json(diyGuard.payload);
      }

      const softWarningCodes = new Set([
        "sender_not_verified",
        "malformed_urls",
        "from_domain_mismatch",
        "postmark_tenant_missing",
        "deliverability_paused",
      ]);
      const blockers = qa.blockers.filter((blocker) => !softWarningCodes.has(blocker.code));
      const warnings = [
        ...qa.warnings,
        ...qa.blockers
          .filter((blocker) => softWarningCodes.has(blocker.code))
          .map((blocker) =>
            blocker.code === "malformed_urls"
              ? {
                  ...blocker,
                  message: `${blocker.message} Test email will still send, but fix URLs before schedule/send.`,
                }
              : blocker
          ),
      ];
      if (blockers.length > 0) {
        await logSupportAuditAction(req, "newsletter_test_send_blocked", qa.newsletter.clientId, {
          newsletterId: qa.newsletter.id,
          toEmail,
          blockerCodes: blockers.map((blocker) => blocker.code),
          warningCodes: warnings.map((warning) => warning.code),
        });
        return res.status(400).json({
          error: "Cannot send test email until blockers are resolved.",
          blockers,
          warnings,
        });
      }

      const senderConfig = await getClientPostmarkSenderConfig(qa.newsletter.clientId);
      if (!senderConfig?.serverToken) {
        const ensured = await ensureClientPostmarkInfrastructure(qa.newsletter.clientId);
        if (!ensured.ok) {
          return res.status(400).json({
            error: ensured.error || "Client Postmark server is not configured.",
          });
        }
      }
      const refreshedSenderConfig = await getClientPostmarkSenderConfig(qa.newsletter.clientId);
      const postmarkToken = String(refreshedSenderConfig?.serverToken || "").trim();
      if (!postmarkToken) {
        return res.status(400).json({
          error: "Client Postmark server is not configured.",
        });
      }

      const { ServerClient } = await import("postmark");
      const pm = new ServerClient(postmarkToken);
      const messageStream =
        String(refreshedSenderConfig?.messageStream || qa.senderProfile?.postmarkMessageStreamId || "broadcast").trim() ||
        "broadcast";
      const testSubject = `[TEST] ${qa.subject}`;
      let fromEmailForTest = qa.fromEmail;
      if (qa.blockers.some((blocker) => blocker.code === "from_domain_mismatch") && qa.client?.primaryEmail) {
        fromEmailForTest = qa.client.primaryEmail;
        warnings.push({
          code: "from_email_overridden_for_test",
          message: `Using ${fromEmailForTest} for test send because the configured From domain did not match client sender domain.`,
        });
      }
      const complianceHtml = ensureComplianceFooter(qa.html, fromEmailForTest);
      const unsubscribeUrl = fallbackUnsubscribeUrl(fromEmailForTest, qa.replyTo || "");
      const htmlBody = applyUnsubscribeUrl(personalizeNewsletterHtml(complianceHtml.html, {
        firstName: "Test",
        lastName: "Recipient",
      }), unsubscribeUrl);

      const sendResult = await pm.sendEmail({
        From: fromEmailForTest,
        ReplyTo: qa.replyTo || undefined,
        To: toEmail,
        Subject: testSubject,
        HtmlBody: htmlBody,
        MessageStream: messageStream,
        TrackOpens: true,
        TrackLinks: "HtmlAndText",
        Tag: `${qa.newsletter.id}-test`,
        Metadata: {
          newsletterId: qa.newsletter.id,
          clientId: qa.newsletter.clientId,
          type: "test_send",
        },
      } as any);

      const { db } = await import("./db");
      const { newsletterEvents } = await import("@shared/schema");
      await db.insert(newsletterEvents).values({
        newsletterId: qa.newsletter.id,
        clientId: qa.newsletter.clientId,
        contactId: null,
        email: toEmail,
        postmarkMessageId:
          typeof (sendResult as any)?.MessageID === "string" ? (sendResult as any).MessageID : null,
        eventType: "test_sent",
        occurredAt: new Date(),
        payload: {
          type: "test_send",
          toEmail,
          subject: testSubject,
          complianceFooterInjected: complianceHtml.injected,
        },
      } as any);
      await logSupportAuditAction(req, "newsletter_test_sent", qa.newsletter.clientId, {
        newsletterId: qa.newsletter.id,
        toEmail,
        fromEmail: fromEmailForTest,
        warningCodes: warnings.map((warning) => warning.code),
      });
      if ((req as AuthedRequest).currentUser.accountType === "diy_customer") {
        await recordDiyFunnelEvent({
          clientId: qa.newsletter.clientId,
          userId: (req as Request & { userId: string }).userId,
          eventType: "test_sent",
          payload: {
            newsletterId: qa.newsletter.id,
            toEmail,
          },
          dedupeKey: `test_sent:${qa.newsletter.id}:${toEmail.toLowerCase()}`,
        });
      }

      res.json({
        ok: true,
        toEmail,
        fromEmail: fromEmailForTest,
        status: "test_sent",
        warnings,
        complianceFooterInjected: complianceHtml.injected,
      });
    } catch (error) {
      console.error("Send test error:", error);
      const detailedMessage =
        error instanceof Error
          ? error.message
          : typeof (error as any)?.message === "string"
            ? String((error as any).message)
            : "";
      res.status(500).json({
        error: detailedMessage
          ? `Failed to send test email: ${detailedMessage}`
          : "Failed to send test email",
      });
    }
  });

  app.post("/api/newsletters/:id/schedule", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const requestedAudienceTag = normalizeAudienceTag(req.body.audienceTag) || normalizeAudienceTag(req.body.segmentTag);
      const requestedProvider = normalizeDeliveryProvider(req.body.provider);
      const qa = await buildNewsletterQaReport(req.params.id, {
        audienceTag: requestedAudienceTag,
        provider: requestedProvider,
        includeAudience: true,
        requireRecipients: true,
      });
      if (!qa) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, qa.newsletter.clientId, "newsletter.send"))) return;
      const diyGuard = await enforceDiySendGuard(req, qa, "schedule");
      if (!diyGuard.ok) {
        return res.status(diyGuard.status).json(diyGuard.payload);
      }
      if (!canTransitionNewsletterStatus(qa.newsletter.status as NewsletterStatus, "scheduled")) {
        return res.status(400).json({
          error: "Newsletter is not in a schedulable state.",
          status: qa.newsletter.status,
        });
      }
      if (!qa.canSend) {
        await logSupportAuditAction(req, "newsletter_schedule_blocked", qa.newsletter.clientId, {
          newsletterId: qa.newsletter.id,
          blockerCodes: qa.blockers.map((blocker) => blocker.code),
        });
        return res.status(400).json({
          error: "Newsletter has blocking QA issues.",
          blockers: qa.blockers,
          warnings: qa.warnings,
        });
      }

      if (qa.deliveryProvider === "html_export") {
        return res.status(400).json({
          error: "HTML export provider cannot be scheduled. Use Send Now to generate export output.",
          blockers: qa.blockers,
          warnings: qa.warnings,
        });
      }

      const sendMode = normalizeSendMode(req.body.sendMode) || qa.newsletter.sendMode || "ai_recommended";
      const timezone = typeof req.body.timezone === "string" && req.body.timezone.trim()
        ? req.body.timezone.trim()
        : qa.newsletter.timezone || "America/New_York";
      const requestedDate = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (req.body.scheduledAt && (!requestedDate || Number.isNaN(requestedDate.getTime()))) {
        return res.status(400).json({ error: "Invalid schedule time." });
      }
      const fallbackDate = qa.newsletter.expectedSendDate
        ? new Date(`${qa.newsletter.expectedSendDate}T09:00:00`)
        : new Date();
      let scheduledAt = requestedDate && !Number.isNaN(requestedDate.getTime()) ? requestedDate : fallbackDate;
      if (scheduledAt.getTime() < Date.now()) {
        if (requestedDate) {
          return res.status(400).json({
            error: "Schedule time must be in the future.",
            blockers: qa.blockers,
            warnings: qa.warnings,
          });
        }
        scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      }

      if (qa.recipientsCount === 0) {
        return res.status(400).json({
          error: `No active contacts found for tag "${qa.audienceTag}".`,
          blockers: qa.blockers,
          warnings: qa.warnings,
        });
      }
      if (await hasActiveSendJobForNewsletter(qa.newsletter.id)) {
        return res.status(409).json({
          error: "A queued/processing send job already exists for this newsletter.",
          status: qa.newsletter.status,
        });
      }
      const queuedRecipients = await queueAudienceDeliveries(
        qa.newsletter.id,
        qa.newsletter.clientId,
        qa.audienceTag,
        qa.recipients
      );
      const idempotencyKey = buildSendIdempotencyKey(
        qa.newsletter.id,
        qa.audienceTag,
        qa.deliveryProvider,
        qa.subject,
        qa.fromEmail,
        req.body.idempotencyKey
      );

      const nextDoc = {
        ...qa.document,
        meta: {
          ...(qa.document.meta || {}),
          subject: qa.subject,
          previewText: qa.previewText || undefined,
          fromEmail: qa.fromEmail,
          replyTo: qa.replyTo || undefined,
          sendMode,
          timezone,
          audienceTag: qa.audienceTag,
          deliveryProvider: qa.deliveryProvider,
        },
      };

      const updated = await storage.updateNewsletter(req.params.id, {
        status: "scheduled",
        scheduledAt,
        sendMode,
        timezone,
        subject: qa.subject,
        previewText: qa.previewText || null,
        fromEmail: qa.fromEmail,
        documentJson: nextDoc,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      const enqueued = await enqueueSendJob({
        newsletterId: qa.newsletter.id,
        clientId: qa.newsletter.clientId,
        provider: qa.deliveryProvider,
        audienceTag: qa.audienceTag,
        idempotencyKey,
        requestedById: userId,
        scheduledFor: scheduledAt,
        metadata: {
          source: "schedule",
        },
      });

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_scheduled", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        scheduledAt: scheduledAt.toISOString(),
        queuedCount: queuedRecipients.length,
        idempotencyKey,
        sendJobId: enqueued.job?.id || null,
      });
      await logSupportAuditAction(req, "newsletter_scheduled", qa.newsletter.clientId, {
        newsletterId: qa.newsletter.id,
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        queuedCount: queuedRecipients.length,
        scheduledAt: scheduledAt.toISOString(),
      });
      if ((req as AuthedRequest).currentUser.accountType === "diy_customer") {
        await recordDiyFunnelEvent({
          clientId: qa.newsletter.clientId,
          userId,
          eventType: "first_send_scheduled",
          payload: {
            newsletterId: qa.newsletter.id,
            provider: qa.deliveryProvider,
            queuedCount: queuedRecipients.length,
            scheduledAt: scheduledAt.toISOString(),
          },
          dedupeKey: `first_send_scheduled:${qa.newsletter.id}`,
        });
      }

      res.json({
        newsletter: updated,
        blockers: qa.blockers,
        warnings: qa.warnings,
        canSend: true,
        queuedCount: queuedRecipients.length,
        provider: qa.deliveryProvider,
        idempotencyKey,
        sendJob: enqueued.job || null,
        duplicate: !!enqueued.duplicate,
      });
    } catch (error) {
      console.error("Schedule newsletter error:", error);
      res.status(500).json({ error: "Failed to schedule newsletter" });
    }
  });

  app.post("/api/newsletters/:id/send-now", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const requestedAudienceTag = normalizeAudienceTag(req.body.audienceTag) || normalizeAudienceTag(req.body.segmentTag);
      const requestedProvider = normalizeDeliveryProvider(req.body.provider);
      const qa = await buildNewsletterQaReport(req.params.id, {
        audienceTag: requestedAudienceTag,
        provider: requestedProvider,
        includeAudience: true,
        requireRecipients: true,
      });
      if (!qa) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!(await ensureWorkspaceCapability(req, res, qa.newsletter.clientId, "newsletter.send"))) return;
      const diyGuard = await enforceDiySendGuard(req, qa, "send_now");
      if (!diyGuard.ok) {
        return res.status(diyGuard.status).json(diyGuard.payload);
      }
      const requiresScheduledTransition = qa.deliveryProvider === "postmark";
      const transitionTarget: NewsletterStatus = requiresScheduledTransition ? "scheduled" : "sent";
      if (!canTransitionNewsletterStatus(qa.newsletter.status as NewsletterStatus, transitionTarget)) {
        return res.status(400).json({
          error: "Newsletter is not in a sendable state.",
          status: qa.newsletter.status,
          provider: qa.deliveryProvider,
        });
      }
      if (!qa.canSend) {
        await logSupportAuditAction(req, "newsletter_send_now_blocked", qa.newsletter.clientId, {
          newsletterId: qa.newsletter.id,
          blockerCodes: qa.blockers.map((blocker) => blocker.code),
        });
        return res.status(400).json({
          error: "Newsletter has blocking QA issues.",
          blockers: qa.blockers,
          warnings: qa.warnings,
        });
      }

      const idempotencyKey = buildSendIdempotencyKey(
        qa.newsletter.id,
        qa.audienceTag,
        qa.deliveryProvider,
        qa.subject,
        qa.fromEmail,
        req.body.idempotencyKey
      );
      const existingRun = await getExistingSendRun(qa.newsletter.id, idempotencyKey);
      if (existingRun) {
        return res.json({
          duplicate: true,
          idempotencyKey,
          provider: qa.deliveryProvider,
          status: qa.newsletter.status,
          message: "Send request already in progress or completed for this idempotency key.",
        });
      }

      if (qa.deliveryProvider === "html_export") {
        const exportResult = await sendNewsletterViaProvider(
          qa,
          qa.deliveryProvider,
          qa.audienceTag,
          qa.recipients,
          { idempotencyKey }
        );
        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "export_generated", {
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
          complianceFooterInjected: (exportResult as any).complianceFooterInjected || false,
        });
        return res.json({
          newsletter: qa.newsletter,
          blockers: qa.blockers,
          warnings: qa.warnings,
          canSend: true,
          provider: qa.deliveryProvider,
          idempotencyKey,
          send: exportResult,
        });
      }

      if (qa.deliveryProvider === "postmark") {
        if (await hasActiveSendJobForNewsletter(qa.newsletter.id)) {
          return res.json({
            duplicate: true,
            idempotencyKey,
            provider: qa.deliveryProvider,
            status: qa.newsletter.status,
            message: "A queued/processing send job already exists for this newsletter.",
          });
        }

        const queuedRecipients = await queueAudienceDeliveries(
          qa.newsletter.id,
          qa.newsletter.clientId,
          qa.audienceTag,
          qa.recipients
        );

        const sendAt = new Date();
        const updated = await storage.updateNewsletter(req.params.id, {
          status: "scheduled",
          sentAt: null,
          scheduledAt: sendAt,
          subject: qa.subject,
          previewText: qa.previewText || null,
          fromEmail: qa.fromEmail,
          documentJson: {
            ...qa.document,
            meta: {
              ...(qa.document.meta || {}),
              subject: qa.subject,
              previewText: qa.previewText || undefined,
              fromEmail: qa.fromEmail,
              replyTo: qa.replyTo || undefined,
              audienceTag: qa.audienceTag,
              deliveryProvider: qa.deliveryProvider,
            },
          },
          lastEditedById: userId,
          lastEditedAt: sendAt,
        });

        const enqueued = await enqueueSendJob({
          newsletterId: qa.newsletter.id,
          clientId: qa.newsletter.clientId,
          provider: qa.deliveryProvider,
          audienceTag: qa.audienceTag,
          idempotencyKey,
          requestedById: userId,
          scheduledFor: sendAt,
          metadata: {
            source: "send_now",
          },
        });

        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_requested", {
          source: "send_now",
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
        });
        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_enqueued", {
          source: "send_now",
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
          queuedCount: queuedRecipients.length,
          sendJobId: enqueued.job?.id || null,
        });
        await logSupportAuditAction(req, "newsletter_send_now_enqueued", qa.newsletter.clientId, {
          newsletterId: qa.newsletter.id,
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          queuedCount: queuedRecipients.length,
          sendJobId: enqueued.job?.id || null,
        });
        if ((req as AuthedRequest).currentUser.accountType === "diy_customer") {
          await recordDiyFunnelEvent({
            clientId: qa.newsletter.clientId,
            userId,
            eventType: "first_send_scheduled",
            payload: {
              newsletterId: qa.newsletter.id,
              provider: qa.deliveryProvider,
              queuedCount: queuedRecipients.length,
              scheduledAt: sendAt.toISOString(),
              source: "send_now",
            },
            dedupeKey: `first_send_scheduled:${qa.newsletter.id}`,
          });
        }

        return res.json({
          newsletter: updated,
          blockers: qa.blockers,
          warnings: qa.warnings,
          canSend: true,
          idempotencyKey,
          provider: qa.deliveryProvider,
          queuedCount: queuedRecipients.length,
          queued: true,
          sendJob: enqueued.job || null,
          duplicate: !!enqueued.duplicate,
        });
      }

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_requested", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey,
      });

      const sendResult = await sendNewsletterViaProvider(
        qa,
        qa.deliveryProvider,
        qa.audienceTag,
        qa.recipients,
        { idempotencyKey }
      );
      if (!sendResult.ok) {
        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_failed", {
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
          error: sendResult.error || "Provider send failed",
        });
        await logSupportAuditAction(req, "newsletter_send_now_failed", qa.newsletter.clientId, {
          newsletterId: qa.newsletter.id,
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          error: sendResult.error || "Provider send failed",
        });
        return res.status(400).json({
          error: sendResult.error || "Failed to send via selected provider",
          blockers: qa.blockers,
          warnings: qa.warnings,
        });
      }

      const sendAt = new Date();
      const nextDoc = {
        ...qa.document,
        meta: {
          ...(qa.document.meta || {}),
          subject: qa.subject,
          previewText: qa.previewText || undefined,
          fromEmail: qa.fromEmail,
          replyTo: qa.replyTo || undefined,
          sendMode: qa.newsletter.sendMode || "ai_recommended",
          timezone: qa.newsletter.timezone || "America/New_York",
          audienceTag: (sendResult as any).audienceTag || qa.audienceTag,
          deliveryProvider: qa.deliveryProvider,
        },
      };

      const nextStatus: NewsletterStatus = "sent";
      const updated = await storage.updateNewsletter(req.params.id, {
        status: nextStatus,
        sentAt: nextStatus === "sent" ? sendAt : null,
        // Keep immediate sends out of cron's due queue to avoid duplicate sends.
        scheduledAt: null,
        sendDate: nextStatus === "sent" ? sendAt.toISOString().split("T")[0] : null,
        subject: qa.subject,
        previewText: qa.previewText || null,
        fromEmail: qa.fromEmail,
        documentJson: nextDoc,
        lastEditedById: userId,
        lastEditedAt: sendAt,
      });

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_processing", {
        audienceTag: (sendResult as any).audienceTag || qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey,
        acceptedCount: (sendResult as any).acceptedCount || 0,
        failedCount: (sendResult as any).failedCount || 0,
        queuedCount: (sendResult as any).queuedCount || 0,
      });

      if (qa.deliveryProvider === "mailchimp") {
        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_completed", {
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
          acceptedCount: (sendResult as any).acceptedCount || 0,
        });
      } else {
        await syncNewsletterStatusFromDeliveries(qa.newsletter.id);
      }
      await logSupportAuditAction(req, "newsletter_send_now_completed", qa.newsletter.clientId, {
        newsletterId: qa.newsletter.id,
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        acceptedCount: (sendResult as any).acceptedCount || 0,
        failedCount: (sendResult as any).failedCount || 0,
      });
      if ((req as AuthedRequest).currentUser.accountType === "diy_customer") {
        await recordDiyFunnelEvent({
          clientId: qa.newsletter.clientId,
          userId,
          eventType: "first_send_completed",
          payload: {
            newsletterId: qa.newsletter.id,
            provider: qa.deliveryProvider,
            acceptedCount: (sendResult as any).acceptedCount || 0,
            failedCount: (sendResult as any).failedCount || 0,
            source: "send_now",
          },
          dedupeKey: `first_send_completed:${qa.newsletter.id}`,
        });
      }

      res.json({
        newsletter: updated,
        blockers: qa.blockers,
        warnings: qa.warnings,
        canSend: true,
        idempotencyKey,
        provider: qa.deliveryProvider,
        send: sendResult,
      });
    } catch (error) {
      console.error("Send newsletter error:", error);
      res.status(500).json({ error: "Failed to send newsletter" });
    }
  });

  app.post("/api/newsletters/:id/retry-failed", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const requestedAudienceTag = normalizeAudienceTag(req.body.audienceTag) || normalizeAudienceTag(req.body.segmentTag);
      const requestedProvider = normalizeDeliveryProvider(req.body.provider);
      const qa = await buildNewsletterQaReport(req.params.id, {
        audienceTag: requestedAudienceTag,
        provider: requestedProvider,
        includeAudience: true,
      });
      if (!qa) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (qa.deliveryProvider !== "postmark") {
        return res.status(400).json({
          error: "Retry failed is currently supported for Postmark delivery only.",
          provider: qa.deliveryProvider,
        });
      }
      if (await hasActiveSendJobForNewsletter(qa.newsletter.id)) {
        return res.status(409).json({
          error: "A queued/processing send job already exists for this newsletter.",
        });
      }

      const { db } = await import("./db");
      const { and, eq, inArray } = await import("drizzle-orm");
      const { newsletterDeliveries } = await import("@shared/schema");
      const failedRows = await db
        .select()
        .from(newsletterDeliveries)
        .where(
          and(
            eq((newsletterDeliveries as any).newsletterId, qa.newsletter.id),
            inArray((newsletterDeliveries as any).status, ["failed", "bounced"])
          )
        );
      if (!failedRows.length) {
        return res.status(400).json({ error: "No failed recipients available to retry." });
      }

      const idempotencyKey = buildSendIdempotencyKey(
        qa.newsletter.id,
        qa.audienceTag,
        qa.deliveryProvider,
        qa.subject,
        qa.fromEmail,
        typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey : `${Date.now()}-retry`
      );

      const existingRun = await getExistingSendRun(qa.newsletter.id, idempotencyKey);
      if (existingRun) {
        return res.json({
          duplicate: true,
          idempotencyKey,
          provider: qa.deliveryProvider,
          message: "Retry already in progress or completed for this idempotency key.",
        });
      }

      const failedIds = failedRows.map((row: any) => row.id);
      await db
        .update(newsletterDeliveries)
        .set({
          status: "queued",
          error: null,
          postmarkMessageId: null,
          sentAt: null,
        } as any)
        .where(inArray((newsletterDeliveries as any).id, failedIds));

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_retry_requested", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey,
        retryCount: failedRows.length,
      });

      const now = new Date();
      const updated = await storage.updateNewsletter(qa.newsletter.id, {
        status: "scheduled",
        // Retry is queued immediately and processed by the send queue worker.
        scheduledAt: now,
        sentAt: null,
        sendDate: null,
        documentJson: {
          ...qa.document,
          meta: {
            ...(qa.document.meta || {}),
            subject: qa.subject,
            previewText: qa.previewText || undefined,
            fromEmail: qa.fromEmail,
            replyTo: qa.replyTo || undefined,
            audienceTag: qa.audienceTag,
            deliveryProvider: qa.deliveryProvider,
          },
        },
        lastEditedById: userId,
        lastEditedAt: now,
      });

      const enqueued = await enqueueSendJob({
        newsletterId: qa.newsletter.id,
        clientId: qa.newsletter.clientId,
        provider: qa.deliveryProvider,
        audienceTag: qa.audienceTag,
        idempotencyKey,
        requestedById: userId,
        scheduledFor: now,
        metadata: {
          source: "retry_failed",
          retryCount: failedRows.length,
        },
      });

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_enqueued", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey,
        queuedCount: failedRows.length,
        retryCount: failedRows.length,
        sendJobId: enqueued.job?.id || null,
      });

      res.json({
        ok: true,
        newsletter: updated,
        provider: qa.deliveryProvider,
        idempotencyKey,
        retriedCount: failedRows.length,
        queued: true,
        duplicate: !!enqueued.duplicate,
        sendJob: enqueued.job || null,
      });
    } catch (error) {
      console.error("Retry failed delivery error:", error);
      res.status(500).json({ error: "Failed to retry failed deliveries" });
    }
  });

  app.get("/api/newsletters/:id/analytics", requireAuth, async (req: Request, res: Response) => {
    try {
      const { db } = await import("./db");
      const { newsletterDeliveries, newsletterEvents } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");

      const deliveries = await db
        .select()
        .from(newsletterDeliveries)
        .where(eq((newsletterDeliveries as any).newsletterId, req.params.id))
        .orderBy(desc((newsletterDeliveries as any).createdAt));

      const events = await db
        .select()
        .from(newsletterEvents)
        .where(eq((newsletterEvents as any).newsletterId, req.params.id))
        .orderBy(desc((newsletterEvents as any).createdAt));

      const countsByType: Record<string, number> = {};
      const uniqueOpenMessageIds = new Set<string>();
      const uniqueClickMessageIds = new Set<string>();
      for (const ev of events as any[]) {
        const t = typeof ev?.eventType === "string" ? ev.eventType : "unknown";
        countsByType[t] = (countsByType[t] || 0) + 1;
        const mid = typeof ev?.postmarkMessageId === "string" ? ev.postmarkMessageId : "";
        if (mid) {
          if (t.includes("open")) uniqueOpenMessageIds.add(mid);
          if (t.includes("click")) uniqueClickMessageIds.add(mid);
        }
      }

      const sentCount = (deliveries as any[]).filter((d) => d.status === "sent").length;
      const queuedCount = (deliveries as any[]).filter((d) => d.status === "queued").length;
      const failedCount = (deliveries as any[]).filter((d) => d.status === "failed").length;
      const bouncedCount = (deliveries as any[]).filter((d) => d.status === "bounced").length;
      const unsubCount = (deliveries as any[]).filter((d) => d.status === "unsubscribed").length;

      res.json({
        deliveriesCount: (deliveries as any[]).length,
        sentCount,
        queuedCount,
        failedCount,
        bouncedCount,
        unsubscribedCount: unsubCount,
        eventsCount: (events as any[]).length,
        countsByType,
        uniqueOpens: uniqueOpenMessageIds.size,
        uniqueClicks: uniqueClickMessageIds.size,
        openRate: sentCount > 0 ? uniqueOpenMessageIds.size / sentCount : 0,
        clickRate: sentCount > 0 ? uniqueClickMessageIds.size / sentCount : 0,
        recentEvents: (events as any[]).slice(0, 50),
      });
    } catch (error) {
      console.error("Analytics fetch error:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // Campaign + contact-level timeline (deliveries + events).
  app.get("/api/newsletters/:id/timeline", requireAuth, async (req: Request, res: Response) => {
    try {
      const { db } = await import("./db");
      const { newsletterDeliveries, newsletterEvents } = await import("@shared/schema");
      const { eq, asc } = await import("drizzle-orm");

      const deliveries = await db
        .select()
        .from(newsletterDeliveries)
        .where(eq((newsletterDeliveries as any).newsletterId, req.params.id))
        .orderBy(asc((newsletterDeliveries as any).createdAt));

      const events = await db
        .select()
        .from(newsletterEvents)
        .where(eq((newsletterEvents as any).newsletterId, req.params.id))
        .orderBy(asc((newsletterEvents as any).createdAt));

      const byEmail = new Map<string, any>();
      for (const d of deliveries as any[]) {
        const key = String(d.email || "").toLowerCase();
        if (!key) continue;
        byEmail.set(key, {
          contactId: d.contactId || null,
          email: d.email,
          status: d.status,
          postmarkMessageId: d.postmarkMessageId || null,
          audienceTag: d.audienceTag || "all",
          sentAt: d.sentAt || null,
          events: [],
        });
      }

      for (const ev of events as any[]) {
        const key = String(ev.email || "").toLowerCase();
        if (!key) continue;
        if (!byEmail.has(key)) {
          byEmail.set(key, {
            contactId: ev.contactId || null,
            email: ev.email,
            status: null,
            postmarkMessageId: ev.postmarkMessageId || null,
            audienceTag: "all",
            sentAt: null,
            events: [],
          });
        }
        byEmail.get(key).events.push({
          eventType: ev.eventType,
          occurredAt: ev.occurredAt,
          postmarkMessageId: ev.postmarkMessageId || null,
        });
      }

      const campaignEvents = (events as any[])
        .filter((ev) => typeof ev?.eventType === "string" && ev.eventType.startsWith("send_"))
        .map((ev) => ({
          id: ev.id,
          eventType: ev.eventType,
          occurredAt: ev.occurredAt || ev.createdAt,
          payload: ev.payload || {},
        }));

      const summary = {
        queued: (deliveries as any[]).filter((item) => item.status === "queued").length,
        sent: (deliveries as any[]).filter((item) => item.status === "sent").length,
        failed: (deliveries as any[]).filter((item) => item.status === "failed").length,
        bounced: (deliveries as any[]).filter((item) => item.status === "bounced").length,
        unsubscribed: (deliveries as any[]).filter((item) => item.status === "unsubscribed").length,
      };

      res.json({
        newsletterId: req.params.id,
        summary,
        campaignEvents,
        contacts: Array.from(byEmail.values()),
      });
    } catch (error) {
      console.error("Timeline fetch error:", error);
      res.status(500).json({ error: "Failed to fetch timeline" });
    }
  });

  app.get("/api/newsletters/:id/send-jobs", requireAuth, async (req: Request, res: Response) => {
    try {
      const { db } = await import("./db");
      const { newsletterSendJobs } = await import("@shared/schema");
      const { desc, eq } = await import("drizzle-orm");
      const jobs = await db
        .select()
        .from(newsletterSendJobs)
        .where(eq((newsletterSendJobs as any).newsletterId, req.params.id))
        .orderBy(desc((newsletterSendJobs as any).createdAt))
        .limit(30);
      res.json(jobs);
    } catch (error) {
      console.error("Send jobs fetch error:", error);
      res.status(500).json({ error: "Failed to fetch send jobs" });
    }
  });

  // Cron/automation hook to send scheduled newsletters. Configure this with Vercel Cron or an external scheduler.
  // Vercel Cron invokes this endpoint via HTTP GET and will automatically include:
  // Authorization: Bearer ${CRON_SECRET}
  const sendDueNewslettersCronHandler = async (req: Request, res: Response) => {
    try {
      const expected = String(process.env.CRON_SECRET || process.env.FLOW_CRON_SECRET || "").trim();
      const authorization = (req.headers["authorization"] as string) || "";
      // Never allow this endpoint unauthenticated in production; it can trigger sends.
      if (!expected && process.env.NODE_ENV === "production") {
        return res.status(500).json({
          error: "Cron auth is not configured.",
          code: "cron_secret_missing",
          requiredEnv: ["CRON_SECRET"],
          acceptedFallbackEnv: ["FLOW_CRON_SECRET"],
        });
      }
      if (expected) {
        const expectedHeader = `Bearer ${expected}`;
        if (authorization !== expectedHeader) {
          return res.status(401).json({ error: "Unauthorized", code: "invalid_cron_auth" });
        }
      }

      const dueNewsletters = (await storage.getNewslettersByStatus(["scheduled"] as any)).filter((n: any) => {
        if (!n?.scheduledAt) return false;
        const when = new Date(n.scheduledAt);
        return !Number.isNaN(when.getTime()) && when.getTime() <= Date.now();
      });

      let enqueued = 0;
      let skipped = 0;
      let failed = 0;
      const enqueueResults: any[] = [];
      for (const nl of dueNewsletters) {
        try {
          const qa = await buildNewsletterQaReport(nl.id, {
            provider: normalizeDeliveryProvider((nl.documentJson as any)?.meta?.deliveryProvider),
            includeAudience: true,
            requireRecipients: true,
          });
          if (!qa) {
            skipped += 1;
            enqueueResults.push({ newsletterId: nl.id, skipped: true, reason: "missing_newsletter" });
            continue;
          }
          if (!qa.canSend) {
            skipped += 1;
            enqueueResults.push({
              newsletterId: nl.id,
              skipped: true,
              reason: "qa_blocked",
              blockers: qa.blockers.map((b) => b.code),
            });
            continue;
          }

          if (await hasActiveSendJobForNewsletter(qa.newsletter.id)) {
            skipped += 1;
            enqueueResults.push({
              newsletterId: qa.newsletter.id,
              skipped: true,
              reason: "existing_active_send_job",
            });
            continue;
          }

          await queueAudienceDeliveries(
            qa.newsletter.id,
            qa.newsletter.clientId,
            qa.audienceTag,
            qa.recipients
          );

          const scheduledAtDate = nl.scheduledAt ? new Date(nl.scheduledAt) : new Date();
          const scheduleNonce = scheduledAtDate.toISOString();
          const idempotencyKey = buildSendIdempotencyKey(
            qa.newsletter.id,
            qa.audienceTag,
            qa.deliveryProvider,
            qa.subject,
            qa.fromEmail,
            `scheduled-${scheduleNonce}`
          );
          const queuedJob = await enqueueSendJob({
            newsletterId: qa.newsletter.id,
            clientId: qa.newsletter.clientId,
            provider: qa.deliveryProvider,
            audienceTag: qa.audienceTag,
            idempotencyKey,
            requestedById: null,
            scheduledFor: scheduledAtDate,
            metadata: {
              source: "cron_due",
            },
          });

          if (!queuedJob.duplicate) {
            enqueued += 1;
            await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_requested", {
              source: "cron_due",
              audienceTag: qa.audienceTag,
              provider: qa.deliveryProvider,
              idempotencyKey,
            });
            await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_enqueued", {
              source: "cron_due",
              audienceTag: qa.audienceTag,
              provider: qa.deliveryProvider,
              idempotencyKey,
              queuedCount: qa.recipientsCount,
              sendJobId: queuedJob.job?.id || null,
            });
          }

          enqueueResults.push({
            newsletterId: qa.newsletter.id,
            provider: qa.deliveryProvider,
            idempotencyKey,
            duplicate: !!queuedJob.duplicate,
            sendJobId: queuedJob.job?.id || null,
          });
        } catch (error) {
          failed += 1;
          enqueueResults.push({
            newsletterId: nl.id,
            failed: true,
            reason: "enqueue_exception",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const workerSummary = await processQueuedSendJobs("cron", Number(process.env.SEND_WORKER_CRON_BATCH || 10));
      res.json({
        ok: true,
        dueCount: dueNewsletters.length,
        enqueued,
        skipped,
        failed,
        enqueueResults,
        worker: workerSummary,
      });
    } catch (error) {
      console.error("Cron send-due error:", error);
      const detail = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Failed to send due newsletters", detail });
    }
  };

  app.get("/api/internal/cron/send-due-newsletters", sendDueNewslettersCronHandler);
  // Keep POST for internal/manual triggers.
  app.post("/api/internal/cron/send-due-newsletters", sendDueNewslettersCronHandler);

  const processSendQueueCronHandler = async (req: Request, res: Response) => {
    try {
      const expected = String(process.env.CRON_SECRET || process.env.FLOW_CRON_SECRET || "").trim();
      const authorization = (req.headers["authorization"] as string) || "";
      if (!expected && process.env.NODE_ENV === "production") {
        return res.status(500).json({
          error: "Cron auth is not configured.",
          code: "cron_secret_missing",
          requiredEnv: ["CRON_SECRET"],
          acceptedFallbackEnv: ["FLOW_CRON_SECRET"],
        });
      }
      if (expected) {
        const expectedHeader = `Bearer ${expected}`;
        if (authorization !== expectedHeader) {
          return res.status(401).json({ error: "Unauthorized", code: "invalid_cron_auth" });
        }
      }

      const requestedLimit = Number(req.query?.limit || req.body?.limit || process.env.SEND_WORKER_CRON_BATCH || 10);
      const summary = await processQueuedSendJobs("cron_queue", requestedLimit);
      res.json({ ok: true, ...summary });
    } catch (error) {
      console.error("Cron send-queue error:", error);
      const detail = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Failed to process send queue", detail });
    }
  };

  app.get("/api/internal/cron/process-send-queue", processSendQueueCronHandler);
  app.post("/api/internal/cron/process-send-queue", processSendQueueCronHandler);

  app.post("/api/newsletters/:id/send-for-review", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }
      if (!canTransitionNewsletterStatus(newsletter.status as NewsletterStatus, "in_review")) {
        return res.status(400).json({
          error: `Cannot move newsletter from '${newsletter.status}' to in_review.`,
        });
      }

      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await storage.createReviewToken({
        newsletterId: newsletter.id,
        token,
        expiresAt,
        singleUse: true,
      });

      await storage.updateNewsletter(newsletter.id, {
        status: "in_review",
        scheduledAt: newsletter.status === "scheduled" ? null : newsletter.scheduledAt,
      });

      const reviewUrl = `${req.protocol}://${req.get("host")}/review/${token}`;

      res.json({ success: true, reviewUrl });
    } catch (error) {
      res.status(500).json({ error: "Failed to send for review" });
    }
  });

  app.post("/api/newsletters/:id/restore/:versionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const targetVersion = versions.find((v) => v.id === req.params.versionId);
      if (!targetVersion) {
        return res.status(404).json({ error: "Version not found" });
      }

      const restoredDoc = normalizeNewsletterDocument(targetVersion.snapshotJson as NewsletterDocument);
      const latestNum = await storage.getLatestVersionNumber(newsletter.id);

      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: restoredDoc,
        createdById: userId,
        changeSummary: `Restored from v${targetVersion.versionNumber}`,
      });

      const updated = await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: restoredDoc,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      const html = compileNewsletterToHtml(restoredDoc);

      res.json({ newsletter: updated, html, version: newVersion });
    } catch (error) {
      res.status(500).json({ error: "Failed to restore version" });
    }
  });

  app.get("/api/newsletters/:id/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = normalizeNewsletterDocument(
        (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument
      );
      const html = compileNewsletterToHtml(document);
      const format = req.query.format as string || "html";
      const safeTitle = newsletter.title.replace(/[^a-z0-9]/gi, '_');

      if (format === "pdf" || format === "png") {
        res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "image/png");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${format}"`);
        res.send(html);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.html"`);
        res.send(html);
      }
    } catch (error) {
      res.status(500).json({ error: "Export failed" });
    }
  });

  // ============================================================================
  // PROJECTS
  // ============================================================================
  app.get("/api/clients/:clientId/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const projects = await storage.getProjectsByClient(req.params.clientId);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "Failed to get projects" });
    }
  });

  app.post("/api/clients/:clientId/projects", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const { name, description, templateId } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Project name required" });
      }
      const project = await storage.createProject({
        clientId: req.params.clientId,
        name,
        description,
        templateId,
        status: "active",
      });
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.get("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to get project" });
    }
  });

  app.patch("/api/projects/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const project = await storage.updateProject(req.params.id, req.body);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  // ============================================================================
  // HTML TEMPLATES
  // ============================================================================
  app.get("/api/templates", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const templates = await storage.getTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to get templates" });
    }
  });

  app.post("/api/templates", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const userId = (req as Request & { userId: string }).userId;
      const { name, description, html, category, isDefault, thumbnail } = req.body;
      if (!name || !html) {
        return res.status(400).json({ error: "Name and HTML required" });
      }
      const template = await storage.createTemplate({
        name,
        description,
        html,
        category: category || "custom",
        isDefault: isDefault || false,
        thumbnail,
        createdById: userId,
      });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.get("/api/templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const template = await storage.getTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to get template" });
    }
  });

  app.patch("/api/templates/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const template = await storage.updateTemplate(req.params.id, req.body);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  // ============================================================================
  // PRODUCTION TASKS
  // ============================================================================
  app.get("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      const tasks = await storage.getProductionTasks();
      const visible = scopedClientId
        ? tasks.filter((task) => task.clientId === scopedClientId)
        : tasks;
      res.json(visible);
    } catch (error) {
      res.status(500).json({ error: "Failed to get tasks" });
    }
  });

  app.post("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      if (scopedClientId && req.body?.clientId && req.body.clientId !== scopedClientId) {
        return res.status(403).json({ error: "Forbidden for this workspace" });
      }
      const userId = (req as Request & { userId: string }).userId;
      const task = await storage.createProductionTask({
        ...req.body,
        clientId: scopedClientId || req.body?.clientId || null,
        createdById: userId,
      });
      res.status(201).json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const scopedClientId = (req as AuthedRequest).scopedClientId;
      if (scopedClientId && req.body?.clientId && req.body.clientId !== scopedClientId) {
        return res.status(403).json({ error: "Forbidden for this workspace" });
      }
      const task = await storage.updateProductionTask(req.params.id, req.body);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      await storage.deleteProductionTask(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.get("/api/gmail/status", requireAuth, async (_req, res) => {
    try {
      const { isGmailConnected } = await import("./gmail-service");
      const connected = await isGmailConnected();
      res.json({ connected });
    } catch {
      res.json({ connected: false });
    }
  });

  app.get("/api/integrations/ai-status", requireAuth, async (_req, res) => {
    const geminiConfigured = Boolean(
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY || process.env.GEMINI_API_KEY
    );
    const openaiConfigured = Boolean(
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    );
    const postmarkConfigured = Boolean(
      process.env.POSTMARK_ACCOUNT_API_TOKEN || process.env.POSTMARK_SERVER_TOKEN
    );

    res.json({
      geminiConfigured,
      openaiConfigured,
      postmarkConfigured,
    });
  });

  app.get("/api/clients/:clientId/emails", requireAuth, async (req, res) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) return res.status(404).json({ error: "Client not found" });

      const { searchEmailsByContact } = await import("./gmail-service");
      const emails = await searchEmailsByContact(client.primaryEmail, 30);
      res.json(emails);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch emails" });
    }
  });

  app.get("/api/gmail/threads/:threadId", requireAuth, async (req, res) => {
    try {
      const { getEmailThread } = await import("./gmail-service");
      const thread = await getEmailThread(req.params.threadId);
      res.json(thread);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch thread" });
    }
  });

  // ============================================================================
  // STRIPE INTEGRATION
  // ============================================================================

  const createDiyCheckoutSession = async (
    req: Request,
    stripe: any,
    currentUser: User,
    returnPath: string = "/billing"
  ) => {
    const priceId = String(process.env.STRIPE_DIY_PRICE_ID || "").trim();
    if (!priceId) {
      const error = new Error(
        "DIY checkout is not configured. Set STRIPE_DIY_PRICE_ID to enable self-serve billing."
      );
      (error as Error & { status?: number }).status = 503;
      throw error;
    }

    const host = req.get("host");
    const baseUrl = host ? `${req.protocol}://${host}` : normalizeBaseUrl(req);
    const successUrl = `${baseUrl}${returnPath}?checkout=success`;
    const cancelUrl = `${baseUrl}${returnPath}?checkout=cancel`;

    return stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: currentUser.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: currentUser.id,
        clientId: currentUser.diyClientId,
        accountType: currentUser.accountType,
        planCode: DIY_MONTHLY_PLAN.code,
      },
    });
  };

  app.post("/api/diy/billing/portal", requireAuth, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as AuthedRequest).currentUser;
      if (currentUser.accountType !== "diy_customer") {
        return res.status(403).json({ error: "DIY access only" });
      }
      if (!currentUser.diyClientId) {
        return res.status(409).json({ error: "DIY workspace is not configured." });
      }

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      let customerId: string | null = null;

      const clientSubscriptions = await storage.getSubscriptionsByClient(currentUser.diyClientId);
      const subscriptionWithStripe = clientSubscriptions.find(
        (subscription) => typeof subscription.stripeSubscriptionId === "string" && subscription.stripeSubscriptionId.trim().length > 0
      );

      if (subscriptionWithStripe?.stripeSubscriptionId) {
        try {
          const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionWithStripe.stripeSubscriptionId);
          if (stripeSubscription && !("deleted" in stripeSubscription) && typeof stripeSubscription.customer === "string") {
            customerId = stripeSubscription.customer;
          }
        } catch (error) {
          console.warn("DIY billing portal: failed to resolve customer from subscription", error);
        }
      }

      if (!customerId) {
        const customers = await stripe.customers.list({
          email: currentUser.email,
          limit: 10,
        });
        const exactMatch = customers.data.find(
          (customer: any) => String(customer?.email || "").trim().toLowerCase() === currentUser.email.toLowerCase()
        );
        customerId = (exactMatch || customers.data[0])?.id || null;
      }

      if (customerId) {
        const host = req.get("host");
        const baseUrl = host ? `${req.protocol}://${host}` : normalizeBaseUrl(req);
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${baseUrl}/billing`,
        });
        return res.json({
          mode: "portal",
          url: portalSession.url,
        });
      }

      const checkoutSession = await createDiyCheckoutSession(req, stripe, currentUser);
      return res.json({
        mode: "checkout",
        url: checkoutSession.url,
      });
    } catch (error: any) {
      const status = (error as Error & { status?: number }).status || 500;
      console.error("DIY billing portal error:", error);
      res.status(status).json({ error: error?.message || "Failed to open billing portal" });
    }
  });

  app.post("/api/diy/billing/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as AuthedRequest).currentUser;
      if (currentUser.accountType !== "diy_customer") {
        return res.status(403).json({ error: "DIY access only" });
      }
      if (!currentUser.diyClientId) {
        return res.status(409).json({ error: "DIY workspace is not configured." });
      }

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      const session = await createDiyCheckoutSession(req, stripe, currentUser);

      res.json({
        url: session.url,
      });
    } catch (error: any) {
      console.error("DIY billing checkout error:", error);
      res.status(500).json({ error: "Failed to start checkout session" });
    }
  });

  app.get("/api/stripe/publishable-key", requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getStripePublishableKey } = await import("./stripeClient");
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error: any) {
      console.error("Failed to get Stripe publishable key:", error);
      res.status(500).json({ error: "Failed to get Stripe configuration" });
    }
  });

  app.post("/api/stripe/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const { invoiceId } = req.body;
      if (!invoiceId) {
        return res.status(400).json({ error: "invoiceId is required" });
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (!ensureClientAccess(req, res, invoice.clientId)) return;
      if (invoice.status === "paid") {
        return res.status(400).json({ error: "Invoice is already paid" });
      }

      const client = await storage.getClient(invoice.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: client.primaryEmail,
        line_items: [{
          price_data: {
            currency: (invoice.currency || 'usd').toLowerCase(),
            product_data: {
              name: `Invoice #${invoice.id.slice(0, 8)} - ${client.name}`,
            },
            unit_amount: Math.round(Number(invoice.amount) * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.protocol}://${req.get('host')}/invoices?paid=${invoiceId}`,
        cancel_url: `${req.protocol}://${req.get('host')}/invoices`,
        metadata: {
          invoiceId: invoice.id,
          clientId: client.id,
        },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  app.get("/api/stripe/products", requireAuth, async (_req: Request, res: Response) => {
    try {
      if ((_req as AuthedRequest).currentUser.accountType === "diy_customer") {
        return res.status(403).json({ error: "Internal access only" });
      }
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const result = await db.execute(
        sql`SELECT p.id, p.name, p.description, p.metadata, p.active,
            pr.id as price_id, pr.unit_amount, pr.currency, pr.recurring
            FROM stripe.products p
            LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
            WHERE p.active = true
            ORDER BY p.name`
      );
      res.json({ data: result.rows });
    } catch (error: any) {
      console.error("Failed to fetch Stripe products:", error);
      res.json({ data: [] });
    }
  });

  app.post("/api/stripe/pull-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      const userId = (req as Request & { userId: string }).userId;
      const requestedProductId =
        typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
      const requestedPriceId =
        typeof req.body?.priceId === "string" ? req.body.priceId.trim() : "";
      const requestedCustomerEmail =
        typeof req.body?.customerEmail === "string" ? req.body.customerEmail.trim().toLowerCase() : "";
      const dateRange = parseStripeDateRangeFilters(
        req.body?.fromDate ?? req.body?.from,
        req.body?.toDate ?? req.body?.to
      );
      if (dateRange.error) {
        return res.status(400).json({ error: dateRange.error });
      }
      const needsLineItemFilter = !!requestedProductId || !!requestedPriceId;
      const [clients, invoices, subscriptions] = await Promise.all([
        storage.getClients(),
        storage.getAllInvoices(),
        storage.getAllSubscriptions(),
      ]);

      const clientByEmail = new Map(
        clients
          .filter((c) => !!c.primaryEmail)
          .map((c) => [c.primaryEmail.trim().toLowerCase(), c])
      );
      const existingStripeOrderIds = new Set(
        invoices.map((invoice) => invoice.stripePaymentId).filter((id): id is string => !!id)
      );
      const activeSubscriptionByClient = new Map(
        subscriptions
          .filter((subscription) => subscription.status === "active")
          .map((subscription) => [subscription.clientId, subscription])
      );

      const sessions = await stripe.checkout.sessions.list({
        limit: 100,
        expand: ["data.customer"],
      });

      let importedCount = 0;
      let skippedCount = 0;
      let filteredOutCount = 0;

      for (const session of sessions.data) {
        const sessionCreatedMs = (session.created || 0) * 1000;
        if (dateRange.fromMs !== null && sessionCreatedMs < dateRange.fromMs) {
          filteredOutCount += 1;
          continue;
        }
        if (dateRange.toMs !== null && sessionCreatedMs > dateRange.toMs) {
          filteredOutCount += 1;
          continue;
        }

        const expandedCustomer =
          typeof session.customer !== "string" && session.customer && "deleted" in session.customer && session.customer.deleted
            ? null
            : (typeof session.customer !== "string" ? session.customer : null);
        const customerEmail =
          session.customer_details?.email ||
          expandedCustomer?.email ||
          null;
        if (!customerEmail) {
          skippedCount += 1;
          continue;
        }
        if (requestedCustomerEmail && customerEmail.trim().toLowerCase() !== requestedCustomerEmail) {
          filteredOutCount += 1;
          continue;
        }

        if (needsLineItemFilter) {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
          const matchesFilter = lineItems.data.some((item) => {
            const priceId = typeof item.price === "string" ? item.price : item.price?.id || "";
            const productId =
              typeof item.price !== "string" && item.price?.product
                ? (typeof item.price.product === "string" ? item.price.product : item.price.product.id)
                : "";
            if (requestedPriceId && priceId !== requestedPriceId) return false;
            if (requestedProductId && productId !== requestedProductId) return false;
            return true;
          });
          if (!matchesFilter) {
            filteredOutCount += 1;
            continue;
          }
        }

        const client = clientByEmail.get(customerEmail.trim().toLowerCase());
        if (!client) {
          skippedCount += 1;
          continue;
        }

        const paymentIntentId =
          (typeof session.payment_intent === "string" && session.payment_intent) ||
          (typeof session.payment_intent !== "string" && session.payment_intent?.id) ||
          "";
        const sessionId = session.id || "";
        const dedupeIds = [paymentIntentId, sessionId].filter((id): id is string => !!id);
        if (dedupeIds.some((id) => existingStripeOrderIds.has(id))) {
          skippedCount += 1;
          continue;
        }
        const stripePaymentId = paymentIntentId || sessionId;

        const amount = ((session.amount_total || 0) / 100).toFixed(2);
        const currency = (session.currency || "usd").toUpperCase();
        const status = "paid";
        const paidAt = new Date((session.created || Math.floor(Date.now() / 1000)) * 1000);

        const activeSubscription = activeSubscriptionByClient.get(client.id);

        const invoice = await storage.createInvoice({
          clientId: client.id,
          subscriptionId: activeSubscription?.id || null,
          amount,
          currency,
          status,
          stripePaymentId,
          paidAt,
        });
        if (invoice.subscriptionId) {
          await createDraftNewsletterForInvoice(invoice.id, userId, null);
        }
        for (const dedupeId of dedupeIds) {
          existingStripeOrderIds.add(dedupeId);
        }
        importedCount += 1;
      }

      res.json({
        success: true,
        scanned: sessions.data.length,
        importedCount,
        skippedCount,
        filteredOutCount,
        filters: {
          productId: requestedProductId || null,
          priceId: requestedPriceId || null,
          customerEmail: requestedCustomerEmail || null,
          fromDate: dateRange.fromDate || null,
          toDate: dateRange.toDate || null,
        },
      });
    } catch (error: any) {
      console.error("Stripe order pull error:", error);
      res.status(500).json({ error: error?.message || "Failed to pull orders from Stripe" });
    }
  });

  app.post("/api/stripe/pull-subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!requireInternalOperator(req, res)) return;
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      const requestedProductId =
        typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
      const requestedPriceId =
        typeof req.body?.priceId === "string" ? req.body.priceId.trim() : "";
      const requestedCustomerEmail =
        typeof req.body?.customerEmail === "string" ? req.body.customerEmail.trim().toLowerCase() : "";
      const dateRange = parseStripeDateRangeFilters(
        req.body?.fromDate ?? req.body?.from,
        req.body?.toDate ?? req.body?.to
      );
      if (dateRange.error) {
        return res.status(400).json({ error: dateRange.error });
      }
      const [clients, subscriptions] = await Promise.all([
        storage.getClients(),
        storage.getAllSubscriptions(),
      ]);

      const clientByEmail = new Map(
        clients
          .filter((c) => !!c.primaryEmail)
          .map((c) => [c.primaryEmail.trim().toLowerCase(), c])
      );
      const existingByStripeId = new Map(
        subscriptions
          .filter((sub) => !!sub.stripeSubscriptionId)
          .map((sub) => [sub.stripeSubscriptionId as string, sub])
      );

      const stripeSubscriptions = await stripe.subscriptions.list({
        limit: 100,
        status: "all",
        expand: ["data.customer"],
      });

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let filteredOutCount = 0;
      const touchedClientIds = new Set<string>();

      const toLocalFrequency = (interval?: string | null, intervalCount?: number | null): "weekly" | "biweekly" | "monthly" => {
        if (interval === "week" && intervalCount === 2) return "biweekly";
        if (interval === "week") return "weekly";
        return "monthly";
      };

      const toLocalStatus = (stripeStatus: string): "active" | "paused" | "canceled" | "past_due" => {
        if (stripeStatus === "active" || stripeStatus === "trialing") return "active";
        if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
        if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") return "canceled";
        return "paused";
      };

      for (const sub of stripeSubscriptions.data) {
        const subAny = sub as any;
        const periodStartTs =
          subAny.current_period_start || sub.start_date || sub.created || null;
        const periodEndTs =
          subAny.current_period_end || subAny.cancel_at || periodStartTs || null;
        const periodStartMs = periodStartTs ? periodStartTs * 1000 : null;
        const periodEndMs = periodEndTs ? periodEndTs * 1000 : periodStartMs;

        if (dateRange.fromMs !== null || dateRange.toMs !== null) {
          const effectiveStartMs = periodStartMs ?? periodEndMs ?? 0;
          const effectiveEndMs = periodEndMs ?? periodStartMs ?? effectiveStartMs;
          const outsideFrom = dateRange.fromMs !== null && effectiveEndMs < dateRange.fromMs;
          const outsideTo = dateRange.toMs !== null && effectiveStartMs > dateRange.toMs;
          if (outsideFrom || outsideTo) {
            filteredOutCount += 1;
            continue;
          }
        }

        const expandedCustomer =
          typeof sub.customer !== "string" && sub.customer && "deleted" in sub.customer && sub.customer.deleted
            ? null
            : (typeof sub.customer !== "string" ? sub.customer : null);
        const customerEmail =
          expandedCustomer?.email ||
          null;
        if (!customerEmail) {
          skippedCount += 1;
          continue;
        }
        if (requestedCustomerEmail && customerEmail.trim().toLowerCase() !== requestedCustomerEmail) {
          filteredOutCount += 1;
          continue;
        }

        const client = clientByEmail.get(customerEmail.trim().toLowerCase());
        if (!client) {
          skippedCount += 1;
          continue;
        }

        const hasMatchingLine = sub.items.data.some((item) => {
          const priceId = item.price?.id || "";
          const productId =
            item.price?.product
              ? (typeof item.price.product === "string" ? item.price.product : item.price.product.id)
              : "";
          if (requestedPriceId && priceId !== requestedPriceId) return false;
          if (requestedProductId && productId !== requestedProductId) return false;
          return true;
        });
        if ((requestedPriceId || requestedProductId) && !hasMatchingLine) {
          filteredOutCount += 1;
          continue;
        }

        const price = sub.items.data[0]?.price;
        const amount = ((price?.unit_amount || 0) / 100).toFixed(2);
        const frequency = toLocalFrequency(price?.recurring?.interval, price?.recurring?.interval_count || 1);
        const status = toLocalStatus(sub.status);
        const startTs = periodStartTs;
        const endTs = periodEndTs;
        const startDate = startTs
          ? new Date(startTs * 1000).toISOString().slice(0, 10)
          : null;
        const endDate = endTs
          ? new Date(endTs * 1000).toISOString().slice(0, 10)
          : null;

        const existing = existingByStripeId.get(sub.id);
        if (existing) {
          const updated = await storage.updateSubscription(existing.id, {
            amount,
            currency: (price?.currency || "usd").toUpperCase(),
            frequency,
            status,
            startDate,
            endDate,
          });
          if (updated?.status === "active") {
            await ensureSubscriptionHasInvoice(updated.id);
          }
          updatedCount += 1;
        } else {
          const created = await storage.createSubscription({
            clientId: client.id,
            amount,
            currency: (price?.currency || "usd").toUpperCase(),
            frequency,
            status,
            stripeSubscriptionId: sub.id,
            startDate,
            endDate,
          });
          existingByStripeId.set(sub.id, created);
          if (created.status === "active") {
            await ensureSubscriptionHasInvoice(created.id);
          }
          createdCount += 1;
        }
        touchedClientIds.add(client.id);
      }

      await Promise.all(
        Array.from(touchedClientIds).map((clientId) =>
          storage.recalculateClientSubscriptionStatus(clientId)
        )
      );

      res.json({
        success: true,
        scanned: stripeSubscriptions.data.length,
        createdCount,
        updatedCount,
        skippedCount,
        filteredOutCount,
        filters: {
          productId: requestedProductId || null,
          priceId: requestedPriceId || null,
          customerEmail: requestedCustomerEmail || null,
          fromDate: dateRange.fromDate || null,
          toDate: dateRange.toDate || null,
        },
      });
    } catch (error: any) {
      console.error("Stripe subscription pull error:", error);
      res.status(500).json({ error: error?.message || "Failed to pull subscriptions from Stripe" });
    }
  });

  const runInProcessWorker =
    process.env.ENABLE_SEND_QUEUE_WORKER !== "0" &&
    process.env.NODE_ENV !== "test";
  if (runInProcessWorker) {
    const intervalMs = Math.max(30000, Number(process.env.SEND_WORKER_INTERVAL_MS || 45000));
    const batchSize = Math.max(1, Number(process.env.SEND_WORKER_BATCH || 5));
    const timer = setInterval(() => {
      processQueuedSendJobs("interval", batchSize).catch((error) => {
        console.error("In-process send queue worker failed:", error);
      });
    }, intervalMs);
    if (typeof (timer as any).unref === "function") {
      (timer as any).unref();
    }
  }

  return httpServer;
}
