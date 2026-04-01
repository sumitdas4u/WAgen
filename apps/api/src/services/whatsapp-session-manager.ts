import * as baileys from "@whiskeysockets/baileys";
import type {
  WAMessage,
  WASocket,
  MessageUpsertType,
  ConnectionState
} from "@whiskeysockets/baileys";
import { getKeyAuthor } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import { getAggregateVotesInPollMessage } from "@whiskeysockets/baileys/lib/Utils/messages.js";
import { decryptPollVote } from "@whiskeysockets/baileys/lib/Utils/process-message.js";
import { jidNormalizedUser } from "@whiskeysockets/baileys/lib/WABinary/jid-utils.js";
import { env } from "../config/env.js";
import { clearAuthStateCache, useDbAuthState } from "./baileys-auth-state.js";
import {
  disconnectSessionsByPhoneNumber,
  getOrCreateWhatsAppSession,
  getWhatsAppStatus,
  resetWhatsAppAuthState,
  updateWhatsAppStatus
} from "./whatsapp-session-store.js";
import {
  encodeFlowLocationInput,
  encodeFlowPollInput,
  formatFlowLocationSummary,
  formatFlowPollSummary,
  type CapturedPollInput
} from "./flow-input-codec.js";
import { realtimeHub } from "./realtime-hub.js";
import {
  extractMessageLocationPayload,
  getMessageText,
  randomInt,
  unwrapMessageContent,
  wait
} from "../utils/index.js";
import { reconcileConversationPhone } from "./conversation-service.js";
import { extractInboundMediaText } from "./inbound-media-service.js";
import { processIncomingMessage } from "./message-router-service.js";
import { summarizeFlowMessage, type FlowMessagePayload } from "./outbound-message-types.js";

const HUMAN_REPLY_DELAY_MIN_MS = Math.max(0, Math.min(env.REPLY_DELAY_MIN_MS, env.REPLY_DELAY_MAX_MS));
const HUMAN_REPLY_DELAY_MAX_MS = Math.max(HUMAN_REPLY_DELAY_MIN_MS, env.REPLY_DELAY_MAX_MS);

interface SessionRuntime {
  socket: WASocket;
  qr: string | null;
  status: "connected" | "connecting" | "disconnected";
  connectionId: number;
}

interface QueuedInboundMessage {
  userId: string;
  remoteJid: string;
  phoneNumber: string;
  text: string;
  flowText?: string | null;
  senderName?: string;
  shouldAutoReply: boolean;
  channelLinkedNumber: string | null;
  mediaUrl?: string | null;
}

interface ExtractedInboundText {
  displayText: string;
  flowText?: string | null;
}

function getPollCreationContent(
  message: baileys.proto.IMessage | undefined
): {
  message: baileys.proto.IMessage;
  question: string;
  allowMultiple: boolean;
  encKey: Uint8Array | null;
} | null {
  if (!message) {
    return null;
  }

  const poll =
    message.pollCreationMessage ??
    message.pollCreationMessageV2 ??
    message.pollCreationMessageV3;

  if (!poll) {
    return null;
  }

  return {
    message,
    question: String(poll.name ?? "").trim(),
    allowMultiple: Number(poll.selectableOptionsCount ?? 1) > 1,
    encKey: poll.encKey ?? null
  };
}

function buildQrFlowMessageContent(payload: FlowMessagePayload): Record<string, unknown> {
  switch (payload.type) {
    case "text":
      return { text: payload.text };

    case "media":
      if (payload.mediaType === "image") {
        return {
          image: { url: payload.url },
          caption: payload.caption || ""
        };
      }
      if (payload.mediaType === "video") {
        return {
          video: { url: payload.url },
          caption: payload.caption || ""
        };
      }
      if (payload.mediaType === "audio") {
        return {
          audio: { url: payload.url },
          mimetype: "audio/mp4"
        };
      }
      return {
        document: { url: payload.url },
        caption: payload.caption || "",
        fileName: "document"
      };

    case "text_buttons":
      return {
        text: payload.text || "Please choose an option.",
        footer: payload.footer || "",
        buttons: payload.buttons.slice(0, 3).map((button) => ({
          buttonId: button.id,
          buttonText: { displayText: button.label },
          type: 1
        })),
        headerType: 1
      };

    case "media_buttons": {
      const base = {
        caption: payload.caption || "Please choose an option.",
        footer: "",
        buttons: payload.buttons.slice(0, 3).map((button) => ({
          buttonId: button.id,
          buttonText: { displayText: button.label },
          type: 1
        }))
      };

      if (payload.mediaType === "image") {
        return { ...base, image: { url: payload.url } };
      }
      if (payload.mediaType === "video") {
        return { ...base, video: { url: payload.url } };
      }
      return {
        ...base,
        document: { url: payload.url },
        fileName: "document"
      };
    }

    case "list":
      let remainingRows = 10;
      return {
        text: payload.text || "Please choose an option.",
        footer: "",
        buttonText: payload.buttonLabel || "View options",
        sections: payload.sections
          .map((section) => {
            const rows = section.rows
              .slice(0, remainingRows)
              .map((row) => ({
                title: row.title,
                description: row.description || "",
                rowId: row.id
              }));
            remainingRows -= rows.length;
            return {
              title: section.title,
              rows
            };
          })
          .filter((section) => section.rows.length > 0)
      };

    case "location_share":
      return {
        location: {
          degreesLatitude: payload.latitude,
          degreesLongitude: payload.longitude,
          name: payload.name || "",
          address: payload.address || ""
        }
      };

    case "contact_share": {
      const vcard = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${payload.name.trim()}`,
        ...(payload.org?.trim() ? [`ORG:${payload.org.trim()}`] : []),
        `TEL;type=CELL;type=VOICE;waid=${payload.phone.replace(/\D/g, "")}:+${payload.phone.replace(/\D/g, "")}`,
        "END:VCARD"
      ].join("\n");
      return {
        contacts: {
          contacts: [
            {
              displayName: payload.name.trim(),
              vcard
            }
          ]
        }
      };
    }

    case "poll":
      return {
        poll: {
          name: payload.question.trim(),
          values: payload.options.slice(0, 12),
          selectableCount: payload.allowMultiple ? payload.options.length : 1
        }
      };

    default:
      return { text: summarizeFlowMessage(payload) };
  }
}

function isDirectChatJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

type InboundMessageIdentifiers = {
  senderPn?: string;
  senderLid?: string;
  participant?: string;
  remoteJid?: string;
  participantPn?: string;
  participantLid?: string;
  remoteJidAlt?: string;
};

function readInboundIdentifiers(message: WAMessage): {
  keyFields: InboundMessageIdentifiers;
  messageFields: InboundMessageIdentifiers;
} {
  const keyFields = (message.key as unknown as InboundMessageIdentifiers) ?? {};
  const messageFields = (message as unknown as InboundMessageIdentifiers) ?? {};
  return { keyFields, messageFields };
}

function normalizePhoneDigits(raw: string, maxDigits = 15): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > maxDigits) {
    return null;
  }
  return digits;
}

function extractPhoneFromJidCandidate(candidate: unknown, maxDigits = 15): string | null {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return null;
  }

  const value = candidate.trim();
  if (value.includes("@")) {
    const [jidUserRaw, jidServerRaw] = value.split("@");
    const jidUser = jidUserRaw?.split(":")[0] ?? "";
    const jidServer = (jidServerRaw ?? "").toLowerCase();
    if (jidServer === "lid") {
      return null;
    }
    return normalizePhoneDigits(jidUser, maxDigits);
  }

  return normalizePhoneDigits(value, maxDigits);
}

function getAliasLookupKeys(candidate: unknown): string[] {
  if (typeof candidate !== "string") {
    return [];
  }

  const value = candidate.trim().toLowerCase();
  if (!value) {
    return [];
  }

  const keys = new Set<string>([value]);
  if (value.includes("@")) {
    const [jidUserRaw] = value.split("@");
    const jidUser = jidUserRaw?.split(":")[0] ?? "";
    if (jidUser) {
      keys.add(jidUser);
    }
  }

  return [...keys];
}

function resolveInboundPhoneNumber(
  message: WAMessage,
  lookupAliasPhone?: (candidate: unknown) => string | null
): string | null {
  const { keyFields, messageFields } = readInboundIdentifiers(message);

  const explicitPnCandidates: unknown[] = [
    keyFields.senderPn,
    messageFields.senderPn,
    keyFields.participantPn,
    messageFields.participantPn
  ];

  for (const candidate of explicitPnCandidates) {
    const phone = extractPhoneFromJidCandidate(candidate, 15);
    if (phone) {
      return phone;
    }
  }

  const aliasCandidates: unknown[] = [
    keyFields.senderLid,
    messageFields.senderLid,
    keyFields.participantLid,
    messageFields.participantLid,
    keyFields.participant,
    messageFields.participant,
    keyFields.remoteJidAlt,
    keyFields.remoteJid
  ];

  if (lookupAliasPhone) {
    for (const candidate of aliasCandidates) {
      const mapped = lookupAliasPhone(candidate);
      if (mapped) {
        return mapped;
      }
    }
  }

  const conservativeFallbackCandidates: unknown[] = [
    keyFields.remoteJidAlt,
    keyFields.remoteJid,
    keyFields.participant,
    messageFields.participant
  ];

  for (const candidate of conservativeFallbackCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const value = candidate.trim();
    if (!value || !value.includes("@")) {
      continue;
    }

    const [jidUserRaw, jidServerRaw] = value.split("@");
    const jidServer = (jidServerRaw ?? "").toLowerCase();
    if (jidServer !== "s.whatsapp.net" && jidServer !== "c.us") {
      continue;
    }

    const jidUser = jidUserRaw?.split(":")[0] ?? "";
    const phone = normalizePhoneDigits(jidUser, 15);
    if (phone) {
      return phone;
    }
  }

  return null;
}

function resolveInboundSenderName(message: WAMessage): string | undefined {
  const messageAny = message as unknown as {
    verifiedBizName?: string;
    notifyName?: string;
    pushName?: string;
  };

  const candidates = [
    message.pushName,
    messageAny.notifyName,
    messageAny.verifiedBizName
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim();
    if (!normalized || /^(\d+|\+?\d+)$/.test(normalized)) {
      continue;
    }
    return normalized;
  }

  return undefined;
}

export async function randomDelay(min: number, max: number): Promise<void> {
  const delay = randomInt(min, max);
  await wait(delay);
}

export async function simulateTyping(sock: WASocket, jid: string, messageLength: number): Promise<void> {
  await sock.sendPresenceUpdate("composing", jid);
  const baseMs = 300;
  const perCharacterMs = 20;
  const typingMs = Math.max(600, Math.min(2500, baseMs + messageLength * perCharacterMs));
  await wait(typingMs);
}

class WhatsAppSessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly activeConnectAttempts = new Set<string>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly phoneAliasMapByUser = new Map<string, Map<string, string>>();
  private readonly phoneChatJidByUser = new Map<string, Map<string, string>>();
  private readonly recentOutboundMessagesByUser = new Map<string, Map<string, baileys.proto.IMessage>>();
  private readonly messageQueues = new Map<string, QueuedInboundMessage[]>();
  private readonly processingUsers = new Set<string>();
  private connectionSeq = 0;

  async connectUser(userId: string, options?: { resetAuth?: boolean; force?: boolean }): Promise<void> {
    if (this.activeConnectAttempts.has(userId)) {
      return;
    }

    if (options?.resetAuth) {
      await this.resetUserSession(userId);
    }

    const existing = this.sessions.get(userId);
    if (!options?.force && (existing?.status === "connected" || existing?.status === "connecting")) {
      return;
    }

    this.activeConnectAttempts.add(userId);
    try {
      this.clearReconnectTimer(userId);
      this.reconnectAttempts.delete(userId);
      await getOrCreateWhatsAppSession(userId);
      await updateWhatsAppStatus(userId, "connecting");
      realtimeHub.broadcast(userId, "whatsapp.status", { status: "connecting" });

      clearAuthStateCache(userId);
      const { state, saveCreds } = await useDbAuthState(userId);
      const { version } = await baileys.fetchLatestBaileysVersion();

      const socket = (baileys.default ?? (baileys as any).makeWASocket)({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["WAgen", "Chrome", "1.0.0"],
        getMessage: async (key) => this.getRecentOutboundMessage(userId, key)
      }) as WASocket;
      const connectionId = ++this.connectionSeq;

      this.sessions.set(userId, {
        socket,
        qr: null,
        status: "connecting",
        connectionId
      });

      socket.ev.on("creds.update", saveCreds);
      (socket.ev as unknown as { on: (event: string, listener: (payload: unknown) => void) => void }).on(
        "chats.phoneNumberShare",
        (payload) => {
          const update = payload as { lid?: string; jid?: string };
          this.rememberPhoneAlias(userId, update.lid, update.jid);
          this.rememberPhoneAlias(userId, update.jid, update.jid);
        }
      );

      socket.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
        const runtime = this.sessions.get(userId);
        if (!runtime || runtime.socket !== socket || runtime.connectionId !== connectionId) {
          return;
        }

        if (update.qr) {
          runtime.qr = update.qr;
          realtimeHub.broadcast(userId, "whatsapp.qr", {
            qr: update.qr,
            status: "waiting_scan"
          });
        }

        if (update.connection === "open") {
          runtime.status = "connected";
          runtime.qr = null;
          this.reconnectAttempts.delete(userId);
          const phone = socket.user?.id?.split(":")[0] ?? null;
          await updateWhatsAppStatus(userId, "connected", phone ?? undefined);

          if (phone) {
            const duplicateUserIds = await disconnectSessionsByPhoneNumber(userId, phone);
            for (const duplicateUserId of duplicateUserIds) {
              this.clearReconnectTimer(duplicateUserId);
              this.reconnectAttempts.delete(duplicateUserId);
              this.clearUserQueues(duplicateUserId);
              this.clearPhoneAliasMap(duplicateUserId);
              this.clearPhoneChatJidMap(duplicateUserId);
              this.clearRecentOutboundMessages(duplicateUserId);

              const duplicateRuntime = this.sessions.get(duplicateUserId);
              if (duplicateRuntime) {
                try {
                  (duplicateRuntime.socket as unknown as { ws?: { close?: () => void } }).ws?.close?.();
                } catch {
                  // No-op.
                }
                this.sessions.delete(duplicateUserId);
              }

              realtimeHub.broadcast(duplicateUserId, "whatsapp.status", { status: "disconnected" });
            }
          }

          realtimeHub.broadcast(userId, "whatsapp.status", {
            status: "connected",
            phoneNumber: phone
          });
        }

        if (update.connection === "close") {
          const previousStatus = runtime.status;
          const hadQr = Boolean(runtime.qr);
          const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode;
          const errorMessage = String(update.lastDisconnect?.error ?? "").toLowerCase();
          const isConflictError = errorMessage.includes("conflict");
          const looksLikeStaleAuth = errorMessage.includes("connection failure") && previousStatus === "connecting";
          const shouldResetAuth = statusCode === (baileys.DisconnectReason as any).loggedOut || (looksLikeStaleAuth && !hadQr);

          runtime.status = "disconnected";
          await updateWhatsAppStatus(userId, "disconnected");
          realtimeHub.broadcast(userId, "whatsapp.status", { status: "disconnected" });

          if (shouldResetAuth) {
            await resetWhatsAppAuthState(userId);
            clearAuthStateCache(userId);
            console.warn(
              `[WA] auth reset requested user=${userId} reason=${
                statusCode === (baileys.DisconnectReason as any).loggedOut ? "logged_out" : "connection_failure"
              }`
            );
          }

          const shouldReconnect =
            env.AUTO_RECONNECT && (statusCode !== (baileys.DisconnectReason as any).loggedOut || shouldResetAuth);

          this.sessions.delete(userId);
          this.clearUserQueues(userId);
          this.clearPhoneChatJidMap(userId);
          this.clearRecentOutboundMessages(userId);
          this.clearReconnectTimer(userId);
          if (shouldReconnect) {
            const attempts = (this.reconnectAttempts.get(userId) ?? 0) + 1;
            this.reconnectAttempts.set(userId, attempts);
            const baseDelay = isConflictError ? 5000 : 1500;
            const delayMs = Math.min(30000, baseDelay * Math.max(1, Math.min(attempts, 6)));
            this.scheduleReconnect(userId, delayMs);
          } else {
            this.reconnectAttempts.delete(userId);
          }
        }
      });

      socket.ev.on(
        "messages.upsert",
        async ({ messages, type }: { messages: WAMessage[]; type: MessageUpsertType }) => {
        const runtime = this.sessions.get(userId);
        if (!runtime || runtime.socket !== socket || runtime.connectionId !== connectionId) {
          return;
        }

        const shouldAutoReply = type === "notify";
        if (type !== "notify" && type !== "append") {
          return;
        }

        if (type === "notify") {
          console.info(`[WA] messages.upsert user=${userId} type=${type} count=${messages.length}`);
        }

        for (const message of messages) {
          try {
            await this.handleInboundMessage(userId, message, shouldAutoReply);
          } catch (error) {
            console.error("Inbound message handling failed", error);
          }
        }
      });
    } finally {
      this.activeConnectAttempts.delete(userId);
    }
  }

  async getStatus(userId: string): Promise<{
    status: string;
    phoneNumber: string | null;
    hasQr: boolean;
    qr: string | null;
  }> {
    const dbStatus = await getWhatsAppStatus(userId);
    const runtime = this.sessions.get(userId);
    const shouldRestoreRuntime =
      !runtime && (dbStatus.status === "connected" || dbStatus.status === "connecting");

    if (shouldRestoreRuntime) {
      void this.connectUser(userId);
      return {
        status: "connecting",
        phoneNumber: dbStatus.phoneNumber,
        hasQr: false,
        qr: null
      };
    }

    return {
      status: runtime?.status ?? dbStatus.status,
      phoneNumber: dbStatus.phoneNumber,
      hasQr: Boolean(runtime?.qr),
      qr: runtime?.qr ?? null
    };
  }

  async disconnectUser(userId: string): Promise<void> {
    await this.resetUserSession(userId);
  }

  async sendManualMessage(input: { userId: string; phoneNumber: string; text: string }): Promise<void> {
    const runtime = this.sessions.get(input.userId);
    if (!runtime || runtime.status !== "connected") {
      throw new Error("WhatsApp QR session is not connected.");
    }

    const to = this.resolveOutboundChatJid(input.userId, input.phoneNumber);
    const message = input.text.trim();
    if (!message) {
      throw new Error("Message text is required.");
    }

    await this.sendAndRememberMessage(input.userId, runtime.socket, to, { text: message });
  }

  async sendRawMessage(input: {
    userId: string;
    phoneNumber: string;
    content: Record<string, unknown>;
  }): Promise<WAMessage | undefined> {
    const runtime = this.sessions.get(input.userId);
    if (!runtime || runtime.status !== "connected") {
      throw new Error("WhatsApp QR session is not connected.");
    }

    const to = this.resolveOutboundChatJid(input.userId, input.phoneNumber);
    return this.sendAndRememberMessage(input.userId, runtime.socket, to, input.content);
  }

  async sendFlowMessage(input: { userId: string; phoneNumber: string; payload: FlowMessagePayload }): Promise<void> {
    const runtime = this.sessions.get(input.userId);
    if (!runtime || runtime.status !== "connected") {
      throw new Error("WhatsApp QR session is not connected.");
    }

    const to = this.resolveOutboundChatJid(input.userId, input.phoneNumber);
    await this.sendAndRememberMessage(
      input.userId,
      runtime.socket,
      to,
      buildQrFlowMessageContent(input.payload) as never
    );
  }

  private queueKey(userId: string, jid: string): string {
    return `${userId}::${jid}`;
  }

  private getPhoneAliasMap(userId: string): Map<string, string> {
    const existing = this.phoneAliasMapByUser.get(userId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, string>();
    this.phoneAliasMapByUser.set(userId, created);
    return created;
  }

  private clearPhoneAliasMap(userId: string): void {
    this.phoneAliasMapByUser.delete(userId);
  }

  private getPhoneChatJidMap(userId: string): Map<string, string> {
    const existing = this.phoneChatJidByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, string>();
    this.phoneChatJidByUser.set(userId, created);
    return created;
  }

  private clearPhoneChatJidMap(userId: string): void {
    this.phoneChatJidByUser.delete(userId);
  }

  private rememberPhoneChatJid(userId: string, phoneNumber: string, jid: string): void {
    const digits = normalizePhoneDigits(phoneNumber, 15);
    if (!digits || !isDirectChatJid(jid)) {
      return;
    }

    this.getPhoneChatJidMap(userId).set(digits, jid);
  }

  private resolveOutboundChatJid(userId: string, phoneNumber: string): string {
    const digits = normalizePhoneDigits(phoneNumber, 15);
    if (!digits) {
      throw new Error("Valid phone number is required.");
    }

    return this.getPhoneChatJidMap(userId).get(digits) ?? `${digits}@s.whatsapp.net`;
  }

  private getRecentOutboundMessageMap(userId: string): Map<string, baileys.proto.IMessage> {
    const existing = this.recentOutboundMessagesByUser.get(userId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, baileys.proto.IMessage>();
    this.recentOutboundMessagesByUser.set(userId, created);
    return created;
  }

  private clearRecentOutboundMessages(userId: string): void {
    this.recentOutboundMessagesByUser.delete(userId);
  }

  private getMessageCacheKeys(key: { remoteJid?: string | null; id?: string | null }): string[] {
    const id = key.id?.trim();
    if (!id) {
      return [];
    }

    const cacheKeys = new Set<string>([id]);
    const remoteJid = key.remoteJid?.trim();
    if (remoteJid) {
      cacheKeys.add(`${remoteJid}:${id}`);
    }

    return [...cacheKeys];
  }

  private rememberOutboundMessage(userId: string, message: WAMessage): void {
    if (!message.message) {
      return;
    }

    const cache = this.getRecentOutboundMessageMap(userId);
    for (const key of this.getMessageCacheKeys(message.key)) {
      cache.set(key, message.message);
    }

    while (cache.size > 512) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      cache.delete(oldestKey);
    }
  }

  private getRecentOutboundMessage(
    userId: string,
    key: { remoteJid?: string | null; id?: string | null }
  ): baileys.proto.IMessage | undefined {
    const cache = this.recentOutboundMessagesByUser.get(userId);
    if (!cache) {
      return undefined;
    }

    for (const cacheKey of this.getMessageCacheKeys(key)) {
      const found = cache.get(cacheKey);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private extractPollVoteText(userId: string, runtime: SessionRuntime, message: WAMessage): ExtractedInboundText | null {
    const content = message.message ? unwrapMessageContent(message.message) : null;
    const pollUpdate = content?.pollUpdateMessage;
    const creationKey = pollUpdate?.pollCreationMessageKey;
    const vote = pollUpdate?.vote;
    if (!creationKey?.id || !vote?.encPayload || !vote?.encIv) {
      return null;
    }

    const pollCreationMessage = getPollCreationContent(
      this.getRecentOutboundMessage(userId, {
        remoteJid: creationKey.remoteJid ?? message.key.remoteJid ?? null,
        id: creationKey.id
      })
    );
    if (!pollCreationMessage?.encKey) {
      return {
        displayText: "[Poll] Vote received",
        flowText: null
      };
    }

    try {
      const meId = jidNormalizedUser(runtime.socket.user?.id);
      const pollCreatorJid = getKeyAuthor(creationKey, meId);
      const voterJid = getKeyAuthor(message.key, meId);
      const decryptedVote = decryptPollVote(vote, {
        pollCreatorJid,
        pollMsgId: creationKey.id,
        pollEncKey: pollCreationMessage.encKey,
        voterJid
      });

      const selectedOptions = getAggregateVotesInPollMessage(
        {
          message: pollCreationMessage.message,
          pollUpdates: [
            {
              pollUpdateMessageKey: message.key,
              vote: decryptedVote
            }
          ]
        },
        meId
      )
        .filter((entry) => entry.voters.length > 0 && entry.name && entry.name !== "Unknown")
        .map((entry) => entry.name);

      if (!selectedOptions.length) {
        return {
          displayText: "[Poll] Vote received",
          flowText: null
        };
      }

      const payload: CapturedPollInput = {
        ...(pollCreationMessage.question ? { question: pollCreationMessage.question } : {}),
        selectedOptions,
        allowMultiple: pollCreationMessage.allowMultiple,
        source: "native"
      };

      return {
        displayText: formatFlowPollSummary(payload),
        flowText: encodeFlowPollInput(payload)
      };
    } catch (error) {
      console.warn(
        `[WA] poll vote decode failed user=${userId} message=${message.key.id ?? "unknown"}`,
        error
      );
      return {
        displayText: "[Poll] Vote received",
        flowText: null
      };
    }
  }

  private extractInboundText(userId: string, runtime: SessionRuntime | undefined, message: WAMessage): ExtractedInboundText | null {
    const locationPayload = extractMessageLocationPayload(message);
    if (locationPayload) {
      return {
        displayText: formatFlowLocationSummary(locationPayload),
        flowText: encodeFlowLocationInput(locationPayload)
      };
    }

    if (runtime) {
      const pollPayload = this.extractPollVoteText(userId, runtime, message);
      if (pollPayload) {
        return pollPayload;
      }
    }

    // List response: displayText = clean label only; flowText includes rowId for routing.
    if (message.message) {
      const content = unwrapMessageContent(message.message);

      if (content.listResponseMessage) {
        const label = content.listResponseMessage.title?.trim() ?? "";
        const rowId = content.listResponseMessage.singleSelectReply?.selectedRowId?.trim() ?? "";
        if (label || rowId) {
          return {
            displayText: label || rowId,
            flowText: [label, rowId].filter(Boolean).join(" ")
          };
        }
      }

      if (content.buttonsResponseMessage) {
        const label = content.buttonsResponseMessage.selectedDisplayText?.trim() ?? "";
        const btnId = content.buttonsResponseMessage.selectedButtonId?.trim() ?? "";
        if (label || btnId) {
          return {
            displayText: label || btnId,
            flowText: [label, btnId].filter(Boolean).join(" ")
          };
        }
      }
    }

    const plainText = getMessageText(message);
    if (!plainText) {
      return null;
    }

    return {
      displayText: plainText,
      flowText: plainText
    };
  }

  private async sendAndRememberMessage(
    userId: string,
    socket: WASocket,
    jid: string,
    content: Record<string, unknown>
  ): Promise<WAMessage | undefined> {
    const sent = await socket.sendMessage(jid, content as never);
    if (sent) {
      this.rememberOutboundMessage(userId, sent);
    }
    return sent;
  }

  private lookupPhoneAlias(userId: string, aliasCandidate: unknown): string | null {
    const aliasMap = this.phoneAliasMapByUser.get(userId);
    if (!aliasMap) {
      return null;
    }
    const keys = getAliasLookupKeys(aliasCandidate);
    for (const key of keys) {
      const found = aliasMap.get(key);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private rememberPhoneAlias(userId: string, aliasCandidate: unknown, phoneCandidate: unknown): void {
    const phone = extractPhoneFromJidCandidate(phoneCandidate, 15);
    if (!phone) {
      return;
    }

    const keys = getAliasLookupKeys(aliasCandidate);
    if (keys.length === 0) {
      return;
    }

    const aliasMap = this.getPhoneAliasMap(userId);
    for (const key of keys) {
      aliasMap.set(key, phone);
    }
  }

  private async resetUserSession(userId: string): Promise<void> {
    this.clearReconnectTimer(userId);
    this.reconnectAttempts.delete(userId);

    const runtime = this.sessions.get(userId);
    if (runtime) {
      try {
        (runtime.socket as unknown as { ws?: { close?: () => void } }).ws?.close?.();
      } catch {
        // No-op.
      }
      this.sessions.delete(userId);
    }

    this.clearUserQueues(userId);
    this.clearPhoneAliasMap(userId);
    this.clearPhoneChatJidMap(userId);
    this.clearRecentOutboundMessages(userId);
    clearAuthStateCache(userId);
    await resetWhatsAppAuthState(userId);
    await updateWhatsAppStatus(userId, "disconnected");
    realtimeHub.broadcast(userId, "whatsapp.status", { status: "disconnected" });
  }

  private clearReconnectTimer(userId: string): void {
    const timer = this.reconnectTimers.get(userId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.reconnectTimers.delete(userId);
  }

  private scheduleReconnect(userId: string, delayMs: number): void {
    this.clearReconnectTimer(userId);

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(userId);
      void this.connectUser(userId);
    }, delayMs);

    this.reconnectTimers.set(userId, timer);
  }

  private clearUserQueues(userId: string): void {
    const prefix = `${userId}::`;
    for (const queueKey of this.messageQueues.keys()) {
      if (queueKey.startsWith(prefix)) {
        this.messageQueues.delete(queueKey);
      }
    }

    for (const queueKey of this.processingUsers) {
      if (queueKey.startsWith(prefix)) {
        this.processingUsers.delete(queueKey);
      }
    }
  }

  private enqueueInboundMessage(job: QueuedInboundMessage): void {
    const key = this.queueKey(job.userId, job.remoteJid);
    const queue = this.messageQueues.get(key) ?? [];
    queue.push(job);
    this.messageQueues.set(key, queue);

    console.info(
      `[WA] queue.enqueue user=${job.userId} jid=${job.remoteJid} contact=${job.phoneNumber} size=${queue.length}`
    );

    void this.processQueue(key);
  }

  private async processQueue(queueKey: string): Promise<void> {
    if (this.processingUsers.has(queueKey)) {
      return;
    }

    this.processingUsers.add(queueKey);
    console.info(`[WA] queue.start key=${queueKey}`);

    try {
      while (true) {
        const queue = this.messageQueues.get(queueKey);
        if (!queue || queue.length === 0) {
          break;
        }

        const job = queue.shift();
        if (!job) {
          continue;
        }

        try {
          await this.processQueuedMessage(job);
        } catch (error) {
          console.error(
            `[WA] queue.job_failed contact=${job.phoneNumber} jid=${job.remoteJid}`,
            error
          );
        }
      }
    } finally {
      const remaining = this.messageQueues.get(queueKey);
      if (remaining && remaining.length === 0) {
        this.messageQueues.delete(queueKey);
      }

      this.processingUsers.delete(queueKey);
      console.info(`[WA] queue.done key=${queueKey}`);

      if ((this.messageQueues.get(queueKey)?.length ?? 0) > 0) {
        void this.processQueue(queueKey);
      }
    }
  }

  private async processQueuedMessage(job: QueuedInboundMessage): Promise<void> {
    const result = await processIncomingMessage({
      userId: job.userId,
      channelType: "qr",
      channelLinkedNumber: job.channelLinkedNumber,
      customerIdentifier: job.phoneNumber,
      messageText: job.text,
      flowMessageText: job.flowText ?? job.text,
      senderName: job.senderName,
      shouldAutoReply: job.shouldAutoReply,
      mediaUrl: job.mediaUrl ?? null,
      sendReply: async ({ text }) => {
        const runtime = this.sessions.get(job.userId);
        if (!runtime || runtime.status !== "connected") {
          throw new Error("session_unavailable");
        }

        console.info(
          `[WA] auto-reply queued user=${job.userId} contact=${job.phoneNumber} wait=${HUMAN_REPLY_DELAY_MIN_MS}-${HUMAN_REPLY_DELAY_MAX_MS}ms jid=${job.remoteJid}`
        );
        await randomDelay(HUMAN_REPLY_DELAY_MIN_MS, HUMAN_REPLY_DELAY_MAX_MS);

        let composingSet = false;
        try {
          try {
            await simulateTyping(runtime.socket, job.remoteJid, text.length);
            composingSet = true;
          } catch (presenceError) {
            console.warn(`[WA] typing presence failed user=${job.userId} jid=${job.remoteJid}`, presenceError);
          }

          await this.sendAndRememberMessage(job.userId, runtime.socket, job.remoteJid, { text });
        } finally {
          if (composingSet) {
            try {
              await runtime.socket.sendPresenceUpdate("paused", job.remoteJid);
            } catch (presenceError) {
              console.warn(`[WA] presence reset failed user=${job.userId} jid=${job.remoteJid}`, presenceError);
            }
          }
        }
      }
    });

    if (!result.autoReplySent) {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} conversation=${result.conversationId} reason=${result.reason} contact=${job.phoneNumber}`
      );
      return;
    }

    console.info(
      `[WA] auto-reply sent user=${job.userId} conversation=${result.conversationId} contact=${job.phoneNumber}`
    );
  }

  private async handleInboundMessage(userId: string, message: WAMessage, shouldAutoReply: boolean): Promise<void> {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid) {
      return;
    }

    if (message.key.fromMe) {
      console.info(`[WA] inbound skipped user=${userId} reason=from_me jid=${remoteJid}`);
      return;
    }

    if (!isDirectChatJid(remoteJid)) {
      console.info(`[WA] inbound skipped user=${userId} reason=non_direct_jid jid=${remoteJid}`);
      return;
    }

    const runtime = this.sessions.get(userId);
    const extracted = this.extractInboundText(userId, runtime, message);
    let text = extracted?.displayText ?? "";
    let flowText = extracted?.flowText ?? text;
    let inboundMediaUrl: string | null = null;
    if (runtime) {
      const mediaResult = await extractInboundMediaText(runtime.socket, message, userId);
      if (mediaResult.text) {
        text = text ? `${text}\n${mediaResult.text}` : mediaResult.text;
      }
      inboundMediaUrl = mediaResult.mediaUrl;
    }

    if (!text) {
      console.info(`[WA] inbound skipped user=${userId} reason=no_text jid=${remoteJid}`);
      return;
    }

    const phoneNumber = resolveInboundPhoneNumber(message, (candidate) => this.lookupPhoneAlias(userId, candidate));
    if (!phoneNumber) {
      console.info(`[WA] inbound skipped user=${userId} reason=missing_phone jid=${remoteJid}`);
      return;
    }

    const { keyFields, messageFields } = readInboundIdentifiers(message);
    const aliasCandidates: unknown[] = [
      remoteJid,
      keyFields.remoteJidAlt,
      keyFields.senderLid,
      messageFields.senderLid,
      keyFields.participantLid,
      messageFields.participantLid,
      keyFields.participant,
      messageFields.participant
    ];

    for (const aliasCandidate of aliasCandidates) {
      this.rememberPhoneAlias(userId, aliasCandidate, phoneNumber);
    }
    this.rememberPhoneChatJid(userId, phoneNumber, remoteJid);

    const fallbackPhoneFromRemote = extractPhoneFromJidCandidate(remoteJid, 15);
    if (fallbackPhoneFromRemote && fallbackPhoneFromRemote !== phoneNumber) {
      await reconcileConversationPhone(userId, fallbackPhoneFromRemote, phoneNumber);
    }

    const channelLinkedNumber = runtime ? extractPhoneFromJidCandidate(runtime.socket.user?.id, 15) : null;
    if (channelLinkedNumber && phoneNumber === channelLinkedNumber) {
      console.info(`[WA] inbound skipped user=${userId} reason=from_own_number phone=${phoneNumber}`);
      return;
    }

    const senderName = resolveInboundSenderName(message);

    this.enqueueInboundMessage({
      userId,
      remoteJid,
      phoneNumber,
      text,
      flowText,
      senderName,
      shouldAutoReply,
      channelLinkedNumber,
      mediaUrl: inboundMediaUrl
    });
  }
}

export const whatsappSessionManager = new WhatsAppSessionManager();
