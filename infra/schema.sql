CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  google_auth_sub TEXT UNIQUE,
  business_type TEXT,
  subscription_plan TEXT NOT NULL DEFAULT 'trial',
  business_basics JSONB NOT NULL DEFAULT '{}'::jsonb,
  personality TEXT NOT NULL DEFAULT 'friendly_warm',
  custom_personality_prompt TEXT,
  ai_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  session_auth_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'disconnected',
  phone_number TEXT,
  last_connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_name TEXT,
  content_chunk TEXT NOT NULL,
  embedding_vector VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_user_id_idx ON knowledge_base(user_id);
CREATE INDEX IF NOT EXISTS knowledge_embedding_idx ON knowledge_base USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 100);
CREATE UNIQUE INDEX IF NOT EXISTS users_google_auth_sub_unique_idx ON users(google_auth_sub) WHERE google_auth_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  lead_kind TEXT NOT NULL DEFAULT 'lead' CHECK (lead_kind IN ('lead', 'feedback', 'complaint', 'other')),
  classification_confidence INTEGER NOT NULL DEFAULT 50,
  channel_type TEXT NOT NULL DEFAULT 'qr' CHECK (channel_type IN ('web', 'qr', 'api')),
  channel_linked_number TEXT,
  assigned_agent_profile_id UUID,
  stage TEXT NOT NULL DEFAULT 'new',
  score INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  last_classified_at TIMESTAMPTZ,
  ai_paused BOOLEAN NOT NULL DEFAULT FALSE,
  manual_takeover BOOLEAN NOT NULL DEFAULT FALSE,
  last_ai_reply_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone_number)
);

CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id);
CREATE INDEX IF NOT EXISTS conversations_user_kind_stage_idx ON conversations(user_id, lead_kind, stage, last_message_at DESC);

CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Flow',
  channel VARCHAR(10) NOT NULL DEFAULT 'api',
  connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL,
  nodes JSONB NOT NULL DEFAULT '[]',
  edges JSONB NOT NULL DEFAULT '[]',
  triggers JSONB NOT NULL DEFAULT '[]',
  variables JSONB NOT NULL DEFAULT '{}',
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_user_id ON flows(user_id);
CREATE INDEX IF NOT EXISTS idx_flows_published ON flows(user_id, published) WHERE published = TRUE;
CREATE INDEX IF NOT EXISTS flows_user_connection_idx ON flows(user_id, connection_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS flow_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  current_node_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','waiting','completed','failed','ai_mode')),
  variables JSONB NOT NULL DEFAULT '{}',
  waiting_for TEXT
    CHECK (waiting_for IN ('button','message','location','payment','ai_reply')),
  waiting_node_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_sessions_conversation
  ON flow_sessions(conversation_id, status)
  WHERE status IN ('active','waiting','ai_mode');
CREATE INDEX IF NOT EXISTS idx_flow_sessions_flow_id ON flow_sessions(flow_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_name TEXT,
  message_text TEXT NOT NULL,
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_cursor_idx ON conversation_messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS conversation_read_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_read_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS conversation_read_state_user_idx
  ON conversation_read_state(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_read_state_conversation_idx
  ON conversation_read_state(conversation_id);

CREATE INDEX IF NOT EXISTS conversations_user_last_message_cursor_idx
  ON conversations(user_id, last_message_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS canned_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  short_code  TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canned_responses_short_code_check CHECK (length(btrim(short_code)) > 0),
  CONSTRAINT canned_responses_content_check CHECK (length(btrim(content)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS canned_responses_user_code_idx
  ON canned_responses(user_id, lower(short_code));

CREATE INDEX IF NOT EXISTS canned_responses_user_idx
  ON canned_responses(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  actor_name      TEXT,
  body            TEXT NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_notifications_user_created_idx
  ON agent_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_notifications_unread_idx
  ON agent_notifications(user_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_notifications_user_read_idx
  ON agent_notifications(user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_notifications_conversation_idx
  ON agent_notifications(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_summaries (
  conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  source_last_message_at TIMESTAMPTZ,
  model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  question TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  trigger_signals TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolution_answer TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_review_queue_user_status_idx
  ON ai_review_queue(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_review_queue_conversation_idx
  ON ai_review_queue(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('web', 'qr', 'api')),
  linked_number TEXT NOT NULL,
  business_basics JSONB NOT NULL DEFAULT '{}'::jsonb,
  personality TEXT NOT NULL DEFAULT 'friendly_warm',
  custom_personality_prompt TEXT,
  objective_type TEXT NOT NULL DEFAULT 'lead' CHECK (objective_type IN ('lead', 'feedback', 'complaint', 'hybrid')),
  task_description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_profiles_user_idx ON agent_profiles(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_profiles_channel_lookup_idx ON agent_profiles(user_id, channel_type, linked_number, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_unique_active_channel_idx
  ON agent_profiles(user_id, channel_type, linked_number)
  WHERE is_active = TRUE;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_assigned_agent_profile_id_fkey;
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
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  billing_mode TEXT NOT NULL DEFAULT 'none',
  billing_status TEXT NOT NULL DEFAULT 'unknown',
  billing_owner_business_id TEXT,
  billing_attached_at TIMESTAMPTZ,
  billing_error TEXT,
  billing_credit_line_id TEXT,
  billing_allocation_config_id TEXT,
  billing_currency TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_business_connections_user_idx
  ON whatsapp_business_connections(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_business_connections_lookup_idx
  ON whatsapp_business_connections(phone_number_id, status);

CREATE TABLE IF NOT EXISTS google_sheets_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  google_account_id TEXT,
  display_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'connected',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS google_sheets_connections_user_idx
  ON google_sheets_connections(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  google_account_id TEXT,
  display_name TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  granted_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'connected',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS google_calendar_connections_user_idx
  ON google_calendar_connections(user_id, status, updated_at DESC);

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

CREATE INDEX IF NOT EXISTS user_subscriptions_status_idx ON user_subscriptions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS user_subscriptions_plan_idx ON user_subscriptions(plan_code, updated_at DESC);

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

CREATE INDEX IF NOT EXISTS subscription_payments_user_idx ON subscription_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_subscription_idx ON subscription_payments(razorpay_subscription_id, created_at DESC);

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

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS conversations_touch_updated_at ON conversations;
CREATE TRIGGER conversations_touch_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS flows_touch_updated_at ON flows;
CREATE TRIGGER flows_touch_updated_at
BEFORE UPDATE ON flows
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS flow_sessions_touch_updated_at ON flow_sessions;
CREATE TRIGGER flow_sessions_touch_updated_at
BEFORE UPDATE ON flow_sessions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS whatsapp_sessions_touch_updated_at ON whatsapp_sessions;
CREATE TRIGGER whatsapp_sessions_touch_updated_at
BEFORE UPDATE ON whatsapp_sessions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

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

DROP TRIGGER IF EXISTS google_sheets_connections_touch_updated_at ON google_sheets_connections;
CREATE TRIGGER google_sheets_connections_touch_updated_at
BEFORE UPDATE ON google_sheets_connections
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS google_calendar_connections_touch_updated_at ON google_calendar_connections;
CREATE TRIGGER google_calendar_connections_touch_updated_at
BEFORE UPDATE ON google_calendar_connections
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
