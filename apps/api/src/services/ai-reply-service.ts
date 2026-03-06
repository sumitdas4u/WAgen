import type { User } from "../types/models.js";
import { env } from "../config/env.js";
import { resolvePersonalityPrompt } from "./personality.js";
import { openAIService } from "./openai-service.js";
import { retrieveKnowledge, type KnowledgeChunk } from "./rag-service.js";

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
type QueryComplexity = "simple" | "medium" | "complex";

interface RetrievalQueryProfile {
  asksMenuOrCatalog: boolean;
  asksDocument: boolean;
  asksLocation: boolean;
  asksContact: boolean;
  asksBroadList: boolean;
  isShortFollowup: boolean;
}

interface BusinessBasicsProfile {
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
  supportEmail: string;
  aiDoRules: string;
  aiDontRules: string;
  escalationWhenToEscalate: string;
  escalationContactPerson: string;
  escalationPhoneNumber: string;
  escalationEmail: string;
  agentObjectiveType: string;
  agentTaskDescription: string;
  websiteUrl: string;
  manualFaq: string;
}

interface LocaleContext {
  countryCode: string;
  countryName: string;
  locale: string;
  currencyCode: string;
  currencySymbol: string;
}

interface RankedKnowledgeChunk extends KnowledgeChunk {
  rankScore: number;
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
  availability: [
    "available",
    "availability",
    "in stock",
    "stock",
    "open",
    "timing",
    "today",
    "tomorrow",
    "alcohol",
    "beer",
    "wine",
    "liquor",
    "drinks",
    "cocktail",
    "mocktail"
  ],
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

const MENU_QUERY_KEYWORDS = [
  "menu",
  "catalog",
  "rate card",
  "dish",
  "dishes",
  "food items",
  "items list",
  "price list"
];
const DOCUMENT_QUERY_KEYWORDS = ["pdf", "document", "file", "brochure", "download"];
const LOCATION_QUERY_KEYWORDS = ["address", "location", "where are you", "map", "direction"];
const CONTACT_QUERY_KEYWORDS = ["contact", "phone", "email", "manager", "human", "support"];
const BROAD_LIST_KEYWORDS = ["full", "complete", "entire", "all", "whole"];
const FOLLOWUP_TERMS = new Set(["it", "that", "this", "same", "those", "these", "details", "more", "again"]);


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
    companyName: readString(rawBasics.companyName, "your company"),
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
    supportEmail: readString(rawBasics.supportEmail),
    aiDoRules: readString(rawBasics.aiDoRules),
    aiDontRules: readString(rawBasics.aiDontRules),
    escalationWhenToEscalate: readString(
      rawBasics.escalationWhenToEscalate,
      "Escalate when knowledge is missing, conversation is unclear, or the user asks for a human."
    ),
    escalationContactPerson: readString(rawBasics.escalationContactPerson),
    escalationPhoneNumber: readString(rawBasics.escalationPhoneNumber),
    escalationEmail: readString(rawBasics.escalationEmail),
    agentObjectiveType: readString(rawBasics.agentObjectiveType, "hybrid"),
    agentTaskDescription: readString(rawBasics.agentTaskDescription),
    websiteUrl: readString(rawBasics.websiteUrl),
    manualFaq: readString(rawBasics.manualFaq)
  };
}

function detectSupportIntent(
  message: string,
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>,
  retrievalProfile: RetrievalQueryProfile
): SupportIntent {
  const normalized = normalizePromptText(message);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasGreetingKeyword = INTENT_KEYWORDS.greeting.some((keyword) => normalized.includes(keyword));

  for (const intent of INTENT_ORDER) {
    if (INTENT_KEYWORDS[intent].some((keyword) => normalized.includes(keyword))) {
      if (intent === "greeting" && tokenCount > 6) {
        break;
      }
      return intent;
    }
  }

  if (
    retrievalProfile.asksMenuOrCatalog ||
    retrievalProfile.asksDocument ||
    retrievalProfile.asksLocation ||
    retrievalProfile.asksContact ||
    retrievalProfile.asksBroadList
  ) {
    return "availability";
  }

  const lastBot = [...history].reverse().find((row) => row.direction === "outbound");
  if (lastBot) {
    const lastBotNormalized = normalizePromptText(lastBot.message_text);
    for (const intent of INTENT_ORDER) {
      if (intent === "greeting") {
        continue;
      }
      if (INTENT_KEYWORDS[intent].some((keyword) => lastBotNormalized.includes(keyword))) {
        return intent;
      }
    }
    return "availability";
  }

  return hasGreetingKeyword ? "greeting" : "availability";
}

function isPricingQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  return PRICING_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function estimateQueryComplexity(message: string): QueryComplexity {
  const normalized = message.toLowerCase();
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const questionCount = (normalized.match(/\?/g) ?? []).length;

  if (
    questionCount >= 2 ||
    tokenCount > 32 ||
    normalized.includes("what if") ||
    normalized.includes("compare") ||
    normalized.includes("difference")
  ) {
    return "complex";
  }

  if (questionCount <= 1 && tokenCount <= 14) {
    return "simple";
  }

  return "medium";
}

function includesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectRetrievalProfile(message: string): RetrievalQueryProfile {
  const normalized = normalizePromptText(message);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const asksMenuOrCatalog = includesAnyKeyword(normalized, MENU_QUERY_KEYWORDS);
  const asksDocument = includesAnyKeyword(normalized, DOCUMENT_QUERY_KEYWORDS);
  const asksLocation = includesAnyKeyword(normalized, LOCATION_QUERY_KEYWORDS);
  const asksContact = includesAnyKeyword(normalized, CONTACT_QUERY_KEYWORDS);
  const asksBroadList = includesAnyKeyword(normalized, BROAD_LIST_KEYWORDS);
  const isShortFollowup =
    tokenCount <= 4 ||
    normalized
      .split(/\s+/)
      .filter(Boolean)
      .some((token) => FOLLOWUP_TERMS.has(token));

  return {
    asksMenuOrCatalog,
    asksDocument,
    asksLocation,
    asksContact,
    asksBroadList,
    isShortFollowup
  };
}

function resolveKnowledgeRetrievalLimit(
  complexity: QueryComplexity,
  profile: RetrievalQueryProfile
): number {
  const configured = Math.max(10, env.RAG_RETRIEVAL_LIMIT);
  let limit = Math.max(14, configured * 2);

  if (complexity === "complex") {
    limit += 4;
  }

  if (profile.asksMenuOrCatalog || profile.asksDocument || profile.asksBroadList) {
    limit = Math.max(limit, configured * 4, 24);
  }

  if (profile.asksLocation || profile.asksContact) {
    limit = Math.max(limit, configured * 3, 18);
  }

  return Math.min(limit, 36);
}

function resolveHistoryWindow(complexity: QueryComplexity, topSimilarity: number): number {
  const configured = Math.max(6, env.PROMPT_HISTORY_LIMIT * 2);
  const maxAllowed = Math.min(configured, 24);
  const minimumWindow = Math.min(6, maxAllowed);

  let target = complexity === "simple" ? 8 : complexity === "medium" ? 12 : 16;
  if (topSimilarity >= 0.96) {
    target -= 2;
  } else if (topSimilarity >= 0.9) {
    target -= 1;
  }

  return Math.max(minimumWindow, Math.min(maxAllowed, target));
}

function resolveKnowledgePromptBudget(
  complexity: QueryComplexity,
  profile: RetrievalQueryProfile
): number {
  const configuredBudget = Math.max(1400, Math.min(env.RAG_MAX_PROMPT_CHARS, 5200));
  if (profile.asksMenuOrCatalog || profile.asksDocument || profile.asksBroadList) {
    return configuredBudget;
  }
  if (complexity === "simple") {
    return Math.min(1800, configuredBudget);
  }
  if (complexity === "medium") {
    return Math.min(3200, configuredBudget);
  }

  return configuredBudget;
}

function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function removeCurrentInboundFromHistory(
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>,
  incomingMessage: string
): Array<{ direction: "inbound" | "outbound"; message_text: string }> {
  if (history.length === 0) {
    return history;
  }

  const last = history[history.length - 1];
  if (
    last.direction === "inbound" &&
    normalizePromptText(last.message_text) === normalizePromptText(incomingMessage)
  ) {
    return history.slice(0, -1);
  }

  return history;
}

function buildKnowledgeQuery(
  incomingMessage: string,
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>,
  profile: RetrievalQueryProfile
): string {
  const query = incomingMessage.trim();
  const queryParts = [query];

  if (profile.asksMenuOrCatalog) {
    queryParts.push("menu dishes items catalog rates prices");
  }
  if (profile.asksDocument) {
    queryParts.push("pdf document file brochure download link url");
  }
  if (profile.asksLocation) {
    queryParts.push("address location map directions reach");
  }
  if (profile.asksContact) {
    queryParts.push("contact phone email support manager");
  }

  const contextCandidates = profile.isShortFollowup
    ? history.slice(-4)
    : history.filter((item) => item.direction === "inbound").slice(-1);
  const contextLines = contextCandidates
    .map((item) => {
      const message = item.message_text.trim();
      if (!message) {
        return "";
      }
      return `${item.direction === "inbound" ? "User" : "Bot"}: ${trimForPrompt(message, 220)}`;
    })
    .filter((line) => line.length > 0);

  if (contextLines.length === 0) {
    return Array.from(new Set(queryParts)).join("\n");
  }

  return `${Array.from(new Set(queryParts)).join("\n")}\n\nRecent conversation context:\n${contextLines.join("\n")}`;
}

function mergeUniqueKnowledgeChunks(first: KnowledgeChunk[], second: KnowledgeChunk[], limit: number): KnowledgeChunk[] {
  const seen = new Set<string>();
  const merged: KnowledgeChunk[] = [];

  for (const chunk of [...first, ...second]) {
    if (!chunk.id || seen.has(chunk.id)) {
      continue;
    }
    seen.add(chunk.id);
    merged.push(chunk);
    if (merged.length >= limit) {
      break;
    }
  }

  return merged;
}

function recencyBoost(createdAt: string | undefined): number {
  if (!createdAt) {
    return 0;
  }
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (ageDays <= 1) {
    return 0.8;
  }
  if (ageDays <= 3) {
    return 0.65;
  }
  if (ageDays <= 14) {
    return 0.45;
  }
  if (ageDays <= 45) {
    return 0.2;
  }
  return 0;
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
  const contactPerson = basics.escalationContactPerson || "our support team";
  const phone = basics.escalationPhoneNumber;
  const email = basics.escalationEmail || basics.supportEmail;
  const channels: string[] = [];
  if (phone) {
    channels.push(`phone ${phone}`);
  }
  if (email) {
    channels.push(`email ${email}`);
  }
  return channels.length > 0
    ? `${contactPerson} via ${channels.join(" or ")}.`
    : `${contactPerson}.`;
}

function buildEscalationPolicyLine(basics: BusinessBasicsProfile): string {
  return (
    basics.escalationWhenToEscalate ||
    "Escalate when knowledge is missing, conversation is unclear, or the user asks for human help."
  );
}

function buildNoKnowledgeReply(basics: BusinessBasicsProfile): string {
  const fallback = basics.complaintHandlingScript || "I do not have this information right now.";
  const supportLine = buildSupportContactLine(basics);
  const escalationPolicy = buildEscalationPolicyLine(basics);
  return `${fallback} I could not find a reliable match in my knowledge base. Please connect with ${supportLine} We escalate when: ${escalationPolicy}`;
}

function trimForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 1)}...`;
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

async function retrieveRankedKnowledge(input: {
  userId: string;
  incomingMessage: string;
  retrievalQuery: string;
  limit: number;
  profile: RetrievalQueryProfile;
}): Promise<RankedKnowledgeChunk[]> {
  const safeRetrieve = async (query: string, minSimilarity: number, limit = input.limit): Promise<KnowledgeChunk[]> => {
    try {
      return await retrieveKnowledge({
        userId: input.userId,
        query,
        limit,
        minSimilarity
      });
    } catch (error) {
      console.warn(
        `[ReplyFunnel] retrieval error user=${input.userId} minSimilarity=${minSimilarity} limit=${limit}: ${(error as Error).message}`
      );
      return [];
    }
  };

  const strictIncoming = await safeRetrieve(input.incomingMessage, env.RAG_MIN_SIMILARITY);
  const strictContext = await safeRetrieve(input.retrievalQuery, env.RAG_MIN_SIMILARITY);
  const broadIncoming = await safeRetrieve(input.incomingMessage, 0);

  const broadContext =
    strictIncoming.length + strictContext.length >= Math.min(6, input.limit)
      ? strictContext
      : await safeRetrieve(input.retrievalQuery, 0);

  const sourceBoosterQueryParts: string[] = [];
  if (input.profile.asksMenuOrCatalog) {
    sourceBoosterQueryParts.push("menu catalog dishes items prices");
  }
  if (input.profile.asksDocument) {
    sourceBoosterQueryParts.push("pdf document download link url");
  }
  if (input.profile.asksLocation) {
    sourceBoosterQueryParts.push("address location map directions");
  }
  if (input.profile.asksContact) {
    sourceBoosterQueryParts.push("contact phone email support manager");
  }

  const boosted =
    sourceBoosterQueryParts.length > 0
      ? await safeRetrieve(sourceBoosterQueryParts.join(" "), 0, Math.max(8, Math.floor(input.limit / 2)))
      : [];

  const combined = mergeUniqueKnowledgeChunks(
    mergeUniqueKnowledgeChunks(strictIncoming, strictContext, input.limit * 4),
    mergeUniqueKnowledgeChunks(
      mergeUniqueKnowledgeChunks(broadIncoming, broadContext, input.limit * 4),
      boosted,
      input.limit * 4
    ),
    input.limit * 5
  );

  const primaryTerms = extractQueryTerms(input.incomingMessage);
  const contextTerms = extractQueryTerms(`${input.incomingMessage}\n${input.retrievalQuery}`);
  return combined
    .filter((chunk) => chunk.content_chunk && chunk.content_chunk.trim().length >= 20)
    .map((chunk) => {
      const lexicalPrimary = scoreChunkForQuery(chunk.content_chunk, primaryTerms);
      const lexicalContext = scoreChunkForQuery(chunk.content_chunk, contextTerms);
      const lexical = lexicalPrimary * 2 + lexicalContext;
      const similarity = Number.isFinite(chunk.similarity) ? Number(chunk.similarity) : 0;
      return { ...chunk, rankScore: similarity * 4 + lexical + recencyBoost(chunk.created_at) };
    })
    .sort((a, b) => {
      if (b.rankScore !== a.rankScore) {
        return b.rankScore - a.rankScore;
      }
      return Number(b.similarity) - Number(a.similarity);
    })
    .slice(0, input.limit);
}

function sourceKeyForChunk(chunk: KnowledgeChunk): string {
  const sourceName = chunk.source_name?.trim() || "(unknown)";
  return `${chunk.source_type}:${sourceName}`;
}

function diversifyKnowledgeCoverage(chunks: RankedKnowledgeChunk[], limit: number): RankedKnowledgeChunk[] {
  if (chunks.length <= 2) {
    return chunks.slice(0, limit);
  }

  const grouped = new Map<string, RankedKnowledgeChunk[]>();
  for (const chunk of chunks) {
    const key = sourceKeyForChunk(chunk);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(chunk);
  }

  for (const sourceChunks of grouped.values()) {
    sourceChunks.sort((a, b) => b.rankScore - a.rankScore);
  }

  const prioritizedSources = [...grouped.entries()]
    .sort((a, b) => (b[1][0]?.rankScore ?? 0) - (a[1][0]?.rankScore ?? 0))
    .map((entry) => entry[0]);

  const selected: RankedKnowledgeChunk[] = [];
  const seen = new Set<string>();

  // Pass 1: at least one chunk per source.
  for (const source of prioritizedSources) {
    const chunk = grouped.get(source)?.[0];
    if (!chunk || seen.has(chunk.id)) {
      continue;
    }
    seen.add(chunk.id);
    selected.push(chunk);
    if (selected.length >= limit) {
      return selected;
    }
  }

  // Pass 2: fill by overall rank.
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) {
      continue;
    }
    seen.add(chunk.id);
    selected.push(chunk);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
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

function buildKnowledgeBlock(
  chunks: Awaited<ReturnType<typeof retrieveKnowledge>>,
  query: string,
  maxPromptCharsOverride?: number
): string {
  if (chunks.length === 0) {
    return "No stored knowledge available.";
  }

  const queryTerms = extractQueryTerms(query);
  const rankedChunks = [...chunks].sort(
    (a, b) => scoreChunkForQuery(b.content_chunk, queryTerms) - scoreChunkForQuery(a.content_chunk, queryTerms)
  );

  const requestedBudget = maxPromptCharsOverride ?? env.RAG_MAX_PROMPT_CHARS;
  const maxPromptChars = Math.max(1400, Math.min(requestedBudget, 5200));
  const perChunkChars = Math.min(1000, Math.max(260, Math.floor(maxPromptChars / Math.max(1, rankedChunks.length))));
  let usedChars = 0;
  const lines: string[] = [];

  for (let index = 0; index < rankedChunks.length; index += 1) {
    const chunk = compactChunkForQuery(rankedChunks[index].content_chunk, queryTerms, perChunkChars);
    const source = rankedChunks[index].source_name
      ? `${rankedChunks[index].source_type}:${rankedChunks[index].source_name}`
      : rankedChunks[index].source_type;
    const entry = `${index + 1}. [${source}] ${chunk}`;
    if (usedChars + entry.length > maxPromptChars) {
      break;
    }

    lines.push(entry);
    usedChars += entry.length;
  }

  return lines.length > 0 ? lines.join("\n") : "No stored knowledge available.";
}

function normalizeUrlCandidate(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;]+$/g, "");
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(www\.)/i.test(trimmed) || /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+/i.test(trimmed)
      ? `https://${trimmed}`
      : "";

  if (!withProtocol) {
    return null;
  }

  try {
    const parsed = new URL(withProtocol);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const protocolMatches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const bareDomainMatches = text.match(/\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[^\s<>"']*)?/gi) ?? [];
  const urls = new Set<string>();

  for (const candidate of [...protocolMatches, ...bareDomainMatches]) {
    const normalized = normalizeUrlCandidate(candidate);
    if (normalized) {
      urls.add(normalized);
    }
  }

  return Array.from(urls);
}

function buildSourceCoverageBlock(
  chunks: RankedKnowledgeChunk[],
  query: string,
  maxChars: number
): string {
  if (chunks.length === 0) {
    return "No source summaries available.";
  }

  const grouped = new Map<string, RankedKnowledgeChunk[]>();
  for (const chunk of chunks) {
    const key = sourceKeyForChunk(chunk);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(chunk);
  }

  const terms = extractQueryTerms(query);
  const sortedSources = [...grouped.entries()].sort(
    (a, b) => (b[1][0]?.rankScore ?? 0) - (a[1][0]?.rankScore ?? 0)
  );

  const lines: string[] = [];
  let used = 0;
  for (const [key, sourceChunks] of sortedSources) {
    const selectedChunks = sourceChunks.slice(0, 2);
    const snippets = selectedChunks
      .map((chunk) => compactChunkForQuery(chunk.content_chunk, terms, 220))
      .filter(Boolean);
    if (snippets.length === 0) {
      continue;
    }
    const line = `- ${key}: ${trimForPrompt(snippets.join(" | "), 360)}`;
    if (used + line.length > maxChars) {
      break;
    }
    lines.push(line);
    used += line.length;
  }

  return lines.length > 0 ? lines.join("\n") : "No source summaries available.";
}

function resolveLinkFromKnowledge(chunks: RankedKnowledgeChunk[], basics: BusinessBasicsProfile): string | null {
  for (const chunk of chunks) {
    const urls = extractUrlsFromText(chunk.content_chunk || "");
    if (urls.length > 0) {
      return urls[0];
    }
  }

  return normalizeUrlCandidate(basics.websiteUrl) || null;
}

function buildDeterministicKnowledgeReply(
  profile: RetrievalQueryProfile,
  chunks: RankedKnowledgeChunk[],
  basics: BusinessBasicsProfile
): string | null {
  if (!(profile.asksMenuOrCatalog || profile.asksDocument)) {
    return null;
  }

  const link = resolveLinkFromKnowledge(chunks, basics);
  if (!link) {
    return null;
  }

  if (profile.asksDocument || profile.asksBroadList) {
    return `For full details, please use this link: ${link}`;
  }

  return null;
}

function normalizeReplyForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function resolveLastOutboundReply(
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index];
    if (row.direction !== "outbound") {
      continue;
    }
    const text = row.message_text.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function shouldAllowSelfIntroduction(input: {
  intent: SupportIntent;
  incomingMessage: string;
  historyForPrompt: Array<{ direction: "inbound" | "outbound"; message_text: string }>;
}): boolean {
  const hasPriorBotReply = input.historyForPrompt.some((row) => row.direction === "outbound");
  if (hasPriorBotReply) {
    return false;
  }

  if (input.intent !== "greeting") {
    return false;
  }

  const normalized = normalizePromptText(input.incomingMessage);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasGreetingKeyword = INTENT_KEYWORDS.greeting.some((keyword) => normalized.includes(keyword));
  return hasGreetingKeyword || tokenCount <= 4;
}

function stripRepeatedSelfIntroduction(text: string): string {
  const patterns = [
    /^\s*(?:hi|hello|hey|good (?:morning|afternoon|evening)|namaste)[!,. ]+(?:i am|i'm|this is)\s+[^.!?\n]{1,140}[.!?]?\s*/i,
    /^\s*(?:i am|i'm|this is)\s+[^.!?\n]{1,140}\b(?:from|support|assistant|team|bot)\b[^.!?\n]{0,140}[.!?]?\s*/i
  ];

  let cleaned = text.trimStart();
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, "").trimStart();
  }

  const finalText = cleaned.trim();
  return finalText.length >= 8 ? finalText : text.trim();
}

function buildRepeatGuardReply(input: {
  intent: SupportIntent;
  incomingMessage: string;
  basics: BusinessBasicsProfile;
  deterministicReply: string | null;
}): string {
  if (input.deterministicReply) {
    return input.deterministicReply;
  }

  if (input.intent === "booking") {
    return "I can help you book this. Please share date, guest count, and preferred time so I can guide the next step.";
  }

  const normalizedIncoming = normalizePromptText(input.incomingMessage);
  if (/alcohol|beer|wine|liquor|cocktail|drinks/.test(normalizedIncoming)) {
    return "Please share what type of alcohol you want (beer, wine, whisky, cocktail) and quantity; I will check options and availability.";
  }

  const supportLine = buildSupportContactLine(input.basics);
  return `I noted your latest message. Please share one more specific detail and I will answer precisely. If needed, connect with ${supportLine}`;
}

function buildCompactRetryPrompt(input: {
  basics: BusinessBasicsProfile;
  localeContext: LocaleContext;
  supportLine: string;
  escalationPolicyLine: string;
  historyForPrompt: Array<{ direction: "inbound" | "outbound"; message_text: string }>;
  selectedKnowledge: RankedKnowledgeChunk[];
  incomingMessage: string;
}): string {
  const compactHistory = input.historyForPrompt
    .slice(-4)
    .map((item) => `${item.direction === "inbound" ? "User" : "Bot"}: ${trimForPrompt(item.message_text, 180)}`)
    .join("\n");
  const compactKnowledge = buildKnowledgeBlock(
    input.selectedKnowledge.slice(0, 8),
    input.incomingMessage,
    1800
  );

  return [
    `Business context: ${input.basics.companyName} | ${input.basics.whatDoYouSell}`,
    `Locale: ${input.localeContext.countryName} (${input.localeContext.currencyCode})`,
    `Escalation: ${trimForPrompt(input.escalationPolicyLine, 260)} | Contact: ${input.supportLine}`,
    `Recent conversation:\n${compactHistory || "No prior messages."}`,
    `Knowledge:\n${compactKnowledge}`,
    `User message: ${input.incomingMessage}`,
    "Reply with a concise support answer based on available knowledge. If exact answer is missing, state it clearly and offer handoff."
  ].join("\n\n");
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

  return `Thanks for contacting ${basics.companyName}. I can help with updates and issue resolution. Currency format for your region is ${localeContext.currencySymbol} (${localeContext.currencyCode}).`;
}

export async function buildSalesReply(input: ReplyInput): Promise<ReplyOutput> {
  const basics = toBasicsProfile(input.user.business_basics as Record<string, unknown>);
  const queryComplexity = estimateQueryComplexity(input.incomingMessage);
  const retrievalProfile = detectRetrievalProfile(input.incomingMessage);
  const localeContext = resolveLocaleContext(input.conversationPhone, basics);
  const supportLine = buildSupportContactLine(basics);
  const escalationPolicyLine = buildEscalationPolicyLine(basics);
  const historyForPrompt = removeCurrentInboundFromHistory(input.history, input.incomingMessage);
  const detectedIntent = detectSupportIntent(input.incomingMessage, historyForPrompt, retrievalProfile);
  const allowSelfIntroduction = shouldAllowSelfIntroduction({
    intent: detectedIntent,
    incomingMessage: input.incomingMessage,
    historyForPrompt
  });
  const retrievalQuery = buildKnowledgeQuery(input.incomingMessage, historyForPrompt, retrievalProfile);

  if (!openAIService.isConfigured()) {
    return {
      text: buildFallbackReply(detectedIntent, basics, localeContext, input.incomingMessage),
      model: null,
      usage: null,
      retrievalChunks: 0
    };
  }

  let knowledge: RankedKnowledgeChunk[] = [];
  try {
    knowledge = await retrieveRankedKnowledge({
      userId: input.user.id,
      incomingMessage: input.incomingMessage,
      retrievalQuery,
      limit: resolveKnowledgeRetrievalLimit(queryComplexity, retrievalProfile),
      profile: retrievalProfile
    });
  } catch {
    knowledge = [];
  }

  const selectedKnowledge = diversifyKnowledgeCoverage(knowledge, Math.min(knowledge.length, 24));
  const deterministicReply = buildDeterministicKnowledgeReply(retrievalProfile, selectedKnowledge, basics);
  if (deterministicReply) {
    return {
      text: deterministicReply,
      model: null,
      usage: null,
      retrievalChunks: selectedKnowledge.length
    };
  }

  const personality = resolvePersonalityPrompt(input.user.personality, input.user.custom_personality_prompt);
  const selectedPlaybook = playbookForIntent(detectedIntent, basics);

  const allPlaybooksBlock = INTENT_ORDER.map((intent) => {
    return `- ${INTENT_LABELS[intent]}: ${playbookForIntent(intent, basics)}`;
  }).join("\n");

  const topSimilarity =
    selectedKnowledge.length > 0
      ? Math.max(0, Math.min(1, ...selectedKnowledge.map((chunk) => Number(chunk.similarity || 0))))
      : 0;
  const historyWindow = resolveHistoryWindow(queryComplexity, topSimilarity);
  const knowledgeBudget = resolveKnowledgePromptBudget(queryComplexity, retrievalProfile);

  const systemPrompt = [
    "You are WAgen AI, a WhatsApp customer support agent.",
    "Rules:",
    "- Primary role is customer support, not sales.",
    "- Reply in plain conversational text, usually under 120 words.",
    "- Ask at most one follow-up question.",
    allowSelfIntroduction
      ? "- You may include one short self-introduction in this first greeting turn only."
      : "- Do not start with self-introduction in ongoing chat. Avoid repeating lines like 'Hello, I'm ...'.",
    "- Use retrieved knowledge only; do not invent facts.",
    "- If the answer is missing in knowledge, say that clearly and offer support handoff.",
    "- If item price/amount is present near item name in knowledge, return that numeric value.",
    "- Format money in the user's currency.",
    "- Never claim actions you cannot perform.",
    "- Follow the AI Do and AI Don't rules from business context strictly.",
    "- If escalation policy triggers, hand off to human support and include configured contact details.",
    `- Query complexity: ${queryComplexity}. Match response depth to this.`,
    `- Agent objective: ${basics.agentObjectiveType || "hybrid"}.`,
    basics.agentTaskDescription
      ? `- Agent-specific task: ${trimForPrompt(basics.agentTaskDescription, 300)}`
      : "- Agent-specific task: none.",
    `Personality: ${personality}`
  ].join("\n");

  const knowledgeBlock = buildKnowledgeBlock(selectedKnowledge, input.incomingMessage, knowledgeBudget);
  const sourceCoverageBlock = buildSourceCoverageBlock(
    selectedKnowledge,
    input.incomingMessage,
    Math.min(1400, Math.max(600, Math.floor(knowledgeBudget * 0.45)))
  );
  const includeStructuredHints =
    queryComplexity !== "simple" ||
    isPricingQuery(input.incomingMessage) ||
    retrievalProfile.asksMenuOrCatalog ||
    retrievalProfile.asksDocument ||
    retrievalProfile.asksLocation;
  const structuredHints = includeStructuredHints
    ? buildStructuredKnowledgeHints(selectedKnowledge, input.incomingMessage)
    : "Not required for this query.";

  const selectedHistory = historyWindow > 0 ? historyForPrompt.slice(-historyWindow) : [];
  const historyBlock = selectedHistory
    .map((item) => `${item.direction === "inbound" ? "User" : "WAgen AI"}: ${item.message_text}`)
    .join("\n");

  const baseSections = [
    `Business context:\n- Company: ${basics.companyName}\n- Support domain: ${basics.whatDoYouSell}`,
    `AI Do rules:\n${trimForPrompt(basics.aiDoRules || "Answer clearly and stay factual.", 600)}`,
    `AI Don't rules:\n${trimForPrompt(basics.aiDontRules || "Do not invent details not present in knowledge.", 600)}`,
    `Escalation policy:\n- When to escalate: ${trimForPrompt(escalationPolicyLine, 600)}\n- Human contact: ${supportLine}`,
    `Locale context:\n- User country: ${localeContext.countryName} (${localeContext.countryCode})\n- Currency: ${localeContext.currencyCode} (${localeContext.currencySymbol})\n- Locale format: ${localeContext.locale}`,
    `Detected support scenario: ${INTENT_LABELS[detectedIntent]}`,
    `Primary scenario playbook:\n${selectedPlaybook}`,
    `Support handoff contact:\n${supportLine}`
  ];

  const settingsSections = [
    `Customer fit context:\n- Audience: ${basics.targetAudience}\n- Promise/USP: ${basics.usp}\n- Common issues: ${basics.objections}`,
    `All configured playbooks:\n${allPlaybooksBlock}`,
    `Agent objective type:\n${basics.agentObjectiveType || "hybrid"}`,
    `Agent task guideline:\n${basics.agentTaskDescription || "No extra task guidance."}`
  ];

  const promptSections = [...baseSections, ...settingsSections];

  promptSections.push(
    `Conversation with ${input.conversationPhone}:\n${historyBlock || "No prior messages used for this turn."}`,
    `Retrieved knowledge:\n${knowledgeBlock}`,
    `Knowledge source coverage:\n${sourceCoverageBlock}`
  );

  if (includeStructuredHints && structuredHints !== "No structured hints.") {
    promptSections.push(`Structured hints from retrieved knowledge:\n${structuredHints}`);
  }

  promptSections.push(`Incoming message: ${input.incomingMessage}`, "Craft the best support response now.");

  const userPrompt = promptSections.join("\n\n");
  if (env.OPENAI_LOG_USAGE) {
    console.info(
      `[ReplyFunnel] user=${input.user.id} complexity=${queryComplexity} retrieval=${selectedKnowledge.length} sources=${new Set(selectedKnowledge.map((chunk) => sourceKeyForChunk(chunk))).size}`
    );
  }

  try {
    const response = await openAIService.generateReply(systemPrompt, userPrompt);
    let finalText = allowSelfIntroduction ? response.content : stripRepeatedSelfIntroduction(response.content);
    const lastOutbound = resolveLastOutboundReply(historyForPrompt);
    const lastInboundBeforeCurrent = [...historyForPrompt]
      .reverse()
      .find((item) => item.direction === "inbound")
      ?.message_text;
    const currentInboundNormalized = normalizePromptText(input.incomingMessage);
    const isSameQuestionAsPreviousInbound =
      Boolean(lastInboundBeforeCurrent) &&
      normalizePromptText(lastInboundBeforeCurrent as string) === currentInboundNormalized;

    if (
      lastOutbound &&
      !isSameQuestionAsPreviousInbound &&
      normalizeReplyForComparison(lastOutbound) === normalizeReplyForComparison(finalText)
    ) {
      finalText = buildRepeatGuardReply({
        intent: detectedIntent,
        incomingMessage: input.incomingMessage,
        basics,
        deterministicReply: buildDeterministicKnowledgeReply(retrievalProfile, selectedKnowledge, basics)
      });
    }

    return {
      text: finalText,
      model: response.model,
      usage: response.usage ?? null,
      retrievalChunks: selectedKnowledge.length
    };
  } catch (primaryError) {
    console.warn(
      `[ReplyFunnel] primary generation failed user=${input.user.id}: ${(primaryError as Error).message}`
    );
    try {
      const retryPrompt = buildCompactRetryPrompt({
        basics,
        localeContext,
        supportLine,
        escalationPolicyLine,
        historyForPrompt,
        selectedKnowledge,
        incomingMessage: input.incomingMessage
      });
      const retry = await openAIService.generateReply(systemPrompt, retryPrompt, undefined, {
        maxTokens: Math.max(160, Math.min(260, env.OPENAI_MAX_OUTPUT_TOKENS))
      });
      const retryText = allowSelfIntroduction ? retry.content : stripRepeatedSelfIntroduction(retry.content);
      return {
        text: retryText,
        model: retry.model,
        usage: retry.usage ?? null,
        retrievalChunks: selectedKnowledge.length
      };
    } catch (retryError) {
      console.warn(
        `[ReplyFunnel] retry generation failed user=${input.user.id}: ${(retryError as Error).message}`
      );
      return {
        text: buildFallbackReply(detectedIntent, basics, localeContext, input.incomingMessage),
        model: null,
        usage: null,
        retrievalChunks: selectedKnowledge.length
      };
    }
  }
}
