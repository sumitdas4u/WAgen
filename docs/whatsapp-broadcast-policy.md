# WhatsApp Message Sending Policy — Complete Rules & Flow

> **Last updated:** May 2026
> **Scope:** All outbound message paths — broadcast, chat, sequence, webhook
> **Philosophy:** Meta-required checks are hard gates. Anti-ban checks are smart reroutes — the message always sends, never silently drops.

---

## 1. Send Paths

| Path | Trigger | Message type | Service function |
|---|---|---|---|
| **Broadcast** | Campaign job | Template only | `deliverCampaignMessage` |
| **Chat — template** | Inbox / API | Template | `deliverConversationTemplateMessage` |
| **Chat — freeform** | Inbox / API | Freeform (text, interactive, media) | `sendTrackedApiConversationFlowMessage` |
| **Sequence** | Enrollment scheduler | Template only | `executeSequenceOutboundMessage` |
| **Webhook** | Inbound HTTP webhook | Template or freeform | `executeQueuedGenericWebhookLog` |

---

## 2. Policy Layer Matrix (Target State)

Every check must apply consistently across all paths. This is the required behaviour.

| Check | Broadcast | Chat Template | Chat Freeform | Sequence | Webhook |
|---|---|---|---|---|---|
| Global opt-out | ✅ hard drop | ✅ hard drop | ✅ hard drop | ✅ hard drop | ✅ hard drop |
| Invalid number suppression | ✅ hard drop | ✅ hard drop | ✅ hard drop | ✅ hard drop | ✅ hard drop |
| Blocked / opt-out suppression | ✅ hard drop | ✅ hard drop | ✅ hard drop | ✅ hard drop | ✅ hard drop |
| Daily tier cap | ✅ defer next day | ✅ defer next day | — | ✅ reschedule 1h | ✅ defer next day |
| Template approved | ✅ meta enforces | ✅ meta enforces | — | ✅ meta enforces | ✅ meta enforces |
| 24h inbound window | — | — | ✅ hard abort | — | ✅ hard abort (freeform) |
| Marketing consent | configurable per campaign | ✅ enforced | — | ✅ enforced | ✅ enforced |
| Frequency cap (same template 24h) | ✅ reroute/delay | ✅ reroute/delay | — | ✅ reroute/delay | ✅ reroute/delay |
| Connection rate limit | ✅ backoff queue | ✅ backoff queue | ✅ backoff queue | ✅ backoff queue | ✅ backoff queue |
| Sequence loop guard (10s) | — | — | — | ✅ reschedule 1m | — |
| Sequence daily contact cap (20/day) | — | — | — | ✅ reschedule 1m | — |

---

## 3. Meta Hard Rules (Non-Negotiable)

These run on every send path. If any of them fail, the message is dropped immediately. No retry. No reroute.

### 3.1 Global Opt-Out

- **What:** `contact.global_opt_out_at` is set — the contact has opted out of all business messages
- **Required by:** Meta Business Policy
- **On match:** Drop immediately, log `global_opt_out`
- **Never:** Retry, override, or skip — Meta will ban the WABA for violations

### 3.2 Invalid Number Suppression

- **What:** Phone number is in the local suppression list with `reason = "invalid_number"`
- **Populated by:** Meta hard errors from previous sends — `131026` (number does not exist), `133010` (not a WhatsApp account)
- **On match:** Drop immediately, log `suppressed_invalid_number`
- **Why:** Retrying invalid numbers burns daily tier quota with zero chance of delivery

### 3.3 Blocked / Opt-Out Suppression

- **What:** Phone number is in the suppression list with `reason = "blocked"` or `reason = "opt_out"`
- **Opt-out applies to:** MARKETING category templates only
- **On match:** Drop immediately, log `suppressed_blocked` or `suppressed_opt_out`

### 3.4 Daily Tier Cap

Meta limits how many unique recipients you can reach per UTC day, per phone number.

| Tier | Daily limit |
|---|---|
| TIER_250 | 250 (unverified accounts) |
| TIER_1K | 1,000 |
| TIER_10K | 10,000 |
| TIER_100K | 100,000 |
| Unlimited | No cap |

- **How counted:** `message_delivery_attempts WHERE status = 'sent' AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`
- **Cap resets:** UTC midnight (not a rolling 24h window)
- **On breach — all paths:** Defer the message to next UTC day. Never drop. Never throw and lose the message.
  - Broadcast: `deferCampaignMessageToNextDay`
  - Chat template: queue to next day (same mechanism)
  - Sequence: reschedule enrollment 1 hour later, keep enrollment active
  - Webhook: queue to next UTC day

### 3.5 Template Approved

- **What:** The template name must exist with `APPROVED` status in the WABA before sending
- **Enforced by:** Meta API — unapproved template names return a hard error
- **On fail:** Mark attempt as failed, classify as `business_logic`, do not retry

### 3.6 24-Hour Freeform Window (freeform only)

- **What:** For any non-template message, the recipient must have sent an inbound message within the last 24 hours
- **Source:** `contact.last_incoming_message_at`
- **On fail:** Hard abort — do not send, do not retry
- **Meta error if bypassed:** `131047`
- **Applies to:** Chat freeform, webhook freeform sends
- **Does NOT apply to:** Template sends — templates can go out anytime

---

## 4. Anti-Ban Smart Gates

> These are **not** Meta rules. They protect your WABA quality score by avoiding spam signals.
> Key principle: **the message always sends** — it is rerouted or delayed, never silently dropped.

### 4.1 Same-Template Frequency Cap (24h per contact, MARKETING only)

Sending the same marketing template to the same contact within 24 hours is a strong spam signal that degrades your quality score.

- **Check:** `contact.last_outgoing_marketing_at` — if less than 24h ago and same `template_id`
- **On trigger — decision tree:**
  1. Is there an approved variant template (same intent, different wording)? → **Send the variant**, log `frequency_cap_variant`
  2. No variant available → **Delay the send** until `last_sent_at + 24h`, log `frequency_cap_delay`
  3. Never drop the message silently

```
frequency_cap_24h triggered
│
├─ getApprovedVariant(templateId) → found?
│   └─ YES → send variant, log frequency_cap_variant
│
└─ NO variant
    └─ delay until last_outgoing_marketing_at + 24h
       log frequency_cap_delay
```

**What to track:**
```
key:   freq_cap:{contact_id}:{template_id}
value: { sentAt: ISO8601 }
ttl:   25h
```

### 4.2 Connection Rate Limit (Redis throttle)

Sending too many messages per second per connection triggers burst detection in Meta's infrastructure.

- **What:** Per-connection rolling rate limit set by `DELIVERY_PER_CONNECTION_RATE_LIMIT` env var
- **Implementation:** Redis-backed, falls back to in-memory Map
- **On hit:** `waitForRateLimit()` backs off until the window clears — message is queued, not dropped
- **Applies to:** All send paths

---

## 5. Send Path Flows (Target State)

### 5.1 Broadcast (`deliverCampaignMessage`)

```
Campaign job fires
│
├─ [1] evaluateHardBlocks
│   ├─ global_opt_out → DROP + log
│   ├─ suppressed_blocked → DROP + log
│   ├─ suppressed_invalid_number → DROP + log
│   └─ suppressed_opt_out (MARKETING) → DROP + log
│
├─ [2] evaluateMarketingConsent  ← only if campaign.enforce_marketing_policy = true
│   ├─ missing_contact → DROP
│   ├─ marketing_unsubscribed → DROP
│   └─ missing_marketing_consent → DROP
│
├─ [3] evaluateFrequencyCap  ← MARKETING templates only
│   ├─ cap hit + variant available → swap template, continue
│   └─ cap hit + no variant → delay to last_sent_at + 24h, return retrying
│
├─ [4] checkConnectionDailyCap
│   └─ EXCEEDED → deferCampaignMessageToNextDay, return retrying
│
├─ [5] recordDeliveryAttemptStart
│
├─ [6] waitForRateLimit
│
├─ [7] dispatchTemplateMessage → Meta Graph API
│   │
│   ├─ SUCCESS → markAttemptSent, trackOutbound, markContactActivity
│   │
│   └─ ERROR → classifyDeliveryFailure
│       ├─ code 131049 + smart_retry_enabled
│       │   └─ SMART RETRY: 6h → 12h → 24h (max 3, respects smart_retry_until)
│       ├─ transient (timeout, 429, 5xx) + retryCount < 3
│       │   └─ TRANSIENT RETRY: 30s → 2m → 10m
│       ├─ suppressionReason exists
│       │   └─ upsertRecipientSuppression → permanent fail
│       └─ all else → permanent fail
```

**Note:** `enforce_marketing_policy = false` skips step [2] only. Hard blocks and frequency cap always run.

---

### 5.2 Chat — Template (`deliverConversationTemplateMessage`)

```
Inbox / API template send
│
├─ [1] evaluateHardBlocks
│   ├─ global_opt_out → DROP
│   ├─ suppressed_* → DROP
│   └─ marketing_disabled → DROP
│
├─ [2] evaluateMarketingConsent  ← always enforced, no bypass
│   └─ unsubscribed / missing consent → DROP
│
├─ [3] evaluateFrequencyCap  ← MARKETING only
│   ├─ cap hit + variant → swap, continue
│   └─ cap hit, no variant → queue to +24h
│
├─ [4] checkConnectionDailyCap
│   └─ EXCEEDED → queue to next UTC day (do not throw — do not lose the message)
│
├─ [5] recordDeliveryAttemptStart
│
├─ [6] waitForRateLimit
│
├─ [7] dispatchTemplateMessage → Meta Graph API
│   ├─ SUCCESS → markAttemptSent, trackOutbound, markContactActivity
│   └─ ERROR → classifyDeliveryFailure → throw (5 retries via outbound worker)
```

---

### 5.3 Chat — Freeform (`sendTrackedApiConversationFlowMessage`)

```
Inbox freeform send (text, interactive, media)
│
├─ [1] evaluateHardBlocks  ← must run on freeform too
│   ├─ global_opt_out → DROP
│   └─ suppressed_blocked / suppressed_invalid_number → DROP
│
├─ [2] 24h inbound window check
│   └─ contact.last_incoming_message_at < now - 24h → ABORT
│
├─ [3] recordDeliveryAttemptStart
│
├─ [4] waitForRateLimit
│
├─ [5] sendMetaFlowMessageDirect → Meta Graph API
│   ├─ SUCCESS → markAttemptSent, trackOutbound
│   └─ ERROR → classifyDeliveryFailure → throw (5 retries via outbound worker)
```

**Note:** No tier cap check on freeform — freeform sends count against tier in some Meta configurations but the 24h window already constrains volume naturally.

---

### 5.4 Sequence (`executeSequenceOutboundMessage`)

```
Scheduler fires enrollment
│
├─ [PRE] passesSafetyChecks
│   ├─ loop guard: last outbound < 10s ago → reschedule 1m
│   └─ daily contact cap: > 20 messages today → reschedule 1m
│
├─ [1] evaluateHardBlocks
│   └─ global_opt_out, suppressed_* → mark enrollment failed, clear queue
│
├─ [2] evaluateMarketingConsent  ← always enforced
│   └─ FAIL → mark enrollment failed, clear queue
│
├─ [3] evaluateFrequencyCap  ← MARKETING only
│   ├─ cap hit + variant → swap, continue
│   └─ cap hit, no variant → reschedule enrollment to cap expiry time
│
├─ [4] checkConnectionDailyCap
│   └─ EXCEEDED → reschedule enrollment 1h later, keep active
│
├─ [5] recordDeliveryAttemptStart
│
├─ [6] waitForRateLimit
│
├─ [7] dispatchTemplateMessage → Meta Graph API
│   ├─ SUCCESS → markAttemptSent, trackOutbound, advance to next step
│   └─ ERROR → classifyDeliveryFailure
│       ├─ transient + retry_enabled + within retry_window_hours
│       │   └─ RETRY: 5m delay (1 attempt), bounded by retry_window_hours
│       └─ else → mark enrollment failed
```

---

### 5.5 Webhook Outbound (`executeQueuedGenericWebhookLog`)

```
Inbound HTTP webhook received
│
├─ Phase 1: Reception
│   ├─ validate integration + HMAC secret
│   ├─ match workflow conditions
│   ├─ upsertContact
│   ├─ resolveVariables
│   └─ queue outbound message with delay → recordLog("queued")
│
└─ Phase 2: Queue execution
    │
    ├─ Template send:
    │   └─ Full policy chain: hard blocks → consent → frequency cap → tier cap → send
    │   └─ FAIL → recordLog("failed"), 5 retries via outbound worker
    │
    ├─ Freeform send:
    │   └─ Hard blocks → 24h inbound window → send
    │   └─ FAIL → recordLog("failed"), 5 retries via outbound worker
    │
    └─ QR / flow mode:
        └─ startFlowForConversation (no outbound policy — flow handles its own logic)
```

---

## 6. Retry Reference

| Path | Transient retries | Smart retry (ecosystem throttle) | Controls |
|---|---|---|---|
| Broadcast | 3 — 30s → 2m → 10m | 3 — 6h → 12h → 24h | `campaign.smart_retry_until` |
| Chat template | 5 — exponential (outbound worker) | — | none |
| Chat freeform | 5 — exponential (outbound worker) | — | none |
| Sequence | 1 — 5m | — | `retry_enabled`, `retry_window_hours` |
| Webhook | 5 — exponential (outbound worker) | — | none |

---

## 7. Delivery Status Processing (Inbound from Meta)

```
Meta fires status webhook → x-hub-signature-256 verified
│
└─ processMetaDeliveryStatusEvent (per message)
    ├─ claimWebhookStatusEvent (idempotency — process each wamid once)
    ├─ applyDeliveryAttemptWebhookStatusUpdate
    │   ├─ sent / delivered / read → update attempt status
    │   └─ failed → classifyDeliveryFailure(error, errorCode)
    │       ├─ suppressionReason present → upsertRecipientSuppression
    │       └─ record error_category, error_code, error_message
    ├─ applyConversationDeliveryStatusUpdate
    ├─ applyCampaignDeliveryStatusUpdate
    ├─ applySequenceDeliveryStatusUpdate
    └─ firePerMessageWebhook (if conversation_messages.webhook_url is set)
```

### Meta Error Code Reference

| Code | Category | Retryable | Suppression created |
|---|---|---|---|
| `131026` | permanent | no | `invalid_number` |
| `131047` | permanent | no | — |
| `131049` | business_logic | no (smart retry) | — |
| `133010` | permanent | no | `invalid_number` |
| `130429`, timeout, 5xx | transient | yes | — |
| message contains "blocked" | permanent | no | `blocked` |
| message contains "opted out" | permanent | no | `opt_out` |
| unknown | unknown | yes | — |

---

## 8. Policy Reason Code Reference

| Code | Layer | Meaning | Correct action |
|---|---|---|---|
| `global_opt_out` | Meta required | Contact opted out of all business messages | Hard drop |
| `suppressed_blocked` | Meta required | Number previously hard-blocked | Hard drop |
| `suppressed_invalid_number` | Meta required | Number previously returned invalid | Hard drop |
| `suppressed_opt_out` | Meta required | Number opted out (MARKETING only) | Hard drop |
| `marketing_disabled` | App config | Account-level marketing kill switch | Hard drop |
| `missing_contact` | App logic | No contact record exists (MARKETING only) | Hard drop |
| `marketing_unsubscribed` | App logic | Contact explicitly unsubscribed | Hard drop |
| `missing_marketing_consent` | App logic | No explicit consent recorded | Hard drop |
| `frequency_cap_variant` | Anti-ban | Rotated to template variant | Send variant |
| `frequency_cap_delay` | Anti-ban | Same template within 24h, no variant | Delay to cap expiry |
| `tier_cap_queued` | Meta tier | Over daily tier limit | Defer to next UTC day |
| `rate_limit_queued` | Anti-ban | Connection burst detected | Backoff queue |

---

## 9. Complete Flow Diagram

```
MESSAGE SEND TRIGGERED
│
├─ [A] HARD BLOCKS (all paths)
│   ├─ global_opt_out?        → DROP
│   ├─ suppressed_blocked?    → DROP
│   ├─ suppressed_opt_out?    → DROP (MARKETING only)
│   └─ suppressed_invalid?    → DROP
│
├─ [B] MESSAGE TYPE?
│   │
│   ├─ TEMPLATE SEND
│   │   │
│   │   ├─ [C] MARKETING CONSENT (template + UTILITY/AUTH skip this)
│   │   │   ├─ missing_contact?              → DROP
│   │   │   ├─ marketing_unsubscribed?       → DROP
│   │   │   └─ missing_marketing_consent?    → DROP
│   │   │   NOTE: Broadcast can bypass this with enforce_marketing_policy = false
│   │   │
│   │   ├─ [D] FREQUENCY CAP (MARKETING templates only)
│   │   │   ├─ same template within 24h + variant exists? → SEND VARIANT
│   │   │   └─ same template within 24h, no variant?      → DELAY to +24h
│   │   │
│   │   ├─ [E] DAILY TIER CAP
│   │   │   └─ exceeded? → DEFER to next UTC day (never drop)
│   │   │
│   │   ├─ [F] CONNECTION RATE LIMIT
│   │   │   └─ hit? → BACKOFF QUEUE (never drop)
│   │   │
│   │   └─ SEND → Meta Graph API
│   │       ├─ SUCCESS → track, mark sent
│   │       └─ FAIL → classify → retry / suppress / permanent fail
│   │
│   └─ FREEFORM SEND
│       │
│       ├─ [G] 24H INBOUND WINDOW
│       │   └─ window closed? → ABORT (Meta will reject with 131047)
│       │
│       ├─ [H] CONNECTION RATE LIMIT
│       │   └─ hit? → BACKOFF QUEUE
│       │
│       └─ SEND → Meta Graph API
│           ├─ SUCCESS → track, mark sent
│           └─ FAIL → classify → retry / suppress / permanent fail
│
└─ DELIVERY STATUS WEBHOOK (async, from Meta)
    ├─ sent / delivered / read → update attempt
    └─ failed → classify error → suppress if needed → update attempt
```

---

## 10. Files to Implement This Policy

| File | Required change |
|---|---|
| `message-delivery-service.ts` → `sendTrackedApiConversationFlowMessage` | Add `evaluateHardBlocks()` call before 24h window check |
| `message-delivery-service.ts` → `deliverConversationTemplateMessage` | Change tier cap breach from throw → defer to next day |
| `outbound-policy-service.ts` → `evaluateFrequencyCap` | Change from hard block → return variant/delay decision |
| `message-delivery-service.ts` → `deliverCampaignMessage` | Pass frequency cap decision (variant/delay) through instead of blocking |
| `sequence-execution-service.ts` → `executeSequenceOutboundMessage` | Pass frequency cap decision (variant/delay) through instead of blocking |

---

*Validated against Meta WhatsApp Business API policy, May 2026. Re-check when upgrading API versions or adding new template categories.*
