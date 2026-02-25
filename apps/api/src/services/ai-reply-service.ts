import type { User } from "../types/models.js";
import { resolvePersonalityPrompt } from "./personality.js";
import { openAIService } from "./openai-service.js";
import { retrieveKnowledge } from "./rag-service.js";

interface ReplyInput {
  user: User;
  incomingMessage: string;
  conversationPhone: string;
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>;
}

type SupportIntent =
  | "greeting"
  | "availability"
  | "objection_handling"
  | "booking"
  | "feedback_collection"
  | "complaint_handling";

interface BusinessBasicsProfile {
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
}

interface LocaleContext {
  countryCode: string;
  countryName: string;
  locale: string;
  currencyCode: string;
  currencySymbol: string;
}

const INTENT_ORDER: SupportIntent[] = [
  "complaint_handling",
  "feedback_collection",
  "booking",
  "availability",
  "objection_handling",
  "greeting"
];

const INTENT_LABELS: Record<SupportIntent, string> = {
  greeting: "Greeting",
  availability: "Availability",
  objection_handling: "Objection Handling",
  booking: "Booking",
  feedback_collection: "Feedback Collection",
  complaint_handling: "Complaint Handling"
};

const INTENT_KEYWORDS: Record<SupportIntent, string[]> = {
  greeting: ["hi", "hello", "hey", "good morning", "good evening", "namaste", "hlo"],
  availability: ["available", "availability", "in stock", "stock", "open", "timing", "today", "tomorrow"],
  objection_handling: [
    "expensive",
    "costly",
    "too much",
    "not sure",
    "maybe later",
    "busy",
    "concern",
    "doubt",
    "trust"
  ],
  booking: ["book", "booking", "schedule", "appointment", "demo", "meeting", "slot", "reserve", "call"],
  feedback_collection: ["feedback", "review", "rating", "experience", "testimonial", "suggestion"],
  complaint_handling: ["complaint", "issue", "problem", "bad", "upset", "refund", "cancel", "delay", "poor service"]
};

const PRICING_KEYWORDS = [
  "price",
  "pricing",
  "cost",
  "rate",
  "quote",
  "charges",
  "fee",
  "package",
  "how much",
  "quotation"
];

const DEFAULT_PLAYBOOKS: Record<SupportIntent, string> = {
  greeting:
    "Greet politely, introduce yourself as support, and ask one clear question to understand the issue.",
  availability:
    "Share current availability or timeline clearly. If unavailable, provide the next best option and expected time.",
  objection_handling:
    "Acknowledge concern first, respond calmly with facts from knowledge, and provide one practical next support step.",
  booking:
    "Confirm booking request, collect required details, and guide the user with one clear next step.",
  feedback_collection:
    "Thank the user and collect concise feedback. Ask one follow-up only when needed.",
  complaint_handling:
    "Apologize, acknowledge the issue clearly, offer corrective action, and provide escalation contact if unresolved."
};

const COUNTRY_NAME_BY_CODE: Record<string, string> = {
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  SG: "Singapore",
  MY: "Malaysia",
  AU: "Australia",
  CA: "Canada"
};

const COUNTRY_CURRENCY_BY_CODE: Record<string, string> = {
  IN: "INR",
  US: "USD",
  GB: "GBP",
  AE: "AED",
  SA: "SAR",
  SG: "SGD",
  MY: "MYR",
  AU: "AUD",
  CA: "CAD"
};

const COUNTRY_LOCALE_BY_CODE: Record<string, string> = {
  IN: "en-IN",
  US: "en-US",
  GB: "en-GB",
  AE: "en-AE",
  SA: "en-SA",
  SG: "en-SG",
  MY: "en-MY",
  AU: "en-AU",
  CA: "en-CA"
};

const PHONE_PREFIX_COUNTRY_CODES: Array<{ prefix: string; countryCode: string }> = [
  { prefix: "971", countryCode: "AE" },
  { prefix: "966", countryCode: "SA" },
  { prefix: "65", countryCode: "SG" },
  { prefix: "60", countryCode: "MY" },
  { prefix: "44", countryCode: "GB" },
  { prefix: "61", countryCode: "AU" },
  { prefix: "91", countryCode: "IN" },
  { prefix: "1", countryCode: "US" }
];

const COUNTRY_CODE_BY_NAME: Record<string, string> = Object.entries(COUNTRY_NAME_BY_CODE).reduce(
  (acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    return acc;
  },
  {} as Record<string, string>
);

function readString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeCountryCode(rawCountry: string): string | null {
  const normalized = rawCountry.trim();
  if (!normalized) {
    return null;
  }

  const upper = normalized.toUpperCase();
  if (COUNTRY_NAME_BY_CODE[upper]) {
    return upper;
  }

  return COUNTRY_CODE_BY_NAME[normalized.toLowerCase()] ?? null;
}

function normalizeCurrencyCode(rawCurrency: string): string | null {
  const normalized = rawCurrency.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (/^[A-Z]{3,4}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

function resolveCurrencySymbol(currencyCode: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol"
    }).formatToParts(1);

    const currencyPart = parts.find((part) => part.type === "currency");
    return currencyPart?.value || currencyCode;
  } catch {
    return currencyCode;
  }
}

function toBasicsProfile(rawBasics: Record<string, unknown>): BusinessBasicsProfile {
  return {
    whatDoYouSell: readString(rawBasics.whatDoYouSell, "N/A"),
    targetAudience: readString(rawBasics.targetAudience, "N/A"),
    usp: readString(rawBasics.usp, "N/A"),
    objections: readString(rawBasics.objections, "N/A"),
    defaultCountry: readString(rawBasics.defaultCountry, "IN"),
    defaultCurrency: readString(rawBasics.defaultCurrency, "INR"),
    greetingScript: readString(rawBasics.greetingScript),
    availabilityScript: readString(rawBasics.availabilityScript),
    objectionHandlingScript: readString(rawBasics.objectionHandlingScript),
    bookingScript: readString(rawBasics.bookingScript),
    feedbackCollectionScript: readString(rawBasics.feedbackCollectionScript),
    complaintHandlingScript: readString(rawBasics.complaintHandlingScript),
    supportAddress: readString(rawBasics.supportAddress),
    supportPhoneNumber: readString(rawBasics.supportPhoneNumber),
    supportContactName: readString(rawBasics.supportContactName),
    supportEmail: readString(rawBasics.supportEmail),
    aiDoRules: readString(rawBasics.aiDoRules),
    aiDontRules: readString(rawBasics.aiDontRules)
  };
}

function detectSupportIntent(message: string): SupportIntent {
  const normalized = message.toLowerCase();

  for (const intent of INTENT_ORDER) {
    if (INTENT_KEYWORDS[intent].some((keyword) => normalized.includes(keyword))) {
      return intent;
    }
  }

  return "greeting";
}

function isPricingQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  return PRICING_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function resolveLocaleContext(conversationPhone: string, basics: BusinessBasicsProfile): LocaleContext {
  const phoneDigits = conversationPhone.replace(/\D/g, "");
  const prefixMatch = PHONE_PREFIX_COUNTRY_CODES.find((entry) => phoneDigits.startsWith(entry.prefix));

  let countryCode = prefixMatch?.countryCode ?? normalizeCountryCode(basics.defaultCountry) ?? "IN";
  let currencyCode = prefixMatch
    ? COUNTRY_CURRENCY_BY_CODE[prefixMatch.countryCode]
    : normalizeCurrencyCode(basics.defaultCurrency) ??
      COUNTRY_CURRENCY_BY_CODE[countryCode] ??
      "INR";

  if (!COUNTRY_NAME_BY_CODE[countryCode]) {
    countryCode = "IN";
  }
  if (!currencyCode) {
    currencyCode = COUNTRY_CURRENCY_BY_CODE[countryCode] ?? "INR";
  }

  const locale = COUNTRY_LOCALE_BY_CODE[countryCode] ?? "en-IN";
  const countryName = COUNTRY_NAME_BY_CODE[countryCode] ?? basics.defaultCountry ?? "Unknown";
  const currencySymbol = resolveCurrencySymbol(currencyCode, locale);

  return {
    countryCode,
    countryName,
    locale,
    currencyCode,
    currencySymbol
  };
}

function playbookForIntent(intent: SupportIntent, basics: BusinessBasicsProfile): string {
  const customPlaybookMap: Record<SupportIntent, string> = {
    greeting: basics.greetingScript,
    availability: basics.availabilityScript,
    objection_handling: basics.objectionHandlingScript,
    booking: basics.bookingScript,
    feedback_collection: basics.feedbackCollectionScript,
    complaint_handling: basics.complaintHandlingScript
  };

  return customPlaybookMap[intent] || DEFAULT_PLAYBOOKS[intent];
}

function buildSupportContactLine(basics: BusinessBasicsProfile): string {
  const contactName = basics.supportContactName || "support team";
  const channels = [basics.supportPhoneNumber, basics.supportEmail].filter(Boolean).join(" | ");
  const address = basics.supportAddress ? ` Address: ${basics.supportAddress}.` : "";

  if (channels) {
    return `${contactName} (${channels}).${address}`;
  }

  return `${contactName}.${address}`;
}

function buildFallbackReply(
  intent: SupportIntent,
  basics: BusinessBasicsProfile,
  localeContext: LocaleContext,
  incomingMessage: string
): string {
  const supportLine = buildSupportContactLine(basics);

  if (isPricingQuery(incomingMessage)) {
    return `For pricing details, please contact ${supportLine} I can help with support questions here.`;
  }

  if (intent === "complaint_handling") {
    return `I am sorry for the inconvenience. Please share your issue details, and we will resolve it quickly. If needed, contact ${supportLine}`;
  }

  if (intent === "booking") {
    return "Thanks for reaching out. Please share your preferred date and time, and I will help you with the booking process.";
  }

  return `Thanks for contacting support for ${basics.whatDoYouSell}. I can help with updates and issue resolution. Currency format for your region is ${localeContext.currencySymbol} (${localeContext.currencyCode}).`;
}

export async function buildSalesReply(input: ReplyInput): Promise<string> {
  const basics = toBasicsProfile(input.user.business_basics as Record<string, unknown>);
  const detectedIntent = detectSupportIntent(input.incomingMessage);
  const localeContext = resolveLocaleContext(input.conversationPhone, basics);
  const supportLine = buildSupportContactLine(basics);

  if (!openAIService.isConfigured()) {
    return buildFallbackReply(detectedIntent, basics, localeContext, input.incomingMessage);
  }

  let knowledge: Awaited<ReturnType<typeof retrieveKnowledge>> = [];
  try {
    knowledge = await retrieveKnowledge({
      userId: input.user.id,
      query: input.incomingMessage,
      limit: 5
    });
  } catch {
    knowledge = [];
  }

  const personality = resolvePersonalityPrompt(input.user.personality, input.user.custom_personality_prompt);
  const selectedPlaybook = playbookForIntent(detectedIntent, basics);

  const allPlaybooksBlock = INTENT_ORDER.map((intent) => {
    return `- ${INTENT_LABELS[intent]}: ${playbookForIntent(intent, basics)}`;
  }).join("\n");

  const systemPrompt = [
    "You are WAgen, a WhatsApp customer support agent.",
    "Rules:",
    "- Primary role is customer support, not sales.",
    "- Reply only with plain conversational text.",
    "- Keep messages short (under 120 words unless user asks for details).",
    "- Ask at most one follow-up question.",
    "- Never ask budget, pricing expectation, or package preference.",
    "- If user asks pricing and exact pricing is unavailable, provide support handoff details.",
    "- When money is mentioned, format it in the user's currency.",
    "- If uncertain, acknowledge and offer escalation support.",
    "- Never claim actions you cannot perform.",
    `Personality: ${personality}`
  ].join("\n");

  const knowledgeBlock = knowledge.length
    ? knowledge
        .map((chunk, index) => `${index + 1}. ${chunk.content_chunk}`)
        .join("\n")
    : "No stored knowledge available.";

  const historyBlock = input.history
    .map((item) => `${item.direction === "inbound" ? "User" : "WAgen"}: ${item.message_text}`)
    .join("\n");

  const userPrompt = [
    `Business context:\n- Support domain: ${basics.whatDoYouSell}\n- Audience: ${basics.targetAudience}\n- Promise/USP: ${basics.usp}\n- Common issues: ${basics.objections}`,
    `Locale context:\n- User country: ${localeContext.countryName} (${localeContext.countryCode})\n- Currency: ${localeContext.currencyCode} (${localeContext.currencySymbol})\n- Locale format: ${localeContext.locale}`,
    `Detected support scenario: ${INTENT_LABELS[detectedIntent]}`,
    `Primary scenario playbook:\n${selectedPlaybook}`,
    `All configured playbooks:\n${allPlaybooksBlock}`,
    `Support handoff contact:\n${supportLine}`,
    `AI Do rules:\n${basics.aiDoRules || "No custom do rules provided."}`,
    `AI Don't rules:\n${basics.aiDontRules || "No custom don't rules provided."}`,
    `Conversation with ${input.conversationPhone}:\n${historyBlock || "No prior messages."}`,
    `Retrieved knowledge:\n${knowledgeBlock}`,
    `Incoming message: ${input.incomingMessage}`,
    "Craft the best support response now."
  ].join("\n\n");

  try {
    return await openAIService.generateReply(systemPrompt, userPrompt);
  } catch {
    return buildFallbackReply(detectedIntent, basics, localeContext, input.incomingMessage);
  }
}
