ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS pairing_code TEXT,
  ADD COLUMN IF NOT EXISTS pairing_code_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS whatsapp_proxies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https', 'socks5')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port >= 1 AND port <= 65535),
  username TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rabbitmq_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT 'wagen.events',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, remote_jid)
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  from_me BOOLEAN NOT NULL DEFAULT FALSE,
  message_type TEXT NOT NULL DEFAULT 'unknown',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  text TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_user_remote_timestamp_idx
  ON whatsapp_messages(user_id, remote_jid, timestamp DESC);

CREATE INDEX IF NOT EXISTS whatsapp_messages_user_timestamp_idx
  ON whatsapp_messages(user_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS webhook_endpoints_user_idx
  ON webhook_endpoints(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS webhook_delivery_logs_endpoint_idx
  ON webhook_delivery_logs(endpoint_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_chats_user_last_message_idx
  ON whatsapp_chats(user_id, last_message_at DESC);

DROP TRIGGER IF EXISTS whatsapp_proxies_touch_updated_at ON whatsapp_proxies;
CREATE TRIGGER whatsapp_proxies_touch_updated_at
BEFORE UPDATE ON whatsapp_proxies
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS webhook_endpoints_touch_updated_at ON webhook_endpoints;
CREATE TRIGGER webhook_endpoints_touch_updated_at
BEFORE UPDATE ON webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS rabbitmq_configs_touch_updated_at ON rabbitmq_configs;
CREATE TRIGGER rabbitmq_configs_touch_updated_at
BEFORE UPDATE ON rabbitmq_configs
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS whatsapp_chats_touch_updated_at ON whatsapp_chats;
CREATE TRIGGER whatsapp_chats_touch_updated_at
BEFORE UPDATE ON whatsapp_chats
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS whatsapp_messages_touch_updated_at ON whatsapp_messages;
CREATE TRIGGER whatsapp_messages_touch_updated_at
BEFORE UPDATE ON whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
