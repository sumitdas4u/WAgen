const dashboardBootstrapRoot = ["dashboard", "bootstrap"] as const;
const dashboardInboxRoot = ["dashboard", "inbox"] as const;
const dashboardLeadsRoot = ["dashboard", "leads"] as const;
const dashboardAgentsRoot = ["dashboard", "agents"] as const;
const dashboardSettingsRoot = ["dashboard", "settings"] as const;
const dashboardReviewRoot = ["dashboard", "studio", "review"] as const;
const dashboardKnowledgeRoot = ["dashboard", "studio", "knowledge"] as const;
const dashboardBillingRoot = ["dashboard", "billing"] as const;
const dashboardTemplatesRoot = ["dashboard", "templates"] as const;

export const dashboardQueryKeys = {
  bootstrap: dashboardBootstrapRoot,
  inboxRoot: dashboardInboxRoot,
  inboxConversations: (filters: Record<string, string | boolean>) =>
    [...dashboardInboxRoot, "conversations", filters] as const,
  inboxMessages: (conversationId: string) => [...dashboardInboxRoot, "messages", conversationId] as const,
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
  templates: [...dashboardTemplatesRoot, "list"] as const
};
