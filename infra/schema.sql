CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new',
  score INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  ai_paused BOOLEAN NOT NULL DEFAULT FALSE,
  manual_takeover BOOLEAN NOT NULL DEFAULT FALSE,
  last_ai_reply_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, phone_number)
);

CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_name TEXT,
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages(conversation_id, created_at DESC);

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

DROP TRIGGER IF EXISTS whatsapp_sessions_touch_updated_at ON whatsapp_sessions;
CREATE TRIGGER whatsapp_sessions_touch_updated_at
BEFORE UPDATE ON whatsapp_sessions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();