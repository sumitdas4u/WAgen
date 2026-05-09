-- 0073: Add signup_ip to users for fraud detection

ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip TEXT;
CREATE INDEX IF NOT EXISTS idx_users_signup_ip ON users(signup_ip) WHERE signup_ip IS NOT NULL;
