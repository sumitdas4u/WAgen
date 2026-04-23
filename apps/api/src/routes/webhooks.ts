import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { encryptJsonPayload } from "../utils/encryption.js";
import { getSessionEncryptionSecret } from "../services/whatsapp-session-store.js";

const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().min(8).optional(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().default(true)
});

const UpdateWebhookSchema = CreateWebhookSchema.partial();

function sanitizeWebhookRow(row: Record<string, unknown>) {
  return {
    ...row,
    secret: row.secret ? "********" : null
  };
}

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query(
        `SELECT id, name, url, secret, events, enabled, created_at, updated_at
         FROM webhook_endpoints
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [request.authUser.userId]
      );
      return result.rows.map((row) => sanitizeWebhookRow(row));
    }
  );

  fastify.post(
    "/api/webhooks",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const encryptedSecret = parsed.data.secret
        ? encryptJsonPayload(parsed.data.secret, getSessionEncryptionSecret())
        : null;

      const result = await pool.query(
        `INSERT INTO webhook_endpoints (user_id, name, url, secret, events, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, url, secret, events, enabled, created_at, updated_at`,
        [
          request.authUser.userId,
          parsed.data.name,
          parsed.data.url,
          encryptedSecret,
          parsed.data.events,
          parsed.data.enabled
        ]
      );
      return reply.status(201).send(sanitizeWebhookRow(result.rows[0]));
    }
  );

  fastify.put(
    "/api/webhooks/:id",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const existing = await pool.query(
        `SELECT id, secret
         FROM webhook_endpoints
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [id, request.authUser.userId]
      );
      if (!existing.rows[0]) {
        return reply.status(404).send({ error: "Not found" });
      }

      const secret =
        parsed.data.secret === undefined
          ? existing.rows[0].secret
          : parsed.data.secret
            ? encryptJsonPayload(parsed.data.secret, getSessionEncryptionSecret())
            : null;

      const result = await pool.query(
        `UPDATE webhook_endpoints
         SET name = COALESCE($3, name),
             url = COALESCE($4, url),
             secret = $5,
             events = COALESCE($6, events),
             enabled = COALESCE($7, enabled)
         WHERE id = $1 AND user_id = $2
         RETURNING id, name, url, secret, events, enabled, created_at, updated_at`,
        [id, request.authUser.userId, parsed.data.name, parsed.data.url, secret, parsed.data.events, parsed.data.enabled]
      );
      return sanitizeWebhookRow(result.rows[0]);
    }
  );

  fastify.delete(
    "/api/webhooks/:id",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await pool.query(
        `DELETE FROM webhook_endpoints
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [id, request.authUser.userId]
      );
      if (!result.rows[0]) {
        return reply.status(404).send({ error: "Not found" });
      }
      return { ok: true };
    }
  );

  fastify.get(
    "/api/webhooks/:id/logs",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit, offset } = request.query as { limit?: string; offset?: string };

      const existing = await pool.query(
        `SELECT id
         FROM webhook_endpoints
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [id, request.authUser.userId]
      );
      if (!existing.rows[0]) {
        return reply.status(404).send({ error: "Not found" });
      }

      const result = await pool.query(
        `SELECT id, endpoint_id, event, payload, status_code, attempt, success, error_message, delivered_at
         FROM webhook_delivery_logs
         WHERE endpoint_id = $1
         ORDER BY delivered_at DESC
         LIMIT $2
         OFFSET $3`,
        [id, Math.min(Number(limit ?? 50), 200), Number(offset ?? 0)]
      );
      return result.rows;
    }
  );
}
