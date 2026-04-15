import { pool } from "../db/pool.js";
import { listRecentConversationMessages, type ConversationMessageSnapshot } from "./conversation-service.js";
import { ingestManualText } from "./knowledge-ingestion-service.js";

const DUPLICATE_WINDOW_SECONDS = 6 * 60 * 60;

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
  recurrence_count: number;
}

export interface AiReviewAuditLogItem {
  id: string;
  user_id: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  triage_category: "noise" | "monitor";
  dismiss_reason: string;
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
  recurrenceCount?: number;
  skipQuestionFilter?: boolean;
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

// ─── New severity-classified pattern arrays ────────────────────────────────

const STRONG_UNKNOWN_PATTERNS = [
  "i don't know", "i do not know", "i'm not sure", "i am not sure",
  "i don't have", "i do not have", "not familiar with",
  "unable to find", "unable to help", "cannot help with that", "can't help with that",
  "no information available", "not in my system", "not in my knowledge",
  "i am not familiar", "i'm not familiar"
];

const FALLBACK_PATTERNS = [
  "please contact support", "contact support", "reach out to",
  "i appreciate your", "unfortunately, i don't have", "unfortunately i don't have",
  "unfortunately i do not have",
  "i'm sorry, but i can't", "i am sorry, but i can't", "i'm sorry but i can't",
  "sorry but i can't", "sorry i can't", "sorry i don't",
  "i'm unable to", "i am unable to",
  "please reach out", "contact our team", "reach out to our team",
  "contact the team", "get in touch with support",
  "afraid i cannot", "afraid i can't", "regret i cannot", "regret i can't"
];

const CLARIFICATION_PATTERNS = [
  "please clarify", "could you clarify", "could you provide more details",
  "please provide more details", "please share more details",
  "could you share more details", "which one", "what exactly",
  "can you be more specific"
];

export type ResponseSeverity = "strong_unknown" | "fallback" | "clarification";

export function detectResponseSeverity(aiResponse: string): ResponseSeverity | null {
  if (includesPattern(aiResponse, STRONG_UNKNOWN_PATTERNS)) return "strong_unknown";
  if (includesPattern(aiResponse, FALLBACK_PATTERNS)) return "fallback";
  if (includesPattern(aiResponse, CLARIFICATION_PATTERNS)) return "clarification";
  return null;
}

export function estimateConfidenceScore(input: {
  retrievalChunks: number;
  severity: ResponseSeverity | null;
  hasNegativeFeedback?: boolean;
}): number {
  const chunks = Math.max(0, Number(input.retrievalChunks || 0));
  const chunkFactor = chunks === 0 ? -20 : chunks === 1 ? 0 : chunks === 2 ? 8 : 15;
  const severityPenalty =
    input.severity === "strong_unknown" ? -30 :
    input.severity === "fallback" ? -15 :
    input.severity === "clarification" ? -5 : 0;
  const feedbackPenalty = input.hasNegativeFeedback ? -25 : 0;
  return clampConfidence(50 + chunkFactor + severityPenalty + feedbackPenalty);
}

export function triageCategory(score: number): "noise" | "monitor" | "review" {
  if (score >= 60) return "noise";
  if (score >= 35) return "monitor";
  return "review";
}

function isNegativeFeedbackMessage(message: string): boolean {
  return includesPattern(message, NEGATIVE_FEEDBACK_PATTERNS);
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


function inferFailureSignals(input: {
  retrievalChunks: number;
  severity: ResponseSeverity | null;
  confidenceScore: number;
  recurrenceCount?: number;
}): string[] {
  const signals: string[] = [];
  if (input.retrievalChunks === 0) signals.push("no_knowledge_match");
  if (input.severity === "strong_unknown" || input.severity === "fallback") {
    signals.push("fallback_response");
  }
  if (input.confidenceScore < 35) signals.push("low_confidence");
  if ((input.recurrenceCount ?? 0) > 0) signals.push("kb_not_effective");
  return Array.from(new Set(signals));
}

async function checkPriorResolutions(input: {
  userId: string;
  conversationId: string;
  question: string;
  severity: ResponseSeverity | null;
}): Promise<{ skipQueue: boolean; recurrenceCount: number; duplicateId: string | null }> {
  const normalizedQuestion = normalizeText(input.question);

  // Check resolved items in the last 24 hours for the same question
  const resolved = await pool.query<{ id: string; question: string; recurrence_count: number }>(
    `SELECT id, question, recurrence_count
     FROM ai_review_queue
     WHERE user_id = $1
       AND status = 'resolved'
       AND created_at >= NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 50`,
    [input.userId]
  );

  const matchingResolved = resolved.rows.filter(
    (row) => normalizeText(row.question) === normalizedQuestion
  );

  if (matchingResolved.length > 0) {
    const hasStrongFailure =
      input.severity === "strong_unknown" || input.severity === "fallback";

    if (!hasStrongFailure) {
      // KB is working — question came back but AI answered well enough
      console.log(`[AI-Review] KB effective — skipping queue for: "${input.question.substring(0, 60)}..."`);
      return { skipQueue: true, recurrenceCount: 0, duplicateId: matchingResolved[0].id };
    }

    // KB not effective — same question still failing, increment recurrence
    const maxRecurrence = Math.max(...matchingResolved.map((r) => r.recurrence_count));
    console.log(`[AI-Review] Recurring failure (recurrence_count=${maxRecurrence + 1}): "${input.question.substring(0, 60)}..."`);
    return { skipQueue: false, recurrenceCount: maxRecurrence + 1, duplicateId: null };
  }

  // No resolved history — check for pending duplicate in same conversation (6-hour window)
  const pending = await pool.query<{ id: string; question: string }>(
    `SELECT id, question
     FROM ai_review_queue
     WHERE user_id = $1
       AND conversation_id = $2
       AND status = 'pending'
       AND created_at >= NOW() - ($3::text || ' seconds')::interval
     ORDER BY created_at DESC
     LIMIT 10`,
    [input.userId, input.conversationId, String(DUPLICATE_WINDOW_SECONDS)]
  );

  for (const row of pending.rows) {
    if (normalizeText(row.question) === normalizedQuestion) {
      console.log(`[AI-Review] Pending duplicate found: existing_id=${row.id}`);
      return { skipQueue: true, recurrenceCount: 0, duplicateId: row.id };
    }
  }

  return { skipQueue: false, recurrenceCount: 0, duplicateId: null };
}

async function writeAuditLog(input: {
  userId: string;
  question: string;
  aiResponse: string;
  confidenceScore: number;
  triageCategory: "noise" | "monitor";
  dismissReason: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ai_review_audit_log
       (user_id, question, ai_response, confidence_score, triage_category, dismiss_reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.userId,
      input.question,
      input.aiResponse,
      input.confidenceScore,
      input.triageCategory,
      input.dismissReason
    ]
  );
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

  if (!input.skipQuestionFilter) {
    const questionRejection = getQuestionRejectionReason(question);
    if (questionRejection) {
      console.log(
        `[AI-Review] Queue item rejected: question filtered as irrelevant (reason=${questionRejection}, conversation=${input.conversationId})`
      );
      return { created: false, itemId: null };
    }
  }

  if (input.signals.length === 0) {
    console.log(`[AI-Review] Queue item rejected: no trigger signals detected (conversation=${input.conversationId})`);
    console.log(`  Question: "${question.substring(0, 100)}..."`);
    console.log(`  AI Response: "${aiResponse.substring(0, 100)}..."`);
    return { created: false, itemId: null };
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO ai_review_queue (
       user_id,
       conversation_id,
       customer_phone,
       question,
       ai_response,
       confidence_score,
       trigger_signals,
       recurrence_count
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
     RETURNING id`,
    [
      input.userId,
      input.conversationId,
      input.customerPhone,
      question,
      aiResponse,
      clampConfidence(input.confidenceScore),
      input.signals,
      input.recurrenceCount ?? 0
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
  // Step 1: Question quality filter
  const questionRejection = getQuestionRejectionReason(input.question.trim());
  if (questionRejection) {
    console.log(`[AI-Review] Question filtered: reason=${questionRejection}`);
    return { queued: false, signals: [], confidenceScore: 0, itemId: null };
  }

  // Step 2: Score and triage
  const severity = detectResponseSeverity(input.aiResponse);
  const confidenceScore = estimateConfidenceScore({ retrievalChunks: input.retrievalChunks, severity });
  const category = triageCategory(confidenceScore);

  console.log(`[AI-Review] Triage: chunks=${input.retrievalChunks}, severity=${severity ?? "none"}, score=${confidenceScore}, category=${category}`);

  if (category === "noise" || category === "monitor") {
    await writeAuditLog({
      userId: input.userId,
      question: input.question,
      aiResponse: input.aiResponse,
      confidenceScore,
      triageCategory: category,
      dismissReason: `score_${confidenceScore}_${category}_threshold`
    });
    console.log(`[AI-Review] Auto-dismissed (${category}): score=${confidenceScore}`);
    return { queued: false, signals: [], confidenceScore, itemId: null };
  }

  // Step 3: Learning loop
  const priorCheck = await checkPriorResolutions({
    userId: input.userId,
    conversationId: input.conversationId,
    question: input.question,
    severity
  });

  if (priorCheck.skipQueue) {
    return { queued: false, signals: [], confidenceScore, itemId: priorCheck.duplicateId };
  }

  const signals = inferFailureSignals({
    retrievalChunks: input.retrievalChunks,
    severity,
    confidenceScore,
    recurrenceCount: priorCheck.recurrenceCount
  });

  const created = await createQueueItem({
    userId: input.userId,
    conversationId: input.conversationId,
    customerPhone: input.customerPhone,
    question: input.question,
    aiResponse: input.aiResponse,
    confidenceScore,
    signals,
    recurrenceCount: priorCheck.recurrenceCount
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

export async function queueFlowIssueForReview(input: {
  userId: string;
  conversationId: string;
  customerPhone: string;
  messageText: string;
  issue: "flow_execution_failed" | "no_matching_flow";
  details: string;
}): Promise<{ queued: boolean; itemId: string | null }> {
  const question =
    input.messageText.trim() ||
    (input.issue === "no_matching_flow" ? "[No matching flow]" : "[Flow execution failed]");

  const created = await createQueueItem({
    userId: input.userId,
    conversationId: input.conversationId,
    customerPhone: input.customerPhone,
    question,
    aiResponse: input.details.trim(),
    confidenceScore: input.issue === "no_matching_flow" ? 20 : 10,
    signals:
      input.issue === "no_matching_flow"
        ? ["no_matching_flow", "flow_setup_required"]
        : ["flow_execution_failed", "flow_runtime_error"],
    skipQuestionFilter: true
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
       recurrence_count,
       created_at::text
     FROM ai_review_queue
     WHERE user_id = $1
       AND ($2::text = 'all' OR status = $2::text)
     ORDER BY
       CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
       CASE WHEN status = 'pending' THEN recurrence_count ELSE 0 END DESC,
       created_at DESC
     LIMIT $3`,
    [userId, status, limit]
  );

  return result.rows.map((row) => ({
    ...row,
    trigger_signals: Array.isArray(row.trigger_signals) ? row.trigger_signals : [],
    recurrence_count: row.recurrence_count ?? 0
  }));
}

export async function listAiReviewAuditLog(
  userId: string,
  options?: { limit?: number }
): Promise<AiReviewAuditLogItem[]> {
  const limit = Math.max(1, Math.min(500, options?.limit ?? 100));
  const result = await pool.query<AiReviewAuditLogItem>(
    `SELECT id, user_id, question, ai_response, confidence_score,
            triage_category, dismiss_reason, created_at::text
     FROM ai_review_audit_log
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
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
