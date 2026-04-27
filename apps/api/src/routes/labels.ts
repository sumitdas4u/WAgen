import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const LabelBodySchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#6366f1")
});

const LabelPatchSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});

export async function labelRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/labels",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      const result = await pool.query(
        `SELECT id, user_id, name, color, created_at FROM labels WHERE user_id = $1 ORDER BY name ASC`,
        [request.authUser.userId]
      );
      return { labels: result.rows };
    }
  );

  fastify.post(
    "/api/labels",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = LabelBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid label payload" });

      try {
        const result = await pool.query(
          `INSERT INTO labels (user_id, name, color) VALUES ($1, $2, $3) RETURNING *`,
          [request.authUser.userId, parsed.data.name, parsed.data.color]
        );
        return reply.status(201).send({ label: result.rows[0] });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.status(409).send({ error: "Label name already exists" });
        }
        throw err;
      }
    }
  );

  fastify.patch(
    "/api/labels/:labelId",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { labelId } = request.params as { labelId: string };
      const parsed = LabelPatchSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid label payload" });

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
      if (parsed.data.color !== undefined) { fields.push(`color = $${idx++}`); values.push(parsed.data.color); }
      if (fields.length === 0) return reply.status(400).send({ error: "No fields to update" });

      values.push(labelId, request.authUser.userId);
      const result = await pool.query(
        `UPDATE labels SET ${fields.join(", ")} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
        values
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Label not found" });
      return { label: result.rows[0] };
    }
  );

  fastify.delete(
    "/api/labels/:labelId",
    { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { labelId } = request.params as { labelId: string };
      const result = await pool.query(
        `DELETE FROM labels WHERE id = $1 AND user_id = $2 RETURNING id`,
        [labelId, request.authUser.userId]
      );
      if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: "Label not found" });
      return { ok: true };
    }
  );
}
