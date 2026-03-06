import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { buildSalesReply } from "./ai-reply-service.js";
import { resolveAgentProfileForChannel } from "./agent-profile-service.js";
import { isAgentSenderPhone } from "./agent-loop-guard-service.js";
import { queueAiFailureForReview, queueNegativeFeedbackForReview } from "./ai-review-service.js";
import {
  getConversationHistoryForPrompt,
  setConversationAIPaused,
  setConversationManualAndPaused,
  trackInboundMessage,
  trackOutboundMessage
} from "./conversation-service.js";
import { detectExternalBotLoop } from "./external-bot-detector-service.js";
import { realtimeHub } from "./realtime-hub.js";
import { getUserById } from "./user-service.js";
import { evaluateConversationCredit } from "./workspace-billing-service.js";

type UnifiedChannelType = "web" | "qr" | "api";

export interface ProcessIncomingMessageInput {
  userId: string;
  channelType: UnifiedChannelType;
  channelLinkedNumber?: string | null;
  customerIdentifier: string;
  messageText: string;
  senderName?: string;
  shouldAutoReply?: boolean;
  sendReply?: (payload: { text: string }) => Promise<void>;
}

export interface ProcessIncomingMessageResult {
  conversationId: string;
  stage: string;
  score: number;
  autoReplySent: boolean;
  reason:
    | "sent"
    | "auto_reply_disabled"
    | "missing_user"
    | "ai_inactive"
    | "manual_takeover"
    | "conversation_paused"
    | "sender_is_agent_number"
    | "external_bot_detected"
    | "cooldown"
    | "missing_channel_adapter"
    | "insufficient_credits";
}

function normalizePhoneCandidate(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

function isBotLoopProtectedChannel(channelType: UnifiedChannelType): boolean {
  return channelType === "api" || channelType === "qr";
}

export async function processIncomingMessage(
  input: ProcessIncomingMessageInput
): Promise<ProcessIncomingMessageResult> {
  const normalizedMessage = input.messageText.trim();
  if (!normalizedMessage) {
    throw new Error("Message text is required.");
  }

  const conversation = await trackInboundMessage(
    input.userId,
    input.customerIdentifier,
    normalizedMessage,
    input.senderName,
    {
      channelType: input.channelType,
      channelLinkedNumber: input.channelLinkedNumber ?? null
    }
  );

  realtimeHub.broadcast(input.userId, "conversation.updated", {
    conversationId: conversation.id,
    phoneNumber: input.customerIdentifier,
    direction: "inbound",
    message: normalizedMessage,
    score: conversation.score,
    stage: conversation.stage
  });

  const phoneCandidate = normalizePhoneCandidate(input.customerIdentifier);
  if (isBotLoopProtectedChannel(input.channelType) && phoneCandidate && (await isAgentSenderPhone(phoneCandidate))) {
    await setConversationAIPaused(input.userId, conversation.id, true);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "sender_is_agent_number"
    };
  }

  if (conversation.manual_takeover) {
    console.log(`[Router] Conversation in manual takeover - no auto reply (conversation=${conversation.id})`);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "manual_takeover"
    };
  }

  if (conversation.ai_paused) {
    console.log(`[Router] AI paused for conversation - no auto reply (conversation=${conversation.id})`);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "conversation_paused"
    };
  }

  if (isBotLoopProtectedChannel(input.channelType)) {
    const detection = await detectExternalBotLoop(conversation.id, normalizedMessage);
    if (detection.flagged) {
      console.log(`[Router] External bot detected - marking conversation as manual+paused (conversation=${conversation.id})`);
      await setConversationManualAndPaused(input.userId, conversation.id);
      return {
        conversationId: conversation.id,
        stage: conversation.stage,
        score: conversation.score,
        autoReplySent: false,
        reason: "external_bot_detected"
      };
    }
  }

  try {
    await queueNegativeFeedbackForReview({
      userId: input.userId,
      conversationId: conversation.id,
      customerPhone: input.customerIdentifier,
      feedbackText: normalizedMessage
    });
  } catch (error) {
    console.warn(
      `[Router] negative-feedback queue failed user=${input.userId} conversation=${conversation.id}`,
      error
    );
  }

  if (!input.shouldAutoReply) {
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "auto_reply_disabled"
    };
  }

  const user = await getUserById(input.userId);
  if (!user) {
    console.log(`[Router] User not found (userId=${input.userId})`);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "missing_user"
    };
  }

  if (!user.ai_active) {
    console.log(`[Router] AI not active for user (userId=${input.userId})`);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "ai_inactive"
    };
  }

  if (conversation.last_ai_reply_at) {
    const elapsedSeconds = (Date.now() - new Date(conversation.last_ai_reply_at).getTime()) / 1000;
    if (elapsedSeconds < env.CONTACT_COOLDOWN_SECONDS) {
      console.log(`[Router] Cooldown active - only ${Math.round(elapsedSeconds)}s elapsed, need ${env.CONTACT_COOLDOWN_SECONDS}s (conversation=${conversation.id})`);
      return {
        conversationId: conversation.id,
        stage: conversation.stage,
        score: conversation.score,
        autoReplySent: false,
        reason: "cooldown"
      };
    }
  }

  if (!input.sendReply) {
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "missing_channel_adapter"
    };
  }

  const creditDecision = await evaluateConversationCredit({
    userId: input.userId,
    customerIdentifier: input.customerIdentifier,
    channelType: input.channelType
  });
  if (!creditDecision.allowed) {
    const pausedMessage = creditDecision.blockMessage ?? "AI paused. Please upgrade plan.";
    await input.sendReply({ text: pausedMessage });
    await trackOutboundMessage(conversation.id, pausedMessage);

    realtimeHub.broadcast(input.userId, "conversation.updated", {
      conversationId: conversation.id,
      phoneNumber: input.customerIdentifier,
      direction: "outbound",
      message: pausedMessage,
      score: conversation.score,
      stage: conversation.stage
    });

    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: true,
      reason: "insufficient_credits"
    };
  }

  const historyLimit = Math.max(16, Math.min(40, env.PROMPT_HISTORY_LIMIT * 4));
  const history = await getConversationHistoryForPrompt(conversation.id, historyLimit);
  const channelAgentProfile = await resolveAgentProfileForChannel(
    input.userId,
    input.channelType,
    input.channelLinkedNumber ?? null
  );
  const effectiveUser = channelAgentProfile
    ? {
        ...user,
        business_basics: {
          ...channelAgentProfile.businessBasics,
          agentObjectiveType: channelAgentProfile.objectiveType,
          agentTaskDescription: channelAgentProfile.taskDescription
        },
        personality: channelAgentProfile.personality,
        custom_personality_prompt: channelAgentProfile.customPrompt
      }
    : user;

  const reply = await buildSalesReply({
    user: effectiveUser,
    incomingMessage: normalizedMessage,
    conversationPhone: input.customerIdentifier,
    history
  });

  await input.sendReply({ text: reply.text });
  await trackOutboundMessage(conversation.id, reply.text, {
    promptTokens: reply.usage?.promptTokens,
    completionTokens: reply.usage?.completionTokens,
    totalTokens: reply.usage?.totalTokens,
    aiModel: reply.model,
    retrievalChunks: reply.retrievalChunks
  });

  try {
    const failureResult = await queueAiFailureForReview({
      userId: input.userId,
      conversationId: conversation.id,
      customerPhone: input.customerIdentifier,
      question: normalizedMessage,
      aiResponse: reply.text,
      retrievalChunks: reply.retrievalChunks
    });
    console.log(`[Router] AI failure review queued=${failureResult.queued}, signals=[${failureResult.signals.join(",")}], itemId=${failureResult.itemId ?? "none"}`);
  } catch (error) {
    console.warn(
      `[Router] ai-failure queue failed user=${input.userId} conversation=${conversation.id}`,
      error
    );
  }

  const refreshed = await pool.query<{ score: number; stage: string }>(
    `SELECT score, stage
     FROM conversations
     WHERE id = $1
     LIMIT 1`,
    [conversation.id]
  );
  const latest = refreshed.rows[0] ?? { score: conversation.score, stage: conversation.stage };

  realtimeHub.broadcast(input.userId, "conversation.updated", {
    conversationId: conversation.id,
    phoneNumber: input.customerIdentifier,
    direction: "outbound",
    message: reply.text,
    score: latest.score,
    stage: latest.stage
  });

  return {
    conversationId: conversation.id,
    stage: latest.stage,
    score: latest.score,
    autoReplySent: true,
    reason: "sent"
  };
}
