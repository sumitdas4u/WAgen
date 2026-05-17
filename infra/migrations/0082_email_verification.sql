ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

UPDATE users
SET email_verified = TRUE,
    email_verified_at = COALESCE(email_verified_at, created_at, NOW())
WHERE email_verified IS NULL;

ALTER TABLE users
  ALTER COLUMN email_verified SET DEFAULT FALSE,
  ALTER COLUMN email_verified SET NOT NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_verification_tokens_active_idx
  ON email_verification_tokens(token_hash, expires_at)
  WHERE used_at IS NULL;
