# Reminder Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Reminder Module — automatic date-capture via WhatsApp flow + annual campaign dispatch — with a settings UI for Birthday, Anniversary, and Custom reminder types.

**Architecture:** Contact create/update events trigger a capture flow (permission template → user-linked flow captures date); a daily BullMQ worker scans `contact_field_values` for date matches and sends campaign templates. All data lives in four new tables; captured dates reuse existing `contact_field_values` with `field_type = 'DATE'`.

**Tech Stack:** PostgreSQL (pg pool), BullMQ + ioredis, Fastify routes, Zod validation, React + TanStack Query, react-router-dom nested routes, Vitest for tests.

---

## File Map

**New files — API:**
- `infra/migrations/0075_reminder_module.sql` — 4 new tables
- `apps/api/src/services/reminder-config-service.ts` — CRUD for reminder_configs
- `apps/api/src/services/reminder-capture-trigger-service.ts` — evaluate conditions, start sessions, send permission template
- `apps/api/src/services/reminder-capture-session-service.ts` — session state machine (YES/NO/EXPIRED)
- `apps/api/src/services/reminder-dispatch-worker-service.ts` — BullMQ worker + daily cron
- `apps/api/src/routes/reminder.ts` — Fastify route handlers

**Modified files — API:**
- `apps/api/src/services/queue-service.ts` — add `"reminder-dispatch"` to managed queues
- `apps/api/src/services/contacts-service.ts` — call `emitReminderCaptureEvent` at every `emitSequenceContactEvent` callsite (6 places)
- `apps/api/src/services/message-router-service.ts` — check for active capture session before flow engine runs
- `apps/api/src/app.ts` — register `reminderRoutes`
- `apps/api/src/worker.ts` — start/stop `reminderDispatchWorker`

**New files — Frontend:**
- `apps/web/src/lib/api.ts` — 5 new API functions (append to existing file)
- `apps/web/src/modules/dashboard/reminder/route.tsx` — overview page (3 cards)
- `apps/web/src/modules/dashboard/reminder/api.ts` — typed API wrappers
- `apps/web/src/modules/dashboard/reminder/queries.ts` — TanStack Query hooks
- `apps/web/src/modules/dashboard/reminder/[config_key]/capture.tsx` — capture settings page
- `apps/web/src/modules/dashboard/reminder/[config_key]/campaign.tsx` — campaign settings page
- `apps/web/src/modules/dashboard/reminder/components/ReminderCard.tsx`
- `apps/web/src/modules/dashboard/reminder/components/CaptureSettingsForm.tsx`
- `apps/web/src/modules/dashboard/reminder/components/CampaignSettingsForm.tsx`
- `apps/web/src/modules/dashboard/reminder/components/TemplateVarMapper.tsx`

**Modified files — Frontend:**
- `apps/web/src/shared/dashboard/query-keys.ts` — add reminder keys
- `apps/web/src/registry/dashboardModules.ts` — register reminder module

---

## Task 1: Database Migration

**Files:**
- Create: `infra/migrations/0075_reminder_module.sql`

- [ ] **Step 1: Write the migration file**

```sql
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
  campaign_template_name   VARCHAR(100),
  campaign_template_lang   VARCHAR(10) NOT NULL DEFAULT 'en',
  campaign_template_vars   JSONB NOT NULL DEFAULT '{}',
  campaign_conditions_json JSONB NOT NULL DEFAULT '[]',
  campaign_send_time       TIME NOT NULL DEFAULT '09:00',
  campaign_days_before     INTEGER NOT NULL DEFAULT 0,
  campaign_timezone        VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, config_key)
);

CREATE INDEX reminder_configs_user_idx ON reminder_configs(user_id);

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

-- reminder_prompt_log: cooldown/retry tracking per contact per config
CREATE TABLE reminder_prompt_log (
  user_id          UUID NOT NULL,
  contact_id       UUID NOT NULL,
  config_key       VARCHAR(100) NOT NULL,
  last_prompted_at TIMESTAMPTZ NOT NULL,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, contact_id, config_key)
);

-- reminder_dispatch_log: one row per contact per year per config (dedup guard)
CREATE TABLE reminder_dispatch_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  contact_id    UUID NOT NULL,
  config_key    VARCHAR(100) NOT NULL,
  campaign_year INTEGER NOT NULL,
  template_name VARCHAR(100),
  status        VARCHAR(20) NOT NULL DEFAULT 'sent',
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_reminder_dispatch_year
  ON reminder_dispatch_log(user_id, contact_id, config_key, campaign_year);
```

- [ ] **Step 2: Verify the migration runs**

```bash
# From the WAgen root
npx tsx apps/api/src/scripts/migrate.ts
```

Expected: no errors, all 4 tables created.

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/0075_reminder_module.sql
git commit -m "feat: add reminder module database migration (4 tables)"
```

---

## Task 2: reminder-config-service.ts

**Files:**
- Create: `apps/api/src/services/reminder-config-service.ts`
- Create: `apps/api/src/services/reminder-config-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/reminder-config-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({
  pool: { query: vi.fn() }
}));

import { pool } from "../db/pool.js";
import {
  listReminderConfigs,
  upsertReminderConfig,
  deleteReminderConfig,
  type ReminderConfigInput
} from "./reminder-config-service.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  mockQuery.mockReset();
});

describe("listReminderConfigs", () => {
  it("returns existing configs and seeds defaults if none exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)   // initial SELECT
      .mockResolvedValueOnce({ rows: [] } as any)   // INSERT birthday
      .mockResolvedValueOnce({ rows: [] } as any)   // INSERT anniversary
      .mockResolvedValueOnce({ rows: [
        { id: "uuid-1", config_key: "birthday", reminder_type: "birthday" },
        { id: "uuid-2", config_key: "anniversary", reminder_type: "anniversary" }
      ] } as any); // final SELECT

    const result = await listReminderConfigs("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].config_key).toBe("birthday");
  });
});

describe("upsertReminderConfig", () => {
  it("upserts a config and returns the updated row", async () => {
    const mockRow = {
      id: "uuid-1",
      user_id: "user-1",
      config_key: "birthday",
      reminder_type: "birthday",
      enabled: true
    };
    mockQuery.mockResolvedValueOnce({ rows: [mockRow] } as any);

    const input: ReminderConfigInput = {
      configKey: "birthday",
      reminderType: "birthday",
      enabled: true
    };
    const result = await upsertReminderConfig("user-1", input);
    expect(result.config_key).toBe("birthday");
    expect(result.enabled).toBe(true);
  });
});

describe("deleteReminderConfig", () => {
  it("returns true when a custom config is deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any);
    const result = await deleteReminderConfig("user-1", "kids_birthday");
    expect(result).toBe(true);
  });

  it("returns false when config not found", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as any);
    const result = await deleteReminderConfig("user-1", "nonexistent");
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/services/reminder-config-service.test.ts
```

Expected: FAIL — `reminder-config-service.js` not found.

- [ ] **Step 3: Implement reminder-config-service.ts**

```typescript
// apps/api/src/services/reminder-config-service.ts
import { pool } from "../db/pool.js";

export interface ReminderConfig {
  id: string;
  user_id: string;
  config_key: string;
  reminder_type: "birthday" | "anniversary" | "custom";
  custom_label: string | null;
  enabled: boolean;
  capture_enabled: boolean;
  capture_template_name: string | null;
  capture_template_lang: string;
  capture_template_vars: Record<string, unknown>;
  capture_flow_id: string | null;
  capture_trigger_type: "create" | "update" | "both";
  capture_conditions_json: unknown[];
  retry_interval_days: number;
  retry_max_count: number;
  cooldown_days: number;
  campaign_enabled: boolean;
  campaign_template_name: string | null;
  campaign_template_lang: string;
  campaign_template_vars: Record<string, unknown>;
  campaign_conditions_json: unknown[];
  campaign_send_time: string;
  campaign_days_before: number;
  campaign_timezone: string;
  created_at: string;
  updated_at: string;
}

export interface ReminderConfigInput {
  configKey: string;
  reminderType: "birthday" | "anniversary" | "custom";
  customLabel?: string | null;
  enabled?: boolean;
  captureEnabled?: boolean;
  captureTemplateName?: string | null;
  captureTemplateLang?: string;
  captureTemplateVars?: Record<string, unknown>;
  captureFlowId?: string | null;
  captureTriggerType?: "create" | "update" | "both";
  captureConditionsJson?: unknown[];
  retryIntervalDays?: number;
  retryMaxCount?: number;
  cooldownDays?: number;
  campaignEnabled?: boolean;
  campaignTemplateName?: string | null;
  campaignTemplateLang?: string;
  campaignTemplateVars?: Record<string, unknown>;
  campaignConditionsJson?: unknown[];
  campaignSendTime?: string;
  campaignDaysBefore?: number;
  campaignTimezone?: string;
}

const DEFAULT_CONFIGS: Array<{ config_key: string; reminder_type: ReminderConfig["reminder_type"] }> = [
  { config_key: "birthday", reminder_type: "birthday" },
  { config_key: "anniversary", reminder_type: "anniversary" }
];

export async function listReminderConfigs(userId: string): Promise<ReminderConfig[]> {
  const existing = await pool.query<ReminderConfig>(
    `SELECT * FROM reminder_configs WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );

  if (existing.rows.length === 0) {
    for (const def of DEFAULT_CONFIGS) {
      await pool.query(
        `INSERT INTO reminder_configs (user_id, config_key, reminder_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, config_key) DO NOTHING`,
        [userId, def.config_key, def.reminder_type]
      );
    }
    const seeded = await pool.query<ReminderConfig>(
      `SELECT * FROM reminder_configs WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    return seeded.rows;
  }

  return existing.rows;
}

export async function upsertReminderConfig(
  userId: string,
  input: ReminderConfigInput
): Promise<ReminderConfig> {
  const result = await pool.query<ReminderConfig>(
    `INSERT INTO reminder_configs (
       user_id, config_key, reminder_type, custom_label, enabled,
       capture_enabled, capture_template_name, capture_template_lang, capture_template_vars,
       capture_flow_id, capture_trigger_type, capture_conditions_json,
       retry_interval_days, retry_max_count, cooldown_days,
       campaign_enabled, campaign_template_name, campaign_template_lang, campaign_template_vars,
       campaign_conditions_json, campaign_send_time, campaign_days_before, campaign_timezone,
       updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19,
       $20, $21, $22, $23,
       now()
     )
     ON CONFLICT (user_id, config_key) DO UPDATE SET
       reminder_type           = EXCLUDED.reminder_type,
       custom_label            = EXCLUDED.custom_label,
       enabled                 = EXCLUDED.enabled,
       capture_enabled         = EXCLUDED.capture_enabled,
       capture_template_name   = EXCLUDED.capture_template_name,
       capture_template_lang   = EXCLUDED.capture_template_lang,
       capture_template_vars   = EXCLUDED.capture_template_vars,
       capture_flow_id         = EXCLUDED.capture_flow_id,
       capture_trigger_type    = EXCLUDED.capture_trigger_type,
       capture_conditions_json = EXCLUDED.capture_conditions_json,
       retry_interval_days     = EXCLUDED.retry_interval_days,
       retry_max_count         = EXCLUDED.retry_max_count,
       cooldown_days           = EXCLUDED.cooldown_days,
       campaign_enabled        = EXCLUDED.campaign_enabled,
       campaign_template_name  = EXCLUDED.campaign_template_name,
       campaign_template_lang  = EXCLUDED.campaign_template_lang,
       campaign_template_vars  = EXCLUDED.campaign_template_vars,
       campaign_conditions_json = EXCLUDED.campaign_conditions_json,
       campaign_send_time      = EXCLUDED.campaign_send_time,
       campaign_days_before    = EXCLUDED.campaign_days_before,
       campaign_timezone       = EXCLUDED.campaign_timezone,
       updated_at              = now()
     RETURNING *`,
    [
      userId,
      input.configKey,
      input.reminderType,
      input.customLabel ?? null,
      input.enabled ?? false,
      input.captureEnabled ?? true,
      input.captureTemplateName ?? null,
      input.captureTemplateLang ?? "en",
      JSON.stringify(input.captureTemplateVars ?? {}),
      input.captureFlowId ?? null,
      input.captureTriggerType ?? "create",
      JSON.stringify(input.captureConditionsJson ?? []),
      input.retryIntervalDays ?? 7,
      input.retryMaxCount ?? 1,
      input.cooldownDays ?? 30,
      input.campaignEnabled ?? true,
      input.campaignTemplateName ?? null,
      input.campaignTemplateLang ?? "en",
      JSON.stringify(input.campaignTemplateVars ?? {}),
      JSON.stringify(input.campaignConditionsJson ?? []),
      input.campaignSendTime ?? "09:00",
      input.campaignDaysBefore ?? 0,
      input.campaignTimezone ?? "Asia/Kolkata"
    ]
  );
  return result.rows[0];
}

export async function deleteReminderConfig(userId: string, configKey: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM reminder_configs
     WHERE user_id = $1 AND config_key = $2 AND reminder_type = 'custom'`,
    [userId, configKey]
  );
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/services/reminder-config-service.test.ts
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/reminder-config-service.ts apps/api/src/services/reminder-config-service.test.ts
git commit -m "feat: add reminder-config-service (CRUD for reminder_configs)"
```

---

## Task 3: Add reminder-dispatch Queue

**Files:**
- Modify: `apps/api/src/services/queue-service.ts`

- [ ] **Step 1: Add `"reminder-dispatch"` to managedQueueNames**

In `apps/api/src/services/queue-service.ts`, find:

```typescript
export const managedQueueNames = [
  "campaign-dispatch",
  "campaign-message-send",
  "sequence-enrollment-run",
  "sequence-enrollment-retry",
  "delivery-webhook-process",
  "outbound-execution",
  "outbound-qr-execution",
  "daily-report"
] as const;
```

Replace with:

```typescript
export const managedQueueNames = [
  "campaign-dispatch",
  "campaign-message-send",
  "sequence-enrollment-run",
  "sequence-enrollment-retry",
  "delivery-webhook-process",
  "outbound-execution",
  "outbound-qr-execution",
  "daily-report",
  "reminder-dispatch"
] as const;
```

- [ ] **Step 2: Add the getter function**

In `apps/api/src/services/queue-service.ts`, find the last `export function get...Queue` function (e.g., `getDailyReportQueue`) and add after it:

```typescript
export function getReminderDispatchQueue(): Queue | null {
  return getManagedQueue("reminder-dispatch");
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no type errors related to queue-service.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/queue-service.ts
git commit -m "feat: add reminder-dispatch BullMQ queue"
```

---

## Task 4: reminder-capture-trigger-service.ts

**Files:**
- Create: `apps/api/src/services/reminder-capture-trigger-service.ts`
- Create: `apps/api/src/services/reminder-capture-trigger-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/reminder-capture-trigger-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({
  pool: { query: vi.fn() }
}));
vi.mock("./sequence-condition-service.js", () => ({
  evaluateSequenceConditions: vi.fn()
}));
vi.mock("./channel-outbound-service.js", () => ({
  sendTemplateToPhone: vi.fn()
}));

import { pool } from "../db/pool.js";
import { evaluateSequenceConditions } from "./sequence-condition-service.js";
import { processReminderCaptureEvent } from "./reminder-capture-trigger-service.js";

const mockQuery = vi.mocked(pool.query);
const mockEvaluate = vi.mocked(evaluateSequenceConditions);

beforeEach(() => {
  mockQuery.mockReset();
  mockEvaluate.mockReset();
});

describe("processReminderCaptureEvent", () => {
  const baseContact = {
    id: "contact-1",
    user_id: "user-1",
    display_name: "Test User",
    phone_number: "919999999999",
    email: null,
    contact_type: "customer",
    tags: [],
    source_type: "manual",
    source_id: null,
    source_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  it("skips when no enabled reminder configs exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseContact] } as any)   // contact SELECT
      .mockResolvedValueOnce({ rows: [] } as any)               // no custom fields
      .mockResolvedValueOnce({ rows: [] } as any);              // no configs

    await processReminderCaptureEvent({
      userId: "user-1",
      event: "contact_created",
      contactId: "contact-1"
    });

    // no template send attempted
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("skips a config when trigger_type does not match event", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseContact] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{
        id: "rc-1", user_id: "user-1", config_key: "birthday",
        reminder_type: "birthday", enabled: true, capture_enabled: true,
        capture_trigger_type: "update",    // event is create → skip
        capture_conditions_json: [],
        capture_template_name: "bday_ask",
        capture_template_lang: "en",
        capture_template_vars: {},
        retry_interval_days: 7, retry_max_count: 1, cooldown_days: 30
      }] } as any);

    await processReminderCaptureEvent({
      userId: "user-1",
      event: "contact_created",
      contactId: "contact-1"
    });

    // no prompt log query — config skipped before that
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("skips when conditions do not match", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [baseContact] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{
        id: "rc-1", user_id: "user-1", config_key: "birthday",
        reminder_type: "birthday", enabled: true, capture_enabled: true,
        capture_trigger_type: "create",
        capture_conditions_json: [{ field: "contact_type", operator: "eq", value: "VIP" }],
        capture_template_name: "bday_ask",
        capture_template_lang: "en",
        capture_template_vars: {},
        retry_interval_days: 7, retry_max_count: 1, cooldown_days: 30
      }] } as any);

    mockEvaluate.mockReturnValue(false);

    await processReminderCaptureEvent({
      userId: "user-1",
      event: "contact_created",
      contactId: "contact-1"
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    // no session INSERT
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/services/reminder-capture-trigger-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement reminder-capture-trigger-service.ts**

```typescript
// apps/api/src/services/reminder-capture-trigger-service.ts
import { pool } from "../db/pool.js";
import {
  evaluateSequenceConditions,
  type SequenceContactSnapshot
} from "./sequence-condition-service.js";
import type { SequenceEventType } from "./sequence-event-service.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";

interface ReminderConfigRow {
  id: string;
  user_id: string;
  config_key: string;
  reminder_type: string;
  enabled: boolean;
  capture_enabled: boolean;
  capture_trigger_type: "create" | "update" | "both";
  capture_conditions_json: Array<{
    field: string;
    operator: string;
    value: string;
    id?: string;
    sequence_id?: string;
    condition_type?: string;
    created_at?: string;
    updated_at?: string;
  }>;
  capture_template_name: string | null;
  capture_template_lang: string;
  capture_template_vars: Record<string, unknown>;
  retry_interval_days: number;
  retry_max_count: number;
  cooldown_days: number;
}

interface PromptLogRow {
  last_prompted_at: string;
  retry_count: number;
}

function eventMatchesTrigger(
  event: SequenceEventType,
  triggerType: ReminderConfigRow["capture_trigger_type"]
): boolean {
  if (triggerType === "both") return true;
  return (event === "contact_created" && triggerType === "create") ||
         (event === "contact_updated" && triggerType === "update");
}

function isCooldownActive(log: PromptLogRow, cooldownDays: number): boolean {
  const lastMs = Date.parse(log.last_prompted_at);
  const cutoffMs = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
  return lastMs > cutoffMs;
}

async function loadContactSnapshot(contactId: string): Promise<SequenceContactSnapshot | null> {
  const [contactResult, customFieldsResult] = await Promise.all([
    pool.query<{
      id: string; display_name: string | null; phone_number: string;
      email: string | null; contact_type: string; tags: string[];
      source_type: string; source_id: string | null; source_url: string | null;
      created_at: string; updated_at: string;
    }>(`SELECT * FROM contacts WHERE id = $1 LIMIT 1`, [contactId]),
    pool.query<{ field_name: string; value: string | null }>(
      `SELECT cf.name AS field_name, cfv.value
       FROM contact_field_values cfv
       JOIN contact_fields cf ON cf.id = cfv.field_id
       WHERE cfv.contact_id = $1`,
      [contactId]
    )
  ]);

  const contact = contactResult.rows[0];
  if (!contact) return null;

  return {
    ...contact,
    custom_fields: Object.fromEntries(
      customFieldsResult.rows.map((r) => [r.field_name, r.value])
    )
  };
}

async function sendPermissionTemplate(input: {
  userId: string;
  phoneNumber: string;
  templateName: string;
  templateLang: string;
  configKey: string;
}): Promise<{ conversationId: string }> {
  const conversation = await getOrCreateConversation(input.userId, input.phoneNumber, {
    channelType: "api"
  });
  await sendConversationFlowMessage({
    userId: input.userId,
    conversationId: conversation.id,
    payload: {
      type: "template",
      templateName: input.templateName,
      language: input.templateLang,
      buttons: [
        { id: `start_flow_${input.configKey}`, title: "Yes, sure!" },
        { id: "not_now", title: "Not now" }
      ]
    }
  });
  return { conversationId: conversation.id };
}

export async function processReminderCaptureEvent(input: {
  userId: string;
  event: SequenceEventType;
  contactId: string;
}): Promise<void> {
  const snapshot = await loadContactSnapshot(input.contactId);
  if (!snapshot) return;

  const configResult = await pool.query<ReminderConfigRow>(
    `SELECT * FROM reminder_configs
     WHERE user_id = $1 AND enabled = true AND capture_enabled = true`,
    [input.userId]
  );

  for (const config of configResult.rows) {
    try {
      if (!eventMatchesTrigger(input.event, config.capture_trigger_type)) continue;

      const normalizedConditions = config.capture_conditions_json.map((c) => ({
        id: c.id ?? "",
        sequence_id: c.sequence_id ?? "",
        condition_type: (c.condition_type ?? "start") as "start",
        field: c.field,
        operator: c.operator as "eq" | "neq" | "gt" | "lt" | "contains",
        value: c.value,
        created_at: c.created_at ?? new Date().toISOString(),
        updated_at: c.updated_at ?? new Date().toISOString()
      }));

      if (!evaluateSequenceConditions(normalizedConditions, snapshot)) continue;

      // Check cooldown/retry
      const logResult = await pool.query<PromptLogRow>(
        `SELECT last_prompted_at, retry_count FROM reminder_prompt_log
         WHERE user_id = $1 AND contact_id = $2 AND config_key = $3`,
        [input.userId, input.contactId, config.config_key]
      );
      const log = logResult.rows[0];

      if (log) {
        if (isCooldownActive(log, config.cooldown_days)) continue;
        if (log.retry_count >= config.retry_max_count) continue;
      }

      // Check no active session
      const sessionCheck = await pool.query(
        `SELECT id FROM reminder_capture_sessions
         WHERE conversation_id IN (
           SELECT id FROM conversations WHERE user_id = $1 AND phone_number = $2 LIMIT 1
         ) AND status = 'active' LIMIT 1`,
        [input.userId, snapshot.phone_number]
      );
      if (sessionCheck.rows.length > 0) continue;

      if (!config.capture_template_name) continue;

      const { conversationId } = await sendPermissionTemplate({
        userId: input.userId,
        phoneNumber: snapshot.phone_number,
        templateName: config.capture_template_name,
        templateLang: config.capture_template_lang,
        configKey: config.config_key
      });

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await pool.query(
        `INSERT INTO reminder_capture_sessions
           (user_id, contact_id, conversation_id, config_key, state, status, expires_at)
         VALUES ($1, $2, $3, $4, 'ASK_PERMISSION', 'active', $5)
         ON CONFLICT DO NOTHING`,
        [input.userId, input.contactId, conversationId, config.config_key, expiresAt]
      );

      await pool.query(
        `INSERT INTO reminder_prompt_log (user_id, contact_id, config_key, last_prompted_at, retry_count)
         VALUES ($1, $2, $3, now(), 1)
         ON CONFLICT (user_id, contact_id, config_key) DO UPDATE
           SET last_prompted_at = now(),
               retry_count = reminder_prompt_log.retry_count + 1`,
        [input.userId, input.contactId, config.config_key]
      );
    } catch (err) {
      console.warn(`[ReminderCapture] config ${config.config_key} failed for contact ${input.contactId}`, err);
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/services/reminder-capture-trigger-service.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/reminder-capture-trigger-service.ts apps/api/src/services/reminder-capture-trigger-service.test.ts
git commit -m "feat: add reminder-capture-trigger-service"
```

---

## Task 5: reminder-capture-session-service.ts

**Files:**
- Create: `apps/api/src/services/reminder-capture-session-service.ts`
- Create: `apps/api/src/services/reminder-capture-session-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/reminder-capture-session-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({
  pool: { query: vi.fn() }
}));

import { pool } from "../db/pool.js";
import {
  getActiveCaptureSession,
  handleCaptureSessionReply,
  type CaptureSession
} from "./reminder-capture-session-service.js";

const mockQuery = vi.mocked(pool.query);

beforeEach(() => mockQuery.mockReset());

describe("getActiveCaptureSession", () => {
  it("returns null when no active session exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const result = await getActiveCaptureSession("conv-1");
    expect(result).toBeNull();
  });

  it("returns the active session row", async () => {
    const mockSession = { id: "sess-1", conversation_id: "conv-1", status: "active", state: "ASK_PERMISSION", config_key: "birthday" };
    mockQuery.mockResolvedValueOnce({ rows: [mockSession] } as any);
    const result = await getActiveCaptureSession("conv-1");
    expect(result?.id).toBe("sess-1");
  });
});

describe("handleCaptureSessionReply", () => {
  const baseSession: CaptureSession = {
    id: "sess-1",
    user_id: "user-1",
    contact_id: "contact-1",
    conversation_id: "conv-1",
    config_key: "birthday",
    state: "ASK_PERMISSION",
    status: "active",
    retry_count: 0,
    context: {},
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  it("marks session complete when YES payload received", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ capture_flow_id: "flow-1" }] } as any) // config lookup
      .mockResolvedValueOnce({ rows: [] } as any);  // session UPDATE

    await handleCaptureSessionReply(baseSession, "start_flow_birthday");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateCall = mockQuery.mock.calls[1][0] as string;
    expect(updateCall).toContain("complete");
  });

  it("marks session cancelled and updates cooldown on NOT NOW reply", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)  // session UPDATE
      .mockResolvedValueOnce({ rows: [] } as any); // prompt_log cooldown reset

    await handleCaptureSessionReply(baseSession, "not_now");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateCall = mockQuery.mock.calls[0][0] as string;
    expect(updateCall).toContain("cancelled");
  });

  it("does nothing for unrecognized messages", async () => {
    await handleCaptureSessionReply(baseSession, "hello there");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && npx vitest run src/services/reminder-capture-session-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement reminder-capture-session-service.ts**

```typescript
// apps/api/src/services/reminder-capture-session-service.ts
import { pool } from "../db/pool.js";
import { startFlowForConversation } from "./flow-engine-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";
import type { FlowMessagePayload } from "./outbound-message-types.js";

export interface CaptureSession {
  id: string;
  user_id: string;
  contact_id: string;
  conversation_id: string;
  config_key: string;
  state: "ASK_PERMISSION" | "COMPLETE" | "CANCELLED" | "EXPIRED" | "FAILED";
  status: "active" | "complete" | "cancelled" | "expired" | "failed";
  retry_count: number;
  context: Record<string, unknown>;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export async function getActiveCaptureSession(
  conversationId: string
): Promise<CaptureSession | null> {
  const result = await pool.query<CaptureSession>(
    `SELECT * FROM reminder_capture_sessions
     WHERE conversation_id = $1 AND status = 'active'
     LIMIT 1`,
    [conversationId]
  );
  return result.rows[0] ?? null;
}

function isYesPayload(message: string, configKey: string): boolean {
  return message.trim().toLowerCase() === `start_flow_${configKey}`;
}

function isDeclineMessage(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return lower === "not_now" || lower === "no" || lower === "not now";
}

export async function handleCaptureSessionReply(
  session: CaptureSession,
  message: string
): Promise<void> {
  if (isYesPayload(message, session.config_key)) {
    const configResult = await pool.query<{ capture_flow_id: string | null }>(
      `SELECT capture_flow_id FROM reminder_configs
       WHERE user_id = $1 AND config_key = $2`,
      [session.user_id, session.config_key]
    );
    const flowId = configResult.rows[0]?.capture_flow_id;

    if (flowId) {
      try {
        const sendReply = async (payload: FlowMessagePayload) => {
          await sendConversationFlowMessage({
            userId: session.user_id,
            conversationId: session.conversation_id,
            payload
          });
        };
        await startFlowForConversation({
          userId: session.user_id,
          flowId,
          conversationId: session.conversation_id,
          sendReply
        });
      } catch (err) {
        console.warn(`[ReminderSession] flow trigger failed for session ${session.id}`, err);
      }
    }

    await pool.query(
      `UPDATE reminder_capture_sessions
       SET state = 'COMPLETE', status = 'complete', updated_at = now()
       WHERE id = $1`,
      [session.id]
    );
    return;
  }

  if (isDeclineMessage(message)) {
    await pool.query(
      `UPDATE reminder_capture_sessions
       SET state = 'CANCELLED', status = 'cancelled', updated_at = now()
       WHERE id = $1`,
      [session.id]
    );

    await pool.query(
      `UPDATE reminder_prompt_log
       SET last_prompted_at = now()
       WHERE user_id = $1 AND contact_id = $2 AND config_key = $3`,
      [session.user_id, session.contact_id, session.config_key]
    );
  }
}

export async function expireStaleCaptureSessions(): Promise<number> {
  const result = await pool.query(
    `UPDATE reminder_capture_sessions
     SET state = 'EXPIRED', status = 'expired', updated_at = now()
     WHERE expires_at < now() AND status = 'active'`
  );
  return result.rowCount ?? 0;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && npx vitest run src/services/reminder-capture-session-service.test.ts
```

Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/reminder-capture-session-service.ts apps/api/src/services/reminder-capture-session-service.test.ts
git commit -m "feat: add reminder-capture-session-service (state machine)"
```

---

## Task 6: Hook into contacts-service.ts

**Files:**
- Modify: `apps/api/src/services/contacts-service.ts`

- [ ] **Step 1: Add `emitReminderCaptureEvent` helper after `emitSequenceContactEvent`**

In `apps/api/src/services/contacts-service.ts`, find the function `emitSequenceContactEvent` ending around line 183:

```typescript
async function emitSequenceContactEvent(result: ContactUpsertResult): Promise<void> {
  if (result.action === "skipped") {
    return;
  }
  try {
    const { processSequenceEvent } = await import("./sequence-event-service.js");
    await processSequenceEvent({
      userId: result.contact.user_id,
      event: result.action === "created" ? "contact_created" : "contact_updated",
      contactId: result.contact.id
    });
  } catch (error) {
    console.warn("[Sequence] contact event processing failed", error);
  }
}
```

Add the following function directly after it:

```typescript
async function emitReminderCaptureEvent(result: ContactUpsertResult): Promise<void> {
  if (result.action === "skipped") {
    return;
  }
  try {
    const { processReminderCaptureEvent } = await import("./reminder-capture-trigger-service.js");
    await processReminderCaptureEvent({
      userId: result.contact.user_id,
      event: result.action === "created" ? "contact_created" : "contact_updated",
      contactId: result.contact.id
    });
  } catch (error) {
    console.warn("[ReminderCapture] contact event processing failed", error);
  }
}
```

- [ ] **Step 2: Add `emitReminderCaptureEvent` at all 6 callsites of `emitSequenceContactEvent`**

Search the file for every line containing `await emitSequenceContactEvent(` — there are 6. After each one, add a matching `await emitReminderCaptureEvent(` call with the same argument.

Example — around line 1105:

Before:
```typescript
  await emitSequenceContactEvent(hydratedResult);
  return hydratedResult;
```

After:
```typescript
  await emitSequenceContactEvent(hydratedResult);
  await emitReminderCaptureEvent(hydratedResult);
  return hydratedResult;
```

Repeat this pattern for the remaining 5 callsites (lines approximately 1215, 1267, 1305, 1560, 1828 in the original file).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Run contacts service tests**

```bash
cd apps/api && npx vitest run src/services/contacts-service.test.ts
```

Expected: existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/contacts-service.ts
git commit -m "feat: fire reminder capture event on contact create/update"
```

---

## Task 7: Hook into message-router-service.ts

**Files:**
- Modify: `apps/api/src/services/message-router-service.ts`

- [ ] **Step 1: Add import for session check at the top of the file**

In `apps/api/src/services/message-router-service.ts`, find the block of imports. Add after the last import line:

```typescript
import {
  getActiveCaptureSession,
  handleCaptureSessionReply
} from "./reminder-capture-session-service.js";
```

- [ ] **Step 2: Add session intercept before the flow engine call**

Find in the `processIncomingMessage` function the section where the flow engine runs:

```typescript
  let flowResult: import("./flow-engine-service.js").FlowHandleResult =
    await handleFlowMessage({
```

Insert the following block directly before it (after the bot-loop detection block and before the flow engine):

```typescript
  // ── Reminder capture session intercept ───────────────────────────────────────
  // If an active capture session exists for this conversation, handle the reply
  // and skip the rest of the message processing pipeline.
  const activeCaptureSession = await getActiveCaptureSession(conversation.id);
  if (activeCaptureSession) {
    await handleCaptureSessionReply(activeCaptureSession, normalizedMessage);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "sent"
    };
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/message-router-service.ts
git commit -m "feat: intercept reminder capture session replies in message router"
```

---

## Task 8: reminder-dispatch-worker-service.ts

**Files:**
- Create: `apps/api/src/services/reminder-dispatch-worker-service.ts`

- [ ] **Step 1: Implement the worker service**

```typescript
// apps/api/src/services/reminder-dispatch-worker-service.ts
import { Worker } from "bullmq";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { createQueueWorkerConnection, getReminderDispatchQueue } from "./queue-service.js";
import { expireStaleCaptureSessions } from "./reminder-capture-session-service.js";
import { getOrCreateConversation } from "./conversation-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";

interface ReminderDispatchJob {
  userId: string;
}

interface ReminderConfigRow {
  id: string;
  user_id: string;
  config_key: string;
  campaign_enabled: boolean;
  campaign_template_name: string | null;
  campaign_template_lang: string;
  campaign_template_vars: Record<string, { source: "contact" | "static"; field?: string; value?: string }>;
  campaign_conditions_json: unknown[];
  campaign_days_before: number;
  campaign_timezone: string;
}

interface ContactDateMatch {
  contact_id: string;
  phone_number: string;
  display_name: string | null;
  custom_fields: Record<string, string | null>;
}

async function resolveTemplateVars(
  contact: ContactDateMatch,
  varMapping: ReminderConfigRow["campaign_template_vars"]
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [placeholder, binding] of Object.entries(varMapping)) {
    if (binding.source === "static") {
      resolved[placeholder] = binding.value ?? "";
    } else if (binding.source === "contact" && binding.field) {
      const fieldMap: Record<string, string> = {
        display_name: contact.display_name ?? "",
        name: contact.display_name ?? "",
        phone_number: contact.phone_number
      };
      resolved[placeholder] = fieldMap[binding.field] ?? contact.custom_fields[binding.field] ?? "";
    }
  }
  return resolved;
}

async function processUserReminders(userId: string): Promise<void> {
  const configResult = await pool.query<ReminderConfigRow>(
    `SELECT * FROM reminder_configs
     WHERE user_id = $1 AND enabled = true AND campaign_enabled = true`,
    [userId]
  );

  const currentYear = new Date().getFullYear();

  for (const config of configResult.rows) {
    if (!config.campaign_template_name) continue;

    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + config.campaign_days_before);
      const targetMonth = targetDate.getMonth() + 1;
      const targetDay = targetDate.getDate();

      // Find contact field id for this config_key
      const fieldResult = await pool.query<{ id: string }>(
        `SELECT id FROM contact_fields WHERE user_id = $1 AND name = $2 LIMIT 1`,
        [userId, config.config_key]
      );
      const fieldId = fieldResult.rows[0]?.id;
      if (!fieldId) continue;

      // Find matching contacts (date month+day match, not already sent this year)
      const contactsResult = await pool.query<ContactDateMatch>(
        `SELECT
           c.id AS contact_id,
           c.phone_number,
           c.display_name,
           (
             SELECT jsonb_object_agg(cf2.name, cfv2.value)
             FROM contact_field_values cfv2
             JOIN contact_fields cf2 ON cf2.id = cfv2.field_id
             WHERE cfv2.contact_id = c.id
           ) AS custom_fields
         FROM contacts c
         JOIN contact_field_values cfv ON cfv.contact_id = c.id
         WHERE c.user_id = $1
           AND cfv.field_id = $2
           AND EXTRACT(MONTH FROM cfv.value::date) = $3
           AND EXTRACT(DAY   FROM cfv.value::date) = $4
           AND c.id NOT IN (
             SELECT contact_id FROM reminder_dispatch_log
             WHERE user_id = $1 AND config_key = $5 AND campaign_year = $6
           )`,
        [userId, fieldId, targetMonth, targetDay, config.config_key, currentYear]
      );

      for (const contact of contactsResult.rows) {
        try {
          const resolvedVars = await resolveTemplateVars(
            { ...contact, custom_fields: (contact.custom_fields as Record<string, string | null>) ?? {} },
            config.campaign_template_vars
          );

          const conversation = await getOrCreateConversation(userId, contact.phone_number, {
            channelType: "api"
          });
          await sendConversationFlowMessage({
            userId,
            conversationId: conversation.id,
            payload: {
              type: "template",
              templateName: config.campaign_template_name!,
              language: config.campaign_template_lang,
              components: Object.entries(resolvedVars).map(([key, value]) => ({
                type: "body",
                parameters: [{ type: "text", parameter_name: key, text: value }]
              }))
            }
          });

          await pool.query(
            `INSERT INTO reminder_dispatch_log
               (user_id, contact_id, config_key, campaign_year, template_name, status)
             VALUES ($1, $2, $3, $4, $5, 'sent')
             ON CONFLICT DO NOTHING`,
            [userId, contact.contact_id, config.config_key, currentYear, config.campaign_template_name]
          );

          console.log(`[ReminderDispatch] Sent ${config.config_key} to ${contact.phone_number}`);
        } catch (err) {
          console.error(`[ReminderDispatch] Failed to send to contact ${contact.contact_id}`, err);
        }
      }
    } catch (err) {
      console.error(`[ReminderDispatch] Config ${config.config_key} failed for user ${userId}`, err);
    }
  }

  await expireStaleCaptureSessions();
}

async function enqueueAllUserReminders(): Promise<void> {
  const queue = getReminderDispatchQueue();
  if (!queue) {
    console.warn("[ReminderDispatch] Queue unavailable — Redis not configured");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT rc.user_id AS id
     FROM reminder_configs rc
     WHERE rc.enabled = true AND rc.campaign_enabled = true`
  );

  for (const user of rows) {
    const jobId = `reminder-dispatch-${user.id}-${today}`;
    await queue.add(
      "dispatch-reminders",
      { userId: user.id },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 1000
      }
    );
  }

  console.log(`[ReminderDispatch] Enqueued ${rows.length} reminder job(s) for ${today}`);
}

function scheduleDailyCron(): void {
  const now = new Date();
  const next = new Date();
  // Run at 00:05 UTC daily (before per-user send times)
  next.setUTCHours(0, 5, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntilNext = next.getTime() - now.getTime();

  cronTimer = setTimeout(async () => {
    try {
      await enqueueAllUserReminders();
    } catch (err) {
      console.error("[ReminderDispatch] Cron enqueue error", err);
    }
    scheduleDailyCron();
  }, msUntilNext);

  console.log(`[ReminderDispatch] Next cron in ${Math.round(msUntilNext / 60000)} minutes`);
}

let dispatchWorker: Worker<ReminderDispatchJob> | null = null;
let cronTimer: ReturnType<typeof setTimeout> | null = null;

export function startReminderDispatchWorker(): void {
  const connection = createQueueWorkerConnection();
  if (!connection) {
    console.warn("[ReminderDispatch] Worker not started — Redis not configured");
    return;
  }

  dispatchWorker = new Worker<ReminderDispatchJob>(
    "reminder-dispatch",
    async (job) => {
      const { userId } = job.data;
      await processUserReminders(userId);
    },
    {
      connection,
      prefix: env.QUEUE_PREFIX?.trim() || undefined,
      concurrency: 3
    }
  );

  dispatchWorker.on("completed", (job) =>
    console.log(`[ReminderDispatch] Job completed: ${job.id}`)
  );
  dispatchWorker.on("failed", (job, err) =>
    console.error(`[ReminderDispatch] Job failed: ${job?.id}`, err)
  );

  scheduleDailyCron();
}

export async function stopReminderDispatchWorker(): Promise<void> {
  if (cronTimer) { clearTimeout(cronTimer); cronTimer = null; }
  if (dispatchWorker) { await dispatchWorker.close(); dispatchWorker = null; }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/reminder-dispatch-worker-service.ts
git commit -m "feat: add reminder-dispatch BullMQ worker with daily cron"
```

---

## Task 9: API Routes

**Files:**
- Create: `apps/api/src/routes/reminder.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create the route file**

```typescript
// apps/api/src/routes/reminder.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listReminderConfigs,
  upsertReminderConfig,
  deleteReminderConfig
} from "../services/reminder-config-service.js";

const TemplateVarBindingSchema = z.object({
  source: z.enum(["contact", "static"]),
  field: z.string().optional(),
  value: z.string().optional()
});

const ReminderConfigWriteSchema = z.object({
  reminderType: z.enum(["birthday", "anniversary", "custom"]),
  customLabel: z.string().trim().max(100).optional().nullable(),
  enabled: z.boolean().optional(),
  captureEnabled: z.boolean().optional(),
  captureTemplateName: z.string().trim().max(100).optional().nullable(),
  captureTemplateLang: z.string().trim().max(10).optional(),
  captureTemplateVars: z.record(z.string(), TemplateVarBindingSchema).optional(),
  captureFlowId: z.string().uuid().optional().nullable(),
  captureTriggerType: z.enum(["create", "update", "both"]).optional(),
  captureConditionsJson: z.array(z.object({
    field: z.string(),
    operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
    value: z.string()
  })).optional(),
  retryIntervalDays: z.number().int().min(1).max(365).optional(),
  retryMaxCount: z.number().int().min(0).max(5).optional(),
  cooldownDays: z.number().int().min(1).max(365).optional(),
  campaignEnabled: z.boolean().optional(),
  campaignTemplateName: z.string().trim().max(100).optional().nullable(),
  campaignTemplateLang: z.string().trim().max(10).optional(),
  campaignTemplateVars: z.record(z.string(), TemplateVarBindingSchema).optional(),
  campaignConditionsJson: z.array(z.object({
    field: z.string(),
    operator: z.enum(["eq", "neq", "gt", "lt", "contains"]),
    value: z.string()
  })).optional(),
  campaignSendTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  campaignDaysBefore: z.number().int().min(0).max(30).optional(),
  campaignTimezone: z.string().trim().max(60).optional()
});

export async function reminderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/reminder/configs", { preHandler: [fastify.requireAuth] }, async (request) => {
    const configs = await listReminderConfigs(request.authUser.userId);
    return { configs };
  });

  fastify.put(
    "/api/reminder/configs/:configKey",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { configKey } = request.params as { configKey: string };
      const parsed = ReminderConfigWriteSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid reminder config payload" });
      }
      try {
        const config = await upsertReminderConfig(request.authUser.userId, {
          configKey,
          ...parsed.data
        });
        return { config };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  fastify.delete(
    "/api/reminder/configs/:configKey",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { configKey } = request.params as { configKey: string };
      const deleted = await deleteReminderConfig(request.authUser.userId, configKey);
      if (!deleted) {
        return reply.status(404).send({ error: "Config not found or not a custom type" });
      }
      return { ok: true };
    }
  );

  fastify.post(
    "/api/reminder/dispatch/run",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const { getReminderDispatchQueue } = await import("../services/queue-service.js");
      const queue = getReminderDispatchQueue();
      if (!queue) {
        return reply.status(503).send({ error: "Queue unavailable" });
      }
      const today = new Date().toISOString().slice(0, 10);
      const jobId = `reminder-dispatch-manual-${request.authUser.userId}-${today}-${Date.now()}`;
      await queue.add(
        "dispatch-reminders",
        { userId: request.authUser.userId },
        { jobId, attempts: 1 }
      );
      return { ok: true, jobId };
    }
  );
}
```

- [ ] **Step 2: Register routes in app.ts**

In `apps/api/src/app.ts`, add the import near the other route imports:

```typescript
import { reminderRoutes } from "./routes/reminder.js";
```

Then in the `buildApp()` function, add after `await sequenceRoutes(app);`:

```typescript
  await reminderRoutes(app);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/reminder.ts apps/api/src/app.ts
git commit -m "feat: add reminder API routes (configs CRUD + manual dispatch)"
```

---

## Task 10: Register Worker in worker.ts

**Files:**
- Modify: `apps/api/src/worker.ts`

- [ ] **Step 1: Add import**

In `apps/api/src/worker.ts`, add the import alongside other worker imports:

```typescript
import { startReminderDispatchWorker, stopReminderDispatchWorker } from "./services/reminder-dispatch-worker-service.js";
```

- [ ] **Step 2: Start the worker**

Find `startDailyReportWorker();` and add below it:

```typescript
startReminderDispatchWorker();
```

- [ ] **Step 3: Add to WORKERS heartbeat list**

Find:

```typescript
const WORKERS = ["campaign", "delivery-webhook", "outbound", "sequence", "daily-report"];
```

Replace with:

```typescript
const WORKERS = ["campaign", "delivery-webhook", "outbound", "sequence", "daily-report", "reminder-dispatch"];
```

- [ ] **Step 4: Add to shutdown handler**

Find `await stopDailyReportWorker();` in the `shutdown` function and add below it:

```typescript
  await stopReminderDispatchWorker();
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/worker.ts
git commit -m "feat: register reminder-dispatch worker in worker process"
```

---

## Task 11: Frontend — API Types and Functions

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/shared/dashboard/query-keys.ts`

- [ ] **Step 1: Add reminder types and API functions to lib/api.ts**

Append to the end of `apps/web/src/lib/api.ts`:

```typescript
// ─── Reminder Module ──────────────────────────────────────────────────────────

export interface TemplateVarBinding {
  source: "contact" | "static";
  field?: string;
  value?: string;
}

export interface ReminderCondition {
  field: string;
  operator: "eq" | "neq" | "gt" | "lt" | "contains";
  value: string;
}

export interface ReminderConfig {
  id: string;
  user_id: string;
  config_key: string;
  reminder_type: "birthday" | "anniversary" | "custom";
  custom_label: string | null;
  enabled: boolean;
  capture_enabled: boolean;
  capture_template_name: string | null;
  capture_template_lang: string;
  capture_template_vars: Record<string, TemplateVarBinding>;
  capture_flow_id: string | null;
  capture_trigger_type: "create" | "update" | "both";
  capture_conditions_json: ReminderCondition[];
  retry_interval_days: number;
  retry_max_count: number;
  cooldown_days: number;
  campaign_enabled: boolean;
  campaign_template_name: string | null;
  campaign_template_lang: string;
  campaign_template_vars: Record<string, TemplateVarBinding>;
  campaign_conditions_json: ReminderCondition[];
  campaign_send_time: string;
  campaign_days_before: number;
  campaign_timezone: string;
  created_at: string;
  updated_at: string;
}

export type ReminderConfigWriteInput = Partial<Omit<ReminderConfig, "id" | "user_id" | "config_key" | "created_at" | "updated_at">> & {
  reminderType: ReminderConfig["reminder_type"];
};

export function fetchReminderConfigs(token: string) {
  return apiRequest<{ configs: ReminderConfig[] }>("/api/reminder/configs", { token });
}

export function upsertReminderConfig(token: string, configKey: string, input: ReminderConfigWriteInput) {
  return apiRequest<{ config: ReminderConfig }>(`/api/reminder/configs/${configKey}`, {
    token,
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteReminderConfig(token: string, configKey: string) {
  return apiRequest<{ ok: boolean }>(`/api/reminder/configs/${configKey}`, {
    token,
    method: "DELETE"
  });
}

export function runReminderDispatch(token: string) {
  return apiRequest<{ ok: boolean; jobId: string }>("/api/reminder/dispatch/run", {
    token,
    method: "POST"
  });
}
```

- [ ] **Step 2: Add reminder query keys to query-keys.ts**

In `apps/web/src/shared/dashboard/query-keys.ts`, find the last line before the closing of the `dashboardQueryKeys` object and add:

```typescript
  // add after reportsRoot/dailyReports/notificationSettings:
  reminderRoot: ["dashboard", "reminder"] as const,
  reminderConfigs: ["dashboard", "reminder", "configs"] as const,
  reminderConfig: (configKey: string) => ["dashboard", "reminder", "config", configKey] as const,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/shared/dashboard/query-keys.ts
git commit -m "feat: add reminder API types, functions, and query keys"
```

---

## Task 12: Frontend — TanStack Query Hooks

**Files:**
- Create: `apps/web/src/modules/dashboard/reminder/queries.ts`

- [ ] **Step 1: Create queries.ts**

```typescript
// apps/web/src/modules/dashboard/reminder/queries.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteReminderConfig,
  fetchReminderConfigs,
  upsertReminderConfig,
  type ReminderConfig,
  type ReminderConfigWriteInput
} from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";

export function useReminderConfigsQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.reminderConfigs,
    queryFn: () => fetchReminderConfigs(token).then((r) => r.configs),
    staleTime: 30_000
  });
}

export function useUpsertReminderConfigMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ configKey, input }: { configKey: string; input: ReminderConfigWriteInput }) =>
      upsertReminderConfig(token, configKey, input).then((r) => r.config),
    onSuccess: (config) => {
      queryClient.setQueryData<ReminderConfig[]>(
        dashboardQueryKeys.reminderConfigs,
        (current) => {
          if (!current) return [config];
          const idx = current.findIndex((c) => c.config_key === config.config_key);
          return idx >= 0
            ? current.map((c, i) => (i === idx ? config : c))
            : [...current, config];
        }
      );
    }
  });
}

export function useDeleteReminderConfigMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (configKey: string) => deleteReminderConfig(token, configKey),
    onSuccess: (_, configKey) => {
      queryClient.setQueryData<ReminderConfig[]>(
        dashboardQueryKeys.reminderConfigs,
        (current) => current?.filter((c) => c.config_key !== configKey)
      );
    }
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/modules/dashboard/reminder/queries.ts
git commit -m "feat: add reminder TanStack Query hooks"
```

---

## Task 13: Frontend — Register Module

**Files:**
- Modify: `apps/web/src/registry/dashboardModules.ts`

- [ ] **Step 1: Add reminder module entry**

In `apps/web/src/registry/dashboardModules.ts`, find the `sequence` entry:

```typescript
  {
    id: "sequence",
    path: "sequence/*",
    ...
  },
```

Add the reminder module entry directly after it:

```typescript
  {
    id: "reminder",
    path: "reminder/*",
    navTo: "/dashboard/reminder",
    navLabel: "Reminders",
    subtitle: "Birthday & anniversary campaigns",
    icon: "sequence",
    section: "main",
    lazyRoute: () => import("../modules/dashboard/reminder/route"),
    featureFlag: "dashboard.reminder",
    prefetchStrategy: "code+data",
    requiresAuth: true
  },
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/registry/dashboardModules.ts
git commit -m "feat: register reminder module in dashboard navigation"
```

---

## Task 14: Frontend — Overview Page (3-Card Grid)

**Files:**
- Create: `apps/web/src/modules/dashboard/reminder/route.tsx`
- Create: `apps/web/src/modules/dashboard/reminder/components/ReminderCard.tsx`

- [ ] **Step 1: Create ReminderCard.tsx**

```typescript
// apps/web/src/modules/dashboard/reminder/components/ReminderCard.tsx
import { useNavigate } from "react-router-dom";
import type { ReminderConfig } from "../../../../lib/api";

interface Props {
  config: ReminderConfig;
  icon: string;
  label: string;
}

export function ReminderCard({ config, icon, label }: Props) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 20,
        cursor: "pointer",
        background: "#fff"
      }}
      onClick={() => navigate(`/dashboard/reminder/${config.config_key}/capture`)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 24 }}>{icon}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={config.enabled}
            readOnly
          />
          <span style={{ fontSize: 12, color: "#64748b" }}>
            {config.enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#122033" }}>
        {config.custom_label ?? label}
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
        {config.reminder_type}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/dashboard/reminder/${config.config_key}/capture`);
          }}
        >
          Capture
        </button>
        <button
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer" }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/dashboard/reminder/${config.config_key}/campaign`);
          }}
        >
          Campaign
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create route.tsx (overview page + nested routes)**

```typescript
// apps/web/src/modules/dashboard/reminder/route.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthContext } from "../../../lib/auth-context";
import { useReminderConfigsQuery } from "./queries";
import { ReminderCard } from "./components/ReminderCard";

const CARD_DEFS: Array<{ config_key: string; icon: string; label: string }> = [
  { config_key: "birthday", icon: "🎂", label: "Birthday" },
  { config_key: "anniversary", icon: "💍", label: "Anniversary" }
];

function ReminderOverviewPage() {
  const { token } = useAuthContext();
  const { data: configs, isLoading, error } = useReminderConfigsQuery(token ?? "");

  if (isLoading) {
    return <div style={{ padding: 24, color: "#64748b" }}>Loading reminders...</div>;
  }

  if (error) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Failed to load reminders.</div>;
  }

  const cards = CARD_DEFS.map((def) => ({
    def,
    config: configs?.find((c) => c.config_key === def.config_key)
  })).filter((c): c is { def: typeof CARD_DEFS[0]; config: NonNullable<typeof c.config> } => Boolean(c.config));

  const customConfigs = configs?.filter((c) => c.reminder_type === "custom") ?? [];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Reminders</h1>
      <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>
        Capture dates from contacts and send birthday / anniversary campaigns automatically.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {cards.map(({ def, config }) => (
          <ReminderCard
            key={config.config_key}
            config={config}
            icon={def.icon}
            label={def.label}
          />
        ))}
        {customConfigs.map((config) => (
          <ReminderCard
            key={config.config_key}
            config={config}
            icon="📅"
            label={config.custom_label ?? config.config_key}
          />
        ))}
      </div>
    </div>
  );
}

import { lazy, Suspense } from "react";

const LazyCaptureDetail = lazy(() =>
  import("./[config_key]/capture").then((m) => ({ default: m.CapturePage }))
);
const LazyCampaignDetail = lazy(() =>
  import("./[config_key]/campaign").then((m) => ({ default: m.CampaignPage }))
);

function CaptureDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <LazyCaptureDetail />
    </Suspense>
  );
}

function CampaignDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading...</div>}>
      <LazyCampaignDetail />
    </Suspense>
  );
}

export function Component() {
  return (
    <Routes>
      <Route index element={<ReminderOverviewPage />} />
      <Route path=":configKey/capture" element={<CaptureDetailPage />} />
      <Route path=":configKey/campaign" element={<CampaignDetailPage />} />
      <Route path="*" element={<Navigate to="/dashboard/reminder" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/dashboard/reminder/route.tsx apps/web/src/modules/dashboard/reminder/components/ReminderCard.tsx
git commit -m "feat: add reminder overview page with 3-card grid"
```

---

## Task 15: Frontend — Capture Settings Page

**Files:**
- Create: `apps/web/src/modules/dashboard/reminder/[config_key]/capture.tsx`
- Create: `apps/web/src/modules/dashboard/reminder/components/CaptureSettingsForm.tsx`

- [ ] **Step 1: Create CaptureSettingsForm.tsx**

```typescript
// apps/web/src/modules/dashboard/reminder/components/CaptureSettingsForm.tsx
import { useState } from "react";
import type { ReminderConfig, ReminderConfigWriteInput } from "../../../../lib/api";

interface Props {
  config: ReminderConfig;
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

export function CaptureSettingsForm({ config, onSave, isSaving }: Props) {
  const [templateName, setTemplateName] = useState(config.capture_template_name ?? "");
  const [templateLang, setTemplateLang] = useState(config.capture_template_lang);
  const [flowId, setFlowId] = useState(config.capture_flow_id ?? "");
  const [triggerType, setTriggerType] = useState<"create" | "update" | "both">(config.capture_trigger_type);
  const [retryIntervalDays, setRetryIntervalDays] = useState(config.retry_interval_days);
  const [retryMaxCount, setRetryMaxCount] = useState(config.retry_max_count);
  const [cooldownDays, setCooldownDays] = useState(config.cooldown_days);
  const [captureEnabled, setCaptureEnabled] = useState(config.capture_enabled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      captureEnabled,
      captureTemplateName: templateName || null,
      captureTemplateLang: templateLang,
      captureFlowId: flowId || null,
      captureTriggerType: triggerType,
      retryIntervalDays,
      retryMaxCount,
      cooldownDays
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0",
    borderRadius: 6, fontSize: 13, boxSizing: "border-box"
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: "#445068", marginBottom: 4, display: "block"
  };
  const sectionStyle: React.CSSProperties = {
    background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 16
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Enable toggle */}
      <div style={{ ...sectionStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          id="captureEnabled"
          checked={captureEnabled}
          onChange={(e) => setCaptureEnabled(e.target.checked)}
        />
        <label htmlFor="captureEnabled" style={{ fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Enable Capture
        </label>
      </div>

      {/* Step 1: Template */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 1 — Permission Template
        </div>
        <label style={labelStyle}>Template Name</label>
        <input
          style={inputStyle}
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="e.g. birthday_permission_ask"
        />
        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Language Code</label>
          <input
            style={{ ...inputStyle, width: 100 }}
            value={templateLang}
            onChange={(e) => setTemplateLang(e.target.value)}
            placeholder="en"
          />
        </div>
      </div>

      {/* Step 2: Flow */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 2 — Capture Flow
        </div>
        <label style={labelStyle}>Flow ID (UUID of the linked capture flow)</label>
        <input
          style={inputStyle}
          value={flowId}
          onChange={(e) => setFlowId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
          The flow must contain a "Save to Contact Field" node that stores the date.
        </div>
      </div>

      {/* Step 3: Trigger */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 3 — Trigger
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["create", "update", "both"] as const).map((t) => (
            <button
              key={t}
              type="button"
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                border: triggerType === t ? "2px solid #6c47ff" : "1px solid #e2e8f0",
                background: triggerType === t ? "#f3f0ff" : "#fff",
                color: triggerType === t ? "#6c47ff" : "#445068",
                fontWeight: triggerType === t ? 700 : 400
              }}
              onClick={() => setTriggerType(t)}
            >
              {t === "create" ? "On Create" : t === "update" ? "On Update" : "Both"}
            </button>
          ))}
        </div>
      </div>

      {/* Step 5: Retry & Cooldown */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 5 — Retry & Cooldown
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Retry after (days)</label>
            <input
              type="number" min={1} max={365}
              style={inputStyle}
              value={retryIntervalDays}
              onChange={(e) => setRetryIntervalDays(Number(e.target.value))}
            />
          </div>
          <div>
            <label style={labelStyle}>Max retries</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n} type="button"
                  style={{
                    width: 36, height: 36, borderRadius: 6, fontSize: 13, cursor: "pointer",
                    border: retryMaxCount === n ? "2px solid #6c47ff" : "1px solid #e2e8f0",
                    background: retryMaxCount === n ? "#f3f0ff" : "#fff",
                    color: retryMaxCount === n ? "#6c47ff" : "#445068",
                    fontWeight: retryMaxCount === n ? 700 : 400
                  }}
                  onClick={() => setRetryMaxCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Cooldown (days)</label>
            <input
              type="number" min={1} max={365}
              style={inputStyle}
              value={cooldownDays}
              onChange={(e) => setCooldownDays(Number(e.target.value))}
            />
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
          Retry: no response after expiry. Cooldown: contact declined (Not Now).
        </div>
      </div>

      <button
        type="submit"
        disabled={isSaving}
        style={{
          background: "#6c47ff", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 24px", fontSize: 13,
          fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer",
          opacity: isSaving ? 0.7 : 1
        }}
      >
        {isSaving ? "Saving..." : "Save Capture Settings"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Create capture.tsx**

```typescript
// apps/web/src/modules/dashboard/reminder/[config_key]/capture.tsx
import { useParams, useNavigate } from "react-router-dom";
import { useAuthContext } from "../../../../lib/auth-context";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation } from "../queries";
import { CaptureSettingsForm } from "../components/CaptureSettingsForm";
import type { ReminderConfigWriteInput } from "../../../../lib/api";

export function CapturePage() {
  const { configKey } = useParams<{ configKey: string }>();
  const navigate = useNavigate();
  const { token } = useAuthContext();
  const { data: configs, isLoading } = useReminderConfigsQuery(token ?? "");
  const upsertMutation = useUpsertReminderConfigMutation(token ?? "");

  const config = configs?.find((c) => c.config_key === configKey);

  const handleSave = async (input: ReminderConfigWriteInput) => {
    if (!configKey) return;
    await upsertMutation.mutateAsync({ configKey, input });
  };

  if (isLoading) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  if (!config) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Reminder config not found.</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate("/dashboard/reminder")}
          style={{ fontSize: 12, color: "#6c47ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          ← Back to Reminders
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>
          {config.custom_label ?? config.config_key} — Capture Settings
        </h2>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            style={{ fontSize: 13, padding: "6px 16px", borderRadius: 6, border: "2px solid #6c47ff", background: "#f3f0ff", color: "#6c47ff", fontWeight: 700, cursor: "pointer" }}
          >
            Capture
          </button>
          <button
            style={{ fontSize: 13, padding: "6px 16px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#445068", cursor: "pointer" }}
            onClick={() => navigate(`/dashboard/reminder/${configKey}/campaign`)}
          >
            Campaign
          </button>
        </div>
      </div>

      <CaptureSettingsForm
        config={config}
        onSave={handleSave}
        isSaving={upsertMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/modules/dashboard/reminder/[config_key]/capture.tsx" apps/web/src/modules/dashboard/reminder/components/CaptureSettingsForm.tsx
git commit -m "feat: add capture settings page with form"
```

---

## Task 16: Frontend — Campaign Settings Page

**Files:**
- Create: `apps/web/src/modules/dashboard/reminder/[config_key]/campaign.tsx`
- Create: `apps/web/src/modules/dashboard/reminder/components/CampaignSettingsForm.tsx`

- [ ] **Step 1: Create CampaignSettingsForm.tsx**

```typescript
// apps/web/src/modules/dashboard/reminder/components/CampaignSettingsForm.tsx
import { useState } from "react";
import type { ReminderConfig, ReminderConfigWriteInput } from "../../../../lib/api";

interface Props {
  config: ReminderConfig;
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
  "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles",
  "Africa/Lagos", "Australia/Sydney"
];

export function CampaignSettingsForm({ config, onSave, isSaving }: Props) {
  const [templateName, setTemplateName] = useState(config.campaign_template_name ?? "");
  const [templateLang, setTemplateLang] = useState(config.campaign_template_lang);
  const [daysBefore, setDaysBefore] = useState(config.campaign_days_before);
  const [sendTime, setSendTime] = useState(config.campaign_send_time);
  const [timezone, setTimezone] = useState(config.campaign_timezone);
  const [campaignEnabled, setCampaignEnabled] = useState(config.campaign_enabled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      campaignEnabled,
      campaignTemplateName: templateName || null,
      campaignTemplateLang: templateLang,
      campaignDaysBefore: daysBefore,
      campaignSendTime: sendTime,
      campaignTimezone: timezone
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0",
    borderRadius: 6, fontSize: 13, boxSizing: "border-box"
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: "#445068", marginBottom: 4, display: "block"
  };
  const sectionStyle: React.CSSProperties = {
    background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 16
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Enable toggle */}
      <div style={{ ...sectionStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          id="campaignEnabled"
          checked={campaignEnabled}
          onChange={(e) => setCampaignEnabled(e.target.checked)}
        />
        <label htmlFor="campaignEnabled" style={{ fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Enable Campaign
        </label>
      </div>

      {/* Step 1: Template */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 1 — Campaign Template
        </div>
        <label style={labelStyle}>Template Name</label>
        <input
          style={inputStyle}
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="e.g. birthday_campaign_v1"
        />
        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>Language Code</label>
          <input
            style={{ ...inputStyle, width: 100 }}
            value={templateLang}
            onChange={(e) => setTemplateLang(e.target.value)}
            placeholder="en"
          />
        </div>
      </div>

      {/* Step 2: Timing */}
      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Step 2 — Timing
        </div>
        <label style={labelStyle}>Send N days before</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[0, 1, 2, 3].map((n) => (
            <button
              key={n} type="button"
              style={{
                width: 42, height: 36, borderRadius: 6, fontSize: 13, cursor: "pointer",
                border: daysBefore === n ? "2px solid #6c47ff" : "1px solid #e2e8f0",
                background: daysBefore === n ? "#f3f0ff" : "#fff",
                color: daysBefore === n ? "#6c47ff" : "#445068",
                fontWeight: daysBefore === n ? 700 : 400
              }}
              onClick={() => setDaysBefore(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Send Time</label>
            <input
              type="time"
              style={inputStyle}
              value={sendTime}
              onChange={(e) => setSendTime(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Timezone</label>
            <select
              style={inputStyle}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Step 4: Duplicate guard note */}
      <div style={{ ...sectionStyle, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
        <div style={{ fontSize: 12, color: "#166534" }}>
          <strong>Duplicate Guard: Always Active</strong> — Each contact receives at most one campaign per calendar year per reminder type. No configuration needed.
        </div>
      </div>

      <button
        type="submit"
        disabled={isSaving}
        style={{
          background: "#6c47ff", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 24px", fontSize: 13,
          fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer",
          opacity: isSaving ? 0.7 : 1
        }}
      >
        {isSaving ? "Saving..." : "Save Campaign Settings"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Create campaign.tsx**

```typescript
// apps/web/src/modules/dashboard/reminder/[config_key]/campaign.tsx
import { useParams, useNavigate } from "react-router-dom";
import { useAuthContext } from "../../../../lib/auth-context";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation } from "../queries";
import { CampaignSettingsForm } from "../components/CampaignSettingsForm";
import type { ReminderConfigWriteInput } from "../../../../lib/api";

export function CampaignPage() {
  const { configKey } = useParams<{ configKey: string }>();
  const navigate = useNavigate();
  const { token } = useAuthContext();
  const { data: configs, isLoading } = useReminderConfigsQuery(token ?? "");
  const upsertMutation = useUpsertReminderConfigMutation(token ?? "");

  const config = configs?.find((c) => c.config_key === configKey);

  const handleSave = async (input: ReminderConfigWriteInput) => {
    if (!configKey) return;
    await upsertMutation.mutateAsync({ configKey, input });
  };

  if (isLoading) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  if (!config) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Reminder config not found.</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate("/dashboard/reminder")}
          style={{ fontSize: 12, color: "#6c47ff", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          ← Back to Reminders
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>
          {config.custom_label ?? config.config_key} — Campaign Settings
        </h2>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            style={{ fontSize: 13, padding: "6px 16px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#445068", cursor: "pointer" }}
            onClick={() => navigate(`/dashboard/reminder/${configKey}/capture`)}
          >
            Capture
          </button>
          <button
            style={{ fontSize: 13, padding: "6px 16px", borderRadius: 6, border: "2px solid #6c47ff", background: "#f3f0ff", color: "#6c47ff", fontWeight: 700, cursor: "pointer" }}
          >
            Campaign
          </button>
        </div>
      </div>

      <CampaignSettingsForm
        config={config}
        onSave={handleSave}
        isSaving={upsertMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/modules/dashboard/reminder/[config_key]/campaign.tsx" apps/web/src/modules/dashboard/reminder/components/CampaignSettingsForm.tsx
git commit -m "feat: add campaign settings page with form"
```

---

## Task 17: End-to-End Smoke Test

**No new files** — manual verification steps.

- [ ] **Step 1: Start dev server**

```bash
cd apps/api && npm run dev
# In another terminal:
cd apps/web && npm run dev
```

- [ ] **Step 2: Verify the Reminders page loads**

Navigate to `http://localhost:5173/dashboard/reminder`. You should see Birthday and Anniversary cards in a 3-column grid.

- [ ] **Step 3: Verify Capture Settings page**

Click the Birthday card → Capture tab. The form should show template name, language, flow ID, trigger (On Create / On Update / Both), and retry/cooldown settings. Fill in a template name and click Save — should not error.

- [ ] **Step 4: Verify Campaign Settings page**

Click Campaign tab. The form should show template name, days-before pills (0/1/2/3), time picker, timezone dropdown, and the green "Duplicate Guard: Always Active" notice. Save — should not error.

- [ ] **Step 5: Verify API directly**

```bash
# Replace <token> with a valid JWT
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/reminder/configs
```

Expected: `{ configs: [ { config_key: "birthday", ... }, { config_key: "anniversary", ... } ] }`

- [ ] **Step 6: Run all API tests**

```bash
cd apps/api && npx vitest run
```

Expected: all existing tests still pass + 11 new reminder tests pass.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "feat: complete reminder module — capture + campaign + UI"
```

---

## Self-Review Checklist

- [x] **Spec §3 DB schema**: All 4 tables in migration 0075 ✓
- [x] **Spec §5 Capture Trigger**: `processReminderCaptureEvent` called from `contacts-service.ts` at all 6 callsites ✓
- [x] **Spec §5 Session State Machine**: `handleCaptureSessionReply` handles YES (triggers flow) + NO (cooldown) + unknown (ignored) ✓
- [x] **Spec §6 Campaign Dispatch**: BullMQ worker with daily cron, EXTRACT(MONTH/DAY) matching, dispatch_log dedup ✓
- [x] **Spec §7 Service Files**: All 5 service files created ✓
- [x] **Spec §8 API Routes**: GET configs, PUT config, DELETE config, POST dispatch/run ✓
- [x] **Spec §9 Frontend Files**: All files created, `route.tsx` uses nested Routes ✓
- [x] **Spec §10 Capture Fields**: template_name, template_lang, flow_id, trigger_type, retry_interval_days, retry_max_count, cooldown_days ✓
- [x] **Spec §11 Campaign Fields**: template_name, template_lang, days_before, send_time, timezone, duplicate-guard note ✓
- [x] **Spec §12 Dedup**: `UNIQUE(user_id, contact_id, config_key, campaign_year)` in dispatch_log ✓
- [x] **Spec §12 Session isolation**: Partial unique index `WHERE status = 'active'` ✓
- [x] **Spec §4 Date storage**: Reuses `contact_field_values` — no new storage table ✓
