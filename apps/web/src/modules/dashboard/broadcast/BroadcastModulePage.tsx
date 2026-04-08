import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  createContactSegment,
  cancelCampaignRun,
  createCampaignDraft,
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
  type BroadcastReport,
  type Campaign,
  type ContactImportColumnMapping,
  type ContactImportPreview,
  type CampaignMediaOverrides,
  type CampaignTemplateVariables,
  type ContactField,
  type ContactRecord,
  type MessageTemplate,
  type SegmentFilter,
  type SegmentFilterOp,
  type RetargetStatus
} from "../../../lib/api";
import { uploadBroadcastMedia as uploadBroadcastMediaToSupabase } from "../../../lib/supabase";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { useInboxPublishedFlowsQuery } from "../inbox/queries";
import { TemplatePreviewPanel } from "../templates/TemplatePreviewPanel";
import { useTemplatesQuery } from "../templates/queries";
import "./broadcast.css";

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

function SummaryCards({ report }: { report: BroadcastReport }) {
  const items = [
    { label: "Recipients", value: report.campaign.total_count, tone: "neutral" },
    { label: "Sent", value: report.buckets.sent, tone: "blue" },
    { label: "Delivered", value: report.buckets.delivered, tone: "green" },
    { label: "Read", value: report.buckets.read, tone: "teal" },
    { label: "Failed", value: report.buckets.failed, tone: "rose" },
    { label: "Not delivered", value: report.buckets.skipped, tone: "amber" }
  ];

  return (
    <div className="broadcast-stat-grid">
      {items.map((item) => (
        <div key={item.label} className={`broadcast-stat-card tone-${item.tone}`}>
          <div className="broadcast-stat-label">{item.label}</div>
          <div className="broadcast-stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function BroadcastListPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("7d");

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
  const filtered = allBroadcasts.filter((b) =>
    !search || b.name.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage);

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
            <div className="bl-date-filter">
              <span className="bl-date-filter-label">From date</span>
              <span className="bl-date-filter-sep">|</span>
              <span className="bl-date-filter-label">To date</span>
              <span className="bl-date-filter-icon">&#128197;</span>
            </div>
            <button type="button" className="bl-toolbar-btn">
              &#11123; Export
            </button>
            <button type="button" className="bl-toolbar-btn">
              &#9965; Filter
            </button>
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
                  <td>
                    <div className="bl-cell-date">{formatDateTime(broadcast.created_at)}</div>
                    <div className="bl-cell-name">{broadcast.name}</div>
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
                      <button
                        type="button"
                        className="bl-more-btn"
                        onClick={() => navigate(`/dashboard/broadcast/${broadcast.id}`)}
                        title="More"
                      >
                        &#8942;
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!broadcastsQuery.isLoading && filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="broadcast-empty-state">
                  {search ? "No broadcasts match your search." : "No broadcasts created yet."}
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

  return (
    <section className="broadcast-page">
      <div className="broadcast-hero">
        <div className="broadcast-hero-copy">
          <span className="broadcast-eyebrow">Broadcast report</span>
          <h2 className="broadcast-hero-title">{report.campaign.name}</h2>
          <p className="broadcast-hero-text">
            {formatCampaignStatus(report.campaign.status)} • Created {formatDateTime(report.campaign.created_at)}
          </p>
          {isLiveUpdating ? <div className="broadcast-live-note">Status is updating in real time while this broadcast is running.</div> : null}
        </div>
        <div className="broadcast-table-actions">
          <button type="button" className="broadcast-secondary-btn" onClick={() => navigate(`/dashboard/broadcast/${campaignId}/retarget`)}>Retarget</button>
          {(report.campaign.status === "running" || report.campaign.status === "scheduled" || report.campaign.status === "draft") ? (
            <button type="button" className="broadcast-secondary-btn" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      <SummaryCards report={report} />

      <section className="broadcast-table-shell">
        <div className="broadcast-table-header">
          <div>
            <h3 className="broadcast-section-title">Recipient delivery log</h3>
            <p className="broadcast-section-text">Every recipient status and message failure, in a clearer audit trail.</p>
          </div>
          <div className="broadcast-table-header-actions">
            <button
              type="button"
              className="broadcast-secondary-btn broadcast-refresh-btn"
              onClick={() => void reportQuery.refetch()}
              disabled={reportQuery.isFetching}
            >
              {reportQuery.isFetching ? "Refreshing..." : "Refresh status"}
            </button>
          </div>
        </div>
        <table className="broadcast-table">
          <thead>
            <tr>
              {["Phone", "Status", "Sent", "Delivered", "Read", "Error"].map((heading) => (
                <th key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.messages.map((message) => (
              <tr key={message.id}>
                <td>{message.phone_number}</td>
                <td>
                  <span className={`broadcast-status-pill status-${String(message.status)}`}>
                    {formatCampaignStatus(message.status as Campaign["status"])}
                  </span>
                </td>
                <td>{message.sent_at ? formatDateTime(message.sent_at) : "—"}</td>
                <td>{message.delivered_at ? formatDateTime(message.delivered_at) : "—"}</td>
                <td>{message.read_at ? formatDateTime(message.read_at) : "—"}</td>
                <td className="broadcast-error-cell">{message.error_message || "—"}</td>
              </tr>
            ))}
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
  const templatesQuery = useTemplatesQuery(token);
  const segmentsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactSegments,
    queryFn: () => listContactSegments(token).then((response) => response.segments)
  });
  const fieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields)
  });
  const publishedFlowsQuery = useInboxPublishedFlowsQuery(token);

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
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [phoneNumberFormat, setPhoneNumberFormat] = useState<"with_country_code" | "without_country_code">("with_country_code");
  const [defaultCountryCode, setDefaultCountryCode] = useState("91");
  const [uploadStep, setUploadStep] = useState<"download" | "upload" | "preview">("download");
  const [showCreateSegmentModal, setShowCreateSegmentModal] = useState(false);

  const approvedTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.status === "APPROVED"),
    [templatesQuery.data]
  );
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const placeholders = useMemo(() => extractTemplatePlaceholders(selectedTemplate), [selectedTemplate]);
  const fields = fieldsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const publishedFlows = publishedFlowsQuery.data ?? [];

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

  const saveMutation = useMutation({
    mutationFn: async (launchNow: boolean) => {
      const draft = await createCampaignDraft(token, {
        name: name.trim(),
        broadcastType: mode === "retarget" ? "retarget" : "standard",
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
                  flowId: replyMode === "flow" ? replyFlowId || null : null
                }
              }
            : {
                kind: "segment",
                segmentId: primarySegmentId,
                segmentIds: selectedSegmentIds,
                replyRouting: {
                  mode: replyMode,
                  flowId: replyMode === "flow" ? replyFlowId || null : null
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
    mode === "retarget" ? Boolean(retargetPreviewQuery.data?.count) : Boolean(selectedTemplateId);
  const canContinueStep2 =
    mode === "retarget" ? Boolean(selectedTemplateId) : selectedSegmentIds.length > 0;

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
            onDownloadTemplate={handleDownloadAudienceTemplate}
            downloadingTemplate={downloadingTemplate}
            selectedTemplate={selectedTemplate}
            placeholders={placeholders}
            previewComponents={previewComponents}
            onContinue={() => setStep(3)}
            canContinue={canContinueStep2 && Boolean(name.trim())}
          />
        ) : null}

        {step === 2 && mode === "retarget" ? (
          <TemplateSelectionStep
            name={name}
            onNameChange={setName}
            templates={approvedTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
            canContinue={canContinueStep2 && Boolean(name.trim())}
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
            availableFlows={publishedFlows}
            selectedTemplate={selectedTemplate}
            bindings={bindings}
            sampleContacts={selectedSegmentContactsQuery.data ?? []}
            onBack={() => setStep(3)}
            onSave={() => saveMutation.mutate(false)}
            onLaunch={() => saveMutation.mutate(true)}
            saving={saveMutation.isPending}
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
  name,
  onNameChange,
  templates,
  selectedTemplateId,
  onSelect,
  onBack,
  onContinue,
  canContinue
}: {
  name?: string;
  onNameChange?: (value: string) => void;
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

      {/* Optional broadcast name field (retarget step 2) */}
      {onNameChange ? (
        <label className="broadcast-field wz-name-field">
          <span className="broadcast-label">Broadcast name</span>
          <input
            className="broadcast-input"
            value={name ?? ""}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Enter broadcast name"
          />
        </label>
      ) : null}

      {/* Template grid */}
      <div className="wz-tpl-grid">
        {filtered.map((template) => {
          const selected = selectedTemplateId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.id)}
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
  const [filters, setFilters] = useState<SegmentFilter[]>([]);
  const [previewContacts, setPreviewContacts] = useState<ContactRecord[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFilter = () => {
    setFilters((current) => [...current, { field: "marketing_optin", op: "is", value: "true" }]);
    setPreviewContacts(null);
  };

  const updateFilter = (index: number, updated: SegmentFilter) => {
    setFilters((current) => current.map((item, i) => (i === index ? updated : item)));
    setPreviewContacts(null);
  };

  const removeFilter = (index: number) => {
    setFilters((current) => current.filter((_, i) => i !== index));
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

  const FIELD_LABELS: Record<string, string> = {
    display_name: "Name", phone_number: "Phone", email: "Email",
    tags: "Tags", contact_type: "Type", created_at: "Created At",
    order_date: "Order Date", marketing_optin: "Marketing Optin"
  };
  const OP_LABELS: Record<string, string> = {
    is: "Is", is_not: "Is not", contains: "Contains", not_contains: "Does not contain",
    before: "Before", after: "Is after", is_empty: "Is empty", is_not_empty: "Is not empty"
  };

  return (
    <div className="csm-backdrop" onClick={onClose}>
      <div className="csm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="csm-header">
          <span className="csm-title">Create Segment</span>
          <button type="button" className="csm-close" onClick={onClose}>&#10005;</button>
        </div>

        {/* Segment name */}
        <div className="csm-name-row">
          <input
            className="csm-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Segment name"
            autoFocus
          />
        </div>

        {/* Filter button */}
        <div className="csm-filter-bar">
          <button type="button" className="csm-filter-btn" onClick={addFilter}>
            <span className="csm-filter-icon">&#9965;</span> Filter
          </button>
        </div>

        {/* Filter rows */}
        {filters.length > 0 ? (
          <div className="csm-filter-list">
            {filters.map((filter, index) => {
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
              const availableOps = SEGMENT_OP_OPTIONS.filter((o) => !o.onlyDate || isDateField);
              const selectedOp = SEGMENT_OP_OPTIONS.find((o) => o.value === filter.op);

              return (
                <div key={index} className="csm-filter-row">
                  <div className="csm-filter-pill">
                    <span className="csm-filter-field-icon">
                      {filter.field === "tags" ? "🏷" : filter.field.includes("date") || filter.field === "created_at" || filter.field === "order_date" ? "📅" : "👁"}
                    </span>
                    <span className="csm-filter-field-name">
                      {FIELD_LABELS[filter.field] ?? filter.field}
                    </span>
                    <button type="button" className="csm-filter-remove" onClick={() => removeFilter(index)}>&#10005;</button>
                  </div>
                  <div className="csm-filter-controls">
                    <select
                      className="csm-filter-select"
                      value={filter.op}
                      onChange={(e) => updateFilter(index, { ...filter, op: e.target.value as SegmentFilterOp })}
                    >
                      {availableOps.map((o) => (
                        <option key={o.value} value={o.value}>{OP_LABELS[o.value] ?? o.label}</option>
                      ))}
                    </select>
                    {!selectedOp?.noValue && (
                      isDateField ? (
                        <input
                          type="date"
                          className="csm-filter-select"
                          value={filter.value}
                          onChange={(e) => updateFilter(index, { ...filter, value: e.target.value })}
                        />
                      ) : (
                        <select
                          className="csm-filter-select"
                          value={filter.value}
                          onChange={(e) => updateFilter(index, { ...filter, value: e.target.value })}
                        >
                          <option value="">Select value</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      )
                    )}
                  </div>
                  <select
                    className="csm-filter-select csm-filter-field-select"
                    value={filter.field}
                    onChange={(e) => updateFilter(index, { ...filter, field: e.target.value })}
                  >
                    <optgroup label="Standard Fields">
                      {SEGMENT_FIELD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                    {customFields.filter((f) => f.is_active).length > 0 ? (
                      <optgroup label="Custom Fields">
                        {customFields.filter((f) => f.is_active).map((f) => (
                          <option key={f.id} value={`custom:${f.name}`}>{f.label}</option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </div>
              );
            })}
            <div className="csm-filter-actions">
              <button type="button" className="csm-cancel-btn" onClick={() => { setFilters([]); setPreviewContacts(null); }}>Cancel</button>
              <button type="button" className="csm-apply-btn" onClick={() => void handlePreview()} disabled={previewLoading}>
                {previewLoading ? "Loading…" : "Apply"}
              </button>
            </div>
          </div>
        ) : null}

        {/* Body — preview or placeholder */}
        <div className="csm-body">
          {previewContacts ? (
            <div className="csm-preview">
              <div className="csm-preview-count">{previewContacts.length} contact{previewContacts.length !== 1 ? "s" : ""} match</div>
              {previewContacts.slice(0, 6).map((c) => (
                <div key={c.id} className="csm-preview-row">
                  <span className="csm-avatar">{(c.display_name || "U")[0].toUpperCase()}</span>
                  <span>{c.display_name || "Unknown"}</span>
                  <span className="csm-preview-phone">{c.phone_number}</span>
                </div>
              ))}
              {previewContacts.length > 6 ? <div className="csm-preview-more">+{previewContacts.length - 6} more</div> : null}
            </div>
          ) : (
            <div className="csm-placeholder">
              Add filters to contacts to create a segment. Broadcast will be triggered to selected segments.
            </div>
          )}
        </div>

        {error ? <div className="csm-error">{error}</div> : null}

        {/* Footer */}
        <div className="csm-footer">
          <button type="button" className="csm-cancel-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="csm-create-btn" disabled={saving || !name.trim()} onClick={() => void handleCreate()}>
            {saving ? "Creating…" : "Create Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AudienceSelectionStep({
  name,
  onNameChange,
  segments,
  selectedSegmentIds,
  onToggleSegment,
  onToggleAll,
  onOpenCreateSegment,
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
                        Provide the new contacts consent to receive marketing messages.{" "}
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
                    <td>
                      <button type="button" className="aud-view-count" onClick={(e) => e.stopPropagation()}>
                        View count
                      </button>
                    </td>
                    <td><span className="aud-created-by">—</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="aud-more-btn">&#8942;</button>
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
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="broadcast-step-section">
      <div className="broadcast-section-heading">
        <h3 className="broadcast-section-title">Map Variables & Media</h3>
        <p className="broadcast-section-text">Connect template placeholders to contact fields or static values, then attach media if needed.</p>
      </div>
      {placeholders.length === 0 ? (
        <div className="broadcast-note-card">
          This template does not have dynamic variables.
        </div>
      ) : (
        placeholders.map((placeholder) => {
          const binding = bindings[placeholder] ?? { source: "contact" as const, field: "display_name", fallback: "" };
          return (
            <div key={placeholder} className="broadcast-binding-card">
              <strong className="broadcast-binding-token">{placeholder}</strong>
              <select className="broadcast-input" value={binding.source} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, source: event.target.value as "contact" | "static" } }))}>
                <option value="contact">Contact field</option>
                <option value="static">Static value</option>
              </select>
              {binding.source === "contact" ? (
                <select className="broadcast-input" value={binding.field ?? "display_name"} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, field: event.target.value } }))}>
                  {fieldOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input className="broadcast-input" value={binding.value ?? ""} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, value: event.target.value } }))} placeholder="Static replacement" />
              )}
              <input className="broadcast-input" value={binding.fallback ?? ""} onChange={(event) => setBindings((current) => ({ ...current, [placeholder]: { ...binding, fallback: event.target.value } }))} placeholder="Fallback if empty" />
            </div>
          );
        })
      )}
      {headerMediaType ? (
        <section className="broadcast-surface-card">
          <div className="broadcast-card-title">Media</div>
          <div className="broadcast-muted-copy">
            This template uses a {headerMediaType.toLowerCase()} header. Upload a file or provide a public media URL for this broadcast.
          </div>
          <label className="broadcast-upload-btn slim">
            {uploadingMedia ? "Uploading..." : `Upload ${headerMediaType.toLowerCase()}`}
            <input type="file" disabled={uploadingMedia} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onMediaUpload(file);
              }
            }} />
          </label>
          <input className="broadcast-input" value={mediaOverrides.headerMediaUrl ?? ""} onChange={(event) => setMediaOverrides((current) => ({ ...current, headerMediaUrl: event.target.value }))} placeholder="https://example.com/media.jpg" />
        </section>
      ) : null}
      <div className="broadcast-actions">
        <button type="button" className="broadcast-secondary-btn" onClick={onBack}>Back</button>
        <button type="button" onClick={onContinue} className="broadcast-primary-btn">
          Continue
        </button>
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
  availableFlows,
  selectedTemplate,
  bindings,
  sampleContacts,
  onBack,
  onSave,
  onLaunch,
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
  availableFlows: Array<{ id: string; name: string }>;
  selectedTemplate: MessageTemplate | null;
  bindings: CampaignTemplateVariables;
  sampleContacts: ContactRecord[];
  onBack: () => void;
  onSave: () => void;
  onLaunch: () => void;
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
                    <option value="ai">Select Assignee</option>
                    <option value="flow">Flow</option>
                  </select>
                  <select
                    className="sch-select"
                    value={replyFlowId}
                    onChange={(e) => onReplyFlowIdChange(e.target.value)}
                    disabled={replyMode !== "flow"}
                  >
                    <option value="">--Select--</option>
                    {availableFlows.map((flow) => (
                      <option key={flow.id} value={flow.id}>{flow.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="sch-checkbox-row">
                <input type="checkbox" className="aud-checkbox" defaultChecked />
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
            console.info("Test broadcast to:", phones);
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
