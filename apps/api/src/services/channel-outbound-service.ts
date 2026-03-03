import { getConversationById, setConversationManualAndPaused, trackOutboundMessage } from "./conversation-service.js";
import { sendMetaTextDirect } from "./meta-whatsapp-service.js";
import { sendWidgetConversationMessage } from "./widget-chat-gateway-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";

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

  const conversation = await getConversationById(input.conversationId);
  if (!conversation || conversation.user_id !== input.userId) {
    throw new Error("Conversation not found.");
  }

  if (conversation.channel_type === "api") {
    await sendMetaTextDirect({
      userId: input.userId,
      to: conversation.phone_number,
      text: message,
      linkedNumber: conversation.channel_linked_number
    });
    await trackOutboundMessage(conversation.id, message);
  } else if (conversation.channel_type === "qr") {
    await whatsappSessionManager.sendManualMessage({
      userId: input.userId,
      phoneNumber: conversation.phone_number,
      text: message
    });
    await trackOutboundMessage(conversation.id, message);
  } else {
    const delivered = await sendWidgetConversationMessage({
      userId: input.userId,
      customerIdentifier: conversation.phone_number,
      text: message
    });
    if (!delivered) {
      throw new Error("Web visitor is offline.");
    }
    await trackOutboundMessage(conversation.id, message);
  }

  if (input.lockToManual !== false) {
    await setConversationManualAndPaused(input.userId, conversation.id);
  }

  return {
    conversationId: conversation.id,
    channelType: conversation.channel_type,
    delivered: true
  };
}
