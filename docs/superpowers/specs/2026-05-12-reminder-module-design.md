# Reminder Module — Design Spec

**Date:** 2026-05-12  
**Status:** Approved  
**Scope:** Full engine — data capture + campaign dispatch + UI

---

## 1. Overview

The Reminder Module lets WAgen users (restaurant/business owners) automatically capture important dates (birthday, anniversary, custom) from their WhatsApp contacts and send template-based campaigns on those dates.

**Two sub-features per reminder type:**
- **Capture** — send a permission template → customer says YES → flow captures the date
- **Campaign** — daily scheduler finds matching contacts → sends template on the date

---

## 2. UI Structure

### Settings Page: `/dashboard/reminder`

Single page, three fixed cards in a 3-column grid:

| Card | config_key | reminder_type |
|---|---|---|
| 🎂 Birthday | `birthday` | `birthday` |
| 💍 Anniversary | `anniversary` | `anniversary` |
| 📅 Custom | user-defined (e.g. `kids_birthday`) | `custom` |

Each card navigates to a detail page with two tabs:
- **Capture Settings** (`/dashboard/reminder/:config_key/capture`)
- **Campaign Settings** (`/dashboard/reminder/:config_key/campaign`)

---

## 3. Database Schema

### `reminder_configs`
```sql
CREATE TABLE reminder_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_key      VARCHAR(100) NOT NULL,
  reminder_type   VARCHAR(50)  NOT NULL CHECK (reminder_type IN ('birthday','anniversary','custom')),
  custom_label    VARCHAR(100),
  enabled         BOOLEAN NOT NULL DEFAULT false,

  -- Capture
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

  -- Campaign
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
```

**`capture_conditions_json` / `campaign_conditions_json` structure:**
```json
[
  { "field": "contact_type", "operator": "eq",       "value": "customer" },
  { "field": "tags",         "operator": "contains", "value": "VIP"      },
  { "field": "custom:birthday", "operator": "eq",    "value": ""         }
]
```

**`campaign_template_vars` structure:**
```json
{
  "contact.name":     { "source": "contact", "field": "display_name" },
  "offer.discount":   { "source": "static",  "value": "20%" },
  "business.name":    { "source": "static",  "value": "AnyBelly Restaurant" }
}
```

---

### `reminder_capture_sessions`
```sql
CREATE TABLE reminder_capture_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  contact_id       UUID NOT NULL,
  conversation_id  UUID NOT NULL,
  config_key       VARCHAR(100) NOT NULL,
  state            VARCHAR(30) NOT NULL
                     CHECK (state IN ('ASK_PERMISSION','ASK_DATE','CONFIRM',
                                      'COMPLETE','CANCELLED','EXPIRED','FAILED')),
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
```

---

### `reminder_prompt_log`
```sql
CREATE TABLE reminder_prompt_log (
  user_id          UUID NOT NULL,
  contact_id       UUID NOT NULL,
  config_key       VARCHAR(100) NOT NULL,
  last_prompted_at TIMESTAMPTZ NOT NULL,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, contact_id, config_key)
);
```

---

### `reminder_dispatch_log`
```sql
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

*Duplicate guard: `UNIQUE(user_id, contact_id, config_key, campaign_year)` prevents sending twice in the same calendar year.*

---

## 4. Data Storage

Captured dates are stored in the **existing** `contact_field_values` table using the existing `DATE` field type. No new storage column needed.

The WAgen user must ensure a `contact_fields` row exists for each reminder type (e.g. `name: "birthday"`, `field_type: "DATE"`). The capture flow saves to this field via the existing "Save to Contact Field" flow block.

---

## 5. Capture Flow — Architecture

### Trigger Point — Two separate hooks

**A. Contact event → send permission template**

`sequence-event-service.ts` already fires `processSequenceEvent` on contact create/update. A new parallel call fires `processReminderCaptureEvent` at the same point:

```ts
// In the contact create/update path (same as sequences)
await processReminderCaptureEvent({
  userId,
  event,          // 'contact_created' | 'contact_updated'
  contactId
});
```

**B. Inbound message → handle session reply**

`message-router-service.ts` → `processIncomingMessage()` checks for active capture session **before** the flow engine runs:

```ts
const activeSession = await getActiveCaptureSession(conversation.id);
if (activeSession) {
  await handleCaptureSessionReply(activeSession, normalizedMessage);
  return { conversationId, ..., reason: 'sent' };
}
```

### Capture Trigger Logic (`reminder-capture-trigger-service.ts`)

`processReminderCaptureEvent` runs on contact create/update:

1. Load all `reminder_configs` where `user_id = userId AND enabled = true AND capture_enabled = true`
2. For each config:
   - Check `capture_trigger_type` matches the event (`create`/`update`/`both`)
   - Evaluate `capture_conditions_json` against contact snapshot (reuses `evaluateSequenceConditions`)
   - Check `reminder_prompt_log` — cooldown not active, retry count < max
   - Check no active `reminder_capture_sessions` row for this contact
   - If all pass → send `capture_template_name` via Meta API with `capture_template_vars` mapping
   - Insert `reminder_capture_sessions` row (state: `ASK_PERMISSION`, expires_at: now + 24h)
   - Upsert `reminder_prompt_log`

### Session State Machine (`reminder-capture-session-service.ts`)

```
ASK_PERMISSION
  → customer reply = "YES" (quick-reply payload: "start_flow_<config_key>")
      → trigger linked flow (capture_flow_id) on the conversation
      → state = COMPLETE, status = complete
  → customer reply = "NOT NOW" / declined
      → state = CANCELLED, status = cancelled
      → update cooldown in reminder_prompt_log

EXPIRED (set by daily cleanup job when expires_at < now AND status = active)
  → retry_count < retry_max_count → schedule retry after retry_interval_days
  → retry_count >= retry_max_count → status = failed, no more retries
```

---

## 6. Campaign Dispatch — Architecture

### BullMQ Queue: `reminder-dispatch`

New dedicated queue. Does not share workers with sequence queue.

### Daily Scheduler (`reminder-dispatch-queue-service.ts`)
Enqueues a single `scan_and_dispatch` job at the configured `campaign_send_time` for each user. Uses `node-cron` or existing scheduler infrastructure to enqueue daily.

### Worker (`reminder-dispatch-worker-service.ts`)

```
For each enabled reminder_config (campaign_enabled = true):
  1. Compute target date:
       target = CURRENT_DATE + campaign_days_before days
  2. Query contact_field_values:
       WHERE EXTRACT(MONTH FROM value::date) = EXTRACT(MONTH FROM target)
         AND EXTRACT(DAY   FROM value::date) = EXTRACT(DAY   FROM target)
         AND field_id = <field mapped to config_key>
  3. Filter by campaign_conditions_json (evaluateSequenceConditions)
  4. Exclude contacts in reminder_dispatch_log for this year
  5. For each remaining contact:
       - Build template payload with campaign_template_vars
       - Send via Meta WhatsApp API
       - Insert reminder_dispatch_log row
  6. Cleanup: expire stale capture sessions
       UPDATE reminder_capture_sessions
       SET status = 'expired', state = 'EXPIRED'
       WHERE expires_at < now() AND status = 'active'
```

---

## 7. New Service Files

```
apps/api/src/
  routes/
    reminder.ts                          ← Fastify route handlers

  services/
    reminder-config-service.ts           ← CRUD for reminder_configs
    reminder-capture-trigger-service.ts  ← checks conditions, starts sessions
    reminder-capture-session-service.ts  ← session state machine
    reminder-dispatch-worker-service.ts  ← BullMQ worker: scan + send
    reminder-dispatch-queue-service.ts   ← enqueue jobs + daily schedule
```

---

## 8. API Routes

```
GET    /reminder/configs                   list all configs (creates defaults if none)
PUT    /reminder/configs/:config_key       upsert a config
DELETE /reminder/configs/:config_key       delete custom config

GET    /reminder/dispatch/preview          dry-run: who gets a campaign today?
POST   /reminder/dispatch/run              manual trigger (dev/admin only)
```

---

## 9. Frontend Files

```
apps/web/src/modules/dashboard/
  reminder/
    index.tsx                    /dashboard/reminder — 3-card overview
    api.ts
    queries.ts
    [config_key]/
      capture.tsx                /dashboard/reminder/:key/capture
      campaign.tsx               /dashboard/reminder/:key/campaign
    components/
      ReminderCard.tsx           overview card (enable toggle, stats)
      CaptureSettingsForm.tsx    5-step capture form
      CampaignSettingsForm.tsx   4-step campaign form
      TemplateSelector.tsx       template dropdown + preview + var mapping
      FlowSelector.tsx           flow picker list
      ConditionsBuilder.tsx      reusable condition rows (shared with Sequences UI)
      TriggerEventSelector.tsx   On Create / On Update / Both
      RetrySettings.tsx          retry pills + cooldown
      TimingSettings.tsx         days-before pills + time + timezone
      DispatchCalendarPreview.tsx upcoming dispatch preview table
```

---

## 10. Capture Settings — Fields

| Step | Field | Type |
|---|---|---|
| 1 | capture_template_name  | template selector |
| 1 | capture_template_lang  | text |
| 1 | capture_template_vars  | variable mapping (contact field or static) |
| 2 | capture_flow_id | flow picker |
| 3 | capture_trigger_type | create / update / both |
| 4 | capture_conditions_json | condition builder rows |
| 5 | retry_interval_days | number |
| 5 | retry_max_count | 0/1/2/3 pills |
| 5 | cooldown_days | number |

---

## 11. Campaign Settings — Fields

| Step | Field | Type |
|---|---|---|
| 1 | campaign_template_name | template selector |
| 1 | campaign_template_lang | text |
| 1 | campaign_template_vars | variable mapping (contact field or static) |
| 2 | campaign_days_before | 0/1/2/3 pills |
| 2 | campaign_send_time | time picker |
| 2 | campaign_timezone | timezone selector |
| 3 | campaign_conditions_json | condition builder rows |
| 4 | Duplicate guard | always-on, no config |

---

## 12. Key Constraints & Rules

- **WhatsApp compliance**: only templates are sent — no free-form messages outside 24h window
- **Date matching**: `EXTRACT(MONTH)` + `EXTRACT(DAY)` — year is ignored (recurring annually)
- **Dedup**: `UNIQUE(user_id, contact_id, config_key, campaign_year)` in dispatch_log
- **Anti-spam**: `reminder_prompt_log` tracks cooldown per contact per config_key
- **Session isolation**: partial unique index on `conversation_id WHERE status = 'active'` — one active session per chat
- **Retry**: expired sessions (no response) re-trigger template after `retry_interval_days`, up to `retry_max_count` times
- **Cooldown**: declined sessions ("Not now") block re-prompting for `cooldown_days`
- **Flow requirement**: the linked capture flow must include a "Save to Contact Field" node for the date field

---

## 13. Acceptance Criteria

- [ ] Business owner can enable Birthday / Anniversary / Custom reminder from settings page
- [ ] Permission template sends when a matching contact is created/updated
- [ ] Customer can tap YES → flow triggers → date captured in contact field
- [ ] Customer "Not now" → cooldown applied, not re-asked for configured period
- [ ] No response → retry after configured interval, up to max retries
- [ ] Daily scheduler sends campaign template to contacts whose date matches today
- [ ] Variable mapping from contact fields populates template correctly
- [ ] Duplicate guard prevents sending same campaign twice in a year
- [ ] Audience filter conditions work identically to Sequences filter engine
- [ ] Dispatch log visible in UI with sent/queued/scheduled status
