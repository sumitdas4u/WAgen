import { pool } from "../db/pool.js";
import { appendSequenceLog } from "./sequence-log-service.js";
import { createSequenceEnrollment, type Sequence } from "./sequence-service.js";

export async function maybeCreateSequenceEnrollment(sequence: Sequence, contactId: string): Promise<boolean> {
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

  const enrollment = await createSequenceEnrollment(sequence.id, contactId);
  await appendSequenceLog({
    enrollmentId: enrollment.id,
    sequenceId: sequence.id,
    status: "pending",
    meta: { reason: "enrolled" }
  });
  return true;
}
