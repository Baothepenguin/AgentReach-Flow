import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { compileNewsletterToHtml } from "./email-compiler";
import { processHtmlCommand } from "./ai-service";
import { generateEmailFromPrompt, editEmailWithAI, suggestSubjectLines } from "./gemini-email-service";
import { renderMjml, validateMjml } from "./mjml-service";
import { createSenderSignature, getSenderSignature } from "./postmark-service";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
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
  type NewsletterDocument,
  type LegacyNewsletterDocument,
  type NewsletterStatus,
} from "@shared/schema";
import { createHash, randomUUID } from "crypto";
import session from "express-session";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import { addDays, addWeeks, addMonths, format } from "date-fns";

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
    importedBySource?: string;
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
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      return new PgSessionStore({
        pool,
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
  // Required for secure cookies behind Vercel/edge proxies.
  app.set("trust proxy", 1);

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      store: createSessionStore(),
      proxy: true,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  registerObjectStorageRoutes(app);

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: "Email, password, and name required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
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
      });
      (req.session as { userId?: string }).userId = user.id;
      res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      (req.session as { userId?: string }).userId = user.id;
      res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
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
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // Dev-only auto-login endpoint
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/auth/dev-login", async (req: Request, res: Response) => {
      try {
        const devEmail = "dev@agentreach.test";
        let user = await storage.getUserByEmail(devEmail);
        if (!user) {
          const passwordHash = await bcrypt.hash("devpassword123", 12);
          user = await storage.createUser({
            email: devEmail,
            passwordHash,
            name: "Dev User",
            role: "producer",
          });
        }
        (req.session as { userId?: string }).userId = user.id;
        res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
      } catch (error) {
        console.error("Dev login error:", error);
        res.status(500).json({ error: "Dev login failed" });
      }
    });
  }

  const requireAuth = (req: Request, res: Response, next: Function) => {
    const userId = (req.session as { userId?: string }).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    (req as Request & { userId: string }).userId = userId;
    next();
  };

  // ============================================================================
  // USERS
  // ============================================================================
  app.get("/api/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const users = await storage.getUsers();
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
      const clients = await storage.getClients();
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
        const importedBySource =
          typeof mapping.importedBySource === "string" ? mapping.importedBySource : "internal_app";
        const importedByUser = importedByUserId ? usersById.get(importedByUserId) : null;

        return {
          ...job,
          importedByUserId,
          importedBySource,
          importedByLabel: importedByUser?.name || (importedBySource === "onboarding_portal" ? "Client Onboarding" : "Team"),
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error("Get contact import jobs error:", error);
      res.status(500).json({ error: "Failed to fetch contact import history" });
    }
  });

  app.post("/api/clients/:id/contacts", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

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

      const userId = (req as Request & { userId: string }).userId;
      const updated = await storage.updateContact(req.params.id, {
        archivedAt: new Date(),
        archivedById: userId,
      } as any);
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

      const updated = await storage.updateContact(req.params.id, {
        archivedAt: null,
        archivedById: null,
      } as any);
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
      if (!existing.archivedAt) {
        return res.status(409).json({ error: "Archive contact before permanent deletion." });
      }
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

      const csvContent = typeof req.body.csvContent === "string" ? req.body.csvContent : "";
      if (!csvContent.trim()) {
        return res.status(400).json({ error: "csvContent is required" });
      }

      const userId = (req as Request & { userId: string }).userId;
      const requestedMapping = req.body.mapping && typeof req.body.mapping === "object" ? req.body.mapping : {};
      const result = await importContactsFromCsv(client.id, csvContent, requestedMapping, {
        createSegmentsFromTags: !!req.body?.createSegmentsFromTags,
        segmentTags: req.body?.segmentTags,
        importedByUserId: userId,
        importedBySource: "internal_app",
      });
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

      const client = await storage.createClient(parsed.data);
      await storage.upsertBrandingKit({ clientId: client.id });
      
      if (client.primaryEmail && process.env.POSTMARK_ACCOUNT_API_TOKEN) {
        const signatureResult = await createSenderSignature(client.primaryEmail, client.name);
        if (signatureResult.success && signatureResult.signatureId) {
          const signature = await getSenderSignature(signatureResult.signatureId);
          await storage.updateClient(client.id, {
            postmarkSignatureId: signatureResult.signatureId,
            isVerified: signature?.Confirmed || false,
          });
        }
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
      const kits = await storage.getAllBrandingKits();
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
      const kit = await storage.getBrandingKit(req.params.clientId);
      res.json(kit || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch branding kit" });
    }
  });

  app.put("/api/clients/:clientId/branding-kit", requireAuth, async (req: Request, res: Response) => {
    try {
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
      const allSubscriptions = await storage.getAllSubscriptions();
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
      const subscription = await storage.updateSubscription(req.params.id, req.body);
      if (subscription?.status === "active") {
        await ensureSubscriptionHasInvoice(subscription.id);
      }
      if (existing) {
        await storage.recalculateClientSubscriptionStatus(existing.clientId);
      }
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
      const [invoices, clients, subscriptions, newsletters] = await Promise.all([
        storage.getAllInvoices(),
        storage.getClients(),
        storage.getAllSubscriptions(),
        storage.getAllNewsletters(),
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
      
      if (status && typeof status === "string") {
        const statuses = status
          .split(",")
          .map((s) => normalizeNewsletterStatus(s))
          .filter((s): s is NewsletterStatus => !!s);
        newsletters = statuses.length > 0 ? await storage.getNewslettersByStatus(statuses) : [];
      } else {
        newsletters = await storage.getAllNewsletters();
      }

      const clients = await storage.getClients();
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
      const newsletters = await storage.getNewslettersByClient(req.params.clientId);
      res.json(newsletters);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch newsletters" });
    }
  });

  app.post("/api/clients/:clientId/newsletters", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { expectedSendDate, importedHtml, invoiceId, subscriptionId } = req.body;

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

      if (importedHtml && importedHtml.trim()) {
        documentJson = createNewsletterDocumentFromHtml(importedHtml.trim());
      } else {
        documentJson = await getLatestNewsletterDocumentForClient(client.id);
      }
      documentJson = await applyBrandingToDocument(client.id, documentJson);

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
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: conversationContents,
          config: {
            systemInstruction,
            maxOutputTokens: 4096,
            temperature: 0.7,
          },
        });
        assistantContent = response.text ?? assistantContent;
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
        await storage.updateClient(client.id, { isVerified: true });
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

      if (!newsletterId) {
        // Can't attribute; still acknowledge to avoid retries.
        return res.json({ ok: true, ignored: true });
      }

      const { db } = await import("./db");
      const { newsletterEvents, newsletterDeliveries } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      // If metadata didn't include clientId, derive it from the newsletter record.
      let clientId = clientIdFromMeta;
      if (!clientId) {
        const nl = await storage.getNewsletter(newsletterId);
        clientId = nl?.clientId || null;
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

      await syncNewsletterStatusFromDeliveries(newsletterId);

      res.json({ ok: true });
    } catch (error) {
      console.error("Postmark events webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  app.get("/api/clients/:clientId/verification-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      
      if (client.postmarkSignatureId) {
        const signature = await getSenderSignature(client.postmarkSignatureId);
        if (signature?.Confirmed && !client.isVerified) {
          await storage.updateClient(client.id, { isVerified: true });
          return res.json({ isVerified: true, signatureId: client.postmarkSignatureId });
        }
        return res.json({ 
          isVerified: client.isVerified, 
          signatureId: client.postmarkSignatureId,
          pendingVerification: !signature?.Confirmed 
        });
      }
      
      res.json({ isVerified: client.isVerified });
    } catch (error) {
      res.status(500).json({ error: "Failed to check verification status" });
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

      if (client.isVerified) {
        return res.json({ success: true, isVerified: true, message: "Sender already verified" });
      }

      if (client.postmarkSignatureId) {
        const signature = await getSenderSignature(client.postmarkSignatureId);
        if (signature?.Confirmed) {
          await storage.updateClient(client.id, { isVerified: true });
          return res.json({ success: true, isVerified: true, message: "Sender verified" });
        }
      }

      if (!process.env.POSTMARK_ACCOUNT_API_TOKEN) {
        return res.status(400).json({ error: "Postmark account API token is not configured" });
      }

      const signatureResult = await createSenderSignature(client.primaryEmail, client.name);
      if (!signatureResult.success || !signatureResult.signatureId) {
        return res.status(500).json({ error: signatureResult.error || "Failed to request verification email" });
      }

      await storage.updateClient(client.id, {
        postmarkSignatureId: signatureResult.signatureId,
        isVerified: false,
      });

      res.json({
        success: true,
        isVerified: false,
        signatureId: signatureResult.signatureId,
        message: "Verification email sent",
      });
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
    brandingKit?: BrandingKit | null
  ): DeliveryProvider => {
    const requestedProvider = normalizeDeliveryProvider(requestedProviderRaw);
    if (requestedProvider) return requestedProvider;

    const docProvider = normalizeDeliveryProvider((document?.meta as any)?.deliveryProvider);
    if (docProvider) return docProvider;

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
      "all";
    const selectedProvider = resolveDefaultProvider(options.provider, document, brandingKit);
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
    const postmarkToken = process.env.POSTMARK_SERVER_TOKEN || "";
    if (!postmarkToken) {
      return {
        ok: false,
        error: "Postmark server token is not configured (POSTMARK_SERVER_TOKEN).",
      };
    }

    const { ServerClient } = await import("postmark");
    const pm = new ServerClient(postmarkToken);
    const messageStream = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

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
    let acceptedCount = 0;
    let failedCount = 0;

    // Keep batches modest for serverless timeouts and Postmark API limits.
    const batches = chunkArray(queuedDeliveries as any[], 400);
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
          HtmlBody: personalizeNewsletterHtml(complianceHtml.html, contact),
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

      const softWarningCodes = new Set(["sender_not_verified", "malformed_urls"]);
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
        return res.status(400).json({
          error: "Cannot send test email until blockers are resolved.",
          blockers,
          warnings,
        });
      }

      const postmarkToken = process.env.POSTMARK_SERVER_TOKEN || "";
      if (!postmarkToken) {
        return res.status(400).json({
          error: "Postmark server token is not configured (POSTMARK_SERVER_TOKEN).",
        });
      }

      const { ServerClient } = await import("postmark");
      const pm = new ServerClient(postmarkToken);
      const messageStream = process.env.POSTMARK_MESSAGE_STREAM || "outbound";
      const testSubject = `[TEST] ${qa.subject}`;
      const complianceHtml = ensureComplianceFooter(qa.html, qa.fromEmail);
      const htmlBody = personalizeNewsletterHtml(complianceHtml.html, {
        firstName: "Test",
        lastName: "Recipient",
      });

      const sendResult = await pm.sendEmail({
        From: qa.fromEmail,
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

      res.json({
        ok: true,
        toEmail,
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
      if (!canTransitionNewsletterStatus(qa.newsletter.status as NewsletterStatus, "scheduled")) {
        return res.status(400).json({
          error: "Newsletter is not in a schedulable state.",
          status: qa.newsletter.status,
        });
      }
      if (!qa.canSend) {
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
      const queuedRecipients = await queueAudienceDeliveries(
        qa.newsletter.id,
        qa.newsletter.clientId,
        qa.audienceTag,
        qa.recipients
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

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_scheduled", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        scheduledAt: scheduledAt.toISOString(),
        queuedCount: queuedRecipients.length,
      });

      res.json({
        newsletter: updated,
        blockers: qa.blockers,
        warnings: qa.warnings,
        canSend: true,
        queuedCount: queuedRecipients.length,
        provider: qa.deliveryProvider,
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

      const nextStatus: NewsletterStatus = qa.deliveryProvider === "postmark" ? "scheduled" : "sent";
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

      const recipientsHint = failedRows.map((row: any) => ({
        id: row.contactId || null,
        email: row.email,
      }));
      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_retry_requested", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey,
        retryCount: failedRows.length,
      });

      const sendResult = await sendNewsletterViaProvider(
        qa,
        qa.deliveryProvider,
        qa.audienceTag,
        recipientsHint,
        { idempotencyKey }
      );
      if (!sendResult.ok) {
        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_failed", {
          audienceTag: qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
          error: sendResult.error || "Retry send failed",
        });
        return res.status(400).json({ error: sendResult.error || "Retry failed" });
      }

      const now = new Date();
      const updated = await storage.updateNewsletter(qa.newsletter.id, {
        status: "scheduled",
        // Retry is an immediate pipeline run, not a future schedule.
        scheduledAt: null,
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

      await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_processing", {
        audienceTag: qa.audienceTag,
        provider: qa.deliveryProvider,
        idempotencyKey,
        acceptedCount: (sendResult as any).acceptedCount || 0,
        failedCount: (sendResult as any).failedCount || 0,
        queuedCount: (sendResult as any).queuedCount || 0,
        retryCount: failedRows.length,
      });

      const sync = await syncNewsletterStatusFromDeliveries(qa.newsletter.id);

      res.json({
        ok: true,
        newsletter: updated,
        provider: qa.deliveryProvider,
        idempotencyKey,
        retriedCount: failedRows.length,
        send: sendResult,
        sync,
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

  // Cron/automation hook to send scheduled newsletters. Configure this with Vercel Cron or an external scheduler.
  // Vercel Cron invokes this endpoint via HTTP GET and will automatically include:
  // Authorization: Bearer ${CRON_SECRET}
  const sendDueNewslettersCronHandler = async (req: Request, res: Response) => {
    try {
      const expected = process.env.CRON_SECRET;
      const authorization = (req.headers["authorization"] as string) || "";
      // Never allow this endpoint unauthenticated in production; it can trigger sends.
      if (!expected && process.env.NODE_ENV === "production") {
        return res.status(500).json({ error: "CRON_SECRET is not configured." });
      }
      if (expected) {
        const expectedHeader = `Bearer ${expected}`;
        if (authorization !== expectedHeader) {
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      const dueNewsletters = (await storage.getNewslettersByStatus(["scheduled"] as any)).filter((n: any) => {
        if (!n?.scheduledAt) return false;
        const when = new Date(n.scheduledAt);
        return !Number.isNaN(when.getTime()) && when.getTime() <= Date.now();
      });

      let processed = 0;
      let skipped = 0;
      let failed = 0;
      const results: any[] = [];
      for (const nl of dueNewsletters) {
        const qa = await buildNewsletterQaReport(nl.id, {
          provider: normalizeDeliveryProvider((nl.documentJson as any)?.meta?.deliveryProvider),
          includeAudience: true,
          requireRecipients: true,
        });
        if (!qa) {
          skipped += 1;
          results.push({ newsletterId: nl.id, skipped: true, reason: "missing_newsletter" });
          continue;
        }
        if (!qa.canSend) {
          skipped += 1;
          results.push({
            newsletterId: nl.id,
            skipped: true,
            reason: "qa_blocked",
            blockers: qa.blockers.map((b) => b.code),
          });
          continue;
        }
        const idempotencyKey = buildSendIdempotencyKey(
          qa.newsletter.id,
          qa.audienceTag,
          qa.deliveryProvider,
          qa.subject,
          qa.fromEmail,
          `cron-${Date.now()}-${qa.newsletter.id}`
        );
        await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_requested", {
          source: "cron",
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
            source: "cron",
            audienceTag: qa.audienceTag,
            provider: qa.deliveryProvider,
            idempotencyKey,
            error: sendResult.error || "Provider send failed",
          });
          failed += 1;
          results.push({
            newsletterId: nl.id,
            failed: true,
            error: sendResult.error || "Failed to send via provider",
          });
          continue;
        }

        const sendAt = new Date();
        const nextStatus: NewsletterStatus = qa.deliveryProvider === "postmark" ? "scheduled" : "sent";
        await storage.updateNewsletter(nl.id, {
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
          source: "cron",
          audienceTag: (sendResult as any).audienceTag || qa.audienceTag,
          provider: qa.deliveryProvider,
          idempotencyKey,
          acceptedCount: (sendResult as any).acceptedCount || 0,
          failedCount: (sendResult as any).failedCount || 0,
          queuedCount: (sendResult as any).queuedCount || 0,
        });

        if (qa.deliveryProvider === "mailchimp") {
          await recordCampaignEvent(qa.newsletter.id, qa.newsletter.clientId, "send_completed", {
            source: "cron",
            audienceTag: qa.audienceTag,
            provider: qa.deliveryProvider,
            idempotencyKey,
            acceptedCount: (sendResult as any).acceptedCount || 0,
          });
        } else {
          await syncNewsletterStatusFromDeliveries(qa.newsletter.id);
        }

        processed += 1;
        results.push({ newsletterId: nl.id, provider: qa.deliveryProvider, send: sendResult });
      }

      res.json({ ok: true, dueCount: dueNewsletters.length, processed, skipped, failed, results });
    } catch (error) {
      console.error("Cron send-due error:", error);
      const detail = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Failed to send due newsletters", detail });
    }
  };

  app.get("/api/internal/cron/send-due-newsletters", sendDueNewslettersCronHandler);
  // Keep POST for internal/manual triggers.
  app.post("/api/internal/cron/send-due-newsletters", sendDueNewslettersCronHandler);

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
      const projects = await storage.getProjectsByClient(req.params.clientId);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "Failed to get projects" });
    }
  });

  app.post("/api/clients/:clientId/projects", requireAuth, async (req: Request, res: Response) => {
    try {
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
      const templates = await storage.getTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to get templates" });
    }
  });

  app.post("/api/templates", requireAuth, async (req: Request, res: Response) => {
    try {
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
      const tasks = await storage.getProductionTasks();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to get tasks" });
    }
  });

  app.post("/api/tasks", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const task = await storage.createProductionTask({
        ...req.body,
        createdById: userId,
      });
      res.status(201).json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", requireAuth, async (req: Request, res: Response) => {
    try {
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

  return httpServer;
}
