import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  date,
  jsonb,
  integer,
  boolean,
  serial,
  decimal,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
  accountType: text("account_type", { enum: ["internal_operator", "diy_customer"] })
    .notNull()
    .default("internal_operator"),
  diyClientId: varchar("diy_client_id"),
  billingStatus: text("billing_status", { enum: ["trialing", "active", "past_due", "canceled"] })
    .notNull()
    .default("active"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  timezone: text("timezone").notNull().default("America/New_York"),
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
  serviceMode: text("service_mode", { enum: ["diy_active", "dfy_requested", "dfy_active", "hybrid"] })
    .notNull()
    .default("dfy_active"),
  newsletterFrequency: text("newsletter_frequency", { enum: ["weekly", "biweekly", "monthly"] }).notNull().default("monthly"),
  subscriptionStatus: text("subscription_status", { enum: ["active", "paused", "past_due", "canceled"] }).notNull().default("active"),
  defaultDeliveryProvider: text("default_delivery_provider", { enum: ["postmark", "mailchimp", "html_export"] })
    .notNull()
    .default("postmark"),
  defaultAudienceTag: text("default_audience_tag").notNull().default("all"),
  isVerified: boolean("is_verified").notNull().default(false),
  postmarkSignatureId: integer("postmark_signature_id"),
  postmarkServerId: integer("postmark_server_id"),
  postmarkMessageStreamId: text("postmark_message_stream_id"),
  postmarkDomain: text("postmark_domain"),
  postmarkDomainVerificationState: text("postmark_domain_verification_state", {
    enum: ["not_configured", "pending", "verified", "failed"],
  })
    .notNull()
    .default("not_configured"),
  postmarkSenderVerificationState: text("postmark_sender_verification_state", {
    enum: ["missing", "pending", "verified", "failed"],
  })
    .notNull()
    .default("missing"),
  postmarkQualityState: text("postmark_quality_state", {
    enum: ["healthy", "watch", "paused"],
  })
    .notNull()
    .default("healthy"),
  postmarkAutoPausedAt: timestamp("postmark_auto_paused_at"),
  postmarkAutoPauseReason: text("postmark_auto_pause_reason"),
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
  notes: many(clientNotes),
  contacts: many(contacts),
  contactImportJobs: many(contactImportJobs),
  contactSegments: many(contactSegments),
  onboardingTokens: many(clientOnboardingTokens),
  crmConnections: many(clientCrmConnections),
}));

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// ============================================================================
// CLIENT POSTMARK TENANTS - Per-client Postmark server isolation + quality state
// ============================================================================
export const clientPostmarkTenants = pgTable(
  "client_postmark_tenants",
  {
    id: serial("id").primaryKey(),
    clientId: varchar("client_id")
      .notNull()
      .unique()
      .references(() => clients.id, { onDelete: "cascade" }),
    serverId: integer("server_id").notNull(),
    serverToken: text("server_token").notNull(),
    broadcastStreamId: text("broadcast_stream_id").notNull(),
    webhookId: integer("webhook_id"),
    webhookUrl: text("webhook_url"),
    senderSignatureId: integer("sender_signature_id"),
    senderEmail: text("sender_email"),
    senderConfirmed: boolean("sender_confirmed").notNull().default(false),
    domain: text("domain"),
    domainVerificationState: text("domain_verification_state", {
      enum: ["not_configured", "pending", "verified", "failed"],
    })
      .notNull()
      .default("not_configured"),
    qualityState: text("quality_state", { enum: ["healthy", "watch", "paused"] })
      .notNull()
      .default("healthy"),
    autoPausedAt: timestamp("auto_paused_at"),
    autoPauseReason: text("auto_pause_reason"),
    lastBounceRate: decimal("last_bounce_rate", { precision: 6, scale: 4 }),
    lastComplaintRate: decimal("last_complaint_rate", { precision: 6, scale: 4 }),
    lastHealthCheckAt: timestamp("last_health_check_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    qualityIdx: index("client_postmark_tenants_quality_idx").on(table.qualityState),
  })
);

export const clientPostmarkTenantsRelations = relations(clientPostmarkTenants, ({ one }) => ({
  client: one(clients, {
    fields: [clientPostmarkTenants.clientId],
    references: [clients.id],
  }),
}));

export const insertClientPostmarkTenantSchema = createInsertSchema(clientPostmarkTenants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientPostmarkTenant = z.infer<typeof insertClientPostmarkTenantSchema>;
export type ClientPostmarkTenant = typeof clientPostmarkTenants.$inferSelect;

// ============================================================================
// CLIENT CRM CONNECTIONS - Per-client CRM provider credentials + sync state
// ============================================================================
export const clientCrmConnections = pgTable(
  "client_crm_connections",
  {
    id: serial("id").primaryKey(),
    clientId: varchar("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["follow_up_boss", "kvcore", "boldtrail"] }).notNull(),
    status: text("status", { enum: ["connected", "disconnected", "error"] }).notNull().default("connected"),
    accessToken: text("access_token").notNull(),
    accountLabel: text("account_label"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at"),
    lastSyncStatus: text("last_sync_status", { enum: ["idle", "success", "error"] })
      .notNull()
      .default("idle"),
    lastSyncMessage: text("last_sync_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    clientProviderUnique: uniqueIndex("client_crm_connections_client_provider_uq").on(
      table.clientId,
      table.provider
    ),
    clientProviderIdx: index("client_crm_connections_client_provider_idx").on(table.clientId, table.provider),
  })
);

export const clientCrmConnectionsRelations = relations(clientCrmConnections, ({ one }) => ({
  client: one(clients, {
    fields: [clientCrmConnections.clientId],
    references: [clients.id],
  }),
}));

export const insertClientCrmConnectionSchema = createInsertSchema(clientCrmConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientCrmConnection = z.infer<typeof insertClientCrmConnectionSchema>;
export type ClientCrmConnection = typeof clientCrmConnections.$inferSelect;

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
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "sent"
] as const;

export type NewsletterStatus = typeof NEWSLETTER_STATUSES[number];
export const NEWSLETTER_SEND_MODES = [
  "fixed_time",
  "immediate_after_approval",
  "ai_recommended",
] as const;
export type NewsletterSendMode = typeof NEWSLETTER_SEND_MODES[number];

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
  }).notNull().default("draft"),
  subject: text("subject"),
  previewText: text("preview_text"),
  fromEmail: text("from_email"),
  sendMode: text("send_mode", { enum: NEWSLETTER_SEND_MODES }).default("ai_recommended"),
  timezone: text("timezone").default("America/New_York"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  editorVersion: text("editor_version").default("v1"),
  currentVersionId: varchar("current_version_id"),
  documentJson: jsonb("document_json").$type<NewsletterDocument>(),
  designJson: jsonb("design_json"),
  internalNotes: text("internal_notes"),
  editorFileUrl: text("editor_file_url"),
  contentChatUrl: text("content_chat_url"),
  sendDate: date("send_date"),
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
// PRODUCTION TASKS - General team tasks
// ============================================================================
export const productionTasks = pgTable("production_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  completed: boolean("completed").notNull().default(false),
  createdById: varchar("created_by_id").references(() => users.id, { onDelete: "set null" }),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  newsletterId: varchar("newsletter_id").references(() => newsletters.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }),
  dueDate: timestamp("due_date"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).default("medium"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const productionTasksRelations = relations(productionTasks, ({ one }) => ({
  createdBy: one(users, {
    fields: [productionTasks.createdById],
    references: [users.id],
    relationName: "taskCreator",
  }),
  assignedTo: one(users, {
    fields: [productionTasks.assignedToId],
    references: [users.id],
    relationName: "taskAssignee",
  }),
  newsletter: one(newsletters, {
    fields: [productionTasks.newsletterId],
    references: [newsletters.id],
  }),
  client: one(clients, {
    fields: [productionTasks.clientId],
    references: [clients.id],
  }),
}));

export const insertProductionTaskSchema = createInsertSchema(productionTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProductionTask = z.infer<typeof insertProductionTaskSchema>;
export type ProductionTask = typeof productionTasks.$inferSelect;

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
// CLIENT ONBOARDING TOKENS - Secure onboarding links
// ============================================================================
export const clientOnboardingTokens = pgTable("client_onboarding_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clientOnboardingTokensRelations = relations(clientOnboardingTokens, ({ one }) => ({
  client: one(clients, {
    fields: [clientOnboardingTokens.clientId],
    references: [clients.id],
  }),
}));

export const insertClientOnboardingTokenSchema = createInsertSchema(clientOnboardingTokens).omit({
  id: true,
  createdAt: true,
});
export type InsertClientOnboardingToken = z.infer<typeof insertClientOnboardingTokenSchema>;
export type ClientOnboardingToken = typeof clientOnboardingTokens.$inferSelect;

// ============================================================================
// REVIEW COMMENTS - Client feedback on newsletters (to-do style)
// ============================================================================
export const reviewComments = pgTable("review_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  reviewTokenId: varchar("review_token_id").references(() => reviewTokens.id, { onDelete: "set null" }),
  sectionId: text("section_id"),
  commentType: text("comment_type", { enum: ["change", "addition", "removal", "general", "content", "design", "links"] }).notNull().default("general"),
  content: text("content").notNull(),
  attachments: jsonb("attachments").$type<string[]>().default([]),
  isCompleted: boolean("is_completed").notNull().default(false),
  isInternal: boolean("is_internal").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedById: varchar("completed_by_id").references(() => users.id),
  createdById: varchar("created_by_id").references(() => users.id),
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
// CLIENT NOTES - Notes, tasks, and checklists per client
// ============================================================================
export const clientNotes = pgTable("client_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["note", "task", "checklist"] }).notNull().default("note"),
  content: text("content").notNull(),
  isCompleted: boolean("is_completed").notNull().default(false),
  priority: text("priority", { enum: ["low", "medium", "high"] }).default("medium"),
  sourceEmailId: text("source_email_id"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientNotesRelations = relations(clientNotes, ({ one }) => ({
  client: one(clients, {
    fields: [clientNotes.clientId],
    references: [clients.id],
  }),
  createdBy: one(users, {
    fields: [clientNotes.createdById],
    references: [users.id],
  }),
}));

export const insertClientNoteSchema = createInsertSchema(clientNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type ClientNote = typeof clientNotes.$inferSelect;

// ============================================================================
// CONTACTS - Client audience records
// ============================================================================
export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  tags: jsonb("tags").$type<string[]>().default(["all"]),
  isActive: boolean("is_active").notNull().default(true),
  archivedAt: timestamp("archived_at"),
  archivedById: varchar("archived_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contactsRelations = relations(contacts, ({ one }) => ({
  client: one(clients, {
    fields: [contacts.clientId],
    references: [clients.id],
  }),
  archivedBy: one(users, {
    fields: [contacts.archivedById],
    references: [users.id],
  }),
}));

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// ============================================================================
// CONTACT IMPORT JOBS - CSV import audit trail
// ============================================================================
export const contactImportJobs = pgTable("contact_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
  totalRows: integer("total_rows").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errors: jsonb("errors").$type<string[]>().default([]),
  mapping: jsonb("mapping").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contactImportJobsRelations = relations(contactImportJobs, ({ one }) => ({
  client: one(clients, {
    fields: [contactImportJobs.clientId],
    references: [clients.id],
  }),
}));

export const insertContactImportJobSchema = createInsertSchema(contactImportJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContactImportJob = z.infer<typeof insertContactImportJobSchema>;
export type ContactImportJob = typeof contactImportJobs.$inferSelect;

// ============================================================================
// CONTACT SEGMENTS - Tag-based audience groups
// ============================================================================
export const contactSegments = pgTable("contact_segments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tags: jsonb("tags").$type<string[]>().default(["all"]),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contactSegmentsRelations = relations(contactSegments, ({ one }) => ({
  client: one(clients, {
    fields: [contactSegments.clientId],
    references: [clients.id],
  }),
}));

export const insertContactSegmentSchema = createInsertSchema(contactSegments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContactSegment = z.infer<typeof insertContactSegmentSchema>;
export type ContactSegment = typeof contactSegments.$inferSelect;

// ============================================================================
// NEWSLETTER DELIVERIES / EVENTS - Postmark send + analytics
// ============================================================================
export const newsletterDeliveries = pgTable(
  "newsletter_deliveries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
    clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    audienceTag: text("audience_tag").default("all"),
    postmarkMessageId: text("postmark_message_id"),
    status: text("status", { enum: ["queued", "sent", "failed", "bounced", "unsubscribed"] })
      .notNull()
      .default("queued"),
    error: text("error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    newsletterStatusIdx: index("newsletter_deliveries_newsletter_status_idx").on(table.newsletterId, table.status),
    clientStatusIdx: index("newsletter_deliveries_client_status_idx").on(table.clientId, table.status),
    messageIdIdx: index("newsletter_deliveries_message_id_idx").on(table.postmarkMessageId),
  })
);

export const newsletterEvents = pgTable(
  "newsletter_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
    clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    email: text("email"),
    postmarkMessageId: text("postmark_message_id"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    newsletterEventIdx: index("newsletter_events_newsletter_event_idx").on(table.newsletterId, table.eventType),
    clientOccurredIdx: index("newsletter_events_client_occurred_idx").on(table.clientId, table.occurredAt),
    messageIdIdx: index("newsletter_events_message_id_idx").on(table.postmarkMessageId),
  })
);

export const supportActionAudits = pgTable(
  "support_action_audits",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    targetClientId: varchar("target_client_id").references(() => clients.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    actorIdx: index("support_action_audits_actor_idx").on(table.actorUserId),
    clientIdx: index("support_action_audits_client_idx").on(table.targetClientId),
    actionCreatedIdx: index("support_action_audits_action_created_idx").on(table.action, table.createdAt),
  })
);

export const diyFunnelEvents = pgTable(
  "diy_funnel_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    clientEventCreatedIdx: index("diy_funnel_events_client_event_created_idx").on(
      table.clientId,
      table.eventType,
      table.createdAt
    ),
    userCreatedIdx: index("diy_funnel_events_user_created_idx").on(table.userId, table.createdAt),
  })
);

export const crmSyncEvents = pgTable(
  "crm_sync_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["follow_up_boss", "kvcore", "boldtrail"] }).notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    dedupeIdx: uniqueIndex("crm_sync_events_client_provider_external_uq").on(
      table.clientId,
      table.provider,
      table.externalEventId
    ),
    clientCreatedIdx: index("crm_sync_events_client_created_idx").on(table.clientId, table.createdAt),
  })
);

export const newsletterSendJobs = pgTable(
  "newsletter_send_jobs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
    clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    requestedById: varchar("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider", { enum: ["postmark", "mailchimp", "html_export"] }).notNull().default("postmark"),
    audienceTag: text("audience_tag").notNull().default("all"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["queued", "processing", "completed", "failed", "canceled"] })
      .notNull()
      .default("queued"),
    scheduledFor: timestamp("scheduled_for").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusScheduledIdx: index("newsletter_send_jobs_status_scheduled_idx").on(table.status, table.scheduledFor),
    clientIdx: index("newsletter_send_jobs_client_idx").on(table.clientId),
    newsletterIdx: index("newsletter_send_jobs_newsletter_idx").on(table.newsletterId),
    idempotencyIdx: uniqueIndex("newsletter_send_jobs_newsletter_idempotency_uq").on(
      table.newsletterId,
      table.idempotencyKey
    ),
  })
);

export const insertNewsletterDeliverySchema = createInsertSchema(newsletterDeliveries).omit({
  id: true,
  createdAt: true,
});
export type InsertNewsletterDelivery = z.infer<typeof insertNewsletterDeliverySchema>;
export type NewsletterDelivery = typeof newsletterDeliveries.$inferSelect;

export const insertNewsletterEventSchema = createInsertSchema(newsletterEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertNewsletterEvent = z.infer<typeof insertNewsletterEventSchema>;
export type NewsletterEvent = typeof newsletterEvents.$inferSelect;

export const insertSupportActionAuditSchema = createInsertSchema(supportActionAudits).omit({
  id: true,
  createdAt: true,
});
export type InsertSupportActionAudit = z.infer<typeof insertSupportActionAuditSchema>;
export type SupportActionAudit = typeof supportActionAudits.$inferSelect;

export const insertDiyFunnelEventSchema = createInsertSchema(diyFunnelEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertDiyFunnelEvent = z.infer<typeof insertDiyFunnelEventSchema>;
export type DiyFunnelEvent = typeof diyFunnelEvents.$inferSelect;

export const insertCrmSyncEventSchema = createInsertSchema(crmSyncEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertCrmSyncEvent = z.infer<typeof insertCrmSyncEventSchema>;
export type CrmSyncEvent = typeof crmSyncEvents.$inferSelect;

export const insertNewsletterSendJobSchema = createInsertSchema(newsletterSendJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNewsletterSendJob = z.infer<typeof insertNewsletterSendJobSchema>;
export type NewsletterSendJob = typeof newsletterSendJobs.$inferSelect;

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

export const NEWSLETTER_BLOCK_TYPES = [
  "text",
  "image",
  "button",
  "divider",
  "socials",
  "grid",
  "image_button",
] as const;

export type NewsletterBlockType = typeof NEWSLETTER_BLOCK_TYPES[number];

export interface NewsletterBlock {
  id: string;
  type: NewsletterBlockType;
  data: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export const BLOCK_EDIT_OPERATION_TYPES = [
  "update_block_data",
  "insert_block_after",
  "remove_block",
  "move_block",
] as const;
export type BlockEditOperationType = typeof BLOCK_EDIT_OPERATION_TYPES[number];

export type BlockEditOperation =
  | {
      op: "update_block_data";
      blockId: string;
      patch: Record<string, unknown>;
      reason?: string;
    }
  | {
      op: "insert_block_after";
      afterBlockId: string;
      blockType: NewsletterBlockType;
      data: Record<string, unknown>;
      reason?: string;
    }
  | {
      op: "remove_block";
      blockId: string;
      reason?: string;
    }
  | {
      op: "move_block";
      blockId: string;
      direction: "up" | "down";
      reason?: string;
    };

export interface BlockEditSuggestion {
  summary: string;
  operations: BlockEditOperation[];
}

export interface NewsletterDocumentMeta {
  subject?: string;
  previewText?: string;
  fromEmail?: string;
  replyTo?: string;
  sendMode?: NewsletterSendMode;
  timezone?: string;
  // Delivery transport. postmark=primary, mailchimp=client-linked API flow, html_export=manual external send.
  deliveryProvider?: "postmark" | "mailchimp" | "html_export";
  // Tag-based segment selector (defaults to "all").
  // Used by send/schedule to decide which contacts receive the campaign.
  audienceTag?: string;
  // DIY lane rendering/editing hints.
  simpleMode?: boolean;
  firstTemplateLocked?: boolean;
}

// V1 block editor document with HTML fallback for legacy compatibility
export interface NewsletterDocument {
  version?: "v1";
  templateId?: string;
  theme?: Partial<NewsletterTheme>;
  blocks?: NewsletterBlock[];
  meta?: NewsletterDocumentMeta;
  html?: string;
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
  version: "v1",
  blocks: [],
  meta: {
    sendMode: "ai_recommended",
    timezone: "America/New_York",
  },
  html: "",
};

// Zod schemas for runtime validation
export const newsletterDocumentSchema = z.object({
  version: z.literal("v1").optional(),
  templateId: z.string().optional(),
  theme: z.record(z.unknown()).optional(),
  blocks: z.array(
    z.object({
      id: z.string(),
      type: z.enum(NEWSLETTER_BLOCK_TYPES),
      data: z.record(z.unknown()),
      options: z.record(z.unknown()).optional(),
    })
  ).optional(),
  meta: z.object({
    subject: z.string().optional(),
    previewText: z.string().optional(),
    fromEmail: z.string().optional(),
    sendMode: z.enum(NEWSLETTER_SEND_MODES).optional(),
    timezone: z.string().optional(),
    audienceTag: z.string().optional(),
  }).optional(),
  html: z.string().optional(),
});

export function getNewsletterDocumentHtml(document: NewsletterDocument | LegacyNewsletterDocument | null | undefined): string {
  if (!document) return "";
  if (typeof (document as NewsletterDocument).html === "string") {
    return (document as NewsletterDocument).html || "";
  }
  if (typeof (document as LegacyNewsletterDocument).html === "string") {
    return (document as LegacyNewsletterDocument).html || "";
  }
  return "";
}

export function createNewsletterDocumentFromHtml(html: string): NewsletterDocument {
  return {
    ...DEFAULT_NEWSLETTER_DOCUMENT,
    blocks: [...(DEFAULT_NEWSLETTER_DOCUMENT.blocks || [])],
    meta: { ...(DEFAULT_NEWSLETTER_DOCUMENT.meta || {}) },
    html: html.trim(),
  };
}

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

// ============================================================================
// NEWSLETTER CHAT MESSAGES - Persistent AI chat per newsletter
// ============================================================================
export const newsletterChatMessages = pgTable("newsletter_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const newsletterChatMessagesRelations = relations(newsletterChatMessages, ({ one }) => ({
  newsletter: one(newsletters, {
    fields: [newsletterChatMessages.newsletterId],
    references: [newsletters.id],
  }),
}));

export const insertNewsletterChatMessageSchema = createInsertSchema(newsletterChatMessages).omit({
  id: true,
  createdAt: true,
});
export type InsertNewsletterChatMessage = z.infer<typeof insertNewsletterChatMessageSchema>;
export type NewsletterChatMessage = typeof newsletterChatMessages.$inferSelect;

// ============================================================================
// AI PROMPTS - Master and client-level system prompts
// ============================================================================
export const aiPrompts = pgTable("ai_prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type", { enum: ["master", "client"] }).notNull(),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiPromptsRelations = relations(aiPrompts, ({ one }) => ({
  client: one(clients, {
    fields: [aiPrompts.clientId],
    references: [clients.id],
  }),
}));

export const insertAiPromptSchema = createInsertSchema(aiPrompts).omit({
  id: true,
  updatedAt: true,
});
export type InsertAiPrompt = z.infer<typeof insertAiPromptSchema>;
export type AiPrompt = typeof aiPrompts.$inferSelect;
