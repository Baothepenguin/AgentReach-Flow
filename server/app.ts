import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { registerRoutes } from "./routes";
import { WebhookHandlers } from "./webhookHandlers";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export async function createApp(): Promise<{ app: Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);

  // Basic request logging for API calls.
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    const originalResJson: any = res.json.bind(res);
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    res.json = function (bodyJson: any, ...args: any[]) {
      capturedJsonResponse = bodyJson;
      return originalResJson(bodyJson, ...args);
    } as any;

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          try {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          } catch {}
        }
        console.log(logLine);
      }
    });

    next();
  });

  // Stripe webhook must be registered before express.json() so raw body is preserved.
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signature = req.headers["stripe-signature"];
      if (!signature) {
        return res.status(400).json({ error: "Missing stripe-signature" });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        if (!Buffer.isBuffer(req.body)) {
          return res.status(500).json({ error: "Webhook processing error" });
        }
        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: any) {
        res.status(400).json({ error: "Webhook processing error" });
      }
    }
  );

  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));

  await registerRoutes(httpServer, app);
  return { app, httpServer };
}
