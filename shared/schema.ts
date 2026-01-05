import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date, jsonb, integer, boolean, serial } from "drizzle-orm/pg-core";
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
  newsletterFrequency: text("newsletter_frequency", { enum: ["weekly", "monthly"] }).notNull().default("monthly"),
  status: text("status", { enum: ["active", "paused", "past_due", "canceled"] }).notNull().default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientsRelations = relations(clients, ({ one, many }) => ({
  dna: one(clientDna, {
    fields: [clients.id],
    references: [clientDna.clientId],
  }),
  assets: many(assets),
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
// CLIENT DNA - Brand/Tone preferences
// ============================================================================
export const clientDna = pgTable("client_dna", {
  clientId: varchar("client_id").primaryKey().references(() => clients.id, { onDelete: "cascade" }),
  tone: text("tone"),
  mustInclude: jsonb("must_include").$type<string[]>().default([]),
  avoidTopics: jsonb("avoid_topics").$type<string[]>().default([]),
  localLandmarks: jsonb("local_landmarks").$type<string[]>().default([]),
  brandColors: jsonb("brand_colors").$type<{ primary: string; secondary: string; accent: string }>(),
  fonts: jsonb("fonts").$type<{ heading: string; body: string }>(),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientDnaRelations = relations(clientDna, ({ one }) => ({
  client: one(clients, {
    fields: [clientDna.clientId],
    references: [clients.id],
  }),
}));

export const insertClientDnaSchema = createInsertSchema(clientDna).omit({
  updatedAt: true,
});
export type InsertClientDna = z.infer<typeof insertClientDnaSchema>;
export type ClientDna = typeof clientDna.$inferSelect;

// ============================================================================
// ASSETS - Client media files
// ============================================================================
export const assets = pgTable("assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["logo", "headshot", "image", "other"] }).notNull(),
  url: text("url").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const assetsRelations = relations(assets, ({ one }) => ({
  client: one(clients, {
    fields: [assets.clientId],
    references: [clients.id],
  }),
}));

export const insertAssetSchema = createInsertSchema(assets).omit({
  id: true,
  createdAt: true,
});
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assets.$inferSelect;

// ============================================================================
// NEWSLETTERS
// ============================================================================
export const newsletters = pgTable("newsletters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  periodStart: date("period_start").notNull(),
  status: text("status", { 
    enum: ["draft", "internal_review", "client_review", "revisions", "approved", "scheduled", "sent"] 
  }).notNull().default("draft"),
  currentVersionId: varchar("current_version_id"),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const newslettersRelations = relations(newsletters, ({ one, many }) => ({
  client: one(clients, {
    fields: [newsletters.clientId],
    references: [clients.id],
  }),
  createdBy: one(users, {
    fields: [newsletters.createdById],
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
// REVIEW TOKENS - Secure client review links
// ============================================================================
export const reviewTokens = pgTable("review_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  newsletterId: varchar("newsletter_id").notNull().references(() => newsletters.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at"),
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

// Base module interface
export interface BaseModule {
  id: string;
  type: string;
  locked?: boolean;
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

// Full newsletter document
export interface NewsletterDocument {
  templateId: string;
  theme: NewsletterTheme;
  modules: NewsletterModule[];
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

// Default newsletter template
export const DEFAULT_NEWSLETTER_DOCUMENT: NewsletterDocument = {
  templateId: "agent-001",
  theme: {
    bg: "#ffffff",
    text: "#1a1a1a",
    accent: "#1a5f4a",
    muted: "#6b7280",
    fontHeading: "Georgia, serif",
    fontBody: "Arial, sans-serif",
  },
  modules: [
    {
      id: "header-1",
      type: "HeaderNav",
      props: { navLinks: [] },
    },
    {
      id: "hero-1",
      type: "Hero",
      props: { title: "Monthly Newsletter", subtitle: "" },
    },
    {
      id: "welcome-1",
      type: "RichText",
      props: { content: "" },
    },
    {
      id: "events-1",
      type: "EventsList",
      props: { title: "Upcoming Events", events: [] },
    },
    {
      id: "market-1",
      type: "MarketUpdate",
      props: { title: "Market Update", paragraphs: [] },
    },
    {
      id: "news-1",
      type: "NewsCards",
      props: { title: "In The News", items: [] },
    },
    {
      id: "cta-1",
      type: "CTA",
      props: { headline: "Ready to Buy or Sell?", buttonText: "Contact Me", buttonUrl: "#" },
    },
    {
      id: "bio-1",
      type: "AgentBio",
      props: { name: "", title: "Real Estate Agent" },
    },
    {
      id: "footer-1",
      type: "FooterCompliance",
      props: {},
    },
  ],
};

// Zod schemas for runtime validation
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

export const newsletterDocumentSchema = z.object({
  templateId: z.string(),
  theme: newsletterThemeSchema,
  modules: z.array(z.object({
    id: z.string(),
    type: z.string(),
    locked: z.boolean().optional(),
    props: z.record(z.unknown()),
  })),
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
