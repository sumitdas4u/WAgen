# Sequence Report Page — Design Spec

**Date:** 2026-04-09  
**Status:** Approved  
**Author:** Claude (brainstorming session)

---

## Overview

A dedicated full-page report for each published sequence, accessible at `/dashboard/sequence/:id/report`. Mirrors the broadcast report UX so operators already familiar with broadcast analytics have zero learning curve.

---

## Route & Navigation

- **New route:** `/dashboard/sequence/:id/report`
- **Entry point:** "View Report →" button in the sequence builder header (visible when sequence is published or has enrollments)
- **Back navigation:** "← Sequences" link returns to the sequences list (`/dashboard/sequences`)
- The existing builder stays at `/dashboard/sequence/:id` — no changes to its routing

---

## Page Layout

### Header

Displays sequence name, status pill (Published / Paused / Draft), trigger summary ("1 step · WhatsApp · Trigger: contact created"), and three action buttons:

- **Refresh** — re-fetches all report data
- **Edit Sequence** — navigates to the builder (`/dashboard/sequence/:id`)
- **Pause / Resume** — toggles sequence active state inline

### Stats Row

Five stat cards in a single row:

| Card | Value | Secondary |
|------|-------|-----------|
| Enrolled | total enrolled count | — |
| Active | active count | % of enrolled |
| Completed | completed count | % of enrolled |
| Failed | failed count | % of enrolled |
| Stopped | stopped count | % of enrolled |

### Step Funnel

One row per step. Each row shows:
- Step number badge
- Step name + delay label (e.g., "⏱ 1 day from enrollment") + template name
- Horizontal progress bar (width = step's reach ÷ total enrolled)
- Count label (e.g., "22 / 24")

"Reach" for a step = number of enrollments that have executed that step or are currently waiting on it.

### Enrollments Table

Status filter pills: **All · Active · Completed · Failed · Stopped**

Columns:
| Column | Notes |
|--------|-------|
| Contact | Phone number (clickable) + contact name below |
| Status | Pill: active / completed / failed / stopped |
| Current Step | "Step N" or "Step N ✓" when passed |
| Delivery | Last delivery status for that enrollment (sent / delivered / read / failed) |
| Enrolled | Timestamp of enrollment creation |
| Next Run | ISO timestamp of next scheduled execution, or "—" |

Clicking a row selects it and opens the Logs Panel below.

### Logs Panel

Appears below the table when an enrollment row is selected. Shows the full event trail for that enrollment:

Each log entry:
- Colored dot (grey=pending, blue=sent, teal=delivered, green=read/completed, red=failed, amber=retrying, purple=stopped)
- Status label (capitalized)
- Timestamp
- Meta line: step name + template name (where applicable)
- Error line in red (for failed entries only)

---

## Data Requirements

### API changes needed

1. **`GET /api/sequence/:id`** — add per-step enrollment counts to the response (or new endpoint `GET /api/sequence/:id/stats`)  
   Returns: `{ enrolled, active, completed, failed, stopped, steps: [{ id, reached }] }`

2. **`GET /api/sequence/:id/enrollments`** — JOIN `contacts` table to return `contact_phone` and `contact_name` alongside each enrollment row. Add `?status=active|completed|failed|stopped` filter.

3. **`GET /api/sequence/:id/enrollments/:enrollmentId/logs`** — return all `sequence_logs` rows for a given enrollment, ordered by `created_at` ASC. New endpoint; needs to be added to the Fastify router.

### No schema changes required

All data is already present in `sequence_enrollments`, `sequence_logs`, `sequences`, `sequence_steps`, and `contacts` tables (confirmed in `0029_sequences.sql`).

---

## Component Structure

```
SequenceReportPage
├── ReportHeader          (name, status, actions)
├── StatsRow              (5 StatCard components)
├── StepFunnel            (per-step rows with progress bars)
├── EnrollmentsTable      (filter pills + table + row selection)
└── EnrollmentLogsPanel   (log trail for selected enrollment)
```

All data fetched via React Query. `EnrollmentLogsPanel` fetches lazily when a row is selected.

---

## CSS / Styling

Follow the existing WAgen UI design system:
- Use `seq-` prefix for new class names
- Leverage existing CSS variables (`--color-primary`, `--radius-*`, etc.)
- Pill/badge patterns reuse broadcast report styles where possible
- Stat cards, table, and log panel styled to match broadcast report visual weight

---

## Existing Bugs Fixed Alongside This Work

The following bugs in the current sequence UI (`route.tsx`) will be fixed as part of this implementation:

1. **Duplicate logs rendering** — `ActivityPanel` renders logs in two places (lines ~1504 and ~1527). Remove the duplicate block.
2. **Logs always show enrollment[0]** — `selectedEnrollment` is hardcoded to `enrollments[0]`. Fix to use whichever row is clicked.
3. **"Step 2" confusion** — after a 1-step sequence completes, `current_step` increments to 1 but the UI shows "Step 2". Display "Step 1 ✓" when `status === 'completed'` and the sequence has only 1 step.

---

## Out of Scope

- Pagination of enrollments table (first version loads all; add if >200 rows becomes an issue)
- Export to CSV
- Per-step delivery rate analytics (open rate, reply rate)
- Real-time auto-refresh (manual Refresh button is sufficient for v1)
