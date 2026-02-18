import OpenAI from "openai";
import type { BrandingKit } from "@shared/schema";

export interface AIHtmlEditResponse {
  type: "success" | "error";
  html?: string;
  message: string;
}

let cachedClient: OpenAI | null | undefined;

function getOpenAIClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;

  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    cachedClient = null;
    return cachedClient;
  }

  const baseURL =
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;

  cachedClient = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  return cachedClient;
}

export async function processHtmlCommand(
  command: string,
  html: string,
  brandingKit: BrandingKit | null
): Promise<AIHtmlEditResponse> {
  const openai = getOpenAIClient();
  if (!openai) {
    return {
      type: "error",
      message:
        "OpenAI is not configured. Set AI_INTEGRATIONS_OPENAI_API_KEY (or OPENAI_API_KEY) to enable AI HTML editing.",
    };
  }

  const systemPrompt = `You are an AI assistant that edits HTML email newsletters. 
Your role is to modify the provided HTML based on the user's command.

RULES:
1. Only return the modified HTML, no explanations.
2. Preserve the overall structure and styling of the email.
3. Make targeted edits based on the user's request.
4. Keep all inline styles intact unless specifically asked to change them.
5. Return valid HTML that works in email clients.

Client branding:
${brandingKit ? `Primary color: ${brandingKit.primaryColor}, Tone: ${brandingKit.tone}` : "No preferences"}

Current HTML:
${html.slice(0, 8000)}${html.length > 8000 ? "... (truncated)" : ""}

Return ONLY the complete modified HTML. No markdown, no explanations, just the raw HTML.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command },
      ],
      max_completion_tokens: 16384,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        type: "error",
        message: "AI did not return a response",
      };
    }

    let cleanedHtml = content.trim();
    if (cleanedHtml.startsWith("```html")) {
      cleanedHtml = cleanedHtml.slice(7);
    }
    if (cleanedHtml.startsWith("```")) {
      cleanedHtml = cleanedHtml.slice(3);
    }
    if (cleanedHtml.endsWith("```")) {
      cleanedHtml = cleanedHtml.slice(0, -3);
    }

    return {
      type: "success",
      html: cleanedHtml.trim(),
      message: "HTML updated successfully",
    };
  } catch (error) {
    console.error("AI HTML edit error:", error);
    return {
      type: "error",
      message: error instanceof Error ? error.message : "AI processing failed",
    };
  }
}
