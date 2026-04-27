import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const CannedBodySchema = z.object({
  name:       z.string().trim().min(1).max(100),
  short_code: z.string().trim().min(1).max(50).regex(/^\S+$/, "short_code must have no spaces"),
  content:    z.string().trim().min(1).max(4000)
});

const CannedPatchSchema = z.object({
  name:       z.string().trim().min(1).max(100).optional(),
  short_code: z.string().trim().min(1).max(50).regex(/^\S+$/).optional(),
  content:    z.string().trim().min(1).max(4000).optional()
});

export async function cannedResponsesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/canned-responses",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request) => {
      const result = await pool.query(
        `SELECT id, name, short_code, content, created_at, updated_at
         FROM canned_responses
         WHERE user_id = $1
         ORDER BY name ASC`,
        [request.authUser.userId]
      );
      return { cannedResponses: result.rows };
    }
  );

  fastify.post(
    "/api/canned-responses",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = CannedBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid canned response payload" });

      try {
        const result = await pool.query(
          `INSERT INTO canned_responses (user_id, name, short_code, content)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, short_code, content, created_at, updated_at`,
          [request.authUser.userId, parsed.data.name, parsed.data.short_code.toLowerCase(), parsed.data.content]
        );
        return reply.status(201).send({ cannedResponse: result.rows[0] });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.status(409).send({ error: "Short code already exists" });
        }
        throw err;
      }
    }
  );

  fastify.patch(
    "/api/canned-responses/:id",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CannedPatchSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid payload" });

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (parsed.data.name !== undefined)       { fields.push(`name = $${idx++}`);       values.push(parsed.data.name); }
      if (parsed.data.short_code !== undefined) { fields.push(`short_code = $${idx++}`); values.push(parsed.data.short_code.toLowerCase()); }
      if (parsed.data.content !== undefined)    { fields.push(`content = $${idx++}`);    values.push(parsed.data.content); }
      if (fields.length === 0) return reply.status(400).send({ error: "No fields to update" });

      fields.push(`updated_at = NOW()`);
      values.push(id, request.authUser.userId);
      const result = await pool.query(
        `UPDATE canned_responses SET ${fields.join(", ")} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
        values
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Canned response not found" });
      return { cannedResponse: result.rows[0] };
    }
  );

  fastify.delete(
    "/api/canned-responses/:id",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await pool.query(
        `DELETE FROM canned_responses WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, request.authUser.userId]
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Canned response not found" });
      return { ok: true };
    }
  );
}
