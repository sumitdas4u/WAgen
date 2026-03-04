import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { DashboardBillingCenter } from "../components/dashboard-billing-center";
import {
  API_URL,
  completeMetaBusinessSignup,
  createAgentProfile,
  connectWhatsApp,
  deleteMyAccount,
  disconnectWhatsApp,
  disconnectMetaBusiness,
  deleteAgentProfile,
  deleteKnowledgeSource,
  fetchAiReviewQueue,
  fetchAgentProfiles,
  fetchLeadConversations,
  fetchConversationMessages,
  fetchConversations,
  fetchDashboardOverview,
  fetchWorkspaceCredits,
  fetchMetaBusinessConfig,
  fetchMetaBusinessStatus,
  fetchIngestionJobs,
  fetchKnowledgeChunks,
  fetchKnowledgeSources,
  ingestManual,
  ingestPdf,
  ingestWebsite,
  resolveAiReviewQueueItem,
  saveBusinessBasics,
  savePersonality,
  sendConversationManualMessage,
  setAgentActive,
  setConversationPaused,
  setManualTakeover,
  summarizeLeadConversations,
  updateAgentProfile,
  type AgentProfile as AgentProfileApi,
  type AiReviewQueueItem,
  type BusinessBasicsPayload,
  type Conversation,
  type ConversationMessage,
  type DashboardOverviewResponse,
  type LeadConversation,
  type KnowledgeIngestJob,
  type KnowledgeChunkPreview,
  type KnowledgeSource,
  type MetaBusinessConfig,
  type MetaBusinessStatus,
  type WorkspaceCreditsResponse
} from "../lib/api";
import { useRealtime } from "../lib/use-realtime";

const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
type PersonalityKey = "friendly_warm" | "professional" | "hard_closer" | "premium_consultant" | "custom";
type NavIconName =
  | "brand"
  | "chats"
  | "leads"
  | "billing"
  | "knowledge"
  | "test"
  | "agents"
  | "settings"
  | "personality"
  | "unanswered"
  | "logout";
const DASHBOARD_TAB_OPTIONS = [
  { value: "conversations", label: "Chats", subtitle: "Live Inbox", icon: "chats" },
  { value: "leads", label: "Leads", subtitle: "Priority Queue", icon: "leads" },
  { value: "billing", label: "Billing", subtitle: "Credits & Invoices", icon: "billing" },
  { value: "knowledge", label: "Chat Bot", subtitle: "AI Studio", icon: "knowledge" },
  { value: "settings", label: "Settings", subtitle: "WhatsApp connection setup", icon: "settings" }
] as const;
type DashboardTab =
  | (typeof DASHBOARD_TAB_OPTIONS)[number]["value"]
  | "chatbot_personality"
  | "unanswered_questions"
  | "bot_agents";
type ChatbotStudioView = DashboardTab | "test_chatbot";
type ChatFolderFilter = "all" | "unassigned" | "mine" | "bot";
type LeadKindFilter = "all" | "lead" | "feedback" | "complaint" | "other";
type LeadChannelFilter = "all" | "web" | "qr" | "api";
type LeadQuickFilter = "all" | "today_hot" | "today_warm" | "today_complaint" | "needs_reply";
type SettingsSubmenu = "setup_web" | "setup_qr" | "setup_api";
type AgentProfile = AgentProfileApi;
type PersonalityPanelTab = "answer_formatting" | "bot_identity" | "custom_instructions";
type ResponseLengthPreference = "descriptive" | "medium" | "short";
type TonePreference = "matter_of_fact" | "friendly" | "humorous" | "neutral" | "professional";
type GenderPreference = "female" | "male" | "neutral";
type LanguagePreference = "english" | "hindi" | "hinglish" | "bengali" | "none";
type AiReviewStatusFilter = "all" | "pending" | "resolved";

const CHATBOT_STUDIO_MENU: Array<{ value: ChatbotStudioView; label: string; icon: NavIconName }> = [
  { value: "knowledge", label: "Knowledge Base", icon: "knowledge" },
  { value: "chatbot_personality", label: "Chatbot Personality", icon: "personality" },
  { value: "unanswered_questions", label: "AI Review Center", icon: "unanswered" },
  { value: "test_chatbot", label: "Test chatbot", icon: "test" },
  { value: "bot_agents", label: "AI Agents", icon: "agents" }
];

const STUDIO_TABS = new Set<DashboardTab>([
  "knowledge",
  "chatbot_personality",
  "unanswered_questions",
  "bot_agents"
]);
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

const CHAT_FOLDER_FILTER_OPTIONS: Array<{ value: ChatFolderFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "My chats" },
  { value: "bot", label: "Bot" }
];

const CHAT_AI_DURATION_OPTIONS: Array<{ label: string; minutes: number | null }> = [
  { label: "For 15mins", minutes: 15 },
  { label: "For 30mins", minutes: 30 },
  { label: "For 1hr", minutes: 60 },
  { label: "For 6hrs", minutes: 360 },
  { label: "For 12hrs", minutes: 720 },
  { label: "For 24hrs", minutes: 1440 },
  { label: "For forever", minutes: null }
];

type ChatAiTimedAction = {
  switchToPaused: boolean;
  executeAt: number;
};

const LEAD_QUICK_FILTER_OPTIONS: Array<{ value: LeadQuickFilter; label: string }> = [
  { value: "all", label: "All Leads" },
  { value: "today_hot", label: "Today's Hot Leads" },
  { value: "today_warm", label: "Today's Warm Leads" },
  { value: "today_complaint", label: "Today's Complaints" },
  { value: "needs_reply", label: "Must Reply" }
];

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

function toWebSocketBase(url: string): string {
  if (url.startsWith("https://")) {
    return url.replace("https://", "wss://");
  }
  if (url.startsWith("http://")) {
    return url.replace("http://", "ws://");
  }
  return url;
}

type ConversationUpdateRealtimePayload = {
  conversationId: string;
  phoneNumber: string | null;
  direction: "inbound" | "outbound";
  message: string;
};

const MAX_ALERT_DEDUPE_KEYS = 250;
let dashboardAudioContext: AudioContext | null = null;

function parseConversationUpdateRealtimePayload(value: unknown): ConversationUpdateRealtimePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
  const directionRaw = typeof payload.direction === "string" ? payload.direction.trim().toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const phoneNumberRaw = typeof payload.phoneNumber === "string" ? payload.phoneNumber.trim() : "";
  if (!conversationId || !message || (directionRaw !== "inbound" && directionRaw !== "outbound")) {
    return null;
  }
  return {
    conversationId,
    phoneNumber: phoneNumberRaw || null,
    direction: directionRaw,
    message
  };
}

function requestNotificationPermissionIfSupported(): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "default") {
    return;
  }
  void Notification.requestPermission().catch(() => undefined);
}

function playDashboardMessageAlertSound(): void {
  if (typeof window === "undefined") {
    return;
  }
  const ContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ContextCtor) {
    return;
  }
  if (!dashboardAudioContext) {
    dashboardAudioContext = new ContextCtor();
  }
  const context = dashboardAudioContext;
  if (context.state !== "running") {
    void context.resume().catch(() => undefined);
  }
  if (context.state !== "running") {
    return;
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, now);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.24);
}

function showDashboardBrowserNotification(message: string, phoneNumber: string | null): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  const title = phoneNumber ? `New message from ${phoneNumber}` : "New incoming message";
  try {
    const notification = new Notification(title, {
      body: message.slice(0, 180),
      tag: `wagenai-inbox-${phoneNumber ?? "unknown"}`
    });
    window.setTimeout(() => notification.close(), 6000);
  } catch {
    // Browser blocked notification display.
  }
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

function NavIcon({ name }: { name: NavIconName }) {
  switch (name) {
    case "brand":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="3" y="3" width="14" height="14" rx="3" />
          <path d="M7 13v-2m3 2V7m3 6V9" />
        </svg>
      );
    case "chats":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M5 5.5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9l-3 2v-2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
        </svg>
      );
    case "leads":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M4 14.5V9.8m4 4.7V6.8m4 7.7v-3.7m4 3.7V5.5" />
        </svg>
      );
    case "billing":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="3.5" y="5" width="13" height="10" rx="2" />
          <path d="M3.5 8h13M7 12h2.5" />
        </svg>
      );
    case "knowledge":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M6 4.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5H7.5A2.5 2.5 0 0 0 5 17V6a1.5 1.5 0 0 1 1-1.5Z" />
          <path d="M7.5 14.5H15.5V17H7.5a2.5 2.5 0 0 1 0-5h8" />
        </svg>
      );
    case "test":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M5 4.5h10M7 4.5l1 11h4l1-11M8 9h4" />
        </svg>
      );
    case "agents":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <rect x="5" y="6.5" width="10" height="8" rx="2" />
          <path d="M8 6.5V5a2 2 0 0 1 4 0v1.5M7.5 10h5" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <circle cx="10" cy="10" r="2.2" />
          <path d="M10 4.2v1.7M10 14.1v1.7M15.8 10h-1.7M5.9 10H4.2M13.9 6.1l-1.2 1.2M7.3 12.7l-1.2 1.2M13.9 13.9l-1.2-1.2M7.3 7.3L6.1 6.1" />
        </svg>
      );
    case "personality":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <circle cx="10" cy="8" r="3" />
          <path d="M5 15.5a5 5 0 0 1 10 0" />
        </svg>
      );
    case "unanswered":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M7.2 7.5a2.8 2.8 0 1 1 4.6 2.1c-.9.7-1.8 1.2-1.8 2.4" />
          <circle cx="10" cy="14.5" r=".6" fill="currentColor" stroke="none" />
          <circle cx="10" cy="10" r="7" />
        </svg>
      );
    case "logout":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-icon-svg">
          <path d="M8 5.5H5.5A1.5 1.5 0 0 0 4 7v6a1.5 1.5 0 0 0 1.5 1.5H8" />
          <path d="M11 7.5 14 10l-3 2.5M14 10H7" />
        </svg>
      );
    default:
      return null;
  }
}

function matchesChatFolderFilter(conversation: Conversation, filter: ChatFolderFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "unassigned") {
    return !conversation.assigned_agent_profile_id && !conversation.ai_paused && !conversation.manual_takeover;
  }
  if (filter === "mine") {
    return conversation.ai_paused || conversation.manual_takeover;
  }
  return !conversation.ai_paused && !conversation.manual_takeover;
}

function getConversationSortTime(conversation: Conversation): number {
  if (!conversation.last_message_at) {
    return 0;
  }
  const timestamp = new Date(conversation.last_message_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortConversationsByRecent(rows: Conversation[]): Conversation[] {
  return [...rows].sort((a, b) => getConversationSortTime(b) - getConversationSortTime(a));
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
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;

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
        existing.addEventListener("load", () => {
          if (window.fbAsyncInit) {
            window.fbAsyncInit();
          }
        });
        existing.addEventListener("error", () => reject(new Error("Failed to load Facebook SDK script.")));
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = FACEBOOK_SDK_URL;
      script.dataset.wagenFacebookSdk = "true";
      script.onload = () => {
        if (window.fbAsyncInit) {
          window.fbAsyncInit();
        }
      };
      script.onerror = () => reject(new Error("Failed to load Facebook SDK script."));
      document.body.appendChild(script);
    });
  }

  await window.__wagenFacebookSdkPromise;
  initSdk();
}

const DEFAULT_BUSINESS_BASICS: BusinessBasicsPayload = {
  companyName: "",
  whatDoYouSell: "",
  targetAudience: "",
  usp: "",
  objections: "",
  defaultCountry: "IN",
  defaultCurrency: "INR",
  greetingScript: "Greet politely, introduce yourself as support, and ask how you can help.",
  availabilityScript:
    "Share availability and timelines clearly. If unavailable, offer the next available option and expected time.",
  objectionHandlingScript:
    "Acknowledge concern first, explain clearly with empathy, and provide a practical next support step.",
  bookingScript:
    "Confirm booking intent, collect necessary details, and provide a clear next step to complete the booking.",
  feedbackCollectionScript:
    "Thank the customer, ask for concise feedback, and capture one suggestion to improve support quality.",
  complaintHandlingScript:
    "Apologize clearly, acknowledge the issue, share corrective action, and provide escalation contact if needed.",
  supportEmail: "",
  aiDoRules:
    "Be polite and empathetic.\nAnswer clearly using available business knowledge.\nEscalate to support contact when needed.",
  aiDontRules:
    "Do not ask customer budget or pricing qualification questions.\nDo not promise actions you cannot perform.\nDo not share sensitive data."
};

function readSavedString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function parseRuleLines(value: string): string[] {
  const rules = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return rules.length > 0 ? rules : [""];
}

function loadSavedBusinessBasics(value: unknown): BusinessBasicsPayload {
  if (!value || typeof value !== "object") {
    return DEFAULT_BUSINESS_BASICS;
  }

  const saved = value as Record<string, unknown>;
  return {
    companyName: readSavedString(saved.companyName, DEFAULT_BUSINESS_BASICS.companyName),
    whatDoYouSell: readSavedString(saved.whatDoYouSell, DEFAULT_BUSINESS_BASICS.whatDoYouSell),
    targetAudience: readSavedString(saved.targetAudience, DEFAULT_BUSINESS_BASICS.targetAudience),
    usp: readSavedString(saved.usp, DEFAULT_BUSINESS_BASICS.usp),
    objections: readSavedString(saved.objections, DEFAULT_BUSINESS_BASICS.objections),
    defaultCountry: readSavedString(saved.defaultCountry, DEFAULT_BUSINESS_BASICS.defaultCountry).toUpperCase(),
    defaultCurrency: readSavedString(saved.defaultCurrency, DEFAULT_BUSINESS_BASICS.defaultCurrency).toUpperCase(),
    greetingScript: readSavedString(saved.greetingScript, DEFAULT_BUSINESS_BASICS.greetingScript),
    availabilityScript: readSavedString(saved.availabilityScript, DEFAULT_BUSINESS_BASICS.availabilityScript),
    objectionHandlingScript: readSavedString(
      saved.objectionHandlingScript,
      DEFAULT_BUSINESS_BASICS.objectionHandlingScript
    ),
    bookingScript: readSavedString(saved.bookingScript, DEFAULT_BUSINESS_BASICS.bookingScript),
    feedbackCollectionScript: readSavedString(
      saved.feedbackCollectionScript,
      DEFAULT_BUSINESS_BASICS.feedbackCollectionScript
    ),
    complaintHandlingScript: readSavedString(
      saved.complaintHandlingScript,
      DEFAULT_BUSINESS_BASICS.complaintHandlingScript
    ),
    supportEmail: readSavedString(saved.supportEmail, DEFAULT_BUSINESS_BASICS.supportEmail),
    aiDoRules: readSavedString(saved.aiDoRules, DEFAULT_BUSINESS_BASICS.aiDoRules),
    aiDontRules: readSavedString(saved.aiDontRules, DEFAULT_BUSINESS_BASICS.aiDontRules)
  };
}

export function DashboardPage() {
  const { token, user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [workspaceCredits, setWorkspaceCredits] = useState<WorkspaceCreditsResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [testChatInput, setTestChatInput] = useState("");
  const [testChatSending, setTestChatSending] = useState(false);
  const [testWidgetStatus, setTestWidgetStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [widgetSnippetCopied, setWidgetSnippetCopied] = useState<"idle" | "copied" | "error">("idle");
  const [testChatRows, setTestChatRows] = useState<
    Array<{ id: string; sender: "user" | "bot"; text: string; time: string }>
  >([
    {
      id: "seed",
      sender: "bot",
      text: "Hey, how can I help you today?",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);
  const [activeTab, setActiveTab] = useState<DashboardTab>("conversations");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false);
  const [isTestChatOverlayOpen, setIsTestChatOverlayOpen] = useState(false);
  const [widgetSetupDraft, setWidgetSetupDraft] = useState<WidgetSetupDraft>(DEFAULT_WIDGET_SETUP_DRAFT);
  const [whatsAppBusinessDraft, setWhatsAppBusinessDraft] = useState<WhatsAppBusinessProfileDraft>(
    DEFAULT_WHATSAPP_BUSINESS_PROFILE_DRAFT
  );
  const [chatFolderFilter, setChatFolderFilter] = useState<ChatFolderFilter>("all");
  const [chatSearch, setChatSearch] = useState("");
  const [chatAiMenuOpen, setChatAiMenuOpen] = useState(false);
  const [chatAiTimers, setChatAiTimers] = useState<Record<string, ChatAiTimedAction>>({});
  const [leadStageFilter, setLeadStageFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [leadKindFilter, setLeadKindFilter] = useState<LeadKindFilter>("all");
  const [leadChannelFilter, setLeadChannelFilter] = useState<LeadChannelFilter>("all");
  const [leadTodayOnly, setLeadTodayOnly] = useState(false);
  const [leadRequiresReplyOnly, setLeadRequiresReplyOnly] = useState(false);
  const [leadQuickFilter, setLeadQuickFilter] = useState<LeadQuickFilter>("all");
  const [leadRows, setLeadRows] = useState<LeadConversation[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<AiReviewStatusFilter>("pending");
  const [reviewRows, setReviewRows] = useState<AiReviewQueueItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [reviewResolutionAnswer, setReviewResolutionAnswer] = useState("");
  const [reviewConversationMessages, setReviewConversationMessages] = useState<ConversationMessage[]>([]);
  const [reviewConversationLoading, setReviewConversationLoading] = useState(false);
  const [resolvingReview, setResolvingReview] = useState(false);
  const [summarizingLeads, setSummarizingLeads] = useState(false);
  const [expandedLeadSummaries, setExpandedLeadSummaries] = useState<Record<string, boolean>>({});
  const [expandedLeadMessages, setExpandedLeadMessages] = useState<Record<string, boolean>>({});
  const [businessBasics, setBusinessBasics] = useState<BusinessBasicsPayload>(DEFAULT_BUSINESS_BASICS);
  const [personality, setPersonality] = useState<PersonalityKey>("friendly_warm");
  const [customPrompt, setCustomPrompt] = useState("");
  const [personalityPanelTab, setPersonalityPanelTab] = useState<PersonalityPanelTab>("answer_formatting");
  const [responseLengthPreference, setResponseLengthPreference] = useState<ResponseLengthPreference>("medium");
  const [tonePreference, setTonePreference] = useState<TonePreference>("neutral");
  const [genderPreference, setGenderPreference] = useState<GenderPreference>("neutral");
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>("none");
  const [enableEmojis, setEnableEmojis] = useState(true);
  const [enableBulletPoints, setEnableBulletPoints] = useState(true);
  const [botName, setBotName] = useState("");
  const [botBusinessAbout, setBotBusinessAbout] = useState("");
  const [botUnknownReply, setBotUnknownReply] = useState("Sorry, I don't have information on this yet.");
  const [botAvoidWords, setBotAvoidWords] = useState("");
  const [doRules, setDoRules] = useState<string[]>([""]);
  const [dontRules, setDontRules] = useState<string[]>([""]);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [manualFaq, setManualFaq] = useState("");
  const [showKnowledgeMenu, setShowKnowledgeMenu] = useState(false);
  const [knowledgeModal, setKnowledgeModal] = useState<"manual" | "website" | "pdf" | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState<"add" | "edit">("add");
  const [settingsSubmenu, setSettingsSubmenu] = useState<SettingsSubmenu>("setup_web");
  const [metaBusinessConfig, setMetaBusinessConfig] = useState<MetaBusinessConfig | null>(null);
  const [metaBusinessStatus, setMetaBusinessStatus] = useState<MetaBusinessStatus>({ connected: false, connection: null });
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<string>("");
  const [agentName, setAgentName] = useState("");
  const [agentLinkedNumber, setAgentLinkedNumber] = useState("");
  const [agentChannelType, setAgentChannelType] = useState<"web" | "qr" | "api">("qr");
  const [agentObjectiveType, setAgentObjectiveType] = useState<"lead" | "feedback" | "complaint" | "hybrid">("lead");
  const [agentTaskDescription, setAgentTaskDescription] = useState("");
  const [showAgentWorkflowForm, setShowAgentWorkflowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<{ sourceType: KnowledgeSource["source_type"]; sourceName: string } | null>(null);
  const [modalSourceName, setModalSourceName] = useState("");
  const [modalWebsiteUrl, setModalWebsiteUrl] = useState("");
  const [modalManualText, setModalManualText] = useState("");
  const [modalPdfFiles, setModalPdfFiles] = useState<File[]>([]);
  const [chunkViewerSource, setChunkViewerSource] = useState<{ sourceType: KnowledgeSource["source_type"]; sourceName: string } | null>(null);
  const [chunkViewerItems, setChunkViewerItems] = useState<KnowledgeChunkPreview[]>([]);
  const [chunkViewerLoading, setChunkViewerLoading] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pdfUploadItems, setPdfUploadItems] = useState<
    Array<{
      id: string;
      jobId?: string;
      name: string;
      size: number;
      status: "queued" | "uploading" | "done" | "error";
      stage?: string;
      progress?: number;
      chunks?: number;
      error?: string;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState("");
  const [sendingAgentMessage, setSendingAgentMessage] = useState(false);
  const [agentReplyText, setAgentReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const widgetPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const widgetTestSocketRef = useRef<WebSocket | null>(null);
  const widgetTestVisitorIdRef = useRef<string>("");
  const chatAiMenuRef = useRef<HTMLDivElement | null>(null);
  const chatAiTimerProcessingRef = useRef<Set<string>>(new Set());
  const notifiedInboundMessageKeysRef = useRef<string[]>([]);
  const notificationPermissionBoundRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    const submenu = params.get("submenu");
    if (!tab) {
      return;
    }
    if (tab === "test_chatbot") {
      setActiveTab("knowledge");
      setIsTestChatOverlayOpen(true);
      return;
    }
    const allowed = new Set<DashboardTab>([
      "conversations",
      "leads",
      "billing",
      "knowledge",
      "chatbot_personality",
      "unanswered_questions",
      "bot_agents",
      "settings"
    ]);
    if (allowed.has(tab as DashboardTab)) {
      setActiveTab(tab as DashboardTab);
      if (tab === "settings" && (submenu === "setup_web" || submenu === "setup_qr" || submenu === "setup_api")) {
        setSettingsSubmenu(submenu);
      }
    }
  }, [location.search]);

  useEffect(() => {
    if (notificationPermissionBoundRef.current) {
      return;
    }
    notificationPermissionBoundRef.current = true;

    const requestOnInteraction = () => {
      requestNotificationPermissionIfSupported();
    };

    window.addEventListener("pointerdown", requestOnInteraction, { once: true });
    window.addEventListener("keydown", requestOnInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", requestOnInteraction);
      window.removeEventListener("keydown", requestOnInteraction);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1100px)");
    const syncViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false);
      setIsMobileConversationOpen(false);
      return;
    }
    if (activeTab !== "conversations") {
      setIsMobileConversationOpen(false);
    }
  }, [activeTab, isMobileViewport]);

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileSidebarOpen]);

  const openTestChatOverlay = useCallback(() => {
    setIsTestChatOverlayOpen(true);
  }, []);

  const closeTestChatOverlay = useCallback(() => {
    setIsTestChatOverlayOpen(false);
    setTestChatSending(false);
  }, []);

  useEffect(() => {
    if (!info) {
      return;
    }
    const timer = window.setTimeout(() => setInfo(null), 4000);
    return () => window.clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!isTestChatOverlayOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTestChatOverlayOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isTestChatOverlayOpen]);

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
      if (!element) {
        return;
      }
      element.scrollTop = element.scrollHeight;
    }, 40);

    return () => window.clearTimeout(timer);
  }, [widgetSetupDraft.previewOpen, widgetSetupDraft.initialGreeting, widgetSetupDraft.disclaimer]);

  useEffect(() => {
    if (!isTestChatOverlayOpen || !user?.id) {
      setTestWidgetStatus("disconnected");
      widgetTestSocketRef.current?.close();
      widgetTestSocketRef.current = null;
      return;
    }

    const visitorStorageKey = `wagenai_dashboard_widget_test_${user.id}`;
    const existingVisitorId = window.localStorage.getItem(visitorStorageKey);
    const visitorId = existingVisitorId || `dashboard-test-${Math.random().toString(36).slice(2, 10)}`;
    if (!existingVisitorId) {
      window.localStorage.setItem(visitorStorageKey, visitorId);
    }
    widgetTestVisitorIdRef.current = visitorId;

    setTestWidgetStatus("connecting");
    const wsBase = toWebSocketBase(API_URL);
    const socket = new WebSocket(
      `${wsBase}/ws/widget?wid=${encodeURIComponent(user.id)}&visitorId=${encodeURIComponent(visitorId)}`
    );
    widgetTestSocketRef.current = socket;

    socket.onopen = () => {
      setTestWidgetStatus("connected");
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as {
          event?: string;
          data?: { text?: unknown; message?: unknown; sender?: "ai" | "system" };
        };
        const text =
          typeof payload.data?.text === "string"
            ? payload.data.text
            : (typeof payload.data?.message === "string" ? payload.data.message : "");

        if (payload.event === "message" && text) {
          setTestChatRows((current) => [
            ...current,
            {
              id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: "bot",
              text,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ]);
          setTestChatSending(false);
        }
        if (payload.event === "error" && text) {
          setTestChatRows((current) => [
            ...current,
            {
              id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              sender: "bot",
              text,
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ]);
          setTestChatSending(false);
        }
      } catch {
        // Ignore malformed realtime payloads.
      }
    };

    socket.onerror = () => {
      setTestWidgetStatus("disconnected");
      setTestChatSending(false);
    };

    socket.onclose = () => {
      setTestWidgetStatus("disconnected");
    };

    return () => {
      socket.close();
      if (widgetTestSocketRef.current === socket) {
        widgetTestSocketRef.current = null;
      }
    };
  }, [isTestChatOverlayOpen, user?.id]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const isSameLocalDay = useCallback((value: string | null | undefined) => {
    if (!value) {
      return false;
    }
    const current = new Date();
    const sample = new Date(value);
    return (
      current.getFullYear() === sample.getFullYear() &&
      current.getMonth() === sample.getMonth() &&
      current.getDate() === sample.getDate()
    );
  }, []);

  const leadHighlights = useMemo(() => {
    return leadRows.reduce(
      (acc, row) => {
        if (isSameLocalDay(row.last_message_at)) {
          if (row.stage === "hot") {
            acc.todayHot += 1;
          }
          if (row.stage === "warm") {
            acc.todayWarm += 1;
          }
          if (row.lead_kind === "complaint") {
            acc.todayComplaints += 1;
          }
        }
        if (row.requires_reply) {
          acc.mustReply += 1;
        }
        return acc;
      },
      {
        todayHot: 0,
        todayWarm: 0,
        todayComplaints: 0,
        mustReply: 0
      }
    );
  }, [isSameLocalDay, leadRows]);

  const leads = useMemo(() => {
    const sorted = [...leadRows].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
    return sorted.filter((lead) => {
      if (leadStageFilter !== "all" && lead.stage !== leadStageFilter) {
        return false;
      }
      if (leadKindFilter !== "all" && lead.lead_kind !== leadKindFilter) {
        return false;
      }
      if (leadChannelFilter !== "all" && lead.channel_type !== leadChannelFilter) {
        return false;
      }
      if (leadTodayOnly && !isSameLocalDay(lead.last_message_at)) {
        return false;
      }
      if (leadRequiresReplyOnly && !lead.requires_reply) {
        return false;
      }
      if (leadQuickFilter === "today_hot" && !(lead.stage === "hot" && isSameLocalDay(lead.last_message_at))) {
        return false;
      }
      if (leadQuickFilter === "today_warm" && !(lead.stage === "warm" && isSameLocalDay(lead.last_message_at))) {
        return false;
      }
      if (
        leadQuickFilter === "today_complaint" &&
        !(lead.lead_kind === "complaint" && isSameLocalDay(lead.last_message_at))
      ) {
        return false;
      }
      if (leadQuickFilter === "needs_reply" && !lead.requires_reply) {
        return false;
      }
      return true;
    });
  }, [
    isSameLocalDay,
    leadRows,
    leadChannelFilter,
    leadKindFilter,
    leadQuickFilter,
    leadRequiresReplyOnly,
    leadStageFilter,
    leadTodayOnly
  ]);

  const selectedReview = useMemo(
    () => reviewRows.find((item) => item.id === selectedReviewId) ?? null,
    [reviewRows, selectedReviewId]
  );

  const reviewHighlights = useMemo(() => {
    return reviewRows.reduce(
      (acc, row) => {
        if (row.status === "pending") {
          acc.pending += 1;
        }
        if (row.status === "resolved" && isSameLocalDay(row.resolved_at)) {
          acc.resolvedToday += 1;
        }
        if (isSameLocalDay(row.created_at) && row.confidence_score < 70) {
          acc.lowConfidenceToday += 1;
        }
        return acc;
      },
      { pending: 0, resolvedToday: 0, lowConfidenceToday: 0 }
    );
  }, [isSameLocalDay, reviewRows]);

  const formatPhone = useCallback((value: string | null | undefined) => {
    if (!value) {
      return "Unknown";
    }
    const digits = value.replace(/\D/g, "");
    if (!digits || digits.length < 8 || digits.length > 15) {
      return value;
    }
    return `+${digits}`;
  }, []);

  const formatDateTime = useCallback((value: string | null | undefined) => {
    if (!value) {
      return "-";
    }
    return new Date(value).toLocaleString();
  }, []);

  const filteredConversations = useMemo(() => {
    const inFolder = conversations.filter((conversation) => matchesChatFolderFilter(conversation, chatFolderFilter));
    const query = chatSearch.trim().toLowerCase();
    if (!query) {
      return sortConversationsByRecent(inFolder);
    }
    return sortConversationsByRecent(
      inFolder.filter((conversation) => {
        const haystack = `${conversation.contact_name ?? ""} ${
          formatPhone(conversation.contact_phone || conversation.phone_number)
        } ${conversation.contact_email ?? ""} ${
          conversation.last_message ?? ""
        }`.toLowerCase();
        return haystack.includes(query);
      })
    );
  }, [chatSearch, conversations, formatPhone, chatFolderFilter]);

  const chatFolderCounts = useMemo(
    () =>
      CHAT_FOLDER_FILTER_OPTIONS.reduce<Record<ChatFolderFilter, number>>(
        (counts, option) => ({ ...counts, [option.value]: conversations.filter((row) => matchesChatFolderFilter(row, option.value)).length }),
        {
          all: 0,
          unassigned: 0,
          mine: 0,
          bot: 0
        }
      ),
    [conversations]
  );

  const getSummaryStatusLabel = (status: LeadConversation["summary_status"]) => {
    if (status === "ready") {
      return "Ready";
    }
    if (status === "stale") {
      return "Outdated";
    }
    return "Missing";
  };

  const getLeadKindLabel = (kind: LeadConversation["lead_kind"]) => {
    if (kind === "feedback") {
      return "Feedback";
    }
    if (kind === "complaint") {
      return "Complaint";
    }
    if (kind === "other") {
      return "Other";
    }
    return "Lead";
  };

  const getChannelLabel = (channelType: LeadConversation["channel_type"]) => {
    if (channelType === "api") {
      return "WhatsApp API";
    }
    if (channelType === "qr") {
      return "WhatsApp QR";
    }
    return "Web";
  };

  const getConversationChannelBadge = (channelType: Conversation["channel_type"]) => {
    if (channelType === "api") {
      return "🟢 WA API";
    }
    if (channelType === "qr") {
      return "⚡ WA QR";
    }
    return "🌐 Web";
  };

  const getReviewStatusLabel = (status: AiReviewQueueItem["status"]) => {
    return status === "resolved" ? "Resolved" : "Needs review";
  };

  const getReviewSignalLabel = (signal: string) => {
    if (signal === "low_confidence") {
      return "Low confidence";
    }
    if (signal === "fallback_response") {
      return "Fallback reply";
    }
    if (signal === "no_knowledge_match") {
      return "No KB match";
    }
    if (signal === "user_negative_feedback") {
      return "User flagged wrong answer";
    }
    return signal.replace(/_/g, " ");
  };

  const toggleLeadSummary = (leadId: string) => {
    setExpandedLeadSummaries((current) => ({
      ...current,
      [leadId]: !current[leadId]
    }));
  };

  const toggleLeadMessage = (leadId: string) => {
    setExpandedLeadMessages((current) => ({
      ...current,
      [leadId]: !current[leadId]
    }));
  };

  useEffect(() => {
    const savedBasics = loadSavedBusinessBasics(user?.business_basics);
    const rawBasics = (user?.business_basics ?? {}) as Record<string, unknown>;
    setBusinessBasics(savedBasics);
    setWebsiteUrl(readSavedString(rawBasics.websiteUrl, ""));
    setManualFaq(readSavedString(rawBasics.manualFaq, ""));
    if (user?.personality) {
      setPersonality(user.personality);
    }
    setCustomPrompt(user?.custom_personality_prompt ?? "");
    setBotName(savedBasics.companyName || user?.name || "WAgen AI Bot");
    setBotBusinessAbout(savedBasics.whatDoYouSell);
    setBotUnknownReply(savedBasics.complaintHandlingScript || "Sorry, I don't have information on this yet.");
    setBotAvoidWords(savedBasics.objections);
    setDoRules(parseRuleLines(savedBasics.aiDoRules));
    setDontRules(parseRuleLines(savedBasics.aiDontRules));
  }, [user]);

  const refreshKnowledge = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetchKnowledgeSources(token);
      setKnowledgeSources(response.sources);
    } catch {
      setKnowledgeSources([]);
    }
  }, [token]);

  const refreshMetaBusinessStatus = useCallback(
    async (forceRefresh = false) => {
      if (!token) {
        return;
      }
      const next = await fetchMetaBusinessStatus(token, { forceRefresh });
      setMetaBusinessStatus(next);
      return next;
    },
    [token]
  );

  const refreshWorkspaceCreditSummary = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetchWorkspaceCredits(token);
      setWorkspaceCredits(response);
    } catch {
      setWorkspaceCredits(null);
    }
  }, [token]);

  const loadData = useCallback(async (options?: { forceMetaRefresh?: boolean }) => {
    if (!token) {
      return;
    }

    setError(null);
    const [overviewResponse, conversationsResponse, metaConfigResponse, metaStatusResponse, creditsResponse] = await Promise.all([
      fetchDashboardOverview(token),
      fetchConversations(token),
      fetchMetaBusinessConfig(token),
      fetchMetaBusinessStatus(token, { forceRefresh: Boolean(options?.forceMetaRefresh) }),
      fetchWorkspaceCredits(token)
    ]);

    const sortedConversations = sortConversationsByRecent(conversationsResponse.conversations);
    setOverview(overviewResponse);
    setWorkspaceCredits(creditsResponse);
    setMetaBusinessConfig(metaConfigResponse);
    setMetaBusinessStatus(metaStatusResponse);
    setConversations(sortedConversations);
    setSelectedConversationId((current) => {
      if (current && sortedConversations.some((conversation) => conversation.id === current)) {
        return current;
      }
      return sortedConversations[0]?.id ?? null;
    });
  }, [token]);

  const loadLeads = useCallback(async () => {
    if (!token) {
      return;
    }
    setLeadsLoading(true);
    try {
      const response = await fetchLeadConversations(token, { limit: 500 });
      setLeadRows(response.leads);
    } finally {
      setLeadsLoading(false);
    }
  }, [token]);

  const loadAiReviewQueue = useCallback(async () => {
    if (!token) {
      return;
    }
    setReviewLoading(true);
    try {
      const response = await fetchAiReviewQueue(token, {
        status: reviewStatusFilter,
        limit: 300
      });
      const sorted = [...response.queue].sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      });
      setReviewRows(sorted);
      setSelectedReviewId((current) => {
        if (current && sorted.some((item) => item.id === current)) {
          return current;
        }
        return sorted[0]?.id ?? null;
      });
    } finally {
      setReviewLoading(false);
    }
  }, [reviewStatusFilter, token]);

  const loadAgentProfiles = useCallback(async () => {
    if (!token) {
      return;
    }
    const response = await fetchAgentProfiles(token);
    setAgentProfiles(response.profiles);
  }, [token]);

  useEffect(() => {
    setConnectionLoading(true);
    void loadData()
      .catch((loadError) => {
        setError((loadError as Error).message);
      })
      .finally(() => {
        setConnectionLoading(false);
      });
    void refreshKnowledge();
    void loadAgentProfiles().catch((loadError) => {
      setError((loadError as Error).message);
    });
  }, [loadData, refreshKnowledge, loadAgentProfiles]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshWorkspaceCreditSummary();
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [token, refreshWorkspaceCreditSummary]);

  useEffect(() => {
    if (activeTab !== "settings" || settingsSubmenu !== "setup_api" || !metaBusinessStatus.connection) {
      return;
    }
    void refreshMetaBusinessStatus(true).catch(() => undefined);
  }, [activeTab, settingsSubmenu, metaBusinessStatus.connection, refreshMetaBusinessStatus]);

  useEffect(() => {
    if (activeTab !== "leads") {
      return;
    }
    void loadLeads().catch((loadError) => {
      setError((loadError as Error).message);
    });
  }, [activeTab, loadLeads]);

  useEffect(() => {
    if (activeTab !== "unanswered_questions") {
      return;
    }
    void loadAiReviewQueue().catch((loadError) => {
      setError((loadError as Error).message);
    });
  }, [activeTab, loadAiReviewQueue]);

  useEffect(() => {
    if (!token || !selectedConversationId) {
      setMessages([]);
      return;
    }

    void fetchConversationMessages(token, selectedConversationId)
      .then((response) => setMessages(response.messages))
      .catch((loadError) => setError((loadError as Error).message));
  }, [selectedConversationId, token]);

  useEffect(() => {
    setReviewResolutionAnswer(selectedReview?.resolution_answer ?? "");
  }, [selectedReview?.id, selectedReview?.resolution_answer]);

  useEffect(() => {
    if (!token || activeTab !== "unanswered_questions" || !selectedReview) {
      setReviewConversationMessages([]);
      setReviewConversationLoading(false);
      return;
    }
    if (!selectedReview.conversation_id) {
      setReviewConversationMessages([]);
      setReviewConversationLoading(false);
      return;
    }

    setReviewConversationLoading(true);
    void fetchConversationMessages(token, selectedReview.conversation_id)
      .then((response) => setReviewConversationMessages(response.messages))
      .catch((loadError) => setError((loadError as Error).message))
      .finally(() => setReviewConversationLoading(false));
  }, [activeTab, selectedReview, token]);

  useEffect(() => {
    const scrollHost = messagesScrollRef.current;
    if (!scrollHost) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      scrollHost.scrollTop = scrollHost.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, selectedConversationId]);

  useEffect(() => {
    if (activeTab !== "conversations") {
      return;
    }
    if (filteredConversations.length === 0) {
      setSelectedConversationId(null);
      return;
    }
    if (!selectedConversationId || !filteredConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(filteredConversations[0].id);
    }
  }, [activeTab, filteredConversations, selectedConversationId]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }
    const storageKey = `wagenai_chat_ai_timers_${user.id}`;
    try {
      const rawValue = window.localStorage.getItem(storageKey);
      if (!rawValue) {
        setChatAiTimers({});
        return;
      }
      const parsed = JSON.parse(rawValue) as Record<string, ChatAiTimedAction>;
      if (!parsed || typeof parsed !== "object") {
        setChatAiTimers({});
        return;
      }
      setChatAiTimers(parsed);
    } catch {
      setChatAiTimers({});
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }
    const storageKey = `wagenai_chat_ai_timers_${user.id}`;
    window.localStorage.setItem(storageKey, JSON.stringify(chatAiTimers));
  }, [chatAiTimers, user?.id]);

  useEffect(() => {
    if (!chatAiMenuOpen) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      if (chatAiMenuRef.current && event.target instanceof Node && !chatAiMenuRef.current.contains(event.target)) {
        setChatAiMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChatAiMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatAiMenuOpen]);

  useEffect(() => {
    setChatAiMenuOpen(false);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      const dueConversationIds = Object.entries(chatAiTimers)
        .filter(([, schedule]) => schedule.executeAt <= now)
        .map(([conversationId]) => conversationId);
      if (dueConversationIds.length === 0) {
        return;
      }
      for (const conversationId of dueConversationIds) {
        if (chatAiTimerProcessingRef.current.has(conversationId)) {
          continue;
        }
        const schedule = chatAiTimers[conversationId];
        if (!schedule) {
          continue;
        }
        chatAiTimerProcessingRef.current.add(conversationId);
        void Promise.all([
          setManualTakeover(token, conversationId, schedule.switchToPaused),
          setConversationPaused(token, conversationId, schedule.switchToPaused)
        ])
          .then(async () => {
            setChatAiTimers((current) => {
              const next = { ...current };
              delete next[conversationId];
              return next;
            });
            if (selectedConversationId === conversationId) {
              setInfo(schedule.switchToPaused ? "AI auto-paused by timer." : "AI auto-resumed by timer.");
            }
            await loadData();
          })
          .catch(() => undefined)
          .finally(() => {
            chatAiTimerProcessingRef.current.delete(conversationId);
          });
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [chatAiTimers, loadData, selectedConversationId, token]);

  useEffect(() => {
    const preferredNumber = overview?.whatsapp.phoneNumber || metaBusinessStatus.connection?.linkedNumber || "";
    if (preferredNumber) {
      setAgentLinkedNumber((current) => current || preferredNumber);
    }
  }, [overview?.whatsapp.phoneNumber, metaBusinessStatus.connection?.linkedNumber]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const pollTimer = setInterval(() => {
      void loadData().catch(() => undefined);
      if (selectedConversationId) {
        void fetchConversationMessages(token, selectedConversationId)
          .then((response) => setMessages(response.messages))
          .catch(() => undefined);
      }
    }, 8000);

    return () => clearInterval(pollTimer);
  }, [loadData, selectedConversationId, token]);

  useEffect(() => {
    if (!token || activeTab !== "leads") {
      return;
    }
    const timer = setInterval(() => {
      void loadLeads().catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [activeTab, loadLeads, token]);

  useEffect(() => {
    if (!token || activeTab !== "unanswered_questions") {
      return;
    }
    const timer = setInterval(() => {
      void loadAiReviewQueue().catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [activeTab, loadAiReviewQueue, token]);

  useRealtime(
    token,
    useCallback(
      (event) => {
        if (event.event === "conversation.updated") {
          const conversationUpdate = parseConversationUpdateRealtimePayload(event.data);
          if (conversationUpdate && conversationUpdate.direction === "inbound") {
            const dedupeKey = `${conversationUpdate.conversationId}:${conversationUpdate.message}`;
            if (!notifiedInboundMessageKeysRef.current.includes(dedupeKey)) {
              playDashboardMessageAlertSound();
              showDashboardBrowserNotification(conversationUpdate.message, conversationUpdate.phoneNumber);
              notifiedInboundMessageKeysRef.current.push(dedupeKey);
              if (notifiedInboundMessageKeysRef.current.length > MAX_ALERT_DEDUPE_KEYS) {
                notifiedInboundMessageKeysRef.current.splice(
                  0,
                  notifiedInboundMessageKeysRef.current.length - MAX_ALERT_DEDUPE_KEYS
                );
              }
            }
          }

          void loadData();
          if (selectedConversationId && token) {
            void fetchConversationMessages(token, selectedConversationId)
              .then((response) => setMessages(response.messages))
              .catch(() => undefined);
          }
          if (activeTab === "leads") {
            void loadLeads().catch(() => undefined);
          }
          if (activeTab === "unanswered_questions") {
            void loadAiReviewQueue().catch(() => undefined);
          }
        }

        if (event.event === "whatsapp.status") {
          setOverview((current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              whatsapp: {
                ...current.whatsapp,
                ...(event.data as Record<string, unknown>)
              }
            };
          });
        }
      },
      [activeTab, loadAiReviewQueue, loadData, loadLeads, selectedConversationId, token]
    )
  );

  const handleApplyChatAiMode = async (switchToPaused: boolean, durationMinutes: number | null) => {
    if (!token || !selectedConversation) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    setChatAiMenuOpen(false);
    try {
      await Promise.all([
        setManualTakeover(token, selectedConversation.id, switchToPaused),
        setConversationPaused(token, selectedConversation.id, switchToPaused)
      ]);
      setChatAiTimers((current) => {
        const next = { ...current };
        delete next[selectedConversation.id];
        if (durationMinutes !== null) {
          next[selectedConversation.id] = {
            switchToPaused: !switchToPaused,
            executeAt: Date.now() + durationMinutes * 60_000
          };
        }
        return next;
      });
      await loadData();
      if (switchToPaused) {
        setInfo(durationMinutes === null ? "AI turned off for this chat." : `AI turned off for ${durationMinutes} minutes.`);
      } else {
        setInfo(durationMinutes === null ? "AI turned on for this chat." : `AI turned on for ${durationMinutes} minutes.`);
      }
    } catch (toggleError) {
      setError((toggleError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReconnectWhatsApp = async () => {
    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await connectWhatsApp(token);
      await loadData();
      setInfo("Reconnect requested. Open Onboarding if QR scan is needed.");
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePauseAgent = async () => {
    if (!token || !overview) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setAgentActive(token, !overview.agent.active);
      await loadData();
      setInfo(overview.agent.active ? "Agent paused." : "Agent activated.");
    } catch (pauseError) {
      setError((pauseError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenBusinessApiSetup = async () => {
    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const config = metaBusinessConfig ?? (await fetchMetaBusinessConfig(token));
      setMetaBusinessConfig(config);

      if (!config.configured || !config.appId || !config.embeddedSignupConfigId) {
        throw new Error(
          "Business API onboarding is not configured yet. Add Meta App settings in backend environment first."
        );
      }

      await ensureFacebookSdk(config.appId, config.graphVersion);
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

        const signup = await completeMetaBusinessSignup(token, {
          code,
          redirectUri,
          ...captured
        });

        setMetaBusinessStatus({ connected: signup.connection.status === "connected", connection: signup.connection });
        await loadData({ forceMetaRefresh: true });
        setInfo("Official WhatsApp Business API connected successfully.");
      } finally {
        window.removeEventListener("message", messageListener);
      }
    } catch (setupError) {
      setError((setupError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshMetaApiStatus = async () => {
    if (!token || !metaBusinessStatus.connection) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await refreshMetaBusinessStatus(true);
      await loadData({ forceMetaRefresh: true });
      setInfo("Meta business details refreshed from API.");
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleQrChannel = async () => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (overview?.whatsapp.status === "connected") {
        await disconnectWhatsApp(token);
        setInfo("QR channel deactivated.");
      } else {
        await connectWhatsApp(token);
        setInfo("QR channel activated. Open QR setup to scan and complete connection.");
      }
      await loadData();
    } catch (toggleError) {
      setError((toggleError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleApiChannel = async () => {
    if (!token) {
      return;
    }

    if (metaBusinessStatus.connection) {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        await disconnectMetaBusiness(token, {
          connectionId: metaBusinessStatus.connection?.id
        });
        setMetaBusinessStatus({ connected: false, connection: null });
        await loadData();
        setInfo("Official WhatsApp API channel deactivated.");
      } catch (disconnectError) {
        setError((disconnectError as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    await handleOpenBusinessApiSetup();
  };

  const handleCopyWidgetSnippet = async () => {
    try {
      await navigator.clipboard.writeText(widgetScriptSnippet);
      setWidgetSnippetCopied("copied");
    } catch {
      setWidgetSnippetCopied("error");
    }
  };

  const handleSaveWidgetSetup = () => {
    if (!user?.id) {
      return;
    }
    const storageKey = `wagenai_widget_setup_draft_${user.id}`;
    window.localStorage.setItem(storageKey, JSON.stringify(widgetSetupDraft));
    setInfo("Website widget setup saved.");
    setWidgetSnippetCopied("idle");
  };

  const handleWidgetQuestionChange = (index: 0 | 1 | 2, value: string) => {
    setWidgetSetupDraft((current) => {
      const nextQuestions: [string, string, string] = [...current.initialQuestions] as [string, string, string];
      nextQuestions[index] = value;
      return {
        ...current,
        initialQuestions: nextQuestions
      };
    });
  };

  const handleSaveWhatsAppBusinessProfile = () => {
    if (!user?.id) {
      return;
    }
    const storageKey = `wagenai_whatsapp_business_profile_draft_${user.id}`;
    window.localStorage.setItem(storageKey, JSON.stringify(whatsAppBusinessDraft));
    setInfo("WhatsApp Business profile draft saved.");
  };

  const handleSendAgentMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !selectedConversation) {
      return;
    }

    const text = agentReplyText.trim();
    if (!text) {
      return;
    }

    setSendingAgentMessage(true);
    setError(null);
    try {
      await sendConversationManualMessage(token, selectedConversation.id, text, { lockToManual: false });
      setAgentReplyText("");
      await loadData();
      const refreshed = await fetchConversationMessages(token, selectedConversation.id);
      setMessages(refreshed.messages);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setSendingAgentMessage(false);
    }
  };

  const handleDisconnectBusinessApi = async () => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await disconnectMetaBusiness(token, {
        connectionId: metaBusinessStatus.connection?.id
      });
      await loadData();
      setInfo("Official WhatsApp Business API connection disconnected.");
    } catch (disconnectError) {
      setError((disconnectError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!token || deletingAccount) {
      return;
    }

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
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      await deleteMyAccount(token, { confirmText: "DELETE" });
      await logout();
      navigate("/signup", { replace: true });
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeletingAccount(false);
      setBusy(false);
    }
  };

  const handleExportLeads = () => {
    if (leads.length === 0) {
      setInfo("No leads available to export.");
      return;
    }

    const rows = leads.map((lead) => ({
      Name: lead.contact_name || "",
      Phone: formatPhone(lead.contact_phone || lead.phone_number),
      Email: lead.contact_email || "",
      Type: getLeadKindLabel(lead.lead_kind),
      Stage: lead.stage,
      Score: lead.score,
      Channel: getChannelLabel(lead.channel_type),
      "Assigned Agent": lead.assigned_agent_name || "",
      "Must Reply": lead.requires_reply ? "Yes" : "No",
      "AI Summary": lead.ai_summary || "",
      "Last Message": lead.last_message || "",
      "Last Activity": lead.last_message_at ? new Date(lead.last_message_at).toLocaleString() : ""
    }));

    const csvEscape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const header = Object.keys(rows[0]);
    const lines = [
      header.map((key) => csvEscape(key)).join(","),
      ...rows.map((row) => header.map((key) => csvEscape(String(row[key as keyof typeof row] ?? ""))).join(","))
    ];

    const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `leads-summary-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setInfo("Leads exported.");
  };

  const handleSummarizeLeads = async () => {
    if (!token) {
      return;
    }

    setSummarizingLeads(true);
    setError(null);
    setInfo(null);
    try {
      const response = await summarizeLeadConversations(token, { limit: 500 });
      await loadLeads();
      setInfo(
        `Lead summaries updated: ${response.updated}. Skipped: ${response.skipped}.` +
          (response.failed > 0 ? ` Failed: ${response.failed}.` : "")
      );
    } catch (summarizeError) {
      setError((summarizeError as Error).message);
    } finally {
      setSummarizingLeads(false);
    }
  };

  const handleResolveReviewItem = async (options: { addToKnowledgeBase: boolean }) => {
    if (!token || !selectedReview) {
      return;
    }

    const answer = reviewResolutionAnswer.trim();
    if (options.addToKnowledgeBase && answer.length < 8) {
      setError("Please write the correct answer before adding this item to Knowledge Base.");
      return;
    }

    setResolvingReview(true);
    setError(null);
    setInfo(null);
    try {
      const response = await resolveAiReviewQueueItem(token, selectedReview.id, {
        resolutionAnswer: answer || undefined,
        addToKnowledgeBase: options.addToKnowledgeBase
      });
      await loadAiReviewQueue();
      if (options.addToKnowledgeBase) {
        await refreshKnowledge();
      }
      setInfo(
        response.knowledgeChunks > 0
          ? `Resolved and added to Knowledge Base (${response.knowledgeChunks} chunk${response.knowledgeChunks > 1 ? "s" : ""}).`
          : "Review item resolved."
      );
    } catch (resolveError) {
      setError((resolveError as Error).message);
    } finally {
      setResolvingReview(false);
    }
  };

  const handleRuleChange = (kind: "do" | "dont", index: number, value: string) => {
    if (kind === "do") {
      setDoRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? value : rule)));
      return;
    }
    setDontRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? value : rule)));
  };

  const handleAddRule = (kind: "do" | "dont") => {
    if (kind === "do") {
      setDoRules((current) => [...current, ""]);
      return;
    }
    setDontRules((current) => [...current, ""]);
  };

  const handleDeleteRule = (kind: "do" | "dont", index: number) => {
    if (kind === "do") {
      setDoRules((current) => {
        const next = current.filter((_, itemIndex) => itemIndex !== index);
        return next.length > 0 ? next : [""];
      });
      return;
    }
    setDontRules((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length > 0 ? next : [""];
    });
  };

  const buildSimplifiedBasics = (): BusinessBasicsPayload => {
    const cleanDoRules = doRules.map((rule) => rule.trim()).filter((rule) => rule.length > 0);
    const cleanDontRules = dontRules.map((rule) => rule.trim()).filter((rule) => rule.length > 0);
    const fallbackAbout = businessBasics.whatDoYouSell.trim().length >= 2 ? businessBasics.whatDoYouSell : "Business support";
    const fallbackAudience =
      businessBasics.targetAudience.trim().length >= 2 ? businessBasics.targetAudience : "WhatsApp users";
    const fallbackUsp = businessBasics.usp.trim().length >= 2 ? businessBasics.usp : fallbackAbout;
    const fallbackObjections =
      botAvoidWords.trim().length >= 2
        ? botAvoidWords.trim()
        : businessBasics.objections.trim().length >= 2
          ? businessBasics.objections
          : "No restricted words defined";

    return {
      ...businessBasics,
      companyName: botName.trim() || businessBasics.companyName || "WAgen AI Bot",
      whatDoYouSell: botBusinessAbout.trim().length >= 2 ? botBusinessAbout.trim() : fallbackAbout,
      targetAudience: fallbackAudience,
      usp: fallbackUsp,
      objections: fallbackObjections,
      complaintHandlingScript:
        botUnknownReply.trim().length > 0
          ? botUnknownReply.trim()
          : businessBasics.complaintHandlingScript || "I don't have this information right now.",
      aiDoRules: cleanDoRules.length > 0 ? cleanDoRules.join("\n") : "Answer clearly and stay factual.",
      aiDontRules:
        cleanDontRules.length > 0 ? cleanDontRules.join("\n") : "Do not hallucinate policy or pricing details."
    };
  };

  const buildPersonalityPrompt = (basics: BusinessBasicsPayload): string => {
    const lines = [
      `Response length: ${responseLengthPreference}.`,
      `Tone: ${tonePreference}.`,
      `Voice preference: ${genderPreference}.`,
      `Preferred language: ${languagePreference}.`,
      enableEmojis ? "Use emojis only when they improve clarity." : "Do not use emojis.",
      enableBulletPoints ? "Use bullet points for multi-step answers." : "Avoid bullet points unless asked.",
      `Bot identity: ${basics.companyName}.`,
      `Business context: ${basics.whatDoYouSell}.`,
      `Fallback when answer is unknown: ${basics.complaintHandlingScript}.`
    ];
    return lines.join("\n");
  };

  const handleSaveChatbotPersonality = async () => {
    const basics = buildSimplifiedBasics();
    const prompt = buildPersonalityPrompt(basics);
    setBusinessBasics(basics);
    setPersonality("custom");
    setCustomPrompt(prompt);
    await persistBotSettings(basics, "custom", prompt, "Chatbot personality saved.");
  };

  const stopUploadPolling = useCallback(() => {
    if (uploadPollRef.current) {
      clearInterval(uploadPollRef.current);
      uploadPollRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopUploadPolling();
    },
    [stopUploadPolling]
  );

  const persistBotSettings = async (
    basics: BusinessBasicsPayload,
    selectedPersonality: PersonalityKey,
    selectedCustomPrompt: string,
    successMessage: string
  ) => {
    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await saveBusinessBasics(token, {
        ...basics,
        defaultCountry: basics.defaultCountry.trim().toUpperCase() || "IN",
        defaultCurrency: basics.defaultCurrency.trim().toUpperCase() || "INR",
        websiteUrl: websiteUrl.trim(),
        manualFaq: manualFaq.trim()
      });
      await savePersonality(token, {
        personality: selectedPersonality,
        customPrompt: selectedPersonality === "custom" ? selectedCustomPrompt.trim() : undefined
      });
      await refreshUser();
      setInfo(successMessage);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleStartNewAgent = () => {
    setSelectedAgentProfileId("");
    setAgentName("");
    setAgentChannelType("qr");
    setAgentLinkedNumber(overview?.whatsapp.phoneNumber || metaBusinessStatus.connection?.linkedNumber || "");
    setAgentObjectiveType("lead");
    setAgentTaskDescription("");
    setShowAgentWorkflowForm(true);
  };

  const handleCreateOrUpdateAgentProfile = async () => {
    if (!token) {
      return;
    }
    const cleanName = agentName.trim();
    const cleanNumber = agentChannelType === "web" ? "web" : agentLinkedNumber.trim();
    const cleanTaskDescription = agentTaskDescription.trim();
    if (!cleanName) {
      setError("Agent name is required.");
      return;
    }
    if (agentChannelType !== "web" && !cleanNumber) {
      setError("Linked number is required for WhatsApp channels.");
      return;
    }
    if (!cleanTaskDescription) {
      setError("Define the task for this AI agent.");
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        name: cleanName,
        linkedNumber: cleanNumber,
        channelType: agentChannelType,
        businessBasics: { ...businessBasics },
        personality,
        customPrompt,
        objectiveType: agentObjectiveType,
        taskDescription: cleanTaskDescription,
        isActive: selectedAgentProfileId
          ? (agentProfiles.find((item) => item.id === selectedAgentProfileId)?.isActive ?? false)
          : false
      };

      const response = selectedAgentProfileId
        ? await updateAgentProfile(token, selectedAgentProfileId, payload)
        : await createAgentProfile(token, payload);

      setSelectedAgentProfileId(response.profile.id);
      setAgentProfiles((current) => {
        const exists = current.some((item) => item.id === response.profile.id);
        if (exists) {
          return current.map((item) => (item.id === response.profile.id ? response.profile : item));
        }
        return [response.profile, ...current];
      });
      setShowAgentWorkflowForm(false);
      setInfo(
        selectedAgentProfileId
          ? `Agent profile "${cleanName}" updated.`
          : `Agent profile "${cleanName}" saved as disabled. Use Go Live to activate.`
      );
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendTestChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.id || testChatSending) {
      return;
    }

    const message = testChatInput.trim();
    if (!message) {
      return;
    }

    const userRow = {
      id: `u-${Date.now()}`,
      sender: "user" as const,
      text: message,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    const historyRows = [...testChatRows, userRow];
    setTestChatRows(historyRows);
    setTestChatInput("");
    setTestChatSending(true);

    try {
      const socket = widgetTestSocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Website widget test channel is not connected yet. Please wait 1-2 seconds.");
      }
      socket.send(
        JSON.stringify({
          type: "message",
          wid: user.id,
          visitorId: widgetTestVisitorIdRef.current,
          message
        })
      );
    } catch (chatError) {
      setTestChatRows((current) => [
        ...current,
        {
          id: `b-${Date.now()}`,
          sender: "bot",
          text: `I could not send this to widget channel. ${(chatError as Error).message}`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
      setTestChatSending(false);
    }
  };

  const handleLoadAgentProfile = (profile: AgentProfile) => {
    setSelectedAgentProfileId(profile.id);
    setAgentName(profile.name);
    setAgentLinkedNumber(profile.linkedNumber);
    setAgentChannelType(profile.channelType);
    setAgentObjectiveType(profile.objectiveType);
    setAgentTaskDescription(profile.taskDescription ?? "");
    setBusinessBasics(profile.businessBasics);
    setPersonality(profile.personality);
    setCustomPrompt(profile.customPrompt ?? "");
    setShowAgentWorkflowForm(true);
    setInfo(`Loaded profile "${profile.name}" in editor.`);
    setError(null);
  };

  const handleDeleteAgentProfile = async (profileId: string) => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await deleteAgentProfile(token, profileId);
      setAgentProfiles((current) => current.filter((profile) => profile.id !== profileId));
      if (selectedAgentProfileId === profileId) {
        setSelectedAgentProfileId("");
        setAgentName("");
        setAgentTaskDescription("");
        setAgentObjectiveType("lead");
        setShowAgentWorkflowForm(false);
      }
      setInfo("Agent profile removed.");
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSetAgentLive = async (profileId: string, live: boolean) => {
    if (!token) {
      return;
    }
    const profile = agentProfiles.find((item) => item.id === profileId);
    if (!profile) {
      setError("Select an agent profile first.");
      return;
    }

    setSelectedAgentProfileId(profile.id);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await updateAgentProfile(token, profile.id, {
        name: profile.name,
        linkedNumber: profile.linkedNumber,
        channelType: profile.channelType,
        businessBasics: profile.businessBasics,
        personality: profile.personality,
        customPrompt: profile.customPrompt ?? "",
        objectiveType: profile.objectiveType,
        taskDescription: profile.taskDescription ?? "",
        isActive: live
      });
      await loadAgentProfiles();
      setInfo(live
        ? `Agent "${profile.name}" is now live for ${profile.channelType === "web" ? "web channel" : profile.linkedNumber} (${profile.channelType.toUpperCase()}).`
        : `Agent "${profile.name}" disabled.`);
    } catch (applyError) {
      setError((applyError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleIngest = async (source: "website" | "manual", rawValue: string, sourceName?: string) => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      let nextWebsite = websiteUrl.trim();
      let nextManual = manualFaq.trim();

      if (source === "website") {
        const url = rawValue.trim();
        if (!url) {
          throw new Error("Enter a website URL first.");
        }
        const response = await ingestWebsite(token, url, sourceName);
        setInfo(`URL ingested (${response.chunks} chunks).`);
        nextWebsite = url;
        setWebsiteUrl(url);
      } else {
        const text = rawValue.trim();
        if (text.length < 20) {
          throw new Error("Manual text must be at least 20 characters.");
        }
        const response = await ingestManual(token, text, sourceName);
        setInfo(`Text ingested (${response.chunks} chunks).`);
        nextManual = text;
        setManualFaq(text);
      }
      await saveBusinessBasics(token, { ...businessBasics, websiteUrl: nextWebsite, manualFaq: nextManual });
      await refreshUser();
      await refreshKnowledge();
      await loadData();
    } catch (ingestError) {
      setError((ingestError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePdfUpload = async (files: File[]) => {
    if (!token || files.length === 0) {
      return;
    }

    if (uploadingFiles) {
      setError("A PDF upload is already running.");
      return;
    }

    const accepted = files.filter((file) => file.type === "application/pdf" && file.size <= MAX_PDF_UPLOAD_BYTES);
    if (accepted.length === 0) {
      setError("No valid PDF selected (max 20MB each).");
      return;
    }

    const uploadItems = accepted.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`,
      name: file.name,
      size: file.size,
      status: "uploading" as const,
      progress: 0
    }));
    setPdfUploadItems((current) => [...uploadItems, ...current].slice(0, 25));
    setUploadingFiles(true);
    setError(null);
    setInfo(null);
    stopUploadPolling();

    try {
      const response = await ingestPdf(token, accepted);
      const jobsByName = new Map(response.jobs.map((job) => [job.source_name || "", job]));
      setPdfUploadItems((current) =>
        current.map((item) => {
          const job = jobsByName.get(item.name);
          if (!job) {
            return { ...item, status: "error", progress: 100, error: "Job not created" };
          }
          return { ...item, jobId: job.id, status: "uploading", progress: Math.max(5, job.progress || 0) };
        })
      );

      const jobIds = response.jobs.map((job) => job.id);
      uploadPollRef.current = setInterval(() => {
        void fetchIngestionJobs(token, jobIds)
          .then((jobsResponse) => {
            setPdfUploadItems((current) =>
              current.map((item) => {
                const job = jobsResponse.jobs.find((candidate) => candidate.id === item.jobId);
                if (!job) {
                  return item;
                }
                if (job.status === "failed") {
                  return { ...item, status: "error", progress: 100, error: job.error_message || "Upload failed" };
                }
                const done = job.status === "completed" || Boolean(job.completed_at) || job.progress >= 100;
                if (done) {
                  return { ...item, status: "done", progress: 100, chunks: job.chunks_created };
                }
                return { ...item, status: "uploading", progress: job.progress };
              })
            );

            const pending = jobsResponse.jobs.some((job) => job.status === "queued" || job.status === "processing");
            if (!pending) {
              stopUploadPolling();
              setUploadingFiles(false);
              void refreshKnowledge();
              void loadData();
            }
          })
          .catch(() => {
            stopUploadPolling();
            setUploadingFiles(false);
          });
      }, 1500);
    } catch (uploadError) {
      setUploadingFiles(false);
      setPdfUploadItems((current) =>
        current.map((item) => ({
          ...item,
          status: "error",
          progress: 100,
          error: (uploadError as Error).message
        }))
      );
    }
  };

  const handleDeleteSource = async (sourceType: KnowledgeSource["source_type"], sourceName: string | null) => {
    if (!token || !sourceName) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await deleteKnowledgeSource(token, { sourceType, sourceName });
      await refreshKnowledge();
      await loadData();
      setInfo("Source deleted.");
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openKnowledgeModal = (
    type: "manual" | "website" | "pdf",
    mode: "add" | "edit" = "add",
    source?: { sourceType: KnowledgeSource["source_type"]; sourceName: string }
  ) => {
    setShowKnowledgeMenu(false);
    setKnowledgeMode(mode);
    setEditingSource(source ?? null);
    setKnowledgeModal(type);
    setModalSourceName(source?.sourceName ?? "");
    if (type === "website") {
      setModalWebsiteUrl(websiteUrl);
    }
    if (type === "manual") {
      setModalManualText(manualFaq);
    }
    if (type === "pdf") {
      setModalPdfFiles([]);
    }
  };

  const closeKnowledgeModal = () => {
    setKnowledgeModal(null);
    setEditingSource(null);
    setKnowledgeMode("add");
  };

  const handleProceedKnowledgeModal = async () => {
    if (!knowledgeModal) {
      return;
    }

    const resolvedSourceName = modalSourceName.trim() || editingSource?.sourceName || undefined;
    if (knowledgeMode === "edit" && editingSource?.sourceName) {
      await handleDeleteSource(editingSource.sourceType, editingSource.sourceName);
    }

    if (knowledgeModal === "website") {
      await handleIngest("website", modalWebsiteUrl, resolvedSourceName);
      closeKnowledgeModal();
      return;
    }

    if (knowledgeModal === "manual") {
      await handleIngest("manual", modalManualText, resolvedSourceName);
      closeKnowledgeModal();
      return;
    }

    await handlePdfUpload(modalPdfFiles);
    closeKnowledgeModal();
  };

  const openChunkViewer = async (sourceType: KnowledgeSource["source_type"], sourceName: string | null) => {
    if (!token || !sourceName) {
      return;
    }
    setChunkViewerSource({ sourceType, sourceName });
    setChunkViewerLoading(true);
    try {
      const response = await fetchKnowledgeChunks(token, { sourceType, sourceName, limit: 120 });
      setChunkViewerItems(response.chunks);
    } catch {
      setChunkViewerItems([]);
    } finally {
      setChunkViewerLoading(false);
    }
  };

  const companyLabel =
    businessBasics.companyName ||
    (typeof user?.business_basics?.companyName === "string" ? String(user.business_basics.companyName) : "") ||
    user?.name ||
    "WAgen AI";
  const selectedAgentProfile =
    agentProfiles.find((profile) => profile.id === selectedAgentProfileId) ?? null;
  const websiteChannelEnabled = Boolean(overview?.agent.active);
  const qrChannelStatus = overview?.whatsapp.status ?? "not_connected";
  const qrChannelConnected = qrChannelStatus === "connected";
  const apiChannelConnected = metaBusinessStatus.connected;
  const isAnyChannelConnected = websiteChannelEnabled || qrChannelConnected || apiChannelConnected;
  const connectionBadgeStatus = connectionLoading
    ? "checking"
    : isAnyChannelConnected
      ? "connected"
      : qrChannelStatus === "waiting_scan" || qrChannelStatus === "connecting"
        ? qrChannelStatus
        : "not_connected";
  const connectionBadgeLabel = connectionLoading
    ? "Checking..."
    : qrChannelConnected
      ? "QR connected"
      : apiChannelConnected
        ? "API connected"
        : websiteChannelEnabled
          ? "Web connected"
          : qrChannelStatus === "waiting_scan"
            ? "QR waiting scan"
            : qrChannelStatus === "connecting"
              ? "QR connecting"
              : "disconnected";
  const workspaceCreditsLabel = workspaceCredits
    ? `${workspaceCredits.remaining_credits} / ${workspaceCredits.total_credits}`
    : "-- / --";
  const workspaceLowCreditMessage = workspaceCredits?.low_credit_message ?? null;
  const selectedConversationLabel = selectedConversation
    ? selectedConversation.contact_name || formatPhone(selectedConversation.contact_phone || selectedConversation.phone_number)
    : "Select a conversation";
  const selectedConversationAiTimer =
    selectedConversation ? chatAiTimers[selectedConversation.id] ?? null : null;
  const selectedConversationAiTimerLabel = selectedConversationAiTimer
    ? (() => {
        const remainingMs = Math.max(0, selectedConversationAiTimer.executeAt - Date.now());
        const totalMinutes = Math.ceil(remainingMs / 60_000);
        if (totalMinutes >= 60) {
          const hours = Math.ceil(totalMinutes / 60);
          return `${hours}h`;
        }
        return `${Math.max(1, totalMinutes)}m`;
      })()
    : null;
  const chatListHeading =
    chatFolderFilter === "all"
      ? "All chats"
      : chatFolderFilter === "unassigned"
        ? "Unassigned"
        : chatFolderFilter === "mine"
          ? "My chats"
          : "Bot chats";
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
  const workspaceId = user?.id ?? "";
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
    `wid="${escapeHtmlAttribute(workspaceId)}" ` +
    `data-theme-color="${escapeHtmlAttribute(widgetThemeColor)}" ` +
    `data-position="right" ` +
    `data-greeting="${escapeHtmlAttribute(widgetGreetingText)}" ` +
    `data-api-base="${escapeHtmlAttribute(API_URL)}"></script>`;
  const studioMeta: Record<DashboardTab, { label: string; subtitle: string }> = {
    conversations: { label: "Chats", subtitle: "Live Inbox" },
    leads: { label: "Leads", subtitle: "Priority Queue" },
    billing: { label: "Billing", subtitle: "Credits, invoices, and renewals" },
    knowledge: { label: "Knowledge Base", subtitle: "Manage all ingested sources" },
    chatbot_personality: { label: "Chatbot Personality", subtitle: "Tune voice, identity, and behavior" },
    unanswered_questions: { label: "AI Review Center", subtitle: "Review low-confidence replies and teach better answers" },
    settings: { label: "Settings", subtitle: "Configure QR and Business API channels" },
    bot_agents: { label: "AI Agents", subtitle: "Manage channel-linked agents" }
  };
  const currentSection = studioMeta[activeTab];
  const isStudioTab = STUDIO_TABS.has(activeTab);
  const dashboardHeaderTitle =
    activeTab === "conversations"
      ? (isAnyChannelConnected ? "Chats" : "Go Live")
      : currentSection.label;
  const dashboardHeaderSubtitle =
    activeTab === "conversations"
      ? (isAnyChannelConnected ? "Live Inbox" : "Connect your channels and launch chatbot automation.")
      : currentSection.subtitle;
  const showConversationListPane = !isMobileViewport || !isMobileConversationOpen;
  const showConversationDetailPane = !isMobileViewport || isMobileConversationOpen;

  const handleSelectTab = useCallback(
    (tab: DashboardTab) => {
      setActiveTab(tab);
      if (isMobileViewport) {
        setIsMobileSidebarOpen(false);
        if (tab !== "conversations") {
          setIsMobileConversationOpen(false);
        }
      }
    },
    [isMobileViewport]
  );

  const handleOpenConversation = useCallback(
    (conversationId: string) => {
      setSelectedConversationId(conversationId);
      if (isMobileViewport) {
        setIsMobileConversationOpen(true);
      }
    },
    [isMobileViewport]
  );

  const renderStudioLayout = (content: ReactNode) => (
    <section className="chatbot-studio-shell dashboard-flat-studio">
      <aside className="chatbot-studio-sidebar dashboard-flat-studio-sidebar">
        <h2>AI Agents</h2>
        <nav className="chatbot-studio-menu dashboard-flat-studio-menu">
          {CHATBOT_STUDIO_MENU.map((item) => (
            <button
              key={item.value}
              type="button"
              className={
                item.value === "test_chatbot"
                  ? (isTestChatOverlayOpen ? "active" : "")
                  : (activeTab === item.value ? "active" : "")
              }
              onClick={() => {
                if (item.value === "test_chatbot") {
                  openTestChatOverlay();
                  return;
                }
                setActiveTab(item.value);
              }}
            >
              <span>
                <NavIcon name={item.icon} />
              </span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="chatbot-studio-content">{content}</div>
    </section>
  );

  return (
    <main className="dashboard-shell dashboard-clone-shell dashboard-flat-shell">
      <section className="clone-workspace">
        <aside
          className={
            isMobileViewport
              ? `clone-icon-rail dashboard-flat-sidebar ${isMobileSidebarOpen ? "mobile-open" : "mobile-closed"}`
              : "clone-icon-rail dashboard-flat-sidebar"
          }
          id="dashboard-mobile-sidebar"
        >
          <button className="clone-rail-logo dashboard-flat-brand" type="button" onClick={() => handleSelectTab("conversations")}>
            <span className="clone-rail-icon">
              <NavIcon name="brand" />
            </span>
            <span className="clone-rail-label">{companyLabel}</span>
          </button>
          <nav className="clone-rail-menu dashboard-flat-menu">
            {DASHBOARD_TAB_OPTIONS.map((option) => {
              const isActive = option.value === "knowledge" ? isStudioTab : activeTab === option.value;
              return (
                <button
                  key={option.value}
                  className={isActive ? "clone-rail-btn dashboard-flat-item active" : "clone-rail-btn dashboard-flat-item"}
                  type="button"
                  title={option.label}
                  onClick={() => handleSelectTab(option.value)}
                >
                  <span className="clone-rail-icon">
                    <NavIcon name={option.icon} />
                  </span>
                  <span className="clone-rail-label">{option.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="clone-rail-divider" />
          <div className="clone-rail-spacer" />
          <button
            className="clone-rail-btn dashboard-flat-item"
            type="button"
            title="Logout"
            onClick={() => {
              if (isMobileViewport) {
                setIsMobileSidebarOpen(false);
              }
              logout();
              navigate("/signup", { replace: true });
            }}
          >
            <span className="clone-rail-icon">
              <NavIcon name="logout" />
            </span>
            <span className="clone-rail-label">Logout</span>
          </button>
        </aside>
        {isMobileViewport && isMobileSidebarOpen ? (
          <button
            type="button"
            className="dashboard-mobile-scrim"
            aria-label="Close menu"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        ) : null}

        <section className="clone-main dashboard-flat-main">
          <header className="clone-main-header dashboard-flat-header">
            <div className="dashboard-header-left">
              {isMobileViewport ? (
                <button
                  type="button"
                  className="dashboard-mobile-menu-btn"
                  aria-label="Open menu"
                  aria-expanded={isMobileSidebarOpen}
                  aria-controls="dashboard-mobile-sidebar"
                  onClick={() => setIsMobileSidebarOpen((current) => !current)}
                >
                  &#9776;
                </button>
              ) : null}
              <div>
              <h1>{dashboardHeaderTitle}</h1>
              <p>{dashboardHeaderSubtitle}</p>
              </div>
            </div>
            <div className="clone-main-actions">
              <button
                type="button"
                className={workspaceCredits?.low_credit ? "credits-chip credits-chip-low" : "credits-chip"}
                onClick={() => setActiveTab("billing")}
                title="Open Billing"
              >
                Credits: {workspaceCreditsLabel}
              </button>
              <span className={`status-badge status-${connectionBadgeStatus}`}>
                {connectionBadgeLabel}
              </span>
              <button className="ghost-btn" type="button" onClick={() => setActiveTab("billing")}>
                Billing
              </button>
              <button className="ghost-btn" type="button" disabled={busy} onClick={handlePauseAgent}>
                {overview?.agent.active ? "Pause Agent" : "Activate Agent"}
              </button>
              <button className="ghost-btn" type="button" onClick={openTestChatOverlay}>
                Test chatbot
              </button>
              {isStudioTab && (
                <button className="ghost-btn" type="button" onClick={() => setActiveTab("chatbot_personality")}>
                  Bot settings
                </button>
              )}
            </div>
          </header>
          {workspaceLowCreditMessage ? (
            <div className="credits-warning-banner" role="status">
              {workspaceLowCreditMessage}
            </div>
          ) : null}

      {activeTab === "billing" && token ? (
        <DashboardBillingCenter token={token} onCreditsRefresh={refreshWorkspaceCreditSummary} />
      ) : null}

      {activeTab === "knowledge" && renderStudioLayout(
        <section className="finance-shell">
          <article className="finance-panel">
            <div className="kb-toolbar">
              <h2>Articles</h2>
              <div className="kb-toolbar-actions">
                <button className="ghost-btn" type="button" disabled={busy} onClick={() => void refreshKnowledge()}>
                  Refresh
                </button>
                <div className="kb-add-wrap">
                  <button className="primary-btn" type="button" disabled={busy} onClick={() => setShowKnowledgeMenu((current) => !current)}>
                    + New
                  </button>
                  {showKnowledgeMenu && (
                    <div className="kb-add-menu">
                      <button type="button" onClick={() => openKnowledgeModal("manual")}>
                        <strong>Manual</strong>
                        <small>Manually add business info to train the chatbot</small>
                      </button>
                      <button type="button" onClick={() => openKnowledgeModal("website")}>
                        <strong>URL</strong>
                        <small>Add URL and fetch pages from your website</small>
                      </button>
                      <button type="button" onClick={() => openKnowledgeModal("pdf")}>
                        <strong>PDF</strong>
                        <small>Upload PDF with your business details</small>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {pdfUploadItems.length > 0 && (
              <div className="file-chip-list">
                {pdfUploadItems.map((item) => (
                  <span key={item.id} className="file-chip">
                    {item.name}{" "}
                    {item.status === "uploading"
                      ? `Uploading (${item.progress ?? 0}%)`
                      : item.status === "done"
                        ? `Done (${item.chunks ?? 0} chunks)`
                        : item.status === "error"
                          ? `Failed: ${item.error || "upload error"}`
                          : "Queued"}
                  </span>
                ))}
              </div>
            )}
            {knowledgeSources.length === 0 ? (
              <p className="empty-note">No articles found.</p>
            ) : (
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr>
                      <th>Title & Description</th>
                      <th>Type</th>
                      <th>Created On</th>
                      <th>Chunks</th>
                      <th>Modified On</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knowledgeSources.map((source) => (
                      <tr key={`${source.source_type}-${source.source_name}-${source.last_ingested_at}`}>
                        <td>{source.source_name || "Untitled source"}</td>
                        <td>{source.source_type}</td>
                        <td>{new Date(source.last_ingested_at).toLocaleDateString()}</td>
                        <td>{source.chunks}</td>
                        <td>{new Date(source.last_ingested_at).toLocaleString()}</td>
                        <td>Success</td>
                        <td>
                          {source.source_name ? (
                            <div className="kb-row-actions">
                              <button className="ghost-btn" type="button" onClick={() => void openChunkViewer(source.source_type, source.source_name)}>
                                View chunks
                              </button>
                              {source.source_type === "manual" || source.source_type === "website" ? (
                                <button
                                  className="ghost-btn"
                                  type="button"
                                  onClick={() =>
                                    openKnowledgeModal(
                                      source.source_type === "manual" ? "manual" : "website",
                                      "edit",
                                      { sourceType: source.source_type, sourceName: source.source_name as string }
                                    )
                                  }
                                >
                                  Edit
                                </button>
                              ) : null}
                              <button className="ghost-btn" type="button" disabled={busy} onClick={() => void handleDeleteSource(source.source_type, source.source_name)}>
                                Delete
                              </button>
                            </div>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      )}

      {knowledgeModal && (
        <div className="kb-modal-backdrop" onClick={closeKnowledgeModal}>
          <div className="kb-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{knowledgeMode === "edit" ? "Edit knowledge" : knowledgeModal === "manual" ? "Add manual text" : knowledgeModal === "website" ? "Add URL" : "Add PDF"}</h3>

            {knowledgeModal !== "pdf" && (
              <label>
                Knowledge name
                <input
                  value={modalSourceName}
                  onChange={(event) => setModalSourceName(event.target.value)}
                  placeholder={knowledgeModal === "manual" ? "Example: Return policy v2" : "Example: Website pricing page"}
                />
              </label>
            )}

            {knowledgeModal === "manual" && (
              <label>
                Manual content
                <textarea
                  value={modalManualText}
                  onChange={(event) => setModalManualText(event.target.value)}
                  placeholder="Manually add your business info to train the chatbot"
                />
              </label>
            )}

            {knowledgeModal === "website" && (
              <label>
                Website URL
                <input
                  type="url"
                  value={modalWebsiteUrl}
                  onChange={(event) => setModalWebsiteUrl(event.target.value)}
                  placeholder="https://yourcompany.com"
                />
              </label>
            )}

            {knowledgeModal === "pdf" && (
              <label>
                PDF file(s)
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(event) => setModalPdfFiles(Array.from(event.target.files ?? []))}
                />
                {modalPdfFiles.length > 0 && (
                  <div className="kb-modal-file-list">
                    {modalPdfFiles.map((file) => (
                      <div key={`${file.name}-${file.size}`} className="kb-modal-file">
                        <span>{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setModalPdfFiles((current) => current.filter((currentFile) => currentFile !== file))
                          }
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </label>
            )}

            <div className="kb-modal-actions">
              <button type="button" className="ghost-btn" onClick={closeKnowledgeModal}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={
                  busy ||
                  ((knowledgeModal === "manual" || knowledgeModal === "website") && !modalSourceName.trim()) ||
                  (knowledgeModal === "manual" && modalManualText.trim().length < 20) ||
                  (knowledgeModal === "website" && !modalWebsiteUrl.trim()) ||
                  (knowledgeModal === "pdf" && modalPdfFiles.length === 0)
                }
                onClick={() => void handleProceedKnowledgeModal()}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {chunkViewerSource && (
        <div className="kb-modal-backdrop" onClick={() => setChunkViewerSource(null)}>
          <div className="kb-modal kb-modal-wide" onClick={(event) => event.stopPropagation()}>
            <h3>Chunks: {chunkViewerSource.sourceName}</h3>
            {chunkViewerLoading ? (
              <p className="tiny-note">Loading chunks...</p>
            ) : chunkViewerItems.length === 0 ? (
              <p className="empty-note">No chunks found for this source.</p>
            ) : (
              <div className="kb-chunk-list">
                {chunkViewerItems.map((chunk) => (
                  <article key={chunk.id} className="kb-chunk-card">
                    <header>
                      <strong>{chunk.source_type}</strong>
                      <small>{new Date(chunk.created_at).toLocaleString()}</small>
                    </header>
                    <p>{chunk.content_chunk}</p>
                  </article>
                ))}
              </div>
            )}
            <div className="kb-modal-actions">
              <button type="button" className="primary-btn" onClick={() => setChunkViewerSource(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTab === "chatbot_personality" && renderStudioLayout(
        <section className="chatbot-personality-view">
          <article className="chatbot-personality-panel">
            <header className="chatbot-personality-head">
              <h2>Bot settings</h2>
              <button type="button" className="primary-btn" disabled={busy} onClick={() => void handleSaveChatbotPersonality()}>
                Save settings
              </button>
            </header>

            <nav className="chatbot-personality-tabs">
              <button
                type="button"
                className={personalityPanelTab === "answer_formatting" ? "active" : ""}
                onClick={() => setPersonalityPanelTab("answer_formatting")}
              >
                Answer formatting
              </button>
              <button
                type="button"
                className={personalityPanelTab === "bot_identity" ? "active" : ""}
                onClick={() => setPersonalityPanelTab("bot_identity")}
              >
                Bot Identity
              </button>
              <button
                type="button"
                className={personalityPanelTab === "custom_instructions" ? "active" : ""}
                onClick={() => setPersonalityPanelTab("custom_instructions")}
              >
                Custom instructions
              </button>
            </nav>

            {personalityPanelTab === "answer_formatting" && (
              <div className="chatbot-personality-body">
                <label>Length of responses</label>
                <div className="personality-chip-row">
                  {[
                    { value: "descriptive", label: "Descriptive" },
                    { value: "medium", label: "Medium" },
                    { value: "short", label: "Short" }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={responseLengthPreference === item.value ? "personality-chip active" : "personality-chip"}
                      onClick={() => setResponseLengthPreference(item.value as ResponseLengthPreference)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label>Chatbot tone</label>
                <div className="personality-chip-row">
                  {[
                    { value: "matter_of_fact", label: "Matter of fact" },
                    { value: "friendly", label: "Friendly" },
                    { value: "humorous", label: "Humorous" },
                    { value: "neutral", label: "Neutral" },
                    { value: "professional", label: "Professional" }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={tonePreference === item.value ? "personality-chip active" : "personality-chip"}
                      onClick={() => setTonePreference(item.value as TonePreference)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label>Chatbot gender</label>
                <div className="personality-chip-row">
                  {[
                    { value: "female", label: "Female" },
                    { value: "male", label: "Male" },
                    { value: "neutral", label: "Neutral" }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={genderPreference === item.value ? "personality-chip active" : "personality-chip"}
                      onClick={() => setGenderPreference(item.value as GenderPreference)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label>Preferred language</label>
                <div className="personality-chip-row">
                  {[
                    { value: "english", label: "English" },
                    { value: "hindi", label: "Hindi" },
                    { value: "hinglish", label: "Hinglish" },
                    { value: "bengali", label: "Bengali" },
                    { value: "none", label: "None" }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={languagePreference === item.value ? "personality-chip active" : "personality-chip"}
                      onClick={() => setLanguagePreference(item.value as LanguagePreference)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="personality-checkbox-row">
                  <label>
                    <input type="checkbox" checked={enableEmojis} onChange={(event) => setEnableEmojis(event.target.checked)} />
                    Use emojis
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={enableBulletPoints}
                      onChange={(event) => setEnableBulletPoints(event.target.checked)}
                    />
                    Use bullet points
                  </label>
                </div>
              </div>
            )}

            {personalityPanelTab === "bot_identity" && (
              <div className="chatbot-personality-body">
                <label>
                  Bot name
                  <input value={botName} onChange={(event) => setBotName(event.target.value)} placeholder="e.g. FoodSrtudio" />
                </label>
                <label>
                  What is your business about?
                  <textarea
                    rows={6}
                    value={botBusinessAbout}
                    onChange={(event) => setBotBusinessAbout(event.target.value)}
                    placeholder="Write here..."
                  />
                </label>
                <label>
                  What will the bot say when it does not know the answer?
                  <input
                    value={botUnknownReply}
                    onChange={(event) => setBotUnknownReply(event.target.value)}
                    placeholder="Sorry, I don't have information on this."
                  />
                </label>
                <label>
                  Words and phrases to avoid in conversations
                  <input
                    value={botAvoidWords}
                    onChange={(event) => setBotAvoidWords(event.target.value)}
                    placeholder="e.g. abusive words or unsafe terms"
                  />
                </label>
              </div>
            )}

            {personalityPanelTab === "custom_instructions" && (
              <div className="chatbot-personality-body">
                <h3>Add custom behavior commands/prompt for your bot</h3>
                <div className="instruction-group">
                  <strong>Do's</strong>
                  {doRules.map((rule, index) => (
                    <div key={`do-${index}`} className="instruction-row">
                      <textarea
                        value={rule}
                        onChange={(event) => handleRuleChange("do", index, event.target.value)}
                        placeholder="e.g. Keep responses concise"
                      />
                      <button type="button" onClick={() => handleDeleteRule("do", index)}>
                        Delete
                      </button>
                    </div>
                  ))}
                  <button type="button" className="link-btn add-row-btn" onClick={() => handleAddRule("do")}>
                    + Add
                  </button>
                </div>

                <div className="instruction-group">
                  <strong>Don'ts</strong>
                  {dontRules.map((rule, index) => (
                    <div key={`dont-${index}`} className="instruction-row">
                      <textarea
                        value={rule}
                        onChange={(event) => handleRuleChange("dont", index, event.target.value)}
                        placeholder="e.g. Do not guess pricing details"
                      />
                      <button type="button" onClick={() => handleDeleteRule("dont", index)}>
                        Delete
                      </button>
                    </div>
                  ))}
                  <button type="button" className="link-btn add-row-btn" onClick={() => handleAddRule("dont")}>
                    + Add
                  </button>
                </div>
              </div>
            )}
          </article>
        </section>
      )}
      {activeTab === "unanswered_questions" && renderStudioLayout(
        <section className="ai-review-center">
          <div className="ai-review-head">
            <h2>AI Review & Learning Center</h2>
            <div className="clone-hero-actions">
              <button type="button" className="ghost-btn" disabled={reviewLoading} onClick={() => void loadAiReviewQueue()}>
                Refresh Queue
              </button>
              <button type="button" className="ghost-btn" onClick={() => setActiveTab("knowledge")}>
                Open Knowledge Base
              </button>
            </div>
          </div>
          <p className="ai-review-copy">
            Improve your AI by reviewing low-confidence replies and unresolved conversations, then save corrected answers to
            Knowledge Base.
          </p>

          <div className="ai-review-cards">
            <article>
              <strong>{reviewHighlights.pending}</strong>
              <span>Pending review</span>
            </article>
            <article>
              <strong>{reviewHighlights.lowConfidenceToday}</strong>
              <span>Low confidence today</span>
            </article>
            <article>
              <strong>{reviewHighlights.resolvedToday}</strong>
              <span>Resolved today</span>
            </article>
          </div>

          <div className="ai-review-filters">
            {([
              { value: "pending", label: "Pending" },
              { value: "resolved", label: "Resolved" },
              { value: "all", label: "All" }
            ] as Array<{ value: AiReviewStatusFilter; label: string }>).map((item) => (
              <button
                key={item.value}
                type="button"
                className={reviewStatusFilter === item.value ? "active" : ""}
                onClick={() => setReviewStatusFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="ai-review-layout">
            <div className="ai-review-table-wrap finance-table-wrap">
              {reviewLoading ? (
                <p className="empty-note">Loading review queue...</p>
              ) : reviewRows.length === 0 ? (
                <p className="empty-note">No conversations in this filter yet.</p>
              ) : (
                <table className="finance-table ai-review-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Question</th>
                      <th>AI Answer</th>
                      <th>Confidence</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map((item) => (
                      <tr
                        key={item.id}
                        className={selectedReviewId === item.id ? "selected" : ""}
                        onClick={() => setSelectedReviewId(item.id)}
                      >
                        <td>
                          <strong>{formatPhone(item.customer_phone)}</strong>
                          <small>{formatDateTime(item.created_at)}</small>
                        </td>
                        <td>{item.question}</td>
                        <td>{item.ai_response}</td>
                        <td>
                          <span className={item.confidence_score < 70 ? "ai-review-confidence low" : "ai-review-confidence"}>
                            {item.confidence_score}%
                          </span>
                        </td>
                        <td>{getReviewStatusLabel(item.status)}</td>
                        <td>
                          <button type="button" className="ghost-btn" onClick={() => setSelectedReviewId(item.id)}>
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <aside className="ai-review-detail">
              {!selectedReview ? (
                <p className="empty-note">Select a conversation to review.</p>
              ) : (
                <>
                  <header>
                    <h3>{getReviewStatusLabel(selectedReview.status)}</h3>
                    <small>{formatPhone(selectedReview.customer_phone)}</small>
                  </header>

                  <div className="ai-review-block">
                    <strong>Customer question</strong>
                    <p>{selectedReview.question}</p>
                  </div>

                  <div className="ai-review-block">
                    <strong>AI generated answer</strong>
                    <p>{selectedReview.ai_response}</p>
                  </div>

                  <div className="ai-review-meta-row">
                    <span className={selectedReview.confidence_score < 70 ? "ai-review-confidence low" : "ai-review-confidence"}>
                      Confidence {selectedReview.confidence_score}%
                    </span>
                    <div className="ai-review-signals">
                      {selectedReview.trigger_signals.map((signal) => (
                        <span key={signal}>{getReviewSignalLabel(signal)}</span>
                      ))}
                    </div>
                  </div>

                  {selectedReview.conversation_id && (
                    <div className="ai-review-block">
                      <strong>Conversation context</strong>
                      {reviewConversationLoading ? (
                        <p className="empty-note">Loading conversation...</p>
                      ) : reviewConversationMessages.length === 0 ? (
                        <p className="empty-note">No conversation history found.</p>
                      ) : (
                        <div className="ai-review-context">
                          {reviewConversationMessages.slice(-12).map((message) => (
                            <div key={message.id} className={`ai-review-context-item ${message.direction}`}>
                              <p>{message.message_text}</p>
                              <small>{new Date(message.created_at).toLocaleString()}</small>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <label>
                    Correct answer
                    <textarea
                      rows={5}
                      value={reviewResolutionAnswer}
                      onChange={(event) => setReviewResolutionAnswer(event.target.value)}
                      placeholder="Write the correct answer to teach AI for future similar questions."
                    />
                  </label>

                  <div className="clone-hero-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={resolvingReview || selectedReview.status === "resolved"}
                      onClick={() => void handleResolveReviewItem({ addToKnowledgeBase: true })}
                    >
                      Save & Add to Knowledge Base
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={resolvingReview || selectedReview.status === "resolved"}
                      onClick={() => void handleResolveReviewItem({ addToKnowledgeBase: false })}
                    >
                      Mark resolved
                    </button>
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>
      )}
      {activeTab === "settings" && (
        <section className="clone-settings-view go-live-settings">
          <div className="clone-settings-top go-live-top">
            <h2>Go live</h2>
          </div>

          <div className="go-live-grid">
            <article className="go-live-card">
              <div className="go-live-card-body">
                <div className="go-live-card-head">
                  <span className="go-live-icon">
                    <NavIcon name="knowledge" />
                  </span>
                  <button
                    type="button"
                    className={websiteChannelEnabled ? "go-live-switch on" : "go-live-switch"}
                    disabled={busy}
                    onClick={handlePauseAgent}
                    aria-label={websiteChannelEnabled ? "Deactivate website channel" : "Activate website channel"}
                    title={websiteChannelEnabled ? "Deactivate website channel" : "Activate website channel"}
                  >
                    <span />
                  </button>
                </div>
                <h3>Connect to Website</h3>
                <p>Customize your chatbot appearance, get integration code and go live.</p>
              </div>
              <footer className="go-live-card-footer">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setSettingsSubmenu("setup_web");
                    setWidgetSnippetCopied("idle");
                  }}
                >
                  Setup
                </button>
              </footer>
            </article>

            <article className="go-live-card">
              <div className="go-live-card-body">
                <div className="go-live-card-head">
                  <span className="go-live-icon">
                    <NavIcon name="chats" />
                  </span>
                  <button
                    type="button"
                    className={qrChannelConnected ? "go-live-switch on" : "go-live-switch"}
                    disabled={busy}
                    onClick={() => void handleToggleQrChannel()}
                    aria-label={qrChannelConnected ? "Deactivate QR channel" : "Activate QR channel"}
                    title={qrChannelConnected ? "Deactivate QR channel" : "Activate QR channel"}
                  >
                    <span />
                  </button>
                </div>
                <h3>Connect to WhatsApp</h3>
                <p>Configure your chatbot settings, get login QR code and go live.</p>
              </div>
              <footer className="go-live-card-footer">
                <button type="button" className="ghost-btn" onClick={() => navigate("/onboarding/qr")}>
                  Setup
                </button>
              </footer>
            </article>

            <article className="go-live-card">
              <div className="go-live-card-body">
                <div className="go-live-card-head">
                  <span className="go-live-icon">
                    <NavIcon name="settings" />
                  </span>
                  <button
                    type="button"
                    className={apiChannelConnected ? "go-live-switch on" : "go-live-switch"}
                    disabled={busy}
                    onClick={() => void handleToggleApiChannel()}
                    aria-label={apiChannelConnected ? "Deactivate API channel" : "Activate API channel"}
                    title={apiChannelConnected ? "Deactivate API channel" : "Activate API channel"}
                  >
                    <span />
                  </button>
                </div>
                <h3>Connect to WACA</h3>
                <p>Configure your chatbot settings, login facebook and go live.</p>
              </div>
              <footer className="go-live-card-footer">
                <button type="button" className="ghost-btn" onClick={() => setSettingsSubmenu("setup_api")}>
                  Setup
                </button>
              </footer>
            </article>
          </div>

          {settingsSubmenu === "setup_web" && (
            <article className="channel-setup-panel">
              <header>
                <h3>Customize your website chatbot</h3>
                <p>
                  Website test chat and website widget use the same channel. Every new message appears in inbox in real time.
                </p>
              </header>
              <div className="web-widget-setup-layout">
                <section className="web-widget-form-section">
                  <div className="web-widget-row">
                    <label>
                      Chatbot logo
                      <input
                        value={widgetSetupDraft.chatbotLogoUrl}
                        onChange={(event) =>
                          setWidgetSetupDraft((current) => ({ ...current, chatbotLogoUrl: event.target.value }))
                        }
                        placeholder="Enter URL for chatbot icon"
                      />
                    </label>
                  </div>

                  <div className="web-widget-row">
                    <p className="web-widget-label">Chatbot size</p>
                    <div className="web-widget-radio-row">
                      {(
                        [
                          { key: "small", label: "Small" },
                          { key: "medium", label: "Medium" },
                          { key: "large", label: "Large" }
                        ] as const
                      ).map((item) => (
                        <label key={item.key}>
                          <input
                            type="radio"
                            checked={widgetSetupDraft.chatbotSize === item.key}
                            onChange={() =>
                              setWidgetSetupDraft((current) => ({ ...current, chatbotSize: item.key }))
                            }
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="web-widget-row">
                    <p className="web-widget-label">Device visibility</p>
                    <div className="web-widget-radio-row">
                      {(
                        [
                          { key: "both", label: "Both" },
                          { key: "phone", label: "Phone" },
                          { key: "desktop", label: "Desktop" }
                        ] as const
                      ).map((item) => (
                        <label key={item.key}>
                          <input
                            type="radio"
                            checked={widgetSetupDraft.deviceVisibility === item.key}
                            onChange={() =>
                              setWidgetSetupDraft((current) => ({ ...current, deviceVisibility: item.key }))
                            }
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="web-widget-row">
                    <p className="web-widget-label">Initial questions (up to 3)</p>
                    <div className="web-widget-question-list">
                      {[0, 1, 2].map((idx) => (
                        <div key={idx} className="web-widget-question-item">
                          <input
                            value={widgetSetupDraft.initialQuestions[idx as 0 | 1 | 2]}
                            onChange={(event) => handleWidgetQuestionChange(idx as 0 | 1 | 2, event.target.value)}
                            placeholder="Enter question"
                          />
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => handleWidgetQuestionChange(idx as 0 | 1 | 2, "")}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="web-widget-row">
                    <label className="web-widget-toggle-row">
                      <span className="web-widget-label">Initial greetings</span>
                      <button
                        type="button"
                        className={widgetSetupDraft.initialGreetingEnabled ? "go-live-switch on" : "go-live-switch"}
                        onClick={() =>
                          setWidgetSetupDraft((current) => ({
                            ...current,
                            initialGreetingEnabled: !current.initialGreetingEnabled
                          }))
                      }
                      >
                        <span />
                      </button>
                    </label>
                    <textarea
                      rows={2}
                      value={widgetSetupDraft.initialGreeting}
                      onChange={(event) =>
                        setWidgetSetupDraft((current) => ({ ...current, initialGreeting: event.target.value }))
                      }
                      placeholder="Enter greeting"
                    />
                  </div>

                  <div className="web-widget-row">
                    <label>
                      Disclaimer
                      <textarea
                        rows={2}
                        value={widgetSetupDraft.disclaimer}
                        onChange={(event) =>
                          setWidgetSetupDraft((current) => ({ ...current, disclaimer: event.target.value }))
                        }
                        placeholder="Enter fallback disclaimer"
                      />
                    </label>
                  </div>

                  <div className="web-widget-row">
                    <label>
                      Background colour
                      <div className="web-widget-color-row">
                        <input
                          type="color"
                          value={widgetThemeColor}
                          onChange={(event) =>
                            setWidgetSetupDraft((current) => ({ ...current, backgroundColor: event.target.value }))
                          }
                        />
                        <input
                          value={widgetSetupDraft.backgroundColor}
                          onChange={(event) =>
                            setWidgetSetupDraft((current) => ({ ...current, backgroundColor: event.target.value }))
                          }
                        />
                      </div>
                    </label>
                  </div>

                  <div className="web-widget-row">
                    <div className="web-widget-code-head">
                      <p className="web-widget-label">Integration code</p>
                      <button type="button" className="ghost-btn" onClick={() => void handleCopyWidgetSnippet()}>
                        Copy
                      </button>
                    </div>
                    <pre className="widget-inline-code">
                      <code>{widgetScriptSnippet}</code>
                    </pre>
                    {widgetSnippetCopied === "copied" && <p className="tiny-note">Integration code copied.</p>}
                    {widgetSnippetCopied === "error" && <p className="tiny-note">Copy failed. Copy from code block manually.</p>}
                  </div>

                  <div className="clone-hero-actions">
                    <button type="button" className="primary-btn" onClick={handleSaveWidgetSetup}>
                      Save
                    </button>
                  </div>
                </section>

                <aside className="web-widget-preview-section">
                  <div className="web-widget-preview-top">
                    <label>
                      Preview Widget
                      <select
                        value={widgetSetupDraft.previewOpen ? "open" : "closed"}
                        onChange={(event) =>
                          setWidgetSetupDraft((current) => ({
                            ...current,
                            previewOpen: event.target.value === "open"
                          }))
                        }
                      >
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                      </select>
                    </label>
                    <button type="button" className="ghost-btn" onClick={openTestChatOverlay}>
                      Test
                    </button>
                  </div>

                  <div className={`web-widget-preview-phone ${widgetPreviewSizeClass}`}>
                    <header style={{ background: widgetThemeColor }}>
                      <strong>{companyLabel}</strong>
                    </header>
                    {widgetSetupDraft.previewOpen && (
                      <>
                        <div ref={widgetPreviewScrollRef} className="web-widget-preview-thread">
                          {widgetSetupDraft.initialGreetingEnabled && widgetSetupDraft.initialGreeting.trim() && (
                            <p>{widgetSetupDraft.initialGreeting.trim()}</p>
                          )}
                          {widgetSetupDraft.disclaimer.trim() && (
                            <small>{widgetSetupDraft.disclaimer.trim()}</small>
                          )}
                        </div>
                        <footer>
                          <input placeholder="Type here..." readOnly />
                          <button type="button">Send</button>
                        </footer>
                      </>
                    )}
                  </div>
                  <button type="button" className="web-widget-preview-fab" style={{ background: widgetThemeColor }}>
                    W
                  </button>
                </aside>
              </div>
            </article>
          )}

          {settingsSubmenu === "setup_qr" && (
            <article className="channel-setup-panel">
              <header>
                <h3>Instant QR Mode Setup</h3>
                <p>Connect WhatsApp quickly for starter usage. Best for testing and small-scale automation.</p>
              </header>
              <div className="clone-channel-meta">
                <div>
                  <h3>Status</h3>
                  <p>{overview?.whatsapp.status ?? "disconnected"}</p>
                </div>
                <div>
                  <h3>Linked Number</h3>
                  <p>{overview?.whatsapp.phoneNumber ? formatPhone(overview.whatsapp.phoneNumber) : "Not linked"}</p>
                </div>
                <div>
                  <h3>Session</h3>
                  <p>{overview?.whatsapp.hasQr ? "QR generated" : "Not generated"}</p>
                </div>
              </div>
              <div className="clone-hero-actions">
                <button type="button" className="primary-btn" onClick={() => navigate("/onboarding/qr")}>
                  Setup QR
                </button>
                <button type="button" className="ghost-btn" disabled={busy} onClick={() => void handleReconnectWhatsApp()}>
                  Reconnect
                </button>
              </div>
              <p className="tiny-note">
                QR mode is ideal for testing and early-stage businesses. For long-term growth, use Official API mode.
              </p>
            </article>
          )}

          {settingsSubmenu === "setup_api" && (
            <article className="channel-setup-panel">
              <header>
                <h3>Official WhatsApp API Setup</h3>
                <p>Connect Meta Embedded Signup for stable production messaging at scale, then configure business profile.</p>
              </header>
              <div className="api-setup-alert">
                <strong>
                  Facebook Business Verification -{" "}
                  {formatMetaStatusLabel(apiBusinessVerificationStatus, "Pending")}
                </strong>
                <p>
                  {apiBusinessVerificationPending
                    ? "Please complete Meta business verification to unlock higher messaging limits and stable deliverability."
                    : "Business verification is in a healthy state. Keep profile and compliance details updated in Meta."}
                </p>
              </div>
              <div className="clone-channel-meta">
                <div>
                  <h3>Status</h3>
                  <p>{metaBusinessStatus.connection?.status ?? "disconnected"}</p>
                </div>
                <div>
                  <h3>Linked Number</h3>
                  <p>
                    {metaBusinessStatus.connection?.linkedNumber
                      ? formatPhone(metaBusinessStatus.connection.linkedNumber)
                      : (metaBusinessStatus.connection?.displayPhoneNumber ?? "Not linked")}
                  </p>
                </div>
                <div>
                  <h3>WABA ID</h3>
                  <p>{metaBusinessStatus.connection?.wabaId ?? "Not connected"}</p>
                </div>
              </div>
              <div className="clone-channel-meta">
                <div>
                  <h3>Quality Rating</h3>
                  <p>{formatMetaStatusLabel(apiQualityRating)}</p>
                </div>
                <div>
                  <h3>Message Limit</h3>
                  <p>{formatMetaStatusLabel(apiMessagingLimitTier)}</p>
                </div>
                <div>
                  <h3>Code Verification</h3>
                  <p>{formatMetaStatusLabel(apiCodeVerificationStatus)}</p>
                </div>
              </div>
              <div className="clone-channel-meta">
                <div>
                  <h3>Name Status</h3>
                  <p>{formatMetaStatusLabel(apiNameStatus)}</p>
                </div>
                <div>
                  <h3>Account Review</h3>
                  <p>{formatMetaStatusLabel(apiWabaReviewStatus)}</p>
                </div>
                <div>
                  <h3>Last Meta Sync</h3>
                  <p>{apiLastMetaSyncLabel ?? "Not synced"}</p>
                </div>
              </div>
              <div className="api-profile-tabs">
                {["Profile", "Compliance Info", "Assignments", "Configuration", "Channel Logs"].map((tab) => (
                  <button key={tab} type="button" className={tab === "Profile" ? "active" : ""}>
                    {tab}
                  </button>
                ))}
              </div>

              <form
                className="api-profile-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSaveWhatsAppBusinessProfile();
                }}
              >
                <label>
                  WhatsApp Display Picture URL
                  <input
                    value={whatsAppBusinessDraft.displayPictureUrl}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, displayPictureUrl: event.target.value }))
                    }
                    placeholder="https://..."
                  />
                </label>
                <label>
                  Address
                  <textarea
                    rows={2}
                    maxLength={256}
                    value={whatsAppBusinessDraft.address}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, address: event.target.value }))
                    }
                    placeholder="Enter address"
                  />
                </label>
                <label>
                  Business Description
                  <textarea
                    rows={3}
                    maxLength={256}
                    value={whatsAppBusinessDraft.businessDescription}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, businessDescription: event.target.value }))
                    }
                    placeholder="Message not available now, leave a message"
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    maxLength={128}
                    value={whatsAppBusinessDraft.email}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="Enter email"
                  />
                </label>
                <label>
                  Vertical
                  <select
                    value={whatsAppBusinessDraft.vertical}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, vertical: event.target.value }))
                    }
                  >
                    <option value="Restaurant">Restaurant</option>
                    <option value="Retail">Retail</option>
                    <option value="Education">Education</option>
                    <option value="Healthcare">Healthcare</option>
                    <option value="Services">Services</option>
                  </select>
                </label>
                <label>
                  Website URL
                  <input
                    value={whatsAppBusinessDraft.websiteUrl}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, websiteUrl: event.target.value }))
                    }
                    placeholder="https://your-website.com"
                  />
                </label>
                <label>
                  About
                  <input
                    maxLength={139}
                    value={whatsAppBusinessDraft.about}
                    onChange={(event) =>
                      setWhatsAppBusinessDraft((current) => ({ ...current, about: event.target.value }))
                    }
                    placeholder="Official WhatsApp Business Account"
                  />
                </label>

                <div className="clone-hero-actions">
                  <button type="submit" className="primary-btn">
                    Apply
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setWhatsAppBusinessDraft(DEFAULT_WHATSAPP_BUSINESS_PROFILE_DRAFT)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
              <div className="clone-hero-actions">
                <button type="button" className="primary-btn" disabled={busy} onClick={() => void handleOpenBusinessApiSetup()}>
                  {metaBusinessStatus.connection ? "Reconnect API" : "Connect API"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy || !metaBusinessStatus.connection}
                  onClick={() => void handleRefreshMetaApiStatus()}
                >
                  Refresh status
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy || !metaBusinessStatus.connection}
                  onClick={() => void handleToggleApiChannel()}
                >
                  Disconnect
                </button>
              </div>
              <p className="tiny-note">
                Official API channel is recommended for long-term growth and higher reliability.
              </p>
            </article>
          )}

          <article className="channel-setup-panel account-danger-panel">
            <header>
              <h3>Account Settings</h3>
              <p>
                Delete your account permanently. This revokes connected WhatsApp tokens, removes webhook subscriptions,
                and deletes associated business data from active systems.
              </p>
            </header>
            <div className="web-widget-row">
              <label>
                Type <strong>DELETE</strong> to confirm
                <input
                  value={deleteAccountConfirmText}
                  onChange={(event) => setDeleteAccountConfirmText(event.target.value)}
                  placeholder="DELETE"
                />
              </label>
            </div>
            <div className="clone-hero-actions">
              <button
                type="button"
                className="account-danger-btn"
                disabled={busy || deletingAccount || deleteAccountConfirmText.trim() !== "DELETE"}
                onClick={() => void handleDeleteAccount()}
              >
                {deletingAccount ? "Deleting..." : "Delete Account"}
              </button>
            </div>
            <p className="tiny-note">This action is irreversible.</p>
          </article>
        </section>
      )}

      {activeTab === "bot_agents" && renderStudioLayout(
        <section className="clone-settings-view agent-manager-shell">
          <div className="agent-manager-head">
            <div className="agent-manager-title">
              <h3>Agents</h3>
              <p>One live agent per channel chat. Keep others disabled as drafts.</p>
            </div>
            <button type="button" className="primary-btn agent-manager-add-btn" onClick={handleStartNewAgent}>
              + Add
            </button>
          </div>

          {agentProfiles.length === 0 && !showAgentWorkflowForm ? (
            <div className="agent-manager-empty">
              <h3>No agents found</h3>
              <button type="button" className="primary-btn" onClick={handleStartNewAgent}>
                + Add
              </button>
            </div>
          ) : (
            <>
              {agentProfiles.length > 0 && (
                <div className="agent-manager-cards">
                  {agentProfiles.map((profile) => (
                    <article
                      key={profile.id}
                      className={selectedAgentProfileId === profile.id ? "agent-profile-card active" : "agent-profile-card"}
                    >
                      <header>
                        <strong>{profile.name}</strong>
                        <div className="agent-card-badges">
                          <span>
                            {profile.channelType === "api"
                              ? "WHATSAPP API"
                              : profile.channelType === "qr"
                                ? "WHATSAPP QR"
                                : "WEB"}
                          </span>
                          <span className={profile.isActive ? "agent-status-pill live" : "agent-status-pill disabled"}>
                            {profile.isActive ? "LIVE" : "DISABLED"}
                          </span>
                        </div>
                      </header>
                      <p>
                        {profile.objectiveType.toUpperCase()} AGENT
                        {profile.channelType !== "web" ? ` | ${profile.linkedNumber}` : ""}
                      </p>
                      <small>{new Date(profile.createdAt).toLocaleString()}</small>
                      <div className="agent-profile-actions">
                        <button type="button" className="ghost-btn" onClick={() => handleLoadAgentProfile(profile)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={busy || profile.isActive}
                          onClick={() => void handleSetAgentLive(profile.id, true)}
                        >
                          Go Live
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={busy || !profile.isActive}
                          onClick={() => void handleSetAgentLive(profile.id, false)}
                        >
                          Disable
                        </button>
                        <button type="button" className="ghost-btn" onClick={() => handleDeleteAgentProfile(profile.id)}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {showAgentWorkflowForm && (
                <form
                  className="stack-form clone-settings-form agent-workflow-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateOrUpdateAgentProfile();
                  }}
                >
                  <h3>{selectedAgentProfile ? "Update Workflow" : "Add Workflow"}</h3>
                  <div className="train-grid two-col simple-agent-grid">
                    <label>
                      Name of the AI agent
                      <input required value={agentName} onChange={(event) => setAgentName(event.target.value)} />
                    </label>
                    <label>
                      Agent Nature
                      <select
                        value={agentObjectiveType}
                        onChange={(event) => setAgentObjectiveType(event.target.value as "lead" | "feedback" | "complaint" | "hybrid")}
                      >
                        <option value="lead">Lead Capture Agent</option>
                        <option value="feedback">Feedback Agent</option>
                        <option value="complaint">Complaint Agent</option>
                        <option value="hybrid">Hybrid Agent</option>
                      </select>
                    </label>
                    <label>
                      Channel Mode
                      <select
                        value={agentChannelType}
                        onChange={(event) => setAgentChannelType(event.target.value as "web" | "qr" | "api")}
                      >
                        <option value="web">Web Chat</option>
                        <option value="qr">QR Mode</option>
                        <option value="api">Official API Mode</option>
                      </select>
                    </label>
                    {agentChannelType !== "web" && (
                      <label>
                        Linked Number
                        <input
                          required
                          value={agentLinkedNumber}
                          onChange={(event) => setAgentLinkedNumber(event.target.value)}
                        />
                      </label>
                    )}
                    <label className="agent-task-field">
                      Define the task which you want to achieve using this agent.
                      <textarea
                        required
                        value={agentTaskDescription}
                        onChange={(event) => setAgentTaskDescription(event.target.value)}
                        placeholder="Ex - Capture qualified leads and ask one clear next-step question. Or handle complaints and collect order ID before escalation."
                      />
                    </label>
                  </div>
                  <p className="tiny-note">
                    Save creates/updates a disabled draft. Use Go Live on a card to activate. Only one live agent is allowed per channel chat.
                  </p>

                  <div className="clone-hero-actions">
                    <button className="primary-btn" type="submit" disabled={busy}>
                      {selectedAgentProfile ? "Update Agent Profile" : "Save Agent Profile"}
                    </button>
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={() => setShowAgentWorkflowForm(false)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      className="ghost-btn"
                      type="button"
                      disabled={busy || !selectedAgentProfileId}
                      onClick={() => selectedAgentProfileId && void handleDeleteAgentProfile(selectedAgentProfileId)}
                    >
                      Delete selected
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      )}

      {isTestChatOverlayOpen && (
        <div className="test-chat-overlay-backdrop" onClick={closeTestChatOverlay}>
          <aside
            className="test-chat-overlay-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Test chatbot"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="test-chat-overlay-header">
              <div>
                <h2>Test Website Chat (Live)</h2>
                <p>
                  This test uses the same website widget channel. Incoming test messages create or update web conversations in inbox.
                </p>
              </div>
              <button type="button" className="ghost-btn" onClick={closeTestChatOverlay}>
                Close
              </button>
            </header>
            <div className="test-chat-overlay-meta">
              <span className={testWidgetStatus === "connected" ? "status-badge status-connected" : "status-badge status-not_connected"}>
                Widget channel: {testWidgetStatus}
              </span>
            </div>
            <article className="journey-chat-preview dashboard-test-chat dashboard-test-chat-overlay">
              <header>
                <strong>{companyLabel}</strong>
              </header>
              <div className="journey-chat-scroll">
                {testChatRows.map((row) => (
                  <div key={row.id} className={row.sender === "bot" ? "bot-row" : "user-row"}>
                    <p>{row.text}</p>
                    <small>{row.time}</small>
                  </div>
                ))}
                {testChatSending && <div className="bot-row typing">Typing...</div>}
              </div>
              <form className="journey-chat-input" onSubmit={handleSendTestChat}>
                <input
                  placeholder="Type here..."
                  value={testChatInput}
                  onChange={(event) => setTestChatInput(event.target.value)}
                />
                <button type="submit" aria-label="Send">
                  {"->"}
                </button>
              </form>
              <small className="journey-powered">Powered by WAgen AI</small>
            </article>
            <div className="clone-hero-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  setActiveTab("knowledge");
                  closeTestChatOverlay();
                }}
              >
                Improve quality of answers
              </button>
            </div>
          </aside>
        </div>
      )}

      {activeTab === "leads" && (
        <section className="finance-shell">
          <article className="finance-panel">
            <div className="kb-toolbar">
              <h2>All Leads</h2>
              <div className="header-actions">
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => void handleSummarizeLeads()}
                  disabled={summarizingLeads || leadsLoading}
                >
                  {summarizingLeads ? "Summarizing..." : "Summarize All"}
                </button>
                <button className="ghost-btn" type="button" onClick={() => void loadLeads()} disabled={leadsLoading}>
                  {leadsLoading ? "Refreshing..." : "Refresh"}
                </button>
                <button className="ghost-btn" type="button" onClick={handleExportLeads}>
                  Export Excel
                </button>
                <select value={leadStageFilter} onChange={(event) => setLeadStageFilter(event.target.value as "all" | "hot" | "warm" | "cold")}>
                  <option value="all">All stages</option>
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                </select>
                <select value={leadKindFilter} onChange={(event) => setLeadKindFilter(event.target.value as LeadKindFilter)}>
                  <option value="all">All types</option>
                  <option value="lead">Lead</option>
                  <option value="feedback">Feedback</option>
                  <option value="complaint">Complaint</option>
                  <option value="other">Other</option>
                </select>
                <select
                  value={leadChannelFilter}
                  onChange={(event) => setLeadChannelFilter(event.target.value as LeadChannelFilter)}
                >
                  <option value="all">All channels</option>
                  <option value="web">Web</option>
                  <option value="qr">WhatsApp QR</option>
                  <option value="api">WhatsApp API</option>
                </select>
                <label className="lead-toggle-filter">
                  <input
                    type="checkbox"
                    checked={leadTodayOnly}
                    onChange={(event) => setLeadTodayOnly(event.target.checked)}
                  />
                  Today only
                </label>
                <label className="lead-toggle-filter">
                  <input
                    type="checkbox"
                    checked={leadRequiresReplyOnly}
                    onChange={(event) => setLeadRequiresReplyOnly(event.target.checked)}
                  />
                  Must reply
                </label>
              </div>
            </div>
            <div className="lead-highlight-grid">
              <button
                type="button"
                className={leadQuickFilter === "today_hot" ? "lead-highlight-card active" : "lead-highlight-card"}
                onClick={() => setLeadQuickFilter((current) => (current === "today_hot" ? "all" : "today_hot"))}
              >
                <strong>{leadHighlights.todayHot}</strong>
                <span>Today's Hot Leads</span>
              </button>
              <button
                type="button"
                className={leadQuickFilter === "today_warm" ? "lead-highlight-card active" : "lead-highlight-card"}
                onClick={() => setLeadQuickFilter((current) => (current === "today_warm" ? "all" : "today_warm"))}
              >
                <strong>{leadHighlights.todayWarm}</strong>
                <span>Today's Warm Leads</span>
              </button>
              <button
                type="button"
                className={leadQuickFilter === "today_complaint" ? "lead-highlight-card active" : "lead-highlight-card"}
                onClick={() => setLeadQuickFilter((current) => (current === "today_complaint" ? "all" : "today_complaint"))}
              >
                <strong>{leadHighlights.todayComplaints}</strong>
                <span>Today's Complaints</span>
              </button>
              <button
                type="button"
                className={leadQuickFilter === "needs_reply" ? "lead-highlight-card active" : "lead-highlight-card"}
                onClick={() => setLeadQuickFilter((current) => (current === "needs_reply" ? "all" : "needs_reply"))}
              >
                <strong>{leadHighlights.mustReply}</strong>
                <span>Must Reply</span>
              </button>
            </div>
            <div className="lead-quick-filter-row">
              {LEAD_QUICK_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={leadQuickFilter === option.value ? "active" : ""}
                  onClick={() => setLeadQuickFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {leadsLoading && <p className="tiny-note">Refreshing leads...</p>}
            {summarizingLeads && (
              <p className="tiny-note">Generating summaries for all missing or outdated leads.</p>
            )}
            {leads.length === 0 ? (
              <p className="empty-note">No leads found for the selected filter.</p>
            ) : (
              <div className="finance-table-wrap leads-table-wrap">
                <table className="finance-table leads-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Type</th>
                      <th>Stage</th>
                      <th>Score</th>
                      <th>Channel</th>
                      <th>Assigned Agent</th>
                      <th>Reply</th>
                      <th>AI Summary</th>
                      <th>Last Message</th>
                      <th>Last Activity</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
                      const leadStageClass =
                        lead.stage === "hot" || lead.stage === "warm" || lead.stage === "cold" ? lead.stage : "cold";
                      const summaryText =
                        lead.ai_summary ||
                        (lead.summary_status === "missing"
                          ? "No summary yet. Click Summarize All."
                          : "Summary is outdated. Click Summarize All.");
                      const lastMessageText = lead.last_message || "-";
                      const summaryExpanded = Boolean(expandedLeadSummaries[lead.id]);
                      const messageExpanded = Boolean(expandedLeadMessages[lead.id]);
                      const showSummaryToggle = summaryText.length > 140;
                      const showMessageToggle = lead.last_message ? lead.last_message.length > 90 : false;

                      return (
                        <tr key={lead.id}>
                          <td className="lead-name">{lead.contact_name || "Unknown"}</td>
                          <td className="lead-phone">{formatPhone(lead.contact_phone || lead.phone_number)}</td>
                          <td>
                            <span className={`lead-kind ${lead.lead_kind}`}>{getLeadKindLabel(lead.lead_kind)}</span>
                          </td>
                          <td>
                            <span className={`lead-stage ${leadStageClass}`}>{lead.stage}</span>
                          </td>
                          <td className="lead-score">{lead.score}</td>
                          <td>{getChannelLabel(lead.channel_type)}</td>
                          <td>{lead.assigned_agent_name || "Auto"}</td>
                          <td>
                            <span className={lead.requires_reply ? "lead-reply-pill yes" : "lead-reply-pill no"}>
                              {lead.requires_reply ? "You must reply" : "Normal"}
                            </span>
                          </td>
                          <td className="lead-summary-cell">
                            <span className={`summary-status ${lead.summary_status}`}>
                              {getSummaryStatusLabel(lead.summary_status)}
                            </span>
                            <p
                              className={summaryExpanded ? "lead-summary-text expanded" : "lead-summary-text"}
                              title={summaryText}
                            >
                              {summaryText}
                            </p>
                            {showSummaryToggle && (
                              <button
                                type="button"
                                className="lead-expand-btn"
                                onClick={() => toggleLeadSummary(lead.id)}
                              >
                                {summaryExpanded ? "Less" : "More"}
                              </button>
                            )}
                            <small className="lead-summary-time">
                              Updated: {formatDateTime(lead.summary_updated_at)}
                            </small>
                          </td>
                          <td className="lead-last-message">
                            <p
                              className={messageExpanded ? "lead-last-message-text expanded" : "lead-last-message-text"}
                              title={lastMessageText}
                            >
                              {lastMessageText}
                            </p>
                            {showMessageToggle && (
                              <button
                                type="button"
                                className="lead-expand-btn"
                                onClick={() => toggleLeadMessage(lead.id)}
                              >
                                {messageExpanded ? "Less" : "More"}
                              </button>
                            )}
                          </td>
                          <td>{formatDateTime(lead.last_message_at)}</td>
                          <td>
                            <button
                              className="ghost-btn"
                              type="button"
                              onClick={() => {
                                setSelectedConversationId(lead.id);
                                setActiveTab("conversations");
                                if (isMobileViewport) {
                                  setIsMobileConversationOpen(true);
                                }
                              }}
                            >
                              Open Chat
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>
      )}
      {activeTab === "conversations" && (
        <section className="clone-chat-wrap">
          {!isAnyChannelConnected ? (
            <section className="clone-chat-setup">
              <h2>Go Live</h2>
              <p>Connect your channels and go live.</p>
              <div className="clone-setup-grid">
                <article className="clone-setup-panel">
                  <div className="clone-setup-head">
                    <span className="clone-setup-icon">
                      <NavIcon name="knowledge" />
                    </span>
                    <div>
                      <h3>Connect to Website</h3>
                      <p>Customize your chatbot appearance, get integration code and go live.</p>
                    </div>
                  </div>
                  <div className="clone-hero-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => {
                        setActiveTab("settings");
                        setSettingsSubmenu("setup_web");
                      }}
                    >
                      Setup
                    </button>
                  </div>
                </article>
                <article className="clone-setup-panel">
                  <div className="clone-setup-head">
                    <span className="clone-setup-icon">
                      <NavIcon name="chats" />
                    </span>
                    <div>
                      <h3>Connect to WhatsApp</h3>
                      <p>Configure your chatbot settings, get login QR code and go live.</p>
                    </div>
                  </div>
                  <div className="clone-hero-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => navigate("/onboarding/qr")}
                    >
                      Setup
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => void handleReconnectWhatsApp()}
                    >
                      Reconnect
                    </button>
                  </div>
                </article>
                <article className="clone-setup-panel">
                  <div className="clone-setup-head">
                    <span className="clone-setup-icon">
                      <NavIcon name="settings" />
                    </span>
                    <div>
                      <h3>Connect to WACA</h3>
                      <p>Configure your chatbot settings, login facebook and go live.</p>
                    </div>
                  </div>
                  <div className="clone-hero-actions">
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => {
                        setActiveTab("settings");
                        setSettingsSubmenu("setup_api");
                      }}
                    >
                      Setup
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setActiveTab("settings");
                        setSettingsSubmenu("setup_api");
                      }}
                    >
                      Open Settings
                    </button>
                  </div>
                </article>
              </div>
            </section>
          ) : (
            <>
              <section
                className={
                  isMobileViewport
                    ? `clone-chat-layout ${isMobileConversationOpen ? "mobile-conversation-panel" : "mobile-conversation-list"}`
                    : "clone-chat-layout"
                }
              >
                {showConversationListPane ? (
                <aside className="clone-thread-list">
                  <div className="clone-thread-top-tabs">
                    {CHAT_FOLDER_FILTER_OPTIONS.map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        className={chatFolderFilter === filter.value ? "active" : ""}
                        onClick={() => setChatFolderFilter(filter.value)}
                      >
                        {filter.label}
                        <span>{chatFolderCounts[filter.value]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="clone-thread-toolbar">
                    <h3>
                      {chatListHeading} <span>{filteredConversations.length}</span>
                    </h3>
                    <label className="clone-chat-search">
                      <input
                        value={chatSearch}
                        onChange={(event) => setChatSearch(event.target.value)}
                        placeholder="Search chats..."
                      />
                    </label>
                  </div>
                  {filteredConversations.length === 0 ? (
                    <p className="empty-note">
                      {chatSearch.trim()
                        ? "No conversations match your search."
                        : "No conversations yet. Send a new inbound message to start chat tracking."}
                    </p>
                  ) : (
                    filteredConversations.map((conversation) => {
                      const label = conversation.contact_name || formatPhone(conversation.contact_phone || conversation.phone_number);
                      const stage = conversation.stage.toLowerCase();
                      const stageClass = stage === "hot" || stage === "warm" || stage === "cold" ? stage : "cold";
                      const stageLabel = `${stageClass.charAt(0).toUpperCase()}${stageClass.slice(1)} Lead`;
                      const initials = label
                        .split(" ")
                        .map((part) => part[0] ?? "")
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();
                      return (
                        <button
                          key={conversation.id}
                          className={
                            conversation.id === selectedConversationId
                              ? `clone-thread-item stage-${stageClass} active`
                              : `clone-thread-item stage-${stageClass}`
                          }
                          onClick={() => handleOpenConversation(conversation.id)}
                        >
                          <span className="clone-thread-avatar">{initials || "U"}</span>
                          <div>
                            <header>
                              <div className="clone-thread-title">
                                <strong>{label}</strong>
                                <span className={`clone-thread-stage ${stageClass}`}>{stageLabel}</span>
                              </div>
                              <small>{conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString() : ""}</small>
                            </header>
                            <p>{conversation.last_message || "No messages yet"}</p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </aside>
                ) : null}

                {showConversationDetailPane ? (
                <section className="clone-chat-panel">
                  <header className="clone-chat-head">
                    <div className="clone-chat-head-main">
                      {isMobileViewport ? (
                        <button type="button" className="chat-mobile-back-btn" onClick={() => setIsMobileConversationOpen(false)}>
                          Back
                        </button>
                      ) : null}
                      <div>
                      <h2>{selectedConversationLabel}</h2>
                      {selectedConversation ? (
                        <div className="chat-meta-row">
                          <span>{formatPhone(selectedConversation.contact_phone || selectedConversation.phone_number)}</span>
                          {selectedConversation.contact_email ? <span>{selectedConversation.contact_email}</span> : null}
                          <span className="chat-channel-badge">{getConversationChannelBadge(selectedConversation.channel_type)}</span>
                          <span>{getLeadKindLabel(selectedConversation.lead_kind)}</span>
                          <span>Score {selectedConversation.score}</span>
                          <span className={`clone-thread-stage ${selectedConversation.stage}`}>{selectedConversation.stage}</span>
                          <span className={selectedConversation.ai_paused ? "chat-flag paused" : "chat-flag live"}>
                            {selectedConversation.ai_paused ? "AI Paused" : "AI Live"}
                          </span>
                        </div>
                      ) : null}
                      </div>
                    </div>
                    {selectedConversation && (
                      <div className="chat-actions" ref={chatAiMenuRef}>
                        <button className="ghost-btn" disabled={busy} onClick={() => setChatAiMenuOpen((current) => !current)}>
                          {selectedConversation.ai_paused ? "Turn on AI" : "Turn off AI"}
                        </button>
                        {selectedConversationAiTimerLabel && (
                          <span className="chat-ai-timer-badge">Timer {selectedConversationAiTimerLabel}</span>
                        )}
                        {chatAiMenuOpen && (
                          <div className="chat-ai-menu">
                            {selectedConversation.ai_paused ? (
                              <>
                                {CHAT_AI_DURATION_OPTIONS.map((option) => (
                                  <button
                                    key={option.label}
                                    type="button"
                                    onClick={() => void handleApplyChatAiMode(false, option.minutes)}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </>
                            ) : (
                              <>
                                {CHAT_AI_DURATION_OPTIONS.map((option) => (
                                  <button
                                    key={option.label}
                                    type="button"
                                    onClick={() => void handleApplyChatAiMode(true, option.minutes)}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </header>

                  <div ref={messagesScrollRef} className="clone-messages messages-scroll">
                    {messages.length === 0 ? (
                      <p className="empty-note">No messages in this chat yet.</p>
                    ) : (
                      messages.map((message) => (
                        <div key={message.id} className={`bubble ${message.direction}`}>
                          <p>{message.message_text}</p>
                          {message.direction === "outbound" && message.total_tokens ? (
                            <small className="token-meta">
                              Tokens: {message.total_tokens}
                              {typeof message.prompt_tokens === "number" ? ` (P:${message.prompt_tokens}` : ""}
                              {typeof message.completion_tokens === "number" ? ` C:${message.completion_tokens})` : ""}
                              {message.ai_model ? ` | ${message.ai_model}` : ""}
                            </small>
                          ) : null}
                          <small>{new Date(message.created_at).toLocaleTimeString()}</small>
                        </div>
                      ))
                    )}
                  </div>
                  {selectedConversation && (
                    <form className="chat-manual-compose" onSubmit={handleSendAgentMessage}>
                      <input
                        value={agentReplyText}
                        onChange={(event) => setAgentReplyText(event.target.value)}
                        placeholder='Type message or "/" for quick response'
                      />
                      <button type="submit" className="primary-btn" disabled={sendingAgentMessage || !agentReplyText.trim()}>
                        {sendingAgentMessage ? "Sending..." : "Send"}
                      </button>
                    </form>
                  )}
                </section>
                ) : null}
              </section>
            </>
          )}
        </section>
      )}

        </section>
      </section>

      {(info || error) && (
        <div className="dashboard-toast-stack" aria-live="polite" aria-atomic="true">
          {info && (
            <div className="dashboard-toast dashboard-toast-success" role="status">
              <p>{info}</p>
              <button
                type="button"
                className="dashboard-toast-close"
                aria-label="Dismiss notification"
                onClick={() => setInfo(null)}
              >
                x
              </button>
            </div>
          )}
          {error && (
            <div className="dashboard-toast dashboard-toast-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="dashboard-toast-close"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                x
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
