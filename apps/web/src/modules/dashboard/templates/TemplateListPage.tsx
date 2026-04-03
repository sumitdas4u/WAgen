import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { MessageTemplate, MetaBusinessStatus, TemplateCategory, TemplateStatus } from "../../../lib/api";
import { TemplatePreviewPanel } from "./TemplatePreviewPanel";
import { TemplateStatusBadge } from "./TemplateStatusBadge";
import { useDeleteTemplateMutation, useSendTestTemplateMutation, useSyncTemplatesMutation, useTemplatesQuery } from "./queries";

// ─── Mini card preview ────────────────────────────────────────────────────────

function MiniPreview({ template }: { template: MessageTemplate }) {
  const header = template.components.find((c) => c.type === "HEADER");
  const body = template.components.find((c) => c.type === "BODY");
  const buttonsComp = template.components.find((c) => c.type === "BUTTONS");
  const imageUrl =
    (header?.example as { header_handle?: string[] } | undefined)?.header_handle?.[0] ?? null;

  const bodyPreview = body?.text?.slice(0, 100) ?? "";

  return (
    <div
      style={{
        background: "#e5ddd5",
        borderRadius: "6px",
        padding: "8px",
        flex: 1,
        overflow: "hidden",
        minHeight: "120px"
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "0 6px 6px 6px",
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
          fontSize: "11px"
        }}
      >
        {header?.format === "IMAGE" && (
          <div
            style={{
              height: "80px",
              background: imageUrl ? "transparent" : "#ccc",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ color: "#666", fontSize: "12px" }}>🖼️ Image</span>
            )}
          </div>
        )}
        {header?.format === "VIDEO" && (
          <div style={{ height: "60px", background: "#d1d5db", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#666", fontSize: "12px" }}>🎬 Video</span>
          </div>
        )}
        {header?.format === "DOCUMENT" && (
          <div style={{ height: "50px", background: "#d1d5db", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#666", fontSize: "12px" }}>📄 Document</span>
          </div>
        )}
        {header?.format === "TEXT" && header.text && (
          <div style={{ padding: "6px 8px 2px", fontWeight: 700, color: "#111" }}>{header.text}</div>
        )}
        {bodyPreview && (
          <div style={{ padding: "4px 8px", color: "#303030", lineHeight: 1.4 }}>
            {bodyPreview}{body?.text && body.text.length > 100 ? "…" : ""}
          </div>
        )}
        {buttonsComp?.buttons && buttonsComp.buttons.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            {buttonsComp.buttons.slice(0, 2).map((btn, i) => (
              <div
                key={i}
                style={{
                  padding: "5px 8px",
                  borderTop: i > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined,
                  color: "#128c7e",
                  fontWeight: 600,
                  textAlign: "center"
                }}
              >
                {btn.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Options menu ─────────────────────────────────────────────────────────────

interface OptionsMenuProps {
  onDuplicate: () => void;
  onTest: () => void;
  onCopyId: () => void;
  onConfigurations: () => void;
  onDelete: () => void;
}

function OptionsMenu({ onDuplicate, onTest, onCopyId, onConfigurations, onDelete }: OptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideBtn = btnRef.current?.contains(target);
      const insideDrop = dropRef.current?.contains(target);
      if (!insideBtn && !insideDrop) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleToggle(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  }

  const item = (icon: string, label: string, action: () => void, danger = false) => (
    <button
      key={label}
      type="button"
      onClick={() => { action(); setOpen(false); }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        padding: "9px 14px",
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: "13px",
        fontFamily: "inherit",
        color: danger ? "#dc2626" : "#222",
        textAlign: "left"
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = danger ? "#fef2f2" : "#f5f5f5"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
    >
      <span style={{ width: "16px", textAlign: "center" }}>{icon}</span>
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        style={{
          background: "none",
          border: "1px solid #e0e0e0",
          borderRadius: "6px",
          cursor: "pointer",
          padding: "3px 8px",
          fontSize: "16px",
          color: "#555",
          lineHeight: 1
        }}
        title="More options"
      >
        ⋮
      </button>
      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            right: dropPos.right,
            background: "#fff",
            border: "1.5px solid #e0e0e0",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 9999,
            minWidth: "190px",
            overflow: "hidden"
          }}
        >
          {item("⧉", "Duplicate template", onDuplicate)}
          {item("🧪", "Test template", onTest)}
          {item("⎘", "Copy template ID", onCopyId)}
          {item("⚙", "Configurations", onConfigurations)}
          <div style={{ borderTop: "1px solid #f0f0f0", margin: "4px 0" }} />
          {item("🗑", "Delete", onDelete, true)}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Test template modal ──────────────────────────────────────────────────────

function TestTemplateModal({
  template,
  token,
  onClose
}: {
  template: MessageTemplate;
  token: string;
  onClose: () => void;
}) {
  const vars = [...new Set([...JSON.stringify(template.components).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[0]))];
  const [phone, setPhone] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"variables" | "media" | "advanced">("variables");
  const [sent, setSent] = useState(false);

  const sendMutation = useSendTestTemplateMutation(token);

  const filled = template.components.map((c) => {
    if (c.type !== "BODY" || !c.text) return c;
    let text = c.text;
    for (const [k, v] of Object.entries(values)) text = text.replaceAll(k, v || k);
    return { ...c, text };
  });

  async function handleSend() {
    if (!phone.trim()) return;
    try {
      await sendMutation.mutateAsync({
        templateId: template.id,
        to: phone.trim(),
        variableValues: values
      });
      setSent(true);
    } catch {
      // error shown via sendMutation.error
    }
  }

  const phoneValid = phone.replace(/\D/g, "").length >= 8;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "760px", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "17px" }}>Test template</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "22px", color: "#888", lineHeight: 1 }}>×</button>
        </div>

        {/* Phone input row */}
        <div style={{ padding: "14px 24px", background: "#f6f8fb", borderBottom: "1px solid #eef0f3", display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }}>
          <label style={{ fontWeight: 600, fontSize: "13px", whiteSpace: "nowrap" }}>
            Enter your phone number <span style={{ color: "#dc2626" }}>*</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "0", border: "1.5px solid #d1d5db", borderRadius: "8px", overflow: "hidden", background: "#fff", maxWidth: "280px", flex: 1 }}>
            <div style={{ padding: "9px 12px", borderRight: "1px solid #e5e7eb", fontSize: "18px", lineHeight: 1, userSelect: "none" }}>🇮🇳</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98047 35837"
              style={{ flex: 1, border: "none", outline: "none", padding: "9px 12px", fontSize: "14px", fontFamily: "inherit" }}
            />
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          {/* Left: preview */}
          <div style={{ width: "300px", flexShrink: 0, borderRight: "1px solid #f0f0f0", padding: "16px", overflowY: "auto" }}>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "#111" }}>{template.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                <TemplateStatusBadge status={template.status} />
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#1d4ed8", background: "#eff6ff", padding: "2px 6px", borderRadius: "4px" }}>{template.category}</span>
              </div>
            </div>
            <TemplatePreviewPanel components={filled} />
          </div>

          {/* Right: tabs */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1.5px solid #e5e7eb", padding: "0 24px", flexShrink: 0 }}>
              {(["variables", "media", "advanced"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "12px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: activeTab === tab ? "2px solid #1a56db" : "2px solid transparent",
                    marginBottom: "-1.5px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: activeTab === tab ? 600 : 400,
                    color: activeTab === tab ? "#1a56db" : "#555",
                    fontFamily: "inherit",
                    textTransform: "capitalize"
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              {activeTab === "variables" && (
                vars.length === 0 ? (
                  <div style={{ color: "#888", fontSize: "14px", marginTop: "4px" }}>
                    This message template doesn&apos;t have variables
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {vars.map((v) => (
                      <div key={v}>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#444", marginBottom: "5px" }}>
                          {v}
                        </label>
                        <input
                          value={values[v] ?? ""}
                          onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                          placeholder={`Value for ${v}`}
                          style={{ width: "100%", border: "1.5px solid #e0e0e0", borderRadius: "8px", padding: "8px 12px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }}
                        />
                      </div>
                    ))}
                  </div>
                )
              )}

              {activeTab === "media" && (
                <div style={{ color: "#888", fontSize: "14px" }}>
                  Media overrides are not supported for test sends. The template&apos;s original media will be used.
                </div>
              )}

              {activeTab === "advanced" && (
                <div style={{ color: "#888", fontSize: "14px" }}>
                  Advanced options coming soon.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          {/* Error / success */}
          <div style={{ flex: 1 }}>
            {sent && (
              <div style={{ color: "#166534", fontSize: "13px", fontWeight: 600 }}>
                ✓ Message sent successfully!
              </div>
            )}
            {sendMutation.isError && (
              <div style={{ color: "#dc2626", fontSize: "13px" }}>
                {(sendMutation.error as Error).message}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "9px 20px", borderRadius: "8px", border: "1.5px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: "14px", fontFamily: "inherit" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!phoneValid || sendMutation.isPending}
              style={{
                padding: "9px 28px",
                borderRadius: "8px",
                border: "none",
                background: phoneValid && !sendMutation.isPending ? "#1a56db" : "#93c5fd",
                color: "#fff",
                fontWeight: 700,
                fontSize: "14px",
                cursor: phoneValid && !sendMutation.isPending ? "pointer" : "not-allowed",
                fontFamily: "inherit"
              }}
            >
              {sendMutation.isPending ? "Sending…" : "Test"}
            </button>
          </div>
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
    ["Template name", <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}>{template.name}</code>],
    ["Category", template.category],
    ["Language", template.language],
    ["Status", <TemplateStatusBadge status={template.status} />],
    ["Quality score", template.qualityScore ?? "—"],
    ["Created", new Date(template.createdAt).toLocaleDateString()],
    ["Updated", new Date(template.updatedAt).toLocaleDateString()],
    ["Template ID", (
      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}>
          {template.templateId ?? template.id}
        </code>
        <button
          type="button"
          onClick={copyId}
          style={{ padding: "2px 8px", borderRadius: "4px", border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: "11px", color: "#555" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </span>
    )]
  ];

  if (template.metaRejectionReason) {
    rows.push(["Rejection reason", <span style={{ color: "#dc2626" }}>{template.metaRejectionReason}</span>]);
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "520px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>Template configurations</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#888" }}>×</button>
        </div>
        <div style={{ padding: "24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={String(label)} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "10px 0", fontSize: "13px", color: "#666", width: "40%", fontWeight: 600 }}>{label}</td>
                  <td style={{ padding: "10px 0", fontSize: "13px", color: "#111" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<TemplateCategory, { bg: string; color: string }> = {
  MARKETING:      { bg: "#eff6ff", color: "#1d4ed8" },
  UTILITY:        { bg: "#f0fdf4", color: "#166534" },
  AUTHENTICATION: { bg: "#fdf4ff", color: "#7e22ce" }
};

interface GridCardProps {
  template: MessageTemplate;
  onView: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onCopyId: () => void;
  onConfigurations: () => void;
  onDelete: () => void;
}

function GridCard({ template, onView, onDuplicate, onTest, onCopyId, onConfigurations, onDelete }: GridCardProps) {
  const cat = CATEGORY_COLOR[template.category] ?? CATEGORY_COLOR.MARKETING;
  return (
    <div
      style={{
        background: "#fff",
        border: "1.5px solid #e5e7eb",
        borderRadius: "12px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 0
      }}
    >
      {/* Card header */}
      <div style={{ padding: "12px 12px 8px", display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
            <TemplateStatusBadge status={template.status} />
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: "999px",
                background: cat.bg,
                color: cat.color,
                whiteSpace: "nowrap"
              }}
            >
              {template.category}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <button
              type="button"
              onClick={onView}
              style={{
                padding: "3px 10px",
                borderRadius: "6px",
                border: "1px solid #e0e0e0",
                background: "#fff",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                color: "#333"
              }}
            >
              View
            </button>
            <OptionsMenu
              onDuplicate={onDuplicate}
              onTest={onTest}
              onCopyId={onCopyId}
              onConfigurations={onConfigurations}
              onDelete={onDelete}
            />
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: "14px", color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {template.name}
        </div>
      </div>

      {/* Mini preview */}
      <div style={{ padding: "0 12px", flex: 1, display: "flex" }}>
        <MiniPreview template={template} />
      </div>

      {/* Card footer */}
      <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f0f0f0", marginTop: "8px" }}>
        <span style={{ fontSize: "12px", color: "#888" }}>{template.language}</span>
        <span style={{ fontSize: "12px", color: "#888" }}>{new Date(template.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
      </div>
    </div>
  );
}

// ─── List row ─────────────────────────────────────────────────────────────────

interface ListRowProps {
  template: MessageTemplate;
  onView: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onCopyId: () => void;
  onConfigurations: () => void;
  onDelete: () => void;
}

function ListRow({ template, onView, onDuplicate, onTest, onCopyId, onConfigurations, onDelete }: ListRowProps) {
  const cat = CATEGORY_COLOR[template.category] ?? CATEGORY_COLOR.MARKETING;
  const body = template.components.find((c) => c.type === "BODY");
  const preview = body?.text?.slice(0, 70) ?? "—";
  return (
    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        <div style={{ fontWeight: 600, fontSize: "14px" }}>{template.name}</div>
        <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>
          {preview}{body?.text && body.text.length > 70 ? "…" : ""}
        </div>
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, padding: "3px 8px", borderRadius: "6px", background: cat.bg, color: cat.color }}>
          {template.category}
        </span>
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", fontSize: "13px", color: "#555" }}>{template.language}</td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        <TemplateStatusBadge status={template.status} />
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", fontSize: "12px", color: "#888" }}>
        {template.qualityScore ?? "—"}
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle", fontSize: "12px", color: "#888", whiteSpace: "nowrap" }}>
        {new Date(template.createdAt).toLocaleDateString()}
      </td>
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button
            type="button"
            onClick={onView}
            style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#333" }}
          >
            View
          </button>
          <OptionsMenu
            onDuplicate={onDuplicate}
            onTest={onTest}
            onCopyId={onCopyId}
            onConfigurations={onConfigurations}
            onDelete={onDelete}
          />
        </div>
      </td>
    </tr>
  );
}

// ─── View modal ───────────────────────────────────────────────────────────────

function ViewModal({ template, onClose }: { template: MessageTemplate; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "400px", boxShadow: "0 24px 64px rgba(0,0,0,0.2)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: "15px" }}>{template.name}</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#888" }}>×</button>
        </div>
        <div style={{ padding: "16px" }}>
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
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
      onClick={onCancel}
    >
      <div
        style={{ background: "#fff", borderRadius: "16px", width: "100%", maxWidth: "400px", padding: "28px", boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "8px" }}>Delete template?</div>
        <div style={{ fontSize: "13px", color: "#555", marginBottom: "24px" }}>
          <strong>{template.name}</strong> will be permanently deleted from Meta. This cannot be undone.
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={{ padding: "8px 18px", borderRadius: "8px", border: "1.5px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: "13px" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", cursor: isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 700, opacity: isPending ? 0.6 : 1 }}
          >
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
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
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [activeTab, setActiveTab] = useState<"mine" | "library">("mine");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "All">("All");
  const [typeFilter, setTypeFilter] = useState<TemplateCategory | "All">("All");
  const [viewTemplate, setViewTemplate] = useState<MessageTemplate | null>(null);
  const [testTemplate, setTestTemplate] = useState<MessageTemplate | null>(null);
  const [configTemplate, setConfigTemplate] = useState<MessageTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageTemplate | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const templatesQuery = useTemplatesQuery(token);
  const syncMutation = useSyncTemplatesMutation(token);
  const deleteMutation = useDeleteTemplateMutation(token);

  const allTemplates = templatesQuery.data ?? [];

  const filtered = allTemplates.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "All" && t.status !== statusFilter) return false;
    if (typeFilter !== "All" && t.category !== typeFilter) return false;
    return true;
  });

  function handleCopyId(template: MessageTemplate) {
    const id = template.templateId ?? template.id;
    void navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function handleDuplicate(template: MessageTemplate) {
    navigate(`/dashboard/templates/${template.id}`, {
      state: { prefill: template }
    });
  }

  const makeActions = (t: MessageTemplate) => ({
    onView: () => setViewTemplate(t),
    onDuplicate: () => handleDuplicate(t),
    onTest: () => setTestTemplate(t),
    onCopyId: () => handleCopyId(t),
    onConfigurations: () => setConfigTemplate(t),
    onDelete: () => setDeleteTarget(t)
  });

  const isSyncing = syncMutation.isPending || templatesQuery.isFetching;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      <style>{`
        @keyframes tmpl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .tmpl-sync-spin { animation: tmpl-spin 0.7s linear infinite; display: inline-block; }
      `}</style>

      {/* ── Page title row ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>WhatsApp Templates</h2>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={isSyncing}
            style={{ padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e0e0e0", background: "#fff", cursor: isSyncing ? "not-allowed" : "pointer", color: "#555", fontSize: "16px", lineHeight: 1, opacity: isSyncing ? 0.7 : 1 }}
            title="Sync from Meta"
          >
            <span className={isSyncing ? "tmpl-sync-spin" : ""}>↻</span>
          </button>
          <button
            type="button"
            onClick={() => { setSuccessMsg(null); navigate("/dashboard/templates/new"); }}
            style={{ padding: "9px 16px", borderRadius: "8px", background: "#128c7e", color: "#fff", border: "none", fontWeight: 700, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          >
            + Create New Template
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: "0", borderBottom: "2px solid #f0f0f0", marginBottom: "16px" }}>
        {(["mine", "library"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "10px 20px",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #128c7e" : "2px solid transparent",
              marginBottom: "-2px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: activeTab === tab ? 700 : 400,
              color: activeTab === tab ? "#128c7e" : "#666"
            }}
          >
            {tab === "mine" ? "My Templates" : "Library"}
          </button>
        ))}
      </div>

      {/* ── Approval delay banner ── */}
      {activeTab === "mine" && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            fontSize: "13px",
            color: "#92400e",
            marginBottom: "16px",
            display: "flex",
            gap: "10px",
            alignItems: "flex-start"
          }}
        >
          <span>ⓘ</span>
          <div>
            <strong>Template Approval Delays</strong>
            <div style={{ marginTop: "2px" }}>
              WhatsApp Template approvals from Meta are currently taking longer than usual. Please plan your template submissions in advance for upcoming campaigns.
            </div>
          </div>
        </div>
      )}

      {activeTab === "library" ? (
        <div style={{ padding: "60px 24px", textAlign: "center", color: "#aaa", fontSize: "14px" }}>
          Template library coming soon — browse pre-built templates to get started quickly.
        </div>
      ) : (
        <>
          {/* ── Filter bar ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
            {/* List / Grid toggle */}
            <div style={{ display: "flex", border: "1.5px solid #e0e0e0", borderRadius: "8px", overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="List view"
                style={{ padding: "6px 12px", background: viewMode === "list" ? "#f3f4f6" : "#fff", border: "none", cursor: "pointer", fontSize: "13px", color: viewMode === "list" ? "#111" : "#888", fontWeight: viewMode === "list" ? 700 : 400 }}
              >
                ☰ List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Grid view"
                style={{ padding: "6px 12px", background: viewMode === "grid" ? "#f3f4f6" : "#fff", border: "none", borderLeft: "1px solid #e0e0e0", cursor: "pointer", fontSize: "13px", color: viewMode === "grid" ? "#111" : "#888", fontWeight: viewMode === "grid" ? 700 : 400 }}
              >
                ⊞ Grid
              </button>
            </div>

            {/* Search */}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates"
              style={{ padding: "7px 12px", borderRadius: "8px", border: "1.5px solid #e0e0e0", fontSize: "13px", minWidth: "180px" }}
            />

            <div style={{ marginLeft: "auto", display: "flex", gap: "10px", alignItems: "center" }}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TemplateStatus | "All")}
                style={{ padding: "7px 12px", borderRadius: "8px", border: "1.5px solid #e0e0e0", fontSize: "13px" }}
              >
                <option value="All">Status: All</option>
                <option value="APPROVED">Approved</option>
                <option value="PENDING">Pending</option>
                <option value="REJECTED">Rejected</option>
                <option value="PAUSED">Paused</option>
                <option value="DISABLED">Disabled</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TemplateCategory | "All")}
                style={{ padding: "7px 12px", borderRadius: "8px", border: "1.5px solid #e0e0e0", fontSize: "13px" }}
              >
                <option value="All">Type: All</option>
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utility</option>
                <option value="AUTHENTICATION">Authentication</option>
              </select>
            </div>
          </div>

          {/* ── Success toast ── */}
          {successMsg && (
            <div style={{ padding: "12px 16px", borderRadius: "8px", background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              ✓ {successMsg}
              <button type="button" onClick={() => setSuccessMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#166534", fontSize: "16px" }}>×</button>
            </div>
          )}

          {/* ── Copied toast ── */}
          {copiedId && (
            <div style={{ padding: "10px 16px", borderRadius: "8px", background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", fontSize: "13px", marginBottom: "12px" }}>
              ✓ Template ID copied to clipboard
            </div>
          )}

          {/* ── No Meta warning ── */}
          {metaStatus && !metaStatus.connected && (
            <div style={{ padding: "12px 16px", borderRadius: "8px", background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", fontSize: "13px", marginBottom: "12px" }}>
              ⚠️ No Meta WhatsApp Business connection found. Connect your account in <strong>Settings → API Channel</strong>.
            </div>
          )}

          {/* ── Loading ── */}
          {templatesQuery.isLoading && (
            <div style={{ padding: "40px", textAlign: "center", color: "#aaa", fontSize: "14px" }}>Loading templates…</div>
          )}

          {/* ── Empty state ── */}
          {!templatesQuery.isLoading && allTemplates.length === 0 && (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>📋</div>
              <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>No templates yet</div>
              <div style={{ color: "#666", fontSize: "14px", marginBottom: "20px" }}>Create your first WhatsApp template to start broadcasting.</div>
              <button type="button" onClick={() => navigate("/dashboard/templates/new")} style={{ padding: "10px 24px", borderRadius: "8px", background: "#128c7e", color: "#fff", border: "none", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>
                + Create Template
              </button>
            </div>
          )}

          {/* ── GRID view ── */}
          {!templatesQuery.isLoading && allTemplates.length > 0 && viewMode === "grid" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: "16px"
              }}
            >
              {/* Create new card */}
              <div
                style={{
                  background: "#f9fafb",
                  border: "1.5px dashed #d1d5db",
                  borderRadius: "12px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "12px",
                  minHeight: "260px",
                  cursor: "pointer",
                  padding: "24px"
                }}
                onClick={() => navigate("/dashboard/templates/new")}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    background: "#128c7e",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "28px",
                    fontWeight: 300
                  }}
                >
                  +
                </div>
                <div style={{ fontWeight: 700, fontSize: "15px", color: "#111", textAlign: "center" }}>Create new template</div>
                <div
                  style={{ fontSize: "12px", color: "#128c7e", textDecoration: "underline", cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setActiveTab("library"); }}
                >
                  Create new from our library →
                </div>
              </div>

              {filtered.map((t) => (
                <GridCard key={t.id} template={t} {...makeActions(t)} />
              ))}
            </div>
          )}

          {/* ── LIST view ── */}
          {!templatesQuery.isLoading && allTemplates.length > 0 && viewMode === "list" && (
            <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    {["Template Name", "Category", "Language", "Status", "Quality", "Created", "Actions"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 16px",
                          textAlign: "left",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #e0e0e0"
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <ListRow key={t.id} template={t} {...makeActions(t)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Sync error ── */}
          {syncMutation.isError && (
            <div style={{ padding: "10px 14px", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: "13px", marginTop: "12px" }}>
              Sync failed: {(syncMutation.error as Error).message}
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {viewTemplate && <ViewModal template={viewTemplate} onClose={() => setViewTemplate(null)} />}
      {testTemplate && <TestTemplateModal template={testTemplate} token={token} onClose={() => setTestTemplate(null)} />}
      {configTemplate && <ConfigurationsModal template={configTemplate} onClose={() => setConfigTemplate(null)} />}
      {deleteTarget && (
        <DeleteConfirmModal
          template={deleteTarget}
          isPending={deleteMutation.isPending}
          onConfirm={() => {
            deleteMutation.mutate(deleteTarget.id, {
              onSuccess: () => setDeleteTarget(null)
            });
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
