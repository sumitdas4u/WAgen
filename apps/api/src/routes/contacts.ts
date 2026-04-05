import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createManualContact,
  generateContactsExportWorkbook,
  generateContactsTemplateWorkbook,
  getContactByConversationId,
  importContactsWorkbook,
  previewContactsWorkbookImport,
  listContacts
} from "../services/contacts-service.js";

const ContactTypeSchema = z.enum(["lead", "feedback", "complaint", "other"]);
const ContactSourceSchema = z.enum(["manual", "import", "web", "qr", "api"]);

const ListContactsQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: ContactTypeSchema.optional(),
  source: ContactSourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const CreateContactBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(32),
  email: z.string().trim().optional(),
  type: ContactTypeSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  orderDate: z.string().trim().optional(),
  sourceId: z.string().trim().optional(),
  sourceUrl: z.string().trim().optional(),
  customFields: z.record(z.string(), z.string()).optional()
});

const ExportContactsBodySchema = z.object({
  ids: z.array(z.string().uuid()).max(1000).optional(),
  filters: ListContactsQuerySchema.optional()
});

export async function contactRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/contacts/import/preview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "XLSX file is required." });
      }

      const filename = file.filename.toLowerCase();
      if (!filename.endsWith(".xlsx")) {
        return reply.status(400).send({ error: "Only .xlsx files are supported." });
      }

      try {
        const buffer = await file.toBuffer();
        const preview = previewContactsWorkbookImport(buffer);
        return { ok: true, preview };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.get(
    "/api/contacts",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ListContactsQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid contacts query" });
      }

      const contacts = await listContacts(request.authUser.userId, parsed.data);
      return { contacts };
    }
  );

  fastify.post(
    "/api/contacts",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = CreateContactBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid contact payload" });
      }

      try {
        const contact = await createManualContact(request.authUser.userId, {
          displayName: parsed.data.name,
          phoneNumber: parsed.data.phone,
          email: parsed.data.email,
          contactType: parsed.data.type,
          tags: parsed.data.tags,
          orderDate: parsed.data.orderDate,
          sourceId: parsed.data.sourceId,
          sourceUrl: parsed.data.sourceUrl,
          customFields: parsed.data.customFields
        });
        return reply.status(201).send({ contact });
      } catch (error) {
        if ((error as Error & { code?: string }).code === "CONTACT_DUPLICATE") {
          return reply.status(409).send({ error: (error as Error).message });
        }
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.post(
    "/api/contacts/import",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "XLSX file is required." });
      }

      const filename = file.filename.toLowerCase();
      if (!filename.endsWith(".xlsx")) {
        return reply.status(400).send({ error: "Only .xlsx files are supported." });
      }

      try {
        const buffer = await file.toBuffer();
        const mappingRaw = file.fields.mapping;
        let mapping: Record<string, string> | undefined;
        if (mappingRaw && "value" in mappingRaw && typeof mappingRaw.value === "string" && mappingRaw.value.trim()) {
          mapping = JSON.parse(mappingRaw.value) as Record<string, string>;
        }
        const result = await importContactsWorkbook(request.authUser.userId, buffer, {
          columnMapping: mapping
        });
        return { ok: true, ...result };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.get(
    "/api/contacts/template",
    { preHandler: [fastify.requireAuth] },
    async (_, reply) => {
      const { filename, content } = generateContactsTemplateWorkbook();
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(content);
    }
  );

  fastify.get(
    "/api/contacts/by-conversation/:conversationId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const contact = await getContactByConversationId(request.authUser.userId, conversationId);
      if (!contact) return reply.status(404).send({ error: "No contact found." });
      return { contact };
    }
  );

  fastify.post(
    "/api/contacts/export",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = ExportContactsBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid export payload" });
      }

      const { filename, content } = await generateContactsExportWorkbook({
        userId: request.authUser.userId,
        ids: parsed.data.ids,
        filters: parsed.data.filters
      });

      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(content);
    }
  );
}
