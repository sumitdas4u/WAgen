import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SequenceEnrollment, SequenceEnrollmentStatus, SequenceLog } from "../../../lib/api";
import {
  usePauseSequenceMutation,
  useResumeSequenceMutation,
  useSequenceDetailQuery,
  useSequenceEnrollmentsQuery,
  useSequenceLogsQuery,
  useSequenceStepFunnelQuery
} from "./queries";

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
  const bg =
    status === "active"    ? "#dbeafe" :
    status === "completed" ? "#dcfce7" :
    status === "failed"    ? "#ffe4e6" :
    status === "stopped"   ? "#f3e8ff" : "#f1f5f9";
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
            <span
              className="seq-log-status"
              style={{ color: log.status === "failed" ? "#be123c" : log.status === "stopped" ? "#7c3aed" : undefined }}
            >
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
  const navigate                    = useNavigate();
  const { sequenceId }              = useParams<{ sequenceId: string }>();
  const [statusFilter, setStatus]   = useState<SequenceEnrollmentStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const detail      = useSequenceDetailQuery(token, sequenceId ?? "").data;
  const funnel      = useSequenceStepFunnelQuery(token, sequenceId ?? "").data ?? [];
  const enrollments = useSequenceEnrollmentsQuery(
    token, sequenceId ?? "", statusFilter === "all" ? undefined : statusFilter
  ).data ?? [];
  const pauseMutation  = usePauseSequenceMutation(token, sequenceId ?? "");
  const resumeMutation = useResumeSequenceMutation(token, sequenceId ?? "");

  if (!detail) {
    return (
      <section className="seq-report-page">
        <div className="seq-card seq-loading">Loading report…</div>
      </section>
    );
  }

  const m = detail.metrics;
  const totalEnrolled = m.enrolled || 1;
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
            <span>
              {detail.steps.length} step{detail.steps.length !== 1 ? "s" : ""} · WhatsApp · Trigger: {detail.trigger_type}
            </span>
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

      {/* Logs panel */}
      {selectedEnrollment && (
        <LogsPanel enrollment={selectedEnrollment} token={token} />
      )}

    </section>
  );
}
