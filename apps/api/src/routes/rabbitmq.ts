import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as amqplib from "amqplib";
import { pool } from "../db/pool.js";
import { encryptJsonPayload } from "../utils/encryption.js";
import { getSessionEncryptionSecret } from "../services/whatsapp-session-store.js";

const RabbitMQSchema = z.object({
  uri: z.string().min(1),
  exchange: z.string().min(1).default("wagen.events"),
  enabled: z.boolean().default(true)
});

export async function rabbitmqRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/rabbitmq",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query(
        `SELECT exchange, enabled
         FROM rabbitmq_configs
         WHERE user_id = $1
         LIMIT 1`,
        [request.authUser.userId]
      );
      const config = result.rows[0];
      if (!config) {
        return null;
      }
      return {
        exchange: config.exchange,
        enabled: config.enabled,
        uri: "amqp://********"
      };
    }
  );

  fastify.put(
    "/api/rabbitmq",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = RabbitMQSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const encryptedUri = encryptJsonPayload(parsed.data.uri, getSessionEncryptionSecret());
      await pool.query(
        `INSERT INTO rabbitmq_configs (user_id, uri, exchange, enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id)
         DO UPDATE SET uri = EXCLUDED.uri,
                       exchange = EXCLUDED.exchange,
                       enabled = EXCLUDED.enabled`,
        [request.authUser.userId, encryptedUri, parsed.data.exchange, parsed.data.enabled]
      );
      return { ok: true };
    }
  );

  fastify.delete(
    "/api/rabbitmq",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      await pool.query(`DELETE FROM rabbitmq_configs WHERE user_id = $1`, [request.authUser.userId]);
      return { ok: true };
    }
  );

  fastify.post(
    "/api/rabbitmq/test",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = RabbitMQSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const connection = (await Promise.race([
          amqplib.connect(parsed.data.uri),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Connection timeout")), 8_000);
          })
        ])) as amqplib.ChannelModel;
        await connection.close();
        return { ok: true };
      } catch (err) {
        return reply.status(502).send({ error: "RabbitMQ unreachable", detail: String(err) });
      }
    }
  );
}
