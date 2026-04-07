-- Add is_default_reply flag to flows
-- When true, this flow acts as the catch-all for its channel when no other trigger matches.
-- Only one flow per (user_id, channel) should have is_default_reply = true.
-- Uniqueness is enforced in the service layer (unsets others before setting).
ALTER TABLE flows ADD COLUMN IF NOT EXISTS is_default_reply BOOLEAN NOT NULL DEFAULT FALSE;
