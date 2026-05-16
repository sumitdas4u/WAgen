import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReminderConfig, ReminderCampaignStep, ReminderConfigWriteInput, TemplateVarBinding, MessageTemplate } from "../../../../lib/api";
import { listContactFields, fetchTemplates } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";

interface StepDraft {
  stepOrder: number;
  daysBefore: number;
  templateName: string;
  templateLang: string;
  templateVars: Record<string, TemplateVarBinding>;
}

interface Props {
  config: ReminderConfig;
  steps: ReminderCampaignStep[];
  onSave: (input: ReminderConfigWriteInput) => Promise<void>;
  isSaving: boolean;
}

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
  "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles",
  "Africa/Lagos", "Australia/Sydney"
];

const LANGS = ["en", "en_US", "hi", "ar", "id", "pt_BR", "es", "fr"];

function stepFromRow(s: ReminderCampaignStep): StepDraft {
  return {
    stepOrder: s.step_order,
    daysBefore: s.days_before,
    templateName: s.template_name,
    templateLang: s.template_lang,
    templateVars: s.template_vars ?? {}
  };
}

function newStep(order: number): StepDraft {
  return { stepOrder: order, daysBefore: 0, templateName: "", templateLang: "en", templateVars: {} };
}

const CORE_FIELDS = [
  { key: "display_name", label: "Display Name" },
  { key: "phone_number", label: "Phone Number" },
  { key: "email", label: "Email" },
  { key: "contact_type", label: "Contact Type" },
  { key: "tags", label: "Tags" }
];

function extractPlaceholders(template: MessageTemplate | null): string[] {
  if (!template) return [];
  const matches = JSON.stringify(template.components).matchAll(/\{\{(\d+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))].sort((a, b) => Number(a) - Number(b));
}

interface StepEditorProps {
  step: StepDraft;
  index: number;
  onChange: (updated: StepDraft) => void;
  onRemove: () => void;
  isOnly: boolean;
  templates: MessageTemplate[];
  contactFieldOptions: Array<{ key: string; label: string }>;
}

function StepEditor({ step, index, onChange, onRemove, isOnly, templates, contactFieldOptions }: StepEditorProps) {
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.name === step.templateName) ?? null,
    [templates, step.templateName]
  );
  const placeholders = useMemo(() => extractPlaceholders(selectedTemplate), [selectedTemplate]);

  const handleTemplateChange = (name: string) => {
    onChange({ ...step, templateName: name, templateVars: {} });
  };

  const setVar = (pos: string, binding: TemplateVarBinding) => {
    onChange({ ...step, templateVars: { ...step.templateVars, [pos]: binding } });
  };

  return (
    <div className="rm-step-card">
      <div className="rm-step-head">
        <span className="rm-step-title">Step {index + 1}</span>
        {!isOnly && (
          <button type="button" className="rm-step-remove" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>

      <div className="rm-step-body">
        <div className="rm-step-fields">
          <div className="rm-field">
            <label className="rm-label">Days Before</label>
            <input
              type="number" min={0}
              className="rm-input"
              value={step.daysBefore}
              onChange={(e) => onChange({ ...step, daysBefore: parseInt(e.target.value, 10) || 0 })}
            />
            <span className="rm-label-hint">0 = day of event</span>
          </div>
          <div className="rm-field">
            <label className="rm-label">Template</label>
            <select
              className="rm-select"
              value={step.templateName}
              onChange={(e) => handleTemplateChange(e.target.value)}
            >
              <option value="">— select template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="rm-field">
            <label className="rm-label">Language</label>
            <select
              className="rm-select"
              value={step.templateLang}
              onChange={(e) => onChange({ ...step, templateLang: e.target.value })}
            >
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* Variable mapping — auto-derived from selected template */}
        {step.templateName && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#5f6f86", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
              Template Variables
            </div>
            {placeholders.length === 0 ? (
              <div style={{ fontSize: "0.8rem", color: "#94a3b8", padding: "0.5rem 0" }}>
                {selectedTemplate ? "No dynamic variables in this template." : "Select a template to map variables."}
              </div>
            ) : (
              <div style={{ border: "1px solid #e2eaf4", borderRadius: 8, overflow: "hidden" }}>
                {placeholders.map((pos, idx) => {
                  const binding = step.templateVars[pos] ?? { source: "contact" as const, field: "" };
                  const isContact = binding.source === "contact";
                  return (
                    <div
                      key={pos}
                      style={{
                        padding: "0.65rem 0.85rem",
                        borderBottom: idx < placeholders.length - 1 ? "1px solid #f1f5f9" : undefined,
                        display: "flex", flexDirection: "column", gap: "0.4rem"
                      }}
                    >
                      <code style={{
                        alignSelf: "flex-start", fontSize: "0.75rem", fontWeight: 700,
                        background: "#e0f2fe", color: "#0369a1", padding: "2px 7px", borderRadius: 5
                      }}>
                        {`{{${pos}}}`}
                      </code>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#5f6f86", width: 48, flexShrink: 0 }}>Source</span>
                        <select
                          className="rm-select rm-input-sm"
                          value={binding.source}
                          onChange={(e) => {
                            const src = e.target.value as "contact" | "static";
                            setVar(pos, src === "contact" ? { source: "contact", field: "" } : { source: "static", value: "" });
                          }}
                        >
                          <option value="contact">Contact field</option>
                          <option value="static">Static value</option>
                        </select>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#5f6f86", width: 48, flexShrink: 0 }}>
                          {isContact ? "Field" : "Value"}
                        </span>
                        {isContact ? (
                          <select
                            className="rm-select rm-input-sm"
                            value={binding.field ?? ""}
                            onChange={(e) => setVar(pos, { source: "contact", field: e.target.value })}
                          >
                            <option value="">— select field —</option>
                            {contactFieldOptions.map((f) => (
                              <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="rm-input rm-input-sm"
                            placeholder="Static replacement text"
                            value={binding.value ?? ""}
                            onChange={(e) => setVar(pos, { source: "static", value: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CampaignSettingsForm({ config, steps, onSave, isSaving }: Props) {
  const { token } = useAuth();
  const [campaignEnabled, setCampaignEnabled] = useState(config.campaign_enabled);
  const [sendTime, setSendTime] = useState(config.campaign_send_time.slice(0, 5));
  const [timezone, setTimezone] = useState(config.campaign_timezone);
  const [dispatchMode, setDispatchMode] = useState<"annual" | "exact_date">(config.dispatch_mode);
  const [dateFieldName, setDateFieldName] = useState(config.date_field_name ?? config.config_key);
  const [stepDrafts, setStepDrafts] = useState<StepDraft[]>(
    steps.length > 0 ? steps.map(stepFromRow) : [newStep(1)]
  );

  const contactFieldsQuery = useQuery({
    queryKey: ["contact-fields"],
    queryFn: () => listContactFields(token ?? "").then((r) => r.fields.filter((f) => f.is_active)),
    staleTime: 60_000,
    enabled: !!token
  });

  const templatesQuery = useQuery({
    queryKey: ["templates-all"],
    queryFn: () => fetchTemplates(token ?? "").then((r) => r.templates.filter((t) => t.status === "APPROVED")),
    staleTime: 60_000,
    enabled: !!token
  });

  const contactFieldOptions = useMemo(() => [
    ...CORE_FIELDS,
    ...(contactFieldsQuery.data ?? []).map((f) => ({ key: `custom:${f.name}`, label: f.label }))
  ], [contactFieldsQuery.data]);

  const updateStep = (i: number, updated: StepDraft) => {
    setStepDrafts((prev) => prev.map((s, idx) => (idx === i ? updated : s)));
  };

  const addStep = () => setStepDrafts((prev) => [...prev, newStep(prev.length + 1)]);

  const removeStep = (i: number) => {
    setStepDrafts((prev) =>
      prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, stepOrder: idx + 1 }))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      reminderType: config.reminder_type,
      enabled: config.capture_enabled || campaignEnabled,
      campaignEnabled,
      campaignSendTime: sendTime,
      campaignTimezone: timezone,
      dispatchMode,
      dateFieldName,
      steps: stepDrafts.map((s, i) => ({
        stepOrder: i + 1,
        daysBefore: s.daysBefore,
        templateName: s.templateName,
        templateLang: s.templateLang,
        templateVars: s.templateVars
      }))
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem" }}>
      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Enable Campaign</span>
          <label className="rm-toggle">
            <input
              type="checkbox"
              checked={campaignEnabled}
              onChange={(e) => setCampaignEnabled(e.target.checked)}
            />
            <span className="rm-toggle-track" />
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              {campaignEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Dispatch Mode</span>
        </div>
        <div className="rm-card-body">
          <div className="rm-dispatch-grid">
            {([
              { value: "annual", label: "Annual (recurring)", desc: "Fires every year on same day — birthday, anniversary" },
              { value: "exact_date", label: "One-time event", desc: "Fires once on the exact stored date — deadline, event" }
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`rm-dispatch-btn${dispatchMode === opt.value ? " is-active" : ""}`}
                onClick={() => setDispatchMode(opt.value)}
              >
                <div className="rm-dispatch-label">{opt.label}</div>
                <div className="rm-dispatch-desc">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Date Field ── */}
      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Date Field</span>
          <span style={{ fontSize: "0.75rem", color: "#5f6f86" }}>
            which contact field holds the date?
          </span>
        </div>
        <div className="rm-card-body">
          <div className="rm-field">
            <label className="rm-label">Contact Field</label>
            <select
              className="rm-select"
              value={dateFieldName}
              onChange={(e) => setDateFieldName(e.target.value)}
            >
              {/* Built-in suggestion matching config key */}
              <option value={config.config_key}>{config.config_key} (default)</option>
              {(contactFieldsQuery.data ?? [])
                .filter((f) => f.name !== config.config_key)
                .map((f) => (
                  <option key={f.id} value={f.name}>{f.label} ({f.name})</option>
                ))}
            </select>
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "0.5rem",
              background: "#fef3c7", border: "1px solid #fde68a",
              borderRadius: 7, padding: "0.5rem 0.75rem", marginTop: "0.4rem"
            }}>
              <span style={{ fontSize: "0.9rem", flexShrink: 0 }}>📅</span>
              <div style={{ fontSize: "0.77rem", color: "#92400e", lineHeight: 1.55 }}>
                <strong>Required format:</strong>{" "}
                <code style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 5px", fontWeight: 800, fontSize: "0.74rem" }}>
                  YYYY-MM-DD
                </code>
                {" "}— e.g. <code style={{ fontSize: "0.73rem" }}>1990-05-15</code>.
                {" "}Your capture flow must save the date in this exact format. Other formats are ignored.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Send Time</span>
        </div>
        <div className="rm-card-body">
          <div className="rm-2col">
            <div className="rm-field">
              <label className="rm-label">Time</label>
              <input
                type="time"
                className="rm-input"
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value)}
              />
            </div>
            <div className="rm-field">
              <label className="rm-label">Timezone</label>
              <select
                className="rm-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="rm-card">
        <div className="rm-card-head">
          <span className="rm-card-title">Campaign Steps</span>
          <span style={{ fontSize: "0.77rem", color: "#5f6f86" }}>
            {stepDrafts.length} step{stepDrafts.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="rm-card-body">
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#5f6f86", lineHeight: 1.55 }}>
            Add one step per message — e.g. 15 days before (teaser), 3 days before (nudge), 0 days (day-of). Each step sends a different template.
          </p>
          {stepDrafts.map((step, i) => (
            <StepEditor
              key={i}
              step={step}
              index={i}
              onChange={(updated) => updateStep(i, updated)}
              onRemove={() => removeStep(i)}
              isOnly={stepDrafts.length === 1}
              templates={templatesQuery.data ?? []}
              contactFieldOptions={contactFieldOptions}
            />
          ))}
          <button type="button" className="rm-add-step-btn" onClick={addStep}>
            + Add Step
          </button>
        </div>
      </div>

      <div className="rm-info-banner">
        <strong>Duplicate Guard: Always Active</strong> — Each contact receives at most one message per step per year (annual) or once ever (exact date).
      </div>

      <div>
        <button type="submit" disabled={isSaving} className="rm-btn rm-btn-primary">
          {isSaving ? "Saving…" : "Save Campaign Settings"}
        </button>
      </div>
    </form>
  );
}
