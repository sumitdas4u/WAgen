import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRoutes } from "react-router-dom";
import type {
  ContactField,
  MessageTemplate,
  SequenceCondition,
  SequenceDetail,
  SequenceListItem,
  SequenceWriteConditionInput,
  SequenceWriteInput,
  SequenceWriteStepInput
} from "../../../lib/api";
import { fetchTemplates, listContactFields } from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  buildSequencesQueryOptions,
  useCreateSequenceMutation,
  usePauseSequenceMutation,
  usePublishSequenceMutation,
  useResumeSequenceMutation,
  useSequenceDetailQuery,
  useSequenceEnrollmentsQuery,
  useSequenceLogsQuery,
  useSequencesQuery,
  useUpdateSequenceMutation
} from "./queries";

type ViewMode = "grid" | "list";
type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type SelectOption = { value: string; label: string; disabled?: boolean; hint?: string };
type ConditionFieldType = "text" | "tag" | "phone" | "email" | "number" | "date" | "switch";
type ConditionFieldOption = {
  key: string;
  label: string;
  type: ConditionFieldType;
  operators: SequenceWriteConditionInput["operator"][];
  source: "core" | "custom";
};

const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayKey, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun"
};
const BASE_OPTIONS: SelectOption[] = [
  { value: "contact", label: "Contacts" },
  { value: "deals", label: "Deals", disabled: true, hint: "Coming soon" },
  { value: "orders", label: "Orders", disabled: true, hint: "Coming soon" }
];
const CHANNEL_OPTIONS: SelectOption[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "web", label: "Web Chat", disabled: true, hint: "Coming soon" },
  { value: "email", label: "Email", disabled: true, hint: "Coming soon" }
];
const CONDITION_FIELD_OPTIONS: ConditionFieldOption[] = [
  { key: "tags", label: "Tag", type: "tag", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "name", label: "Name", type: "text", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "phone", label: "Phone", type: "phone", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "email", label: "Email", type: "email", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "contact_type", label: "Contact Type", type: "text", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "source_type", label: "Source Type", type: "text", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "created_at", label: "Created At", type: "date", operators: ["eq", "gt", "lt"], source: "core" },
  { key: "updated_at", label: "Updated At", type: "date", operators: ["eq", "gt", "lt"], source: "core" }
];

const shell = { display: "flex", flexDirection: "column" as const, gap: 18 };
const card = {
  background: "#fff",
  border: "1px solid #dbe4f0",
  borderRadius: 22,
  padding: 20,
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)"
};
const input = {
  width: "100%",
  border: "1px solid #d7dee8",
  borderRadius: 12,
  padding: "11px 12px",
  fontSize: "0.95rem",
  color: "#0f172a",
  background: "#fff"
};
const subtleSurface = {
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  background: "#f8fafc"
};
const ghostBtn = {
  border: "1px solid #d7dee8",
  borderRadius: 999,
  padding: "10px 16px",
  background: "#fff",
  color: "#334155",
  fontWeight: 600,
  cursor: "pointer"
};
const primaryBtn = {
  border: "none",
  borderRadius: 999,
  padding: "10px 18px",
  background: "#0f766e",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer"
};

function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.35rem", color: "#0f172a" }}>{title}</h2>
        {subtitle ? <p style={{ margin: "6px 0 0", color: "#64748b", lineHeight: 1.6 }}>{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

function FieldLabel({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 8, fontWeight: 700, color: "#0f172a" }}>
      <span>{label}</span>
      {children}
      {helper ? <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "#64748b" }}>{helper}</span> : null}
    </label>
  );
}

function StageHeader({ index, title, subtitle }: { index: number; title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ minWidth: 34, height: 34, borderRadius: 999, background: "#ccfbf1", color: "#115e59", display: "grid", placeItems: "center", fontWeight: 800 }}>
        {index}
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: "1rem", color: "#0f172a" }}>{title}</div>
        <div style={{ marginTop: 4, color: "#64748b", lineHeight: 1.6 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function SelectField({
  value,
  options,
  onChange
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <select style={input} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.hint ? `${option.label} (${option.hint})` : option.label}
        </option>
      ))}
    </select>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const [hours, minutes] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes ?? "0"), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDays(days: string[] | undefined) {
  if (!days || days.length === 0 || days.length === DAYS.length) return "All days";
  return days.map((day) => DAY_LABELS[day as DayKey] ?? day).join(", ");
}

function formatDeliverySummary(draft: SequenceWriteInput) {
  const daySummary = formatDays(draft.allowedDays);
  if (draft.timeMode !== "window") {
    return `Messages can go out ${daySummary.toLowerCase()}, any time.`;
  }
  const start = formatTime(draft.timeWindowStart);
  const end = formatTime(draft.timeWindowEnd);
  return `Messages can go out ${daySummary.toLowerCase()} between ${start || "--"} and ${end || "--"}.`;
}

function StatusPill({ status }: { status: string }) {
  const tones: Record<string, { bg: string; bd: string; fg: string }> = {
    published: { bg: "#ecfdf5", bd: "#bbf7d0", fg: "#166534" },
    paused: { bg: "#fff7ed", bd: "#fed7aa", fg: "#c2410c" },
    draft: { bg: "#eff6ff", bd: "#bfdbfe", fg: "#1d4ed8" },
    sent: { bg: "#ecfdf5", bd: "#bbf7d0", fg: "#166534" },
    failed: { bg: "#fff1f2", bd: "#fecdd3", fg: "#be123c" },
    stopped: { bg: "#f8fafc", bd: "#cbd5e1", fg: "#334155" },
    retrying: { bg: "#fff7ed", bd: "#fed7aa", fg: "#c2410c" }
  };
  const tone = tones[status] ?? { bg: "#f8fafc", bd: "#dbe4f0", fg: "#334155" };
  return (
    <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg, fontSize: "0.82rem", fontWeight: 700, textTransform: "capitalize" }}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "7px 11px", borderRadius: 999, background: "#f8fafc", border: "1px solid #dbe4f0", color: "#334155", fontSize: "0.82rem", fontWeight: 700 }}>
      {children}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={card}>
      <div style={{ color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: "1.9rem", fontWeight: 800, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

function buildDefaultPayload(name: string, baseType = "contact", channel = "whatsapp"): SequenceWriteInput {
  return {
    name,
    triggerType: "create",
    channel: channel as "whatsapp",
    baseType: baseType as "contact",
    allowOnce: true,
    requirePreviousDelivery: false,
    retryEnabled: false,
    retryWindowHours: 48,
    allowedDays: [...DAYS],
    timeMode: "any_time",
    steps: [],
    conditions: []
  };
}

function toDraft(detail: SequenceDetail): SequenceWriteInput {
  return {
    name: detail.name,
    triggerType: detail.trigger_type,
    channel: detail.channel,
    baseType: "contact",
    allowOnce: detail.allow_once,
    requirePreviousDelivery: detail.require_previous_delivery,
    retryEnabled: detail.retry_enabled,
    retryWindowHours: detail.retry_window_hours,
    allowedDays: detail.allowed_days_json,
    timeMode: detail.time_mode,
    timeWindowStart: detail.time_window_start,
    timeWindowEnd: detail.time_window_end,
    steps: detail.steps.map((step) => ({
      id: step.id,
      stepOrder: step.step_order,
      delayValue: step.delay_value,
      delayUnit: step.delay_unit,
      messageTemplateId: step.message_template_id,
      customDelivery: step.custom_delivery_json
    })),
    conditions: detail.conditions.map((condition) => ({
      id: condition.id,
      conditionType: condition.condition_type,
      field: condition.field,
      operator: condition.operator,
      value: condition.value
    }))
  };
}

function getConditionOperatorsForFieldType(type: ConditionFieldType): SequenceWriteConditionInput["operator"][] {
  switch (type) {
    case "number":
      return ["eq", "neq", "gt", "lt"];
    case "date":
      return ["eq", "gt", "lt"];
    case "switch":
      return ["eq", "neq"];
    default:
      return ["contains", "eq", "neq"];
  }
}

function mapContactFieldToConditionOption(field: ContactField): ConditionFieldOption {
  const typeMap: Record<ContactField["field_type"], ConditionFieldType> = {
    TEXT: "text",
    MULTI_TEXT: "text",
    NUMBER: "number",
    SWITCH: "switch",
    DATE: "date"
  };

  const type = typeMap[field.field_type] ?? "text";

  return {
    key: `custom:${field.name}`,
    label: field.label,
    type,
    operators: getConditionOperatorsForFieldType(type),
    source: "custom"
  };
}

function getConditionFieldMeta(field: string, options: ConditionFieldOption[]) {
  return options.find((option) => option.key === field) ?? null;
}

function getConditionFieldKey(condition: SequenceWriteConditionInput, options: ConditionFieldOption[]) {
  return getConditionFieldMeta(condition.field, options)?.key ?? "custom_field";
}

function getOperatorsForField(fieldKey: string, options: ConditionFieldOption[]): SequenceWriteConditionInput["operator"][] {
  if (fieldKey === "custom_field") return ["contains", "eq", "neq", "gt", "lt"];
  return getConditionFieldMeta(fieldKey, options)?.operators ?? ["contains", "eq", "neq"];
}

function getOperatorLabel(operator: SequenceWriteConditionInput["operator"]) {
  const labels: Record<SequenceWriteConditionInput["operator"], string> = {
    contains: "contains",
    eq: "equals",
    neq: "does not equal",
    gt: "is greater than",
    lt: "is less than"
  };
  return labels[operator];
}

function getConditionPreview(prefix: string, condition: SequenceWriteConditionInput, options: ConditionFieldOption[]) {
  const fieldKey = getConditionFieldKey(condition, options);
  const fieldLabel = fieldKey === "custom_field" ? condition.field || "custom field" : getConditionFieldMeta(condition.field, options)?.label ?? condition.field;
  const value = condition.value || "a value";
  return `${prefix} when ${fieldLabel} ${getOperatorLabel(condition.operator)} ${value}`.replace(/\s+/g, " ");
}

function getStepTitle(step: SequenceWriteStepInput, index: number) {
  const title = typeof step.customDelivery?.stepTitle === "string" ? step.customDelivery.stepTitle : "";
  return title || `Untitled Step ${index + 1}`;
}

function getSequenceValidationErrors(draft: SequenceWriteInput) {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Sequence name is required.");
  if (!draft.steps || draft.steps.length === 0) errors.push("Add at least one step before publishing.");
  if (draft.timeMode === "window" && (!draft.timeWindowStart || !draft.timeWindowEnd)) errors.push("Select both a start and end time for the delivery window.");
  if ((draft.conditions ?? []).some((condition) => !condition.field.trim() || !condition.value.trim())) errors.push("Complete or remove any unfinished condition rows.");
  if ((draft.steps ?? []).some((step) => !step.messageTemplateId)) errors.push("Choose a template for every step.");
  return errors;
}

function SequenceListPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const sequences = useSequencesQuery(token).data ?? [];
  const summary = useMemo(() => ({
    active: sequences.filter((item) => item.active_count > 0).length,
    published: sequences.filter((item) => item.status === "published").length,
    paused: sequences.filter((item) => item.status === "paused").length,
    completed: sequences.reduce((sum, item) => sum + item.completed_count, 0),
    failed: sequences.reduce((sum, item) => sum + item.failed_count, 0)
  }), [sequences]);

  return (
    <section style={shell}>
      <div style={card}>
        <SectionHeader
          title="Sequence"
          subtitle="Automate timed WhatsApp follow-ups and trigger-based journeys."
          right={
            <div style={{ display: "flex", gap: 12 }}>
              <button type="button" style={ghostBtn} onClick={() => setViewMode((current) => (current === "grid" ? "list" : "grid"))}>
                {viewMode === "grid" ? "List" : "Grid"}
              </button>
              <button type="button" style={primaryBtn} onClick={() => navigate("/dashboard/sequence/new")}>Create Sequence</button>
            </div>
          }
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
        <StatCard label="Active" value={summary.active} />
        <StatCard label="Published" value={summary.published} />
        <StatCard label="Paused" value={summary.paused} />
        <StatCard label="Completed" value={summary.completed} />
        <StatCard label="Failed enrollments" value={summary.failed} />
      </div>
      {viewMode === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <button type="button" onClick={() => navigate("/dashboard/sequence/new")} style={{ ...card, borderStyle: "dashed", minHeight: 210, display: "grid", placeItems: "center", color: "#0f766e", fontWeight: 700, cursor: "pointer" }}>
            Create new sequence
          </button>
          {sequences.map((sequence) => <SequenceTile key={sequence.id} sequence={sequence} onOpen={() => navigate(`/dashboard/sequence/${sequence.id}`)} />)}
        </div>
      ) : (
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Sequence", "Status", "Trigger", "Steps", "Enrolled", "Completed", "Created", "Action"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", paddingBottom: 12, color: "#64748b", fontSize: "0.82rem" }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sequences.map((sequence) => (
                <tr key={sequence.id} style={{ borderTop: "1px solid #eef2f7" }}>
                  <td style={{ padding: "14px 0", fontWeight: 700 }}>{sequence.name}</td>
                  <td><StatusPill status={sequence.status} /></td>
                  <td>{sequence.trigger_type}</td>
                  <td>{sequence.steps_count}</td>
                  <td>{sequence.enrolled_count}</td>
                  <td>{sequence.completed_count}</td>
                  <td>{formatDateTime(sequence.created_at)}</td>
                  <td><button type="button" style={ghostBtn} onClick={() => navigate(`/dashboard/sequence/${sequence.id}`)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SequenceTile({ sequence, onOpen }: { sequence: SequenceListItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>{sequence.name}</div>
          <div style={{ marginTop: 8 }}><StatusPill status={sequence.status} /></div>
        </div>
        <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>{formatDateTime(sequence.created_at)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, marginTop: 18 }}>
        <Mini label="Trigger" value={sequence.trigger_type} />
        <Mini label="Steps" value={String(sequence.steps_count)} />
        <Mini label="Enrolled" value={String(sequence.enrolled_count)} />
        <Mini label="Completed" value={String(sequence.completed_count)} />
      </div>
    </button>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><div style={{ color: "#64748b", fontSize: "0.8rem" }}>{label}</div><div style={{ marginTop: 4, fontWeight: 700 }}>{value}</div></div>;
}

function SequenceCreatePage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [baseType, setBaseType] = useState("contact");
  const [channel, setChannel] = useState("whatsapp");
  const createMutation = useCreateSequenceMutation(token);
  const canContinue = Boolean(name.trim() && baseType && channel);

  return (
    <section style={shell}>
      <div style={{ ...card, display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(320px, 0.9fr)", gap: 24 }}>
        <div style={{ display: "grid", gap: 22 }}>
          <SectionHeader title="Create Sequence" subtitle="Start with the basics, then define who enters, when messages send, and what each step should do." />
          <div style={{ display: "grid", gap: 18 }}>
            <StageHeader index={1} title="Basics" subtitle="Choose the audience source and sending channel for this sequence." />
            <FieldLabel label="Sequence Name *">
              <input style={input} value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter a sequence name" />
            </FieldLabel>
            <FieldLabel label="Sequence Based on *" helper="Contacts are supported in MVP. More sources will appear here later.">
              <SelectField value={baseType} options={BASE_OPTIONS} onChange={setBaseType} />
            </FieldLabel>
            <FieldLabel label="Send from *" helper="WhatsApp template sequences are supported in MVP.">
              <SelectField value={channel} options={CHANNEL_OPTIONS} onChange={setChannel} />
            </FieldLabel>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={() => navigate("/dashboard/sequence")}>Back</button>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: canContinue ? 1 : 0.55 }}
              disabled={!canContinue || createMutation.isPending}
              onClick={async () => {
                const sequence = await createMutation.mutateAsync(buildDefaultPayload(name.trim(), baseType, channel));
                navigate(`/dashboard/sequence/${sequence.id}`);
              }}
            >
              {createMutation.isPending ? "Creating..." : "Continue to builder"}
            </button>
          </div>
        </div>
        <div style={{ ...card, background: "linear-gradient(180deg, #ecfeff 0%, #f8fafc 100%)", borderColor: "#bae6fd", display: "grid", gap: 16 }}>
          <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1.15rem" }}>How Sequence works</h3>
          <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
            Build a guided WhatsApp follow-up journey that reacts to customer activity and sends approved templates on your schedule.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              "Pick the source and send channel",
              "Decide who should enter the sequence",
              "Choose when messages can go out",
              "Add step delays and templates",
              "Publish when the sequence is ready"
            ].map((item, index) => (
              <div key={item} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 26, height: 26, borderRadius: 999, background: "#ccfbf1", color: "#115e59", display: "grid", placeItems: "center", fontWeight: 800 }}>{index + 1}</div>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function BuilderPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const detail = useSequenceDetailQuery(token, sequenceId ?? "").data;
  const enrollments = useSequenceEnrollmentsQuery(token, sequenceId ?? "").data ?? [];
  const updateMutation = useUpdateSequenceMutation(token, sequenceId ?? "");
  const publishMutation = usePublishSequenceMutation(token, sequenceId ?? "");
  const pauseMutation = usePauseSequenceMutation(token, sequenceId ?? "");
  const resumeMutation = useResumeSequenceMutation(token, sequenceId ?? "");
  const templates = useQuery({
    queryKey: dashboardQueryKeys.templates,
    queryFn: () => fetchTemplates(token).then((response) => response.templates.filter((item) => item.status === "APPROVED")),
    enabled: Boolean(token)
  }).data ?? [];
  const contactFieldDefinitions = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields.filter((field) => field.is_active)),
    enabled: Boolean(token)
  }).data ?? [];
  const [draft, setDraft] = useState<SequenceWriteInput | null>(null);
  const selectedEnrollment = enrollments[0] ?? null;
  const logs = useSequenceLogsQuery(token, selectedEnrollment?.id ?? "").data ?? [];

  useEffect(() => {
    if (detail) {
      setDraft((current) => current ?? toDraft(detail));
    }
  }, [detail]);

  const conditionFieldOptions = useMemo(
    () => [...CONDITION_FIELD_OPTIONS, ...contactFieldDefinitions.map(mapContactFieldToConditionOption)],
    [contactFieldDefinitions]
  );

  if (!detail || !draft) return <div style={card}>Loading sequence...</div>;

  const setConditions = (conditionType: SequenceCondition["condition_type"], next: SequenceWriteConditionInput[]) =>
    setDraft((current) => current ? { ...current, conditions: [...(current.conditions ?? []).filter((item) => item.conditionType !== conditionType), ...next] } : current);

  const validationErrors = getSequenceValidationErrors(draft);
  const saveDraft = async () => { await updateMutation.mutateAsync(draft); };

  return (
    <section style={shell}>
      <div style={{ ...card, position: "sticky", top: 12, zIndex: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 10, minWidth: 320 }}>
            <input style={{ ...input, border: "none", padding: 0, fontSize: "1.45rem", fontWeight: 800 }} value={draft.name} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <StatusPill status={detail.status} />
              <Chip>Based on Contacts</Chip>
              <Chip>Send via WhatsApp</Chip>
              <Chip>Trigger: {draft.triggerType}</Chip>
              <Chip>{formatDays(draft.allowedDays)}</Chip>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={() => setDraft(toDraft(detail))}>Reset draft</button>
            <button type="button" style={ghostBtn} onClick={() => void saveDraft()}>{updateMutation.isPending ? "Saving..." : "Save"}</button>
            {detail.status === "published" ? <button type="button" style={ghostBtn} onClick={() => void pauseMutation.mutateAsync()}>Pause</button> : null}
            {detail.status === "paused" ? <button type="button" style={ghostBtn} onClick={() => void resumeMutation.mutateAsync()}>Resume</button> : null}
            {detail.status !== "published" ? (
              <button
                type="button"
                style={{ ...primaryBtn, opacity: validationErrors.length === 0 ? 1 : 0.72 }}
                onClick={async () => {
                  if (validationErrors.length > 0) return;
                  await saveDraft();
                  await publishMutation.mutateAsync();
                  navigate("/dashboard/sequence");
                }}
              >
                Publish & Close
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {validationErrors.length > 0 ? (
        <div style={{ ...card, borderColor: "#fed7aa", background: "#fffaf0" }}>
          <SectionHeader title="Before you publish" subtitle="A few details still need attention." />
          <div style={{ marginTop: 14, display: "grid", gap: 8, color: "#9a3412" }}>
            {validationErrors.map((error) => <div key={error}>• {error}</div>)}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(320px, 0.85fr)", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <BasicsEditor draft={draft} setDraft={setDraft} />
          <TriggerEditor draft={draft} setDraft={setDraft} setConditions={setConditions} fieldOptions={conditionFieldOptions} />
          <DeliveryEditor draft={draft} setDraft={setDraft} />
          <StepsEditor draft={draft} setDraft={setDraft} templates={templates} />
        </div>
        <div style={{ display: "grid", gap: 18 }}>
          <ReviewPanel draft={draft} />
          <ActivityPanel detail={detail} enrollments={enrollments} logs={logs} />
        </div>
      </div>
    </section>
  );
}

function BasicsEditor({ draft, setDraft }: { draft: SequenceWriteInput; setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>> }) {
  return (
    <div style={card}>
      <SectionHeader title="Basics" subtitle="These settings define where this sequence starts and how it will send." />
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <FieldLabel label="Sequence Based on *" helper="Only Contacts are available in the MVP backend.">
          <SelectField value={draft.baseType ?? "contact"} options={BASE_OPTIONS} onChange={(value) => setDraft((current) => current ? { ...current, baseType: value as "contact" } : current)} />
        </FieldLabel>
        <FieldLabel label="Send from *" helper="Only WhatsApp templates are supported right now.">
          <SelectField value={draft.channel ?? "whatsapp"} options={CHANNEL_OPTIONS} onChange={(value) => setDraft((current) => current ? { ...current, channel: value as "whatsapp" } : current)} />
        </FieldLabel>
      </div>
    </div>
  );
}

function TriggerEditor({
  draft,
  setDraft,
  setConditions,
  fieldOptions
}: {
  draft: SequenceWriteInput;
  setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>;
  setConditions: (type: SequenceCondition["condition_type"], next: SequenceWriteConditionInput[]) => void;
  fieldOptions: ConditionFieldOption[];
}) {
  const start = (draft.conditions ?? []).filter((item) => item.conditionType === "start");
  const success = (draft.conditions ?? []).filter((item) => item.conditionType === "stop_success");
  const failure = (draft.conditions ?? []).filter((item) => item.conditionType === "stop_failure");

  return (
    <div style={card}>
      <SectionHeader title="Trigger & conditions" subtitle="Choose when contacts enter the sequence and what should stop it later." />
      <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
        <div style={{ ...subtleSurface, padding: 16 }}>
          <div style={{ color: "#475569", fontWeight: 700, marginBottom: 12 }}>Who should enter this sequence?</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              ["create", "On create"],
              ["update", "On update"],
              ["both", "Both (create & update)"]
            ].map(([value, label]) => {
              const active = draft.triggerType === value;
              return (
                <button
                  key={value}
                  type="button"
                  style={{
                    ...ghostBtn,
                    background: active ? "#ecfdf5" : "#fff",
                    borderColor: active ? "#99f6e4" : "#d7dee8",
                    color: active ? "#115e59" : "#334155"
                  }}
                  onClick={() => setDraft((current) => current ? { ...current, triggerType: value as SequenceWriteInput["triggerType"] } : current)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <ConditionGroupCard
          title="Start conditions"
          emptyText="No start rules yet. Add a rule to control who enters this sequence."
          previewPrefix="Start"
          conditions={start}
          fieldOptions={fieldOptions}
          onChange={(next) => setConditions("start", next.map((item) => ({ ...item, conditionType: "start" })))}
        />
        <ConditionGroupCard
          title="Stop on success"
          emptyText="No stop-on-success rules yet. Add a rule for conditions that should end the sequence after a positive outcome."
          previewPrefix="Stop"
          conditions={success}
          fieldOptions={fieldOptions}
          onChange={(next) => setConditions("stop_success", next.map((item) => ({ ...item, conditionType: "stop_success" })))}
        />
        <ConditionGroupCard
          title="Stop on failure"
          emptyText="No stop-on-failure rules yet. Add a rule for conditions that should stop the sequence after an unsuccessful outcome."
          previewPrefix="Stop"
          conditions={failure}
          fieldOptions={fieldOptions}
          onChange={(next) => setConditions("stop_failure", next.map((item) => ({ ...item, conditionType: "stop_failure" })))}
        />
      </div>
    </div>
  );
}

function ConditionGroupCard({
  title,
  emptyText,
  previewPrefix,
  conditions,
  fieldOptions,
  onChange
}: {
  title: string;
  emptyText: string;
  previewPrefix: string;
  conditions: SequenceWriteConditionInput[];
  fieldOptions: ConditionFieldOption[];
  onChange: (next: SequenceWriteConditionInput[]) => void;
}) {
  const defaultField = fieldOptions[0];
  const addCondition = () => onChange([...conditions, { conditionType: "start", field: defaultField?.key ?? "tags", operator: defaultField?.operators[0] ?? "contains", value: "" }]);

  return (
    <div style={{ ...subtleSurface, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>{title}</div>
          <div style={{ marginTop: 4, color: "#64748b", fontSize: "0.9rem" }}>{emptyText}</div>
        </div>
        <button type="button" style={ghostBtn} onClick={addCondition}>+ Add rule</button>
      </div>
      {conditions.length === 0 ? null : (
        <div style={{ display: "grid", gap: 12 }}>
          {conditions.map((condition, index) => (
            <ConditionRow
              key={`${title}-${index}`}
              condition={condition}
              previewPrefix={previewPrefix}
              fieldOptions={fieldOptions}
              onChange={(nextCondition) => onChange(conditions.map((item, itemIndex) => itemIndex === index ? nextCondition : item))}
              onRemove={() => onChange(conditions.filter((_, itemIndex) => itemIndex !== index))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionRow({
  condition,
  previewPrefix,
  fieldOptions,
  onChange,
  onRemove
}: {
  condition: SequenceWriteConditionInput;
  previewPrefix: string;
  fieldOptions: ConditionFieldOption[];
  onChange: (next: SequenceWriteConditionInput) => void;
  onRemove: () => void;
}) {
  const fieldKey = getConditionFieldKey(condition, fieldOptions);
  const operators = getOperatorsForField(fieldKey, fieldOptions);
  const fieldMeta = fieldKey === "custom_field" ? null : getConditionFieldMeta(condition.field, fieldOptions);

  useEffect(() => {
    if (!operators.includes(condition.operator)) {
      onChange({ ...condition, operator: operators[0] });
    }
  }, [condition, onChange, operators]);

  return (
    <div style={{ ...card, borderRadius: 18, boxShadow: "none", padding: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "start" }}>
        <select
          style={input}
          value={fieldKey}
          onChange={(event) => {
            const nextFieldKey = event.target.value;
            const nextOperators = getOperatorsForField(nextFieldKey, fieldOptions);
            onChange({
              ...condition,
              field: nextFieldKey === "custom_field" ? "" : nextFieldKey,
              operator: nextOperators[0]
            });
          }}
        >
          <optgroup label="Contact fields">
            {fieldOptions.filter((option) => option.source === "core").map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </optgroup>
          {fieldOptions.some((option) => option.source === "custom") ? (
            <optgroup label="Custom fields">
              {fieldOptions.filter((option) => option.source === "custom").map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </optgroup>
          ) : null}
          <option value="custom_field">Custom field</option>
        </select>
        <select style={input} value={condition.operator} onChange={(event) => onChange({ ...condition, operator: event.target.value as SequenceWriteConditionInput["operator"] })}>
          {operators.map((operator) => <option key={operator} value={operator}>{getOperatorLabel(operator)}</option>)}
        </select>
        {fieldKey === "custom_field" ? (
          <input style={input} value={condition.field} onChange={(event) => onChange({ ...condition, field: event.target.value })} placeholder="Custom field name" />
        ) : null}
        <input
          style={input}
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          placeholder={fieldMeta?.type === "tag" ? "VIP" : "Value"}
        />
        <button type="button" style={ghostBtn} onClick={onRemove}>Remove</button>
      </div>
      <div style={{ marginTop: 10, color: "#0f766e", fontSize: "0.9rem", fontWeight: 600 }}>
        {getConditionPreview(previewPrefix, condition, fieldOptions)}
      </div>
    </div>
  );
}

function DeliveryEditor({ draft, setDraft }: { draft: SequenceWriteInput; setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>> }) {
  const toggleDay = (day: DayKey) => setDraft((current) => current ? { ...current, allowedDays: (current.allowedDays ?? []).includes(day) ? (current.allowedDays ?? []).filter((item) => item !== day) : [...(current.allowedDays ?? []), day] } : current);
  const allDaysSelected = (draft.allowedDays ?? []).length === DAYS.length;

  return (
    <div style={card}>
      <SectionHeader title="Delivery preferences" subtitle="Decide when messages can be sent and how the sequence should behave after each attempt." />
      <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
        <div style={{ ...subtleSurface, padding: 16, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, color: "#0f172a" }}>Retry failed sends</div>
              <div style={{ marginTop: 4, color: "#64748b" }}>Messages can retry within the configured 48-hour window to improve delivery rate.</div>
            </div>
            <input type="checkbox" checked={draft.retryEnabled ?? false} onChange={(event) => setDraft((current) => current ? { ...current, retryEnabled: event.target.checked } : current)} />
          </div>
          <div>
            <div style={{ fontWeight: 800, color: "#0f172a" }}>Which days can messages go out?</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" style={{ ...ghostBtn, background: allDaysSelected ? "#ecfdf5" : "#fff", borderColor: allDaysSelected ? "#99f6e4" : "#d7dee8" }} onClick={() => setDraft((current) => current ? { ...current, allowedDays: [...DAYS] } : current)}>All days</button>
              {DAYS.map((day) => {
                const active = (draft.allowedDays ?? []).includes(day);
                return (
                  <button key={day} type="button" style={{ ...ghostBtn, background: active ? "#ecfdf5" : "#fff", borderColor: active ? "#99f6e4" : "#d7dee8" }} onClick={() => toggleDay(day)}>
                    {DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 800, color: "#0f172a" }}>What time should messages go out?</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...ghostBtn, background: draft.timeMode !== "window" ? "#ecfdf5" : "#fff", borderColor: draft.timeMode !== "window" ? "#99f6e4" : "#d7dee8" }}
                onClick={() => setDraft((current) => current ? { ...current, timeMode: "any_time" } : current)}
              >
                Any time
              </button>
              <button
                type="button"
                style={{ ...ghostBtn, background: draft.timeMode === "window" ? "#ecfdf5" : "#fff", borderColor: draft.timeMode === "window" ? "#99f6e4" : "#d7dee8" }}
                onClick={() => setDraft((current) => current ? { ...current, timeMode: "window" } : current)}
              >
                Between specific hours
              </button>
            </div>
            {draft.timeMode === "window" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <FieldLabel label="Start time">
                  <input style={input} type="time" value={draft.timeWindowStart ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, timeWindowStart: event.target.value } : current)} />
                </FieldLabel>
                <FieldLabel label="End time">
                  <input style={input} type="time" value={draft.timeWindowEnd ?? ""} onChange={(event) => setDraft((current) => current ? { ...current, timeWindowEnd: event.target.value } : current)} />
                </FieldLabel>
              </div>
            ) : null}
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: "#ffffff", border: "1px solid #e2e8f0", color: "#0f766e", fontWeight: 700 }}>
            {formatDeliverySummary(draft)}
          </div>
        </div>
        <div style={{ ...subtleSurface, padding: 16, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>Sequence behavior</div>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={draft.allowOnce ?? false} onChange={(event) => setDraft((current) => current ? { ...current, allowOnce: event.target.checked } : current)} />
            Allow contacts to enter this sequence only once
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="checkbox" checked={draft.requirePreviousDelivery ?? false} onChange={(event) => setDraft((current) => current ? { ...current, requirePreviousDelivery: event.target.checked } : current)} />
            Continue sequence only after the previous message is delivered
          </label>
        </div>
      </div>
    </div>
  );
}

function StepsEditor({ draft, setDraft, templates }: { draft: SequenceWriteInput; setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>; templates: MessageTemplate[] }) {
  const steps = draft.steps ?? [];
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const updateStep = (index: number, patch: Partial<SequenceWriteStepInput>) =>
    setDraft((current) => current ? { ...current, steps: (current.steps ?? []).map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) } : current);

  const addStep = () =>
    setDraft((current) => current ? {
      ...current,
      steps: [
        ...(current.steps ?? []),
        {
          stepOrder: (current.steps ?? []).length,
          delayValue: 1,
          delayUnit: "hours",
          messageTemplateId: templates[0]?.id ?? "",
          customDelivery: { stepTitle: "" }
        }
      ]
    } : current);

  const removeStep = (index: number) =>
    setDraft((current) => current ? { ...current, steps: (current.steps ?? []).filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({ ...step, stepOrder: stepIndex })) } : current);

  const moveStep = (index: number, delta: -1 | 1) => setDraft((current) => {
    if (!current) return current;
    const next = [...(current.steps ?? [])];
    const target = index + delta;
    if (target < 0 || target >= next.length) return current;
    const [step] = next.splice(index, 1);
    next.splice(target, 0, step);
    return { ...current, steps: next.map((item, itemIndex) => ({ ...item, stepOrder: itemIndex })) };
  });

  const duplicate = (index: number) => setDraft((current) => current ? {
    ...current,
    steps: [
      ...(current.steps ?? []).slice(0, index + 1),
      { ...(current.steps ?? [])[index], id: undefined, customDelivery: { ...((current.steps ?? [])[index].customDelivery ?? {}) } },
      ...(current.steps ?? []).slice(index + 1)
    ].map((step, stepIndex) => ({ ...step, stepOrder: stepIndex }))
  } : current);

  return (
    <div style={card}>
      <SectionHeader title="Sequence steps" subtitle="Define what should happen next and how long to wait between sends." right={<button type="button" style={primaryBtn} onClick={addStep}>{steps.length === 0 ? "Add first step" : "Add step"}</button>} />
      {steps.length === 0 ? (
        <div style={{ ...subtleSurface, padding: 20, marginTop: 18, display: "grid", gap: 12, textAlign: "center" }}>
          <div style={{ fontWeight: 800, color: "#0f172a" }}>No steps yet</div>
          <div style={{ color: "#64748b" }}>Add the first step to choose a delay and pick the WhatsApp template that should send.</div>
          <div><button type="button" style={primaryBtn} onClick={addStep}>Add first step</button></div>
        </div>
      ) : (
        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          {steps.map((step, index) => {
            const isCollapsed = Boolean(collapsed[index]);
            const templateName = templates.find((template) => template.id === step.messageTemplateId)?.name ?? "No template selected";
            return (
              <div key={`${step.id ?? "draft"}-${index}`} style={{ display: "grid", gap: 12 }}>
                {index > 0 ? (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <Chip>After {step.delayValue} {step.delayUnit}</Chip>
                  </div>
                ) : null}
                <div style={{ ...card, borderRadius: 18, boxShadow: "none", borderColor: "#cbd5e1" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ width: 34, height: 34, borderRadius: 999, background: "#e2e8f0", color: "#334155", display: "grid", placeItems: "center", fontWeight: 800 }}>
                        {index + 1}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, color: "#0f172a" }}>{getStepTitle(step, index)}</div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: "0.9rem" }}>{index === 0 ? "From enrollment" : "From previous step"} • {templateName}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" style={ghostBtn} onClick={() => moveStep(index, -1)}>Up</button>
                      <button type="button" style={ghostBtn} onClick={() => moveStep(index, 1)}>Down</button>
                      <button type="button" style={ghostBtn} onClick={() => duplicate(index)}>Duplicate</button>
                      <button type="button" style={ghostBtn} onClick={() => removeStep(index)}>Delete</button>
                      <button type="button" style={ghostBtn} onClick={() => setCollapsed((current) => ({ ...current, [index]: !current[index] }))}>{isCollapsed ? "Expand" : "Collapse"}</button>
                    </div>
                  </div>
                  {!isCollapsed ? (
                    <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
                      <FieldLabel label="Step title">
                        <input
                          style={input}
                          value={typeof step.customDelivery?.stepTitle === "string" ? step.customDelivery.stepTitle : ""}
                          onChange={(event) => updateStep(index, { customDelivery: { ...(step.customDelivery ?? {}), stepTitle: event.target.value } })}
                          placeholder={`Untitled Step ${index + 1}`}
                        />
                      </FieldLabel>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                        <FieldLabel label="Send after">
                          <input style={input} type="number" min={0} value={step.delayValue} onChange={(event) => updateStep(index, { delayValue: Number(event.target.value) })} />
                        </FieldLabel>
                        <FieldLabel label="Unit">
                          <select style={input} value={step.delayUnit} onChange={(event) => updateStep(index, { delayUnit: event.target.value as SequenceWriteStepInput["delayUnit"] })}>
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </FieldLabel>
                        <FieldLabel label="Relative to">
                          <input style={{ ...input, background: "#f8fafc" }} value={index === 0 ? "From enrollment" : "From previous step"} readOnly />
                        </FieldLabel>
                      </div>
                      <FieldLabel label="Send message *">
                        <select style={input} value={step.messageTemplateId} onChange={(event) => updateStep(index, { messageTemplateId: event.target.value })}>
                          <option value="">Pick a template</option>
                          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                        </select>
                      </FieldLabel>
                      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <input type="checkbox" checked={Boolean(step.customDelivery?.enabled)} onChange={(event) => updateStep(index, { customDelivery: { ...(step.customDelivery ?? {}), enabled: event.target.checked } })} />
                        Set custom delivery preference
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewPanel({ draft }: { draft: SequenceWriteInput }) {
  const startConditions = (draft.conditions ?? []).filter((item) => item.conditionType === "start");

  return (
    <div style={card}>
      <SectionHeader title="Review" subtitle="A quick summary of who enters, when messages go out, and what happens next." />
      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        <ReviewBlock title="Who can enter?" value={startConditions.length > 0 ? `${startConditions.length} start rule${startConditions.length > 1 ? "s" : ""}` : "Anyone matching the selected trigger"} />
        <ReviewBlock title="When do messages send?" value={formatDeliverySummary(draft)} />
        <ReviewBlock title="What happens next?" value={`${draft.steps?.length ?? 0} step${(draft.steps?.length ?? 0) === 1 ? "" : "s"} configured`} />
        <ReviewBlock title="Retry" value={draft.retryEnabled ? "Enabled" : "Off"} />
      </div>
    </div>
  );
}

function ReviewBlock({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ ...subtleSurface, padding: 14 }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</div>
      <div style={{ marginTop: 6, color: "#0f172a", fontWeight: 700, lineHeight: 1.6 }}>{value}</div>
    </div>
  );
}

function ActivityPanel({
  detail,
  enrollments,
  logs
}: {
  detail: SequenceDetail;
  enrollments: Array<{ id: string; status: string; entered_at: string; current_step: number }>;
  logs: Array<{ id: string; status: string; created_at: string; error_message: string | null }>;
}) {
  return (
    <div style={card}>
      <SectionHeader title="Review / activity" subtitle="Authoring controls stay on the left. Recent enrollment activity stays here for quick reference." />
      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <Mini label="Enrolled" value={String(detail.metrics.enrolled)} />
        <Mini label="Active" value={String(detail.metrics.active)} />
        <Mini label="Completed" value={String(detail.metrics.completed)} />
        <Mini label="Failed" value={String(detail.metrics.failed)} />
      </div>
      <div style={{ marginTop: 20 }}>
        <strong>Recent enrollments</strong>
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {enrollments.slice(0, 4).map((enrollment) => (
            <div key={enrollment.id} style={{ padding: 12, borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <StatusPill status={enrollment.status} />
                <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{formatDateTime(enrollment.entered_at)}</span>
              </div>
              <div style={{ marginTop: 6, color: "#475569" }}>Step {enrollment.current_step + 1}</div>
            </div>
          ))}
          {enrollments.length === 0 ? <div style={{ color: "#94a3b8" }}>No enrollments yet.</div> : null}
        </div>
      </div>
      {logs.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <strong>Latest logs</strong>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {logs.slice(0, 4).map((log) => (
              <div key={log.id} style={{ padding: 12, borderRadius: 14, background: "#fff", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <StatusPill status={log.status} />
                  <span style={{ color: "#64748b", fontSize: "0.82rem" }}>{formatDateTime(log.created_at)}</span>
                </div>
                {log.error_message ? <div style={{ marginTop: 8, color: "#be123c" }}>{log.error_message}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Component() {
  const { token } = useDashboardShell();
  return useRoutes([
    { index: true, element: <SequenceListPage token={token} /> },
    { path: "new", element: <SequenceCreatePage token={token} /> },
    { path: ":sequenceId", element: <BuilderPage token={token} /> }
  ]);
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildSequencesQueryOptions(token));
}
