import type { PersonalityOption } from "../types/models.js";
import { openAIService } from "./openai-service.js";

export interface AutofillDraft {
  businessBasics: {
    companyName: string;
    whatDoYouSell: string;
    targetAudience: string;
    usp: string;
    objections: string;
    defaultCountry: string;
    defaultCurrency: string;
    greetingScript: string;
    availabilityScript: string;
    objectionHandlingScript: string;
    bookingScript: string;
    feedbackCollectionScript: string;
    complaintHandlingScript: string;
    supportAddress: string;
    supportPhoneNumber: string;
    supportContactName: string;
    supportEmail: string;
    aiDoRules: string;
    aiDontRules: string;
  };
  personality: PersonalityOption;
  customPrompt: string;
}

const DEFAULT_DRAFT: AutofillDraft = {
  businessBasics: {
    companyName: "",
    whatDoYouSell: "",
    targetAudience: "",
    usp: "",
    objections: "price, trust, timing",
    defaultCountry: "IN",
    defaultCurrency: "INR",
    greetingScript: "Greet politely, introduce yourself as support, and ask how you can help.",
    availabilityScript:
      "Share current availability and timeline clearly. If unavailable, provide the next best option.",
    objectionHandlingScript:
      "Acknowledge concern first, respond with clear facts, and suggest one practical next step.",
    bookingScript:
      "Confirm booking request, collect required details, and provide the next action to complete booking.",
    feedbackCollectionScript:
      "Thank the customer and ask for concise feedback with one optional follow-up question.",
    complaintHandlingScript:
      "Apologize clearly, acknowledge the issue, provide corrective action, and offer escalation contact.",
    supportAddress: "",
    supportPhoneNumber: "",
    supportContactName: "",
    supportEmail: "",
    aiDoRules:
      "Be polite and empathetic.\nAnswer clearly using business context.\nEscalate when confidence is low.",
    aiDontRules:
      "Do not ask budget qualification questions.\nDo not promise actions you cannot perform.\nDo not share sensitive data."
  },
  personality: "professional",
  customPrompt: ""
};

function readString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizePersonality(value: unknown): PersonalityOption {
  const allowed: PersonalityOption[] = [
    "friendly_warm",
    "professional",
    "hard_closer",
    "premium_consultant",
    "custom"
  ];
  if (typeof value === "string" && allowed.includes(value as PersonalityOption)) {
    return value as PersonalityOption;
  }
  return "professional";
}

function mergeDraft(raw: Record<string, unknown>): AutofillDraft {
  const basics = (raw.businessBasics ?? {}) as Record<string, unknown>;
  return {
    businessBasics: {
      companyName: readString(basics.companyName, DEFAULT_DRAFT.businessBasics.companyName),
      whatDoYouSell: readString(basics.whatDoYouSell, DEFAULT_DRAFT.businessBasics.whatDoYouSell),
      targetAudience: readString(basics.targetAudience, DEFAULT_DRAFT.businessBasics.targetAudience),
      usp: readString(basics.usp, DEFAULT_DRAFT.businessBasics.usp),
      objections: readString(basics.objections, DEFAULT_DRAFT.businessBasics.objections),
      defaultCountry: readString(basics.defaultCountry, DEFAULT_DRAFT.businessBasics.defaultCountry).toUpperCase(),
      defaultCurrency: readString(
        basics.defaultCurrency,
        DEFAULT_DRAFT.businessBasics.defaultCurrency
      ).toUpperCase(),
      greetingScript: readString(basics.greetingScript, DEFAULT_DRAFT.businessBasics.greetingScript),
      availabilityScript: readString(basics.availabilityScript, DEFAULT_DRAFT.businessBasics.availabilityScript),
      objectionHandlingScript: readString(
        basics.objectionHandlingScript,
        DEFAULT_DRAFT.businessBasics.objectionHandlingScript
      ),
      bookingScript: readString(basics.bookingScript, DEFAULT_DRAFT.businessBasics.bookingScript),
      feedbackCollectionScript: readString(
        basics.feedbackCollectionScript,
        DEFAULT_DRAFT.businessBasics.feedbackCollectionScript
      ),
      complaintHandlingScript: readString(
        basics.complaintHandlingScript,
        DEFAULT_DRAFT.businessBasics.complaintHandlingScript
      ),
      supportAddress: readString(basics.supportAddress, DEFAULT_DRAFT.businessBasics.supportAddress),
      supportPhoneNumber: readString(basics.supportPhoneNumber, DEFAULT_DRAFT.businessBasics.supportPhoneNumber),
      supportContactName: readString(basics.supportContactName, DEFAULT_DRAFT.businessBasics.supportContactName),
      supportEmail: readString(basics.supportEmail, DEFAULT_DRAFT.businessBasics.supportEmail),
      aiDoRules: readString(basics.aiDoRules, DEFAULT_DRAFT.businessBasics.aiDoRules),
      aiDontRules: readString(basics.aiDontRules, DEFAULT_DRAFT.businessBasics.aiDontRules)
    },
    personality: normalizePersonality(raw.personality),
    customPrompt: readString(raw.customPrompt)
  };
}

function fallbackDraft(description: string): AutofillDraft {
  const snippet = description.trim().slice(0, 240);
  const inferredAudience = /b2b|business/i.test(description) ? "business clients" : "end customers";
  return {
    ...DEFAULT_DRAFT,
    businessBasics: {
      ...DEFAULT_DRAFT.businessBasics,
      companyName: "Support Team",
      whatDoYouSell: snippet || "Customer support services",
      targetAudience: inferredAudience,
      usp: snippet || "Fast and reliable support",
      supportContactName: "Support Team"
    }
  };
}

export async function generateOnboardingDraft(description: string): Promise<AutofillDraft> {
  if (!openAIService.isConfigured()) {
    return fallbackDraft(description);
  }

  const systemPrompt = [
    "You extract onboarding data for a WhatsApp support AI agent.",
    "Return only valid JSON.",
    "Do not include markdown or explanations.",
    "Use concise practical values.",
    "If uncertain, keep empty strings."
  ].join("\n");

  const userPrompt = [
    "From this business + agent description, produce JSON with keys:",
    "{",
    '  "businessBasics": {',
    '    "companyName": "", "whatDoYouSell": "", "targetAudience": "", "usp": "", "objections": "",',
    '    "defaultCountry": "IN", "defaultCurrency": "INR",',
    '    "greetingScript": "", "availabilityScript": "", "objectionHandlingScript": "",',
    '    "bookingScript": "", "feedbackCollectionScript": "", "complaintHandlingScript": "",',
    '    "supportAddress": "", "supportPhoneNumber": "", "supportContactName": "", "supportEmail": "",',
    '    "aiDoRules": "", "aiDontRules": ""',
    "  },",
    '  "personality": "friendly_warm|professional|hard_closer|premium_consultant|custom",',
    '  "customPrompt": ""',
    "}",
    "",
    `Description:\n${description}`
  ].join("\n");

  try {
    const raw = await openAIService.generateJson(systemPrompt, userPrompt);
    return mergeDraft(raw);
  } catch {
    return fallbackDraft(description);
  }
}
