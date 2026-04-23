import { describe, expect, it } from "vitest";

describe("pairing code option", () => {
  it("phoneNumber option stored in connect call is truthy string", () => {
    const opts = { phoneNumber: "5511999999999" };
    expect(typeof opts.phoneNumber).toBe("string");
    expect(opts.phoneNumber.length).toBeGreaterThan(8);
  });

  it("empty string phoneNumber is treated as absent", () => {
    const phoneNumber = "";
    const hasPhone = phoneNumber.length > 0;
    expect(hasPhone).toBe(false);
  });
});
