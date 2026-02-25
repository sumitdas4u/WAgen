import type { User } from "../types/models.js";
import { env } from "../config/env.js";
import { resolvePersonalityPrompt } from "./personality.js";
import { openAIService } from "./openai-service.js";
import { retrieveKnowledge } from "./rag-service.js";

interface ReplyInput {
  user: User;
  incomingMessage: string;
  conversationPhone: string;
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>;
}

export interface ReplyOutput {
  text: string;
  model: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  retrievalChunks: number;
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

const LIGHTWEIGHT_NO_RAG_PATTERNS = [
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "thanks",
  "thank you",
  "cool",
  "great",
  "done",
  "yes",
  "no"
];

const KNOWLEDGE_REQUIRED_KEYWORDS = [
  "price",
  "pricing",
  "policy",
  "warranty",
  "refund",
  "return",
  "delivery",
  "shipping",
  "timeline",
  "feature",
  "specification",
  "how",
  "why",
  "what",
  "which"
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

function trimForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 1)}...`;
}

function shouldRetrieveKnowledge(incomingMessage: string): boolean {
  if (!env.RAG_KNOWLEDGE_ROUTER) {
    return true;
  }

  const normalized = incomingMessage.toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (LIGHTWEIGHT_NO_RAG_PATTERNS.includes(normalized)) {
    return false;
  }

  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (normalized.length < env.RAG_MIN_QUERY_LENGTH && wordCount <= 2 && !normalized.endsWith("?")) {
    return false;
  }

  if (normalized.endsWith("?")) {
    return true;
  }

  if (KNOWLEDGE_REQUIRED_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  return wordCount >= 3;
}

function extractQueryTerms(query: string): string[] {
  const STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "have",
    "has",
    "from",
    "you",
    "your",
    "what",
    "when",
    "where",
    "which",
    "how",
    "why",
    "can",
    "are",
    "was",
    "were",
    "will",
    "shall",
    "about",
    "please",
    "want",
    "need"
  ]);

  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !STOPWORDS.has(term))
    )
  );
}

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildQueryTermVariants(queryTerms: string[]): string[] {
  const variants = new Set<string>();
  for (const term of queryTerms) {
    const normalized = normalizeTerm(term);
    if (!normalized) {
      continue;
    }
    variants.add(normalized);
    if (normalized.length >= 5) {
      variants.add(normalized.slice(0, Math.max(4, normalized.length - 1)));
    }
  }
  return Array.from(variants);
}

function scoreChunkForQuery(chunk: string, queryTerms: string[]): number {
  if (!chunk) {
    return 0;
  }

  const normalizedChunk = normalizeTerm(chunk);
  const termVariants = buildQueryTermVariants(queryTerms);
  let score = 0;

  for (const variant of termVariants) {
    if (!variant) {
      continue;
    }
    if (normalizedChunk.includes(variant)) {
      score += 3;
    } else if (variant.length >= 5 && normalizedChunk.includes(variant.slice(0, 4))) {
      score += 1;
    }
  }

  if (/\d/.test(chunk)) {
    score += 1;
  }

  return score;
}

function compactChunkForQuery(chunk: string, queryTerms: string[], maxChars: number): string {
  if (!chunk) {
    return "";
  }

  const lowerChunk = chunk.toLowerCase();
  const termVariants = buildQueryTermVariants(queryTerms);
  const snippets: string[] = [];

  for (const term of termVariants) {
    let fromIndex = 0;
    while (fromIndex < lowerChunk.length) {
      const hit = lowerChunk.indexOf(term, fromIndex);
      if (hit < 0) {
        break;
      }

      // Keep broader local context around the matched term so table/header mappings survive.
      const rawStart = Math.max(0, hit - 260);
      const rawEnd = Math.min(chunk.length, hit + term.length + 320);
      const snippet = chunk.slice(rawStart, rawEnd).trim();
      if (snippet.length >= 12) {
        snippets.push(snippet);
      }

      fromIndex = hit + term.length;
    }
  }

  if (snippets.length > 0) {
    const dedupedSnippets = Array.from(new Set(snippets));
    const focused = dedupedSnippets.join(" | ");
    return trimForPrompt(focused, maxChars);
  }

  const sentences = chunk
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return trimForPrompt(chunk, maxChars);
  }

  const scored = sentences
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (lower.includes(term)) {
          score += 2;
        }
      }
      if (/\d/.test(sentence)) {
        score += 1;
      }
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let used = 0;

  for (const item of scored) {
    if (used >= maxChars) {
      break;
    }
    if (item.score <= 0 && selected.length > 0) {
      continue;
    }

    const next = item.sentence;
    if (used + next.length + 1 > maxChars) {
      continue;
    }
    selected.push(next);
    used += next.length + 1;
    if (selected.length >= 5) {
      break;
    }
  }

  if (selected.length === 0) {
    return trimForPrompt(chunk, maxChars);
  }

  return selected.join(" ");
}

function buildKnowledgeBlock(chunks: Awaited<ReturnType<typeof retrieveKnowledge>>, query: string): string {
  if (chunks.length === 0) {
    return "No stored knowledge available.";
  }

  const queryTerms = extractQueryTerms(query);
  const rankedChunks = [...chunks].sort(
    (a, b) => scoreChunkForQuery(b.content_chunk, queryTerms) - scoreChunkForQuery(a.content_chunk, queryTerms)
  );

  const maxPromptChars = Math.max(1400, Math.min(env.RAG_MAX_PROMPT_CHARS, 3200));
  const perChunkChars = Math.min(1000, Math.max(260, Math.floor(maxPromptChars / Math.max(1, rankedChunks.length))));
  let usedChars = 0;
  const lines: string[] = [];

  for (let index = 0; index < rankedChunks.length; index += 1) {
    const chunk = compactChunkForQuery(rankedChunks[index].content_chunk, queryTerms, perChunkChars);
    const entry = `${index + 1}. ${chunk}`;
    if (usedChars + entry.length > maxPromptChars) {
      break;
    }

    lines.push(entry);
    usedChars += entry.length;
  }

  return lines.length > 0 ? lines.join("\n") : "No stored knowledge available.";
}

function buildStructuredKnowledgeHints(
  chunks: Awaited<ReturnType<typeof retrieveKnowledge>>,
  query: string
): string {
  if (chunks.length === 0) {
    return "No structured hints.";
  }

  const queryTerms = extractQueryTerms(query);
  if (queryTerms.length === 0) {
    return "No structured hints.";
  }

  const hintLines: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const text = chunk.content_chunk;
    if (!text) {
      continue;
    }

    const rowRegex = /([A-Za-z][A-Za-z0-9 '&().-]{2,})\s+(\d{2,5}(?:\s*\/\s*\d{2,5}){1,5})/g;
    const variantsRegex = /\b([A-Z]{2,10}(?:\s*\/\s*[A-Z]{2,10}){1,5})\b/;
    const normalized = text.toLowerCase();

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(text)) !== null) {
      const item = rowMatch[1]?.trim() ?? "";
      const prices = rowMatch[2]?.replace(/\s+/g, "") ?? "";
      if (!item || !prices) {
        continue;
      }

      const normalizedItem = item.toLowerCase();
      const isRelevant = queryTerms.some((term) => normalizedItem.includes(term) || normalized.includes(term));
      if (!isRelevant) {
        continue;
      }

      const beforeRow = text.slice(Math.max(0, rowMatch.index - 220), rowMatch.index);
      const variantMatch = beforeRow.match(variantsRegex);
      const variantLabels = variantMatch?.[1]?.replace(/\s+/g, " ") ?? "not specified";
      const hint = `Item "${item}" has prices ${prices}; nearby variant labels: ${variantLabels}.`;

      if (!seen.has(hint)) {
        seen.add(hint);
        hintLines.push(hint);
      }

      if (hintLines.length >= 6) {
        return hintLines.join("\n");
      }
    }
  }

  return hintLines.length > 0 ? hintLines.join("\n") : "No structured hints.";
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

export async function buildSalesReply(input: ReplyInput): Promise<ReplyOutput> {
  const basics = toBasicsProfile(input.user.business_basics as Record<string, unknown>);
  const detectedIntent = detectSupportIntent(input.incomingMessage);
  const localeContext = resolveLocaleContext(input.conversationPhone, basics);
  const supportLine = buildSupportContactLine(basics);

  if (!openAIService.isConfigured()) {
    return {
      text: buildFallbackReply(detectedIntent, basics, localeContext, input.incomingMessage),
      model: null,
      usage: null,
      retrievalChunks: 0
    };
  }

  let knowledge: Awaited<ReturnType<typeof retrieveKnowledge>> = [];
  if (shouldRetrieveKnowledge(input.incomingMessage)) {
    try {
      knowledge = await retrieveKnowledge({
        userId: input.user.id,
        query: input.incomingMessage,
        limit: Math.max(6, Math.min(10, env.RAG_RETRIEVAL_LIMIT)),
        minSimilarity: 0
      });
    } catch {
      knowledge = [];
    }
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
    "- If retrieved knowledge is present, answer strictly from it and do not invent facts.",
    "- When user asks for item price/amount and a numeric value exists in retrieved knowledge near that item name, return that value.",
    "- If the answer is missing in retrieved knowledge, clearly say that and ask one clarifying question.",
    "- Prefer concise answers using only the minimum relevant details from retrieved knowledge.",
    `Personality: ${personality}`
  ].join("\n");

  const knowledgeBlock = buildKnowledgeBlock(knowledge, input.incomingMessage);
  const structuredHints = buildStructuredKnowledgeHints(knowledge, input.incomingMessage);

  const historyBlock = input.history
    .slice(-Math.max(2, Math.min(env.PROMPT_HISTORY_LIMIT, 4)))
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
    `Structured hints from retrieved knowledge:\n${structuredHints}`,
    `Incoming message: ${input.incomingMessage}`,
    "Craft the best support response now."
  ].join("\n\n");

  try {
    const response = await openAIService.generateReply(systemPrompt, userPrompt);
    return {
      text: response.content,
      model: response.model,
      usage: response.usage ?? null,
      retrievalChunks: knowledge.length
    };
  } catch {
    return {
      text: buildFallbackReply(detectedIntent, basics, localeContext, input.incomingMessage),
      model: null,
      usage: null,
      retrievalChunks: knowledge.length
    };
  }
}
