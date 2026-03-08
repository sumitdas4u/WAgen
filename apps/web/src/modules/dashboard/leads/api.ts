import {
  fetchLeadConversations,
  summarizeLeadConversations,
  type LeadConversation
} from "../../../lib/api";

export interface LeadsFilters {
  stage?: "hot" | "warm" | "cold";
  kind?: "lead" | "feedback" | "complaint" | "other";
  channelType?: "web" | "qr" | "api";
  todayOnly?: boolean;
  requiresReply?: boolean;
}

export async function fetchLeads(token: string, filters: LeadsFilters): Promise<LeadConversation[]> {
  const response = await fetchLeadConversations(token, {
    limit: 500,
    stage: filters.stage,
    kind: filters.kind,
    channelType: filters.channelType,
    todayOnly: filters.todayOnly,
    requiresReply: filters.requiresReply
  });
  return response.leads;
}

export function summarizeLeads(token: string) {
  return summarizeLeadConversations(token, { limit: 500 });
}
