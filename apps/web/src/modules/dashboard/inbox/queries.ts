import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { fetchInboxConversations, fetchInboxMessages, fetchInboxPublishedFlows } from "./api";

export function buildInboxConversationsQueryOptions(
  token: string,
  filters: { folder: string; search: string }
) {
  return queryOptions({
    queryKey: dashboardQueryKeys.inboxConversations(filters),
    queryFn: () => fetchInboxConversations(token)
  });
}

export function useInboxConversationsQuery(
  token: string,
  filters: { folder: string; search: string }
) {
  return useQuery(buildInboxConversationsQueryOptions(token, filters));
}

export function buildInboxMessagesQueryOptions(token: string, conversationId: string | null) {
  return queryOptions({
    queryKey: dashboardQueryKeys.inboxMessages(conversationId ?? "none"),
    queryFn: () => fetchInboxMessages(token, conversationId as string),
    enabled: Boolean(conversationId)
  });
}

export function useInboxMessagesQuery(token: string, conversationId: string | null) {
  return useQuery(buildInboxMessagesQueryOptions(token, conversationId));
}

export function buildInboxPublishedFlowsQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.inboxPublishedFlows,
    queryFn: () => fetchInboxPublishedFlows(token)
  });
}

export function useInboxPublishedFlowsQuery(token: string) {
  return useQuery(buildInboxPublishedFlowsQueryOptions(token));
}
