import {
  assignFlowToConversation,
  fetchConversationMessages,
  fetchConversations,
  fetchPublishedFlows,
  fetchTemplates,
  type PublishedFlowSummary,
  type MessageTemplate,
  sendConversationManualMessage,
  uploadConversationMedia,
  setConversationPaused,
  setManualTakeover,
  type Conversation,
  type ConversationMessage,
  API_URL
} from "../../../lib/api";

export async function fetchInboxConversations(token: string): Promise<Conversation[]> {
  const response = await fetchConversations(token);
  return response.conversations;
}

export async function fetchInboxMessages(token: string, conversationId: string): Promise<ConversationMessage[]> {
  const response = await fetchConversationMessages(token, conversationId);
  return response.messages;
}

export function fetchInboxPublishedFlows(token: string): Promise<PublishedFlowSummary[]> {
  return fetchPublishedFlows(token);
}

export function updateConversationAiMode(
  token: string,
  conversationId: string,
  paused: boolean
) {
  return Promise.all([
    setManualTakeover(token, conversationId, paused),
    setConversationPaused(token, conversationId, paused)
  ]);
}

export function sendManualConversationMessage(
  token: string,
  conversationId: string,
  text: string,
  mediaUrl?: string | null,
  mediaMimeType?: string | null
) {
  return sendConversationManualMessage(token, conversationId, text, { lockToManual: false, mediaUrl, mediaMimeType });
}

export function uploadInboxMedia(token: string, conversationId: string, file: File) {
  return uploadConversationMedia(token, conversationId, file);
}

export function assignInboxFlow(token: string, conversationId: string, flowId: string) {
  return assignFlowToConversation(token, flowId, conversationId);
}

export async function fetchInboxApprovedTemplates(token: string): Promise<MessageTemplate[]> {
  const res = await fetchTemplates(token, { status: "APPROVED" });
  return res.templates;
}

export async function aiAssistText(
  token: string,
  text: string,
  action: "rewrite" | "translate",
  language?: string
): Promise<{ text: string }> {
  const res = await fetch(`${API_URL}/api/ai-assist/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, action, language })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "AI assist failed" }));
    throw new Error((err as { error?: string }).error ?? "AI assist failed");
  }
  return res.json() as Promise<{ text: string }>;
}
