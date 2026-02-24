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

type SalesIntent =
  | "greeting"
  | "pricing_inquiry"
  | "availability"
  | "objection_handling"
  | "booking"
  | "feedback_collection"
  | "complaint_handling";

interface BusinessBasicsProfile {
  whatDoYouSell: string;
  priceRange: string;
  targetAudience: string;
  usp: string;
  objections: string;
  defaultCountry: string;
  defaultCurrency: string;
  greetingScript: string;
  pricingInquiryScript: string;
  availabilityScript: string;
  objectionHandlingScript: string;
  bookingScript: string;
  feedbackCollectionScript: string;
  complaintHandlingScript: string;
}

interface LocaleContext {
  countryCode: string;
  countryName: string;
  locale: string;
  currencyCode: string;
  currencySymbol: string;
}

const INTENT_ORDER: SalesIntent[] = [
  "complaint_handling",
  "feedback_collection",
  "booking",
  "pricing_inquiry",
  "availability",
  "objection_handling",
  "greeting"
];

const INTENT_LABELS: Record<SalesIntent, string> = {
  greeting: "Greeting",
  pricing_inquiry: "Pricing Inquiry",
  availability: "Availability",
  objection_handling: "Objection Handling",
  booking: "Booking",
  feedback_collection: "Feedback Collection",
  complaint_handling: "Complaint Handling"
};

const INTENT_KEYWORDS: Record<SalesIntent, string[]> = {
  greeting: ["hi", "hello", "hey", "good morning", "good evening", "namaste", "hlo"],
  pricing_inquiry: [
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
  ],
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

const DEFAULT_PLAYBOOKS: Record<SalesIntent, string> = {
  greeting:
    "Greet warmly, introduce the business in one line, and ask one qualifying question to continue the conversation.",
  pricing_inquiry:
    "Give price context clearly in the right currency, share what is included, and ask one budget or requirement qualifier.",
  availability:
    "Answer availability with clear next slot or timeline. If unavailable, offer the nearest alternative and confirm preference.",
  objection_handling:
    "Acknowledge concern first, reframe with USP/proof, keep tone calm, and ask one question to move the lead forward.",
  booking:
    "Confirm interest, propose immediate next booking step, ask for date/time preference, and keep instructions simple.",
  feedback_collection:
    "Thank the user for time, collect concise feedback, and ask one specific follow-up about their experience.",
  complaint_handling:
    "Apologize sincerely, acknowledge issue details, offer corrective action or escalation path, and confirm resolution intent."
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
    priceRange: readString(rawBasics.priceRange, "N/A"),
    targetAudience: readString(rawBasics.targetAudience, "N/A"),
    usp: readString(rawBasics.usp, "N/A"),
    objections: readString(rawBasics.objections, "N/A"),
    defaultCountry: readString(rawBasics.defaultCountry, "IN"),
    defaultCurrency: readString(rawBasics.defaultCurrency, "INR"),
    greetingScript: readString(rawBasics.greetingScript),
    pricingInquiryScript: readString(rawBasics.pricingInquiryScript),
    availabilityScript: readString(rawBasics.availabilityScript),
    objectionHandlingScript: readString(rawBasics.objectionHandlingScript),
    bookingScript: readString(rawBasics.bookingScript),
    feedbackCollectionScript: readString(rawBasics.feedbackCollectionScript),
    complaintHandlingScript: readString(rawBasics.complaintHandlingScript)
  };
}

function detectSalesIntent(message: string): SalesIntent {
  const normalized = message.toLowerCase();

  for (const intent of INTENT_ORDER) {
    if (INTENT_KEYWORDS[intent].some((keyword) => normalized.includes(keyword))) {
      return intent;
    }
  }

  return "greeting";
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

function playbookForIntent(intent: SalesIntent, basics: BusinessBasicsProfile): string {
  const customPlaybookMap: Record<SalesIntent, string> = {
    greeting: basics.greetingScript,
    pricing_inquiry: basics.pricingInquiryScript,
    availability: basics.availabilityScript,
    objection_handling: basics.objectionHandlingScript,
    booking: basics.bookingScript,
    feedback_collection: basics.feedbackCollectionScript,
    complaint_handling: basics.complaintHandlingScript
  };

  return customPlaybookMap[intent] || DEFAULT_PLAYBOOKS[intent];
}

function buildFallbackReply(intent: SalesIntent, basics: BusinessBasicsProfile, localeContext: LocaleContext): string {
  if (intent === "pricing_inquiry") {
    return `Thanks for your message. Our pricing is in ${localeContext.currencyCode} (${localeContext.currencySymbol}) and typical range is ${basics.priceRange}. Share your requirement and I will suggest the best option.`;
  }

  if (intent === "booking") {
    return "Thanks for the interest. Please share your preferred date and time, and we will help you confirm the booking.";
  }

  if (intent === "complaint_handling") {
    return "I am sorry for the inconvenience. Please share your issue details, and we will resolve it on priority.";
  }

  return `Thanks for reaching out about ${basics.whatDoYouSell}. I can guide you with details in ${localeContext.currencyCode} and help with the next step.`;
}

export async function buildSalesReply(input: ReplyInput): Promise<string> {
  const basics = toBasicsProfile(input.user.business_basics as Record<string, unknown>);
  const detectedIntent = detectSalesIntent(input.incomingMessage);
  const localeContext = resolveLocaleContext(input.conversationPhone, basics);

  if (!openAIService.isConfigured()) {
    return buildFallbackReply(detectedIntent, basics, localeContext);
  }

  let knowledge: Awaited<ReturnType<typeof retrieveKnowledge>> = [];
  try {
    knowledge = await retrieveKnowledge({
      userId: input.user.id,
      query: input.incomingMessage,
      limit: 5
    });
  } catch {
    // Continue without RAG context when embeddings are unavailable for this key/project.
    knowledge = [];
  }

  const personality = resolvePersonalityPrompt(input.user.personality, input.user.custom_personality_prompt);
  const selectedPlaybook = playbookForIntent(detectedIntent, basics);

  const allPlaybooksBlock = INTENT_ORDER.map((intent) => {
    return `- ${INTENT_LABELS[intent]}: ${playbookForIntent(intent, basics)}`;
  }).join("\n");

  const systemPrompt = [
    "You are WAgen, a WhatsApp AI assistant.",
    "Rules:",
    "- Reply only with plain conversational text.",
    "- Keep messages short (under 110 words unless user asks details).",
    "- Ask at most one follow-up question.",
    "- Follow the selected intent playbook closely while sounding natural.",
    "- If message is about pricing, include currency symbol and code at least once.",
    "- Never mix multiple currencies in the same reply.",
    "- If uncertain, acknowledge and offer handoff.",
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
    `Business context:\n- What we sell: ${basics.whatDoYouSell}\n- Price range: ${basics.priceRange}\n- Target audience: ${basics.targetAudience}\n- USP: ${basics.usp}\n- Typical objections: ${basics.objections}`,
    `Locale context:\n- User country: ${localeContext.countryName} (${localeContext.countryCode})\n- Currency: ${localeContext.currencyCode} (${localeContext.currencySymbol})\n- Locale format: ${localeContext.locale}`,
    `Detected intent: ${INTENT_LABELS[detectedIntent]}`,
    `Primary intent playbook:\n${selectedPlaybook}`,
    `All configured playbooks:\n${allPlaybooksBlock}`,
    `Conversation with ${input.conversationPhone}:\n${historyBlock || "No prior messages."}`,
    `Retrieved knowledge:\n${knowledgeBlock}`,
    `Incoming message: ${input.incomingMessage}`,
    "Craft the best helpful response now."
  ].join("\n\n");

  try {
    return await openAIService.generateReply(systemPrompt, userPrompt);
  } catch {
    return buildFallbackReply(detectedIntent, basics, localeContext);
  }
}
