CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused')),
  base_type TEXT NOT NULL DEFAULT 'contact'
    CHECK (base_type IN ('contact')),
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('create', 'update', 'both')),
  channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp')),
  allow_once BOOLEAN NOT NULL DEFAULT TRUE,
  require_previous_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  retry_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  retry_window_hours INTEGER NOT NULL DEFAULT 48,
  allowed_days_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  time_mode TEXT NOT NULL DEFAULT 'any_time'
    CHECK (time_mode IN ('any_time', 'window')),
  time_window_start TIME NULL,
  time_window_end TIME NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sequences_user_status_idx
  ON sequences(user_id, status, trigger_type);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_value INTEGER NOT NULL DEFAULT 0,
  delay_unit TEXT NOT NULL
    CHECK (delay_unit IN ('minutes', 'hours', 'days')),
  message_template_id UUID NOT NULL REFERENCES message_templates(id) ON DELETE RESTRICT,
  custom_delivery_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sequence_id, step_order)
);

CREATE INDEX IF NOT EXISTS sequence_steps_sequence_idx
  ON sequence_steps(sequence_id, step_order);

CREATE TABLE IF NOT EXISTS sequence_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL
    CHECK (condition_type IN ('start', 'stop_success', 'stop_failure')),
  field TEXT NOT NULL,
  operator TEXT NOT NULL
    CHECK (operator IN ('eq', 'neq', 'gt', 'lt', 'contains')),
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sequence_conditions_sequence_idx
  ON sequence_conditions(sequence_id, condition_type);

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'failed', 'stopped')),
  current_step INTEGER NOT NULL DEFAULT 0,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_executed_at TIMESTAMPTZ NULL,
  last_message_id TEXT NULL,
  last_delivery_status TEXT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  retry_started_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sequence_enrollments_due_idx
  ON sequence_enrollments(status, next_run_at);

CREATE INDEX IF NOT EXISTS sequence_enrollments_sequence_contact_idx
  ON sequence_enrollments(sequence_id, contact_id);

CREATE TABLE IF NOT EXISTS sequence_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  step_id UUID NULL REFERENCES sequence_steps(id) ON DELETE SET NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'sent', 'failed', 'stopped', 'skipped', 'retrying')),
  response_id TEXT NULL,
  error_message TEXT NULL,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sequence_logs_enrollment_idx
  ON sequence_logs(enrollment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sequence_logs_sequence_idx
  ON sequence_logs(sequence_id, created_at DESC);
