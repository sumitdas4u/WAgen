/**
 * ai-service.ts — unified AI entry point
 *
 * Drop-in replacement for openai-service.ts.  All callers import `aiService`
 * from here instead of `openAIService` from openai-service.ts.
 *
 * The active provider is read from app_settings (key: 'ai_provider_config')
 * and cached for 60 s so every request does not hit the DB.  When no override
 * is stored the system falls back to the OpenAI env-var configuration.
 *
 * Provider config shape stored in app_settings:
 *   { provider: 'openai' | 'anthropic' | 'gemini', apiKey: string, model?: string }
 *
 * Embedding special-case:
 *   Anthropic has no embeddings API.  When Anthropic is the active chat
 *   provider the embed/embedMany calls are automatically routed to the OpenAI
 *   adapter (using the env OPENAI_API_KEY) so the RAG pipeline keeps working.
 */

import { firstRow } from "../db/sql-helpers.js";
import { pool } from "../db/pool.js";
import { env } from "../config/env.js";
import { OpenAIAdapter }    from "./ai-providers/openai.adapter.js";
import { AnthropicAdapter } from "./ai-providers/anthropic.adapter.js";
import { GeminiAdapter }    from "./ai-providers/gemini.adapter.js";
import type { AIProvider, AIReplyResult, AIGenerateOptions } from "./ai-providers/interface.js";

export type SupportedProvider = "openai" | "anthropic" | "gemini";

interface ProviderConfig {
  provider: SupportedProvider;
  apiKey: string;
  model?: string;
}

// ── Provider list exposed to the admin UI ─────────────────────────────────────
export const SUPPORTED_PROVIDERS: Array<{
  id: SupportedProvider;
  label: string;
  chatModels: string[];
  supportsEmbeddings: boolean;
  supportsVision: boolean;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    chatModels: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o", "o4-mini"],
    supportsEmbeddings: true,
    supportsVision: true
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    chatModels: [
      "claude-3-5-haiku-20241022",
      "claude-3-5-sonnet-20241022",
      "claude-opus-4-5",
      "claude-sonnet-4-5"
    ],
    supportsEmbeddings: false,
    supportsVision: true
  },
  {
    id: "gemini",
    label: "Google Gemini",
    chatModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    supportsEmbeddings: true,
    supportsVision: true
  }
];

// ── Simple TTL cache ──────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
let cachedConfig: ProviderConfig | null = null;
let cacheExpiry = 0;

async function loadProviderConfig(): Promise<ProviderConfig | null> {
  if (cachedConfig && Date.now() < cacheExpiry) return cachedConfig;
  try {
    const result = await pool.query<{ value_json: unknown }>(
      `SELECT value_json FROM app_settings WHERE key = 'ai_provider_config' LIMIT 1`
    );
    const raw = firstRow(result)?.value_json as Record<string, unknown> | undefined;
    if (
      raw &&
      typeof raw.provider === "string" &&
      typeof raw.apiKey === "string" &&
      raw.apiKey.length > 0
    ) {
      cachedConfig = {
        provider: raw.provider as SupportedProvider,
        apiKey: raw.apiKey,
        model: typeof raw.model === "string" ? raw.model : undefined
      };
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return cachedConfig;
    }
  } catch {
    // DB unavailable — fall through to env fallback
  }
  cachedConfig = null;
  return null;
}

function buildProvider(config: ProviderConfig): AIProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter(config.apiKey);
    case "gemini":
      return new GeminiAdapter(config.apiKey);
    default:
      return new OpenAIAdapter(config.apiKey);
  }
}

/** Fallback embed provider — always OpenAI via env key (for Anthropic chat mode). */
function buildEmbedFallback(): OpenAIAdapter {
  return new OpenAIAdapter(env.OPENAI_API_KEY);
}

// ── AIService ─────────────────────────────────────────────────────────────────

class AIService {
  /** Resolves the active chat provider from DB config or env fallback. */
  private async chatProvider(): Promise<AIProvider> {
    const config = await loadProviderConfig();
    if (config) return buildProvider(config);
    return new OpenAIAdapter(); // env-var fallback
  }

  /** Resolves the active embed provider.  Falls back to OpenAI when the chat
   *  provider doesn't support embeddings (e.g. Anthropic). */
  private async embedProvider(): Promise<AIProvider> {
    const config = await loadProviderConfig();
    if (!config) return new OpenAIAdapter();
    const provider = buildProvider(config);
    if (provider.capabilities.embeddings) return provider;
    // Anthropic selected but no embeddings — use OpenAI env key
    const fallback = buildEmbedFallback();
    if (fallback.isConfigured()) return fallback;
    throw new Error(
      `${config.provider} does not support embeddings and no OPENAI_API_KEY is set for the fallback embed provider.`
    );
  }

  isConfigured(): boolean {
    // True if the env key is set OR a DB provider config is cached.
    // The DB config is populated on the first successful AI call, so after
    // the first request this accurately reflects Anthropic/Gemini setups too.
    if (env.OPENAI_API_KEY) return true;
    if (cachedConfig && Date.now() < cacheExpiry) return true;
    return false;
  }

  async embed(text: string): Promise<number[]> {
    return (await this.embedProvider()).embed(text);
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return (await this.embedProvider()).embedMany(texts);
  }

  async generateReply(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    options?: AIGenerateOptions
  ): Promise<AIReplyResult> {
    const provider = await this.chatProvider();
    const config = await loadProviderConfig();
    // Prefer the per-provider stored model over modelOverride when set
    const resolvedModel = modelOverride || config?.model || undefined;
    return provider.generateReply(systemPrompt, userPrompt, resolvedModel, options);
  }

  async generateJson(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string
  ): Promise<Record<string, unknown>> {
    const provider = await this.chatProvider();
    const config = await loadProviderConfig();
    const resolvedModel = modelOverride || config?.model || undefined;
    return provider.generateJson(systemPrompt, userPrompt, resolvedModel);
  }

  async extractTextFromImage(
    imageBuffer: Buffer,
    mimeType: string,
    modelOverride?: string
  ): Promise<string> {
    return (await this.chatProvider()).extractTextFromImage(imageBuffer, mimeType, modelOverride);
  }

  async analyzeImage(
    imageBuffer: Buffer,
    mimeType: string,
    modelOverride?: string
  ): Promise<string> {
    return (await this.chatProvider()).analyzeImage(imageBuffer, mimeType, modelOverride);
  }
}

export const aiService = new AIService();

// ── Admin helpers ─────────────────────────────────────────────────────────────

export async function getActiveProviderConfig(): Promise<ProviderConfig | null> {
  return loadProviderConfig();
}

export async function setActiveProviderConfig(config: ProviderConfig): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES ('ai_provider_config', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [JSON.stringify(config)]
  );
  // Bust cache immediately
  cachedConfig = null;
  cacheExpiry = 0;
}

export async function clearActiveProviderConfig(): Promise<void> {
  await pool.query(`DELETE FROM app_settings WHERE key = 'ai_provider_config'`);
  cachedConfig = null;
  cacheExpiry = 0;
}
