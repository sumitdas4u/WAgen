import {
  fetchAiReviewAuditLog,
  fetchAiReviewQueue,
  fetchConversationMessages,
  resolveAiReviewQueueItem,
  type AiReviewAuditLogItem,
  type AiReviewQueueItem,
  type ConversationMessage
} from "../../../../lib/api";

export async function fetchReviewQueue(token: string, status: "all" | "pending" | "resolved") {
  const response = await fetchAiReviewQueue(token, {
    status,
    limit: 300
  });
  return response.queue;
}

export async function fetchReviewConversation(token: string, conversationId: string): Promise<ConversationMessage[]> {
  const response = await fetchConversationMessages(token, conversationId, { limit: 50 });
  return response.messages;
}

export function resolveReviewItem(
  token: string,
  reviewId: string,
  payload: { resolutionAnswer?: string; addToKnowledgeBase?: boolean }
) {
  return resolveAiReviewQueueItem(token, reviewId, payload);
}

export async function fetchAuditLog(token: string, limit?: number) {
  const response = await fetchAiReviewAuditLog(token, { limit });
  return response.items;
}

export type { AiReviewAuditLogItem, AiReviewQueueItem, ConversationMessage };
