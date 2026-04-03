import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation, useNavigate, useRoutes, useSearchParams } from "react-router-dom";
import type {
  Campaign,
  Conversation,
  DeliveryAlert,
  DeliveryReportChannel,
  DeliveryReportStatus,
  DeliveryReportSummary
} from "../../../lib/api";
import {
  fetchCampaigns,
  fetchDeliveryAlerts,
  fetchDeliveryConversations,
  fetchDeliveryFailures,
  fetchDeliveryNotifications,
  fetchDeliveryOverview,
  fetchDeliveryReportSummary,
  fetchUsageAnalytics
} from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";

const RANGE_OPTIONS = [7, 30, 90] as const;
const PAGE_SIZE = 50;
const EMPTY_CHANNEL = "";
const EMPTY_STATUS = "all";

type NotificationStatusFilter = DeliveryReportStatus | typeof EMPTY_STATUS;

function parseDays(value: string | null): number {
  const parsed = Number(value);
  return RANGE_OPTIONS.includes(parsed as (typeof RANGE_OPTIONS)[number]) ? parsed : 7;
}

function parseStatus(value: string | null): NotificationStatusFilter {
  if (
    value === "sending" ||
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed" ||
    value === "retrying"
  ) {
    return value;
  }
  return EMPTY_STATUS;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  return `${Number.isFinite(value) ? value.toFixed(value % 1 === 0 ? 0 : 1) : "0"}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDateLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short"
  });
}

function formatPhone(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return value;
}

function truncateText(value: string | null | undefined, max = 70): string {
  const text = value?.trim() ?? "";
  if (!text) {
    return "-";
  }
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function getStatusLabel(status: DeliveryReportStatus): string {
  switch (status) {
    case "sending":
      return "Sending";
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "failed":
      return "Failed";
    case "retrying":
      return "Retrying";
    default:
      return status;
  }
}

function getAlertSeverityLabel(alert: DeliveryAlert): string {
  switch (alert.severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

function getModeLabel(conversation: Conversation): string {
  return conversation.ai_paused || conversation.manual_takeover ? "Human" : "AI Live";
}

function getLeadScoreTone(conversation: Conversation): string {
  if (conversation.score >= 80) {
    return "#b91c1c";
  }
  if (conversation.score >= 55) {
    return "#b45309";
  }
  return "#166534";
}

function getStatusPillStyle(status: DeliveryReportStatus): CSSProperties {
  if (status === "failed") {
    return {
      background: "#fff1f2",
      color: "#dc2626",
      border: "1px solid #fecdd3"
    };
  }
  if (status === "read") {
    return {
      background: "#ecfdf5",
      color: "#16a34a",
      border: "1px solid #bbf7d0"
    };
  }
  if (status === "delivered") {
    return {
      background: "#eff6ff",
      color: "#2563eb",
      border: "1px solid #bfdbfe"
    };
  }
  if (status === "retrying") {
    return {
      background: "#fff7ed",
      color: "#c2410c",
      border: "1px solid #fed7aa"
    };
  }
  if (status === "sending") {
    return {
      background: "#f8fafc",
      color: "#475569",
      border: "1px solid #cbd5e1"
    };
  }
  return {
    background: "#f8fafc",
    color: "#334155",
    border: "1px solid #cbd5e1"
  };
}

function getCardTone(key: string): { background: string; border: string; count: string } {
  if (key === "failed" || key === "notInWhatsApp") {
    return { background: "#fff7f7", border: "#fecaca", count: "#dc2626" };
  }
  if (key === "frequencyLimit") {
    return { background: "#fffaf0", border: "#fed7aa", count: "#c2410c" };
  }
  if (key === "engaged") {
    return { background: "#f0fdf4", border: "#bbf7d0", count: "#16a34a" };
  }
  if (key === "delivered") {
    return { background: "#eff6ff", border: "#bfdbfe", count: "#2563eb" };
  }
  return { background: "#f8fafc", border: "#dbe4f0", count: "#0f172a" };
}

function getChannelLabel(channels: DeliveryReportChannel[], channelKey: string): string {
  return channels.find((channel) => channel.key === channelKey)?.label ?? "Selected channel";
}

function SectionHeader({
  title,
  subtitle,
  right
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "16px",
        flexWrap: "wrap"
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#0f172a" }}>{title}</h2>
        {subtitle ? (
          <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: "0.96rem" }}>{subtitle}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

function AnalyticsFilters({
  days,
  onDaysChange,
  channels,
  channelKey,
  onChannelChange,
  status,
  onStatusChange
}: {
  days: number;
  onDaysChange: (value: number) => void;
  channels: DeliveryReportChannel[];
  channelKey: string;
  onChannelChange: (value: string) => void;
  status?: NotificationStatusFilter;
  onStatusChange?: (value: NotificationStatusFilter) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "14px",
        flexWrap: "wrap",
        marginTop: "18px",
        marginBottom: "18px"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ color: "#64748b", fontSize: "0.92rem", fontWeight: 600 }}>Overview</span>
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onDaysChange(option)}
            style={{
              padding: "8px 12px",
              borderRadius: "999px",
              border: option === days ? "1px solid #86efac" : "1px solid #d7dee8",
              background: option === days ? "#f0fdf4" : "#ffffff",
              color: option === days ? "#166534" : "#475569",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Past {option} days
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <select
          value={channelKey}
          onChange={(event) => onChannelChange(event.target.value)}
          style={{
            minWidth: "190px",
            padding: "10px 12px",
            borderRadius: "999px",
            border: "1px solid #d7dee8",
            background: "#ffffff",
            color: "#334155"
          }}
        >
          <option value={EMPTY_CHANNEL}>All channels</option>
          {channels.map((channel) => (
            <option key={channel.key} value={channel.key}>
              {channel.label}
            </option>
          ))}
        </select>

        {channelKey ? (
          <button
            type="button"
            onClick={() => onChannelChange(EMPTY_CHANNEL)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "9px 14px",
              borderRadius: "999px",
              border: "1px solid #93c5fd",
              background: "#eff6ff",
              color: "#1d4ed8",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            {getChannelLabel(channels, channelKey)}
            <span aria-hidden="true">x</span>
          </button>
        ) : null}

        {onStatusChange ? (
          <select
            value={status ?? EMPTY_STATUS}
            onChange={(event) => onStatusChange(parseStatus(event.target.value))}
            style={{
              minWidth: "160px",
              padding: "10px 12px",
              borderRadius: "999px",
              border: "1px solid #d7dee8",
              background: "#ffffff",
              color: "#334155"
            }}
          >
            <option value={EMPTY_STATUS}>All statuses</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="read">Read</option>
            <option value="failed">Failed</option>
            <option value="retrying">Retrying</option>
          </select>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  percentage,
  toneKey,
  href
}: {
  label: string;
  count: number;
  percentage: number;
  toneKey: string;
  href?: string;
}) {
  const tone = getCardTone(toneKey);
  const content = (
    <div
      style={{
        borderRadius: "20px",
        border: `1px solid ${tone.border}`,
        background: tone.background,
        padding: "18px",
        minHeight: "124px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        boxShadow: "0 18px 40px -32px rgba(15, 23, 42, 0.35)"
      }}
    >
      <div style={{ color: "#64748b", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: "2rem", fontWeight: 700, color: tone.count }}>{formatNumber(count)}</div>
      <div style={{ color: "#475569", fontSize: "0.95rem", fontWeight: 600 }}>{formatPercent(percentage)}</div>
    </div>
  );

  if (!href) {
    return content;
  }

  return (
    <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>
      {content}
    </Link>
  );
}

function TableShell({
  title,
  subtitle,
  note,
  children
}: {
  title: string;
  subtitle?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article
      className="finance-panel"
      style={{
        padding: "24px",
        borderRadius: "24px",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        boxShadow: "0 24px 60px -45px rgba(15, 23, 42, 0.45)"
      }}
    >
      <SectionHeader title={title} subtitle={subtitle} right={note} />
      {children}
    </article>
  );
}

function StatusPill({ status }: { status: DeliveryReportStatus }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "88px",
        padding: "6px 12px",
        borderRadius: "999px",
        fontSize: "0.88rem",
        fontWeight: 700,
        ...getStatusPillStyle(status)
      }}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function LoadingState({ label }: { label: string }) {
  return <p style={{ margin: "18px 0 0", color: "#64748b" }}>{label}</p>;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        marginTop: "18px",
        borderRadius: "18px",
        border: "1px dashed #cbd5e1",
        padding: "26px",
        textAlign: "center",
        color: "#64748b",
        background: "#f8fafc"
      }}
    >
      {label}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(value);
        }
      }}
      style={{
        width: "28px",
        height: "28px",
        borderRadius: "8px",
        border: "1px solid #d7dee8",
        background: "#ffffff",
        color: "#475569",
        cursor: "pointer"
      }}
      title="Copy message id"
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

function PaginationBar({
  page,
  total,
  onPrevious,
  onNext
}: {
  page: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "12px",
        flexWrap: "wrap",
        marginTop: "18px"
      }}
    >
      <span style={{ color: "#64748b", fontSize: "0.92rem" }}>
        Showing page {page} of {totalPages} ({formatNumber(total)} rows)
      </span>
      <div style={{ display: "flex", gap: "10px" }}>
        <button
          type="button"
          onClick={onPrevious}
          disabled={page <= 1}
          style={{
            padding: "9px 14px",
            borderRadius: "999px",
            border: "1px solid #d7dee8",
            background: page <= 1 ? "#f8fafc" : "#ffffff",
            color: page <= 1 ? "#94a3b8" : "#334155",
            cursor: page <= 1 ? "not-allowed" : "pointer"
          }}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          style={{
            padding: "9px 14px",
            borderRadius: "999px",
            border: "1px solid #d7dee8",
            background: page >= totalPages ? "#f8fafc" : "#ffffff",
            color: page >= totalPages ? "#94a3b8" : "#334155",
            cursor: page >= totalPages ? "not-allowed" : "pointer"
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function OperationalCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: "18px",
        border: "1px solid #e2e8f0",
        background: "#ffffff",
        padding: "16px"
      }}
    >
      <div style={{ color: "#64748b", fontSize: "0.85rem", fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: "8px", color: "#0f172a", fontSize: "1.4rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "16px",
        alignItems: "center",
        borderRadius: "14px",
        border: "1px solid #e2e8f0",
        background: "#fcfdff",
        padding: "12px 14px"
      }}
    >
      <span style={{ color: "#64748b", fontWeight: 600 }}>{label}</span>
      <strong style={{ color: "#0f172a" }}>{value}</strong>
    </div>
  );
}

const tableHeaderStyle: CSSProperties = {
  padding: "0 12px 12px 0",
  fontWeight: 700,
  letterSpacing: "0.04em"
};

const tableCellStyle: CSSProperties = {
  padding: "14px 12px 14px 0",
  verticalAlign: "top",
  color: "#334155"
};

function DashboardPage({
  token,
  days,
  channelKey,
  channels,
  summary
}: {
  token: string;
  days: number;
  channelKey: string;
  channels: DeliveryReportChannel[];
  summary: DeliveryReportSummary | null;
}) {
  const overviewQuery = useQuery({
    queryKey: [...dashboardQueryKeys.analyticsRoot, "overview"] as const,
    queryFn: () => fetchDeliveryOverview(token).then((response) => response.overview),
    enabled: Boolean(token)
  });

  const cards = useMemo(() => {
    if (!summary) {
      return [];
    }
    return [
      { key: "recipients", value: summary.cards.recipients, href: undefined },
      { key: "sent", value: summary.cards.sent, href: "/dashboard/analytics/notification-messages" },
      { key: "delivered", value: summary.cards.delivered, href: "/dashboard/analytics/notification-messages" },
      { key: "engaged", value: summary.cards.engaged, href: "/dashboard/analytics/notification-messages" },
      { key: "notInWhatsApp", value: summary.cards.notInWhatsApp, href: "/dashboard/analytics/failed-messages" },
      { key: "frequencyLimit", value: summary.cards.frequencyLimit, href: "/dashboard/analytics/failed-messages" },
      { key: "failed", value: summary.cards.failed, href: "/dashboard/analytics/failed-messages" }
    ];
  }, [summary]);

  const overview = overviewQuery.data ?? null;

  return (
    <section className="finance-shell" style={{ display: "grid", gap: "18px" }}>
      <TableShell
        title="Message Delivery Overview"
        subtitle={`Past ${days} days${channelKey ? ` for ${getChannelLabel(channels, channelKey)}` : ""}`}
      >
        {!summary ? (
          summary === null && overviewQuery.isLoading ? (
            <LoadingState label="Loading delivery summary..." />
          ) : (
            <EmptyState label="No delivery activity found for this range yet." />
          )
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "14px",
                marginTop: "18px"
              }}
            >
              {cards.map((card) => (
                <SummaryCard
                  key={card.key}
                  label={card.value.label}
                  count={card.value.count}
                  percentage={card.value.percentage}
                  toneKey={card.key}
                  href={card.href}
                />
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 1fr)",
                gap: "16px",
                marginTop: "20px"
              }}
            >
              <div
                style={{
                  borderRadius: "20px",
                  border: "1px solid #e2e8f0",
                  padding: "18px",
                  background: "#fcfdff"
                }}
              >
                <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#0f172a" }}>Daily trend</h3>
                {summary.daily.length === 0 ? (
                  <EmptyState label="No daily delivery events for this range yet." />
                ) : (
                  <div style={{ overflowX: "auto", marginTop: "14px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "420px" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#64748b", fontSize: "0.82rem" }}>
                          <th style={{ padding: "0 0 12px" }}>Day</th>
                          <th style={{ padding: "0 0 12px" }}>Sent</th>
                          <th style={{ padding: "0 0 12px" }}>Delivered</th>
                          <th style={{ padding: "0 0 12px" }}>Engaged</th>
                          <th style={{ padding: "0 0 12px" }}>Failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.daily.map((item) => (
                          <tr key={item.day} style={{ borderTop: "1px solid #eef2f7" }}>
                            <td style={{ padding: "12px 0", fontWeight: 600, color: "#0f172a" }}>{formatDateLabel(item.day)}</td>
                            <td style={{ padding: "12px 0", color: "#334155" }}>{formatNumber(item.sent)}</td>
                            <td style={{ padding: "12px 0", color: "#2563eb" }}>{formatNumber(item.delivered)}</td>
                            <td style={{ padding: "12px 0", color: "#16a34a" }}>{formatNumber(item.engaged)}</td>
                            <td style={{ padding: "12px 0", color: "#dc2626" }}>{formatNumber(item.failed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: "16px" }}>
                <div
                  style={{
                    borderRadius: "20px",
                    border: "1px solid #e2e8f0",
                    padding: "18px",
                    background: "#fcfdff"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#0f172a" }}>Top failure reasons</h3>
                  {summary.topFailureReasons.length === 0 ? (
                    <p style={{ margin: "14px 0 0", color: "#64748b" }}>No failure reasons recorded in this range.</p>
                  ) : (
                    <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
                      {summary.topFailureReasons.map((reason, index) => (
                        <div
                          key={`${reason.errorCode ?? "na"}-${index}`}
                          style={{
                            borderRadius: "14px",
                            border: "1px solid #fee2e2",
                            padding: "12px 14px",
                            background: "#fffafa"
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                            <strong style={{ color: "#991b1b" }}>{truncateText(reason.message, 52)}</strong>
                            <span style={{ color: "#dc2626", fontWeight: 700 }}>{formatNumber(reason.count)}</span>
                          </div>
                          <div style={{ marginTop: "6px", color: "#7f1d1d", fontSize: "0.85rem" }}>
                            Code: {reason.errorCode ?? "n/a"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    borderRadius: "20px",
                    border: "1px solid #e2e8f0",
                    padding: "18px",
                    background: "#fcfdff"
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#0f172a" }}>Channel health</h3>
                  {summary.channels.length === 0 ? (
                    <p style={{ margin: "14px 0 0", color: "#64748b" }}>No channel activity yet.</p>
                  ) : (
                    <div style={{ display: "grid", gap: "10px", marginTop: "14px" }}>
                      {summary.channels.map((channel) => (
                        <div
                          key={channel.key}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            alignItems: "center",
                            borderRadius: "14px",
                            border: "1px solid #eef2f7",
                            padding: "12px 14px"
                          }}
                        >
                          <div>
                            <strong style={{ color: "#0f172a" }}>{channel.label}</strong>
                            <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
                              {formatNumber(channel.messages)} messages
                            </div>
                          </div>
                          <div style={{ color: channel.failed > 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                            {channel.failed > 0 ? `${formatNumber(channel.failed)} failed` : "Healthy"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {overview ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "14px",
                  marginTop: "18px"
                }}
              >
                <OperationalCard label="Attempts" value={formatNumber(overview.attempts.total)} />
                <OperationalCard label="Success rate" value={formatPercent(overview.attempts.successRate)} />
                <OperationalCard label="Retry scheduled" value={formatNumber(overview.attempts.retryScheduled)} />
                <OperationalCard label="Queued campaign messages" value={formatNumber(overview.queuedCampaignMessages)} />
                <OperationalCard label="Open alerts" value={formatNumber(overview.openAlerts)} />
                <OperationalCard label="Suppressed recipients" value={formatNumber(overview.suppressedRecipients)} />
              </div>
            ) : null}
          </>
        )}
      </TableShell>
    </section>
  );
}

function FailedMessagesPage({
  token,
  days,
  channelKey
}: {
  token: string;
  days: number;
  channelKey: string;
}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [days, channelKey]);

  const failuresQuery = useQuery({
    queryKey: dashboardQueryKeys.deliveryFailures(days, channelKey || "all", page),
    queryFn: () =>
      fetchDeliveryFailures(token, {
        days,
        channelKey: channelKey || null,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE
      }),
    enabled: Boolean(token)
  });

  const result = failuresQuery.data;

  return (
    <section className="finance-shell">
      <TableShell
        title="WhatsApp Failed Messages"
        subtitle="Failure report with sender, recipient, and delivery remarks."
        note={
          <div
            style={{
              borderRadius: "14px",
              background: "#fef9c3",
              border: "1px solid #fde68a",
              color: "#854d0e",
              padding: "10px 12px",
              fontSize: "0.92rem"
            }}
          >
            For brevity, we show only the last 50 message logs per page.
          </div>
        }
      >
        {failuresQuery.isLoading ? (
          <LoadingState label="Loading failed message report..." />
        ) : !result || result.rows.length === 0 ? (
          <EmptyState label="No failed WhatsApp messages found for this range." />
        ) : (
          <>
            <div style={{ overflowX: "auto", marginTop: "18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: "0.82rem", color: "#64748b", textTransform: "uppercase" }}>
                    <th style={tableHeaderStyle}>Message ID</th>
                    <th style={tableHeaderStyle}>Sender</th>
                    <th style={tableHeaderStyle}>Message content</th>
                    <th style={tableHeaderStyle}>To</th>
                    <th style={tableHeaderStyle}>Date time</th>
                    <th style={tableHeaderStyle}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.rowId} style={{ borderTop: "1px solid #edf2f7" }}>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>{truncateText(row.messageId, 18)}</span>
                          <CopyButton value={row.messageId} />
                        </div>
                      </td>
                      <td style={tableCellStyle}>
                        <div style={{ fontWeight: 600, color: "#334155" }}>{row.sender}</div>
                        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>{row.channelLabel}</div>
                      </td>
                      <td style={tableCellStyle} title={row.messageContent}>
                        {truncateText(row.messageContent, 56)}
                      </td>
                      <td style={tableCellStyle}>{formatPhone(row.to)}</td>
                      <td style={tableCellStyle}>{formatDateTime(row.dateTime)}</td>
                      <td style={{ ...tableCellStyle, color: "#7f1d1d" }} title={row.remarks ?? undefined}>
                        {truncateText(row.remarks ?? "No remarks", 64)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={page}
              total={result.total}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </>
        )}
      </TableShell>
    </section>
  );
}

function NotificationMessagesPage({
  token,
  days,
  channelKey,
  status
}: {
  token: string;
  days: number;
  channelKey: string;
  status: NotificationStatusFilter;
}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [days, channelKey, status]);

  const notificationsQuery = useQuery({
    queryKey: dashboardQueryKeys.deliveryNotifications(days, channelKey || "all", status, page),
    queryFn: () =>
      fetchDeliveryNotifications(token, {
        days,
        channelKey: channelKey || null,
        status: status === EMPTY_STATUS ? null : status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE
      }),
    enabled: Boolean(token)
  });

  const result = notificationsQuery.data;

  return (
    <section className="finance-shell">
      <TableShell
        title="WhatsApp Notification Messages"
        subtitle="Tracked outbound notifications across campaigns and inbox sends."
        note={
          <div
            style={{
              borderRadius: "14px",
              background: "#fef9c3",
              border: "1px solid #fde68a",
              color: "#854d0e",
              padding: "10px 12px",
              fontSize: "0.92rem"
            }}
          >
            For brevity, we show only the last 50 message logs per page.
          </div>
        }
      >
        {notificationsQuery.isLoading ? (
          <LoadingState label="Loading notification message report..." />
        ) : !result || result.rows.length === 0 ? (
          <EmptyState label="No notification messages found for this range." />
        ) : (
          <>
            <div style={{ overflowX: "auto", marginTop: "18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "920px" }}>
                <thead>
                  <tr style={{ textAlign: "left", fontSize: "0.82rem", color: "#64748b", textTransform: "uppercase" }}>
                    <th style={tableHeaderStyle}>Message ID</th>
                    <th style={tableHeaderStyle}>Message content</th>
                    <th style={tableHeaderStyle}>To</th>
                    <th style={tableHeaderStyle}>Date time</th>
                    <th style={tableHeaderStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.rowId} style={{ borderTop: "1px solid #edf2f7" }}>
                      <td style={tableCellStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>{truncateText(row.messageId, 20)}</span>
                          <CopyButton value={row.messageId} />
                        </div>
                      </td>
                      <td style={tableCellStyle} title={row.messageContent}>
                        <div style={{ fontWeight: 600, color: "#334155" }}>{truncateText(row.messageContent, 64)}</div>
                        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>{row.channelLabel}</div>
                      </td>
                      <td style={tableCellStyle}>{formatPhone(row.to)}</td>
                      <td style={tableCellStyle}>{formatDateTime(row.dateTime)}</td>
                      <td style={tableCellStyle}>
                        <StatusPill status={row.status} />
                        {row.status === "failed" && row.remarks ? (
                          <div style={{ marginTop: "6px", color: "#991b1b", fontSize: "0.82rem" }}>
                            {truncateText(row.remarks, 40)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={page}
              total={result.total}
              onPrevious={() => setPage((current) => Math.max(1, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </>
        )}
      </TableShell>
    </section>
  );
}

function ConversationReportPage({
  token,
  days,
  channelKey
}: {
  token: string;
  days: number;
  channelKey: string;
}) {
  const navigate = useNavigate();
  const conversationsQuery = useQuery({
    queryKey: dashboardQueryKeys.deliveryConversations(days, channelKey || "all"),
    queryFn: () =>
      fetchDeliveryConversations(token, {
        days,
        channelKey: channelKey || null
      }).then((response) => response.conversations),
    enabled: Boolean(token)
  });

  const conversations = conversationsQuery.data ?? [];
  const humanHandled = conversations.filter((conversation) => conversation.ai_paused || conversation.manual_takeover).length;
  const hotLeads = conversations.filter((conversation) => conversation.score >= 80).length;

  return (
    <section className="finance-shell" style={{ display: "grid", gap: "18px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "14px"
        }}
      >
        <OperationalCard label="API conversations" value={formatNumber(conversations.length)} />
        <OperationalCard label="Human handled" value={formatNumber(humanHandled)} />
        <OperationalCard label="AI live" value={formatNumber(conversations.length - humanHandled)} />
        <OperationalCard label="Hot leads" value={formatNumber(hotLeads)} />
      </div>

      <TableShell
        title="Conversation Report"
        subtitle="Recent API-linked conversations tied to message delivery activity."
      >
        {conversationsQuery.isLoading ? (
          <LoadingState label="Loading conversation report..." />
        ) : conversations.length === 0 ? (
          <EmptyState label="No API conversations found for this range." />
        ) : (
          <div style={{ overflowX: "auto", marginTop: "18px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: "0.82rem", color: "#64748b", textTransform: "uppercase" }}>
                  <th style={tableHeaderStyle}>Contact</th>
                  <th style={tableHeaderStyle}>Phone</th>
                  <th style={tableHeaderStyle}>Connected number</th>
                  <th style={tableHeaderStyle}>Lead type</th>
                  <th style={tableHeaderStyle}>Score</th>
                  <th style={tableHeaderStyle}>Mode</th>
                  <th style={tableHeaderStyle}>Last message</th>
                  <th style={tableHeaderStyle}>Last active</th>
                  <th style={tableHeaderStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conversation) => (
                  <tr key={conversation.id} style={{ borderTop: "1px solid #edf2f7" }}>
                    <td style={tableCellStyle}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {conversation.contact_name?.trim() || "Unknown contact"}
                      </div>
                      <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>
                        {conversation.assigned_agent_name?.trim() || "Unassigned"}
                      </div>
                    </td>
                    <td style={tableCellStyle}>{formatPhone(conversation.contact_phone || conversation.phone_number)}</td>
                    <td style={tableCellStyle}>{formatPhone(conversation.channel_linked_number)}</td>
                    <td style={tableCellStyle}>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: "1px solid #d7dee8",
                          background: "#f8fafc",
                          color: "#334155",
                          fontWeight: 600
                        }}
                      >
                        {conversation.lead_kind}
                      </span>
                    </td>
                    <td style={tableCellStyle}>
                      <span style={{ color: getLeadScoreTone(conversation), fontWeight: 700 }}>{conversation.score}/100</span>
                    </td>
                    <td style={tableCellStyle}>{getModeLabel(conversation)}</td>
                    <td style={tableCellStyle} title={conversation.last_message ?? undefined}>
                      {truncateText(conversation.last_message, 48)}
                    </td>
                    <td style={tableCellStyle}>{formatDateTime(conversation.last_message_at)}</td>
                    <td style={tableCellStyle}>
                      <button
                        type="button"
                        onClick={() => navigate(`/dashboard/inbox/${conversation.id}`)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "999px",
                          border: "1px solid #d7dee8",
                          background: "#ffffff",
                          color: "#334155",
                          cursor: "pointer"
                        }}
                      >
                        Open chat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableShell>
    </section>
  );
}

function CampaignRow({ campaign }: { campaign: Campaign }) {
  return (
    <tr style={{ borderTop: "1px solid #edf2f7" }}>
      <td style={tableCellStyle}>
        <div style={{ fontWeight: 700, color: "#0f172a" }}>{campaign.name}</div>
        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>{campaign.template_id ?? "No template"}</div>
      </td>
      <td style={tableCellStyle}>
        <span
          style={{
            display: "inline-flex",
            padding: "6px 10px",
            borderRadius: "999px",
            border: "1px solid #d7dee8",
            background: "#f8fafc",
            color: "#334155",
            fontWeight: 700
          }}
        >
          {campaign.status}
        </span>
      </td>
      <td style={tableCellStyle}>{formatNumber(campaign.total_count)}</td>
      <td style={tableCellStyle}>{formatNumber(campaign.sent_count)}</td>
      <td style={{ ...tableCellStyle, color: "#2563eb" }}>{formatNumber(campaign.delivered_count)}</td>
      <td style={{ ...tableCellStyle, color: "#16a34a" }}>{formatNumber(campaign.read_count)}</td>
      <td style={{ ...tableCellStyle, color: "#dc2626" }}>{formatNumber(campaign.failed_count)}</td>
      <td style={{ ...tableCellStyle, color: "#c2410c" }}>{formatNumber(campaign.skipped_count)}</td>
      <td style={tableCellStyle}>{formatDateTime(campaign.updated_at)}</td>
    </tr>
  );
}

function ReportsPage({
  token,
  days,
  summary
}: {
  token: string;
  days: number;
  summary: DeliveryReportSummary | null;
}) {
  const alertsQuery = useQuery({
    queryKey: dashboardQueryKeys.deliveryAlerts("open"),
    queryFn: () => fetchDeliveryAlerts(token, { status: "open", limit: 10 }).then((response) => response.alerts),
    enabled: Boolean(token)
  });

  const usageQuery = useQuery({
    queryKey: [...dashboardQueryKeys.analyticsRoot, "usage", days] as const,
    queryFn: () => fetchUsageAnalytics(token, { days, limit: 10 }).then((response) => response.usage),
    enabled: Boolean(token)
  });

  const campaignsQuery = useQuery({
    queryKey: dashboardQueryKeys.campaigns,
    queryFn: () => fetchCampaigns(token).then((response) => response.campaigns),
    enabled: Boolean(token)
  });

  const alerts = alertsQuery.data ?? [];
  const usage = usageQuery.data ?? null;
  const campaigns = useMemo(() => {
    return [...(campaignsQuery.data ?? [])]
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, 6);
  }, [campaignsQuery.data]);

  return (
    <section className="finance-shell" style={{ display: "grid", gap: "18px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "14px"
        }}
      >
        <OperationalCard label="Open alerts" value={formatNumber(alerts.length)} />
        <OperationalCard label="Campaigns" value={formatNumber(campaignsQuery.data?.length ?? 0)} />
        <OperationalCard label="AI messages" value={formatNumber(usage?.messages ?? 0)} />
        <OperationalCard label="Top failures" value={formatNumber(summary?.topFailureReasons.length ?? 0)} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
          gap: "18px"
        }}
      >
        <TableShell title="Delivery alerts" subtitle="Operational issues detected by the delivery service.">
          {alertsQuery.isLoading ? (
            <LoadingState label="Loading delivery alerts..." />
          ) : alerts.length === 0 ? (
            <EmptyState label="No open delivery alerts right now." />
          ) : (
            <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  style={{
                    borderRadius: "18px",
                    border: `1px solid ${
                      alert.severity === "critical" ? "#fecaca" : alert.severity === "warning" ? "#fed7aa" : "#cbd5e1"
                    }`,
                    background:
                      alert.severity === "critical" ? "#fff7f7" : alert.severity === "warning" ? "#fffaf0" : "#f8fafc",
                    padding: "16px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                    <strong style={{ color: "#0f172a" }}>{alert.summary}</strong>
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: "999px",
                        background: "#ffffff",
                        border: "1px solid #d7dee8",
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "#334155"
                      }}
                    >
                      {getAlertSeverityLabel(alert)}
                    </span>
                  </div>
                  <div style={{ marginTop: "8px", color: "#64748b", fontSize: "0.9rem" }}>
                    {alert.alert_type} - {formatDateTime(alert.triggered_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TableShell>

        <TableShell title="Usage snapshot" subtitle={`AI usage for the same ${days}-day range.`}>
          {usageQuery.isLoading ? (
            <LoadingState label="Loading usage summary..." />
          ) : !usage ? (
            <EmptyState label="No usage summary available yet." />
          ) : (
            <div style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
              <UsageMetric label="Messages" value={formatNumber(usage.messages)} />
              <UsageMetric label="Prompt tokens" value={formatNumber(usage.prompt_tokens)} />
              <UsageMetric label="Completion tokens" value={formatNumber(usage.completion_tokens)} />
              <UsageMetric label="Total tokens" value={formatNumber(usage.total_tokens)} />
              <UsageMetric label="Estimated cost" value={`INR ${usage.estimated_cost_inr.toFixed(2)}`} />
            </div>
          )}
        </TableShell>
      </div>

      <TableShell title="Recent broadcast campaigns" subtitle="Latest campaign runs with delivery totals.">
        {campaignsQuery.isLoading ? (
          <LoadingState label="Loading campaigns..." />
        ) : campaigns.length === 0 ? (
          <EmptyState label="No campaigns have been created yet." />
        ) : (
          <div style={{ overflowX: "auto", marginTop: "18px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "860px" }}>
              <thead>
                <tr style={{ textAlign: "left", fontSize: "0.82rem", color: "#64748b", textTransform: "uppercase" }}>
                  <th style={tableHeaderStyle}>Campaign</th>
                  <th style={tableHeaderStyle}>Status</th>
                  <th style={tableHeaderStyle}>Audience</th>
                  <th style={tableHeaderStyle}>Sent</th>
                  <th style={tableHeaderStyle}>Delivered</th>
                  <th style={tableHeaderStyle}>Read</th>
                  <th style={tableHeaderStyle}>Failed</th>
                  <th style={tableHeaderStyle}>Skipped</th>
                  <th style={tableHeaderStyle}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <CampaignRow key={campaign.id} campaign={campaign} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableShell>
    </section>
  );
}

function AnalyticsModule() {
  const { token } = useDashboardShell();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const days = parseDays(searchParams.get("days"));
  const channelKey = searchParams.get("channel")?.trim() ?? EMPTY_CHANNEL;
  const status = parseStatus(searchParams.get("status"));

  const summaryQuery = useQuery({
    queryKey: dashboardQueryKeys.deliverySummary(days, channelKey || "all"),
    queryFn: () =>
      fetchDeliveryReportSummary(token, {
        days,
        channelKey: channelKey || null
      }).then((response) => response.summary),
    enabled: Boolean(token)
  });

  const summary = summaryQuery.data ?? null;
  const channels = summary?.channels ?? [];

  const updateFilter = (patch: Partial<{ days: number; channel: string; status: NotificationStatusFilter }>) => {
    const next = new URLSearchParams(searchParams);
    const nextDays = patch.days ?? days;
    const nextChannel = patch.channel ?? channelKey;
    const nextStatus = patch.status ?? status;

    next.set("days", String(nextDays));

    if (nextChannel) {
      next.set("channel", nextChannel);
    } else {
      next.delete("channel");
    }

    if (nextStatus !== EMPTY_STATUS) {
      next.set("status", nextStatus);
    } else {
      next.delete("status");
    }

    setSearchParams(next, { replace: true });
  };

  const headerRight = summary ? (
    <div
      style={{
        display: "flex",
        gap: "12px",
        flexWrap: "wrap",
        alignItems: "center"
      }}
    >
      <span
        style={{
          padding: "8px 12px",
          borderRadius: "999px",
          background: "#f8fafc",
          border: "1px solid #d7dee8",
          color: "#475569",
          fontWeight: 600
        }}
      >
        Recipients: {formatNumber(summary.cards.recipients.count)}
      </span>
      <span
        style={{
          padding: "8px 12px",
          borderRadius: "999px",
          background: "#fff7f7",
          border: "1px solid #fecaca",
          color: "#dc2626",
          fontWeight: 700
        }}
      >
        Failed: {formatNumber(summary.cards.failed.count)}
      </span>
    </div>
  ) : null;

  const showStatusFilter = location.pathname.includes("/dashboard/analytics/notification-messages");

  const routes = useRoutes([
    {
      index: true,
      element: <DashboardPage token={token} days={days} channelKey={channelKey} channels={channels} summary={summary} />
    },
    {
      path: "failed-messages",
      element: <FailedMessagesPage token={token} days={days} channelKey={channelKey} />
    },
    {
      path: "notification-messages",
      element: <NotificationMessagesPage token={token} days={days} channelKey={channelKey} status={status} />
    },
    {
      path: "conversation-report",
      element: <ConversationReportPage token={token} days={days} channelKey={channelKey} />
    },
    {
      path: "reports",
      element: <ReportsPage token={token} days={days} summary={summary} />
    }
  ]);

  return (
    <section className="finance-shell" style={{ display: "grid", gap: "18px" }}>
      <article
        className="finance-panel"
        style={{
          padding: "24px",
          borderRadius: "24px",
          background:
            "linear-gradient(135deg, rgba(247,250,255,1) 0%, rgba(255,255,255,1) 52%, rgba(240,253,244,1) 100%)",
          border: "1px solid #e2e8f0",
          boxShadow: "0 24px 60px -45px rgba(15, 23, 42, 0.45)"
        }}
      >
        <SectionHeader
          title="Analytics"
          subtitle="Delivery summary, failure handling, notification tracking, and conversation reporting."
          right={headerRight}
        />
        <AnalyticsFilters
          days={days}
          onDaysChange={(value) => updateFilter({ days: value })}
          channels={channels}
          channelKey={channelKey}
          onChannelChange={(value) => updateFilter({ channel: value })}
          status={showStatusFilter ? status : undefined}
          onStatusChange={showStatusFilter ? (value) => updateFilter({ status: value }) : undefined}
        />
      </article>

      {summaryQuery.isError ? (
        <TableShell title="Analytics" subtitle="Something went wrong while loading delivery analytics.">
          <EmptyState label={(summaryQuery.error as Error).message} />
        </TableShell>
      ) : (
        routes
      )}
    </section>
  );
}

export function Component() {
  return <AnalyticsModule />;
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.deliverySummary(7, "all"),
      queryFn: () => fetchDeliveryReportSummary(token, { days: 7 }).then((response) => response.summary)
    }),
    queryClient.prefetchQuery({
      queryKey: [...dashboardQueryKeys.analyticsRoot, "overview"] as const,
      queryFn: () => fetchDeliveryOverview(token).then((response) => response.overview)
    })
  ]);
}
