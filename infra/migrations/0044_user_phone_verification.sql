-- Add phone number verification to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique_idx
  ON users(phone_number)
  WHERE phone_number IS NOT NULL;
