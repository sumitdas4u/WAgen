import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import "./analytics.css";
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
    <div className="an-section-head">
      <div>
        <h2 className="an-section-title">{title}</h2>
        {subtitle ? <p className="an-section-sub">{subtitle}</p> : null}
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
    <div className="an-filters-bar">
      <div className="an-filters-left">
        <span className="an-range-label">Range</span>
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`an-range-pill${option === days ? " is-active" : ""}`}
            onClick={() => onDaysChange(option)}
          >
            Past {option} days
          </button>
        ))}
      </div>
      <div className="an-filters-right">
        <select
          className="an-filter-sel"
          value={channelKey}
          onChange={(event) => onChannelChange(event.target.value)}
        >
          <option value={EMPTY_CHANNEL}>All channels</option>
          {channels.map((channel) => (
            <option key={channel.key} value={channel.key}>{channel.label}</option>
          ))}
        </select>
        {channelKey ? (
          <button type="button" className="an-filter-chip"
            onClick={() => onChannelChange(EMPTY_CHANNEL)}>
            {getChannelLabel(channels, channelKey)}
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        {onStatusChange ? (
          <select
            className="an-filter-sel"
            value={status ?? EMPTY_STATUS}
            onChange={(event) => onStatusChange(parseStatus(event.target.value))}
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
  const content = (
    <div className={`an-summary-card tone-${toneKey}`}>
      <div className="an-summary-card-label">{label}</div>
      <div className="an-summary-card-count">{formatNumber(count)}</div>
      <div className="an-summary-card-pct">{formatPercent(percentage)}</div>
    </div>
  );
  if (!href) return content;
  return <Link to={href} style={{ textDecoration: "none" }}>{content}</Link>;
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
    <article className="an-table-panel">
      <SectionHeader title={title} subtitle={subtitle} right={note} />
      {children}
    </article>
  );
}

function StatusPill({ status }: { status: DeliveryReportStatus }) {
  return (
    <span className={`an-status-pill st-${status}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function LoadingState({ label }: { label: string }) {
  return <p className="an-loading">{label}</p>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="an-empty">{label}</div>;
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="an-copy-btn"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(value);
        }
      }}
      title="Copy message id"
    >
      <span aria-hidden="true">⧉</span>
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
    <div className="an-sub-panel" style={{ minHeight: 0 }}>
      <div className="an-stat-label">{label}</div>
      <div className="an-stat-value" style={{ fontSize: "1.4rem" }}>{value}</div>
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="an-channel-row">
      <span className="an-channel-msgs">{label}</span>
      <strong className="an-channel-name">{value}</strong>
    </div>
  );
}


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
    <TableShell
      title="Message Delivery Overview"
      subtitle={`Past ${days} days${channelKey ? ` for ${getChannelLabel(channels, channelKey)}` : ""}`}
    >
      {!summary ? (
        overviewQuery.isLoading ? (
          <LoadingState label="Loading delivery summary..." />
        ) : (
          <EmptyState label="No delivery activity found for this range yet." />
        )
      ) : (
        <>
          <div className="an-summary-grid">
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

          <div className="an-detail-grid">
            <div className="an-sub-panel">
              <h3>Daily trend</h3>
              {summary.daily.length === 0 ? (
                <EmptyState label="No daily delivery events for this range yet." />
              ) : (
                <div className="an-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Sent</th>
                        <th>Delivered</th>
                        <th>Engaged</th>
                        <th>Failed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.daily.map((item) => (
                        <tr key={item.day}>
                          <td style={{ fontWeight: 600 }}>{formatDateLabel(item.day)}</td>
                          <td>{formatNumber(item.sent)}</td>
                          <td style={{ color: "#2563eb" }}>{formatNumber(item.delivered)}</td>
                          <td style={{ color: "#16a34a" }}>{formatNumber(item.engaged)}</td>
                          <td style={{ color: "#dc2626" }}>{formatNumber(item.failed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="an-sub-column">
              <div className="an-sub-panel">
                <h3>Top failure reasons</h3>
                {summary.topFailureReasons.length === 0 ? (
                  <EmptyState label="No failure reasons recorded in this range." />
                ) : (
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    {summary.topFailureReasons.map((reason, index) => (
                      <div key={`${reason.errorCode ?? "na"}-${index}`} className="an-failure-reason">
                        <div className="an-failure-reason-head">
                          <span className="an-failure-reason-msg">{truncateText(reason.message, 52)}</span>
                          <span className="an-failure-reason-count">{formatNumber(reason.count)}</span>
                        </div>
                        <div className="an-failure-reason-code">Code: {reason.errorCode ?? "n/a"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="an-sub-panel">
                <h3>Channel health</h3>
                {summary.channels.length === 0 ? (
                  <EmptyState label="No channel activity yet." />
                ) : (
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    {summary.channels.map((channel) => (
                      <div key={channel.key} className="an-channel-row">
                        <div>
                          <div className="an-channel-name">{channel.label}</div>
                          <div className="an-channel-msgs">{formatNumber(channel.messages)} messages</div>
                        </div>
                        <span className={`an-channel-status ${channel.failed > 0 ? "is-failed" : "is-healthy"}`}>
                          {channel.failed > 0 ? `${formatNumber(channel.failed)} failed` : "Healthy"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {overview ? (
            <div className="an-summary-grid" style={{ marginTop: "1rem" }}>
              <OperationalCard label="Attempts" value={formatNumber(overview.attempts.total)} />
              <OperationalCard label="Success rate" value={formatPercent(overview.attempts.successRate)} />
              <OperationalCard label="Retry scheduled" value={formatNumber(overview.attempts.retryScheduled)} />
              <OperationalCard label="Queued campaigns" value={formatNumber(overview.queuedCampaignMessages)} />
              <OperationalCard label="Open alerts" value={formatNumber(overview.openAlerts)} />
              <OperationalCard label="Suppressed" value={formatNumber(overview.suppressedRecipients)} />
            </div>
          ) : null}
        </>
      )}
    </TableShell>
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
    <section className="an-shell">
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
            <div className="an-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Message ID</th>
                    <th>Sender</th>
                    <th>Message content</th>
                    <th>To</th>
                    <th>Date time</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.rowId}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>{truncateText(row.messageId, 18)}</span>
                          <CopyButton value={row.messageId} />
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "#334155" }}>{row.sender}</div>
                        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>{row.channelLabel}</div>
                      </td>
                      <td title={row.messageContent}>
                        {truncateText(row.messageContent, 56)}
                      </td>
                      <td>{formatPhone(row.to)}</td>
                      <td>{formatDateTime(row.dateTime)}</td>
                      <td style={{ color: "#7f1d1d" }} title={row.remarks ?? undefined}>
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
    <section className="an-shell">
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
            <div className="an-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Message ID</th>
                    <th>Message content</th>
                    <th>To</th>
                    <th>Date time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.rowId}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontWeight: 600, color: "#0f172a" }}>{truncateText(row.messageId, 20)}</span>
                          <CopyButton value={row.messageId} />
                        </div>
                      </td>
                      <td title={row.messageContent}>
                        <div style={{ fontWeight: 600, color: "#334155" }}>{truncateText(row.messageContent, 64)}</div>
                        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>{row.channelLabel}</div>
                      </td>
                      <td>{formatPhone(row.to)}</td>
                      <td>{formatDateTime(row.dateTime)}</td>
                      <td>
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
    <section className="an-shell">
      <div className="an-summary-grid">
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
          <div className="an-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Connected number</th>
                  <th>Lead type</th>
                  <th>Score</th>
                  <th>Mode</th>
                  <th>Last message</th>
                  <th>Last active</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((conversation) => (
                  <tr key={conversation.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {conversation.contact_name?.trim() || "Unknown contact"}
                      </div>
                      <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>
                        {conversation.assigned_agent_name?.trim() || "Unassigned"}
                      </div>
                    </td>
                    <td>{formatPhone(conversation.contact_phone || conversation.phone_number)}</td>
                    <td>{formatPhone(conversation.channel_linked_number)}</td>
                    <td>
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
                    <td>
                      <span style={{ color: getLeadScoreTone(conversation), fontWeight: 700 }}>{conversation.score}/100</span>
                    </td>
                    <td>{getModeLabel(conversation)}</td>
                    <td title={conversation.last_message ?? undefined}>
                      {truncateText(conversation.last_message, 48)}
                    </td>
                    <td>{formatDateTime(conversation.last_message_at)}</td>
                    <td>
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
    <tr>
      <td>
        <div style={{ fontWeight: 700, color: "#0f172a" }}>{campaign.name}</div>
        <div style={{ marginTop: "4px", color: "#64748b", fontSize: "0.84rem" }}>{campaign.template_id ?? "No template"}</div>
      </td>
      <td>
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
      <td>{formatNumber(campaign.total_count)}</td>
      <td>{formatNumber(campaign.sent_count)}</td>
      <td style={{ color: "#2563eb" }}>{formatNumber(campaign.delivered_count)}</td>
      <td style={{ color: "#16a34a" }}>{formatNumber(campaign.read_count)}</td>
      <td style={{ color: "#dc2626" }}>{formatNumber(campaign.failed_count)}</td>
      <td style={{ color: "#c2410c" }}>{formatNumber(campaign.skipped_count)}</td>
      <td>{formatDateTime(campaign.updated_at)}</td>
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
    <section className="an-shell">
      <div className="an-summary-grid">
        <OperationalCard label="Open alerts" value={formatNumber(alerts.length)} />
        <OperationalCard label="Campaigns" value={formatNumber(campaignsQuery.data?.length ?? 0)} />
        <OperationalCard label="AI messages" value={formatNumber(usage?.messages ?? 0)} />
        <OperationalCard label="Top failures" value={formatNumber(summary?.topFailureReasons.length ?? 0)} />
      </div>

      <div className="an-detail-grid">
        <TableShell title="Delivery alerts" subtitle="Operational issues detected by the delivery service.">
          {alertsQuery.isLoading ? (
            <LoadingState label="Loading delivery alerts..." />
          ) : alerts.length === 0 ? (
            <EmptyState label="No open delivery alerts right now." />
          ) : (
            <div style={{ display: "grid", gap: "0.65rem", marginTop: "1rem" }}>
              {alerts.map((alert) => (
                <div key={alert.id} className="an-failure-reason">
                  <div className="an-failure-reason-head">
                    <span className="an-failure-reason-msg">{alert.summary}</span>
                    <span className={`an-severity-pill sev-${alert.severity}`}>
                      {getAlertSeverityLabel(alert)}
                    </span>
                  </div>
                  <div className="an-failure-reason-code">
                    {alert.alert_type} — {formatDateTime(alert.triggered_at)}
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
            <div style={{ display: "grid", gap: "0.5rem", marginTop: "1rem" }}>
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
          <div className="an-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Audience</th>
                  <th>Sent</th>
                  <th>Delivered</th>
                  <th>Read</th>
                  <th>Failed</th>
                  <th>Skipped</th>
                  <th>Updated</th>
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
    <section className="an-shell">
      {/* Overview stats card */}
      <div className="an-overview-card">
        <div className="an-overview-head">
          <span className="an-overview-title">Overview</span>
          {summary ? (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className="an-overview-badge is-slate">
                Recipients: {formatNumber(summary.cards.recipients.count)}
              </span>
              <span className="an-overview-badge is-red">
                Failed: {formatNumber(summary.cards.failed.count)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="an-overview-stats">
          {summary ? (
            <>
              <div className="an-stat-cell">
                <p className="an-stat-label">Sent</p>
                <p className="an-stat-value">{formatNumber(summary.cards.sent.count)}</p>
                <p className="an-stat-sub">{formatPercent(summary.cards.sent.percentage)}</p>
              </div>
              <div className="an-stat-cell">
                <p className="an-stat-label">Delivered</p>
                <p className="an-stat-value is-blue">{formatNumber(summary.cards.delivered.count)}</p>
                <p className="an-stat-sub">{formatPercent(summary.cards.delivered.percentage)}</p>
              </div>
              <div className="an-stat-cell">
                <p className="an-stat-label">Engaged</p>
                <p className="an-stat-value is-green">{formatNumber(summary.cards.engaged.count)}</p>
                <p className="an-stat-sub">{formatPercent(summary.cards.engaged.percentage)}</p>
              </div>
              <div className="an-stat-cell">
                <p className="an-stat-label">Failed</p>
                <p className="an-stat-value is-red">{formatNumber(summary.cards.failed.count)}</p>
                <p className="an-stat-sub">{formatPercent(summary.cards.failed.percentage)}</p>
              </div>
              <div className="an-stat-cell">
                <p className="an-stat-label">Freq. Limited</p>
                <p className="an-stat-value is-amber">{formatNumber(summary.cards.frequencyLimit.count)}</p>
                <p className="an-stat-sub">{formatPercent(summary.cards.frequencyLimit.percentage)}</p>
              </div>
              <div className="an-stat-cell">
                <p className="an-stat-label">Not in WA</p>
                <p className="an-stat-value is-amber">{formatNumber(summary.cards.notInWhatsApp.count)}</p>
                <p className="an-stat-sub">{formatPercent(summary.cards.notInWhatsApp.percentage)}</p>
              </div>
              <div className="an-stat-cell">
                <p className="an-stat-label">Recipients</p>
                <p className="an-stat-value">{formatNumber(summary.cards.recipients.count)}</p>
              </div>
            </>
          ) : summaryQuery.isLoading ? (
            <div className="an-stat-cell"><p className="an-stat-label">Loading…</p></div>
          ) : (
            <div className="an-stat-cell"><p className="an-stat-label">No data</p></div>
          )}
        </div>
      </div>

      {/* Filter panel */}
      <div className="an-filter-panel">
        <AnalyticsFilters
          days={days}
          onDaysChange={(value) => updateFilter({ days: value })}
          channels={channels}
          channelKey={channelKey}
          onChannelChange={(value) => updateFilter({ channel: value })}
          status={showStatusFilter ? status : undefined}
          onStatusChange={showStatusFilter ? (value) => updateFilter({ status: value }) : undefined}
        />
      </div>

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
