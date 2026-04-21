import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  getSupportedKnowledgeFileAcceptValue,
  getSupportedKnowledgeFileExtensions,
  ingestManualText,
  isSupportedKnowledgeFile,
  ingestWebsiteUrl
} from "../services/knowledge-ingestion-service.js";
import { createFileIngestionJobs, listIngestionJobs } from "../services/knowledge-ingestion-jobs-service.js";
import { deleteKnowledgeSource, getKnowledgeStats, listKnowledgeChunks, listKnowledgeSources } from "../services/rag-service.js";
import { requireAiCredit, AiTokensDepletedError } from "../services/ai-token-service.js";

const ManualSchema = z.object({
  text: z.string().min(20),
  sourceName: z.string().trim().max(180).optional()
});

const WebsiteSchema = z.object({
  url: z.string().url(),
  sourceName: z.string().trim().max(180).optional()
});

const SourcesQuerySchema = z.object({
  sourceType: z.enum(["file", "pdf", "website", "manual"]).optional()
});

const DeleteSourceSchema = z.object({
  sourceType: z.enum(["file", "pdf", "website", "manual"]),
  sourceName: z.string().trim().min(1)
});

const IngestJobsQuerySchema = z.object({
  ids: z.string().optional()
});

const ChunksQuerySchema = z.object({
  sourceType: z.enum(["file", "pdf", "website", "manual"]).optional(),
  sourceName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export async function knowledgeRoutes(fastify: FastifyInstance): Promise<void> {
  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  fastify.post(
    "/api/knowledge/ingest/manual",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ManualSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Manual text must be at least 20 characters" });
      }

      try {
        await requireAiCredit(request.authUser.userId, "kb_ingest_chunk");
      } catch (e) {
        if (e instanceof AiTokensDepletedError) {
          return reply.status(402).send({ error: "ai_tokens_depleted", message: e.message, balance: e.balance });
        }
        throw e;
      }

      const chunks = await ingestManualText(request.authUser.userId, parsed.data.text, parsed.data.sourceName);
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

      try {
        await requireAiCredit(request.authUser.userId, "kb_ingest_chunk");
      } catch (e) {
        if (e instanceof AiTokensDepletedError) {
          return reply.status(402).send({ error: "ai_tokens_depleted", message: e.message, balance: e.balance });
        }
        throw e;
      }

      const chunks = await ingestWebsiteUrl(request.authUser.userId, parsed.data.url, parsed.data.sourceName);
      return reply.send({ ok: true, chunks });
    }
  );

  const ingestFilesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await requireAiCredit(request.authUser.userId, "kb_ingest_chunk");
    } catch (e) {
      if (e instanceof AiTokensDepletedError) {
        return reply.status(402).send({ error: "ai_tokens_depleted", message: e.message, balance: e.balance });
      }
      throw e;
    }

    const files = await withTimeout(
      request.saveRequestFiles(),
      env.PDF_UPLOAD_BUFFER_TIMEOUT_MS,
      "File upload buffering timed out"
    );

    try {
      if (files.length === 0) {
        return reply.status(400).send({ error: "At least one file is required" });
      }

      const invalidFile = files.find((file) => !isSupportedKnowledgeFile(file.filename, file.mimetype));
      if (invalidFile) {
        return reply.status(400).send({
          error: `Unsupported file "${invalidFile.filename}". Supported formats: ${getSupportedKnowledgeFileExtensions().join(", ")}`,
          accept: getSupportedKnowledgeFileAcceptValue()
        });
      }

      const preparedFiles: Array<{ filename: string; mimeType?: string | null; buffer: Buffer }> = [];
      for (const file of files) {
        try {
          const buffer = await withTimeout(
            readFile(file.filepath),
            env.PDF_UPLOAD_BUFFER_TIMEOUT_MS,
            "File upload buffering timed out"
          );
          preparedFiles.push({ filename: file.filename, mimeType: file.mimetype, buffer });
        } catch (error) {
          const message = error instanceof Error ? error.message : "File ingestion failed";
          return reply.status(422).send({ error: `Failed to process "${file.filename}": ${message}` });
        }
      }

      const jobs = await createFileIngestionJobs(request.authUser.userId, preparedFiles);
      return reply.send({ ok: true, jobs });
    } finally {
      await request.cleanRequestFiles();
    }
  };

  fastify.post("/api/knowledge/ingest/files", { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, ingestFilesHandler);
  // Backward-compatible alias for older clients that still call /ingest/pdf.
  fastify.post("/api/knowledge/ingest/pdf", { preHandler: [fastify.requireAuth], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, ingestFilesHandler);

  fastify.get(
    "/api/knowledge/ingest/jobs",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = IngestJobsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid ingestion jobs query" });
      }

      const ids = parsed.data.ids
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids && ids.some((id) => !z.string().uuid().safeParse(id).success)) {
        return reply.status(400).send({ error: "Invalid job id format" });
      }
      const jobs = await listIngestionJobs(request.authUser.userId, ids);
      return { jobs };
    }
  );

  fastify.get(
    "/api/knowledge/chunks",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ChunksQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid chunks query" });
      }
      const chunks = await listKnowledgeChunks({
        userId: request.authUser.userId,
        sourceType: parsed.data.sourceType,
        sourceName: parsed.data.sourceName?.trim() || undefined,
        limit: parsed.data.limit
      });
      return { chunks };
    }
  );

  fastify.get(
    "/api/knowledge/sources",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = SourcesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid sourceType filter" });
      }

      const sources = await listKnowledgeSources(request.authUser.userId, parsed.data.sourceType);
      return { sources };
    }
  );

  fastify.delete(
    "/api/knowledge/source",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = DeleteSourceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "sourceType and sourceName are required" });
      }

      const deleted = await deleteKnowledgeSource({
        userId: request.authUser.userId,
        sourceType: parsed.data.sourceType,
        sourceName: parsed.data.sourceName
      });

      return { ok: true, deleted };
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
