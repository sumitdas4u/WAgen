import { pool } from "../db/pool.js";
import { estimateInrCost } from "./usage-cost-service.js";

export interface AdminOverview {
  totalUsers: number;
  activeAgents: number;
  totalConversations: number;
  totalMessages: number;
  totalChunks: number;
  totalTokens: number;
  totalCostInr: number;
}

export interface AdminUserUsage {
  userId: string;
  name: string;
  email: string;
  plan: string;
  aiActive: boolean;
  conversations: number;
  messages: number;
  chunks: number;
  totalTokens: number;
  costInr: number;
  createdAt: string;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [usersResult, conversationsResult, messagesResult, chunksResult, usageByModelResult] = await Promise.all([
    pool.query<{ total_users: string; active_agents: string }>(
      `SELECT COUNT(*)::text AS total_users,
              COUNT(*) FILTER (WHERE ai_active = true)::text AS active_agents
       FROM users`
    ),
    pool.query<{ total_conversations: string }>(
      `SELECT COUNT(*)::text AS total_conversations FROM conversations`
    ),
    pool.query<{ total_messages: string }>(
      `SELECT COUNT(*)::text AS total_messages FROM conversation_messages`
    ),
    pool.query<{ total_chunks: string }>(
      `SELECT COUNT(*)::text AS total_chunks FROM knowledge_base`
    ),
    pool.query<{ ai_model: string | null; prompt_tokens: string; completion_tokens: string; total_tokens: string }>(
      `SELECT
         ai_model,
         COALESCE(SUM(COALESCE(prompt_tokens, 0)), 0)::text AS prompt_tokens,
         COALESCE(SUM(COALESCE(completion_tokens, 0)), 0)::text AS completion_tokens,
         COALESCE(
           SUM(COALESCE(total_tokens, COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))),
           0
         )::text AS total_tokens
       FROM conversation_messages
       WHERE direction = 'outbound'
       GROUP BY ai_model`
    )
  ]);

  const usageTotals = usageByModelResult.rows.reduce(
    (acc, row) => {
      const promptTokens = Number(row.prompt_tokens ?? 0);
      const completionTokens = Number(row.completion_tokens ?? 0);
      const totalTokens = Number(row.total_tokens ?? 0);
      acc.totalTokens += totalTokens;
      acc.totalCostInr += estimateInrCost(row.ai_model, promptTokens, completionTokens);
      return acc;
    },
    { totalTokens: 0, totalCostInr: 0 }
  );

  return {
    totalUsers: Number(usersResult.rows[0]?.total_users ?? 0),
    activeAgents: Number(usersResult.rows[0]?.active_agents ?? 0),
    totalConversations: Number(conversationsResult.rows[0]?.total_conversations ?? 0),
    totalMessages: Number(messagesResult.rows[0]?.total_messages ?? 0),
    totalChunks: Number(chunksResult.rows[0]?.total_chunks ?? 0),
    totalTokens: usageTotals.totalTokens,
    totalCostInr: usageTotals.totalCostInr
  };
}

export async function listAdminUserUsage(limit = 200): Promise<AdminUserUsage[]> {
  const clampedLimit = Math.max(1, Math.min(500, limit));
  const usersResult = await pool.query<{
    user_id: string;
    name: string;
    email: string;
    plan: string;
    ai_active: boolean;
    conversations: string;
    messages: string;
    chunks: string;
    created_at: string;
  }>(
    `SELECT
       u.id AS user_id,
       u.name,
       u.email,
       u.subscription_plan AS plan,
       u.ai_active,
       COALESCE(c.conversations, 0)::text AS conversations,
       COALESCE(m.messages, 0)::text AS messages,
       COALESCE(k.chunks, 0)::text AS chunks,
       u.created_at
     FROM users u
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS conversations
       FROM conversations
       GROUP BY user_id
     ) c ON c.user_id = u.id
     LEFT JOIN (
       SELECT c.user_id, COUNT(*) AS messages
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       GROUP BY c.user_id
     ) m ON m.user_id = u.id
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS chunks
       FROM knowledge_base
       GROUP BY user_id
     ) k ON k.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT $1`,
    [clampedLimit]
  );

  const userIds = usersResult.rows.map((row) => row.user_id);
  const usageByUser = new Map<string, { totalTokens: number; costInr: number }>();

  if (userIds.length > 0) {
    const usageResult = await pool.query<{
      user_id: string;
      ai_model: string | null;
      prompt_tokens: string;
      completion_tokens: string;
      total_tokens: string;
    }>(
      `SELECT
         c.user_id::text AS user_id,
         m.ai_model,
         COALESCE(SUM(COALESCE(m.prompt_tokens, 0)), 0)::text AS prompt_tokens,
         COALESCE(SUM(COALESCE(m.completion_tokens, 0)), 0)::text AS completion_tokens,
         COALESCE(
           SUM(COALESCE(m.total_tokens, COALESCE(m.prompt_tokens, 0) + COALESCE(m.completion_tokens, 0))),
           0
         )::text AS total_tokens
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.direction = 'outbound'
         AND c.user_id::text = ANY($1::text[])
       GROUP BY c.user_id, m.ai_model`,
      [userIds]
    );

    for (const row of usageResult.rows) {
      const promptTokens = Number(row.prompt_tokens ?? 0);
      const completionTokens = Number(row.completion_tokens ?? 0);
      const totalTokens = Number(row.total_tokens ?? 0);
      const userUsage = usageByUser.get(row.user_id) ?? { totalTokens: 0, costInr: 0 };
      userUsage.totalTokens += totalTokens;
      userUsage.costInr += estimateInrCost(row.ai_model, promptTokens, completionTokens);
      usageByUser.set(row.user_id, userUsage);
    }
  }

  return usersResult.rows.map((row) => {
    const usage = usageByUser.get(row.user_id) ?? { totalTokens: 0, costInr: 0 };
    return {
    userId: row.user_id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    aiActive: row.ai_active,
    conversations: Number(row.conversations),
    messages: Number(row.messages),
    chunks: Number(row.chunks),
    totalTokens: usage.totalTokens,
    costInr: usage.costInr,
    createdAt: row.created_at
    };
  });
}
