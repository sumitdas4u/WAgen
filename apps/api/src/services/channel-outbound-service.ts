import { getConversationById, setConversationManualAndPaused, trackOutboundMessage } from "./conversation-service.js";
import { sendTrackedApiConversationFlowMessage } from "./message-delivery-service.js";
import {
  adaptPayloadForChannel,
  getPayloadMediaUrl,
  summarizeFlowMessage,
  type FlowDeliveryChannel,
  type FlowMessagePayload,
  validateFlowMessagePayload
} from "./outbound-message-types.js";
import { sendWidgetConversationMessage } from "./widget-chat-gateway-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";

function resolveDeliveryChannel(channelType: "web" | "qr" | "api"): FlowDeliveryChannel {
  if (channelType === "api") {
    return "api_whatsapp";
  }
  if (channelType === "qr") {
    return "baileys";
  }
  return "web";
}

export async function sendConversationFlowMessage(input: {
  userId: string;
  conversationId: string;
  payload: FlowMessagePayload;
  track?: boolean;
  mediaUrl?: string | null;
  displayText?: string;
  senderName?: string | null;
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

  const canonicalPayload = validateFlowMessagePayload(input.payload);
  const deliveryChannel = resolveDeliveryChannel(conversation.channel_type);
  const deliveryPayload = adaptPayloadForChannel(canonicalPayload, deliveryChannel);
  const summaryText = input.displayText ?? summarizeFlowMessage(deliveryPayload);
  if (!summaryText) {
    throw new Error("Message text is required.");
  }

  if (conversation.channel_type === "api") {
    await sendTrackedApiConversationFlowMessage({
      userId: input.userId,
      conversation,
      payload: deliveryPayload,
      summaryText,
      mediaUrl: input.mediaUrl ?? getPayloadMediaUrl(canonicalPayload) ?? null,
      senderName: input.senderName ?? null,
      track: input.track
    });
  } else if (conversation.channel_type === "qr") {
    await whatsappSessionManager.sendFlowMessage({
      userId: input.userId,
      phoneNumber: conversation.phone_number,
      payload: deliveryPayload
    });
  } else {
    const delivered = await sendWidgetConversationMessage({
      userId: input.userId,
      customerIdentifier: conversation.phone_number,
      text: summaryText
    });
    if (!delivered) {
      throw new Error("Web visitor is offline. History is still available, but replies can only be sent while the visitor is connected.");
    }
  }

  if (conversation.channel_type !== "api" && input.track !== false) {
    await trackOutboundMessage(
      conversation.id,
      summaryText,
      { senderName: input.senderName ?? null },
      input.mediaUrl ?? getPayloadMediaUrl(canonicalPayload) ?? null,
      canonicalPayload,
      null
    );
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
  senderName?: string | null;
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
    displayText,
    senderName: input.senderName ?? null
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
