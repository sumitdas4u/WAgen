import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { processSequenceEvent } from "../services/sequence-event-service.js";
import { listEnrollmentLogs } from "../services/sequence-log-service.js";
import {
  createSequence,
  deleteSequence,
  getSequenceDetail,
  getSequenceStepFunnel,
  listSequenceEnrollments,
  listSequences,
  pauseSequence,
  publishSequence,
  resumeSequence,
  updateSequence
} from "../services/sequence-service.js";

const EnrollmentQuerySchema = z.object({
  status: z.enum(["active", "completed", "failed", "stopped"]).optional()
});

const StepSchema = z.object({
  id: z.string().uuid().optional(),
  stepOrder: z.number().int().min(0),
  delayValue: z.number().int().min(0),
  delayUnit: z.enum(["minutes", "hours", "days"]),
  messageTemplateId: z.string().uuid(),
  customDelivery: z.record(z.string(), z.unknown()).optional()
});

const ConditionSchema = z.object({
  id: z.string().uuid().optional(),
  conditionType: z.enum(["start", "stop_success", "stop_failure"]),
  field: z.string().trim().min(1),
  operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
  value: z.string()
});

const SequenceWriteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  baseType: z.enum(["contact"]).optional(),
  triggerType: z.enum(["create", "update", "both"]),
  channel: z.enum(["whatsapp"]).optional(),
  allowOnce: z.boolean().optional(),
  requirePreviousDelivery: z.boolean().optional(),
  retryEnabled: z.boolean().optional(),
  retryWindowHours: z.number().int().min(1).max(48).optional(),
  allowedDays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).optional(),
  timeMode: z.enum(["any_time", "window"]).optional(),
  timeWindowStart: z.string().optional().nullable(),
  timeWindowEnd: z.string().optional().nullable(),
  steps: z.array(StepSchema).optional(),
  conditions: z.array(ConditionSchema).optional()
});

const SequencePatchSchema = SequenceWriteSchema.partial();
const SequenceEventSchema = z.object({
  event: z.enum(["contact_created", "contact_updated"]),
  contactId: z.string().uuid()
});

export async function sequenceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/sequences", { preHandler: [fastify.requireAuth] }, async (request) => {
    const sequences = await listSequences(request.authUser.userId);
    return { sequences };
  });

  fastify.post("/api/sequences", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = SequenceWriteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid sequence payload" });
    }
    try {
      const sequence = await createSequence(request.authUser.userId, parsed.data);
      return reply.status(201).send({ sequence });
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  fastify.get("/api/sequences/:sequenceId", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    const sequence = await getSequenceDetail(request.authUser.userId, sequenceId);
    if (!sequence) {
      return reply.status(404).send({ error: "Sequence not found" });
    }
    return { sequence };
  });

  fastify.patch("/api/sequences/:sequenceId", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    const parsed = SequencePatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid sequence patch" });
    }
    try {
      const sequence = await updateSequence(request.authUser.userId, sequenceId, parsed.data);
      if (!sequence) {
        return reply.status(404).send({ error: "Sequence not found" });
      }
      return { sequence };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  fastify.delete("/api/sequences/:sequenceId", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    const deleted = await deleteSequence(request.authUser.userId, sequenceId);
    if (!deleted) {
      return reply.status(404).send({ error: "Sequence not found" });
    }
    return { ok: true };
  });

  fastify.post("/api/sequences/:sequenceId/publish", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    try {
      const sequence = await publishSequence(request.authUser.userId, sequenceId);
      if (!sequence) {
        return reply.status(404).send({ error: "Sequence not found" });
      }
      return { sequence };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  fastify.post("/api/sequences/:sequenceId/pause", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    const sequence = await pauseSequence(request.authUser.userId, sequenceId);
    if (!sequence) {
      return reply.status(404).send({ error: "Sequence not found" });
    }
    return { sequence };
  });

  fastify.post("/api/sequences/:sequenceId/resume", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    try {
      const sequence = await resumeSequence(request.authUser.userId, sequenceId);
      if (!sequence) {
        return reply.status(404).send({ error: "Sequence not found" });
      }
      return { sequence };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  fastify.get("/api/sequences/:sequenceId/enrollments", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    const parsed = EnrollmentQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query" });
    }
    const enrollments = await listSequenceEnrollments(request.authUser.userId, sequenceId, parsed.data.status);
    return { enrollments };
  });

  fastify.get("/api/enrollments/:enrollmentId/logs", { preHandler: [fastify.requireAuth] }, async (request) => {
    const { enrollmentId } = request.params as { enrollmentId: string };
    const logs = await listEnrollmentLogs(request.authUser.userId, enrollmentId);
    return { logs };
  });

  fastify.post("/api/sequences/events", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const parsed = SequenceEventSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid sequence event payload" });
    }
    const result = await processSequenceEvent({
      userId: request.authUser.userId,
      event: parsed.data.event,
      contactId: parsed.data.contactId
    });
    return { ok: true, ...result };
  });

  fastify.get("/api/sequences/:sequenceId/step-funnel", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { sequenceId } = request.params as { sequenceId: string };
    const rows = await getSequenceStepFunnel(request.authUser.userId, sequenceId);
    return { funnel: rows };
  });
}
