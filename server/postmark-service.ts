import * as postmark from "postmark";

let cachedAccountClient: postmark.AccountClient | null | undefined;

function getAccountClient(): postmark.AccountClient | null {
  if (cachedAccountClient !== undefined) return cachedAccountClient;

  const token = process.env.POSTMARK_ACCOUNT_API_TOKEN || "";
  if (!token) {
    cachedAccountClient = null;
    return cachedAccountClient;
  }

  // Postmark validates token format at construction time; avoid crashing app boot.
  cachedAccountClient = new postmark.AccountClient(token);
  return cachedAccountClient;
}

async function findServerByName(name: string): Promise<any | null> {
  const accountClient = getAccountClient();
  if (!accountClient) return null;
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return null;

  try {
    const list = await (accountClient as any).getServers?.();
    const servers = Array.isArray((list as any)?.Servers) ? (list as any).Servers : [];
    const matched = servers.find(
      (server: any) => String(server?.Name || "").trim().toLowerCase() === normalized
    );
    return matched || null;
  } catch (error) {
    console.error("Failed to fetch Postmark servers:", error);
    return null;
  }
}

async function findReusableFlowServer(excludedServerIds: number[] = []): Promise<any | null> {
  const accountClient = getAccountClient();
  if (!accountClient) return null;
  const excluded = new Set<number>(
    excludedServerIds
      .filter((id) => Number.isFinite(id))
      .map((id) => Number(id))
  );

  try {
    const list = await (accountClient as any).getServers?.();
    const servers = Array.isArray((list as any)?.Servers) ? (list as any).Servers : [];
    const reusable = servers.find((server: any) => {
      const id = Number(server?.ID || 0);
      if (!id || excluded.has(id)) return false;
      const serverName = String(server?.Name || "").trim();
      return /^Flow\s+/i.test(serverName);
    });
    return reusable || null;
  } catch (error) {
    console.error("Failed to find reusable Postmark server:", error);
    return null;
  }
}

export interface SenderSignatureResult {
  success: boolean;
  signatureId?: number;
  error?: string;
  alreadyExists?: boolean;
}

export interface PostmarkTenantProvisionResult {
  success: boolean;
  serverId?: number;
  serverToken?: string;
  broadcastStreamId?: string;
  webhookId?: number | null;
  webhookUrl?: string | null;
  signatureId?: number;
  senderConfirmed?: boolean;
  domain?: string;
  domainVerificationState?: "not_configured" | "pending" | "verified" | "failed";
  warning?: string;
  error?: string;
}

type EnsureTenantInput = {
  clientName: string;
  senderEmail: string;
  replyToEmail?: string;
  baseUrl?: string;
  existing?: {
    serverId?: number | null;
    serverToken?: string | null;
    broadcastStreamId?: string | null;
    webhookId?: number | null;
    signatureId?: number | null;
    reservedServerIds?: number[] | null;
  };
};

const normalizeEmail = (value: string): string => String(value || "").trim().toLowerCase();

const defaultBroadcastStreamId = () => {
  const configured = String(process.env.POSTMARK_BROADCAST_STREAM_ID || "").trim();
  return configured || "broadcast";
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const resolveBaseUrl = (explicit?: string): string => {
  const direct = String(explicit || "").trim();
  if (direct) return normalizeBaseUrl(direct);

  const appBase = String(process.env.APP_BASE_URL || "").trim();
  if (appBase) return normalizeBaseUrl(appBase);

  const vercel = String(process.env.VERCEL_URL || "").trim();
  if (vercel) return normalizeBaseUrl(`https://${vercel}`);

  const replitDomain = String(process.env.REPLIT_DOMAINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0];
  if (replitDomain) return normalizeBaseUrl(`https://${replitDomain}`);

  return "";
};

const deriveDomainFromEmail = (email: string): string => {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return "";
  return normalized.slice(at + 1);
};

const PUBLIC_MAILBOX_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.ca",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
]);

export function isLikelyPublicMailboxDomain(email: string): boolean {
  const domain = deriveDomainFromEmail(email);
  if (!domain) return false;
  return PUBLIC_MAILBOX_DOMAINS.has(domain);
}

const toDomainVerificationState = (domain: any): "not_configured" | "pending" | "verified" | "failed" => {
  if (!domain) return "not_configured";
  if (domain.SPFVerified && domain.DKIMVerified) return "verified";
  return "pending";
};

async function resolveDomainState(
  senderEmail: string
): Promise<{ domain: string; state: "not_configured" | "pending" | "verified" | "failed" }> {
  const domain = deriveDomainFromEmail(senderEmail);
  if (!domain) {
    return { domain: "", state: "not_configured" };
  }

  const accountClient = getAccountClient();
  if (!accountClient) {
    return { domain, state: "not_configured" };
  }

  try {
    const domains = await accountClient.getDomains();
    const matched = (domains as any)?.Domains?.find(
      (entry: any) => String(entry?.Name || "").toLowerCase() === domain.toLowerCase()
    );
    return { domain, state: toDomainVerificationState(matched) };
  } catch (error) {
    console.error("Failed to resolve Postmark domain verification state:", error);
    return { domain, state: "failed" };
  }
}

export async function createSenderSignature(
  email: string,
  name: string,
  options: { serverId?: number; replyToEmail?: string } = {}
): Promise<SenderSignatureResult> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) {
      return {
        success: false,
        error: "Postmark account API token is not configured (POSTMARK_ACCOUNT_API_TOKEN).",
      };
    }

    const payload: any = {
      FromEmail: email,
      Name: name,
      ReplyToEmail: options.replyToEmail || email,
    };
    if (typeof options.serverId === "number" && options.serverId > 0) {
      payload.ServerID = options.serverId;
    }

    const result = await accountClient.createSenderSignature(payload);

    return {
      success: true,
      signatureId: result.ID,
    };
  } catch (error: any) {
    if (error.code === 400 && error.message?.includes("already exists")) {
      const existingSignature = await findSignatureByEmail(email);
      return {
        success: true,
        signatureId: existingSignature?.ID,
        alreadyExists: true,
      };
    }

    if (error.code === 505) {
      const existingSignature = await findSignatureByEmail(email);
      return {
        success: true,
        signatureId: existingSignature?.ID,
        alreadyExists: true,
      };
    }

    console.error("Postmark sender signature error:", error);
    return {
      success: false,
      error: error.message || "Failed to create sender signature",
    };
  }
}

async function findSignatureByEmail(email: string): Promise<any | null> {
  try {
    const signatures = await getSenderSignatures();
    return signatures.find(s => s.EmailAddress?.toLowerCase() === email.toLowerCase()) || null;
  } catch (error) {
    console.error("Failed to find signature by email:", error);
    return null;
  }
}

export async function getSenderSignatures(): Promise<any[]> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) return [];

    const result = await accountClient.getSenderSignatures();
    return result.SenderSignatures || [];
  } catch (error) {
    console.error("Failed to get sender signatures:", error);
    return [];
  }
}

export async function resendConfirmation(signatureId: number): Promise<boolean> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) return false;

    await accountClient.resendSenderSignatureConfirmation(signatureId);
    return true;
  } catch (error) {
    console.error("Failed to resend confirmation:", error);
    return false;
  }
}

export async function deleteSenderSignature(signatureId: number): Promise<boolean> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) return false;

    await accountClient.deleteSenderSignature(signatureId);
    return true;
  } catch (error) {
    console.error("Failed to delete sender signature:", error);
    return false;
  }
}

export async function getSenderSignature(signatureId: number): Promise<any | null> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) return null;

    const result = await accountClient.getSenderSignature(signatureId);
    return result;
  } catch (error) {
    console.error("Failed to get sender signature:", error);
    return null;
  }
}

export async function ensureClientPostmarkTenant(input: EnsureTenantInput): Promise<PostmarkTenantProvisionResult> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) {
      return {
        success: false,
        error: "Postmark account API token is not configured (POSTMARK_ACCOUNT_API_TOKEN).",
      };
    }

    const requestedServerId =
      typeof input.existing?.serverId === "number" && input.existing.serverId > 0
        ? input.existing.serverId
        : null;
    let server: any = null;

    if (requestedServerId) {
      try {
        server = await accountClient.getServer(requestedServerId);
      } catch (error) {
        console.warn("Existing Postmark server lookup failed; creating a new server.", error);
      }
    }

    if (!server) {
      const requestedName = `Flow ${String(input.clientName || "Client").trim()}`.slice(0, 80);
      try {
        const created = await accountClient.createServer({
          Name: requestedName,
        } as any);
        server = created;
      } catch (error: any) {
        const message = String(error?.message || "").toLowerCase();
        if (message.includes("already exists")) {
          const existing = await findServerByName(requestedName);
          if (existing) {
            server = existing;
          } else {
            return {
              success: false,
              error: "Postmark server name already exists and could not be resolved.",
            };
          }
        } else if (message.includes("limit of 10 servers")) {
          const reusable = await findReusableFlowServer(input.existing?.reservedServerIds || []);
          if (reusable) {
            server = reusable;
          } else {
            return {
              success: false,
              error:
                "Postmark server limit reached and no reusable Flow server is available. Archive/delete old Flow servers or upgrade Postmark tier.",
            };
          }
        } else {
          throw error;
        }
      }
    }

    const serverId = Number(server?.ID || 0);
    const serverTokenCandidates: string[] = Array.isArray(server?.ApiTokens) ? server.ApiTokens : [];
    const serverToken =
      String(input.existing?.serverToken || "").trim() || String(serverTokenCandidates[0] || "").trim();
    if (!serverId || !serverToken) {
      return {
        success: false,
        error: "Unable to create/retrieve Postmark server API token for this client.",
      };
    }

    const serverClient = new postmark.ServerClient(serverToken);
    const streamId =
      String(input.existing?.broadcastStreamId || "").trim() ||
      defaultBroadcastStreamId();

    try {
      await serverClient.getMessageStream(streamId);
    } catch {
      try {
        await serverClient.createMessageStream({
          ID: streamId,
          Name: "Newsletters",
          MessageStreamType: "Broadcasts",
          Description: "Flow client newsletter broadcast stream",
          SubscriptionManagementConfiguration: {
            UnsubscribeHandlingType: "Postmark",
          },
        } as any);
      } catch (streamError) {
        const streams = await serverClient.getMessageStreams({} as any);
        const fallback = (streams as any)?.MessageStreams?.find(
          (item: any) =>
            String(item?.MessageStreamType || "").toLowerCase().includes("broadcast") ||
            String(item?.ID || "").toLowerCase() === "outbound"
        );
        if (!fallback) {
          console.error("Postmark stream provisioning failed:", streamError);
          return {
            success: false,
            error: "Failed to provision Postmark broadcast message stream.",
          };
        }
      }
    }

    const baseUrl = resolveBaseUrl(input.baseUrl);
    let webhookId: number | null = typeof input.existing?.webhookId === "number" ? input.existing.webhookId : null;
    let webhookUrl: string | null = baseUrl ? `${baseUrl}/api/webhooks/postmark/events` : null;
    if (webhookUrl) {
      const webhookHeaders = process.env.POSTMARK_WEBHOOK_SECRET
        ? [{ Name: "X-Postmark-Webhook-Secret", Value: process.env.POSTMARK_WEBHOOK_SECRET }]
        : [];
      const triggerPayload = {
        Open: { Enabled: true, PostFirstOpenOnly: false },
        Click: { Enabled: true },
        Delivery: { Enabled: true },
        Bounce: { Enabled: true, IncludeContent: false },
        SpamComplaint: { Enabled: true, IncludeContent: false },
        SubscriptionChange: { Enabled: true },
      };
      try {
        const hooks = await serverClient.getWebhooks({} as any);
        const existingHooks = Array.isArray((hooks as any)?.Webhooks) ? (hooks as any).Webhooks : [];
        const matchedById =
          webhookId != null ? existingHooks.find((hook: any) => Number(hook?.ID) === Number(webhookId)) : null;
        const matchedByUrl = existingHooks.find(
          (hook: any) =>
            String(hook?.Url || "").trim() === webhookUrl &&
            String(hook?.MessageStream || "").trim() === streamId
        );
        const webhookToReuse = matchedById || matchedByUrl || null;

        if (webhookToReuse?.ID) {
          webhookId = Number(webhookToReuse.ID);
          await serverClient.editWebhook(webhookId, {
            Url: webhookUrl,
            HttpHeaders: webhookHeaders,
            Triggers: triggerPayload,
          } as any);
        } else {
          const createdWebhook = await serverClient.createWebhook({
            Url: webhookUrl,
            MessageStream: streamId,
            HttpHeaders: webhookHeaders,
            Triggers: triggerPayload,
          } as any);
          webhookId = Number((createdWebhook as any)?.ID || 0) || null;
        }
      } catch (webhookError) {
        console.error("Postmark webhook provisioning failed:", webhookError);
      }
    }

    const signatureInput = {
      email: String(input.senderEmail || "").trim(),
      name: String(input.clientName || "").trim() || "Flow Client",
      replyToEmail: String(input.replyToEmail || "").trim() || undefined,
    };
    const normalizedSenderEmail = normalizeEmail(signatureInput.email);
    let signatureId =
      typeof input.existing?.signatureId === "number" && input.existing.signatureId > 0
        ? input.existing.signatureId
        : null;

    // Existing signature IDs can become stale if the sender email changes.
    // Reuse only when the signature email still matches the current sender email.
    if (signatureId && normalizedSenderEmail) {
      const existingSignature = await getSenderSignature(signatureId);
      const existingEmail = normalizeEmail(String(existingSignature?.EmailAddress || ""));
      if (!existingSignature || existingEmail !== normalizedSenderEmail) {
        signatureId = null;
      }
    }

    if (!signatureId && signatureInput.email) {
      const existingByEmail = await findSignatureByEmail(signatureInput.email);
      if (existingByEmail?.ID) {
        signatureId = Number(existingByEmail.ID);
      }
    }

    if (!signatureId && signatureInput.email) {
      const signatureResult = await createSenderSignature(signatureInput.email, signatureInput.name, {
        serverId,
        replyToEmail: signatureInput.replyToEmail,
      });
      if (signatureResult.success && signatureResult.signatureId) {
        signatureId = signatureResult.signatureId;
      } else if (!signatureResult.success) {
        const signatureError = String(signatureResult.error || "Failed to provision sender signature.");
        const publicDomainBlocked = /public domain emails/i.test(signatureError);
        if (!publicDomainBlocked) {
          return {
            success: false,
            error: signatureError,
            serverId,
            serverToken,
            broadcastStreamId: streamId,
            webhookId,
            webhookUrl,
          };
        }
        console.warn("Postmark sender signature skipped:", signatureError);
      }
    }

    let senderConfirmed = false;
    if (signatureId) {
      const signature = await getSenderSignature(signatureId);
      senderConfirmed = !!signature?.Confirmed;
    }

    const domainState = await resolveDomainState(signatureInput.email);

    return {
      success: true,
      serverId,
      serverToken,
      broadcastStreamId: streamId,
      webhookId,
      webhookUrl,
      signatureId: signatureId || undefined,
      senderConfirmed,
      domain: domainState.domain || undefined,
      domainVerificationState: domainState.state,
      ...(signatureId ? {} : { warning: "Sender signature is not configured yet for this email domain." }),
    };
  } catch (error: any) {
    console.error("Postmark tenant provisioning error:", error);
    return {
      success: false,
      error: error?.message || "Failed to provision Postmark tenant.",
    };
  }
}
