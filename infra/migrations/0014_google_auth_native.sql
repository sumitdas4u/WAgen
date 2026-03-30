ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_auth_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_auth_sub_unique_idx
  ON users(google_auth_sub)
  WHERE google_auth_sub IS NOT NULL;
