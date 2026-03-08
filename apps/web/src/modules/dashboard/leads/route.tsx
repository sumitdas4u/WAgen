import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { LeadConversation } from "../../../lib/api";
import { LeadsTab } from "../../../pages/dashboard/tabs/leads-tab";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { summarizeLeads } from "./api";
import { buildLeadsQueryOptions, useLeadsQuery } from "./queries";

type LeadStageFilter = "all" | "hot" | "warm" | "cold";
type LeadKindFilter = "all" | "lead" | "feedback" | "complaint" | "other";
type LeadChannelFilter = "all" | "web" | "qr" | "api";
type LeadQuickFilter = "all" | "today_hot" | "today_warm" | "today_complaint" | "needs_reply";

const LEAD_QUICK_FILTER_OPTIONS: Array<{ value: LeadQuickFilter; label: string }> = [
  { value: "all", label: "All Leads" },
  { value: "today_hot", label: "Today's Hot Leads" },
  { value: "today_warm", label: "Today's Warm Leads" },
  { value: "today_complaint", label: "Today's Complaints" },
  { value: "needs_reply", label: "Must Reply" }
];

function isSameLocalDay(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const current = new Date();
  const sample = new Date(value);
  return (
    current.getFullYear() === sample.getFullYear() &&
    current.getMonth() === sample.getMonth() &&
    current.getDate() === sample.getDate()
  );
}

function formatPhone(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return value;
  }
  return `+${digits}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function getSummaryStatusLabel(status: LeadConversation["summary_status"]) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "stale") {
    return "Outdated";
  }
  return "Missing";
}

function getLeadKindLabel(kind: LeadConversation["lead_kind"]) {
  if (kind === "feedback") {
    return "Feedback";
  }
  if (kind === "complaint") {
    return "Complaint";
  }
  if (kind === "other") {
    return "Other";
  }
  return "Lead";
}

function getChannelLabel(channelType: LeadConversation["channel_type"]) {
  if (channelType === "api") {
    return "WhatsApp API";
  }
  if (channelType === "qr") {
    return "WhatsApp QR";
  }
  return "Web";
}

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedLeadSummaries, setExpandedLeadSummaries] = useState<Record<string, boolean>>({});
  const [expandedLeadMessages, setExpandedLeadMessages] = useState<Record<string, boolean>>({});

  const leadStageFilter = (searchParams.get("stage") as LeadStageFilter | null) ?? "all";
  const leadKindFilter = (searchParams.get("kind") as LeadKindFilter | null) ?? "all";
  const leadChannelFilter = (searchParams.get("channel") as LeadChannelFilter | null) ?? "all";
  const leadTodayOnly = searchParams.get("today") === "true";
  const leadRequiresReplyOnly = searchParams.get("reply") === "true";
  const leadQuickFilter = (searchParams.get("quick") as LeadQuickFilter | null) ?? "all";

  const leadsQuery = useLeadsQuery(token, {
    stage: leadStageFilter === "all" ? undefined : leadStageFilter,
    kind: leadKindFilter === "all" ? undefined : leadKindFilter,
    channelType: leadChannelFilter === "all" ? undefined : leadChannelFilter,
    todayOnly: leadTodayOnly || undefined,
    requiresReply: leadRequiresReplyOnly || undefined
  });

  const summarizeMutation = useMutation({
    mutationFn: () => summarizeLeads(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.leadsRoot });
    }
  });

  const leads = useMemo(() => {
    const sorted = [...(leadsQuery.data ?? [])].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });

    return sorted.filter((lead) => {
      if (leadQuickFilter === "today_hot" && !(lead.stage === "hot" && isSameLocalDay(lead.last_message_at))) {
        return false;
      }
      if (leadQuickFilter === "today_warm" && !(lead.stage === "warm" && isSameLocalDay(lead.last_message_at))) {
        return false;
      }
      if (
        leadQuickFilter === "today_complaint" &&
        !(lead.lead_kind === "complaint" && isSameLocalDay(lead.last_message_at))
      ) {
        return false;
      }
      if (leadQuickFilter === "needs_reply" && !lead.requires_reply) {
        return false;
      }
      return true;
    });
  }, [leadQuickFilter, leadsQuery.data]);

  const leadHighlights = useMemo(
    () =>
      (leadsQuery.data ?? []).reduce(
        (acc, row) => {
          if (isSameLocalDay(row.last_message_at)) {
            if (row.stage === "hot") {
              acc.todayHot += 1;
            }
            if (row.stage === "warm") {
              acc.todayWarm += 1;
            }
            if (row.lead_kind === "complaint") {
              acc.todayComplaints += 1;
            }
          }
          if (row.requires_reply) {
            acc.mustReply += 1;
          }
          return acc;
        },
        {
          todayHot: 0,
          todayWarm: 0,
          todayComplaints: 0,
          mustReply: 0
        }
      ),
    [leadsQuery.data]
  );

  const updateFilter = (name: string, value: string | boolean) => {
    const next = new URLSearchParams(searchParams);
    const shouldDelete =
      value === false ||
      value === "all" ||
      value === "" ||
      value === null;
    if (shouldDelete) {
      next.delete(name);
    } else {
      next.set(name, String(value));
    }
    setSearchParams(next, { replace: true });
  };

  const handleExportLeads = () => {
    if (leads.length === 0) {
      return;
    }

    const rows = leads.map((lead) => ({
      Name: lead.contact_name || "",
      Phone: formatPhone(lead.contact_phone || lead.phone_number),
      Email: lead.contact_email || "",
      Type: getLeadKindLabel(lead.lead_kind),
      Stage: lead.stage,
      Score: lead.score,
      Channel: getChannelLabel(lead.channel_type),
      "Assigned Agent": lead.assigned_agent_name || "",
      "Must Reply": lead.requires_reply ? "Yes" : "No",
      "AI Summary": lead.ai_summary || "",
      "Last Message": lead.last_message || "",
      "Last Activity": lead.last_message_at ? new Date(lead.last_message_at).toLocaleString() : ""
    }));

    const csvEscape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const header = Object.keys(rows[0]);
    const lines = [
      header.map((key) => csvEscape(key)).join(","),
      ...rows.map((row) => header.map((key) => csvEscape(String(row[key as keyof typeof row] ?? ""))).join(","))
    ];

    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `leads-summary-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <LeadsTab
      summarizingLeads={summarizeMutation.isPending}
      leadsLoading={leadsQuery.isLoading || leadsQuery.isFetching}
      leads={leads}
      leadStageFilter={leadStageFilter}
      leadKindFilter={leadKindFilter}
      leadChannelFilter={leadChannelFilter}
      leadTodayOnly={leadTodayOnly}
      leadRequiresReplyOnly={leadRequiresReplyOnly}
      leadQuickFilter={leadQuickFilter}
      leadHighlights={leadHighlights}
      quickFilterOptions={LEAD_QUICK_FILTER_OPTIONS}
      expandedLeadSummaries={expandedLeadSummaries}
      expandedLeadMessages={expandedLeadMessages}
      formatPhone={formatPhone}
      getLeadKindLabel={getLeadKindLabel}
      getChannelLabel={getChannelLabel}
      getSummaryStatusLabel={getSummaryStatusLabel}
      formatDateTime={formatDateTime}
      onSummarizeLeads={() => {
        summarizeMutation.mutate();
      }}
      onRefreshLeads={() => {
        void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.leadsRoot });
      }}
      onExportLeads={handleExportLeads}
      onLeadStageFilterChange={(value) => updateFilter("stage", value)}
      onLeadKindFilterChange={(value) => updateFilter("kind", value)}
      onLeadChannelFilterChange={(value) => updateFilter("channel", value)}
      onLeadTodayOnlyChange={(value) => updateFilter("today", value)}
      onLeadRequiresReplyOnlyChange={(value) => updateFilter("reply", value)}
      onLeadQuickFilterToggle={(value) => updateFilter("quick", leadQuickFilter === value ? "all" : value)}
      onLeadQuickFilterSelect={(value) => updateFilter("quick", value)}
      onToggleLeadSummary={(leadId) => {
        setExpandedLeadSummaries((current) => ({ ...current, [leadId]: !current[leadId] }));
      }}
      onToggleLeadMessage={(leadId) => {
        setExpandedLeadMessages((current) => ({ ...current, [leadId]: !current[leadId] }));
      }}
      onOpenLeadChat={(leadId) => {
        navigate(`/dashboard/inbox/${leadId}`);
      }}
    />
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildLeadsQueryOptions(token, {}));
}
