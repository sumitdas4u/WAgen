-- Flow builder tables

CREATE TABLE IF NOT EXISTS flows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL DEFAULT 'Untitled Flow',
  nodes       JSONB       NOT NULL DEFAULT '[]',
  edges       JSONB       NOT NULL DEFAULT '[]',
  triggers    JSONB       NOT NULL DEFAULT '[]',
  variables   JSONB       NOT NULL DEFAULT '{}',
  published   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_user_id ON flows(user_id);
CREATE INDEX IF NOT EXISTS idx_flows_published ON flows(user_id, published) WHERE published = TRUE;

CREATE TABLE IF NOT EXISTS flow_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID        NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  current_node_id TEXT,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','waiting','completed','failed')),
  variables       JSONB       NOT NULL DEFAULT '{}',
  waiting_for     TEXT        CHECK (waiting_for IN ('button','message','location','payment')),
  waiting_node_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_sessions_conversation
  ON flow_sessions(conversation_id, status)
  WHERE status IN ('active','waiting');

CREATE INDEX IF NOT EXISTS idx_flow_sessions_flow_id ON flow_sessions(flow_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'flows_updated_at'
  ) THEN
    CREATE TRIGGER flows_updated_at
      BEFORE UPDATE ON flows
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'flow_sessions_updated_at'
  ) THEN
    CREATE TRIGGER flow_sessions_updated_at
      BEFORE UPDATE ON flow_sessions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
