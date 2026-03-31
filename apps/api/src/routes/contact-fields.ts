import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createContactField,
  deleteContactField,
  listContactFields,
  updateContactField
} from "../services/contact-fields-service.js";

const FieldTypeSchema = z.enum(["TEXT", "MULTI_TEXT", "NUMBER", "SWITCH", "DATE"]);

const CreateFieldBodySchema = z.object({
  label: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/, "Name must be alphanumeric with underscores only"),
  field_type: FieldTypeSchema,
  is_active: z.boolean().optional(),
  is_mandatory: z.boolean().optional()
});

const UpdateFieldBodySchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
  is_mandatory: z.boolean().optional()
});

export async function contactFieldRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/contact-fields",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const userId = (request as { user: { userId: string } }).user.userId;
      const fields = await listContactFields(userId);
      return reply.send({ fields });
    }
  );

  fastify.post(
    "/api/contact-fields",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const userId = (request as { user: { userId: string } }).user.userId;
      const body = CreateFieldBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });

      try {
        const field = await createContactField(userId, body.data);
        return reply.status(201).send({ field });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.status(409).send({ error: "A field with this name already exists." });
        }
        throw err;
      }
    }
  );

  fastify.patch(
    "/api/contact-fields/:fieldId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const userId = (request as { user: { userId: string } }).user.userId;
      const { fieldId } = request.params as { fieldId: string };
      const body = UpdateFieldBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });

      const field = await updateContactField(userId, fieldId, body.data);
      if (!field) return reply.status(404).send({ error: "Field not found." });
      return reply.send({ field });
    }
  );

  fastify.delete(
    "/api/contact-fields/:fieldId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const userId = (request as { user: { userId: string } }).user.userId;
      const { fieldId } = request.params as { fieldId: string };
      const deleted = await deleteContactField(userId, fieldId);
      if (!deleted) return reply.status(404).send({ error: "Field not found." });
      return reply.status(204).send();
    }
  );
}
