import {
  users,
  clients,
  clientDna,
  assets,
  newsletters,
  newsletterVersions,
  aiDrafts,
  tasksFlags,
  reviewTokens,
  integrationSettings,
  type User,
  type InsertUser,
  type Client,
  type InsertClient,
  type ClientDna,
  type InsertClientDna,
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
  type NewsletterDocument,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined>;

  // Client DNA
  getClientDna(clientId: string): Promise<ClientDna | undefined>;
  upsertClientDna(dna: InsertClientDna): Promise<ClientDna>;

  // Newsletters
  getNewslettersByClient(clientId: string): Promise<Newsletter[]>;
  getNewsletter(id: string): Promise<Newsletter | undefined>;
  createNewsletter(newsletter: InsertNewsletter): Promise<Newsletter>;
  updateNewsletter(id: string, data: Partial<InsertNewsletter>): Promise<Newsletter | undefined>;

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
  createReviewToken(data: InsertReviewToken): Promise<ReviewToken>;
  markTokenUsed(id: string): Promise<void>;
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

  // Client DNA
  async getClientDna(clientId: string): Promise<ClientDna | undefined> {
    const [dna] = await db.select().from(clientDna).where(eq(clientDna.clientId, clientId));
    return dna;
  }

  async upsertClientDna(dna: InsertClientDna): Promise<ClientDna> {
    const existing = await this.getClientDna(dna.clientId);
    if (existing) {
      const [updated] = await db
        .update(clientDna)
        .set({ ...dna, updatedAt: new Date() })
        .where(eq(clientDna.clientId, dna.clientId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(clientDna).values(dna).returning();
    return created;
  }

  // Newsletters
  async getNewslettersByClient(clientId: string): Promise<Newsletter[]> {
    return db
      .select()
      .from(newsletters)
      .where(eq(newsletters.clientId, clientId))
      .orderBy(desc(newsletters.periodStart));
  }

  async getNewsletter(id: string): Promise<Newsletter | undefined> {
    const [newsletter] = await db.select().from(newsletters).where(eq(newsletters.id, id));
    return newsletter;
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

  async createReviewToken(data: InsertReviewToken): Promise<ReviewToken> {
    const [rt] = await db.insert(reviewTokens).values(data).returning();
    return rt;
  }

  async markTokenUsed(id: string): Promise<void> {
    await db.update(reviewTokens).set({ usedAt: new Date() }).where(eq(reviewTokens.id, id));
  }
}

export const storage = new DatabaseStorage();
