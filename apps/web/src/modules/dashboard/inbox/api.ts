import {
  fetchConversationMessages,
  fetchConversations,
  sendConversationManualMessage,
  setConversationPaused,
  setManualTakeover,
  type Conversation,
  type ConversationMessage
} from "../../../lib/api";

export async function fetchInboxConversations(token: string): Promise<Conversation[]> {
  const response = await fetchConversations(token);
  return response.conversations;
}

export async function fetchInboxMessages(token: string, conversationId: string): Promise<ConversationMessage[]> {
  const response = await fetchConversationMessages(token, conversationId);
  return response.messages;
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

export function sendManualConversationMessage(token: string, conversationId: string, text: string) {
  return sendConversationManualMessage(token, conversationId, text, { lockToManual: false });
}
