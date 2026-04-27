-- 0064: CSAT rating columns on conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS csat_rating INT CHECK (csat_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_sent_at TIMESTAMPTZ;
