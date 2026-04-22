ALTER TABLE sequence_logs
  DROP CONSTRAINT IF EXISTS sequence_logs_status_check;

ALTER TABLE sequence_logs
  ADD CONSTRAINT sequence_logs_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'stopped', 'skipped', 'retrying', 'completed'));
