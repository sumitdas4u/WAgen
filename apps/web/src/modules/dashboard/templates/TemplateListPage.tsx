import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { MessageTemplate, MetaBusinessStatus, TemplateCategory, TemplateStatus } from "../../../lib/api";
import { MetaConnectionSelector, isMetaConnectionActive } from "../../../shared/dashboard/meta-connection-selector";
import { TemplatePreviewPanel } from "./TemplatePreviewPanel";
import { useDeleteTemplateMutation, useSendTestTemplateMutation, useSyncTemplatesMutation, useTemplatesQuery } from "./queries";
import "./templates.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusClass(status: TemplateStatus): string {
  const map: Record<TemplateStatus, string> = {
    APPROVED: "st-approved",
    PENDING:  "st-pending",
    REJECTED: "st-rejected",
    PAUSED:   "st-paused",
    DISABLED: "st-disabled"
  };
  return map[status] ?? "st-default";
}

function getStatusLabel(status: TemplateStatus): string {
  const map: Record<TemplateStatus, string> = {
    APPROVED: "Approved",
    PENDING:  "Pending",
    REJECTED: "Rejected",
    PAUSED:   "Paused",
    DISABLED: "Disabled"
  };
  return map[status] ?? status;
}

function getCatClass(cat: TemplateCategory): string {
  const map: Record<TemplateCategory, string> = {
    MARKETING:      "cat-marketing",
    UTILITY:        "cat-utility",
    AUTHENTICATION: "cat-authentication"
  };
  return map[cat] ?? "cat-marketing";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Status pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: TemplateStatus }) {
  return (
    <span className={`tpl-status-pill ${getStatusClass(status)}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function CatPill({ cat }: { cat: TemplateCategory }) {
  return (
    <span className={`tpl-cat-pill ${getCatClass(cat)}`}>
      {cat}
    </span>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.8 12.8 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M4 5h12M8 5V3h4v2M6 5l1 11h6l1-11" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <rect x="3" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M4 6h12M4 10h12M4 14h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <span className={spinning ? "tpl-icon-btn is-spinning" : ""} style={{ display: "contents" }}>
      <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
        <path d="M4.5 10A5.5 5.5 0 1 0 10 4.5H7.5M7.5 4.5 5 2M7.5 4.5 5 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// ─── WhatsApp bubble mini preview ────────────────────────────────────────────

function BubblePreview({ template }: { template: MessageTemplate }) {
  const header = template.components.find((c) => c.type === "HEADER");
  const body = template.components.find((c) => c.type === "BODY");
  const buttonsComp = template.components.find((c) => c.type === "BUTTONS");
  const imageUrl = (header?.example as { header_handle?: string[] } | undefined)?.header_handle?.[0] ?? null;
  const bodyText = body?.text?.slice(0, 100) ?? "";

  return (
    <div className="tpl-bubble-wrap">
      <div className="tpl-bubble">
        {header?.format === "IMAGE" && (
          <div className="tpl-bubble-img">
            {imageUrl
              ? <img src={imageUrl} alt="" />
              : <span>🖼️ Image</span>}
          </div>
        )}
        {header?.format === "VIDEO" && <div className="tpl-bubble-img"><span>🎬 Video</span></div>}
        {header?.format === "DOCUMENT" && <div className="tpl-bubble-img"><span>📄 Document</span></div>}
        {header?.format === "TEXT" && header.text && (
          <div className="tpl-bubble-header">{header.text}</div>
        )}
        {bodyText && (
          <div className="tpl-bubble-body">
            {bodyText}{body?.text && body.text.length > 100 ? "…" : ""}
          </div>
        )}
        {buttonsComp?.buttons && buttonsComp.buttons.slice(0, 2).map((btn, i) => (
          <div key={i} className="tpl-bubble-btn">{btn.text}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Row dropdown ─────────────────────────────────────────────────────────────

interface RowMenuProps {
  onDuplicate: () => void;
  onTest: () => void;
  onCopyId: () => void;
  onConfigurations: () => void;
  onDelete: () => void;
}

function RowMenu({ onDuplicate, onTest, onCopyId, onConfigurations, onDelete }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !dropRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((v) => !v);
  };

  const act = (fn: () => void) => { fn(); setOpen(false); };

  return (
    <>
      <button ref={btnRef} type="button" className="tpl-more-btn" onClick={toggle} title="More options">···</button>
      {open && pos && createPortal(
        <div
          ref={dropRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999, minWidth: 200 }}
          className="tpl-dd-menu"
        >
          <button type="button" className="tpl-dd-item" onClick={() => act(onDuplicate)}>⧉ Duplicate template</button>
          <button type="button" className="tpl-dd-item" onClick={() => act(onTest)}>🧪 Test template</button>
          <button type="button" className="tpl-dd-item" onClick={() => act(onCopyId)}>⎘ Copy template ID</button>
          <button type="button" className="tpl-dd-item" onClick={() => act(onConfigurations)}>⚙ Configurations</button>
          <div className="tpl-dd-divider" />
          <button type="button" className="tpl-dd-item tpl-dd-item-danger" onClick={() => act(onDelete)}>
            <TrashIcon /> Delete
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Test template modal ──────────────────────────────────────────────────────

function TestTemplateModal({ template, token, onClose }: { template: MessageTemplate; token: string; onClose: () => void }) {
  const vars = [...new Set([...JSON.stringify(template.components).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[0]))];
  const [phone, setPhone] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const sendMutation = useSendTestTemplateMutation(token);

  const filled = template.components.map((c) => {
    if (c.type !== "BODY" || !c.text) return c;
    let text = c.text;
    for (const [k, v] of Object.entries(values)) text = text.replaceAll(k, v || k);
    return { ...c, text };
  });

  const handleSend = async () => {
    if (!phone.trim()) return;
    try {
      await sendMutation.mutateAsync({ templateId: template.id, to: phone.trim(), variableValues: values });
      setSent(true);
    } catch { /* shown via mutation error */ }
  };

  const phoneValid = phone.replace(/\D/g, "").length >= 8;

  return (
    <div className="tpl-modal-backdrop" onClick={onClose}>
      <div className="tpl-modal tpl-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-modal-head">
          <h3 className="tpl-modal-title">Test template — {template.name}</h3>
          <button type="button" className="tpl-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Phone row */}
        <div style={{ padding: "0.75rem 1.5rem", background: "#f8fafc", borderBottom: "1px solid #edf2f7", display: "flex", alignItems: "center", gap: "1rem", flexShrink: 0 }}>
          <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>
            Phone number <span style={{ color: "#be123c" }}>*</span>
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            style={{ flex: 1, maxWidth: 280, height: "2.2rem", padding: "0 0.75rem", border: "1px solid #e2eaf4", borderRadius: 8, font: "inherit", fontSize: "0.84rem", outline: "none" }}
          />
        </div>

        <div className="tpl-modal-body" style={{ display: "flex", gap: "1.5rem", padding: "1.25rem 1.5rem", minHeight: 300 }}>
          {/* Preview */}
          <div style={{ width: 240, flexShrink: 0 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#122033", marginBottom: "0.5rem" }}>{template.name}</div>
            <TemplatePreviewPanel components={filled} />
          </div>

          {/* Variables */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#122033", marginBottom: "0.75rem" }}>Variables</div>
            {vars.length === 0 ? (
              <p style={{ fontSize: "0.83rem", color: "#94a3b8" }}>This template has no variables.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {vars.map((v) => (
                  <label key={v} style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.82rem", fontWeight: 600, color: "#475569" }}>
                    {v}
                    <input
                      value={values[v] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                      placeholder={`Value for ${v}`}
                      style={{ height: "2.2rem", padding: "0 0.75rem", border: "1px solid #e2eaf4", borderRadius: 8, font: "inherit", fontSize: "0.84rem", outline: "none" }}
                    />
                  </label>
                ))}
              </div>
            )}
            {sent && <p style={{ marginTop: "1rem", fontSize: "0.83rem", fontWeight: 700, color: "#166534" }}>✓ Message sent successfully!</p>}
            {sendMutation.isError && <p style={{ marginTop: "1rem", fontSize: "0.83rem", color: "#be123c" }}>{(sendMutation.error as Error).message}</p>}
          </div>
        </div>

        <div className="tpl-modal-footer">
          <button type="button" className="tpl-modal-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="tpl-modal-submit"
            disabled={!phoneValid || sendMutation.isPending}
            onClick={() => void handleSend()}
          >
            {sendMutation.isPending ? "Sending…" : "Send Test"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Configurations modal ─────────────────────────────────────────────────────

function ConfigurationsModal({ template, onClose }: { template: MessageTemplate; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyId = () => {
    void navigator.clipboard.writeText(template.templateId ?? template.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const rows: Array<[string, React.ReactNode]> = [
    ["Template name", <code key="n" className="tpl-config-code">{template.name}</code>],
    ["Category", <CatPill key="c" cat={template.category} />],
    ["Language", template.language],
    ["Status", <StatusPill key="s" status={template.status} />],
    ["Quality score", template.qualityScore ?? "—"],
    ["Created", formatDate(template.createdAt)],
    ["Updated", formatDate(template.updatedAt)],
    ["Template ID", (
      <span key="id" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <code className="tpl-config-code">{template.templateId ?? template.id}</code>
        <button type="button" onClick={copyId} className="tpl-action-btn" style={{ height: "1.8rem", padding: "0 0.5rem", fontSize: "0.75rem" }}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </span>
    )]
  ];

  if (template.metaRejectionReason) {
    rows.push(["Rejection reason", <span key="r" style={{ color: "#be123c" }}>{template.metaRejectionReason}</span>]);
  }

  return (
    <div className="tpl-modal-backdrop" onClick={onClose}>
      <div className="tpl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-modal-head">
          <h3 className="tpl-modal-title">Template Details</h3>
          <button type="button" className="tpl-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="tpl-modal-body">
          <table className="tpl-config-table">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={String(label)}>
                  <td>{label}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tpl-modal-footer">
          <button type="button" className="tpl-modal-submit" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── View modal ───────────────────────────────────────────────────────────────

function ViewModal({ template, onClose }: { template: MessageTemplate; onClose: () => void }) {
  return (
    <div className="tpl-modal-backdrop" onClick={onClose}>
      <div className="tpl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-modal-head">
          <h3 className="tpl-modal-title">{template.name}</h3>
          <button type="button" className="tpl-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="tpl-modal-body">
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <StatusPill status={template.status} />
            <CatPill cat={template.category} />
          </div>
          <TemplatePreviewPanel components={template.components} />
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  template,
  onConfirm,
  onCancel,
  isPending
}: {
  template: MessageTemplate;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="tpl-modal-backdrop" onClick={onCancel}>
      <div className="tpl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-modal-head">
          <h3 className="tpl-modal-title">Delete template?</h3>
          <button type="button" className="tpl-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="tpl-modal-body">
          <p style={{ fontSize: "0.85rem", color: "#334155" }}>
            <strong>{template.name}</strong> will be permanently deleted from Meta first, then removed from your local database. This cannot be undone.
          </p>
        </div>
        <div className="tpl-modal-footer">
          <button type="button" className="tpl-modal-cancel" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="tpl-modal-submit tpl-modal-danger"
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function GridCard({
  template,
  onView,
  onDuplicate,
  onTest,
  onCopyId,
  onConfigurations,
  onDelete
}: {
  template: MessageTemplate;
  onView: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onCopyId: () => void;
  onConfigurations: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="tpl-grid-card" onClick={onView}>
      <div className="tpl-grid-card-head">
        <div className="tpl-grid-card-badges">
          <StatusPill status={template.status} />
          <CatPill cat={template.category} />
        </div>
        <div className="tpl-grid-card-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="tpl-action-btn" onClick={onView}>View</button>
          <RowMenu
            onDuplicate={onDuplicate}
            onTest={onTest}
            onCopyId={onCopyId}
            onConfigurations={onConfigurations}
            onDelete={onDelete}
          />
        </div>
      </div>
      <div className="tpl-grid-card-name">{template.name}</div>
      <div className="tpl-grid-preview">
        <BubblePreview template={template} />
      </div>
      <div className="tpl-grid-card-footer">
        <span>{template.language}</span>
        <span>{formatDate(template.createdAt)}</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  token: string;
  metaStatus?: MetaBusinessStatus | null;
}

export function TemplateListPage({ token, metaStatus }: Props) {
  const navigate = useNavigate();
  const availableConnections = metaStatus?.connections ?? [];
  const activeConnections = availableConnections.filter(isMetaConnectionActive);
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    () => metaStatus?.connection?.id ?? activeConnections[0]?.id ?? ""
  );
  const [showInactiveTemplates, setShowInactiveTemplates] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [activeTab, setActiveTab] = useState<"mine" | "library">("mine");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "All">("All");
  const [typeFilter, setTypeFilter] = useState<TemplateCategory | "All">("All");
  const [viewTemplate, setViewTemplate] = useState<MessageTemplate | null>(null);
  const [testTemplate, setTestTemplate] = useState<MessageTemplate | null>(null);
  const [configTemplate, setConfigTemplate] = useState<MessageTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedConnectionId((current) => {
      const connectionPool = showInactiveTemplates ? availableConnections : activeConnections;
      if (current && connectionPool.some((connection) => connection.id === current)) {
        return current;
      }
      return showInactiveTemplates
        ? (metaStatus?.connection?.id ?? activeConnections[0]?.id ?? availableConnections[0]?.id ?? "")
        : (metaStatus?.connection?.id ?? activeConnections[0]?.id ?? "");
    });
  }, [activeConnections, availableConnections, metaStatus?.connection?.id, showInactiveTemplates]);

  const selectedConnection = availableConnections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedConnectionActive = isMetaConnectionActive(selectedConnection);
  const templatesQuery = useTemplatesQuery(token);
  const syncMutation = useSyncTemplatesMutation(token);
  const deleteMutation = useDeleteTemplateMutation(token);

  const allTemplates = templatesQuery.data ?? [];

  const activeConnectionIds = useMemo(
    () => new Set(activeConnections.map((connection) => connection.id)),
    [activeConnections]
  );

  const filtered = useMemo(() => allTemplates.filter((t) => {
    if (selectedConnectionId && t.connectionId !== selectedConnectionId) return false;
    if (!showInactiveTemplates && !activeConnectionIds.has(t.connectionId)) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "All" && t.status !== statusFilter) return false;
    if (typeFilter !== "All" && t.category !== typeFilter) return false;
    return true;
  }), [activeConnectionIds, allTemplates, search, selectedConnectionId, showInactiveTemplates, statusFilter, typeFilter]);

  const hiddenInactiveTemplateCount = useMemo(
    () => allTemplates.filter((t) => {
      if (selectedConnectionId && t.connectionId !== selectedConnectionId) return false;
      return !activeConnectionIds.has(t.connectionId);
    }).length,
    [activeConnectionIds, allTemplates, selectedConnectionId]
  );

  // Stats
  const stats = useMemo(() => ({
    total:     allTemplates.length,
    approved:  allTemplates.filter((t) => t.status === "APPROVED").length,
    pending:   allTemplates.filter((t) => t.status === "PENDING").length,
    rejected:  allTemplates.filter((t) => t.status === "REJECTED").length,
    marketing: allTemplates.filter((t) => t.category === "MARKETING").length,
    utility:   allTemplates.filter((t) => t.category === "UTILITY").length
  }), [allTemplates]);

  function handleCopyId(template: MessageTemplate) {
    const id = template.templateId ?? template.id;
    void navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    });
  }

  function handleDuplicate(template: MessageTemplate) {
    navigate(`/dashboard/settings/templates/${template.id}`, { state: { prefill: template } });
  }

  const makeActions = (t: MessageTemplate) => ({
    onView:           () => setViewTemplate(t),
    onDuplicate:      () => handleDuplicate(t),
    onTest:           () => setTestTemplate(t),
    onCopyId:         () => handleCopyId(t),
    onConfigurations: () => setConfigTemplate(t),
    onDelete:         () => setDeleteTarget(t)
  });

  const isSyncing = syncMutation.isPending || templatesQuery.isFetching;

  return (
    <div className="tpl-page">
      {/* ── Page header ── */}
      <div className="tpl-page-header">
        <h1 className="tpl-page-title">Templates</h1>
        <div className="tpl-header-actions">
          <button
            type="button"
            className="tpl-icon-btn"
            title="Sync from Meta"
            disabled={isSyncing}
            onClick={() => syncMutation.mutate()}
          >
            <RefreshIcon spinning={isSyncing} />
          </button>
          <button type="button" className="tpl-new-btn" onClick={() => { setSuccessMsg(null); navigate("/dashboard/settings/templates/new"); }}>
            <PlusIcon /> New Template
          </button>
        </div>
      </div>

      {/* ── Overview stats card ── */}
      <div className="tpl-overview-card">
        <div className="tpl-overview-head">
          <span className="tpl-overview-title">Overview</span>
        </div>
        <div className="tpl-overview-stats">
          <div className="tpl-stat-cell">
            <div className="tpl-stat-label">Total</div>
            <div className="tpl-stat-value">{stats.total}</div>
          </div>
          <div className="tpl-stat-cell">
            <div className="tpl-stat-label">Approved</div>
            <div className="tpl-stat-value is-green">{stats.approved}</div>
          </div>
          <div className="tpl-stat-cell">
            <div className="tpl-stat-label">Pending</div>
            <div className="tpl-stat-value is-blue">{stats.pending}</div>
          </div>
          <div className="tpl-stat-cell">
            <div className="tpl-stat-label">Rejected</div>
            <div className="tpl-stat-value is-red">{stats.rejected}</div>
          </div>
          <div className="tpl-stat-cell">
            <div className="tpl-stat-label">Marketing</div>
            <div className="tpl-stat-value is-blue">{stats.marketing}</div>
          </div>
          <div className="tpl-stat-cell">
            <div className="tpl-stat-label">Utility</div>
            <div className="tpl-stat-value is-green">{stats.utility}</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tpl-tabs-row">
        <button type="button" className={`tpl-tab${activeTab === "mine" ? " is-active" : ""}`} onClick={() => setActiveTab("mine")}>
          My Templates
        </button>
        <button type="button" className={`tpl-tab${activeTab === "library" ? " is-active" : ""}`} onClick={() => setActiveTab("library")}>
          Library
        </button>
      </div>

      {/* ── Table card ── */}
      <div className="tpl-table-card">
        {activeTab === "library" ? (
          <div className="tpl-coming-soon">
            Template library coming soon — browse pre-built templates to get started quickly.
          </div>
        ) : (
          <>
            {/* Approval delay notice */}
            <div className="tpl-banner is-warning">
              <strong>⏳ Template Approval Delays</strong>
              WhatsApp Template approvals from Meta are currently taking longer than usual. Plan submissions in advance for upcoming campaigns.
            </div>

            {/* Banners */}
            {successMsg && (
              <div className="tpl-banner is-success">
                ✓ {successMsg}
                <button type="button" className="tpl-banner-dismiss" onClick={() => setSuccessMsg(null)}>×</button>
              </div>
            )}
            {copiedId && (
              <div className="tpl-banner is-success">✓ Template ID copied to clipboard</div>
            )}
            {metaStatus && !metaStatus.connected && (
              <div className="tpl-banner is-warning">
                ⚠️ No Meta WhatsApp Business connection found. Connect your account in <strong>Settings → API Channel</strong>.
              </div>
            )}
            {showInactiveTemplates && selectedConnection && !selectedConnectionActive ? (
              <div className="tpl-banner is-warning">
                You are viewing templates from an inactive connection. You can still duplicate them to a new active channel, but you cannot use the old channel for sending or new submissions.
              </div>
            ) : null}
            {syncMutation.isError && (
              <div className="tpl-banner is-error">
                Sync failed: {(syncMutation.error as Error).message}
              </div>
            )}

            {/* Toolbar */}
            <div className="tpl-toolbar">
              <div className="tpl-toolbar-left">
                {/* View toggle */}
                <div className="tpl-view-toggle">
                  <button type="button" className={`tpl-view-btn${viewMode === "list" ? " is-active" : ""}`} onClick={() => setViewMode("list")} title="List view">
                    <ListIcon />
                  </button>
                  <button type="button" className={`tpl-view-btn${viewMode === "grid" ? " is-active" : ""}`} onClick={() => setViewMode("grid")} title="Grid view">
                    <GridIcon />
                  </button>
                </div>

                {/* Search */}
                <div className="tpl-search-wrap">
                  <span className="tpl-search-icon"><SearchIcon /></span>
                  <input
                    type="search"
                    className="tpl-search-input"
                    placeholder="Search templates…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {hiddenInactiveTemplateCount > 0 ? (
                  <button
                    type="button"
                    className={`tpl-toolbar-btn${showInactiveTemplates ? " is-active" : ""}`}
                    onClick={() => setShowInactiveTemplates((current) => !current)}
                  >
                    {showInactiveTemplates
                      ? `Hide inactive templates (${hiddenInactiveTemplateCount})`
                      : `Show inactive templates (${hiddenInactiveTemplateCount})`}
                  </button>
                ) : null}
              </div>

              <div className="tpl-toolbar-right">
                <div style={{ minWidth: "260px" }}>
                  <MetaConnectionSelector
                    connections={availableConnections}
                    value={selectedConnectionId}
                    onChange={setSelectedConnectionId}
                    label="Connection"
                    allowEmpty
                    emptyLabel={showInactiveTemplates ? "All API connections" : "All active API connections"}
                    activeOnly={!showInactiveTemplates}
                  />
                </div>
                <select className="tpl-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TemplateStatus | "All")}>
                  <option value="All">Status: All</option>
                  <option value="APPROVED">Approved</option>
                  <option value="PENDING">Pending</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="PAUSED">Paused</option>
                  <option value="DISABLED">Disabled</option>
                </select>
                <select className="tpl-filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TemplateCategory | "All")}>
                  <option value="All">Type: All</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>
            </div>

            {/* Content */}
            {templatesQuery.isLoading ? (
              <div className="tpl-loading">Loading templates…</div>
            ) : filtered.length === 0 && allTemplates.length > 0 && !showInactiveTemplates && hiddenInactiveTemplateCount > 0 ? (
              <div className="tpl-empty">
                <div className="tpl-empty-title">Only inactive templates are available</div>
                <p className="tpl-empty-text">Old templates from deleted or paused channels are hidden by default. Show inactive templates if you want to duplicate one for a new active channel.</p>
                <button
                  type="button"
                  className="tpl-toolbar-btn"
                  onClick={() => setShowInactiveTemplates(true)}
                >
                  Show inactive templates ({hiddenInactiveTemplateCount})
                </button>
              </div>
            ) : allTemplates.length === 0 ? (
              <div className="tpl-empty">
                <div className="tpl-empty-icon">📋</div>
                <div className="tpl-empty-title">No templates yet</div>
                <p className="tpl-empty-text">Create your first WhatsApp template to start broadcasting.</p>
                <button type="button" className="tpl-new-btn" onClick={() => navigate("/dashboard/settings/templates/new")}>
                  <PlusIcon /> Create Template
                </button>
              </div>
            ) : viewMode === "grid" ? (
              /* Grid view */
              <div className="tpl-grid">
                <button type="button" className="tpl-grid-new" onClick={() => navigate("/dashboard/settings/templates/new")}>
                  <div className="tpl-grid-new-icon">+</div>
                  <div className="tpl-grid-new-label">Create new template</div>
                  <span className="tpl-grid-new-link" onClick={(e) => { e.stopPropagation(); setActiveTab("library"); }}>
                    Browse library →
                  </span>
                </button>
                {filtered.map((t) => (
                  <GridCard key={t.id} template={t} {...makeActions(t)} />
                ))}
                {filtered.length === 0 && (
                  <div style={{ gridColumn: "1/-1" }}>
                    <div className="tpl-empty">
                      <div className="tpl-empty-title">No templates match your filters</div>
                      <button type="button" className="tpl-toolbar-btn" onClick={() => { setSearch(""); setStatusFilter("All"); setTypeFilter("All"); }}>Clear filters</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* List view */
              <div className="tpl-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Template Name</th>
                      <th>Category</th>
                      <th>Language</th>
                      <th>Status</th>
                      <th>Quality</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="tpl-empty">
                            <div className="tpl-empty-title">No templates match your filters</div>
                            <button type="button" className="tpl-toolbar-btn" onClick={() => { setSearch(""); setStatusFilter("All"); setTypeFilter("All"); }}>Clear filters</button>
                          </div>
                        </td>
                      </tr>
                    ) : filtered.map((t) => {
                      const body = t.components.find((c) => c.type === "BODY");
                      const preview = body?.text?.slice(0, 65) ?? "";
                      return (
                        <tr key={t.id} onClick={() => setViewTemplate(t)}>
                          <td>
                            <div className="tpl-name-main">{t.name}</div>
                            {preview && <div className="tpl-name-preview">{preview}{body?.text && body.text.length > 65 ? "…" : ""}</div>}
                          </td>
                          <td><CatPill cat={t.category} /></td>
                          <td style={{ fontSize: "0.82rem", color: "#5f6f86" }}>{t.language}</td>
                          <td><StatusPill status={t.status} /></td>
                          <td style={{ fontSize: "0.82rem", color: "#5f6f86" }}>{t.qualityScore ?? "—"}</td>
                          <td style={{ fontSize: "0.82rem", color: "#5f6f86", whiteSpace: "nowrap" }}>{formatDate(t.createdAt)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="tpl-action-cell">
                              <button type="button" className="tpl-action-btn" onClick={() => setViewTemplate(t)}>View</button>
                              <RowMenu {...makeActions(t)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {viewTemplate   && <ViewModal template={viewTemplate} onClose={() => setViewTemplate(null)} />}
      {testTemplate   && <TestTemplateModal template={testTemplate} token={token} onClose={() => setTestTemplate(null)} />}
      {configTemplate && <ConfigurationsModal template={configTemplate} onClose={() => setConfigTemplate(null)} />}
      {deleteTarget   && (
        <DeleteConfirmModal
          template={deleteTarget}
          isPending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
