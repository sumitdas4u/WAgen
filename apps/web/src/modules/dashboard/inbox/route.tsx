import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Conversation, ConversationMessage, MessageTemplate } from "../../../lib/api";
import { fetchContactByConversation } from "../../../lib/api";
import { normalizeMessage, renderMessage } from "./message-renderer";
import { uploadInboxMedia as uploadInboxMediaToSupabase } from "../../../lib/supabase";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import {
  assignInboxFlow,
  sendManualConversationMessage,
  updateConversationAiMode,
  aiAssistText
} from "./api";
import {
  buildInboxConversationsQueryOptions,
  useInboxConversationsQuery,
  useInboxMessagesQuery,
  useInboxPublishedFlowsQuery,
  useInboxTemplatesQuery
} from "./queries";

// ─── Types ──────────────────────────────────────────────────────────────────

type LeadStageFilter = "all" | "hot" | "warm" | "cold";
type ChannelFilter = "all" | "web" | "qr" | "api";
type ScoreFilter = "all" | "hot" | "warm" | "cold";
type AssignmentFilter = "all" | "me" | "team" | "unassigned";
type DateRangeFilter = "all" | "today" | "7d" | "30d";
type AiModeFilter = "all" | "live" | "human";
type LeadKindFilter = "all" | "lead" | "feedback" | "complaint" | "other";
type ChatFolderFilter = "all" | "unassigned" | "mine" | "bot";
type ChatAiTimedAction = { switchToPaused: boolean; executeAt: number };
type AttachedFile = { file: File; previewUrl: string; name: string; type: string };

// ─── Constants ───────────────────────────────────────────────────────────────

const LEAD_STAGE_OPTIONS: Array<{ value: LeadStageFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" }
];

const CHANNEL_OPTIONS: Array<{ value: ChannelFilter; label: string }> = [
  { value: "all", label: "All channels" },
  { value: "web", label: "Website" },
  { value: "qr", label: "WhatsApp QR" },
  { value: "api", label: "WhatsApp API" }
];

const SCORE_OPTIONS: Array<{ value: ScoreFilter; label: string }> = [
  { value: "all", label: "All scores" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" }
];

const ASSIGNMENT_OPTIONS: Array<{ value: AssignmentFilter; label: string }> = [
  { value: "all", label: "All owners" },
  { value: "me", label: "Me" },
  { value: "team", label: "Team" },
  { value: "unassigned", label: "Unassigned" }
];

const DATE_RANGE_OPTIONS: Array<{ value: DateRangeFilter; label: string }> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" }
];

const AI_MODE_OPTIONS: Array<{ value: AiModeFilter; label: string }> = [
  { value: "all", label: "AI + Human" },
  { value: "live", label: "AI live" },
  { value: "human", label: "Human handling" }
];

const LEAD_KIND_OPTIONS: Array<{ value: LeadKindFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "lead", label: "Lead" },
  { value: "feedback", label: "Feedback" },
  { value: "complaint", label: "Complaint" },
  { value: "other", label: "Other" }
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

const QUICK_EMOJIS = ["👍", "😊", "🙏", "✅", "🔥", "💯", "👋", "😄", "❤️", "🎉", "⚡", "📞", "📧", "💬", "🏷️", "🔔"];

const TRANSLATE_LANGUAGES = ["English", "Hindi", "Spanish", "French", "Arabic", "Portuguese", "Bengali", "Urdu", "Gujarati", "Marathi", "Tamil", "Telugu"];

function getTemplateBodyText(template: MessageTemplate): string {
  return template.components.find((c) => c.type === "BODY")?.text ?? template.name;
}



// ─── Utility functions ───────────────────────────────────────────────────────

function getOptionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function normalizeStage(stage: string | null | undefined): "hot" | "warm" | "cold" {
  if (stage === "hot" || stage === "warm" || stage === "cold") return stage;
  return "cold";
}

function formatPhone(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return value;
  return `+${digits}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "Not available";
  return new Date(t).toLocaleString();
}

function formatRelativeTime(value: string | null | undefined, now: number): string {
  if (!value) return "-";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "-";
  const diffMinutes = Math.round((t - now) / 60_000);
  if (Math.abs(diffMinutes) < 1) return "Just now";
  if (Math.abs(diffMinutes) < 60) return `${Math.abs(diffMinutes)}m ${diffMinutes < 0 ? "ago" : "from now"}`;
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return `${Math.abs(diffHours)}h ${diffHours < 0 ? "ago" : "from now"}`;
  const diffDays = Math.round(diffHours / 24);
  return `${Math.abs(diffDays)}d ${diffDays < 0 ? "ago" : "from now"}`;
}

function formatMessageTime(value: string): string {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(value: string): string {
  const d = new Date(Date.parse(value));
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

function isSameDay(a: string, b: string): boolean {
  return new Date(Date.parse(a)).toDateString() === new Date(Date.parse(b)).toDateString();
}

function getConversationDisplayName(c: Conversation): string {
  return c.contact_name || formatPhone(c.contact_phone || c.phone_number);
}

function getConversationChannelBadge(t: Conversation["channel_type"]) {
  if (t === "api") return "WA API";
  if (t === "qr") return "WA QR";
  return "Web";
}

function getConversationChannelLabel(t: Conversation["channel_type"]) {
  if (t === "api") return "WhatsApp Business API";
  if (t === "qr") return "WhatsApp QR";
  return "Website Chat";
}

function getLeadKindLabel(kind: Conversation["lead_kind"]) {
  if (kind === "feedback") return "Feedback";
  if (kind === "complaint") return "Complaint";
  if (kind === "other") return "Other";
  return "Lead";
}

function getLeadScoreBand(c: Conversation): "hot" | "warm" | "cold" {
  if (c.score >= 80) return "hot";
  if (c.score >= 55) return "warm";
  return "cold";
}

function getLeadScoreLabel(c: Conversation): string {
  return `${c.score}/100`;
}

function getMessagePreview(text: string | null): string {
  if (!text) return "No messages yet";
  if (text.startsWith("[Extracted image text]:")) return "📷 Photo";
  if (text === "[Image received with no readable text]") return "📷 Image";
  if (text.startsWith("📷")) return text.slice(0, 40);
  return text.slice(0, 80);
}


// ─── Filter logic ─────────────────────────────────────────────────────────────

function matchesStageFilter(c: Conversation, f: LeadStageFilter): boolean {
  return f === "all" || normalizeStage(c.stage) === f;
}
function matchesChannelFilter(c: Conversation, f: ChannelFilter): boolean {
  return f === "all" || c.channel_type === f;
}
function matchesScoreFilter(c: Conversation, f: ScoreFilter): boolean {
  return f === "all" || getLeadScoreBand(c) === f;
}
function matchesAssignmentFilter(c: Conversation, f: AssignmentFilter, me: string): boolean {
  const name = c.assigned_agent_name?.trim().toLowerCase() ?? "";
  const hasAssign = Boolean(c.assigned_agent_profile_id || name);
  if (f === "all") return true;
  if (f === "unassigned") return !hasAssign;
  if (f === "me") return me ? name === me : c.manual_takeover;
  return me ? hasAssign && name !== me : hasAssign;
}
function matchesDateRangeFilter(c: Conversation, f: DateRangeFilter): boolean {
  if (f === "all") return true;
  if (!c.last_message_at) return false;
  const t = Date.parse(c.last_message_at);
  if (!Number.isFinite(t)) return false;
  const diff = Date.now() - t;
  if (f === "today") {
    const now = new Date(), sample = new Date(t);
    return now.getFullYear() === sample.getFullYear() && now.getMonth() === sample.getMonth() && now.getDate() === sample.getDate();
  }
  return diff <= (f === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
}
function matchesAiModeFilter(c: Conversation, f: AiModeFilter): boolean {
  if (f === "all") return true;
  if (f === "live") return !c.ai_paused && !c.manual_takeover;
  return c.ai_paused || c.manual_takeover;
}
function matchesLeadKindFilter(c: Conversation, f: LeadKindFilter): boolean {
  return f === "all" || c.lead_kind === f;
}
function sortConversationsByRecent(rows: Conversation[]): Conversation[] {
  return [...rows].sort((a, b) => {
    const l = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const r = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return r - l;
  });
}

// ─── Lead insight helpers ─────────────────────────────────────────────────────

function getLeadIntentLabel(c: Conversation | null): string {
  if (!c) return "General enquiry";
  const msg = c.last_message?.toLowerCase() ?? "";
  if (c.lead_kind === "complaint") return "Issue resolution";
  if (c.lead_kind === "feedback") return "Product feedback";
  if (msg.includes("price") || msg.includes("pricing") || msg.includes("cost")) return "Pricing enquiry";
  if (msg.includes("menu")) return "Menu request";
  if (msg.includes("demo") || msg.includes("book") || msg.includes("call")) return "Booking / callback";
  if (msg.includes("apply") || msg.includes("application")) return "Application follow-up";
  return "General enquiry";
}

function getLeadSuggestedAction(c: Conversation | null): string {
  if (!c) return "Share the core info, collect missing details, and keep AI qualifying.";
  if (c.lead_kind === "complaint") return "Route to a human agent and confirm the resolution path quickly.";
  if (c.ai_paused || c.manual_takeover) return "Keep the conversation personal and close the next action with a human reply.";
  if (normalizeStage(c.stage) === "hot") return "Reply fast with pricing, proof, and a clear conversion CTA.";
  if (normalizeStage(c.stage) === "warm") return "Qualify the requirement, budget, and preferred timeline.";
  return "Share the core info, collect missing details, and keep AI qualifying.";
}

function getNextFollowUpLabel(c: Conversation): string {
  if (c.lead_kind === "complaint") return "Within 15 minutes";
  if (normalizeStage(c.stage) === "hot") return "Within 30 minutes";
  if (normalizeStage(c.stage) === "warm") return "Today";
  return "Within 24 hours";
}

function getReplySuggestions(c: Conversation): string[] {
  if (c.lead_kind === "complaint") {
    return [
      "I'm sorry about the trouble. I'm checking this for you right now.",
      "Thanks for flagging this. Let me fix it and share the next update shortly.",
      "I understand the concern. Can you share one more detail so I can resolve it quickly?"
    ];
  }
  if (normalizeStage(c.stage) === "hot") {
    return [
      "Happy to help. I can share pricing and the next step right away.",
      "Thanks for reaching out. Would you like the full details or a quick callback?",
      "I can help with that now. Tell me your preferred option and I'll guide you."
    ];
  }
  if (c.channel_type === "web") {
    return [
      "Thanks for reaching out on our website. What are you looking for today?",
      "I can help with pricing, product info, or setup. Which one do you need first?",
      "Happy to assist. Share your requirement and I'll point you to the best option."
    ];
  }
  return [
    "Thanks for your message. Tell me a bit more and I'll help you quickly.",
    "I'm here to help. What would you like to know first?",
    "Got it. Share your exact requirement and I'll guide you with the best next step."
  ];
}

function getConversationTags(c: Conversation): string[] {
  const tags = [
    normalizeStage(c.stage) === "hot" ? "High intent" : normalizeStage(c.stage) === "warm" ? "Needs follow-up" : "Early stage",
    getConversationChannelBadge(c.channel_type),
    getLeadKindLabel(c.lead_kind),
    c.ai_paused || c.manual_takeover ? "Human handling" : "AI live"
  ];
  if (c.assigned_agent_name) tags.push(`Owner: ${c.assigned_agent_name}`);
  return tags;
}

function buildTimeline(c: Conversation, msgs: ConversationMessage[]): Array<{ label: string; detail: string; at: string | null }> {
  const inbound = msgs.filter((m) => m.direction === "inbound");
  const outbound = msgs.filter((m) => m.direction === "outbound");
  return [
    { label: "Conversation opened", detail: `${getConversationChannelLabel(c.channel_type)} conversation created`, at: inbound[0]?.created_at ?? outbound[0]?.created_at ?? c.last_message_at },
    { label: "Latest customer message", detail: inbound.at(-1)?.message_text || c.last_message || "No inbound message yet.", at: inbound.at(-1)?.created_at ?? c.last_message_at },
    { label: "Latest reply", detail: outbound.at(-1)?.sender_name || (c.ai_paused ? "Human agent" : "AI response"), at: outbound.at(-1)?.created_at ?? null },
    { label: "Current handling mode", detail: c.ai_paused || c.manual_takeover ? "Human-led conversation" : "AI is actively replying", at: c.last_message_at }
  ];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const { token, bootstrap, loading } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();

  // Layout state
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false);
  const [isDesktopFilterPanelOpen, setIsDesktopFilterPanelOpen] = useState(true);
  const [isDesktopLeadPanelOpen, setIsDesktopLeadPanelOpen] = useState(true);

  // Chat state
  const [chatAiMenuOpen, setChatAiMenuOpen] = useState(false);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [chatAiTimers, setChatAiTimers] = useState<Record<string, ChatAiTimedAction>>({});
  const [manualComposeConversationId, setManualComposeConversationId] = useState<string | null>(null);
  const [agentReplyText, setAgentReplyText] = useState("");
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [composeTab, setComposeTab] = useState<"reply" | "notes">("reply");
  const [showAiAssistPopup, setShowAiAssistPopup] = useState(false);
  const [showToolbarFlowMenu, setShowToolbarFlowMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false);
  const [isAiRewriting, setIsAiRewriting] = useState(false);

  // Toast
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clock for relative times
  const [clockTick, setClockTick] = useState(() => Date.now());

  // Refs
  const chatAiMenuRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const toolbarWrapRef = useRef<HTMLDivElement | null>(null);

  // ─── URL filter state ─────────────────────────────────────────────────────
  const legacyFolder = (searchParams.get("folder") as ChatFolderFilter | null) ?? null;
  const stageFilter = (searchParams.get("stage") as LeadStageFilter | null) ?? "all";
  const channelFilter = (searchParams.get("channel") as ChannelFilter | null) ?? "all";
  const scoreFilter = (searchParams.get("score") as ScoreFilter | null) ?? "all";
  const assignmentFilter =
    (searchParams.get("assignment") as AssignmentFilter | null) ??
    (legacyFolder === "unassigned" ? "unassigned" : legacyFolder === "mine" ? "me" : "all");
  const dateRangeFilter = (searchParams.get("range") as DateRangeFilter | null) ?? "all";
  const aiModeFilter = (searchParams.get("ai") as AiModeFilter | null) ?? (legacyFolder === "bot" ? "live" : "all");
  const leadKindFilter = (searchParams.get("kind") as LeadKindFilter | null) ?? "all";
  const search = searchParams.get("q") ?? "";
  const selectedConversationId = params.conversationId ?? null;
  const searchParamString = searchParams.toString();
  const currentUserName = bootstrap?.userSummary.name.trim().toLowerCase() ?? "";

  // ─── Queries ──────────────────────────────────────────────────────────────
  const conversationsQuery = useInboxConversationsQuery(token, { folder: "all", search });
  const messagesQuery = useInboxMessagesQuery(token, selectedConversationId);
  const publishedFlowsQuery = useInboxPublishedFlowsQuery(token);
  const contactQuery = useQuery({
    queryKey: selectedConversationId ? dashboardQueryKeys.contactByConversation(selectedConversationId) : ["disabled"],
    queryFn: () => (selectedConversationId ? fetchContactByConversation(token, selectedConversationId).then((r) => r.contact) : Promise.resolve(null)),
    enabled: Boolean(selectedConversationId),
    staleTime: 30_000
  });
  const linkedContact = contactQuery.data ?? null;
  const templatesQuery = useInboxTemplatesQuery(token);
  const approvedTemplates = templatesQuery.data ?? [];

  // ─── Derived data ─────────────────────────────────────────────────────────
  const allConversations = useMemo(() => sortConversationsByRecent(conversationsQuery.data ?? []), [conversationsQuery.data]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allConversations.filter((c) => {
      if (!matchesStageFilter(c, stageFilter)) return false;
      if (!matchesChannelFilter(c, channelFilter)) return false;
      if (!matchesScoreFilter(c, scoreFilter)) return false;
      if (!matchesAssignmentFilter(c, assignmentFilter, currentUserName)) return false;
      if (!matchesDateRangeFilter(c, dateRangeFilter)) return false;
      if (!matchesAiModeFilter(c, aiModeFilter)) return false;
      if (!matchesLeadKindFilter(c, leadKindFilter)) return false;
      if (!q) return true;
      const haystack = `${c.contact_name ?? ""} ${formatPhone(c.contact_phone || c.phone_number)} ${c.contact_email ?? ""} ${c.last_message ?? ""} ${c.assigned_agent_name ?? ""} ${getConversationChannelBadge(c.channel_type)} ${getLeadKindLabel(c.lead_kind)}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [aiModeFilter, allConversations, assignmentFilter, channelFilter, currentUserName, dateRangeFilter, leadKindFilter, scoreFilter, search, stageFilter]);

  const selectedConversation = useMemo(
    () => filteredConversations.find((c) => c.id === selectedConversationId) ?? null,
    [filteredConversations, selectedConversationId]
  );

  const selectedConversationMessages = messagesQuery.data ?? [];
  const selectedConversationLabel = selectedConversation ? getConversationDisplayName(selectedConversation) : "Select a conversation";
  const selectedConversationStage = selectedConversation ? normalizeStage(selectedConversation.stage) : "cold";

  const selectedConversationAiTimer = selectedConversation ? chatAiTimers[selectedConversation.id] ?? null : null;
  const selectedConversationAiTimerLabel = selectedConversationAiTimer
    ? (() => {
        const rem = Math.max(0, selectedConversationAiTimer.executeAt - clockTick);
        const mins = Math.ceil(rem / 60_000);
        return mins >= 60 ? `${Math.ceil(mins / 60)}h` : `${Math.max(1, mins)}m`;
      })()
    : null;

  const replySuggestions = useMemo(() => (selectedConversation ? getReplySuggestions(selectedConversation) : []), [selectedConversation]);
  const conversationTags = useMemo(() => (selectedConversation ? getConversationTags(selectedConversation) : []), [selectedConversation]);
  const timelineItems = useMemo(() => (selectedConversation ? buildTimeline(selectedConversation, selectedConversationMessages) : []), [selectedConversation, selectedConversationMessages]);

  const inboxStats = useMemo(() => ({
    total: allConversations.length,
    hot: allConversations.filter((c) => normalizeStage(c.stage) === "hot").length,
    human: allConversations.filter((c) => c.ai_paused || c.manual_takeover).length,
    unassigned: allConversations.filter((c) => !c.assigned_agent_profile_id && !c.assigned_agent_name).length
  }), [allConversations]);

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (stageFilter !== "all") chips.push(`Status: ${getOptionLabel(LEAD_STAGE_OPTIONS, stageFilter)}`);
    if (channelFilter !== "all") chips.push(`Source: ${getOptionLabel(CHANNEL_OPTIONS, channelFilter)}`);
    if (scoreFilter !== "all") chips.push(`AI score: ${getOptionLabel(SCORE_OPTIONS, scoreFilter)}`);
    if (leadKindFilter !== "all") chips.push(`Type: ${getOptionLabel(LEAD_KIND_OPTIONS, leadKindFilter)}`);
    if (assignmentFilter !== "all") chips.push(`Assigned: ${getOptionLabel(ASSIGNMENT_OPTIONS, assignmentFilter)}`);
    if (aiModeFilter !== "all") chips.push(`AI status: ${getOptionLabel(AI_MODE_OPTIONS, aiModeFilter)}`);
    if (dateRangeFilter !== "all") chips.push(`Date: ${getOptionLabel(DATE_RANGE_OPTIONS, dateRangeFilter)}`);
    if (search.trim()) chips.push(`Search: "${search.trim()}"`);
    return chips;
  }, [aiModeFilter, assignmentFilter, channelFilter, dateRangeFilter, leadKindFilter, scoreFilter, search, stageFilter]);

  const activeFilterCount = activeFilterChips.length;

  const showManualComposer = Boolean(
    selectedConversation &&
      (selectedConversation.ai_paused ||
        selectedConversation.manual_takeover ||
        manualComposeConversationId === selectedConversation.id)
  );

  const hasConfiguredAgentProfile = Boolean(bootstrap?.agentSummary.hasConfiguredProfile);
  const isAnyChannelConnected = Boolean(bootstrap?.channelSummary.anyConnected);
  const isInboxStatusLoading = loading && !bootstrap;


  const showConversationListPane = !isMobileViewport || !isMobileConversationOpen;
  const showConversationDetailPane = !isMobileViewport || isMobileConversationOpen;
  const showFilterPane = !isMobileViewport && isDesktopFilterPanelOpen;
  const showLeadDetailPane = !isMobileViewport && isDesktopLeadPanelOpen;

  const workbenchClassName = [
    "clone-chat-layout",
    "inbox-workbench",
    isMobileViewport ? (isMobileConversationOpen ? "mobile-conversation-panel" : "mobile-conversation-list") : "",
    !isDesktopFilterPanelOpen ? "desktop-filter-collapsed" : "",
    !isDesktopLeadPanelOpen ? "desktop-detail-collapsed" : ""
  ].filter(Boolean).join(" ");

  // ─── Effects ──────────────────────────────────────────────────────────────

  // Viewport detection
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobileViewport(window.innerWidth <= 1100);
      return;
    }
    const mq = window.matchMedia("(max-width: 1100px)");
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) setIsMobileConversationOpen(false);
  }, [isMobileViewport]);

  // Close menus on outside click / escape
  useEffect(() => {
    if (!chatAiMenuOpen && !flowMenuOpen && !showEmojiPicker && !showAiAssistPopup && !showToolbarFlowMenu && !showTemplateMenu && !showTranslateSubmenu) return;
    const onOutside = (e: MouseEvent) => {
      if (chatAiMenuRef.current && e.target instanceof Node && !chatAiMenuRef.current.contains(e.target)) {
        setChatAiMenuOpen(false);
        setFlowMenuOpen(false);
      }
      if (emojiPickerRef.current && e.target instanceof Node && !emojiPickerRef.current.contains(e.target)) {
        setShowEmojiPicker(false);
      }
      if (toolbarWrapRef.current && e.target instanceof Node && !toolbarWrapRef.current.contains(e.target)) {
        setShowAiAssistPopup(false);
        setShowToolbarFlowMenu(false);
        setShowTemplateMenu(false);
        setShowTranslateSubmenu(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChatAiMenuOpen(false); setFlowMenuOpen(false); setShowEmojiPicker(false);
        setShowAiAssistPopup(false); setShowToolbarFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEscape);
    return () => { window.removeEventListener("mousedown", onOutside); window.removeEventListener("keydown", onEscape); };
  }, [chatAiMenuOpen, flowMenuOpen, showEmojiPicker, showAiAssistPopup, showToolbarFlowMenu, showTemplateMenu, showTranslateSubmenu]);

  // Reset chat UI when conversation changes
  useEffect(() => {
    setChatAiMenuOpen(false);
    setFlowMenuOpen(false);
    setAgentReplyText("");
    setManualComposeConversationId(null);
    setShowAiSuggestions(true);
    setShowEmojiPicker(false);
    setAttachedFiles([]);
    setIsScrolledToBottom(true);
    setComposeTab("reply");
    setShowAiAssistPopup(false);
    setShowToolbarFlowMenu(false);
    setShowTemplateMenu(false);
    setShowTranslateSubmenu(false);
  }, [selectedConversationId]);

  // Scroll to bottom when conversation is first opened or messages load
  useEffect(() => {
    if (messagesQuery.isLoading) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setIsScrolledToBottom(true);
  }, [selectedConversationId, messagesQuery.isLoading]);

  // Auto-scroll when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (!isScrolledToBottom) return;
    const el = messagesEndRef.current;
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversationMessages.length, isScrolledToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [agentReplyText]);

  // Clock ticker + AI timer scheduler
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockTick(now);
      for (const [cid, schedule] of Object.entries(chatAiTimers)) {
        if (schedule.executeAt > now || toggleMutation.isPending) continue;
        toggleMutation.mutate({ conversationId: cid, paused: schedule.switchToPaused, durationMinutes: null });
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [chatAiTimers]);

  // Navigate to first conversation when filter changes
  useEffect(() => {
    if (filteredConversations.length === 0) {
      if (selectedConversationId) navigate({ pathname: "/dashboard/inbox", search: searchParamString ? `?${searchParamString}` : "" }, { replace: true });
      return;
    }
    if (!selectedConversation) {
      navigate({ pathname: `/dashboard/inbox/${filteredConversations[0].id}`, search: searchParamString ? `?${searchParamString}` : "" }, { replace: true });
    }
  }, [filteredConversations, navigate, searchParamString, selectedConversation, selectedConversationId]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: async ({ conversationId, paused, durationMinutes }: { conversationId: string; paused: boolean; durationMinutes: number | null }) => {
      await updateConversationAiMode(token, conversationId, paused);
      setChatAiTimers((cur) => {
        const next = { ...cur };
        delete next[conversationId];
        if (durationMinutes !== null) next[conversationId] = { switchToPaused: !paused, executeAt: Date.now() + durationMinutes * 60_000 };
        return next;
      });
      return { paused, durationMinutes };
    },
    onSuccess: async ({ paused, durationMinutes }) => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
      setInfo(paused ? (durationMinutes === null ? "AI turned off." : `AI turned off for ${durationMinutes} minutes.`) : (durationMinutes === null ? "AI turned on." : `AI turned on for ${durationMinutes} minutes.`));
    },
    onError: (e) => setError((e as Error).message)
  });

  const assignFlowMutation = useMutation({
    mutationFn: async ({ conversationId, flowId, flowName }: { conversationId: string; flowId: string; flowName: string }) => {
      await assignInboxFlow(token, conversationId, flowId);
      return { flowName };
    },
    onSuccess: async ({ flowName }) => {
      setFlowMenuOpen(false); setChatAiMenuOpen(false); setManualComposeConversationId(null); setAgentReplyText("");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
      if (selectedConversationId) await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(selectedConversationId) });
      setInfo(`Assigned flow "${flowName}".`);
    },
    onError: (e) => setError((e as Error).message)
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, mediaUrl, mediaMimeType }: { text: string; mediaUrl?: string | null; mediaMimeType?: string | null }) => {
      if (!selectedConversationId) throw new Error("No conversation selected.");
      await sendManualConversationMessage(token, selectedConversationId, text, mediaUrl, mediaMimeType);
    },
    onSuccess: async () => {
      setAgentReplyText("");
      setAttachedFiles([]);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
      if (selectedConversationId) await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(selectedConversationId) });
    },
    onError: (e) => setError((e as Error).message)
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return uploadInboxMediaToSupabase(file);
    }
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const updateSearchParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("folder");
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const clearFilters = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  const openConversation = useCallback((conversationId: string) => {
    navigate({ pathname: `/dashboard/inbox/${conversationId}`, search: searchParamString ? `?${searchParamString}` : "" });
    if (isMobileViewport) setIsMobileConversationOpen(true);
  }, [navigate, searchParamString, isMobileViewport]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 60;
    setIsScrolledToBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messagesEndRef.current;
    if (el) el.scrollIntoView({ behavior: "smooth" });
    setIsScrolledToBottom(true);
  }, []);

  const handleCopyMessage = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }).catch(() => { /* ignore */ });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newAttachments: AttachedFile[] = files.map((f) => ({
      file: f,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
      name: f.name,
      type: f.type
    }));
    setAttachedFiles((prev) => [...prev, ...newAttachments].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRemoveAttachment = useCallback((idx: number) => {
    setAttachedFiles((prev) => {
      const next = [...prev];
      if (next[idx].previewUrl) URL.revokeObjectURL(next[idx].previewUrl);
      next.splice(idx, 1);
      return next;
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const named = new File([file], `paste-${Date.now()}.png`, { type: file.type });
    setAttachedFiles((prev) => [...prev, {
      file: named, previewUrl: URL.createObjectURL(named), name: named.name, type: named.type
    }].slice(0, 5));
  }, []);

  const handleAiRewrite = useCallback(async () => {
    const text = agentReplyText.trim();
    if (!text || isAiRewriting) return;
    setIsAiRewriting(true);
    try {
      const result = await aiAssistText(token, text, "rewrite");
      setAgentReplyText(result.text);
      textareaRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
    }
  }, [agentReplyText, isAiRewriting, token]);

  const handleAiTranslate = useCallback(async (language: string) => {
    const text = agentReplyText.trim();
    if (!text || isAiRewriting) return;
    setIsAiRewriting(true);
    try {
      const result = await aiAssistText(token, text, "translate", language);
      setAgentReplyText(result.text);
      textareaRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
      setShowTranslateSubmenu(false);
    }
  }, [agentReplyText, isAiRewriting, token]);

  const handleSelectTemplate = useCallback((template: MessageTemplate) => {
    const bodyText = getTemplateBodyText(template);
    setAgentReplyText(bodyText);
    setManualComposeConversationId(selectedConversation?.id ?? null);
    setShowTemplateMenu(false);
    textareaRef.current?.focus();
  }, [selectedConversation]);

  const handleSendMessage = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = agentReplyText.trim();
    if (!text && attachedFiles.length === 0) return;
    if (sendMessageMutation.isPending || uploadMutation.isPending) return;

    let mediaUrl: string | null = null;
    let mediaMimeType: string | null = null;
    if (attachedFiles.length > 0) {
      try {
        const result = await uploadMutation.mutateAsync(attachedFiles[0].file);
        mediaUrl = result.url;
        mediaMimeType = result.mimeType;
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    sendMessageMutation.mutate({ text, mediaUrl, mediaMimeType });
  }, [agentReplyText, attachedFiles, sendMessageMutation, uploadMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setAgentReplyText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }, []);

  const publishedFlows = publishedFlowsQuery.data ?? [];
  const isSendDisabled = sendMessageMutation.isPending || uploadMutation.isPending || (!agentReplyText.trim() && attachedFiles.length === 0);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="clone-chat-wrap">
      {(info || error) && (
        <div className="dashboard-toast-stack" aria-live="polite" aria-atomic="true">
          {info && (
            <div className="dashboard-toast dashboard-toast-success" role="status">
              <p>{info}</p>
              <button type="button" className="dashboard-toast-close" onClick={() => setInfo(null)}>×</button>
            </div>
          )}
          {error && (
            <div className="dashboard-toast dashboard-toast-error" role="alert">
              <p>{error}</p>
              <button type="button" className="dashboard-toast-close" onClick={() => setError(null)}>×</button>
            </div>
          )}
        </div>
      )}

      {isInboxStatusLoading ? (
        <section className="clone-chat-setup clone-chat-waiting">
          <h2>Checking inbox status</h2>
          <p>Looking for a connected agent and active channel.</p>
        </section>
      ) : (
        <section className={workbenchClassName}>
          {/* ── Disconnect banner ── */}
          {!isAnyChannelConnected && (
            <div className="inbox-disconnect-banner">
              <span className="inbox-disconnect-icon">⚠</span>
              <span>
                <strong>No live channel connected.</strong>{" "}
                {hasConfiguredAgentProfile
                  ? "Connect a channel to send and receive messages. Viewing history only."
                  : "Create an AI agent first, then connect a channel."}
              </span>
              <div className="inbox-disconnect-actions">
                <button type="button" className="ghost-btn" onClick={() => navigate(hasConfiguredAgentProfile ? "/dashboard/settings/api" : "/dashboard/agents")}>
                  {hasConfiguredAgentProfile ? "Open channel settings" : "Open AI Agents"}
                </button>
              </div>
            </div>
          )}

          {/* ── Filter panel ── */}
          {showConversationListPane && (
            <>
              {showFilterPane && (
                <aside className="inbox-filter-panel">
                  <div className="inbox-panel-head">
                    <div>
                      <h3>Lead Filters</h3>
                      <p>Lead intelligence filters that update the inbox instantly.</p>
                    </div>
                    {activeFilterCount > 0 && (
                      <button type="button" className="ghost-btn" onClick={clearFilters}>Clear</button>
                    )}
                  </div>

                  <section className={activeFilterCount > 0 ? "inbox-active-filter-summary is-active" : "inbox-active-filter-summary"}>
                    <div className="inbox-active-filter-copy">
                      <strong>{activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}` : "No lead filter applied"}</strong>
                      <span>{activeFilterCount > 0 ? "These filters are controlling the chat list right now." : "All conversations are visible until you apply a filter below."}</span>
                    </div>
                    {activeFilterChips.length > 0 && (
                      <div className="inbox-active-filter-chips">
                        {activeFilterChips.map((chip) => <span key={chip} className="inbox-active-filter-chip">{chip}</span>)}
                      </div>
                    )}
                  </section>

                  <div className="inbox-stat-grid">
                    <article className="inbox-stat-card"><span>All chats</span><strong>{inboxStats.total}</strong></article>
                    <article className="inbox-stat-card hot"><span>Hot leads</span><strong>{inboxStats.hot}</strong></article>
                    <article className="inbox-stat-card human"><span>Human handling</span><strong>{inboxStats.human}</strong></article>
                    <article className="inbox-stat-card"><span>Unassigned</span><strong>{inboxStats.unassigned}</strong></article>
                  </div>

                  {[
                    { label: "Status", sub: "Lead stage", type: "pills", key: "stage", options: LEAD_STAGE_OPTIONS, value: stageFilter },
                    { label: "Source", sub: "Conversation channel", type: "select", key: "channel", options: CHANNEL_OPTIONS, value: channelFilter },
                    { label: "AI Score", sub: "Derived from lead score", type: "pills", key: "score", options: SCORE_OPTIONS, value: scoreFilter },
                    { label: "Lead Type", sub: "Intent classification", type: "select", key: "kind", options: LEAD_KIND_OPTIONS, value: leadKindFilter },
                    { label: "Assigned", sub: "Owner routing", type: "select", key: "assignment", options: ASSIGNMENT_OPTIONS, value: assignmentFilter },
                    { label: "AI Status", sub: "Automation mode", type: "select", key: "ai", options: AI_MODE_OPTIONS, value: aiModeFilter },
                    { label: "Date", sub: "Latest message window", type: "select", key: "range", options: DATE_RANGE_OPTIONS, value: dateRangeFilter }
                  ].map((group) => (
                    <section key={group.key} className="inbox-filter-group">
                      <div className="inbox-filter-group-head">
                        <strong>{group.label}</strong>
                        <span>{group.sub}</span>
                      </div>
                      {group.type === "pills" ? (
                        <div className="inbox-choice-grid">
                          {group.options.map((opt) => (
                            <button key={opt.value} type="button" className={group.value === opt.value ? "active" : ""} onClick={() => updateSearchParam(group.key, opt.value)}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <select className="inbox-select" value={group.value} onChange={(e) => updateSearchParam(group.key, e.target.value)}>
                          {group.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      )}
                    </section>
                  ))}
                </aside>
              )}

              {/* ── Conversation list ── */}
              <aside className="clone-thread-list inbox-chat-list">
                <div className="clone-thread-toolbar inbox-list-toolbar">
                  <div className="inbox-list-heading">
                    <div className="inbox-list-heading-row">
                      {!isMobileViewport && (
                        <button type="button" className="inbox-panel-toggle" aria-label={showFilterPane ? "Hide filters" : "Show filters"} title={showFilterPane ? "Hide filters" : "Show filters"} onClick={() => setIsDesktopFilterPanelOpen((v) => !v)}>
                          {showFilterPane ? "<" : ">"}
                        </button>
                      )}
                      <h3>Chat List <span>{filteredConversations.length}</span></h3>
                    </div>
                    <p>Search, scan, and pick the lead to work.</p>
                    {!showFilterPane && activeFilterCount > 0 && (
                      <button type="button" className="ghost-btn" onClick={clearFilters}>Clear filters</button>
                    )}
                  </div>
                  <label className="clone-chat-search inbox-chat-search">
                    <input value={search} onChange={(e) => updateSearchParam("q", e.target.value)} placeholder="Search name, phone, email..." />
                  </label>
                </div>

                {conversationsQuery.isLoading ? (
                  <p className="empty-note inbox-empty-state">Loading conversations...</p>
                ) : filteredConversations.length === 0 ? (
                  <p className="empty-note inbox-empty-state">
                    {search.trim() || activeFilterCount > 0 ? "No conversations match the current filters." : "No conversations yet. Send a new inbound message to start chat tracking."}
                  </p>
                ) : (
                  filteredConversations.map((c) => {
                    const label = getConversationDisplayName(c);
                    const stage = normalizeStage(c.stage);
                    const scoreBand = getLeadScoreBand(c);
                    const initials = label.split(" ").map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`clone-thread-item inbox-thread-item stage-${stage}${c.id === selectedConversationId ? " active" : ""}`}
                        onClick={() => openConversation(c.id)}
                      >
                        <span className="clone-thread-avatar">{initials || "U"}</span>
                        <div className="inbox-thread-body">
                          <header>
                            <div className="clone-thread-title">
                              <strong>{label}</strong>
                              <div className="inbox-thread-badges">
                                <span className={`clone-thread-stage ${stage}`}>{stage}</span>
                                <span className={`inbox-chip inbox-chip-score ${scoreBand}`}>{getLeadScoreLabel(c)}</span>
                              </div>
                            </div>
                            <small>{formatRelativeTime(c.last_message_at, clockTick)}</small>
                          </header>
                          <p>{getMessagePreview(c.last_message)}</p>
                          <div className="inbox-thread-meta">
                            <span className="inbox-chip">{getConversationChannelBadge(c.channel_type)}</span>
                            <span className={c.ai_paused || c.manual_takeover ? "inbox-chip human" : "inbox-chip live"}>
                              {c.ai_paused || c.manual_takeover ? "Human" : "AI Live"}
                            </span>
                            <span className="inbox-thread-owner">{c.assigned_agent_name || "Unassigned"}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </aside>
            </>
          )}

          {/* ── Conversation panel ── */}
          {showConversationDetailPane && (
            <>
              <section className="clone-chat-panel inbox-conversation-panel">
                {/* Header */}
                <header className="clone-chat-head">
                  <div className="clone-chat-head-main">
                    {isMobileViewport && (
                      <button type="button" className="chat-mobile-back-btn" onClick={() => setIsMobileConversationOpen(false)}>Back</button>
                    )}
                    <div>
                      <h2>{selectedConversationLabel}</h2>
                      {selectedConversation && (
                        <div className="chat-meta-row">
                          <span>{formatPhone(selectedConversation.contact_phone || selectedConversation.phone_number)}</span>
                          {selectedConversation.contact_email && <span>{selectedConversation.contact_email}</span>}
                          <span className="chat-channel-badge">{getConversationChannelBadge(selectedConversation.channel_type)}</span>
                          <span>{getLeadKindLabel(selectedConversation.lead_kind)}</span>
                          <span>Score {selectedConversation.score}</span>
                          <span className={`clone-thread-stage ${selectedConversationStage}`}>{selectedConversation.stage}</span>
                          <span className={selectedConversation.ai_paused || selectedConversation.manual_takeover ? "chat-flag paused" : "chat-flag live"}>
                            {selectedConversation.manual_takeover ? "Manual" : selectedConversation.ai_paused ? "Paused" : "AI Live"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="chat-actions" ref={chatAiMenuRef}>
                    {!isMobileViewport && (
                      <button type="button" className="inbox-panel-toggle" aria-label={showLeadDetailPane ? "Hide details" : "Show details"} title={showLeadDetailPane ? "Hide details" : "Show details"} onClick={() => setIsDesktopLeadPanelOpen((v) => !v)}>
                        {showLeadDetailPane ? ">" : "<"}
                      </button>
                    )}
                    {selectedConversation && (
                      <>
                        <button className="ghost-btn" type="button" disabled={assignFlowMutation.isPending} onClick={() => { setFlowMenuOpen((v) => !v); setChatAiMenuOpen(false); }}>
                          {assignFlowMutation.isPending ? "Assigning..." : "Assign flow"}
                        </button>
                        {flowMenuOpen && (
                          <div className="chat-ai-menu">
                            {publishedFlowsQuery.isLoading ? (
                              <button type="button" disabled>Loading flows...</button>
                            ) : publishedFlows.length === 0 ? (
                              <button type="button" disabled>No published flows</button>
                            ) : (
                              publishedFlows.map((flow) => (
                                <button key={flow.id} type="button" onClick={() => assignFlowMutation.mutate({ conversationId: selectedConversation.id, flowId: flow.id, flowName: flow.name })}>
                                  {flow.name}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={toggleMutation.isPending}
                          onClick={() => {
                            if (selectedConversation.ai_paused || selectedConversation.manual_takeover) {
                              setFlowMenuOpen(false);
                              setChatAiMenuOpen((v) => !v);
                              return;
                            }
                            setFlowMenuOpen(false);
                            toggleMutation.mutate({ conversationId: selectedConversation.id, paused: true, durationMinutes: null });
                            setManualComposeConversationId(selectedConversation.id);
                          }}
                        >
                          {selectedConversation.ai_paused || selectedConversation.manual_takeover ? "Turn on AI" : "Take over"}
                        </button>
                        {selectedConversationAiTimerLabel && (
                          <span className="chat-ai-timer-badge">Timer {selectedConversationAiTimerLabel}</span>
                        )}
                        {selectedConversation.ai_paused && chatAiMenuOpen && (
                          <div className="chat-ai-menu">
                            {CHAT_AI_DURATION_OPTIONS.map((opt) => (
                              <button key={opt.label} type="button" onClick={() => { setChatAiMenuOpen(false); toggleMutation.mutate({ conversationId: selectedConversation.id, paused: false, durationMinutes: opt.minutes }); }}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </header>

                {/* Messages area */}
                <div
                  className="clone-messages messages-scroll"
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                >
                  {!selectedConversation ? (
                    <p className="empty-note">Select a conversation to view messages.</p>
                  ) : messagesQuery.isLoading ? (
                    <div className="messages-loading">
                      <span className="messages-loading-dots"><span /><span /><span /></span>
                      <p>Loading conversation...</p>
                    </div>
                  ) : messagesQuery.isError ? (
                    <p className="empty-note" style={{ color: "#c0392b" }}>
                      Could not load messages. Please try again.
                    </p>
                  ) : selectedConversationMessages.length === 0 ? (
                    <p className="empty-note">No messages in this chat yet.</p>
                  ) : (
                    selectedConversationMessages.map((msg, idx) => {
                      const prevMsg = idx > 0 ? selectedConversationMessages[idx - 1] : null;
                      const showDate = !prevMsg || !isSameDay(prevMsg.created_at, msg.created_at);

                      // Identify sender type:
                      // - AI: outbound + ai_model is set
                      // - Manual/agent: outbound + no ai_model + sender_name is set
                      // - Flow: outbound + no ai_model + no sender_name
                      const isOutbound = msg.direction === "outbound";
                      const isAi = isOutbound && Boolean(msg.ai_model);
                      const isFlow = isOutbound && !isAi && !msg.sender_name;
                      const isManual = isOutbound && !isAi && Boolean(msg.sender_name);

                      const bubbleClass = [
                        "bubble",
                        msg.direction,
                        isAi ? "ai-bubble" : "",
                        isFlow ? "flow-bubble" : ""
                      ].filter(Boolean).join(" ");

                      return (
                        <div key={msg.id}>
                          {showDate && (
                            <div className="message-date-separator">
                              <span>{formatDateLabel(msg.created_at)}</span>
                            </div>
                          )}
                          <div className={bubbleClass}>
                            <div className="bubble-content">
                              {renderMessage(normalizeMessage(msg))}
                            </div>
                            <div className="bubble-meta">
                              {isAi && <span className="bubble-ai-badge">AI</span>}
                              {isFlow && <span className="bubble-flow-badge">Flow</span>}
                              {isManual && msg.sender_name && (
                                <span className="bubble-sender">{msg.sender_name}</span>
                              )}
                              <time title={formatDateTime(msg.created_at)}>{formatMessageTime(msg.created_at)}</time>
                              {isOutbound && msg.total_tokens ? (
                                <span className="token-meta">{msg.total_tokens} tokens</span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="bubble-copy-btn"
                              title="Copy message"
                              onClick={() => handleCopyMessage(msg.id, msg.message_text)}
                            >
                              {copiedMessageId === msg.id ? "✓" : "⎘"}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Scroll to bottom FAB */}
                {!isScrolledToBottom && selectedConversation && (
                  <button type="button" className="chat-scroll-fab" onClick={scrollToBottom} title="Scroll to latest">
                    ↓
                  </button>
                )}

                {/* Compose area */}
                {selectedConversation && (
                  <div className="inbox-compose-stack">
                    {showManualComposer ? (
                      <form className="chat-compose-form" onSubmit={(e) => { e.preventDefault(); void handleSendMessage(); }}>
                        {/* Reply / Notes tabs */}
                        <div className="compose-tabs">
                          <button type="button" className={`compose-tab${composeTab === "reply" ? " active" : ""}`} onClick={() => setComposeTab("reply")}>Reply</button>
                          <button type="button" className={`compose-tab${composeTab === "notes" ? " active" : ""}`} onClick={() => setComposeTab("notes")}>Notes</button>
                        </div>

                        {/* Attachment previews */}
                        {attachedFiles.length > 0 && (
                          <div className="chat-attachment-previews">
                            {attachedFiles.map((af, i) => (
                              <div key={i} className="chat-attachment-item">
                                {af.previewUrl ? (
                                  <img src={af.previewUrl} alt={af.name} className="chat-attachment-thumb" />
                                ) : (
                                  <span className="chat-attachment-file-icon">📎</span>
                                )}
                                <span className="chat-attachment-name">{af.name}</span>
                                <button type="button" className="chat-attachment-remove" onClick={() => handleRemoveAttachment(i)} title="Remove">×</button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Textarea */}
                        <textarea
                          ref={textareaRef}
                          className={`chat-compose-textarea${composeTab === "notes" ? " notes-mode" : ""}`}
                          value={agentReplyText}
                          onChange={(e) => { setAgentReplyText(e.target.value); if (selectedConversation) setManualComposeConversationId(selectedConversation.id); }}
                          onKeyDown={handleKeyDown}
                          onPaste={handlePaste}
                          placeholder={composeTab === "notes" ? "Add an internal note… (visible to agents only)" : `Message ${selectedConversationLabel}…`}
                          rows={2}
                          maxLength={4000}
                          disabled={!isAnyChannelConnected}
                        />

                        {/* Toolbar row */}
                        <div className="compose-toolbar-wrap" ref={toolbarWrapRef}>
                          {/* AI Assist popup — floats above toolbar */}
                          {showAiAssistPopup && (
                            <div className="ai-assist-popup">
                              <div className="ai-assist-popup-header">
                                <span>AI Assist <kbd>Ctrl ⇧ A</kbd></span>
                                <button type="button" className="ai-assist-popup-close" onClick={() => setShowAiAssistPopup(false)}>✕</button>
                              </div>
                              <button
                                type="button"
                                className="ai-assist-popup-item"
                                disabled={!agentReplyText.trim() || isAiRewriting}
                                onClick={() => { void handleAiRewrite(); }}
                              >
                                <span className="ai-assist-item-icon">✨</span>
                                <span className="ai-assist-item-label">{isAiRewriting ? "Rewriting…" : "AI Rewrite"}</span>
                                <span className="ai-assist-item-arrow">›</span>
                              </button>
                              <div className="ai-assist-popup-item ai-assist-translate-row" onMouseEnter={() => setShowTranslateSubmenu(true)} onMouseLeave={() => setShowTranslateSubmenu(false)}>
                                <span className="ai-assist-item-icon">🔤</span>
                                <span className="ai-assist-item-label">AI Translate</span>
                                <span className="ai-assist-item-arrow">›</span>
                                {showTranslateSubmenu && (
                                  <div className="ai-translate-submenu">
                                    {TRANSLATE_LANGUAGES.map((lang) => (
                                      <button key={lang} type="button" disabled={!agentReplyText.trim() || isAiRewriting} onClick={() => { void handleAiTranslate(lang); }}>
                                        {lang}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="ai-assist-popup-footer">
                                <span>⬆⬇ Move</span>
                                <span>↵ Select</span>
                              </div>
                            </div>
                          )}

                          {/* Flow dropup */}
                          {showToolbarFlowMenu && (
                            <div className="compose-dropup">
                              <div className="compose-dropup-label">Assign flow bot</div>
                              {publishedFlowsQuery.isLoading ? (
                                <button type="button" disabled>Loading…</button>
                              ) : publishedFlows.length === 0 ? (
                                <button type="button" disabled>No published flows</button>
                              ) : (
                                publishedFlows.map((flow) => (
                                  <button key={flow.id} type="button" onClick={() => { assignFlowMutation.mutate({ conversationId: selectedConversation.id, flowId: flow.id, flowName: flow.name }); setShowToolbarFlowMenu(false); }}>
                                    {flow.name}
                                  </button>
                                ))
                              )}
                            </div>
                          )}

                          {/* Template dropup */}
                          {showTemplateMenu && (
                            <div className="compose-dropup compose-template-dropup">
                              <div className="compose-dropup-label">Send approved template</div>
                              {templatesQuery.isLoading ? (
                                <button type="button" disabled>Loading templates…</button>
                              ) : approvedTemplates.length === 0 ? (
                                <button type="button" disabled>No approved templates</button>
                              ) : (
                                approvedTemplates.map((t) => (
                                  <button key={t.id} type="button" className="compose-template-item" onClick={() => handleSelectTemplate(t)}>
                                    <strong>{t.name}</strong>
                                    <span>{getTemplateBodyText(t).slice(0, 80)}{getTemplateBodyText(t).length > 80 ? "…" : ""}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}

                          <div className="compose-toolbar">
                            {/* Left tools */}
                            <div className="compose-toolbar-left">
                              <button type="button" className="compose-tool" title="Attach file" disabled={!isAnyChannelConnected || attachedFiles.length >= 5} onClick={() => fileInputRef.current?.click()}>＋</button>
                              <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" style={{ display: "none" }} multiple onChange={handleFileSelect} />

                              <div className="chat-emoji-wrap" ref={emojiPickerRef}>
                                <button type="button" className="compose-tool" title="Emoji" disabled={!isAnyChannelConnected} onClick={() => setShowEmojiPicker((v) => !v)}>😊</button>
                                {showEmojiPicker && (
                                  <div className="chat-emoji-picker">
                                    {QUICK_EMOJIS.map((emoji) => (
                                      <button key={emoji} type="button" onClick={() => handleEmojiSelect(emoji)}>{emoji}</button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <button type="button" className="compose-tool compose-tool-aa" title="Font">Aa</button>

                              <span className="compose-toolbar-sep" />

                              <button
                                type="button"
                                className={`compose-tool${showToolbarFlowMenu ? " active" : ""}`}
                                title="Assign flow bot"
                                disabled={assignFlowMutation.isPending}
                                onClick={() => { setShowToolbarFlowMenu((v) => !v); setShowTemplateMenu(false); setShowAiAssistPopup(false); }}
                              >⚡</button>

                              <button
                                type="button"
                                className={`compose-tool${showTemplateMenu ? " active" : ""}`}
                                title="Send approved template"
                                onClick={() => { setShowTemplateMenu((v) => !v); setShowToolbarFlowMenu(false); setShowAiAssistPopup(false); }}
                              >📋</button>
                            </div>

                            {/* Right tools */}
                            <div className="compose-toolbar-right">
                              {agentReplyText.length > 0 && (
                                <span className={`chat-char-count${agentReplyText.length > 3800 ? " near-limit" : ""}`}>{agentReplyText.length}/4000</span>
                              )}

                              <button
                                type="button"
                                className={`compose-ai-assist-btn${showAiAssistPopup ? " active" : ""}`}
                                onClick={() => { setShowAiAssistPopup((v) => !v); setShowToolbarFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false); }}
                              >
                                ✨ AI Assist
                              </button>

                              <button type="button" className="compose-tool" title="Clear message" onClick={() => setAgentReplyText("")}>↩</button>

                              {!isAnyChannelConnected ? (
                                <span className="chat-compose-offline-note">Connect a channel</span>
                              ) : (
                                <button type="submit" className="compose-send-btn" disabled={isSendDisabled}>
                                  {uploadMutation.isPending ? "Uploading…" : sendMessageMutation.isPending ? "Sending…" : "Send"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* AI suggested replies — below toolbar */}
                        {replySuggestions.length > 0 && (
                          showAiSuggestions ? (
                            <div className="compose-suggestions">
                              <div className="compose-suggestions-head">
                                <span>💡 {getLeadIntentLabel(selectedConversation)} — {getLeadSuggestedAction(selectedConversation)}</span>
                                <button type="button" onClick={() => setShowAiSuggestions(false)}>✕</button>
                              </div>
                              <div className="compose-suggestions-strip">
                                {replySuggestions.map((s) => (
                                  <button key={s} type="button" onClick={() => { setManualComposeConversationId(selectedConversation.id); setAgentReplyText(s); textareaRef.current?.focus(); }}>
                                    {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <button type="button" className="compose-suggestions-show" onClick={() => setShowAiSuggestions(true)}>
                              💡 AI Suggestions
                            </button>
                          )
                        )}
                      </form>
                    ) : (
                      <div className="inbox-manual-hint">
                        <span>AI is handling this conversation.</span>
                        <button type="button" className="ghost-btn" onClick={() => { toggleMutation.mutate({ conversationId: selectedConversation.id, paused: true, durationMinutes: null }); setManualComposeConversationId(selectedConversation.id); }}>
                          Take over &amp; reply manually
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ── Lead detail panel ── */}
              {showLeadDetailPane && (
                <aside className="inbox-lead-panel">
                  {!selectedConversation ? (
                    <p className="empty-note inbox-empty-state">Select a chat to inspect the lead profile and activity.</p>
                  ) : (
                    <>
                      <section className="inbox-detail-card">
                        <div className="inbox-detail-card-head">
                          <h3>Contact Info</h3>
                          <span>{getConversationChannelBadge(selectedConversation.channel_type)}</span>
                        </div>
                        <dl className="inbox-detail-list">
                          <div><dt>Name</dt><dd>{getConversationDisplayName(selectedConversation)}</dd></div>
                          <div><dt>Phone</dt><dd>{formatPhone(selectedConversation.contact_phone || selectedConversation.phone_number)}</dd></div>
                          <div><dt>Email</dt><dd>{selectedConversation.contact_email || linkedContact?.email || "Not captured yet"}</dd></div>
                          <div><dt>Type</dt><dd>{linkedContact?.contact_type ?? selectedConversation.lead_kind}</dd></div>
                          {linkedContact?.tags && linkedContact.tags.length > 0 && (
                            <div>
                              <dt>Tags</dt>
                              <dd>
                                <div className="inbox-tag-cloud" style={{ marginTop: 2 }}>
                                  {linkedContact.tags.map((tag) => <span key={tag} className="inbox-tag">{tag}</span>)}
                                </div>
                              </dd>
                            </div>
                          )}
                          {linkedContact?.order_date && (
                            <div><dt>Order Date</dt><dd>{new Date(linkedContact.order_date).toLocaleDateString()}</dd></div>
                          )}
                          <div><dt>Owner</dt><dd>{selectedConversation.assigned_agent_name || "Unassigned"}</dd></div>
                          <div><dt>Last touch</dt><dd>{formatDateTime(selectedConversation.last_message_at)}</dd></div>
                          <div><dt>Connected number</dt><dd>{selectedConversation.channel_linked_number || "Workspace default"}</dd></div>
                          {linkedContact?.source_type && (
                            <div><dt>Source</dt><dd>{linkedContact.source_type}</dd></div>
                          )}
                          {/* Custom fields */}
                          {linkedContact?.custom_field_values && linkedContact.custom_field_values.length > 0 && (
                            <>
                              <div className="inbox-detail-divider"><span>Custom Fields</span></div>
                              {linkedContact.custom_field_values.map((fv) => (
                                <div key={fv.field_id}>
                                  <dt>{fv.field_label}</dt>
                                  <dd>
                                    {fv.field_type === "SWITCH"
                                      ? (fv.value === "true" ? "Yes" : fv.value === "false" ? "No" : "-")
                                      : fv.field_type === "DATE" && fv.value
                                        ? new Date(fv.value).toLocaleDateString()
                                        : fv.value || "-"}
                                  </dd>
                                </div>
                              ))}
                            </>
                          )}
                        </dl>
                      </section>

                      <section className="inbox-detail-card">
                        <div className="inbox-detail-card-head">
                          <h3>AI Insights</h3>
                          <span>Live</span>
                        </div>
                        <div className="inbox-insight-grid">
                          <article><span>Intent</span><strong>{getLeadIntentLabel(selectedConversation)}</strong></article>
                          <article><span>Buying Probability</span><strong>{selectedConversation.score}%</strong></article>
                          <article><span>Classifier Confidence</span><strong>{selectedConversation.classification_confidence}%</strong></article>
                          <article><span>Next Follow-up</span><strong>{getNextFollowUpLabel(selectedConversation)}</strong></article>
                        </div>
                        <p className="inbox-detail-summary">{getLeadSuggestedAction(selectedConversation)}</p>
                      </section>

                      <section className="inbox-detail-card">
                        <div className="inbox-detail-card-head">
                          <h3>Tags</h3>
                          <span>{conversationTags.length}</span>
                        </div>
                        <div className="inbox-tag-cloud">
                          {conversationTags.map((tag) => <span key={tag} className="inbox-tag">{tag}</span>)}
                        </div>
                      </section>

                      <section className="inbox-detail-card">
                        <div className="inbox-detail-card-head">
                          <h3>Activity Timeline</h3>
                          <span>{messagesQuery.isFetching ? "Refreshing" : "Current"}</span>
                        </div>
                        <div className="inbox-timeline">
                          {timelineItems.map((item) => (
                            <article key={item.label} className="inbox-timeline-item">
                              <strong>{item.label}</strong>
                              <p>{item.detail}</p>
                              <small>{formatDateTime(item.at)}</small>
                            </article>
                          ))}
                        </div>
                      </section>
                    </>
                  )}
                </aside>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildInboxConversationsQueryOptions(token, { folder: "all", search: "" }));
}
