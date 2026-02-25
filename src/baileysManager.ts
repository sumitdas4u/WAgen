import * as baileys from "@whiskeysockets/baileys";
import type { WASocket, ConnectionState, WAMessageUpsertType, WAMessage } from "@whiskeysockets/baileys";
import { delay } from "./utils/delay";
import { MessageHandler } from "./messageHandler";

interface ConnectionErrorLike {
  output?: {
    statusCode?: number;
  };
}

export class BaileysManager {
  private sock: WASocket | null = null;
  private messageHandler: MessageHandler | null = null;
  private reconnecting = false;

  async start(): Promise<void> {
    const { state, saveCreds } = await baileys.useMultiFileAuthState("auth");
    const { version, isLatest } = await baileys.fetchLatestBaileysVersion();

    console.log(`[Baileys] Starting socket with WA web version: ${version.join(".")} (latest=${isLatest})`);

    const sock = (baileys.default ?? (baileys as any).makeWASocket)({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ["WAgen Queue Bot", "Chrome", "1.0.0"],
      markOnlineOnConnect: false
    });

    this.sock = sock;
    this.messageHandler = new MessageHandler(sock);
    this.reconnecting = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
      if (update.qr) {
        console.log("[Baileys] QR generated. Scan it with WhatsApp Linked Devices.");
      }

      if (update.connection === "open") {
        console.log("[Baileys] Connected. Listening for incoming messages...");
      }

      if (update.connection === "close") {
        const statusCode = (update.lastDisconnect?.error as ConnectionErrorLike | undefined)?.output?.statusCode;
        const loggedOut = statusCode === (baileys.DisconnectReason as any).loggedOut;

        console.error(`[Baileys] Connection closed (statusCode=${statusCode ?? "unknown"}).`);

        if (loggedOut) {
          console.error("[Baileys] Logged out. Delete ./auth folder and restart to pair again.");
          return;
        }

        await this.reconnect();
      }
    });

    sock.ev.on("messages.upsert", async (payload: { messages: WAMessage[]; type: WAMessageUpsertType }) => {
      if (!this.messageHandler) {
        return;
      }

      try {
        await this.messageHandler.handleUpsert(payload);
      } catch (error) {
        console.error("[Baileys] messages.upsert handler error", error);
      }
    });
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) {
      return;
    }

    this.reconnecting = true;
    console.log("[Baileys] Reconnecting in 2 seconds...");
    await delay(2000);

    try {
      await this.start();
    } catch (error) {
      console.error("[Baileys] Reconnect attempt failed", error);
      this.reconnecting = false;
      await delay(3000);
      await this.reconnect();
    }
  }
}

