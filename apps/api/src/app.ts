import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { env } from "./config/env.js";
import { ensureDbCompatibility } from "./db/pool.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { conversationRoutes } from "./routes/conversations.js";
import { registerRealtimeRoutes } from "./services/realtime-hub.js";

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
  const app = Fastify({ logger: true });
  await ensureDbCompatibility();

  await app.register(cors, {
    origin: env.APP_BASE_URL,
    credentials: true
  });

  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024
    }
  });
  await app.register(websocket);

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
  await conversationRoutes(app);
  await registerRealtimeRoutes(app);

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
