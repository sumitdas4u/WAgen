import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import * as baileys from "@whiskeysockets/baileys";
import pdfParse from "pdf-parse";
import { env } from "../config/env.js";
import { aiService } from "./ai-service.js";
import { chargeUser, requireAiCredit } from "./ai-token-service.js";
import { uploadInboundMedia } from "./supabase-storage-service.js";

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

async function storeMediaInUploads(
  userId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string | null> {
  return uploadInboundMedia({ userId, buffer, mimeType, folder: "inbound", filename });
}

export async function extractInboundMediaText(
  socket: WASocket,
  message: WAMessage,
  userId?: string
): Promise<{ text: string | null; mediaUrl: string | null }> {
  if (!message.message) {
    return { text: null, mediaUrl: null };
  }

  const content = unwrapMessageContent(message.message);
  const hasImage = Boolean(content.imageMessage);
  const hasVideo = Boolean(content.videoMessage);
  const hasAudio = Boolean(content.audioMessage);
  const document = content.documentMessage;
  if (!hasImage && !hasVideo && !hasAudio && !document) {
    return { text: null, mediaUrl: null };
  }

  const mimeType =
    content.imageMessage?.mimetype ??
    content.videoMessage?.mimetype ??
    content.audioMessage?.mimetype ??
    document?.mimetype ??
    "application/octet-stream";
  const media = await withTimeout(
    downloadMediaBuffer(socket, message),
    env.INBOUND_MEDIA_TIMEOUT_MS,
    "Inbound media download timed out"
  );
  if (!media || media.length === 0) {
    return { text: null, mediaUrl: null };
  }

  if (media.length > env.INBOUND_MEDIA_MAX_BYTES) {
    return {
      text: `[Media attached but too large to parse automatically (${Math.round(media.length / (1024 * 1024))}MB)].`,
      mediaUrl: null
    };
  }

  if (hasVideo) {
    const mediaUrl = userId
      ? await storeMediaInUploads(userId, media, mimeType, "inbound-video")
      : null;
    return { text: "[Video received]", mediaUrl };
  }

  if (hasAudio) {
    const mediaUrl = userId
      ? await storeMediaInUploads(userId, media, mimeType, "inbound-audio")
      : null;
    return { text: "[Audio message received]", mediaUrl };
  }

  if (hasImage || mimeType.startsWith("image/")) {
    // Store the image buffer so we can show the actual photo in the chat.
    const mediaUrl = userId
      ? await storeMediaInUploads(userId, media, mimeType, "inbound-image")
      : null;

    try {
      if (userId) {
        await requireAiCredit(userId, "image_analyze", { estimatedTokens: 2_000 });
      }
      const description = await withTimeout(
        aiService.analyzeImage(media, mimeType),
        env.INBOUND_MEDIA_TIMEOUT_MS,
        "Image analysis timed out"
      );
      if (userId) {
        void chargeUser(userId, "image_analyze", { module: "media" });
      }
      const cleaned = normalizeExtractedText(description);
      const text = cleaned ? `[Image received]: ${limitText(cleaned)}` : "[Image received with no description available]";
      return { text, mediaUrl };
    } catch {
      return { text: "[Image received; analysis unavailable]", mediaUrl };
    }
  }

  if (mimeType.includes("pdf")) {
    try {
      const parsed = await withTimeout(pdfParse(media), env.INBOUND_MEDIA_TIMEOUT_MS, "PDF media parsing timed out");
      const cleaned = normalizeExtractedText(parsed.text ?? "");
      return {
        text: cleaned ? `[Extracted document text]: ${limitText(cleaned)}` : "[Document received with no readable text]",
        mediaUrl: null
      };
    } catch {
      return { text: "[PDF received; text extraction failed]", mediaUrl: null };
    }
  }

  if (mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("csv")) {
    const cleaned = normalizeExtractedText(media.toString("utf8"));
    return {
      text: cleaned ? `[Extracted document text]: ${limitText(cleaned)}` : "[Document received with no readable text]",
      mediaUrl: null
    };
  }

  return { text: `[Document received: ${document?.fileName ?? mimeType}]`, mediaUrl: null };
}
