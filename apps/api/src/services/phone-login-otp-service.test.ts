import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn()
}));

vi.mock("../db/pool.js", () => ({
  pool: {
    query: mockPoolQuery,
    connect: vi.fn()
  }
}));

import {
  PhoneOtpError,
  requestPhoneLoginOtp,
  verifyPhoneLoginOtp
} from "./phone-otp-service.js";

describe("phone OTP login", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("requires a verified account before sending login OTP", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await expect(requestPhoneLoginOtp({ phoneNumber: "9804735837" })).rejects.toMatchObject({
      code: "phone_not_found",
      statusCode: 404
    } satisfies Partial<PhoneOtpError>);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("phone_verified = TRUE"),
      ["+919804735837"]
    );
  });

  it("requires a verified account before verifying login OTP", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await expect(verifyPhoneLoginOtp({
      phoneNumber: "+91 98047 35837",
      otp: "123456"
    })).rejects.toMatchObject({
      code: "phone_not_found",
      statusCode: 404
    } satisfies Partial<PhoneOtpError>);

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("phone_verified = TRUE"),
      ["+919804735837"]
    );
  });
});
