import { useState } from "react";
import type { ReminderConfig, ReminderCampaignStep, ReminderConfigWriteInput, TemplateVarBinding } from "../../../../lib/api";

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

interface StepEditorProps {
  step: StepDraft;
  index: number;
  onChange: (updated: StepDraft) => void;
  onRemove: () => void;
  isOnly: boolean;
}

function StepEditor({ step, index, onChange, onRemove, isOnly }: StepEditorProps) {
  const [varKey, setVarKey] = useState("");

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", border: "1px solid #e2eaf4",
    borderRadius: 6, fontSize: 13, boxSizing: "border-box",
    fontFamily: "inherit", color: "#122033", background: "#fff", outline: "none"
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: "#5f6f86", marginBottom: 3, display: "block", textTransform: "uppercase", letterSpacing: "0.05em"
  };

  const addVar = () => {
    const k = varKey.trim();
    if (!k || k in step.templateVars) return;
    onChange({ ...step, templateVars: { ...step.templateVars, [k]: { source: "contact", field: "" } } });
    setVarKey("");
  };

  const updateVar = (key: string, binding: TemplateVarBinding) => {
    onChange({ ...step, templateVars: { ...step.templateVars, [key]: binding } });
  };

  const removeVar = (key: string) => {
    const next = { ...step.templateVars };
    delete next[key];
    onChange({ ...step, templateVars: next });
  };

  return (
    <div style={{
      border: "1px solid #e2eaf4", borderRadius: 10, background: "#fff",
      marginBottom: 10, overflow: "hidden"
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: "#f8fafc", borderBottom: "1px solid #edf2f7"
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#122033" }}>
          Step {index + 1}
        </span>
        {!isOnly && (
          <button
            type="button" onClick={onRemove}
            style={{
              fontSize: 11, color: "#be123c", background: "none", border: "none",
              cursor: "pointer", fontFamily: "inherit", fontWeight: 600
            }}
          >
            Remove
          </button>
        )}
      </div>

      <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Days Before</label>
          <input
            type="number" min={0} style={inputStyle}
            value={step.daysBefore}
            onChange={(e) => onChange({ ...step, daysBefore: parseInt(e.target.value, 10) || 0 })}
          />
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>0 = day of event</div>
        </div>
        <div>
          <label style={labelStyle}>Template Name</label>
          <input
            type="text" style={inputStyle} placeholder="e.g. birthday_reminder"
            value={step.templateName}
            onChange={(e) => onChange({ ...step, templateName: e.target.value })}
          />
        </div>
        <div>
          <label style={labelStyle}>Language</label>
          <select
            style={inputStyle}
            value={step.templateLang}
            onChange={(e) => onChange({ ...step, templateLang: e.target.value })}
          >
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div style={{ padding: "0 14px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#5f6f86", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Template Variables
        </div>

        {Object.entries(step.templateVars).map(([key, binding]) => (
          <div key={key} style={{
            display: "grid", gridTemplateColumns: "140px 1fr 1fr auto",
            gap: 6, alignItems: "center", marginBottom: 6
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: "#334155",
              padding: "6px 8px", background: "#f1f5f9", borderRadius: 6
            }}>
              {`{{${key}}}`}
            </div>
            <select
              style={{ ...inputStyle }}
              value={binding.source}
              onChange={(e) => updateVar(key, { ...binding, source: e.target.value as "contact" | "static" })}
            >
              <option value="contact">From contact</option>
              <option value="static">Static value</option>
            </select>
            {binding.source === "contact" ? (
              <input
                type="text" style={inputStyle}
                placeholder="field name (e.g. display_name)"
                value={binding.field ?? ""}
                onChange={(e) => updateVar(key, { source: "contact", field: e.target.value })}
              />
            ) : (
              <input
                type="text" style={inputStyle}
                placeholder="static value"
                value={binding.value ?? ""}
                onChange={(e) => updateVar(key, { source: "static", value: e.target.value })}
              />
            )}
            <button
              type="button" onClick={() => removeVar(key)}
              style={{
                width: 26, height: 26, borderRadius: 6, border: "1px solid #fecdd3",
                background: "#fff0f3", color: "#be123c", fontSize: 14,
                cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0
              }}
            >
              ×
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <input
            type="text" style={{ ...inputStyle, width: 140 }}
            placeholder="variable name"
            value={varKey}
            onChange={(e) => setVarKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVar())}
          />
          <button
            type="button" onClick={addVar}
            style={{
              padding: "7px 12px", borderRadius: 6, border: "1px solid #e2eaf4",
              background: "#f8fafc", fontSize: 12, fontWeight: 600, color: "#334155",
              cursor: "pointer", fontFamily: "inherit"
            }}
          >
            + Add Variable
          </button>
        </div>
      </div>
    </div>
  );
}

export function CampaignSettingsForm({ config, steps, onSave, isSaving }: Props) {
  const [sendTime, setSendTime] = useState(config.campaign_send_time.slice(0, 5));
  const [timezone, setTimezone] = useState(config.campaign_timezone);
  const [campaignEnabled, setCampaignEnabled] = useState(config.campaign_enabled);
  const [dispatchMode, setDispatchMode] = useState<"annual" | "exact_date">(config.dispatch_mode);
  const [stepDrafts, setStepDrafts] = useState<StepDraft[]>(
    steps.length > 0 ? steps.map(stepFromRow) : [newStep(1)]
  );

  const updateStep = (i: number, updated: StepDraft) => {
    setStepDrafts((prev) => prev.map((s, idx) => (idx === i ? updated : s)));
  };

  const addStep = () => {
    setStepDrafts((prev) => [...prev, newStep(prev.length + 1)]);
  };

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
      steps: stepDrafts.map((s, i) => ({
        stepOrder: i + 1,
        daysBefore: s.daysBefore,
        templateName: s.templateName,
        templateLang: s.templateLang,
        templateVars: s.templateVars
      }))
    });
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #e2eaf4",
    borderRadius: 6, fontSize: 13, boxSizing: "border-box",
    fontFamily: "inherit", color: "#122033", background: "#fff", outline: "none"
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: "#445068", marginBottom: 4, display: "block"
  };
  const sectionStyle: React.CSSProperties = {
    background: "#f8fafc", border: "1px solid #e2eaf4", borderRadius: 10, padding: 16, marginBottom: 16
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ ...sectionStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          id="campaignEnabled"
          checked={campaignEnabled}
          onChange={(e) => setCampaignEnabled(e.target.checked)}
        />
        <label htmlFor="campaignEnabled" style={{ fontSize: 14, fontWeight: 600, cursor: "pointer", color: "#122033" }}>
          Enable Campaign
        </label>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Dispatch Mode
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {([
            { value: "annual", label: "Annual (recurring)", desc: "Fires every year on same day — birthday, anniversary" },
            { value: "exact_date", label: "One-time event", desc: "Fires once on the exact stored date — deadline, event" }
          ] as const).map((opt) => (
            <button
              key={opt.value} type="button"
              style={{
                padding: "12px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer",
                textAlign: "left",
                border: dispatchMode === opt.value ? "2px solid #2563eb" : "1px solid #e2eaf4",
                background: dispatchMode === opt.value ? "#f0f4ff" : "#fff",
                color: dispatchMode === opt.value ? "#2563eb" : "#445068",
                fontFamily: "inherit"
              }}
              onClick={() => setDispatchMode(opt.value)}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{opt.label}</div>
              <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.4 }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "#122033" }}>
          Send Time
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>Time</label>
            <input
              type="time"
              style={inputStyle}
              value={sendTime}
              onChange={(e) => setSendTime(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Timezone</label>
            <select
              style={inputStyle}
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

      <div style={{ ...sectionStyle, background: "#fff", padding: 0, overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid #edf2f7"
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#122033" }}>
            Campaign Steps
          </div>
          <div style={{ fontSize: 11, color: "#5f6f86" }}>
            {stepDrafts.length} step{stepDrafts.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#5f6f86", marginBottom: 12, lineHeight: 1.5 }}>
            Add one step per message — e.g. 15 days before (teaser), 3 days before (nudge), 0 days (day-of). Each step sends a different template.
          </div>
          {stepDrafts.map((step, i) => (
            <StepEditor
              key={i}
              step={step}
              index={i}
              onChange={(updated) => updateStep(i, updated)}
              onRemove={() => removeStep(i)}
              isOnly={stepDrafts.length === 1}
            />
          ))}
          <button
            type="button" onClick={addStep}
            style={{
              width: "100%", padding: "10px", borderRadius: 8,
              border: "1px dashed #c7d6f7", background: "#f0f4ff",
              fontSize: 12, fontWeight: 600, color: "#2563eb",
              cursor: "pointer", fontFamily: "inherit"
            }}
          >
            + Add Step
          </button>
        </div>
      </div>

      <div style={{ ...sectionStyle, background: "#f0fdf4", border: "1px solid #bbf7d0", marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: "#166534" }}>
          <strong>Duplicate Guard: Always Active</strong> — Each contact receives at most one message per step per year (annual) or one message per step ever (exact date).
        </div>
      </div>

      <button
        type="submit"
        disabled={isSaving}
        style={{
          background: "#25d366", color: "#fff", border: "none",
          borderRadius: 10, padding: "10px 24px", fontSize: 13,
          fontWeight: 700, cursor: isSaving ? "not-allowed" : "pointer",
          opacity: isSaving ? 0.7 : 1, fontFamily: "inherit"
        }}
      >
        {isSaving ? "Saving..." : "Save Campaign Settings"}
      </button>
    </form>
  );
}
