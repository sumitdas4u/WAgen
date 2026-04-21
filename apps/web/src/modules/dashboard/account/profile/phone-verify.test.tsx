import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockUpdateMyProfile, mockChangePassword } = vi.hoisted(() => ({
  mockUpdateMyProfile: vi.fn(),
  mockChangePassword: vi.fn()
}));

vi.mock("../../../../lib/api", () => ({
  updateMyProfile: (...args: unknown[]) => mockUpdateMyProfile(...args),
  changePassword: (...args: unknown[]) => mockChangePassword(...args)
}));

vi.mock("../../../../lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      phone_number: null,
      phone_verified: false,
      business_type: null,
      subscription_plan: "starter",
      business_basics: {},
      personality: "friendly_warm",
      custom_personality_prompt: null,
      ai_active: true
    },
    refreshUser: vi.fn()
  })
}));

vi.mock("../../../../shared/dashboard/shell-context", () => ({
  useDashboardShell: () => ({
    token: "test-token",
    bootstrap: null,
    refetchBootstrap: vi.fn()
  })
}));

import { Component } from "./route";

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>
  );
}

function getPhoneInput() {
  return screen.getByPlaceholderText("+91XXXXXXXXXX");
}

function getSendOtpBtn() {
  return screen.getByRole("button", { name: /send otp/i });
}

describe("PhoneVerifySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMyProfile.mockResolvedValue({ user: {} });
  });

  it("renders phone input and Send OTP button", () => {
    renderProfile();
    expect(getPhoneInput()).toBeInTheDocument();
    expect(getSendOtpBtn()).toBeInTheDocument();
  });

  it("shows error if phone does not start with +", async () => {
    renderProfile();
    fireEvent.change(getPhoneInput(), { target: { value: "9804735837" } });
    fireEvent.click(getSendOtpBtn());
    expect(await screen.findByText(/international format/i)).toBeInTheDocument();
  });

  it("shows OTP input after local send", async () => {
    renderProfile();
    fireEvent.change(getPhoneInput(), { target: { value: "+919804735837" } });
    fireEvent.click(getSendOtpBtn());
    expect(await screen.findByPlaceholderText("0000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify otp/i })).toBeInTheDocument();
  });

  it("updates profile after correct OTP", async () => {
    renderProfile();
    fireEvent.change(getPhoneInput(), { target: { value: "+919804735837" } });
    fireEvent.click(getSendOtpBtn());
    const otpInput = await screen.findByPlaceholderText("0000");
    fireEvent.change(otpInput, { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: /verify otp/i }));
    expect(await screen.findByText(/verified/i)).toBeInTheDocument();
    expect(mockUpdateMyProfile).toHaveBeenCalledWith(
      "test-token",
      { phoneNumber: "+919804735837", phoneVerified: true }
    );
  });

  it("changes password through local API", async () => {
    mockChangePassword.mockResolvedValue({ ok: true });
    renderProfile();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: "old-pass-123" } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: "new-pass-123" } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: "new-pass-123" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect(mockChangePassword).toHaveBeenCalledWith(
      "test-token",
      { currentPassword: "old-pass-123", newPassword: "new-pass-123" }
    );
  });
});
