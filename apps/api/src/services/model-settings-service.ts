import { pool } from "../db/pool.js";
import { env } from "../config/env.js";

const AVAILABLE_MODELS = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o",
  "o4-mini"
] as const;

function normalizeModel(model: string): string {
  return model.trim();
}

export function listAvailableChatModels(): string[] {
  return [...AVAILABLE_MODELS];
}

export function getDefaultChatModel(): string {
  return env.OPENAI_CHAT_MODEL;
}

export function isAllowedChatModel(model: string): boolean {
  return listAvailableChatModels().includes(normalizeModel(model));
}

export async function getChatModelOverride(): Promise<string | null> {
  const result = await pool.query<{ value_json: { model?: string } }>(
    `SELECT value_json
     FROM app_settings
     WHERE key = 'global_chat_model'
     LIMIT 1`
  );

  const raw = result.rows[0]?.value_json?.model;
  if (!raw || typeof raw !== "string") {
    return null;
  }

  const model = normalizeModel(raw);
  return model || null;
}

export async function getEffectiveChatModel(): Promise<string> {
  const override = await getChatModelOverride();
  return override || getDefaultChatModel();
}

export async function setChatModelOverride(model: string): Promise<void> {
  const normalized = normalizeModel(model);
  await pool.query(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES ('global_chat_model', $1::jsonb, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [JSON.stringify({ model: normalized })]
  );
}
