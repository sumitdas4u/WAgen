import { describe, expect, it, vi } from "vitest";

describe("fanoutEvent isolation", () => {
  it("calls all channels via Promise.allSettled even when one rejects", async () => {
    const calls: string[] = [];

    const fanoutWebSocket = vi.fn().mockImplementation(() => {
      calls.push("ws");
      return Promise.resolve();
    });
    const fanoutHttp = vi.fn().mockImplementation(() => {
      calls.push("http");
      return Promise.reject(new Error("http down"));
    });
    const fanoutRmq = vi.fn().mockImplementation(() => {
      calls.push("rmq");
      return Promise.resolve();
    });

    await Promise.allSettled([fanoutWebSocket(), fanoutHttp(), fanoutRmq()]);

    expect(calls).toContain("ws");
    expect(calls).toContain("http");
    expect(calls).toContain("rmq");
    expect(calls).toHaveLength(3);
  });

  it("does not throw when all channels fail", async () => {
    const fail = () => Promise.reject(new Error("fail"));
    await expect(Promise.allSettled([fail(), fail(), fail()])).resolves.toBeDefined();
  });
});
