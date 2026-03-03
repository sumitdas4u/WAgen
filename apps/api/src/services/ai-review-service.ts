import { pool } from "../db/pool.js";
import { listRecentConversationMessages, type ConversationMessageSnapshot } from "./conversation-service.js";
import { ingestManualText } from "./knowledge-ingestion-service.js";

const REVIEW_CONFIDENCE_THRESHOLD = 70;
const DUPLICATE_WINDOW_SECONDS = 6 * 60 * 60;

const FALLBACK_REPLY_PATTERNS = [
  "i'm not sure",
  "i am not sure",
  "i dont know",
  "i don't know",
  "i do not know",
  "do not have that information",
  "don't have that information",
  "i don't have the exact",
  "i do not have the exact",
  "i don't have the exact number",
  "i do not have the exact number",
  "i don't have the exact details",
  "i do not have the exact details",
  "unfortunately, i don't have",
  "unfortunately i don't have",
  "unfortunately i do not have",
  "i appreciate your inquiry",
  "please contact support",
  "unable to find",
  "unable to help",
  "cannot help with that",
  "can't help with that",
  "not familiar with",  // Added to catch "I'm not familiar with Sujay"
  "i'm not familiar",
  "i am not familiar"
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
  return includesPattern(aiResponse, FALLBACK_REPLY_PATTERNS);
}

function isNegativeFeedbackMessage(message: string): boolean {
  return includesPattern(message, NEGATIVE_FEEDBACK_PATTERNS);
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
  const normalizedAiResponse = normalizeText(input.aiResponse);

  // Only check for duplicate by question within 6 hour window
  // Different responses to same question should each be tracked
  // This prevents losing unique AI failure patterns
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM ai_review_queue
     WHERE user_id = $1
       AND conversation_id = $2
       AND status = 'pending'
       AND created_at >= NOW() - ($4::text || ' seconds')::interval
       AND trim(regexp_replace(lower(question), '[^a-z0-9]+', ' ', 'g')) = $3
     LIMIT 1`,
    [
      input.userId,
      input.conversationId,
      normalizedQuestion,
      String(DUPLICATE_WINDOW_SECONDS)
    ]
  );

  const isDuplicate = result.rows[0]?.id ?? null;
  if (isDuplicate) {
    console.log(`[AI-Review] Found duplicate question (6hr window): existing_id=${isDuplicate}, question="${input.question.substring(0, 50)}..."`);
  }

  return isDuplicate;
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
    console.log(`[AI-Review] Queue item rejected: duplicate found (existing_id=${duplicateId})`);
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
    console.log(`[AI-Review] No failure signals inferred - response appears normal (confidence=${confidenceScore})`);
    return { queued: false, signals: [], confidenceScore, itemId: null };
  }

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
