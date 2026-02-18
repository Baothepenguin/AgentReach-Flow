import type { Request, Response, NextFunction } from "express";
import { serveStatic } from "./static";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from "./stripeClient";
import { createApp } from "./app";

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn('DATABASE_URL not set, skipping Stripe initialization');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl } as any);
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    // Replit managed webhook setup is not applicable on Vercel/standard hosting.
    if (process.env.REPLIT_DOMAINS) {
      const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
      try {
        const result = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        console.log(`Stripe webhook configured: ${result?.webhook?.url || 'ready'}`);
      } catch (webhookErr) {
        console.warn('Stripe webhook setup skipped (may not be available in dev):', (webhookErr as any)?.message);
      }
    } else {
      console.log('Stripe managed webhook setup skipped (REPLIT_DOMAINS not set)');
    }

    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: any) => console.error('Error syncing Stripe data:', err));
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }
}

initStripe().catch(err => console.error('Stripe init error:', err));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

(async () => {
  const { app, httpServer } = await createApp();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    // Do not rethrow after responding; it can crash the process.
    console.error("Unhandled error:", err);
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  const reusePort =
    process.env.REUSE_PORT === "1" ||
    process.env.REPLIT_DEPLOYMENT === "1" ||
    Boolean(process.env.REPLIT_DOMAINS);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      ...(reusePort ? { reusePort: true } : {}),
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
