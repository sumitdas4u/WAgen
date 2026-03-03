import { pool } from "../db/pool.js";
import { listRecentConversationMessages, type ConversationMessageSnapshot } from "./conversation-service.js";
import { ingestManualText } from "./knowledge-ingestion-service.js";

const REVIEW_CONFIDENCE_THRESHOLD = 70;
const DUPLICATE_WINDOW_SECONDS = 6 * 60 * 60;

const FALLBACK_REPLY_PATTERNS = [
  // "I don't know" variations (10 patterns)
  "i'm not sure",
  "i am not sure",
  "i dont know",
  "i don't know",
  "i do not know",
  "do not know",
  "won't know",
  "can't say for sure",
  "not certain",
  "uncertain",

  // "Don't have information" variations (30+ patterns)
  "do not have that information",
  "don't have that information",
  "do not have information",
  "don't have information",
  "do not have any information",
  "don't have any information",
  "do not have specific information",
  "don't have specific information",
  "do not have details",
  "don't have details",
  "do not have data",
  "don't have data",
  "do not have records",
  "don't have records",
  "do not have that on file",
  "don't have that on file",
  "do not have that in my system",
  "don't have that in my system",
  "i don't have the exact",
  "i do not have the exact",
  "i don't have the exact number",
  "i do not have the exact number",
  "i don't have the exact details",
  "i do not have the exact details",
  "unfortunately, i don't have",
  "unfortunately i don't have",
  "unfortunately i do not have",
  "not in my records",
  "not in my system",
  "not on file",
  "not in my knowledge",
  "not in the database",
  "not available in my system",
  "no information available",
  "no data available",
  "no such information",
  "no record of",
  "no details available",

  // "I appreciate your" variations (3 patterns)
  "i appreciate your",
  "thanks for your",
  "thank you for your",

  // "Contact support" variations (8 patterns)
  "please contact support",
  "contact support",
  "reach out to support",
  "please reach out",
  "contact our team",
  "reach out to our team",
  "contact the team",
  "get in touch with support",

  // "Unable to" variations (12 patterns)
  "unable to find",
  "unable to help",
  "unable to provide",
  "unable to assist",
  "unable to access",
  "unable to retrieve",
  "unable to locate",
  "unable to answer",
  "unable to respond",
  "unable to comment",
  "unable to verify",
  "unable to determine",

  // "Cannot/Can't" variations (18 patterns)
  "cannot help with that",
  "can't help with that",
  "cannot provide",
  "can't provide",
  "cannot assist",
  "can't assist",
  "cannot find",
  "can't find",
  "cannot access",
  "can't access",
  "cannot retrieve",
  "can't retrieve",
  "cannot confirm",
  "can't confirm",
  "cannot determine",
  "can't determine",
  "cannot verify",
  "can't verify",

  // "Not familiar" variations (8 patterns)
  "not familiar with",
  "i'm not familiar",
  "i am not familiar",
  "i'm not sure about",
  "i am not sure about",
  "not acquainted with",
  "not aware of",
  "unfamiliar with",

  // "Don't understand" variations (12 patterns)
  "i don't understand",
  "i do not understand",
  "don't understand",
  "i don't comprehend",
  "i do not comprehend",
  "i'm confused",
  "i am confused",
  "i'm not aware",
  "i am not aware",
  "not clear",
  "unclear",
  "confusing question",

  // General disclaimer patterns (8 patterns)
  "i'm sorry, but i can't",
  "i am sorry, but i can't",
  "i'm sorry but i can't",
  "sorry but i can't",
  "i'm sorry, but i don't",
  "i am sorry, but i don't",
  "sorry i can't",
  "sorry i don't",

  // "Don't have access" variations (6 patterns)
  "don't have access",
  "do not have access",
  "don't have permission",
  "do not have permission",
  "i'm unable to",
  "i am unable to",

  // "Not found" variations (10 patterns)
  "not found",
  "not located",
  "couldn't find",
  "could not find",
  "not available",
  "unavailable",
  "currently unavailable",
  "out of stock",
  "not in stock",
  "not listed",

  // "Need clarification" variations (8 patterns)
  "need more information",
  "need clarification",
  "please clarify",
  "could you clarify",
  "could you be more specific",
  "need more details",
  "specify",
  "more details needed",

  // "Beyond scope" variations (10 patterns)
  "beyond my knowledge",
  "outside my scope",
  "beyond my scope",
  "not my area",
  "not my expertise",
  "beyond what i know",
  "not my specialty",
  "beyond what i can help",
  "outside my expertise",
  "not within my knowledge",

  // "Refer to someone else" variations (8 patterns)
  "you should ask",
  "you might want to ask",
  "better to ask",
  "best to ask",
  "contact the manager",
  "speak to the manager",
  "ask the team",
  "check with",

  // "Limited by system" variations (8 patterns)
  "my system doesn't have",
  "my system doesn't show",
  "not in my system",
  "not stored in my system",
  "my database doesn't contain",
  "no access to that",
  "not accessible",
  "not retrievable",

  // "Apologizing/Unable" variations (8 patterns)
  "sorry, i can't help",
  "sorry i cannot help",
  "afraid i cannot",
  "afraid i can't",
  "regret i cannot",
  "regret i can't",
  "unfortunate that i can't",
  "hate that i can't",

  // "Lack of expertise" variations (6 patterns)
  "not an expert",
  "not my expertise",
  "outside my expertise",
  "beyond my expertise",
  "limited knowledge",
  "limited information",

  // "Don't have authority" variations (6 patterns)
  "don't have the authority",
  "not authorized to",
  "not my decision",
  "not in my power",
  "can't make that decision",
  "not my call",

  // Additional catch-all patterns (15+ patterns)
  "i lack",
  "lacking information",
  "insufficient information",
  "not enough information",
  "incomplete information",
  "partial information only",
  "limited details",
  "vague",
  "general information",
  "unclear how to",
  "no idea",
  "no clue",
  "haven't got",
  "haven't a",
  "no way to",
  "no means to",
  "no method to",
  "unable to verify",
  "can't verify",
  "cannot validate"
];

const NEGATIVE_FEEDBACK_PATTERNS = [
  "that's wrong",
  "that is wrong",
  "not correct",
  "incorrect",
  "wrong answer",
  "you did not answer",
  "you didn't answer",
  "didnt answer",
  "not helpful",
  "this is wrong"
];

const STRONG_UNKNOWN_REPLY_PATTERNS = [
  "i don't know",
  "i do not know",
  "i'm not sure",
  "i am not sure",
  "i don't have",
  "i do not have",
  "not familiar with",
  "unable to find",
  "unable to help",
  "cannot help with that",
  "can't help with that",
  "please contact support",
  "no information available",
  "not in my system",
  "not in my knowledge"
];

const CLARIFICATION_REPLY_PATTERNS = [
  "please clarify",
  "could you clarify",
  "could you provide more details",
  "please provide more details",
  "please share more details",
  "could you share more details",
  "which one",
  "what exactly",
  "can you be more specific"
];

const IRRELEVANT_QUESTION_PATTERNS = [
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "k",
  "kk",
  "hmm",
  "hmmm",
  "thanks",
  "thank you",
  "test",
  "testing",
  "typo",
  "asdf",
  "qwerty",
  "zxcv"
];

export type AiReviewQueueStatus = "pending" | "resolved";

export interface AiReviewQueueItem {
  id: string;
  user_id: string;
  conversation_id: string | null;
  customer_phone: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  trigger_signals: string[];
  status: AiReviewQueueStatus;
  resolution_answer: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

interface CreateQueueItemInput {
  userId: string;
  conversationId: string;
  customerPhone: string;
  question: string;
  aiResponse: string;
  confidenceScore: number;
  signals: string[];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPattern(value: string, patterns: string[]): boolean {
  const normalized = normalizeText(value);
  return patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isFallbackResponse(aiResponse: string): boolean {
  const isFallback = includesPattern(aiResponse, FALLBACK_REPLY_PATTERNS);
  if (isFallback) {
    console.log(`[AI-Review] Fallback response detected: "${aiResponse.substring(0, 80)}..."`);
  }
  return isFallback;
}

function isNegativeFeedbackMessage(message: string): boolean {
  return includesPattern(message, NEGATIVE_FEEDBACK_PATTERNS);
}

function isStrongUnknownResponse(aiResponse: string): boolean {
  return includesPattern(aiResponse, STRONG_UNKNOWN_REPLY_PATTERNS);
}

function isClarificationStyleResponse(aiResponse: string): boolean {
  return includesPattern(aiResponse, CLARIFICATION_REPLY_PATTERNS);
}

function getQuestionRejectionReason(question: string): string | null {
  const normalized = normalizeText(question);
  if (!normalized) {
    return "empty_question";
  }

  if (IRRELEVANT_QUESTION_PATTERNS.includes(normalized)) {
    return "irrelevant_short_message";
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return "empty_tokens";
  }

  if (tokens.length === 1 && tokens[0].length <= 3) {
    return "single_token_too_short";
  }

  const lettersOnly = normalized.replace(/[^a-z]/g, "");
  if (lettersOnly.length < 3) {
    return "insufficient_letters";
  }

  if (/(.)\1{4,}/.test(lettersOnly)) {
    return "repeated_char_noise";
  }

  if (lettersOnly.length >= 5) {
    const vowelCount = (lettersOnly.match(/[aeiou]/g) ?? []).length;
    if (vowelCount === 0) {
      return "likely_typo_or_gibberish";
    }
  }

  if (tokens.every((token) => token.length <= 2)) {
    return "token_quality_too_low";
  }

  return null;
}

function shouldQueueFailureForLearning(input: {
  question: string;
  aiResponse: string;
  signals: string[];
}): { shouldQueue: boolean; reason: string | null } {
  const questionRejection = getQuestionRejectionReason(input.question);
  if (questionRejection) {
    return { shouldQueue: false, reason: questionRejection };
  }

  const strongUnknown = isStrongUnknownResponse(input.aiResponse);
  const clarification = isClarificationStyleResponse(input.aiResponse);
  const tokenCount = normalizeText(input.question).split(" ").filter(Boolean).length;
  if (clarification && tokenCount <= 3) {
    return { shouldQueue: false, reason: "clarification_for_short_question" };
  }

  const hasFallbackSignal = input.signals.includes("fallback_response");
  const hasNoKnowledgeSignal = input.signals.includes("no_knowledge_match");
  if (!hasFallbackSignal && !strongUnknown) {
    return { shouldQueue: false, reason: "response_not_confidently_unknown" };
  }

  if (!hasFallbackSignal && !hasNoKnowledgeSignal) {
    return { shouldQueue: false, reason: "weak_failure_signals" };
  }

  return { shouldQueue: true, reason: null };
}

function estimateConfidenceScore(input: {
  retrievalChunks: number;
  aiResponse: string;
}): number {
  const retrieval = Math.max(0, Number(input.retrievalChunks || 0));
  let score = 52 + Math.min(4, retrieval) * 11;
  if (isFallbackResponse(input.aiResponse)) {
    score = Math.min(score, 38);
  }
  return clampConfidence(score);
}

function inferFailureSignals(input: {
  retrievalChunks: number;
  aiResponse: string;
  confidenceScore: number;
}): string[] {
  const signals: string[] = [];
  const retrieval = Math.max(0, Number(input.retrievalChunks || 0));

  if (retrieval === 0) {
    signals.push("no_knowledge_match");
  }
  if (isFallbackResponse(input.aiResponse)) {
    signals.push("fallback_response");
  }
  if (input.confidenceScore < REVIEW_CONFIDENCE_THRESHOLD) {
    signals.push("low_confidence");
  }

  return Array.from(new Set(signals));
}

async function findPendingDuplicate(input: {
  userId: string;
  conversationId: string;
  question: string;
  aiResponse: string;
}): Promise<string | null> {
  const normalizedQuestion = normalizeText(input.question);

  // Check for RESOLVED items globally (across all conversations)
  // If a question is already resolved and has knowledge in KB, don't queue it again
  // This prevents duplicate learning center items for the same question
  const result = await pool.query<{ id: string; question: string; status: string }>(
    `SELECT id, question, status
     FROM ai_review_queue
     WHERE user_id = $1
       AND status = 'resolved'
       AND created_at >= NOW() - ($2::text || ' seconds')::interval
     ORDER BY created_at DESC
     LIMIT 50`,  // Check more resolved items globally
    [
      input.userId,
      String(DUPLICATE_WINDOW_SECONDS * 4)  // Extend window for resolved items (24 hours)
    ]
  );

  // Check if this question has already been resolved before
  for (const row of result.rows) {
    if (normalizeText(row.question) === normalizedQuestion) {
      console.log(`[AI-Review] ✓ SKIP QUEUE - Question already resolved: existing_id=${row.id}, question="${input.question.substring(0, 50)}..."`);
      console.log(`[AI-Review]   Reason: This question has knowledge in the database from previous resolution`);
      return row.id;  // Return existing ID to skip queuing
    }
  }

  // Also check for PENDING duplicates in SAME conversation only (6-hour window)
  // This prevents rapid duplicate submissions in the same conversation
  const pendingResult = await pool.query<{ id: string; question: string }>(
    `SELECT id, question
     FROM ai_review_queue
     WHERE user_id = $1
       AND conversation_id = $2
       AND status = 'pending'
       AND created_at >= NOW() - ($3::text || ' seconds')::interval
     ORDER BY created_at DESC
     LIMIT 10`,
    [
      input.userId,
      input.conversationId,
      String(DUPLICATE_WINDOW_SECONDS)
    ]
  );

  for (const row of pendingResult.rows) {
    if (normalizeText(row.question) === normalizedQuestion) {
      console.log(`[AI-Review] Found duplicate pending question (6hr window): existing_id=${row.id}, question="${input.question.substring(0, 50)}..."`);
      return row.id;
    }
  }

  return null;
}

async function createQueueItem(input: CreateQueueItemInput): Promise<{ created: boolean; itemId: string | null }> {
  const question = input.question.trim();
  const aiResponse = input.aiResponse.trim();

  // Validation checks with detailed logging
  if (!question) {
    console.log(`[AI-Review] Queue item rejected: empty question (conversation=${input.conversationId})`);
    return { created: false, itemId: null };
  }

  if (!aiResponse) {
    console.log(`[AI-Review] Queue item rejected: empty AI response (conversation=${input.conversationId})`);
    return { created: false, itemId: null };
  }

  const questionRejection = getQuestionRejectionReason(question);
  if (questionRejection) {
    console.log(
      `[AI-Review] Queue item rejected: question filtered as irrelevant (reason=${questionRejection}, conversation=${input.conversationId})`
    );
    return { created: false, itemId: null };
  }

  if (input.signals.length === 0) {
    console.log(`[AI-Review] Queue item rejected: no trigger signals detected (conversation=${input.conversationId})`);
    console.log(`  Question: "${question.substring(0, 100)}..."`);
    console.log(`  AI Response: "${aiResponse.substring(0, 100)}..."`);
    return { created: false, itemId: null };
  }

  const duplicateId = await findPendingDuplicate({
    userId: input.userId,
    conversationId: input.conversationId,
    question,
    aiResponse
  });
  if (duplicateId) {
    console.log(`[AI-Review] Queue item rejected: ALREADY RESOLVED - skipping duplicate queue (existing_id=${duplicateId})`);
    console.log(`[AI-Review]   User already provided answer for: "${question.substring(0, 70)}..."`);
    console.log(`[AI-Review]   Knowledge is now available in knowledge base for this question`);
    return { created: false, itemId: duplicateId };
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO ai_review_queue (
       user_id,
       conversation_id,
       customer_phone,
       question,
       ai_response,
       confidence_score,
       trigger_signals
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
     RETURNING id`,
    [
      input.userId,
      input.conversationId,
      input.customerPhone,
      question,
      aiResponse,
      clampConfidence(input.confidenceScore),
      input.signals
    ]
  );

  const itemId = inserted.rows[0]?.id ?? null;
  console.log(`[AI-Review] Queue item created: item_id=${itemId}, confidence=${input.confidenceScore}, signals=${input.signals.join(",")}`);

  return { created: true, itemId };
}

function pickFeedbackAnchor(
  rows: ConversationMessageSnapshot[],
  feedbackText: string
): number {
  const normalizedFeedback = normalizeText(feedbackText);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.direction !== "inbound") {
      continue;
    }
    if (normalizeText(row.message_text) === normalizedFeedback) {
      return index;
    }
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.direction === "inbound") {
      return index;
    }
  }
  return -1;
}

export async function queueAiFailureForReview(input: {
  userId: string;
  conversationId: string;
  customerPhone: string;
  question: string;
  aiResponse: string;
  retrievalChunks: number;
}): Promise<{ queued: boolean; signals: string[]; confidenceScore: number; itemId: string | null }> {
  console.log(`[AI-Review] Processing response: "${input.aiResponse.substring(0, 100)}..."`);

  const confidenceScore = estimateConfidenceScore({
    retrievalChunks: input.retrievalChunks,
    aiResponse: input.aiResponse
  });
  const signals = inferFailureSignals({
    retrievalChunks: input.retrievalChunks,
    aiResponse: input.aiResponse,
    confidenceScore
  });

  console.log(`[AI-Review] Failure detection: chunks=${input.retrievalChunks}, confidence=${confidenceScore}, signals=[${signals.join(",")}]`);

  if (signals.length === 0) {
    console.log(`[AI-Review] ❌ No failure signals inferred - response appears normal (confidence=${confidenceScore}%)`);
    console.log(`[AI-Review] Response text: "${input.aiResponse.substring(0, 150)}..."`);
    return { queued: false, signals: [], confidenceScore, itemId: null };
  }

  const queueDecision = shouldQueueFailureForLearning({
    question: input.question,
    aiResponse: input.aiResponse,
    signals
  });
  if (!queueDecision.shouldQueue) {
    console.log(
      `[AI-Review] Queue item skipped by smart filter: reason=${queueDecision.reason}, question="${input.question.substring(0, 80)}..."`
    );
    return { queued: false, signals, confidenceScore, itemId: null };
  }

  console.log(`[AI-Review] Signals detected: ${signals.join(", ")}`);

  const created = await createQueueItem({
    userId: input.userId,
    conversationId: input.conversationId,
    customerPhone: input.customerPhone,
    question: input.question,
    aiResponse: input.aiResponse,
    confidenceScore,
    signals
  });

  return {
    queued: created.created,
    signals,
    confidenceScore,
    itemId: created.itemId
  };
}

export async function queueNegativeFeedbackForReview(input: {
  userId: string;
  conversationId: string;
  customerPhone: string;
  feedbackText: string;
}): Promise<{ queued: boolean; itemId: string | null }> {
  // Check if message contains negative feedback patterns
  if (!isNegativeFeedbackMessage(input.feedbackText)) {
    console.log(`[AI-Review] Feedback message rejected: no negative patterns detected: "${input.feedbackText.substring(0, 80)}..."`);
    return { queued: false, itemId: null };
  }

  console.log(`[AI-Review] Negative feedback detected: "${input.feedbackText.substring(0, 80)}..."`);

  const rows = await listRecentConversationMessages(input.conversationId, 20);
  if (rows.length === 0) {
    console.log(`[AI-Review] No conversation history found for negative feedback (conversation=${input.conversationId})`);
    return { queued: false, itemId: null };
  }

  console.log(`[AI-Review] Found ${rows.length} recent messages in conversation`);

  const anchor = pickFeedbackAnchor(rows, input.feedbackText);
  if (anchor < 0) {
    // Only reject if no inbound message found (-1)
    // Allow index 0 which represents the first message in conversation
    console.log(`[AI-Review] No inbound message anchor found for feedback: "${input.feedbackText}"`);
    return { queued: false, itemId: null };
  }

  console.log(`[AI-Review] Found feedback anchor at message index: ${anchor}`);

  const priorRows = rows.slice(0, anchor);
  const aiResponseRow = [...priorRows].reverse().find((row) => row.direction === "outbound");
  if (!aiResponseRow?.message_text?.trim()) {
    console.log(`[AI-Review] No prior AI response found before feedback`);
    return { queued: false, itemId: null };
  }

  const aiResponseTime = new Date(aiResponseRow.created_at).getTime();
  const questionRow = [...priorRows]
    .reverse()
    .find((row) => row.direction === "inbound" && new Date(row.created_at).getTime() <= aiResponseTime);
  const question = questionRow?.message_text?.trim() || input.feedbackText.trim();
  const aiResponse = aiResponseRow.message_text.trim();

  console.log(`[AI-Review] Creating feedback queue item: question="${question.substring(0, 50)}...", response="${aiResponse.substring(0, 50)}..."`);

  const created = await createQueueItem({
    userId: input.userId,
    conversationId: input.conversationId,
    customerPhone: input.customerPhone,
    question,
    aiResponse,
    confidenceScore: 25,
    signals: ["user_negative_feedback", "low_confidence"]
  });

  return {
    queued: created.created,
    itemId: created.itemId
  };
}

export async function listAiReviewQueue(
  userId: string,
  options?: { status?: "pending" | "resolved" | "all"; limit?: number }
): Promise<AiReviewQueueItem[]> {
  const limit = Math.max(1, Math.min(500, options?.limit ?? 200));
  const status = options?.status ?? "all";

  const result = await pool.query<AiReviewQueueItem>(
    `SELECT
       id,
       user_id,
       conversation_id,
       customer_phone,
       question,
       ai_response,
       confidence_score,
       trigger_signals,
       status,
       resolution_answer,
       resolved_at::text,
       resolved_by,
       created_at::text
     FROM ai_review_queue
     WHERE user_id = $1
       AND ($2::text = 'all' OR status = $2::text)
     ORDER BY
       CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT $3`,
    [userId, status, limit]
  );

  return result.rows.map((row) => ({
    ...row,
    trigger_signals: Array.isArray(row.trigger_signals) ? row.trigger_signals : []
  }));
}

export async function resolveAiReviewQueueItem(input: {
  userId: string;
  reviewId: string;
  resolvedBy: string;
  resolutionAnswer?: string;
  addToKnowledgeBase?: boolean;
}): Promise<{ item: AiReviewQueueItem; knowledgeChunks: number }> {
  const existing = await pool.query<AiReviewQueueItem>(
    `SELECT
       id,
       user_id,
       conversation_id,
       customer_phone,
       question,
       ai_response,
       confidence_score,
       trigger_signals,
       status,
       resolution_answer,
       resolved_at::text,
       resolved_by,
       created_at::text
     FROM ai_review_queue
     WHERE id = $1
       AND user_id = $2
     LIMIT 1`,
    [input.reviewId, input.userId]
  );

  const current = existing.rows[0];
  if (!current) {
    throw new Error("Review item not found.");
  }

  if (current.status === "resolved") {
    return { item: current, knowledgeChunks: 0 };
  }

  const answer = (input.resolutionAnswer ?? "").trim();
  let knowledgeChunks = 0;
  if (input.addToKnowledgeBase) {
    if (answer.length < 8) {
      throw new Error("Resolution answer must be at least 8 characters to add into knowledge base.");
    }

    const textForKb = [
      `Customer question: ${current.question}`,
      `Correct answer: ${answer}`
    ].join("\n");
    knowledgeChunks = await ingestManualText(
      input.userId,
      textForKb,
      `AI Review ${current.customer_phone}`
    );
  }

  const updated = await pool.query<AiReviewQueueItem>(
    `UPDATE ai_review_queue
     SET status = 'resolved',
         resolution_answer = CASE
           WHEN $3::text = '' THEN resolution_answer
           ELSE $3::text
         END,
         resolved_at = NOW(),
         resolved_by = $4
     WHERE id = $1
       AND user_id = $2
     RETURNING
       id,
       user_id,
       conversation_id,
       customer_phone,
       question,
       ai_response,
       confidence_score,
       trigger_signals,
       status,
       resolution_answer,
       resolved_at::text,
       resolved_by,
       created_at::text`,
    [input.reviewId, input.userId, answer, input.resolvedBy]
  );

  return {
    item: updated.rows[0],
    knowledgeChunks
  };
}
