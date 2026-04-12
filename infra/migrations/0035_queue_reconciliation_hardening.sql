ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS last_enqueued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_enqueued_for_run_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_enqueued_queue TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_enqueued_job_id TEXT NULL;

CREATE INDEX IF NOT EXISTS sequence_enrollments_queue_due_idx
  ON sequence_enrollments(status, next_run_at, last_enqueued_for_run_at);

CREATE INDEX IF NOT EXISTS sequence_enrollments_queue_job_idx
  ON sequence_enrollments(last_enqueued_queue, last_enqueued_job_id)
  WHERE last_enqueued_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaign_messages_sending_updated_idx
  ON campaign_messages(status, updated_at)
  WHERE status = 'sending';
