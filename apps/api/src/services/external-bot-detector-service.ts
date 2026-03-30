import { env } from "../config/env.js";
import {
  listRecentConversationMessages,
  type ConversationMessageSnapshot
} from "./conversation-service.js";

const DEFAULT_KEYWORDS = [
  "automated",
  "auto-reply",
  "auto reply",
  "do not reply",
  "this is an automated message",
  "virtual assistant",
  "chatbot",
  "bot"
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDetectionKeywords(): string[] {
  const raw = env.BOT_LOOP_DETECTION_KEYWORDS || DEFAULT_KEYWORDS.join(",");
  const parsed = raw
    .split(",")
    .map((item) => normalizeText(item))
    .filter((item) => item.length >= 2);

  if (parsed.length === 0) {
    return DEFAULT_KEYWORDS.map((item) => normalizeText(item));
  }
  return Array.from(new Set(parsed));
}

function hasTemplatePattern(text: string): boolean {
  const directOptionPattern = /(^|\n|\r)\s*\d{1,2}[.)]\s+\S+/i;
  const promptPattern = /\b(press|reply(?:\s+with)?|choose|select)\s+\d{1,2}\b/i;
  return directOptionPattern.test(text) || promptPattern.test(text);
}

function isLowSignalReply(text: string): boolean {
  if (!text) {
    return true;
  }

  if (/^\d{1,2}$/.test(text)) {
    return true;
  }

  const tokens = text.split(" ").filter(Boolean);
  if (text.length <= 3 && tokens.length <= 2) {
    return true;
  }

  return false;
}

function parseTimeMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getCurrentInboundAnchor(
  rows: ConversationMessageSnapshot[],
  inboundText: string
): { atMs: number; inboundRowsBefore: ConversationMessageSnapshot[] } {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.direction !== "inbound") {
      continue;
    }
    if (normalizeText(row.message_text) !== normalizeText(inboundText)) {
      continue;
    }
    return {
      atMs: parseTimeMs(row.created_at),
      inboundRowsBefore: rows.slice(0, index).filter((item) => item.direction === "inbound")
    };
  }

  const lastInboundIndex = [...rows]
    .map((row, idx) => ({ row, idx }))
    .reverse()
    .find((entry) => entry.row.direction === "inbound")?.idx;

  if (typeof lastInboundIndex === "number") {
    return {
      atMs: parseTimeMs(rows[lastInboundIndex].created_at),
      inboundRowsBefore: rows.slice(0, lastInboundIndex).filter((item) => item.direction === "inbound")
    };
  }

  return {
    atMs: Date.now(),
    inboundRowsBefore: rows.filter((item) => item.direction === "inbound")
  };
}

export async function detectExternalBotLoop(
  conversationId: string,
  inboundText: string
): Promise<{ flagged: boolean; signals: string[] }> {
  if (!env.BOT_LOOP_DETECTION_ENABLED) {
    return { flagged: false, signals: [] };
  }

  const rows = await listRecentConversationMessages(conversationId, 40);
  if (rows.length === 0) {
    return { flagged: false, signals: [] };
  }

  const signals: string[] = [];
  const normalizedInbound = normalizeText(inboundText);
  const keywords = getDetectionKeywords();
  const inboundAnchor = getCurrentInboundAnchor(rows, inboundText);

  const hasLexicon = keywords.some((keyword) => normalizedInbound.includes(keyword));
  if (hasLexicon) {
    signals.push("bot_lexicon");
  }

  const hasTemplateLikeText = hasTemplatePattern(inboundText);
  if (hasTemplateLikeText) {
    signals.push("template_pattern");
  }

  if (!hasLexicon && !hasTemplateLikeText && isLowSignalReply(normalizedInbound)) {
    return { flagged: false, signals: [] };
  }

  const previousOutbound = [...rows]
    .reverse()
    .find((row) => row.direction === "outbound" && parseTimeMs(row.created_at) <= inboundAnchor.atMs);
  if (previousOutbound) {
    const deltaSeconds = (inboundAnchor.atMs - parseTimeMs(previousOutbound.created_at)) / 1000;
    if (deltaSeconds >= 0 && deltaSeconds <= env.BOT_LOOP_QUICK_REPLY_SECONDS) {
      signals.push("quick_turnaround");
    }
  }

  if (normalizedInbound.length > 0) {
    const hasRepeatPayload = inboundAnchor.inboundRowsBefore.some((row) => {
      if (normalizeText(row.message_text) !== normalizedInbound) {
        return false;
      }
      const ageSeconds = (inboundAnchor.atMs - parseTimeMs(row.created_at)) / 1000;
      return ageSeconds >= 0 && ageSeconds <= env.BOT_LOOP_REPEAT_WINDOW_SECONDS;
    });
    if (hasRepeatPayload) {
      signals.push("repeat_payload");
    }
  }

  const uniqueSignals = Array.from(new Set(signals));
  const hasStrongSignal = uniqueSignals.includes("quick_turnaround") || uniqueSignals.includes("repeat_payload");
  const flagged = uniqueSignals.length >= 2 && hasStrongSignal;
  return { flagged, signals: uniqueSignals };
}
