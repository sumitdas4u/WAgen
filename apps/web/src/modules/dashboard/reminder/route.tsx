import { lazy, Suspense, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { fetchReminderConfigs } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useReminderConfigsQuery, useUpsertReminderConfigMutation, useReminderDispatchLogQuery, useReminderStatsQuery } from "./queries";
import type { ReminderStats } from "../../../lib/api";
import "./reminder.css";

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function NewReminderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { token } = useAuth();
  const upsertMutation = useUpsertReminderConfigMutation(token ?? "");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const configKey = slugify(label);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configKey) { setError("Enter a name."); return; }
    try {
      await upsertMutation.mutateAsync({
        configKey,
        input: { reminderType: "custom", customLabel: label.trim(), enabled: false }
      });
      onCreated(configKey);
    } catch {
      setError("Failed to create reminder.");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(18,32,51,0.45)",
      display: "grid", placeItems: "center"
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: "1.5rem",
        width: "min(420px, 90vw)", display: "grid", gap: "1rem"
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.1rem", fontWeight: 700, color: "#122033" }}>
          New Reminder
        </div>

        <form onSubmit={handleCreate} style={{ display: "grid", gap: "0.85rem" }}>
          <div className="rm-field">
            <label className="rm-label">Reminder Name</label>
            <input
              className="rm-input"
              autoFocus
              placeholder="e.g. Policy Renewal, Wedding Anniversary, Membership Expiry"
              value={label}
              onChange={(e) => { setLabel(e.target.value); setError(""); }}
            />
            {configKey && (
              <span className="rm-label-hint">Key: <code>{configKey}</code></span>
            )}
            {error && <span style={{ fontSize: "0.8rem", color: "#dc2626" }}>{error}</span>}
          </div>

          <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
            <button type="button" className="rm-btn rm-btn-ghost rm-btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="rm-btn rm-btn-primary rm-btn-sm"
              disabled={!configKey || upsertMutation.isPending}
            >
              {upsertMutation.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const REMINDER_META_LABELS: Record<string, { icon: string; label: string }> = {
  birthday:    { icon: "🎂", label: "Birthday" },
  anniversary: { icon: "💍", label: "Anniversary" }
};

import type { ReminderLogType } from "../../../lib/api";

const LOG_TYPE_META: Record<ReminderLogType, { icon: string; label: string; bg: string; border: string; color: string }> = {
  campaign:         { icon: "📅", label: "Campaign",         bg: "#f0f4ff", border: "#c7d6f7", color: "#1d4ed8" },
  capture_ask:      { icon: "📲", label: "Capture Ask",      bg: "#fef3c7", border: "#fde68a", color: "#92400e" },
  capture_complete: { icon: "✅", label: "Date Captured",    bg: "#dcfce7", border: "#bbf7d0", color: "#166534" },
  capture_declined: { icon: "⏸️", label: "Declined",        bg: "#ffe4e6", border: "#fecdd3", color: "#be123c" },
  capture_expired:  { icon: "⏱️", label: "No Response",     bg: "#f1f5f9", border: "#e2eaf4", color: "#475569" }
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  sent:      { color: "#166534", bg: "#dcfce7", border: "#bbf7d0" },
  failed:    { color: "#be123c", bg: "#ffe4e6", border: "#fecdd3" },
  pending:   { color: "#92400e", bg: "#fef3c7", border: "#fde68a" },
  delivered: { color: "#1d4ed8", bg: "#dbeafe", border: "#bfdbfe" }
};

type LogFilter = "all" | ReminderLogType;

function StatBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: "#f1f5f9", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 300ms ease" }} />
      </div>
      <span style={{ fontSize: "0.72rem", fontWeight: 700, color, minWidth: 28, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function ReminderStatsRow({ stat, configLabel }: { stat: ReminderStats; configLabel: string }) {
  const captureRate = stat.capture_asked > 0
    ? Math.round((stat.capture_complete / stat.capture_asked) * 100)
    : 0;
  const deliveryRate = stat.campaign_total > 0
    ? Math.round((stat.campaign_delivered / stat.campaign_total) * 100)
    : 0;

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#122033" }}>{configLabel}</div>
        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.1rem" }}>
          <code style={{ fontSize: "0.68rem" }}>{stat.config_key}</code>
        </div>
      </td>
      {/* Capture funnel */}
      <td style={{ minWidth: 160 }}>
        <div style={{ display: "grid", gap: "0.2rem" }}>
          <StatBar value={stat.capture_asked} total={stat.capture_asked} color="#92400e" />
          <StatBar value={stat.capture_complete} total={stat.capture_asked} color="#166534" />
          <StatBar value={stat.capture_declined} total={stat.capture_asked} color="#be123c" />
          <StatBar value={stat.capture_expired} total={stat.capture_asked} color="#475569" />
        </div>
      </td>
      <td style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.15rem", fontWeight: 800, color: captureRate >= 50 ? "#166534" : "#92400e" }}>{captureRate}%</div>
        <div style={{ fontSize: "0.62rem", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>capture rate</div>
      </td>
      {/* Campaign */}
      <td style={{ minWidth: 140 }}>
        <div style={{ display: "grid", gap: "0.2rem" }}>
          <StatBar value={stat.campaign_sent} total={stat.campaign_total} color="#1d4ed8" />
          <StatBar value={stat.campaign_delivered} total={stat.campaign_total} color="#166534" />
          <StatBar value={stat.campaign_failed} total={stat.campaign_total} color="#be123c" />
        </div>
      </td>
      <td style={{ textAlign: "center" }}>
        <div style={{ fontSize: "1.15rem", fontWeight: 800, color: deliveryRate >= 80 ? "#166534" : "#92400e" }}>{deliveryRate}%</div>
        <div style={{ fontSize: "0.62rem", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>delivery rate</div>
      </td>
      <td style={{ textAlign: "center" }}>
        {stat.capture_pending > 0 ? (
          <span style={{
            display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999,
            background: "#fef3c7", border: "1px solid #fde68a",
            fontSize: "0.72rem", fontWeight: 800, color: "#92400e"
          }}>
            ⏳ {stat.capture_pending}
          </span>
        ) : (
          <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>—</span>
        )}
      </td>
    </tr>
  );
}

function ReminderStatsSection() {
  const { token } = useAuth();
  const { data: stats, isLoading } = useReminderStatsQuery(token ?? "");
  const { data: configs } = useReminderConfigsQuery(token ?? "");

  if (isLoading || !stats || stats.length === 0) return null;

  const getLabel = (configKey: string) => {
    const config = configs?.find((c) => c.config_key === configKey);
    const meta = REMINDER_META_LABELS[configKey];
    return config?.custom_label ?? meta?.label ?? configKey;
  };

  return (
    <div className="rm-table-card">
      <div className="rm-toolbar">
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>
          Performance Report
        </div>
        <div style={{ fontSize: "0.75rem", color: "#5f6f86" }}>All-time stats per reminder</div>
      </div>
      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th>Reminder</th>
              <th>
                <div style={{ display: "grid", gap: "0.1rem" }}>
                  <span>Capture Funnel</span>
                  <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.25rem" }}>
                    {[
                      { color: "#92400e", label: "Asked" },
                      { color: "#166534", label: "Captured" },
                      { color: "#be123c", label: "Declined" },
                      { color: "#475569", label: "Expired" }
                    ].map((l) => (
                      <span key={l.label} style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.6rem", fontWeight: 700, textTransform: "none", letterSpacing: 0, color: "#5f6f86" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
                        {l.label}
                      </span>
                    ))}
                  </div>
                </div>
              </th>
              <th style={{ textAlign: "center" }}>Rate</th>
              <th>
                <div style={{ display: "grid", gap: "0.1rem" }}>
                  <span>Campaign</span>
                  <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.25rem" }}>
                    {[
                      { color: "#1d4ed8", label: "Sent" },
                      { color: "#166534", label: "Delivered" },
                      { color: "#be123c", label: "Failed" }
                    ].map((l) => (
                      <span key={l.label} style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.6rem", fontWeight: 700, textTransform: "none", letterSpacing: 0, color: "#5f6f86" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
                        {l.label}
                      </span>
                    ))}
                  </div>
                </div>
              </th>
              <th style={{ textAlign: "center" }}>Rate</th>
              <th style={{ textAlign: "center" }}>Pending</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((stat) => (
              <ReminderStatsRow key={stat.config_key} stat={stat} configLabel={getLabel(stat.config_key)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DispatchLogSection() {
  const { token } = useAuth();
  const [days, setDays] = useState(7);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const { data: logs, isLoading } = useReminderDispatchLogQuery(token ?? "", { days });

  const filtered = logFilter === "all" ? logs : logs?.filter((l) => l.log_type === logFilter);

  const counts = {
    campaign: logs?.filter((l) => l.log_type === "campaign").length ?? 0,
    capture_ask: logs?.filter((l) => l.log_type === "capture_ask").length ?? 0,
    capture_complete: logs?.filter((l) => l.log_type === "capture_complete").length ?? 0,
    capture_declined: logs?.filter((l) => l.log_type === "capture_declined").length ?? 0,
    capture_expired: logs?.filter((l) => l.log_type === "capture_expired").length ?? 0,
  };

  return (
    <div className="rm-table-card">
      <div className="rm-toolbar">
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#122033" }}>
          Activity Log
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              style={{
                appearance: "none", height: "1.9rem", padding: "0 0.65rem",
                border: "1px solid #e2eaf4", borderRadius: 8,
                background: days === d ? "#f0f4ff" : "#fff",
                borderColor: days === d ? "#c7d6f7" : "#e2eaf4",
                color: days === d ? "#2563eb" : "#5f6f86",
                fontSize: "0.75rem", fontWeight: 600, cursor: "pointer"
              }}
            >
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats row */}
      {!isLoading && logs && logs.length > 0 && (
        <div style={{ display: "flex", borderBottom: "1px solid #edf2f7", overflowX: "auto" }}>
          {([
            { key: "all" as LogFilter, label: "All", count: logs.length, color: "#122033", bg: "#f8fafc", border: "#e2eaf4" },
            { key: "capture_ask" as LogFilter, ...LOG_TYPE_META.capture_ask, count: counts.capture_ask },
            { key: "capture_complete" as LogFilter, ...LOG_TYPE_META.capture_complete, count: counts.capture_complete },
            { key: "capture_declined" as LogFilter, ...LOG_TYPE_META.capture_declined, count: counts.capture_declined },
            { key: "capture_expired" as LogFilter, ...LOG_TYPE_META.capture_expired, count: counts.capture_expired },
            { key: "campaign" as LogFilter, ...LOG_TYPE_META.campaign, count: counts.campaign }
          ]).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setLogFilter(item.key)}
              style={{
                appearance: "none", border: 0, background: logFilter === item.key ? "#f0f4ff" : "transparent",
                padding: "0.55rem 0.85rem", cursor: "pointer", flexShrink: 0,
                borderBottom: logFilter === item.key ? "2px solid #2563eb" : "2px solid transparent",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem"
              }}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1 }}>{"icon" in item ? item.icon : "📊"}</span>
              <span style={{ fontSize: "0.62rem", fontWeight: 800, color: logFilter === item.key ? "#2563eb" : "#5f6f86", whiteSpace: "nowrap" }}>
                {item.label}
              </span>
              <span style={{ fontSize: "0.78rem", fontWeight: 800, color: logFilter === item.key ? "#2563eb" : "#122033" }}>
                {item.count}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Reminder</th>
              <th>Event</th>
              <th>Time</th>
              <th>Template</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="rm-table-empty">Loading…</td></tr>
            )}
            {!isLoading && (!filtered || filtered.length === 0) && (
              <tr><td colSpan={6} className="rm-table-empty">No activity in the last {days} days.</td></tr>
            )}
            {filtered?.map((log) => {
              const reminderMeta = REMINDER_META_LABELS[log.config_key] ?? { icon: "📅", label: log.config_key };
              const logMeta = LOG_TYPE_META[log.log_type] ?? LOG_TYPE_META.campaign;
              const st = STATUS_STYLE[log.status] ?? STATUS_STYLE["pending"];
              const d = new Date(log.sent_at);
              const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
              const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
              return (
                <tr key={log.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: "#122033", fontSize: "0.85rem" }}>{log.contact_name ?? "—"}</div>
                    <div style={{ fontSize: "0.72rem", color: "#5f6f86" }}>{log.contact_phone}</div>
                  </td>
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "2px 8px", borderRadius: 999,
                      background: "#f0f4ff", border: "1px solid #c7d6f7",
                      fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8"
                    }}>
                      {reminderMeta.icon} {reminderMeta.label}
                    </span>
                  </td>
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "2px 8px", borderRadius: 999,
                      background: logMeta.bg, border: `1px solid ${logMeta.border}`,
                      fontSize: "0.72rem", fontWeight: 700, color: logMeta.color, whiteSpace: "nowrap"
                    }}>
                      {logMeta.icon} {logMeta.label}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>{dateStr}</div>
                    <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{timeStr}</div>
                  </td>
                  <td style={{ fontSize: "0.78rem", color: "#475569" }}>{log.template_name ?? "—"}</td>
                  <td>
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "2px 8px", borderRadius: 999,
                      background: st.bg, border: `1px solid ${st.border}`,
                      fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.04em",
                      textTransform: "uppercase", color: st.color
                    }}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReminderOverviewPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { data: configs, isLoading, error } = useReminderConfigsQuery(token ?? "");
  const [showModal, setShowModal] = useState(false);

  if (isLoading) return <div className="rm-loading">Loading reminders…</div>;
  if (error) return <div className="rm-loading" style={{ color: "#dc2626" }}>Failed to load reminders.</div>;

  return (
    <div className="rm-page">
      {showModal && (
        <NewReminderModal
          onClose={() => setShowModal(false)}
          onCreated={(key) => {
            setShowModal(false);
            navigate(`/dashboard/reminder/${key}/capture`);
          }}
        />
      )}
      <div className="rm-list-hero">
        <div className="rm-hero-copy">
          <span className="rm-eyebrow">Automation</span>
          <h1 className="rm-hero-title">Reminders</h1>
          <p className="rm-hero-desc">Date-based capture &amp; campaign automation — birthdays, anniversaries and custom events.</p>
        </div>
        <div className="rm-hero-actions">
          <button className="rm-btn rm-btn-primary" style={{ fontSize: "0.82rem" }} onClick={() => setShowModal(true)}>
            + New Reminder
          </button>
        </div>
      </div>

      <div className="rm-table-card">
        <div className="rm-toolbar">
          <div className="rm-toolbar-left">
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#5f6f86" }}>
              {configs?.length ?? 0} reminder{configs?.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="rm-table-wrap">
          <table className="rm-table">
            <thead>
              <tr>
                <th>Reminder</th>
                <th>Status</th>
                <th>Capture</th>
                <th>Campaign</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(!configs || configs.length === 0) && (
                <tr>
                  <td colSpan={5} className="rm-table-empty">No reminders configured yet.</td>
                </tr>
              )}
              {configs?.map((config) => {
                const meta = REMINDER_META_LABELS[config.config_key] ?? { icon: "📅", label: config.custom_label ?? config.config_key };
                return (
                  <tr key={config.config_key} onClick={() => navigate(`/dashboard/reminder/${config.config_key}/capture`)}>
                    <td>
                      <div className="rm-row-identity">
                        <div className="rm-row-icon">{meta.icon}</div>
                        <div>
                          <div className="rm-row-name">{config.custom_label ?? meta.label}</div>
                          <div className="rm-row-type">{config.reminder_type}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`rm-pill ${config.enabled ? "rm-pill-enabled" : "rm-pill-disabled"}`}>
                        {config.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <span className={`rm-pill ${config.capture_enabled ? "rm-pill-on" : "rm-pill-off"}`}>
                        {config.capture_enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td>
                      <span className={`rm-pill ${config.campaign_enabled ? "rm-pill-on" : "rm-pill-off"}`}>
                        {config.campaign_enabled ? "On" : "Off"}
                      </span>
                    </td>
                    <td>
                      <div className="rm-row-actions">
                        <button
                          className="rm-btn rm-btn-ghost rm-btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/reminder/${config.config_key}/capture`); }}
                        >
                          Capture
                        </button>
                        <button
                          className="rm-btn rm-btn-ghost rm-btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/reminder/${config.config_key}/campaign`); }}
                        >
                          Campaign
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ReminderStatsSection />
      <DispatchLogSection />
    </div>
  );
}

const LazyCaptureDetail = lazy(() =>
  import("./[config_key]/capture").then((m) => ({ default: m.CapturePage }))
);
const LazyCampaignDetail = lazy(() =>
  import("./[config_key]/campaign").then((m) => ({ default: m.CampaignPage }))
);

function CaptureDetailPage() {
  return (
    <Suspense fallback={<div className="rm-loading">Loading…</div>}>
      <LazyCaptureDetail />
    </Suspense>
  );
}

function CampaignDetailPage() {
  return (
    <Suspense fallback={<div className="rm-loading">Loading…</div>}>
      <LazyCampaignDetail />
    </Suspense>
  );
}

export function Component() {
  return (
    <Routes>
      <Route index element={<ReminderOverviewPage />} />
      <Route path=":configKey/capture" element={<CaptureDetailPage />} />
      <Route path=":configKey/campaign" element={<CampaignDetailPage />} />
      <Route path="*" element={<Navigate to="/dashboard/reminder" replace />} />
    </Routes>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery({
    queryKey: dashboardQueryKeys.reminderConfigs,
    queryFn: () => fetchReminderConfigs(token).then((result) => result.configs)
  });
}
