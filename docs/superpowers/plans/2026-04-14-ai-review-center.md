# AI Review Center — Smart Triage & Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the over-eager review queue with a smart triage pipeline that scores AI responses using a multi-factor formula, auto-dismisses noise to an audit log, and tracks recurring failures after KB resolutions.

**Architecture:** A new `detectResponseSeverity` / `estimateConfidenceScore` / `triageCategory` pipeline replaces the current blunt chunk-count formula and 150+ pattern list. Items scoring ≥60 (noise) or 35–59 (monitor) are written to a new `ai_review_audit_log` table instead of the queue. A learning loop checks resolved questions on re-entry and increments `recurrence_count` when the KB answer didn't prevent the failure.

**Tech Stack:** PostgreSQL (migration), TypeScript/Node (Fastify API service), React/TanStack Query (frontend), Vitest (tests)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `infra/migrations/0043_ai_review_improvements.sql` | Create | DB schema changes |
| `apps/api/src/services/ai-review-service.ts` | Modify | All scoring, triage, learning loop, audit log logic |
| `apps/api/src/services/ai-review-service.test.ts` | Create | Unit tests for pure scoring functions |
| `apps/api/src/routes/ai-review.ts` | Modify | New `GET /api/ai-review/audit-log` endpoint |
| `apps/web/src/lib/api.ts` | Modify | Add `recurrence_count` to `AiReviewQueueItem`, add `AiReviewAuditLogItem` type, add `fetchAiReviewAuditLog` |
| `apps/web/src/shared/dashboard/query-keys.ts` | Modify | Add `reviewAuditLog` key |
| `apps/web/src/modules/dashboard/studio/review/api.ts` | Modify | Add `fetchAuditLog` wrapper |
| `apps/web/src/modules/dashboard/studio/review/queries.ts` | Modify | Add `useAuditLogQuery` hook |
| `apps/web/src/modules/dashboard/studio/review/route.tsx` | Modify | Dismissed tab, recurring badge, recurrence warning, confidence pill colors, stats card |

---

## Task 1: DB Migration

**Files:**
- Create: `infra/migrations/0043_ai_review_improvements.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- infra/migrations/0043_ai_review_improvements.sql
ALTER TABLE ai_review_queue
  ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_review_audit_log (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question         TEXT        NOT NULL,
  ai_response      TEXT        NOT NULL,
  confidence_score INTEGER     NOT NULL,
  triage_category  TEXT        NOT NULL CHECK (triage_category IN ('noise', 'monitor')),
  dismiss_reason   TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_review_audit_log_user_created
  ON ai_review_audit_log (user_id, created_at DESC);
```

- [ ] **Step 2: Run the migration**

```bash
cd apps/api && npm run db:migrate
```

Expected: migration applies with no errors. Run `npm run db:migrate:status` to confirm `0043_ai_review_improvements` shows as applied.

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/0043_ai_review_improvements.sql
git commit -m "feat: add recurrence_count to ai_review_queue and create ai_review_audit_log table"
```

---

## Task 2: Service — New Pure Scoring Functions (TDD)

**Files:**
- Create: `apps/api/src/services/ai-review-service.test.ts`
- Modify: `apps/api/src/services/ai-review-service.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/ai-review-service.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  detectResponseSeverity,
  estimateConfidenceScore,
  triageCategory
} from "./ai-review-service.js";

describe("detectResponseSeverity", () => {
  it("detects strong_unknown from 'I don't know' variants", () => {
    expect(detectResponseSeverity("I don't know what that is")).toBe("strong_unknown");
    expect(detectResponseSeverity("I'm not sure about that")).toBe("strong_unknown");
    expect(detectResponseSeverity("I'm not familiar with Sujay")).toBe("strong_unknown");
    expect(detectResponseSeverity("unable to find that information")).toBe("strong_unknown");
    expect(detectResponseSeverity("no information available on that topic")).toBe("strong_unknown");
  });

  it("detects fallback from softer deflection patterns", () => {
    expect(detectResponseSeverity("Please contact support for more help")).toBe("fallback");
    expect(detectResponseSeverity("Unfortunately, I don't have that detail")).toBe("fallback");
    expect(detectResponseSeverity("I'm sorry, but I can't help with that")).toBe("fallback");
  });

  it("detects clarification patterns", () => {
    expect(detectResponseSeverity("Could you clarify what you mean?")).toBe("clarification");
    expect(detectResponseSeverity("Please clarify your question")).toBe("clarification");
    expect(detectResponseSeverity("Can you be more specific?")).toBe("clarification");
  });

  it("returns null for normal informational responses", () => {
    expect(detectResponseSeverity("Our business hours are 9am to 5pm Monday through Friday.")).toBeNull();
    expect(detectResponseSeverity("Your order has been confirmed and will arrive in 3-5 days.")).toBeNull();
    expect(detectResponseSeverity("We offer three pricing plans: Basic, Pro, and Enterprise.")).toBeNull();
  });

  it("prioritizes strong_unknown over fallback when both match", () => {
    expect(detectResponseSeverity("I don't know, please contact support")).toBe("strong_unknown");
  });
});

describe("estimateConfidenceScore", () => {
  it("scores 65 with 3+ chunks and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: null })).toBe(65);
    expect(estimateConfidenceScore({ retrievalChunks: 5, severity: null })).toBe(65);
  });

  it("scores 58 with 2 chunks and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 2, severity: null })).toBe(58);
  });

  it("scores 50 with 1 chunk and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: null })).toBe(50);
  });

  it("scores 30 with 0 chunks and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: null })).toBe(30);
  });

  it("applies strong_unknown penalty of -30", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "strong_unknown" })).toBe(0);
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: "strong_unknown" })).toBe(35);
  });

  it("applies fallback penalty of -15", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "fallback" })).toBe(15);
    expect(estimateConfidenceScore({ retrievalChunks: 2, severity: "fallback" })).toBe(43);
  });

  it("applies clarification penalty of -5", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: "clarification" })).toBe(45);
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: "clarification" })).toBe(60);
  });

  it("applies negative feedback penalty of -25", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: null, hasNegativeFeedback: true })).toBe(25);
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: null, hasNegativeFeedback: true })).toBe(40);
  });

  it("clamps to 0 minimum", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "strong_unknown", hasNegativeFeedback: true })).toBe(0);
  });

  it("clamps to 100 maximum", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 10, severity: null })).toBe(65);
  });
});

describe("triageCategory", () => {
  it("categorizes score >= 60 as noise", () => {
    expect(triageCategory(60)).toBe("noise");
    expect(triageCategory(65)).toBe("noise");
    expect(triageCategory(100)).toBe("noise");
  });

  it("categorizes score 35-59 as monitor", () => {
    expect(triageCategory(35)).toBe("monitor");
    expect(triageCategory(50)).toBe("monitor");
    expect(triageCategory(59)).toBe("monitor");
  });

  it("categorizes score < 35 as review", () => {
    expect(triageCategory(34)).toBe("review");
    expect(triageCategory(15)).toBe("review");
    expect(triageCategory(0)).toBe("review");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/api && npx vitest run src/services/ai-review-service.test.ts
```

Expected: FAIL — `detectResponseSeverity`, `estimateConfidenceScore`, `triageCategory` are not exported.

- [ ] **Step 3: Add new pattern arrays and pure functions to the service**

In `apps/api/src/services/ai-review-service.ts`, ADD the following after the existing imports (keep all existing code for now — removal happens in Task 3):

```typescript
// ─── New severity-classified pattern arrays ────────────────────────────────

const STRONG_UNKNOWN_PATTERNS = [
  "i don't know", "i do not know", "i'm not sure", "i am not sure",
  "i don't have", "i do not have", "not familiar with",
  "unable to find", "unable to help", "cannot help with that", "can't help with that",
  "no information available", "not in my system", "not in my knowledge",
  "i am not familiar", "i'm not familiar"
];

const FALLBACK_PATTERNS = [
  "please contact support", "contact support", "reach out to",
  "i appreciate your", "unfortunately, i don't have", "unfortunately i don't have",
  "unfortunately i do not have",
  "i'm sorry, but i can't", "i am sorry, but i can't", "i'm sorry but i can't",
  "sorry but i can't", "sorry i can't", "sorry i don't",
  "i'm unable to", "i am unable to",
  "please reach out", "contact our team", "reach out to our team",
  "contact the team", "get in touch with support",
  "afraid i cannot", "afraid i can't", "regret i cannot", "regret i can't"
];

const CLARIFICATION_PATTERNS = [
  "please clarify", "could you clarify", "could you provide more details",
  "please provide more details", "please share more details",
  "could you share more details", "which one", "what exactly",
  "can you be more specific"
];

export type ResponseSeverity = "strong_unknown" | "fallback" | "clarification";

export function detectResponseSeverity(aiResponse: string): ResponseSeverity | null {
  if (includesPattern(aiResponse, STRONG_UNKNOWN_PATTERNS)) return "strong_unknown";
  if (includesPattern(aiResponse, FALLBACK_PATTERNS)) return "fallback";
  if (includesPattern(aiResponse, CLARIFICATION_PATTERNS)) return "clarification";
  return null;
}

export function estimateConfidenceScore(input: {
  retrievalChunks: number;
  severity: ResponseSeverity | null;
  hasNegativeFeedback?: boolean;
}): number {
  const chunks = Math.max(0, Number(input.retrievalChunks || 0));
  const chunkFactor = chunks === 0 ? -20 : chunks === 1 ? 0 : chunks === 2 ? 8 : 15;
  const severityPenalty =
    input.severity === "strong_unknown" ? -30 :
    input.severity === "fallback" ? -15 :
    input.severity === "clarification" ? -5 : 0;
  const feedbackPenalty = input.hasNegativeFeedback ? -25 : 0;
  return clampConfidence(50 + chunkFactor + severityPenalty + feedbackPenalty);
}

export function triageCategory(score: number): "noise" | "monitor" | "review" {
  if (score >= 60) return "noise";
  if (score >= 35) return "monitor";
  return "review";
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/api && npx vitest run src/services/ai-review-service.test.ts
```

Expected: all 18 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai-review-service.ts apps/api/src/services/ai-review-service.test.ts
git commit -m "feat: add detectResponseSeverity, estimateConfidenceScore, triageCategory with tests"
```

---

## Task 3: Service — Wire Triage into queueAiFailureForReview

**Files:**
- Modify: `apps/api/src/services/ai-review-service.ts`

Replace the old scoring path in `queueAiFailureForReview` with the new triage pipeline, and remove the now-superseded functions and pattern arrays.

- [ ] **Step 1: Update `inferFailureSignals` to use severity**

Replace the existing `inferFailureSignals` function (lines ~468–487) with:

```typescript
function inferFailureSignals(input: {
  retrievalChunks: number;
  severity: ResponseSeverity | null;
  confidenceScore: number;
  recurrenceCount?: number;
}): string[] {
  const signals: string[] = [];
  if (input.retrievalChunks === 0) signals.push("no_knowledge_match");
  if (input.severity === "strong_unknown" || input.severity === "fallback") {
    signals.push("fallback_response");
  }
  if (input.confidenceScore < 35) signals.push("low_confidence");
  if ((input.recurrenceCount ?? 0) > 0) signals.push("kb_not_effective");
  return Array.from(new Set(signals));
}
```

- [ ] **Step 2: Update `CreateQueueItemInput` to include `recurrenceCount`**

Replace the existing `CreateQueueItemInput` interface:

```typescript
interface CreateQueueItemInput {
  userId: string;
  conversationId: string;
  customerPhone: string;
  question: string;
  aiResponse: string;
  confidenceScore: number;
  signals: string[];
  recurrenceCount?: number;
  skipQuestionFilter?: boolean;
}
```

- [ ] **Step 3: Update the INSERT in `createQueueItem` to store `recurrence_count`**

Replace the `pool.query` INSERT inside `createQueueItem` (currently ~line 596):

```typescript
const inserted = await pool.query<{ id: string }>(
  `INSERT INTO ai_review_queue (
     user_id, conversation_id, customer_phone, question, ai_response,
     confidence_score, trigger_signals, recurrence_count
   )
   VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8)
   RETURNING id`,
  [
    input.userId,
    input.conversationId,
    input.customerPhone,
    question,
    aiResponse,
    clampConfidence(input.confidenceScore),
    input.signals,
    input.recurrenceCount ?? 0
  ]
);
```

- [ ] **Step 4: Replace `queueAiFailureForReview` body with the new triage pipeline**

Replace the entire body of `queueAiFailureForReview` (keep the exported function signature unchanged):

```typescript
export async function queueAiFailureForReview(input: {
  userId: string;
  conversationId: string;
  customerPhone: string;
  question: string;
  aiResponse: string;
  retrievalChunks: number;
}): Promise<{ queued: boolean; signals: string[]; confidenceScore: number; itemId: string | null }> {
  // Step 1: Question quality filter (unchanged)
  const questionRejection = getQuestionRejectionReason(input.question.trim());
  if (questionRejection) {
    console.log(`[AI-Review] Question filtered: reason=${questionRejection}`);
    return { queued: false, signals: [], confidenceScore: 0, itemId: null };
  }

  // Step 2: Score and triage
  const severity = detectResponseSeverity(input.aiResponse);
  const confidenceScore = estimateConfidenceScore({ retrievalChunks: input.retrievalChunks, severity });
  const category = triageCategory(confidenceScore);

  console.log(`[AI-Review] Triage: chunks=${input.retrievalChunks}, severity=${severity ?? "none"}, score=${confidenceScore}, category=${category}`);

  if (category === "noise" || category === "monitor") {
    // Audit log write happens in Task 5 — for now just log
    console.log(`[AI-Review] Auto-dismissed (${category}): score=${confidenceScore}, question="${input.question.substring(0, 60)}..."`);
    return { queued: false, signals: [], confidenceScore, itemId: null };
  }

  // Step 3: Learning loop check (implemented fully in Task 4)
  const signals = inferFailureSignals({ retrievalChunks: input.retrievalChunks, severity, confidenceScore });

  const created = await createQueueItem({
    userId: input.userId,
    conversationId: input.conversationId,
    customerPhone: input.customerPhone,
    question: input.question,
    aiResponse: input.aiResponse,
    confidenceScore,
    signals
  });

  return { queued: created.created, signals, confidenceScore, itemId: created.itemId };
}
```

- [ ] **Step 5: Remove superseded code**

Delete these functions and their pattern arrays (they are replaced by `detectResponseSeverity` + `estimateConfidenceScore`):
- `const FALLBACK_REPLY_PATTERNS = [...]` (the 150+ entry array, lines ~8–253)
- `const STRONG_UNKNOWN_REPLY_PATTERNS = [...]` (lines ~268–284)
- `const CLARIFICATION_REPLY_PATTERNS = [...]` (lines ~286–296)
- `function isFallbackResponse(...)`
- `function isStrongUnknownResponse(...)`
- `function isClarificationStyleResponse(...)`
- `function shouldQueueFailureForLearning(...)`

Keep: `NEGATIVE_FEEDBACK_PATTERNS`, `IRRELEVANT_QUESTION_PATTERNS`, `isNegativeFeedbackMessage`, `getQuestionRejectionReason`.

- [ ] **Step 6: Run tests to confirm nothing broke**

```bash
cd apps/api && npx vitest run src/services/ai-review-service.test.ts
```

Expected: all 18 tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/ai-review-service.ts
git commit -m "refactor: wire new triage pipeline into queueAiFailureForReview, remove 150+ pattern list"
```

---

## Task 4: Service — Learning Loop

**Files:**
- Modify: `apps/api/src/services/ai-review-service.ts`

Replace `findPendingDuplicate` with `checkPriorResolutions` which implements the learning loop.

- [ ] **Step 1: Add tests for learning loop logic**

Add to `apps/api/src/services/ai-review-service.test.ts` — these test the `triageCategory` boundary that drives the KB-effective check (pure logic only; DB queries are tested via integration):

```typescript
describe("estimateConfidenceScore — kb_effective boundary", () => {
  it("scores >= 35 (monitor/noise) when KB answered and no strong signal", () => {
    // After KB resolution, same question with clarification only → monitor → skip
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: "clarification" })).toBe(45);
    expect(triageCategory(45)).toBe("monitor");
  });

  it("scores < 35 (review) when strong failure persists after KB resolution", () => {
    // After KB resolution, same question still gets strong_unknown → review → re-queue
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "strong_unknown" })).toBe(0);
    expect(triageCategory(0)).toBe("review");
  });
});
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd apps/api && npx vitest run src/services/ai-review-service.test.ts
```

Expected: all tests PASS (these tests use already-implemented pure functions).

- [ ] **Step 3: Replace `findPendingDuplicate` with `checkPriorResolutions`**

Delete the existing `findPendingDuplicate` function and add:

```typescript
async function checkPriorResolutions(input: {
  userId: string;
  conversationId: string;
  question: string;
  severity: ResponseSeverity | null;
}): Promise<{ skipQueue: boolean; recurrenceCount: number; duplicateId: string | null }> {
  const normalizedQuestion = normalizeText(input.question);

  // Check resolved items in the last 24 hours for this question
  const resolved = await pool.query<{ id: string; question: string; recurrence_count: number }>(
    `SELECT id, question, recurrence_count
     FROM ai_review_queue
     WHERE user_id = $1
       AND status = 'resolved'
       AND created_at >= NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 50`,
    [input.userId]
  );

  const matchingResolved = resolved.rows.filter(
    (row) => normalizeText(row.question) === normalizedQuestion
  );

  if (matchingResolved.length > 0) {
    const hasStrongFailure =
      input.severity === "strong_unknown" || input.severity === "fallback";

    if (!hasStrongFailure) {
      // KB is working — question came back but AI answered well enough
      console.log(`[AI-Review] KB effective — skipping queue for: "${input.question.substring(0, 60)}..."`);
      return { skipQueue: true, recurrenceCount: 0, duplicateId: matchingResolved[0].id };
    }

    // KB not effective — same question still failing, increment recurrence
    const maxRecurrence = Math.max(...matchingResolved.map((r) => r.recurrence_count));
    console.log(`[AI-Review] Recurring failure (recurrence_count=${maxRecurrence + 1}): "${input.question.substring(0, 60)}..."`);
    return { skipQueue: false, recurrenceCount: maxRecurrence + 1, duplicateId: null };
  }

  // No resolved history — check for pending duplicate in same conversation (6-hour window)
  const pending = await pool.query<{ id: string; question: string }>(
    `SELECT id, question
     FROM ai_review_queue
     WHERE user_id = $1
       AND conversation_id = $2
       AND status = 'pending'
       AND created_at >= NOW() - ($3::text || ' seconds')::interval
     ORDER BY created_at DESC
     LIMIT 10`,
    [input.userId, input.conversationId, String(DUPLICATE_WINDOW_SECONDS)]
  );

  for (const row of pending.rows) {
    if (normalizeText(row.question) === normalizedQuestion) {
      console.log(`[AI-Review] Pending duplicate found: existing_id=${row.id}`);
      return { skipQueue: true, recurrenceCount: 0, duplicateId: row.id };
    }
  }

  return { skipQueue: false, recurrenceCount: 0, duplicateId: null };
}
```

- [ ] **Step 4: Wire `checkPriorResolutions` into `queueAiFailureForReview`**

Replace the "Step 3: Learning loop check" comment section in `queueAiFailureForReview` (from Task 3) with:

```typescript
  // Step 3: Learning loop
  const priorCheck = await checkPriorResolutions({
    userId: input.userId,
    conversationId: input.conversationId,
    question: input.question,
    severity
  });

  if (priorCheck.skipQueue) {
    return { queued: false, signals: [], confidenceScore, itemId: priorCheck.duplicateId };
  }

  const signals = inferFailureSignals({
    retrievalChunks: input.retrievalChunks,
    severity,
    confidenceScore,
    recurrenceCount: priorCheck.recurrenceCount
  });

  const created = await createQueueItem({
    userId: input.userId,
    conversationId: input.conversationId,
    customerPhone: input.customerPhone,
    question: input.question,
    aiResponse: input.aiResponse,
    confidenceScore,
    signals,
    recurrenceCount: priorCheck.recurrenceCount
  });

  return { queued: created.created, signals, confidenceScore, itemId: created.itemId };
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai-review-service.ts apps/api/src/services/ai-review-service.test.ts
git commit -m "feat: add learning loop — track recurring failures after KB resolutions"
```

---

## Task 5: Service — Audit Log Writes

**Files:**
- Modify: `apps/api/src/services/ai-review-service.ts`

Add the DB audit log write for auto-dismissed items and the `listAiReviewAuditLog` export.

- [ ] **Step 1: Add `AiReviewAuditLogItem` type and `writeAuditLog` function**

Add after the `AiReviewQueueItem` interface:

```typescript
export interface AiReviewAuditLogItem {
  id: string;
  user_id: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  triage_category: "noise" | "monitor";
  dismiss_reason: string;
  created_at: string;
}

async function writeAuditLog(input: {
  userId: string;
  question: string;
  aiResponse: string;
  confidenceScore: number;
  triageCategory: "noise" | "monitor";
  dismissReason: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ai_review_audit_log
       (user_id, question, ai_response, confidence_score, triage_category, dismiss_reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.userId,
      input.question,
      input.aiResponse,
      input.confidenceScore,
      input.triageCategory,
      input.dismissReason
    ]
  );
}
```

- [ ] **Step 2: Replace the console.log stub in `queueAiFailureForReview` with a real audit log write**

Find the auto-dismiss block in `queueAiFailureForReview` (added in Task 3) and replace:

```typescript
  if (category === "noise" || category === "monitor") {
    await writeAuditLog({
      userId: input.userId,
      question: input.question,
      aiResponse: input.aiResponse,
      confidenceScore,
      triageCategory: category,
      dismissReason: `score_${confidenceScore}_${category}_threshold`
    });
    console.log(`[AI-Review] Auto-dismissed (${category}): score=${confidenceScore}`);
    return { queued: false, signals: [], confidenceScore, itemId: null };
  }
```

- [ ] **Step 3: Add `listAiReviewAuditLog` export**

Add after `listAiReviewQueue`:

```typescript
export async function listAiReviewAuditLog(
  userId: string,
  options?: { limit?: number }
): Promise<AiReviewAuditLogItem[]> {
  const limit = Math.max(1, Math.min(500, options?.limit ?? 100));
  const result = await pool.query<AiReviewAuditLogItem>(
    `SELECT id, user_id, question, ai_response, confidence_score,
            triage_category, dismiss_reason, created_at::text
     FROM ai_review_audit_log
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/ai-review-service.ts
git commit -m "feat: write auto-dismissed items to audit log, add listAiReviewAuditLog"
```

---

## Task 6: Service — Update List Query for Recurrence Sort

**Files:**
- Modify: `apps/api/src/services/ai-review-service.ts`

- [ ] **Step 1: Add `recurrence_count` to `AiReviewQueueItem` interface**

Add `recurrence_count: number;` to the `AiReviewQueueItem` interface:

```typescript
export interface AiReviewQueueItem {
  id: string;
  user_id: string;
  conversation_id: string | null;
  customer_phone: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  trigger_signals: string[];
  status: AiReviewQueueStatus;
  resolution_answer: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  recurrence_count: number;
}
```

- [ ] **Step 2: Update the SELECT query in `listAiReviewQueue`**

Replace the `pool.query` inside `listAiReviewQueue` with:

```typescript
  const result = await pool.query<AiReviewQueueItem>(
    `SELECT
       id, user_id, conversation_id, customer_phone, question, ai_response,
       confidence_score, trigger_signals, status, resolution_answer,
       resolved_at::text, resolved_by, created_at::text, recurrence_count
     FROM ai_review_queue
     WHERE user_id = $1
       AND ($2::text = 'all' OR status = $2::text)
     ORDER BY
       CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
       CASE WHEN status = 'pending' THEN recurrence_count ELSE 0 END DESC,
       created_at DESC
     LIMIT $3`,
    [userId, status, limit]
  );
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/ai-review-service.ts
git commit -m "feat: sort pending queue by recurrence_count desc, include recurrence_count in list response"
```

---

## Task 7: API — Audit Log Endpoint

**Files:**
- Modify: `apps/api/src/routes/ai-review.ts`

- [ ] **Step 1: Import `listAiReviewAuditLog` and add the new route**

Update the import at the top of `apps/api/src/routes/ai-review.ts`:

```typescript
import { listAiReviewQueue, resolveAiReviewQueueItem, listAiReviewAuditLog } from "../services/ai-review-service.js";
```

Then add the new route inside `aiReviewRoutes`, after the existing `resolveAiReviewQueueItem` route:

```typescript
  fastify.get(
    "/api/ai-review/audit-log",
    { preHandler: [fastify.requireAuth] },
    async (request, reply) => {
      const parsed = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional()
      }).safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid query." });
      }

      const items = await listAiReviewAuditLog(request.authUser.userId, {
        limit: parsed.data.limit
      });
      return { items };
    }
  );
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd apps/api && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/ai-review.ts
git commit -m "feat: add GET /api/ai-review/audit-log endpoint"
```

---

## Task 8: Frontend — Types, API Client, Query Keys

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/shared/dashboard/query-keys.ts`
- Modify: `apps/web/src/modules/dashboard/studio/review/api.ts`
- Modify: `apps/web/src/modules/dashboard/studio/review/queries.ts`

- [ ] **Step 1: Add `recurrence_count` to `AiReviewQueueItem` in `lib/api.ts`**

Find the `AiReviewQueueItem` interface (around line 2095) and add `recurrence_count`:

```typescript
export interface AiReviewQueueItem {
  id: string;
  user_id: string;
  conversation_id: string | null;
  customer_phone: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  trigger_signals: string[];
  status: "pending" | "resolved";
  resolution_answer: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  recurrence_count: number;
}
```

- [ ] **Step 2: Add `AiReviewAuditLogItem` type and `fetchAiReviewAuditLog` to `lib/api.ts`**

Add after `resolveAiReviewQueueItem`:

```typescript
export interface AiReviewAuditLogItem {
  id: string;
  user_id: string;
  question: string;
  ai_response: string;
  confidence_score: number;
  triage_category: "noise" | "monitor";
  dismiss_reason: string;
  created_at: string;
}

export function fetchAiReviewAuditLog(token: string, options?: { limit?: number }) {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  const path = query ? `/api/ai-review/audit-log?${query}` : "/api/ai-review/audit-log";
  return apiRequest<{ items: AiReviewAuditLogItem[] }>(path, { token });
}
```

- [ ] **Step 3: Add `reviewAuditLog` key to `query-keys.ts`**

In `apps/web/src/shared/dashboard/query-keys.ts`, add after `reviewConversation`:

```typescript
  reviewAuditLog: [...dashboardReviewRoot, "audit-log"] as const,
```

- [ ] **Step 4: Replace `review/api.ts` with the updated version (adds `fetchAuditLog`, keeps existing functions)**

Full file content for `apps/web/src/modules/dashboard/studio/review/api.ts`:

```typescript
import {
  fetchAiReviewQueue,
  fetchConversationMessages,
  resolveAiReviewQueueItem,
  fetchAiReviewAuditLog,
  type AiReviewQueueItem,
  type AiReviewAuditLogItem,
  type ConversationMessage
} from "../../../../lib/api";

export async function fetchReviewQueue(token: string, status: "all" | "pending" | "resolved") {
  const response = await fetchAiReviewQueue(token, {
    status,
    limit: 300
  });
  return response.queue;
}

export async function fetchReviewConversation(token: string, conversationId: string): Promise<ConversationMessage[]> {
  const response = await fetchConversationMessages(token, conversationId);
  return response.messages;
}

export function resolveReviewItem(
  token: string,
  reviewId: string,
  payload: { resolutionAnswer?: string; addToKnowledgeBase?: boolean }
) {
  return resolveAiReviewQueueItem(token, reviewId, payload);
}

export async function fetchAuditLog(token: string): Promise<AiReviewAuditLogItem[]> {
  const response = await fetchAiReviewAuditLog(token, { limit: 100 });
  return response.items;
}

export type { AiReviewQueueItem, AiReviewAuditLogItem, ConversationMessage };
```

- [ ] **Step 5: Replace `review/queries.ts` with the updated version (adds `useAuditLogQuery`, keeps existing hooks)**

Full file content for `apps/web/src/modules/dashboard/studio/review/queries.ts`:

```typescript
import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { fetchReviewConversation, fetchReviewQueue, fetchAuditLog } from "./api";

export function buildReviewQueueQueryOptions(token: string, status: "all" | "pending" | "resolved") {
  return queryOptions({
    queryKey: dashboardQueryKeys.reviewQueue(status),
    queryFn: () => fetchReviewQueue(token, status)
  });
}

export function useReviewQueueQuery(token: string, status: "all" | "pending" | "resolved") {
  return useQuery(buildReviewQueueQueryOptions(token, status));
}

export function buildReviewConversationQueryOptions(token: string, conversationId: string | null) {
  return queryOptions({
    queryKey: dashboardQueryKeys.reviewConversation(conversationId ?? "none"),
    queryFn: () => fetchReviewConversation(token, conversationId as string),
    enabled: Boolean(conversationId)
  });
}

export function useReviewConversationQuery(token: string, conversationId: string | null) {
  return useQuery(buildReviewConversationQueryOptions(token, conversationId));
}

export function useAuditLogQuery(token: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.reviewAuditLog,
    queryFn: () => fetchAuditLog(token)
  });
}
```

- [ ] **Step 6: Type-check**

```bash
cd apps/web && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/shared/dashboard/query-keys.ts apps/web/src/modules/dashboard/studio/review/api.ts apps/web/src/modules/dashboard/studio/review/queries.ts
git commit -m "feat: add audit log types, fetchAiReviewAuditLog, useAuditLogQuery, reviewAuditLog query key"
```

---

## Task 9: Frontend — Review Center UI

**Files:**
- Modify: `apps/web/src/modules/dashboard/studio/review/route.tsx`

- [ ] **Step 1: Update imports and type**

At the top of `route.tsx`, add `useAuditLogQuery` to imports and update `ReviewStatusFilter`:

```typescript
import { useAuditLogQuery } from "./queries";
import type { AiReviewAuditLogItem } from "./api";

type ReviewStatusFilter = "all" | "pending" | "resolved" | "dismissed";
```

- [ ] **Step 2: Add audit log query and update highlights**

After the existing `reviewConversationQuery` declaration, add:

```typescript
  const auditLogQuery = useAuditLogQuery(token);
```

Replace the `reviewHighlights` useMemo with (change `lowConfidenceToday` → `recurringToday`):

```typescript
  const reviewHighlights = useMemo(
    () =>
      (reviewQuery.data ?? []).reduce(
        (acc, row) => {
          if (row.status === "pending") {
            acc.pending += 1;
          }
          if (row.status === "resolved" && isSameLocalDay(row.resolved_at)) {
            acc.resolvedToday += 1;
          }
          if (isSameLocalDay(row.created_at) && row.recurrence_count > 0) {
            acc.recurringToday += 1;
          }
          return acc;
        },
        { pending: 0, resolvedToday: 0, recurringToday: 0 }
      ),
    [reviewQuery.data]
  );
```

- [ ] **Step 3: Update stats cards**

Replace the third `<article>` card (currently "Low confidence today"):

```tsx
      <div className="ai-review-cards">
        <article>
          <strong>{reviewHighlights.pending}</strong>
          <span>Pending review</span>
        </article>
        <article>
          <strong>{reviewHighlights.recurringToday}</strong>
          <span>Recurring today</span>
        </article>
        <article>
          <strong>{reviewHighlights.resolvedToday}</strong>
          <span>Resolved today</span>
        </article>
      </div>
```

- [ ] **Step 4: Update filter tabs to include Dismissed with pending count badge**

Replace the `ai-review-filters` div:

```tsx
      <div className="ai-review-filters">
        {([
          { value: "pending", label: reviewHighlights.pending > 0 ? `Pending (${reviewHighlights.pending})` : "Pending" },
          { value: "resolved", label: "Resolved" },
          { value: "dismissed", label: "Dismissed" },
          { value: "all", label: "All" }
        ] as Array<{ value: ReviewStatusFilter; label: string }>).map((item) => (
          <button
            key={item.value}
            type="button"
            className={reviewStatusFilter === item.value ? "active" : ""}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (item.value === "pending") {
                next.delete("status");
              } else {
                next.set("status", item.value);
              }
              setSearchParams(next, { replace: true });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
```

- [ ] **Step 5: Update the table to show Dismissed view or queue view**

Replace the entire `ai-review-table-wrap` div with:

```tsx
        <div className="ai-review-table-wrap finance-table-wrap">
          {reviewStatusFilter === "dismissed" ? (
            auditLogQuery.isLoading ? (
              <p className="empty-note">Loading dismissed items...</p>
            ) : (auditLogQuery.data ?? []).length === 0 ? (
              <p className="empty-note">No auto-dismissed items yet.</p>
            ) : (
              <table className="finance-table ai-review-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>AI Answer</th>
                    <th>Confidence</th>
                    <th>Category</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(auditLogQuery.data ?? []).map((item: AiReviewAuditLogItem) => (
                    <tr key={item.id}>
                      <td>{item.question}</td>
                      <td>{item.ai_response}</td>
                      <td>
                        <span className={
                          item.confidence_score < 35 ? "ai-review-confidence low" :
                          item.confidence_score < 60 ? "ai-review-confidence amber" :
                          "ai-review-confidence"
                        }>
                          {item.confidence_score}%
                        </span>
                      </td>
                      <td>{item.triage_category}</td>
                      <td><small>{formatDateTime(item.created_at)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : reviewQuery.isLoading ? (
            <p className="empty-note">Loading review queue...</p>
          ) : (reviewQuery.data ?? []).length === 0 ? (
            <p className="empty-note">No conversations in this filter yet.</p>
          ) : (
            <table className="finance-table ai-review-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Question</th>
                  <th>AI Answer</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(reviewQuery.data ?? []).map((item) => (
                  <tr
                    key={item.id}
                    className={selectedReviewId === item.id ? "selected" : ""}
                    onClick={() => setSelectedReviewId(item.id)}
                  >
                    <td>
                      <strong>{formatPhone(item.customer_phone)}</strong>
                      <small>{formatDateTime(item.created_at)}</small>
                    </td>
                    <td>{item.question}</td>
                    <td>{item.ai_response}</td>
                    <td>
                      <span className={
                        item.confidence_score < 35 ? "ai-review-confidence low" :
                        item.confidence_score < 60 ? "ai-review-confidence amber" :
                        "ai-review-confidence"
                      }>
                        {item.confidence_score}%
                      </span>
                    </td>
                    <td>
                      {item.recurrence_count > 0 && (
                        <span className="ai-review-recurring">Recurring ×{item.recurrence_count}</span>
                      )}
                      {getReviewStatusLabel(item.status)}
                    </td>
                    <td>
                      <button type="button" className="ghost-btn" onClick={() => setSelectedReviewId(item.id)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
```

- [ ] **Step 6: Add recurrence warning to the detail panel**

In the detail panel `<aside>`, add the recurrence warning block BEFORE the `<label>` for "Correct answer" (after the conversation context block):

```tsx
              {selectedReview.recurrence_count > 0 ? (
                <div className="ai-review-block ai-review-recurring-warning">
                  <strong>Recurring failure</strong>
                  <p>
                    This question has appeared {selectedReview.recurrence_count} time
                    {selectedReview.recurrence_count > 1 ? "s" : ""} after a previous resolution.
                    The KB answer you wrote before did not prevent this failure.
                    Consider updating your answer below.
                  </p>
                </div>
              ) : null}
```

- [ ] **Step 7: Update the detail panel confidence display to use color tiers**

Replace both `ai-review-confidence` spans in the detail panel (there are two — one in `ai-review-meta-row` and one in the table):

```tsx
              <div className="ai-review-meta-row">
                <span className={
                  selectedReview.confidence_score < 35 ? "ai-review-confidence low" :
                  selectedReview.confidence_score < 60 ? "ai-review-confidence amber" :
                  "ai-review-confidence"
                }>
                  Confidence {selectedReview.confidence_score}%
                </span>
                <div className="ai-review-signals">
                  {selectedReview.trigger_signals.map((signal) => (
                    <span key={signal}>{getReviewSignalLabel(signal)}</span>
                  ))}
                </div>
              </div>
```

- [ ] **Step 8: Type-check**

```bash
cd apps/web && npm run lint
```

Expected: no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/modules/dashboard/studio/review/route.tsx
git commit -m "feat: add Dismissed tab, recurring badge, recurrence warning, confidence color tiers to review center UI"
```

---

## Done

All 9 tasks produce working, independently testable software. After all tasks are merged:

- The review queue only receives items with `score < 35` (genuine failures)
- Items scoring 35–59 or ≥60 go to the audit log visible in the "Dismissed" tab
- Recurring failures surface at the top of the pending list with a count badge
- The confidence % now reflects chunk quality + signal severity + user feedback — not just chunk count
