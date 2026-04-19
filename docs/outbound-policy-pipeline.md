# Outbound Policy Pipeline

## Summary of Changes

This document describes the outbound marketing message policy architecture and the fixes applied to ensure consistent enforcement across all send paths.

---

## Policy Layers

All outbound template sends are gated by three explicit policy layers defined in `outbound-policy-service.ts`.

### 1. Hard Blocks (`evaluateHardBlocks`)
Always enforced on every send path, no exceptions.

| Code | Reason |
|---|---|
| `suppressed_blocked` | Contact previously blocked messages from this account |
| `suppressed_invalid_number` | Phone number marked invalid by Meta |
| `suppressed_opt_out` | Contact opted out of marketing (MARKETING templates only) |
| `global_opt_out` | Contact globally opted out of all business messaging |
| `marketing_disabled` | Marketing outbound not enabled on this account |

### 2. Marketing Consent (`evaluateMarketingConsent`)
Enforced for MARKETING templates when `enforce_marketing_policy = true` (controlled per broadcast).

| Code | Reason |
|---|---|
| `missing_contact` | No contact record found for this phone number |
| `marketing_unsubscribed` | Contact unsubscribed or revoked consent |
| `missing_marketing_consent` | Contact consent status is not `subscribed` |

### 3. Frequency Cap (`evaluateFrequencyCap`)
Always enforced for MARKETING templates — not controlled by consent toggle.

| Code | Reason |
|---|---|
| `frequency_cap_24h` | A marketing template was already sent to this contact within the last 24 hours |

This mirrors WhatsApp's platform-level proactive marketing frequency rule.

---

## Send Paths — Policy Matrix

| Check | Broadcast (consent ON) | Broadcast (consent OFF) | Sequence | Conversation Template | New Chat |
|---|---|---|---|---|---|
| Hard blocks | ✓ | ✓ | ✓ | ✓ | ✓ |
| Marketing consent | ✓ | ✗ skipped | ✓ | ✓ | ✓ |
| 24h frequency cap | ✓ | ✓ | ✓ | ✓ | ✓ |
| Meta tier daily cap | ✓ | ✓ | ✓ | ✓ | ✓ |
| Per-connection rate limit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delivery attempt tracking | ✓ | ✓ | ✓ | ✓ | — |

---

## Meta Tier Daily Cap

WhatsApp Business API enforces per-connection daily message limits based on account tier.

| Tier | Daily Limit |
|---|---|
| `TIER_250` (default) | 250 |
| `TIER_1K` | 1,000 |
| `TIER_10K` | 10,000 |
| `TIER_100K` | 100,000 |

Cap is checked via `checkConnectionDailyCap(connectionId)` in `message-delivery-service.ts`.

The count is queried from `message_delivery_attempts` where `status = 'sent'` and `created_at` is today — covering all send paths (campaigns, sequences, conversation templates).

**Broadcast**: exceeding cap defers the message to the next day (`deferCampaignMessageToNextDay`).  
**Sequence**: exceeding cap re-queues the step 1 hour later.  
**Conversation template**: throws an error shown to the user.

---

## Per-Connection Rate Limit

`waitForRateLimit()` in `message-delivery-service.ts` enforces a minimum delay between sends on the same WhatsApp connection. This prevents API rate limit errors from Meta on bulk sends.

Uses Redis when available; falls back to in-memory lock.

---

## Broadcast Consent Toggle

The "Follow WhatsApp Business Policy" toggle in the broadcast UI controls `enforce_marketing_policy` on the campaign.

- **ON (default)**: consent layer enforced — only opted-in contacts receive the message
- **OFF**: consent layer skipped — sends to all contacts in segment regardless of opt-in status

Hard blocks and 24h frequency cap are **always** enforced regardless of this toggle.

---

## Delivery Attempt Tracking

All template sends record to `message_delivery_attempts` via `recordDeliveryAttemptStart` / `markDeliveryAttemptSuccess` / `markDeliveryAttemptFailure`.

Message kinds:
- `campaign_template` — broadcast sends
- `conversation_template` — template sent from inbox conversation
- `sequence_template` — automated sequence step
- `test_template` — test send from broadcast UI

This table is the source of truth for the daily cap count and delivery observability.

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/services/outbound-policy-service.ts` | Split into `evaluateHardBlocks`, `evaluateMarketingConsent`, `evaluateFrequencyCap` + composer |
| `apps/api/src/services/message-delivery-service.ts` | Exported `waitForRateLimit`, `checkConnectionDailyCap`; fixed daily cap count to use `message_delivery_attempts`; added tier cap to conversation template path |
| `apps/api/src/services/sequence-execution-service.ts` | Added `waitForRateLimit`, `checkConnectionDailyCap`, `recordDeliveryAttemptStart/Success/Failure` to sequence send path |
| `apps/api/src/services/message-delivery-data-service.ts` | Added `sequence_template` to `DeliveryMessageKind` |
