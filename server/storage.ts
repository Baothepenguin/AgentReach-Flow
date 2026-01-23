import {
  users,
  clients,
  brandingKits,
  projects,
  htmlTemplates,
  subscriptions,
  invoices,
  newsletters,
  newsletterVersions,
  aiDrafts,
  tasksFlags,
  reviewTokens,
  reviewComments,
  integrationSettings,
  productionTasks,
  type User,
  type InsertUser,
  type Client,
  type InsertClient,
  type BrandingKit,
  type InsertBrandingKit,
  type Project,
  type InsertProject,
  type HtmlTemplate,
  type InsertHtmlTemplate,
  type Subscription,
  type InsertSubscription,
  type Invoice,
  type InsertInvoice,
  type Newsletter,
  type InsertNewsletter,
  type NewsletterVersion,
  type InsertNewsletterVersion,
  type AiDraft,
  type InsertAiDraft,
  type TasksFlags,
  type InsertTasksFlags,
  type ReviewToken,
  type InsertReviewToken,
  type ReviewComment,
  type InsertReviewComment,
  type ProductionTask,
  type InsertProductionTask,
  type NewsletterDocument,
  type NewsletterStatus,
  NEWSLETTER_STATUSES,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ne, isNull, or, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  getClientWithRelations(id: string): Promise<{
    client: Client;
    brandingKit?: BrandingKit;
    subscriptions: Subscription[];
    invoices: Invoice[];
    newsletters: Newsletter[];
  } | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined>;

  // Branding Kits
  getBrandingKit(clientId: string): Promise<BrandingKit | undefined>;
  upsertBrandingKit(kit: InsertBrandingKit): Promise<BrandingKit>;

  // Subscriptions
  getSubscriptionsByClient(clientId: string): Promise<Subscription[]>;
  getSubscription(id: string): Promise<Subscription | undefined>;
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription | undefined>;

  // Invoices
  getAllInvoices(): Promise<Invoice[]>;
  getInvoicesByClient(clientId: string): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined>;

  // Newsletters
  getAllNewsletters(): Promise<Newsletter[]>;
  getNewslettersByClient(clientId: string): Promise<Newsletter[]>;
  getNewslettersByStatus(statuses: NewsletterStatus[]): Promise<Newsletter[]>;
  getNewsletter(id: string): Promise<Newsletter | undefined>;
  getNewsletterWithClient(id: string): Promise<{ newsletter: Newsletter; client: Client } | undefined>;
  createNewsletter(newsletter: InsertNewsletter): Promise<Newsletter>;
  updateNewsletter(id: string, data: Partial<InsertNewsletter>): Promise<Newsletter | undefined>;
  getLatestClientNewsletter(clientId: string): Promise<Newsletter | undefined>;

  // Newsletter Versions
  getVersionsByNewsletter(newsletterId: string): Promise<NewsletterVersion[]>;
  getVersion(id: string): Promise<NewsletterVersion | undefined>;
  createVersion(version: InsertNewsletterVersion): Promise<NewsletterVersion>;
  getLatestVersionNumber(newsletterId: string): Promise<number>;

  // AI Drafts
  getAiDraftsByNewsletter(newsletterId: string): Promise<AiDraft[]>;
  createAiDraft(draft: InsertAiDraft): Promise<AiDraft>;

  // Tasks/Flags
  getFlagsByNewsletter(newsletterId: string): Promise<TasksFlags[]>;
  createFlag(flag: InsertTasksFlags): Promise<TasksFlags>;
  resolveFlag(id: string): Promise<void>;

  // Review Tokens
  getReviewToken(token: string): Promise<ReviewToken | undefined>;
  getValidReviewToken(token: string): Promise<ReviewToken | undefined>;
  createReviewToken(data: InsertReviewToken): Promise<ReviewToken>;
  markTokenUsed(id: string): Promise<void>;

  // Review Comments
  getReviewCommentsByNewsletter(newsletterId: string): Promise<ReviewComment[]>;
  createReviewComment(comment: InsertReviewComment): Promise<ReviewComment>;
  updateReviewComment(id: string, data: Partial<InsertReviewComment>): Promise<ReviewComment | undefined>;
  toggleReviewCommentComplete(id: string, userId: string): Promise<ReviewComment | undefined>;

  // Projects
  getProjectsByClient(clientId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;

  // HTML Templates
  getTemplates(): Promise<HtmlTemplate[]>;
  getTemplate(id: string): Promise<HtmlTemplate | undefined>;
  getDefaultTemplate(): Promise<HtmlTemplate | undefined>;
  createTemplate(template: InsertHtmlTemplate): Promise<HtmlTemplate>;
  updateTemplate(id: string, data: Partial<InsertHtmlTemplate>): Promise<HtmlTemplate | undefined>;

  // Production Tasks
  getProductionTasks(): Promise<ProductionTask[]>;
  getProductionTask(id: string): Promise<ProductionTask | undefined>;
  createProductionTask(task: InsertProductionTask): Promise<ProductionTask>;
  updateProductionTask(id: string, data: Partial<InsertProductionTask>): Promise<ProductionTask | undefined>;
  deleteProductionTask(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Clients
  async getClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async getClientWithRelations(id: string): Promise<{
    client: Client;
    brandingKit?: BrandingKit;
    subscriptions: Subscription[];
    invoices: Invoice[];
    newsletters: Newsletter[];
  } | undefined> {
    const client = await this.getClient(id);
    if (!client) return undefined;

    const [brandingKit, subs, invs, nls] = await Promise.all([
      this.getBrandingKit(id),
      this.getSubscriptionsByClient(id),
      this.getInvoicesByClient(id),
      this.getNewslettersByClient(id),
    ]);

    return {
      client,
      brandingKit: brandingKit || undefined,
      subscriptions: subs,
      invoices: invs,
      newsletters: nls,
    };
  }

  async createClient(insertClient: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(insertClient).returning();
    return client;
  }

  async updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined> {
    const [client] = await db
      .update(clients)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return client;
  }

  // Branding Kits
  async getBrandingKit(clientId: string): Promise<BrandingKit | undefined> {
    const [kit] = await db.select().from(brandingKits).where(eq(brandingKits.clientId, clientId));
    return kit;
  }

  async upsertBrandingKit(kit: InsertBrandingKit): Promise<BrandingKit> {
    const existing = await this.getBrandingKit(kit.clientId);
    if (existing) {
      const [updated] = await db
        .update(brandingKits)
        .set({ ...kit, updatedAt: new Date() })
        .where(eq(brandingKits.clientId, kit.clientId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(brandingKits).values(kit).returning();
    return created;
  }

  // Subscriptions
  async getSubscriptionsByClient(clientId: string): Promise<Subscription[]> {
    return db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.clientId, clientId))
      .orderBy(desc(subscriptions.createdAt));
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
    return sub;
  }

  async createSubscription(insertSub: InsertSubscription): Promise<Subscription> {
    const [sub] = await db.insert(subscriptions).values(insertSub).returning();
    return sub;
  }

  async updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription | undefined> {
    const [sub] = await db
      .update(subscriptions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
      .returning();
    return sub;
  }

  // Invoices
  async getAllInvoices(): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoicesByClient(clientId: string): Promise<Invoice[]> {
    return db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, clientId))
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
    return inv;
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const [inv] = await db.insert(invoices).values(insertInvoice).returning();
    return inv;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [inv] = await db
      .update(invoices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return inv;
  }

  // Newsletters
  async getAllNewsletters(): Promise<Newsletter[]> {
    return db
      .select()
      .from(newsletters)
      .orderBy(desc(newsletters.expectedSendDate));
  }

  async getNewslettersByClient(clientId: string): Promise<Newsletter[]> {
    return db
      .select()
      .from(newsletters)
      .where(eq(newsletters.clientId, clientId))
      .orderBy(desc(newsletters.expectedSendDate));
  }

  async getNewslettersByStatus(statuses: NewsletterStatus[]): Promise<Newsletter[]> {
    return db
      .select()
      .from(newsletters)
      .where(inArray(newsletters.status, statuses))
      .orderBy(desc(newsletters.expectedSendDate));
  }

  async getNewsletter(id: string): Promise<Newsletter | undefined> {
    const [newsletter] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    return newsletter;
  }

  async getNewsletterWithClient(id: string): Promise<{ newsletter: Newsletter; client: Client } | undefined> {
    const newsletter = await this.getNewsletter(id);
    if (!newsletter) return undefined;
    const client = await this.getClient(newsletter.clientId);
    if (!client) return undefined;
    return { newsletter, client };
  }

  async createNewsletter(insertNewsletter: InsertNewsletter): Promise<Newsletter> {
    const [newsletter] = await db.insert(newsletters).values(insertNewsletter).returning();
    return newsletter;
  }

  async updateNewsletter(id: string, data: Partial<InsertNewsletter>): Promise<Newsletter | undefined> {
    const [newsletter] = await db
      .update(newsletters)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(newsletters.id, id))
      .returning();
    return newsletter;
  }

  async deleteNewsletter(id: string): Promise<void> {
    await db.delete(newsletters).where(eq(newsletters.id, id));
  }

  async getLatestClientNewsletter(clientId: string): Promise<Newsletter | undefined> {
    const [newsletter] = await db
      .select()
      .from(newsletters)
      .where(and(
        eq(newsletters.clientId, clientId),
        ne(newsletters.status, "not_started")
      ))
      .orderBy(desc(newsletters.createdAt))
      .limit(1);
    return newsletter;
  }

  // Newsletter Versions
  async getVersionsByNewsletter(newsletterId: string): Promise<NewsletterVersion[]> {
    return db
      .select()
      .from(newsletterVersions)
      .where(eq(newsletterVersions.newsletterId, newsletterId))
      .orderBy(desc(newsletterVersions.versionNumber));
  }

  async getVersion(id: string): Promise<NewsletterVersion | undefined> {
    const [version] = await db
      .select()
      .from(newsletterVersions)
      .where(eq(newsletterVersions.id, id));
    return version;
  }

  async createVersion(insertVersion: InsertNewsletterVersion): Promise<NewsletterVersion> {
    const [version] = await db.insert(newsletterVersions).values(insertVersion).returning();
    return version;
  }

  async getLatestVersionNumber(newsletterId: string): Promise<number> {
    const versions = await db
      .select({ versionNumber: newsletterVersions.versionNumber })
      .from(newsletterVersions)
      .where(eq(newsletterVersions.newsletterId, newsletterId))
      .orderBy(desc(newsletterVersions.versionNumber))
      .limit(1);
    return versions[0]?.versionNumber || 0;
  }

  // AI Drafts
  async getAiDraftsByNewsletter(newsletterId: string): Promise<AiDraft[]> {
    return db
      .select()
      .from(aiDrafts)
      .where(eq(aiDrafts.newsletterId, newsletterId))
      .orderBy(desc(aiDrafts.createdAt));
  }

  async createAiDraft(insertDraft: InsertAiDraft): Promise<AiDraft> {
    const [draft] = await db.insert(aiDrafts).values(insertDraft).returning();
    return draft;
  }

  // Tasks/Flags
  async getFlagsByNewsletter(newsletterId: string): Promise<TasksFlags[]> {
    return db
      .select()
      .from(tasksFlags)
      .where(eq(tasksFlags.newsletterId, newsletterId))
      .orderBy(desc(tasksFlags.createdAt));
  }

  async createFlag(insertFlag: InsertTasksFlags): Promise<TasksFlags> {
    const [flag] = await db.insert(tasksFlags).values(insertFlag).returning();
    return flag;
  }

  async resolveFlag(id: string): Promise<void> {
    await db
      .update(tasksFlags)
      .set({ resolvedAt: new Date() })
      .where(eq(tasksFlags.id, id));
  }

  // Review Tokens
  async getReviewToken(token: string): Promise<ReviewToken | undefined> {
    const [rt] = await db.select().from(reviewTokens).where(eq(reviewTokens.token, token));
    return rt;
  }

  async getValidReviewToken(token: string): Promise<ReviewToken | undefined> {
    const [rt] = await db
      .select()
      .from(reviewTokens)
      .where(and(
        eq(reviewTokens.token, token),
        sql`${reviewTokens.expiresAt} > NOW()`,
        or(
          eq(reviewTokens.singleUse, false),
          isNull(reviewTokens.usedAt)
        )
      ));
    return rt;
  }

  async createReviewToken(data: InsertReviewToken): Promise<ReviewToken> {
    const [rt] = await db.insert(reviewTokens).values(data).returning();
    return rt;
  }

  async markTokenUsed(id: string): Promise<void> {
    await db.update(reviewTokens).set({ usedAt: new Date() }).where(eq(reviewTokens.id, id));
  }

  // Projects
  async getProjectsByClient(clientId: string): Promise<Project[]> {
    return db
      .select()
      .from(projects)
      .where(eq(projects.clientId, clientId))
      .orderBy(desc(projects.createdAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(insertProject).returning();
    return project;
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined> {
    const [project] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return project;
  }

  // HTML Templates
  async getTemplates(): Promise<HtmlTemplate[]> {
    return db
      .select()
      .from(htmlTemplates)
      .orderBy(desc(htmlTemplates.createdAt));
  }

  async getTemplate(id: string): Promise<HtmlTemplate | undefined> {
    const [template] = await db.select().from(htmlTemplates).where(eq(htmlTemplates.id, id));
    return template;
  }

  async getDefaultTemplate(): Promise<HtmlTemplate | undefined> {
    const [template] = await db.select().from(htmlTemplates).where(eq(htmlTemplates.isDefault, true));
    return template;
  }

  async createTemplate(insertTemplate: InsertHtmlTemplate): Promise<HtmlTemplate> {
    const [template] = await db.insert(htmlTemplates).values(insertTemplate).returning();
    return template;
  }

  async updateTemplate(id: string, data: Partial<InsertHtmlTemplate>): Promise<HtmlTemplate | undefined> {
    const [template] = await db
      .update(htmlTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(htmlTemplates.id, id))
      .returning();
    return template;
  }

  // Review Comments
  async getReviewCommentsByNewsletter(newsletterId: string): Promise<ReviewComment[]> {
    return db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.newsletterId, newsletterId))
      .orderBy(desc(reviewComments.createdAt));
  }

  async createReviewComment(comment: InsertReviewComment): Promise<ReviewComment> {
    const [created] = await db.insert(reviewComments).values(comment).returning();
    return created;
  }

  async updateReviewComment(id: string, data: Partial<InsertReviewComment>): Promise<ReviewComment | undefined> {
    const [updated] = await db
      .update(reviewComments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(reviewComments.id, id))
      .returning();
    return updated;
  }

  async toggleReviewCommentComplete(id: string, userId: string): Promise<ReviewComment | undefined> {
    const [existing] = await db.select().from(reviewComments).where(eq(reviewComments.id, id));
    if (!existing) return undefined;

    const [updated] = await db
      .update(reviewComments)
      .set({
        isCompleted: !existing.isCompleted,
        completedAt: existing.isCompleted ? null : new Date(),
        completedById: existing.isCompleted ? null : userId,
        updatedAt: new Date(),
      })
      .where(eq(reviewComments.id, id))
      .returning();
    return updated;
  }

  // Production Tasks
  async getProductionTasks(): Promise<ProductionTask[]> {
    return db.select().from(productionTasks).orderBy(desc(productionTasks.createdAt));
  }

  async getProductionTask(id: string): Promise<ProductionTask | undefined> {
    const [task] = await db.select().from(productionTasks).where(eq(productionTasks.id, id));
    return task;
  }

  async createProductionTask(task: InsertProductionTask): Promise<ProductionTask> {
    const [newTask] = await db.insert(productionTasks).values(task).returning();
    return newTask;
  }

  async updateProductionTask(id: string, data: Partial<InsertProductionTask>): Promise<ProductionTask | undefined> {
    const [updated] = await db
      .update(productionTasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(productionTasks.id, id))
      .returning();
    return updated;
  }

  async deleteProductionTask(id: string): Promise<void> {
    await db.delete(productionTasks).where(eq(productionTasks.id, id));
  }
}

export const storage = new DatabaseStorage();
