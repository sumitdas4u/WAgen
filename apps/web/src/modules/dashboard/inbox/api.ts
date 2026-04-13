import {
  assignFlowToConversation,
  createConversationNote,
  fetchConversationMessages,
  fetchConversationNotes,
  fetchConversations,
  fetchPublishedFlows,
  fetchTemplates,
  sendConversationTemplate,
  type PublishedFlowSummary,
  type MessageTemplate,
  sendConversationManualMessage,
  uploadConversationMedia,
  setConversationPaused,
  setManualTakeover,
  createOutboundConversation,
  markConversationRead,
  type Conversation,
  type ConversationNote,
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

export function markInboxConversationRead(token: string, conversationId: string) {
  return markConversationRead(token, conversationId);
}

export async function fetchInboxNotes(token: string, conversationId: string): Promise<ConversationNote[]> {
  const response = await fetchConversationNotes(token, conversationId);
  return response.notes;
}

export async function createInboxNote(token: string, conversationId: string, content: string): Promise<ConversationNote> {
  const response = await createConversationNote(token, conversationId, content);
  return response.note;
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

export async function fetchInboxApprovedTemplates(token: string, connectionId?: string | null): Promise<MessageTemplate[]> {
  const res = await fetchTemplates(token, { status: "APPROVED", connectionId: connectionId ?? undefined });
  return res.templates;
}

export function sendInboxConversationTemplate(
  token: string,
  conversationId: string,
  templateId: string,
  variableValues?: Record<string, string>
) {
  return sendConversationTemplate(token, conversationId, templateId, variableValues);
}

export function startOutboundConversation(
  token: string,
  contactId: string,
  channelType: "qr" | "api",
  connectionId?: string | null
): Promise<{ conversationId: string }> {
  return createOutboundConversation(token, contactId, channelType, connectionId ?? undefined);
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
