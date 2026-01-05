import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { compileNewsletterToHtml } from "./email-compiler";
import { processAICommand, generateNewsletterContent, applyOperationsToDocument } from "./ai-service";
import { DEFAULT_NEWSLETTER_DOCUMENT, type NewsletterDocument, type AIIntentResponse, type NewsletterStatus, NEWSLETTER_STATUSES } from "@shared/schema";
import { randomUUID } from "crypto";
import session from "express-session";
import MemoryStore from "memorystore";
import bcrypt from "bcrypt";

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
      const subscription = await storage.createSubscription({
        clientId: req.params.clientId,
        ...req.body,
      });
      res.status(201).json(subscription);
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
      const { amount, currency, expectedSendDate, stripePaymentId } = req.body;

      const invoice = await storage.createInvoice({
        clientId: req.params.clientId,
        amount,
        currency: currency || "USD",
        stripePaymentId,
        status: stripePaymentId ? "paid" : "pending",
        paidAt: stripePaymentId ? new Date() : null,
      });

      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const sendDate = new Date(expectedSendDate);
      const formattedDate = sendDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const title = `${client.name} - ${formattedDate}`;

      const latestNewsletter = await storage.getLatestClientNewsletter(client.id);
      let documentJson: NewsletterDocument;

      if (latestNewsletter?.documentJson) {
        documentJson = JSON.parse(JSON.stringify(latestNewsletter.documentJson));
      } else {
        documentJson = JSON.parse(JSON.stringify(DEFAULT_NEWSLETTER_DOCUMENT));
        const brandingKit = await storage.getBrandingKit(client.id);
        if (brandingKit) {
          documentJson.theme.accent = brandingKit.primaryColor || "#1a5f4a";
          const headerModule = documentJson.modules.find(m => m.type === "HeaderNav");
          if (headerModule && headerModule.type === "HeaderNav") {
            headerModule.props.logoUrl = brandingKit.logo || "";
          }
          const bioModule = documentJson.modules.find(m => m.type === "AgentBio");
          if (bioModule && bioModule.type === "AgentBio") {
            bioModule.props.name = client.name;
            bioModule.props.title = brandingKit.title || "Real Estate Agent";
            bioModule.props.phone = brandingKit.phone || "";
            bioModule.props.email = brandingKit.email || client.primaryEmail;
            bioModule.props.photoUrl = brandingKit.headshot || "";
            const socials: Array<{ platform: string; url: string }> = [];
            if (brandingKit.facebook) socials.push({ platform: "facebook", url: brandingKit.facebook });
            if (brandingKit.instagram) socials.push({ platform: "instagram", url: brandingKit.instagram });
            if (brandingKit.linkedin) socials.push({ platform: "linkedin", url: brandingKit.linkedin });
            if (brandingKit.youtube) socials.push({ platform: "youtube", url: brandingKit.youtube });
            if (brandingKit.website) socials.push({ platform: "website", url: brandingKit.website });
            bioModule.props.socials = socials;
          }
          const footerModule = documentJson.modules.find(m => m.type === "FooterCompliance");
          if (footerModule && footerModule.type === "FooterCompliance") {
            footerModule.props.brokerage = brandingKit.companyName || "";
          }
        }
      }

      const newsletter = await storage.createNewsletter({
        clientId: client.id,
        invoiceId: invoice.id,
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
      const { expectedSendDate } = req.body;

      const client = await storage.getClient(req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      const sendDate = new Date(expectedSendDate);
      const formattedDate = sendDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const title = `${client.name} - ${formattedDate}`;

      const latestNewsletter = await storage.getLatestClientNewsletter(client.id);
      let documentJson: NewsletterDocument;

      if (latestNewsletter?.documentJson) {
        documentJson = JSON.parse(JSON.stringify(latestNewsletter.documentJson));
      } else {
        documentJson = JSON.parse(JSON.stringify(DEFAULT_NEWSLETTER_DOCUMENT));
        const brandingKit = await storage.getBrandingKit(client.id);
        if (brandingKit) {
          documentJson.theme.accent = brandingKit.primaryColor || "#1a5f4a";
          const bioModule = documentJson.modules.find(m => m.type === "AgentBio");
          if (bioModule && bioModule.type === "AgentBio") {
            bioModule.props.name = client.name;
            bioModule.props.title = brandingKit.title || "Real Estate Agent";
            bioModule.props.phone = brandingKit.phone || "";
            bioModule.props.email = brandingKit.email || client.primaryEmail;
          }
        }
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
      const newsletter = await storage.updateNewsletter(req.params.id, {
        ...req.body,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });
      res.json(newsletter);
    } catch (error) {
      res.status(500).json({ error: "Failed to update newsletter" });
    }
  });

  app.patch("/api/newsletters/:id/modules/:moduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const user = await storage.getUser(userId);
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const latestNum = await storage.getLatestVersionNumber(newsletter.id);
      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);

      if (!currentVersion) {
        return res.status(400).json({ error: "No current version" });
      }

      const document = currentVersion.snapshotJson as NewsletterDocument;
      const updatedModule = {
        ...req.body,
        metadata: {
          lastEditedAt: new Date().toISOString(),
          lastEditedById: userId,
          lastEditedByName: user?.name || "Unknown",
          origin: "human" as const,
        },
      };

      const newModules = document.modules.map((m) =>
        m.id === req.params.moduleId ? updatedModule : m
      );

      const newDoc = { ...document, modules: newModules };

      const newVersion = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: latestNum + 1,
        snapshotJson: newDoc,
        createdById: userId,
        changeSummary: `Updated module ${req.params.moduleId}`,
      });

      await storage.updateNewsletter(newsletter.id, {
        currentVersionId: newVersion.id,
        documentJson: newDoc,
        lastEditedById: userId,
        lastEditedAt: new Date(),
      });

      res.json({ success: true, version: newVersion });
    } catch (error) {
      console.error("Update module error:", error);
      res.status(500).json({ error: "Failed to update module" });
    }
  });

  app.post("/api/newsletters/:id/ai-command", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const { command, selectedModuleId } = req.body;

      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(client.id) : null;

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = (currentVersion?.snapshotJson || newsletter.documentJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;

      const aiResponse = await processAICommand(command, selectedModuleId, document, brandingKit || null);

      if (aiResponse.type === "REQUEST_CLARIFICATION") {
        return res.json({
          type: "clarification",
          message: aiResponse.question,
          options: aiResponse.options,
        });
      }

      if (aiResponse.type === "FLAG_FOR_REVIEW") {
        return res.json({
          type: "error",
          message: aiResponse.reason,
        });
      }

      if (aiResponse.type === "APPLY_PATCH" && aiResponse.operations) {
        const newDoc = applyOperationsToDocument(document, aiResponse.operations);
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

        return res.json({
          type: "success",
          message: "Changes applied successfully",
          version: newVersion,
        });
      }

      res.json({ type: "error", message: "Unknown AI response type" });
    } catch (error) {
      console.error("AI command error:", error);
      res.status(500).json({ error: "AI command failed" });
    }
  });

  app.post("/api/newsletters/:id/generate-content", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const client = await storage.getClient(newsletter.clientId);
      const brandingKit = client ? await storage.getBrandingKit(client.id) : null;

      const targetMonth = new Date(newsletter.expectedSendDate);
      const region = client?.locationRegion || client?.locationCity || "";

      const { content, sources } = await generateNewsletterContent(brandingKit || null, targetMonth, region);

      const draft = await storage.createAiDraft({
        newsletterId: newsletter.id,
        createdById: userId,
        intent: "Generate newsletter content",
        draftJson: content as unknown as Record<string, unknown>,
        sourcesJson: sources,
        validationJson: { warnings: [], errors: [] },
      });

      res.json({ draft, content, sources });
    } catch (error) {
      console.error("Generate content error:", error);
      res.status(500).json({ error: "Content generation failed" });
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
      const { comment } = req.body;
      const reviewToken = await storage.getValidReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid or expired token" });
      }

      if (reviewToken.singleUse) {
        await storage.markTokenUsed(reviewToken.id);
      }
      await storage.updateNewsletter(reviewToken.newsletterId, { status: "revisions" });

      await storage.createFlag({
        newsletterId: reviewToken.newsletterId,
        severity: "warning",
        code: "CLIENT_CHANGES_REQUESTED",
        message: comment || "Client requested changes",
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Request failed" });
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

  return httpServer;
}
