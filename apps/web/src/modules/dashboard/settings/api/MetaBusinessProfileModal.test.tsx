import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaBusinessConnection, MetaBusinessProfile } from "../../../../lib/api";

const apiMocks = vi.hoisted(() => ({
  fetchSettingsMetaProfile: vi.fn(),
  saveSettingsMetaProfile: vi.fn(),
  uploadSettingsMetaProfileLogo: vi.fn()
}));

vi.mock("../api", () => ({
  fetchSettingsMetaProfile: (...args: unknown[]) => apiMocks.fetchSettingsMetaProfile(...args),
  saveSettingsMetaProfile: (...args: unknown[]) => apiMocks.saveSettingsMetaProfile(...args),
  uploadSettingsMetaProfileLogo: (...args: unknown[]) => apiMocks.uploadSettingsMetaProfileLogo(...args)
}));

import { MetaBusinessProfileModal } from "./MetaBusinessProfileModal";

const baseConnection: MetaBusinessConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  metaBusinessId: "business-1",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  displayPhoneNumber: "+91 96741 09091",
  linkedNumber: "919674109091",
  tokenExpiresAt: null,
  enabled: true,
  subscriptionStatus: "active",
  status: "connected",
  billingMode: "none",
  billingStatus: "not_configured",
  billingOwnerBusinessId: null,
  billingAttachedAt: null,
  billingError: null,
  billingCreditLineId: null,
  billingAllocationConfigId: null,
  billingCurrency: null,
  metadata: {
    metaHealth: {
      verifiedName: "Keyline Digitech",
      nameStatus: "APPROVED",
      phoneQualityRating: "GREEN",
      messagingLimitTier: "TIER_1K"
    }
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function makeProfile(overrides: Partial<MetaBusinessProfile> = {}): MetaBusinessProfile {
  return {
    connectionId: baseConnection.id,
    phoneNumberId: "phone-1",
    displayPictureUrl: "https://example.com/profile.jpg",
    address: "12 Market Street",
    businessDescription: "Customer support and order updates",
    email: "support@example.com",
    vertical: "RETAIL",
    websites: ["https://example.com"],
    about: "Usually replies in minutes",
    ...overrides
  };
}

function renderModal(connection: MetaBusinessConnection | null = baseConnection) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MetaBusinessProfileModal token="test-token" connection={connection} onClose={vi.fn()} />
    </QueryClientProvider>
  );
  return { ...result, queryClient };
}

describe("MetaBusinessProfileModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:profile-preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    apiMocks.fetchSettingsMetaProfile.mockResolvedValue({ profile: makeProfile() });
    apiMocks.saveSettingsMetaProfile.mockResolvedValue({ ok: true, profile: makeProfile() });
    apiMocks.uploadSettingsMetaProfileLogo.mockResolvedValue({
      ok: true,
      connectionId: baseConnection.id,
      phoneNumberId: "phone-1",
      handle: "h:uploaded-profile"
    });
  });

  it("loads the selected connection profile into the form", async () => {
    renderModal();

    expect(await screen.findByDisplayValue("Usually replies in minutes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12 Market Street")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Customer support and order updates")).toBeInTheDocument();
    expect(screen.getByDisplayValue("support@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.com")).toBeInTheDocument();
    expect(apiMocks.fetchSettingsMetaProfile).toHaveBeenCalledWith("test-token", baseConnection.id);
  });

  it("clears stale form state when switching connection ids", async () => {
    const secondConnection = {
      ...baseConnection,
      id: "22222222-2222-4222-8222-222222222222",
      phoneNumberId: "phone-2",
      displayPhoneNumber: "+91 90000 00000"
    };
    let resolveSecond: (value: { profile: MetaBusinessProfile }) => void = () => undefined;
    apiMocks.fetchSettingsMetaProfile
      .mockResolvedValueOnce({ profile: makeProfile({ about: "First profile" }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const view = renderModal(baseConnection);
    expect(await screen.findByDisplayValue("First profile")).toBeInTheDocument();

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <MetaBusinessProfileModal token="test-token" connection={secondConnection} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.queryByDisplayValue("First profile")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/loading profile from meta/i);

    resolveSecond({ profile: makeProfile({ connectionId: secondConnection.id, about: "Second profile" }) });
    expect(await screen.findByDisplayValue("Second profile")).toBeInTheDocument();
  });

  it("shows counters and blocks invalid email, about, and website input", async () => {
    renderModal();
    const about = await screen.findByLabelText("About");
    fireEvent.change(about, { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad-email" } });
    fireEvent.change(screen.getByLabelText("Website 1"), { target: { value: "example.com" } });

    expect(screen.getByText("0/139")).toBeInTheDocument();
    expect(screen.getByText("About cannot be only spaces.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Website must start with http:// or https:// and be valid.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save profile/i })).toBeDisabled();
  });

  it("uploads a selected image before saving with the returned handle", async () => {
    renderModal();
    await screen.findByDisplayValue("Usually replies in minutes");

    const file = new File(["avatar"], "avatar.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Profile picture"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Website 1"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByLabelText("Website 2"), { target: { value: "https://instagram.com/keyline" } });
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => expect(apiMocks.uploadSettingsMetaProfileLogo).toHaveBeenCalledWith("test-token", file, baseConnection.id));
    await waitFor(() => expect(apiMocks.saveSettingsMetaProfile).toHaveBeenCalled());
    expect(apiMocks.uploadSettingsMetaProfileLogo.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.saveSettingsMetaProfile.mock.invocationCallOrder[0]
    );
    expect(apiMocks.saveSettingsMetaProfile).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({
        connectionId: baseConnection.id,
        profilePictureHandle: "h:uploaded-profile",
        websites: ["https://example.com", "https://instagram.com/keyline"]
      })
    );
  });
});
