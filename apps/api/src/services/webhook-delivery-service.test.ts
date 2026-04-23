import { describe, expect, it } from "vitest";
import { createHmacSignature } from "./webhook-delivery-service.js";

describe("createHmacSignature", () => {
  it("produces consistent sha256 hmac", () => {
    const sig1 = createHmacSignature("secret", '{"test":1}');
    const sig2 = createHmacSignature("secret", '{"test":1}');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = createHmacSignature("secret", '{"test":1}');
    const sig2 = createHmacSignature("secret", '{"test":2}');
    expect(sig1).not.toBe(sig2);
  });
});
