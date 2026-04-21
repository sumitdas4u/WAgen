# AI Review & Learning Center — Redesign Spec

**Date:** 2026-04-14  
**Status:** Approved for implementation  
**Scope:** Smart triage layer, confidence scoring overhaul, learning loop, audit log, UI updates

---

## Problem

The review queue receives almost every AI response because:
1. The confidence formula (`52 + chunks×11`, capped at 38 for fallback) is too coarse — chunk count alone doesn't reflect answer quality
2. The fallback pattern list is too broad (150+ patterns including vague terms like `"specify"`, `"vague"`, `"general information"`)
3. There is no triage step — any detected signal creates a queue item
4. Resolved questions can re-appear with no indication they are recurring failures
5. Auto-dismissed items are silently dropped with no visibility

---

## Goals

1. Only queue items that genuinely need a human-written answer
2. Make the confidence score meaningful and multi-factor
3. Track whether KB answers are working (learning loop)
4. Surface recurring failures as highest priority
5. Give visibility into auto-dismissed items via audit log

---

## Architecture

```
AI sends response
      │
      ▼
[Triage Pipeline]
      │
      ├── NOISE   (score ≥ 60) → write to ai_review_audit_log, skip queue
      ├── MONITOR (score 35–59) → write to ai_review_audit_log, skip queue
      └── REVIEW  (score < 35) → create ai_review_queue item

Human reviews item
      │
      ├── Save & Add to KB  → knowledge_chunks ingested
      └── Mark resolved     → status = 'resolved'

[Learning Loop]
      │
      └── Same question recurs?
            ├── AI answered correctly → skip queue (KB working ✓)
            └── AI failed again       → re-queue, increment recurrence_count
```

All logic lives in `apps/api/src/services/ai-review-service.ts`.  
UI changes are in `apps/web/src/modules/dashboard/studio/review/route.tsx`.  
One new API endpoint in `apps/api/src/routes/ai-review.ts`.  
One new DB table and one new DB column.

---

## Section 1: Confidence Scoring Formula

Replaces the current `52 + chunks×11` formula.

### Formula

```
score = BASE
      + CHUNK_FACTOR
      + SIGNAL_SEVERITY
      + FEEDBACK_PENALTY

clamped to [0, 100]
```

### Factors

**BASE = 50**

**CHUNK_FACTOR** (KB retrieval quality):
| Chunks retrieved | Value |
|---|---|
| 0 | −20 |
| 1 | +0 |
| 2 | +8 |
| 3+ | +15 |

**SIGNAL_SEVERITY** (worst signal present):
| Signal | Value |
|---|---|
| `strong_unknown` ("I don't know", "not familiar with") | −30 |
| `fallback_response` (softer patterns) | −15 |
| `clarification` (asking user for more details) | −5 |
| No signal | +0 |

**FEEDBACK_PENALTY**:
| Condition | Value |
|---|---|
| `user_negative_feedback` present | −25 |
| Not present | +0 |

### Example Scores

| Scenario | Score | Triage |
|---|---|---|
| 3 chunks, no signal | 65 | NOISE → skip |
| 1 chunk, no signal | 50 | MONITOR → skip |
| 0 chunks, no signal | 30 | REVIEW |
| 0 chunks + strong_unknown | 0 | REVIEW |
| 2 chunks + fallback | 43 | MONITOR → skip |
| 1 chunk + user flagged | 25 | REVIEW |
| 3 chunks + user flagged | 40 | MONITOR → skip |
| 0 chunks + strong_unknown + user flagged | 0 | REVIEW |

### Triage Thresholds

| Score range | Category | Action |
|---|---|---|
| ≥ 60 | NOISE | Auto-dismiss, write to audit log |
| 35–59 | MONITOR | Log only, no queue entry |
| < 35 | REVIEW | Create queue item for human review |

---

## Section 2: Triage Pipeline

Replaces the current `shouldQueueFailureForLearning` function.

### Steps (in order)

1. **Question quality filter** — reject empty, single-char, gibberish (unchanged from current)
2. **Resolved-question check** — if this exact question was resolved before AND the AI response contains no `strong_unknown` or `fallback_response` patterns → skip (KB is working)
3. **Score calculation** — apply multi-factor formula above
4. **Triage categorization** — NOISE / MONITOR / REVIEW based on thresholds
5. **Audit log write** — for NOISE and MONITOR, append to `ai_review_audit_log`
6. **Queue creation** — for REVIEW only, create `ai_review_queue` item

### Signal Classification

Signals are now classified by severity before scoring:

**Strong unknown** (maps to `−30`):
- `"i don't know"`, `"i do not know"`, `"i'm not sure"`, `"i am not sure"`
- `"i don't have"`, `"i do not have"`, `"not familiar with"`
- `"unable to find"`, `"unable to help"`, `"cannot help with that"`
- `"no information available"`, `"not in my system"`, `"not in my knowledge"`

**Fallback response** (maps to `−15`):
- `"please contact support"`, `"contact support"`, `"reach out to"`
- `"i appreciate your"`, `"unfortunately, i don't have"`
- `"i'm sorry, but i can't"`, `"sorry i can't"`
- *(Reduced from 150+ patterns to ~30 high-signal patterns)*

**Clarification** (maps to `−5`):
- `"please clarify"`, `"could you clarify"`, `"could you provide more details"`
- `"which one"`, `"what exactly"`, `"can you be more specific"`

---

## Section 3: Learning Loop

### DB Change

```sql
ALTER TABLE ai_review_queue
  ADD COLUMN recurrence_count INTEGER NOT NULL DEFAULT 0;
```

### Logic

When a new item enters the triage pipeline:

1. Query `ai_review_queue` for a resolved item with the same normalized question (same user, `status = 'resolved'`)
2. If found:
   - If new AI response has **no failure signals** → skip queue entirely (log as "kb_effective")
   - If new AI response **has failure signals** → create queue item with `recurrence_count = MAX(previous resolved items' recurrence_count) + 1`, add signal `"kb_not_effective"`
3. If not found → normal triage flow

### Priority Sorting

Queue items are sorted server-side:
1. `recurrence_count > 0` items first (descending by recurrence_count)
2. Then by `created_at DESC`

This means recurring failures always appear at the top of the Pending list.

---

## Section 4: Audit Log

### New DB Table

```sql
CREATE TABLE ai_review_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  triage_category TEXT NOT NULL CHECK (triage_category IN ('noise', 'monitor')),
  dismiss_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON ai_review_audit_log (user_id, created_at DESC);
```

### New API Endpoint

```
GET /api/ai-review/audit-log?limit=100
```

Returns last 100 auto-dismissed items for the authenticated user, ordered by `created_at DESC`.

### UI Integration

New **"Dismissed"** tab in the filter bar:

```
Pending (32)  |  Resolved  |  Dismissed  |  All
```

Dismissed tab shows a read-only table: Question, Score, Reason, Date. No action buttons. Intended for occasional inspection (weekly), not daily workflow.

---

## Section 5: UI Changes

All changes are in `apps/web/src/modules/dashboard/studio/review/route.tsx`.

### Filter Bar

```
Pending (N)  |  Resolved  |  Dismissed  |  All
```

Pending count shown as badge. "Dismissed" tab calls the new audit log endpoint.

### Queue Table — Updated Columns

| Column | Change |
|---|---|
| Confidence | Color-coded pill: red `<35`, amber `35–59`, green `≥60` |
| Signals | Add `Recurring ×N` badge in red when `recurrence_count > 0` |
| Sort | Recurring items float to top (server-side, no UI sort needed) |

### Detail Panel — Recurrence Warning

When `recurrence_count > 0`, show above the "Correct answer" textarea:

```
⚠ Recurring failure
This question has appeared N times after a previous resolution.
The KB answer you wrote before didn't prevent this failure.
Consider updating your answer below.
```

### Stats Cards — Updated

| Old label | New label |
|---|---|
| Low confidence today | Recurring today |

`Recurring today` = count of items created today with `recurrence_count > 0`.

---

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/services/ai-review-service.ts` | New scoring formula, triage pipeline, learning loop, audit log writes |
| `apps/api/src/routes/ai-review.ts` | New `GET /api/ai-review/audit-log` endpoint |
| `apps/web/src/modules/dashboard/studio/review/route.tsx` | Filter bar tab, recurring badge, recurrence warning, confidence pill colors, stats card label |
| `apps/web/src/modules/dashboard/studio/review/api.ts` | New `listAuditLog()` API call |
| `apps/web/src/modules/dashboard/studio/review/queries.ts` | New `useAuditLogQuery()` hook |
| DB migration | `ALTER TABLE ai_review_queue ADD COLUMN recurrence_count` + new `ai_review_audit_log` table |

---

## What Does Not Change

- The `resolveAiReviewQueueItem` function — resolution flow is unchanged
- Knowledge Base ingestion — `ingestManualText` called as-is
- The `queueNegativeFeedbackForReview` function signature — internal scoring updated, external interface unchanged
- The `queueFlowIssueForReview` function — unchanged, flow errors always queue (score forced to REVIEW)
- All existing API endpoints — no breaking changes

---

## Out of Scope

- Semantic/embedding-based deduplication (Approach C — future work)
- Bulk-resolve UI actions
- Email/push notifications for recurring failures
- Per-signal threshold configuration UI
