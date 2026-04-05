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

// Standard columns the user can toggle (Name is always pinned)
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
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "-";
  return new Date(timestamp).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function getTypeLabel(value: ContactType): string {
  const map: Record<ContactType, string> = { feedback: "Feedback", complaint: "Complaint", other: "Other", lead: "Lead" };
  return map[value] ?? "Lead";
}

function getSourceLabel(value: ContactSourceType): string {
  const map: Record<ContactSourceType, string> = { manual: "Manual", import: "Import", web: "Website", qr: "WhatsApp QR", api: "WhatsApp API" };
  return map[value] ?? value;
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
  if (!value) return "-";
  if (fieldType === "SWITCH") return value === "true" ? "Yes" : "No";
  if (fieldType === "DATE") return formatDate(value);
  return value;
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 5.5h12l-4.8 5.4v3.4l-2.4 1.2v-4.6L4 5.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.8 12.8 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 13V5m0 0 3 3m-3-3L7 8M4.5 14.5v1h11v-1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 5v8m0 0 3-3m-3 3-3-3M4.5 14.5v1h11v-1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
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
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5.5h14M3 10h14M3 14.5h14M7 3v14M13 3v14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Segment Filter Builder ───────────────────────────────────────────────────

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
    <div className="segment-filter-row">
      {index > 0 && <span className="segment-filter-connector">AND</span>}
      <select
        value={filter.field}
        onChange={(e) => handleFieldChange(e.target.value)}
        className="segment-filter-field"
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
        className="segment-filter-op"
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
            className="segment-filter-value"
          />
        ) : (
          <input
            type="text"
            value={filter.value}
            onChange={(e) => onChange(index, { ...filter, value: e.target.value })}
            placeholder="Value"
            className="segment-filter-value"
          />
        )
      )}

      <button type="button" className="ghost-btn segment-filter-remove" onClick={() => onRemove(index)}>
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
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="kb-modal kb-modal-wide segment-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{initial ? "Edit Segment" : "Create Segment"}</h3>

        <div className="segment-modal-body">
          <label className="segment-name-label">
            Segment Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New leads this month"
              autoFocus
            />
          </label>

          <div className="segment-filters-section">
            <div className="segment-filters-head">
              <strong>Filters</strong>
              <button type="button" className="ghost-btn segment-add-filter-btn" onClick={addFilter}>
                <PlusIcon /> Add Condition
              </button>
            </div>

            {filters.length === 0 ? (
              <p className="segment-no-filters">No filters — segment will include all contacts.</p>
            ) : (
              <div className="segment-filter-list">
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
              className="ghost-btn segment-preview-btn"
              onClick={() => void handlePreview()}
              disabled={previewLoading}
            >
              {previewLoading ? "Loading..." : "Preview Matching Contacts"}
            </button>

            {previewContacts !== null && (
              <div className="segment-preview-result">
                <strong>{previewContacts.length} contact{previewContacts.length !== 1 ? "s" : ""} match</strong>
                {previewContacts.slice(0, 5).map((c) => (
                  <div key={c.id} className="segment-preview-contact">
                    <span className="contacts-avatar" style={{ width: 26, height: 26, fontSize: "0.75rem" }}>
                      {(c.display_name || "U").slice(0, 1).toUpperCase()}
                    </span>
                    <span>{c.display_name || "Unknown"}</span>
                    <span className="segment-preview-phone">{formatPhone(c.phone_number)}</span>
                  </div>
                ))}
                {previewContacts.length > 5 && (
                  <p className="segment-preview-more">+{previewContacts.length - 5} more</p>
                )}
              </div>
            )}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="kb-modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-btn" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving..." : initial ? "Update Segment" : "Create Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="kb-modal kb-modal-wide" onClick={(event) => event.stopPropagation()}>
        <h3>Map Excel Columns</h3>
        <p className="empty-note" style={{ marginTop: "-0.2rem", marginBottom: "1rem" }}>
          Select which Excel column should fill each contact field.
        </p>

        <div className="contacts-form-grid">
          {mappingFields.map((field) => (
            <label key={field.key}>
              {field.label}{field.required ? " *" : ""}
              <select
                value={mapping[field.key] ?? ""}
                onChange={(event) => onMappingChange(field.key, event.target.value)}
              >
                <option value="">Do not import</option>
                {preview.columns.map((column) => (
                  <option key={`${field.key}-${column}`} value={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {preview.sampleRows.length > 0 ? (
          <div className="contacts-table-wrap" style={{ marginTop: "1rem" }}>
            <table className="contacts-table">
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
        ) : null}

        {!canImport ? <p className="error-text">Phone number mapping is required.</p> : null}

        <div className="kb-modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-btn" disabled={importing || !canImport} onClick={onImport}>
            {importing ? "Importing..." : "Import Contacts"}
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
  const [showFilters, setShowFilters] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [importPreview, setImportPreview] = useState<ContactImportPreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMapping, setImportMapping] = useState<ContactImportColumnMapping>({});
  const [formState, setFormState] = useState<ContactFormState>(DEFAULT_FORM_STATE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadVisibleColumns);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const importMenuRef = useRef<HTMLDivElement | null>(null);
  const columnsMenuRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

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
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShowExportMenu(false); setShowImportMenu(false); setShowColumnsMenu(false); setShowAddModal(false); }
    };
    window.addEventListener("mousedown", closeMenus);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("mousedown", closeMenus); window.removeEventListener("keydown", closeOnEscape); };
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
    const customFields: Record<string, string> = {};
    setFormState({ ...DEFAULT_FORM_STATE, customFields });
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
      setInfo("Contact added.");
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
      setInfo(`Import complete. Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`);
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

  const contactRows = useMemo(
    () => contacts.map((contact) => ({ ...contact, tagItems: [getTypeLabel(contact.contact_type), ...contact.tags] })),
    [contacts]
  );

  const setCustomField = (name: string, value: string) => {
    setFormState((current) => ({ ...current, customFields: { ...current.customFields, [name]: value } }));
  };

  const activeCustomFields = customFields.filter((f) => f.is_active);

  // Column picker helpers
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

  return (
    <>
      {info ? <p className="info-text">{info}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="contacts-toolbar">
        <div className="contacts-toolbar-left">
          <button
            type="button"
            className={showFilters ? "ghost-btn contacts-tool-btn active" : "ghost-btn contacts-tool-btn"}
            onClick={() => setShowFilters((c) => !c)}
          >
            <FilterIcon />
            <span>Filter</span>
            {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
          </button>

          <div className="contacts-menu-wrap" ref={columnsMenuRef}>
            <button
              type="button"
              className={showColumnsMenu ? "ghost-btn contacts-tool-btn active" : "ghost-btn contacts-tool-btn"}
              onClick={() => setShowColumnsMenu((c) => !c)}
            >
              <ColumnsIcon />
              <span>Columns</span>
              {visibleColumns.length > 0 ? <strong>{visibleColumns.length}</strong> : null}
            </button>
            {showColumnsMenu && (
              <div className="contacts-menu contacts-columns-menu">
                <p className="contacts-columns-hint">Choose which columns to show</p>
                <div className="contacts-columns-section-label">Standard Fields</div>
                {STANDARD_COLUMN_DEFS.map((col) => (
                  <label key={col.id} className="contacts-columns-row">
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
                    <div className="contacts-columns-section-label" style={{ marginTop: "0.5rem" }}>Custom Fields</div>
                    {customFields.filter((f) => f.is_active).map((f) => (
                      <label key={f.id} className="contacts-columns-row">
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
                <div className="contacts-columns-footer">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => { setVisibleColumns(DEFAULT_VISIBLE_COLUMNS); saveVisibleColumns(DEFAULT_VISIBLE_COLUMNS); }}
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="contacts-toolbar-right">
          <label className="contacts-search">
            <SearchIcon />
            <input value={search} onChange={(e) => updateSearchParam("q", e.target.value)} placeholder="Search contacts" />
          </label>

          <div className="contacts-menu-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className="ghost-btn contacts-tool-btn"
              onClick={() => { setShowImportMenu(false); setShowExportMenu((c) => !c); }}
            >
              <DownloadIcon /><span>Export</span>
            </button>
            {showExportMenu && (
              <div className="contacts-menu">
                <button type="button" disabled={selectedCount === 0} onClick={() => void handleExport("selected")}>
                  Export selected {selectedCount > 0 ? `(${selectedCount})` : ""}
                </button>
                <button type="button" disabled={contacts.length === 0} onClick={() => void handleExport("filtered")}>
                  Export all filtered
                </button>
              </div>
            )}
          </div>

          <div className="contacts-menu-wrap" ref={importMenuRef}>
            <button
              type="button"
              className="ghost-btn contacts-tool-btn"
              onClick={() => { setShowExportMenu(false); setShowImportMenu((c) => !c); }}
            >
              <UploadIcon /><span>Import</span>
            </button>
            {showImportMenu && (
              <div className="contacts-menu">
                <button type="button" onClick={() => void handleTemplateDownload()}>Download template</button>
                <button type="button" onClick={() => { setShowImportMenu(false); fileInputRef.current?.click(); }}>
                  Upload XLSX
                </button>
              </div>
            )}
          </div>

          <button type="button" className="primary-btn contacts-add-btn" onClick={openAddModal}>
            <PlusIcon /><span>Add Contact</span>
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" hidden onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)} />
        </div>
      </div>

      {showFilters && (
        <div className="contacts-filter-bar">
          <label>
            Type
            <select value={typeFilter} onChange={(e) => updateSearchParam("type", e.target.value)}>
              {CONTACT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>
            Source
            <select value={sourceFilter} onChange={(e) => updateSearchParam("source", e.target.value)}>
              {CONTACT_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" className="ghost-btn" onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {importResult && importResult.errors.length > 0 && (
        <div className="contacts-import-summary">
          <strong>Import issues</strong>
          <ul>
            {importResult.errors.slice(0, 6).map((item) => (
              <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>
            ))}
          </ul>
        </div>
      )}

      {contactsQuery.isLoading ? (
        <p className="empty-note">Loading contacts...</p>
      ) : contacts.length === 0 ? (
        <p className="empty-note">
          {activeFilterCount > 0 ? "No contacts match the current search or filters." : "No contacts added yet."}
        </p>
      ) : (
        <div className="contacts-table-wrap">
          <table className="contacts-table">
            <thead>
              <tr>
                <th>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => setSelectedIds(e.target.checked ? contacts.map((c) => c.id) : [])}
                  />
                </th>
                {/* Name is always pinned */}
                <th>Name</th>
                {/* Dynamic columns */}
                {allColumnDefs.filter((col) => isColVisible(col.id)).map((col) => (
                  <th key={col.id}>{col.label}</th>
                ))}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {contactRows.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <input
                      type="checkbox"
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
                  {/* Name always shown */}
                  <td>
                    <div className="contacts-name-cell">
                      <span className="contacts-avatar">{(contact.display_name || "U").slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{contact.display_name || "Unknown"}</strong>
                        {contact.email && !isColVisible("email") ? <small>{contact.email}</small> : null}
                      </div>
                    </div>
                  </td>
                  {/* Dynamic column cells */}
                  {allColumnDefs.filter((col) => isColVisible(col.id)).map((col) => {
                    if (col.id.startsWith("custom:")) {
                      const fieldName = col.id.slice(7);
                      const fv = contact.custom_field_values?.find((v) => v.field_name === fieldName);
                      return <td key={col.id}>{renderFieldValue(fv?.field_type ?? "TEXT", fv?.value ?? null)}</td>;
                    }
                    switch (col.id) {
                      case "phone":       return <td key={col.id}>{formatPhone(contact.phone_number)}</td>;
                      case "email":       return <td key={col.id}>{contact.email || "-"}</td>;
                      case "type":        return <td key={col.id}><span className="contacts-tag contacts-tag-type">{getTypeLabel(contact.contact_type)}</span></td>;
                      case "tags":        return (
                        <td key={col.id}>
                          <div className="contacts-tag-list">
                            {contact.tags.map((tag) => <span key={tag} className="contacts-tag">{tag}</span>)}
                            {contact.tags.length === 0 && <span className="contacts-empty-cell">—</span>}
                          </div>
                        </td>
                      );
                      case "source":      return <td key={col.id}>{getSourceLabel(contact.source_type)}</td>;
                      case "source_id":   return <td key={col.id}>{contact.source_id || "—"}</td>;
                      case "source_url":  return <td key={col.id}>{contact.source_url ? <a href={contact.source_url} target="_blank" rel="noreferrer" className="contacts-link">{contact.source_url}</a> : "—"}</td>;
                      case "created_at":  return <td key={col.id}>{formatDate(contact.created_at)}</td>;
                      case "updated_at":  return <td key={col.id}>{formatDate(contact.updated_at)}</td>;
                      default:            return <td key={col.id}>—</td>;
                    }
                  })}
                  <td>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={!contact.linked_conversation_id}
                      onClick={() => { if (contact.linked_conversation_id) navigate(`/dashboard/inbox/${contact.linked_conversation_id}`); }}
                    >
                      Open Chat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <div className="kb-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="kb-modal kb-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Add Contact</h3>
            <div className="contacts-form-grid">
              <label>
                Name *
                <input value={formState.name} onChange={(e) => setFormState((c) => ({ ...c, name: e.target.value }))} />
              </label>
              <label>
                Phone *
                <input value={formState.phone} onChange={(e) => setFormState((c) => ({ ...c, phone: e.target.value }))} />
              </label>
              <label>
                Email
                <input type="email" value={formState.email} onChange={(e) => setFormState((c) => ({ ...c, email: e.target.value }))} />
              </label>
              <label>
                Type
                <select value={formState.type} onChange={(e) => setFormState((c) => ({ ...c, type: e.target.value as ContactType }))}>
                  {CONTACT_TYPE_OPTIONS.filter((o) => o.value !== "all").map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Tags
                <input value={formState.tags} onChange={(e) => setFormState((c) => ({ ...c, tags: e.target.value }))} placeholder="VIP, Follow up" />
              </label>
              <label>
                Source ID
                <input value={formState.sourceId} onChange={(e) => setFormState((c) => ({ ...c, sourceId: e.target.value }))} />
              </label>
              <label>
                Source URL
                <input type="url" value={formState.sourceUrl} onChange={(e) => setFormState((c) => ({ ...c, sourceUrl: e.target.value }))} />
              </label>

              {activeCustomFields.length > 0 && (
                <div className="contacts-form-custom-divider">
                  <span>Custom Fields</span>
                </div>
              )}

              {activeCustomFields.map((field) => (
                <label key={field.id}>
                  {field.label}{field.is_mandatory ? " *" : ""}
                  {field.field_type === "SWITCH" ? (
                    <select
                      value={formState.customFields[field.name] ?? ""}
                      onChange={(e) => setCustomField(field.name, e.target.value)}
                    >
                      <option value="">Select...</option>
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
                      style={{ resize: "vertical", minHeight: 72, borderRadius: 10, border: "1px solid #cfd9e7", padding: "0.5rem 0.72rem" }}
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
            <div className="kb-modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button type="button" className="primary-btn" disabled={submitting} onClick={() => void handleCreateContact()}>
                {submitting ? "Saving..." : "Save Contact"}
              </button>
            </div>
          </div>
        </div>
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

  const handleSaved = () => {
    setShowModal(false);
    setEditingSegment(null);
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegmentsRoot });
  };

  const openCreate = () => { setEditingSegment(null); setShowModal(true); };
  const openEdit = (seg: ContactSegment) => { setEditingSegment(seg); setShowModal(true); };

  const toggleExpand = (segmentId: string) => {
    setExpandedSegmentId((prev) => (prev === segmentId ? null : segmentId));
  };

  return (
    <>
      <div className="contacts-toolbar">
        <div className="contacts-toolbar-left" />
        <div className="contacts-toolbar-right">
          <button type="button" className="primary-btn contacts-add-btn" onClick={openCreate}>
            <PlusIcon /><span>New Segment</span>
          </button>
        </div>
      </div>

      {segmentsQuery.isLoading ? (
        <p className="empty-note">Loading segments...</p>
      ) : segments.length === 0 ? (
        <div className="segments-empty">
          <p>No segments yet.</p>
          <p>Create dynamic contact groups by combining filters on name, date, type, tags, or custom fields.</p>
          <button type="button" className="primary-btn" onClick={openCreate}>
            <PlusIcon /> Create your first segment
          </button>
        </div>
      ) : (
        <div className="segments-list">
          {segments.map((seg) => {
            const isExpanded = expandedSegmentId === seg.id;
            const segContacts = isExpanded ? (segmentContactsQuery.data ?? []) : [];
            const isLoading = isExpanded && segmentContactsQuery.isFetching;

            return (
              <div key={seg.id} className={`segment-card ${isExpanded ? "segment-card-expanded" : ""}`}>
                <div className="segment-card-head">
                  <div className="segment-card-info">
                    <strong>{seg.name}</strong>
                    <div className="segment-card-filters">
                      {seg.filters.length === 0 ? (
                        <span className="segment-filter-badge">All contacts</span>
                      ) : (
                        seg.filters.map((f, i) => (
                          <span key={i} className="segment-filter-badge">
                            {f.field.startsWith("custom:") ? f.field.slice(7) : f.field} {f.op.replace(/_/g, " ")}
                            {f.value ? ` "${f.value}"` : ""}
                          </span>
                        ))
                      )}
                    </div>
                    <small>Created {formatDate(seg.created_at)}</small>
                  </div>
                  <div className="segment-card-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => toggleExpand(seg.id)}
                    >
                      {isExpanded ? "Collapse" : "View Contacts"}
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => openEdit(seg)}>Edit</button>
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ color: "#e53e3e" }}
                      onClick={() => { if (window.confirm(`Delete segment "${seg.name}"?`)) deleteMutation.mutate(seg.id); }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="segment-card-contacts">
                    {isLoading ? (
                      <p className="empty-note">Loading contacts...</p>
                    ) : segContacts.length === 0 ? (
                      <p className="empty-note">No contacts match this segment.</p>
                    ) : (
                      <table className="contacts-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Tags</th>
                            <th>Created</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {segContacts.slice(0, 50).map((c) => (
                            <tr key={c.id}>
                              <td>
                                <div className="contacts-name-cell">
                                  <span className="contacts-avatar">{(c.display_name || "U").slice(0, 1).toUpperCase()}</span>
                                  <div>
                                    <strong>{c.display_name || "Unknown"}</strong>
                                    {c.email ? <small>{c.email}</small> : null}
                                  </div>
                                </div>
                              </td>
                              <td>{formatPhone(c.phone_number)}</td>
                              <td>
                                <div className="contacts-tag-list">
                                  <span className="contacts-tag contacts-tag-type">{getTypeLabel(c.contact_type)}</span>
                                  {c.tags.slice(0, 2).map((tag) => (
                                    <span key={tag} className="contacts-tag">{tag}</span>
                                  ))}
                                </div>
                              </td>
                              <td>{formatDate(c.created_at)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="ghost-btn"
                                  disabled={!c.linked_conversation_id}
                                  onClick={() => { if (c.linked_conversation_id) navigate(`/dashboard/inbox/${c.linked_conversation_id}`); }}
                                >
                                  Open Chat
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {segContacts.length > 50 && <p className="segment-preview-more">Showing 50 of {segContacts.length} contacts</p>}
                  </div>
                )}
              </div>
            );
          })}
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

  const setTab = (tab: TabId) => {
    const next = new URLSearchParams();
    next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <section className="finance-shell contacts-shell">
      <article className="finance-panel contacts-panel">
        <div className="contacts-tab-bar">
          <button
            type="button"
            className={activeTab === "contacts" ? "contacts-tab active" : "contacts-tab"}
            onClick={() => setTab("contacts")}
          >
            Contacts
          </button>
          <button
            type="button"
            className={activeTab === "segments" ? "contacts-tab active" : "contacts-tab"}
            onClick={() => setTab("segments")}
          >
            Segments
          </button>
        </div>

        {activeTab === "contacts" ? (
          <ContactsTab token={token} customFields={customFields} />
        ) : (
          <SegmentsTab token={token} customFields={customFields} />
        )}
      </article>
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildContactsQueryOptions(token, { limit: 1000 }));
}
