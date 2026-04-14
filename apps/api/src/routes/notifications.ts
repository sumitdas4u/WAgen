import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const UpdateNotificationSettingsSchema = z.object({
  dailyReportEnabled: z.boolean()
});

export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/notifications/settings",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query<{ daily_report_enabled: boolean }>(
        "SELECT daily_report_enabled FROM users WHERE id = $1",
        [request.authUser.userId]
      );
      const row = result.rows[0];
      return { dailyReportEnabled: row?.daily_report_enabled ?? false };
    }
  );

  fastify.patch(
    "/api/notifications/settings",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = UpdateNotificationSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload" });
      }
      await pool.query(
        "UPDATE users SET daily_report_enabled = $1 WHERE id = $2",
        [parsed.data.dailyReportEnabled, request.authUser.userId]
      );
      return { dailyReportEnabled: parsed.data.dailyReportEnabled };
    }
  );
}
