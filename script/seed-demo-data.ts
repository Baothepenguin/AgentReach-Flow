import { addDays, format, subDays } from "date-fns";
import {
  createNewsletterDocumentFromHtml,
  getNewsletterDocumentHtml,
  type Client,
  type NewsletterStatus,
} from "@shared/schema";
import { pool } from "../server/db";
import { storage } from "../server/storage";

const SOURCE_NEWSLETTER_TITLE = "QA Client 1771456475 - Feb 25";

const FALLBACK_HTML = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 12px;font-size:24px;color:#1a5f4a;">Monthly Real Estate Update</h1>
                <p style="margin:0 0 12px;color:#1f2937;">This layout was seeded as fallback HTML.</p>
                <p style="margin:0;color:#4b5563;">Replace this content in the editor as needed.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();

type DemoContact = {
  email: string;
  firstName: string;
  lastName: string;
  tag: "all" | "referral partners" | "past clients";
  isActive: boolean;
};

type DemoNewsletter = {
  title: string;
  expectedSendDate: string;
  status: NewsletterStatus;
  subject: string;
  previewText: string;
};

type DemoClient = {
  name: string;
  primaryEmail: string;
  phone: string;
  city: string;
  region: string;
  newsletterFrequency: "weekly" | "biweekly" | "monthly";
  subscriptionAmount: string;
  branding: {
    companyName: string;
    website: string;
    instagram: string;
    facebook: string;
    primaryColor: string;
    secondaryColor: string;
    tone: string;
  };
  contacts: DemoContact[];
  newsletters: DemoNewsletter[];
};

function buildDemoClients(today: Date): DemoClient[] {
  const fmt = (offsetDays: number) => format(addDays(today, offsetDays), "yyyy-MM-dd");
  const paidDate = format(subDays(today, 7), "yyyy-MM-dd");

  return [
    {
      name: "Sophia Martinez",
      primaryEmail: "sophia.martinez@alderrealty.com",
      phone: "(512) 555-0197",
      city: "Austin",
      region: "TX",
      newsletterFrequency: "monthly",
      subscriptionAmount: "149.00",
      branding: {
        companyName: "Alder Realty Group",
        website: "https://alderrealty.com",
        instagram: "https://instagram.com/alderrealty",
        facebook: "https://facebook.com/alderrealty",
        primaryColor: "#1A5F4A",
        secondaryColor: "#0F172A",
        tone: "Warm, confident, neighborhood-focused",
      },
      contacts: [
        { email: "mila.thompson@gmail.com", firstName: "Mila", lastName: "Thompson", tag: "past clients", isActive: true },
        { email: "david.romero@gmail.com", firstName: "David", lastName: "Romero", tag: "all", isActive: true },
        { email: "oakline.lending@partner.com", firstName: "Oakline", lastName: "Lending", tag: "referral partners", isActive: true },
        { email: "jane.holden@gmail.com", firstName: "Jane", lastName: "Holden", tag: "past clients", isActive: false },
      ],
      newsletters: [
        {
          title: "Alder Realty Monthly Market Letter",
          expectedSendDate: fmt(4),
          status: "draft",
          subject: "Austin homes this month: what buyers should watch",
          previewText: "Listings, local events, and this week’s market pulse for Austin.",
        },
        {
          title: "Alder Realty February Seller Update",
          expectedSendDate: paidDate,
          status: "sent",
          subject: "Your Austin seller playbook for this month",
          previewText: "Fresh pricing moves, neighborhood demand, and quick seller wins.",
        },
      ],
    },
    {
      name: "Ethan Brooks",
      primaryEmail: "ethan.brooks@harborlanehomes.com",
      phone: "(619) 555-0162",
      city: "San Diego",
      region: "CA",
      newsletterFrequency: "monthly",
      subscriptionAmount: "129.00",
      branding: {
        companyName: "Harbor Lane Homes",
        website: "https://harborlanehomes.com",
        instagram: "https://instagram.com/harborlanehomes",
        facebook: "https://facebook.com/harborlanehomes",
        primaryColor: "#0C4A6E",
        secondaryColor: "#111827",
        tone: "Modern, upbeat, coastal lifestyle",
      },
      contacts: [
        { email: "olivia.ward@gmail.com", firstName: "Olivia", lastName: "Ward", tag: "all", isActive: true },
        { email: "nathan.price@gmail.com", firstName: "Nathan", lastName: "Price", tag: "past clients", isActive: true },
        { email: "horizon.title@partner.com", firstName: "Horizon", lastName: "Title", tag: "referral partners", isActive: true },
      ],
      newsletters: [
        {
          title: "Harbor Lane Coastal Market Brief",
          expectedSendDate: fmt(8),
          status: "in_review",
          subject: "San Diego market snapshot + listings this week",
          previewText: "Current local stats, neighborhood picks, and agent recommendations.",
        },
        {
          title: "Harbor Lane Buyer Pulse",
          expectedSendDate: fmt(-12),
          status: "sent",
          subject: "Where buyer demand is moving in San Diego",
          previewText: "Open-home activity, pricing signals, and next-step strategy.",
        },
      ],
    },
    {
      name: "Chloe Bennett",
      primaryEmail: "chloe.bennett@westfieldcollective.com",
      phone: "(212) 555-0189",
      city: "New York",
      region: "NY",
      newsletterFrequency: "biweekly",
      subscriptionAmount: "189.00",
      branding: {
        companyName: "Westfield Collective",
        website: "https://westfieldcollective.com",
        instagram: "https://instagram.com/westfieldcollective",
        facebook: "https://facebook.com/westfieldcollective",
        primaryColor: "#14532D",
        secondaryColor: "#111827",
        tone: "Premium, concise, data-backed",
      },
      contacts: [
        { email: "michelle.wu@gmail.com", firstName: "Michelle", lastName: "Wu", tag: "past clients", isActive: true },
        { email: "andrew.park@gmail.com", firstName: "Andrew", lastName: "Park", tag: "all", isActive: true },
        { email: "northstar.staging@partner.com", firstName: "Northstar", lastName: "Staging", tag: "referral partners", isActive: true },
      ],
      newsletters: [
        {
          title: "Westfield NYC Property Brief",
          expectedSendDate: fmt(2),
          status: "scheduled",
          subject: "This week’s NYC housing moves and opportunities",
          previewText: "Inventory shifts, featured listings, and city highlights.",
        },
        {
          title: "Westfield Midtown Market Digest",
          expectedSendDate: fmt(-20),
          status: "sent",
          subject: "Midtown trends and new comps you should know",
          previewText: "Price movement, negotiation insights, and next actions.",
        },
      ],
    },
  ];
}

async function getSourceHtml(): Promise<string> {
  const newsletters = await storage.getAllNewsletters();
  const source =
    newsletters.find((item) => item.title === SOURCE_NEWSLETTER_TITLE) ||
    newsletters.find((item) => item.title.includes("QA Client 1771456475"));

  if (!source?.documentJson) {
    return FALLBACK_HTML;
  }

  const html = getNewsletterDocumentHtml(source.documentJson);
  return html.trim() ? html : FALLBACK_HTML;
}

async function ensureClient(spec: DemoClient): Promise<Client> {
  const clients = await storage.getClients();
  const existing = clients.find(
    (client) => client.primaryEmail.trim().toLowerCase() === spec.primaryEmail.trim().toLowerCase()
  );

  if (existing) {
    await storage.updateClient(existing.id, {
      name: spec.name,
      phone: spec.phone,
      locationCity: spec.city,
      locationRegion: spec.region,
      newsletterFrequency: spec.newsletterFrequency,
      subscriptionStatus: "active",
    });
    return (await storage.getClient(existing.id)) || existing;
  }

  return storage.createClient({
    name: spec.name,
    primaryEmail: spec.primaryEmail,
    phone: spec.phone,
    locationCity: spec.city,
    locationRegion: spec.region,
    newsletterFrequency: spec.newsletterFrequency,
    subscriptionStatus: "active",
    isVerified: true,
  });
}

async function ensureSegments(clientId: string) {
  const existing = await storage.getContactSegmentsByClient(clientId);
  const byName = new Set(existing.map((segment) => segment.name.toLowerCase()));
  const defaults = [
    { name: "All", tags: ["all"], isDefault: true },
    { name: "Referral Partners", tags: ["referral partners"], isDefault: false },
    { name: "Past Clients", tags: ["past clients"], isDefault: false },
  ];

  for (const segment of defaults) {
    if (byName.has(segment.name.toLowerCase())) continue;
    await storage.createContactSegment({
      clientId,
      name: segment.name,
      tags: segment.tags,
      isDefault: segment.isDefault,
    });
  }
}

async function ensureContacts(clientId: string, contacts: DemoContact[]) {
  for (const contact of contacts) {
    await storage.upsertContactByEmail(clientId, contact.email, {
      firstName: contact.firstName,
      lastName: contact.lastName,
      tags: [contact.tag],
      isActive: contact.isActive,
    });
  }
}

async function ensureSubscription(
  clientId: string,
  amount: string,
  frequency: "weekly" | "biweekly" | "monthly"
): Promise<string> {
  const subscriptionKey = `demo_sub_${clientId}`;
  const subscriptions = await storage.getSubscriptionsByClient(clientId);
  const existing = subscriptions.find((subscription) => subscription.stripeSubscriptionId === subscriptionKey);
  if (existing) {
    await storage.updateSubscription(existing.id, {
      amount,
      currency: "USD",
      status: "active",
      frequency,
    });
    return existing.id;
  }

  const created = await storage.createSubscription({
    clientId,
    amount,
    currency: "USD",
    status: "active",
    frequency,
    stripeSubscriptionId: subscriptionKey,
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: null,
  });
  return created.id;
}

async function ensureInvoice(clientId: string, subscriptionId: string, amount: string): Promise<string> {
  const paymentIntentId = `demo_pi_${clientId}`;
  const sessionId = `demo_cs_${clientId}`;
  const invoices = await storage.getInvoicesByClient(clientId);
  const existing = invoices.find((invoice) =>
    invoice.stripePaymentId === paymentIntentId || invoice.stripePaymentId === sessionId
  );

  if (existing) {
    await storage.updateInvoice(existing.id, {
      subscriptionId,
      amount,
      currency: "USD",
      status: "paid",
      paidAt: existing.paidAt || new Date(),
      stripePaymentId: paymentIntentId,
    });
    return existing.id;
  }

  const created = await storage.createInvoice({
    clientId,
    subscriptionId,
    amount,
    currency: "USD",
    status: "paid",
    paidAt: new Date(),
    stripePaymentId: paymentIntentId,
  });
  return created.id;
}

async function ensureNewsletter(
  clientId: string,
  subscriptionId: string,
  invoiceId: string,
  html: string,
  fromEmail: string,
  spec: DemoNewsletter
) {
  const newsletters = await storage.getNewslettersByClient(clientId);
  const existing = newsletters.find((newsletter) => newsletter.title === spec.title);
  const documentJson = createNewsletterDocumentFromHtml(html);
  const scheduledTimestamp = new Date(`${spec.expectedSendDate}T14:00:00.000Z`);

  const payload = {
    clientId,
    subscriptionId,
    invoiceId: spec.status === "sent" ? invoiceId : null,
    title: spec.title,
    expectedSendDate: spec.expectedSendDate,
    status: spec.status,
    subject: spec.subject,
    previewText: spec.previewText,
    fromEmail,
    sendMode: "fixed_time" as const,
    timezone: "America/New_York",
    scheduledAt: spec.status === "scheduled" || spec.status === "sent" ? scheduledTimestamp : null,
    sentAt: spec.status === "sent" ? scheduledTimestamp : null,
    documentJson,
  };

  if (existing) {
    await storage.updateNewsletter(existing.id, payload);
    const versions = await storage.getVersionsByNewsletter(existing.id);
    if (versions.length === 0) {
      const version = await storage.createVersion({
        newsletterId: existing.id,
        versionNumber: 1,
        snapshotJson: documentJson,
        createdById: null,
        changeSummary: "Seeded demo content",
      });
      await storage.updateNewsletter(existing.id, { currentVersionId: version.id });
    } else if (!existing.currentVersionId) {
      await storage.updateNewsletter(existing.id, { currentVersionId: versions[0].id });
    }
    return;
  }

  const created = await storage.createNewsletter(payload);
  const version = await storage.createVersion({
    newsletterId: created.id,
    versionNumber: 1,
    snapshotJson: documentJson,
    createdById: null,
    changeSummary: "Initial seeded demo content",
  });
  await storage.updateNewsletter(created.id, { currentVersionId: version.id });
}

async function seedDemoData() {
  const sourceHtml = await getSourceHtml();
  const demoClients = buildDemoClients(new Date());
  const supportsContacts = await tableExists("contacts");
  const supportsContactSegments = await tableExists("contact_segments");

  if (!supportsContacts) {
    console.warn("Skipping contact seed: contacts table does not exist in this database.");
  }
  if (!supportsContactSegments) {
    console.warn("Skipping segment seed: contact_segments table does not exist in this database.");
  }

  for (const clientSpec of demoClients) {
    const client = await ensureClient(clientSpec);
    await storage.upsertBrandingKit({
      clientId: client.id,
      companyName: clientSpec.branding.companyName,
      website: clientSpec.branding.website,
      instagram: clientSpec.branding.instagram,
      facebook: clientSpec.branding.facebook,
      primaryColor: clientSpec.branding.primaryColor,
      secondaryColor: clientSpec.branding.secondaryColor,
      tone: clientSpec.branding.tone,
      platform: "mailchimp",
      mustInclude: ["name", "license", "unsubscribe"],
      avoidTopics: ["politics", "medical advice"],
      localLandmarks: [clientSpec.city],
    });
    if (supportsContactSegments) {
      await ensureSegments(client.id);
    }
    if (supportsContacts) {
      await ensureContacts(client.id, clientSpec.contacts);
    }
    const subscriptionId = await ensureSubscription(
      client.id,
      clientSpec.subscriptionAmount,
      clientSpec.newsletterFrequency
    );
    const invoiceId = await ensureInvoice(client.id, subscriptionId, clientSpec.subscriptionAmount);
    for (const newsletter of clientSpec.newsletters) {
      await ensureNewsletter(
        client.id,
        subscriptionId,
        invoiceId,
        sourceHtml,
        clientSpec.primaryEmail,
        newsletter
      );
    }
    await storage.recalculateClientSubscriptionStatus(client.id);
    console.log(`Seeded demo client: ${client.name}`);
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await pool.query("select to_regclass($1) as relation_name", [`public.${tableName}`]);
  return !!result.rows[0]?.relation_name;
}

seedDemoData()
  .then(() => {
    console.log("Demo data seed complete.");
  })
  .catch((error) => {
    console.error("Demo data seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
