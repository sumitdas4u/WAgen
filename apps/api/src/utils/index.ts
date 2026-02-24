import type { WAMessage } from "@whiskeysockets/baileys";

function unwrapMessageContent(message: NonNullable<WAMessage["message"]>): NonNullable<WAMessage["message"]> {
  let current = message as Record<string, any>;

  while (current) {
    const next =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message?.protocolMessage?.editedMessage;

    if (!next) {
      break;
    }

    current = next as Record<string, any>;
  }

  return current as NonNullable<WAMessage["message"]>;
}

export function getMessageText(message: WAMessage): string {
  const content = message.message ? unwrapMessageContent(message.message) : null;
  if (!content) {
    return "";
  }

  const candidates = [
    content.conversation,
    content.extendedTextMessage?.text,
    content.imageMessage?.caption,
    content.videoMessage?.caption,
    content.documentMessage?.caption,
    content.buttonsResponseMessage?.selectedDisplayText,
    content.buttonsResponseMessage?.selectedButtonId,
    content.templateButtonReplyMessage?.selectedDisplayText,
    content.templateButtonReplyMessage?.selectedId,
    content.listResponseMessage?.title,
    content.listResponseMessage?.singleSelectReply?.selectedRowId,
    content.interactiveResponseMessage?.body?.text,
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return "";
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
