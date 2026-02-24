import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ingestManualText,
  ingestPdfBuffer,
  ingestWebsiteUrl
} from "../services/knowledge-ingestion-service.js";
import { getKnowledgeStats } from "../services/rag-service.js";

const ManualSchema = z.object({
  text: z.string().min(20)
});

const WebsiteSchema = z.object({
  url: z.string().url()
});

export async function knowledgeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/knowledge/ingest/manual",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ManualSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Manual text must be at least 20 characters" });
      }

      const chunks = await ingestManualText(request.authUser.userId, parsed.data.text);
      return reply.send({ ok: true, chunks });
    }
  );

  fastify.post(
    "/api/knowledge/ingest/website",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = WebsiteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid website URL" });
      }

      const chunks = await ingestWebsiteUrl(request.authUser.userId, parsed.data.url);
      return reply.send({ ok: true, chunks });
    }
  );

  fastify.post(
    "/api/knowledge/ingest/pdf",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "PDF file is required" });
      }

      if (file.mimetype !== "application/pdf") {
        return reply.status(400).send({ error: "Only PDF files are allowed" });
      }

      const buffer = await file.toBuffer();
      const chunks = await ingestPdfBuffer(request.authUser.userId, file.filename, buffer);
      return reply.send({ ok: true, chunks });
    }
  );

  fastify.get(
    "/api/knowledge/stats",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      return getKnowledgeStats(request.authUser.userId);
    }
  );
}