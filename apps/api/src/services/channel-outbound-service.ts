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
  mediaUrl?: string | null;
  displayText?: string;
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

  const summaryText = input.displayText ?? summarizeFlowMessage(input.payload);
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
    await trackOutboundMessage(conversation.id, summaryText, undefined, input.mediaUrl ?? null, input.payload);
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
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
}): Promise<{ conversationId: string; channelType: "web" | "qr" | "api"; delivered: boolean }> {
  const message = input.text.trim();
  if (!message && !input.mediaUrl) {
    throw new Error("Message text or media is required.");
  }

  const isImage = input.mediaMimeType ? input.mediaMimeType.startsWith("image/") : false;
  const isVideo = input.mediaMimeType ? input.mediaMimeType.startsWith("video/") : false;
  const isAudio = input.mediaMimeType ? input.mediaMimeType.startsWith("audio/") : false;

  let payload: Parameters<typeof sendConversationFlowMessage>[0]["payload"];

  if (input.mediaUrl) {
    const absoluteUrl = input.mediaUrl.startsWith("/")
      ? `${process.env.APP_BASE_URL ?? ""}${input.mediaUrl}`
      : input.mediaUrl;

    if (isImage) {
      payload = { type: "media", mediaType: "image", url: absoluteUrl, caption: message || undefined };
    } else if (isVideo) {
      payload = { type: "media", mediaType: "video", url: absoluteUrl, caption: message || undefined };
    } else if (isAudio) {
      payload = { type: "media", mediaType: "audio", url: absoluteUrl };
    } else {
      // document / other file
      payload = { type: "media", mediaType: "document", url: absoluteUrl, caption: message || undefined };
    }
  } else {
    payload = { type: "text", text: message };
  }

  const displayText = message || (input.mediaUrl ? "📎 Attachment" : "");

  const delivered = await sendConversationFlowMessage({
    userId: input.userId,
    conversationId: input.conversationId,
    payload,
    mediaUrl: input.mediaUrl ?? null,
    displayText
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
