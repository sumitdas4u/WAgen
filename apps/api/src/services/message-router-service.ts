import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  handleFlowMessage,
  advanceFlowAfterAiReply,
  getActiveAiReplyContextNote
} from "./flow-engine-service.js";
import { buildSalesReply } from "./ai-reply-service.js";
import { resolveAgentProfileForChannel } from "./agent-profile-service.js";
import { isAgentSenderPhone } from "./agent-loop-guard-service.js";
import {
  queueAiFailureForReview,
  queueFlowIssueForReview,
  queueNegativeFeedbackForReview
} from "./ai-review-service.js";
import {
  getConversationHistoryForPrompt,
  setConversationAIPaused,
  setConversationManualAndPaused,
  trackInboundMessage
} from "./conversation-service.js";
import {
  detectMarketingUnsubscribe,
  markContactInboundActivity,
  unsubscribeContactMarketingByPhone
} from "./contacts-service.js";
import { detectExternalBotLoop } from "./external-bot-detector-service.js";
import { sendConversationFlowMessage } from "./channel-outbound-service.js";
import { getActiveFlowSession } from "./flow-service.js";
import { upsertRecipientSuppression } from "./message-delivery-data-service.js";
import type { FlowMessagePayload } from "./outbound-message-types.js";
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
  flowMessageText?: string | null;
  senderName?: string;
  shouldAutoReply?: boolean;
  mediaUrl?: string | null;
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
    | "insufficient_credits"
    | "flow_error"
    | "no_matching_flow";
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

async function getLatestConversationState(
  conversationId: string,
  fallback: { score: number; stage: string }
): Promise<{ score: number; stage: string }> {
  const refreshed = await pool.query<{ score: number; stage: string }>(
    `SELECT score, stage
     FROM conversations
     WHERE id = $1
     LIMIT 1`,
    [conversationId]
  );
  return refreshed.rows[0] ?? fallback;
}

export async function processIncomingMessage(
  input: ProcessIncomingMessageInput
): Promise<ProcessIncomingMessageResult> {
  const normalizedMessage = input.messageText.trim();
  const normalizedFlowMessage = input.flowMessageText?.trim() || normalizedMessage;
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
      channelLinkedNumber: input.channelLinkedNumber ?? null,
      mediaUrl: input.mediaUrl ?? null
    }
  );
  await markContactInboundActivity(input.userId, input.customerIdentifier);

  const unsubscribeKeyword = detectMarketingUnsubscribe(normalizedMessage);
  if (unsubscribeKeyword) {
    const unsubscribedContact = await unsubscribeContactMarketingByPhone({
      userId: input.userId,
      phoneNumber: input.customerIdentifier,
      source: `inbound:${unsubscribeKeyword}`
    });
    await upsertRecipientSuppression({
      userId: input.userId,
      phoneNumber: input.customerIdentifier,
      contactId: unsubscribedContact?.id ?? null,
      reason: "opt_out",
      source: "manual",
      metadata: {
        conversationId: conversation.id,
        keyword: unsubscribeKeyword
      }
    });
  }

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

  let latestConversationState = {
    score: conversation.score,
    stage: conversation.stage
  };
  const sendTrackedFlowReply = async (payload: FlowMessagePayload) => {
    await sendConversationFlowMessage({
      userId: input.userId,
      conversationId: conversation.id,
      payload
    });
  };

  // ── Credits gate ─────────────────────────────────────────────────────────────
  const creditDecision = await evaluateConversationCredit({
    userId: input.userId,
    customerIdentifier: input.customerIdentifier,
    channelType: input.channelType
  });
  if (!creditDecision.allowed) {
    const pausedMessage = creditDecision.blockMessage ?? "Replies paused. Please upgrade your plan.";
    await sendConversationFlowMessage({
      userId: input.userId,
      conversationId: conversation.id,
      payload: { type: "text", text: pausedMessage }
    });
    latestConversationState = await getLatestConversationState(conversation.id, latestConversationState);
    return {
      conversationId: conversation.id,
      stage: latestConversationState.stage,
      score: latestConversationState.score,
      autoReplySent: true,
      reason: "insufficient_credits"
    };
  }

  // ── Bot-loop detection (before flow runs) ────────────────────────────────────
  if (isBotLoopProtectedChannel(input.channelType)) {
    const activeFlowSession = await getActiveFlowSession(conversation.id);
    if (!activeFlowSession) {
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

  // ── Flow engine runs regardless of manual_takeover/ai_paused ─────────────────
  // A flow assigned to this conversation always gets to respond.
  // manual_takeover only blocks the AI fallback below.
  const flowResult: import("./flow-engine-service.js").FlowHandleResult =
    await handleFlowMessage({
      userId: input.userId,
      conversationId: conversation.id,
      channelType: input.channelType,
      message: normalizedFlowMessage,
      sendReply: sendTrackedFlowReply
    });

  if (flowResult.result === "handled") {
    return {
      conversationId: conversation.id,
      stage: latestConversationState.stage,
      score: latestConversationState.score,
      autoReplySent: true,
      reason: "sent"
    };
  }

  if (flowResult.result === "failed") {
    try {
      const reviewResult = await queueFlowIssueForReview({
        userId: input.userId,
        conversationId: conversation.id,
        customerPhone: input.customerIdentifier,
        messageText: normalizedFlowMessage,
        issue: "flow_execution_failed",
        details:
          "Flow execution failed while continuing this conversation. Check the flow session, node wiring, and runtime logs."
      });
      console.warn(
        `[Router] flow execution failed user=${input.userId} conversation=${conversation.id} reviewQueued=${reviewResult.queued} itemId=${reviewResult.itemId ?? "none"}`
      );
      return {
        conversationId: conversation.id,
        stage: latestConversationState.stage,
        score: latestConversationState.score,
        autoReplySent: false,
        reason: "flow_error"
      };
    } catch (error) {
      console.warn(
        `[Router] flow issue queue failed user=${input.userId} conversation=${conversation.id}`,
        error
      );
      return {
        conversationId: conversation.id,
        stage: latestConversationState.stage,
        score: latestConversationState.score,
        autoReplySent: false,
        reason: "flow_error"
      };
    }
  }

  if (flowResult.result === "not_matched") {
    // Default: silence. No reply goes out unless a flow (or default reply flow) handled the message.
    return {
      conversationId: conversation.id,
      stage: latestConversationState.stage,
      score: latestConversationState.score,
      autoReplySent: false,
      reason: "no_matching_flow"
    };
  }

  // ── AI gate — only runs when a flow explicitly requests it via use_ai ────────
  // Any other result (not_matched, handled, failed) returns before reaching here.
  // Manual-takeover / ai_paused → agent is handling; skip AI.
  if (conversation.manual_takeover) {
    console.log(`[Router] Manual takeover — skipping AI reply (conversation=${conversation.id})`);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "manual_takeover"
    };
  }

  if (conversation.ai_paused) {
    console.log(`[Router] AI paused — skipping AI reply (conversation=${conversation.id})`);
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      score: conversation.score,
      autoReplySent: false,
      reason: "conversation_paused"
    };
  }

  // At this point flowResult.result === "use_ai" — AI was explicitly requested by the flow.
  // Cooldown is intentionally skipped: when a flow requests AI, it should always fire.

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
    history,
    flowContextNote:
      flowResult.result === "use_ai"
        ? await getActiveAiReplyContextNote(conversation.id)
        : null
  });

  await sendConversationFlowMessage({
    userId: input.userId,
    conversationId: conversation.id,
    payload: { type: "text", text: reply.text },
    usage: {
      promptTokens: reply.usage?.promptTokens,
      completionTokens: reply.usage?.completionTokens,
      totalTokens: reply.usage?.totalTokens,
      aiModel: reply.model,
      retrievalChunks: reply.retrievalChunks,
      markAsAiReply: true
    }
  });
  latestConversationState = await getLatestConversationState(conversation.id, latestConversationState);

  // If flow is in one-shot aiReply mode, advance to the next node after AI replied
  if (flowResult.result === "use_ai") {
    await advanceFlowAfterAiReply(conversation.id, sendTrackedFlowReply);
  }

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

  return {
    conversationId: conversation.id,
    stage: latestConversationState.stage,
    score: latestConversationState.score,
    autoReplySent: true,
    reason: "sent"
  };
}
