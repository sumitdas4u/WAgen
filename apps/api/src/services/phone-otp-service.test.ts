import { describe, expect, it } from "vitest";
import { normalizeAccountPhoneNumber, PhoneOtpError } from "./phone-otp-service.js";

describe("normalizeAccountPhoneNumber", () => {
  it("normalizes 10-digit Indian mobile numbers to +91", () => {
    expect(normalizeAccountPhoneNumber("9804735837")).toBe("+919804735837");
  });

  it("keeps valid +91 Indian mobile numbers", () => {
    expect(normalizeAccountPhoneNumber("+91 98047 35837")).toBe("+919804735837");
  });

  it("rejects short Indian mobile numbers with +91 country code", () => {
    expect(() => normalizeAccountPhoneNumber("+91980735837")).toThrow(PhoneOtpError);
  });
});
