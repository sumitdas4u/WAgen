-- Extend flow_sessions to support ai_mode status and ai_reply waiting state

-- Drop old constraints
ALTER TABLE flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_status_check;
ALTER TABLE flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_waiting_for_check;

-- Re-add with new values
ALTER TABLE flow_sessions
  ADD CONSTRAINT flow_sessions_status_check
  CHECK (status IN ('active','waiting','completed','failed','ai_mode'));

ALTER TABLE flow_sessions
  ADD CONSTRAINT flow_sessions_waiting_for_check
  CHECK (waiting_for IN ('button','message','location','payment','ai_reply'));
