import { describe, expect, it, vi } from "vitest";
import { classifyDeliveryFailure } from "./message-delivery-data-service.js";

vi.mock("../config/env.js", () => ({
  env: {
    DELIVERY_PER_CONNECTION_RATE_LIMIT: 10,
    QUEUE_PREFIX: "test"
  }
}));

vi.mock("../db/pool.js", () => ({
  pool: { query: vi.fn() },
  withTransaction: vi.fn()
}));

vi.mock("../db/sql-helpers.js", () => ({
  firstRow: vi.fn(),
  requireRow: vi.fn()
}));

vi.mock("./realtime-hub.js", () => ({
  realtimeHub: {
    broadcast: vi.fn(),
    broadcastMessageUpdated: vi.fn()
  }
}));

describe("classifyDeliveryFailure", () => {
  it("does not suppress a phone number for generic Meta parameter validation errors", () => {
    const result = classifyDeliveryFailure(
      new Error("Meta code 131009: (#131009) Parameter value is not valid."),
      "131009"
    );

    expect(result.category).toBe("unknown");
    expect(result.errorCode).toBe("131009");
    expect(result.suppressionReason).toBeNull();
  });

  it("still suppresses confirmed invalid WhatsApp numbers", () => {
    const result = classifyDeliveryFailure(
      new Error("Meta code 133010: Phone number is not a valid WhatsApp number."),
      "133010"
    );

    expect(result.category).toBe("permanent");
    expect(result.suppressionReason).toBe("invalid_number");
  });
});
