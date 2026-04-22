import { pool } from "../db/pool.js";

export type SequenceLogStatus = "pending" | "sent" | "failed" | "stopped" | "skipped" | "retrying" | "completed";

export interface SequenceLog {
  id: string;
  enrollment_id: string;
  sequence_id: string;
  step_id: string | null;
  status: SequenceLogStatus;
  response_id: string | null;
  error_message: string | null;
  meta_json: Record<string, unknown>;
  created_at: string;
}

export async function appendSequenceLog(input: {
  enrollmentId: string;
  sequenceId: string;
  stepId?: string | null;
  status: SequenceLogStatus;
  responseId?: string | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown>;
}): Promise<SequenceLog> {
  const result = await pool.query<SequenceLog>(
    `INSERT INTO sequence_logs (
       enrollment_id,
       sequence_id,
       step_id,
       status,
       response_id,
       error_message,
       meta_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      input.enrollmentId,
      input.sequenceId,
      input.stepId ?? null,
      input.status,
      input.responseId ?? null,
      input.errorMessage ?? null,
      JSON.stringify(input.meta ?? {})
    ]
  );
  return result.rows[0]!;
}

export async function listEnrollmentLogs(userId: string, enrollmentId: string): Promise<SequenceLog[]> {
  const result = await pool.query<SequenceLog>(
    `SELECT sl.*
     FROM sequence_logs sl
     JOIN sequence_enrollments se ON se.id = sl.enrollment_id
     JOIN sequences s ON s.id = se.sequence_id
     WHERE sl.enrollment_id = $1
       AND s.user_id = $2
     ORDER BY sl.created_at DESC`,
    [enrollmentId, userId]
  );
  return result.rows;
}
