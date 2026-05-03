# Outbound Messaging Architecture

This document describes the complete send path for every outbound message type in the API.
Use it as a reference when adding a new message type, modifying retry logic, or debugging a stuck message.

---

## Message Types

| Type | Description | Queue | Channel |
|---|---|---|---|
| `conversation_api` | Freeform/template in an API WhatsApp conversation | `outbound-execution` | `api` |
| `conversation_qr` | Freeform/template via QR-linked WhatsApp session | `outbound-qr-execution` | `qr` |
| `conversation_web` | Widget/web chat conversation message | `outbound-execution` | `web` |
| `template_api` | Template send triggered via generic webhook | `outbound-execution` | `api` |
| `campaign_send` | Broadcast campaign message | `outbound-execution` | `api` |
| `sequence_send` | Sequence step send | `outbound-execution` | `api` |
| `generic_webhook` | Raw outbound webhook execution | `outbound-execution` or `outbound-qr-execution` | `api` or `qr` |

---

## Infrastructure

### Queues (BullMQ)

```
outbound-execution        — all message types except QR conversations
outbound-qr-execution     — conversation_qr and QR-mode generic_webhook
campaign-dispatch         — batch dispatch of campaign_messages → outbound-execution
```

Queue definitions: [queue-service.ts](src/services/queue-service.ts)

### Workers

| Worker | File | Handles |
|---|---|---|
| `outbound-execution` worker | `outbound-message-service.ts` | All non-QR outbound jobs |
| `outbound-qr-execution` worker | `outbound-message-service.ts` | QR-channel jobs |
| `campaign-dispatch` worker | `campaign-worker-service.ts` | Campaign batch dispatch |

### Background Timers

**Reconciliation timer** (`outbound-message-service.ts`, 60 s)
- Resets `outbound_messages` rows stuck in `processing` back to `queued` (stalled job recovery)
- Re-enqueues any `queued` outbound_messages whose `scheduled_at <= NOW()` as native BullMQ delayed jobs

**retrySweep** (`campaign-worker-service.ts`, 60 s)
- Promotes `scheduled` campaigns to `running` when `scheduled_at <= NOW()`
- Re-dispatches campaigns with webhook-retried messages (`campaign_messages.next_retry_at IS NOT NULL AND <= NOW() AND retry_count > 0`)
- Recovers `campaign_messages` stuck in `sending` for longer than `QUEUE_STALLED_JOB_TIMEOUT_MS` → resets to `queued`

---

## Database Tables

| Table | Purpose |
|---|---|
| `outbound_messages` | One row per send attempt. Central tracking table for all types. |
| `campaign_messages` | One row per recipient per campaign. Status + retry metadata. |
| `message_delivery_attempts` | One row per API dispatch attempt (wamid, status, error). |
| `webhook_status_events` | Inbound Meta delivery webhooks (sent/delivered/read/failed). |

---

## Shared Systems

### Outbound Policy (`outbound-policy-service.ts`)

Applied to every MARKETING template send. Three independent layers:

```
evaluateHardBlocks()          — suppression list, global opt-out, marketing_disabled
evaluateMarketingConsent()    — consent status (unsubscribed/revoked/missing)
evaluateFrequencyCap()        — per-template 24 h cap (routing decision, not a hard block)
```

`evaluateOutboundTemplatePolicy()` composes all three. `allowed=false` only from hard blocks
or consent failures. Frequency cap returns a routing decision:

| `frequencyCapDecision.action` | Meaning |
|---|---|
| `send` | No cap hit — proceed normally |
| `variant` | Swap to `variantTemplateId` (requires `variant_of_template_id` DB column) |
| `delay` | Re-queue at `delayUntil` (last_sent_at + 24 h) |

### Frequency Cap Redis Key

```
freq_cap:{contactId}:{templateId}   TTL: 25 h
```

- **Set** (`recordFrequencyCapSend`) — after every successful Meta API dispatch of a MARKETING template
- **Read** (`getFreqCapSentAt`) — inside `evaluateFrequencyCap` before dispatch
- **Cleared** (`clearFrequencyCapSend`) — on permanent delivery webhook failure (message failed to
  reach recipient), so the contact can be re-targeted immediately on the next manual send

Only fires for `MARKETING` category templates. UTILITY and AUTHENTICATION templates are never
capped.

### Rate Limiting (`waitForRateLimit` in `message-delivery-service.ts`)

Per-connection sliding window enforced via Redis (or in-memory fallback). Configured by
`DELIVERY_PER_CONNECTION_RATE_LIMIT` (messages/second). Called before every Meta API dispatch.

### Daily Tier Cap (`checkConnectionDailyCap`)

Meta messaging tier limits (TIER_250 / TIER_1K / TIER_10K / TIER_100K). Checked before campaign
and sequence sends. If exceeded, the message is deferred to the next UTC day.

### Grouping Lock (`withGroupingLock`)

Redis lock on `outbound-order:{groupingKey}` (30 s TTL). Prevents concurrent sends to the same
phone number within a campaign batch. Key pattern: `campaign:{e164digits}`.

### Delivery Attempt Tracking (`message-delivery-data-service.ts`)

Every API dispatch records a row in `message_delivery_attempts`. On Meta webhook receipt:
- `applyDeliveryAttemptWebhookStatusUpdate` updates the attempt row
- `applyCampaignDeliveryStatusUpdate` updates `campaign_messages` (and triggers smart retry)
- `applyConversationDeliveryStatusUpdate` updates `conversation_messages`
- `applySequenceDeliveryStatusUpdate` updates sequence enrollment state

---

## Message Type Flows

### conversation_api / conversation_qr / conversation_web

**Trigger**: User sends message in the dashboard or via API.

```
Route handler
  → insertOutboundMessage (status=queued)
  → enqueueOutboundJob (BullMQ delayed if scheduledAt set)
  → Worker picks up job
      → evaluateHardBlocks (suppression / global opt-out)
      → waitForRateLimit
      → sendTrackedApiConversationFlowMessage / dispatchTemplateMessage
      → trackOutboundMessage (conversation_messages row)
      → updateOutboundMessageState (status=completed)
  → Meta webhook arrives
      → applyConversationDeliveryStatusUpdate
      → realtimeHub broadcast
```

Retry: BullMQ automatic retry, up to 5 attempts, exponential backoff starting at 3 s.
QR channel: same path but uses `outbound-qr-execution` queue and `whatsappSessionManager`.

---

### template_api

**Trigger**: Generic webhook configuration fires, or direct API call to send a template.

```
Webhook / API route
  → insertOutboundMessage (type=template_api, status=queued, generic_webhook_log_id linked)
  → enqueueOutboundJob
  → Worker picks up job
      → evaluateOutboundTemplatePolicy (hard blocks + consent + freq cap)
      → if policy.allowed=false → mark failed, skip
      → if frequencyCapDecision.action=delay → update scheduled_at, reschedule
      → waitForRateLimit
      → dispatchTemplateMessage → Meta API → wamid returned
      → recordFrequencyCapSend (MARKETING only)
      → updateOutboundMessageState (status=completed)
      → updateGenericWebhookLog (mirrors outbound_messages status for webhook logs)
  → Meta webhook arrives
      → applyDeliveryAttemptWebhookStatusUpdate
      → if failed + MARKETING → clearFrequencyCapSend
```

Retry: BullMQ automatic, up to 5 attempts.
No smart retry (smart retry is campaign-only).

---

### campaign_send

**Trigger**: Campaign launched via `POST /api/campaigns/:id/launch`.

```
launchCampaign() — sets campaign status=running, populates campaign_messages rows
enqueueCampaign() — adds job to campaign-dispatch queue

campaign-dispatch worker → processCampaignDispatch()
  → claimQueuedCampaignMessages (batch of 25, marks status=sending)
  → for each message:
      staggerMs = (batchIndex * 25 + idx) * 1000 + jitter
      queueCampaignOutboundMessage(campaignMessageId, scheduledAt, groupingKey)
        → insertOutboundMessage (type=campaign_send)
        → enqueueOutboundJob (delayed by staggerMs)
  → repeat until no more queued messages
  → markCampaignCompleted

outbound-execution worker → processCampaignSend()
  → loadCampaignExecutionInput (JOIN campaigns + users)
  → withGroupingLock(campaign:{phone})
      → evaluateOutboundTemplatePolicy
          enforceConsentPolicy = campaign.enforce_marketing_policy
      → if policy.allowed=false → markCampaignMessageFailed, skip
      → if frequencyCapDecision.action=delay
          → update outbound_messages.scheduled_at = delayUntil
          → reconciliation timer will re-enqueue at delayUntil
          → return (no UnrecoverableError)
      → if frequencyCapDecision.action=variant → swap templateId
      → checkConnectionDailyCap
          → if exceeded → deferCampaignMessageToNextDay
                         → update outbound_messages.scheduled_at = nextDay
                         → return
      → waitForRateLimit
      → dispatchTemplateMessage → Meta API → wamid
      → markCampaignMessageSent (status=sent, wamid stored)
      → recordFrequencyCapSend (MARKETING only)
      → updateOutboundMessageState (status=completed)

Meta webhook arrives → message-delivery-service.ts → processWebhookStatusEvent()
  → applyCampaignDeliveryStatusUpdate()
      → on status=failed + errorCode=131049 + smart_retry_enabled + retry_count < 3:
          delay = [6h, 12h, 24h][retry_count]
          UPDATE campaign_messages SET status=queued, retry_count++, next_retry_at=delay
          (outbound_messages row is already completed — no scheduled_at update needed)
          return { freqCapRelease: null }
      → on permanent failure:
          UPDATE campaign_messages SET status=failed
          return { freqCapRelease: { contactId, templateId } }
  → if freqCapRelease → clearFrequencyCapSend(contactId, templateId)

retrySweep (60 s) detects next_retry_at <= NOW() + retry_count > 0
  → enqueueCampaign → new dispatch job → picks up the queued campaign_message
```

**Smart retry** (campaign_send only):

| Error Code | Meaning | Max Retries | Delays |
|---|---|---|---|
| 131049 | Healthy ecosystem (Meta throttle) | 3 | 6 h → 12 h → 24 h |

Smart retry is gated on `campaign.smart_retry_enabled = true` (default: `true` for new campaigns)
and bounded by `campaign.smart_retry_until` if set.

**Retry path** (outbound_messages deferred, not webhook):
- reconciliation timer handles freq cap delays and daily tier cap deferrals via `outbound_messages.scheduled_at`
- `campaign_messages.next_retry_at` is only used for webhook-sourced retries (131049)

---

### sequence_send

**Trigger**: Sequence enrollment becomes due (`scheduled_send_at <= NOW()`).

```
Sequence scheduler (sequence-queue-service.ts)
  → listDueSequenceEnrollmentIds
  → for each: enqueueSequenceEnrollment

outbound-execution worker → executeSequenceOutboundMessage()
  → getSequenceEnrollmentForExecution
  → evaluateSequenceConditions (skip if conditions not met)
  → evaluateOutboundTemplatePolicy (hard blocks + consent + freq cap)
  → if cap → action=delay: reschedule enrollment, return
  → checkConnectionDailyCap
  → waitForRateLimit
  → dispatchTemplateMessage → wamid
  → recordFrequencyCapSend (MARKETING only)
  → updateSequenceEnrollment (advance to next step, set next scheduled_send_at)
  → trackOutboundMessage

Meta webhook arrives
  → applySequenceDeliveryStatusUpdate
```

Retry: BullMQ automatic, up to 1 attempt (failures are surfaced to sequence log; next step
scheduling is handled by the sequence scheduler, not queue retries).

---

### generic_webhook

**Trigger**: Inbound webhook payload dispatched to a webhook rule.

```
Webhook rule engine
  → insertOutboundMessage (type=generic_webhook)
  → enqueueOutboundJob

Worker → executeQueuedGenericWebhookLog()
  → evaluateHardBlocks (suppression / opt-out)
  → if template: evaluateOutboundTemplatePolicy
  → waitForRateLimit
  → dispatchTemplateMessage or send freeform
  → updateOutboundMessageState
```

QR-mode generic webhooks use `outbound-qr-execution` queue (detected from `payload_json.channelMode`).
Retry: BullMQ automatic, up to 5 attempts.

---

## Frequency Cap: Which Types Are Affected

| Type | Freq Cap Applied |
|---|---|
| `conversation_api` | Hard blocks only (no freq cap) |
| `conversation_qr` | Hard blocks only |
| `conversation_web` | None |
| `template_api` | Yes — if MARKETING category |
| `campaign_send` | Yes — if MARKETING category |
| `sequence_send` | Yes — if MARKETING category |
| `generic_webhook` | Yes — if template is MARKETING category |

The cap is **per-template per-contact**, not per-contact globally. Sending template A to a contact
does not block template B.

---

## Adding a New Message Type

1. Add the type string to `OutboundMessageType` in `outbound-message-service.ts`
2. Add a row to `OutboundJobPayload` (the union type)
3. Implement a `processYourType()` handler inside the worker's `processJob()` switch
4. Call `insertOutboundMessage` with the new type before enqueuing
5. Call `enqueueOutboundJob` — choose `outbound-execution` or `outbound-qr-execution`
6. If the type sends MARKETING templates: call `recordFrequencyCapSend` after dispatch and
   `clearFrequencyCapSend` on permanent webhook failure
7. If the type has its own DB row (like campaign_messages): implement a corresponding
   `applyYourTypeDeliveryStatusUpdate()` in `message-delivery-data-service.ts` and wire it into
   `processWebhookStatusEvent()` in `message-delivery-service.ts`

---

## Error Classification (`classifyDeliveryFailure`)

Located in `message-delivery-data-service.ts`. Determines whether a failed send is retryable:

| Category | Retryable | Examples |
|---|---|---|
| `rate_limit` | Yes | 429, Meta rate limit |
| `provider_transient` | Yes | 500, network errors |
| `business_logic` | No | 131049, invalid number |
| `recipient_invalid` | No | Unknown recipient |

BullMQ retries (`attempts: 5`) apply to `retryable=true` errors for conversation types.
Campaign and sequence types use `attempts: 1` — their retry logic is external (reconciliation /
retrySweep / smart retry), not BullMQ automatic retries.
