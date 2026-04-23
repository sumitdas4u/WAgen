import { describe, expect, it } from "vitest";

function computeChunks(delayMs: number, chunkMs: number): number[] {
  const chunks: number[] = [];
  let remaining = delayMs;
  while (remaining > chunkMs) {
    chunks.push(chunkMs);
    remaining -= chunkMs;
  }
  if (remaining > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

describe("chunked presence timing", () => {
  it("no chunks needed for delay under 20s", () => {
    const chunks = computeChunks(2500, 20_000);
    expect(chunks).toEqual([2500]);
  });

  it("splits 45s into [20000, 20000, 5000]", () => {
    const chunks = computeChunks(45_000, 20_000);
    expect(chunks).toEqual([20_000, 20_000, 5_000]);
  });

  it("splits exactly 20s into [20000]", () => {
    const chunks = computeChunks(20_000, 20_000);
    expect(chunks).toEqual([20_000]);
  });

  it("splits 60s into three 20s chunks", () => {
    const chunks = computeChunks(60_000, 20_000);
    expect(chunks).toEqual([20_000, 20_000, 20_000]);
  });
});
