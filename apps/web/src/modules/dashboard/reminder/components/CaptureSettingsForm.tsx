import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReminderConfig, ReminderConfigWriteInput, MessageTemplate, TemplateComponent, TemplateVarBinding } from "../../../../lib/api";
import { fetchTemplates, listContactFields } from "../../../../lib/api";
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

function extractQuickReplyButtons(template: MessageTemplate | null): Array<{ text: string; index: number }> {
  if (!template) return [];
  const buttonsComp = template.components.find((c: TemplateComponent) => c.type === "BUTTONS");
  if (!buttonsComp?.buttons) return [];
  return buttonsComp.buttons
    .filter((b) => b.type === "QUICK_REPLY")
    .map((b, i) => ({ text: b.text, index: i }));
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

function ChatBubble({ from, text }: { from: "wagen" | "contact"; text: string }) {
  const isWagen = from === "wagen";
  return (
    <div style={{ display: "flex", justifyContent: isWagen ? "flex-start" : "flex-end", marginBottom: "0.35rem" }}>
      <div style={{
        maxWidth: "80%", padding: "0.45rem 0.7rem", borderRadius: isWagen ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
        background: isWagen ? "#fff" : "#dcfce7",
        border: isWagen ? "1px solid #e2eaf4" : "1px solid #bbf7d0",
        fontSize: "0.78rem", color: "#122033", lineHeight: 1.55, whiteSpace: "pre-wrap"
      }}>
        {text}
        <div style={{ fontSize: "0.6rem", color: "#94a3b8", textAlign: "right", marginTop: "0.2rem" }}>
          {isWagen ? "WAgen" : "Contact"}
        </div>
      </div>
    </div>
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
  const contactFieldsQuery = useQuery({
    queryKey: ["contact-fields"],
    queryFn: () => listContactFields(token ?? "").then((r) => r.fields.filter((f) => f.is_active && f.field_type === "date")),
    staleTime: 60_000,
    enabled: !!token
  });
  const allContactFieldsForVar = useQuery({
    queryKey: ["contact-fields-all"],
    queryFn: () => listContactFields(token ?? "").then((r) => r.fields.filter((f) => f.is_active)),
    staleTime: 60_000,
    enabled: !!token
  });

  const allContactFields = useMemo(() => [
    ...CORE_CONTACT_FIELDS,
    ...(allContactFieldsForVar.data ?? []).map((f) => ({ key: f.name, label: f.label }))
  ], [allContactFieldsForVar.data]);

  const dateFields = useMemo(() => contactFieldsQuery.data ?? [], [contactFieldsQuery.data]);

  /* ── Form state ── */
  const [captureEnabled, setCaptureEnabled] = useState(config.capture_enabled);
  const [dateFieldName, setDateFieldName] = useState<string>(
    config.date_field_name ?? config.config_key
  );
  const [templateId, setTemplateId] = useState(config.capture_template_name ?? "");
  const [templateVars, setTemplateVars] = useState<Record<string, TemplateVarBinding>>(
    config.capture_template_vars ?? {}
  );
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
  const quickReplyButtons = useMemo(() => extractQuickReplyButtons(selectedTemplate), [selectedTemplate]);

  const selectedDateFieldLabel = useMemo(() => {
    return dateFields.find((f) => f.name === dateFieldName)?.label ?? dateFieldName;
  }, [dateFields, dateFieldName]);

  /* ── Handlers ── */
  const handleTemplateChange = (name: string) => {
    setTemplateId(name);
    setTemplateVars({});
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
      captureFlowId: null,
      captureTriggerType: triggerType,
      captureTemplateVars: templateVars,
      captureConditionsJson: conditions,
      retryIntervalDays,
      retryMaxCount,
      cooldownDays,
      dateFieldName
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
        <div style={{ padding: "0 1rem 0.85rem", fontSize: "0.82rem", color: "#5f6f86", lineHeight: 1.6 }}>
          When a contact registers or updates, WAgen sends a permission template asking if they want to share their date.
          If they say <strong>Yes</strong>, WAgen automatically collects the date via chat and saves it to the contact field you select below.
          <strong> No flow required.</strong>
        </div>
      </div>

      {/* ── Section 1: Date Field ── */}
      <div className="rm-card">
        {cardHead(1, "Date Field to Capture", "Which contact field will store the captured date?",
          dateFieldName ? <span className="rm-pill rm-pill-on">Selected</span> : undefined
        )}
        <div className="rm-card-body">
          {contactFieldsQuery.isLoading ? (
            <div style={{ fontSize: "0.82rem", color: "#5f6f86" }}>Loading date fields…</div>
          ) : dateFields.length === 0 ? (
            <div style={{
              background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8,
              padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#92400e"
            }}>
              No active date-type contact fields found.{" "}
              <a href="/dashboard/settings/contact-fields" target="_blank" style={{ color: "#92400e", fontWeight: 700 }}>
                Create one in Contact Fields →
              </a>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {dateFields.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setDateFieldName(f.name)}
                  style={{
                    appearance: "none", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0.65rem 0.85rem", border: "1.5px solid",
                    borderColor: dateFieldName === f.name ? "#2563eb" : "#e2eaf4",
                    borderRadius: 10, background: dateFieldName === f.name ? "#eff6ff" : "#fff",
                    cursor: "pointer", transition: "all 120ms ease", textAlign: "left"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <span style={{ fontSize: "1.1rem" }}>📅</span>
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#122033" }}>{f.label}</div>
                      <div style={{ fontSize: "0.72rem", color: "#5f6f86", marginTop: "0.1rem" }}>
                        field key: <code style={{ fontSize: "0.7rem" }}>{f.name}</code>
                        {f.is_system && <span style={{ marginLeft: "0.4rem", padding: "1px 6px", borderRadius: 6, background: "#ede9fe", color: "#7c3aed", fontSize: "0.64rem", fontWeight: 800 }}>SYSTEM</span>}
                      </div>
                    </div>
                  </div>
                  {dateFieldName === f.name && <span style={{ color: "#2563eb", fontWeight: 800, fontSize: "1.1rem" }}>✓</span>}
                </button>
              ))}
            </div>
          )}

          {/* Built-in conversation preview */}
          {dateFieldName && (
            <div style={{ marginTop: "1rem", border: "1.5px solid #c7d6f7", borderRadius: 10, overflow: "hidden" }}>
              <div style={{
                background: "#eff6ff", padding: "0.5rem 0.85rem",
                fontSize: "0.72rem", fontWeight: 800, color: "#1d4ed8",
                textTransform: "uppercase", letterSpacing: "0.08em"
              }}>
                💬 Built-in Capture Conversation — contact taps YES on the permission template
              </div>
              <div style={{ background: "#f8fafc", padding: "0.75rem 0.85rem" }}>
                <ChatBubble from="wagen" text={`Great! Please reply with your ${selectedDateFieldLabel} date in YYYY-MM-DD format (e.g. 1990-06-15). Reply *cancel* to skip.`} />
                <ChatBubble from="contact" text="1990-06-15" />
                <ChatBubble from="wagen" text={`Thank you! Your date has been saved as 1990-06-15. We'll send you a reminder when the time comes.`} />
              </div>
              <div style={{ padding: "0.55rem 0.85rem", background: "#eff6ff", fontSize: "0.75rem", color: "#1d4ed8", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>✅</span> Date saved to <strong>{selectedDateFieldLabel}</strong> contact field automatically. No flow needed.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Trigger Event ── */}
      <div className="rm-card">
        {cardHead(2, "Trigger Event", "When should WAgen send the permission template?")}
        <div className="rm-card-body">
          <div className="rm-trigger-row">
            {([
              { value: "create", icon: "✨", label: "On Create", sub: "New contact registers" },
              { value: "update", icon: "✏️", label: "On Update", sub: "Contact info updated" },
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

      {/* ── Section 3: Permission Template ── */}
      <div className="rm-card">
        {cardHead(3, "Permission Template", "Sent outside 24h window — must be a WhatsApp-approved template with 2 quick-reply buttons",
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

              {/* Button payload callout */}
              <div style={{
                marginTop: "0.6rem", padding: "0.65rem 0.85rem",
                background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8,
                fontSize: "0.78rem", color: "#166534", lineHeight: 1.6
              }}>
                <strong>Button payloads set automatically by WAgen:</strong>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.35rem" }}>
                  {quickReplyButtons.length > 0 ? quickReplyButtons.map((b, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 6, background: "#fff",
                        border: `1px solid ${i === 0 ? "#bbf7d0" : "#fecdd3"}`,
                        fontSize: "0.78rem", fontWeight: 600,
                        color: i === 0 ? "#166534" : "#be123c"
                      }}>
                        "{b.text}"
                      </span>
                      <span style={{ fontSize: "0.72rem", color: "#5f6f86" }}>→</span>
                      <code style={{
                        fontSize: "0.72rem", padding: "2px 6px", borderRadius: 4,
                        background: i === 0 ? "#dcfce7" : "#ffe4e6",
                        color: i === 0 ? "#166534" : "#be123c", fontWeight: 700
                      }}>
                        {i === 0 ? `start_flow_${config.config_key}` : "not_now"}
                      </code>
                    </span>
                  )) : (
                    <span style={{ color: "#92400e" }}>⚠ No quick-reply buttons found in template — add 2 quick-reply buttons.</span>
                  )}
                </div>
              </div>

              {placeholders.length > 0 && (
                <div className="rm-field" style={{ marginTop: "0.5rem" }}>
                  <label className="rm-label">Template Variable Mapping</label>
                  <div style={{ border: "1px solid #e2eaf4", borderRadius: 8, overflow: "hidden" }}>
                    {placeholders.map((pos, idx) => {
                      const binding = templateVars[pos] ?? { source: "contact" as const, field: "" };
                      const isContact = binding.source === "contact";
                      return (
                        <div
                          key={pos}
                          style={{
                            padding: "0.75rem 1rem",
                            borderBottom: idx < placeholders.length - 1 ? "1px solid #f1f5f9" : undefined,
                            display: "flex", flexDirection: "column", gap: "0.45rem"
                          }}
                        >
                          <code style={{
                            alignSelf: "flex-start",
                            fontSize: "0.78rem", fontWeight: 700,
                            background: "#e0f2fe", color: "#0369a1",
                            padding: "2px 8px", borderRadius: 6
                          }}>
                            {`{{${pos}}}`}
                          </code>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5f6f86", width: 52, flexShrink: 0 }}>Source</span>
                            <select
                              className="rm-select rm-input-sm"
                              value={binding.source}
                              onChange={(e) => {
                                const src = e.target.value as "contact" | "static";
                                setTemplateVars((prev) => ({
                                  ...prev,
                                  [pos]: src === "contact"
                                    ? { source: "contact", field: "" }
                                    : { source: "static", value: "" }
                                }));
                              }}
                            >
                              <option value="contact">Contact field</option>
                              <option value="static">Static value</option>
                            </select>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#5f6f86", width: 52, flexShrink: 0 }}>
                              {isContact ? "Field" : "Value"}
                            </span>
                            {isContact ? (
                              <select
                                className="rm-select rm-input-sm"
                                value={binding.field ?? ""}
                                onChange={(e) => setTemplateVars((prev) => ({
                                  ...prev, [pos]: { source: "contact", field: e.target.value }
                                }))}
                              >
                                <option value="">— select field —</option>
                                {allContactFields.map((f) => (
                                  <option key={f.key} value={f.key}>{f.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className="rm-input rm-input-sm"
                                placeholder="Static replacement text"
                                value={binding.value ?? ""}
                                onChange={(e) => setTemplateVars((prev) => ({
                                  ...prev, [pos]: { source: "static", value: e.target.value }
                                }))}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Section 4: Audience Filter ── */}
      <div className="rm-card">
        {cardHead(4, "Audience Filter", "Only send to contacts who match ALL conditions (optional)",
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
                    {(allContactFieldsForVar.data ?? []).map((f) => (
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
                  <button type="button" className="rm-var-rm" onClick={() => removeCondition(i)}>×</button>
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
              background: "transparent", cursor: "pointer", width: "100%"
            }}
          >
            <span style={{ fontSize: "1rem" }}>+</span> Add condition
          </button>
        </div>
      </div>

      {/* ── Section 5: Retry & Cooldown ── */}
      <div className="rm-card">
        {cardHead(5, "Retry & Cooldown", "Control re-ask behaviour when contact ignores or declines")}
        <div className="rm-card-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
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
            <div style={{ border: "1.5px solid #c7d6f7", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "0.65rem 1rem", background: "#eff6ff", fontSize: "0.85rem", fontWeight: 700, color: "#1d4ed8", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                ⏸️ Cooldown <span style={{ fontSize: "0.75rem", fontWeight: 400 }}>(said Not now)</span>
              </div>
              <div style={{ padding: "0.85rem 1rem", background: "#fff" }}>
                <div className="rm-field">
                  <label className="rm-label" style={{ fontSize: "0.72rem" }}>Don't re-ask for (days)</label>
                  <input type="number" min={1} max={365} className="rm-input rm-input-sm" value={cooldownDays} onChange={(e) => setCooldownDays(Number(e.target.value))} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
            {[
              { bg: "#fef3c7", emoji: "🔄", text: "No response (ignored)", desc: `session expires → retry after ${retryIntervalDays}d → stop after ${retryMaxCount} retr${retryMaxCount !== 1 ? "ies" : "y"}` },
              { bg: "#fee2e2", emoji: "⏸️", text: 'Tapped "Not now"', desc: `cooldown ${cooldownDays}d → eligible again after cooldown` },
              { bg: "#f0fdf4", emoji: "✅", text: "Tapped YES → replied with date", desc: `date saved to ${selectedDateFieldLabel} field → never prompted again` }
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
