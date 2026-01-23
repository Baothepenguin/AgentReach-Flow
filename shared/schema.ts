import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date, jsonb, integer, boolean, serial, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// USERS
// ============================================================================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "producer"] }).notNull().default("producer"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================================
// CLIENTS
// ============================================================================
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  primaryEmail: text("primary_email").notNull(),
  secondaryEmail: text("secondary_email"),
  phone: text("phone"),
  locationCity: text("location_city"),
  locationRegion: text("location_region"),
  newsletterFrequency: text("newsletter_frequency", { enum: ["weekly", "biweekly", "monthly"] }).notNull().default("monthly"),
  subscriptionStatus: text("subscription_status", { enum: ["active", "paused", "past_due", "canceled"] }).notNull().default("active"),
  isVerified: boolean("is_verified").notNull().default(false),
  postmarkSignatureId: integer("postmark_signature_id"),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientsRelations = relations(clients, ({ one, many }) => ({
  brandingKit: one(brandingKits, {
    fields: [clients.id],
    references: [brandingKits.clientId],
  }),
  assignedTo: one(users, {
    fields: [clients.assignedToId],
    references: [users.id],
  }),
  projects: many(projects),
  subscriptions: many(subscriptions),
  invoices: many(invoices),
  newsletters: many(newsletters),
}));

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// ============================================================================
// HTML TEMPLATES - Base templates for newsletters
// ============================================================================
export const htmlTemplates = pgTable("html_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  html: text("html").notNull(),
  thumbnail: text("thumbnail"),
  category: text("category", { enum: ["minimal", "modern", "classic", "custom"] }).notNull().default("custom"),
  isDefault: boolean("is_default").notNull().default(false),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertHtmlTemplateSchema = createInsertSchema(htmlTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertHtmlTemplate = z.infer<typeof insertHtmlTemplateSchema>;
export type HtmlTemplate = typeof htmlTemplates.$inferSelect;

// ============================================================================
// PROJECTS - Client projects that contain newsletters
// ============================================================================
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: ["active", "paused", "completed", "archived"] }).notNull().default("active"),
  templateId: varchar("template_id").references(() => htmlTemplates.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  template: one(htmlTemplates, {
    fields: [projects.templateId],
    references: [htmlTemplates.id],
  }),
  newsletters: many(newsletters),
}));

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export const htmlTemplatesRelations = relations(htmlTemplates, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [htmlTemplates.createdById],
    references: [users.id],
  }),
  projects: many(projects),
}));

// ============================================================================
// BRANDING KITS - Client branding assets
// ============================================================================
export const brandingKits = pgTable("branding_kits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }).unique(),
  title: text("title"),
  phone: text("phone"),
  email: text("email"),
  secondaryEmail: text("secondary_email"),
  headshot: text("headshot"),
  logo: text("logo"),
  companyName: text("company_name"),
  companyLogo: text("company_logo"),
  primaryColor: text("primary_color").default("#1a5f4a"),
  secondaryColor: text("secondary_color").default("#000000"),
  facebook: text("facebook"),
  instagram: text("instagram"),
  linkedin: text("linkedin"),
  youtube: text("youtube"),
  website: text("website"),
  platform: text("platform", { enum: ["mailchimp", "constant_contact", "other"] }).default("mailchimp"),
  platformAccountName: text("platform_account_name"),
  tone: text("tone"),
  mustInclude: jsonb("must_include").$type<string[]>().default([]),
  avoidTopics: jsonb("avoid_topics").$type<string[]>().default([]),
  localLandmarks: jsonb("local_landmarks").$type<string[]>().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const brandingKitsRelations = relations(brandingKits, ({ one }) => ({
  client: one(clients, {
    fields: [brandingKits.clientId],
    references: [clients.id],
  }),
}));

export const insertBrandingKitSchema = createInsertSchema(brandingKits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBrandingKit = z.infer<typeof insertBrandingKitSchema>;
export type BrandingKit = typeof brandingKits.$inferSelect;

// ============================================================================
// SUBSCRIPTIONS - Client payment plans
// ============================================================================
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  mrr: decimal("mrr", { precision: 10, scale: 2 }),
  status: text("status", { enum: ["active", "paused", "canceled", "past_due"] }).notNull().default("active"),
  frequency: text("frequency", { enum: ["weekly", "biweekly", "monthly"] }).notNull().default("monthly"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  client: one(clients, {
    fields: [subscriptions.clientId],
    references: [clients.id],
  }),
  newsletters: many(newsletters),
}));

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

// ============================================================================
// INVOICES - Payment records linked to newsletters
// ============================================================================
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  transactionFee: decimal("transaction_fee", { precision: 10, scale: 2 }),
  stripePaymentId: text("stripe_payment_id"),
  status: text("status", { enum: ["pending", "paid", "failed", "refunded"] }).notNull().default("pending"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
  newsletters: many(newsletters),
}));

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ============================================================================
// NEWSLETTERS
// ============================================================================
export const NEWSLETTER_STATUSES = [
  "not_started",
  "in_progress", 
  "internal_review",
  "client_review",
  "revisions",
  "approved",
  "sent"
] as const;

export type NewsletterStatus = typeof NEWSLETTER_STATUSES[number];

export const newsletters = pgTable("newsletters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  expectedSendDate: date("expected_send_date").notNull(),
  status: text("status", { 
    enum: NEWSLETTER_STATUSES
  }).notNull().default("not_started"),
  currentVersionId: varchar("current_version_id"),
  documentJson: jsonb("document_json").$type<NewsletterDocument>(),
  designJson: jsonb("design_json"),
  internalNotes: text("internal_notes"),
  editorFileUrl: text("editor_file_url"),
  contentChatUrl: text("content_chat_url"),
  isUnpaid: boolean("is_unpaid").default(false),
  assignedToId: varchar("assigned_to_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
  lastEditedById: varchar("last_edited_by_id").references(() => users.id),
  lastEditedAt: timestamp("last_edited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const newslettersRelations = relations(newsletters, ({ one, many }) => ({
  client: one(clients, {
    fields: [newsletters.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [newsletters.projectId],
    references: [projects.id],
  }),
  invoice: one(invoices, {
    fields: [newsletters.invoiceId],
    references: [invoices.id],
  }),
  subscription: one(subscriptions, {
    fields: [newsletters.subscriptionId],
    references: [subscriptions.id],
  }),
  assignedTo: one(users, {
    fields: [newsletters.assignedToId],
    references: [users.id],
  }),
  reviewComments: many(reviewComments),
  createdBy: one(users, {
    fields: [newsletters.createdById],
    references: [users.id],
  }),
  lastEditedBy: one(users, {
    fields: [newsletters.lastEditedById],
    references: [users.id],
  }),
  versions: many(newsletterVersions),
  aiDrafts: many(aiDrafts),
  flags: many(tasksFlags),
  reviewTokens: many(reviewTokens),
}));

export const insertNewsletterSchema = createInsertSchema(newsletters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNewsletter = z.infer<typeof insertNewsletterSchema>;
export type Newsletter = typeof newsletters.$inferSelect;

// ============================================================================
// NEWSLETTER VERSIONS - Snapshots
// ============================================================================
export const newsletterVersions = pgTable("newsletter_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshotJson: jsonb("snapshot_json").$type<NewsletterDocument>().notNull(),
  createdById: varchar("created_by_id").references(() => users.id),
  changeSummary: text("change_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const newsletterVersionsRelations = relations(newsletterVersions, ({ one }) => ({
  newsletter: one(newsletters, {
    fields: [newsletterVersions.newsletterId],
    references: [newsletters.id],
  }),
  createdBy: one(users, {
    fields: [newsletterVersions.createdById],
    references: [users.id],
  }),
}));

export const insertNewsletterVersionSchema = createInsertSchema(newsletterVersions).omit({
  id: true,
  createdAt: true,
});
export type InsertNewsletterVersion = z.infer<typeof insertNewsletterVersionSchema>;
export type NewsletterVersion = typeof newsletterVersions.$inferSelect;

// ============================================================================
// AI DRAFTS - AI output storage
// ============================================================================
export const aiDrafts = pgTable("ai_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  createdById: varchar("created_by_id").references(() => users.id),
  intent: text("intent").notNull(),
  draftJson: jsonb("draft_json").$type<Record<string, unknown>>().notNull(),
  sourcesJson: jsonb("sources_json").$type<AIDraftSource[]>().default([]),
  validationJson: jsonb("validation_json").$type<{ warnings: string[]; errors: string[] }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiDraftsRelations = relations(aiDrafts, ({ one }) => ({
  newsletter: one(newsletters, {
    fields: [aiDrafts.newsletterId],
    references: [newsletters.id],
  }),
  createdBy: one(users, {
    fields: [aiDrafts.createdById],
    references: [users.id],
  }),
}));

export const insertAiDraftSchema = createInsertSchema(aiDrafts).omit({
  id: true,
  createdAt: true,
});
export type InsertAiDraft = z.infer<typeof insertAiDraftSchema>;
export type AiDraft = typeof aiDrafts.$inferSelect;

// ============================================================================
// TASKS/FLAGS - Validation issues
// ============================================================================
export const tasksFlags = pgTable("tasks_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  severity: text("severity", { enum: ["info", "warning", "blocker"] }).notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const tasksFlagsRelations = relations(tasksFlags, ({ one }) => ({
  newsletter: one(newsletters, {
    fields: [tasksFlags.newsletterId],
    references: [newsletters.id],
  }),
}));

export const insertTasksFlagsSchema = createInsertSchema(tasksFlags).omit({
  id: true,
  createdAt: true,
});
export type InsertTasksFlags = z.infer<typeof insertTasksFlagsSchema>;
export type TasksFlags = typeof tasksFlags.$inferSelect;

// ============================================================================
// REVIEW TOKENS - Secure client review links with expiration
// ============================================================================
export const reviewTokens = pgTable("review_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  singleUse: boolean("single_use").notNull().default(true),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reviewTokensRelations = relations(reviewTokens, ({ one }) => ({
  newsletter: one(newsletters, {
    fields: [reviewTokens.newsletterId],
    references: [newsletters.id],
  }),
}));

export const insertReviewTokenSchema = createInsertSchema(reviewTokens).omit({
  id: true,
  createdAt: true,
});
export type InsertReviewToken = z.infer<typeof insertReviewTokenSchema>;
export type ReviewToken = typeof reviewTokens.$inferSelect;

// ============================================================================
// REVIEW COMMENTS - Client feedback on newsletters (to-do style)
// ============================================================================
export const reviewComments = pgTable("review_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  reviewTokenId: varchar("review_token_id").references(() => reviewTokens.id, { onDelete: "set null" }),
  sectionId: text("section_id"),
  commentType: text("comment_type", { enum: ["change", "addition", "removal", "general"] }).notNull().default("general"),
  content: text("content").notNull(),
  attachments: jsonb("attachments").$type<string[]>().default([]),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  newsletter: one(newsletters, {
    fields: [reviewComments.newsletterId],
    references: [newsletters.id],
  }),
  reviewToken: one(reviewTokens, {
    fields: [reviewComments.reviewTokenId],
    references: [reviewTokens.id],
  }),
  completedBy: one(users, {
    fields: [reviewComments.completedById],
    references: [users.id],
  }),
}));

export const insertReviewCommentSchema = createInsertSchema(reviewComments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertReviewComment = z.infer<typeof insertReviewCommentSchema>;
export type ReviewComment = typeof reviewComments.$inferSelect;

// ============================================================================
// SESSIONS - Persistent session store
// ============================================================================
export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

// ============================================================================
// INTEGRATION SETTINGS - Global config
// ============================================================================
export const integrationSettings = pgTable("integration_settings", {
  id: serial("id").primaryKey(),
  slackWebhookUrl: text("slack_webhook_url"),
  smtpHost: text("smtp_host"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  stripeWebhookSecret: text("stripe_webhook_secret"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertIntegrationSettingsSchema = createInsertSchema(integrationSettings).omit({
  id: true,
  updatedAt: true,
});
export type InsertIntegrationSettings = z.infer<typeof insertIntegrationSettingsSchema>;
export type IntegrationSettings = typeof integrationSettings.$inferSelect;

// ============================================================================
// NEWSLETTER MODULE SYSTEM - JSON Types
// ============================================================================

// Theme configuration
export interface NewsletterTheme {
  bg: string;
  text: string;
  accent: string;
  muted: string;
  fontHeading: string;
  fontBody: string;
}

// Module metadata for tracking edits
export interface ModuleMetadata {
  lastEditedAt?: string;
  lastEditedById?: string;
  lastEditedByName?: string;
  origin?: "human" | "ai";
}

// Base module interface
export interface BaseModule {
  id: string;
  type: string;
  locked?: boolean;
  metadata?: ModuleMetadata;
}

// Module types
export interface HeaderNavModule extends BaseModule {
  type: "HeaderNav";
  props: {
    logoUrl?: string;
    navLinks?: Array<{ label: string; url: string }>;
  };
}

export interface HeroModule extends BaseModule {
  type: "Hero";
  props: {
    backgroundUrl?: string;
    title: string;
    subtitle?: string;
  };
}

export interface RichTextModule extends BaseModule {
  type: "RichText";
  props: {
    content: string;
  };
}

export interface EventsListModule extends BaseModule {
  type: "EventsList";
  props: {
    title?: string;
    events: Array<{
      name: string;
      startDate: string;
      endDate?: string;
      address?: string;
      city?: string;
      region?: string;
      url?: string;
      sourceName?: string;
      sourceDate?: string;
    }>;
  };
}

export interface CTAModule extends BaseModule {
  type: "CTA";
  props: {
    headline: string;
    buttonText: string;
    buttonUrl: string;
    backgroundUrl?: string;
  };
}

export interface MarketUpdateModule extends BaseModule {
  type: "MarketUpdate";
  props: {
    title?: string;
    paragraphs: string[];
    metrics?: Array<{
      label: string;
      value: string;
      sourceUrl?: string;
    }>;
  };
}

export interface NewsCardsModule extends BaseModule {
  type: "NewsCards";
  props: {
    title?: string;
    items: Array<{
      headline: string;
      summary: string;
      imageUrl?: string;
      url: string;
      sourceName: string;
      sourceDate?: string;
    }>;
  };
}

export interface ListingsGridModule extends BaseModule {
  type: "ListingsGrid";
  props: {
    title?: string;
    listings: Array<{
      imageUrl?: string;
      price: string;
      beds?: number;
      baths?: number;
      address?: string;
      url?: string;
    }>;
  };
}

export interface TestimonialModule extends BaseModule {
  type: "Testimonial";
  props: {
    quote: string;
    author: string;
    role?: string;
  };
}

export interface AgentBioModule extends BaseModule {
  type: "AgentBio";
  props: {
    photoUrl?: string;
    name: string;
    title?: string;
    phone?: string;
    email?: string;
    socials?: Array<{ platform: string; url: string }>;
  };
}

export interface FooterComplianceModule extends BaseModule {
  type: "FooterCompliance";
  props: {
    copyright?: string;
    brokerage?: string;
    unsubscribeText?: string;
  };
}

export type NewsletterModule =
  | HeaderNavModule
  | HeroModule
  | RichTextModule
  | EventsListModule
  | CTAModule
  | MarketUpdateModule
  | NewsCardsModule
  | ListingsGridModule
  | TestimonialModule
  | AgentBioModule
  | FooterComplianceModule;

// Full newsletter document - simplified to just raw HTML
export interface NewsletterDocument {
  html: string;
}

// Legacy module-based document (deprecated, kept for migration)
export interface LegacyNewsletterDocument {
  templateId: string;
  theme: NewsletterTheme;
  modules: NewsletterModule[];
  html?: string;
}

// AI Draft source tracking
export interface AIDraftSource {
  id: string;
  type: "event" | "news" | "market_data";
  url: string;
  sourceName: string;
  sourceDate?: string;
  referencedBy: string[]; // module IDs that reference this source
}

// AI Intent Router types
export type AIIntentResponse =
  | { type: "REQUEST_CLARIFICATION"; question: string; options?: string[] }
  | { type: "APPLY_PATCH"; operations: AIOperation[] }
  | { type: "FLAG_FOR_REVIEW"; severity: "info" | "warning" | "blocker"; reason: string; suggestedNextStep?: string };

export type AIOperation =
  | { type: "UPDATE_MODULE_PROPS"; moduleId: string; patch: Record<string, unknown> }
  | { type: "BULK_UPDATE"; where: { type?: string; propMatch?: Record<string, unknown> }; patch: Record<string, unknown> }
  | { type: "REPLACE_LIST_ITEMS"; moduleId: string; listField: string; items: unknown[]; sources?: AIDraftSource[] }
  | { type: "SET_THEME"; patch: Partial<NewsletterTheme> }
  | { type: "NO_OP"; reason: string };

// AI Content generation output
export interface AIGeneratedContent {
  welcome?: string;
  events?: Array<{
    name: string;
    startDate: string;
    endDate?: string;
    address?: string;
    city?: string;
    region?: string;
    url: string;
    sourceName: string;
    sourceDate?: string;
  }>;
  marketUpdate?: {
    paragraphs: string[];
    metrics?: Array<{ label: string; value: string; sourceUrl?: string }>;
  };
  homeTip?: string;
  marketNews?: Array<{
    headline: string;
    summary: string;
    url: string;
    sourceName: string;
    sourceDate?: string;
  }>;
  subjectLines?: Array<{ subject: string; preview: string }>;
}

// Default empty newsletter document
export const DEFAULT_NEWSLETTER_DOCUMENT: NewsletterDocument = {
  html: "",
};

// Zod schemas for runtime validation
export const newsletterDocumentSchema = z.object({
  html: z.string(),
});

// Legacy schemas kept for migration
export const newsletterThemeSchema = z.object({
  bg: z.string(),
  text: z.string(),
  accent: z.string(),
  muted: z.string(),
  fontHeading: z.string(),
  fontBody: z.string(),
});

export const baseModuleSchema = z.object({
  id: z.string(),
  type: z.string(),
  locked: z.boolean().optional(),
});

export const legacyNewsletterDocumentSchema = z.object({
  templateId: z.string(),
  theme: newsletterThemeSchema,
  modules: z.array(z.object({
    id: z.string(),
    type: z.string(),
    locked: z.boolean().optional(),
    props: z.record(z.unknown()),
  })),
  html: z.string().optional(),
});

// Chat models for AI integrations (kept for compatibility)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
