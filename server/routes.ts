import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { compileNewsletterToHtml } from "./email-compiler";
import { processAICommand, generateNewsletterContent, applyOperationsToDocument } from "./ai-service";
import { DEFAULT_NEWSLETTER_DOCUMENT, type NewsletterDocument, type AIIntentResponse } from "@shared/schema";
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

  const requireAuth = (req: Request, res: Response, next: Function) => {
    const userId = (req.session as { userId?: string }).userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    (req as Request & { userId: string }).userId = userId;
    next();
  };

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
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      const dna = await storage.getClientDna(client.id);
      res.json({ ...client, dna });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch client" });
    }
  });

  app.post("/api/clients", requireAuth, async (req: Request, res: Response) => {
    try {
      const client = await storage.createClient(req.body);
      await storage.upsertClientDna({ clientId: client.id });
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
      const { title, periodStart } = req.body;

      const newsletter = await storage.createNewsletter({
        clientId: req.params.clientId,
        title,
        periodStart,
        status: "draft",
        createdById: userId,
      });

      const initialDoc = { ...DEFAULT_NEWSLETTER_DOCUMENT };
      const version = await storage.createVersion({
        newsletterId: newsletter.id,
        versionNumber: 1,
        snapshotJson: initialDoc,
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
      const newsletter = await storage.getNewsletter(req.params.id);
      if (!newsletter) {
        return res.status(404).json({ error: "Newsletter not found" });
      }

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const flags = await storage.getFlagsByNewsletter(newsletter.id);
      const aiDrafts = await storage.getAiDraftsByNewsletter(newsletter.id);

      let document: NewsletterDocument = DEFAULT_NEWSLETTER_DOCUMENT;
      if (newsletter.currentVersionId) {
        const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
        if (currentVersion) {
          document = currentVersion.snapshotJson as NewsletterDocument;
        }
      }

      const html = compileNewsletterToHtml(document);

      res.json({
        newsletter,
        document,
        versions,
        flags,
        aiDrafts,
        html,
      });
    } catch (error) {
      console.error("Get newsletter error:", error);
      res.status(500).json({ error: "Failed to fetch newsletter" });
    }
  });

  app.patch("/api/newsletters/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const newsletter = await storage.updateNewsletter(req.params.id, req.body);
      res.json(newsletter);
    } catch (error) {
      res.status(500).json({ error: "Failed to update newsletter" });
    }
  });

  app.patch("/api/newsletters/:id/modules/:moduleId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { userId: string }).userId;
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
      const updatedModule = req.body;

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

      await storage.updateNewsletter(newsletter.id, { currentVersionId: newVersion.id });

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
      const clientDna = client ? await storage.getClientDna(client.id) : null;

      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = (currentVersion?.snapshotJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;

      const aiResponse = await processAICommand(command, selectedModuleId, document, clientDna);

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

        await storage.updateNewsletter(newsletter.id, { currentVersionId: newVersion.id });

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
      const clientDna = client ? await storage.getClientDna(client.id) : null;

      const targetMonth = new Date(newsletter.periodStart);
      const region = client?.locationRegion || client?.locationCity || "";

      const { content, sources } = await generateNewsletterContent(clientDna, targetMonth, region);

      const draft = await storage.createAiDraft({
        newsletterId: newsletter.id,
        createdById: userId,
        intent: "Generate newsletter content",
        draftJson: content,
        sourcesJson: sources,
        validationJson: { warnings: [], errors: [] },
      });

      res.json({ draft, content, sources });
    } catch (error) {
      console.error("Generate content error:", error);
      res.status(500).json({ error: "Content generation failed" });
    }
  });

  app.get("/api/review/:token", async (req: Request, res: Response) => {
    try {
      const reviewToken = await storage.getReviewToken(req.params.token);
      if (!reviewToken) {
        return res.json({ expired: true });
      }

      if (reviewToken.expiresAt && new Date(reviewToken.expiresAt) < new Date()) {
        return res.json({ expired: true });
      }

      if (reviewToken.usedAt) {
        return res.json({ expired: true });
      }

      const newsletter = await storage.getNewsletter(reviewToken.newsletterId);
      if (!newsletter) {
        return res.json({ expired: true });
      }

      const client = await storage.getClient(newsletter.clientId);
      const versions = await storage.getVersionsByNewsletter(newsletter.id);
      const currentVersion = versions.find((v) => v.id === newsletter.currentVersionId);
      const document = (currentVersion?.snapshotJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;
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
      const reviewToken = await storage.getReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid token" });
      }

      await storage.markTokenUsed(reviewToken.id);
      await storage.updateNewsletter(reviewToken.newsletterId, { status: "approved" });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Approval failed" });
    }
  });

  app.post("/api/review/:token/request-changes", async (req: Request, res: Response) => {
    try {
      const { comment } = req.body;
      const reviewToken = await storage.getReviewToken(req.params.token);
      if (!reviewToken) {
        return res.status(404).json({ error: "Invalid token" });
      }

      await storage.markTokenUsed(reviewToken.id);
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
      const document = (currentVersion?.snapshotJson || DEFAULT_NEWSLETTER_DOCUMENT) as NewsletterDocument;
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
