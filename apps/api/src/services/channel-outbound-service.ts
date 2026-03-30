import { getConversationById, setConversationManualAndPaused, trackOutboundMessage } from "./conversation-service.js";
import { sendMetaFlowMessageDirect } from "./meta-whatsapp-service.js";
import { summarizeFlowMessage, type FlowMessagePayload } from "./outbound-message-types.js";
import { sendWidgetConversationMessage } from "./widget-chat-gateway-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";

export async function sendConversationFlowMessage(input: {
  userId: string;
  conversationId: string;
  payload: FlowMessagePayload;
  track?: boolean;
}): Promise<{
  conversationId: string;
  channelType: "web" | "qr" | "api";
  delivered: boolean;
  summaryText: string;
}> {
  const conversation = await getConversationById(input.conversationId);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new Error("Conversation not found.");
  }

  const summaryText = summarizeFlowMessage(input.payload);
  if (!summaryText) {
    throw new Error("Message text is required.");
  }

  if (conversation.channel_type === "api") {
    await sendMetaFlowMessageDirect({
      userId: input.userId,
      to: conversation.phone_number,
      payload: input.payload,
      linkedNumber: conversation.channel_linked_number
    });
  } else if (conversation.channel_type === "qr") {
    await whatsappSessionManager.sendFlowMessage({
      userId: input.userId,
      phoneNumber: conversation.phone_number,
      payload: input.payload
    });
  } else {
    const delivered = await sendWidgetConversationMessage({
      userId: input.userId,
      customerIdentifier: conversation.phone_number,
      text: summaryText
    });
    if (!delivered) {
      throw new Error("Web visitor is offline.");
    }
  }

  if (input.track !== false) {
    await trackOutboundMessage(conversation.id, summaryText);
  }

  return {
    conversationId: conversation.id,
    channelType: conversation.channel_type,
    delivered: true,
    summaryText
  };
}

export async function sendManualConversationMessage(input: {
  userId: string;
  conversationId: string;
  text: string;
  lockToManual?: boolean;
}): Promise<{ conversationId: string; channelType: "web" | "qr" | "api"; delivered: boolean }> {
  const message = input.text.trim();
  if (!message) {
    throw new Error("Message text is required.");
  }

  const delivered = await sendConversationFlowMessage({
    userId: input.userId,
    conversationId: input.conversationId,
    payload: {
      type: "text",
      text: message
    }
  });

  if (input.lockToManual !== false) {
    await setConversationManualAndPaused(input.userId, delivered.conversationId);
  }

  return {
    conversationId: delivered.conversationId,
    channelType: delivered.channelType,
    delivered: delivered.delivered
  };
}
