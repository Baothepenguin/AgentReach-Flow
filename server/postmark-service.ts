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

export interface SenderSignatureResult {
  success: boolean;
  signatureId?: number;
  error?: string;
  alreadyExists?: boolean;
}

export async function createSenderSignature(email: string, name: string): Promise<SenderSignatureResult> {
  try {
    const accountClient = getAccountClient();
    if (!accountClient) {
      return {
        success: false,
        error: "Postmark account API token is not configured (POSTMARK_ACCOUNT_API_TOKEN).",
      };
    }

    const result = await accountClient.createSenderSignature({
      FromEmail: email,
      Name: name,
      ReplyToEmail: email,
    });

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
