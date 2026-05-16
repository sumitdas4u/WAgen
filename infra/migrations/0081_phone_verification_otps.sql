CREATE TABLE IF NOT EXISTS phone_verification_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS phone_verification_otps_user_active_idx
  ON phone_verification_otps(user_id, phone_number, sent_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS phone_verification_otps_expiry_idx
  ON phone_verification_otps(expires_at)
  WHERE consumed_at IS NULL;
