import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage
} from "@whiskeysockets/baileys";
import { env } from "../config/env.js";
import { getUserById } from "./user-service.js";
import { clearAuthStateCache, useDbAuthState } from "./baileys-auth-state.js";
import {
  getOrCreateWhatsAppSession,
  getWhatsAppStatus,
  updateWhatsAppStatus
} from "./whatsapp-session-store.js";
import { realtimeHub } from "./realtime-hub.js";
import { getMessageText, randomInt, wait } from "../utils/index.js";
import {
  getConversationHistoryForPrompt,
  trackInboundMessage,
  trackOutboundMessage
} from "./conversation-service.js";
import { buildSalesReply } from "./ai-reply-service.js";

interface SessionRuntime {
  socket: WASocket;
  qr: string | null;
  status: "connected" | "connecting" | "disconnected";
}

function isDirectChatJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

class WhatsAppSessionManager {
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly activeConnectAttempts = new Set<string>();

  async connectUser(userId: string): Promise<void> {
    if (this.activeConnectAttempts.has(userId)) {
      return;
    }

    const existing = this.sessions.get(userId);
    if (existing?.status === "connected" || existing?.status === "connecting") {
      return;
    }

    this.activeConnectAttempts.add(userId);
    try {
      await getOrCreateWhatsAppSession(userId);
      await updateWhatsAppStatus(userId, "connecting");
      realtimeHub.broadcast(userId, "whatsapp.status", { status: "connecting" });

      // Always refresh auth snapshot from DB when opening a new socket.
      clearAuthStateCache(userId);
      const { state, saveCreds } = await useDbAuthState(userId);
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["WAgen", "Chrome", "1.0.0"]
      });

      this.sessions.set(userId, {
        socket,
        qr: null,
        status: "connecting"
      });

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        const runtime = this.sessions.get(userId);
        if (!runtime) {
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
          const phone = socket.user?.id?.split(":")[0] ?? null;
          await updateWhatsAppStatus(userId, "connected", phone ?? undefined);
          realtimeHub.broadcast(userId, "whatsapp.status", {
            status: "connected",
            phoneNumber: phone
          });
        }

        if (update.connection === "close") {
          runtime.status = "disconnected";
          await updateWhatsAppStatus(userId, "disconnected");
          realtimeHub.broadcast(userId, "whatsapp.status", { status: "disconnected" });

          const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode;
          const shouldReconnect = env.AUTO_RECONNECT && statusCode !== DisconnectReason.loggedOut;

          this.sessions.delete(userId);
          if (shouldReconnect) {
            setTimeout(() => {
              void this.connectUser(userId);
            }, 1500);
          }
        }
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        const shouldAutoReply = type === "notify";
        if (type !== "notify" && type !== "append") {
          return;
        }

        if (type === "notify") {
          console.info(`[WA] messages.upsert user=${userId} type=${type} count=${messages.length}`);
        }

        for (const message of messages) {
          try {
            await this.handleInboundMessage(userId, socket, message, shouldAutoReply);
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

  private async handleInboundMessage(
    userId: string,
    socket: WASocket,
    message: WAMessage,
    shouldAutoReply: boolean
  ): Promise<void> {
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

    if (!shouldAutoReply) {
      console.info(`[WA] auto-reply skipped user=${userId} reason=non_notify_event conversation=${conversation.id}`);
      return;
    }

    const user = await getUserById(userId);
    if (!user) {
      console.info(`[WA] auto-reply skipped user=${userId} reason=missing_user conversation=${conversation.id}`);
      return;
    }

    if (!user.ai_active) {
      console.info(`[WA] auto-reply skipped user=${userId} reason=agent_inactive conversation=${conversation.id}`);
      return;
    }

    if (conversation.manual_takeover) {
      console.info(`[WA] auto-reply skipped user=${userId} reason=manual_takeover conversation=${conversation.id}`);
      return;
    }

    if (conversation.ai_paused) {
      console.info(`[WA] auto-reply skipped user=${userId} reason=conversation_paused conversation=${conversation.id}`);
      return;
    }

    if (conversation.last_ai_reply_at) {
      const elapsedSeconds = (Date.now() - new Date(conversation.last_ai_reply_at).getTime()) / 1000;
      if (elapsedSeconds < env.CONTACT_COOLDOWN_SECONDS) {
        console.info(
          `[WA] auto-reply skipped user=${userId} reason=cooldown conversation=${conversation.id} elapsed=${Math.round(
            elapsedSeconds
          )}s required=${env.CONTACT_COOLDOWN_SECONDS}s`
        );
        return;
      }
    }

    const history = await getConversationHistoryForPrompt(conversation.id, 10);
    const reply = await buildSalesReply({
      user,
      incomingMessage: text,
      conversationPhone: phoneNumber,
      history
    });

    const delay = randomInt(env.REPLY_DELAY_MIN_MS, env.REPLY_DELAY_MAX_MS);
    console.info(`[WA] auto-reply pending user=${userId} conversation=${conversation.id} delayMs=${delay}`);
    await wait(delay);

    await socket.sendMessage(remoteJid, { text: reply });
    await trackOutboundMessage(conversation.id, reply);
    console.info(`[WA] auto-reply sent user=${userId} conversation=${conversation.id} phone=${phoneNumber}`);

    realtimeHub.broadcast(userId, "conversation.updated", {
      conversationId: conversation.id,
      phoneNumber,
      direction: "outbound",
      message: reply,
      score: conversation.score,
      stage: conversation.stage
    });
  }
}

export const whatsappSessionManager = new WhatsAppSessionManager();
