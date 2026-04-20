import { useEffect, useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useRoutes } from "react-router-dom";
import type {
  CampaignMediaOverrides,
  CampaignTemplateVariableBinding,
  CampaignTemplateVariables,
  ContactField,
  ContactRecord,
  MessageTemplate,
  SequenceCondition,
  SequenceDetail,
  SequenceListItem,
  SequenceWriteConditionInput,
  SequenceWriteInput,
  SequenceWriteStepInput
} from "../../../lib/api";
import { fetchContacts, fetchTemplates, listContactFields } from "../../../lib/api";
import { uploadSequenceMedia } from "../../../lib/supabase";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { MetaConnectionSelector, isMetaConnectionActive } from "../../../shared/dashboard/meta-connection-selector";
import { TemplatePreviewPanel } from "../templates/TemplatePreviewPanel";
import {
  buildSequencesQueryOptions,
  useCreateSequenceMutation,
  useDeleteSequenceMutation,
  usePauseSequenceMutation,
  usePublishSequenceMutation,
  useResumeSequenceMutation,
  useSequenceDetailQuery,
  useSequenceEnrollmentsQuery,
  useSequencesQuery,
  useUpdateSequenceMutation
} from "./queries";
import { SequenceReportPage } from "./SequenceReportPage";
import "./sequence.css";

/* ─────────────────────────────────────────────
   Types & constants
───────────────────────────────────────────── */
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
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
  fri: "Fri", sat: "Sat", sun: "Sun"
};

const BASE_OPTIONS: SelectOption[] = [
  { value: "contact", label: "Contacts" },
  { value: "deals",   label: "Deals",  disabled: true, hint: "Coming soon" },
  { value: "orders",  label: "Orders", disabled: true, hint: "Coming soon" }
];

const CHANNEL_OPTIONS: SelectOption[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "web",      label: "Web Chat", disabled: true, hint: "Coming soon" },
  { value: "email",    label: "Email",    disabled: true, hint: "Coming soon" }
];

const SEQUENCE_STANDARD_VARIABLE_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "display_name",  label: "Contact name" },
  { value: "phone_number",  label: "Phone number" },
  { value: "email",         label: "Email" },
  { value: "contact_type",  label: "Contact type" },
  { value: "tags",          label: "Tags" },
  { value: "source_type",   label: "Source type" },
  { value: "source_id",     label: "Source ID" },
  { value: "source_url",    label: "Source URL" }
];

function extractTemplatePlaceholders(template: MessageTemplate | null): string[] {
  if (!template) return [];
  return Array.from(
    new Set(
      [...JSON.stringify(template.components).matchAll(/\{\{[^}]+\}\}/g)]
        .map((m) => m[0])
        .sort((a, b) => a.localeCompare(b))
    )
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveSequenceContactFieldValue(contact: ContactRecord | null, field: string | undefined): string {
  if (!contact || !field) {
    return "";
  }

  switch (field) {
    case "display_name":
      return contact.display_name ?? "";
    case "phone_number":
      return contact.phone_number ?? "";
    case "email":
      return contact.email ?? "";
    case "contact_type":
      return contact.contact_type ?? "";
    case "tags":
      return contact.tags.join(", ");
    case "source_type":
      return contact.source_type ?? "";
    case "source_id":
      return contact.source_id ?? "";
    case "source_url":
      return contact.source_url ?? "";
    case "created_at":
      return contact.created_at ?? "";
    case "updated_at":
      return contact.updated_at ?? "";
    default:
      break;
  }

  if (!field.startsWith("custom:")) {
    return "";
  }

  const customField = field.slice("custom:".length).trim().toLowerCase();
  return (
    contact.custom_field_values.find((item) => item.field_name.toLowerCase() === customField)?.value ?? ""
  );
}

function computeDateOffsetPreview(offset: CampaignTemplateVariableBinding["dateOffset"]): string {
  if (!offset) return "";
  const d = new Date();
  const n = offset.direction === "subtract" ? -offset.value : offset.value;
  if (offset.unit === "days")   d.setDate(d.getDate() + n);
  if (offset.unit === "weeks")  d.setDate(d.getDate() + n * 7);
  if (offset.unit === "months") d.setMonth(d.getMonth() + n);
  if (offset.unit === "years")  d.setFullYear(d.getFullYear() + n);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function resolveSequenceBindingPreviewValue(
  placeholder: string,
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null
): string {
  const binding = bindings[placeholder];
  if (!binding) {
    return placeholder;
  }

  if (binding.source === "now") {
    return computeDateOffsetPreview(binding.dateOffset) || placeholder;
  }

  if (binding.source === "static") {
    return binding.value?.trim() || binding.fallback?.trim() || placeholder;
  }

  const contactValue = resolveSequenceContactFieldValue(sampleContact, binding.field);
  return contactValue || binding.fallback?.trim() || placeholder;
}

function buildSequenceTemplatePreviewComponents(
  template: MessageTemplate | null,
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null
) {
  if (!template) {
    return [];
  }

  return template.components.map((component) => {
    if (!component.text) {
      return component;
    }
    return {
      ...component,
      text: component.text.replace(/\{\{[^}]+\}\}/g, (match) =>
        resolveSequenceBindingPreviewValue(match, bindings, sampleContact)
      )
    };
  });
}

function syncTemplateBindings(
  template: MessageTemplate | null,
  existing: CampaignTemplateVariables | undefined
): CampaignTemplateVariables {
  const next: CampaignTemplateVariables = {};
  for (const placeholder of extractTemplatePlaceholders(template)) {
    next[placeholder] = existing?.[placeholder] ?? { source: "contact", field: "display_name", fallback: "" };
  }
  return next;
}

function getTemplateHeaderMediaType(template: MessageTemplate | null): "IMAGE" | "VIDEO" | "DOCUMENT" | null {
  const header = template?.components.find((component) => component.type === "HEADER");
  return header?.format === "IMAGE" || header?.format === "VIDEO" || header?.format === "DOCUMENT"
    ? header.format
    : null;
}

function extractStepTemplateVariables(step: SequenceDetail["steps"][number]): CampaignTemplateVariables {
  if (step.template_variables_json) {
    return step.template_variables_json;
  }

  const raw = isPlainObject(step.custom_delivery_json?.templateVariables)
    ? step.custom_delivery_json.templateVariables
    : null;
  if (!raw || !isPlainObject(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, value]) => isPlainObject(value))
      .map(([key, value]) => {
        const record = value as Record<string, unknown>;
        return [
          key,
          {
            source: record.source === "static" ? "static" : "contact",
            ...(typeof record.field === "string" ? { field: record.field } : {}),
            ...(typeof record.value === "string" ? { value: record.value } : {}),
            ...(typeof record.fallback === "string" ? { fallback: record.fallback } : {})
          } satisfies CampaignTemplateVariableBinding
        ];
      })
  );
}

function extractStepMediaOverrides(step: SequenceDetail["steps"][number]): CampaignMediaOverrides {
  if (step.media_overrides_json) {
    return step.media_overrides_json;
  }

  const raw = isPlainObject(step.custom_delivery_json?.mediaOverrides)
    ? step.custom_delivery_json.mediaOverrides
    : null;
  if (!raw || !isPlainObject(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function stripStepRuntimeConfig(customDelivery: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(customDelivery ?? {}) };
  delete next.templateVariables;
  delete next.mediaOverrides;
  return next;
}

const CONDITION_FIELD_OPTIONS: ConditionFieldOption[] = [
  { key: "tags",         label: "Tag",          type: "tag",   operators: ["contains", "eq", "neq"], source: "core" },
  { key: "name",         label: "Name",         type: "text",  operators: ["contains", "eq", "neq"], source: "core" },
  { key: "phone",        label: "Phone",        type: "phone", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "email",        label: "Email",        type: "email", operators: ["contains", "eq", "neq"], source: "core" },
  { key: "contact_type", label: "Contact Type", type: "text",  operators: ["contains", "eq", "neq"], source: "core" },
  { key: "source_type",  label: "Source Type",  type: "text",  operators: ["contains", "eq", "neq"], source: "core" },
  { key: "created_at",   label: "Created At",   type: "date",  operators: ["eq", "gt", "lt"],        source: "core" },
  { key: "updated_at",   label: "Updated At",   type: "date",  operators: ["eq", "gt", "lt"],        source: "core" }
];

const WIZARD_STEPS = [
  { label: "Triggers",     desc: "Who enters & conditions" },
  { label: "Delivery",     desc: "Days, time & retry" },
  { label: "Steps",        desc: "Message templates" }
];

/* ─────────────────────────────────────────────
   Pure helpers
───────────────────────────────────────────── */
function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const [hours, minutes] = value.split(":");
  const d = new Date();
  d.setHours(Number(hours), Number(minutes ?? "0"), 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDays(days: string[] | undefined) {
  if (!days || days.length === 0 || days.length === DAYS.length) return "All days";
  return days.map((d) => DAY_LABELS[d as DayKey] ?? d).join(", ");
}

function formatDeliverySummary(draft: SequenceWriteInput) {
  const daySummary = formatDays(draft.allowedDays);
  if (draft.timeMode !== "window") return `${daySummary}, any time.`;
  const start = formatTime(draft.timeWindowStart);
  const end   = formatTime(draft.timeWindowEnd);
  return `${daySummary}, between ${start || "--"} and ${end || "--"}.`;
}

function getConditionOperatorsForFieldType(type: ConditionFieldType): SequenceWriteConditionInput["operator"][] {
  switch (type) {
    case "number": return ["eq", "neq", "gt", "lt"];
    case "date":   return ["eq", "gt", "lt"];
    case "switch": return ["eq", "neq"];
    default:       return ["contains", "eq", "neq"];
  }
}

function mapContactFieldToConditionOption(field: ContactField): ConditionFieldOption {
  const typeMap: Record<ContactField["field_type"], ConditionFieldType> = {
    TEXT: "text", MULTI_TEXT: "text", NUMBER: "number", SWITCH: "switch", DATE: "date"
  };
  const type = typeMap[field.field_type] ?? "text";
  return { key: `custom:${field.name}`, label: field.label, type, operators: getConditionOperatorsForFieldType(type), source: "custom" };
}

function getConditionFieldMeta(field: string, options: ConditionFieldOption[]) {
  return options.find((o) => o.key === field) ?? null;
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
    contains: "contains", eq: "equals", neq: "does not equal", gt: "is greater than", lt: "is less than"
  };
  return labels[operator];
}

function getConditionPreview(prefix: string, condition: SequenceWriteConditionInput, options: ConditionFieldOption[]) {
  const fieldKey   = getConditionFieldKey(condition, options);
  const fieldLabel = fieldKey === "custom_field"
    ? condition.field || "custom field"
    : getConditionFieldMeta(condition.field, options)?.label ?? condition.field;
  return `${prefix} when ${fieldLabel} ${getOperatorLabel(condition.operator)} ${condition.value || "a value"}`.replace(/\s+/g, " ");
}

function getStepTitle(step: SequenceWriteStepInput, index: number) {
  const title = typeof step.customDelivery?.stepTitle === "string" ? step.customDelivery.stepTitle : "";
  return title || `Untitled Step ${index + 1}`;
}

function getSequenceValidationErrors(draft: SequenceWriteInput) {
  const errors: string[] = [];
  if (!draft.name.trim())                                                                errors.push("Sequence name is required.");
  if (!draft.connectionId)                                                               errors.push("Select a WhatsApp API connection.");
  if (!draft.steps || draft.steps.length === 0)                                         errors.push("Add at least one step before publishing.");
  if (draft.timeMode === "window" && (!draft.timeWindowStart || !draft.timeWindowEnd))   errors.push("Select both a start and end time for the delivery window.");
  if ((draft.conditions ?? []).some((c) => !c.field.trim() || !c.value.trim()))         errors.push("Complete or remove any unfinished condition rows.");
  if ((draft.steps ?? []).some((s) => !s.messageTemplateId))                            errors.push("Choose a template for every step.");
  return errors;
}

function buildDefaultPayload(name: string, connectionId: string | null, baseType = "contact", channel = "whatsapp"): SequenceWriteInput {
  return {
    name,
    connectionId,
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

function normalizeSequenceDraftTemplates(draft: SequenceWriteInput, templates: MessageTemplate[]): SequenceWriteInput {
  return {
    ...draft,
    steps: (draft.steps ?? []).map((step) => {
      const template = templates.find((item) => item.id === step.messageTemplateId) ?? null;
      return {
        ...step,
        templateVariables: template ? syncTemplateBindings(template, step.templateVariables) : (step.templateVariables ?? {}),
        mediaOverrides: step.mediaOverrides ?? {}
      };
    })
  };
}

function toDraft(detail: SequenceDetail): SequenceWriteInput {
  return {
    name: detail.name,
    connectionId: detail.connection_id,
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
    steps: detail.steps.map((s) => ({
      id: s.id,
      stepOrder: s.step_order,
      delayValue: s.delay_value,
      delayUnit: s.delay_unit,
      messageTemplateId: s.message_template_id,
      templateVariables: extractStepTemplateVariables(s),
      mediaOverrides: extractStepMediaOverrides(s),
      customDelivery: stripStepRuntimeConfig(s.custom_delivery_json)
    })),
    conditions: detail.conditions.map((c) => ({
      id: c.id,
      conditionType: c.condition_type,
      field: c.field,
      operator: c.operator,
      value: c.value
    }))
  };
}

function normalizeSuggestionValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function getConditionValueSuggestions(contacts: ContactRecord[], fieldKey: string, rawFieldName?: string) {
  switch (fieldKey) {
    case "tags":
      return normalizeSuggestionValues(contacts.flatMap((contact) => contact.tags));
    case "name":
      return normalizeSuggestionValues(contacts.map((contact) => contact.display_name));
    case "phone":
      return normalizeSuggestionValues(contacts.map((contact) => contact.phone_number ? `+${contact.phone_number}` : null));
    case "email":
      return normalizeSuggestionValues(contacts.map((contact) => contact.email));
    case "contact_type":
      return normalizeSuggestionValues(contacts.map((contact) => contact.contact_type));
    case "source_type":
      return normalizeSuggestionValues(contacts.map((contact) => contact.source_type));
    case "created_at":
    case "updated_at":
      return normalizeSuggestionValues(
        contacts.map((contact) => {
          const value = fieldKey === "created_at" ? contact.created_at : contact.updated_at;
          const timestamp = Date.parse(value);
          return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
        })
      );
    case "custom_field": {
      const fieldName = rawFieldName?.trim().toLowerCase();
      if (!fieldName) return [];
      return normalizeSuggestionValues(
        contacts.flatMap((contact) =>
          contact.custom_field_values
            .filter((value) => value.field_name.trim().toLowerCase() === fieldName)
            .map((value) => value.value)
        )
      );
    }
    default:
      if (!fieldKey.startsWith("custom:")) return [];
      return normalizeSuggestionValues(
        contacts.flatMap((contact) =>
          contact.custom_field_values
            .filter((value) => value.field_name === fieldKey.slice("custom:".length))
            .map((value) => value.value)
        )
      );
  }
}

/* ─────────────────────────────────────────────
   Small shared UI atoms
───────────────────────────────────────────── */
function StatusPill({ status }: { status: string }) {
  return (
    <span className={`seq-pill status-${status}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

function Chip({ children, teal }: { children: ReactNode; teal?: boolean }) {
  return <span className={`seq-chip${teal ? " chip-teal" : ""}`}>{children}</span>;
}

function SelectField({ value, options, onChange }: { value: string; options: SelectOption[]; onChange: (v: string) => void }) {
  return (
    <select className="seq-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.hint ? `${o.label} (${o.hint})` : o.label}
        </option>
      ))}
    </select>
  );
}

function FieldLabel({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className="seq-field">
      <label className="seq-label">
        {label}{required && <span className="seq-label-required">*</span>}
      </label>
      {children}
      {hint && <p className="seq-label-hint">{hint}</p>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   LIST PAGE
───────────────────────────────────────────── */
function SequenceListPage({ token }: { token: string }) {
  const navigate  = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const sequences = useSequencesQuery(token).data ?? [];

  const summary = useMemo(() => ({
    total:     sequences.length,
    published: sequences.filter((s) => s.status === "published").length,
    paused:    sequences.filter((s) => s.status === "paused").length,
    completed: sequences.reduce((n, s) => n + s.completed_count, 0),
    failed:    sequences.reduce((n, s) => n + s.failed_count, 0)
  }), [sequences]);

  const filtered = useMemo(() => sequences.filter((s) => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    return matchSearch && matchStatus;
  }), [sequences, search, statusFilter]);

  return (
    <section className="seq-page">
      {/* Actions bar */}
      <div className="seq-list-actions">
        <div className="seq-view-toggle">
          <button type="button"
            className={`seq-view-btn${viewMode === "grid" ? " is-active" : ""}`}
            onClick={() => setViewMode("grid")}>
            ⊞ Grid
          </button>
          <button type="button"
            className={`seq-view-btn${viewMode === "list" ? " is-active" : ""}`}
            onClick={() => setViewMode("list")}>
            ☰ List
          </button>
        </div>
        <button type="button" className="seq-btn seq-btn-primary"
          onClick={() => navigate("/dashboard/sequence/new")}>
          + Create Sequence
        </button>
      </div>

      {/* Overview stats card */}
      <div className="seq-overview-card">
        <div className="seq-overview-head">
          <span className="seq-overview-title">Overview</span>
        </div>
        <div className="seq-overview-stats">
          <div className="seq-stat-cell">
            <p className="seq-stat-label">Total</p>
            <p className="seq-stat-value">{summary.total}</p>
          </div>
          <div className="seq-stat-cell">
            <p className="seq-stat-label">Published</p>
            <p className="seq-stat-value is-green">{summary.published}</p>
          </div>
          <div className="seq-stat-cell">
            <p className="seq-stat-label">Paused</p>
            <p className="seq-stat-value is-amber">{summary.paused}</p>
          </div>
          <div className="seq-stat-cell">
            <p className="seq-stat-label">Completed</p>
            <p className="seq-stat-value is-blue">{summary.completed}</p>
          </div>
          <div className="seq-stat-cell">
            <p className="seq-stat-label">Failed</p>
            <p className="seq-stat-value is-rose">{summary.failed}</p>
          </div>
        </div>
      </div>

      {/* Grid view */}
      {viewMode === "grid" ? (
        <div className="seq-grid">
          <button type="button" className="seq-tile-new"
            onClick={() => navigate("/dashboard/sequence/new")}>
            <div className="seq-tile-new-icon">+</div>
            <span>Create new sequence</span>
          </button>
          {sequences.map((s) => (
            <SequenceTile key={s.id} sequence={s}
              onOpen={() => navigate(`/dashboard/sequence/${s.id}`)} />
          ))}
        </div>
      ) : (
        /* List / table view */
        <div className="seq-table-card">
          <div className="seq-toolbar">
            <div className="seq-toolbar-left">
              <div className="seq-search-wrap">
                <span className="seq-search-icon">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                </span>
                <input
                  className="seq-search-input"
                  placeholder="Search sequences…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="seq-filter-sel"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="paused">Paused</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>
          <div className="seq-table-wrap">
            <table className="seq-table">
              <thead>
                <tr>
                  {["Sequence", "Status", "Trigger", "Steps", "Enrolled", "Completed", "Created", ""].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="seq-table-empty">
                      {sequences.length === 0 ? "No sequences yet — create your first one." : "No sequences match your filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.id}>
                      <td className="seq-table-name">{s.name}</td>
                      <td><StatusPill status={s.status} /></td>
                      <td>{s.trigger_type}</td>
                      <td>{s.steps_count}</td>
                      <td>{s.enrolled_count}</td>
                      <td>{s.completed_count}</td>
                      <td style={{ color: "var(--seq-muted)", fontSize: "0.82rem" }}>{formatDateTime(s.created_at)}</td>
                      <td>
                        <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
                          onClick={() => navigate(`/dashboard/sequence/${s.id}`)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function SequenceTile({ sequence, onOpen }: { sequence: SequenceListItem; onOpen: () => void }) {
  return (
    <button type="button" className={`seq-tile status-${sequence.status}`} onClick={onOpen}>
      <div className="seq-tile-body">
        <div className="seq-tile-head">
          <span className="seq-tile-name">{sequence.name}</span>
          <span className="seq-tile-date">{formatDateTime(sequence.created_at)}</span>
        </div>
        <div className="seq-tile-meta">
          <StatusPill status={sequence.status} />
          <span className="seq-tile-step-count">{sequence.steps_count} step{sequence.steps_count !== 1 ? "s" : ""}</span>
        </div>
        <div className="seq-tile-stats">
          {([
            ["Enrolled",  String(sequence.enrolled_count)],
            ["Completed", String(sequence.completed_count)],
            ["Failed",    String(sequence.failed_count)]
          ] as [string, string][]).map(([label, value]) => (
            <div key={label} className="seq-tile-stat">
              <p className="seq-tile-stat-label">{label}</p>
              <p className="seq-tile-stat-value">{value}</p>
            </div>
          ))}
        </div>
      </div>
      {(sequence.enrolled_count > 0 || sequence.status === "published") && (
        <div className="seq-tile-footer">
          <span className="seq-chip chip-teal" style={{ fontSize: "0.7rem" }}>Logs</span>
        </div>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────
   CREATE PAGE  (wizard step 1)
───────────────────────────────────────────── */
function SequenceCreatePage({ token }: { token: string }) {
  const navigate = useNavigate();
  const { bootstrap } = useDashboardShell();
  const apiConnections = bootstrap?.channelSummary.metaApi.connections ?? [];
  const [name, setName]       = useState("");
  const [baseType, setBaseType] = useState("contact");
  const [channel, setChannel]   = useState("whatsapp");
  const [connectionId, setConnectionId] = useState(
    () => bootstrap?.channelSummary.metaApi.connection?.id ?? apiConnections.find(isMetaConnectionActive)?.id ?? apiConnections[0]?.id ?? ""
  );
  const createMutation = useCreateSequenceMutation(token);
  const selectedConnection = apiConnections.find((connection) => connection.id === connectionId) ?? null;
  const canContinue = Boolean(name.trim() && baseType && channel && connectionId && isMetaConnectionActive(selectedConnection));

  useEffect(() => {
    setConnectionId((current) => {
      if (current && apiConnections.some((connection) => connection.id === current)) {
        return current;
      }
      return bootstrap?.channelSummary.metaApi.connection?.id ?? apiConnections.find(isMetaConnectionActive)?.id ?? apiConnections[0]?.id ?? "";
    });
  }, [apiConnections, bootstrap?.channelSummary.metaApi.connection?.id]);

  return (
    <section className="seq-page">
      {/* Wizard step indicator */}
      <div className="seq-wizard-nav">
        {[
          { label: "Setup",     desc: "Name & channel",       done: false, active: true  },
          { label: "Triggers",  desc: "Who enters",           done: false, active: false },
          { label: "Delivery",  desc: "Days & time",          done: false, active: false },
          { label: "Steps",     desc: "Message templates",    done: false, active: false }
        ].map(({ label, desc, done, active }, i, arr) => (
          <div key={label} style={{ display: "contents" }}>
            <button type="button" className={`seq-wstep${active ? " is-active" : ""}${done ? " is-done" : ""}`}
              style={{ cursor: "default" }}>
              <span className="seq-wstep-badge">{done ? "✓" : i + 1}</span>
              <span className="seq-wstep-text">
                <span className="seq-wstep-label">{label}</span>
                <span className="seq-wstep-desc">{desc}</span>
              </span>
            </button>
            {i < arr.length - 1 && <span className="seq-wstep-divider" />}
          </div>
        ))}
      </div>

      {/* Page header */}
      <div className="seq-card">
        <div className="seq-page-header">
          <button type="button" className="seq-back-btn"
            onClick={() => navigate("/dashboard/sequence")}>
            ← Back
          </button>
          <h1 className="seq-page-title">Create Sequence</h1>
        </div>
        <p style={{ margin: "0.25rem 0 0", color: "var(--seq-muted)", fontSize: "0.88rem" }}>
          Start with the basics — you can refine triggers, delivery and steps next.
        </p>
      </div>

      {/* Main layout */}
      <div className="seq-create-shell">
        {/* Form */}
        <div className="seq-card seq-create-form">
          <div className="seq-create-fields">
            <FieldLabel label="Sequence Name" required>
              <input
                className="seq-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Post-purchase follow-up"
                autoFocus
              />
            </FieldLabel>
            <FieldLabel label="Sequence Based on" required
              hint="Contacts are supported in MVP — more sources coming soon.">
              <SelectField value={baseType} options={BASE_OPTIONS} onChange={setBaseType} />
            </FieldLabel>
            <FieldLabel label="Send from" required
              hint="WhatsApp template sequences are supported in MVP.">
              <SelectField value={channel} options={CHANNEL_OPTIONS} onChange={setChannel} />
            </FieldLabel>
            <div style={{ gridColumn: "1 / -1" }}>
              <MetaConnectionSelector
                connections={apiConnections}
                value={connectionId}
                onChange={setConnectionId}
                label="WhatsApp API connection"
                required
                allowEmpty
                emptyLabel="Select a connection"
              />
              {selectedConnection && !isMetaConnectionActive(selectedConnection) ? (
                <p style={{ margin: "0.45rem 0 0", color: "#b91c1c", fontSize: "0.82rem" }}>
                  This connection is inactive. Reconnect or resume it before creating a sequence.
                </p>
              ) : null}
            </div>
          </div>
          <div className="seq-create-actions">
            <button type="button" className="seq-btn seq-btn-ghost"
              onClick={() => navigate("/dashboard/sequence")}>
              Cancel
            </button>
            <button
              type="button"
              className="seq-btn seq-btn-primary"
              disabled={!canContinue || createMutation.isPending}
              onClick={async () => {
                const sequence = await createMutation.mutateAsync(buildDefaultPayload(name.trim(), connectionId, baseType, channel));
                navigate(`/dashboard/sequence/${sequence.id}`);
              }}
            >
              {createMutation.isPending ? "Creating…" : "Continue →"}
            </button>
          </div>
        </div>

        {/* Info panel */}
        <div className="seq-info-panel">
          <h3 className="seq-info-title">What is a Sequence?</h3>
          <p className="seq-info-desc">
            Send multiple WhatsApp templates to your customers automatically, based on triggers and delays.
          </p>
          <ol className="seq-info-steps">
            {[
              "Create a sequence & name it",
              "Set the trigger conditions",
              "Add message steps & delays",
              "Configure delivery windows",
              "Publish and let it run"
            ].map((step, i) => (
              <li key={step} className="seq-info-step">
                <span className="seq-info-step-num">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   BUILDER PAGE  (wizard steps 1–3)
───────────────────────────────────────────── */
function BuilderPage({ token }: { token: string }) {
  const navigate                    = useNavigate();
  const { bootstrap }              = useDashboardShell();
  const { sequenceId }              = useParams<{ sequenceId: string }>();
  const detail                      = useSequenceDetailQuery(token, sequenceId ?? "").data;
  const enrollments                 = useSequenceEnrollmentsQuery(token, sequenceId ?? "").data ?? [];
  const updateMutation              = useUpdateSequenceMutation(token, sequenceId ?? "");
  const publishMutation             = usePublishSequenceMutation(token, sequenceId ?? "");
  const pauseMutation               = usePauseSequenceMutation(token, sequenceId ?? "");
  const resumeMutation              = useResumeSequenceMutation(token, sequenceId ?? "");
  const deleteMutation              = useDeleteSequenceMutation(token);

  const apiConnections              = bootstrap?.channelSummary.metaApi.connections ?? [];
  const [draft, setDraft]           = useState<SequenceWriteInput | null>(null);
  const templates = useQuery({
    queryKey: [...dashboardQueryKeys.templates, draft?.connectionId ?? "none"],
    queryFn:  () => fetchTemplates(token, { connectionId: draft?.connectionId ?? undefined }).then((r) => r.templates.filter((t) => t.status === "APPROVED")),
    enabled:  Boolean(token && draft?.connectionId)
  }).data ?? [];

  const contactFieldDefinitions = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn:  () => listContactFields(token).then((r) => r.fields.filter((f) => f.is_active)),
    enabled:  Boolean(token)
  }).data ?? [];
  const contacts = useQuery({
    queryKey: [...dashboardQueryKeys.contactsRoot, "sequence-condition-suggestions"],
    queryFn: () => fetchContacts(token, { limit: 1000 }).then((r) => r.contacts),
    enabled: Boolean(token)
  }).data ?? [];

  const [wizardStep, setWizardStep] = useState(0);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (detail) setDraft((cur) => cur ?? toDraft(detail));
  }, [detail]);

  useEffect(() => {
    if (!draft) {
      return;
    }
    if (draft.connectionId && apiConnections.some((connection) => connection.id === draft.connectionId)) {
      return;
    }
    if (!draft.connectionId) {
      return;
    }
    setDraft((current) =>
      current
        ? {
            ...current,
            connectionId: "",
            steps: (current.steps ?? []).map((step) => ({
              ...step,
              messageTemplateId: "",
              templateVariables: {},
              mediaOverrides: {}
            }))
          }
        : current
    );
  }, [apiConnections, draft]);

  const conditionFieldOptions = useMemo(
    () => [...CONDITION_FIELD_OPTIONS, ...contactFieldDefinitions.map(mapContactFieldToConditionOption)],
    [contactFieldDefinitions]
  );

  const normalizedDraft = useMemo(
    () => (draft ? normalizeSequenceDraftTemplates(draft, templates) : null),
    [draft, templates]
  );

  if (!detail || !draft || !normalizedDraft) {
    return <section className="seq-page"><div className="seq-card seq-loading">Loading sequence…</div></section>;
  }

  const setConditions = (conditionType: SequenceCondition["condition_type"], next: SequenceWriteConditionInput[]) =>
    setDraft((cur) => cur
      ? { ...cur, conditions: [...(cur.conditions ?? []).filter((c) => c.conditionType !== conditionType), ...next] }
      : cur);

  const validationErrors = getSequenceValidationErrors(normalizedDraft);
  const saveDraft = async () => {
    setDraft(normalizedDraft);
    await updateMutation.mutateAsync(normalizedDraft);
  };
  const handlePublish = async () => {
    if (validationErrors.length > 0) { setWizardStep(2); return; }
    await saveDraft();
    await publishMutation.mutateAsync();
    navigate("/dashboard/sequence");
  };

  const canGoNext = wizardStep < WIZARD_STEPS.length - 1;
  const canGoBack = wizardStep > 0;

  return (
    <section className="seq-page">

      {/* ── Sticky builder bar ── */}
      <div className="seq-builder-bar">
        <div className="seq-builder-left">
          <button type="button" className="seq-back-btn"
            onClick={() => navigate("/dashboard/sequence")}>
            ← Sequences
          </button>
          <input
            className="seq-builder-name"
            value={draft.name}
            onChange={(e) => setDraft((cur) => cur ? { ...cur, name: e.target.value } : cur)}
            aria-label="Sequence name"
          />
          <div className="seq-builder-chips">
            <StatusPill status={detail.status} />
            <Chip>Contacts</Chip>
            <Chip>WhatsApp</Chip>
            <Chip>Trigger: {draft.triggerType}</Chip>
            <Chip teal={(draft.steps?.length ?? 0) > 0}>
              {draft.steps?.length ?? 0} step{(draft.steps?.length ?? 0) !== 1 ? "s" : ""}
            </Chip>
            <Chip>{formatDays(draft.allowedDays)}</Chip>
            {draft.retryEnabled && <Chip>Retry on</Chip>}
          </div>
          <div style={{ minWidth: "280px", marginTop: "0.9rem" }}>
            <MetaConnectionSelector
              connections={apiConnections}
              value={draft.connectionId ?? ""}
              onChange={(connectionId) => setDraft((current) => current ? { ...current, connectionId, steps: (current.steps ?? []).map((step) => ({ ...step, messageTemplateId: "", templateVariables: {}, mediaOverrides: {} })) } : current)}
              label="WhatsApp API connection"
              required
              allowEmpty
              emptyLabel="Select a connection"
            />
          </div>
        </div>
        <div className="seq-builder-right">
          {(detail.status === "published" || detail.metrics.enrolled > 0) && (
            <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
              onClick={() => navigate(`/dashboard/sequence/${sequenceId}/report`)}>
              View Report →
            </button>
          )}
          <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
            onClick={() => setDraft(toDraft(detail))}>
            Reset
          </button>
          <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
            onClick={() => void saveDraft()}>
            {updateMutation.isPending ? "Saving…" : "Save"}
          </button>
          {detail.status === "published" && (
            <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
              onClick={() => void pauseMutation.mutateAsync()}>
              Pause
            </button>
          )}
          {detail.status === "paused" && (
            <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
              onClick={() => void resumeMutation.mutateAsync()}>
              Resume
            </button>
          )}
          {detail.status !== "published" && (
            <button type="button" className="seq-btn seq-btn-primary seq-btn-sm"
              disabled={validationErrors.length > 0}
              onClick={() => void handlePublish()}>
              Publish &amp; Close
            </button>
          )}
          <button type="button" className="seq-btn seq-btn-danger seq-btn-sm"
            onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setConfirmDelete(false)}>
          <div style={{ background: "#fff", borderRadius: "12px", padding: "28px 32px", maxWidth: "420px", width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>Delete Sequence?</h3>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#64748b", lineHeight: 1.55 }}>
              This will <strong>cancel all queued &amp; scheduled messages</strong>, stop new enrollments, deactivate the sequence, and permanently delete it. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
                onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button type="button" className="seq-btn seq-btn-danger seq-btn-sm"
                disabled={deleteMutation.isPending}
                onClick={() => void deleteMutation.mutateAsync(sequenceId ?? "").then(() => navigate("/dashboard/sequence"))}>
                {deleteMutation.isPending ? "Deleting…" : "Yes, Delete Sequence"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Info banner ── */}
      <div className="seq-info-banner">
        <div className="seq-banner-icon">📋</div>
        <div className="seq-banner-content">
          <p className="seq-banner-title">Sequence Type: Based on enrollment date</p>
          {bannerOpen && (
            <div className="seq-banner-meta">
              <Chip>Contacts</Chip>
              <Chip>WhatsApp</Chip>
              <Chip>{formatDays(draft.allowedDays)}</Chip>
              <Chip>{draft.timeMode === "any_time" ? "Any time" : `${formatTime(draft.timeWindowStart)}–${formatTime(draft.timeWindowEnd)}`}</Chip>
            </div>
          )}
          {bannerOpen && <p className="seq-banner-desc">The sequence will be triggered based on the enrollment date with conditions.</p>}
        </div>
        <button type="button" className="seq-banner-collapse"
          onClick={() => setBannerOpen((o) => !o)}>
          {bannerOpen ? "∧" : "∨"}
        </button>
      </div>

      {/* ── Wizard navigation ── */}
      <div className="seq-wizard-nav">
        {WIZARD_STEPS.map(({ label, desc }, i, arr) => (
          <div key={label} style={{ display: "contents" }}>
            <button
              type="button"
              className={`seq-wstep${wizardStep === i ? " is-active" : ""}${wizardStep > i ? " is-done" : ""}`}
              onClick={() => setWizardStep(i)}
            >
              <span className="seq-wstep-badge">{wizardStep > i ? "✓" : i + 1}</span>
              <span className="seq-wstep-text">
                <span className="seq-wstep-label">{label}</span>
                <span className="seq-wstep-desc">{desc}</span>
              </span>
            </button>
            {i < arr.length - 1 && <span className="seq-wstep-divider" />}
          </div>
        ))}
      </div>

      {/* ── Validation banner (step 2 only) ── */}
      {validationErrors.length > 0 && wizardStep === 2 && (
        <div className="seq-validation-banner">
          <p className="seq-validation-title">⚠ Before you publish</p>
          <div className="seq-validation-list">
            {validationErrors.map((e) => (
              <p key={e} className="seq-validation-item">• {e}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Main wizard content — full width ── */}
      <div className="seq-wizard-layout">
        <div className="seq-wizard-main">

          {/* Step 0 — Triggers & Conditions */}
          {wizardStep === 0 && (
            <TriggerEditor
              draft={draft}
              setDraft={setDraft}
              setConditions={setConditions}
              fieldOptions={conditionFieldOptions}
              contacts={contacts}
            />
          )}

          {/* Step 1 — Delivery */}
          {wizardStep === 1 && (
            <DeliveryEditor draft={draft} setDraft={setDraft} />
          )}

          {/* Step 2 — Steps */}
          {wizardStep === 2 && (
            <StepsEditor
              draft={draft}
              setDraft={setDraft}
              templates={templates}
              contactFieldDefinitions={contactFieldDefinitions}
              contacts={contacts}
            />
          )}

          {/* ── Footer: nav buttons only ── */}
          <div className="seq-wizard-footer">
            <button
              type="button"
              className="seq-btn seq-btn-ghost"
              onClick={() => canGoBack ? setWizardStep((s) => s - 1) : navigate("/dashboard/sequence")}
            >
              ← {canGoBack ? `Back: ${WIZARD_STEPS[wizardStep - 1].label}` : "Back to Sequences"}
            </button>
            {canGoNext ? (
              <button type="button" className="seq-btn seq-btn-primary"
                onClick={() => setWizardStep((s) => s + 1)}>
                Next: {WIZARD_STEPS[wizardStep + 1].label} →
              </button>
            ) : (
              <button type="button" className="seq-btn seq-btn-primary"
                disabled={validationErrors.length > 0}
                onClick={() => void handlePublish()}>
                {publishMutation.isPending ? "Publishing…" : "Publish & Close"}
              </button>
            )}
          </div>

          {/* ── Review panel — full width, below footer ── */}
          <ReviewPanel draft={draft} />

          {/* ── Activity panel — full width, below review ── */}
          <ActivityPanel detail={detail} enrollments={enrollments} />

        </div>
      </div>

    </section>
  );
}

/* ─────────────────────────────────────────────
   TRIGGER EDITOR  (wizard step 0)
───────────────────────────────────────────── */
function TriggerEditor({
  draft,
  setDraft,
  setConditions,
  fieldOptions,
  contacts
}: {
  draft: SequenceWriteInput;
  setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>;
  setConditions: (type: SequenceCondition["condition_type"], next: SequenceWriteConditionInput[]) => void;
  fieldOptions: ConditionFieldOption[];
  contacts: ContactRecord[];
}) {
  const start   = (draft.conditions ?? []).filter((c) => c.conditionType === "start");
  const success = (draft.conditions ?? []).filter((c) => c.conditionType === "stop_success");
  const failure = (draft.conditions ?? []).filter((c) => c.conditionType === "stop_failure");

  return (
    <div className="seq-card">
      <div className="seq-section-head">
        <div className="seq-section-heading">
          <h2 className="seq-section-title">Set trigger and conditions</h2>
          <p className="seq-section-desc">Control who enters the sequence and what stops it.</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        {/* Trigger type */}
        <div className="seq-surface">
          <p style={{ margin: "0 0 0.7rem", fontWeight: 800, color: "var(--seq-ink)", fontSize: "0.88rem" }}>
            When should contacts enter?
          </p>
          <div className="seq-trigger-row">
            {([
              ["create", "On create"],
              ["update", "On update"],
              ["both",   "Both (create & update)"]
            ] as [string, string][]).map(([value, label]) => {
              const active = draft.triggerType === value;
              return (
                <button key={value} type="button"
                  className={`seq-trigger-pill${active ? " is-active" : ""}`}
                  onClick={() => setDraft((cur) => cur ? { ...cur, triggerType: value as SequenceWriteInput["triggerType"] } : cur)}>
                  <span className="seq-trigger-dot" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Start conditions */}
        <div className="seq-surface">
          <ConditionGroupCard
            title="Start conditions"
            emptyText="No start rules yet — add a rule to filter who enters this sequence."
            previewPrefix="Start"
            conditions={start}
            fieldOptions={fieldOptions}
            contacts={contacts}
            onChange={(next) => setConditions("start", next.map((c) => ({ ...c, conditionType: "start" })))}
          />
        </div>

        {/* Stop conditions */}
        <div className="seq-surface">
          <div style={{ display: "grid", gap: "0.9rem" }}>
            <ConditionGroupCard
              title="Stop on success"
              emptyText="Add a rule for conditions that end the sequence after a positive outcome."
              previewPrefix="Stop"
              conditions={success}
              fieldOptions={fieldOptions}
              contacts={contacts}
              onChange={(next) => setConditions("stop_success", next.map((c) => ({ ...c, conditionType: "stop_success" })))}
            />
            <div style={{ borderTop: "1px solid var(--seq-line)", paddingTop: "0.9rem" }}>
              <ConditionGroupCard
                title="Stop on failure"
                emptyText="Add a rule for conditions that stop the sequence after an unsuccessful outcome."
                previewPrefix="Stop"
                conditions={failure}
                fieldOptions={fieldOptions}
                contacts={contacts}
                onChange={(next) => setConditions("stop_failure", next.map((c) => ({ ...c, conditionType: "stop_failure" })))}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConditionGroupCard({
  title, emptyText, previewPrefix, conditions, fieldOptions, contacts, onChange
}: {
  title: string; emptyText: string; previewPrefix: string;
  conditions: SequenceWriteConditionInput[];
  fieldOptions: ConditionFieldOption[];
  contacts: ContactRecord[];
  onChange: (next: SequenceWriteConditionInput[]) => void;
}) {
  const defaultField = fieldOptions[0];
  const addCondition = () => onChange([
    ...conditions,
    { conditionType: "start", field: defaultField?.key ?? "tags", operator: defaultField?.operators[0] ?? "contains", value: "" }
  ]);

  return (
    <div className="seq-cond-group">
      <div className="seq-cond-head">
        <div className="seq-cond-head-text">
          <p className="seq-cond-title">{title}</p>
          {conditions.length === 0 && <p className="seq-cond-empty">{emptyText}</p>}
        </div>
        <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm" onClick={addCondition}>
          + Add rule
        </button>
      </div>
      {conditions.length > 0 && (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {conditions.map((condition, idx) => (
            <ConditionRow
              key={`${title}-${idx}`}
              condition={condition}
              previewPrefix={previewPrefix}
              fieldOptions={fieldOptions}
              contacts={contacts}
              onChange={(next) => onChange(conditions.map((c, i) => i === idx ? next : c))}
              onRemove={() => onChange(conditions.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionRow({
  condition, previewPrefix, fieldOptions, contacts, onChange, onRemove
}: {
  condition: SequenceWriteConditionInput;
  previewPrefix: string;
  fieldOptions: ConditionFieldOption[];
  contacts: ContactRecord[];
  onChange: (next: SequenceWriteConditionInput) => void;
  onRemove: () => void;
}) {
  const suggestionListId = useId();
  const fieldKey   = getConditionFieldKey(condition, fieldOptions);
  const operators  = getOperatorsForField(fieldKey, fieldOptions);
  const fieldMeta  = fieldKey === "custom_field" ? null : getConditionFieldMeta(condition.field, fieldOptions);
  const valueSuggestions = useMemo(
    () => getConditionValueSuggestions(contacts, fieldKey, condition.field),
    [condition.field, contacts, fieldKey]
  );
  const valuePlaceholder =
    fieldMeta?.type === "tag"
      ? "Search or type a tag"
      : valueSuggestions.length > 0
        ? "Search or type to match"
        : "Value";

  useEffect(() => {
    if (!operators.includes(condition.operator)) onChange({ ...condition, operator: operators[0] });
  }, [condition, onChange, operators]);

  return (
    <div className="seq-cond-row">
      <select
        className="seq-select"
        value={fieldKey}
        onChange={(e) => {
          const next = e.target.value;
          const ops  = getOperatorsForField(next, fieldOptions);
          onChange({ ...condition, field: next === "custom_field" ? "" : next, operator: ops[0] });
        }}
      >
        <optgroup label="Contact fields">
          {fieldOptions.filter((o) => o.source === "core").map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </optgroup>
        {fieldOptions.some((o) => o.source === "custom") && (
          <optgroup label="Custom fields">
            {fieldOptions.filter((o) => o.source === "custom").map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </optgroup>
        )}
        <option value="custom_field">Custom field</option>
      </select>

      <select className="seq-select" value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as SequenceWriteConditionInput["operator"] })}>
        {operators.map((op) => <option key={op} value={op}>{getOperatorLabel(op)}</option>)}
      </select>

      {fieldKey === "custom_field" && (
        <input className="seq-input" value={condition.field}
          onChange={(e) => onChange({ ...condition, field: e.target.value })}
          placeholder="Custom field name" />
      )}

      <input
        className="seq-input"
        value={condition.value}
        list={valueSuggestions.length > 0 ? suggestionListId : undefined}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder={valuePlaceholder}
      />
      {valueSuggestions.length > 0 && (
        <datalist id={suggestionListId}>
          {valueSuggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      )}

      <button type="button" className="seq-btn seq-btn-danger seq-btn-sm" onClick={onRemove}>Remove</button>

      <p className="seq-cond-preview">{getConditionPreview(previewPrefix, condition, fieldOptions)}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   DELIVERY EDITOR  (wizard step 1)
───────────────────────────────────────────── */
function DeliveryEditor({
  draft, setDraft
}: {
  draft: SequenceWriteInput;
  setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>;
}) {
  const toggleDay = (day: DayKey) => setDraft((cur) => cur ? {
    ...cur,
    allowedDays: (cur.allowedDays ?? []).includes(day)
      ? (cur.allowedDays ?? []).filter((d) => d !== day)
      : [...(cur.allowedDays ?? []), day]
  } : cur);

  const allDays = (draft.allowedDays ?? []).length === DAYS.length;

  return (
    <div className="seq-card">
      <div className="seq-section-head">
        <div className="seq-section-heading">
          <h2 className="seq-section-title">Set sequence delivery preference</h2>
          <p className="seq-section-desc">Choose when messages can be sent and how the sequence behaves after each attempt.</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>

        {/* Retry */}
        <div className="seq-surface" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, fontWeight: 800, color: "var(--seq-ink)", fontSize: "0.88rem" }}>Enable Retry</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.81rem", color: "var(--seq-muted)" }}>
              Messages can retry within a 2-day interval to increase delivery rate.
            </p>
          </div>
          <label className="seq-toggle">
            <input type="checkbox" checked={draft.retryEnabled ?? false}
              onChange={(e) => setDraft((cur) => cur ? { ...cur, retryEnabled: e.target.checked } : cur)} />
            <span className="seq-toggle-track" />
          </label>
        </div>

        {/* Days */}
        <div className="seq-surface">
          <p style={{ margin: "0 0 0.7rem", fontWeight: 800, color: "var(--seq-ink)", fontSize: "0.88rem" }}>Which days can messages go out?</p>
          <div className="seq-day-row">
            <button type="button" className={`seq-day-pill${allDays ? " is-active" : ""}`}
              onClick={() => setDraft((cur) => cur ? { ...cur, allowedDays: [...DAYS] } : cur)}>
              All days
            </button>
            {DAYS.map((day) => {
              const active = (draft.allowedDays ?? []).includes(day);
              return (
                <button key={day} type="button"
                  className={`seq-day-pill${active ? " is-active" : ""}`}
                  onClick={() => toggleDay(day)}>
                  {DAY_LABELS[day]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time window */}
        <div className="seq-surface">
          <p style={{ margin: "0 0 0.7rem", fontWeight: 800, color: "var(--seq-ink)", fontSize: "0.88rem" }}>What time should messages go out?</p>
          <div className="seq-trigger-row" style={{ marginBottom: "0.75rem" }}>
            <button type="button"
              className={`seq-trigger-pill${draft.timeMode !== "window" ? " is-active" : ""}`}
              onClick={() => setDraft((cur) => cur ? { ...cur, timeMode: "any_time" } : cur)}>
              <span className="seq-trigger-dot" />
              Any time
            </button>
            <button type="button"
              className={`seq-trigger-pill${draft.timeMode === "window" ? " is-active" : ""}`}
              onClick={() => setDraft((cur) => cur ? { ...cur, timeMode: "window" } : cur)}>
              <span className="seq-trigger-dot" />
              Between specific hours
            </button>
          </div>
          {draft.timeMode === "window" && (
            <div className="seq-2col">
              <FieldLabel label="Start time">
                <input className="seq-input" type="time"
                  value={draft.timeWindowStart ?? ""}
                  onChange={(e) => setDraft((cur) => cur ? { ...cur, timeWindowStart: e.target.value } : cur)} />
              </FieldLabel>
              <FieldLabel label="End time">
                <input className="seq-input" type="time"
                  value={draft.timeWindowEnd ?? ""}
                  onChange={(e) => setDraft((cur) => cur ? { ...cur, timeWindowEnd: e.target.value } : cur)} />
              </FieldLabel>
            </div>
          )}
          <p className="seq-delivery-summary" style={{ marginTop: "0.75rem" }}>
            📅 {formatDeliverySummary(draft)}
          </p>
        </div>

        {/* Behavior */}
        <div className="seq-surface">
          <p style={{ margin: "0 0 0.85rem", fontWeight: 800, color: "var(--seq-ink)", fontSize: "0.88rem" }}>Sequence behavior</p>
          <div style={{ display: "grid", gap: "0.7rem" }}>
            <label className="seq-checkbox-label">
              <input type="checkbox" checked={draft.allowOnce ?? false}
                onChange={(e) => setDraft((cur) => cur ? { ...cur, allowOnce: e.target.checked } : cur)} />
              Allow contacts to enter this sequence only once
            </label>
            <label className="seq-checkbox-label">
              <input type="checkbox" checked={draft.requirePreviousDelivery ?? false}
                onChange={(e) => setDraft((cur) => cur ? { ...cur, requirePreviousDelivery: e.target.checked } : cur)} />
              Continue sequence only after message is successfully delivered
            </label>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   STEPS EDITOR  (wizard step 2)
───────────────────────────────────────────── */
function StepsEditor({
  draft,
  setDraft,
  templates,
  contactFieldDefinitions,
  contacts
}: {
  draft: SequenceWriteInput;
  setDraft: Dispatch<SetStateAction<SequenceWriteInput | null>>;
  templates: MessageTemplate[];
  contactFieldDefinitions: ContactField[];
  contacts: ContactRecord[];
}) {
  const steps = draft.steps ?? [];
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [uploadingMediaByStep, setUploadingMediaByStep] = useState<Record<number, boolean>>({});
  const [mediaFeedbackByStep, setMediaFeedbackByStep] = useState<Record<number, { kind: "success" | "error"; message: string }>>({});
  const sampleContact = contacts[0] ?? null;
  const variableFieldOptions = useMemo(
    () => [
      ...SEQUENCE_STANDARD_VARIABLE_FIELD_OPTIONS,
      ...contactFieldDefinitions.map((field) => ({
        value: `custom:${field.name}`,
        label: `${field.label} (custom)`
      }))
    ],
    [contactFieldDefinitions]
  );

  const updateStep = (idx: number, patch: Partial<SequenceWriteStepInput>) =>
    setDraft((cur) => cur ? {
      ...cur,
      steps: (cur.steps ?? []).map((s, i) => i === idx ? { ...s, ...patch } : s)
    } : cur);

  const addStep = () => setDraft((cur) => cur ? {
    ...cur,
    steps: [
      ...(cur.steps ?? []),
      {
        stepOrder: (cur.steps ?? []).length,
        delayValue: 1,
        delayUnit: "hours",
        messageTemplateId: templates[0]?.id ?? "",
        templateVariables: syncTemplateBindings(templates[0] ?? null, {}),
        mediaOverrides: {},
        customDelivery: { stepTitle: "" }
      }
    ]
  } : cur);

  const removeStep = (idx: number) => setDraft((cur) => cur ? {
    ...cur,
    steps: (cur.steps ?? []).filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i }))
  } : cur);

  const moveStep = (idx: number, delta: -1 | 1) => setDraft((cur) => {
    if (!cur) return cur;
    const next   = [...(cur.steps ?? [])];
    const target = idx + delta;
    if (target < 0 || target >= next.length) return cur;
    const [step] = next.splice(idx, 1);
    next.splice(target, 0, step);
    return { ...cur, steps: next.map((s, i) => ({ ...s, stepOrder: i })) };
  });

  const duplicate = (idx: number) => setDraft((cur) => cur ? {
    ...cur,
    steps: [
      ...(cur.steps ?? []).slice(0, idx + 1),
      { ...(cur.steps ?? [])[idx], id: undefined, customDelivery: { ...((cur.steps ?? [])[idx].customDelivery ?? {}) } },
      ...(cur.steps ?? []).slice(idx + 1)
    ].map((s, i) => ({ ...s, stepOrder: i }))
  } : cur);

  async function handleMediaUpload(stepIndex: number, file: File) {
    setUploadingMediaByStep((current) => ({ ...current, [stepIndex]: true }));
    setMediaFeedbackByStep((current) => {
      const next = { ...current };
      delete next[stepIndex];
      return next;
    });

    try {
      const uploaded = await uploadSequenceMedia(file);
      setDraft((current) => current ? {
        ...current,
        steps: (current.steps ?? []).map((step, index) =>
          index === stepIndex
            ? {
                ...step,
                mediaOverrides: {
                  ...(step.mediaOverrides ?? {}),
                  headerMediaUrl: uploaded.url
                }
              }
            : step
        )
      } : current);
      setMediaFeedbackByStep((current) => ({
        ...current,
        [stepIndex]: { kind: "success", message: "Media uploaded to Supabase and ready in preview." }
      }));
    } catch (error) {
      setMediaFeedbackByStep((current) => ({
        ...current,
        [stepIndex]: { kind: "error", message: (error as Error).message }
      }));
    } finally {
      setUploadingMediaByStep((current) => ({ ...current, [stepIndex]: false }));
    }
  }

  return (
    <div className="seq-card">
      <div className="seq-section-head">
        <div className="seq-section-heading">
          <h2 className="seq-section-title">Sequence steps</h2>
          <p className="seq-section-desc">Define the message templates to send and the delay between each step.</p>
        </div>
        {steps.length > 0 && (
          <button type="button" className="seq-btn seq-btn-primary" onClick={addStep}>
            + Add step
          </button>
        )}
      </div>

      {steps.length === 0 ? (
        <div className="seq-surface seq-steps-empty">
          <p className="seq-steps-empty-icon">📨</p>
          <p className="seq-steps-empty-title">No steps yet</p>
          <p className="seq-steps-empty-desc">
            Add your first step to pick a delay and choose the WhatsApp template to send.
          </p>
          <button type="button" className="seq-btn seq-btn-primary" onClick={addStep}>
            + Add first step
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0" }}>
          {steps.map((step, idx) => {
            const isCollapsed  = Boolean(collapsed[idx]);
            const template = templates.find((item) => item.id === step.messageTemplateId) ?? null;
            const templateName = template?.name ?? "No template selected";
            const placeholders = extractTemplatePlaceholders(template);
            const bindings = syncTemplateBindings(template, step.templateVariables);
            const headerMediaType = getTemplateHeaderMediaType(template);
            const mediaOverrides = step.mediaOverrides ?? {};
            const livePreviewComponents = buildSequenceTemplatePreviewComponents(template, bindings, sampleContact);
            const previewName = sampleContact?.display_name ?? sampleContact?.phone_number ?? "No sample contact";
            const feedback = mediaFeedbackByStep[idx];

            return (
              <div key={`${step.id ?? "draft"}-${idx}`}>
                {/* Connector between steps */}
                {idx > 0 && (
                  <div className="seq-flow-connector">
                    <div className="seq-flow-line" />
                    <span className="seq-delay-chip">⏱ After {step.delayValue} {step.delayUnit}</span>
                    <div className="seq-flow-line" />
                  </div>
                )}

                {/* Step card */}
                <div className="seq-step-card">
                  <div className="seq-step-head">
                    <div className="seq-step-identity">
                      <span className="seq-step-badge">{idx + 1}</span>
                      <div>
                        <p className="seq-step-name">{getStepTitle(step, idx)}</p>
                        <p className="seq-step-sub">
                          {idx === 0 ? "From enrollment" : "From previous step"} · {templateName}
                        </p>
                      </div>
                    </div>
                    <div className="seq-step-actions">
                      <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm seq-btn-icon"
                        title="Move up" onClick={() => moveStep(idx, -1)}>↑</button>
                      <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm seq-btn-icon"
                        title="Move down" onClick={() => moveStep(idx, 1)}>↓</button>
                      <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
                        onClick={() => duplicate(idx)}>Duplicate</button>
                      <button type="button" className="seq-btn seq-btn-danger seq-btn-sm"
                        onClick={() => removeStep(idx)}>Delete</button>
                      <button type="button" className="seq-btn seq-btn-ghost seq-btn-sm"
                        onClick={() => setCollapsed((c) => ({ ...c, [idx]: !c[idx] }))}>
                        {isCollapsed ? "Expand" : "Collapse"}
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="seq-step-body">
                      {/* Step title */}
                      <FieldLabel label="Step title">
                        <input className="seq-input"
                          value={typeof step.customDelivery?.stepTitle === "string" ? step.customDelivery.stepTitle : ""}
                          onChange={(e) => updateStep(idx, { customDelivery: { ...(step.customDelivery ?? {}), stepTitle: e.target.value } })}
                          placeholder={`Untitled Step ${idx + 1}`} />
                      </FieldLabel>

                      {/* Delay row */}
                      <div className="seq-step-delay-row">
                        <FieldLabel label="Send after">
                          <input className="seq-input" type="number" min={0}
                            value={step.delayValue}
                            onChange={(e) => updateStep(idx, { delayValue: Number(e.target.value) })} />
                        </FieldLabel>
                        <FieldLabel label="Unit">
                          <select className="seq-select" value={step.delayUnit}
                            onChange={(e) => updateStep(idx, { delayUnit: e.target.value as SequenceWriteStepInput["delayUnit"] })}>
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </FieldLabel>
                        <FieldLabel label="Relative to">
                          <input className="seq-input seq-input-readonly"
                            value={idx === 0 ? "From enrollment" : "From previous step"}
                            readOnly />
                        </FieldLabel>
                      </div>

                      {/* Template picker */}
                      <FieldLabel label="Send Message" required>
                        <select className="seq-select" value={step.messageTemplateId}
                          onChange={(e) => {
                            const nextTemplate = templates.find((item) => item.id === e.target.value) ?? null;
                            updateStep(idx, {
                              messageTemplateId: e.target.value,
                              templateVariables: syncTemplateBindings(nextTemplate, {}),
                              mediaOverrides: {}
                            });
                          }}>
                          <option value="">Pick a template…</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </FieldLabel>

                      {/* Variable mapping */}
                      {placeholders.length > 0 ? (
                        <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", marginTop: "4px" }}>
                          <div style={{ background: "#f8fafc", padding: "8px 12px", borderBottom: "1px solid #e2e8f0", fontSize: "12px", fontWeight: 600, color: "#475569", letterSpacing: "0.03em" }}>
                            TEMPLATE VARIABLES
                          </div>
                          {placeholders.map((ph) => {
                            const binding = bindings[ph] ?? { source: "contact" as const, field: "display_name", fallback: "" };
                            const setBinding = (patch: Partial<CampaignTemplateVariableBinding>) => {
                              const current = bindings[ph] ?? { source: "contact" as const, field: "display_name", fallback: "" };
                              updateStep(idx, { templateVariables: { ...bindings, [ph]: { ...current, ...patch } } });
                            };

                            return (
                              <div key={ph} style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: "8px" }}>
                                <span style={{ display: "inline-flex", alignSelf: "flex-start", padding: "2px 8px", borderRadius: "5px", background: "#e0f2fe", color: "#0369a1", fontFamily: "monospace", fontSize: "12px", fontWeight: 700 }}>
                                  {ph}
                                </span>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                    <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Source</span>
                                    <select
                                      className="seq-select"
                                      value={binding.source}
                                      onChange={(e) => {
                                        const src = e.target.value as "contact" | "static" | "now";
                                        if (src === "now") {
                                          updateStep(idx, { templateVariables: { ...bindings, [ph]: { source: "now", dateOffset: { direction: "add", value: 1, unit: "days" } } } });
                                        } else {
                                          setBinding({ source: src, field: variableFieldOptions[0]?.value ?? "display_name", value: "", dateOffset: undefined });
                                        }
                                      }}
                                    >
                                      <option value="contact">Contact field</option>
                                      <option value="static">Static value</option>
                                      <option value="now">📅 Today&apos;s date</option>
                                    </select>
                                  </div>
                                  {binding.source !== "now" && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{binding.source === "contact" ? "Field" : "Value"}</span>
                                      {binding.source === "contact" ? (
                                        <select
                                          className="seq-select"
                                          value={binding.field ?? variableFieldOptions[0]?.value ?? "display_name"}
                                          onChange={(e) => setBinding({ field: e.target.value })}
                                        >
                                          {variableFieldOptions.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          className="seq-input"
                                          value={binding.value ?? ""}
                                          onChange={(e) => setBinding({ value: e.target.value })}
                                          placeholder="Static text"
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                                {binding.source === "contact" && (
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500, width: "60px" }}>Date offset</span>
                                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer" }}>
                                      <input
                                        type="checkbox"
                                        checked={!!binding.dateOffset}
                                        onChange={(e) => setBinding({ dateOffset: e.target.checked ? { direction: "add" as const, value: 1, unit: "days" as const } : undefined })}
                                      />
                                      Shift this date
                                    </label>
                                    {binding.dateOffset && (
                                      <>
                                        <select className="seq-select" style={{ width: "auto" }}
                                          value={binding.dateOffset.direction}
                                          onChange={(e) => setBinding({ dateOffset: { ...binding.dateOffset!, direction: e.target.value as "add" | "subtract" } })}
                                        >
                                          <option value="add">+ Add</option>
                                          <option value="subtract">− Subtract</option>
                                        </select>
                                        <input type="number" min={1} max={999} className="seq-input" style={{ width: "55px" }}
                                          value={binding.dateOffset.value}
                                          onChange={(e) => setBinding({ dateOffset: { ...binding.dateOffset!, value: Math.max(1, Number(e.target.value)) } })}
                                        />
                                        <select className="seq-select" style={{ width: "auto" }}
                                          value={binding.dateOffset.unit}
                                          onChange={(e) => setBinding({ dateOffset: { ...binding.dateOffset!, unit: e.target.value as "days" | "weeks" | "months" | "years" } })}
                                        >
                                          <option value="days">Days</option>
                                          <option value="weeks">Weeks</option>
                                          <option value="months">Months</option>
                                          <option value="years">Years</option>
                                        </select>
                                        <span style={{ color: "#16a34a", fontSize: "12px", fontWeight: 600 }}>→ {computeDateOffsetPreview(binding.dateOffset)}</span>
                                      </>
                                    )}
                                  </div>
                                )}
                                {binding.source === "now" && (
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500, width: "60px" }}>Offset</span>
                                    <select
                                      className="seq-select"
                                      style={{ width: "auto" }}
                                      value={binding.dateOffset?.direction ?? "add"}
                                      onChange={(e) => setBinding({ dateOffset: { ...(binding.dateOffset ?? { value: 1, unit: "days" as const }), direction: e.target.value as "add" | "subtract" } })}
                                    >
                                      <option value="add">+ Add</option>
                                      <option value="subtract">− Subtract</option>
                                    </select>
                                    <input
                                      type="number" min={1} max={999}
                                      className="seq-input"
                                      style={{ width: "55px" }}
                                      value={binding.dateOffset?.value ?? 1}
                                      onChange={(e) => setBinding({ dateOffset: { ...(binding.dateOffset ?? { direction: "add" as const, unit: "days" as const }), value: Math.max(1, Number(e.target.value)) } })}
                                    />
                                    <select
                                      className="seq-select"
                                      style={{ width: "auto" }}
                                      value={binding.dateOffset?.unit ?? "days"}
                                      onChange={(e) => setBinding({ dateOffset: { ...(binding.dateOffset ?? { direction: "add" as const, value: 1 }), unit: e.target.value as "days" | "weeks" | "months" | "years" } })}
                                    >
                                      <option value="days">Days</option>
                                      <option value="weeks">Weeks</option>
                                      <option value="months">Months</option>
                                      <option value="years">Years</option>
                                    </select>
                                    <span style={{ color: "#16a34a", fontSize: "12px", fontWeight: 600 }}>→ {computeDateOffsetPreview(binding.dateOffset)}</span>
                                  </div>
                                )}
                                {binding.source !== "now" && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                    <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Fallback (when field is empty)</span>
                                    <input
                                      className="seq-input"
                                      value={binding.fallback ?? ""}
                                      onChange={(e) => setBinding({ fallback: e.target.value })}
                                      placeholder="e.g. there"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {headerMediaType ? (
                        <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginTop: "12px", display: "grid", gap: "10px" }}>
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>Template media</div>
                            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                              This header expects a {headerMediaType.toLowerCase()}. Upload to Supabase or paste a public URL.
                            </div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                            <label
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.4rem",
                                height: "2.25rem",
                                padding: "0 1rem",
                                border: "1.5px solid #2563eb",
                                borderRadius: "8px",
                                background: "#fff",
                                color: "#2563eb",
                                fontSize: "0.82rem",
                                fontWeight: 700,
                                cursor: uploadingMediaByStep[idx] ? "not-allowed" : "pointer",
                                opacity: uploadingMediaByStep[idx] ? 0.6 : 1
                              }}
                            >
                              {uploadingMediaByStep[idx] ? "Uploading…" : `Upload ${headerMediaType.toLowerCase()}`}
                              <input
                                type="file"
                                style={{ display: "none" }}
                                disabled={uploadingMediaByStep[idx]}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    void handleMediaUpload(idx, file);
                                  }
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                            {mediaOverrides.headerMediaUrl ? (
                              <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>Media ready for preview</span>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>Media URL</span>
                            <input
                              className="seq-input"
                              value={mediaOverrides.headerMediaUrl ?? ""}
                              onChange={(e) => updateStep(idx, {
                                mediaOverrides: {
                                  ...mediaOverrides,
                                  headerMediaUrl: e.target.value
                                }
                              })}
                              placeholder="https://example.com/header-media"
                            />
                          </div>
                          {feedback ? (
                            <div style={{ fontSize: "12px", color: feedback.kind === "error" ? "#dc2626" : "#16a34a" }}>
                              {feedback.message}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {template ? (
                        <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", overflow: "hidden", marginTop: "12px", background: "#fff" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>Live template preview</div>
                              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                                {sampleContact ? `Preview uses ${previewName} as the sample contact.` : "Preview uses your fallbacks because no sample contact is available yet."}
                              </div>
                            </div>
                            <div style={{ fontSize: "12px", color: "#0f172a", fontWeight: 600 }}>
                              {template.displayPhoneNumber ?? template.name}
                            </div>
                          </div>
                          <div style={{ padding: "12px" }}>
                            <TemplatePreviewPanel
                              components={livePreviewComponents.length ? livePreviewComponents : template.components}
                              businessName={template.displayPhoneNumber ?? template.name}
                              headerMediaType={headerMediaType ?? undefined}
                              headerMediaUrl={mediaOverrides.headerMediaUrl}
                            />
                          </div>
                        </div>
                      ) : null}

                      {/* Custom delivery */}
                      <label className="seq-checkbox-label">
                        <input type="checkbox" checked={Boolean(step.customDelivery?.enabled)}
                          onChange={(e) => updateStep(idx, { customDelivery: { ...(step.customDelivery ?? {}), enabled: e.target.checked } })} />
                        Set custom delivery preference for this step
                      </label>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add step button */}
          <button type="button" className="seq-add-step-btn" onClick={addStep}>
            + Add step
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   REVIEW PANEL  (full-width, below footer)
───────────────────────────────────────────── */
function ReviewPanel({ draft }: { draft: SequenceWriteInput }) {
  const startConditions = (draft.conditions ?? []).filter((c) => c.conditionType === "start");
  const stepCount = draft.steps?.length ?? 0;

  const items = [
    { label: "Who can enter?",         value: startConditions.length > 0 ? `${startConditions.length} start rule${startConditions.length > 1 ? "s" : ""}` : "Anyone matching the trigger" },
    { label: "When do messages send?", value: formatDeliverySummary(draft) },
    { label: "Steps configured",       value: `${stepCount} step${stepCount !== 1 ? "s" : ""}` },
    { label: "Retry",                  value: draft.retryEnabled ? "Enabled (48 hr window)" : "Off" },
    { label: "Allowed days",           value: formatDays(draft.allowedDays) }
  ];

  return (
    <div className="seq-card">
      <div className="seq-section-head" style={{ marginBottom: "1rem" }}>
        <div className="seq-section-heading">
          <h3 className="seq-section-title">Review</h3>
          <p className="seq-section-desc">A summary of your sequence settings.</p>
        </div>
      </div>
      <div className="seq-review-inline-grid">
        {items.map(({ label, value }) => (
          <div key={label} className="seq-review-block">
            <p className="seq-review-label">{label}</p>
            <p className="seq-review-value">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ACTIVITY PANEL  (full-width, below footer)
───────────────────────────────────────────── */
function ActivityPanel({
  detail, enrollments
}: {
  detail: SequenceDetail;
  enrollments: Array<{ id: string; status: string; entered_at: string; current_step: number }>;
}) {
  return (
    <div className="seq-card">
      <div className="seq-section-head" style={{ marginBottom: "1rem" }}>
        <div className="seq-section-heading">
          <h3 className="seq-section-title">Activity</h3>
          <p className="seq-section-desc">Enrollment metrics.</p>
        </div>
      </div>

      {/* Metrics — horizontal row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem", marginBottom: enrollments.length > 0 ? "1.25rem" : 0 }}>
        {([
          ["Enrolled",  detail.metrics.enrolled,  "tone-blue"],
          ["Active",    detail.metrics.active,    "tone-teal"],
          ["Completed", detail.metrics.completed, "tone-green"],
          ["Failed",    detail.metrics.failed,    "tone-rose"]
        ] as [string, number, string][]).map(([label, value, tone]) => (
          <div key={label} className={`seq-stat-card ${tone}`} style={{ minHeight: "auto", padding: "0.75rem 1rem" }}>
            <p className="seq-stat-label">{label}</p>
            <p className="seq-stat-value" style={{ fontSize: "1.5rem" }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Recent enrollments */}
      {enrollments.length > 0 && (
        <div>
          <p style={{ margin: "0 0 0.65rem", fontSize: "0.76rem", fontWeight: 800, color: "var(--seq-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Recent enrollments
          </p>
          <div className="seq-activity-list">
            {enrollments.slice(0, 5).map((enr) => (
              <div key={enr.id} className="seq-activity-item">
                <div className="seq-activity-row">
                  <StatusPill status={enr.status} />
                  <span className="seq-activity-time">{formatDateTime(enr.entered_at)}</span>
                </div>
                <p className="seq-activity-step">
                  {enr.status === "completed"
                    ? `Step ${enr.current_step} ✓`
                    : `Step ${enr.current_step + 1}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {enrollments.length === 0 && (
        <p className="seq-empty-row">No enrollment activity yet.</p>
      )}

    </div>
  );
}

/* ─────────────────────────────────────────────
   Router
───────────────────────────────────────────── */
export function Component() {
  const { token } = useDashboardShell();
  return useRoutes([
    { index: true,                element: <SequenceListPage token={token} /> },
    { path: "new",                element: <SequenceCreatePage token={token} /> },
    { path: ":sequenceId",        element: <BuilderPage token={token} /> },
    { path: ":sequenceId/report", element: <SequenceReportPage token={token} /> }
  ]);
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildSequencesQueryOptions(token));
}
