ALTER TABLE whatsapp_business_connections
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS billing_owner_business_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_attached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_error TEXT,
  ADD COLUMN IF NOT EXISTS billing_credit_line_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_allocation_config_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_currency TEXT;
