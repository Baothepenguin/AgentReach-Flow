import { storage } from "../server/storage";
import { pool } from "../server/db";

function assertSafeMode() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--confirm")) {
    throw new Error("Refusing to run without --confirm");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run relation repair in production");
  }
}

async function main() {
  assertSafeMode();

  const clients = await storage.getClients();
  let patchedInvoices = 0;
  let createdInvoices = 0;
  let patchedNewsletters = 0;

  for (const client of clients) {
    const subscriptions = await storage.getSubscriptionsByClient(client.id);
    const activeSubscription = subscriptions.find((sub) => sub.status === "active") || null;

    const invoices = await storage.getInvoicesByClient(client.id);
    for (const invoice of invoices) {
      if (!invoice.subscriptionId && activeSubscription) {
        await storage.updateInvoice(invoice.id, { subscriptionId: activeSubscription.id });
        patchedInvoices += 1;
      }
    }

    if (activeSubscription) {
      const refreshedInvoices = await storage.getInvoicesByClient(client.id);
      const linked = refreshedInvoices.some((invoice) => invoice.subscriptionId === activeSubscription.id);
      if (!linked) {
        await storage.createInvoice({
          clientId: client.id,
          subscriptionId: activeSubscription.id,
          amount: activeSubscription.amount,
          currency: activeSubscription.currency || "USD",
          status: "pending",
          paidAt: null,
          stripePaymentId: null,
        });
        createdInvoices += 1;
      }
    }

    const newsletters = await storage.getNewslettersByClient(client.id);
    const latestInvoiceBySubscription = new Map<string, string>();
    const invoicesAfter = await storage.getInvoicesByClient(client.id);
    for (const invoice of invoicesAfter) {
      if (!invoice.subscriptionId) continue;
      if (!latestInvoiceBySubscription.has(invoice.subscriptionId)) {
        latestInvoiceBySubscription.set(invoice.subscriptionId, invoice.id);
      }
    }

    for (const newsletter of newsletters) {
      let nextSubscriptionId = newsletter.subscriptionId || null;
      if (!nextSubscriptionId && newsletter.invoiceId) {
        const invoice = await storage.getInvoice(newsletter.invoiceId);
        if (invoice?.subscriptionId) {
          nextSubscriptionId = invoice.subscriptionId;
        }
      }
      if (!nextSubscriptionId && activeSubscription) {
        nextSubscriptionId = activeSubscription.id;
      }

      let nextInvoiceId = newsletter.invoiceId || null;
      if (!nextInvoiceId && nextSubscriptionId) {
        nextInvoiceId = latestInvoiceBySubscription.get(nextSubscriptionId) || null;
      }

      if (!nextInvoiceId && nextSubscriptionId) {
        const sub = subscriptions.find((entry) => entry.id === nextSubscriptionId);
        if (sub) {
          const created = await storage.createInvoice({
            clientId: client.id,
            subscriptionId: sub.id,
            amount: sub.amount,
            currency: sub.currency || "USD",
            status: "pending",
            paidAt: null,
            stripePaymentId: null,
          });
          nextInvoiceId = created.id;
          latestInvoiceBySubscription.set(sub.id, created.id);
          createdInvoices += 1;
        }
      }

      if (
        (nextSubscriptionId && newsletter.subscriptionId !== nextSubscriptionId) ||
        (nextInvoiceId && newsletter.invoiceId !== nextInvoiceId)
      ) {
        await storage.updateNewsletter(newsletter.id, {
          subscriptionId: nextSubscriptionId,
          invoiceId: nextInvoiceId,
        } as any);
        patchedNewsletters += 1;
      }
    }

    await storage.recalculateClientSubscriptionStatus(client.id);
  }

  console.log(
    `[repair:relations] complete (patchedInvoices=${patchedInvoices}, createdInvoices=${createdInvoices}, patchedNewsletters=${patchedNewsletters})`
  );
}

main()
  .catch((error) => {
    console.error("[repair:relations] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
