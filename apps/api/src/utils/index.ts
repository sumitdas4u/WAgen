import type { WAMessage } from "@whiskeysockets/baileys";
import type { CapturedLocationInput } from "../services/flow-input-codec.js";

export function unwrapMessageContent(message: NonNullable<WAMessage["message"]>): NonNullable<WAMessage["message"]> {
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

export function extractMessageLocationPayload(message: WAMessage): CapturedLocationInput | null {
  const content = message.message ? unwrapMessageContent(message.message) : null;
  if (!content) {
    return null;
  }

  const location =
    content.locationMessage ??
    content.liveLocationMessage;

  if (!location) {
    return null;
  }

  const latitude = Number(location.degreesLatitude);
  const longitude = Number(location.degreesLongitude);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return null;
  }

  const name = String((location as { name?: string | null }).name ?? "").trim();
  const address =
    String((location as { address?: string | null; caption?: string | null; comment?: string | null }).address ?? "").trim() ||
    String((location as { caption?: string | null }).caption ?? "").trim() ||
    String((location as { comment?: string | null }).comment ?? "").trim();
  const url = String((location as { url?: string | null }).url ?? "").trim();

  return {
    latitude,
    longitude,
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
    ...(url ? { url } : {}),
    source: "native"
  };
}

export function getMessageText(message: WAMessage): string {
  const content = message.message ? unwrapMessageContent(message.message) : null;
  if (!content) {
    return "";
  }

  const joinCandidateParts = (parts: Array<unknown>): string => {
    const seen = new Set<string>();
    const values: string[] = [];

    for (const part of parts) {
      if (typeof part !== "string") {
        continue;
      }

      const trimmed = part.trim();
      const dedupeKey = trimmed.toLowerCase();
      if (!trimmed || seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      values.push(trimmed);
    }

    return values.join(" ").trim();
  };

  const extractNativeFlowResponseText = (paramsJson: unknown): string => {
    if (typeof paramsJson !== "string" || !paramsJson.trim()) {
      return "";
    }

    try {
      const parsed = JSON.parse(paramsJson) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return paramsJson.trim();
      }

      const priorityKeys = [
        "selectedId",
        "selected_id",
        "selectedRowId",
        "selected_row_id",
        "selectedButtonId",
        "selected_button_id",
        "id",
        "rowId",
        "row_id",
        "buttonId",
        "button_id",
        "title",
        "buttonTitle",
        "displayText",
        "display_text",
        "text",
        "description"
      ];

      const collected: string[] = [];
      const visit = (value: unknown, depth = 0): void => {
        if (!value || depth > 5) {
          return;
        }

        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) {
            collected.push(trimmed);
          }
          return;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            visit(item, depth + 1);
          }
          return;
        }

        if (typeof value !== "object") {
          return;
        }

        const record = value as Record<string, unknown>;
        for (const key of priorityKeys) {
          if (key in record) {
            visit(record[key], depth + 1);
          }
        }
      };

      visit(parsed);
      return joinCandidateParts(collected) || paramsJson.trim();
    } catch {
      return paramsJson.trim();
    }
  };

  const buttonsResponseText = joinCandidateParts([
    content.buttonsResponseMessage?.selectedDisplayText,
    content.buttonsResponseMessage?.selectedButtonId
  ]);
  const templateButtonResponseText = joinCandidateParts([
    content.templateButtonReplyMessage?.selectedDisplayText,
    content.templateButtonReplyMessage?.selectedId
  ]);
  const listResponseText = joinCandidateParts([
    content.listResponseMessage?.title,
    content.listResponseMessage?.singleSelectReply?.selectedRowId
  ]);
  const interactiveResponseText = joinCandidateParts([
    content.interactiveResponseMessage?.body?.text,
    extractNativeFlowResponseText(
      content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
    )
  ]);

  const candidates = [
    content.conversation,
    content.extendedTextMessage?.text,
    content.imageMessage?.caption,
    content.videoMessage?.caption,
    content.documentMessage?.caption,
    buttonsResponseText,
    templateButtonResponseText,
    listResponseText,
    interactiveResponseText
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  const image = content.imageMessage;
  if (image) {
    return "[Image received]";
  }

  const video = content.videoMessage;
  if (video) {
    return "[Video received]";
  }

  const audio = content.audioMessage;
  if (audio) {
    return "[Audio message received]";
  }

  const document = content.documentMessage;
  if (document) {
    const fileName = document.fileName?.trim();
    const mediaType = document.mimetype?.trim();
    if (fileName && mediaType) {
      return `[Document received: ${fileName} (${mediaType})]`;
    }
    if (fileName) {
      return `[Document received: ${fileName}]`;
    }
    if (mediaType) {
      return `[Document received: ${mediaType}]`;
    }
    return "[Document received]";
  }

  if (content.stickerMessage) {
    return "[Sticker received]";
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
