import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  applyTemplateWebhookUpdate,
  createTemplate,
  deleteTemplate,
  generateTemplateWithAI,
  listTemplates,
  sendTestTemplate,
  syncAllTemplates,
  uploadTemplateMedia,
  type TemplateStatus
} from "../services/template-service.js";

type TemplateUploadMediaType = "IMAGE" | "VIDEO" | "DOCUMENT";

const UPLOAD_MEDIA_RULES: Record<
  TemplateUploadMediaType,
  {
    mimeTypes: string[];
    extensions: string[];
    maxBytes: number;
    description: string;
  }
> = {
  IMAGE: {
    mimeTypes: ["image/jpeg", "image/png"],
    extensions: [".jpg", ".jpeg", ".png"],
    maxBytes: 5 * 1024 * 1024,
    description: "JPG or PNG"
  },
  VIDEO: {
    mimeTypes: ["video/mp4"],
    extensions: [".mp4"],
    maxBytes: 16 * 1024 * 1024,
    description: "MP4"
  },
  DOCUMENT: {
    mimeTypes: ["application/pdf"],
    extensions: [".pdf"],
    maxBytes: 10 * 1024 * 1024,
    description: "PDF"
  }
};

const TemplateComponentButtonSchema = z.object({
  type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE", "FLOW"]),
  text: z.string().trim().min(1).max(25),
  url: z.string().url().optional(),
  phone_number: z.string().optional(),
  example: z.array(z.string()).optional()
});

const TemplateComponentSchema = z.object({
  type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
  format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"]).optional(),
  text: z.string().max(4096).optional(),
  buttons: z.array(TemplateComponentButtonSchema).max(10).optional(),
  example: z.record(z.unknown()).optional()
});

const CreateTemplateSchema = z.object({
  connectionId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Template name must be lowercase letters, digits, and underscores only"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  language: z.string().trim().min(2).max(20).default("en_US"),
  components: z.array(TemplateComponentSchema).min(1).max(10)
});

const GenerateTemplateSchema = z.object({
  prompt: z.string().trim().min(5).max(500),
  style: z.enum(["normal", "poetic", "exciting", "funny"]).default("normal")
});

export async function templateRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/meta/templates — list all templates (optionally filtered)
  fastify.get(
    "/api/meta/templates",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const query = request.query as Record<string, string | undefined>;
      const templates = await listTemplates(request.authUser.userId, {
        connectionId: query.connectionId,
        status: query.status as TemplateStatus | undefined
      });
      return { templates };
    }
  );

  // POST /api/meta/templates — create + submit template to Meta
  fastify.post(
    "/api/meta/templates",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateTemplateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid template payload",
          details: parsed.error.flatten().fieldErrors
        });
      }
      try {
        const template = await createTemplate(request.authUser.userId, parsed.data);
        return reply.status(201).send({ template });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to submit template.";
        fastify.log.error({ err: error }, "create template error");
        return reply.status(400).send({ error: message });
      }
    }
  );

  // POST /api/meta/templates/sync — bulk sync all template statuses from Meta
  fastify.post(
    "/api/meta/templates/sync",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const templates = await syncAllTemplates(request.authUser.userId);
      return { ok: true, templates };
    }
  );

  // POST /api/meta/templates/ai-generate — generate a template with AI
  fastify.post(
    "/api/meta/templates/ai-generate",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = GenerateTemplateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid AI generate payload",
          details: parsed.error.flatten().fieldErrors
        });
      }
      const generated = await generateTemplateWithAI(request.authUser.userId, parsed.data);
      return { generated };
    }
  );

  // POST /api/meta/templates/upload-media — upload sample media and return a template header handle
  fastify.post(
    "/api/meta/templates/upload-media",
    { preHandler: [fastify.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const connectionId = query.connectionId;
      const mediaType = (query.mediaType ?? "").toUpperCase() as TemplateUploadMediaType;
      if (!connectionId) {
        return reply.status(400).send({ error: "connectionId query parameter is required" });
      }
      if (!mediaType || !(mediaType in UPLOAD_MEDIA_RULES)) {
        return reply.status(400).send({ error: "mediaType query parameter must be IMAGE, VIDEO, or DOCUMENT" });
      }

      const files = await request.saveRequestFiles();
      try {
        if (files.length === 0) {
          return reply.status(400).send({ error: "A file is required" });
        }

        const file = files[0]!;
        const ext = (file.filename ?? "").toLowerCase().split(".").pop() ?? "";
        const extWithDot = `.${ext}`;
        const rule = UPLOAD_MEDIA_RULES[mediaType];

        if (!rule.extensions.includes(extWithDot) || !rule.mimeTypes.includes(file.mimetype ?? "")) {
          return reply.status(400).send({
            error: `${mediaType.toLowerCase()} template headers currently support ${rule.description} sample files only. Upload the sample here instead of pasting a public URL.`
          });
        }

        const buffer = await readFile(file.filepath);
        if (buffer.byteLength > rule.maxBytes) {
          return reply.status(400).send({ error: `File exceeds ${Math.round(rule.maxBytes / (1024 * 1024))}MB limit` });
        }

        const result = await uploadTemplateMedia(
          request.authUser.userId,
          connectionId,
          buffer,
          file.mimetype ?? "application/octet-stream",
          file.filename ?? null
        );

        return { handle: result.handle };
      } finally {
        await request.cleanRequestFiles();
      }
    }
  );

  // POST /api/meta/templates/test-send — send template to a test phone number
  fastify.post(
    "/api/meta/templates/test-send",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const body = request.body as {
        templateId?: string;
        to?: string;
        variableValues?: Record<string, string>;
      };
      if (!body.templateId || !body.to) {
        return reply.status(400).send({ error: "templateId and to are required." });
      }
      try {
        const result = await sendTestTemplate(request.authUser.userId, {
          templateId: body.templateId,
          to: body.to,
          variableValues: body.variableValues ?? {}
        });
        return { ok: true, messageId: result.messageId };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send test template.";
        fastify.log.error({ err }, "test-send template error");
        if (message.toLowerCase().includes("not found")) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(400).send({ error: message });
      }
    }
  );

  // DELETE /api/meta/templates/:id — delete template from Meta + local DB
  fastify.delete(
    "/api/meta/templates/:id",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteTemplate(request.authUser.userId, id);
      if (!deleted) {
        return reply.status(404).send({ error: "Template not found" });
      }
      return { ok: true };
    }
  );

  // Internal: webhook handler called from meta.ts
  // (applyTemplateWebhookUpdate is re-exported so meta.ts can import it directly)
  void applyTemplateWebhookUpdate; // keep import alive
}

export { applyTemplateWebhookUpdate };
