import type { WAMessage, WASocket } from "@adiwajshing/baileys";
import { PerUserMessageQueue } from "./messageQueue";
import { delay, randomDelay } from "./utils/delay";

interface MessageUpsertPayload {
  messages: WAMessage[];
  type: string;
}

interface QueuedIncomingMessage {
  jid: string;
  text: string;
  message: WAMessage;
  receivedAt: number;
}

export async function generateReply(_text: string): Promise<string> {
  return "This is a demo AI reply.";
}

export async function simulateTyping(sock: WASocket, jid: string, messageLength: number): Promise<void> {
  const charsPerSecond = 7;
  const minTypingMs = 900;
  const maxTypingMs = 4500;
  const estimatedTypingMs = Math.ceil((Math.max(messageLength, 1) / charsPerSecond) * 1000);
  const typingDelayMs = Math.max(minTypingMs, Math.min(maxTypingMs, estimatedTypingMs));

  await sock.sendPresenceUpdate("composing", jid);
  await delay(typingDelayMs);
}

function isDirectChatJid(jid: string): boolean {
  if (jid === "status@broadcast" || jid.endsWith("@broadcast")) {
    return false;
  }

  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

function getTextFromMessage(message: WAMessage): string {
  const content = message.message;
  if (!content) {
    return "";
  }

  const unwrapped =
    content.ephemeralMessage?.message ??
    content.viewOnceMessage?.message ??
    content.viewOnceMessageV2?.message ??
    content.viewOnceMessageV2Extension?.message ??
    content;

  const textCandidates = [
    unwrapped.conversation,
    unwrapped.extendedTextMessage?.text,
    unwrapped.imageMessage?.caption,
    unwrapped.videoMessage?.caption,
    unwrapped.documentMessage?.caption,
    unwrapped.buttonsResponseMessage?.selectedDisplayText,
    unwrapped.listResponseMessage?.title,
    unwrapped.templateButtonReplyMessage?.selectedDisplayText
  ];

  for (const candidate of textCandidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return "";
}

export class MessageHandler {
  private readonly queue: PerUserMessageQueue<QueuedIncomingMessage>;

  constructor(private readonly sock: WASocket) {
    this.queue = new PerUserMessageQueue<QueuedIncomingMessage>(this.processQueuedMessage.bind(this));
  }

  async handleUpsert(payload: MessageUpsertPayload): Promise<void> {
    if (payload.type !== "notify" && payload.type !== "append") {
      return;
    }

    for (const message of payload.messages) {
      try {
        this.enqueueIfEligible(message);
      } catch (error) {
        console.error("[Handler] Failed to enqueue message", error);
      }
    }
  }

  private enqueueIfEligible(message: WAMessage): void {
    if (message.key.fromMe) {
      console.log("[Handler] Ignored self message");
      return;
    }

    const jid = message.key.remoteJid;
    if (!jid) {
      return;
    }

    if (!isDirectChatJid(jid)) {
      console.log(`[Handler] Ignored non-direct chat: ${jid}`);
      return;
    }

    const text = getTextFromMessage(message);
    if (!text) {
      console.log(`[Handler] Ignored empty/non-text message from ${jid}`);
      return;
    }

    const queuedMessage: QueuedIncomingMessage = {
      jid,
      text,
      message,
      receivedAt: Date.now()
    };

    this.queue.enqueue(jid, queuedMessage);
    console.log(`[Queue] Enqueued message for ${jid}. Queue size=${this.queue.getQueueSize(jid)}`);
  }

  private async processQueuedMessage(jid: string, item: QueuedIncomingMessage): Promise<void> {
    const preview = item.text.length > 48 ? `${item.text.slice(0, 48)}...` : item.text;
    console.log(`[Queue] Processing ${jid}: "${preview}"`);

    try {
      // Human-like think time before typing starts.
      await randomDelay(2000, 3000);

      const reply = await generateReply(item.text);

      // Show typing indicator and wait realistic typing time.
      await simulateTyping(this.sock, jid, reply.length);

      await this.sock.sendMessage(jid, { text: reply });
      console.log(`[Queue] Reply sent to ${jid}`);
    } catch (error) {
      console.error(`[Queue] Failed to reply for ${jid}`, error);
    } finally {
      try {
        await this.sock.sendPresenceUpdate("paused", jid);
      } catch (presenceError) {
        console.error(`[Presence] Failed to set paused for ${jid}`, presenceError);
      }
    }
  }
}

