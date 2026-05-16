-- Extend dispatch log to track capture template sends alongside campaign dispatches
ALTER TABLE reminder_dispatch_log
  ALTER COLUMN step_id DROP NOT NULL;

ALTER TABLE reminder_dispatch_log
  ADD COLUMN IF NOT EXISTS log_type VARCHAR(20) NOT NULL DEFAULT 'campaign'
    CHECK (log_type IN ('campaign','capture_ask','capture_complete','capture_declined','capture_expired'));

-- Backfill existing rows as campaign type (already correct via DEFAULT)
UPDATE reminder_dispatch_log SET log_type = 'campaign' WHERE log_type = 'campaign';

CREATE INDEX IF NOT EXISTS reminder_dispatch_log_type_idx
  ON reminder_dispatch_log(user_id, log_type, sent_at DESC);
