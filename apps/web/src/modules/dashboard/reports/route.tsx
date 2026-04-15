import "./reports.css";
import { useState } from "react";
import type { DailyReportSnapshot } from "../../../lib/api";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  useTodayReportQuery,
  useDailyReportsQuery,
  useNotificationSettingsQuery,
  useToggleNotificationMutation
} from "./queries";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatReportDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

function scoreBadgeClass(score: number): string {
  if (score >= 80) return "reports-badge score-hot";
  if (score >= 50) return "reports-badge score-warm";
  return "reports-badge score-cold";
}

function scoreBadgeLabel(score: number): string {
  if (score >= 80) return `HOT · ${score}`;
  if (score >= 50) return `WARM · ${score}`;
  return `COLD · ${score}`;
}

function statusLabel(status: string): string {
  if (status === "open") return "Not resolved";
  if (status === "pending") return "Follow-up pending";
  if (status === "resolved") return "Resolved";
  return status;
}

function sentimentLabel(s: string | null): string {
  const map: Record<string, string> = {
    angry: "Angry", frustrated: "Frustrated",
    negative: "Negative", positive: "Positive", neutral: "Neutral"
  };
  return s ? (map[s] ?? s) : "";
}

// ─── ReportCard ───────────────────────────────────────────────────────────────

function ReportCard({ snapshot }: { snapshot: DailyReportSnapshot }) {
  const { overview, topLeads, topComplaints, topFeedback, broadcasts, automation, alerts } = snapshot;

  return (
    <div className="reports-card-body">

      {/* Stat row */}
      <div className="reports-stat-grid">
        <div className="reports-stat-cell">
          <div className="reports-stat-label">Conversations</div>
          <div className="reports-stat-value">{overview.totalConversations}</div>
        </div>
        <div className="reports-stat-cell">
          <div className="reports-stat-label">Leads</div>
          <div className="reports-stat-value is-leads">{overview.leads}</div>
        </div>
        <div className="reports-stat-cell">
          <div className="reports-stat-label">Complaints</div>
          <div className="reports-stat-value is-complaints">{overview.complaints}</div>
        </div>
        <div className="reports-stat-cell">
          <div className="reports-stat-label">Feedback</div>
          <div className="reports-stat-value is-feedback">{overview.feedback}</div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="reports-alerts">
          {alerts.map((a, i) => (
            <div key={i} className="reports-alert-item">⚠ {a}</div>
          ))}
        </div>
      )}

      {/* Leads + Complaints */}
      <div className="reports-two-col">
        <div className="reports-section-panel">
          <div className="reports-section-title">Top Leads</div>
          {topLeads.length === 0
            ? <p className="reports-empty-small">No leads recorded today</p>
            : <div className="reports-insight-list">
                {topLeads.map((r) => (
                  <div key={r.conversationId} className="reports-insight-item lead">
                    <div className="reports-insight-head">
                      <span className="reports-insight-phone">{r.phoneNumber}</span>
                      <span className={scoreBadgeClass(r.score)}>{scoreBadgeLabel(r.score)}</span>
                    </div>
                    {r.summary && <div className="reports-insight-summary">{r.summary}</div>}
                    <div className="reports-insight-status">{statusLabel(r.status)}</div>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="reports-section-panel">
          <div className="reports-section-title">Top Complaints</div>
          {topComplaints.length === 0
            ? <p className="reports-empty-small">No complaints recorded today</p>
            : <div className="reports-insight-list">
                {topComplaints.map((r) => (
                  <div key={r.conversationId} className="reports-insight-item complaint">
                    <div className="reports-insight-head">
                      <span className="reports-insight-phone">{r.phoneNumber}</span>
                      {r.sentiment && (
                        <span className="reports-badge sentiment">{sentimentLabel(r.sentiment)}</span>
                      )}
                    </div>
                    {r.summary && <div className="reports-insight-summary">{r.summary}</div>}
                    <div className="reports-insight-status">{statusLabel(r.status)}</div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* Feedback */}
      {topFeedback.length > 0 && (
        <div className="reports-section-panel-full">
          <div className="reports-section-title">Customer Feedback</div>
          <div className="reports-insight-list">
            {topFeedback.map((r) => (
              <div key={r.conversationId} className="reports-insight-item feedback">
                <div className="reports-insight-phone">{r.phoneNumber}</div>
                {r.summary && <div className="reports-insight-summary">{r.summary}</div>}
                <div className="reports-insight-status">{statusLabel(r.status)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Broadcasts + Automation */}
      <div className="reports-two-col">
        <div className="reports-section-panel">
          <div className="reports-section-title">Broadcasts</div>
          <div className="reports-broadcast-grid">
            <div className="reports-mini-stat">
              <div className="stat-value">{broadcasts.sent}</div>
              <div className="stat-label">Sent</div>
            </div>
            <div className="reports-mini-stat is-delivered">
              <div className="stat-value">{broadcasts.delivered}</div>
              <div className="stat-label">Delivered</div>
            </div>
            <div className={`reports-mini-stat${broadcasts.failed > 0 ? " is-failed" : ""}`}>
              <div className="stat-value">{broadcasts.failed}</div>
              <div className="stat-label">Failed</div>
            </div>
          </div>
        </div>

        <div className="reports-section-panel">
          <div className="reports-section-title">Automation</div>
          <div className="reports-auto-grid">
            <div className="reports-mini-stat">
              <div className="stat-value">{automation.sequencesCompleted}</div>
              <div className="stat-label">Sequences</div>
            </div>
            <div className="reports-mini-stat">
              <div className="stat-value">{automation.flowsCompleted}</div>
              <div className="stat-label">Flows</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ReportSkeleton() {
  return (
    <div className="reports-skeleton">
      <div className="reports-skeleton-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="reports-skeleton-cell" />
        ))}
      </div>
      <div className="reports-skeleton-body">
        <div className="reports-skeleton-section" />
        <div className="reports-skeleton-section" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Component() {
  const { token } = useDashboardShell();
  const todayQuery = useTodayReportQuery(token);
  const historyQuery = useDailyReportsQuery(token);
  const notifQuery = useNotificationSettingsQuery(token);
  const toggleMutation = useToggleNotificationMutation(token);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dailyReportEnabled = notifQuery.data?.dailyReportEnabled ?? false;

  return (
    <section className="reports-page">

      {/* Header */}
      <div className="reports-page-header">
        <div>
          <h2 className="reports-page-title">Reports</h2>
          <p className="reports-page-subtitle">Daily conversation and performance summary</p>
        </div>
        <div className="reports-notif-row">
          <span className="reports-notif-label">Daily email</span>
          <button
            type="button"
            className={dailyReportEnabled ? "go-live-switch on" : "go-live-switch"}
            disabled={toggleMutation.isPending || notifQuery.isPending}
            onClick={() => toggleMutation.mutate(!dailyReportEnabled)}
            aria-label={dailyReportEnabled ? "Disable daily report email" : "Enable daily report email"}
          >
            <span />
          </button>
        </div>
      </div>

      {/* Summary of Day */}
      <p className="reports-section-heading">Summary of Day</p>

      {todayQuery.isPending ? (
        <ReportSkeleton />
      ) : todayQuery.isError ? (
        <div className="reports-error-state">
          <span>Could not load today&apos;s report</span>
          <button type="button" onClick={() => { void todayQuery.refetch(); }}>Retry</button>
        </div>
      ) : todayQuery.data ? (
        <div className="reports-overview-card">
          <div className="reports-overview-head">
            <span className="reports-overview-title">Today</span>
            <span className="reports-overview-date">{formatReportDate(todayQuery.data.date)}</span>
          </div>
          <ReportCard snapshot={todayQuery.data} />
        </div>
      ) : null}

      {/* Past Reports */}
      <p className="reports-section-heading">Past Reports</p>

      {historyQuery.isPending ? (
        <p className="reports-loading">Loading history…</p>
      ) : historyQuery.isError ? (
        <p className="reports-error-inline">Failed to load report history.</p>
      ) : !historyQuery.data?.reports.length ? (
        <div className="reports-empty-state">
          <div className="reports-empty-icon">📋</div>
          <div className="reports-empty-title">No past reports yet</div>
          <div className="reports-empty-body">Your first report will be saved automatically at 11:59 PM tonight.</div>
        </div>
      ) : (
        <div className="reports-history-list">
          {historyQuery.data.reports.map((r) => (
            <div
              key={r.id}
              className={`reports-history-row${expandedId === r.id ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="reports-history-toggle"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <span>{formatReportDate(r.reportDate)}</span>
                <span className="reports-history-chevron">▼</span>
              </button>
              {expandedId === r.id && (
                <div className="reports-history-content">
                  <ReportCard snapshot={r.snapshot} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </section>
  );
}
