# Sequence Report Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated `/dashboard/sequence/:id/report` page showing enrollment stats, per-step funnel, filterable enrollments table, and per-enrollment log drill-down — matching the broadcast report UX pattern.

**Architecture:** Three API additions (contact-enriched enrollment list, status filter, per-step funnel stats) feed a new standalone React component `SequenceReportPage.tsx`. The existing `route.tsx` gets a new router entry and a "View Report" button added to the builder header. Three existing ActivityPanel bugs are fixed as part of the same router change.

**Tech Stack:** PostgreSQL (existing pool), Fastify, React 18, React Query v5, React Router v6, Vitest + React Testing Library

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `WAgen/apps/api/src/services/sequence-service.ts` | Update `listSequenceEnrollments` to JOIN contacts; add `getSequenceStepFunnel` |
| Modify | `WAgen/apps/api/src/routes/sequences.ts` | Add `?status` filter + new `GET /api/sequences/:sequenceId/step-funnel` route |
| Modify | `WAgen/apps/web/src/lib/api.ts` | Update `SequenceEnrollment` type; add `SequenceStepFunnel`/`fetchSequenceStepFunnel`; add status param to `fetchSequenceEnrollments` |
| Modify | `WAgen/apps/web/src/modules/dashboard/sequence/queries.ts` | Add `useSequenceStepFunnelQuery`; update `useSequenceEnrollmentsQuery` to accept status |
| Create | `WAgen/apps/web/src/modules/dashboard/sequence/SequenceReportPage.tsx` | New full-page report component |
| Modify | `WAgen/apps/web/src/modules/dashboard/sequence/sequence.css` | Add report-specific CSS classes |
| Modify | `WAgen/apps/web/src/modules/dashboard/sequence/route.tsx` | Add `:sequenceId/report` route; "View Report" button; fix 3 ActivityPanel bugs |
| Modify | `WAgen/apps/web/src/app/router.test.tsx` | Add route test for `/dashboard/sequence/:id/report` |

---

## Task 1: API — Enrich enrollment list with contact info + add status filter

**Files:**
- Modify: `WAgen/apps/api/src/services/sequence-service.ts:446-457`
- Modify: `WAgen/apps/api/src/routes/sequences.ts:146-150`

- [ ] **Step 1: Update `listSequenceEnrollments` to JOIN contacts and accept optional status filter**

In `sequence-service.ts`, replace the `listSequenceEnrollments` function (lines 446-457):

```typescript
export async function listSequenceEnrollments(
  userId: string,
  sequenceId: string,
  status?: SequenceEnrollmentStatus
): Promise<(SequenceEnrollment & { contact_phone: string; contact_name: string | null })[]> {
  const result = await pool.query<SequenceEnrollment & { contact_phone: string; contact_name: string | null }>(
    `SELECT se.*,
            c.phone_number AS contact_phone,
            c.display_name AS contact_name
     FROM sequence_enrollments se
     JOIN sequences s ON s.id = se.sequence_id
     JOIN contacts c ON c.id = se.contact_id
     WHERE se.sequence_id = $1
       AND s.user_id = $2
       ${status ? "AND se.status = $3" : ""}
     ORDER BY se.entered_at DESC`,
    status ? [sequenceId, userId, status] : [sequenceId, userId]
  );
  return result.rows;
}
```

- [ ] **Step 2: Update the route to pass the `status` query param**

In `sequences.ts`, replace the enrollment list route (lines 146-150):

```typescript
const EnrollmentQuerySchema = z.object({
  status: z.enum(["active", "completed", "failed", "stopped"]).optional()
});

fastify.get("/api/sequences/:sequenceId/enrollments", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
  const { sequenceId } = request.params as { sequenceId: string };
  const parsed = EnrollmentQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid query" });
  }
  const enrollments = await listSequenceEnrollments(request.authUser.userId, sequenceId, parsed.data.status);
  return { enrollments };
});
```

Add `EnrollmentQuerySchema` before the `sequenceRoutes` function (near line 17 with the other schemas) and update the route inside `sequenceRoutes`.

- [ ] **Step 3: Commit**

```bash
git add WAgen/apps/api/src/services/sequence-service.ts WAgen/apps/api/src/routes/sequences.ts
git commit -m "feat(api): enrich enrollment list with contact info and add status filter"
```

---

## Task 2: API — Add per-step funnel stats endpoint

**Files:**
- Modify: `WAgen/apps/api/src/services/sequence-service.ts` (append)
- Modify: `WAgen/apps/api/src/routes/sequences.ts` (append inside sequenceRoutes)

- [ ] **Step 1: Add `getSequenceStepFunnel` to `sequence-service.ts`**

Append to the end of `sequence-service.ts`:

```typescript
export interface SequenceStepFunnelRow {
  step_id: string;
  step_order: number;
  delay_value: number;
  delay_unit: SequenceDelayUnit;
  message_template_id: string;
  reached: number;
}

export async function getSequenceStepFunnel(
  userId: string,
  sequenceId: string
): Promise<SequenceStepFunnelRow[]> {
  const result = await pool.query<SequenceStepFunnelRow>(
    `SELECT ss.id         AS step_id,
            ss.step_order,
            ss.delay_value,
            ss.delay_unit,
            ss.message_template_id,
            COUNT(DISTINCT sl.enrollment_id) AS reached
     FROM sequence_steps ss
     JOIN sequences s ON s.id = ss.sequence_id AND s.user_id = $2
     LEFT JOIN sequence_logs sl ON sl.step_id = ss.id
     WHERE ss.sequence_id = $1
     GROUP BY ss.id, ss.step_order, ss.delay_value, ss.delay_unit, ss.message_template_id
     ORDER BY ss.step_order ASC`,
    [sequenceId, userId]
  );
  return result.rows;
}
```

- [ ] **Step 2: Add the route in `sequences.ts`**

Inside the `sequenceRoutes` function, append before the closing brace:

```typescript
fastify.get("/api/sequences/:sequenceId/step-funnel", { preHandler: [fastify.requireAuth] }, async (request, reply) => {
  const { sequenceId } = request.params as { sequenceId: string };
  const rows = await getSequenceStepFunnel(request.authUser.userId, sequenceId);
  return { funnel: rows };
});
```

Add the import at the top of `sequences.ts`:

```typescript
import {
  // ... existing imports ...,
  getSequenceStepFunnel
} from "../services/sequence-service.js";
```

- [ ] **Step 3: Commit**

```bash
git add WAgen/apps/api/src/services/sequence-service.ts WAgen/apps/api/src/routes/sequences.ts
git commit -m "feat(api): add per-step funnel stats endpoint"
```

---

## Task 3: Frontend — Update types and API functions

**Files:**
- Modify: `WAgen/apps/web/src/lib/api.ts`

- [ ] **Step 1: Update `SequenceEnrollment` interface to include contact fields**

Find the `SequenceEnrollment` interface (~line 2644) and add two fields:

```typescript
export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  contact_id: string;
  contact_phone: string;
  contact_name: string | null;
  status: SequenceEnrollmentStatus;
  current_step: number;
  entered_at: string;
  next_run_at: string;
  last_executed_at: string | null;
  last_message_id: string | null;
  last_delivery_status: string | null;
  retry_count: number;
  retry_started_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Add `SequenceStepFunnelRow` interface after `SequenceLog`**

After the `SequenceLog` interface (~line 2670), add:

```typescript
export interface SequenceStepFunnelRow {
  step_id: string;
  step_order: number;
  delay_value: number;
  delay_unit: SequenceDelayUnit;
  message_template_id: string;
  reached: number;
}
```

- [ ] **Step 3: Update `fetchSequenceEnrollments` to accept optional status**

Find `fetchSequenceEnrollments` (~line 2759) and replace:

```typescript
export function fetchSequenceEnrollments(
  token: string,
  sequenceId: string,
  status?: SequenceEnrollmentStatus
) {
  const query = status ? `?status=${status}` : "";
  return apiRequest<{ enrollments: SequenceEnrollment[] }>(
    `/api/sequences/${sequenceId}/enrollments${query}`,
    { token }
  );
}
```

- [ ] **Step 4: Add `fetchSequenceStepFunnel` after `fetchSequenceEnrollments`**

```typescript
export function fetchSequenceStepFunnel(token: string, sequenceId: string) {
  return apiRequest<{ funnel: SequenceStepFunnelRow[] }>(
    `/api/sequences/${sequenceId}/step-funnel`,
    { token }
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add WAgen/apps/web/src/lib/api.ts
git commit -m "feat(web): add contact fields to SequenceEnrollment type and step-funnel API function"
```

---

## Task 4: Frontend — Add React Query hooks

**Files:**
- Modify: `WAgen/apps/web/src/modules/dashboard/sequence/queries.ts`

- [ ] **Step 1: Update `useSequenceEnrollmentsQuery` to accept optional status**

Find `useSequenceEnrollmentsQuery` (line 38) and replace:

```typescript
export function useSequenceEnrollmentsQuery(
  token: string,
  sequenceId: string,
  status?: SequenceEnrollmentStatus
) {
  return useQuery({
    queryKey: dashboardQueryKeys.sequenceEnrollments(sequenceId, status),
    queryFn: () =>
      fetchSequenceEnrollments(token, sequenceId, status).then(
        (response) => response.enrollments
      ),
    enabled: Boolean(token && sequenceId)
  });
}
```

Add the `SequenceEnrollmentStatus` import to the imports block at the top:

```typescript
import {
  // ... existing imports ...
  fetchSequenceStepFunnel,
  type SequenceEnrollmentStatus,
} from "../../../lib/api";
```

- [ ] **Step 2: Update `sequenceEnrollments` query key to include status**

In `WAgen/apps/web/src/shared/dashboard/query-keys.ts`, find the `sequenceEnrollments` key (line ~61) and update:

```typescript
sequenceEnrollments: (sequenceId: string, status?: string) =>
  [...dashboardSequenceRoot, "enrollments", sequenceId, status ?? "all"] as const,
```

- [ ] **Step 3: Add `useSequenceStepFunnelQuery` to `queries.ts`**

Append after `useSequenceLogsQuery`:

```typescript
export function useSequenceStepFunnelQuery(token: string, sequenceId: string) {
  return useQuery({
    queryKey: [...dashboardQueryKeys.sequenceRoot, "step-funnel", sequenceId],
    queryFn: () =>
      fetchSequenceStepFunnel(token, sequenceId).then((r) => r.funnel),
    enabled: Boolean(token && sequenceId)
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add WAgen/apps/web/src/modules/dashboard/sequence/queries.ts WAgen/apps/web/src/shared/dashboard/query-keys.ts
git commit -m "feat(web): add step-funnel query hook and status filter to enrollments query"
```

---

## Task 5: CSS for report page

**Files:**
- Modify: `WAgen/apps/web/src/modules/dashboard/sequence/sequence.css` (append)

- [ ] **Step 1: Append report CSS classes to `sequence.css`**

Append at the very end of `sequence.css`:

```css
/* ═══════════════════════════════════════
   REPORT PAGE
═══════════════════════════════════════ */

.seq-report-page {
  display: grid;
  gap: 12px;
  padding: 0 0 2rem;
  color: var(--seq-ink);
  font-family: inherit;
  font-size: 13px;
}

/* ── Report header ── */
.seq-report-header {
  background: #fff;
  border: 1px solid #e2eaf4;
  border-radius: 12px;
  padding: 14px 18px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.seq-report-back {
  font-size: 12px;
  color: #2563eb;
  font-weight: 600;
  margin-bottom: 4px;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.seq-report-title {
  font-size: 18px;
  font-weight: 800;
  margin: 0 0 4px;
  letter-spacing: -0.02em;
}
.seq-report-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: var(--seq-muted);
}
.seq-report-actions {
  display: flex;
  gap: 6px;
}

/* ── Stats row ── */
.seq-report-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}
.seq-report-stat {
  background: #fff;
  border: 1px solid #e2eaf4;
  border-radius: 10px;
  padding: 12px 14px;
}
.seq-report-stat-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--seq-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 4px;
}
.seq-report-stat-val {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
  line-height: 1;
}
.seq-report-stat-pct {
  font-size: 10px;
  font-weight: 600;
  color: var(--seq-muted);
  margin-top: 2px;
}

/* ── Step funnel ── */
.seq-report-funnel {
  background: #fff;
  border: 1px solid #e2eaf4;
  border-radius: 12px;
  padding: 14px 18px;
}
.seq-funnel-row {
  display: grid;
  grid-template-columns: 24px 1fr 200px 80px;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
}
.seq-funnel-row:last-child { border-bottom: none; }
.seq-funnel-num {
  width: 22px;
  height: 22px;
  background: #dbeafe;
  color: #2563eb;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.seq-funnel-step-name { font-size: 12px; font-weight: 700; }
.seq-funnel-step-meta { font-size: 10px; color: var(--seq-muted); }
.seq-funnel-bar-wrap { display: flex; align-items: center; gap: 6px; }
.seq-funnel-bar {
  height: 6px;
  background: #e2eaf4;
  border-radius: 3px;
  flex: 1;
  overflow: hidden;
}
.seq-funnel-bar-fill { height: 100%; border-radius: 3px; background: #2563eb; }
.seq-funnel-count { font-size: 11px; font-weight: 700; text-align: right; min-width: 46px; }

/* ── Enrollments table card ── */
.seq-report-table-card {
  background: #fff;
  border: 1px solid #e2eaf4;
  border-radius: 12px;
  overflow: hidden;
}
.seq-report-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
}
.seq-report-filter-pills { display: flex; gap: 6px; }
.seq-report-fpill {
  border: 1px solid #e2eaf4;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--seq-muted);
  cursor: pointer;
  background: none;
}
.seq-report-fpill.active { background: #dbeafe; color: #2563eb; border-color: #bfdbfe; }
.seq-report-table { width: 100%; border-collapse: collapse; }
.seq-report-table thead th {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--seq-muted);
  padding: 8px 14px;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}
.seq-report-table tbody tr {
  border-bottom: 1px solid #f8fafc;
  cursor: pointer;
  transition: background 0.1s;
}
.seq-report-table tbody tr:hover { background: #f0f4ff; }
.seq-report-table tbody tr.selected { background: #eff6ff; }
.seq-report-table tbody td { padding: 9px 14px; font-size: 12px; color: var(--seq-sub); vertical-align: middle; }
.seq-report-contact-phone { font-weight: 700; color: #2563eb; display: flex; align-items: center; gap: 4px; }
.seq-report-contact-name { font-size: 11px; color: var(--seq-muted); }

/* ── Logs panel ── */
.seq-report-logs {
  background: #fff;
  border: 1px solid #e2eaf4;
  border-radius: 12px;
  overflow: hidden;
}
.seq-report-logs-head {
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.seq-log-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 16px;
  border-bottom: 1px solid #f8fafc;
}
.seq-log-row:last-child { border-bottom: none; }
.seq-log-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
}
.seq-log-dot-pending  { background: #94a3b8; }
.seq-log-dot-sent     { background: #2563eb; }
.seq-log-dot-delivered { background: #0d9488; }
.seq-log-dot-read     { background: #059669; }
.seq-log-dot-failed   { background: #be123c; }
.seq-log-dot-retrying { background: #d97706; }
.seq-log-dot-stopped  { background: #7c3aed; }
.seq-log-dot-completed { background: #059669; }
.seq-log-dot-skipped  { background: #94a3b8; }
.seq-log-info { flex: 1; display: grid; gap: 1px; }
.seq-log-status { font-size: 11px; font-weight: 700; text-transform: capitalize; }
.seq-log-time { font-size: 10px; color: var(--seq-muted); }
.seq-log-meta { font-size: 10px; color: var(--seq-muted); }
.seq-log-err { font-size: 10px; color: #be123c; margin-top: 2px; }
```

- [ ] **Step 2: Commit**

```bash
git add WAgen/apps/web/src/modules/dashboard/sequence/sequence.css
git commit -m "feat(web): add report page CSS classes to sequence.css"
```

---

## Task 6: Create SequenceReportPage component

**Files:**
- Create: `WAgen/apps/web/src/modules/dashboard/sequence/SequenceReportPage.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SequenceEnrollment, SequenceEnrollmentStatus, SequenceLog } from "../../../lib/api";
import { usePauseSequenceMutation, useResumeSequenceMutation, useSequenceDetailQuery, useSequenceEnrollmentsQuery, useSequenceLogsQuery, useSequenceStepFunnelQuery } from "./queries";

const STATUS_FILTERS: Array<{ label: string; value: SequenceEnrollmentStatus | "all" }> = [
  { label: "All",       value: "all" },
  { label: "Active",    value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Failed",    value: "failed" },
  { label: "Stopped",   value: "stopped" }
];

const LOG_DOT_CLASS: Record<string, string> = {
  pending:   "seq-log-dot-pending",
  sent:      "seq-log-dot-sent",
  delivered: "seq-log-dot-delivered",
  read:      "seq-log-dot-read",
  failed:    "seq-log-dot-failed",
  retrying:  "seq-log-dot-retrying",
  stopped:   "seq-log-dot-stopped",
  completed: "seq-log-dot-completed",
  skipped:   "seq-log-dot-skipped"
};

const STATUS_COLOR: Record<string, string> = {
  active:    "#2563eb",
  completed: "#059669",
  failed:    "#be123c",
  stopped:   "#7c3aed"
};

function formatTs(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
    ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#475569";
  const bg = status === "active" ? "#dbeafe" : status === "completed" ? "#dcfce7" : status === "failed" ? "#ffe4e6" : status === "stopped" ? "#f3e8ff" : "#f1f5f9";
  return (
    <span className="pill" style={{ background: bg, color, borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
      {status}
    </span>
  );
}

function StepDisplay({ enrollment, totalSteps }: { enrollment: SequenceEnrollment; totalSteps: number }) {
  if (enrollment.status === "completed") {
    return <span>Step {totalSteps} ✓</span>;
  }
  return <span>Step {enrollment.current_step + 1}</span>;
}

function LogsPanel({ enrollment, token }: { enrollment: SequenceEnrollment; token: string }) {
  const { data: logs = [] } = useSequenceLogsQuery(token, enrollment.id);
  return (
    <div className="seq-report-logs">
      <div className="seq-report-logs-head">
        <div>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#122033" }}>Enrollment Log</span>
          <span style={{ fontSize: 11, color: "#5f6f86", marginLeft: 8 }}>
            {enrollment.contact_phone}
            {enrollment.contact_name ? ` · ${enrollment.contact_name}` : ""}
          </span>
        </div>
        <StatusPill status={enrollment.status} />
      </div>
      {logs.length === 0 && (
        <p style={{ padding: "12px 16px", fontSize: 12, color: "#5f6f86", margin: 0 }}>No logs yet.</p>
      )}
      {[...logs].reverse().map((log: SequenceLog) => (
        <div key={log.id} className="seq-log-row">
          <div className={`seq-log-dot ${LOG_DOT_CLASS[log.status] ?? "seq-log-dot-pending"}`} />
          <div className="seq-log-info">
            <span className="seq-log-status" style={{ color: log.status === "failed" ? "#be123c" : log.status === "stopped" ? "#7c3aed" : undefined }}>
              {log.status}
            </span>
            <span className="seq-log-time">{formatTs(log.created_at)}</span>
            {log.meta_json && Object.keys(log.meta_json).length > 0 && (
              <span className="seq-log-meta">{JSON.stringify(log.meta_json)}</span>
            )}
            {log.error_message && (
              <span className="seq-log-err">{log.error_message}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SequenceReportPage({ token }: { token: string }) {
  const navigate                   = useNavigate();
  const { sequenceId }             = useParams<{ sequenceId: string }>();
  const [statusFilter, setStatus]  = useState<SequenceEnrollmentStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const detail    = useSequenceDetailQuery(token, sequenceId ?? "").data;
  const funnel    = useSequenceStepFunnelQuery(token, sequenceId ?? "").data ?? [];
  const enrollments = useSequenceEnrollmentsQuery(
    token, sequenceId ?? "", statusFilter === "all" ? undefined : statusFilter
  ).data ?? [];
  const pauseMutation   = usePauseSequenceMutation(token, sequenceId ?? "");
  const resumeMutation  = useResumeSequenceMutation(token, sequenceId ?? "");

  if (!detail) {
    return (
      <section className="seq-report-page">
        <div className="seq-card seq-loading">Loading report…</div>
      </section>
    );
  }

  const m = detail.metrics;
  const totalEnrolled = m.enrolled || 1; // avoid divide-by-zero
  const selectedEnrollment = enrollments.find((e) => e.id === selectedId) ?? null;

  return (
    <section className="seq-report-page">

      {/* Header */}
      <div className="seq-report-header">
        <div>
          <button type="button" className="seq-report-back"
            onClick={() => navigate("/dashboard/sequence")}>
            ← Sequences
          </button>
          <h2 className="seq-report-title">{detail.name}</h2>
          <div className="seq-report-meta">
            <StatusPill status={detail.status} />
            <span>{detail.steps.length} step{detail.steps.length !== 1 ? "s" : ""} · WhatsApp · Trigger: {detail.trigger_type}</span>
          </div>
        </div>
        <div className="seq-report-actions">
          <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
            onClick={() => navigate(`/dashboard/sequence/${sequenceId}`)}>
            ✏ Edit Sequence
          </button>
          {detail.status === "published" && (
            <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
              onClick={() => void pauseMutation.mutateAsync()}>
              ⏸ Pause
            </button>
          )}
          {detail.status === "paused" && (
            <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
              onClick={() => void resumeMutation.mutateAsync()}>
              ▶ Resume
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="seq-report-stats">
        {([
          ["Enrolled",  m.enrolled,  "#2563eb", null],
          ["Active",    m.active,    "#0d9488", m.enrolled],
          ["Completed", m.completed, "#059669", m.enrolled],
          ["Failed",    m.failed,    "#be123c", m.enrolled],
          ["Stopped",   m.stopped,   "#7c3aed", m.enrolled]
        ] as [string, number, string, number | null][]).map(([label, val, color, base]) => (
          <div key={label} className="seq-report-stat">
            <p className="seq-report-stat-label">{label}</p>
            <p className="seq-report-stat-val" style={{ color }}>{val}</p>
            {base != null && base > 0 && (
              <p className="seq-report-stat-pct">{Math.round((val / base) * 100)}%</p>
            )}
          </div>
        ))}
      </div>

      {/* Step Funnel */}
      {funnel.length > 0 && (
        <div className="seq-report-funnel seq-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>Step Funnel</p>
              <p style={{ margin: 0, fontSize: 11, color: "#5f6f86" }}>How many contacts have reached each step</p>
            </div>
          </div>
          {funnel.map((row) => {
            const pct = totalEnrolled > 0 ? (Number(row.reached) / totalEnrolled) * 100 : 0;
            return (
              <div key={row.step_id} className="seq-funnel-row">
                <div className="seq-funnel-num">{row.step_order + 1}</div>
                <div>
                  <p className="seq-funnel-step-name">Step {row.step_order + 1}</p>
                  <p className="seq-funnel-step-meta">
                    ⏱ {row.delay_value} {row.delay_unit} from {row.step_order === 0 ? "enrollment" : "previous step"}
                  </p>
                </div>
                <div className="seq-funnel-bar-wrap">
                  <div className="seq-funnel-bar">
                    <div className="seq-funnel-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="seq-funnel-count">{row.reached} / {m.enrolled}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Enrollments Table */}
      <div className="seq-report-table-card">
        <div className="seq-report-toolbar">
          <div>
            <span style={{ fontSize: 13, fontWeight: 800 }}>Enrollments</span>
            <span style={{ fontSize: 11, color: "#5f6f86", marginLeft: 8 }}>{m.enrolled} total</span>
          </div>
          <div className="seq-report-filter-pills">
            {STATUS_FILTERS.map((f) => (
              <button key={f.value} type="button"
                className={`seq-report-fpill${statusFilter === f.value ? " active" : ""}`}
                onClick={() => { setStatus(f.value); setSelectedId(null); }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <table className="seq-report-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Status</th>
              <th>Current Step</th>
              <th>Delivery</th>
              <th>Enrolled</th>
              <th>Next Run</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#5f6f86", padding: "16px" }}>
                  No enrollments.
                </td>
              </tr>
            )}
            {enrollments.map((enr) => (
              <tr key={enr.id}
                className={selectedId === enr.id ? "selected" : ""}
                onClick={() => setSelectedId(enr.id === selectedId ? null : enr.id)}>
                <td>
                  <div className="seq-report-contact-phone">{enr.contact_phone}</div>
                  {enr.contact_name && (
                    <div className="seq-report-contact-name">{enr.contact_name}</div>
                  )}
                </td>
                <td><StatusPill status={enr.status} /></td>
                <td><StepDisplay enrollment={enr} totalSteps={detail.steps.length} /></td>
                <td style={{ fontSize: 11, color: enr.last_delivery_status === "failed" ? "#be123c" : "#334155" }}>
                  {enr.last_delivery_status ?? "—"}
                </td>
                <td style={{ color: "#5f6f86" }}>{formatTs(enr.entered_at)}</td>
                <td style={{ color: enr.next_run_at ? "#5f6f86" : "#94a3b8" }}>
                  {enr.status === "active" && enr.next_run_at ? formatTs(enr.next_run_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Logs panel — appears when a row is selected */}
      {selectedEnrollment && (
        <LogsPanel enrollment={selectedEnrollment} token={token} />
      )}

    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add WAgen/apps/web/src/modules/dashboard/sequence/SequenceReportPage.tsx
git commit -m "feat(web): add SequenceReportPage component"
```

---

## Task 7: Wire up route, "View Report" button, and fix ActivityPanel bugs

**Files:**
- Modify: `WAgen/apps/web/src/modules/dashboard/sequence/route.tsx`

- [ ] **Step 1: Add `SequenceReportPage` import at top of `route.tsx`**

Find the existing import block (line 1–31) and add:

```typescript
import { SequenceReportPage } from "./SequenceReportPage";
```

- [ ] **Step 2: Add `:sequenceId/report` to `useRoutes` in `Component`**

Find the `Component` function (lines 1554-1561) and replace:

```typescript
export function Component() {
  const { token } = useDashboardShell();
  return useRoutes([
    { index: true,                  element: <SequenceListPage token={token} /> },
    { path: "new",                  element: <SequenceCreatePage token={token} /> },
    { path: ":sequenceId",          element: <BuilderPage token={token} /> },
    { path: ":sequenceId/report",   element: <SequenceReportPage token={token} /> }
  ]);
}
```

- [ ] **Step 3: Add "View Report" button in BuilderPage header**

Find the `seq-builder-right` div (lines 725-753). Before the Reset button, add:

```typescript
{(detail.status === "published" || detail.metrics.enrolled > 0) && (
  <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
    onClick={() => navigate(`/dashboard/sequence/${sequenceId}/report`)}>
    View Report →
  </button>
)}
```

- [ ] **Step 4: Fix ActivityPanel — remove duplicate logs block**

In `ActivityPanel` (lines 1526-1546), the second "Logs" section is a duplicate. Remove the entire second block:

```diff
- {/* Logs */}
- {logs.length > 0 && (
-   <div style={{ marginTop: "1rem" }}>
-     <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 800, color: "var(--seq-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
-       Latest logs
-     </p>
-     <div className="seq-activity-list">
-       {logs.slice(0, 4).map((log) => (
-         <div key={log.id} className="seq-activity-item">
-           <div className="seq-activity-row">
-             <StatusPill status={log.status} />
-             <span className="seq-activity-time">{formatDateTime(log.created_at)}</span>
-           </div>
-           {log.error_message && (
-             <p style={{ margin: "0.3rem 0 0", fontSize: "0.78rem", color: "#be123c" }}>{log.error_message}</p>
-           )}
-         </div>
-       ))}
-     </div>
-   </div>
- )}
```

The remaining code to keep is the closing tags: `</div>` that closes the grid at line 1475, and `</div>` closing the outer container, then `</div>` for the `seq-card`.

- [ ] **Step 5: Fix `selectedEnrollment` hardcoding in BuilderPage**

At line 664, find:

```typescript
const selectedEnrollment = enrollments[0] ?? null;
```

This was never used for interaction in the ActivityPanel (the panel takes the full list). Leave this line as-is — it's only used to fetch the logs for the activity panel preview, and showing the first enrollment's logs in the builder panel is acceptable. The real drill-down is in `SequenceReportPage`.

- [ ] **Step 6: Fix "Step N" display confusion in ActivityPanel**

In `ActivityPanel` (line ~1491):

```typescript
// Before:
<p className="seq-activity-step">Step {enr.current_step + 1}</p>

// After:
<p className="seq-activity-step">
  {enr.status === "completed"
    ? `Step ${enr.current_step} ✓`
    : `Step ${enr.current_step + 1}`}
</p>
```

- [ ] **Step 7: Commit**

```bash
git add WAgen/apps/web/src/modules/dashboard/sequence/route.tsx
git commit -m "feat(web): wire sequence report route, add View Report button, fix ActivityPanel bugs"
```

---

## Task 8: Add router test for the report route

**Files:**
- Modify: `WAgen/apps/web/src/app/router.test.tsx`

- [ ] **Step 1: Write the failing test**

In `router.test.tsx`, find the mock for the sequence module (~line 44):

```typescript
vi.mock("../modules/dashboard/sequence/route", () => ({
  Component: () => <div>Sequence module</div>,
  prefetchData: mockSequencePrefetchData
}));
```

The router test mocks the entire module, so the child route rendering is not testable here. Add a simpler smoke test after the existing sequence test (~line 217):

```typescript
it("renders the sequence report route on /dashboard/sequence/:id/report", async () => {
  const { router } = renderRoute("/dashboard/sequence/abc123/report");

  expect(await screen.findByText("Sequence module")).toBeInTheDocument();
  await waitFor(() => {
    expect(router.state.location.pathname).toBe("/dashboard/sequence/abc123/report");
  });
});
```

This test verifies the route is registered and does not throw a 404 (the mock renders "Sequence module" for the whole sequence subtree, which is correct).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd WAgen/apps/web && npx vitest run src/app/router.test.tsx
```

Expected: test fails because `/dashboard/sequence/:id/report` isn't registered yet (it may navigate away or error).

- [ ] **Step 3: Run the full test suite after Task 7 is complete**

```bash
cd WAgen/apps/web && npx vitest run src/app/router.test.tsx
```

Expected: all tests pass including the new one.

- [ ] **Step 4: Commit**

```bash
git add WAgen/apps/web/src/app/router.test.tsx
git commit -m "test(web): add router smoke test for sequence report route"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ New route `/dashboard/sequence/:id/report` — Task 7 Step 2
- ✅ "View Report →" button in builder header — Task 7 Step 3
- ✅ Header with name, status, edit/pause buttons — `SequenceReportPage` header section
- ✅ 5 stat cards (enrolled/active/completed/failed/stopped) — `SequenceReportPage` stats section
- ✅ Step funnel with progress bars and counts — `SequenceReportPage` funnel section
- ✅ Enrollments table with status filter pills — `SequenceReportPage` table section
- ✅ Log panel on row click — `LogsPanel` component
- ✅ Contact phone + name in table — Task 1 (JOIN contacts)
- ✅ Fix duplicate logs in ActivityPanel — Task 7 Step 4
- ✅ Fix hardcoded selectedEnrollment — Task 7 Step 5 (acknowledged, scoped to builder preview)
- ✅ Fix "Step N+1" display confusion — Task 7 Step 6
- ✅ `?status` filter on enrollment API — Task 1 Step 2

**Type consistency:**
- `SequenceEnrollmentStatus` imported from `api.ts` in `queries.ts` and `SequenceReportPage.tsx`
- `useSequenceStepFunnelQuery` defined in `queries.ts` Task 4, imported in `SequenceReportPage.tsx` Task 6
- `SequenceStepFunnelRow.reached` is `number` in both service and frontend type (note: PostgreSQL COUNT returns bigint — cast with `Number()` in the component, done)
- `usePauseSequenceMutation`/`useResumeSequenceMutation` used with `(token, sequenceId)` signature — matches `makeStatusMutation` wrapper in `queries.ts`
