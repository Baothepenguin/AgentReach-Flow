import OpenAI from "openai";
import type { NewsletterDocument, AIIntentResponse, AIGeneratedContent, NewsletterModule, BrandingKit, AIDraftSource, AIOperation } from "@shared/schema";
import { randomUUID } from "crypto";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function processAICommand(
  command: string,
  selectedModuleId: string | null,
  document: NewsletterDocument,
  brandingKit: BrandingKit | null
): Promise<AIIntentResponse> {
  const moduleContext = selectedModuleId
    ? document.modules.find((m) => m.id === selectedModuleId)
    : null;

  const systemPrompt = `You are an AI assistant that helps producers edit real estate newsletter content. 
Your role is to interpret commands and return structured operations to modify the newsletter.

RULES:
1. If the user's command is ambiguous about which module to edit, and no module is selected, you MUST ask for clarification.
2. Never modify locked modules.
3. Return structured JSON operations only.
4. For global commands (like "change all button colors"), you can use BULK_UPDATE.
5. For specific module edits, use UPDATE_MODULE_PROPS.

Client branding and preferences:
${brandingKit ? JSON.stringify(brandingKit, null, 2) : "No client preferences set"}

Current newsletter document summary:
- Template: ${document.templateId}
- Theme accent: ${document.theme.accent}
- Modules: ${document.modules.map((m) => `${m.id} (${m.type})`).join(", ")}

${moduleContext ? `Selected module: ${JSON.stringify(moduleContext, null, 2)}` : "No module selected"}

Respond ONLY with valid JSON matching one of these types:
1. { "type": "REQUEST_CLARIFICATION", "question": "...", "options": ["option1", "option2"] }
2. { "type": "APPLY_PATCH", "operations": [{ "type": "UPDATE_MODULE_PROPS", "moduleId": "...", "patch": {...} }] }
3. { "type": "FLAG_FOR_REVIEW", "severity": "warning", "reason": "...", "suggestedNextStep": "..." }`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        type: "FLAG_FOR_REVIEW",
        severity: "warning",
        reason: "AI did not return a valid response",
      };
    }

    const parsed = JSON.parse(content) as AIIntentResponse;

    if (
      parsed.type === "APPLY_PATCH" &&
      !selectedModuleId &&
      parsed.operations?.some((op) => op.type === "UPDATE_MODULE_PROPS")
    ) {
      const isGlobalCommand =
        command.toLowerCase().includes("all ") ||
        command.toLowerCase().includes("every ") ||
        parsed.operations?.every((op) => op.type === "BULK_UPDATE" || op.type === "SET_THEME");

      if (!isGlobalCommand) {
        return {
          type: "REQUEST_CLARIFICATION",
          question: "Which module would you like me to modify?",
          options: document.modules
            .filter((m) => !m.locked)
            .slice(0, 5)
            .map((m) => m.id),
        };
      }
    }

    return parsed;
  } catch (error) {
    console.error("AI command error:", error);
    return {
      type: "FLAG_FOR_REVIEW",
      severity: "warning",
      reason: error instanceof Error ? error.message : "AI processing failed",
    };
  }
}

export async function generateNewsletterContent(
  brandingKit: BrandingKit | null,
  targetMonth: Date,
  region: string
): Promise<{ content: AIGeneratedContent; sources: AIDraftSource[] }> {
  const monthName = targetMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const systemPrompt = `You are a real estate newsletter content writer. Generate engaging, professional content for a ${monthName} newsletter.

Client branding and preferences:
${brandingKit ? JSON.stringify(brandingKit, null, 2) : "No specific preferences"}

Region: ${region || "General"}

Generate the following sections with realistic, helpful content:
1. welcome - A warm, personalized welcome message (2-3 sentences)
2. events - 3-4 local community events for the month (with realistic dates, locations, sources)
3. marketUpdate - Current market insights with 2-3 metrics
4. homeTip - A seasonal home maintenance tip
5. marketNews - 2-3 relevant real estate news items (with sources)
6. subjectLines - 3 email subject line options with preview text

For events and news, include realistic source attributions (local newspapers, city websites, etc).
All dates should be within ${monthName}.

Respond with valid JSON only.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate newsletter content for ${monthName}` },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content returned from AI");
    }

    const parsed = JSON.parse(content) as AIGeneratedContent;

    const sources: AIDraftSource[] = [];

    if (parsed.events) {
      parsed.events.forEach((event, i) => {
        if (event.url) {
          sources.push({
            id: randomUUID(),
            type: "event",
            url: event.url,
            sourceName: event.sourceName || "Local Source",
            sourceDate: event.sourceDate,
            referencedBy: ["events-1"],
          });
        }
      });
    }

    if (parsed.marketNews) {
      parsed.marketNews.forEach((news, i) => {
        sources.push({
          id: randomUUID(),
          type: "news",
          url: news.url,
          sourceName: news.sourceName,
          sourceDate: news.sourceDate,
          referencedBy: ["news-1"],
        });
      });
    }

    return { content: parsed, sources };
  } catch (error) {
    console.error("Content generation error:", error);
    throw error;
  }
}

export function applyOperationsToDocument(
  document: NewsletterDocument,
  operations: AIOperation[]
): NewsletterDocument {
  let newDoc = { ...document, modules: [...document.modules] };

  for (const op of operations || []) {
    switch (op.type) {
      case "UPDATE_MODULE_PROPS": {
        const idx = newDoc.modules.findIndex((m) => m.id === op.moduleId);
        if (idx !== -1 && !newDoc.modules[idx].locked) {
          newDoc.modules[idx] = {
            ...newDoc.modules[idx],
            props: { ...newDoc.modules[idx].props, ...op.patch },
          } as NewsletterModule;
        }
        break;
      }
      case "BULK_UPDATE": {
        newDoc.modules = newDoc.modules.map((m) => {
          if (m.locked) return m;
          const matchesType = !op.where.type || m.type === op.where.type;
          const matchesProps =
            !op.where.propMatch ||
            Object.entries(op.where.propMatch).every(
              ([k, v]) => (m.props as Record<string, unknown>)[k] === v
            );
          if (matchesType && matchesProps) {
            return { ...m, props: { ...m.props, ...op.patch } } as NewsletterModule;
          }
          return m;
        });
        break;
      }
      case "SET_THEME": {
        newDoc.theme = { ...newDoc.theme, ...op.patch };
        break;
      }
      case "REPLACE_LIST_ITEMS": {
        const idx = newDoc.modules.findIndex((m) => m.id === op.moduleId);
        if (idx !== -1 && !newDoc.modules[idx].locked) {
          newDoc.modules[idx] = {
            ...newDoc.modules[idx],
            props: {
              ...newDoc.modules[idx].props,
              [op.listField]: op.items,
            },
          } as NewsletterModule;
        }
        break;
      }
    }
  }

  return newDoc;
}
