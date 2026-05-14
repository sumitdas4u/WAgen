import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReminderConfig, ReminderConfigWriteInput, MessageTemplate, TemplateVarBinding } from "../../../../lib/api";
import { fetchTemplates, fetchPublishedFlows, listContactFields } from "../../../../lib/api";
import { TemplatePreviewPanel } from "../../templates/TemplatePreviewPanel";
import { useAuth } from "../../../../lib/auth-context";

interface ConditionDraft {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt";
  value: string;
}

interface Props {
  config: ReminderConfig;
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

const CORE_CONTACT_FIELDS = [
  { key: "display_name", label: "Display Name" },
  { key: "phone_number", label: "Phone Number" },
  { key: "email", label: "Email" },
  { key: "contact_type", label: "Contact Type" },
  { key: "tags", label: "Tags" }
];

const OPERATORS: Array<{ value: ConditionDraft["operator"]; label: string }> = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" }
];

function extractPlaceholders(template: MessageTemplate | null): string[] {
  if (!template) return [];
  const matches = JSON.stringify(template.components).matchAll(/\{\{(\d+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))].sort((a, b) => Number(a) - Number(b));
}

function StepCircle({ n, done }: { n: number; done?: boolean }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
      background: done ? "#22c55e" : "#2563eb", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "0.75rem", fontWeight: 800
    }}>{n}</div>
  );
}

export function CaptureSettingsForm({ config, onSave, isSaving }: Props) {
  const { token } = useAuth();

  /* ── Data ── */
  const templatesQuery = useQuery({
    queryKey: ["templates-all"],
    queryFn: () => fetchTemplates(token ?? "").then((r) => r.templates.filter((t) => t.status === "APPROVED")),
    staleTime: 60_000,
    enabled: !!token
  });
  const flowsQuery = useQuery({
    queryKey: ["flows-published"],
    queryFn: () => fetchPublishedFlows(token ?? ""),
    staleTime: 60_000,
    enabled: !!token
  });
  const contactFieldsQuery = useQuery({
    queryKey: ["contact-fields"],
    queryFn: () => listContactFields(token ?? "").then((r) => r.fields.filter((f) => f.is_active)),
    staleTime: 60_000,
    enabled: !!token
  });

  const allContactFields = useMemo(() => [
    ...CORE_CONTACT_FIELDS,
    ...(contactFieldsQuery.data ?? []).map((f) => ({ key: `custom:${f.name}`, label: f.label }))
  ], [contactFieldsQuery.data]);

  /* ── Form state ── */
  const [captureEnabled, setCaptureEnabled] = useState(config.capture_enabled);
  const [templateId, setTemplateId] = useState(() => {
    if (!config.capture_template_name) return "";
    return config.capture_template_name;
  });
  const [templateVars, setTemplateVars] = useState<Record<string, TemplateVarBinding>>(
    config.capture_template_vars ?? {}
  );
  const [flowId, setFlowId] = useState(config.capture_flow_id ?? "");
  const [triggerType, setTriggerType] = useState<"create" | "update" | "both">(config.capture_trigger_type);
  const [conditions, setConditions] = useState<ConditionDraft[]>(
    (config.capture_conditions_json as ConditionDraft[] | null) ?? []
  );
  const [retryIntervalDays, setRetryIntervalDays] = useState(config.retry_interval_days);
  const [retryMaxCount, setRetryMaxCount] = useState(config.retry_max_count);
  const [cooldownDays, setCooldownDays] = useState(config.cooldown_days);

  /* ── Derived ── */
  const selectedTemplate = useMemo(
    () => (templatesQuery.data ?? []).find((t) => t.name === templateId) ?? null,
    [templatesQuery.data, templateId]
  );
  const placeholders = useMemo(() => extractPlaceholders(selectedTemplate), [selectedTemplate]);

  /* ── Handlers ── */
  const handleTemplateChange = (name: string) => {
    setTemplateId(name);
    setTemplateVars({});
  };

  const setVarField = (pos: string, field: string) => {
    setTemplateVars((prev) => ({ ...prev, [pos]: { source: "contact", field } }));
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, { field: "tags", operator: "contains", value: "" }]);
  };
  const updateCondition = (i: number, next: ConditionDraft) => {
    setConditions((prev) => prev.map((c, idx) => idx === i ? next : c));
  };
  const removeCondition = (i: number) => {
    setConditions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      enabled: captureEnabled || config.campaign_enabled,
      captureEnabled,
      captureTemplateName: templateId || null,
      captureFlowId: flowId || null,
      captureTriggerType: triggerType,
      captureTemplateVars: templateVars,
      captureConditionsJson: conditions,
      retryIntervalDays,
      retryMaxCount,
      cooldownDays
    });
  };

  const cardHead = (n: number, title: string, desc: string, badge?: React.ReactNode) => (
    <div className="rm-card-head">
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <StepCircle n={n} done={!!badge} />
        <div>
          <div className="rm-card-title">{title}</div>
          <div style={{ fontSize: "0.75rem", color: "#5f6f86", marginTop: "0.1rem" }}>{desc}</div>
        </div>
      </div>
      {badge}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>

      {/* ── Enable toggle ── */}
      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Enable Capture</span>
          <label className="rm-toggle">
            <input type="checkbox" checked={captureEnabled} onChange={(e) => setCaptureEnabled(e.target.checked)} />
            <span className="rm-toggle-track" />
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{captureEnabled ? "On" : "Off"}</span>
          </label>
        </div>
      </div>

      {/* ── Section 1: Permission Template ── */}
      <div className="rm-card">
        {cardHead(1, "Permission Template", "Sent to ask the customer — works outside 24h window",
          selectedTemplate ? <span className="rm-pill rm-pill-on">Configured</span> : undefined
        )}
        <div className="rm-card-body">

          <div className="rm-field">
            <label className="rm-label">Select Template</label>
            {templatesQuery.isLoading ? (
              <div style={{ fontSize: "0.82rem", color: "#5f6f86" }}>Loading templates…</div>
            ) : (
              <select className="rm-select" value={templateId} onChange={(e) => handleTemplateChange(e.target.value)}>
                <option value="">— select a template —</option>
                {(templatesQuery.data ?? []).map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {selectedTemplate && (
            <>
              <div style={{ border: "1.5px solid #c7d6f7", borderRadius: 10, overflow: "hidden", marginTop: "0.25rem" }}>
                <div style={{
                  background: "#eff6ff", padding: "0.5rem 0.85rem",
                  display: "flex", alignItems: "center", justifyContent: "space-between"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.77rem", fontWeight: 700, color: "#1d4ed8" }}>
                    📄 Template Preview
                    <span className="rm-pill rm-pill-on" style={{ fontSize: "0.62rem" }}>{selectedTemplate.name}</span>
                  </div>
                  <a
                    href="/dashboard/templates"
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.75rem", color: "#2563eb", fontWeight: 600, textDecoration: "none" }}
                  >
                    Edit in Templates →
                  </a>
                </div>
                <div style={{ padding: "0.75rem" }}>
                  <TemplatePreviewPanel components={selectedTemplate.components} />
                </div>
              </div>

              {placeholders.length > 0 && (
                <div className="rm-field" style={{ marginTop: "0.5rem" }}>
                  <label className="rm-label">
                    Template Variable Mapping
                    <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "#5f6f86", marginLeft: "0.4rem" }}>
                      — map {`{{variable}}`} to contact fields
                    </span>
                  </label>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #edf2f7" }}>
                        <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5f6f86", background: "#fafbfd" }}>Template Variable</th>
                        <th style={{ width: 36, background: "#fafbfd" }}></th>
                        <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5f6f86", background: "#fafbfd" }}>Contact Field</th>
                      </tr>
                    </thead>
                    <tbody>
                      {placeholders.map((pos) => (
                        <tr key={pos} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "0.6rem 0.75rem" }}>
                            <code style={{ fontSize: "0.78rem", background: "#f1f5f9", padding: "2px 7px", borderRadius: 5, color: "#334155" }}>
                              {`{{${pos}}}`}
                            </code>
                          </td>
                          <td style={{ textAlign: "center", color: "#d1d5db", fontSize: "0.85rem" }}>→</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>
                            <select
                              className="rm-select rm-input-sm"
                              value={templateVars[pos]?.field ?? ""}
                              onChange={(e) => setVarField(pos, e.target.value)}
                            >
                              <option value="">— select field —</option>
                              {allContactFields.map((f) => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Section 2: Capture Flow ── */}
      <div className="rm-card">
        {cardHead(2, "Date Capture Flow", "Triggered when customer replies YES to the template",
          flowId ? <span className="rm-pill rm-pill-on">Linked</span> : undefined
        )}
        <div className="rm-card-body">
          <div className="rm-field">
            <label className="rm-label">
              Select Flow
              <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "#5f6f86", marginLeft: "0.4rem" }}>
                — must save date to contact field
              </span>
            </label>
            {flowsQuery.isLoading ? (
              <div style={{ fontSize: "0.82rem", color: "#5f6f86" }}>Loading flows…</div>
            ) : (
              <>
                <div style={{ border: "1px solid #e2eaf4", borderRadius: 8, overflow: "hidden" }}>
                  {(flowsQuery.data ?? []).length === 0 ? (
                    <div style={{ padding: "1rem", fontSize: "0.82rem", color: "#5f6f86", textAlign: "center" }}>
                      No published flows yet.
                    </div>
                  ) : (
                    (flowsQuery.data ?? []).map((flow) => (
                      <div
                        key={flow.id}
                        onClick={() => setFlowId(flowId === flow.id ? "" : flow.id)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "0.65rem 0.85rem",
                          borderBottom: "1px solid #f1f5f9",
                          cursor: "pointer",
                          background: flowId === flow.id ? "#eff6ff" : "#fff",
                          borderLeft: flowId === flow.id ? "3px solid #2563eb" : "3px solid transparent",
                          transition: "background 100ms ease"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                          <span style={{ fontSize: "1rem" }}>💬</span>
                          <div>
                            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#122033" }}>{flow.name}</div>
                            <div style={{ fontSize: "0.72rem", color: "#5f6f86", marginTop: "0.1rem" }}>{flow.channel} · published</div>
                          </div>
                        </div>
                        {flowId === flow.id && <span style={{ color: "#2563eb", fontWeight: 800 }}>✓</span>}
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="rm-btn rm-btn-ghost rm-btn-sm"
                  style={{ marginTop: "0.5rem", width: "100%", borderStyle: "dashed", color: "#2563eb" }}
                  onClick={() => window.open("/dashboard/flows", "_blank")}
                >
                  + Build a new capture flow in Flow Builder →
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: Trigger ── */}
      <div className="rm-card">
        {cardHead(3, "Trigger Event", "When should WAgen check if this contact needs prompting?")}
        <div className="rm-card-body">
          <div className="rm-trigger-row">
            {([
              { value: "create", icon: "✨", label: "On Create", sub: "New contact" },
              { value: "update", icon: "✏️", label: "On Update", sub: "Contact updated" },
              { value: "both",   icon: "⚡", label: "Both", sub: "Create or update" }
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`rm-trigger-pill${triggerType === opt.value ? " is-active" : ""}`}
                style={{ flexDirection: "column", alignItems: "center", padding: "0.7rem 1.2rem", gap: "0.2rem" }}
                onClick={() => setTriggerType(opt.value)}
              >
                <span style={{ fontSize: "1.1rem" }}>{opt.icon}</span>
                <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{opt.label}</span>
                <span style={{ fontSize: "0.72rem", opacity: 0.75 }}>{opt.sub}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section 4: Audience Filter ── */}
      <div className="rm-card">
        {cardHead(4, "Audience Filter", "Only prompt contacts who match ALL conditions",
          conditions.length > 0
            ? <span className="rm-pill rm-pill-on">{conditions.length} condition{conditions.length !== 1 ? "s" : ""}</span>
            : undefined
        )}
        <div className="rm-card-body">
          {conditions.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem", marginBottom: "0.6rem" }}>
              {conditions.map((cond, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 100px 1fr auto", gap: "0.4rem", alignItems: "center" }}>
                  <select
                    className="rm-select rm-input-sm"
                    value={cond.field}
                    onChange={(e) => updateCondition(i, { ...cond, field: e.target.value })}
                  >
                    {CORE_CONTACT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    {(contactFieldsQuery.data ?? []).map((f) => (
                      <option key={f.id} value={`custom:${f.name}`}>{f.label}</option>
                    ))}
                  </select>
                  <select
                    className="rm-select rm-input-sm"
                    value={cond.operator}
                    onChange={(e) => updateCondition(i, { ...cond, operator: e.target.value as ConditionDraft["operator"] })}
                  >
                    {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                  <input
                    className="rm-input rm-input-sm"
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { ...cond, value: e.target.value })}
                    placeholder="value"
                  />
                  <button
                    type="button"
                    className="rm-var-rm"
                    onClick={() => removeCondition(i)}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={addCondition}
            style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              padding: "0.55rem 0.85rem",
              border: "1.5px dashed #c7d6f7", borderRadius: 8,
              color: "#2563eb", fontSize: "0.82rem", fontWeight: 600,
              background: "transparent", cursor: "pointer", transition: "background 100ms ease",
              width: "100%"
            }}
          >
            <span style={{ fontSize: "1rem", lineHeight: 1 }}>+</span> Add condition
          </button>
          {conditions.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: "0.6rem",
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: 8, padding: "0.6rem 0.85rem",
              fontSize: "0.82rem", color: "#166534", marginTop: "0.6rem"
            }}>
              <span style={{
                background: "#166534", color: "#fff",
                borderRadius: 999, padding: "1px 10px",
                fontSize: "0.82rem", fontWeight: 800
              }}>ALL</span>
              conditions must match · template will be sent to these contacts
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5: Retry & Cooldown ── */}
      <div className="rm-card">
        {cardHead(5, "Retry & Cooldown", "Control what happens when customer ignores or declines")}
        <div className="rm-card-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>

            {/* Retry box */}
            <div style={{ border: "1.5px solid #f59e0b", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "0.65rem 1rem", background: "#fffbeb", fontSize: "0.85rem", fontWeight: 700, color: "#92400e", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                🔄 Retry <span style={{ fontSize: "0.75rem", fontWeight: 400 }}>(no response)</span>
              </div>
              <div style={{ padding: "0.85rem 1rem", background: "#fff", display: "grid", gap: "0.75rem" }}>
                <div className="rm-field">
                  <label className="rm-label" style={{ fontSize: "0.72rem" }}>Max retries</label>
                  <div className="rm-count-row">
                    {[0, 1, 2, 3].map((n) => (
                      <button key={n} type="button" className={`rm-count-btn${retryMaxCount === n ? " is-active" : ""}`} onClick={() => setRetryMaxCount(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rm-field">
                  <label className="rm-label" style={{ fontSize: "0.72rem" }}>Retry after (days)</label>
                  <input type="number" min={1} max={365} className="rm-input rm-input-sm" value={retryIntervalDays} onChange={(e) => setRetryIntervalDays(Number(e.target.value))} />
                </div>
              </div>
            </div>

            {/* Cooldown box */}
            <div style={{ border: "1.5px solid #c7d6f7", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "0.65rem 1rem", background: "#eff6ff", fontSize: "0.85rem", fontWeight: 700, color: "#1d4ed8", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                ⏸️ Cooldown <span style={{ fontSize: "0.75rem", fontWeight: 400 }}>(said Not now)</span>
              </div>
              <div style={{ padding: "0.85rem 1rem", background: "#fff", display: "grid", gap: "0.75rem" }}>
                <div className="rm-field">
                  <label className="rm-label" style={{ fontSize: "0.72rem" }}>Don't re-ask for (days)</label>
                  <input type="number" min={1} max={365} className="rm-input rm-input-sm" value={cooldownDays} onChange={(e) => setCooldownDays(Number(e.target.value))} />
                </div>
              </div>
            </div>
          </div>

          {/* Timeline preview */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 8, padding: "0.85rem 1rem", marginTop: "0.75rem" }}>
            <div style={{ fontSize: "0.64rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: "0.65rem" }}>
              Timeline Preview — what happens to a contact
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
              {[
                { dot: "#2563eb", label: "Day 0", text: "Template sent", sub: "Permission ask delivered" },
                { dot: "#f59e0b", label: `Day ${retryIntervalDays}`, text: `Retry 1`, sub: "No response — resend" },
                { dot: "#dc2626", label: `Day ${retryIntervalDays * retryMaxCount + retryIntervalDays}`, text: "Stopped", sub: "Max retries reached" }
              ].filter((_, i) => i === 0 || (i === 1 && retryMaxCount > 0) || (i === 2 && retryMaxCount > 1)).map((row) => (
                <div key={row.label} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: row.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, height: 2, background: "#e2eaf4", borderRadius: 1 }} />
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155", whiteSpace: "nowrap" }}>
                    {row.label} — {row.text}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{row.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Paths */}
          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
            {[
              { bg: "#fef3c7", emoji: "🔄", text: "No response (ignored)", desc: `session expires → retry after ${retryIntervalDays}d → stop after ${retryMaxCount} retr${retryMaxCount !== 1 ? "ies" : "y"}` },
              { bg: "#fee2e2", emoji: "⏸️", text: 'Tapped "Not now"', desc: `cooldown ${cooldownDays}d → eligible again after cooldown` },
              { bg: "#eff6ff", emoji: "✅", text: 'Tapped "Yes"', desc: "flow starts → date captured → never prompted again" }
            ].map((p) => (
              <div key={p.emoji} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: p.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", flexShrink: 0 }}>{p.emoji}</div>
                <div style={{ fontSize: "0.8rem", color: "#334155", lineHeight: 1.5 }}>
                  <strong>{p.text}</strong> — {p.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <button type="submit" disabled={isSaving} className="rm-btn rm-btn-primary">
          {isSaving ? "Saving…" : "Save Capture Settings"}
        </button>
      </div>
    </form>
  );
}
