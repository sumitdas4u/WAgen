import { pool } from "../db/pool.js";

export type InsightType = "lead" | "complaint" | "feedback";
export type InsightSentiment = "positive" | "neutral" | "negative" | "angry" | "frustrated";
export type InsightStatus = "open" | "resolved" | "pending";

export interface UpsertInsightParams {
  type: InsightType;
  summary: string;
  sentiment: InsightSentiment | null;
  priority_score: number;
  status: InsightStatus;
}

export async function upsertConversationInsight(
  conversationId: string,
  userId: string,
  params: UpsertInsightParams
): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_insights
       (conversation_id, user_id, type, summary, sentiment, priority_score, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (conversation_id) DO UPDATE SET
       type           = EXCLUDED.type,
       summary        = EXCLUDED.summary,
       sentiment      = EXCLUDED.sentiment,
       priority_score = EXCLUDED.priority_score,
       status         = EXCLUDED.status,
       updated_at     = NOW()`,
    [
      conversationId,
      userId,
      params.type,
      params.summary,
      params.sentiment,
      params.priority_score,
      params.status
    ]
  );
}

export function deriveSentiment(
  type: InsightType,
  score: number
): InsightSentiment | null {
  if (type === "lead") return null;
  if (type === "complaint") {
    return score < 40 ? "angry" : "frustrated";
  }
  // feedback
  return score >= 50 ? "positive" : "negative";
}
