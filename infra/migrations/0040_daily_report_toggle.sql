-- 0030: add daily_report_enabled toggle to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT FALSE;
