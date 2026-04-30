import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";

export async function agentNotificationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/agent-notifications",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      const query = request.query as { unread?: string; limit?: string };
      const onlyUnread = query.unread === "true";
      const limit = Math.min(parseInt(query.limit ?? "50", 10) || 50, 200);

      const result = await pool.query(
        `SELECT id, type, conversation_id, actor_name, body, read_at, created_at
         FROM agent_notifications
         WHERE user_id = $1
           ${onlyUnread ? "AND read_at IS NULL" : ""}
         ORDER BY created_at DESC
         LIMIT $2`,
        [request.authUser.userId, limit]
      );

      const unreadCount = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM agent_notifications WHERE user_id = $1 AND read_at IS NULL`,
        [request.authUser.userId]
      );

      return {
        notifications: result.rows,
        unreadCount: parseInt(unreadCount.rows[0]?.count ?? "0", 10)
      };
    }
  );

  fastify.post(
    "/api/agent-notifications/:id/read",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await pool.query(
        `UPDATE agent_notifications
         SET read_at = COALESCE(read_at, NOW())
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [id, request.authUser.userId]
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Notification not found" });
      return { ok: true };
    }
  );

  fastify.post(
    "/api/agent-notifications/read-all",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      await pool.query(
        `UPDATE agent_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
        [request.authUser.userId]
      );
      return { ok: true };
    }
  );
}
