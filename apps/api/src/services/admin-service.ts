import { pool } from "../db/pool.js";

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
  const [usersResult, conversationsResult, messagesResult, chunksResult, tokensResult] = await Promise.all([
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
    pool.query<{ total_tokens: string; total_cost_inr: string }>(
      `SELECT COALESCE(SUM(total_tokens), 0)::text AS total_tokens,
              COALESCE(SUM(
                CASE
                  WHEN ai_model LIKE 'gpt-4%' THEN (COALESCE(prompt_tokens,0) / 1000.0) * 0.01 + (COALESCE(completion_tokens,0) / 1000.0) * 0.03
                  ELSE (COALESCE(prompt_tokens,0) / 1000.0) * 0.00015 + (COALESCE(completion_tokens,0) / 1000.0) * 0.0006
                END
              ) * 83, 0)::text AS total_cost_inr
       FROM conversation_messages
       WHERE direction = 'outbound'`
    )
  ]);

  return {
    totalUsers: Number(usersResult.rows[0]?.total_users ?? 0),
    activeAgents: Number(usersResult.rows[0]?.active_agents ?? 0),
    totalConversations: Number(conversationsResult.rows[0]?.total_conversations ?? 0),
    totalMessages: Number(messagesResult.rows[0]?.total_messages ?? 0),
    totalChunks: Number(chunksResult.rows[0]?.total_chunks ?? 0),
    totalTokens: Number(tokensResult.rows[0]?.total_tokens ?? 0),
    totalCostInr: Number(tokensResult.rows[0]?.total_cost_inr ?? 0)
  };
}

export async function listAdminUserUsage(limit = 200): Promise<AdminUserUsage[]> {
  const clampedLimit = Math.max(1, Math.min(500, limit));
  const result = await pool.query<{
    user_id: string;
    name: string;
    email: string;
    plan: string;
    ai_active: boolean;
    conversations: string;
    messages: string;
    chunks: string;
    total_tokens: string;
    cost_inr: string;
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
       COALESCE(t.total_tokens, 0)::text AS total_tokens,
       COALESCE(t.cost_inr, 0)::text AS cost_inr,
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
     LEFT JOIN (
       SELECT
         c.user_id,
         COALESCE(SUM(m.total_tokens), 0) AS total_tokens,
         COALESCE(SUM(
           CASE
             WHEN m.ai_model LIKE 'gpt-4%' THEN (COALESCE(m.prompt_tokens,0) / 1000.0) * 0.01 + (COALESCE(m.completion_tokens,0) / 1000.0) * 0.03
             ELSE (COALESCE(m.prompt_tokens,0) / 1000.0) * 0.00015 + (COALESCE(m.completion_tokens,0) / 1000.0) * 0.0006
           END
         ) * 83, 0) AS cost_inr
       FROM conversation_messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.direction = 'outbound'
       GROUP BY c.user_id
     ) t ON t.user_id = u.id
     ORDER BY u.created_at DESC
     LIMIT $1`,
    [clampedLimit]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    aiActive: row.ai_active,
    conversations: Number(row.conversations),
    messages: Number(row.messages),
    chunks: Number(row.chunks),
    totalTokens: Number(row.total_tokens),
    costInr: Number(row.cost_inr),
    createdAt: row.created_at
  }));
}
