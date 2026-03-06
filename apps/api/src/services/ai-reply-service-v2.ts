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

export interface ReplyOutputV2 {
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
  availability: ["available", "availability", "in stock", "stock", "open", "timing", "today", "tomorrow"],
  objection_handling: [
    "expensive",
    "costly",
    "too much",
    "not sure",
    "maybe later",
    "concern",
    "doubt",
    "trust"
  ],
  booking: ["book", "booking", "schedule", "appointment", "demo", "meeting", "slot", "reserve", "call"],
  feedback_collection: ["feedback", "review", "rating", "experience", "testimonial", "suggestion"],
  complaint_handling: ["complaint", "issue", "problem", "bad", "upset", "refund", "cancel", "delay", "poor service"]
};

const PRICING_KEYWORDS = ["price", "pricing", "cost", "rate", "quote", "charges", "fee", "package", "how much"];
const MENU_KEYWORDS = [
  "menu",
  "dish",
  "dishes",
  "food items",
  "price list",
  "rate card",
  "catalog",
  "veg menu",
  "non veg",
  "starter",
  "main course"
];
const DOCUMENT_KEYWORDS = ["pdf", "document", "file", "brochure", "download", "menu pdf", "menu file"];
const LOCATION_KEYWORDS = ["address", "location", "where are you", "map", "directions", "how to reach"];
const HIRING_KEYWORDS = ["job", "hiring", "vacancy", "career", "apply", "interview", "resume", "biodata"];
const HUMAN_SUPPORT_KEYWORDS = ["manager", "human", "person", "call", "contact", "speak to"];
const MENU_LINK_DIRECTIVE_KEYWORDS = [
  "menu link",
  "send link",
  "share link",
  "full menu",
  "complete menu",
  "visit",
  "website",
  "url"
];
const FOLLOWUP_CONTEXT_TERMS = new Set([
  "it",
  "that",
  "this",
  "same",
  "those",
  "these",
  "more",
  "again",
  "details"
]);

interface QueryProfile {
  asksMenu: boolean;
  asksDocument: boolean;
  asksPdf: boolean;
  asksLocation: boolean;
  asksHiring: boolean;
  asksHumanSupport: boolean;
  asksFullList: boolean;
  isBroadMenuRequest: boolean;
}

const DEFAULT_PLAYBOOKS: Record<SupportIntent, string> = {
  greeting: "Greet politely, introduce support role, and ask one clarifying question when needed.",
  availability: "Share availability clearly. If unavailable, provide the next best option and timeline.",
  objection_handling: "Acknowledge concern first, answer with facts, and suggest one practical next step.",
  booking: "Confirm booking request, collect required details, and provide one clear next action.",
  feedback_collection: "Thank customer, capture concise feedback, and ask at most one follow-up question.",
  complaint_handling: "Apologize clearly, acknowledge issue, propose corrective action, and escalate if unresolved."
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

function readString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function cap(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function includesAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectQueryProfile(
  message: string,
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>
): QueryProfile {
  const normalizedMessage = normalizePromptText(message);
  const messageTokens = normalizedMessage.split(/\s+/).filter(Boolean);
  const isShortPrompt = messageTokens.length <= 4;
  const isFollowupPrompt = messageTokens.some((token) => FOLLOWUP_CONTEXT_TERMS.has(token));
  const recentInboundContext = history
    .filter((item) => item.direction === "inbound")
    .slice(-3)
    .map((item) => normalizePromptText(item.message_text))
    .join(" ");
  const followupScopedContext = isShortPrompt && isFollowupPrompt ? recentInboundContext : "";
  const combined = `${normalizedMessage} ${followupScopedContext}`.trim();

  const asksMenu =
    includesAnyKeyword(normalizedMessage, MENU_KEYWORDS) ||
    (isShortPrompt && isFollowupPrompt && includesAnyKeyword(combined, MENU_KEYWORDS));
  const asksDocument =
    includesAnyKeyword(normalizedMessage, DOCUMENT_KEYWORDS) ||
    (isShortPrompt && isFollowupPrompt && includesAnyKeyword(combined, DOCUMENT_KEYWORDS));
  const asksPdf =
    normalizedMessage.includes("pdf") ||
    (isShortPrompt && isFollowupPrompt && combined.includes("pdf"));
  const asksLocation =
    includesAnyKeyword(normalizedMessage, LOCATION_KEYWORDS) ||
    (isShortPrompt && isFollowupPrompt && includesAnyKeyword(combined, LOCATION_KEYWORDS));
  const asksHiring =
    includesAnyKeyword(normalizedMessage, HIRING_KEYWORDS) ||
    (isShortPrompt && isFollowupPrompt && includesAnyKeyword(combined, HIRING_KEYWORDS));
  const asksHumanSupport =
    includesAnyKeyword(normalizedMessage, HUMAN_SUPPORT_KEYWORDS) ||
    (isShortPrompt && isFollowupPrompt && includesAnyKeyword(combined, HUMAN_SUPPORT_KEYWORDS));
  const asksFullList = /\b(full|entire|complete|all)\b/.test(normalizedMessage) ||
    (isShortPrompt && isFollowupPrompt && /\b(full|entire|complete|all)\b/.test(combined));
  const isBroadMenuRequest =
    (asksMenu && isShortPrompt) ||
    asksFullList ||
    asksDocument ||
    asksPdf ||
    /\b(menu|price list|rate card|catalog)\b/.test(normalizedMessage);

  return {
    asksMenu,
    asksDocument,
    asksPdf,
    asksLocation,
    asksHiring,
    asksHumanSupport,
    asksFullList,
    isBroadMenuRequest
  };
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

function toBasicsProfile(raw: Record<string, unknown>): BusinessBasicsProfile {
  return {
    companyName: readString(raw.companyName, "your company"),
    whatDoYouSell: readString(raw.whatDoYouSell, "N/A"),
    targetAudience: readString(raw.targetAudience, "N/A"),
    usp: readString(raw.usp, "N/A"),
    objections: readString(raw.objections, "N/A"),
    defaultCountry: readString(raw.defaultCountry, "IN").toUpperCase(),
    defaultCurrency: readString(raw.defaultCurrency, "INR").toUpperCase(),
    greetingScript: readString(raw.greetingScript),
    availabilityScript: readString(raw.availabilityScript),
    objectionHandlingScript: readString(raw.objectionHandlingScript),
    bookingScript: readString(raw.bookingScript),
    feedbackCollectionScript: readString(raw.feedbackCollectionScript),
    complaintHandlingScript: readString(raw.complaintHandlingScript),
    supportEmail: readString(raw.supportEmail),
    aiDoRules: readString(raw.aiDoRules),
    aiDontRules: readString(raw.aiDontRules),
    escalationWhenToEscalate: readString(
      raw.escalationWhenToEscalate,
      "Escalate when knowledge is missing, response confidence is low, or user asks for human support."
    ),
    escalationContactPerson: readString(raw.escalationContactPerson),
    escalationPhoneNumber: readString(raw.escalationPhoneNumber),
    escalationEmail: readString(raw.escalationEmail),
    agentObjectiveType: readString(raw.agentObjectiveType, "hybrid"),
    agentTaskDescription: readString(raw.agentTaskDescription),
    websiteUrl: readString(raw.websiteUrl),
    manualFaq: readString(raw.manualFaq)
  };
}

function resolveCurrencySymbol(currencyCode: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "narrowSymbol"
    }).formatToParts(1);
    return parts.find((part) => part.type === "currency")?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

function resolveLocaleContext(phone: string, basics: BusinessBasicsProfile): LocaleContext {
  const phoneDigits = phone.replace(/\D/g, "");
  const prefix = PHONE_PREFIX_COUNTRY_CODES.find((entry) => phoneDigits.startsWith(entry.prefix));

  const countryCode = COUNTRY_NAME_BY_CODE[basics.defaultCountry]
    ? basics.defaultCountry
    : prefix?.countryCode ?? "IN";
  const currencyCode = COUNTRY_CURRENCY_BY_CODE[countryCode] ?? (basics.defaultCurrency || "INR");
  const locale = COUNTRY_LOCALE_BY_CODE[countryCode] ?? "en-IN";

  return {
    countryCode,
    countryName: COUNTRY_NAME_BY_CODE[countryCode] ?? "Unknown",
    locale,
    currencyCode,
    currencySymbol: resolveCurrencySymbol(currencyCode, locale)
  };
}

function estimateComplexity(message: string): QueryComplexity {
  const tokenCount = message.trim().split(/\s+/).filter(Boolean).length;
  const questionCount = (message.match(/\?/g) ?? []).length;

  if (questionCount >= 2 || tokenCount > 32 || /what if|compare|difference/i.test(message)) {
    return "complex";
  }
  if (tokenCount <= 14 && questionCount <= 1) {
    return "simple";
  }
  return "medium";
}

function resolveHistoryWindowSize(complexity: QueryComplexity): number {
  const maxAllowed = Math.max(3, Math.min(18, env.PROMPT_HISTORY_LIMIT * 3));
  const base = complexity === "simple" ? 4 : complexity === "medium" ? 8 : 12;
  return Math.min(base, maxAllowed);
}

function normalizeHistory(
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>,
  incomingMessage: string,
  windowSize: number
): Array<{ direction: "inbound" | "outbound"; message_text: string }> {
  if (history.length === 0) {
    return [];
  }

  const last = history[history.length - 1];
  const withoutCurrentDuplicate =
    last.direction === "inbound" && normalizePromptText(last.message_text) === normalizePromptText(incomingMessage)
      ? history.slice(0, -1)
      : history;
  return withoutCurrentDuplicate.slice(-windowSize);
}

function detectIntent(
  message: string,
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>
): SupportIntent {
  const normalized = message.toLowerCase();
  for (const intent of INTENT_ORDER) {
    if (INTENT_KEYWORDS[intent].some((keyword) => normalized.includes(keyword))) {
      return intent;
    }
  }

  const lastBot = [...history].reverse().find((item) => item.direction === "outbound");
  if (lastBot) {
    const lastNormalized = lastBot.message_text.toLowerCase();
    for (const intent of INTENT_ORDER) {
      if (INTENT_KEYWORDS[intent].some((keyword) => lastNormalized.includes(keyword))) {
        return intent;
      }
    }
  }

  return "greeting";
}

function playbookForIntent(intent: SupportIntent, basics: BusinessBasicsProfile): string {
  const mapped: Record<SupportIntent, string> = {
    greeting: basics.greetingScript,
    availability: basics.availabilityScript,
    objection_handling: basics.objectionHandlingScript,
    booking: basics.bookingScript,
    feedback_collection: basics.feedbackCollectionScript,
    complaint_handling: basics.complaintHandlingScript
  };
  return mapped[intent] || DEFAULT_PLAYBOOKS[intent];
}

function buildEscalationContactLine(basics: BusinessBasicsProfile): string {
  const person = basics.escalationContactPerson || "our support team";
  const channels: string[] = [];

  const phoneFromRulesMatch =
    basics.aiDoRules.match(/(\+?\d[\d\s-]{7,}\d)/) ??
    basics.manualFaq.match(/(\+?\d[\d\s-]{7,}\d)/);
  const derivedPhone = phoneFromRulesMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const resolvedPhone = basics.escalationPhoneNumber || derivedPhone;

  if (resolvedPhone) {
    channels.push(`phone ${resolvedPhone}`);
  }
  if (basics.escalationEmail) {
    channels.push(`email ${basics.escalationEmail}`);
  } else if (basics.supportEmail) {
    channels.push(`email ${basics.supportEmail}`);
  }
  return channels.length > 0 ? `${person} via ${channels.join(" or ")}` : person;
}

function buildEscalationPolicyLine(basics: BusinessBasicsProfile): string {
  return basics.escalationWhenToEscalate || "Escalate when knowledge is missing or user requests human support.";
}

function extractTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3 && !STOPWORDS.has(term))
    )
  );
}

function lexicalHitScore(content: string, terms: string[]): number {
  if (!content) {
    return 0;
  }
  const lower = content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      score += 2;
    }
  }
  if (/\d/.test(content)) {
    score += 1;
  }
  return score;
}

function buildRetrievalQuery(
  incomingMessage: string,
  history: Array<{ direction: "inbound" | "outbound"; message_text: string }>,
  profile: QueryProfile,
  basics: BusinessBasicsProfile
): string {
  const shortHistory = history
    .filter((item) => item.direction === "inbound")
    .slice(-4)
    .map((item) => `User: ${item.message_text}`);
  const queryParts = [incomingMessage];

  if (profile.asksMenu) {
    queryParts.push("menu dishes food items prices starters mains beverages");
    queryParts.push("full menu link url website");
  }
  if (profile.asksDocument || profile.asksPdf) {
    queryParts.push("pdf document file menu document");
    queryParts.push("menu link website url");
  }
  if (profile.asksLocation) {
    queryParts.push("address location map directions");
  }
  if (profile.asksHiring) {
    queryParts.push("hiring job vacancy biodata resume experience salary department");
  }
  if (basics.companyName) {
    queryParts.push(`business ${basics.companyName}`);
  }

  const mergedQuery = Array.from(new Set(queryParts.map((value) => value.trim()).filter(Boolean))).join("\n");
  return shortHistory.length > 0
    ? `${mergedQuery}\n\nRecent context:\n${shortHistory.join("\n")}`
    : mergedQuery;
}

function mergeUniqueChunks(first: KnowledgeChunk[], second: KnowledgeChunk[], limit: number): KnowledgeChunk[] {
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

async function retrieveRankedKnowledge(input: {
  userId: string;
  incomingMessage: string;
  retrievalQuery: string;
  limit: number;
}): Promise<RankedKnowledgeChunk[]> {
  const strict = await retrieveKnowledge({
    userId: input.userId,
    query: input.retrievalQuery,
    limit: input.limit,
    minSimilarity: env.RAG_MIN_SIMILARITY
  });

  const focused = await retrieveKnowledge({
    userId: input.userId,
    query: input.incomingMessage,
    limit: input.limit,
    minSimilarity: 0
  });

  const expandedByContext =
    strict.length >= Math.min(3, input.limit)
      ? strict
      : mergeUniqueChunks(
          strict,
          await retrieveKnowledge({
            userId: input.userId,
            query: input.retrievalQuery,
            limit: input.limit,
            minSimilarity: 0
          }),
          input.limit * 2
        );

  const expanded = mergeUniqueChunks(
    mergeUniqueChunks(strict, focused, input.limit * 3),
    expandedByContext,
    input.limit * 3
  );

  const terms = extractTerms(`${input.incomingMessage}\n${input.retrievalQuery}`);
  return expanded
    .filter((chunk) => chunk.content_chunk && chunk.content_chunk.trim().length >= 20)
    .map((chunk) => {
      const lexical = lexicalHitScore(chunk.content_chunk, terms);
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

function compactChunk(content: string, terms: string[], budget: number): string {
  const normalized = content.toLowerCase();
  const snippets: string[] = [];

  for (const term of terms) {
    let fromIndex = 0;
    while (fromIndex < normalized.length) {
      const hit = normalized.indexOf(term, fromIndex);
      if (hit < 0) {
        break;
      }
      const from = Math.max(0, hit - 180);
      const to = Math.min(content.length, hit + term.length + 260);
      snippets.push(content.slice(from, to).trim());
      fromIndex = hit + term.length;
    }
  }

  if (snippets.length > 0) {
    return cap(Array.from(new Set(snippets)).join(" | "), budget);
  }
  return cap(content.trim(), budget);
}

function resolveKnowledgeBudget(complexity: QueryComplexity, profile: QueryProfile): number {
  const configured = Math.max(900, Math.min(env.RAG_MAX_PROMPT_CHARS, 3200));
  if (profile.asksMenu || profile.asksDocument || profile.asksPdf) {
    return configured;
  }
  if (complexity === "simple") {
    return Math.min(1200, configured);
  }
  if (complexity === "medium") {
    return Math.min(2200, configured);
  }
  return configured;
}

function resolveRetrievalLimit(profile: QueryProfile): number {
  const base = Math.max(8, Math.min(14, env.RAG_RETRIEVAL_LIMIT + 2));
  if (profile.asksMenu || profile.asksDocument || profile.asksPdf) {
    return Math.min(20, Math.max(base, 14));
  }
  if (profile.asksLocation || profile.asksHiring) {
    return Math.min(16, Math.max(base, 10));
  }
  return base;
}

function buildKnowledgeBlock(chunks: RankedKnowledgeChunk[], retrievalQuery: string, totalBudget: number): string {
  if (chunks.length === 0) {
    return "No knowledge available.";
  }

  const terms = extractTerms(retrievalQuery);
  const perChunkBudget = Math.max(220, Math.min(900, Math.floor(totalBudget / chunks.length)));
  let used = 0;
  const rows: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const source = chunk.source_name ? `${chunk.source_type}:${chunk.source_name}` : chunk.source_type;
    const snippet = compactChunk(chunk.content_chunk, terms, perChunkBudget);
    const row = `${index + 1}. [${source}] ${snippet}`;
    if (used + row.length > totalBudget) {
      break;
    }
    rows.push(row);
    used += row.length;
  }

  return rows.length > 0 ? rows.join("\n") : "No knowledge available.";
}

function normalizeForDedupe(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractMenuItemsFromChunks(chunks: RankedKnowledgeChunk[], limit = 14): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const pattern = /([A-Za-z][A-Za-z0-9 '&().\/-]{2,}?)\s*(?:\u20B9|rs\.?|inr)\s*([0-9]{2,5})/gi;
  const noisyNamePattern = /gst|extra time|we only use|strictly avoid|hygiene|start with|policy|maintain/i;

  for (const chunk of chunks) {
    const text = chunk.content_chunk || "";
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match) {
      const rawName = (match[1] || "").replace(/[^\p{L}\p{N} '&().\/-]/gu, " ").replace(/\s+/g, " ").trim();
      const price = (match[2] || "").trim();
      const normalizedName = normalizeForDedupe(rawName);
      const wordCount = rawName.split(/\s+/).filter(Boolean).length;
      const hasLetters = /[a-z]{3,}/i.test(rawName);
      const isLikelyNoise = noisyNamePattern.test(rawName);
      const isLengthValid = rawName.length >= 3 && rawName.length <= 52;
      const isWordCountValid = wordCount >= 1 && wordCount <= 7;

      if (
        isLengthValid &&
        isWordCountValid &&
        hasLetters &&
        !isLikelyNoise &&
        price &&
        normalizedName &&
        !seen.has(normalizedName)
      ) {
        seen.add(normalizedName);
        items.push(`${toTitleCase(rawName)} - Rs ${price}`);
        if (items.length >= limit) {
          return items;
        }
      }
      match = pattern.exec(text);
    }
  }

  return items;
}

function extractPdfSourceNames(chunks: RankedKnowledgeChunk[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const sourceName = (chunk.source_name || "").trim();
    if (!sourceName) {
      continue;
    }
    if (!/\.pdf$/i.test(sourceName)) {
      continue;
    }
    const key = sourceName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(sourceName);
  }
  return names;
}

function sourcePriorityForMenuLink(sourceType: string): number {
  if (sourceType === "manual") {
    return 3;
  }
  if (sourceType === "website") {
    return 2;
  }
  return 1;
}

function resolveMenuLinkFromKnowledge(chunks: RankedKnowledgeChunk[], basics: BusinessBasicsProfile): string | null {
  const prioritized = [...chunks].sort((left, right) => {
    const bySource = sourcePriorityForMenuLink(right.source_type) - sourcePriorityForMenuLink(left.source_type);
    if (bySource !== 0) {
      return bySource;
    }
    return right.rankScore - left.rankScore;
  });

  for (const chunk of prioritized) {
    const text = chunk.content_chunk || "";
    if (!text.trim()) {
      continue;
    }
    const normalized = normalizePromptText(text);
    const hasMenuContext =
      includesAnyKeyword(normalized, MENU_KEYWORDS) || includesAnyKeyword(normalized, DOCUMENT_KEYWORDS);
    if (!hasMenuContext) {
      continue;
    }
    const hasLinkDirective = includesAnyKeyword(normalized, MENU_LINK_DIRECTIVE_KEYWORDS);
    const urls = extractUrlsFromText(text);
    if (urls.length === 0) {
      continue;
    }
    if (hasLinkDirective || chunk.source_type === "manual" || chunk.source_type === "website") {
      return urls[0];
    }
  }

  const basicsUrl = normalizeUrlCandidate(basics.websiteUrl);
  return basicsUrl || null;
}

function buildStructuredKnowledgeReply(
  profile: QueryProfile,
  basics: BusinessBasicsProfile,
  rankedChunks: RankedKnowledgeChunk[]
): string | null {
  const menuItems = extractMenuItemsFromChunks(rankedChunks, profile.asksFullList ? 18 : 12);
  const pdfSources = extractPdfSourceNames(rankedChunks);
  const menuLink = resolveMenuLinkFromKnowledge(rankedChunks, basics);
  const escalationContact = buildEscalationContactLine(basics);
  const wantsMenuOrDocument = profile.asksMenu || profile.asksDocument || profile.asksPdf;
  const shouldPreferMenuLink = wantsMenuOrDocument && (profile.isBroadMenuRequest || profile.asksFullList);
  const lines: string[] = [];

  if (shouldPreferMenuLink && menuLink) {
    return `For full menu, please use this link: ${menuLink}`;
  }

  if ((profile.asksDocument || profile.asksPdf) && pdfSources.length > 0 && !menuLink) {
    lines.push(`Menu document(s) in knowledge base: ${pdfSources.slice(0, 3).join(", ")}.`);
  }

  if (wantsMenuOrDocument && menuLink) {
    lines.push(`For full menu, please use this link: ${menuLink}`);
  }

  if (wantsMenuOrDocument) {
    if (menuItems.length > 0) {
      lines.push("Menu highlights from your uploaded data:");
      for (const item of menuItems.slice(0, profile.asksFullList ? 16 : 10)) {
        lines.push(`- ${item}`);
      }
      lines.push("Tell me your preference (veg/non-veg/starters/main course/drinks) and I will share that full section.");
    } else if (menuLink) {
      lines.push("If you want, I can also share key dish names and prices here.");
    }
  }

  if (profile.asksLocation && basics.manualFaq) {
    lines.push(`Location details: ${cap(basics.manualFaq, 280)}`);
  }

  if (profile.asksHiring) {
    lines.push("For hiring, please share biodata/resume, experience, department applied for, and salary expectation.");
  }

  if (profile.asksHumanSupport && escalationContact) {
    lines.push(`For manager support, connect with ${escalationContact}.`);
  }

  const merged = lines.join("\n").trim();
  return merged.length > 0 ? merged : null;
}

function shouldOverrideGenericRefusal(modelReply: string, profile: QueryProfile): boolean {
  if (!(profile.asksMenu || profile.asksDocument || profile.asksPdf)) {
    return false;
  }
  return /can(?:'|\u2019)?t provide (the )?(entire|full) menu|cannot provide (the )?(entire|full) menu|can(?:'|\u2019)?t provide .*pdf|cannot provide .*pdf/i.test(
    modelReply
  );
}

function resolveReplyMaxTokens(complexity: QueryComplexity, profile: QueryProfile): number | undefined {
  if (profile.asksMenu || profile.asksDocument || profile.asksPdf) {
    return Math.max(280, env.OPENAI_MAX_OUTPUT_TOKENS);
  }
  if (complexity === "complex") {
    return Math.max(220, env.OPENAI_MAX_OUTPUT_TOKENS);
  }
  return undefined;
}

function buildHistoryBlock(history: Array<{ direction: "inbound" | "outbound"; message_text: string }>): string {
  if (history.length === 0) {
    return "No prior messages.";
  }
  return history
    .map((item) => `${item.direction === "inbound" ? "User" : "Bot"}: ${cap(item.message_text, 500)}`)
    .join("\n");
}

function buildSettingsBlock(
  basics: BusinessBasicsProfile,
  intent: SupportIntent,
  complexity: QueryComplexity,
  locale: LocaleContext
): string {
  const selectedPlaybook = playbookForIntent(intent, basics);
  const escalationContact = buildEscalationContactLine(basics);
  const escalationPolicy = buildEscalationPolicyLine(basics);

  const commonLines = [
    `Company: ${basics.companyName}`,
    `Business: ${basics.whatDoYouSell}`,
    `Audience: ${basics.targetAudience}`,
    `USP: ${basics.usp}`,
    `Common objections: ${basics.objections}`,
    `Locale: ${locale.countryName} (${locale.countryCode}), currency ${locale.currencyCode} (${locale.currencySymbol})`,
    `AI Do rules: ${cap(basics.aiDoRules || "Answer clearly and stay factual.", 700)}`,
    `AI Don't rules: ${cap(basics.aiDontRules || "Do not invent details not present in knowledge.", 700)}`,
    basics.websiteUrl ? `Website URL: ${basics.websiteUrl}` : "",
    basics.manualFaq ? `Manual FAQ: ${cap(basics.manualFaq, 500)}` : "",
    `Agent objective: ${basics.agentObjectiveType || "hybrid"}`,
    basics.agentTaskDescription ? `Agent task: ${cap(basics.agentTaskDescription, 320)}` : "",
    `Escalation trigger: ${cap(escalationPolicy, 500)}`,
    `Escalation contact: ${escalationContact}`,
    `Primary playbook (${INTENT_LABELS[intent]}): ${cap(selectedPlaybook, 420)}`
  ].filter(Boolean);

  if (complexity === "simple") {
    return commonLines.join("\n");
  }

  const allPlaybooks = [
    `Greeting script: ${cap(basics.greetingScript || DEFAULT_PLAYBOOKS.greeting, 240)}`,
    `Availability script: ${cap(basics.availabilityScript || DEFAULT_PLAYBOOKS.availability, 240)}`,
    `Objection script: ${cap(basics.objectionHandlingScript || DEFAULT_PLAYBOOKS.objection_handling, 240)}`,
    `Booking script: ${cap(basics.bookingScript || DEFAULT_PLAYBOOKS.booking, 240)}`,
    `Feedback script: ${cap(basics.feedbackCollectionScript || DEFAULT_PLAYBOOKS.feedback_collection, 240)}`,
    `Complaint script: ${cap(basics.complaintHandlingScript || DEFAULT_PLAYBOOKS.complaint_handling, 240)}`
  ];

  return [...commonLines, ...allPlaybooks].join("\n");
}

function buildPrompt(input: {
  basics: BusinessBasicsProfile;
  intent: SupportIntent;
  complexity: QueryComplexity;
  queryProfile: QueryProfile;
  locale: LocaleContext;
  personality: string;
  historyBlock: string;
  settingsBlock: string;
  knowledgeBlock: string;
  incomingMessage: string;
}): { systemPrompt: string; userPrompt: string } {
  const { personality, settingsBlock, historyBlock, knowledgeBlock, incomingMessage, queryProfile } = input;

  const systemPrompt = [
    "You are WAgen AI, a WhatsApp customer support assistant.",
    `Personality: ${personality}`,
    "Rules:",
    "- Use only provided knowledge and settings. Do not hallucinate.",
    "- Follow bot settings, AI Do rules, AI Don't rules, and playbooks as strict instructions.",
    "- Keep reply concise and conversational unless user asks for full list/details.",
    "- Ask at most one follow-up question.",
    "- If answer is not in knowledge, say so clearly and escalate with configured contact details.",
    "- Respect AI Do and AI Don't rules exactly.",
    "- Format monetary values using the locale currency context.",
    "- If knowledge includes a menu URL instruction (for example 'send link for full menu'), send that URL first.",
    "- If user asks for menu/catalog/rate-card, provide available items and prices from knowledge and follow menu-link instructions.",
    "- If user asks for PDF/document, follow knowledge instructions first; otherwise mention available source document names."
  ].join("\n");

  const userPrompt = [
    `[Query Profile]\n${JSON.stringify(queryProfile)}`,
    `[Bot Settings]\n${settingsBlock}`,
    `[Conversation History]\n${historyBlock}`,
    `[Retrieved Knowledge Chunks]\n${knowledgeBlock}`,
    `[User Message]\n${incomingMessage}`,
    "Generate the best support reply now."
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

function buildFallback(
  intent: SupportIntent,
  basics: BusinessBasicsProfile,
  locale: LocaleContext,
  message: string
): string {
  const escalationContact = buildEscalationContactLine(basics);
  if (PRICING_KEYWORDS.some((keyword) => message.toLowerCase().includes(keyword))) {
    return `For pricing details, please connect with ${escalationContact}. I can help with support queries here.`;
  }
  if (intent === "complaint_handling") {
    return `Sorry for the inconvenience. Please share details and we will resolve it quickly. If urgent, contact ${escalationContact}.`;
  }
  if (intent === "booking") {
    return "Thanks for reaching out. Please share your preferred date and time and I will help with booking.";
  }
  return `Thanks for contacting ${basics.companyName}. I can help you here. Currency for your region is ${locale.currencySymbol} (${locale.currencyCode}).`;
}

function buildNoKnowledgeReply(basics: BusinessBasicsProfile): string {
  const fallback = basics.complaintHandlingScript || "I do not have this information right now.";
  const escalationContact = buildEscalationContactLine(basics);
  return `${fallback} I could not find a reliable answer in the knowledge base. Please connect with ${escalationContact}.`;
}

export async function buildSalesReplyV2(input: ReplyInput): Promise<ReplyOutputV2> {
  const basics = toBasicsProfile(input.user.business_basics as Record<string, unknown>);
  const complexity = estimateComplexity(input.incomingMessage);
  const locale = resolveLocaleContext(input.conversationPhone, basics);
  const historyWindow = resolveHistoryWindowSize(complexity);
  const history = normalizeHistory(input.history, input.incomingMessage, historyWindow);
  const queryProfile = detectQueryProfile(input.incomingMessage, history);
  const intent = detectIntent(input.incomingMessage, history);

  if (!openAIService.isConfigured()) {
    return {
      text: buildFallback(intent, basics, locale, input.incomingMessage),
      model: null,
      usage: null,
      retrievalChunks: 0
    };
  }

  const retrievalQuery = buildRetrievalQuery(input.incomingMessage, history, queryProfile, basics);
  let rankedChunks: RankedKnowledgeChunk[] = [];
  try {
    rankedChunks = await retrieveRankedKnowledge({
      userId: input.user.id,
      incomingMessage: input.incomingMessage,
      retrievalQuery,
      limit: resolveRetrievalLimit(queryProfile)
    });
  } catch {
    rankedChunks = [];
  }

  if (rankedChunks.length === 0) {
    return {
      text: buildNoKnowledgeReply(basics),
      model: null,
      usage: null,
      retrievalChunks: 0
    };
  }

  const deterministicReply = buildStructuredKnowledgeReply(queryProfile, basics, rankedChunks);
  if (deterministicReply && (queryProfile.asksMenu || queryProfile.asksDocument || queryProfile.asksPdf)) {
    return {
      text: deterministicReply,
      model: null,
      usage: null,
      retrievalChunks: rankedChunks.length
    };
  }

  const personality = resolvePersonalityPrompt(input.user.personality, input.user.custom_personality_prompt);
  const settingsBlock = buildSettingsBlock(basics, intent, complexity, locale);
  const historyBlock = buildHistoryBlock(history);
  const knowledgeBlock = buildKnowledgeBlock(
    rankedChunks,
    retrievalQuery,
    resolveKnowledgeBudget(complexity, queryProfile)
  );
  const { systemPrompt, userPrompt } = buildPrompt({
    basics,
    intent,
    complexity,
    queryProfile,
    locale,
    personality,
    historyBlock,
    settingsBlock,
    knowledgeBlock,
    incomingMessage: input.incomingMessage
  });

  try {
    const response = await openAIService.generateReply(systemPrompt, userPrompt, undefined, {
      maxTokens: resolveReplyMaxTokens(complexity, queryProfile)
    });
    const finalText =
      shouldOverrideGenericRefusal(response.content, queryProfile) && deterministicReply
        ? deterministicReply
        : response.content;
    return {
      text: finalText,
      model: response.model,
      usage: response.usage ?? null,
      retrievalChunks: rankedChunks.length
    };
  } catch {
    return {
      text: buildFallback(intent, basics, locale, input.incomingMessage),
      model: null,
      usage: null,
      retrievalChunks: rankedChunks.length
    };
  }
}
