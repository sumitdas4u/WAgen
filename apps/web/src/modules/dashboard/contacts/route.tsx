import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  createManualContact,
  downloadContactsTemplate,
  exportContactsWorkbook,
  type ContactImportResult,
  type ContactSourceType,
  type ContactType,
  uploadContactsWorkbook
} from "./api";
import { buildContactsQueryOptions, useContactsQuery } from "./queries";

type ContactTypeFilter = "all" | ContactType;
type ContactSourceFilter = "all" | ContactSourceType;

type ContactFormState = {
  name: string;
  phone: string;
  email: string;
  type: ContactType;
  tags: string;
  orderDate: string;
  sourceId: string;
  sourceUrl: string;
};

const DEFAULT_FORM_STATE: ContactFormState = {
  name: "",
  phone: "",
  email: "",
  type: "lead",
  tags: "",
  orderDate: "",
  sourceId: "",
  sourceUrl: ""
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
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  return new Date(timestamp).toLocaleString();
}

function getTypeLabel(value: ContactType): string {
  switch (value) {
    case "feedback":
      return "Feedback";
    case "complaint":
      return "Complaint";
    case "other":
      return "Other";
    default:
      return "Lead";
  }
}

function getSourceLabel(value: ContactSourceType): string {
  switch (value) {
    case "manual":
      return "Manual";
    case "import":
      return "Import";
    case "web":
      return "Website";
    case "qr":
      return "WhatsApp QR";
    case "api":
      return "WhatsApp API";
    default:
      return value;
  }
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

function canRenderUrl(value: string | null): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

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

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [formState, setFormState] = useState<ContactFormState>(DEFAULT_FORM_STATE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const importMenuRef = useRef<HTMLDivElement | null>(null);
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
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => contacts.some((contact) => contact.id === id)));
  }, [contacts]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (exportMenuRef.current && event.target instanceof Node && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
      if (importMenuRef.current && event.target instanceof Node && !importMenuRef.current.contains(event.target)) {
        setShowImportMenu(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowExportMenu(false);
        setShowImportMenu(false);
        setShowAddModal(false);
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
    if (!value || value === "all") {
      next.delete(name);
    } else {
      next.set(name, value);
    }
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

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
    setFormState(DEFAULT_FORM_STATE);
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
        orderDate: formState.orderDate || undefined,
        sourceId: formState.sourceId || undefined,
        sourceUrl: formState.sourceUrl || undefined
      });
      await invalidateContacts();
      setShowAddModal(false);
      setFormState(DEFAULT_FORM_STATE);
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
    if (!file) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setInfo(null);
    setImportResult(null);
    try {
      const result = await uploadContactsWorkbook(token, file);
      await invalidateContacts();
      setImportResult(result);
      setInfo(`Import complete. Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`);
    } catch (importError) {
      setError((importError as Error).message);
    } finally {
      setSubmitting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleExport = async (mode: "selected" | "filtered") => {
    setShowExportMenu(false);
    setError(null);
    try {
      const payload =
        mode === "selected"
          ? { ids: selectedIds }
          : {
              filters: {
                q: search || undefined,
                type: typeFilter === "all" ? undefined : typeFilter,
                source: sourceFilter === "all" ? undefined : sourceFilter,
                limit: 1000
              }
            };
      const { blob, filename } = await exportContactsWorkbook(token, payload);
      downloadBlob(blob, filename);
    } catch (exportError) {
      setError((exportError as Error).message);
    }
  };

  const contactRows = useMemo(
    () =>
      contacts.map((contact) => ({
        ...contact,
        tagItems: [getTypeLabel(contact.contact_type), ...contact.tags]
      })),
    [contacts]
  );

  return (
    <section className="finance-shell contacts-shell">
      <article className="finance-panel contacts-panel">
        {info ? <p className="info-text">{info}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="contacts-toolbar">
          <div className="contacts-toolbar-left">
            <button
              type="button"
              className={showFilters ? "ghost-btn contacts-tool-btn active" : "ghost-btn contacts-tool-btn"}
              onClick={() => setShowFilters((current) => !current)}
            >
              <FilterIcon />
              <span>Filter</span>
              {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
            </button>
          </div>

          <div className="contacts-toolbar-right">
            <label className="contacts-search">
              <SearchIcon />
              <input
                value={search}
                onChange={(event) => updateSearchParam("q", event.target.value)}
                placeholder="Search contacts"
              />
            </label>

            <div className="contacts-menu-wrap" ref={exportMenuRef}>
              <button
                type="button"
                className="ghost-btn contacts-tool-btn"
                onClick={() => {
                  setShowImportMenu(false);
                  setShowExportMenu((current) => !current);
                }}
              >
                <DownloadIcon />
                <span>Export</span>
              </button>
              {showExportMenu ? (
                <div className="contacts-menu">
                  <button type="button" disabled={selectedCount === 0} onClick={() => void handleExport("selected")}>
                    Export selected {selectedCount > 0 ? `(${selectedCount})` : ""}
                  </button>
                  <button type="button" disabled={contacts.length === 0} onClick={() => void handleExport("filtered")}>
                    Export all filtered
                  </button>
                </div>
              ) : null}
            </div>

            <div className="contacts-menu-wrap" ref={importMenuRef}>
              <button
                type="button"
                className="ghost-btn contacts-tool-btn"
                onClick={() => {
                  setShowExportMenu(false);
                  setShowImportMenu((current) => !current);
                }}
              >
                <UploadIcon />
                <span>Import</span>
              </button>
              {showImportMenu ? (
                <div className="contacts-menu">
                  <button type="button" onClick={() => void handleTemplateDownload()}>
                    Download template
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowImportMenu(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    Upload XLSX
                  </button>
                </div>
              ) : null}
            </div>

            <button type="button" className="primary-btn contacts-add-btn" onClick={openAddModal}>
              <PlusIcon />
              <span>Add Contact</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {showFilters ? (
          <div className="contacts-filter-bar">
            <label>
              Type
              <select value={typeFilter} onChange={(event) => updateSearchParam("type", event.target.value)}>
                {CONTACT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select value={sourceFilter} onChange={(event) => updateSearchParam("source", event.target.value)}>
                {CONTACT_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost-btn" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : null}

        {importResult && importResult.errors.length > 0 ? (
          <div className="contacts-import-summary">
            <strong>Import issues</strong>
            <ul>
              {importResult.errors.slice(0, 6).map((item) => (
                <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

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
                      onChange={(event) =>
                        setSelectedIds(event.target.checked ? contacts.map((contact) => contact.id) : [])
                      }
                    />
                  </th>
                  <th>Name</th>
                  <th>Tags</th>
                  <th>Phone</th>
                  <th>Order Date</th>
                  <th>Contact Created Source</th>
                  <th>Source ID</th>
                  <th>Source URL</th>
                  <th>Created Date</th>
                  <th>Last Updated</th>
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
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, contact.id]))
                              : current.filter((item) => item !== contact.id)
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="contacts-name-cell">
                        <span className="contacts-avatar">
                          {(contact.display_name || "U").slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{contact.display_name || "Unknown"}</strong>
                          {contact.email ? <small>{contact.email}</small> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="contacts-tag-list">
                        {contact.tagItems.map((tag, index) => (
                          <span
                            key={`${contact.id}-${tag}-${index}`}
                            className={index === 0 ? "contacts-tag contacts-tag-type" : "contacts-tag"}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{formatPhone(contact.phone_number)}</td>
                    <td>{formatDateTime(contact.order_date)}</td>
                    <td>{getSourceLabel(contact.source_type)}</td>
                    <td>{contact.source_id || "-"}</td>
                    <td>
                      {canRenderUrl(contact.source_url) ? (
                        <a href={contact.source_url ?? "#"} target="_blank" rel="noreferrer" className="contacts-link">
                          {contact.source_url}
                        </a>
                      ) : (
                        contact.source_url || "-"
                      )}
                    </td>
                    <td>{formatDate(contact.created_at)}</td>
                    <td>{formatDateTime(contact.updated_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={!contact.linked_conversation_id}
                        onClick={() => {
                          if (contact.linked_conversation_id) {
                            navigate(`/dashboard/inbox/${contact.linked_conversation_id}`);
                          }
                        }}
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
      </article>

      {showAddModal ? (
        <div className="kb-modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="kb-modal kb-modal-wide" onClick={(event) => event.stopPropagation()}>
            <h3>Add Contact</h3>
            <div className="contacts-form-grid">
              <label>
                Name
                <input
                  value={formState.name}
                  onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label>
                Phone
                <input
                  value={formState.phone}
                  onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={formState.email}
                  onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
              <label>
                Type
                <select
                  value={formState.type}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, type: event.target.value as ContactType }))
                  }
                >
                  {CONTACT_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tags
                <input
                  value={formState.tags}
                  onChange={(event) => setFormState((current) => ({ ...current, tags: event.target.value }))}
                  placeholder="VIP, Follow up"
                />
              </label>
              <label>
                Order Date
                <input
                  type="datetime-local"
                  value={formState.orderDate}
                  onChange={(event) => setFormState((current) => ({ ...current, orderDate: event.target.value }))}
                />
              </label>
              <label>
                Source ID
                <input
                  value={formState.sourceId}
                  onChange={(event) => setFormState((current) => ({ ...current, sourceId: event.target.value }))}
                />
              </label>
              <label>
                Source URL
                <input
                  type="url"
                  value={formState.sourceUrl}
                  onChange={(event) => setFormState((current) => ({ ...current, sourceUrl: event.target.value }))}
                />
              </label>
            </div>
            <div className="kb-modal-actions">
              <button type="button" className="ghost-btn" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button type="button" className="primary-btn" disabled={submitting} onClick={() => void handleCreateContact()}>
                {submitting ? "Saving..." : "Save Contact"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildContactsQueryOptions(token, { limit: 1000 }));
}
