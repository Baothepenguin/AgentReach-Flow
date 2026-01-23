import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { compileNewsletterToHtml } from "./email-compiler";
import { processHtmlCommand } from "./ai-service";
import { createSenderSignature, getSenderSignature } from "./postmark-service";
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
  // BRANDING KITS
  // ============================================================================
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

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================
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
          
          res.status(201).json({ subscription, newsletters });
          return;
        }
      }
      
      res.status(201).json({ subscription, newsletters: [] });
    } catch (error) {
      console.error("Create subscription error:", error);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  app.patch("/api/subscriptions/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const subscription = await storage.updateSubscription(req.params.id, req.body);
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: "Failed to update subscription" });
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

      const newsletter = await storage.updateNewsletter(req.params.id, updateData);
      res.json(newsletter);
    } catch (error) {
      res.status(500).json({ error: "Failed to update newsletter" });
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

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${newsletter.title.replace(/[^a-z0-9]/gi, '_')}.html"`);
      res.send(html);
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

  return httpServer;
}
