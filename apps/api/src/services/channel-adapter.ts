import type { FlowMessagePayload } from "./outbound-message-types.js";
import type { Conversation } from "../types/models.js";

export interface ChannelSendInput {
  userId: string;
  conversation: Conversation;
  payload: FlowMessagePayload;
  summaryText: string;
  mediaUrl: string | null;
  senderName: string | null;
  usage: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    aiModel?: string | null;
    retrievalChunks?: number | null;
    markAsAiReply?: boolean;
  };
}

export interface ChannelSendResult {
  messageId: string | null;
  /** true = adapter handled trackOutboundMessage itself; caller must skip it */
  tracked: boolean;
}

/**
 * Implement this interface and call registerChannelAdapter() to add a new
 * outbound channel (e.g. SMS, Instagram, email). The worker's
 * processConversationChannel() will route to the right adapter automatically.
 */
export interface ConversationChannelAdapter {
  readonly channelType: string;
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}

const registry = new Map<string, ConversationChannelAdapter>();

export function registerChannelAdapter(adapter: ConversationChannelAdapter): void {
  registry.set(adapter.channelType, adapter);
}

export function getChannelAdapter(channelType: string): ConversationChannelAdapter | undefined {
  return registry.get(channelType);
}
