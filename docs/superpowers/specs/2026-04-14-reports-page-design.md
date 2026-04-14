# Reports Page Design

## Goal

Add a dedicated **Reports** page to the dashboard sidebar where users can view today's live conversation summary, browse past daily report snapshots, and toggle the daily email notification — all in one place.

## Architecture

### Approach
Always-live today + snapshots for history. Today's panel runs a fresh query on page load. Past reports load instantly from stored JSON snapshots in the database.

### Backend

**New migration — `daily_reports` table**
```sql
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, report_date)
);
CREATE INDEX idx_daily_reports_user_date ON daily_reports (user_id, report_date DESC);
```

**Refactor: extract shared data service**
Move the data-fetching queries out of `daily-report-worker-service.ts` into a new `daily-report-data-service.ts` that exports:
- `fetchDailyReportData(userId: string, date: Date): Promise<DailyReportSnapshot>`

Both the worker and the new API route import from this shared service.

**Worker change**
After generating the report data and sending the email, save the snapshot:
```sql
INSERT INTO daily_reports (user_id, report_date, snapshot)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, report_date) DO UPDATE SET snapshot = EXCLUDED.snapshot
```
This runs even if Brevo is not configured (snapshot is always saved).

**New API routes — `apps/api/src/routes/reports.ts`**
- `GET /api/reports/daily/today` — calls `fetchDailyReportData` for today, returns `DailyReportSnapshot`
- `GET /api/reports/daily` — returns last 30 snapshots: `{ reports: { id, reportDate, snapshot }[] }`

Both routes require `requireAuth`.

**Notification toggle**
Reuses existing `GET/PATCH /api/notifications/settings` — no new endpoint needed.

### Frontend

**New module: `apps/web/src/modules/dashboard/reports/`**
- `route.tsx` — page component
- `api.ts` — thin wrappers around `lib/api.ts` calls
- `queries.ts` — TanStack Query hooks
- `reports.css` — page styles

**New nav entry in `dashboardModules.ts`**
```typescript
{
  id: "reports",
  path: "reports",
  navTo: "/dashboard/reports",
  navLabel: "Reports",
  subtitle: "Daily summaries",
  icon: "analytics",
  section: "main",
  lazyRoute: () => import("../modules/dashboard/reports/route"),
  prefetchStrategy: "code+data",
  requiresAuth: true
}
```

## Page Layout

```
/dashboard/reports
│
├── Page header
│   ├── Title: "Reports"
│   └── Daily email toggle (go-live-switch pill, synced with Settings)
│
├── TODAY'S REPORT  (live query on load, skeleton while loading)
│   ├── 4 stat cards: Conversations | Leads | Complaints | Feedback
│   ├── Top Leads     (name, score badge 🔴≥70 🟡≥40 ⚪<40, summary)
│   ├── Top Complaints (summary, sentiment badge: Angry / Frustrated)
│   ├── Top Feedback  (summary snippets)
│   ├── Broadcasts    (name, sent / delivered / read / failed counts)
│   ├── Automation    (sequences active, flows triggered)
│   └── Alerts        (highlighted callouts, e.g. "High complaint volume")
│
└── PAST REPORTS  (last 30 days, from daily_reports snapshots)
    └── Collapsible date rows — expand to show same sections as today
```

## Data Shape

```typescript
type DailyReportSnapshot = {
  date: string;                 // "YYYY-MM-DD"
  overview: {
    totalConversations: number;
    leads: number;
    complaints: number;
    feedback: number;
  };
  topLeads: {
    conversationId: string;
    contactName: string | null;
    summary: string;
    score: number;              // 0–100
  }[];
  topComplaints: {
    conversationId: string;
    summary: string;
    sentiment: string;          // "angry" | "frustrated"
    score: number;
  }[];
  topFeedback: {
    conversationId: string;
    summary: string;
  }[];
  broadcasts: {
    name: string;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  }[];
  automation: {
    sequencesActive: number;
    flowsTriggered: number;
  };
  alerts: string[];
};
```

## Files Created / Modified

| Action | Path |
|--------|------|
| Create | `infra/migrations/0042_daily_reports.sql` |
| Create | `apps/api/src/services/daily-report-data-service.ts` |
| Modify | `apps/api/src/services/daily-report-worker-service.ts` (import shared service, save snapshot) |
| Create | `apps/api/src/routes/reports.ts` |
| Modify | `apps/api/src/app.ts` (register reports route) |
| Modify | `apps/web/src/lib/api.ts` (add fetchTodayReport, fetchDailyReports) |
| Create | `apps/web/src/modules/dashboard/reports/api.ts` |
| Create | `apps/web/src/modules/dashboard/reports/queries.ts` |
| Create | `apps/web/src/modules/dashboard/reports/route.tsx` |
| Create | `apps/web/src/modules/dashboard/reports/reports.css` |
| Modify | `apps/web/src/registry/dashboardModules.ts` (add reports entry) |

## Error Handling

- Today's live query fails → show error state with retry button, do not hide the page
- No past reports yet → show empty state: "Your first report will appear here after 11:59 PM tonight"
- Notification toggle fails → revert optimistic update, show inline error

## Tech Stack

- Backend: Fastify 5, PostgreSQL (pool), Zod validation
- Frontend: React, TanStack Query (`useQuery`), existing CSS class patterns (`channel-setup-panel`, `go-live-switch`)
- No new dependencies
