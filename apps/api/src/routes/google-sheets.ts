import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildGoogleSheetsConnectUrl,
  completeGoogleSheetsOAuthCallback,
  disconnectGoogleSheetsConnection,
  getGoogleSheetsConfig,
  getGoogleSheetsConnectionInfo,
  getGoogleSheetsStatus,
  listGoogleSheetColumns,
  listGoogleSheetsSpreadsheets,
  listGoogleSpreadsheetSheets,
  renderGoogleSheetsOauthPopupPage
} from "../services/google-sheets-service.js";

const DisconnectSchema = z.object({
  connectionId: z.string().uuid().optional()
});

const ConnectionQuerySchema = z.object({
  connectionId: z.string().uuid().optional()
});

const ColumnsQuerySchema = z.object({
  connectionId: z.string().uuid().optional(),
  sheetTitle: z.string().trim().min(1)
});

const CallbackQuerySchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  error: z.string().trim().optional(),
  error_description: z.string().trim().optional()
});

export async function googleSheetsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/google/sheets/config",
    { preHandler: [app.requireAuth] },
    async () => getGoogleSheetsConfig()
  );

  app.get(
    "/api/google/sheets/status",
    { preHandler: [app.requireAuth] },
    async (request) => getGoogleSheetsStatus(request.authUser.userId)
  );

  app.get(
    "/api/google/sheets/connect/start",
    { preHandler: [app.requireAuth] },
    async (request) => ({
      url: buildGoogleSheetsConnectUrl(request.authUser.userId)
    })
  );

  app.get("/api/google/sheets/connect/callback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = CallbackQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleSheetsOauthPopupPage({
            status: "error",
            message: "Google Sheets callback payload is invalid."
          })
        );
    }

    if (parsed.data.error) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleSheetsOauthPopupPage({
            status: "error",
            message: parsed.data.error_description || parsed.data.error
          })
        );
    }

    if (!parsed.data.code || !parsed.data.state) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleSheetsOauthPopupPage({
            status: "error",
            message: "Missing Google authorization code or state."
          })
        );
    }

    try {
      const connection = await completeGoogleSheetsOAuthCallback({
        code: parsed.data.code,
        state: parsed.data.state
      });
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleSheetsOauthPopupPage({
            status: "success",
            message: `Connected as ${connection.googleEmail}.`
          })
        );
    } catch (error) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleSheetsOauthPopupPage({
            status: "error",
            message: (error as Error).message
          })
        );
    }
  });

  app.post(
    "/api/google/sheets/disconnect",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const parsed = DisconnectSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid disconnect payload" });
      }

      const ok = await disconnectGoogleSheetsConnection(
        request.authUser.userId,
        parsed.data.connectionId
      );
      return { ok };
    }
  );

  app.get(
    "/api/google/sheets/spreadsheets",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const parsed = ConnectionQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid connection query" });
      }

      const spreadsheets = await listGoogleSheetsSpreadsheets({
        userId: request.authUser.userId,
        connectionId: parsed.data.connectionId
      });
      return { spreadsheets };
    }
  );

  app.get(
    "/api/google/sheets/spreadsheets/:spreadsheetId/sheets",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const parsed = ConnectionQuerySchema.safeParse(request.query ?? {});
      const spreadsheetId = z.string().trim().min(1).safeParse(
        (request.params as { spreadsheetId?: string }).spreadsheetId
      );
      if (!parsed.success || !spreadsheetId.success) {
        return reply.status(400).send({ error: "Invalid spreadsheet request" });
      }

      const sheets = await listGoogleSpreadsheetSheets({
        userId: request.authUser.userId,
        connectionId: parsed.data.connectionId,
        spreadsheetId: spreadsheetId.data
      });
      return { sheets };
    }
  );

  app.get(
    "/api/google/sheets/spreadsheets/:spreadsheetId/columns",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const parsed = ColumnsQuerySchema.safeParse(request.query ?? {});
      const spreadsheetId = z.string().trim().min(1).safeParse(
        (request.params as { spreadsheetId?: string }).spreadsheetId
      );
      if (!parsed.success || !spreadsheetId.success) {
        return reply.status(400).send({ error: "Invalid sheet column request" });
      }

      const columns = await listGoogleSheetColumns({
        userId: request.authUser.userId,
        connectionId: parsed.data.connectionId,
        spreadsheetId: spreadsheetId.data,
        sheetTitle: parsed.data.sheetTitle
      });
      return { columns };
    }
  );

  // Get connection info by ID — lets any user see who owns a stored connectionId
  app.get(
    "/api/google/sheets/connections/:id",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const id = (request.params as { id?: string }).id ?? "";
      if (!id) return reply.status(400).send({ error: "Missing connection id" });
      const connection = await getGoogleSheetsConnectionInfo(id);
      return { connection };
    }
  );
}
