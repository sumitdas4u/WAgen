import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import * as baileys from "@whiskeysockets/baileys";
import pdfParse from "pdf-parse";
import { env } from "../config/env.js";
import { openAIService } from "./openai-service.js";

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function downloadMediaBuffer(socket: WASocket, message: WAMessage): Promise<Buffer | null> {
  try {
    const buffer = await baileys.downloadMediaMessage(
      message,
      "buffer",
      {},
      { reuploadRequest: socket.updateMediaMessage as any, logger: console as any } as any
    );

    if (!buffer) {
      return null;
    }

    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
  } catch {
    return null;
  }
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function limitText(text: string): string {
  return text.slice(0, env.INBOUND_MEDIA_MAX_TEXT_CHARS);
}

export async function extractInboundMediaText(socket: WASocket, message: WAMessage): Promise<string | null> {
  if (!message.message) {
    return null;
  }

  const content = unwrapMessageContent(message.message);
  const hasImage = Boolean(content.imageMessage);
  const document = content.documentMessage;
  if (!hasImage && !document) {
    return null;
  }

  const mimeType = content.imageMessage?.mimetype || document?.mimetype || "application/octet-stream";
  const media = await withTimeout(
    downloadMediaBuffer(socket, message),
    env.INBOUND_MEDIA_TIMEOUT_MS,
    "Inbound media download timed out"
  );
  if (!media || media.length === 0) {
    return null;
  }

  if (media.length > env.INBOUND_MEDIA_MAX_BYTES) {
    return `[Media attached but too large to parse automatically (${Math.round(media.length / (1024 * 1024))}MB)].`;
  }

  if (hasImage || mimeType.startsWith("image/")) {
    try {
      const extracted = await withTimeout(
        openAIService.extractTextFromImage(media, mimeType),
        env.INBOUND_MEDIA_TIMEOUT_MS,
        "Image OCR timed out"
      );
      const cleaned = normalizeExtractedText(extracted);
      return cleaned ? `[Extracted image text]: ${limitText(cleaned)}` : "[Image received with no readable text]";
    } catch {
      return "[Image received; text extraction unavailable]";
    }
  }

  if (mimeType.includes("pdf")) {
    try {
      const parsed = await withTimeout(pdfParse(media), env.INBOUND_MEDIA_TIMEOUT_MS, "PDF media parsing timed out");
      const cleaned = normalizeExtractedText(parsed.text ?? "");
      return cleaned ? `[Extracted document text]: ${limitText(cleaned)}` : "[Document received with no readable text]";
    } catch {
      return "[PDF received; text extraction failed]";
    }
  }

  if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("csv")) {
    const cleaned = normalizeExtractedText(media.toString("utf8"));
    return cleaned ? `[Extracted document text]: ${limitText(cleaned)}` : "[Document received with no readable text]";
  }

  return `[Document received: ${document?.fileName ?? mimeType}]`;
}
