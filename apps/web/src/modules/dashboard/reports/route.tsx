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

function formatReportDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatTime(iso: string | null): string {
  if (!iso) {
    return "No time";
  }

  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
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
    angry: "Angry",
    frustrated: "Frustrated",
    negative: "Negative",
    positive: "Positive",
    neutral: "Neutral"
  };
  return s ? (map[s] ?? s) : "Neutral";
}

function pctLabel(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeMetricCount(value: unknown): { count: number; percent: number | null } {
  const source = asObject(value);
  return {
    count: asNumber(source.count),
    percent: asNullableNumber(source.percent)
  };
}

function normalizeDailyReportSnapshot(raw: unknown): DailyReportSnapshot {
  const source = asObject(raw);
  const overview = asObject(source.overview);
  const priority = asObject(source.priority);
  const aiPerformance = asObject(source.aiPerformance);
  const comparisons = asObject(source.comparisons);
  const broadcasts = asObject(source.broadcasts);
  const automation = asObject(source.automation);
  const range = asObject(source.range);

  const topLeads = Array.isArray(source.topLeads) ? source.topLeads : [];
  const topComplaints = Array.isArray(source.topComplaints) ? source.topComplaints : [];
  const topFeedback = Array.isArray(source.topFeedback) ? source.topFeedback : [];

  return {
    date: asString(source.date),
    range: {
      dateLabel: asString(range.dateLabel, asString(source.date)),
      startAt: asString(range.startAt),
      endAt: asString(range.endAt)
    },
    overview: {
      totalConversations: asNumber(overview.totalConversations),
      leads: asNumber(overview.leads),
      complaints: asNumber(overview.complaints),
      feedback: asNumber(overview.feedback),
      responseRate: asNullableNumber(overview.responseRate),
      avgResponseTimeMinutes: asNullableNumber(overview.avgResponseTimeMinutes),
      aiHandled: normalizeMetricCount(overview.aiHandled),
      humanTakeover: normalizeMetricCount(overview.humanTakeover)
    },
    priority: {
      staleLeads: (Array.isArray(priority.staleLeads) ? priority.staleLeads : []).map((item) => {
        const row = asObject(item);
        return {
          conversationId: asString(row.conversationId),
          contactLabel: asString(row.contactLabel, asString(row.phoneNumber)),
          phoneNumber: asString(row.phoneNumber),
          lastMessage: asString(row.lastMessage, asString(row.summary)),
          lastActivityAt: asNullableString(row.lastActivityAt),
          reason: asString(row.reason),
          suggestedAction: asString(row.suggestedAction),
          suggestedActionTag: asString(row.suggestedActionTag)
        };
      }),
      stuckConversations: (Array.isArray(priority.stuckConversations) ? priority.stuckConversations : []).map((item) => {
        const row = asObject(item);
        return {
          conversationId: asString(row.conversationId),
          contactLabel: asString(row.contactLabel, asString(row.phoneNumber)),
          phoneNumber: asString(row.phoneNumber),
          lastMessage: asString(row.lastMessage, asString(row.summary)),
          lastActivityAt: asNullableString(row.lastActivityAt),
          reason: asString(row.reason),
          suggestedAction: asString(row.suggestedAction),
          suggestedActionTag: asString(row.suggestedActionTag)
        };
      }),
      lowConfidenceChats: (Array.isArray(priority.lowConfidenceChats) ? priority.lowConfidenceChats : []).map((item) => {
        const row = asObject(item);
        return {
          conversationId: asNullableString(row.conversationId),
          contactLabel: asString(row.contactLabel, asString(row.phoneNumber)),
          phoneNumber: asString(row.phoneNumber),
          question: asString(row.question),
          confidenceScore: asNumber(row.confidenceScore),
          createdAt: asString(row.createdAt),
          kbSuggestion: asString(row.kbSuggestion)
        };
      })
    },
    topLeads: topLeads.map((item) => {
      const row = asObject(item);
      const phoneNumber = asString(row.phoneNumber);
      return {
        conversationId: asString(row.conversationId),
        displayName: asNullableString(row.displayName),
        phoneNumber,
        contactLabel: asString(row.contactLabel, phoneNumber),
        summary: asString(row.summary),
        score: asNumber(row.score),
        status: asString(row.status),
        lastMessage: asString(row.lastMessage, asString(row.summary)),
        lastActivityAt: asNullableString(row.lastActivityAt),
        suggestedAction: asString(row.suggestedAction),
        suggestedActionTag: asString(row.suggestedActionTag)
      };
    }),
    topComplaints: topComplaints.map((item) => {
      const row = asObject(item);
      const phoneNumber = asString(row.phoneNumber);
      return {
        conversationId: asString(row.conversationId),
        displayName: asNullableString(row.displayName),
        phoneNumber,
        contactLabel: asString(row.contactLabel, phoneNumber),
        summary: asString(row.summary),
        sentiment: asNullableString(row.sentiment),
        score: asNumber(row.score),
        status: asString(row.status),
        lastMessage: asString(row.lastMessage, asString(row.summary)),
        lastActivityAt: asNullableString(row.lastActivityAt),
        comparisonNote: asString(row.comparisonNote)
      };
    }),
    topFeedback: topFeedback.map((item) => {
      const row = asObject(item);
      const phoneNumber = asString(row.phoneNumber);
      return {
        conversationId: asString(row.conversationId),
        displayName: asNullableString(row.displayName),
        phoneNumber,
        contactLabel: asString(row.contactLabel, phoneNumber),
        summary: asString(row.summary),
        sentiment: asNullableString(row.sentiment),
        status: asString(row.status),
        lastActivityAt: asNullableString(row.lastActivityAt),
        insight: asString(row.insight),
        repeatCount: asNumber(row.repeatCount, 1)
      };
    }),
    aiPerformance: {
      aiHandled: normalizeMetricCount(aiPerformance.aiHandled ?? overview.aiHandled),
      humanTakeover: normalizeMetricCount(aiPerformance.humanTakeover ?? overview.humanTakeover),
      failedResponses: asNumber(aiPerformance.failedResponses),
      unansweredQuestions: (Array.isArray(aiPerformance.unansweredQuestions) ? aiPerformance.unansweredQuestions : []).map((item) => {
        const row = asObject(item);
        return {
          conversationId: asNullableString(row.conversationId),
          contactLabel: asString(row.contactLabel, asString(row.phoneNumber)),
          phoneNumber: asString(row.phoneNumber),
          question: asString(row.question),
          confidenceScore: asNumber(row.confidenceScore),
          createdAt: asString(row.createdAt),
          kbSuggestion: asString(row.kbSuggestion)
        };
      }),
      kbSuggestions: asStringArray(aiPerformance.kbSuggestions)
    },
    insights: asStringArray(source.insights),
    improvements: asStringArray(source.improvements),
    timeline: (Array.isArray(source.timeline) ? source.timeline : []).map((item) => {
      const row = asObject(item);
      return {
        time: asString(row.time),
        contactLabel: asString(row.contactLabel),
        eventType: (asString(row.eventType) as "inbound" | "outbound" | "ai_alert") || "inbound",
        description: asString(row.description)
      };
    }),
    comparisons: {
      leadsDelta: asNumber(comparisons.leadsDelta),
      complaintsDelta: asNumber(comparisons.complaintsDelta),
      feedbackDelta: asNumber(comparisons.feedbackDelta),
      responseRateDelta: asNullableNumber(comparisons.responseRateDelta),
      summary: asStringArray(comparisons.summary)
    },
    broadcasts: {
      sent: asNumber(broadcasts.sent),
      delivered: asNumber(broadcasts.delivered),
      failed: asNumber(broadcasts.failed)
    },
    automation: {
      sequencesCompleted: asNumber(automation.sequencesCompleted),
      flowsCompleted: asNumber(automation.flowsCompleted)
    },
    alerts: asStringArray(source.alerts)
  };
}

function PriorityList(props: {
  title: string;
  emptyText: string;
  items: Array<{
    conversationId: string | null;
    contactLabel: string;
    lastMessage?: string;
    question?: string;
    lastActivityAt?: string | null;
    createdAt?: string;
    reason?: string;
    suggestedAction?: string;
    suggestedActionTag?: string;
    kbSuggestion?: string;
  }>;
  tone: "lead" | "warning" | "alert";
}) {
  return (
    <div className={`reports-priority-card is-${props.tone}`}>
      <div className="reports-section-title">{props.title}</div>
      {props.items.length === 0 ? (
        <p className="reports-empty-small">{props.emptyText}</p>
      ) : (
        <div className="reports-insight-list">
          {props.items.map((item) => (
            <div key={`${props.title}-${item.conversationId || item.question}`} className="reports-insight-item neutral">
              <div className="reports-insight-head">
                <span className="reports-insight-phone">{item.contactLabel}</span>
                {item.suggestedActionTag && (
                  <span className="reports-badge neutral">{item.suggestedActionTag}</span>
                )}
              </div>
              {item.reason && <div className="reports-insight-summary">{item.reason}</div>}
              {item.lastMessage && <div className="reports-insight-summary">Last message: {item.lastMessage}</div>}
              {item.question && <div className="reports-insight-summary">Question: {item.question}</div>}
              {item.kbSuggestion && <div className="reports-insight-summary">Suggestion: {item.kbSuggestion}</div>}
              {item.suggestedAction && <div className="reports-insight-status">{item.suggestedAction}</div>}
              {(item.lastActivityAt || item.createdAt) && (
                <div className="reports-insight-status">
                  {item.lastActivityAt ? `Time: ${formatTime(item.lastActivityAt)}` : `Time: ${formatTime(item.createdAt ?? null)}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ snapshot }: { snapshot: DailyReportSnapshot }) {
  const {
    overview,
    topLeads,
    topComplaints,
    topFeedback,
    broadcasts,
    automation,
    alerts,
    priority,
    aiPerformance,
    insights,
    improvements,
    timeline,
    comparisons
  } = snapshot;

  return (
    <div className="reports-card-body">
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

      <div className="reports-mini-grid reports-mini-grid-4">
        <div className="reports-mini-card">
          <div className="reports-mini-label">Response Rate</div>
          <div className="reports-mini-value">{pctLabel(overview.responseRate)}</div>
        </div>
        <div className="reports-mini-card">
          <div className="reports-mini-label">Avg Response</div>
          <div className="reports-mini-value">
            {overview.avgResponseTimeMinutes === null ? "—" : `${overview.avgResponseTimeMinutes}m`}
          </div>
        </div>
        <div className="reports-mini-card">
          <div className="reports-mini-label">AI Handled</div>
          <div className="reports-mini-value">{pctLabel(overview.aiHandled.percent)}</div>
        </div>
        <div className="reports-mini-card">
          <div className="reports-mini-label">Human Takeover</div>
          <div className="reports-mini-value">{pctLabel(overview.humanTakeover.percent)}</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="reports-alerts">
          {alerts.map((a, i) => (
            <div key={i} className="reports-alert-item">⚠ {a}</div>
          ))}
        </div>
      )}

      <div className="reports-section-panel-full">
        <div className="reports-section-title">Needs Attention</div>
        <div className="reports-three-col">
          <PriorityList
            title="Stale Leads"
            emptyText="No leads are waiting too long."
            items={priority.staleLeads}
            tone="lead"
          />
          <PriorityList
            title="Stuck Chats"
            emptyText="No conversations are stuck today."
            items={priority.stuckConversations}
            tone="warning"
          />
          <PriorityList
            title="Low AI Confidence"
            emptyText="No low-confidence AI chats today."
            items={priority.lowConfidenceChats}
            tone="alert"
          />
        </div>
      </div>

      <div className="reports-two-col">
        <div className="reports-section-panel">
          <div className="reports-section-title">Top Leads</div>
          {topLeads.length === 0 ? (
            <p className="reports-empty-small">No leads recorded today.</p>
          ) : (
            <div className="reports-insight-list">
              {topLeads.map((r) => (
                <div key={r.conversationId} className="reports-insight-item lead">
                  <div className="reports-insight-head">
                    <span className="reports-insight-phone">{r.contactLabel}</span>
                    <span className={scoreBadgeClass(r.score)}>{scoreBadgeLabel(r.score)}</span>
                  </div>
                  <div className="reports-insight-summary">Last message: {r.lastMessage || r.summary}</div>
                  <div className="reports-insight-summary">Summary: {r.summary}</div>
                  <div className="reports-insight-status">
                    {formatTime(r.lastActivityAt)} · {r.suggestedActionTag || "Action"}
                  </div>
                  <div className="reports-insight-action">{r.suggestedAction}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="reports-section-panel">
          <div className="reports-section-title">Complaints</div>
          {topComplaints.length === 0 ? (
            <div className="reports-success-state">
              <div className="reports-success-title">No complaints today</div>
              <div className="reports-success-copy">
                {comparisons.complaintsDelta < 0
                  ? "Good performance — complaints are down from yesterday."
                  : "Good performance — no issues flagged in complaint conversations."}
              </div>
            </div>
          ) : (
            <div className="reports-insight-list">
              {topComplaints.map((r) => (
                <div key={r.conversationId} className="reports-insight-item complaint">
                  <div className="reports-insight-head">
                    <span className="reports-insight-phone">{r.contactLabel}</span>
                    <span className="reports-badge sentiment">{sentimentLabel(r.sentiment)}</span>
                  </div>
                  <div className="reports-insight-summary">Last message: {r.lastMessage || r.summary}</div>
                  <div className="reports-insight-summary">{r.comparisonNote}</div>
                  <div className="reports-insight-status">
                    {statusLabel(r.status)} · {formatTime(r.lastActivityAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="reports-section-panel-full">
        <div className="reports-section-title">Customer Feedback</div>
        {topFeedback.length === 0 ? (
          <p className="reports-empty-small">No feedback recorded today.</p>
        ) : (
          <div className="reports-insight-list">
            {topFeedback.map((r) => (
              <div key={r.conversationId} className="reports-insight-item feedback">
                <div className="reports-insight-head">
                  <span className="reports-insight-phone">{r.contactLabel}</span>
                  <span className="reports-badge positive">{sentimentLabel(r.sentiment)}</span>
                </div>
                <div className="reports-insight-summary">{r.summary}</div>
                <div className="reports-insight-summary">{r.insight}</div>
                <div className="reports-insight-status">
                  {formatTime(r.lastActivityAt)} · {r.repeatCount > 1 ? `Repeated ${r.repeatCount} times` : "Single pattern"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="reports-two-col">
        <div className="reports-section-panel">
          <div className="reports-section-title">AI Performance</div>
          <div className="reports-broadcast-grid">
            <div className="reports-mini-stat">
              <div className="stat-value">{pctLabel(aiPerformance.aiHandled.percent)}</div>
              <div className="stat-label">AI handled</div>
            </div>
            <div className="reports-mini-stat">
              <div className="stat-value">{pctLabel(aiPerformance.humanTakeover.percent)}</div>
              <div className="stat-label">Human takeover</div>
            </div>
            <div className="reports-mini-stat is-failed">
              <div className="stat-value">{aiPerformance.failedResponses}</div>
              <div className="stat-label">Failed responses</div>
            </div>
          </div>
          <div className="reports-stack-list">
            {aiPerformance.unansweredQuestions.length === 0 ? (
              <p className="reports-empty-small">No unanswered AI questions today.</p>
            ) : (
              aiPerformance.unansweredQuestions.map((item) => (
                <div key={`${item.contactLabel}-${item.question}`} className="reports-note-row">
                  <strong>{item.contactLabel}</strong> — {item.question}
                  <span>{item.kbSuggestion}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="reports-section-panel">
          <div className="reports-section-title">Insights & Improvements</div>
          <div className="reports-stack-list">
            {insights.map((item, index) => (
              <div key={`insight-${index}`} className="reports-note-row">{item}</div>
            ))}
            {improvements.map((item, index) => (
              <div key={`improvement-${index}`} className="reports-note-row">{item}</div>
            ))}
            {insights.length === 0 && improvements.length === 0 && (
              <p className="reports-empty-small">No smart insights available yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="reports-two-col">
        <div className="reports-section-panel">
          <div className="reports-section-title">Timeline</div>
          <div className="reports-stack-list">
            {timeline.length === 0 ? (
              <p className="reports-empty-small">No timeline activity captured today.</p>
            ) : (
              timeline.map((item, index) => (
                <div key={`${item.contactLabel}-${index}`} className="reports-timeline-row">
                  <span className={`reports-timeline-pill is-${item.eventType}`}>{item.time}</span>
                  <div>
                    <strong>{item.contactLabel}</strong>
                    <div>{item.description}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="reports-section-panel">
          <div className="reports-section-title">Broadcasts & Automation</div>
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
          <div className="reports-stack-list">
            {comparisons.summary.map((item, index) => (
              <div key={`comparison-${index}`} className="reports-note-row">{item}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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

export function Component() {
  const { token } = useDashboardShell();
  const todayQuery = useTodayReportQuery(token);
  const historyQuery = useDailyReportsQuery(token);
  const notifQuery = useNotificationSettingsQuery(token);
  const toggleMutation = useToggleNotificationMutation(token);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dailyReportEnabled = notifQuery.data?.dailyReportEnabled ?? false;
  const todaySnapshot = todayQuery.data ? normalizeDailyReportSnapshot(todayQuery.data) : null;

  return (
    <section className="reports-page">
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

      <p className="reports-section-heading">Summary of Day</p>

      {todayQuery.isPending ? (
        <ReportSkeleton />
      ) : todayQuery.isError ? (
        <div className="reports-error-state">
          <span>Could not load today&apos;s report</span>
          <button type="button" onClick={() => { void todayQuery.refetch(); }}>Retry</button>
        </div>
      ) : todaySnapshot ? (
        <div className="reports-overview-card">
          <div className="reports-overview-head">
            <span className="reports-overview-title">Today</span>
            <span className="reports-overview-date">
              {todaySnapshot.range.dateLabel || formatReportDate(todaySnapshot.date)}
            </span>
          </div>
          <ReportCard snapshot={todaySnapshot} />
        </div>
      ) : null}

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
          {historyQuery.data.reports.map((r) => {
            const snapshot = normalizeDailyReportSnapshot(r.snapshot);
            return (
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
                    <ReportCard snapshot={snapshot} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
