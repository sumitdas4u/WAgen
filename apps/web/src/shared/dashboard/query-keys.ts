const dashboardBootstrapRoot = ["dashboard", "bootstrap"] as const;
const dashboardInboxRoot = ["dashboard", "inbox"] as const;
const dashboardContactsRoot = ["dashboard", "contacts"] as const;
const dashboardLeadsRoot = ["dashboard", "leads"] as const;
const dashboardAgentsRoot = ["dashboard", "agents"] as const;
const dashboardSettingsRoot = ["dashboard", "settings"] as const;
const dashboardReviewRoot = ["dashboard", "studio", "review"] as const;
const dashboardKnowledgeRoot = ["dashboard", "studio", "knowledge"] as const;
const dashboardBillingRoot = ["dashboard", "billing"] as const;
const dashboardTemplatesRoot = ["dashboard", "templates"] as const;
const dashboardCampaignsRoot = ["dashboard", "campaigns"] as const;
const dashboardContactFieldsRoot = ["dashboard", "contact-fields"] as const;
const dashboardContactSegmentsRoot = ["dashboard", "contact-segments"] as const;
const dashboardAnalyticsRoot = ["dashboard", "analytics"] as const;
const dashboardBroadcastRoot = ["dashboard", "broadcast"] as const;
const dashboardWebhooksRoot = ["dashboard", "webhooks"] as const;

export const dashboardQueryKeys = {
  bootstrap: dashboardBootstrapRoot,
  inboxRoot: dashboardInboxRoot,
  inboxConversations: (filters: Record<string, string | boolean>) =>
    [...dashboardInboxRoot, "conversations", filters] as const,
  inboxMessages: (conversationId: string) => [...dashboardInboxRoot, "messages", conversationId] as const,
  inboxNotes: (conversationId: string) => [...dashboardInboxRoot, "notes", conversationId] as const,
  inboxPublishedFlows: [...dashboardInboxRoot, "published-flows"] as const,
  contactsRoot: dashboardContactsRoot,
  contacts: (filters: Record<string, string | boolean>) => [...dashboardContactsRoot, filters] as const,
  leadsRoot: dashboardLeadsRoot,
  leads: (filters: Record<string, string | boolean>) => [...dashboardLeadsRoot, filters] as const,
  agentsRoot: dashboardAgentsRoot,
  agents: [...dashboardAgentsRoot, "profiles"] as const,
  settingsRoot: dashboardSettingsRoot,
  settingsMetaConfig: [...dashboardSettingsRoot, "meta-config"] as const,
  settingsMetaStatus: [...dashboardSettingsRoot, "meta-status"] as const,
  reviewRoot: dashboardReviewRoot,
  reviewQueue: (status: string) => [...dashboardReviewRoot, "queue", status] as const,
  reviewConversation: (conversationId: string) => [...dashboardReviewRoot, "conversation", conversationId] as const,
  knowledgeRoot: dashboardKnowledgeRoot,
  knowledgeSources: [...dashboardKnowledgeRoot, "sources"] as const,
  knowledgeChunks: (sourceType: string, sourceName: string) =>
    [...dashboardKnowledgeRoot, "chunks", sourceType, sourceName] as const,
  billingRoot: dashboardBillingRoot,
  templatesRoot: dashboardTemplatesRoot,
  templates: [...dashboardTemplatesRoot, "list"] as const,
  campaignsRoot: dashboardCampaignsRoot,
  campaigns: [...dashboardCampaignsRoot, "list"] as const,
  campaignMessages: (campaignId: string, status: string, page: number) =>
    [...dashboardCampaignsRoot, "messages", campaignId, status, page] as const,
  analyticsRoot: dashboardAnalyticsRoot,
  broadcastRoot: dashboardBroadcastRoot,
  broadcasts: [...dashboardBroadcastRoot, "list"] as const,
  broadcastSummary: [...dashboardBroadcastRoot, "summary"] as const,
  broadcastReport: (campaignId: string, status: string, page: number) =>
    [...dashboardBroadcastRoot, "report", campaignId, status, page] as const,
  broadcastRetargetPreview: (campaignId: string, status: string) =>
    [...dashboardBroadcastRoot, "retarget-preview", campaignId, status] as const,
  webhooksRoot: dashboardWebhooksRoot,
  webhookIntegration: [...dashboardWebhooksRoot, "integration"] as const,
  webhookWorkflows: [...dashboardWebhooksRoot, "workflows"] as const,
  webhookLogs: [...dashboardWebhooksRoot, "logs"] as const,
  deliverySummary: (days: number, channelKey: string) => [...dashboardAnalyticsRoot, "summary", days, channelKey] as const,
  deliveryNotifications: (days: number, channelKey: string, status: string, page: number) =>
    [...dashboardAnalyticsRoot, "notifications", days, channelKey, status, page] as const,
  deliveryFailures: (days: number, channelKey: string, page: number) =>
    [...dashboardAnalyticsRoot, "failures", days, channelKey, page] as const,
  deliveryConversations: (days: number, channelKey: string) =>
    [...dashboardAnalyticsRoot, "conversations", days, channelKey] as const,
  deliveryAlerts: (status: string) => [...dashboardAnalyticsRoot, "alerts", status] as const,
  contactFieldsRoot: dashboardContactFieldsRoot,
  contactFields: [...dashboardContactFieldsRoot, "list"] as const,
  contactSegmentsRoot: dashboardContactSegmentsRoot,
  contactSegments: [...dashboardContactSegmentsRoot, "list"] as const,
  segmentContacts: (segmentId: string) => [...dashboardContactSegmentsRoot, "contacts", segmentId] as const,
  contactByConversation: (conversationId: string) => [...dashboardContactFieldsRoot, "by-conversation", conversationId] as const
};
