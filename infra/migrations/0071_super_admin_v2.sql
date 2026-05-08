-- 0071: Super Admin V2 — new tables, extended audit logs, and performance indexes

-- ── Admin session tracking ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS admin_sessions_email_created_idx ON admin_sessions(admin_email, created_at DESC);

-- ── Admin impersonation log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_impersonation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  ip_address TEXT
);
CREATE INDEX IF NOT EXISTS admin_impersonation_logs_admin_idx ON admin_impersonation_logs(admin_email, started_at DESC);

-- ── Extend admin_audit_logs ───────────────────────────────────────────────────
ALTER TABLE admin_audit_logs
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS before_json JSONB,
  ADD COLUMN IF NOT EXISTS after_json JSONB,
  ADD COLUMN IF NOT EXISTS admin_email TEXT;

-- ── Worker heartbeats ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL UNIQUE,
  last_ping_at TIMESTAMPTZ NOT NULL,
  queue_name TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ── Workspace abuse flags ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_abuse_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  auto_actioned BOOL NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workspace_abuse_flags_workspace_idx ON workspace_abuse_flags(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_abuse_flags_type_idx ON workspace_abuse_flags(flag_type, severity, created_at DESC);

-- Extend workspaces with risk fields
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS abuse_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_abuse_flag TEXT;

-- ── AI spend limits ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_ai_spend_limits (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  daily_cap_inr NUMERIC(10,2),
  monthly_cap_inr NUMERIC(10,2),
  action_on_breach TEXT NOT NULL DEFAULT 'pause_ai',
  notify_email TEXT,
  current_day_spend_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
  current_month_spend_inr NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_reset_daily TIMESTAMPTZ,
  last_reset_monthly TIMESTAMPTZ,
  breached_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Broadcast reputation ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_broadcast_reputation (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_delivered INTEGER NOT NULL DEFAULT 0,
  total_read INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  total_blocked INTEGER NOT NULL DEFAULT 0,
  total_templates INTEGER NOT NULL DEFAULT 0,
  total_templates_rejected INTEGER NOT NULL DEFAULT 0,
  delivery_rate NUMERIC(5,2),
  read_rate NUMERIC(5,2),
  failure_rate NUMERIC(5,2),
  template_rejection_rate NUMERIC(5,2),
  reputation_score INTEGER NOT NULL DEFAULT 100,
  risk_level TEXT NOT NULL DEFAULT 'safe',
  last_calculated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Workspace health scores ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_health_scores (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'inactive',
  ai_enabled BOOL NOT NULL DEFAULT FALSE,
  has_active_flow BOOL NOT NULL DEFAULT FALSE,
  has_approved_template BOOL NOT NULL DEFAULT FALSE,
  has_sent_broadcast BOOL NOT NULL DEFAULT FALSE,
  active_conversations_7d INTEGER NOT NULL DEFAULT 0,
  messages_sent_7d INTEGER NOT NULL DEFAULT 0,
  payment_ok BOOL NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workspace_health_scores_tier_idx ON workspace_health_scores(tier, score DESC);

-- ── AI prompt management ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOL NOT NULL DEFAULT TRUE,
  created_by_admin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_by_admin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_prompt_versions_key_idx ON admin_prompt_versions(prompt_key, version DESC);

-- Seed default prompt templates
INSERT INTO admin_prompt_templates (key, name, content, version, is_active)
VALUES
  ('global_system_prompt', 'Global System Prompt', 'You are a helpful AI assistant. Be concise, accurate, and friendly. If you are unsure about something, say so.', 1, TRUE),
  ('fallback_prompt', 'AI Fallback Prompt', 'I understand your message but I need more context to help you properly. Could you please provide more details?', 1, TRUE)
ON CONFLICT (key) DO NOTHING;

-- ── Feature flags ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  enabled_globally BOOL NOT NULL DEFAULT FALSE,
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_feature_overrides (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flag_key TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  enabled BOOL NOT NULL,
  override_reason TEXT,
  set_by_admin TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, flag_key)
);
CREATE INDEX IF NOT EXISTS workspace_feature_overrides_flag_idx ON workspace_feature_overrides(flag_key, enabled);

-- ── Emergency kill switches ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_kill_switches (
  key TEXT PRIMARY KEY,
  enabled BOOL NOT NULL DEFAULT FALSE,
  enabled_by TEXT,
  enabled_at TIMESTAMPTZ,
  reason TEXT
);

INSERT INTO admin_kill_switches (key, enabled) VALUES
  ('pause_all_broadcasts', FALSE),
  ('pause_all_ai', FALSE),
  ('disable_meta_sending', FALSE),
  ('disable_qr_sending', FALSE),
  ('pause_workers', FALSE),
  ('maintenance_mode', FALSE)
ON CONFLICT (key) DO NOTHING;

-- ── Internal workspace notes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_workspace_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  admin_email TEXT NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOL NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_workspace_notes_workspace_idx ON admin_workspace_notes(workspace_id, is_pinned DESC, created_at DESC);

-- ── Fraud signals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL DEFAULT 'low',
  auto_actioned BOOL NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fraud_signals_severity_idx ON fraud_signals(severity, resolved_at, created_at DESC);
CREATE INDEX IF NOT EXISTS fraud_signals_workspace_idx ON fraud_signals(workspace_id, created_at DESC);

-- ── Meta compliance events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES whatsapp_business_connections(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL DEFAULT 'warn',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS meta_compliance_events_workspace_idx ON meta_compliance_events(workspace_id, event_type, created_at DESC);

-- ── Performance indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workspaces_status_created ON workspaces(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_next_billing ON subscriptions(status, next_billing_date);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_created ON campaigns(user_id, created_at DESC);

-- ── Full-text search support ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_users_email_gin ON users USING gin(email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_name_gin ON users USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_campaigns_name_gin ON campaigns USING gin(name gin_trgm_ops);
