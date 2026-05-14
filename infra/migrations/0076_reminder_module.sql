-- reminder_configs: one row per user per reminder type
CREATE TABLE reminder_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_key      VARCHAR(100) NOT NULL,
  reminder_type   VARCHAR(50)  NOT NULL
                    CHECK (reminder_type IN ('birthday','anniversary','custom')),
  custom_label    VARCHAR(100),
  enabled         BOOLEAN NOT NULL DEFAULT false,

  capture_enabled         BOOLEAN NOT NULL DEFAULT true,
  capture_template_name   VARCHAR(100),
  capture_template_lang   VARCHAR(10) NOT NULL DEFAULT 'en',
  capture_template_vars   JSONB NOT NULL DEFAULT '{}',
  capture_flow_id         UUID,
  capture_trigger_type    VARCHAR(10) NOT NULL DEFAULT 'create'
                            CHECK (capture_trigger_type IN ('create','update','both')),
  capture_conditions_json JSONB NOT NULL DEFAULT '[]',
  retry_interval_days     INTEGER NOT NULL DEFAULT 7,
  retry_max_count         INTEGER NOT NULL DEFAULT 1,
  cooldown_days           INTEGER NOT NULL DEFAULT 30,

  campaign_enabled         BOOLEAN NOT NULL DEFAULT true,
  campaign_conditions_json JSONB NOT NULL DEFAULT '[]',
  campaign_send_time       TIME NOT NULL DEFAULT '09:00',
  campaign_timezone        VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
  dispatch_mode            VARCHAR(15) NOT NULL DEFAULT 'annual'
                             CHECK (dispatch_mode IN ('annual','exact_date')),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, config_key)
);

CREATE INDEX reminder_configs_user_idx ON reminder_configs(user_id);

-- reminder_campaign_steps: one or more timed steps per config (Option B)
-- Each step has its own template + days_before (e.g. 15-day teaser, 3-day nudge, day-of message)
CREATE TABLE reminder_campaign_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id     UUID NOT NULL REFERENCES reminder_configs(id) ON DELETE CASCADE,
  step_order    INTEGER NOT NULL DEFAULT 0,
  days_before   INTEGER NOT NULL DEFAULT 0,
  template_name VARCHAR(100) NOT NULL,
  template_lang VARCHAR(10) NOT NULL DEFAULT 'en',
  template_vars JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(config_id, step_order)
);

CREATE INDEX reminder_steps_config_idx ON reminder_campaign_steps(config_id);

-- reminder_capture_sessions: one active session per conversation
CREATE TABLE reminder_capture_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  contact_id       UUID NOT NULL,
  conversation_id  UUID NOT NULL,
  config_key       VARCHAR(100) NOT NULL,
  state            VARCHAR(30) NOT NULL
                     CHECK (state IN ('ASK_PERMISSION','COMPLETE','CANCELLED','EXPIRED','FAILED')),
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','complete','cancelled','expired','failed')),
  retry_count      INTEGER NOT NULL DEFAULT 0,
  context          JSONB NOT NULL DEFAULT '{}',
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_active_reminder_session
  ON reminder_capture_sessions(conversation_id)
  WHERE status = 'active';

CREATE INDEX reminder_sessions_contact_idx ON reminder_capture_sessions(user_id, contact_id);

-- reminder_dispatch_log: dedup guard per step per contact
-- annual:     campaign_year populated, dispatched_date NULL
-- exact_date: dispatched_date populated, campaign_year NULL
-- step_id scoped dedup: 15-day step and day-of step both allowed in same year
CREATE TABLE reminder_dispatch_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  contact_id      UUID NOT NULL,
  config_key      VARCHAR(100) NOT NULL,
  step_id         UUID NOT NULL REFERENCES reminder_campaign_steps(id) ON DELETE CASCADE,
  campaign_year   INTEGER,
  dispatched_date DATE,
  template_name   VARCHAR(100),
  status          VARCHAR(20) NOT NULL DEFAULT 'sent',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup annual: one send per contact per step per year
CREATE UNIQUE INDEX uniq_reminder_dispatch_year
  ON reminder_dispatch_log(user_id, contact_id, step_id, campaign_year)
  WHERE campaign_year IS NOT NULL;

-- Dedup exact_date: one send per contact per step per date
CREATE UNIQUE INDEX uniq_reminder_dispatch_date
  ON reminder_dispatch_log(user_id, contact_id, step_id, dispatched_date)
  WHERE dispatched_date IS NOT NULL;
