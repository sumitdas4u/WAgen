import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  ContactField,
  ContactRecord,
  ContactSegment,
  SegmentFilter,
  SegmentFilterOp
} from "../../../lib/api";
import {
  createContactSegment,
  deleteContactSegment,
  fetchSegmentContacts,
  listContactFields,
  listContactSegments,
  previewSegmentContacts,
  updateContactSegment
} from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  createManualContact,
  downloadContactsTemplate,
  exportContactsWorkbook,
  previewContactsWorkbookUpload,
  type ContactImportColumnMapping,
  type ContactImportPreview,
  type ContactImportResult,
  type ContactSourceType,
  type ContactType,
  uploadContactsWorkbook
} from "./api";
import { buildContactsQueryOptions, useContactsQuery } from "./queries";
import "./contacts.css";

// ─── Types ───────────────────────────────────────────────────────────────────

type ContactTypeFilter = "all" | ContactType;
type ContactSourceFilter = "all" | ContactSourceType;
type TabId = "contacts" | "segments";

type ContactFormState = {
  name: string;
  phone: string;
  email: string;
  type: ContactType;
  tags: string;
  sourceId: string;
  sourceUrl: string;
  customFields: Record<string, string>;
};

const DEFAULT_FORM_STATE: ContactFormState = {
  name: "",
  phone: "",
  email: "",
  type: "lead",
  tags: "",
  sourceId: "",
  sourceUrl: "",
  customFields: {}
};

const CONTACT_TYPE_OPTIONS: Array<{ value: ContactTypeFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "lead", label: "Lead" },
  { value: "feedback", label: "Feedback" },
  { value: "complaint", label: "Complaint" },
  { value: "other", label: "Other" }
];

const CONTACT_SOURCE_OPTIONS: Array<{ value: ContactSourceFilter; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "manual", label: "Manual" },
  { value: "import", label: "Import" },
  { value: "web", label: "Website" },
  { value: "qr", label: "WhatsApp QR" },
  { value: "api", label: "WhatsApp API" }
];

const SEGMENT_FIELD_OPTIONS: Array<{ value: string; label: string; isDate?: boolean }> = [
  { value: "display_name", label: "Name" },
  { value: "phone_number", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "contact_type", label: "Type" },
  { value: "source_type", label: "Source" },
  { value: "tags", label: "Tags" },
  { value: "created_at", label: "Created Date", isDate: true }
];

const SEGMENT_OP_OPTIONS: Array<{ value: SegmentFilterOp; label: string; onlyDate?: boolean; noValue?: boolean }> = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "before", label: "before", onlyDate: true },
  { value: "after", label: "after", onlyDate: true },
  { value: "is_empty", label: "is empty", noValue: true },
  { value: "is_not_empty", label: "is not empty", noValue: true }
];

type ContactImportFieldOption = { key: string; label: string; required?: boolean };

const CONTACT_IMPORT_STANDARD_FIELDS: ContactImportFieldOption[] = [
  { key: "display_name", label: "Contact name" },
  { key: "phone_number", label: "Phone number", required: true },
  { key: "email", label: "Email" },
  { key: "contact_type", label: "Contact type" },
  { key: "tags", label: "Tags" },
  { key: "source_type", label: "Source type" },
  { key: "source_id", label: "Source ID" },
  { key: "source_url", label: "Source URL" }
];

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS_STORAGE_KEY = "contacts_visible_columns_v1";

const STANDARD_COLUMN_DEFS: Array<{ id: string; label: string }> = [
  { id: "phone",      label: "Phone" },
  { id: "email",      label: "Email" },
  { id: "type",       label: "Type" },
  { id: "tags",       label: "Tags" },
  { id: "source",     label: "Source" },
  { id: "source_id",  label: "Source ID" },
  { id: "source_url", label: "Source URL" },
  { id: "created_at", label: "Created" },
  { id: "updated_at", label: "Last Updated" }
];

const DEFAULT_VISIBLE_COLUMNS = ["phone", "type", "tags", "created_at"];

const PAGE_SIZES = [10, 25, 50, 100] as const;

function loadVisibleColumns(): string[] {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed as string[];
    }
  } catch { /* ignore */ }
  return DEFAULT_VISIBLE_COLUMNS;
}

function saveVisibleColumns(cols: string[]): void {
  try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(cols)); } catch { /* ignore */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  );
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : value;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function getTypeLabel(value: ContactType): string {
  const map: Record<ContactType, string> = { feedback: "Feedback", complaint: "Complaint", other: "Other", lead: "Lead" };
  return map[value] ?? "Lead";
}

function getTypeClass(value: ContactType): string {
  const map: Record<ContactType, string> = { lead: "type-lead", feedback: "type-feedback", complaint: "type-complaint", other: "type-other" };
  return map[value] ?? "type-lead";
}

function getSourceLabel(value: ContactSourceType): string {
  const map: Record<ContactSourceType, string> = { manual: "Manual", import: "Import", web: "Website", qr: "WhatsApp QR", api: "WhatsApp API" };
  return map[value] ?? value;
}

function getSourceDotClass(value: ContactSourceType): string {
  const map: Record<ContactSourceType, string> = { web: "dot-web", qr: "dot-qr", import: "dot-import", api: "dot-api", manual: "dot-manual" };
  return map[value] ?? "";
}

const AVATAR_VARIANTS = ["av-blue", "av-green", "av-purple", "av-amber", "av-rose"] as const;

function getAvatarClass(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return AVATAR_VARIANTS[Math.abs(hash) % AVATAR_VARIANTS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderFieldValue(fieldType: string, value: string | null): string {
  if (!value) return "—";
  if (fieldType === "SWITCH") return value === "true" ? "Yes" : "No";
  if (fieldType === "DATE") return formatDate(value);
  return value;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.8 12.8 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M10 13V5m0 0 3 3m-3-3L7 8M4.5 14.5v1h11v-1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M10 5v8m0 0 3-3m-3 3-3-3M4.5 14.5v1h11v-1" fill="none" stroke="currentColor" strokeWidth="1.5" />
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

function ColumnsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M3 5.5h14M3 10h14M3 14.5h14M7 3v14M13 3v14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M4.5 10A5.5 5.5 0 1 0 10 4.5H7.5M7.5 4.5 5 2M7.5 4.5 5 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="13" height="13">
      <path d="M4 4h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-3 3V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" width="12" height="12">
      <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Segment Filter Row ───────────────────────────────────────────────────────

function SegmentFilterRow({
  filter,
  index,
  customFields,
  onChange,
  onRemove
}: {
  filter: SegmentFilter;
  index: number;
  customFields: ContactField[];
  onChange: (index: number, updated: SegmentFilter) => void;
  onRemove: (index: number) => void;
}) {
  const allFieldOptions = [
    ...SEGMENT_FIELD_OPTIONS,
    ...customFields.filter((f) => f.is_active).map((f) => ({
      value: `custom:${f.name}`,
      label: f.label,
      isDate: f.field_type === "DATE"
    }))
  ];

  const selectedFieldOption = allFieldOptions.find((o) => o.value === filter.field);
  const isDateField = selectedFieldOption?.isDate ?? false;

  const availableOps = SEGMENT_OP_OPTIONS.filter((op) => {
    if (op.onlyDate && !isDateField) return false;
    return true;
  });

  const selectedOp = SEGMENT_OP_OPTIONS.find((o) => o.value === filter.op);
  const showValue = !selectedOp?.noValue;

  const handleFieldChange = (field: string) => {
    const newIsDate = allFieldOptions.find((o) => o.value === field)?.isDate ?? false;
    const currentOpIsDateOnly = SEGMENT_OP_OPTIONS.find((o) => o.value === filter.op)?.onlyDate ?? false;
    const newOp = currentOpIsDateOnly && !newIsDate ? "is" : filter.op;
    onChange(index, { ...filter, field, op: newOp as SegmentFilterOp });
  };

  return (
    <div className="seg-filter-row">
      {index > 0 && <span className="seg-filter-connector">AND</span>}
      <select
        value={filter.field}
        onChange={(e) => handleFieldChange(e.target.value)}
        className="seg-filter-field"
      >
        <optgroup label="Standard Fields">
          {SEGMENT_FIELD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
        {customFields.filter((f) => f.is_active).length > 0 && (
          <optgroup label="Custom Fields">
            {customFields.filter((f) => f.is_active).map((f) => (
              <option key={f.id} value={`custom:${f.name}`}>{f.label}</option>
            ))}
          </optgroup>
        )}
      </select>

      <select
        value={filter.op}
        onChange={(e) => onChange(index, { ...filter, op: e.target.value as SegmentFilterOp })}
        className="seg-filter-op"
      >
        {availableOps.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {showValue && (
        isDateField ? (
          <input
            type="date"
            value={filter.value}
            onChange={(e) => onChange(index, { ...filter, value: e.target.value })}
            className="seg-filter-value"
          />
        ) : (
          <input
            type="text"
            value={filter.value}
            onChange={(e) => onChange(index, { ...filter, value: e.target.value })}
            placeholder="Value"
            className="seg-filter-value"
          />
        )
      )}

      <button type="button" className="seg-filter-remove" onClick={() => onRemove(index)} title="Remove condition">
        <TrashIcon />
      </button>
    </div>
  );
}

// ─── Segment Modal ────────────────────────────────────────────────────────────

function SegmentModal({
  token,
  customFields,
  initial,
  onClose,
  onSaved
}: {
  token: string;
  customFields: ContactField[];
  initial?: ContactSegment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [filters, setFilters] = useState<SegmentFilter[]>(
    initial?.filters.length ? initial.filters : [{ field: "created_at", op: "after", value: "" }]
  );
  const [previewContacts, setPreviewContacts] = useState<ContactRecord[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFilter = () => {
    setFilters((prev) => [...prev, { field: "display_name", op: "contains", value: "" }]);
  };

  const updateFilter = (index: number, updated: SegmentFilter) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? updated : f)));
    setPreviewContacts(null);
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
    setPreviewContacts(null);
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await previewSegmentContacts(token, filters);
      setPreviewContacts(result.contacts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { setError("Segment name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      if (initial) {
        await updateContactSegment(token, initial.id, { name, filters });
      } else {
        await createContactSegment(token, { name, filters });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ct-modal-backdrop" onClick={onClose}>
      <div className="ct-modal ct-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="ct-modal-head">
          <h3 className="ct-modal-title">{initial ? "Edit Segment" : "Create Segment"}</h3>
          <button type="button" className="ct-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ct-modal-body">
          {/* Segment name */}
          <div className="seg-modal-name-row">
            <label className="ct-form-label ct-form-single">
              Segment Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. New leads this month"
                autoFocus
              />
            </label>
          </div>

          {/* Filters */}
          <div className="seg-filters-section">
            <div className="seg-filters-head">
              <strong>Filter Conditions</strong>
              <button type="button" className="seg-add-filter-btn" onClick={addFilter}>
                <PlusIcon /> Add Condition
              </button>
            </div>

            {filters.length === 0 ? (
              <p className="seg-no-filters">No conditions — segment will include all contacts.</p>
            ) : (
              <div className="seg-filter-list">
                {filters.map((filter, i) => (
                  <SegmentFilterRow
                    key={i}
                    filter={filter}
                    index={i}
                    customFields={customFields}
                    onChange={updateFilter}
                    onRemove={removeFilter}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              className="seg-preview-btn"
              onClick={() => void handlePreview()}
              disabled={previewLoading}
            >
              {previewLoading ? "Loading preview…" : "Preview Matching Contacts"}
            </button>

            {previewContacts !== null && (
              <div className="seg-preview-result">
                <div className="seg-preview-result-head">
                  {previewContacts.length} contact{previewContacts.length !== 1 ? "s" : ""} match
                </div>
                {previewContacts.slice(0, 5).map((c) => (
                  <div key={c.id} className="seg-preview-contact">
                    <div className={`ct-avatar ${getAvatarClass(c.display_name || c.phone_number)}`} style={{ width: "1.6rem", height: "1.6rem", fontSize: "0.68rem" }}>
                      {getInitials(c.display_name || "?")}
                    </div>
                    <span>{c.display_name || "Unknown"}</span>
                    <span className="seg-preview-phone">{formatPhone(c.phone_number)}</span>
                  </div>
                ))}
                {previewContacts.length > 5 && (
                  <p className="seg-preview-more">+{previewContacts.length - 5} more</p>
                )}
              </div>
            )}
          </div>
        </div>

        {error && <p className="ct-modal-error">{error}</p>}

        <div className="ct-modal-footer">
          <button type="button" className="ct-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="ct-modal-submit is-blue" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : initial ? "Update Segment" : "Create Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contacts Import Modal ────────────────────────────────────────────────────

function ContactsImportModal({
  customFields,
  preview,
  mapping,
  onMappingChange,
  onClose,
  onImport,
  importing
}: {
  customFields: ContactField[];
  preview: ContactImportPreview;
  mapping: ContactImportColumnMapping;
  onMappingChange: (key: string, value: string) => void;
  onClose: () => void;
  onImport: () => void;
  importing: boolean;
}) {
  const mappingFields: ContactImportFieldOption[] = [
    ...CONTACT_IMPORT_STANDARD_FIELDS,
    ...customFields
      .filter((field) => field.is_active)
      .map((field) => ({ key: `custom:${field.name}`, label: `${field.label} (custom)` }))
  ];
  const canImport = Boolean(mapping.phone_number);

  return (
    <div className="ct-modal-backdrop" onClick={onClose}>
      <div className="ct-modal ct-modal-xl" onClick={(event) => event.stopPropagation()}>
        <div className="ct-modal-head">
          <h3 className="ct-modal-title">Map Excel Columns</h3>
          <button type="button" className="ct-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ct-modal-body">
          <p style={{ fontSize: "0.83rem", color: "#5f6f86", marginBottom: "1rem", marginTop: "-0.25rem" }}>
            Select which Excel column should fill each contact field.
          </p>

          <div className="ct-form-grid">
            {mappingFields.map((field) => (
              <label key={field.key} className="ct-form-label">
                {field.label}{field.required ? " *" : ""}
                <select
                  value={mapping[field.key] ?? ""}
                  onChange={(event) => onMappingChange(field.key, event.target.value)}
                >
                  <option value="">Do not import</option>
                  {preview.columns.map((column) => (
                    <option key={`${field.key}-${column}`} value={column}>{column}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {preview.sampleRows.length > 0 && (
            <div className="ct-import-table-wrap">
              <table>
                <thead>
                  <tr>
                    {preview.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, index) => (
                    <tr key={`sample-${index}`}>
                      {preview.columns.map((column) => (
                        <td key={`${index}-${column}`}>{row[column] || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!canImport && <p className="ct-modal-error">Phone number mapping is required to import.</p>}

        <div className="ct-modal-footer">
          <button type="button" className="ct-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="ct-modal-submit" disabled={importing || !canImport} onClick={onImport}>
            {importing ? "Importing…" : "Import Contacts"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Contact Modal ────────────────────────────────────────────────────────

function AddContactModal({
  customFields,
  formState,
  setFormState,
  submitting,
  error,
  onClose,
  onSave
}: {
  customFields: ContactField[];
  formState: ContactFormState;
  setFormState: React.Dispatch<React.SetStateAction<ContactFormState>>;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const activeCustomFields = customFields.filter((f) => f.is_active);

  const setCustomField = (name: string, value: string) => {
    setFormState((c) => ({ ...c, customFields: { ...c.customFields, [name]: value } }));
  };

  return (
    <div className="ct-modal-backdrop" onClick={onClose}>
      <div className="ct-modal ct-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="ct-modal-head">
          <h3 className="ct-modal-title">Add Contact</h3>
          <button type="button" className="ct-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ct-modal-body">
          <div className="ct-form-grid">
            <label className="ct-form-label">
              Name *
              <input
                value={formState.name}
                onChange={(e) => setFormState((c) => ({ ...c, name: e.target.value }))}
                placeholder="Full name"
                autoFocus
              />
            </label>
            <label className="ct-form-label">
              Phone *
              <input
                value={formState.phone}
                onChange={(e) => setFormState((c) => ({ ...c, phone: e.target.value }))}
                placeholder="+91 98765 43210"
              />
            </label>
            <label className="ct-form-label">
              Email
              <input
                type="email"
                value={formState.email}
                onChange={(e) => setFormState((c) => ({ ...c, email: e.target.value }))}
                placeholder="email@example.com"
              />
            </label>
            <label className="ct-form-label">
              Type
              <select
                value={formState.type}
                onChange={(e) => setFormState((c) => ({ ...c, type: e.target.value as ContactType }))}
              >
                {CONTACT_TYPE_OPTIONS.filter((o) => o.value !== "all").map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="ct-form-label">
              Tags
              <input
                value={formState.tags}
                onChange={(e) => setFormState((c) => ({ ...c, tags: e.target.value }))}
                placeholder="VIP, Follow up (comma-separated)"
              />
            </label>
            <label className="ct-form-label">
              Source ID
              <input
                value={formState.sourceId}
                onChange={(e) => setFormState((c) => ({ ...c, sourceId: e.target.value }))}
              />
            </label>
            <label className="ct-form-label">
              Source URL
              <input
                type="url"
                value={formState.sourceUrl}
                onChange={(e) => setFormState((c) => ({ ...c, sourceUrl: e.target.value }))}
                placeholder="https://"
              />
            </label>

            {activeCustomFields.length > 0 && (
              <div className="ct-form-divider">Custom Fields</div>
            )}

            {activeCustomFields.map((field) => (
              <label key={field.id} className="ct-form-label">
                {field.label}{field.is_mandatory ? " *" : ""}
                {field.field_type === "SWITCH" ? (
                  <select
                    value={formState.customFields[field.name] ?? ""}
                    onChange={(e) => setCustomField(field.name, e.target.value)}
                  >
                    <option value="">Select…</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : field.field_type === "DATE" ? (
                  <input
                    type="date"
                    value={formState.customFields[field.name] ?? ""}
                    onChange={(e) => setCustomField(field.name, e.target.value)}
                  />
                ) : field.field_type === "NUMBER" ? (
                  <input
                    type="number"
                    value={formState.customFields[field.name] ?? ""}
                    onChange={(e) => setCustomField(field.name, e.target.value)}
                  />
                ) : field.field_type === "MULTI_TEXT" ? (
                  <textarea
                    value={formState.customFields[field.name] ?? ""}
                    onChange={(e) => setCustomField(field.name, e.target.value)}
                    rows={3}
                  />
                ) : (
                  <input
                    type="text"
                    value={formState.customFields[field.name] ?? ""}
                    onChange={(e) => setCustomField(field.name, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="ct-modal-error">{error}</p>}

        <div className="ct-modal-footer">
          <button type="button" className="ct-modal-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="ct-modal-submit" disabled={submitting} onClick={onSave}>
            {submitting ? "Saving…" : "Save Contact"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────

function ContactsTab({
  token,
  customFields
}: {
  token: string;
  customFields: ContactField[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Toolbar state
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Per-row dropdown
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  // Form / import state
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [importPreview, setImportPreview] = useState<ContactImportPreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMapping, setImportMapping] = useState<ContactImportColumnMapping>({});
  const [formState, setFormState] = useState<ContactFormState>(DEFAULT_FORM_STATE);

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Columns
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadVisibleColumns);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);

  // Refs
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const importMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // Filters from URL
  const search = searchParams.get("q") ?? "";
  const typeFilter = (searchParams.get("type") as ContactTypeFilter | null) ?? "all";
  const sourceFilter = (searchParams.get("source") as ContactSourceFilter | null) ?? "all";

  const contactsQuery = useContactsQuery(token, {
    q: search || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    source: sourceFilter === "all" ? undefined : sourceFilter,
    limit: 1000
  });

  const contacts = contactsQuery.data ?? [];
  const activeFilterCount = [search.trim(), typeFilter !== "all", sourceFilter !== "all"].filter(Boolean).length;
  const selectedCount = selectedIds.length;
  const allVisibleSelected = contacts.length > 0 && selectedCount === contacts.length;
  const someVisibleSelected = selectedCount > 0 && selectedCount < contacts.length;

  // Pagination computed
  const totalPages = Math.max(1, Math.ceil(contacts.length / pageSize));
  const pagedContacts = contacts.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => { setPage(0); }, [contacts.length, search, typeFilter, sourceFilter]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => contacts.some((c) => c.id === id)));
  }, [contacts]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (exportMenuRef.current && event.target instanceof Node && !exportMenuRef.current.contains(event.target)) setShowExportMenu(false);
      if (importMenuRef.current && event.target instanceof Node && !importMenuRef.current.contains(event.target)) setShowImportMenu(false);
      if (columnsMenuRef.current && event.target instanceof Node && !columnsMenuRef.current.contains(event.target)) setShowColumnsMenu(false);
      if (rowMenuRef.current && event.target instanceof Node && !rowMenuRef.current.contains(event.target)) setOpenRowId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowExportMenu(false);
        setShowImportMenu(false);
        setShowColumnsMenu(false);
        setShowAddModal(false);
        setOpenRowId(null);
      }
    };
    window.addEventListener("mousedown", closeMenus);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeMenus);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const updateSearchParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all") next.delete(name); else next.set(name, value);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const invalidateContacts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactsRoot }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.leadsRoot }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot })
    ]);
  };

  const openAddModal = () => {
    setShowExportMenu(false);
    setShowImportMenu(false);
    setFormState({ ...DEFAULT_FORM_STATE, customFields: {} });
    setShowAddModal(true);
    setInfo(null);
    setError(null);
  };

  const handleCreateContact = async () => {
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      await createManualContact(token, {
        name: formState.name,
        phone: formState.phone,
        email: formState.email || undefined,
        type: formState.type,
        tags: normalizeTags(formState.tags),
        sourceId: formState.sourceId || undefined,
        sourceUrl: formState.sourceUrl || undefined,
        customFields: Object.fromEntries(
          Object.entries(formState.customFields).filter(([, v]) => v.trim())
        )
      });
      await invalidateContacts();
      setShowAddModal(false);
      setInfo("Contact added successfully.");
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTemplateDownload = async () => {
    setShowImportMenu(false);
    setError(null);
    try {
      const { blob, filename } = await downloadContactsTemplate(token);
      downloadBlob(blob, filename);
    } catch (downloadError) {
      setError((downloadError as Error).message);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    setInfo(null);
    setImportResult(null);
    try {
      const preview = await previewContactsWorkbookUpload(token, file);
      setImportFile(file);
      setImportPreview(preview);
      setImportMapping(preview.suggestedMapping ?? {});
    } catch (importError) {
      setError((importError as Error).message);
    } finally {
      setSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRunImport = async () => {
    if (!importFile) return;
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const result = await uploadContactsWorkbook(token, importFile, { mapping: importMapping });
      await invalidateContacts();
      setImportResult(result);
      setInfo(`Import complete — ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`);
      setImportPreview(null);
      setImportFile(null);
      setImportMapping({});
    } catch (importError) {
      setError((importError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = async (mode: "selected" | "filtered") => {
    setShowExportMenu(false);
    setError(null);
    try {
      const payload =
        mode === "selected"
          ? { ids: selectedIds }
          : { filters: { q: search || undefined, type: typeFilter === "all" ? undefined : typeFilter, source: sourceFilter === "all" ? undefined : sourceFilter, limit: 1000 } };
      const { blob, filename } = await exportContactsWorkbook(token, payload);
      downloadBlob(blob, filename);
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };

  // Column helpers
  const allColumnDefs = useMemo(() => [
    ...STANDARD_COLUMN_DEFS,
    ...customFields.filter((f) => f.is_active).map((f) => ({ id: `custom:${f.name}`, label: f.label }))
  ], [customFields]);

  const toggleColumn = (id: string) => {
    setVisibleColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      saveVisibleColumns(next);
      return next;
    });
  };

  const isColVisible = (id: string) => visibleColumns.includes(id);

  const copyPhone = (phone: string) => {
    void navigator.clipboard.writeText(formatPhone(phone));
  };

  return (
    <>
      {info && <div className="ct-banner is-info">{info}</div>}
      {error && <div className="ct-banner is-error">{error}</div>}

      {importResult && importResult.errors.length > 0 && (
        <div className="ct-import-summary">
          <strong>Import completed with issues</strong>
          <ul>
            {importResult.errors.slice(0, 6).map((item) => (
              <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="ct-toolbar">
        <div className="ct-toolbar-left">
          {/* Search */}
          <div className="ct-search-wrap">
            <span className="ct-search-icon"><SearchIcon /></span>
            <input
              type="search"
              className="ct-search-input"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => updateSearchParam("q", e.target.value)}
            />
          </div>

          {/* Type filter */}
          <select
            className="ct-filter-select"
            value={typeFilter}
            onChange={(e) => updateSearchParam("type", e.target.value)}
          >
            {CONTACT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Source filter */}
          <select
            className="ct-filter-select"
            value={sourceFilter}
            onChange={(e) => updateSearchParam("source", e.target.value)}
          >
            {CONTACT_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <button type="button" className="ct-toolbar-btn" onClick={clearFilters}>
              ✕ Clear filters
            </button>
          )}
        </div>

        <div className="ct-toolbar-right">
          {/* Selected badge */}
          {selectedCount > 0 && (
            <span className="ct-selected-badge">{selectedCount} selected</span>
          )}

          {/* Columns picker */}
          <div className="ct-dd-wrap" ref={columnsMenuRef}>
            <button
              type="button"
              className={`ct-toolbar-btn${showColumnsMenu ? " is-active" : ""}`}
              onClick={() => setShowColumnsMenu((c) => !c)}
            >
              <ColumnsIcon />
              Columns
              {visibleColumns.length > 0 && <span style={{ fontWeight: 800, color: "#2563eb", fontSize: "0.72rem" }}>{visibleColumns.length}</span>}
              <ChevronDownIcon />
            </button>
            {showColumnsMenu && (
              <div className="ct-dd-menu ct-columns-menu">
                <p className="ct-columns-hint">Choose which columns to display</p>
                <div className="ct-columns-section-label">Standard</div>
                {STANDARD_COLUMN_DEFS.map((col) => (
                  <label key={col.id} className="ct-columns-row">
                    <input
                      type="checkbox"
                      checked={isColVisible(col.id)}
                      onChange={() => toggleColumn(col.id)}
                    />
                    {col.label}
                  </label>
                ))}
                {customFields.filter((f) => f.is_active).length > 0 && (
                  <>
                    <div className="ct-columns-section-label" style={{ marginTop: "0.5rem" }}>Custom Fields</div>
                    {customFields.filter((f) => f.is_active).map((f) => (
                      <label key={f.id} className="ct-columns-row">
                        <input
                          type="checkbox"
                          checked={isColVisible(`custom:${f.name}`)}
                          onChange={() => toggleColumn(`custom:${f.name}`)}
                        />
                        {f.label}
                      </label>
                    ))}
                  </>
                )}
                <div className="ct-columns-footer">
                  <button
                    type="button"
                    className="ct-link-btn"
                    onClick={() => { setVisibleColumns(DEFAULT_VISIBLE_COLUMNS); saveVisibleColumns(DEFAULT_VISIBLE_COLUMNS); }}
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Export */}
          <div className="ct-dd-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className={`ct-toolbar-btn${showExportMenu ? " is-active" : ""}`}
              onClick={() => { setShowImportMenu(false); setShowExportMenu((c) => !c); }}
            >
              <DownloadIcon />
              Export
              <ChevronDownIcon />
            </button>
            {showExportMenu && (
              <div className="ct-dd-menu">
                <button
                  type="button"
                  className="ct-dd-item"
                  disabled={selectedCount === 0}
                  onClick={() => void handleExport("selected")}
                >
                  Export selected {selectedCount > 0 ? `(${selectedCount})` : ""}
                </button>
                <button
                  type="button"
                  className="ct-dd-item"
                  disabled={contacts.length === 0}
                  onClick={() => void handleExport("filtered")}
                >
                  Export all filtered
                </button>
              </div>
            )}
          </div>

          {/* Import */}
          <div className="ct-dd-wrap" ref={importMenuRef}>
            <button
              type="button"
              className={`ct-toolbar-btn${showImportMenu ? " is-active" : ""}`}
              onClick={() => { setShowExportMenu(false); setShowImportMenu((c) => !c); }}
            >
              <UploadIcon />
              Import
              <ChevronDownIcon />
            </button>
            {showImportMenu && (
              <div className="ct-dd-menu">
                <button type="button" className="ct-dd-item" onClick={() => void handleTemplateDownload()}>
                  <DownloadIcon /> Download template
                </button>
                <button type="button" className="ct-dd-item" onClick={() => { setShowImportMenu(false); fileInputRef.current?.click(); }}>
                  <UploadIcon /> Upload XLSX
                </button>
              </div>
            )}
          </div>

          {/* Refresh */}
          <button
            type="button"
            className="ct-icon-btn"
            title="Refresh"
            onClick={() => void invalidateContacts()}
          >
            <RefreshIcon />
          </button>

          {/* Add contact */}
          <button type="button" className="ct-new-btn" onClick={openAddModal}>
            <PlusIcon />
            Add Contact
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {/* ── Table ── */}
      {contactsQuery.isLoading ? (
        <div className="ct-loading">Loading contacts…</div>
      ) : contacts.length === 0 ? (
        <div className="ct-empty">
          <div className="ct-empty-icon">👥</div>
          <div className="ct-empty-title">
            {activeFilterCount > 0 ? "No contacts match your filters" : "No contacts yet"}
          </div>
          <div className="ct-empty-text">
            {activeFilterCount > 0
              ? "Try adjusting your search or filter criteria."
              : "Add your first contact manually or import from an Excel file."}
          </div>
          {activeFilterCount > 0 ? (
            <button type="button" className="ct-toolbar-btn" onClick={clearFilters}>Clear filters</button>
          ) : (
            <button type="button" className="ct-new-btn" onClick={openAddModal}><PlusIcon /> Add Contact</button>
          )}
        </div>
      ) : (
        <div className="ct-table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="ct-checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => setSelectedIds(e.target.checked ? contacts.map((c) => c.id) : [])}
                  />
                </th>
                <th>Name &amp; Phone</th>
                {allColumnDefs.filter((col) => isColVisible(col.id)).map((col) => (
                  <th key={col.id}>{col.label}</th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedContacts.map((contact) => (
                <tr key={contact.id} className={selectedIds.includes(contact.id) ? "is-selected" : ""}>
                  {/* Checkbox */}
                  <td>
                    <input
                      type="checkbox"
                      className="ct-checkbox"
                      checked={selectedIds.includes(contact.id)}
                      onChange={(e) =>
                        setSelectedIds((current) =>
                          e.target.checked
                            ? Array.from(new Set([...current, contact.id]))
                            : current.filter((id) => id !== contact.id)
                        )
                      }
                    />
                  </td>

                  {/* Name + Phone (always pinned) */}
                  <td>
                    <div className="ct-name-cell">
                      <div className={`ct-avatar ${getAvatarClass(contact.display_name || contact.phone_number)}`}>
                        {getInitials(contact.display_name || "?")}
                      </div>
                      <div className="ct-name-info">
                        <div className="ct-name-main">{contact.display_name || "Unknown"}</div>
                        <div className="ct-name-phone">{formatPhone(contact.phone_number)}</div>
                      </div>
                    </div>
                  </td>

                  {/* Dynamic columns */}
                  {allColumnDefs.filter((col) => isColVisible(col.id)).map((col) => {
                    if (col.id.startsWith("custom:")) {
                      const fieldName = col.id.slice(7);
                      const fv = contact.custom_field_values?.find((v) => v.field_name === fieldName);
                      const val = renderFieldValue(fv?.field_type ?? "TEXT", fv?.value ?? null);
                      return <td key={col.id}>{val === "—" ? <span className="ct-cell-empty">—</span> : val}</td>;
                    }
                    switch (col.id) {
                      case "phone":
                        return <td key={col.id}><span className="ct-cell-mono">{formatPhone(contact.phone_number)}</span></td>;
                      case "email":
                        return <td key={col.id}>{contact.email ? <span className="ct-cell-mono">{contact.email}</span> : <span className="ct-cell-empty">—</span>}</td>;
                      case "type":
                        return (
                          <td key={col.id}>
                            <span className={`ct-type-pill ${getTypeClass(contact.contact_type)}`}>
                              {getTypeLabel(contact.contact_type)}
                            </span>
                          </td>
                        );
                      case "tags":
                        return (
                          <td key={col.id}>
                            {contact.tags.length > 0 ? (
                              <div className="ct-tags">
                                {contact.tags.map((tag) => (
                                  <span key={tag} className="ct-tag">{tag}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="ct-cell-empty">—</span>
                            )}
                          </td>
                        );
                      case "source":
                        return (
                          <td key={col.id}>
                            <div className="ct-source">
                              <span className={`ct-source-dot ${getSourceDotClass(contact.source_type)}`} />
                              {getSourceLabel(contact.source_type)}
                            </div>
                          </td>
                        );
                      case "source_id":
                        return <td key={col.id}>{contact.source_id ? <span className="ct-cell-mono">{contact.source_id}</span> : <span className="ct-cell-empty">—</span>}</td>;
                      case "source_url":
                        return (
                          <td key={col.id}>
                            {contact.source_url
                              ? <a href={contact.source_url} target="_blank" rel="noreferrer" className="ct-cell-link">{contact.source_url}</a>
                              : <span className="ct-cell-empty">—</span>}
                          </td>
                        );
                      case "created_at":
                        return <td key={col.id} style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "#334155" }}>{formatDate(contact.created_at)}</td>;
                      case "updated_at":
                        return <td key={col.id} style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "#334155" }}>{formatDate(contact.updated_at)}</td>;
                      default:
                        return <td key={col.id}><span className="ct-cell-empty">—</span></td>;
                    }
                  })}

                  {/* Action */}
                  <td>
                    <div className="ct-action-cell">
                      <button
                        type="button"
                        className="ct-action-btn"
                        disabled={!contact.linked_conversation_id}
                        title={contact.linked_conversation_id ? "Open chat" : "No chat linked"}
                        onClick={() => { if (contact.linked_conversation_id) navigate(`/dashboard/inbox/${contact.linked_conversation_id}`); }}
                      >
                        <MessageIcon /> Message
                      </button>
                      <div className="ct-dd-wrap" ref={openRowId === contact.id ? rowMenuRef : undefined}>
                        <button
                          type="button"
                          className="ct-more-btn"
                          aria-label="More options"
                          onClick={() => setOpenRowId((prev) => (prev === contact.id ? null : contact.id))}
                        >
                          ···
                        </button>
                        {openRowId === contact.id && (
                          <div className="ct-dd-menu">
                            <button
                              type="button"
                              className="ct-dd-item"
                              onClick={() => { copyPhone(contact.phone_number); setOpenRowId(null); }}
                            >
                              📋 Copy phone
                            </button>
                            {contact.linked_conversation_id && (
                              <button
                                type="button"
                                className="ct-dd-item"
                                onClick={() => { navigate(`/dashboard/inbox/${contact.linked_conversation_id}`); setOpenRowId(null); }}
                              >
                                💬 View history
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {contacts.length > 0 && (
        <div className="ct-pagination">
          <div className="ct-pagination-left">
            <span>Rows per page</span>
            <select
              className="ct-rows-select"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <span className="ct-page-info">
            <strong>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, contacts.length)}</strong> of {contacts.length.toLocaleString()}
          </span>
          <div className="ct-page-nav">
            <button type="button" className="ct-nav-btn" disabled={page === 0} onClick={() => setPage(0)}>«</button>
            <button type="button" className="ct-nav-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</button>
            <button type="button" className="ct-nav-btn" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next ›</button>
            <button type="button" className="ct-nav-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {showAddModal && (
        <AddContactModal
          customFields={customFields}
          formState={formState}
          setFormState={setFormState}
          submitting={submitting}
          error={error}
          onClose={() => setShowAddModal(false)}
          onSave={() => void handleCreateContact()}
        />
      )}

      {importPreview && (
        <ContactsImportModal
          customFields={customFields}
          preview={importPreview}
          mapping={importMapping}
          onMappingChange={(key, value) =>
            setImportMapping((current) => {
              if (!value) {
                const next = { ...current };
                delete next[key];
                return next;
              }
              return { ...current, [key]: value };
            })
          }
          onClose={() => {
            setImportPreview(null);
            setImportFile(null);
            setImportMapping({});
          }}
          onImport={() => void handleRunImport()}
          importing={submitting}
        />
      )}
    </>
  );
}

// ─── Segments Tab ─────────────────────────────────────────────────────────────

function SegmentsTab({ token, customFields }: { token: string; customFields: ContactField[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState<ContactSegment | null>(null);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);
  const [openSegMenuId, setOpenSegMenuId] = useState<string | null>(null);
  const segMenuRef = useRef<HTMLDivElement | null>(null);

  const segmentsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactSegments,
    queryFn: () => listContactSegments(token).then((r) => r.segments),
    enabled: Boolean(token)
  });

  const segmentContactsQuery = useQuery({
    queryKey: expandedSegmentId ? dashboardQueryKeys.segmentContacts(expandedSegmentId) : ["disabled"],
    queryFn: () => (expandedSegmentId ? fetchSegmentContacts(token, expandedSegmentId).then((r) => r.contacts) : Promise.resolve([])),
    enabled: Boolean(expandedSegmentId)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteContactSegment(token, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegmentsRoot })
  });

  const segments = segmentsQuery.data ?? [];

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (segMenuRef.current && e.target instanceof Node && !segMenuRef.current.contains(e.target)) setOpenSegMenuId(null);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenSegMenuId(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape); };
  }, []);

  const handleSaved = () => {
    setShowModal(false);
    setEditingSegment(null);
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegmentsRoot });
  };

  const openCreate = () => { setEditingSegment(null); setShowModal(true); };
  const openEdit = (seg: ContactSegment) => { setEditingSegment(seg); setShowModal(true); setOpenSegMenuId(null); };

  const toggleExpand = (segmentId: string) => {
    setExpandedSegmentId((prev) => (prev === segmentId ? null : segmentId));
  };

  const handleDelete = (seg: ContactSegment) => {
    if (window.confirm(`Delete segment "${seg.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(seg.id);
    }
    setOpenSegMenuId(null);
  };

  return (
    <>
      {/* Toolbar */}
      <div className="ct-toolbar">
        <div className="ct-toolbar-left">
          <span style={{ fontSize: "0.82rem", color: "#5f6f86", fontWeight: 500 }}>
            {segments.length > 0 ? `${segments.length} segment${segments.length !== 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <div className="ct-toolbar-right">
          <button type="button" className="ct-new-btn" onClick={openCreate}>
            <PlusIcon /> New Segment
          </button>
        </div>
      </div>

      {/* Segments table */}
      {segmentsQuery.isLoading ? (
        <div className="ct-loading">Loading segments…</div>
      ) : segments.length === 0 ? (
        <div className="seg-empty">
          <div className="ct-empty-icon">🗂️</div>
          <div className="seg-empty-title">No segments yet</div>
          <p className="seg-empty-text">
            Create dynamic contact groups by combining filters on name, date, type, tags, or custom fields.
          </p>
          <button type="button" className="ct-new-btn" onClick={openCreate}>
            <PlusIcon /> Create your first segment
          </button>
        </div>
      ) : (
        <div className="seg-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Segment</th>
                <th>Filters</th>
                <th>Created</th>
                <th>Contacts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => {
                const isExpanded = expandedSegmentId === seg.id;
                const segContacts = isExpanded ? (segmentContactsQuery.data ?? []) : [];
                const isLoading = isExpanded && segmentContactsQuery.isFetching;

                return (
                  <>
                    <tr key={seg.id}>
                      {/* Name */}
                      <td>
                        <div className="ct-name-cell">
                          <div className={`ct-avatar ${getAvatarClass(seg.name)}`}>
                            {getInitials(seg.name)}
                          </div>
                          <div className="ct-name-info">
                            <div className="ct-name-main">{seg.name}</div>
                          </div>
                        </div>
                      </td>

                      {/* Filters as chips */}
                      <td>
                        <div className="seg-row-filters">
                          {seg.filters.length === 0 ? (
                            <span className="ct-tag">All contacts</span>
                          ) : (
                            seg.filters.map((f, i) => (
                              <span key={i} className="seg-filter-chip">
                                <span className="chip-key">
                                  {f.field.startsWith("custom:") ? f.field.slice(7) : f.field}
                                </span>
                                <span className="chip-op">{f.op.replace(/_/g, " ")}</span>
                                {f.value && <span className="chip-val">{f.value}</span>}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* Created */}
                      <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "#5f6f86" }}>
                        {formatDate(seg.created_at)}
                      </td>

                      {/* View contacts */}
                      <td>
                        <button type="button" className="ct-view-count" onClick={() => toggleExpand(seg.id)}>
                          {isExpanded ? "▲ Collapse" : "▼ View contacts"}
                        </button>
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="ct-action-cell">
                          <button type="button" className="ct-action-btn" onClick={() => openEdit(seg)}>
                            Edit
                          </button>
                          <div className="ct-dd-wrap" ref={openSegMenuId === seg.id ? segMenuRef : undefined}>
                            <button
                              type="button"
                              className="ct-more-btn"
                              aria-label="More"
                              onClick={() => setOpenSegMenuId((prev) => (prev === seg.id ? null : seg.id))}
                            >
                              ···
                            </button>
                            {openSegMenuId === seg.id && (
                              <div className="ct-dd-menu">
                                <button type="button" className="ct-dd-item" onClick={() => openEdit(seg)}>
                                  ✏️ Edit segment
                                </button>
                                <div className="ct-dd-divider" />
                                <button
                                  type="button"
                                  className="ct-dd-item ct-dd-item-danger"
                                  onClick={() => handleDelete(seg)}
                                >
                                  <TrashIcon /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded contacts row */}
                    {isExpanded && (
                      <tr key={`${seg.id}-expanded`} className="seg-expanded-row">
                        <td colSpan={5}>
                          <div className="seg-expanded-inner">
                            {isLoading ? (
                              <div className="ct-loading">Loading contacts…</div>
                            ) : segContacts.length === 0 ? (
                              <div className="ct-loading">No contacts match this segment.</div>
                            ) : (
                              <div className="ct-table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Name</th>
                                      <th>Phone</th>
                                      <th>Type</th>
                                      <th>Tags</th>
                                      <th>Created</th>
                                      <th>Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {segContacts.slice(0, 50).map((c) => (
                                      <tr key={c.id}>
                                        <td>
                                          <div className="ct-name-cell">
                                            <div className={`ct-avatar ${getAvatarClass(c.display_name || c.phone_number)}`}>
                                              {getInitials(c.display_name || "?")}
                                            </div>
                                            <div className="ct-name-info">
                                              <div className="ct-name-main">{c.display_name || "Unknown"}</div>
                                            </div>
                                          </div>
                                        </td>
                                        <td><span className="ct-cell-mono">{formatPhone(c.phone_number)}</span></td>
                                        <td>
                                          <span className={`ct-type-pill ${getTypeClass(c.contact_type)}`}>
                                            {getTypeLabel(c.contact_type)}
                                          </span>
                                        </td>
                                        <td>
                                          <div className="ct-tags">
                                            {c.tags.slice(0, 3).map((tag) => (
                                              <span key={tag} className="ct-tag">{tag}</span>
                                            ))}
                                          </div>
                                        </td>
                                        <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem", color: "#5f6f86" }}>
                                          {formatDate(c.created_at)}
                                        </td>
                                        <td>
                                          <button
                                            type="button"
                                            className="ct-action-btn"
                                            disabled={!c.linked_conversation_id}
                                            onClick={() => { if (c.linked_conversation_id) navigate(`/dashboard/inbox/${c.linked_conversation_id}`); }}
                                          >
                                            <MessageIcon /> Message
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {segContacts.length > 50 && (
                                  <div className="seg-show-more">Showing 50 of {segContacts.length} contacts</div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <SegmentModal
          token={token}
          customFields={customFields}
          initial={editingSegment ?? undefined}
          onClose={() => { setShowModal(false); setEditingSegment(null); }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Component() {
  const { token } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: TabId = (searchParams.get("tab") as TabId | null) ?? "contacts";

  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((r) => r.fields),
    enabled: Boolean(token)
  });
  const customFields = fieldsQuery.data ?? [];

  // Stats from pre-fetched contacts (limit 1000)
  const allContactsQuery = useContactsQuery(token, { limit: 1000 });
  const allContacts = allContactsQuery.data ?? [];

  const segmentsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactSegments,
    queryFn: () => listContactSegments(token).then((r) => r.segments),
    enabled: Boolean(token)
  });
  const segments = segmentsQuery.data ?? [];

  const stats = useMemo(() => {
    const leads = allContacts.filter((c) => c.contact_type === "lead").length;
    const feedback = allContacts.filter((c) => c.contact_type === "feedback").length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const addedThisWeek = allContacts.filter((c) => Date.parse(c.created_at) > weekAgo).length;
    const leadPct = allContacts.length > 0 ? Math.round((leads / allContacts.length) * 100) : 0;
    return { total: allContacts.length, leads, leadPct, feedback, addedThisWeek, segments: segments.length };
  }, [allContacts, segments]);

  const setTab = (tab: TabId) => {
    const next = new URLSearchParams();
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="ct-page">
      {/* ── Page header ── */}
      <div className="ct-page-header">
        <h1 className="ct-page-title">Contacts</h1>
      </div>

      {/* ── Overview stats ── */}
      <div className="ct-overview-card">
        <div className="ct-overview-head">
          <span className="ct-overview-title">Overview</span>
        </div>
        <div className="ct-overview-stats">
          <div className="ct-stat-cell">
            <div className="ct-stat-label">Total Contacts</div>
            <div className="ct-stat-value">{stats.total.toLocaleString()}</div>
          </div>
          <div className="ct-stat-cell">
            <div className="ct-stat-label">Leads</div>
            <div className="ct-stat-value">
              {stats.leads.toLocaleString()}
              {stats.total > 0 && <span className="ct-stat-sub">{stats.leadPct}%</span>}
            </div>
          </div>
          <div className="ct-stat-cell">
            <div className="ct-stat-label">Feedback</div>
            <div className="ct-stat-value">{stats.feedback.toLocaleString()}</div>
          </div>
          <div className="ct-stat-cell">
            <div className="ct-stat-label">Added this week</div>
            <div className={`ct-stat-value${stats.addedThisWeek > 0 ? " is-green" : ""}`}>
              {stats.addedThisWeek > 0 ? `+${stats.addedThisWeek.toLocaleString()}` : stats.addedThisWeek.toLocaleString()}
            </div>
          </div>
          <div className="ct-stat-cell">
            <div className="ct-stat-label">Segments</div>
            <div className="ct-stat-value">{stats.segments}</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="ct-tabs-row">
        <button
          type="button"
          className={`ct-tab${activeTab === "contacts" ? " is-active" : ""}`}
          onClick={() => setTab("contacts")}
        >
          Contacts
        </button>
        <button
          type="button"
          className={`ct-tab${activeTab === "segments" ? " is-active" : ""}`}
          onClick={() => setTab("segments")}
        >
          Segments
        </button>
      </div>

      {/* ── Tab content ── */}
      <div className="ct-table-card">
        {activeTab === "contacts" ? (
          <ContactsTab token={token} customFields={customFields} />
        ) : (
          <SegmentsTab token={token} customFields={customFields} />
        )}
      </div>
    </div>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildContactsQueryOptions(token, { limit: 1000 }));
}
