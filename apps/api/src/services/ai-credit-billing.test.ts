import { describe, expect, it } from "vitest";
import {
  AiTokenLimitExceededError,
  estimateRequiredCredits,
  estimateTextTokens,
  getCreditsForAction,
  getMaxTokensForAction
} from "./ai-token-service.js";
import {
  AI_RECHARGE_PACK_CREDITS,
  computeRechargePriceForCredits,
  isStandardAIRechargePack
} from "./workspace-billing-center-service.js";

describe("AI credit billing helpers", () => {
  it("keeps standard recharge packs and prices fixed", () => {
    expect(AI_RECHARGE_PACK_CREDITS).toEqual([120, 260, 600]);
    expect(computeRechargePriceForCredits(120).totalPaise).toBe(49_900);
    expect(computeRechargePriceForCredits(260).totalPaise).toBe(99_900);
    expect(computeRechargePriceForCredits(600).totalPaise).toBe(199_900);
  });

  it("rejects arbitrary recharge amounts", () => {
    expect(isStandardAIRechargePack(121)).toBe(false);
    expect(() => computeRechargePriceForCredits(121)).toThrow(/Invalid AI recharge pack/);
  });

  it("uses weighted action credits as the floor", () => {
    expect(getCreditsForAction("chatbot_reply")).toBe(1);
    expect(getCreditsForAction("template_generate")).toBe(8);
    expect(estimateRequiredCredits("template_generate", { estimatedTokens: 100 })).toBe(8);
  });

  it("scales estimated credits with token volume", () => {
    expect(estimateRequiredCredits("rag_query", { estimatedTokens: 8_000 })).toBe(1);
    expect(estimateRequiredCredits("rag_query", { estimatedTokens: 8_001 })).toBe(2);
  });

  it("blocks prompts above the action token guard", () => {
    expect(getMaxTokensForAction("ai_text_assist")).toBe(4_000);
    expect(() =>
      estimateRequiredCredits("ai_text_assist", { estimatedTokens: 4_001 })
    ).toThrow(AiTokenLimitExceededError);
  });

  it("estimates text tokens with the same rough character ratio used by prechecks", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
  });
});
