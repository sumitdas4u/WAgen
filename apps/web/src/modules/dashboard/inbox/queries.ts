import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import {
  fetchInboxApprovedTemplates,
  fetchInboxConversationsPage,
  fetchInboxMessagesPage,
  fetchInboxNotes,
  fetchInboxPublishedFlows
} from "./api";

const INBOX_CONVERSATION_PAGE_SIZE = 20;
const INBOX_MESSAGE_PAGE_SIZE = 5;

export function buildInboxConversationsInfiniteQueryOptions(
  token: string,
  filters: { folder: string; search: string }
) {
  return infiniteQueryOptions({
    queryKey: dashboardQueryKeys.inboxConversations(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInboxConversationsPage(token, {
        limit: INBOX_CONVERSATION_PAGE_SIZE,
        cursor: pageParam,
        search: filters.search
      }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined)
  });
}

export function useInboxConversationsInfiniteQuery(
  token: string,
  filters: { folder: string; search: string }
) {
  return useInfiniteQuery(buildInboxConversationsInfiniteQueryOptions(token, filters));
}

export function buildInboxMessagesInfiniteQueryOptions(token: string, conversationId: string | null) {
  return infiniteQueryOptions({
    queryKey: dashboardQueryKeys.inboxMessages(conversationId ?? "none"),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchInboxMessagesPage(token, conversationId as string, {
        limit: INBOX_MESSAGE_PAGE_SIZE,
        before: pageParam
      }),
    enabled: Boolean(conversationId),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined)
  });
}

export function useInboxMessagesInfiniteQuery(token: string, conversationId: string | null) {
  return useInfiniteQuery(buildInboxMessagesInfiniteQueryOptions(token, conversationId));
}

export function buildInboxNotesQueryOptions(token: string, conversationId: string | null) {
  return queryOptions({
    queryKey: dashboardQueryKeys.inboxNotes(conversationId ?? "none"),
    queryFn: () => fetchInboxNotes(token, conversationId as string),
    enabled: Boolean(conversationId)
  });
}

export function useInboxNotesQuery(token: string, conversationId: string | null) {
  return useQuery(buildInboxNotesQueryOptions(token, conversationId));
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

export function useInboxTemplatesQuery(token: string, connectionId?: string | null) {
  return useQuery({
    queryKey: ["inbox", "approvedTemplates", connectionId ?? "all"],
    queryFn: () => fetchInboxApprovedTemplates(token, connectionId),
    staleTime: 60_000
  });
}
