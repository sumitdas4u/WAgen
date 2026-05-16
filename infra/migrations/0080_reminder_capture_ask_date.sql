-- Add ASK_DATE state to capture session state machine
-- and store the captured date value + target field

ALTER TABLE reminder_capture_sessions
  DROP CONSTRAINT IF EXISTS reminder_capture_sessions_state_check;

ALTER TABLE reminder_capture_sessions
  ADD CONSTRAINT reminder_capture_sessions_state_check
  CHECK (state IN ('ASK_PERMISSION', 'ASK_DATE', 'COMPLETE', 'CANCELLED', 'EXPIRED', 'FAILED'));

ALTER TABLE reminder_capture_sessions
  ADD COLUMN IF NOT EXISTS captured_date DATE,
  ADD COLUMN IF NOT EXISTS field_name VARCHAR(100);
