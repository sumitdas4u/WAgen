import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildGoogleCalendarConnectUrl,
  completeGoogleCalendarOAuthCallback,
  disconnectGoogleCalendarConnection,
  getGoogleCalendarConfig,
  getGoogleCalendarStatus,
  listGoogleCalendars,
  renderGoogleCalendarOauthPopupPage
} from "../services/google-calendar-service.js";

const DisconnectSchema = z.object({
  connectionId: z.string().uuid().optional()
});

const ConnectionQuerySchema = z.object({
  connectionId: z.string().uuid().optional()
});

const CallbackQuerySchema = z.object({
  code: z.string().trim().optional(),
  state: z.string().trim().optional(),
  error: z.string().trim().optional(),
  error_description: z.string().trim().optional()
});

export async function googleCalendarRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/google/calendar/config",
    { preHandler: [app.requireAuth] },
    async () => getGoogleCalendarConfig()
  );

  app.get(
    "/api/google/calendar/status",
    { preHandler: [app.requireAuth] },
    async (request) => getGoogleCalendarStatus(request.authUser.userId)
  );

  app.get(
    "/api/google/calendar/connect/start",
    { preHandler: [app.requireAuth] },
    async (request) => ({
      url: buildGoogleCalendarConnectUrl(request.authUser.userId)
    })
  );

  app.get("/api/google/calendar/connect/callback", async (request, reply) => {
    const parsed = CallbackQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleCalendarOauthPopupPage({
            status: "error",
            message: "Google Calendar callback payload is invalid."
          })
        );
    }

    if (parsed.data.error) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleCalendarOauthPopupPage({
            status: "error",
            message: parsed.data.error_description || parsed.data.error
          })
        );
    }

    if (!parsed.data.code || !parsed.data.state) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleCalendarOauthPopupPage({
            status: "error",
            message: "Missing Google authorization code or state."
          })
        );
    }

    try {
      const connection = await completeGoogleCalendarOAuthCallback({
        code: parsed.data.code,
        state: parsed.data.state
      });
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleCalendarOauthPopupPage({
            status: "success",
            message: `Connected as ${connection.googleEmail}.`
          })
        );
    } catch (error) {
      return reply
        .type("text/html; charset=utf-8")
        .send(
          renderGoogleCalendarOauthPopupPage({
            status: "error",
            message: (error as Error).message
          })
        );
    }
  });

  app.post(
    "/api/google/calendar/disconnect",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const parsed = DisconnectSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid disconnect payload" });
      }

      const ok = await disconnectGoogleCalendarConnection(
        request.authUser.userId,
        parsed.data.connectionId
      );
      return { ok };
    }
  );

  app.get(
    "/api/google/calendar/calendars",
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const parsed = ConnectionQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid connection query" });
      }

      const calendars = await listGoogleCalendars({
        userId: request.authUser.userId,
        connectionId: parsed.data.connectionId
      });
      return { calendars };
    }
  );
}
