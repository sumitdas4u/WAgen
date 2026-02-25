import { BaileysManager } from "./baileysManager";

async function bootstrap(): Promise<void> {
  console.log("[App] Starting WhatsApp AI Agent...");
  const manager = new BaileysManager();
  await manager.start();
}

bootstrap().catch((error) => {
  console.error("[App] Fatal startup error", error);
  process.exit(1);
});

