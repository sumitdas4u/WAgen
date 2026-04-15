import { describe, expect, it } from "vitest";
import {
  detectResponseSeverity,
  estimateConfidenceScore,
  triageCategory
} from "./ai-review-service.js";

describe("detectResponseSeverity", () => {
  it("detects strong_unknown from 'I don't know' variants", () => {
    expect(detectResponseSeverity("I don't know what that is")).toBe("strong_unknown");
    expect(detectResponseSeverity("I'm not sure about that")).toBe("strong_unknown");
    expect(detectResponseSeverity("I'm not familiar with Sujay")).toBe("strong_unknown");
    expect(detectResponseSeverity("unable to find that information")).toBe("strong_unknown");
    expect(detectResponseSeverity("no information available on that topic")).toBe("strong_unknown");
  });

  it("detects fallback from softer deflection patterns", () => {
    expect(detectResponseSeverity("Please contact support for more help")).toBe("fallback");
    expect(detectResponseSeverity("I'm afraid I cannot assist you with that")).toBe("fallback");
    expect(detectResponseSeverity("Please reach out to our team for assistance")).toBe("fallback");
  });

  it("detects clarification patterns", () => {
    expect(detectResponseSeverity("Could you clarify what you mean?")).toBe("clarification");
    expect(detectResponseSeverity("Please clarify your question")).toBe("clarification");
    expect(detectResponseSeverity("Can you be more specific?")).toBe("clarification");
  });

  it("returns null for normal informational responses", () => {
    expect(detectResponseSeverity("Our business hours are 9am to 5pm Monday through Friday.")).toBeNull();
    expect(detectResponseSeverity("Your order has been confirmed and will arrive in 3-5 days.")).toBeNull();
    expect(detectResponseSeverity("We offer three pricing plans: Basic, Pro, and Enterprise.")).toBeNull();
  });

  it("prioritizes strong_unknown over fallback when both match", () => {
    expect(detectResponseSeverity("I don't know, please contact support")).toBe("strong_unknown");
  });
});

describe("estimateConfidenceScore", () => {
  it("scores 65 with 3+ chunks and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: null })).toBe(65);
    expect(estimateConfidenceScore({ retrievalChunks: 5, severity: null })).toBe(65);
  });

  it("scores 58 with 2 chunks and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 2, severity: null })).toBe(58);
  });

  it("scores 50 with 1 chunk and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: null })).toBe(50);
  });

  it("scores 30 with 0 chunks and no signals", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: null })).toBe(30);
  });

  it("applies strong_unknown penalty of -30", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "strong_unknown" })).toBe(0);
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: "strong_unknown" })).toBe(35);
  });

  it("applies fallback penalty of -15", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "fallback" })).toBe(15);
    expect(estimateConfidenceScore({ retrievalChunks: 2, severity: "fallback" })).toBe(43);
  });

  it("applies clarification penalty of -5", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: "clarification" })).toBe(45);
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: "clarification" })).toBe(60);
  });

  it("applies negative feedback penalty of -25", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: null, hasNegativeFeedback: true })).toBe(25);
    expect(estimateConfidenceScore({ retrievalChunks: 3, severity: null, hasNegativeFeedback: true })).toBe(40);
  });

  it("clamps to 0 minimum", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "strong_unknown", hasNegativeFeedback: true })).toBe(0);
  });

  it("clamps to 100 maximum", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 10, severity: null })).toBe(65);
  });
});

describe("triageCategory", () => {
  it("categorizes score >= 60 as noise", () => {
    expect(triageCategory(60)).toBe("noise");
    expect(triageCategory(65)).toBe("noise");
    expect(triageCategory(100)).toBe("noise");
  });

  it("categorizes score 35-59 as monitor", () => {
    expect(triageCategory(35)).toBe("monitor");
    expect(triageCategory(50)).toBe("monitor");
    expect(triageCategory(59)).toBe("monitor");
  });

  it("categorizes score < 35 as review", () => {
    expect(triageCategory(34)).toBe("review");
    expect(triageCategory(15)).toBe("review");
    expect(triageCategory(0)).toBe("review");
  });
});

describe("estimateConfidenceScore — kb_effective boundary", () => {
  it("scores >= 35 (monitor) when KB answered and clarification only", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 1, severity: "clarification" })).toBe(45);
    expect(triageCategory(45)).toBe("monitor");
  });

  it("scores < 35 (review) when strong failure persists after KB resolution", () => {
    expect(estimateConfidenceScore({ retrievalChunks: 0, severity: "strong_unknown" })).toBe(0);
    expect(triageCategory(0)).toBe("review");
  });
});
