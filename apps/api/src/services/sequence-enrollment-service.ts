import { pool } from "../db/pool.js";
import { appendSequenceLog } from "./sequence-log-service.js";
import { createSequenceEnrollment, type Sequence, type SequenceStep } from "./sequence-service.js";

export async function maybeCreateSequenceEnrollment(
  sequence: Sequence & { steps?: SequenceStep[] },
  contactId: string
): Promise<boolean> {
  if (sequence.allow_once) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id
       FROM sequence_enrollments
       WHERE sequence_id = $1
         AND contact_id = $2
       LIMIT 1`,
      [sequence.id, contactId]
    );
    if (existing.rows[0]) {
      return false;
    }
  }

  const firstStep = sequence.steps?.[0];
  const enrollment = await createSequenceEnrollment(
    sequence.id,
    contactId,
    firstStep ? { value: firstStep.delay_value, unit: firstStep.delay_unit } : undefined
  );
  await appendSequenceLog({
    enrollmentId: enrollment.id,
    sequenceId: sequence.id,
    status: "pending",
    meta: { reason: "enrolled" }
  });
  return true;
}
