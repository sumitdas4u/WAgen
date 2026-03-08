import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MetaBusinessConfig, MetaBusinessStatus } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { SettingsTab } from "../../../pages/dashboard/tabs/settings-tab";
import { API_URL } from "../../../shared/api/client";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import { DashboardIcon } from "../../../shared/dashboard/icons";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import {
  activateQrChannel,
  completeMetaSignup,
  deactivateMetaChannel,
  deactivateQrChannel,
  deleteAccount,
  fetchSettingsMetaStatus,
  toggleWebsiteAgent
} from "./api";
import { useSettingsMetaConfigQuery, useSettingsMetaStatusQuery } from "./queries";

type SettingsSubmenu = "setup_web" | "setup_qr" | "setup_api";

type WidgetSetupDraft = {
  chatbotLogoUrl: string;
  chatbotSize: "small" | "medium" | "large";
  deviceVisibility: "both" | "phone" | "desktop";
  initialQuestions: [string, string, string];
  initialGreetingEnabled: boolean;
  initialGreeting: string;
  disclaimer: string;
  backgroundColor: string;
  previewOpen: boolean;
};

type WhatsAppBusinessProfileDraft = {
  displayPictureUrl: string;
  address: string;
  businessDescription: string;
  email: string;
  vertical: string;
  websiteUrl: string;
  about: string;
};

type EmbeddedSignupSnapshot = {
  metaBusinessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
};

type FacebookLoginResponse = {
  authResponse?: {
    code?: string;
  };
  status?: string;
};

declare global {
  interface Window {
    FB?: {
      init: (options: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }) => void;
      login: (
        callback: (response: FacebookLoginResponse) => void,
        options?: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit?: () => void;
    __wagenFacebookSdkPromise?: Promise<void>;
  }
}

const FACEBOOK_SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

const DEFAULT_WIDGET_SETUP_DRAFT: WidgetSetupDraft = {
  chatbotLogoUrl: "",
  chatbotSize: "medium",
  deviceVisibility: "both",
  initialQuestions: ["", "", ""],
  initialGreetingEnabled: true,
  initialGreeting: "Have questions about our business?",
  disclaimer: "Hey, how can I help you today?",
  backgroundColor: "#1a2b48",
  previewOpen: true
};

const DEFAULT_WHATSAPP_BUSINESS_PROFILE_DRAFT: WhatsAppBusinessProfileDraft = {
  displayPictureUrl: "",
  address: "",
  businessDescription: "",
  email: "",
  vertical: "Restaurant",
  websiteUrl: "",
  about: ""
};

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeHexColor(value: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }
  return "#1a2b48";
}

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readMetaString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function formatMetaStatusLabel(value: string | null | undefined, fallback = "Not available"): string {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }
  if (/^TIER_/i.test(raw)) {
    return raw.toUpperCase();
  }
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function parseMetaTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toLocaleString();
}

function parseEmbeddedSignupEventData(rawData: unknown): EmbeddedSignupSnapshot | null {
  let payload: unknown = rawData;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const candidate =
    root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;

  const read = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  const snapshot: EmbeddedSignupSnapshot = {
    metaBusinessId: read(candidate.business_id ?? candidate.businessId ?? candidate.meta_business_id),
    wabaId: read(candidate.waba_id ?? candidate.whatsapp_business_account_id),
    phoneNumberId: read(candidate.phone_number_id ?? candidate.phoneNumberId),
    displayPhoneNumber: read(candidate.display_phone_number ?? candidate.displayPhoneNumber)
  };

  if (!snapshot.metaBusinessId && !snapshot.wabaId && !snapshot.phoneNumberId && !snapshot.displayPhoneNumber) {
    return null;
  }
  return snapshot;
}

async function ensureFacebookSdk(appId: string, graphVersion: string): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Facebook SDK is only available in browser.");
  }

  const initSdk = () => {
    if (!window.FB) {
      throw new Error("Facebook SDK failed to initialize.");
    }
    window.FB.init({
      appId,
      cookie: true,
      xfbml: false,
      version: graphVersion
    });
  };

  if (window.FB) {
    initSdk();
    return;
  }

  if (!window.__wagenFacebookSdkPromise) {
    window.__wagenFacebookSdkPromise = new Promise<void>((resolve, reject) => {
      window.fbAsyncInit = () => {
        try {
          initSdk();
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      const existing = document.querySelector<HTMLScriptElement>("script[data-wagen-facebook-sdk='true']");
      if (existing) {
        existing.addEventListener("load", () => window.fbAsyncInit?.());
        existing.addEventListener("error", () => reject(new Error("Failed to load Facebook SDK script.")));
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = FACEBOOK_SDK_URL;
      script.dataset.wagenFacebookSdk = "true";
      script.onload = () => window.fbAsyncInit?.();
      script.onerror = () => reject(new Error("Failed to load Facebook SDK script."));
      document.body.appendChild(script);
    });
  }

  await window.__wagenFacebookSdkPromise;
  initSdk();
}

function formatPhone(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) {
    return value;
  }
  return `+${digits}`;
}

export function SettingsPage({ submenu }: { submenu: SettingsSubmenu }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const { token, bootstrap, refetchBootstrap } = useDashboardShell();
  const widgetPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [widgetSetupDraft, setWidgetSetupDraft] = useState(DEFAULT_WIDGET_SETUP_DRAFT);
  const [whatsAppBusinessDraft, setWhatsAppBusinessDraft] = useState(DEFAULT_WHATSAPP_BUSINESS_PROFILE_DRAFT);
  const [widgetSnippetCopied, setWidgetSnippetCopied] = useState<"idle" | "copied" | "error">("idle");
  const [metaApiSetupLoading, setMetaApiSetupLoading] = useState(false);
  const [metaApiSetupLoadingText, setMetaApiSetupLoadingText] = useState<string | null>(null);
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const metaConfigQuery = useSettingsMetaConfigQuery(token);
  const metaStatusQuery = useSettingsMetaStatusQuery(token);
  const metaBusinessStatus = metaStatusQuery.data ?? bootstrap?.channelSummary.metaApi ?? ({ connected: false, connection: null } as MetaBusinessStatus);
  const metaBusinessConfig = metaConfigQuery.data ?? null;

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const widgetKey = `wagenai_widget_setup_draft_${user.id}`;
    const apiKey = `wagenai_whatsapp_business_profile_draft_${user.id}`;
    try {
      const rawWidget = window.localStorage.getItem(widgetKey);
      if (rawWidget) {
        const parsed = JSON.parse(rawWidget) as Partial<WidgetSetupDraft>;
        setWidgetSetupDraft({
          ...DEFAULT_WIDGET_SETUP_DRAFT,
          ...parsed,
          initialQuestions: [
            parsed.initialQuestions?.[0] ?? "",
            parsed.initialQuestions?.[1] ?? "",
            parsed.initialQuestions?.[2] ?? ""
          ],
          backgroundColor: normalizeHexColor(parsed.backgroundColor ?? DEFAULT_WIDGET_SETUP_DRAFT.backgroundColor)
        });
      }
    } catch {
      // Ignore malformed local draft.
    }

    try {
      const rawApi = window.localStorage.getItem(apiKey);
      if (rawApi) {
        const parsed = JSON.parse(rawApi) as Partial<WhatsAppBusinessProfileDraft>;
        setWhatsAppBusinessDraft({
          ...DEFAULT_WHATSAPP_BUSINESS_PROFILE_DRAFT,
          ...parsed
        });
      }
    } catch {
      // Ignore malformed local draft.
    }
  }, [user?.id]);

  useEffect(() => {
    if (!widgetSetupDraft.previewOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      const element = widgetPreviewScrollRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    }, 40);

    return () => window.clearTimeout(timer);
  }, [widgetSetupDraft.previewOpen, widgetSetupDraft.initialGreeting, widgetSetupDraft.disclaimer]);

  const metaHealthRecord = getNestedRecord(metaBusinessStatus.connection?.metadata?.metaHealth);
  const apiBusinessVerificationStatus = readMetaString(metaHealthRecord, "businessVerificationStatus");
  const apiWabaReviewStatus = readMetaString(metaHealthRecord, "wabaReviewStatus");
  const apiQualityRating = readMetaString(metaHealthRecord, "phoneQualityRating");
  const apiMessagingLimitTier = readMetaString(metaHealthRecord, "messagingLimitTier");
  const apiCodeVerificationStatus = readMetaString(metaHealthRecord, "codeVerificationStatus");
  const apiNameStatus = readMetaString(metaHealthRecord, "nameStatus");
  const apiLastMetaSyncLabel = parseMetaTimestamp(readMetaString(metaHealthRecord, "syncedAt"));
  const apiBusinessVerificationLower = (apiBusinessVerificationStatus ?? "").toLowerCase();
  const apiBusinessVerificationPending = !/(verified|approved|complete)/.test(apiBusinessVerificationLower);
  const widgetThemeColor = normalizeHexColor(widgetSetupDraft.backgroundColor);
  const widgetPreviewSizeClass =
    widgetSetupDraft.chatbotSize === "small"
      ? "size-small"
      : widgetSetupDraft.chatbotSize === "large"
        ? "size-large"
        : "size-medium";
  const widgetGreetingText = (
    widgetSetupDraft.initialGreetingEnabled ? widgetSetupDraft.initialGreeting : widgetSetupDraft.disclaimer
  ).trim() || "Hi there, how can we help you?";
  const widgetScriptSnippet =
    `<script src="${escapeHtmlAttribute(API_URL)}/sdk/chatbot.bundle.js" ` +
    `wid="${escapeHtmlAttribute(user?.id ?? "")}" ` +
    `data-theme-color="${escapeHtmlAttribute(widgetThemeColor)}" ` +
    `data-position="right" ` +
    `data-greeting="${escapeHtmlAttribute(widgetGreetingText)}" ` +
    `data-api-base="${escapeHtmlAttribute(API_URL)}"></script>`;

  const setBusyState = (nextBusy: boolean) => {
    setBusy(nextBusy);
    if (!nextBusy) {
      setMetaApiSetupLoading(false);
      setMetaApiSetupLoadingText(null);
    }
  };

  const updateShellState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsRoot }),
      refetchBootstrap()
    ]);
  };

  const websiteToggleMutation = useMutation({
    mutationFn: () => toggleWebsiteAgent(token, !Boolean(bootstrap?.userSummary.aiActive)),
    onSuccess: async () => {
      await updateShellState();
      setInfo(bootstrap?.userSummary.aiActive ? "Agent paused." : "Agent activated.");
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const qrToggleMutation = useMutation({
    mutationFn: async () => {
      if (bootstrap?.channelSummary.whatsapp.status === "connected") {
        await deactivateQrChannel(token);
        return "QR channel deactivated.";
      }
      await activateQrChannel(token);
      return "QR channel activated. Open QR setup to scan and complete connection.";
    },
    onSuccess: async (message) => {
      await updateShellState();
      setInfo(message);
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const apiDisconnectMutation = useMutation({
    mutationFn: () => deactivateMetaChannel(token, metaBusinessStatus.connection?.id),
    onSuccess: async () => {
      await updateShellState();
      setInfo("Official WhatsApp API channel deactivated.");
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => deleteAccount(token),
    onSuccess: async () => {
      await logout();
      navigate("/signup", { replace: true });
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const refreshMetaApiStatus = async () => {
    setBusy(true);
    setMetaApiSetupLoading(true);
    setMetaApiSetupLoadingText("Refreshing channel status from Meta...");
    setError(null);
    setInfo(null);
    try {
      await fetchSettingsMetaStatus(token, true);
      await updateShellState();
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus });
      setInfo("Meta business details refreshed from API.");
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setBusyState(false);
    }
  };

  const openBusinessApiSetup = async () => {
    setBusy(true);
    setMetaApiSetupLoading(true);
    setMetaApiSetupLoadingText("Opening Facebook login...");
    setError(null);
    setInfo(null);

    try {
      const config: MetaBusinessConfig | null =
        metaBusinessConfig ?? (await queryClient.fetchQuery({
          queryKey: dashboardQueryKeys.settingsMetaConfig,
          queryFn: () => metaConfigQuery.refetch().then((response) => response.data ?? null)
        }));

      if (!config || !config.configured || !config.appId || !config.embeddedSignupConfigId) {
        throw new Error(
          "Business API onboarding is not configured yet. Add Meta App settings in backend environment first."
        );
      }

      await ensureFacebookSdk(config.appId, config.graphVersion);
      setMetaApiSetupLoadingText("Waiting for Facebook authorization...");
      const captured: EmbeddedSignupSnapshot = {};
      const redirectUri = config.redirectUri || `${window.location.origin}/meta-callback`;

      const messageListener = (event: MessageEvent) => {
        const originHost = (() => {
          try {
            return new URL(event.origin).hostname;
          } catch {
            return "";
          }
        })();
        if (!originHost.endsWith("facebook.com") && !originHost.endsWith("fbcdn.net")) {
          return;
        }
        const details = parseEmbeddedSignupEventData(event.data);
        if (details) {
          Object.assign(captured, details);
        }
      };

      window.addEventListener("message", messageListener);
      try {
        const response = await new Promise<FacebookLoginResponse>((resolve) => {
          window.FB?.login(
            (fbResponse) => resolve(fbResponse ?? {}),
            {
              config_id: config.embeddedSignupConfigId,
              response_type: "code",
              override_default_response_type: true,
              redirect_uri: redirectUri
            }
          );
        });

        const code = response.authResponse?.code?.trim();
        if (!code) {
          throw new Error("Meta signup was cancelled or did not return an authorization code.");
        }

        setMetaApiSetupLoadingText("Connecting number and syncing Meta status...");
        await completeMetaSignup(token, {
          code,
          redirectUri,
          ...captured
        });

        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.settingsMetaStatus });
        await updateShellState();
        setInfo("Official WhatsApp Business API connected successfully.");
      } finally {
        window.removeEventListener("message", messageListener);
      }
    } catch (setupError) {
      setError((setupError as Error).message);
    } finally {
      setBusyState(false);
    }
  };

  const currentBusy =
    busy ||
    websiteToggleMutation.isPending ||
    qrToggleMutation.isPending ||
    apiDisconnectMutation.isPending ||
    deleteAccountMutation.isPending;

  return (
    <section className="finance-shell">
      {(info || error) && (
        <article className="finance-panel">
          {info ? <p className="info-text">{info}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </article>
      )}
      <SettingsTab
        websiteChannelEnabled={Boolean(bootstrap?.userSummary.aiActive)}
        qrChannelConnected={bootstrap?.channelSummary.whatsapp.status === "connected"}
        apiChannelConnected={Boolean(metaBusinessStatus.connected)}
        busy={currentBusy}
        settingsSubmenu={submenu}
        widgetSetupDraft={widgetSetupDraft}
        widgetThemeColor={widgetThemeColor}
        widgetScriptSnippet={widgetScriptSnippet}
        widgetSnippetCopied={widgetSnippetCopied}
        widgetPreviewSizeClass={widgetPreviewSizeClass}
        companyLabel={bootstrap?.userSummary.name ?? "WAgen AI"}
        widgetPreviewScrollRef={widgetPreviewScrollRef}
        qrStatus={bootstrap?.channelSummary.whatsapp.status ?? "disconnected"}
        qrPhoneNumber={bootstrap?.channelSummary.whatsapp.phoneNumber ?? null}
        qrHasQr={Boolean(bootstrap?.channelSummary.whatsapp.hasQr)}
        formatPhone={formatPhone}
        formatMetaStatusLabel={formatMetaStatusLabel}
        apiBusinessVerificationStatus={apiBusinessVerificationStatus}
        apiBusinessVerificationPending={apiBusinessVerificationPending}
        apiConnectionStatus={metaBusinessStatus.connection?.status ?? "disconnected"}
        apiLinkedNumber={metaBusinessStatus.connection?.linkedNumber ?? null}
        apiDisplayPhoneNumber={metaBusinessStatus.connection?.displayPhoneNumber ?? null}
        apiWabaId={metaBusinessStatus.connection?.wabaId ?? null}
        apiQualityRating={apiQualityRating}
        apiMessagingLimitTier={apiMessagingLimitTier}
        apiCodeVerificationStatus={apiCodeVerificationStatus}
        apiNameStatus={apiNameStatus}
        apiWabaReviewStatus={apiWabaReviewStatus}
        apiLastMetaSyncLabel={apiLastMetaSyncLabel}
        hasMetaConnection={Boolean(metaBusinessStatus.connection)}
        apiSetupLoading={metaApiSetupLoading}
        apiSetupLoadingText={metaApiSetupLoadingText}
        whatsAppBusinessDraft={whatsAppBusinessDraft}
        deleteAccountConfirmText={deleteAccountConfirmText}
        deletingAccount={deletingAccount}
        onPauseAgent={() => {
          setError(null);
          setInfo(null);
          websiteToggleMutation.mutate();
        }}
        onToggleQrChannel={() => {
          setError(null);
          setInfo(null);
          qrToggleMutation.mutate();
        }}
        onToggleApiChannel={() => {
          if (metaBusinessStatus.connection) {
            setError(null);
            setInfo(null);
            apiDisconnectMutation.mutate();
            return;
          }
          void openBusinessApiSetup();
        }}
        onSelectSetupWeb={() => navigate("/dashboard/settings/web")}
        onSelectSetupApi={() => navigate("/dashboard/settings/api")}
        onNavigateToQrSetup={() => navigate("/onboarding/qr")}
        onUpdateWidgetSetupDraft={setWidgetSetupDraft}
        onWidgetQuestionChange={(index, value) => {
          setWidgetSetupDraft((current) => {
            const nextQuestions = [...current.initialQuestions] as [string, string, string];
            nextQuestions[index] = value;
            return {
              ...current,
              initialQuestions: nextQuestions
            };
          });
        }}
        onCopyWidgetSnippet={async () => {
          try {
            await navigator.clipboard.writeText(widgetScriptSnippet);
            setWidgetSnippetCopied("copied");
          } catch {
            setWidgetSnippetCopied("error");
          }
        }}
        onSaveWidgetSetup={() => {
          if (!user?.id) {
            return;
          }
          const storageKey = `wagenai_widget_setup_draft_${user.id}`;
          window.localStorage.setItem(storageKey, JSON.stringify(widgetSetupDraft));
          setInfo("Website widget setup saved.");
          setWidgetSnippetCopied("idle");
        }}
        onOpenTestChatOverlay={() => navigate("/dashboard/studio/test")}
        onReconnectWhatsApp={() => {
          setError(null);
          setInfo(null);
          qrToggleMutation.mutate();
        }}
        onSaveWhatsAppBusinessProfile={() => {
          if (!user?.id) {
            return;
          }
          const storageKey = `wagenai_whatsapp_business_profile_draft_${user.id}`;
          window.localStorage.setItem(storageKey, JSON.stringify(whatsAppBusinessDraft));
          setInfo("WhatsApp Business profile draft saved.");
        }}
        onUpdateWhatsAppBusinessDraft={setWhatsAppBusinessDraft}
        onResetWhatsAppBusinessDraft={() => {
          setWhatsAppBusinessDraft(DEFAULT_WHATSAPP_BUSINESS_PROFILE_DRAFT);
        }}
        onOpenBusinessApiSetup={() => {
          void openBusinessApiSetup();
        }}
        onRefreshMetaApiStatus={() => {
          void refreshMetaApiStatus();
        }}
        onDeleteAccountConfirmTextChange={setDeleteAccountConfirmText}
        onDeleteAccount={() => {
          if (deleteAccountConfirmText.trim() !== "DELETE") {
            setError('Type "DELETE" to confirm account deletion.');
            return;
          }
          const confirmed = window.confirm(
            "This will permanently delete your account, revoke connected WhatsApp tokens, and remove associated business data. Continue?"
          );
          if (!confirmed) {
            return;
          }
          setDeletingAccount(true);
          deleteAccountMutation.mutate(undefined, {
            onSettled: () => {
              setDeletingAccount(false);
            }
          });
        }}
        renderNavIcon={(name) => <DashboardIcon name={name} />}
      />
    </section>
  );
}
