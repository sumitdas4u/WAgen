import { queryOptions, useQuery } from "@tanstack/react-query";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { fetchReviewConversation, fetchReviewQueue } from "./api";

export function buildReviewQueueQueryOptions(token: string, status: "all" | "pending" | "resolved") {
  return queryOptions({
    queryKey: dashboardQueryKeys.reviewQueue(status),
    queryFn: () => fetchReviewQueue(token, status)
  });
}

export function useReviewQueueQuery(token: string, status: "all" | "pending" | "resolved") {
  return useQuery(buildReviewQueueQueryOptions(token, status));
}

export function buildReviewConversationQueryOptions(token: string, conversationId: string | null) {
  return queryOptions({
    queryKey: dashboardQueryKeys.reviewConversation(conversationId ?? "none"),
    queryFn: () => fetchReviewConversation(token, conversationId as string),
    enabled: Boolean(conversationId)
  });
}

export function useReviewConversationQuery(token: string, conversationId: string | null) {
  return useQuery(buildReviewConversationQueryOptions(token, conversationId));
}
