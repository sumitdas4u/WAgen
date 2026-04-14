import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  createContactSegment,
  cancelCampaignRun,
  createCampaignDraft,
  deleteContactSegment,
  downloadContactsTemplate,
  fetchBroadcastReport,
  fetchBroadcastRetargetPreview,
  fetchBroadcasts,
  fetchSegmentContacts,
  importBroadcastAudienceWorkbook,
  launchCampaignDraft,
  listContactFields,
  listContactSegments,
  previewSegmentContacts,
  previewBroadcastAudienceWorkbookImport,
  sendTestTemplate,
  type Campaign,
  type ContactImportColumnMapping,
  type ContactImportPreview,
  type CampaignMediaOverrides,
  type CampaignTemplateVariables,
  type ContactField,
  type ContactRecord,
  type MessageTemplate,
  type MetaBusinessConnection,
  type SegmentFilter,
  type SegmentFilterOp,
  type RetargetStatus
} from "../../../lib/api";
import { uploadBroadcastMedia as uploadBroadcastMediaToSupabase } from "../../../lib/supabase";
import { MetaConnectionSelector, isMetaConnectionActive } from "../../../shared/dashboard/meta-connection-selector";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { useAgentsQuery } from "../agents/queries";
import { useInboxPublishedFlowsQuery } from "../inbox/queries";
import { TemplatePreviewPanel } from "../templates/TemplatePreviewPanel";
import { useTemplatesQuery } from "../templates/queries";
import "./broadcast.css";
import "../contacts/contacts.css";

type ModuleMode = "list" | "new" | "detail" | "retarget";
type WizardStep = 1 | 2 | 3 | 4;
type BroadcastReplyMode = "ai" | "flow";

const STANDARD_CONTACT_FIELDS = [
  { value: "display_name", label: "Contact name" },
  { value: "phone_number", label: "Phone number" },
  { value: "email", label: "Email" },
  { value: "contact_type", label: "Contact type" },
  { value: "tags", label: "Tags" },
  { value: "source_type", label: "Source type" },
  { value: "source_id", label: "Source ID" },
  { value: "source_url", label: "Source URL" }
] as const;

const RETARGET_OPTIONS: Array<{ value: RetargetStatus; label: string }> = [
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "read", label: "Read" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Not delivered" }
];

const SEGMENT_FIELD_OPTIONS: Array<{ value: string; label: string; isDate?: boolean }> = [
  { value: "display_name", label: "Name" },
  { value: "phone_number", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "contact_type", label: "Type" },
  { value: "source_type", label: "Source" },
  { value: "tags", label: "Tags" },
  { value: "created_at", label: "Created Date", isDate: true },
  { value: "order_date", label: "Order Date", isDate: true }
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

const BROADCAST_STATUS_OPTIONS: Campaign["status"][] = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled"
];

function extractTemplatePlaceholders(template: MessageTemplate | null): string[] {
  if (!template) {
    return [];
  }
  return Array.from(
    new Set(
      [...JSON.stringify(template.components).matchAll(/\{\{[^}]+\}\}/g)]
        .map((match) => match[0])
        .sort((left, right) => left.localeCompare(right))
    )
  );
}

function resolveContactFieldValue(contact: ContactRecord | null, field: string | undefined): string {
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

function resolveBindingPreviewValue(
  placeholder: string,
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null
): string {
  const binding = bindings[placeholder];
  if (!binding) {
    return placeholder;
  }

  if (binding.source === "static") {
    return binding.value?.trim() || binding.fallback?.trim() || placeholder;
  }

  const contactValue = resolveContactFieldValue(sampleContact, binding.field);
  return contactValue || binding.fallback?.trim() || placeholder;
}

function buildPreviewComponents(
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
        resolveBindingPreviewValue(match, bindings, sampleContact)
      )
    };
  });
}

function resolveBroadcastVariableValues(
  bindings: CampaignTemplateVariables,
  sampleContact: ContactRecord | null,
  mediaOverrides: CampaignMediaOverrides
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const placeholder of Object.keys(bindings)) {
    const value = resolveBindingPreviewValue(placeholder, bindings, sampleContact).trim();
    if (value) {
      resolved[placeholder] = value;
    }
  }

  for (const [key, value] of Object.entries(mediaOverrides)) {
    const trimmed = value.trim();
    if (trimmed) {
      resolved[key] = trimmed;
    }
  }

  return resolved;
}

function formatCampaignStatus(status: Campaign["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function shouldPollCampaign(status: Campaign["status"]): boolean {
  return status === "running" || status === "scheduled";
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function formatShortDate(value: string): string {
  const timestamp = Date.parse(`${value}T00:00:00`);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateRangeLabel(fromDate: string, toDate: string): string {
  if (fromDate && toDate) {
    return `${formatShortDate(fromDate)} to ${formatShortDate(toDate)}`;
  }
  if (fromDate) {
    return `From ${formatShortDate(fromDate)}`;
  }
  if (toDate) {
    return `Until ${formatShortDate(toDate)}`;
  }
  return "From date | To date";
}

function matchesCreatedDateRange(value: string, fromDate: string, toDate: string): boolean {
  const createdAt = Date.parse(value);
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  if (fromDate) {
    const startAt = Date.parse(`${fromDate}T00:00:00`);
    if (Number.isFinite(startAt) && createdAt < startAt) {
      return false;
    }
  }
  if (toDate) {
    const endAt = Date.parse(`${toDate}T23:59:59.999`);
    if (Number.isFinite(endAt) && createdAt > endAt) {
      return false;
    }
  }
  return true;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function downloadBroadcastsCsv(broadcasts: Campaign[]): void {
  const headers = [
    "Broadcast Name",
    "Status",
    "Broadcast Type",
    "Recipients",
    "Sent",
    "Delivered",
    "Read",
    "Failed",
    "Skipped",
    "Scheduled",
    "Started",
    "Completed",
    "Created",
    "Updated"
  ];

  const csvRows = broadcasts.map((broadcast) => [
    broadcast.name,
    formatCampaignStatus(broadcast.status),
    broadcast.broadcast_type,
    broadcast.total_count,
    broadcast.sent_count,
    broadcast.delivered_count,
    broadcast.read_count,
    broadcast.failed_count,
    broadcast.skipped_count,
    broadcast.scheduled_at ? formatDateTime(broadcast.scheduled_at) : "",
    broadcast.started_at ? formatDateTime(broadcast.started_at) : "",
    broadcast.completed_at ? formatDateTime(broadcast.completed_at) : "",
    formatDateTime(broadcast.created_at),
    formatDateTime(broadcast.updated_at)
  ]);

  const csv = [headers, ...csvRows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\n");

  downloadBlob(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" }),
    `broadcasts-export-${new Date().toISOString().slice(0, 10)}.csv`
  );
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

function BroadcastListPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<Campaign["status"][]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const dateMenuRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  const broadcastsQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcasts,
    queryFn: () => fetchBroadcasts(token),
    refetchInterval: (query) =>
      (query.state.data?.broadcasts ?? []).some((broadcast) => shouldPollCampaign(broadcast.status))
        ? 5000
        : false
  });

  const data = broadcastsQuery.data;
  const summary = data?.summary;
  const hasLiveBroadcast = (data?.broadcasts ?? []).some((broadcast) => shouldPollCampaign(broadcast.status));

  const allBroadcasts = data?.broadcasts ?? [];
  const filtered = useMemo(
    () =>
      allBroadcasts.filter((broadcast) => {
        const normalizedSearch = search.trim().toLowerCase();
        const matchesSearch =
          !normalizedSearch ||
          broadcast.name.toLowerCase().includes(normalizedSearch) ||
          formatCampaignStatus(broadcast.status).toLowerCase().includes(normalizedSearch);
        const matchesStatus =
          selectedStatuses.length === 0 || selectedStatuses.includes(broadcast.status);
        const matchesDate = matchesCreatedDateRange(broadcast.created_at, fromDate, toDate);
        return matchesSearch && matchesStatus && matchesDate;
      }),
    [allBroadcasts, search, selectedStatuses, fromDate, toDate]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const hasActiveHeaderFilters = Boolean(fromDate || toDate || selectedStatuses.length > 0);
  const dateFilterLabel = formatDateRangeLabel(fromDate, toDate);

  useEffect(() => {
    setPage(1);
  }, [search, fromDate, toDate, selectedStatuses, rowsPerPage]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (dateMenuRef.current && event.target instanceof Node && !dateMenuRef.current.contains(event.target)) {
        setShowDateMenu(false);
      }
      if (filterMenuRef.current && event.target instanceof Node && !filterMenuRef.current.contains(event.target)) {
        setShowFilterMenu(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDateMenu(false);
        setShowFilterMenu(false);
        setOpenMenuId(null);
      }
    };

    window.addEventListener("mousedown", closeMenus);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeMenus);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const toggleStatusFilter = (status: Campaign["status"]) => {
    setSelectedStatuses((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status]
    );
  };

  const clearHeaderFilters = () => {
    setFromDate("");
    setToDate("");
    setSelectedStatuses([]);
  };

  const DATE_RANGE_LABELS: Record<typeof dateRange, string> = {
    "7d": "Past 7 days",
    "30d": "Past 30 days",
    "90d": "Past 90 days",
    "all": "All time"
  };

  const overviewStats = [
    { label: "Recipients", value: summary?.recipients ?? 0, pctVal: null, icon: "👥" },
    { label: "Sent", value: summary?.sent ?? 0, pctVal: pct(summary?.sent ?? 0, summary?.recipients ?? 0), icon: "✓" },
    { label: "Delivered", value: summary?.delivered ?? 0, pctVal: pct(summary?.delivered ?? 0, summary?.recipients ?? 0), icon: "✓✓" },
    { label: "Engaged", value: summary?.engaged ?? 0, pctVal: pct(summary?.engaged ?? 0, summary?.recipients ?? 0), icon: "↩" },
    { label: "Not in WhatsApp", value: summary?.suppressed ?? 0, pctVal: pct(summary?.suppressed ?? 0, summary?.recipients ?? 0), icon: "⊘" },
    { label: "Frequency Limit", value: summary?.frequencyLimited ?? 0, pctVal: pct(summary?.frequencyLimited ?? 0, summary?.recipients ?? 0), icon: "∞" },
    { label: "Failed", value: summary?.failed ?? 0, pctVal: pct(summary?.failed ?? 0, summary?.recipients ?? 0), icon: "!" }
  ];

  return (
    <section className="broadcast-page">
      {/* Page header */}
      <div className="bl-page-header">
        <h2 className="bl-page-title">Broadcast</h2>
        <div className="bl-page-header-actions">
          {hasLiveBroadcast ? <div className="broadcast-live-note">Live updates active</div> : null}
          <button
            type="button"
            onClick={() => navigate("/dashboard/broadcast/new")}
            className="bl-new-btn"
          >
            + New Broadcast
          </button>
        </div>
      </div>

      {/* Overview */}
      <div className="bl-overview-card">
        <div className="bl-overview-head">
          <span className="bl-overview-title">Overview</span>
          <div className="bl-date-range-tabs">
            {(["7d", "30d", "90d", "all"] as const).map((range) => (
              <button
                key={range}
                type="button"
                className={`bl-date-tab ${dateRange === range ? "is-active" : ""}`}
                onClick={() => setDateRange(range)}
              >
                {DATE_RANGE_LABELS[range]}
              </button>
            ))}
          </div>
        </div>
        <div className="bl-overview-stats">
          {overviewStats.map((stat) => (
            <div key={stat.label} className="bl-stat-cell">
              <div className="bl-stat-label">{stat.label}</div>
              <div className="bl-stat-value">
                {stat.value}
                {stat.pctVal !== null ? <span className="bl-stat-pct">{stat.pctVal}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Close dropdown on outside click */}
      {openMenuId ? <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpenMenuId(null)} /> : null}

      {/* Table section */}
      <section className="broadcast-table-shell">
        <div className="bl-table-toolbar">
          <span className="bl-table-title">All Broadcasts</span>
          <div className="bl-toolbar-right">
            <button
              type="button"
              className="bl-icon-btn"
              onClick={() => void broadcastsQuery.refetch()}
              disabled={broadcastsQuery.isFetching}
              title="Refresh"
            >
              {broadcastsQuery.isFetching ? "⟳" : "⟳"}
            </button>
            <div className="bl-search-wrap">
              <span className="bl-search-icon">&#128269;</span>
              <input
                className="bl-search-input"
                type="text"
                placeholder="Search broadcasts…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <div className="dd-wrap" ref={dateMenuRef}>
              <button
                type="button"
                className={`bl-date-filter${showDateMenu ? " is-active" : ""}`}
                onClick={() => {
                  setOpenMenuId(null);
                  setShowFilterMenu(false);
                  setShowDateMenu((current) => !current);
                }}
              >
                <span className="bl-date-filter-label">{dateFilterLabel}</span>
                <span className="bl-date-filter-icon">&#128197;</span>
              </button>
              {showDateMenu ? (
                <div className="dd-menu bl-toolbar-menu bl-date-menu">
                  <div className="bl-toolbar-menu-title">Filter by created date</div>
                  <label className="bl-toolbar-field">
                    <span>From date</span>
                    <input
                      type="date"
                      value={fromDate}
                      max={toDate || undefined}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </label>
                  <label className="bl-toolbar-field">
                    <span>To date</span>
                    <input
                      type="date"
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </label>
                  <div className="bl-toolbar-menu-footer">
                    <button type="button" className="bl-toolbar-link" onClick={() => { setFromDate(""); setToDate(""); }}>
                      Clear dates
                    </button>
                    <button type="button" className="bl-toolbar-btn bl-toolbar-btn-compact" onClick={() => setShowDateMenu(false)}>
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="bl-toolbar-btn"
              disabled={filtered.length === 0}
              onClick={() => downloadBroadcastsCsv(filtered)}
            >
              &#11123; Export
            </button>
            <div className="dd-wrap" ref={filterMenuRef}>
              <button
                type="button"
                className={`bl-toolbar-btn${showFilterMenu ? " is-active" : ""}`}
                onClick={() => {
                  setOpenMenuId(null);
                  setShowDateMenu(false);
                  setShowFilterMenu((current) => !current);
                }}
              >
                &#9965; Filter
                {selectedStatuses.length > 0 ? <span className="bl-filter-count">{selectedStatuses.length}</span> : null}
              </button>
              {showFilterMenu ? (
                <div className="dd-menu bl-toolbar-menu bl-filter-menu">
                  <div className="bl-toolbar-menu-title">Campaign status</div>
                  {BROADCAST_STATUS_OPTIONS.map((status) => (
                    <label key={status} className="bl-filter-option">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes(status)}
                        onChange={() => toggleStatusFilter(status)}
                      />
                      <span>{formatCampaignStatus(status)}</span>
                    </label>
                  ))}
                  <div className="bl-toolbar-menu-footer">
                    <button type="button" className="bl-toolbar-link" onClick={clearHeaderFilters}>
                      Clear filters
                    </button>
                    <button type="button" className="bl-toolbar-btn bl-toolbar-btn-compact" onClick={() => setShowFilterMenu(false)}>
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {hasActiveHeaderFilters ? (
              <button type="button" className="bl-toolbar-btn" onClick={clearHeaderFilters}>
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <table className="broadcast-table">
          <thead>
            <tr>
              {[
                "Broadcast Name",
                "Status",
                "Recipients",
                "Sent",
                "Delivered",
                "Read",
                "Engaged",
                "Not in WhatsApp",
                "Frequency Limit",
                "Failed",
                "Created",
                "Actions"
              ].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((broadcast) => {
              const sentPct = pct(broadcast.sent_count, broadcast.total_count);
              const delivPct = pct(broadcast.delivered_count, broadcast.total_count);
              const readPct = pct(broadcast.read_count, broadcast.total_count);
              const failPct = pct(broadcast.failed_count, broadcast.total_count);
              return (
                <tr key={broadcast.id}>
                  <td
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}`)}
                  >
                    <div className="bl-cell-date">{formatDateTime(broadcast.created_at)}</div>
                    <div className="bl-cell-name" style={{ color: "#2563eb" }}>{broadcast.name}</div>
                  </td>
                  <td>
                    <span className={`bl-status-pill status-${broadcast.status}`}>
                      {formatCampaignStatus(broadcast.status)}
                    </span>
                  </td>
                  <td>
                    <div className="bl-count-wrap">
                      <span className="bl-icon-circle bl-icon-neutral">&#128100;</span>
                      {broadcast.total_count}
                    </div>
                  </td>
                  <td>
                    <div className="bl-count-wrap">
                      <span className="bl-ring-icon" />
                      <div>
                        <div>{broadcast.sent_count}</div>
                        <div className="bl-count-pct">{sentPct}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="bl-count-wrap">
                      <span className="bl-ring-icon" />
                      <div>
                        <div>{broadcast.delivered_count}</div>
                        <div className="bl-count-pct">{delivPct}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="bl-count-wrap">
                      <span className="bl-ring-icon bl-ring-blue" />
                      <div>
                        <div>{broadcast.read_count}</div>
                        <div className="bl-count-pct">{readPct}</div>
                      </div>
                    </div>
                  </td>
                  <td>0<div className="bl-count-pct">0%</div></td>
                  <td className="bl-muted-cell">N/A</td>
                  <td className="bl-muted-cell">N/A</td>
                  <td>
                    <div className="bl-count-wrap">
                      <span className="bl-ring-icon bl-ring-rose" />
                      <div>
                        <div>{broadcast.failed_count}</div>
                        <div className="bl-count-pct">{failPct}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="bl-created-cell">
                      <div className="bl-created-name">Sumit Das</div>
                      <div className="bl-created-date">{formatDateTime(broadcast.created_at)}</div>
                    </div>
                  </td>
                  <td>
                    <div className="bl-action-cell">
                      <button
                        type="button"
                        className="bl-retarget-btn"
                        onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}/retarget`)}
                      >
                        &#9965; Retarget
                      </button>
                      <div className="dd-wrap">
                        <button
                          type="button"
                          className="bl-more-btn"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === broadcast.id ? null : broadcast.id); }}
                          title="More"
                        >
                          &#8942;
                        </button>
                        {openMenuId === broadcast.id ? (
                          <div className="dd-menu">
                            <button
                              type="button"
                              className="dd-item"
                              onClick={() => { navigate(`/dashboard/broadcast/${broadcast.id}`); setOpenMenuId(null); }}
                            >
                              &#11123; Download Report
                            </button>
                            <button
                              type="button"
                              className="dd-item"
                              onClick={() => { navigate("/dashboard/broadcast/new"); setOpenMenuId(null); }}
                            >
                              &#8635; Repeat Broadcast
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!broadcastsQuery.isLoading && filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="broadcast-empty-state">
                  {search || hasActiveHeaderFilters ? "No broadcasts match your current filters." : "No broadcasts created yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="bl-pagination">
          <div className="bl-rows-per-page">
            <span>Show rows per page</span>
            <select
              className="bl-rows-select"
              value={rowsPerPage}
              onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="bl-page-info">
            Showing {filtered.length === 0 ? "0" : `${(page - 1) * rowsPerPage + 1}–${Math.min(page * rowsPerPage, filtered.length)}`} of{" "}
            <strong>{filtered.length} total</strong>
          </div>
          <div className="bl-page-nav">
            <button
              type="button"
              className="bl-nav-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="bl-nav-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

function BroadcastDetailPage({ token, campaignId }: { token: string; campaignId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reportQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcastReport(campaignId, "all", 0),
    queryFn: () => fetchBroadcastReport(token, campaignId).then((response) => response.report),
    refetchInterval: (query) =>
      query.state.data && shouldPollCampaign(query.state.data.campaign.status) ? 4000 : false
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelCampaignRun(token, campaignId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.broadcasts }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.broadcastReport(campaignId, "all", 0) })
      ]);
    }
  });

  const report = reportQuery.data;
  if (!report) {
    return <div className="broadcast-loading">Loading broadcast report…</div>;
  }
  const isLiveUpdating = shouldPollCampaign(report.campaign.status);

  const totalCount = report.campaign.total_count;
  const detailStats = [
    { label: "Recipients", value: totalCount, pct: null },
    { label: "Sent", value: report.buckets.sent, pct: pct(report.buckets.sent, totalCount) },
    { label: "Delivered", value: report.buckets.delivered, pct: pct(report.buckets.delivered, totalCount) },
    { label: "Read", value: report.buckets.read, pct: pct(report.buckets.read, totalCount) },
    { label: "Failed", value: report.buckets.failed, pct: pct(report.buckets.failed, totalCount) },
    { label: "Not Delivered", value: report.buckets.skipped, pct: pct(report.buckets.skipped, totalCount) }
  ];

  return (
    <section className="broadcast-page">
      {/* Header */}
      <div className="bl-page-header">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <button
            type="button"
            className="wz-back-btn"
            style={{ fontSize: "0.82rem", marginBottom: "0.25rem" }}
            onClick={() => navigate("/dashboard/broadcast")}
          >
            &#8592; All Broadcasts
          </button>
          <h2 className="bl-page-title">{report.campaign.name}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.15rem" }}>
            <span className={`bl-status-pill status-${report.campaign.status}`}>
              {formatCampaignStatus(report.campaign.status)}
            </span>
            <span style={{ fontSize: "0.78rem", color: "#5f6f86" }}>
              Created {formatDateTime(report.campaign.created_at)}
            </span>
            {isLiveUpdating ? (
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#16a34a", background: "#dcfce7", padding: "0.15rem 0.5rem", borderRadius: "999px", border: "1px solid #bbf7d0" }}>
                ● Live
              </span>
            ) : null}
          </div>
        </div>
        <div className="bl-page-header-actions">
          <button
            type="button"
            className="bl-toolbar-btn"
            onClick={() => void reportQuery.refetch()}
            disabled={reportQuery.isFetching}
          >
            ⟳ {reportQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="bl-toolbar-btn"
            onClick={() => navigate(`/dashboard/broadcast/${campaignId}/retarget`)}
          >
            &#9965; Retarget
          </button>
          {(report.campaign.status === "running" || report.campaign.status === "scheduled" || report.campaign.status === "draft") ? (
            <button
              type="button"
              className="bl-toolbar-btn"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              style={{ color: "#be123c", borderColor: "#fecdd3" }}
            >
              {cancelMutation.isPending ? "Cancelling…" : "✕ Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Stats overview */}
      <div className="bl-overview-card">
        <div className="bl-overview-head">
          <span className="bl-overview-title">Delivery Overview</span>
        </div>
        <div className="bl-overview-stats" style={{ gridTemplateColumns: `repeat(${detailStats.length}, minmax(0,1fr))` }}>
          {detailStats.map((stat) => (
            <div key={stat.label} className="bl-stat-cell">
              <div className="bl-stat-label">{stat.label}</div>
              <div className="bl-stat-value">
                {stat.value}
                {stat.pct !== null ? <span className="bl-stat-pct">{stat.pct}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delivery log table */}
      <section className="broadcast-table-shell">
        <div className="bl-table-toolbar">
          <span className="bl-table-title">Recipient delivery log</span>
          <div className="bl-toolbar-right">
            <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Every recipient status and message failure in a clearer audit trail</span>
          </div>
        </div>
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Phone", "Status", "Sent", "Delivered", "Read", "Error"].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.messages.map((message) => (
              <tr key={message.id}>
                <td style={{ fontWeight: 600 }}>{message.phone_number}</td>
                <td>
                  <span className={`bl-status-pill status-${String(message.status)}`}>
                    {formatCampaignStatus(message.status as Campaign["status"])}
                  </span>
                </td>
                <td>{message.sent_at ? formatDateTime(message.sent_at) : "—"}</td>
                <td>{message.delivered_at ? formatDateTime(message.delivered_at) : "—"}</td>
                <td>{message.read_at ? formatDateTime(message.read_at) : "—"}</td>
                <td style={{ color: message.error_message ? "#be123c" : "#94a3b8", fontSize: "0.8rem" }}>
                  {message.error_message || "—"}
                </td>
              </tr>
            ))}
            {report.messages.length === 0 ? (
              <tr>
                <td colSpan={6} className="broadcast-empty-state">No delivery records yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function WizardStepHeader({
  mode,
  step
}: {
  mode: "new" | "retarget";
  step: WizardStep;
}) {
  const labels =
    mode === "retarget"
      ? ["Retarget Audience", "Select Template", "Map Variables & Media", "Schedule Broadcast"]
      : ["Select Template", "Select Audience", "Map Variables & Media", "Schedule Broadcast"];

  return (
    <div className="wz-stepper">
      {labels.map((label, index) => {
        const current = (index + 1) as WizardStep;
        const active = current === step;
        const complete = current < step;
        return (
          <div key={label} className="wz-step-wrap">
            <div className={`wz-step ${active ? "is-active" : ""} ${complete ? "is-complete" : ""}`}>
              <div className="wz-step-num">{complete ? "✓" : current}</div>
              <span className="wz-step-label">{label}</span>
            </div>
            {index < labels.length - 1 ? <div className="wz-step-line" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function BroadcastWizardPage({
  token,
  mode,
  sourceCampaignId
}: {
  token: string;
  mode: "new" | "retarget";
  sourceCampaignId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { bootstrap } = useDashboardShell();
  const apiConnections = bootstrap?.channelSummary.metaApi.connections ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    () => bootstrap?.channelSummary.metaApi.connection?.id ?? apiConnections.find(isMetaConnectionActive)?.id ?? apiConnections[0]?.id ?? ""
  );
  const selectedConnection = apiConnections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedConnectionActive = isMetaConnectionActive(selectedConnection);
  const templatesQuery = useTemplatesQuery(token, { connectionId: selectedConnectionId || undefined });
  const segmentsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactSegments,
    queryFn: () => listContactSegments(token).then((response) => response.segments)
  });
  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields)
  });
  const publishedFlowsQuery = useInboxPublishedFlowsQuery(token);
  const agentsQuery = useAgentsQuery(token);

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [bindings, setBindings] = useState<CampaignTemplateVariables>({});
  const [mediaOverrides, setMediaOverrides] = useState<CampaignMediaOverrides>({});
  const [scheduledAt, setScheduledAt] = useState("");
  const [uploadingAudience, setUploadingAudience] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [audienceImportPreview, setAudienceImportPreview] = useState<ContactImportPreview | null>(null);
  const [audienceImportFile, setAudienceImportFile] = useState<File | null>(null);
  const [audienceImportMapping, setAudienceImportMapping] = useState<ContactImportColumnMapping>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retargetStatus, setRetargetStatus] = useState<RetargetStatus>("sent");
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [retryEnabled, setRetryEnabled] = useState(false);
  const [retryType, setRetryType] = useState<"smart" | "manual">("smart");
  const [retryUntil, setRetryUntil] = useState("");
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [replyMode, setReplyMode] = useState<BroadcastReplyMode>("ai");
  const [replyFlowId, setReplyFlowId] = useState("");
  const [replyAgentProfileId, setReplyAgentProfileId] = useState("");
  const [overrideExistingAssignee, setOverrideExistingAssignee] = useState(true);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [phoneNumberFormat, setPhoneNumberFormat] = useState<"with_country_code" | "without_country_code">("with_country_code");
  const [defaultCountryCode, setDefaultCountryCode] = useState("91");
  const [uploadStep, setUploadStep] = useState<"download" | "upload" | "preview">("download");
  const [showCreateSegmentModal, setShowCreateSegmentModal] = useState(false);

  const deleteSegmentMutation = useMutation({
    mutationFn: (id: string) => deleteContactSegment(token, id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegments });
      setSelectedSegmentIds((prev) => prev.filter((segId) => segId !== id));
    }
  });

  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status === "APPROVED"),
    [templatesQuery.data]
  );
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const placeholders = useMemo(() => extractTemplatePlaceholders(selectedTemplate), [selectedTemplate]);
  const fields = fieldsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const publishedFlows = useMemo(
    () => (publishedFlowsQuery.data ?? []).filter((flow) => flow.channel === "api"),
    [publishedFlowsQuery.data]
  );
  const agentProfiles = agentsQuery.data ?? [];

  const primarySegmentId = selectedSegmentIds[0] ?? "";
  const selectedSegmentContactsQuery = useQuery({
    queryKey: dashboardQueryKeys.segmentContacts(primarySegmentId || "none"),
    queryFn: () => fetchSegmentContacts(token, primarySegmentId).then((response) => response.contacts),
    enabled: mode === "new" && Boolean(primarySegmentId)
  });
  const retargetPreviewQuery = useQuery({
    queryKey: dashboardQueryKeys.broadcastRetargetPreview(sourceCampaignId ?? "none", retargetStatus),
    queryFn: () => fetchBroadcastRetargetPreview(token, sourceCampaignId ?? "", retargetStatus).then((response) => response.preview),
    enabled: mode === "retarget" && Boolean(sourceCampaignId)
  });

  useEffect(() => {
    const hasSelectedConnection = selectedConnectionId
      ? apiConnections.some((connection) => connection.id === selectedConnectionId)
      : false;
    if (selectedConnectionId && !hasSelectedConnection) {
      setSelectedConnectionId("");
      setSelectedTemplateId("");
      setBindings({});
      setMediaOverrides({});
    }
  }, [apiConnections]);

  useEffect(() => {
    if (!selectedTemplateId) {
      return;
    }
    if (!approvedTemplates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId("");
    }
  }, [approvedTemplates, selectedTemplateId]);

  useEffect(() => {
    setBindings((current) => {
      const next: CampaignTemplateVariables = {};
      for (const placeholder of placeholders) {
        next[placeholder] = current[placeholder] ?? { source: "contact", field: "display_name", fallback: "" };
      }
      return next;
    });
  }, [placeholders]);

  const sampleContact =
    mode === "retarget"
      ? retargetPreviewQuery.data?.recipients?.[0] ?? null
      : selectedSegmentContactsQuery.data?.[0] ?? null;
  const targetAudienceCount =
    mode === "retarget"
      ? retargetPreviewQuery.data?.count ?? 0
      : selectedSegmentContactsQuery.data?.length ?? 0;
  const previewComponents = useMemo(
    () => buildPreviewComponents(selectedTemplate, bindings, sampleContact),
    [bindings, sampleContact, selectedTemplate]
  );

  const fieldOptions = useMemo(
    () => [
      ...STANDARD_CONTACT_FIELDS.map((field) => ({ value: field.value, label: field.label })),
      ...fields.map((field) => ({ value: `custom:${field.name}`, label: `${field.label} (custom)` }))
    ],
    [fields]
  );

  const headerMediaType = useMemo(() => {
    const header = selectedTemplate?.components.find((component) => component.type === "HEADER");
    return header?.format === "IMAGE" || header?.format === "VIDEO" || header?.format === "DOCUMENT"
      ? header.format
      : null;
  }, [selectedTemplate]);

  useEffect(() => {
    if (sendMode === "now") {
      setScheduledAt("");
    }
  }, [sendMode]);

  useEffect(() => {
    if (replyMode === "flow") {
      setReplyAgentProfileId("");
      return;
    }
    if (!agentProfiles.some((profile) => profile.id === replyAgentProfileId)) {
      setReplyAgentProfileId(agentProfiles[0]?.id ?? "");
    }
  }, [agentProfiles, replyAgentProfileId, replyMode]);

  useEffect(() => {
    if (replyMode !== "flow") {
      return;
    }
    if (!publishedFlows.some((flow) => flow.id === replyFlowId)) {
      setReplyFlowId("");
    }
  }, [publishedFlows, replyFlowId, replyMode]);

  const saveMutation = useMutation({
    mutationFn: async (launchNow: boolean) => {
      if (!selectedConnectionId) {
        throw new Error("Select a WhatsApp API connection before saving this broadcast.");
      }
      if (!selectedConnectionActive) {
        throw new Error("The selected WhatsApp API connection is not active. Reconnect or resume it before launching this broadcast.");
      }
      const draft = await createCampaignDraft(token, {
        name: name.trim(),
        broadcastType: mode === "retarget" ? "retarget" : "standard",
        connectionId: selectedConnectionId,
        templateId: selectedTemplateId || null,
        templateVariables: bindings,
        targetSegmentId: mode === "new" ? primarySegmentId || null : null,
        sourceCampaignId: mode === "retarget" ? sourceCampaignId ?? null : null,
        retargetStatus: mode === "retarget" ? retargetStatus : null,
        audienceSource:
          mode === "retarget"
            ? {
                kind: "retarget",
                sourceCampaignId,
                status: retargetStatus,
                replyRouting: {
                  mode: replyMode,
                  flowId: replyMode === "flow" ? replyFlowId || null : null,
                  agentProfileId: replyMode === "ai" ? replyAgentProfileId || null : null,
                  overrideExistingAssignee
                }
              }
            : {
                kind: "segment",
                segmentId: primarySegmentId,
                segmentIds: selectedSegmentIds,
                replyRouting: {
                  mode: replyMode,
                  flowId: replyMode === "flow" ? replyFlowId || null : null,
                  agentProfileId: replyMode === "ai" ? replyAgentProfileId || null : null,
                  overrideExistingAssignee
                }
              },
        mediaOverrides,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null
      });

      if (!launchNow) {
        return draft.campaign;
      }

      const launched = await launchCampaignDraft(token, draft.campaign.id);
      return launched.campaign;
    },
    onSuccess: async (campaign) => {
      setError(null);
      setMessage(campaign.status === "running" ? "Broadcast launched." : "Broadcast saved.");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.broadcasts });
      navigate(`/dashboard/broadcast/${campaign.id}`);
    },
    onError: (mutationError) => {
      setMessage(null);
      setError((mutationError as Error).message);
    }
  });

  const canContinueStep1 =
    Boolean(selectedConnectionId) &&
    selectedConnectionActive &&
    (mode === "retarget" ? Boolean(retargetPreviewQuery.data?.count) : Boolean(selectedTemplateId));
  const canContinueStep2 =
    mode === "retarget" ? Boolean(selectedTemplateId) : selectedSegmentIds.length > 0;

  const testBroadcastMutation = useMutation({
    mutationFn: async (phones: string[]) => {
      if (!selectedTemplateId) {
        throw new Error("Select a template before sending a test broadcast.");
      }

      const uniquePhones = Array.from(
        new Set(
          phones
            .map((phone) => phone.trim())
            .filter((phone) => phone.length > 2)
        )
      );

      if (uniquePhones.length === 0) {
        throw new Error("Enter at least one phone number for the test broadcast.");
      }

      const variableValues = resolveBroadcastVariableValues(bindings, sampleContact, mediaOverrides);

      await Promise.all(
        uniquePhones.map((phone) =>
          sendTestTemplate(token, {
            templateId: selectedTemplateId,
            to: phone,
            variableValues
          })
        )
      );

      return uniquePhones.length;
    },
    onSuccess: (count) => {
      setError(null);
      setMessage(`Test broadcast sent to ${count} number${count === 1 ? "" : "s"}.`);
    },
    onError: (mutationError) => {
      setMessage(null);
      setError((mutationError as Error).message);
    }
  });

  async function handleAudienceUpload(file: File) {
    setUploadingAudience(true);
    setError(null);
    try {
      const preview = await previewBroadcastAudienceWorkbookImport(token, file);
      setAudienceImportFile(file);
      setAudienceImportPreview(preview.preview);
      setAudienceImportMapping(preview.preview.suggestedMapping ?? {});
      setUploadedFileName(file.name);
      setUploadStep("upload");
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingAudience(false);
    }
  }

  async function handleConfirmAudienceImport() {
    if (!audienceImportFile) return;
    setUploadingAudience(true);
    setError(null);
    try {
      const result = await importBroadcastAudienceWorkbook(token, audienceImportFile, {
        segmentName: `${name.trim() || "Broadcast"} audience`,
        marketingOptIn,
        phoneNumberFormat,
        defaultCountryCode,
        mapping: audienceImportMapping
      });
      setSelectedSegmentIds((prev) => prev.includes(result.segment.id) ? prev : [...prev, result.segment.id]);
      setUploadedFileName(audienceImportFile.name);
      setUploadStep("preview");
      setAudienceImportPreview(null);
      setAudienceImportFile(null);
      setAudienceImportMapping({});
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegments });
      setMessage(`Imported audience and created segment "${result.segment.name}".`);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingAudience(false);
    }
  }

  async function handleDownloadAudienceTemplate() {
    setDownloadingTemplate(true);
    setError(null);
    try {
      const result = await downloadContactsTemplate(token);
      downloadBlob(result.blob, result.filename);
    } catch (downloadError) {
      setError((downloadError as Error).message);
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleMediaUpload(file: File) {
    setUploadingMedia(true);
    setError(null);
    try {
      const uploaded = await uploadBroadcastMediaToSupabase(file);
      setMediaOverrides((current) => ({
        ...current,
        headerMediaUrl: uploaded.url
      }));
      setMessage("Media uploaded to Supabase for this broadcast.");
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setUploadingMedia(false);
    }
  }

  return (
    <section className="broadcast-page wz-page">
      <WizardStepHeader mode={mode} step={step} />

      <section className="wz-body">
        {step === 1 && mode === "new" ? (
          <TemplateSelectionStep
            connections={apiConnections}
            selectedConnectionId={selectedConnectionId}
            onSelectConnection={setSelectedConnectionId}
            connectionActive={selectedConnectionActive}
            templates={approvedTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            onContinue={() => setStep(2)}
            canContinue={canContinueStep1}
            onBack={() => navigate("/dashboard/broadcast")}
          />
        ) : null}

        {step === 1 && mode === "retarget" ? (
          <RetargetAudienceStep
            retargetStatus={retargetStatus}
            onRetargetStatusChange={setRetargetStatus}
            preview={retargetPreviewQuery.data}
            onContinue={() => setStep(2)}
            canContinue={canContinueStep1}
          />
        ) : null}

        {step === 2 && mode === "new" ? (
          <AudienceSelectionStep
            token={token}
            name={name}
            onNameChange={setName}
            customFields={fields}
            segments={segments}
            selectedSegmentIds={selectedSegmentIds}
            onToggleSegment={(id) =>
              setSelectedSegmentIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
            onToggleAll={(ids) => setSelectedSegmentIds(ids)}
            onUpload={handleAudienceUpload}
            uploadingAudience={uploadingAudience}
            uploadedFileName={uploadedFileName}
            importPreview={audienceImportPreview}
            importMapping={audienceImportMapping}
            onImportMappingChange={setAudienceImportMapping}
            onConfirmImport={() => void handleConfirmAudienceImport()}
            marketingOptIn={marketingOptIn}
            onMarketingOptInChange={setMarketingOptIn}
            phoneNumberFormat={phoneNumberFormat}
            onPhoneNumberFormatChange={setPhoneNumberFormat}
            defaultCountryCode={defaultCountryCode}
            onDefaultCountryCodeChange={setDefaultCountryCode}
            uploadStep={uploadStep}
            onOpenCreateSegment={() => setShowCreateSegmentModal(true)}
            onDeleteSegment={(id, name) => {
              if (window.confirm(`Delete segment "${name}"? This cannot be undone.`)) {
                deleteSegmentMutation.mutate(id);
              }
            }}
            onDownloadTemplate={handleDownloadAudienceTemplate}
            downloadingTemplate={downloadingTemplate}
            selectedTemplate={selectedTemplate}
            placeholders={placeholders}
            previewComponents={previewComponents}
            onContinue={() => setStep(3)}
            canContinue={canContinueStep2}
          />
        ) : null}

        {step === 2 && mode === "retarget" ? (
          <TemplateSelectionStep
            connections={apiConnections}
            selectedConnectionId={selectedConnectionId}
            onSelectConnection={setSelectedConnectionId}
            connectionActive={selectedConnectionActive}
            templates={approvedTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
            canContinue={canContinueStep2}
          />
        ) : null}

        {step === 3 ? (
          <VariableMappingStep
            placeholders={placeholders}
            bindings={bindings}
            setBindings={setBindings}
            fieldOptions={fieldOptions}
            headerMediaType={headerMediaType}
            mediaOverrides={mediaOverrides}
            setMediaOverrides={setMediaOverrides}
            onMediaUpload={handleMediaUpload}
            uploadingMedia={uploadingMedia}
            selectedTemplate={selectedTemplate}
            sampleContact={sampleContact}
            onBack={() => setStep(2)}
            onContinue={() => setStep(4)}
          />
        ) : null}

        {step === 4 ? (
          <ScheduleStep
            name={name}
            onNameChange={setName}
            sendMode={sendMode}
            onSendModeChange={setSendMode}
            scheduledAt={scheduledAt}
            onScheduledAtChange={setScheduledAt}
            retryEnabled={retryEnabled}
            onRetryEnabledChange={setRetryEnabled}
            retryType={retryType}
            onRetryTypeChange={setRetryType}
            retryUntil={retryUntil}
            onRetryUntilChange={setRetryUntil}
            policyEnabled={policyEnabled}
            onPolicyEnabledChange={setPolicyEnabled}
            audienceCount={targetAudienceCount}
            selectedSegmentNames={selectedSegmentIds
              .map((id) => segments.find((s) => s.id === id)?.name ?? id)
              .filter(Boolean)}
            replyMode={replyMode}
            onReplyModeChange={setReplyMode}
            replyFlowId={replyFlowId}
            onReplyFlowIdChange={setReplyFlowId}
            replyAgentProfileId={replyAgentProfileId}
            onReplyAgentProfileIdChange={setReplyAgentProfileId}
            availableFlows={publishedFlows}
            availableAgents={agentProfiles.map((agent) => ({ id: agent.id, name: agent.name }))}
            overrideExistingAssignee={overrideExistingAssignee}
            onOverrideExistingAssigneeChange={setOverrideExistingAssignee}
            selectedTemplate={selectedTemplate}
            bindings={bindings}
            headerMediaType={headerMediaType}
            mediaOverrides={mediaOverrides}
            sampleContacts={
              mode === "retarget"
                ? retargetPreviewQuery.data?.recipients ?? []
                : selectedSegmentContactsQuery.data ?? []
            }
            onBack={() => setStep(3)}
            onSave={() => saveMutation.mutate(false)}
            onLaunch={() => saveMutation.mutate(true)}
            onSendTest={(phones) => testBroadcastMutation.mutate(phones)}
            saving={saveMutation.isPending || testBroadcastMutation.isPending}
          />
        ) : null}

        {message ? <div className="broadcast-feedback success">{message}</div> : null}
        {error ? <div className="broadcast-feedback error">{error}</div> : null}
      </section>

      {showCreateSegmentModal ? (
        <BroadcastCreateSegmentModal
          token={token}
          customFields={fields}
          onClose={() => setShowCreateSegmentModal(false)}
          onCreated={async (segment) => {
            setShowCreateSegmentModal(false);
            setSelectedSegmentIds((prev) => prev.includes(segment.id) ? prev : [...prev, segment.id]);
            await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.contactSegments });
            setMessage(`Created segment "${segment.name}".`);
          }}
        />
      ) : null}
    </section>
  );
}

function TemplateSelectionStep({
  connections,
  selectedConnectionId,
  onSelectConnection,
  connectionActive,
  templates,
  selectedTemplateId,
  onSelect,
  onBack,
  onContinue,
  canContinue
}: {
  connections: MetaBusinessConnection[];
  selectedConnectionId: string;
  onSelectConnection: (connectionId: string) => void;
  connectionActive: boolean;
  templates: MessageTemplate[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
  onBack?: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const [search, setSearch] = useState("");

  const filtered = templates.filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.category.toLowerCase().includes(search.toLowerCase())
  );

  function statusLabel(status: string) {
    if (status === "APPROVED") return "Active";
    if (status === "PENDING") return "Active - Pending";
    return status.charAt(0) + status.slice(1).toLowerCase();
  }

  function formatTemplateDate(dateStr: string | undefined) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <section className="wz-tpl-section">
      {/* Step toolbar */}
      <div className="wz-tpl-toolbar">
        <button type="button" className="wz-back-btn" onClick={onBack}>
          &#8592; Select Template
        </button>
        <div className="wz-tpl-toolbar-center">
          <div style={{ minWidth: "280px", marginBottom: "0.75rem" }}>
            <MetaConnectionSelector
              connections={connections}
              value={selectedConnectionId}
              onChange={onSelectConnection}
              label="WhatsApp API connection"
              required
              allowEmpty
              emptyLabel="Select a connection"
            />
          </div>
          <div className="wz-tpl-search-wrap">
            <span className="wz-tpl-search-icon">&#128269;</span>
            <input
              className="wz-tpl-search"
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <a
          href="/dashboard/templates/new"
          target="_blank"
          rel="noopener noreferrer"
          className="wz-new-tpl-btn"
        >
          + New Template &#8599;
        </a>
      </div>
      {!selectedConnectionId ? <div className="broadcast-feedback error">Select a WhatsApp API connection to load templates.</div> : null}
      {selectedConnectionId && !connectionActive ? <div className="broadcast-feedback error">The selected connection is inactive. Reconnect or resume it before launching this broadcast.</div> : null}

      {/* Template grid */}
      <div className="wz-tpl-grid">
        {filtered.map((template) => {
          const selected = selectedTemplateId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => { onSelect(template.id); onContinue(); }}
              className={`wz-tpl-card ${selected ? "is-selected" : ""}`}
            >
              <div className="wz-tpl-card-head">
                <span className="wz-tpl-name">{template.name}</span>
                <div className="wz-tpl-badges">
                  <span className="wz-tpl-status-badge">
                    <span className="wz-tpl-status-dot" /> {statusLabel(template.status)}
                  </span>
                  <span className="wz-tpl-cat-badge">{template.category}</span>
                </div>
              </div>
              <div className="wz-tpl-preview-box">
                <TemplatePreviewPanel
                  components={template.components}
                  businessName={template.displayPhoneNumber ?? template.name}
                />
              </div>
              <div className="wz-tpl-card-foot">
                <span className="wz-tpl-lang">{template.language}</span>
                <span className="wz-tpl-date">{formatTemplateDate((template as { updated_at?: string }).updated_at)}</span>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="wz-tpl-empty">No templates match "{search}".</div>
        ) : null}
      </div>

      {/* Footer actions */}
      <div className="wz-tpl-footer">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="wz-continue-btn"
        >
          Continue &#8594;
        </button>
      </div>
    </section>
  );
}

function RetargetAudienceStep({
  retargetStatus,
  onRetargetStatusChange,
  preview,
  onContinue,
  canContinue
}: {
  retargetStatus: RetargetStatus;
  onRetargetStatusChange: (status: RetargetStatus) => void;
  preview: { recipients: ContactRecord[]; count: number; status: RetargetStatus } | undefined;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Select Retarget Audience</h3>
        <p className="broadcast-section-text">Choose one outcome bucket from the previous run and preview the matched recipients.</p>
      </div>
      <div className="broadcast-retarget-grid">
        {RETARGET_OPTIONS.map((option) => (
          <button key={option.value} type="button" onClick={() => onRetargetStatusChange(option.value)} className={`broadcast-retarget-card ${retargetStatus === option.value ? "is-selected" : ""}`}>
            <div className="broadcast-retarget-label">{option.label}</div>
            <div className="broadcast-retarget-value">
              {preview?.status === option.value ? preview.count : "—"}
            </div>
          </button>
        ))}
      </div>
      <section className="broadcast-table-shell compact">
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Recipient", "Phone"].map((heading) => (
                <th key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(preview?.recipients ?? []).slice(0, 50).map((contact) => (
              <tr key={contact.id}>
                <td>{contact.display_name || "Unknown"}</td>
                <td>{contact.phone_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="broadcast-actions">
        <button type="button" onClick={onContinue} disabled={!canContinue} className="broadcast-primary-btn">
          Continue
        </button>
      </div>
    </section>
  );
}

function BroadcastSegmentFilterRow({
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

function BroadcastCreateSegmentModal({
  token,
  customFields,
  onClose,
  onCreated
}: {
  token: string;
  customFields: ContactField[];
  onClose: () => void;
  onCreated: (segment: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [filters, setFilters] = useState<SegmentFilter[]>(
    [{ field: "created_at", op: "after", value: "" }]
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

  const handleCreate = async () => {
    if (!name.trim()) { setError("Segment name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await createContactSegment(token, { name: name.trim(), filters });
      onCreated(result.segment);
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
          <h3 className="ct-modal-title">Create Segment</h3>
          <button type="button" className="ct-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ct-modal-body">
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
                  <BroadcastSegmentFilterRow
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
                    <span className="seg-preview-phone">{c.phone_number}</span>
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
          <button type="button" className="ct-modal-submit is-blue" disabled={saving} onClick={() => void handleCreate()}>
            {saving ? "Creating…" : "Create Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AudienceSelectionStep({
  token,
  name,
  onNameChange,
  segments,
  selectedSegmentIds,
  onToggleSegment,
  onToggleAll,
  onOpenCreateSegment,
  onDeleteSegment,
  onContinue,
  canContinue,
  onUpload,
  uploadingAudience,
  uploadedFileName,
  importPreview,
  importMapping,
  onImportMappingChange,
  onConfirmImport,
  marketingOptIn,
  onMarketingOptInChange,
  phoneNumberFormat,
  onPhoneNumberFormatChange,
  defaultCountryCode,
  onDefaultCountryCodeChange,
  uploadStep,
  onDownloadTemplate,
  downloadingTemplate,
  selectedTemplate,
  placeholders,
  previewComponents
}: {
  token: string;
  name: string;
  onNameChange: (value: string) => void;
  customFields: Array<{ id: string; label: string; name: string; is_active: boolean }>;
  segments: Array<{ id: string; name: string; created_at: string; filters: SegmentFilter[] }>;
  selectedSegmentIds: string[];
  onToggleSegment: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onUpload: (file: File) => Promise<void>;
  uploadingAudience: boolean;
  uploadedFileName: string;
  importPreview: ContactImportPreview | null;
  importMapping: ContactImportColumnMapping;
  onImportMappingChange: Dispatch<SetStateAction<ContactImportColumnMapping>>;
  onConfirmImport: () => void;
  marketingOptIn: boolean;
  onMarketingOptInChange: (value: boolean) => void;
  phoneNumberFormat: "with_country_code" | "without_country_code";
  onPhoneNumberFormatChange: (value: "with_country_code" | "without_country_code") => void;
  defaultCountryCode: string;
  onDefaultCountryCodeChange: (value: string) => void;
  uploadStep: "download" | "upload" | "preview";
  onOpenCreateSegment: () => void;
  onDeleteSegment: (id: string, name: string) => void;
  onDownloadTemplate: () => Promise<void>;
  downloadingTemplate: boolean;
  selectedTemplate: MessageTemplate | null;
  placeholders: string[];
  previewComponents: ReturnType<typeof buildPreviewComponents>;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const [showExcelUpload, setShowExcelUpload] = useState(false);
  const [openAccordion, setOpenAccordion] = useState<"download" | "upload" | "preview">("download");
  const [search, setSearch] = useState("");
  const [hoveredFilterId, setHoveredFilterId] = useState<string | null>(null);
  const [openSegmentMenuId, setOpenSegmentMenuId] = useState<string | null>(null);
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [loadingCountIds, setLoadingCountIds] = useState<Set<string>>(new Set());

  const handleViewCount = async (segmentId: string) => {
    if (segmentCounts[segmentId] !== undefined || loadingCountIds.has(segmentId)) return;
    setLoadingCountIds((prev) => new Set(prev).add(segmentId));
    try {
      const result = await fetchSegmentContacts(token, segmentId);
      setSegmentCounts((prev) => ({ ...prev, [segmentId]: result.contacts.length }));
    } finally {
      setLoadingCountIds((prev) => { const next = new Set(prev); next.delete(segmentId); return next; });
    }
  };

  const FIELD_LABELS: Record<string, string> = {
    display_name: "Name", phone_number: "Phone", email: "Email",
    tags: "Tags", contact_type: "Type", created_at: "Created At", order_date: "Order Date"
  };
  const OP_LABELS: Record<string, string> = {
    is: "Is", is_not: "Is not", contains: "Contains", not_contains: "Does not contain",
    before: "Before", after: "Is after", is_empty: "Is empty", is_not_empty: "Is not empty"
  };

  const filtered = segments.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase())
  );
  const allChecked = filtered.length > 0 && filtered.every((s) => selectedSegmentIds.includes(s.id));

  function handleToggleAll() {
    if (allChecked) {
      onToggleAll(selectedSegmentIds.filter((id) => !filtered.some((s) => s.id === id)));
    } else {
      const toAdd = filtered.map((s) => s.id).filter((id) => !selectedSegmentIds.includes(id));
      onToggleAll([...selectedSegmentIds, ...toAdd]);
    }
  }

  function renderFilterChip(filter: SegmentFilter, index: number, extras: number) {
    const field = FIELD_LABELS[filter.field] ?? filter.field;
    const op = OP_LABELS[filter.op] ?? filter.op;
    const isTag = filter.field === "tags";
    return (
      <div key={index} className="aud-filter-chip">
        <span className="aud-filter-icon">{isTag ? "🏷" : "📅"}</span>
        <span className="aud-filter-field">{field}</span>
        <span className="aud-filter-op">{op}</span>
        <span className="aud-filter-val">{filter.value.length > 10 ? `${filter.value.slice(0, 10)}…` : filter.value}</span>
        {extras > 0 ? <span className="aud-filter-extra">+{extras}</span> : null}
      </div>
    );
  }

  /* ── Excel Upload sub-view ── */
  if (showExcelUpload) {
    const audienceReady = Boolean(uploadedFileName) && uploadStep === "preview";

    return (
      <section className="eu-page">
        {/* Back header */}
        <div className="eu-header">
          <button type="button" className="wz-back-btn" onClick={() => setShowExcelUpload(false)}>
            &#8592; Upload Contacts from Excel
          </button>
        </div>

        <div className="eu-layout">
          {/* Left: accordion */}
          <div className="eu-accordions">

            {/* ── Section 1: Download Sample ── */}
            <div className={`eu-accordion ${openAccordion === "download" ? "is-open" : ""}`}>
              <button
                type="button"
                className="eu-accordion-head"
                onClick={() => setOpenAccordion(openAccordion === "download" ? "upload" : "download")}
              >
                <span className="eu-acc-check is-done">&#10003;</span>
                <span className="eu-acc-title">Download Sample file</span>
                <span className="eu-acc-badge">Optional</span>
                <span className="eu-acc-chevron">{openAccordion === "download" ? "∧" : "∨"}</span>
              </button>
              {openAccordion === "download" ? (
                <div className="eu-accordion-body">
                  <p className="eu-body-text">
                    Name and Phone numbers (with country code, e.g., +91) are mandatory fields.
                  </p>
                  {placeholders.length > 0 ? (
                    <>
                      <p className="eu-body-text">
                        The selected WhatsApp message template contains below mandatory variables and ensure
                        to update the necessary columns in the sample file before uploading in the next step.
                      </p>
                      <div className="eu-placeholder-chips">
                        {placeholders.map((p) => (
                          <span key={p} className="eu-placeholder-chip">{p}</span>
                        ))}
                      </div>
                    </>
                  ) : null}
                  <div className="eu-acc-actions">
                    <button
                      type="button"
                      className="eu-downloaded-btn"
                      onClick={() => setOpenAccordion("upload")}
                    >
                      I&apos;ve downloaded
                    </button>
                    <button
                      type="button"
                      className="eu-download-btn"
                      disabled={downloadingTemplate}
                      onClick={() => void onDownloadTemplate()}
                    >
                      {downloadingTemplate ? "Downloading…" : "Download Sample file"} &#8964;
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* ── Section 2: Upload data file ── */}
            <div className={`eu-accordion ${openAccordion === "upload" ? "is-open" : ""}`}>
              <button
                type="button"
                className="eu-accordion-head"
                onClick={() => setOpenAccordion(openAccordion === "upload" ? "download" : "upload")}
              >
                <span className={`eu-acc-check ${uploadedFileName ? "is-done" : ""}`}>
                  {uploadedFileName ? "✓" : "○"}
                </span>
                <span className="eu-acc-title">Upload data file</span>
                <span className="eu-acc-chevron">{openAccordion === "upload" ? "∧" : "∨"}</span>
              </button>
              {openAccordion === "upload" ? (
                <div className="eu-accordion-body">
                  <p className="eu-body-hint">
                    Please ensure you have updated the columns with necessary information in the file before uploading.
                  </p>

                  {/* Dropzone */}
                  <label className="eu-dropzone">
                    <div className="eu-dropzone-title">Drag &amp; drop your file here</div>
                    <div className="eu-dropzone-field">
                      <span>{uploadedFileName || "Please Upload a File"}</span>
                      <span className="eu-dropzone-icon">&#8679;</span>
                    </div>
                    <div className="eu-dropzone-hint">Accepted file type: .XLSX</div>
                    <input
                      type="file"
                      accept=".xlsx"
                      style={{ display: "none" }}
                      disabled={uploadingAudience}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { void onUpload(f); setOpenAccordion("upload"); }
                      }}
                    />
                  </label>

                  {/* Marketing Opt-In */}
                  <div className="eu-field-row">
                    <div className="eu-field-info">
                      <span className="eu-field-label">Marketing Opt-In <span className="eu-required">*</span> <span className="eu-info-icon">&#9432;</span></span>
                      <span className="eu-field-desc">
                        Legacy import helper only. This does not count as documented Meta-compliant consent proof by itself.{" "}
                        <a href="#" className="aud-bottom-link">Learn more</a>
                      </span>
                    </div>
                    <select
                      className="eu-select"
                      value={marketingOptIn ? "yes" : "no"}
                      onChange={(e) => onMarketingOptInChange(e.target.value === "yes")}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>

                  {/* Phone Number Format */}
                  <div className="eu-field-row">
                    <div className="eu-field-info">
                      <span className="eu-field-label">Phone Number Format <span className="eu-required">*</span></span>
                      <span className="eu-field-desc">
                        &quot;Without country code&quot; the default format is +91 (account&apos;s country code).
                      </span>
                    </div>
                    <select
                      className="eu-select"
                      value={phoneNumberFormat}
                      onChange={(e) => onPhoneNumberFormatChange(e.target.value as "with_country_code" | "without_country_code")}
                    >
                      <option value="">Select...</option>
                      <option value="with_country_code">With country code</option>
                      <option value="without_country_code">Without country code</option>
                    </select>
                  </div>

                  {phoneNumberFormat === "without_country_code" ? (
                    <div className="eu-field-row">
                      <div className="eu-field-info">
                        <span className="eu-field-label">Default country code <span className="eu-required">*</span></span>
                      </div>
                      <input
                        className="eu-select"
                        value={defaultCountryCode}
                        onChange={(e) => onDefaultCountryCodeChange(e.target.value.replace(/\D/g, ""))}
                        placeholder="91"
                      />
                    </div>
                  ) : null}

                  {/* Column mapping after upload */}
                  {importPreview ? (
                    <div className="eu-mapping">
                      <div className="eu-mapping-title">Map Excel columns to contact fields</div>
                      <div className="eu-mapping-grid">
                        {CONTACT_IMPORT_STANDARD_FIELDS.map((field) => (
                          <div key={field.key} className="eu-mapping-row">
                            <span className="eu-mapping-label">
                              {field.label}{field.required ? " *" : ""}
                            </span>
                            <select
                              className="eu-select"
                              value={importMapping[field.key] ?? ""}
                              onChange={(e) =>
                                onImportMappingChange((cur) => {
                                  if (!e.target.value) { const next = { ...cur }; delete next[field.key]; return next; }
                                  return { ...cur, [field.key]: e.target.value };
                                })
                              }
                            >
                              <option value="">Do not import</option>
                              {importPreview.columns.map((col) => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="wz-continue-btn"
                        style={{ marginTop: "0.75rem" }}
                        disabled={uploadingAudience || !importMapping.phone_number}
                        onClick={onConfirmImport}
                      >
                        {uploadingAudience ? "Importing…" : "Import & create segment"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* ── Section 3: Preview ── */}
            <div className={`eu-accordion ${audienceReady ? "" : "is-disabled"} ${openAccordion === "preview" && audienceReady ? "is-open" : ""}`}>
              <button
                type="button"
                className="eu-accordion-head"
                onClick={() => audienceReady && setOpenAccordion("preview")}
                disabled={!audienceReady}
              >
                <span className={`eu-acc-check ${audienceReady ? "is-done" : ""}`}>
                  {audienceReady ? "✓" : "○"}
                </span>
                <span className="eu-acc-title">Preview your target audience</span>
                <span className="eu-acc-chevron">{openAccordion === "preview" && audienceReady ? "∧" : "∨"}</span>
              </button>
              {openAccordion === "preview" && audienceReady ? (
                <div className="eu-accordion-body">
                  <p className="eu-body-text">
                    Your uploaded contacts have been converted into a reusable segment and are ready for this broadcast.
                  </p>
                  <button type="button" className="wz-continue-btn" onClick={() => setShowExcelUpload(false)}>
                    Use this audience &#8594;
                  </button>
                </div>
              ) : null}
            </div>

          </div>

          {/* Right: template preview */}
          {selectedTemplate ? (
            <div className="eu-preview-panel">
              <div className="eu-preview-name">{selectedTemplate.name}</div>
              <div className="eu-preview-meta">
                &#128241; {(selectedTemplate as { displayPhoneNumber?: string }).displayPhoneNumber ?? "—"}
              </div>
              <div className="eu-preview-scroll">
                <TemplatePreviewPanel
                  components={previewComponents.length ? previewComponents : selectedTemplate.components}
                  businessName={(selectedTemplate as { displayPhoneNumber?: string }).displayPhoneNumber ?? selectedTemplate.name}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  /* ── Main audience selection view ── */
  return (
    <section className="aud-section">
      {/* ── Excel upload banner ── */}
      <div className="aud-excel-card">
        <div className="aud-excel-head">
          <span className="aud-excel-title">Upload Contacts from Excel</span>
        </div>
        <div className="aud-excel-body">
          <span className="aud-excel-badge">X</span>
          <span className="aud-excel-text">Broadcast customized messages to your contacts available in your excel sheet</span>
          <button type="button" className="aud-upload-btn" onClick={() => setShowExcelUpload(true)}>
            &#128202; Upload Contacts
          </button>
        </div>
      </div>

      {/* ── OR divider ── */}
      <div className="aud-or-divider">
        <span className="aud-or-line" />
        <span className="aud-or-text">OR</span>
        <span className="aud-or-line" />
      </div>

      {/* ── Segments section ── */}
      <div className="aud-segments-card">
        {/* Broadcast name */}
        <div className="aud-name-row">
          <label className="aud-name-label">Broadcast name</label>
          <input
            className="aud-name-input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. April promotion"
          />
        </div>

        {/* Segment list header */}
        <div className="aud-segments-head">
          <div className="aud-segments-title-wrap">
            <span className="aud-segments-title">Pick from Segments</span>
            <a href="/dashboard/contacts" target="_blank" rel="noopener noreferrer" className="aud-segments-link">
              What are segments? &#8599;
            </a>
          </div>
          <div className="aud-segments-actions">
            <div className="aud-seg-search-wrap">
              <span className="aud-seg-search-icon">&#128269;</span>
              <input
                className="aud-seg-search"
                type="text"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className="aud-new-seg-btn" onClick={onOpenCreateSegment}>
              + New Segment
            </button>
          </div>
        </div>

        {/* Close segment dropdown on outside click */}
        {openSegmentMenuId ? <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpenSegmentMenuId(null)} /> : null}

        {/* Segment table */}
        <div className="aud-table-wrap">
          <table className="aud-table">
            <thead>
              <tr>
                <th className="aud-th-check">
                  <input type="checkbox" checked={allChecked} onChange={handleToggleAll} className="aud-checkbox" />
                </th>
                <th>Segment Name</th>
                <th>Filters</th>
                <th>Total Contacts</th>
                <th>Created By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((segment) => {
                const checked = selectedSegmentIds.includes(segment.id);
                const firstFilter = segment.filters[0];
                const extras = segment.filters.length - 1;
                return (
                  <tr key={segment.id} className={`aud-row ${checked ? "is-checked" : ""}`} onClick={() => onToggleSegment(segment.id)}>
                    <td className="aud-td-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => onToggleSegment(segment.id)} className="aud-checkbox" />
                    </td>
                    <td>
                      <div className="aud-seg-name">{segment.name}</div>
                      <div className="aud-seg-date">{formatDateTime(segment.created_at)}</div>
                    </td>
                    <td
                      className="aud-td-filters"
                      onMouseEnter={() => segment.filters.length > 1 ? setHoveredFilterId(segment.id) : null}
                      onMouseLeave={() => setHoveredFilterId(null)}
                    >
                      {firstFilter ? renderFilterChip(firstFilter, 0, extras) : <span className="aud-no-filter">—</span>}
                      {hoveredFilterId === segment.id && segment.filters.length > 1 ? (
                        <div className="aud-filter-tooltip">
                          {segment.filters.map((f, i) => (
                            <div key={i} className="aud-tooltip-row">
                              <span className="aud-filter-icon">{f.field === "tags" ? "🏷" : "📅"}</span>
                              <span>{FIELD_LABELS[f.field] ?? f.field}</span>
                              <span className="aud-filter-op">{OP_LABELS[f.op] ?? f.op}</span>
                              <span>{f.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {segmentCounts[segment.id] !== undefined ? (
                        <span className="aud-view-count aud-view-count-done">
                          {segmentCounts[segment.id].toLocaleString()} contacts
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="aud-view-count"
                          disabled={loadingCountIds.has(segment.id)}
                          onClick={() => void handleViewCount(segment.id)}
                        >
                          {loadingCountIds.has(segment.id) ? "Loading…" : "View count"}
                        </button>
                      )}
                    </td>
                    <td><span className="aud-created-by">—</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="dd-wrap">
                        <button
                          type="button"
                          className="aud-more-btn"
                          onClick={(e) => { e.stopPropagation(); setOpenSegmentMenuId(openSegmentMenuId === segment.id ? null : segment.id); }}
                        >
                          &#8942;
                        </button>
                        {openSegmentMenuId === segment.id ? (
                          <div className="dd-menu">
                            <button
                              type="button"
                              className="dd-item"
                              onClick={() => { void navigator.clipboard.writeText(segment.id); setOpenSegmentMenuId(null); }}
                            >
                              &#128203; Copy Segment ID
                            </button>
                            <button
                              type="button"
                              className="dd-item"
                              onClick={() => { onOpenCreateSegment(); setOpenSegmentMenuId(null); }}
                            >
                              &#9998; Edit Segment
                            </button>
                            <div className="dd-divider" />
                            <button
                              type="button"
                              className="dd-item dd-item-danger"
                              onClick={() => { setOpenSegmentMenuId(null); onDeleteSegment(segment.id, segment.name); }}
                            >
                              &#128465; Delete Segment
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="aud-empty">
                    {search ? `No segments match "${search}".` : "No segments yet. Create one above."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bottom sticky bar ── */}
      <div className="aud-bottom-bar">
        <span className="aud-bottom-note">
          These segments update dynamically according to the filters. Click "View count" to see the count.{" "}
          <a href="#" className="aud-bottom-link">Learn more &#8599;</a>
        </span>
        <div className="aud-bottom-right">
          {selectedSegmentIds.length > 0 ? (
            <span className="aud-selected-count">{selectedSegmentIds.length} Segment{selectedSegmentIds.length > 1 ? "s" : ""} Selected</span>
          ) : null}
          <button type="button" className="wz-continue-btn" disabled={!canContinue} onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </section>
  );
}

function VariableMappingStep({
  placeholders,
  bindings,
  setBindings,
  fieldOptions,
  headerMediaType,
  mediaOverrides,
  setMediaOverrides,
  onMediaUpload,
  uploadingMedia,
  selectedTemplate,
  sampleContact,
  onBack,
  onContinue
}: {
  placeholders: string[];
  bindings: CampaignTemplateVariables;
  setBindings: Dispatch<SetStateAction<CampaignTemplateVariables>>;
  fieldOptions: Array<{ value: string; label: string }>;
  headerMediaType: "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  mediaOverrides: CampaignMediaOverrides;
  setMediaOverrides: Dispatch<SetStateAction<CampaignMediaOverrides>>;
  onMediaUpload: (file: File) => Promise<void>;
  uploadingMedia: boolean;
  selectedTemplate: MessageTemplate | null;
  sampleContact: ContactRecord | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  const liveComponents = useMemo(
    () => buildPreviewComponents(selectedTemplate, bindings, sampleContact),
    [selectedTemplate, bindings, sampleContact]
  );

  return (
    <section className="sch-page">
      <div className="sch-header">
        <button type="button" className="wz-back-btn" onClick={onBack}>
          &#8592; Map Variables &amp; Media
        </button>
      </div>

      <div className="sch-layout">
        {/* ── Left: form ── */}
        <div className="sch-form-col">

          {/* Variables */}
          <div className="sch-section">
            <div className="sch-section-title">Template Variables</div>
            {placeholders.length === 0 ? (
              <div style={{ fontSize: "0.84rem", color: "#64748b", padding: "0.25rem 0" }}>
                This template has no dynamic variables — nothing to map.
              </div>
            ) : (
              placeholders.map((placeholder) => {
                const binding = bindings[placeholder] ?? { source: "contact" as const, field: "display_name", fallback: "" };
                return (
                  <div
                    key={placeholder}
                    style={{ display: "flex", flexDirection: "column", gap: "0.55rem", padding: "0.75rem 0", borderBottom: "1px solid #f1f5f9" }}
                  >
                    {/* Token badge */}
                    <span style={{
                      display: "inline-flex", alignSelf: "flex-start",
                      padding: "0.18rem 0.6rem", borderRadius: "6px",
                      background: "#e0f2fe", color: "#0369a1",
                      fontFamily: "monospace", fontSize: "0.82rem", fontWeight: 700
                    }}>
                      {placeholder}
                    </span>

                    <div className="sch-field-row">
                      <span className="sch-field-label">Source</span>
                      <select
                        className="sch-select"
                        value={binding.source}
                        onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, source: e.target.value as "contact" | "static" } }))}
                      >
                        <option value="contact">Contact field</option>
                        <option value="static">Static value</option>
                      </select>
                    </div>

                    <div className="sch-field-row">
                      <span className="sch-field-label">{binding.source === "contact" ? "Field" : "Value"}</span>
                      {binding.source === "contact" ? (
                        <select
                          className="sch-select"
                          value={binding.field ?? "display_name"}
                          onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, field: e.target.value } }))}
                        >
                          {fieldOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="sch-input"
                          value={binding.value ?? ""}
                          onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, value: e.target.value } }))}
                          placeholder="Static replacement value"
                        />
                      )}
                    </div>

                    <div className="sch-field-row">
                      <span className="sch-field-label">Fallback</span>
                      <input
                        className="sch-input"
                        value={binding.fallback ?? ""}
                        onChange={(e) => setBindings((c) => ({ ...c, [placeholder]: { ...binding, fallback: e.target.value } }))}
                        placeholder="Used when field is empty"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Media */}
          {headerMediaType ? (
            <div className="sch-section">
              <div className="sch-section-title">Media</div>
              <p className="sch-section-desc">
                This template requires a <strong>{headerMediaType.toLowerCase()}</strong> header.
                Upload a file or enter a public URL.
              </p>
              <div className="sch-field-row">
                <span className="sch-field-label">Upload file</span>
                <label style={{
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  height: "2.25rem", padding: "0 1rem",
                  border: "1.5px solid #2563eb", borderRadius: "8px",
                  background: "#fff", color: "#2563eb",
                  fontSize: "0.82rem", fontWeight: 700,
                  cursor: uploadingMedia ? "not-allowed" : "pointer",
                  opacity: uploadingMedia ? 0.6 : 1
                }}>
                  {uploadingMedia ? "Uploading…" : `↑ Upload ${headerMediaType.toLowerCase()}`}
                  <input
                    type="file"
                    style={{ display: "none" }}
                    disabled={uploadingMedia}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onMediaUpload(f); }}
                  />
                </label>
              </div>
              {mediaOverrides.headerMediaUrl ? (
                <div style={{ fontSize: "0.78rem", color: "#16a34a", marginTop: "-0.25rem" }}>
                  ✓ Media uploaded
                </div>
              ) : null}
              <div className="sch-field-row">
                <span className="sch-field-label">Or URL</span>
                <input
                  className="sch-input"
                  value={mediaOverrides.headerMediaUrl ?? ""}
                  onChange={(e) => setMediaOverrides((c) => ({ ...c, headerMediaUrl: e.target.value }))}
                  placeholder="https://example.com/media.jpg"
                />
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Right: live preview ── */}
        <div className="sch-preview-col">
          <div className="sch-preview-card">
            {selectedTemplate ? (
              <>
                <div className="sch-preview-tpl-name">{selectedTemplate.name}</div>
                <div className="sch-preview-tpl-meta">
                  <span className="sch-tpl-status">● Active</span>
                  <span className="sch-tpl-cat">{selectedTemplate.category}</span>
                </div>
                {sampleContact ? (
                  <div className="sch-preview-tpl-phone">
                    Preview for: {sampleContact.display_name ?? sampleContact.phone_number}
                  </div>
                ) : null}
                <div className="sch-preview-scroll">
                  <TemplatePreviewPanel
                    components={liveComponents.length ? liveComponents : selectedTemplate.components}
                    businessName={selectedTemplate.name}
                    headerMediaType={headerMediaType ?? undefined}
                    headerMediaUrl={mediaOverrides.headerMediaUrl}
                  />
                </div>
              </>
            ) : (
              <div style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
                No template selected
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div className="sch-bottom-bar">
        <div className="sch-bottom-left" />
        <div className="sch-bottom-right">
          <button type="button" className="sch-cancel-btn" onClick={onBack}>Back</button>
          <button type="button" className="sch-launch-btn" onClick={onContinue}>
            Continue &#8594;
          </button>
        </div>
      </div>
    </section>
  );
}

function TestBroadcastModal({
  onClose,
  onSend
}: {
  onClose: () => void;
  onSend: (phones: string[]) => void;
}) {
  const [phones, setPhones] = useState(["+91"]);

  function updatePhone(index: number, value: string) {
    setPhones((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function addPhone() {
    if (phones.length < 10) setPhones((prev) => [...prev, "+91"]);
  }

  function removePhone(index: number) {
    setPhones((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="tbm-backdrop" onClick={onClose}>
      <div className="tbm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tbm-header">
          <span className="tbm-title">Test Broadcast</span>
          <button type="button" className="csm-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="tbm-body">
          <div className="tbm-info">
            <span className="tbm-info-icon">&#9432;</span>
            <span>Required data for template variables and URL&apos;s will be taken from the first contact in the dynamic segment or excel sheet used. This is to ensure both the message quality and engagement will be tested by you.</span>
          </div>

          <div className="tbm-phones-label">Phone Number</div>
          <div className="tbm-phones">
            {phones.map((phone, index) => (
              <div key={index} className="tbm-phone-row">
                <div className="tbm-phone-input-wrap">
                  <span className="tbm-flag">🇮🇳</span>
                  <input
                    className="tbm-phone-input"
                    value={phone}
                    onChange={(e) => updatePhone(index, e.target.value)}
                    placeholder="+91 XXXXX XXXXX"
                  />
                </div>
                {phones.length > 1 ? (
                  <button type="button" className="tbm-remove-btn" onClick={() => removePhone(index)}>
                    🗑
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {phones.length < 10 ? (
            <button type="button" className="tbm-add-btn" onClick={addPhone}>
              + Add new
            </button>
          ) : null}
        </div>

        <div className="tbm-footer">
          <span className="tbm-limit">Max limit 10 numbers</span>
          <div className="tbm-footer-actions">
            <button type="button" className="csm-cancel-btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="csm-apply-btn"
              onClick={() => onSend(phones.filter((p) => p.trim().length > 2))}
            >
              Send now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleStep({
  name,
  onNameChange,
  sendMode,
  onSendModeChange,
  scheduledAt,
  onScheduledAtChange,
  retryEnabled,
  onRetryEnabledChange,
  retryType,
  onRetryTypeChange,
  retryUntil,
  onRetryUntilChange,
  policyEnabled,
  onPolicyEnabledChange,
  audienceCount,
  selectedSegmentNames,
  replyMode,
  onReplyModeChange,
  replyFlowId,
  onReplyFlowIdChange,
  replyAgentProfileId,
  onReplyAgentProfileIdChange,
  availableFlows,
  availableAgents,
  overrideExistingAssignee,
  onOverrideExistingAssigneeChange,
  selectedTemplate,
  bindings,
  headerMediaType,
  mediaOverrides,
  sampleContacts,
  onBack,
  onSave,
  onLaunch,
  onSendTest,
  saving
}: {
  name: string;
  onNameChange: (v: string) => void;
  sendMode: "now" | "schedule";
  onSendModeChange: (value: "now" | "schedule") => void;
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  retryEnabled: boolean;
  onRetryEnabledChange: (value: boolean) => void;
  retryType: "smart" | "manual";
  onRetryTypeChange: (value: "smart" | "manual") => void;
  retryUntil: string;
  onRetryUntilChange: (value: string) => void;
  policyEnabled: boolean;
  onPolicyEnabledChange: (value: boolean) => void;
  audienceCount: number;
  selectedSegmentNames: string[];
  replyMode: BroadcastReplyMode;
  onReplyModeChange: (value: BroadcastReplyMode) => void;
  replyFlowId: string;
  onReplyFlowIdChange: (value: string) => void;
  replyAgentProfileId: string;
  onReplyAgentProfileIdChange: (value: string) => void;
  availableFlows: Array<{ id: string; name: string }>;
  availableAgents: Array<{ id: string; name: string }>;
  overrideExistingAssignee: boolean;
  onOverrideExistingAssigneeChange: (value: boolean) => void;
  selectedTemplate: MessageTemplate | null;
  bindings: CampaignTemplateVariables;
  headerMediaType: "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  mediaOverrides: CampaignMediaOverrides;
  sampleContacts: ContactRecord[];
  onBack: () => void;
  onSave: () => void;
  onLaunch: () => void;
  onSendTest: (phones: string[]) => void;
  saving: boolean;
}) {
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showTestModal, setShowTestModal] = useState(false);

  // Auto-generate name if empty
  useEffect(() => {
    if (!name.trim()) {
      const now = new Date();
      onNameChange(
        now.toLocaleString([], {
          day: "2-digit", month: "short", year: "2-digit",
          hour: "2-digit", minute: "2-digit"
        })
      );
    }
  }, []);

  const replyConfigValid = replyMode !== "flow" || Boolean(replyFlowId);
  const totalPreview = Math.max(sampleContacts.length, 1);
  const safeIndex = Math.min(previewIndex, totalPreview - 1);

  const currentContact = sampleContacts[safeIndex] ?? null;
  const livePreviewComponents = useMemo(
    () => buildPreviewComponents(selectedTemplate, bindings, currentContact),
    [selectedTemplate, bindings, currentContact]
  );

  return (
    <>
      <section className="sch-page">
        {/* Header */}
        <div className="sch-header">
          <button type="button" className="wz-back-btn" onClick={onBack}>
            &#8592; Schedule Broadcast
          </button>
        </div>

        <div className="sch-layout">
          {/* ── Left: form ── */}
          <div className="sch-form-col">

            {/* Limit info banner */}
            <div className="sch-info-banner">
              <span className="sch-info-icon">&#9432;</span>
              <span>
                0 broadcast messages sent in the last 24 hours for a limit of 250 messages per day.
                You can send another <strong>250 messages</strong> for now.
              </span>
            </div>

            {/* Broadcast details */}
            <div className="sch-section">
              <div className="sch-section-title">Broadcast details</div>
              <div className="sch-field-row">
                <span className="sch-field-label">Broadcast name</span>
                <input
                  className="sch-input"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="e.g. April promotion"
                />
              </div>
              <div className="sch-field-row">
                <span className="sch-field-label">
                  Send broadcast <span className="sch-info-icon-sm">&#9432;</span>
                </span>
                <select
                  className="sch-select"
                  value={sendMode}
                  onChange={(e) => onSendModeChange(e.target.value as "now" | "schedule")}
                >
                  <option value="now">Send immediately</option>
                  <option value="schedule">Schedule for later</option>
                </select>
              </div>
              {sendMode === "schedule" ? (
                <div className="sch-field-row">
                  <span className="sch-field-label">Schedule date &amp; time</span>
                  <input
                    className="sch-input"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => onScheduledAtChange(e.target.value)}
                  />
                </div>
              ) : null}
            </div>

            {/* Retry Mode */}
            <div className="sch-section">
              <div className="sch-section-title">Retry Mode</div>
              <div className="sch-field-row">
                <span className="sch-field-label">
                  Enable Retry <span className="sch-info-icon-sm">&#9432;</span>
                </span>
                <label className="sch-toggle">
                  <input
                    type="checkbox"
                    checked={retryEnabled}
                    onChange={(e) => onRetryEnabledChange(e.target.checked)}
                  />
                  <span className="sch-toggle-track" />
                </label>
              </div>
              <div className={`sch-retry-body ${retryEnabled ? "" : "is-disabled"}`}>
                <div className="sch-field-row">
                  <span className="sch-field-label">Retry type <span className="sch-required">*</span></span>
                  <div className="sch-radio-group">
                    <label className="sch-radio-label">
                      <input
                        type="radio"
                        name="retryType"
                        checked={retryType === "smart"}
                        onChange={() => onRetryTypeChange("smart")}
                        disabled={!retryEnabled}
                      />
                      <span>Smart retry</span>
                      <span className="sch-recommended">Recommended</span>
                    </label>
                    <label className="sch-radio-label">
                      <input
                        type="radio"
                        name="retryType"
                        checked={retryType === "manual"}
                        onChange={() => onRetryTypeChange("manual")}
                        disabled={!retryEnabled}
                      />
                      <span>Manual retry</span>
                    </label>
                  </div>
                </div>
                <div className="sch-field-row">
                  <span className="sch-field-label">Retry until</span>
                  <div className="sch-input-icon-wrap">
                    <input
                      className="sch-input"
                      type="datetime-local"
                      value={retryUntil}
                      onChange={(e) => onRetryUntilChange(e.target.value)}
                      disabled={!retryEnabled}
                      placeholder="Retry until"
                    />
                    <span className="sch-cal-icon">&#128197;</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Target audience */}
            <div className="sch-section">
              <div className="sch-section-title">Target audience</div>
              <div className="sch-field-row">
                <span className="sch-field-label">Total contacts</span>
                <span className="sch-audience-count">
                  &#128101; <strong>{audienceCount}</strong>
                </span>
              </div>
              <div className="sch-field-row">
                <span className="sch-field-label">Selected segments</span>
                <div className="sch-segment-chips">
                  {selectedSegmentNames.length > 0
                    ? selectedSegmentNames.map((n) => (
                        <span key={n} className="sch-segment-chip">{n}</span>
                      ))
                    : <span className="sch-muted">—</span>}
                </div>
              </div>
              <div className="sch-policy-row">
                <div>
                  <div className="sch-policy-title">
                    Follow WhatsApp Business Policy{" "}
                    <a href="#" className="sch-learn-more">Learn more &#8599;</a>
                  </div>
                  <div className="sch-policy-desc">
                    We&apos;ll only message contacts those who have opted in for marketing messages.
                  </div>
                </div>
                <label className="sch-toggle">
                  <input
                    type="checkbox"
                    checked={policyEnabled}
                    onChange={(e) => onPolicyEnabledChange(e.target.checked)}
                  />
                  <span className="sch-toggle-track" />
                </label>
              </div>
            </div>

            {/* Broadcast reply settings */}
            <div className="sch-section">
              <div className="sch-section-head">
                <span className="sch-section-title">Broadcast reply settings</span>
                <span className="sch-optional-badge">Optional</span>
                <a href="#" className="sch-learn-more sch-section-learn">Learn more &#8599;</a>
              </div>
              <p className="sch-section-desc">
                Set how replies to your broadcast messages are managed when contacts interact with them.
                <span className="sch-info-icon-sm"> &#9432;</span>
              </p>
              <div className="sch-field-row">
                <span className="sch-field-label">Assign conversations to</span>
                <div className="sch-reply-selects">
                  <select
                    className="sch-select"
                    value={replyMode}
                    onChange={(e) => onReplyModeChange(e.target.value as BroadcastReplyMode)}
                  >
                    <option value="ai">AI assignee</option>
                    <option value="flow">API flow</option>
                  </select>
                  <select
                    className="sch-select"
                    value={replyMode === "flow" ? replyFlowId : replyAgentProfileId}
                    onChange={(e) =>
                      replyMode === "flow"
                        ? onReplyFlowIdChange(e.target.value)
                        : onReplyAgentProfileIdChange(e.target.value)
                    }
                  >
                    {replyMode === "flow" ? <option value="">Select API flow</option> : <option value="">Select AI assignee</option>}
                    {replyMode === "flow"
                      ? availableFlows.map((flow) => (
                          <option key={flow.id} value={flow.id}>{flow.name}</option>
                        ))
                      : availableAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                  </select>
                </div>
              </div>
              <label className="sch-checkbox-row">
                <input
                  type="checkbox"
                  className="aud-checkbox"
                  checked={overrideExistingAssignee}
                  onChange={(e) => onOverrideExistingAssigneeChange(e.target.checked)}
                />
                <span className="sch-checkbox-text">
                  Use the above configuration, though the conversation is currently assigned to some assignee.
                </span>
              </label>
            </div>

          </div>

          {/* ── Right: message preview ── */}
          {selectedTemplate ? (
            <div className="sch-preview-col">
              <div className="sch-preview-nav">
                <button
                  type="button"
                  className="sch-nav-btn"
                  disabled={safeIndex <= 0}
                  onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                >
                  &#8592;
                </button>
                <span className="sch-nav-label">
                  Message preview {safeIndex + 1} / {totalPreview}
                </span>
                <button
                  type="button"
                  className="sch-nav-btn"
                  disabled={safeIndex >= totalPreview - 1}
                  onClick={() => setPreviewIndex((i) => Math.min(totalPreview - 1, i + 1))}
                >
                  &#8594;
                </button>
              </div>
              <div className="sch-preview-card">
                <div className="sch-preview-tpl-name">{selectedTemplate.name}</div>
                <div className="sch-preview-tpl-meta">
                  <span className="sch-tpl-status">
                    <span className="wz-tpl-status-dot" />
                    Active
                  </span>
                  <span className="sch-tpl-cat">
                    {selectedTemplate.category}
                  </span>
                </div>
                <div className="sch-preview-tpl-phone">
                  &#128241; {(selectedTemplate as { displayPhoneNumber?: string }).displayPhoneNumber ?? "—"}
                </div>
                <div className="sch-preview-scroll">
                  <TemplatePreviewPanel
                    components={livePreviewComponents.length ? livePreviewComponents : selectedTemplate.components}
                    businessName={(selectedTemplate as { displayPhoneNumber?: string }).displayPhoneNumber ?? selectedTemplate.name}
                    headerMediaType={headerMediaType ?? undefined}
                    headerMediaUrl={mediaOverrides.headerMediaUrl}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Bottom sticky bar ── */}
        <div className="sch-bottom-bar">
          <div className="sch-bottom-left" />
          <div className="sch-bottom-right">
            <button type="button" className="sch-cancel-btn" onClick={onBack}>
              Cancel
            </button>
            <button
              type="button"
              className="sch-test-btn"
              onClick={() => setShowTestModal(true)}
              disabled={saving}
            >
              Test Broadcast
            </button>
            <button
              type="button"
              className="sch-launch-btn"
              disabled={saving || !replyConfigValid}
              onClick={sendMode === "schedule" ? onSave : onLaunch}
            >
              {saving
                ? "Sending…"
                : sendMode === "schedule"
                  ? "Save Scheduled Broadcast"
                  : "Send Broadcast Now"}
            </button>
          </div>
        </div>
      </section>

      {showTestModal ? (
        <TestBroadcastModal
          onClose={() => setShowTestModal(false)}
          onSend={(phones) => {
            setShowTestModal(false);
            onSendTest(phones);
          }}
        />
      ) : null}
    </>
  );
}

export function BroadcastModulePage({ token, mode }: { token: string; mode: ModuleMode }) {
  const { campaignId } = useParams<{ campaignId: string }>();

  if (mode === "list") {
    return <BroadcastListPage token={token} />;
  }
  if (mode === "detail" && campaignId) {
    return <BroadcastDetailPage token={token} campaignId={campaignId} />;
  }
  if (mode === "retarget" && campaignId) {
    return <BroadcastWizardPage token={token} mode="retarget" sourceCampaignId={campaignId} />;
  }
  return <BroadcastWizardPage token={token} mode="new" />;
}
