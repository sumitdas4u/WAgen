import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool.js";
import { fetchDailyReportData, type DailyReportSnapshot } from "../services/daily-report-data-service.js";

interface DailyReportRow {
  id: string;
  report_date: string;
  snapshot: DailyReportSnapshot;
}

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/reports/daily/today",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return fetchDailyReportData(request.authUser.userId, start);
    }
  );

  fastify.get(
    "/api/reports/daily",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const result = await pool.query<DailyReportRow>(
        `SELECT id, report_date, snapshot
         FROM daily_reports
         WHERE user_id = $1
         ORDER BY report_date DESC
         LIMIT 30`,
        [request.authUser.userId]
      );
      return {
        reports: result.rows.map((r) => ({
          id: r.id,
          reportDate: r.report_date,
          snapshot: r.snapshot
        }))
      };
    }
  );
}
