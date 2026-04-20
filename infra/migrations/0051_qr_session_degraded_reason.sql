ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS last_degraded_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_degraded_at TIMESTAMPTZ;
