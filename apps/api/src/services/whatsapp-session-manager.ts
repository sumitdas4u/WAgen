import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WAMessage,
  type WASocket
} from "@whiskeysockets/baileys";
import { env } from "../config/env.js";
import { getUserById } from "./user-service.js";
import { clearAuthStateCache, useDbAuthState } from "./baileys-auth-state.js";
import {
  disconnectSessionsByPhoneNumber,
  getOrCreateWhatsAppSession,
  getWhatsAppStatus,
  resetWhatsAppAuthState,
  updateWhatsAppStatus
} from "./whatsapp-session-store.js";
import { realtimeHub } from "./realtime-hub.js";
import { getMessageText, randomInt, wait } from "../utils/index.js";
import {
  getConversationById,
  getConversationHistoryForPrompt,
  trackInboundMessage,
  trackOutboundMessage
} from "./conversation-service.js";
import { buildSalesReply } from "./ai-reply-service.js";

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
  conversationId: string;
  shouldAutoReply: boolean;
}

function isDirectChatJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
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
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["WAgen", "Chrome", "1.0.0"]
      });
      const connectionId = ++this.connectionSeq;

      this.sessions.set(userId, {
        socket,
        qr: null,
        status: "connecting",
        connectionId
      });

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
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
          const shouldResetAuth = statusCode === DisconnectReason.loggedOut || (looksLikeStaleAuth && !hadQr);

          runtime.status = "disconnected";
          await updateWhatsAppStatus(userId, "disconnected");
          realtimeHub.broadcast(userId, "whatsapp.status", { status: "disconnected" });

          if (shouldResetAuth) {
            await resetWhatsAppAuthState(userId);
            clearAuthStateCache(userId);
            console.warn(
              `[WA] auth reset requested user=${userId} reason=${
                statusCode === DisconnectReason.loggedOut ? "logged_out" : "connection_failure"
              }`
            );
          }

          const shouldReconnect =
            env.AUTO_RECONNECT && (statusCode !== DisconnectReason.loggedOut || shouldResetAuth);

          this.sessions.delete(userId);
          this.clearUserQueues(userId);
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

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
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

  private queueKey(userId: string, jid: string): string {
    return `${userId}::${jid}`;
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
      `[WA] queue.enqueue user=${job.userId} jid=${job.remoteJid} conversation=${job.conversationId} size=${queue.length}`
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
            `[WA] queue.job_failed conversation=${job.conversationId} jid=${job.remoteJid}`,
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
    if (!job.shouldAutoReply) {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} reason=non_notify_event conversation=${job.conversationId}`
      );
      return;
    }

    const user = await getUserById(job.userId);
    if (!user) {
      console.info(`[WA] auto-reply skipped user=${job.userId} reason=missing_user conversation=${job.conversationId}`);
      return;
    }

    if (!user.ai_active) {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} reason=agent_inactive conversation=${job.conversationId}`
      );
      return;
    }

    const conversation = await getConversationById(job.conversationId);
    if (!conversation) {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} reason=missing_conversation conversation=${job.conversationId}`
      );
      return;
    }

    if (conversation.manual_takeover) {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} reason=manual_takeover conversation=${job.conversationId}`
      );
      return;
    }

    if (conversation.ai_paused) {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} reason=conversation_paused conversation=${job.conversationId}`
      );
      return;
    }

    if (conversation.last_ai_reply_at) {
      const elapsedSeconds = (Date.now() - new Date(conversation.last_ai_reply_at).getTime()) / 1000;
      if (elapsedSeconds < env.CONTACT_COOLDOWN_SECONDS) {
        console.info(
          `[WA] auto-reply skipped user=${job.userId} reason=cooldown conversation=${job.conversationId} elapsed=${Math.round(
            elapsedSeconds
          )}s required=${env.CONTACT_COOLDOWN_SECONDS}s`
        );
        return;
      }
    }

    const history = await getConversationHistoryForPrompt(conversation.id, 10);
    const reply = await buildSalesReply({
      user,
      incomingMessage: job.text,
      conversationPhone: job.phoneNumber,
      history
    });

    const runtime = this.sessions.get(job.userId);
    if (!runtime || runtime.status !== "connected") {
      console.info(
        `[WA] auto-reply skipped user=${job.userId} reason=session_unavailable conversation=${job.conversationId}`
      );
      return;
    }

    console.info(
      `[WA] auto-reply queued user=${job.userId} conversation=${job.conversationId} wait=${HUMAN_REPLY_DELAY_MIN_MS}-${HUMAN_REPLY_DELAY_MAX_MS}ms jid=${job.remoteJid}`
    );
    await randomDelay(HUMAN_REPLY_DELAY_MIN_MS, HUMAN_REPLY_DELAY_MAX_MS);

    let composingSet = false;
    try {
      try {
        await simulateTyping(runtime.socket, job.remoteJid, reply.length);
        composingSet = true;
      } catch (presenceError) {
        console.warn(`[WA] typing presence failed user=${job.userId} jid=${job.remoteJid}`, presenceError);
      }

      await runtime.socket.sendMessage(job.remoteJid, { text: reply });
      await trackOutboundMessage(conversation.id, reply);

      console.info(
        `[WA] auto-reply sent user=${job.userId} conversation=${job.conversationId} phone=${job.phoneNumber}`
      );

      realtimeHub.broadcast(job.userId, "conversation.updated", {
        conversationId: conversation.id,
        phoneNumber: job.phoneNumber,
        direction: "outbound",
        message: reply,
        score: conversation.score,
        stage: conversation.stage
      });
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

    const text = getMessageText(message);
    if (!text) {
      console.info(`[WA] inbound skipped user=${userId} reason=no_text jid=${remoteJid}`);
      return;
    }

    const phoneNumber = remoteJid.split("@")[0].split(":")[0];
    const conversation = await trackInboundMessage(userId, phoneNumber, text, message.pushName ?? undefined);
    console.info(`[WA] inbound tracked user=${userId} conversation=${conversation.id} phone=${phoneNumber}`);

    realtimeHub.broadcast(userId, "conversation.updated", {
      conversationId: conversation.id,
      phoneNumber,
      direction: "inbound",
      message: text,
      score: conversation.score,
      stage: conversation.stage
    });

    this.enqueueInboundMessage({
      userId,
      remoteJid,
      phoneNumber,
      text,
      conversationId: conversation.id,
      shouldAutoReply
    });
  }
}

export const whatsappSessionManager = new WhatsAppSessionManager();
