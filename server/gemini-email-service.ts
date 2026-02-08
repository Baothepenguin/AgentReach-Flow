import { GoogleGenAI } from "@google/genai";
import mjml2html from "mjml";
import type { BrandingKit } from "@shared/schema";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function buildBrandingContext(brandingKit: BrandingKit | null): string {
  if (!brandingKit) return "No branding kit provided. Use a clean, professional default style with navy (#1a2b4a) as primary color.";

  const parts: string[] = [];
  if (brandingKit.title) parts.push(`Agent Name: ${brandingKit.title}`);
  if (brandingKit.companyName) parts.push(`Company: ${brandingKit.companyName}`);
  if (brandingKit.primaryColor) parts.push(`Primary Color: ${brandingKit.primaryColor}`);
  if (brandingKit.secondaryColor) parts.push(`Secondary Color: ${brandingKit.secondaryColor}`);
  if (brandingKit.phone) parts.push(`Phone: ${brandingKit.phone}`);
  if (brandingKit.email) parts.push(`Email: ${brandingKit.email}`);
  if (brandingKit.website) parts.push(`Website: ${brandingKit.website}`);
  if (brandingKit.logo) parts.push(`Logo URL: ${brandingKit.logo}`);
  if (brandingKit.headshot) parts.push(`Headshot URL: ${brandingKit.headshot}`);
  if (brandingKit.facebook) parts.push(`Facebook: ${brandingKit.facebook}`);
  if (brandingKit.instagram) parts.push(`Instagram: ${brandingKit.instagram}`);
  if (brandingKit.linkedin) parts.push(`LinkedIn: ${brandingKit.linkedin}`);
  if (brandingKit.tone) parts.push(`Tone: ${brandingKit.tone}`);
  if (brandingKit.mustInclude && brandingKit.mustInclude.length > 0) parts.push(`Must include: ${brandingKit.mustInclude.join(", ")}`);
  if (brandingKit.avoidTopics && brandingKit.avoidTopics.length > 0) parts.push(`Avoid topics: ${brandingKit.avoidTopics.join(", ")}`);
  if (brandingKit.localLandmarks && brandingKit.localLandmarks.length > 0) parts.push(`Local landmarks: ${brandingKit.localLandmarks.join(", ")}`);

  return parts.length > 0 ? parts.join("\n") : "No branding details available.";
}

function cleanMjmlResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```mjml")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```xml")) cleaned = cleaned.slice(6);
  else if (cleaned.startsWith("```html")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const mjmlStart = cleaned.indexOf("<mjml");
  if (mjmlStart > 0) cleaned = cleaned.slice(mjmlStart);

  return cleaned;
}

function renderToHtml(mjmlString: string): string {
  if (!mjmlString || !mjmlString.includes("<mjml")) {
    throw new Error("Invalid MJML: markup must contain <mjml> root element");
  }
  try {
    const result = mjml2html(mjmlString, {
      validationLevel: "soft",
      minify: false,
    });
    return result.html;
  } catch (e) {
    throw new Error(`MJML rendering failed: ${e instanceof Error ? e.message : "Unknown error"}`);
  }
}

const GENERATE_SYSTEM_PROMPT = `You are an expert email designer specializing in real estate newsletters using MJML markup language.

Your task is to generate complete, valid MJML markup for professional real estate email newsletters.

RULES:
1. Generate ONLY valid MJML markup. Do NOT use raw HTML - use MJML components (mj-section, mj-column, mj-text, mj-image, mj-button, etc.)
2. Start with <mjml> and end with </mjml>. Include <mj-head> with <mj-attributes> for default styling and <mj-body>.
3. Create professional, modern real estate newsletter layouts.
4. Use realistic placeholder content - actual-sounding addresses, realistic market statistics, believable property descriptions. Never use lorem ipsum.
5. Structure the newsletter with these sections in order:
   - Header with agent branding/logo
   - Hero section with a compelling headline
   - Market update section with key statistics
   - Featured listings grid (use mj-column for side-by-side layouts)
   - Call-to-action section
   - Footer with compliance text, unsubscribe link placeholder, and brokerage info
6. For images, use placeholder URLs like https://placehold.co/600x400, https://placehold.co/300x200, etc.
7. Return ONLY the MJML markup. No markdown code fences, no explanations, no extra text.
8. Use the provided branding colors, agent name, and contact info when available.
9. Ensure the email is mobile-responsive by using MJML's built-in responsive features.
10. Use clean typography with appropriate font sizes (headings 22-28px, body 14-16px).`;

export async function generateEmailFromPrompt(
  prompt: string,
  brandingKit: BrandingKit | null
): Promise<{ mjml: string; html: string; subject?: string }> {
  const brandingContext = buildBrandingContext(brandingKit);

  const userPrompt = `${prompt}

BRANDING INFORMATION:
${brandingContext}

Generate the complete MJML markup now. Return ONLY the MJML code starting with <mjml> and ending with </mjml>.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    config: {
      systemInstruction: GENERATE_SYSTEM_PROMPT,
      maxOutputTokens: 16384,
      temperature: 0.7,
    },
  });

  const rawText = response.text ?? "";
  if (!rawText) {
    throw new Error("AI did not return any content. Please try again with a different prompt.");
  }

  const mjml = cleanMjmlResponse(rawText);
  const html = renderToHtml(mjml);

  let subject: string | undefined;
  const titleMatch = mjml.match(/<mj-text[^>]*>([^<]*(?:newsletter|update|report|digest|market)[^<]*)<\/mj-text>/i);
  if (titleMatch) {
    subject = titleMatch[1].replace(/<[^>]*>/g, "").trim();
  }

  return { mjml, html, subject };
}

export async function editEmailWithAI(
  command: string,
  currentMjml: string,
  brandingKit: BrandingKit | null
): Promise<{ mjml: string; html: string }> {
  const brandingContext = buildBrandingContext(brandingKit);

  const systemPrompt = `You are an expert MJML email editor. You modify existing MJML email markup based on user commands.

RULES:
1. Return ONLY the complete modified MJML markup.
2. Preserve the overall structure unless specifically asked to change it.
3. Make targeted edits based on the user's request.
4. Keep all MJML attributes and styling intact unless specifically asked to change them.
5. Return valid MJML that starts with <mjml> and ends with </mjml>.
6. No markdown code fences, no explanations, no extra text.
7. Use the branding information when making style changes.`;

  const userPrompt = `CURRENT MJML:
${currentMjml}

BRANDING INFORMATION:
${brandingContext}

EDIT COMMAND: ${command}

Return the complete modified MJML markup.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 16384,
      temperature: 0.4,
    },
  });

  const rawText = response.text ?? "";
  const mjml = cleanMjmlResponse(rawText);
  const html = renderToHtml(mjml);

  return { mjml, html };
}

export async function suggestSubjectLines(
  html: string,
  count: number = 5
): Promise<string[]> {
  const systemPrompt = `You are an email marketing expert specializing in real estate newsletters. Analyze the newsletter content and suggest compelling email subject lines.

RULES:
1. Return ONLY the subject lines, one per line.
2. No numbering, no bullets, no extra formatting.
3. Keep subject lines under 60 characters.
4. Make them compelling, specific, and relevant to the content.
5. Mix different approaches: curiosity, urgency, value proposition, personalization.
6. Avoid spam trigger words.`;

  const contentPreview = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{ text: `Analyze this newsletter content and suggest ${count} email subject lines:\n\n${contentPreview}` }],
      },
    ],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 1024,
      temperature: 0.8,
    },
  });

  const rawText = response.text ?? "";
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 100)
    .slice(0, count);

  return lines;
}
