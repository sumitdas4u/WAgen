import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  ingestManualText,
  ingestWebsiteUrl
} from "../services/knowledge-ingestion-service.js";
import { createPdfIngestionJobs, listIngestionJobs } from "../services/knowledge-ingestion-jobs-service.js";
import { deleteKnowledgeSource, getKnowledgeStats, listKnowledgeSources } from "../services/rag-service.js";

const ManualSchema = z.object({
  text: z.string().min(20)
});

const WebsiteSchema = z.object({
  url: z.string().url()
});

const SourcesQuerySchema = z.object({
  sourceType: z.enum(["pdf", "website", "manual"]).optional()
});

const DeleteSourceSchema = z.object({
  sourceType: z.enum(["pdf", "website", "manual"]),
  sourceName: z.string().trim().min(1)
});

const IngestJobsQuerySchema = z.object({
  ids: z.string().optional()
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
      const files = await withTimeout(
        request.saveRequestFiles(),
        env.PDF_UPLOAD_BUFFER_TIMEOUT_MS,
        "PDF upload buffering timed out"
      );

      try {
        if (files.length === 0) {
          return reply.status(400).send({ error: "PDF file is required" });
        }

        const nonPdf = files.find((file) => file.mimetype !== "application/pdf");
        if (nonPdf) {
          return reply.status(400).send({ error: `Only PDF files are allowed. Invalid file: ${nonPdf.filename}` });
        }

        const preparedFiles: Array<{ filename: string; buffer: Buffer }> = [];
        for (const file of files) {
          try {
            const buffer = await withTimeout(
              readFile(file.filepath),
              env.PDF_UPLOAD_BUFFER_TIMEOUT_MS,
              "PDF upload buffering timed out"
            );
            preparedFiles.push({ filename: file.filename, buffer });
          } catch (error) {
            const message = error instanceof Error ? error.message : "PDF ingestion failed";
            return reply.status(422).send({ error: `Failed to process "${file.filename}": ${message}` });
          }
        }

        const jobs = await createPdfIngestionJobs(request.authUser.userId, preparedFiles);
        return reply.send({ ok: true, jobs });
      } finally {
        await request.cleanRequestFiles();
      }
    }
  );

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
