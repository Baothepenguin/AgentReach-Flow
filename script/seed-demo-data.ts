import { addDays, format, subDays } from "date-fns";
import {
  createNewsletterDocumentFromHtml,
  getNewsletterDocumentHtml,
  type Client,
  type NewsletterStatus,
} from "@shared/schema";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { ensureClientPostmarkTenant } from "../server/postmark-service";

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
  return [
    {
      name: "Bao Ghua",
      primaryEmail: "baoghua17@sansu.ca",
      phone: "(403) 555-0101",
      city: "Calgary",
      region: "AB",
      newsletterFrequency: "monthly",
      subscriptionAmount: "149.00",
      branding: {
        companyName: "Sansu Realty Calgary",
        website: "https://sansu.ca",
        instagram: "https://instagram.com/sansu.ca",
        facebook: "https://facebook.com/sansu.ca",
        primaryColor: "#1A5F4A",
        secondaryColor: "#0F172A",
        tone: "Confident, local, market-driven",
      },
      contacts: [
        { email: "baoghua17@gmail.com", firstName: "Bao", lastName: "Ghua", tag: "all", isActive: true },
        { email: "leo@sansu.ca", firstName: "Leo", lastName: "Sansu", tag: "past clients", isActive: true },
        { email: "bao@sansu.ca", firstName: "Bao", lastName: "Sansu", tag: "referral partners", isActive: true },
      ],
      newsletters: [
        {
          title: "Bao Ghua Newsletter",
          expectedSendDate: fmt(4),
          status: "draft",
          subject: "Calgary market highlights for this month",
          previewText: "Listings, neighborhood spots, and this week’s local market pulse.",
        },
      ],
    },
    {
      name: "Leo Sansu",
      primaryEmail: "leo@sansu.ca",
      phone: "(604) 555-0202",
      city: "Vancouver",
      region: "BC",
      newsletterFrequency: "monthly",
      subscriptionAmount: "129.00",
      branding: {
        companyName: "Sansu Homes Vancouver",
        website: "https://sansu.ca",
        instagram: "https://instagram.com/sansu.ca",
        facebook: "https://facebook.com/sansu.ca",
        primaryColor: "#0C4A6E",
        secondaryColor: "#111827",
        tone: "Modern, concise, practical",
      },
      contacts: [
        { email: "leo@sansu.ca", firstName: "Leo", lastName: "Sansu", tag: "all", isActive: true },
        { email: "baoghua17@gmail.com", firstName: "Bao", lastName: "Ghua", tag: "past clients", isActive: true },
        { email: "bao@sansu.ca", firstName: "Bao", lastName: "Sansu", tag: "referral partners", isActive: true },
      ],
      newsletters: [
        {
          title: "Leo Sansu Newsletter",
          expectedSendDate: fmt(7),
          status: "in_review",
          subject: "Vancouver listings and opportunities this week",
          previewText: "Current local stats, featured listings, and next steps for buyers.",
        },
      ],
    },
    {
      name: "Bao Sansu",
      primaryEmail: "bao@sansu.ca",
      phone: "(587) 555-0303",
      city: "Toronto",
      region: "ON",
      newsletterFrequency: "biweekly",
      subscriptionAmount: "189.00",
      branding: {
        companyName: "Sansu Collective Toronto",
        website: "https://sansu.ca",
        instagram: "https://instagram.com/sansu.ca",
        facebook: "https://facebook.com/sansu.ca",
        primaryColor: "#14532D",
        secondaryColor: "#111827",
        tone: "Premium, concise, data-backed",
      },
      contacts: [
        { email: "bao@sansu.ca", firstName: "Bao", lastName: "Sansu", tag: "all", isActive: true },
        { email: "baoghua17@gmail.com", firstName: "Bao", lastName: "Ghua", tag: "past clients", isActive: true },
        { email: "leo@sansu.ca", firstName: "Leo", lastName: "Sansu", tag: "referral partners", isActive: true },
      ],
      newsletters: [
        {
          title: "Bao Sansu Newsletter",
          expectedSendDate: fmt(2),
          status: "approved",
          subject: "Toronto market update and featured listings",
          previewText: "Inventory shifts, featured homes, and city highlights.",
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
    invoiceId,
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

async function ensurePostmarkProvision(client: Client) {
  if (!process.env.POSTMARK_ACCOUNT_API_TOKEN) {
    return;
  }
  if (!(await tableExists("client_postmark_tenants"))) {
    return;
  }

  const existing = await pool.query<{
    server_id: number | null;
    server_token: string | null;
    broadcast_stream_id: string | null;
    webhook_id: number | null;
    sender_signature_id: number | null;
  }>(
    `select server_id, server_token, broadcast_stream_id, webhook_id, sender_signature_id
     from client_postmark_tenants
     where client_id = $1
     limit 1`,
    [client.id]
  );
  const tenant = existing.rows[0];

  const provisioned = await ensureClientPostmarkTenant({
    clientName: client.name,
    senderEmail: client.primaryEmail,
    replyToEmail: client.secondaryEmail || client.primaryEmail,
    existing: {
      serverId: tenant?.server_id || client.postmarkServerId || null,
      serverToken: tenant?.server_token || null,
      broadcastStreamId: tenant?.broadcast_stream_id || client.postmarkMessageStreamId || null,
      webhookId: tenant?.webhook_id || null,
      signatureId: tenant?.sender_signature_id || client.postmarkSignatureId || null,
    },
  });

  if (!provisioned.success || !provisioned.serverId || !provisioned.serverToken || !provisioned.broadcastStreamId) {
    console.warn(`[seed] postmark provisioning skipped for ${client.name}: ${provisioned.error || "unknown error"}`);
    return;
  }

  await pool.query(
    `insert into client_postmark_tenants (
      client_id, server_id, server_token, broadcast_stream_id, webhook_id, webhook_url,
      sender_signature_id, sender_email, sender_confirmed, domain, domain_verification_state,
      quality_state, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      'healthy', now()
    )
    on conflict (client_id) do update set
      server_id = excluded.server_id,
      server_token = excluded.server_token,
      broadcast_stream_id = excluded.broadcast_stream_id,
      webhook_id = excluded.webhook_id,
      webhook_url = excluded.webhook_url,
      sender_signature_id = excluded.sender_signature_id,
      sender_email = excluded.sender_email,
      sender_confirmed = excluded.sender_confirmed,
      domain = excluded.domain,
      domain_verification_state = excluded.domain_verification_state,
      quality_state = excluded.quality_state,
      updated_at = now()`,
    [
      client.id,
      provisioned.serverId,
      provisioned.serverToken,
      provisioned.broadcastStreamId,
      provisioned.webhookId ?? null,
      provisioned.webhookUrl ?? null,
      provisioned.signatureId ?? null,
      client.primaryEmail,
      !!provisioned.senderConfirmed,
      provisioned.domain || null,
      provisioned.domainVerificationState || "not_configured",
    ]
  );

  await storage.updateClient(client.id, {
    postmarkServerId: provisioned.serverId,
    postmarkMessageStreamId: provisioned.broadcastStreamId,
    postmarkDomain: provisioned.domain || null,
    postmarkDomainVerificationState: provisioned.domainVerificationState || "not_configured",
    postmarkSenderVerificationState: provisioned.senderConfirmed ? "verified" : "pending",
    postmarkSignatureId: provisioned.signatureId ?? null,
    isVerified: !!provisioned.senderConfirmed,
  } as any);
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
    await ensurePostmarkProvision(client);
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
