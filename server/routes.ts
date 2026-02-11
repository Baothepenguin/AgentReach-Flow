import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { compileNewsletterToHtml } from "./email-compiler";
import { processHtmlCommand } from "./ai-service";
import { generateEmailFromPrompt, editEmailWithAI, suggestSubjectLines } from "./gemini-email-service";
import { renderMjml, validateMjml } from "./mjml-service";
import { createSenderSignature, getSenderSignature } from "./postmark-service";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { DEFAULT_NEWSLETTER_DOCUMENT, type NewsletterDocument, type LegacyNewsletterDocument, type NewsletterStatus, NEWSLETTER_STATUSES } from "@shared/schema";
import { randomUUID } from "crypto";
import session from "express-session";
import MemoryStore from "memorystore";
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

const SessionStore = MemoryStore(session);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      store: new SessionStore({ checkPeriod: 86400000 }),
      cookie: {
        secure: process.env.NODE_ENV === "production",
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

  app.post("/api/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.createClient(req.body);
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
      
      res.status(201).json(client);
    } catch (error) {
      console.error("Create client error:", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", requireAuth, async (req: Request, res: Response) => {
    try {
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
            const formattedDate = format(sendDate, "MMM d");
            const title = `${client.name} - ${formattedDate}`;
            
            const newsletter = await storage.createNewsletter({
              clientId,
              subscriptionId: subscription.id,
              title,
              expectedSendDate: format(sendDate, "yyyy-MM-dd"),
              status: "not_started",
              documentJson: { html: "" },
              createdById: userId,
            });
            
            const version = await storage.createVersion({
              newsletterId: newsletter.id,
              versionNumber: 1,
              snapshotJson: { html: "" },
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
      await storage.recalculateClientSubscriptionStatus(clientId);
      res.status(201).json(subscription);
    } catch (error) {
      console.error("Create subscription error:", error);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  app.patch("/api/subscriptions/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getSubscription(req.params.id);
      const subscription = await storage.updateSubscription(req.params.id, req.body);
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
      const invoices = await storage.getAllInvoices();
      const clients = await storage.getClients();
      const clientMap = new Map(clients.map(c => [c.id, c]));

      const enrichedInvoices = invoices.map(inv => ({
        ...inv,
        client: clientMap.get(inv.clientId),
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

      let linkedSubscriptionId = subscriptionId;
      if (!linkedSubscriptionId) {
        const subscriptions = await storage.getSubscriptionsByClient(clientId);
        const activeSubscription = subscriptions.find(s => s.status === "active");
        if (activeSubscription) {
          linkedSubscriptionId = activeSubscription.id;
        }
      }

      const invoice = await storage.createInvoice({
        clientId,
        subscriptionId: linkedSubscriptionId || null,
        amount,
        currency: currency || "USD",
        stripePaymentId,
        status: stripePaymentId ? "paid" : "pending",
        paidAt: stripePaymentId ? new Date() : null,
      });

      const sendDate = new Date(expectedSendDate);
      const formattedDate = sendDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const title = `${client.name} - ${formattedDate}`;

      const latestNewsletter = await storage.getLatestClientNewsletter(client.id);
      let documentJson: NewsletterDocument;

      if (latestNewsletter?.documentJson?.html) {
        documentJson = { html: latestNewsletter.documentJson.html };
      } else {
        documentJson = { html: "" };
      }

      const newsletter = await storage.createNewsletter({
        clientId: client.id,
        invoiceId: invoice.id,
        subscriptionId: linkedSubscriptionId || null,
        title,
        expectedSendDate: expectedSendDate,
        status: "not_started",
        documentJson,
        createdById: userId,
      });

      const version = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: 1,
        snapshotJson: documentJson,
        createdById: userId,
        changeSummary: "Initial version from invoice",
      });

      await storage.updateNewsletter(newsletter.id, { currentVersionId: version.id });

      res.status(201).json({ invoice, newsletter: { ...newsletter, currentVersionId: version.id } });
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
        const statuses = status.split(",") as NewsletterStatus[];
        newsletters = await storage.getNewslettersByStatus(statuses);
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
      const { expectedSendDate, importedHtml } = req.body;

      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const sendDate = new Date(expectedSendDate);
      const formattedDate = sendDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const title = `${client.name} - ${formattedDate}`;

      let documentJson: NewsletterDocument;

      if (importedHtml && importedHtml.trim()) {
        documentJson = { html: importedHtml.trim() };
      } else {
        const latestNewsletter = await storage.getLatestClientNewsletter(client.id);
        const latestHtml = (latestNewsletter?.documentJson as NewsletterDocument | LegacyNewsletterDocument | null)?.html;
        documentJson = { html: latestHtml || "" };
      }

      const newsletter = await storage.createNewsletter({
        clientId: req.params.clientId,
        title,
        expectedSendDate,
        status: "not_started",
        documentJson,
        createdById: userId,
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

      let document: NewsletterDocument = newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT;
      if (newsletter.currentVersionId) {
        const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
        if (currentVersion) {
          document = currentVersion.snapshotJson as NewsletterDocument;
        }
      }

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

      if (documentJson) {
        const newsletter = await storage.getNewsletter(req.params.id);
        if (!newsletter) {
          return res.status(404).json({ error: "Newsletter not found" });
        }

        const versions = await storage.getVersionsByNewsletter(newsletter.id);
        const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
        const existingDoc = (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;
        
        const newDoc = { ...existingDoc, ...documentJson };
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

        if (otherFields.status === "sent" && !updateData.sendDate) {
          updateData.sendDate = new Date().toISOString().split("T")[0];
        }

        const updated = await storage.updateNewsletter(req.params.id, updateData);
        return res.json(updated);
      }

      const updateData: any = {
        ...otherFields,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      };
      
      if (designJson) {
        updateData.designJson = designJson;
      }

      if (otherFields.status === "sent" && !updateData.sendDate) {
        updateData.sendDate = new Date().toISOString().split("T")[0];
      }

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
      const documentJson: NewsletterDocument = (currentVersion?.snapshotJson || original.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;

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
        subscriptionId: original.subscriptionId || null,
        title: original.title + " (Copy)",
        status: "not_started",
        documentJson,
        expectedSendDate,
        createdById: userId,
      });

      const version = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: 1,
        snapshotJson: documentJson,
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
      const document = (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;

      if (!document.html) {
        return res.json({ type: "error", message: "No HTML content to edit" });
      }

      const htmlResponse = await processHtmlCommand(command, document.html, brandingKit || null);
      
      if (htmlResponse.type === "error") {
        return res.json({ type: "error", message: htmlResponse.message });
      }

      const trimmedHtml = htmlResponse.html?.trim() || "";
      if (!trimmedHtml || !trimmedHtml.includes("<") || trimmedHtml.length < 100) {
        return res.json({ type: "error", message: "AI returned invalid HTML. Please try a different command." });
      }

      const newDoc: NewsletterDocument = { html: trimmedHtml };
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

      const newDoc: NewsletterDocument = { html: result.html };
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

      const newDoc: NewsletterDocument = { html: result.html };
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
      const document = (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;

      if (!document.html) {
        return res.status(400).json({ error: "No content to analyze" });
      }

      const subjects = await suggestSubjectLines(document.html);
      return res.json({ subjects });
    } catch (error) {
      console.error("Subject suggest error:", error);
      res.status(500).json({ error: "Failed to suggest subject lines" });
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
      const document = (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;
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

      if (reviewToken.singleUse) {
        await storage.markTokenUsed(reviewToken.id);
      }
      await storage.updateNewsletter(reviewToken.newsletterId, { status: "approved" });

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

      const reviewComment = await storage.createReviewComment({
        newsletterId: reviewToken.newsletterId,
        reviewTokenId: reviewToken.id,
        sectionId: sectionId || null,
        commentType: commentType || "general",
        content: comment || "Change requested",
        attachments: [],
      });

      await storage.updateNewsletter(reviewToken.newsletterId, { status: "revisions" });

      res.json({ success: true, comment: reviewComment });
    } catch (error) {
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

      const comment = await storage.createReviewComment({
        newsletterId: reviewToken.newsletterId,
        reviewTokenId: reviewToken.id,
        sectionId: sectionId || null,
        commentType: commentType || "general",
        content,
        attachments: attachments || [],
      });

      await storage.updateNewsletter(reviewToken.newsletterId, { status: "revisions" });
      res.status(201).json(comment);
    } catch (error) {
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
        commentType: "general",
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

  app.post("/api/newsletters/:id/send-for-review", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
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

      await storage.updateNewsletter(newsletter.id, { status: "client_review" });

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

      const restoredDoc = targetVersion.snapshotJson as NewsletterDocument;
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
      const document = (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;
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

  return httpServer;
}
