import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getUncachableGmailClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function getBodyFromParts(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }

    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data);
    }

    for (const part of payload.parts) {
      if (part.parts) {
        const nested = getBodyFromParts(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

export async function searchEmailsByContact(email: string, maxResults: number = 20) {
  const gmail = await getUncachableGmailClient();
  const query = `from:${email} OR to:${email}`;

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messageIds = listResponse.data.messages || [];
  if (messageIds.length === 0) return [];

  const emails = await Promise.all(
    messageIds.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      const from = getHeader(headers, 'From');
      const to = getHeader(headers, 'To');
      const isInbound = from.toLowerCase().includes(email.toLowerCase());

      return {
        id: detail.data.id,
        threadId: detail.data.threadId,
        subject: getHeader(headers, 'Subject'),
        from,
        to,
        date: getHeader(headers, 'Date'),
        snippet: detail.data.snippet || '',
        isInbound,
      };
    })
  );

  return emails;
}

export async function getEmailThread(threadId: string) {
  const gmail = await getUncachableGmailClient();

  const threadResponse = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = (threadResponse.data.messages || []).map((msg) => {
    const headers = msg.payload?.headers || [];
    const body = getBodyFromParts(msg.payload || {});

    return {
      id: msg.id,
      subject: getHeader(headers, 'Subject'),
      from: getHeader(headers, 'From'),
      to: getHeader(headers, 'To'),
      date: getHeader(headers, 'Date'),
      snippet: msg.snippet || '',
      body,
    };
  });

  return messages;
}

export async function isGmailConnected(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
