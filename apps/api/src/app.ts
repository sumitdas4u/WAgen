import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import fastifyRawBody from "fastify-raw-body";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { registerMetrics } from "./observability/metrics.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { conversationRoutes } from "./routes/conversations.js";
import { flowRoutes } from "./routes/flows.js";
import { billingRoutes } from "./routes/billing.js";
import { agentRoutes } from "./routes/agents.js";
import { metaRoutes } from "./routes/meta.js";
import { googleCalendarRoutes } from "./routes/google-calendar.js";
import { googleSheetsRoutes } from "./routes/google-sheets.js";
import { aiReviewRoutes } from "./routes/ai-review.js";
import { sdkRoutes } from "./routes/sdk.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { workspaceBillingRoutes } from "./routes/workspace-billing.js";
import { contactRoutes } from "./routes/contacts.js";
import { contactFieldRoutes } from "./routes/contact-fields.js";
import { templateRoutes } from "./routes/templates.js";
import { registerRealtimeRoutes } from "./services/realtime-hub.js";
import { registerWidgetChatGatewayRoutes } from "./services/widget-chat-gateway-service.js";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface AuthTokenPayload {
  userId?: string;
  email: string;
  role?: "super_admin";
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
    requestIdHeader: "x-request-id",
    genReqId: (request) => request.headers["x-request-id"]?.toString() ?? randomUUID()
  });

  registerMetrics(app, {
    enabled: env.METRICS_ENABLED,
    metricsEndpoint: env.METRICS_ENDPOINT,
    vitalsEndpoint: "/api/observability/vitals",
    prefix: "wagen_",
    defaultLabels: { service: "wagen-api" }
  });

  const allowedOrigins = new Set(
    [env.APP_BASE_URL, "http://localhost:8080", "http://localhost:4000", "http://localhost:5173"]
      .filter(Boolean)
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.has(origin)) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"), false);
      }
    },
    credentials: true
  });

  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024
    }
  });
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true
  });
  await app.register(websocket);

  app.addHook("onResponse", async (request, reply) => {
    reply.header("x-request-id", request.id);
    const start = (request as FastifyRequest & { _startHr?: bigint })._startHr;
    if (!start) return;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const slow = durationMs >= 500;
    if (slow) {
      app.log.warn(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          requestId: request.id,
          durationMs
        },
        "Slow request"
      );
    } else {
      app.log.info(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          requestId: request.id,
          durationMs
        },
        "Request completed"
      );
    }
  });

  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<AuthTokenPayload>();
      if (!payload.userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      request.authUser = {
        userId: payload.userId,
        email: payload.email
      };
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });

  app.decorate("requireSuperAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<AuthTokenPayload>();
      if (payload.role !== "super_admin") {
        return reply.status(403).send({ error: "Forbidden" });
      }
      request.adminUser = {
        email: payload.email,
        role: "super_admin"
      };
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });

  await authRoutes(app);
  await adminRoutes(app);
  await onboardingRoutes(app);
  await knowledgeRoutes(app);
  await whatsappRoutes(app);
  await dashboardRoutes(app);
  await billingRoutes(app);
  await workspaceRoutes(app);
  await workspaceBillingRoutes(app);
  await metaRoutes(app);
  await googleCalendarRoutes(app);
  await googleSheetsRoutes(app);
  await templateRoutes(app);
  await agentRoutes(app);
  await aiReviewRoutes(app);
  await sdkRoutes(app);
  await conversationRoutes(app);
  await contactRoutes(app);
  await contactFieldRoutes(app);
  await flowRoutes(app);
  await registerRealtimeRoutes(app);
  await registerWidgetChatGatewayRoutes(app);

  app.get("/api/health", async () => ({ ok: true }));

  app.setErrorHandler((error, _, reply) => {
    app.log.error(error);
    if (!reply.sent) {
      const message = error instanceof Error ? error.message : "Internal server error";
      reply.status(500).send({ error: message });
    }
  });

  return app;
}
