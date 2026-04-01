import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  applyFilters,
  createSegment,
  deleteSegment,
  getSegmentContacts,
  listSegments,
  updateSegment,
  type SegmentFilter,
  type SegmentFilterOp
} from "../services/contact-segments-service.js";

const FilterOpSchema = z.enum([
  "is",
  "is_not",
  "contains",
  "not_contains",
  "before",
  "after",
  "is_empty",
  "is_not_empty"
] as [SegmentFilterOp, ...SegmentFilterOp[]]);

const SegmentFilterSchema = z.object({
  field: z.string().trim().min(1).max(100),
  op: FilterOpSchema,
  value: z.string().max(500).default("")
});

const CreateSegmentBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  filters: z.array(SegmentFilterSchema).max(20).default([])
});

const UpdateSegmentBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  filters: z.array(SegmentFilterSchema).max(20).optional()
});

const PreviewBodySchema = z.object({
  filters: z.array(SegmentFilterSchema).max(20).default([])
});

export async function contactSegmentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/contact-segments",
    { preHandler: [fastify.requireAuth] },
    async (request) => {
      const segments = await listSegments(request.authUser.userId);
      return { segments };
    }
  );

  fastify.post(
    "/api/contact-segments",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const body = CreateSegmentBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });
      const segment = await createSegment(request.authUser.userId, body.data.name, body.data.filters as SegmentFilter[]);
      return reply.status(201).send({ segment });
    }
  );

  fastify.patch(
    "/api/contact-segments/:segmentId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { segmentId } = request.params as { segmentId: string };
      const body = UpdateSegmentBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });
      const segment = await updateSegment(request.authUser.userId, segmentId, {
        name: body.data.name,
        filters: body.data.filters as SegmentFilter[] | undefined
      });
      if (!segment) return reply.status(404).send({ error: "Segment not found." });
      return { segment };
    }
  );

  fastify.delete(
    "/api/contact-segments/:segmentId",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { segmentId } = request.params as { segmentId: string };
      const deleted = await deleteSegment(request.authUser.userId, segmentId);
      if (!deleted) return reply.status(404).send({ error: "Segment not found." });
      return reply.status(204).send();
    }
  );

  fastify.get(
    "/api/contact-segments/:segmentId/contacts",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { segmentId } = request.params as { segmentId: string };
      const contacts = await getSegmentContacts(request.authUser.userId, segmentId);
      return { contacts };
    }
  );

  // Preview endpoint — returns matching contacts for a set of filters without saving
  fastify.post(
    "/api/contact-segments/preview",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const body = PreviewBodySchema.safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues[0]?.message ?? "Invalid input" });
      const contacts = await applyFilters(request.authUser.userId, body.data.filters as SegmentFilter[]);
      return { contacts, count: contacts.length };
    }
  );
}
