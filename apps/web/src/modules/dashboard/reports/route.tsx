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
  if (score >= 80) return `🔴 HOT · ${score}`;
  if (score >= 50) return `🟡 WARM · ${score}`;
  return `⚪ COLD · ${score}`;
}

function statusLabel(status: string): string {
  if (status === "open") return "❌ Not resolved";
  if (status === "pending") return "⏳ Follow-up pending";
  if (status === "resolved") return "✅ Resolved";
  return status;
}

function sentimentLabel(s: string | null): string {
  const map: Record<string, string> = {
    angry: "😡 Angry", frustrated: "😤 Frustrated",
    negative: "😞 Negative", positive: "😊 Positive", neutral: "😐 Neutral"
  };
  return s ? (map[s] ?? s) : "";
}

// ─── ReportCard ───────────────────────────────────────────────────────────────

function ReportCard({ snapshot }: { snapshot: DailyReportSnapshot }) {
  const { overview, topLeads, topComplaints, topFeedback, broadcasts, automation, alerts } = snapshot;

  return (
    <div className="reports-card-body">
      {/* Overview stat row */}
      <div className="reports-stat-grid">
        <div className="reports-stat-card total">
          <div className="stat-value">{overview.totalConversations}</div>
          <div className="stat-label">Conversations</div>
        </div>
        <div className="reports-stat-card leads">
          <div className="stat-value">{overview.leads}</div>
          <div className="stat-label">Leads</div>
        </div>
        <div className="reports-stat-card complaints">
          <div className="stat-value">{overview.complaints}</div>
          <div className="stat-label">Complaints</div>
        </div>
        <div className="reports-stat-card feedback">
          <div className="stat-value">{overview.feedback}</div>
          <div className="stat-label">Feedback</div>
        </div>
      </div>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="reports-alerts">
          {alerts.map((a, i) => (
            <div key={i} className="reports-alert-item">⚠️ {a}</div>
          ))}
        </div>
      )}

      <div className="reports-two-col">
        {/* Leads */}
        <div className="reports-section-card">
          <div className="reports-section-card-header lead">🧲 Top Leads</div>
          {topLeads.length === 0
            ? <p className="reports-empty-small">No leads recorded today</p>
            : <div className="reports-insight-list">
                {topLeads.map((r) => (
                  <div key={r.conversationId} className="reports-insight-item lead">
                    <div className="reports-insight-head">
                      <span className="reports-insight-phone">{r.phoneNumber}</span>
                      <span className={scoreBadgeClass(r.score)}>{scoreBadgeLabel(r.score)}</span>
                    </div>
                    <div className="reports-insight-summary">{r.summary}</div>
                    <div className="reports-insight-status">{statusLabel(r.status)}</div>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Complaints */}
        <div className="reports-section-card">
          <div className="reports-section-card-header complaint">⚠️ Top Complaints</div>
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
                    <div className="reports-insight-summary">{r.summary}</div>
                    <div className="reports-insight-status">{statusLabel(r.status)}</div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {/* Feedback */}
      {topFeedback.length > 0 && (
        <div className="reports-section-card">
          <div className="reports-section-card-header feedback">💬 Customer Feedback</div>
          <div className="reports-insight-list">
            {topFeedback.map((r) => (
              <div key={r.conversationId} className="reports-insight-item feedback">
                <div className="reports-insight-phone">{r.phoneNumber}</div>
                <div className="reports-insight-summary">{r.summary}</div>
                <div className="reports-insight-status">{statusLabel(r.status)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom row: Broadcasts + Automation */}
      <div className="reports-two-col">
        <div className="reports-section-card">
          <div className="reports-section-card-header neutral">📩 Broadcasts</div>
          <div className="reports-broadcast-grid">
            <div className="reports-broadcast-card">
              <div className="stat-value">{broadcasts.sent}</div>
              <div className="stat-label">Sent</div>
            </div>
            <div className="reports-broadcast-card">
              <div className="stat-value" style={{ color: "#22c55e" }}>{broadcasts.delivered}</div>
              <div className="stat-label">Delivered</div>
            </div>
            <div className={`reports-broadcast-card${broadcasts.failed > 0 ? " failed-nonzero" : ""}`}>
              <div className="stat-value">{broadcasts.failed}</div>
              <div className="stat-label">Failed</div>
            </div>
          </div>
        </div>

        <div className="reports-section-card">
          <div className="reports-section-card-header neutral">⚙️ Automation</div>
          <div className="reports-auto-grid">
            <div className="reports-auto-card">
              <div className="stat-value">{automation.sequencesCompleted}</div>
              <div className="stat-label">Sequences completed</div>
            </div>
            <div className="reports-auto-card">
              <div className="stat-value">{automation.flowsCompleted}</div>
              <div className="stat-label">Flows completed</div>
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
    <div className="reports-card-body">
      <div className="reports-stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="reports-skeleton-card" />
        ))}
      </div>
      <div className="reports-two-col">
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
      <div className="reports-header">
        <div>
          <h2 className="reports-title">Reports</h2>
          <p className="reports-subtitle">Daily conversation and performance summary</p>
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

      {/* Today */}
      <div className="reports-panel">
        <div className="reports-panel-header">
          <span className="reports-panel-title">Today</span>
          {todayQuery.data && (
            <span className="reports-panel-date">{formatReportDate(todayQuery.data.date)}</span>
          )}
        </div>

        {todayQuery.isPending ? (
          <ReportSkeleton />
        ) : todayQuery.isError ? (
          <div className="reports-error-state">
            <span>⚠️ Could not load today&apos;s report</span>
            <button type="button" onClick={() => { void todayQuery.refetch(); }}>Retry</button>
          </div>
        ) : todayQuery.data ? (
          <ReportCard snapshot={todayQuery.data} />
        ) : null}
      </div>

      {/* Past Reports */}
      <div className="reports-panel-title" style={{ marginTop: "0.5rem" }}>Past Reports</div>

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
            <div key={r.id} className="reports-history-row">
              <button
                type="button"
                className="reports-history-toggle"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <span>{formatReportDate(r.reportDate)}</span>
                <span className="reports-history-chevron">{expandedId === r.id ? "▲" : "▶"}</span>
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
