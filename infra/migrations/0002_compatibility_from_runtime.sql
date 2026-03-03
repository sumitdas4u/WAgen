-- Compatibility migration moved from runtime ensureDbCompatibility().
-- Safe to run in production deploy pipeline before app rollout.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique_idx
  ON users(firebase_uid)
  WHERE firebase_uid IS NOT NULL;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS retrieval_chunks INTEGER;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS lead_kind TEXT NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS classification_confidence INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS channel_type TEXT NOT NULL DEFAULT 'qr',
  ADD COLUMN IF NOT EXISTS channel_linked_number TEXT,
  ADD COLUMN IF NOT EXISTS assigned_agent_profile_id UUID,
  ADD COLUMN IF NOT EXISTS last_classified_at TIMESTAMPTZ;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_lead_kind_check,
  DROP CONSTRAINT IF EXISTS conversations_channel_type_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_lead_kind_check CHECK (lead_kind IN ('lead', 'feedback', 'complaint', 'other')),
  ADD CONSTRAINT conversations_channel_type_check CHECK (channel_type IN ('web', 'qr', 'api'));

CREATE INDEX IF NOT EXISTS conversations_user_kind_stage_idx
  ON conversations(user_id, lead_kind, stage, last_message_at DESC);

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS knowledge_ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'Queued',
  progress INTEGER NOT NULL DEFAULT 0,
  chunks_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS knowledge_ingest_jobs_user_idx
  ON knowledge_ingest_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_summaries (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  source_last_message_at TIMESTAMPTZ,
  model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('web', 'qr', 'api')),
  linked_number TEXT NOT NULL,
  business_basics JSONB NOT NULL DEFAULT '{}'::jsonb,
  personality TEXT NOT NULL DEFAULT 'friendly_warm',
  custom_personality_prompt TEXT,
  objective_type TEXT NOT NULL DEFAULT 'lead',
  task_description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS objective_type TEXT NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS task_description TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_profiles
  DROP CONSTRAINT IF EXISTS agent_profiles_channel_type_check,
  DROP CONSTRAINT IF EXISTS agent_profiles_objective_type_check;

ALTER TABLE agent_profiles
  ADD CONSTRAINT agent_profiles_channel_type_check CHECK (channel_type IN ('web', 'qr', 'api')),
  ADD CONSTRAINT agent_profiles_objective_type_check CHECK (objective_type IN ('lead', 'feedback', 'complaint', 'hybrid'));

CREATE INDEX IF NOT EXISTS agent_profiles_user_idx
  ON agent_profiles(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_profiles_channel_lookup_idx
  ON agent_profiles(user_id, channel_type, linked_number, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_unique_active_channel_idx
  ON agent_profiles(user_id, channel_type, linked_number)
  WHERE is_active = TRUE;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_assigned_agent_profile_id_fkey;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_assigned_agent_profile_id_fkey
  FOREIGN KEY (assigned_agent_profile_id)
  REFERENCES agent_profiles(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS whatsapp_business_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meta_business_id TEXT,
  waba_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL UNIQUE,
  display_phone_number TEXT,
  linked_number TEXT,
  access_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  subscription_status TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'connected',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE whatsapp_business_connections
  ADD COLUMN IF NOT EXISTS linked_number TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS whatsapp_business_connections_user_idx
  ON whatsapp_business_connections(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_business_connections_lookup_idx
  ON whatsapp_business_connections(phone_number_id, status);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  razorpay_customer_id TEXT,
  razorpay_subscription_id TEXT UNIQUE,
  razorpay_plan_id TEXT,
  plan_code TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'pending',
  current_start_at TIMESTAMPTZ,
  current_end_at TIMESTAMPTZ,
  next_charge_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  expiry_date TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_subscriptions_status_idx
  ON user_subscriptions(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS user_subscriptions_plan_idx
  ON user_subscriptions(plan_code, updated_at DESC);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_row_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  razorpay_payment_id TEXT NOT NULL UNIQUE,
  razorpay_subscription_id TEXT,
  status TEXT NOT NULL,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  method TEXT,
  description TEXT,
  paid_at TIMESTAMPTZ,
  failure_reason TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscription_payments_user_idx
  ON subscription_payments(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS subscription_payments_subscription_idx
  ON subscription_payments(razorpay_subscription_id, created_at DESC);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_subscriptions_touch_updated_at ON user_subscriptions;
CREATE TRIGGER user_subscriptions_touch_updated_at
BEFORE UPDATE ON user_subscriptions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS agent_profiles_touch_updated_at ON agent_profiles;
CREATE TRIGGER agent_profiles_touch_updated_at
BEFORE UPDATE ON agent_profiles
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS whatsapp_business_connections_touch_updated_at ON whatsapp_business_connections;
CREATE TRIGGER whatsapp_business_connections_touch_updated_at
BEFORE UPDATE ON whatsapp_business_connections
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
