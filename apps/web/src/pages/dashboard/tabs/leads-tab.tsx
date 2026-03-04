import type { LeadConversation } from "../../../lib/api";

type LeadKindFilter = "all" | "lead" | "feedback" | "complaint" | "other";
type LeadChannelFilter = "all" | "web" | "qr" | "api";
type LeadQuickFilter = "all" | "today_hot" | "today_warm" | "today_complaint" | "needs_reply";

interface LeadsTabProps {
  summarizingLeads: boolean;
  leadsLoading: boolean;
  leads: LeadConversation[];
  leadStageFilter: "all" | "hot" | "warm" | "cold";
  leadKindFilter: LeadKindFilter;
  leadChannelFilter: LeadChannelFilter;
  leadTodayOnly: boolean;
  leadRequiresReplyOnly: boolean;
  leadQuickFilter: LeadQuickFilter;
  leadHighlights: {
    todayHot: number;
    todayWarm: number;
    todayComplaints: number;
    mustReply: number;
  };
  quickFilterOptions: Array<{ value: LeadQuickFilter; label: string }>;
  expandedLeadSummaries: Record<string, boolean>;
  expandedLeadMessages: Record<string, boolean>;
  formatPhone: (value: string | null | undefined) => string;
  getLeadKindLabel: (kind: LeadConversation["lead_kind"]) => string;
  getChannelLabel: (channelType: LeadConversation["channel_type"]) => string;
  getSummaryStatusLabel: (status: LeadConversation["summary_status"]) => string;
  formatDateTime: (value: string | null | undefined) => string;
  onSummarizeLeads: () => void;
  onRefreshLeads: () => void;
  onExportLeads: () => void;
  onLeadStageFilterChange: (value: "all" | "hot" | "warm" | "cold") => void;
  onLeadKindFilterChange: (value: LeadKindFilter) => void;
  onLeadChannelFilterChange: (value: LeadChannelFilter) => void;
  onLeadTodayOnlyChange: (value: boolean) => void;
  onLeadRequiresReplyOnlyChange: (value: boolean) => void;
  onLeadQuickFilterToggle: (value: LeadQuickFilter) => void;
  onLeadQuickFilterSelect: (value: LeadQuickFilter) => void;
  onToggleLeadSummary: (leadId: string) => void;
  onToggleLeadMessage: (leadId: string) => void;
  onOpenLeadChat: (leadId: string) => void;
}

export function LeadsTab(props: LeadsTabProps) {
  const {
    summarizingLeads,
    leadsLoading,
    leads,
    leadStageFilter,
    leadKindFilter,
    leadChannelFilter,
    leadTodayOnly,
    leadRequiresReplyOnly,
    leadQuickFilter,
    leadHighlights,
    quickFilterOptions,
    expandedLeadSummaries,
    expandedLeadMessages,
    formatPhone,
    getLeadKindLabel,
    getChannelLabel,
    getSummaryStatusLabel,
    formatDateTime,
    onSummarizeLeads,
    onRefreshLeads,
    onExportLeads,
    onLeadStageFilterChange,
    onLeadKindFilterChange,
    onLeadChannelFilterChange,
    onLeadTodayOnlyChange,
    onLeadRequiresReplyOnlyChange,
    onLeadQuickFilterToggle,
    onLeadQuickFilterSelect,
    onToggleLeadSummary,
    onToggleLeadMessage,
    onOpenLeadChat
  } = props;

  return (
    <section className="finance-shell">
      <article className="finance-panel">
        <div className="kb-toolbar">
          <h2>All Leads</h2>
          <div className="header-actions">
            <button
              className="primary-btn"
              type="button"
              onClick={onSummarizeLeads}
              disabled={summarizingLeads || leadsLoading}
            >
              {summarizingLeads ? "Summarizing..." : "Summarize All"}
            </button>
            <button className="ghost-btn" type="button" onClick={onRefreshLeads} disabled={leadsLoading}>
              {leadsLoading ? "Refreshing..." : "Refresh"}
            </button>
            <button className="ghost-btn" type="button" onClick={onExportLeads}>
              Export Excel
            </button>
            <select value={leadStageFilter} onChange={(event) => onLeadStageFilterChange(event.target.value as "all" | "hot" | "warm" | "cold")}>
              <option value="all">All stages</option>
              <option value="hot">Hot</option>
              <option value="warm">Warm</option>
              <option value="cold">Cold</option>
            </select>
            <select value={leadKindFilter} onChange={(event) => onLeadKindFilterChange(event.target.value as LeadKindFilter)}>
              <option value="all">All types</option>
              <option value="lead">Lead</option>
              <option value="feedback">Feedback</option>
              <option value="complaint">Complaint</option>
              <option value="other">Other</option>
            </select>
            <select
              value={leadChannelFilter}
              onChange={(event) => onLeadChannelFilterChange(event.target.value as LeadChannelFilter)}
            >
              <option value="all">All channels</option>
              <option value="web">Web</option>
              <option value="qr">WhatsApp QR</option>
              <option value="api">WhatsApp API</option>
            </select>
            <label className="lead-toggle-filter">
              <input
                type="checkbox"
                checked={leadTodayOnly}
                onChange={(event) => onLeadTodayOnlyChange(event.target.checked)}
              />
              Today only
            </label>
            <label className="lead-toggle-filter">
              <input
                type="checkbox"
                checked={leadRequiresReplyOnly}
                onChange={(event) => onLeadRequiresReplyOnlyChange(event.target.checked)}
              />
              Must reply
            </label>
          </div>
        </div>
        <div className="lead-highlight-grid">
          <button
            type="button"
            className={leadQuickFilter === "today_hot" ? "lead-highlight-card active" : "lead-highlight-card"}
            onClick={() => onLeadQuickFilterToggle("today_hot")}
          >
            <strong>{leadHighlights.todayHot}</strong>
            <span>Today's Hot Leads</span>
          </button>
          <button
            type="button"
            className={leadQuickFilter === "today_warm" ? "lead-highlight-card active" : "lead-highlight-card"}
            onClick={() => onLeadQuickFilterToggle("today_warm")}
          >
            <strong>{leadHighlights.todayWarm}</strong>
            <span>Today's Warm Leads</span>
          </button>
          <button
            type="button"
            className={leadQuickFilter === "today_complaint" ? "lead-highlight-card active" : "lead-highlight-card"}
            onClick={() => onLeadQuickFilterToggle("today_complaint")}
          >
            <strong>{leadHighlights.todayComplaints}</strong>
            <span>Today's Complaints</span>
          </button>
          <button
            type="button"
            className={leadQuickFilter === "needs_reply" ? "lead-highlight-card active" : "lead-highlight-card"}
            onClick={() => onLeadQuickFilterToggle("needs_reply")}
          >
            <strong>{leadHighlights.mustReply}</strong>
            <span>Must Reply</span>
          </button>
        </div>
        <div className="lead-quick-filter-row">
          {quickFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={leadQuickFilter === option.value ? "active" : ""}
              onClick={() => onLeadQuickFilterSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {leadsLoading && <p className="tiny-note">Refreshing leads...</p>}
        {summarizingLeads && (
          <p className="tiny-note">Generating summaries for all missing or outdated leads.</p>
        )}
        {leads.length === 0 ? (
          <p className="empty-note">No leads found for the selected filter.</p>
        ) : (
          <div className="finance-table-wrap leads-table-wrap">
            <table className="finance-table leads-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Type</th>
                  <th>Stage</th>
                  <th>Score</th>
                  <th>Channel</th>
                  <th>Assigned Agent</th>
                  <th>Reply</th>
                  <th>AI Summary</th>
                  <th>Last Message</th>
                  <th>Last Activity</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const leadStageClass =
                    lead.stage === "hot" || lead.stage === "warm" || lead.stage === "cold" ? lead.stage : "cold";
                  const summaryText =
                    lead.ai_summary ||
                    (lead.summary_status === "missing"
                      ? "No summary yet. Click Summarize All."
                      : "Summary is outdated. Click Summarize All.");
                  const lastMessageText = lead.last_message || "-";
                  const summaryExpanded = Boolean(expandedLeadSummaries[lead.id]);
                  const messageExpanded = Boolean(expandedLeadMessages[lead.id]);
                  const showSummaryToggle = summaryText.length > 140;
                  const showMessageToggle = lead.last_message ? lead.last_message.length > 90 : false;

                  return (
                    <tr key={lead.id}>
                      <td className="lead-name">{lead.contact_name || "Unknown"}</td>
                      <td className="lead-phone">{formatPhone(lead.contact_phone || lead.phone_number)}</td>
                      <td>
                        <span className={`lead-kind ${lead.lead_kind}`}>{getLeadKindLabel(lead.lead_kind)}</span>
                      </td>
                      <td>
                        <span className={`lead-stage ${leadStageClass}`}>{lead.stage}</span>
                      </td>
                      <td className="lead-score">{lead.score}</td>
                      <td>{getChannelLabel(lead.channel_type)}</td>
                      <td>{lead.assigned_agent_name || "Auto"}</td>
                      <td>
                        <span className={lead.requires_reply ? "lead-reply-pill yes" : "lead-reply-pill no"}>
                          {lead.requires_reply ? "You must reply" : "Normal"}
                        </span>
                      </td>
                      <td className="lead-summary-cell">
                        <span className={`summary-status ${lead.summary_status}`}>
                          {getSummaryStatusLabel(lead.summary_status)}
                        </span>
                        <p
                          className={summaryExpanded ? "lead-summary-text expanded" : "lead-summary-text"}
                          title={summaryText}
                        >
                          {summaryText}
                        </p>
                        {showSummaryToggle && (
                          <button
                            type="button"
                            className="lead-expand-btn"
                            onClick={() => onToggleLeadSummary(lead.id)}
                          >
                            {summaryExpanded ? "Less" : "More"}
                          </button>
                        )}
                        <small className="lead-summary-time">
                          Updated: {formatDateTime(lead.summary_updated_at)}
                        </small>
                      </td>
                      <td className="lead-last-message">
                        <p
                          className={messageExpanded ? "lead-last-message-text expanded" : "lead-last-message-text"}
                          title={lastMessageText}
                        >
                          {lastMessageText}
                        </p>
                        {showMessageToggle && (
                          <button
                            type="button"
                            className="lead-expand-btn"
                            onClick={() => onToggleLeadMessage(lead.id)}
                          >
                            {messageExpanded ? "Less" : "More"}
                          </button>
                        )}
                      </td>
                      <td>{formatDateTime(lead.last_message_at)}</td>
                      <td>
                        <button className="ghost-btn" type="button" onClick={() => onOpenLeadChat(lead.id)}>
                          Open Chat
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
