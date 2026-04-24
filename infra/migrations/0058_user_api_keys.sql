-- 0058: user API keys for public /v1/ access
CREATE TABLE IF NOT EXISTS user_api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_api_keys_user_idx
  ON user_api_keys(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_api_keys_hash_idx
  ON user_api_keys(key_hash)
  WHERE revoked_at IS NULL;
