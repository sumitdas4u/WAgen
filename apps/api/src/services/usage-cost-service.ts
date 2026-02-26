import { env } from "../config/env.js";

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING_USD: Record<string, ModelPricing> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4-turbo": { inputPerMillion: 10, outputPerMillion: 30 }
};

function fallbackModel(): string {
  const configured = (env.OPENAI_CHAT_MODEL || "").trim().toLowerCase();
  return MODEL_PRICING_USD[configured] ? configured : "gpt-4o-mini";
}

export function normalizeModelName(model: string | null | undefined): string {
  return (model || "").trim().toLowerCase();
}

function resolvePricing(model: string | null | undefined): ModelPricing {
  const normalized = normalizeModelName(model);
  if (MODEL_PRICING_USD[normalized]) {
    return MODEL_PRICING_USD[normalized];
  }
  return MODEL_PRICING_USD[fallbackModel()];
}

export function estimateUsdCost(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = resolvePricing(model);
  const inputCost = (Math.max(0, promptTokens) / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (Math.max(0, completionTokens) / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

export function estimateInrCost(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number
): number {
  return estimateUsdCost(model, promptTokens, completionTokens) * env.USD_TO_INR;
}
