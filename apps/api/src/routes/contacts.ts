import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createManualContact,
  generateContactsExportWorkbook,
  generateContactsTemplateWorkbook,
  getContactByConversationId,
  importContactsWorkbook,
  previewContactsWorkbookImport,
  listContacts,
  updateContactCompliance
} from "../services/contacts-service.js";

const ContactTypeSchema = z.enum(["lead", "feedback", "complaint", "other"]);
const ContactSourceSchema = z.enum(["manual", "import", "web", "qr", "api"]);
const MarketingConsentStatusSchema = z.enum(["unknown", "subscribed", "unsubscribed", "revoked"]);

const ListContactsQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: ContactTypeSchema.optional(),
  source: ContactSourceSchema.optional(),
  tag: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const CreateContactBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(32),
  email: z.string().trim().optional(),
  type: ContactTypeSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  sourceId: z.string().trim().optional(),
  sourceUrl: z.string().trim().optional(),
  customFields: z.record(z.string(), z.string()).optional(),
  marketingConsentStatus: MarketingConsentStatusSchema.optional(),
  marketingConsentRecordedAt: z.string().datetime({ offset: true }).optional(),
  marketingConsentSource: z.string().trim().max(160).optional(),
  marketingConsentText: z.string().trim().max(2000).optional(),
  marketingConsentProofRef: z.string().trim().max(500).optional()
});

const UpdateContactComplianceBodySchema = z.object({
  marketingConsentStatus: MarketingConsentStatusSchema.optional(),
  marketingConsentRecordedAt: z.string().datetime({ offset: true }).nullable().optional(),
  marketingConsentSource: z.string().trim().max(160).nullable().optional(),
  marketingConsentText: z.string().trim().max(2000).nullable().optional(),
  marketingConsentProofRef: z.string().trim().max(500).nullable().optional(),
  marketingUnsubscribedAt: z.string().datetime({ offset: true }).nullable().optional(),
  marketingUnsubscribeSource: z.string().trim().max(160).nullable().optional(),
  globalOptOutAt: z.string().datetime({ offset: true }).nullable().optional()
});

const ExportContactsBodySchema = z.object({
  ids: z.array(z.string().uuid()).max(1000).optional(),
  filters: ListContactsQuerySchema.optional(),
  columns: z.array(z.string().trim().min(1).max(160)).max(200).optional()
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
        const result = await createManualContact(request.authUser.userId, {
          displayName: parsed.data.name,
          phoneNumber: parsed.data.phone,
          email: parsed.data.email,
          contactType: parsed.data.type,
          tags: parsed.data.tags,
          sourceId: parsed.data.sourceId,
          sourceUrl: parsed.data.sourceUrl,
          customFields: parsed.data.customFields,
          marketingConsentStatus: parsed.data.marketingConsentStatus,
          marketingConsentRecordedAt: parsed.data.marketingConsentRecordedAt,
          marketingConsentSource: parsed.data.marketingConsentSource,
          marketingConsentText: parsed.data.marketingConsentText,
          marketingConsentProofRef: parsed.data.marketingConsentProofRef
        });
        return reply.status(result.action === "created" ? 201 : 200).send({ contact: result.contact });
      } catch (error) {
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

  fastify.patch(
    "/api/contacts/:contactId/compliance",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { contactId } = request.params as { contactId: string };
      const parsed = UpdateContactComplianceBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid contact compliance payload" });
      }

      const contact = await updateContactCompliance(request.authUser.userId, contactId, {
        marketingConsentStatus: parsed.data.marketingConsentStatus,
        marketingConsentRecordedAt: parsed.data.marketingConsentRecordedAt ?? undefined,
        marketingConsentSource: parsed.data.marketingConsentSource ?? undefined,
        marketingConsentText: parsed.data.marketingConsentText ?? undefined,
        marketingConsentProofRef: parsed.data.marketingConsentProofRef ?? undefined,
        marketingUnsubscribedAt: parsed.data.marketingUnsubscribedAt ?? undefined,
        marketingUnsubscribeSource: parsed.data.marketingUnsubscribeSource ?? undefined,
        globalOptOutAt: parsed.data.globalOptOutAt ?? undefined
      });
      if (!contact) {
        return reply.status(404).send({ error: "Contact not found" });
      }
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
        filters: parsed.data.filters,
        columns: parsed.data.columns
      });

      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(content);
    }
  );
}
