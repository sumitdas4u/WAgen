import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Conversation, ConversationMessage, MessageTemplate, ContactRecord } from "../../../lib/api";
import { fetchContactByConversation, listContactFields, fetchContacts } from "../../../lib/api";
import { normalizeMessage, renderFormattedText, renderMessage } from "./message-renderer";
import { uploadInboxMedia as uploadInboxMediaToSupabase } from "../../../lib/supabase";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import {
  assignInboxFlow,
  createInboxNote,
  markInboxConversationRead,
  sendManualConversationMessage,
  updateConversationAiMode,
  aiAssistText,
  sendInboxConversationTemplate,
  startOutboundConversation
} from "./api";
import {
  buildInboxConversationsInfiniteQueryOptions,
  useInboxConversationsInfiniteQuery,
  useInboxMessagesInfiniteQuery,
  useInboxNotesQuery,
  useInboxPublishedFlowsQuery,
  useInboxTemplatesQuery
} from "./queries";
import { MetaConnectionSelector, getConnectionActiveLabel, isMetaConnectionActive } from "../../../shared/dashboard/meta-connection-selector";

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
type ActiveFilterChip = { key: string; label: string };
type ComposeFormatStyle = "bold" | "italic" | "strike" | "monospace";
type TemplateDialogMediaType = "IMAGE" | "VIDEO" | "DOCUMENT";
type TemplateDialogField =
  | { key: string; label: string; kind: "text"; placeholder: string }
  | { key: string; label: string; kind: "media"; mediaType: TemplateDialogMediaType; description: string };
type TemplateDialogUpload = { fileName: string; mimeType: string; previewUrl: string | null };
type TemplateVarsDialogState = {
  template: MessageTemplate;
  fields: TemplateDialogField[];
  values: Record<string, string>;
  uploads: Record<string, TemplateDialogUpload>;
};

type NewChatStep = "contact" | "message";
type NewChatQrMode = "flow" | "manual" | "ai" | null;
type NewChatState = {
  open: boolean;
  step: NewChatStep;
  contact: ContactRecord | null;
  channelType: "qr" | "api";
  connectionId: string;
  qrMode: NewChatQrMode;
  qrFlowId: string | null;
  messageText: string;
  template: MessageTemplate | null;
  templateVars: TemplateVarsDialogState | null;
};

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
const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;
const TEMPLATE_MEDIA_INPUT_CONFIG: Record<
  TemplateDialogMediaType,
  { label: string; accept: string; allowedMimeTypes: string[]; extensions: string[]; maxMb: number }
> = {
  IMAGE: {
    label: "Image",
    accept: "image/jpeg,image/png",
    allowedMimeTypes: ["image/jpeg", "image/png"],
    extensions: [".jpg", ".jpeg", ".png"],
    maxMb: 5
  },
  VIDEO: {
    label: "Video",
    accept: "video/mp4",
    allowedMimeTypes: ["video/mp4"],
    extensions: [".mp4"],
    maxMb: 16
  },
  DOCUMENT: {
    label: "Document",
    accept: "application/pdf",
    allowedMimeTypes: ["application/pdf"],
    extensions: [".pdf"],
    maxMb: 10
  }
};

function getTemplateBodyText(template: MessageTemplate): string {
  return template.components.find((c) => c.type === "BODY")?.text ?? template.name;
}

function extractTemplatePlaceholders(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const matches = [...text.matchAll(TEMPLATE_PLACEHOLDER_PATTERN)];
  return [...new Set(matches.map((match) => `{{${(match[1] ?? "").trim()}}}`))];
}

function buildTemplateDialogFields(template: MessageTemplate): TemplateDialogField[] {
  const fields: TemplateDialogField[] = [];
  const header = template.components.find((component) => component.type === "HEADER");
  if (header?.format === "IMAGE" || header?.format === "VIDEO" || header?.format === "DOCUMENT") {
    const config = TEMPLATE_MEDIA_INPUT_CONFIG[header.format];
    fields.push({
      key: "headerMediaUrl",
      label: `${config.label} header`,
      kind: "media",
      mediaType: header.format,
      description: `Upload a ${config.label.toLowerCase()} file (${config.extensions.join(", ")}, up to ${config.maxMb}MB).`
    });
  }

  const placeholders = new Set<string>();
  for (const component of template.components) {
    extractTemplatePlaceholders(component.text).forEach((placeholder) => placeholders.add(placeholder));
    if (component.type === "BUTTONS") {
      (component.buttons ?? []).forEach((button) => {
        extractTemplatePlaceholders(button.url).forEach((placeholder) => placeholders.add(placeholder));
      });
    }
  }

  fields.push(
    ...Array.from(placeholders).map((placeholder) => ({
      key: placeholder,
      label: placeholder,
      kind: "text" as const,
      placeholder: `Value for ${placeholder}`
    }))
  );

  return fields;
}

function getTemplateFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function validateTemplateMediaFile(mediaType: TemplateDialogMediaType, file: File): string | null {
  const config = TEMPLATE_MEDIA_INPUT_CONFIG[mediaType];
  if (file.size > config.maxMb * 1024 * 1024) {
    return `${config.label} files must be ${config.maxMb}MB or smaller.`;
  }

  const normalizedMimeType = file.type.trim().toLowerCase();
  const extension = getTemplateFileExtension(file.name);
  const matchesMimeType = normalizedMimeType ? config.allowedMimeTypes.includes(normalizedMimeType) : false;
  const matchesExtension = config.extensions.includes(extension);
  if (!matchesMimeType && !matchesExtension) {
    return `${config.label} uploads must use ${config.extensions.join(", ")} files.`;
  }

  return null;
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

function formatContactFieldValue(fieldType: string, value: string | null | undefined): string {
  if (fieldType === "SWITCH") {
    if (value === "true") return "Yes";
    if (value === "false") return "No";
    return "Not captured yet";
  }
  if (fieldType === "DATE") {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : "Not captured yet";
  }
  return value?.trim() ? value : "Not captured yet";
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

function formatUnreadCount(value: number | null | undefined): string {
  const unreadCount = Math.max(0, Number(value ?? 0));
  if (unreadCount <= 0) {
    return "";
  }
  return unreadCount > 99 ? "99+" : String(unreadCount);
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

const META_ERROR_SOLUTIONS: Record<string, string> = {
  "131026": "The contact may not have WhatsApp or has blocked your number. Verify the phone number is valid and active on WhatsApp.",
  "131047": "You can only send free-form messages within 24 hours of the contact's last message. Use an approved template instead.",
  "131049": "Meta did not deliver this message to maintain ecosystem health (spam/quality signal). Improve template quality and reduce frequency.",
  "131051": "Template not found or not approved. Check that the template exists and is approved in Meta Business Manager.",
  "131052": "Template was paused or disabled by Meta due to low quality. Review and fix the template before resending.",
  "131053": "Media could not be downloaded — the URL expired or returned 403. Re-upload the media or use a permanently accessible URL.",
  "131056": "Too many messages sent to this contact in a short time. Wait before sending again.",
  "131057": "This contact has not opted in to receive messages from your business. Get explicit consent first.",
  "130429": "Rate limit hit on your WhatsApp Business Account. Slow down message sending or upgrade your tier.",
  "131031": "Business account is locked. Check your Meta Business Manager for policy violations or account issues.",
  "131000": "Message undeliverable — generic failure from Meta. Check the contact's number and account status.",
  "131008": "Required parameter missing in template. Ensure all template variables are filled.",
  "131009": "Parameter value invalid. Check the format of template variable values.",
};

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
  const [isDesktopFilterPanelOpen, setIsDesktopFilterPanelOpen] = useState(false);
  const [isDesktopLeadPanelOpen, setIsDesktopLeadPanelOpen] = useState(false);

  // Chat state
  const [chatAiMenuOpen, setChatAiMenuOpen] = useState(false);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [chatAiTimers, setChatAiTimers] = useState<Record<string, ChatAiTimedAction>>({});
  const [manualComposeConversationId, setManualComposeConversationId] = useState<string | null>(null);
  const [replyDraftText, setReplyDraftText] = useState("");
  const [noteDraftText, setNoteDraftText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [msgInfoTarget, setMsgInfoTarget] = useState<import("../../../lib/api").ConversationMessage | null>(null);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);
  const [composeTab, setComposeTab] = useState<"reply" | "notes">("reply");
  const [showAiAssistPopup, setShowAiAssistPopup] = useState(false);
  const [showToolbarFlowMenu, setShowToolbarFlowMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false);
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [isAiRewriting, setIsAiRewriting] = useState(false);
  const [showReplyGuide, setShowReplyGuide] = useState(false);
  const [templateVarsDialog, setTemplateVarsDialog] = useState<TemplateVarsDialogState | null>(null);
  const [templateUploadError, setTemplateUploadError] = useState<string | null>(null);
  const [templateUploadingFieldKey, setTemplateUploadingFieldKey] = useState<string | null>(null);
  const [newChatUploadingFieldKey, setNewChatUploadingFieldKey] = useState<string | null>(null);

  // New Chat dialog
  const NEW_CHAT_DEFAULT: NewChatState = { open: false, step: "contact", contact: null, channelType: "qr", connectionId: "", qrMode: null, qrFlowId: null, messageText: "", template: null, templateVars: null };
  const [newChat, setNewChat] = useState<NewChatState>(NEW_CHAT_DEFAULT);
  const [newChatContactSearch, setNewChatContactSearch] = useState("");
  const [newChatContacts, setNewChatContacts] = useState<ContactRecord[]>([]);

  // Toast
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clock for relative times
  const [clockTick, setClockTick] = useState(() => Date.now());

  // Refs
  const chatAiMenuRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingHistoryScrollRef = useRef<{ previousHeight: number; previousTop: number } | null>(null);
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
  const apiConnections = bootstrap?.channelSummary.metaApi.connections ?? [];
  const selectedNewChatConnection = apiConnections.find((connection) => connection.id === newChat.connectionId) ?? null;
  const selectedNewChatConnectionActive = isMetaConnectionActive(selectedNewChatConnection);

  // ─── Queries ──────────────────────────────────────────────────────────────
  const conversationsQuery = useInboxConversationsInfiniteQuery(token, { folder: "all", search });
  const messagesQuery = useInboxMessagesInfiniteQuery(token, selectedConversationId);
  const notesQuery = useInboxNotesQuery(token, selectedConversationId);
  const publishedFlowsQuery = useInboxPublishedFlowsQuery(token);
  const contactQuery = useQuery({
    queryKey: selectedConversationId ? dashboardQueryKeys.contactByConversation(selectedConversationId) : ["disabled"],
    queryFn: () => (selectedConversationId ? fetchContactByConversation(token, selectedConversationId).then((r) => r.contact) : Promise.resolve(null)),
    enabled: Boolean(selectedConversationId),
    staleTime: 30_000
  });
  const contactFieldsQuery = useQuery({
    queryKey: dashboardQueryKeys.contactFields,
    queryFn: () => listContactFields(token).then((response) => response.fields),
    staleTime: 60_000
  });
  const linkedContact = contactQuery.data ?? null;
  const templatesQuery = useInboxTemplatesQuery(token, newChat.channelType === "api" ? (newChat.connectionId || null) : null);
  const approvedTemplates = templatesQuery.data ?? [];

  // ─── Derived data ─────────────────────────────────────────────────────────
  const allConversations = useMemo(
    () => sortConversationsByRecent(conversationsQuery.data?.pages.flatMap((page) => page.items) ?? []),
    [conversationsQuery.data]
  );

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
  const selectedConversationFromAll = useMemo(
    () => allConversations.find((c) => c.id === selectedConversationId) ?? null,
    [allConversations, selectedConversationId]
  );

  const selectedConversationMessages = useMemo(
    () => (messagesQuery.data?.pages ? [...messagesQuery.data.pages].reverse().flatMap((page) => page.items) : []),
    [messagesQuery.data]
  );
  const selectedConversationNotes = notesQuery.data ?? [];
  const selectedConversationLabel = selectedConversation ? getConversationDisplayName(selectedConversation) : "Select a conversation";
  const selectedConversationStage = selectedConversation ? normalizeStage(selectedConversation.stage) : "cold";
  const activeDraftText = composeTab === "notes" ? noteDraftText : replyDraftText;
  const availableTemplates = useMemo(() => {
    if (!selectedConversation || selectedConversation.channel_type !== "api") {
      return [];
    }
    const linkedNumber = selectedConversation.channel_linked_number?.replace(/\D/g, "").trim();
    if (!linkedNumber) {
      return approvedTemplates;
    }
    return approvedTemplates.filter((template) => {
      if (!template.linkedNumber) return true;
      return template.linkedNumber.replace(/\D/g, "") === linkedNumber;
    });
  }, [approvedTemplates, selectedConversation]);

  const isQrConnected = Boolean(bootstrap?.channelSummary.whatsapp.status === "connected");
  const isApiConnected = Boolean(bootstrap?.channelSummary.metaApi.connected);
  const selectedConversationApiConnection = useMemo(() => {
    if (!selectedConversation || selectedConversation.channel_type !== "api") {
      return null;
    }
    const linkedNumber = selectedConversation.channel_linked_number?.replace(/\D/g, "").trim();
    if (!linkedNumber) {
      return bootstrap?.channelSummary.metaApi.connection ?? null;
    }
    return apiConnections.find((connection) => connection.linkedNumber?.replace(/\D/g, "").trim() === linkedNumber) ?? null;
  }, [apiConnections, bootstrap?.channelSummary.metaApi.connection, selectedConversation]);
  const selectedConversationCanDeliver = useMemo(() => {
    if (!selectedConversation) {
      return false;
    }
    if (selectedConversation.channel_type === "web") {
      return Boolean(selectedConversation.visitor_online);
    }
    if (selectedConversation.channel_type === "qr") {
      return isQrConnected;
    }
    return isMetaConnectionActive(selectedConversationApiConnection);
  }, [isQrConnected, selectedConversation, selectedConversationApiConnection]);
  const selectedConversationOfflineReason = useMemo(() => {
    if (!selectedConversation) {
      return "Select a conversation to reply.";
    }
    if (selectedConversation.channel_type === "web") {
      return selectedConversation.visitor_online
        ? null
        : "Visitor offline. History is available, but replies can only be delivered while the visitor is connected.";
    }
    if (selectedConversation.channel_type === "qr") {
      return isQrConnected ? null : "WhatsApp QR is disconnected. Reconnect it to send replies in this chat.";
    }
    return selectedConversationCanDeliver
      ? null
      : `WhatsApp API connection is ${getConnectionActiveLabel(selectedConversationApiConnection).toLowerCase()}. Reconnect or resume it to send replies or templates in this chat.`;
  }, [isQrConnected, selectedConversation, selectedConversationApiConnection, selectedConversationCanDeliver]);

  const newChatFilteredContacts = useMemo(() => {
    const q = newChatContactSearch.trim().toLowerCase();
    if (!q) return newChatContacts.slice(0, 50);
    return newChatContacts.filter((c) => {
      const hay = `${c.display_name ?? ""} ${c.phone_number} ${c.email ?? ""}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 50);
  }, [newChatContacts, newChatContactSearch]);

  const newChatAvailableTemplates = useMemo(() => {
    if (newChat.channelType !== "api" || !newChat.connectionId) return [];
    return approvedTemplates;
  }, [approvedTemplates, newChat.channelType, newChat.connectionId]);

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
  const visibleCustomFields = useMemo(() => {
    const fieldDefinitions = contactFieldsQuery.data ?? [];
    const valueRows = linkedContact?.custom_field_values ?? [];
    const valueMap = new Map(valueRows.map((fieldValue) => [fieldValue.field_id, fieldValue]));

    const merged = fieldDefinitions.map((field) => {
      const currentValue = valueMap.get(field.id);
      return {
        field_id: field.id,
        field_name: field.name,
        field_label: field.label,
        field_type: field.field_type,
        value: currentValue?.value ?? null
      };
    });

    const knownIds = new Set(fieldDefinitions.map((field) => field.id));
    const orphanValues = valueRows.filter((fieldValue) => !knownIds.has(fieldValue.field_id));
    return [...merged, ...orphanValues];
  }, [contactFieldsQuery.data, linkedContact]);

  const inboxStats = useMemo(() => ({
    total: allConversations.length,
    hot: allConversations.filter((c) => normalizeStage(c.stage) === "hot").length,
    human: allConversations.filter((c) => c.ai_paused || c.manual_takeover).length,
    unassigned: allConversations.filter((c) => !c.assigned_agent_profile_id && !c.assigned_agent_name).length
  }), [allConversations]);

  const activeFilterChips = useMemo(() => {
    const chips: ActiveFilterChip[] = [];
    if (stageFilter !== "all") chips.push({ key: "stage", label: `Status: ${getOptionLabel(LEAD_STAGE_OPTIONS, stageFilter)}` });
    if (channelFilter !== "all") chips.push({ key: "channel", label: `Source: ${getOptionLabel(CHANNEL_OPTIONS, channelFilter)}` });
    if (scoreFilter !== "all") chips.push({ key: "score", label: `AI score: ${getOptionLabel(SCORE_OPTIONS, scoreFilter)}` });
    if (leadKindFilter !== "all") chips.push({ key: "kind", label: `Type: ${getOptionLabel(LEAD_KIND_OPTIONS, leadKindFilter)}` });
    if (assignmentFilter !== "all") chips.push({ key: "assignment", label: `Assigned: ${getOptionLabel(ASSIGNMENT_OPTIONS, assignmentFilter)}` });
    if (aiModeFilter !== "all") chips.push({ key: "ai", label: `AI status: ${getOptionLabel(AI_MODE_OPTIONS, aiModeFilter)}` });
    if (dateRangeFilter !== "all") chips.push({ key: "range", label: `Date: ${getOptionLabel(DATE_RANGE_OPTIONS, dateRangeFilter)}` });
    if (search.trim()) chips.push({ key: "q", label: `Search: "${search.trim()}"` });
    return chips;
  }, [aiModeFilter, assignmentFilter, channelFilter, dateRangeFilter, leadKindFilter, scoreFilter, search, stageFilter]);

  const activeFilterCount = activeFilterChips.length;

  const canManualReply = Boolean(
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
    if (!chatAiMenuOpen && !flowMenuOpen && !showEmojiPicker && !showAiAssistPopup && !showToolbarFlowMenu && !showTemplateMenu && !showTranslateSubmenu && !showFormatMenu) return;
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
        setShowFormatMenu(false);
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChatAiMenuOpen(false); setFlowMenuOpen(false); setShowEmojiPicker(false);
        setShowAiAssistPopup(false); setShowToolbarFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false); setShowFormatMenu(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("keydown", onEscape);
    return () => { window.removeEventListener("mousedown", onOutside); window.removeEventListener("keydown", onEscape); };
  }, [chatAiMenuOpen, flowMenuOpen, showEmojiPicker, showAiAssistPopup, showToolbarFlowMenu, showTemplateMenu, showTranslateSubmenu, showFormatMenu]);

  // Reset chat UI when conversation changes
  useEffect(() => {
    setChatAiMenuOpen(false);
    setFlowMenuOpen(false);
    setReplyDraftText("");
    setNoteDraftText("");
    setManualComposeConversationId(null);
    setShowEmojiPicker(false);
    setAttachedFiles([]);
    setIsScrolledToBottom(true);
    setComposeTab("reply");
    setShowAiAssistPopup(false);
    setShowToolbarFlowMenu(false);
    setShowTemplateMenu(false);
    setShowTranslateSubmenu(false);
    setShowFormatMenu(false);
    setShowReplyGuide(true);
  }, [selectedConversationId]);

  useEffect(() => {
    setShowAiAssistPopup(false);
    setShowToolbarFlowMenu(false);
    setShowTemplateMenu(false);
    setShowTranslateSubmenu(false);
    setShowFormatMenu(false);
    setShowEmojiPicker(false);
  }, [composeTab]);

  // Scroll to bottom when conversation is first opened or messages load
  useEffect(() => {
    if (messagesQuery.isLoading) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setIsScrolledToBottom(true);
  }, [selectedConversationId, messagesQuery.isLoading]);

  useEffect(() => {
    if (!templateVarsDialog) {
      setTemplateUploadError(null);
      setTemplateUploadingFieldKey(null);
    }
  }, [templateVarsDialog]);

  useEffect(() => {
    if (newChat.channelType !== "api") {
      return;
    }
    if (!newChat.connectionId) {
      setNewChat((prev) => (
        prev.channelType === "api" && !prev.connectionId
          ? {
              ...prev,
              connectionId:
                apiConnections.find(isMetaConnectionActive)?.id ??
                bootstrap?.channelSummary.metaApi.connection?.id ??
                apiConnections[0]?.id ??
                ""
            }
          : prev
      ));
      return;
    }
    if (!apiConnections.some((connection) => connection.id === newChat.connectionId)) {
      setNewChat((prev) => ({ ...prev, connectionId: "", template: null, templateVars: null }));
    }
  }, [apiConnections, bootstrap?.channelSummary.metaApi.connection?.id, newChat.channelType, newChat.connectionId]);

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
  }, [activeDraftText]);

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

  const markReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      await markInboxConversationRead(token, conversationId);
      return conversationId;
    },
    onMutate: async (conversationId) => {
      const queryKey = dashboardQueryKeys.inboxConversations({ folder: "all", search });
      await queryClient.cancelQueries({ queryKey });
      const previousConversations = queryClient.getQueryData<InfiniteData<{ items: Conversation[]; nextCursor: string | null; hasMore: boolean }>>(queryKey);
      queryClient.setQueryData<InfiniteData<{ items: Conversation[]; nextCursor: string | null; hasMore: boolean }>>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.map((conversation) =>
              conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation
            )
          }))
        };
      });
      return { previousConversations, queryKey };
    },
    onError: (e, _conversationId, context) => {
      if (context?.previousConversations) {
        queryClient.setQueryData(context.queryKey, context.previousConversations);
      }
      setError((e as Error).message);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxConversations({ folder: "all", search }) });
    }
  });

  useEffect(() => {
    if (!selectedConversationId || !selectedConversationFromAll) {
      return;
    }
    if ((selectedConversationFromAll.unread_count ?? 0) <= 0 || markReadMutation.isPending) {
      return;
    }
    markReadMutation.mutate(selectedConversationId);
  }, [markReadMutation, selectedConversationFromAll, selectedConversationId]);

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
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxConversations({ folder: "all", search }) });
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
      setFlowMenuOpen(false); setChatAiMenuOpen(false); setManualComposeConversationId(null); setReplyDraftText("");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxConversations({ folder: "all", search }) });
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
      setReplyDraftText("");
      setAttachedFiles([]);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxConversations({ folder: "all", search }) });
      if (selectedConversationId) await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(selectedConversationId) });
    },
    onError: (e) => setError((e as Error).message)
  });

  const saveNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedConversationId) throw new Error("No conversation selected.");
      await createInboxNote(token, selectedConversationId, content);
    },
    onSuccess: async () => {
      setNoteDraftText("");
      if (selectedConversationId) {
        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxNotes(selectedConversationId) });
      }
      setInfo("Internal note saved.");
    },
    onError: (e) => setError((e as Error).message)
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return uploadInboxMediaToSupabase(file);
    }
  });

  const templateUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await uploadInboxMediaToSupabase(file);
      return {
        ...uploaded,
        fileName: file.name
      };
    }
  });

  const sendTemplateMutation = useMutation({
    mutationFn: async ({ conversationId, templateId, variableValues }: { conversationId: string; templateId: string; variableValues: Record<string, string> }) => {
      return sendInboxConversationTemplate(token, conversationId, templateId, variableValues);
    },
    onSuccess: async () => {
      setShowTemplateMenu(false);
      setTemplateVarsDialog(null);
      setTemplateUploadError(null);
      setTemplateUploadingFieldKey(null);
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxConversations({ folder: "all", search }) });
      if (selectedConversationId) await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(selectedConversationId) });
      setInfo("Template sent.");
    },
    onError: (e) => setError((e as Error).message)
  });

  const newChatMutation = useMutation({
    mutationFn: async () => {
      if (!newChat.contact) throw new Error("No contact selected.");
      if (newChat.channelType === "api") {
        if (!newChat.connectionId) {
          throw new Error("Select a WhatsApp API connection before starting this chat.");
        }
        if (!selectedNewChatConnectionActive) {
          throw new Error(`The selected WhatsApp API connection is ${getConnectionActiveLabel(selectedNewChatConnection).toLowerCase()}. Reconnect or resume it before sending.`);
        }
      }
      const { conversationId } = await startOutboundConversation(
        token,
        newChat.contact.id,
        newChat.channelType,
        newChat.channelType === "api" ? newChat.connectionId : null
      );
      if (newChat.channelType === "api" && newChat.templateVars) {
        await sendInboxConversationTemplate(token, conversationId, newChat.templateVars.template.id, newChat.templateVars.values);
      } else if (newChat.channelType === "qr") {
        if (newChat.qrMode === "manual" && newChat.messageText.trim()) {
          await sendManualConversationMessage(token, conversationId, newChat.messageText.trim());
        } else if (newChat.qrMode === "flow" && newChat.qrFlowId) {
          await assignInboxFlow(token, conversationId, newChat.qrFlowId);
        }
        // "ai" mode: conversation is created, AI handles from here — nothing extra to send
      }
      return conversationId;
    },
    onSuccess: async (conversationId) => {
      setNewChat(NEW_CHAT_DEFAULT);
      setNewChatContactSearch("");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxConversations({ folder: "all", search }) });
      navigate({ pathname: `/dashboard/inbox/${conversationId}`, search: searchParamString ? `?${searchParamString}` : "" });
      setInfo("Chat started.");
    },
    onError: (e) => setError((e as Error).message)
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const updateSearchParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("folder");
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const clearFilters = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);
  const clearFilterChip = useCallback((key: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("folder");
    next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openConversation = useCallback((conversationId: string) => {
    navigate({ pathname: `/dashboard/inbox/${conversationId}`, search: searchParamString ? `?${searchParamString}` : "" });
    if (isMobileViewport) setIsMobileConversationOpen(true);
  }, [navigate, searchParamString, isMobileViewport]);

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 60;
    setIsScrolledToBottom(atBottom);
    if (
      el.scrollTop <= 80 &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isFetchingNextPage &&
      !messagesQuery.isLoading
    ) {
      pendingHistoryScrollRef.current = {
        previousHeight: el.scrollHeight,
        previousTop: el.scrollTop
      };
      void messagesQuery.fetchNextPage();
    }
  }, [messagesQuery]);

  const scrollToBottom = useCallback(() => {
    const el = messagesEndRef.current;
    if (el) el.scrollIntoView({ behavior: "smooth" });
    setIsScrolledToBottom(true);
  }, []);

  useEffect(() => {
    if (messagesQuery.isFetchingNextPage) {
      return;
    }
    const pending = pendingHistoryScrollRef.current;
    const container = messagesContainerRef.current;
    if (!pending || !container) {
      return;
    }
    const addedHeight = container.scrollHeight - pending.previousHeight;
    container.scrollTop = pending.previousTop + Math.max(0, addedHeight);
    pendingHistoryScrollRef.current = null;
  }, [messagesQuery.data, messagesQuery.isFetchingNextPage]);

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
    if (composeTab !== "reply") return;
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
  }, [composeTab]);

  const handleInsertReplySuggestion = useCallback((suggestion: string) => {
    if (!selectedConversation) return;
    setComposeTab("reply");
    setManualComposeConversationId(selectedConversation.id);
    setReplyDraftText(suggestion);
    setShowAiAssistPopup(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [selectedConversation]);

  const handleApplyFormatting = useCallback((style: ComposeFormatStyle) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const marker = style === "bold" ? "*" : style === "italic" ? "_" : style === "strike" ? "~" : "```";
    const currentText = composeTab === "notes" ? noteDraftText : replyDraftText;
    const selectionStart = textarea.selectionStart ?? currentText.length;
    const selectionEnd = textarea.selectionEnd ?? currentText.length;
    const selectedText = currentText.slice(selectionStart, selectionEnd);
    const replacement = `${marker}${selectedText}${marker}`;
    const nextText = `${currentText.slice(0, selectionStart)}${replacement}${currentText.slice(selectionEnd)}`;
    const nextCursorStart = selectionStart + marker.length;
    const nextCursorEnd = nextCursorStart + selectedText.length;

    if (composeTab === "notes") {
      setNoteDraftText(nextText);
    } else {
      setReplyDraftText(nextText);
      if (selectedConversation) setManualComposeConversationId(selectedConversation.id);
    }

    setShowFormatMenu(false);
    requestAnimationFrame(() => {
      textarea.focus();
      if (selectedText.length > 0) {
        textarea.setSelectionRange(nextCursorStart, nextCursorEnd);
      } else {
        textarea.setSelectionRange(nextCursorStart, nextCursorStart);
      }
    });
  }, [composeTab, noteDraftText, replyDraftText, selectedConversation]);

  const handleAiRewrite = useCallback(async () => {
    const text = replyDraftText.trim();
    if (!text || isAiRewriting) return;
    setIsAiRewriting(true);
    try {
      const result = await aiAssistText(token, text, "rewrite");
      setReplyDraftText(result.text);
      textareaRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
    }
  }, [replyDraftText, isAiRewriting, token]);

  const handleAiTranslate = useCallback(async (language: string) => {
    const text = replyDraftText.trim();
    if (!text || isAiRewriting) return;
    setIsAiRewriting(true);
    try {
      const result = await aiAssistText(token, text, "translate", language);
      setReplyDraftText(result.text);
      textareaRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAiRewriting(false);
      setShowAiAssistPopup(false);
      setShowTranslateSubmenu(false);
    }
  }, [replyDraftText, isAiRewriting, token]);

  const handleOpenNewChat = useCallback(async () => {
    const defaultChannel: "qr" | "api" = isQrConnected ? "qr" : "api";
    const defaultConnectionId =
      apiConnections.find(isMetaConnectionActive)?.id ??
      bootstrap?.channelSummary.metaApi.connection?.id ??
      apiConnections[0]?.id ??
      "";
    setNewChat({ ...NEW_CHAT_DEFAULT, open: true, channelType: defaultChannel, connectionId: defaultChannel === "api" ? defaultConnectionId : "" });
    setNewChatContactSearch("");
    try {
      const res = await fetchContacts(token, { limit: 250 });
      setNewChatContacts(res.contacts);
    } catch {
      setNewChatContacts([]);
    }
  }, [apiConnections, bootstrap?.channelSummary.metaApi.connection?.id, isQrConnected, token]);

  const handleNewChatSelectContact = useCallback((contact: ContactRecord) => {
    setNewChat((prev) => ({ ...prev, contact, step: "message", qrMode: null, qrFlowId: null, messageText: "", template: null, templateVars: null }));
  }, []);

  const handleNewChatSelectTemplate = useCallback((template: MessageTemplate) => {
    const fields = buildTemplateDialogFields(template);
    const initialValues: Record<string, string> = {};
    fields.forEach((f) => { initialValues[f.key] = ""; });
    setNewChat((prev) => ({
      ...prev,
      template,
      templateVars: { template, fields, values: initialValues, uploads: {} }
    }));
  }, []);

  const handleSelectTemplate = useCallback((template: MessageTemplate) => {
    if (!selectedConversation) return;
    setShowTemplateMenu(false);
    if (!selectedConversationCanDeliver) {
      setError(selectedConversationOfflineReason ?? "This conversation is offline.");
      return;
    }
    if (selectedConversation.channel_type !== "api") {
      setError("Templates can only be sent on the WhatsApp API channel.");
      return;
    }
    // Build the dialog fields from the approved template structure.
    const fields = buildTemplateDialogFields(template);
    if (fields.length === 0 && template.category !== "MARKETING") {
      // No variables — send immediately
      sendTemplateMutation.mutate({ conversationId: selectedConversation.id, templateId: template.id, variableValues: {} });
    } else {
      // Open variable-fill dialog, and require confirmation for marketing templates even without variables.
      const initialValues: Record<string, string> = {};
      fields.forEach((field) => { initialValues[field.key] = ""; });
      setTemplateUploadError(null);
      setTemplateUploadingFieldKey(null);
      setTemplateVarsDialog({ template, fields, values: initialValues, uploads: {} });
    }
  }, [selectedConversation, selectedConversationCanDeliver, selectedConversationOfflineReason, sendTemplateMutation]);

  const handleSendMessage = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedConversationCanDeliver) {
      setError(selectedConversationOfflineReason ?? "This conversation is offline.");
      return;
    }
    const text = replyDraftText.trim();
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
  }, [attachedFiles, replyDraftText, selectedConversationCanDeliver, selectedConversationOfflineReason, sendMessageMutation, uploadMutation]);

  const handleSaveNote = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const text = noteDraftText.trim();
    if (!text || saveNoteMutation.isPending) return;
    saveNoteMutation.mutate(text);
  }, [noteDraftText, saveNoteMutation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (composeTab === "notes") {
        handleSaveNote();
      } else {
        void handleSendMessage();
      }
    }
  }, [composeTab, handleSaveNote, handleSendMessage]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    if (composeTab === "notes") {
      setNoteDraftText((prev) => prev + emoji);
    } else {
      setReplyDraftText((prev) => prev + emoji);
      if (selectedConversation) setManualComposeConversationId(selectedConversation.id);
    }
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }, [composeTab, selectedConversation]);

  const publishedFlows = publishedFlowsQuery.data ?? [];
  const isReplySendDisabled =
    !selectedConversationCanDeliver ||
    sendMessageMutation.isPending ||
    uploadMutation.isPending ||
    (!replyDraftText.trim() && attachedFiles.length === 0);
  const isNoteSendDisabled = saveNoteMutation.isPending || !noteDraftText.trim();
  const isTemplateDialogReady = templateVarsDialog ? templateVarsDialog.fields.every((field) => field.kind === "media" || Boolean(templateVarsDialog.values[field.key]?.trim())) : false;

  const closeTemplateDialog = () => {
    setTemplateVarsDialog(null);
    setTemplateUploadError(null);
    setTemplateUploadingFieldKey(null);
  };

  const updateTemplateDialogValue = (fieldKey: string, value: string) => {
    setTemplateVarsDialog((prev) => (
      prev ? { ...prev, values: { ...prev.values, [fieldKey]: value } } : prev
    ));
  };

  const handleTemplateFieldFileSelect = async (
    field: Extract<TemplateDialogField, { kind: "media" }>,
    file: File | null | undefined
  ) => {
    if (!file) {
      return;
    }

    const validationError = validateTemplateMediaFile(field.mediaType, file);
    if (validationError) {
      setTemplateUploadError(validationError);
      return;
    }

    setTemplateUploadError(null);
    setTemplateUploadingFieldKey(field.key);
    try {
      const uploaded = await templateUploadMutation.mutateAsync(file);
      setTemplateVarsDialog((prev) => (
        prev
          ? {
              ...prev,
              values: { ...prev.values, [field.key]: uploaded.url },
              uploads: {
                ...prev.uploads,
                [field.key]: {
                  fileName: uploaded.fileName,
                  mimeType: uploaded.mimeType,
                  previewUrl: field.mediaType === "IMAGE" ? uploaded.url : null
                }
              }
            }
          : prev
      ));
    } catch (err) {
      setTemplateUploadError((err as Error).message);
    } finally {
      setTemplateUploadingFieldKey(null);
    }
  };

  const handleNewChatFieldFileSelect = async (
    field: Extract<TemplateDialogField, { kind: "media" }>,
    file: File | null | undefined
  ) => {
    if (!file) return;
    const validationError = validateTemplateMediaFile(field.mediaType, file);
    if (validationError) {
      setTemplateUploadError(validationError);
      return;
    }
    setTemplateUploadError(null);
    setNewChatUploadingFieldKey(field.key);
    try {
      const uploaded = await templateUploadMutation.mutateAsync(file);
      setNewChat((prev) =>
        prev.templateVars
          ? {
              ...prev,
              templateVars: {
                ...prev.templateVars,
                values: { ...prev.templateVars.values, [field.key]: uploaded.url },
                uploads: {
                  ...prev.templateVars.uploads,
                  [field.key]: {
                    fileName: uploaded.fileName ?? file.name,
                    mimeType: file.type,
                    previewUrl: field.mediaType === "IMAGE" ? uploaded.url : null
                  }
                }
              }
            }
          : prev
      );
    } catch (err) {
      setTemplateUploadError((err as Error).message);
    } finally {
      setNewChatUploadingFieldKey(null);
    }
  };

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
                        {activeFilterChips.map((chip) => (
                          <button key={chip.key} type="button" className="inbox-active-filter-chip" onClick={() => clearFilterChip(chip.key)}>
                            <span>{chip.label}</span>
                            <strong>×</strong>
                          </button>
                        ))}
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
                    <div className="inbox-list-toolbar-actions">
                      {(isQrConnected || isApiConnected) && (
                        <button type="button" className="ghost-btn inbox-new-chat-btn" onClick={() => { void handleOpenNewChat(); }}>
                          + New Chat
                        </button>
                      )}
                      {!showFilterPane && activeFilterCount > 0 && (
                        <button type="button" className="ghost-btn" onClick={clearFilters}>Clear filters</button>
                      )}
                    </div>
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
                  <>
                    {filteredConversations.map((c) => {
                      const label = getConversationDisplayName(c);
                      const stage = normalizeStage(c.stage);
                      const scoreBand = getLeadScoreBand(c);
                      const initials = label.split(" ").map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
                      const unreadCount = c.unread_count ?? 0;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={`clone-thread-item inbox-thread-item stage-${stage}${c.id === selectedConversationId ? " active" : ""}${unreadCount > 0 ? " unread" : ""}`}
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
                                  {unreadCount > 0 && <span className="inbox-unread-badge">{formatUnreadCount(unreadCount)}</span>}
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
                    })}
                    {conversationsQuery.hasNextPage && (
                      <button
                        type="button"
                        className="ghost-btn"
                        style={{ margin: "0.8rem 1rem 1rem" }}
                        disabled={conversationsQuery.isFetchingNextPage}
                        onClick={() => void conversationsQuery.fetchNextPage()}
                      >
                        {conversationsQuery.isFetchingNextPage ? "Loading..." : "Load more"}
                      </button>
                    )}
                  </>
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
                    <>
                      {messagesQuery.hasNextPage && (
                        <div style={{ display: "flex", justifyContent: "center", paddingBottom: "0.75rem" }}>
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={messagesQuery.isFetchingNextPage}
                            onClick={() => {
                              const container = messagesContainerRef.current;
                              if (container) {
                                pendingHistoryScrollRef.current = {
                                  previousHeight: container.scrollHeight,
                                  previousTop: container.scrollTop
                                };
                              }
                              void messagesQuery.fetchNextPage();
                            }}
                          >
                            {messagesQuery.isFetchingNextPage ? "Loading older..." : "Load older messages"}
                          </button>
                        </div>
                      )}
                      {selectedConversationMessages.map((msg, idx) => {
                        const prevMsg = idx > 0 ? selectedConversationMessages[idx - 1] : null;
                        const showDate = !prevMsg || !isSameDay(prevMsg.created_at, msg.created_at);
                        const normalizedMessage = normalizeMessage(msg);

                        const isOutbound = msg.direction === "outbound";
                        const isAi = isOutbound && Boolean(msg.ai_model);
                        const isFlow = isOutbound && !isAi && !msg.sender_name;
                        const isManual = isOutbound && !isAi && Boolean(msg.sender_name);
                        const isTemplate = normalizedMessage.type === "template";

                        const isFailed = msg.delivery_status === "failed";

                        const bubbleClass = [
                          "bubble",
                          msg.direction,
                          isAi ? "ai-bubble" : "",
                          isFlow ? "flow-bubble" : "",
                          isFailed ? "bubble--failed" : ""
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
                                {renderMessage(normalizedMessage)}
                              </div>
                              <div className="bubble-meta">
                                {isAi && <span className="bubble-ai-badge">AI</span>}
                                {isFlow && <span className="bubble-flow-badge">Flow</span>}
                                {isTemplate && <span className="bubble-template-badge">Template</span>}
                                {isManual && msg.sender_name && (
                                  <span className="bubble-sender">{msg.sender_name}</span>
                                )}
                                <time title={formatDateTime(msg.created_at)}>{formatMessageTime(msg.created_at)}</time>
                                {isOutbound && msg.total_tokens ? (
                                  <span className="token-meta">{msg.total_tokens} tokens</span>
                                ) : null}
                              </div>
                              {isFailed && (
                                <div className="bubble-error-hint">
                                  <span className="bubble-error-hint-icon">&#9888;</span>
                                  <span className="bubble-error-hint-text">
                                    {msg.error_code ? `Error ${msg.error_code}: ` : ""}
                                    {msg.error_message ?? "Message delivery failed"}
                                  </span>
                                </div>
                              )}
                              <button
                                type="button"
                                className="bubble-copy-btn"
                                title="Copy message"
                                onClick={() => handleCopyMessage(msg.id, msg.message_text)}
                              >
                                {copiedMessageId === msg.id ? "✓" : "⎘"}
                              </button>
                              {isOutbound && (
                                <button
                                  type="button"
                                  className={`bubble-info-btn${isFailed ? " bubble-info-btn--error" : ""}`}
                                  title={isFailed ? "Delivery failed – click for details" : "Message info"}
                                  onClick={() => setMsgInfoTarget(msg)}
                                >
                                  &#9432;
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
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
                    <div className="compose-tabs">
                      <button type="button" className={`compose-tab${composeTab === "reply" ? " active" : ""}`} onClick={() => setComposeTab("reply")}>Reply</button>
                      <button type="button" className={`compose-tab${composeTab === "notes" ? " active" : ""}`} onClick={() => setComposeTab("notes")}>Notes</button>
                    </div>

                    {composeTab === "reply" ? (
                      canManualReply ? (
                      <form className="chat-compose-form" onSubmit={(e) => { e.preventDefault(); void handleSendMessage(); }}>
                        {showReplyGuide && (
                          <div className="compose-channel-hint">
                            <div className="compose-channel-hint-head">
                              <div className="compose-channel-hint-copy">
                                <strong>Reply channel</strong>
                                <span>Use Template for approved API outbound messages, Flow for automation, and AI Assist for drafting help.</span>
                              </div>
                              <button type="button" className="compose-channel-hint-close" aria-label="Close reply guide" onClick={() => setShowReplyGuide(false)}>×</button>
                            </div>
                          </div>
                        )}

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
                        <div className={`chat-compose-rich-wrap${replyDraftText ? " has-value" : ""}`}>
                          <div className="chat-compose-rich-preview">
                            {replyDraftText ? renderFormattedText(replyDraftText, "compose-reply") : null}
                          </div>
                          {!replyDraftText && (
                            <div className="chat-compose-rich-placeholder">{`Message ${selectedConversationLabel}…`}</div>
                          )}
                          <textarea
                            ref={textareaRef}
                            className="chat-compose-textarea chat-compose-textarea-rich"
                            value={replyDraftText}
                            onChange={(e) => { setReplyDraftText(e.target.value); setManualComposeConversationId(selectedConversation.id); }}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            rows={2}
                            maxLength={4000}
                          />
                        </div>

                        {/* Toolbar row */}
                        <div className="compose-toolbar-wrap" ref={toolbarWrapRef}>
                          {/* AI Assist popup — floats above toolbar */}
                          {showAiAssistPopup && (
                            <div className="ai-assist-popup">
                              <div className="ai-assist-popup-header">
                                <span>AI Assist</span>
                                <button type="button" className="ai-assist-popup-close" onClick={() => setShowAiAssistPopup(false)}>✕</button>
                              </div>
                              <button
                                type="button"
                                className="ai-assist-popup-item"
                                disabled={!replyDraftText.trim() || isAiRewriting}
                                onClick={() => { void handleAiRewrite(); }}
                              >
                                <span className="ai-assist-item-icon">✨</span>
                                <span className="ai-assist-item-label">{isAiRewriting ? "Rewriting…" : "Rewrite current draft"}</span>
                                <span className="ai-assist-item-arrow">›</span>
                              </button>
                              <div className="ai-assist-popup-item ai-assist-translate-row" onMouseEnter={() => setShowTranslateSubmenu(true)} onMouseLeave={() => setShowTranslateSubmenu(false)}>
                                <span className="ai-assist-item-icon">🔤</span>
                                <span className="ai-assist-item-label">Translate current draft</span>
                                <span className="ai-assist-item-arrow">›</span>
                                {showTranslateSubmenu && (
                                  <div className="ai-translate-submenu">
                                    {TRANSLATE_LANGUAGES.map((lang) => (
                                      <button key={lang} type="button" disabled={!replyDraftText.trim() || isAiRewriting} onClick={() => { void handleAiTranslate(lang); }}>
                                        {lang}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {replySuggestions.length > 0 && (
                                <div className="ai-assist-section">
                                  <div className="ai-assist-section-label">Suggested replies</div>
                                  <div className="ai-assist-suggestion-list">
                                    {replySuggestions.map((suggestion) => (
                                      <button key={suggestion} type="button" className="ai-assist-suggestion-btn" onClick={() => handleInsertReplySuggestion(suggestion)}>
                                        {suggestion}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="ai-assist-popup-footer">
                                <span>{getLeadIntentLabel(selectedConversation)}</span>
                                <span>{getLeadSuggestedAction(selectedConversation)}</span>
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
                          {showTemplateMenu && selectedConversation.channel_type === "api" && (
                            <div className="compose-dropup compose-template-dropup">
                                <div className="compose-dropup-label">Send approved template</div>
                              {templatesQuery.isLoading ? (
                                <button type="button" disabled>Loading templates…</button>
                              ) : availableTemplates.length === 0 ? (
                                <button type="button" disabled>No approved templates</button>
                              ) : (
                                availableTemplates.map((t) => (
                                  <button key={t.id} type="button" className="compose-template-item" disabled={!selectedConversationCanDeliver || sendTemplateMutation.isPending} onClick={() => handleSelectTemplate(t)}>
                                    <strong>{t.name} <span style={{ color: t.category === "MARKETING" ? "#b45309" : "#0f766e", fontWeight: 700 }}>{t.category}</span></strong>
                                    <span>{getTemplateBodyText(t).slice(0, 80)}{getTemplateBodyText(t).length > 80 ? "…" : ""}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}

                          {showFormatMenu && (
                            <div className="compose-format-menu">
                              <button type="button" onClick={() => handleApplyFormatting("bold")}><strong>B</strong><span>Bold</span></button>
                              <button type="button" onClick={() => handleApplyFormatting("italic")}><em>I</em><span>Italic</span></button>
                              <button type="button" onClick={() => handleApplyFormatting("strike")}><span style={{ textDecoration: "line-through" }}>S</span><span>Strike</span></button>
                              <button type="button" onClick={() => handleApplyFormatting("monospace")}><code>{`{ }`}</code><span>Monospace</span></button>
                            </div>
                          )}

                          <div className="compose-toolbar">
                            <div className="compose-toolbar-left">
                              <button type="button" className="compose-tool" title="Attach file" disabled={attachedFiles.length >= 5} onClick={() => fileInputRef.current?.click()}>＋</button>
                              <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt" style={{ display: "none" }} multiple onChange={handleFileSelect} />

                              <div className="chat-emoji-wrap" ref={emojiPickerRef}>
                                <button type="button" className="compose-tool" title="Emoji" onClick={() => setShowEmojiPicker((v) => !v)}>😊</button>
                                {showEmojiPicker && (
                                  <div className="chat-emoji-picker">
                                    {QUICK_EMOJIS.map((emoji) => (
                                      <button key={emoji} type="button" onClick={() => handleEmojiSelect(emoji)}>{emoji}</button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <button type="button" className={`compose-tool compose-tool-aa${showFormatMenu ? " active" : ""}`} title="Formatting" onClick={() => { setShowFormatMenu((v) => !v); setShowAiAssistPopup(false); setShowToolbarFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false); }}>Aa</button>

                              <button
                                type="button"
                                className={`compose-action-btn compose-toolbar-pill${showToolbarFlowMenu ? " active" : ""}`}
                                disabled={!selectedConversationCanDeliver || assignFlowMutation.isPending}
                                onClick={() => { setShowToolbarFlowMenu((v) => !v); setShowTemplateMenu(false); setShowAiAssistPopup(false); setShowTranslateSubmenu(false); setShowFormatMenu(false); }}
                              >
                                Flow
                              </button>

                              {selectedConversation.channel_type === "api" && (
                                <button
                                  type="button"
                                  className={`compose-action-btn compose-toolbar-pill${showTemplateMenu ? " active" : ""}`}
                                  disabled={!selectedConversationCanDeliver || sendTemplateMutation.isPending}
                                  onClick={() => { setShowTemplateMenu((v) => !v); setShowToolbarFlowMenu(false); setShowAiAssistPopup(false); setShowTranslateSubmenu(false); setShowFormatMenu(false); }}
                                >
                                  {sendTemplateMutation.isPending ? "Template..." : "Template"}
                                </button>
                              )}

                              <button
                                type="button"
                                className={`compose-ai-assist-btn compose-toolbar-pill${showAiAssistPopup ? " active" : ""}`}
                                onClick={() => { setShowAiAssistPopup((v) => !v); setShowToolbarFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false); setShowFormatMenu(false); }}
                              >
                                AI Assist
                              </button>
                            </div>

                            <div className="compose-toolbar-right">
                              {replyDraftText.length > 0 && (
                                <span className={`chat-char-count${replyDraftText.length > 3800 ? " near-limit" : ""}`}>{replyDraftText.length}/4000</span>
                              )}

                              <button type="button" className="compose-tool" title="Clear message" onClick={() => setReplyDraftText("")}>↩</button>

                              {!selectedConversationCanDeliver ? (
                                <span className="chat-compose-offline-note">{selectedConversationOfflineReason}</span>
                              ) : (
                                <button type="submit" className="compose-send-btn" disabled={isReplySendDisabled}>
                                  {uploadMutation.isPending ? "Uploading…" : sendMessageMutation.isPending ? "Sending…" : "Send"}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </form>
                      ) : (
                        <>
                          {showReplyGuide && (
                            <div className="compose-channel-hint compose-channel-hint-warning">
                              <div className="compose-channel-hint-head">
                                <div className="compose-channel-hint-copy">
                                  <strong>Reply channel</strong>
                                  <span>AI is still active on this chat. Take over when you want to send a personal reply.</span>
                                </div>
                                <button type="button" className="compose-channel-hint-close" aria-label="Close reply guide" onClick={() => setShowReplyGuide(false)}>×</button>
                              </div>
                            </div>
                          )}
                          <div className="inbox-manual-hint">
                            <span>AI is handling this conversation.</span>
                            <button type="button" className="ghost-btn" onClick={() => { toggleMutation.mutate({ conversationId: selectedConversation.id, paused: true, durationMinutes: null }); setManualComposeConversationId(selectedConversation.id); }}>
                              Take over &amp; reply manually
                            </button>
                          </div>
                        </>
                      )
                    ) : (
                      <form className="chat-compose-form" onSubmit={(e) => { e.preventDefault(); handleSaveNote(); }}>
                        <div className="compose-note-intro">
                          <strong>Internal session notes</strong>
                          <span>Notes stay inside this chat for your team and are never sent to the contact.</span>
                        </div>

                        <div className="compose-notes-panel">
                          {notesQuery.isLoading ? (
                            <p className="empty-note">Loading notes…</p>
                          ) : notesQuery.isError ? (
                            <p className="empty-note" style={{ color: "#c0392b" }}>Could not load notes.</p>
                          ) : selectedConversationNotes.length === 0 ? (
                            <p className="empty-note">No internal notes yet.</p>
                          ) : (
                            <div className="compose-note-list">
                              {selectedConversationNotes.map((note) => (
                                <article key={note.id} className="compose-note-item">
                                  <div className="compose-note-meta">
                                    <strong>{note.author_name}</strong>
                                    <time title={formatDateTime(note.created_at)}>{formatDateTime(note.created_at)}</time>
                                  </div>
                                  <p className="compose-note-text">{note.content}</p>
                                </article>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className={`chat-compose-rich-wrap chat-compose-rich-wrap-notes${noteDraftText ? " has-value" : ""}`}>
                          <div className="chat-compose-rich-preview">
                            {noteDraftText ? renderFormattedText(noteDraftText, "compose-note") : null}
                          </div>
                          {!noteDraftText && (
                            <div className="chat-compose-rich-placeholder">Add an internal note... (visible to agents only)</div>
                          )}
                          <textarea
                            ref={textareaRef}
                            className="chat-compose-textarea chat-compose-textarea-rich notes-mode"
                            value={noteDraftText}
                            onChange={(e) => setNoteDraftText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={2}
                            maxLength={4000}
                          />
                        </div>

                        <div className="compose-toolbar-wrap" ref={toolbarWrapRef}>
                          {showFormatMenu && (
                            <div className="compose-format-menu">
                              <button type="button" onClick={() => handleApplyFormatting("bold")}><strong>B</strong><span>Bold</span></button>
                              <button type="button" onClick={() => handleApplyFormatting("italic")}><em>I</em><span>Italic</span></button>
                              <button type="button" onClick={() => handleApplyFormatting("strike")}><span style={{ textDecoration: "line-through" }}>S</span><span>Strike</span></button>
                              <button type="button" onClick={() => handleApplyFormatting("monospace")}><code>{`{ }`}</code><span>Monospace</span></button>
                            </div>
                          )}

                          <div className="compose-channel-row compose-channel-row-notes">
                            <span className="compose-channel-row-label">Notes only</span>
                            <div className="compose-channel-row-actions">
                              <span className="compose-note-pill">Not sent to customer</span>
                            </div>
                          </div>

                          <div className="compose-toolbar">
                            <div className="compose-toolbar-left">
                              <div className="chat-emoji-wrap" ref={emojiPickerRef}>
                                <button type="button" className="compose-tool" title="Emoji" onClick={() => setShowEmojiPicker((v) => !v)}>😊</button>
                                {showEmojiPicker && (
                                  <div className="chat-emoji-picker">
                                    {QUICK_EMOJIS.map((emoji) => (
                                      <button key={emoji} type="button" onClick={() => handleEmojiSelect(emoji)}>{emoji}</button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <button type="button" className={`compose-tool compose-tool-aa${showFormatMenu ? " active" : ""}`} title="Formatting" onClick={() => { setShowFormatMenu((v) => !v); setShowAiAssistPopup(false); setShowToolbarFlowMenu(false); setShowTemplateMenu(false); setShowTranslateSubmenu(false); }}>Aa</button>
                            </div>

                            <div className="compose-toolbar-right">
                              {noteDraftText.length > 0 && (
                                <span className={`chat-char-count${noteDraftText.length > 3800 ? " near-limit" : ""}`}>{noteDraftText.length}/4000</span>
                              )}

                              <button type="button" className="compose-tool" title="Clear note" onClick={() => setNoteDraftText("")}>↩</button>
                              <button type="submit" className="compose-send-btn" disabled={isNoteSendDisabled}>
                                {saveNoteMutation.isPending ? "Saving…" : "Save Note"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </section>

              {/* ── Template variable fill dialog ── */}
              {templateVarsDialog && (
                <div className="tmpl-dialog-overlay" onClick={closeTemplateDialog}>
                  <div className="tmpl-dialog" onClick={(e) => e.stopPropagation()}>
                    <div className="tmpl-dialog-head">
                      <strong>Fill template variables</strong>
                      <span className="tmpl-dialog-name">{templateVarsDialog.template.name}</span>
                      <button type="button" className="tmpl-dialog-close" onClick={closeTemplateDialog}>✕</button>
                    </div>
                    <div className="tmpl-dialog-preview">
                      {templateVarsDialog.template.category === "MARKETING" && (
                        <div
                          style={{
                            marginBottom: "12px",
                            padding: "10px 12px",
                            borderRadius: "10px",
                            background: "#fffbeb",
                            border: "1px solid #fde68a",
                            color: "#92400e",
                            fontSize: "13px"
                          }}
                        >
                          Approved marketing templates can still be blocked by Meta based on recipient engagement policy. A successful send request does not guarantee delivery.
                        </div>
                      )}
                      {templateVarsDialog.template.components.filter((c) => c.text).map((c, i) => (
                        <p key={i} className="tmpl-dialog-preview-text">{c.text}</p>
                      ))}
                    </div>
                    <div className="tmpl-dialog-fields">
                      {templateVarsDialog.fields.length === 0 && (
                        <div className="tmpl-dialog-empty-state">
                          No extra input is needed for this template. Review the preview and send when ready.
                        </div>
                      )}
                      {templateVarsDialog.fields.map((field) => (
                        <label key={field.key} className="tmpl-dialog-field">
                          <span>{field.label}</span>
                          {field.kind === "text" ? (
                            <input
                              type="text"
                              placeholder={field.placeholder}
                              value={templateVarsDialog.values[field.key] ?? ""}
                              onChange={(e) => updateTemplateDialogValue(field.key, e.target.value)}
                            />
                          ) : (
                            <div className={`tmpl-dialog-upload${templateVarsDialog.values[field.key] ? " uploaded" : ""}`}>
                              <div className="tmpl-dialog-upload-main">
                                <div>
                                  <strong>{TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].label} header</strong>
                                  <p className="tmpl-dialog-media-hint">Optional — leaves empty to use template&apos;s approved sample media.</p>
                                </div>
                                <label className="tmpl-dialog-upload-btn">
                                  <input
                                    type="file"
                                    accept={TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].accept}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      void handleTemplateFieldFileSelect(field, file);
                                      e.target.value = "";
                                    }}
                                  />
                                  {templateUploadingFieldKey === field.key ? "Uploading..." : templateVarsDialog.uploads[field.key] ? "Replace file" : `Upload ${TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].label.toLowerCase()}`}
                                </label>
                              </div>
                              {templateVarsDialog.uploads[field.key] && (
                                <div className="tmpl-dialog-upload-meta">
                                  {templateVarsDialog.uploads[field.key]?.previewUrl ? (
                                    <img
                                      src={templateVarsDialog.uploads[field.key]?.previewUrl ?? ""}
                                      alt={templateVarsDialog.uploads[field.key]?.fileName}
                                      className="tmpl-dialog-upload-preview"
                                    />
                                  ) : (
                                    <div className="tmpl-dialog-upload-file">{templateVarsDialog.uploads[field.key]?.fileName}</div>
                                  )}
                                  <div className="tmpl-dialog-upload-caption">
                                    Ready to send: {templateVarsDialog.uploads[field.key]?.fileName}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="tmpl-dialog-actions">
                      {templateUploadError && (
                        <div className="tmpl-dialog-error">{templateUploadError}</div>
                      )}
                      {sendTemplateMutation.isError && (
                        <div className="tmpl-dialog-error">{(sendTemplateMutation.error as Error).message}</div>
                      )}
                      <button type="button" className="ghost-btn" onClick={closeTemplateDialog}>Cancel</button>
                      <button
                        type="button"
                        className="compose-send-btn"
                        disabled={!selectedConversationCanDeliver || sendTemplateMutation.isPending || templateUploadMutation.isPending || !isTemplateDialogReady}
                        onClick={() => {
                          if (!selectedConversationCanDeliver) {
                            setError(selectedConversationOfflineReason ?? "This conversation is offline.");
                            return;
                          }
                          if (!selectedConversation) return;
                          setTemplateUploadError(null);
                          sendTemplateMutation.mutate({
                            conversationId: selectedConversation.id,
                            templateId: templateVarsDialog.template.id,
                            variableValues: templateVarsDialog.values
                          });
                        }}
                      >
                        {templateUploadMutation.isPending ? "Uploading..." : sendTemplateMutation.isPending ? "Sending..." : "Send Template"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                          <div><dt>Owner</dt><dd>{selectedConversation.assigned_agent_name || "Unassigned"}</dd></div>
                          <div><dt>Last touch</dt><dd>{formatDateTime(selectedConversation.last_message_at)}</dd></div>
                          <div><dt>Connected number</dt><dd>{selectedConversation.channel_linked_number || "Workspace default"}</dd></div>
                          {linkedContact?.source_type && (
                            <div><dt>Source</dt><dd>{linkedContact.source_type}</dd></div>
                          )}
                          {/* Custom fields */}
                          {visibleCustomFields.length > 0 && (
                            <>
                              <div className="inbox-detail-divider"><span>Custom Fields</span></div>
                              {visibleCustomFields.map((fv) => (
                                <div key={fv.field_id}>
                                  <dt>{fv.field_label}</dt>
                                  <dd>{formatContactFieldValue(fv.field_type, fv.value)}</dd>
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
      {/* ── New Chat dialog ── */}
      {newChat.open && (
        <div className="tmpl-dialog-overlay" onClick={() => setNewChat(NEW_CHAT_DEFAULT)}>
          <div className="tmpl-dialog new-chat-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="tmpl-dialog-head">
              <strong>{newChat.step === "contact" ? "New Chat — Pick a contact" : `New Chat — ${newChat.contact?.display_name ?? newChat.contact?.phone_number ?? ""}`}</strong>
              <button type="button" className="tmpl-dialog-close" onClick={() => setNewChat(NEW_CHAT_DEFAULT)}>✕</button>
            </div>

            {newChat.step === "contact" && (
              <>
                <div className="new-chat-search-wrap">
                  <input
                    className="inbox-select"
                    autoFocus
                    placeholder="Search by name or phone..."
                    value={newChatContactSearch}
                    onChange={(e) => setNewChatContactSearch(e.target.value)}
                  />
                </div>
                {newChat.contact === null && newChatContacts.length === 0 && (
                  <p className="empty-note" style={{ padding: "12px 16px" }}>Loading contacts…</p>
                )}
                <div className="new-chat-contact-list">
                  {newChatFilteredContacts.length === 0 && newChatContacts.length > 0 && (
                    <p className="empty-note" style={{ padding: "12px 16px" }}>No contacts match.</p>
                  )}
                  {newChatFilteredContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="new-chat-contact-item"
                      onClick={() => handleNewChatSelectContact(c)}
                    >
                      <span className="new-chat-contact-name">{c.display_name || c.phone_number}</span>
                      <span className="new-chat-contact-phone">{c.phone_number}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {newChat.step === "message" && newChat.contact && (
              <>
                {/* Channel selector — always visible, disabled pills for disconnected channels */}
                <div className="new-chat-channel-row">
                  <span>Channel</span>
                  <div className="new-chat-channel-pills">
                    <button
                      type="button"
                      className={`compose-toolbar-pill${newChat.channelType === "qr" ? " active" : ""}${!isQrConnected ? " disabled" : ""}`}
                      disabled={!isQrConnected}
                      title={isQrConnected ? "WhatsApp QR" : "WhatsApp QR not connected"}
                      onClick={() => setNewChat((p) => ({ ...p, channelType: "qr", connectionId: "", qrMode: null, qrFlowId: null, messageText: "", template: null, templateVars: null }))}
                    >
                      WA QR{!isQrConnected && " (offline)"}
                    </button>
                    <button
                      type="button"
                      className={`compose-toolbar-pill${newChat.channelType === "api" ? " active" : ""}${!isApiConnected ? " disabled" : ""}`}
                      disabled={!isApiConnected}
                      title={isApiConnected ? "WhatsApp API" : "WhatsApp API not connected"}
                      onClick={() => setNewChat((p) => ({ ...p, channelType: "api", connectionId: p.connectionId || apiConnections.find(isMetaConnectionActive)?.id || bootstrap?.channelSummary.metaApi.connection?.id || apiConnections[0]?.id || "", qrMode: null, qrFlowId: null, messageText: "", template: null, templateVars: null }))}
                    >
                      WA API{!isApiConnected && " (offline)"}
                    </button>
                  </div>
                </div>

                {/* QR: 3-option mode picker */}
                {newChat.channelType === "qr" && (
                  <div className="new-chat-compose-wrap">
                    {/* Mode cards */}
                    {!newChat.qrMode && (
                      <div className="new-chat-qr-modes">
                        <button
                          type="button"
                          className="new-chat-qr-mode-card"
                          onClick={() => setNewChat((p) => ({ ...p, qrMode: "manual" }))}
                        >
                          <span className="new-chat-qr-mode-icon">✏️</span>
                          <strong>Manual Message</strong>
                          <span>Type a custom first message to send now.</span>
                        </button>
                        <button
                          type="button"
                          className="new-chat-qr-mode-card"
                          onClick={() => setNewChat((p) => ({ ...p, qrMode: "flow" }))}
                        >
                          <span className="new-chat-qr-mode-icon">⚡</span>
                          <strong>Select Flow</strong>
                          <span>Assign a published automation flow to handle the conversation.</span>
                        </button>
                        <button
                          type="button"
                          className="new-chat-qr-mode-card"
                          onClick={() => setNewChat((p) => ({ ...p, qrMode: "ai" }))}
                        >
                          <span className="new-chat-qr-mode-icon">🤖</span>
                          <strong>AI Reply</strong>
                          <span>Open the chat and let the AI agent respond automatically.</span>
                        </button>
                      </div>
                    )}

                    {/* Manual: free-text textarea */}
                    {newChat.qrMode === "manual" && (
                      <>
                        <div className="new-chat-mode-back">
                          <button type="button" className="ghost-btn" onClick={() => setNewChat((p) => ({ ...p, qrMode: null, messageText: "" }))}>← Change</button>
                          <label className="new-chat-compose-label">Type your first message</label>
                        </div>
                        <textarea
                          className="chat-compose-textarea"
                          rows={4}
                          maxLength={4000}
                          autoFocus
                          placeholder="Type the first message to send..."
                          value={newChat.messageText}
                          onChange={(e) => setNewChat((p) => ({ ...p, messageText: e.target.value }))}
                        />
                        <p className="new-chat-hint">Sent to {newChat.contact.phone_number} via WA QR.</p>
                      </>
                    )}

                    {/* Flow: pick a published flow */}
                    {newChat.qrMode === "flow" && (
                      <>
                        <div className="new-chat-mode-back">
                          <button type="button" className="ghost-btn" onClick={() => setNewChat((p) => ({ ...p, qrMode: null, qrFlowId: null }))}>← Change</button>
                          <label className="new-chat-compose-label">Select a flow</label>
                        </div>
                        {publishedFlowsQuery.isLoading ? (
                          <p className="empty-note" style={{ padding: "8px 0" }}>Loading flows…</p>
                        ) : publishedFlows.length === 0 ? (
                          <p className="empty-note" style={{ padding: "8px 0" }}>No published flows found.</p>
                        ) : (
                          <div className="new-chat-template-list">
                            {publishedFlows.map((flow) => (
                              <button
                                key={flow.id}
                                type="button"
                                className={`compose-template-item${newChat.qrFlowId === flow.id ? " active" : ""}`}
                                onClick={() => setNewChat((p) => ({ ...p, qrFlowId: flow.id }))}
                              >
                                <strong>{flow.name}</strong>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* AI mode: confirmation */}
                    {newChat.qrMode === "ai" && (
                      <>
                        <div className="new-chat-mode-back">
                          <button type="button" className="ghost-btn" onClick={() => setNewChat((p) => ({ ...p, qrMode: null }))}>← Change</button>
                        </div>
                        <div className="new-chat-ai-confirm">
                          <span className="new-chat-qr-mode-icon">🤖</span>
                          <p>The conversation will open and the AI agent will reply automatically when the contact messages.</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* API: template picker */}
                {newChat.channelType === "api" && (
                  <div className="new-chat-template-wrap">
                    <div style={{ marginBottom: "12px" }}>
                      <MetaConnectionSelector
                        connections={apiConnections}
                        value={newChat.connectionId}
                        onChange={(connectionId) => setNewChat((prev) => ({ ...prev, connectionId, template: null, templateVars: null }))}
                        label="WhatsApp API connection"
                        required
                        allowEmpty
                        emptyLabel="Select a connection"
                      />
                    </div>
                    {selectedNewChatConnection && !selectedNewChatConnectionActive ? (
                      <p className="empty-note" style={{ padding: "8px 0" }}>
                        This connection is {getConnectionActiveLabel(selectedNewChatConnection).toLowerCase()}. Reconnect or resume it before sending.
                      </p>
                    ) : null}
                    <label className="new-chat-compose-label">Select an approved template</label>
                    {!newChat.connectionId ? (
                      <p className="empty-note" style={{ padding: "8px 0" }}>Select a connection to load its approved templates.</p>
                    ) : templatesQuery.isLoading ? (
                      <p className="empty-note" style={{ padding: "8px 0" }}>Loading templates…</p>
                    ) : newChatAvailableTemplates.length === 0 ? (
                      <p className="empty-note" style={{ padding: "8px 0" }}>No approved templates found.</p>
                    ) : (
                      <div className="new-chat-template-list">
                        {newChatAvailableTemplates.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={`compose-template-item${newChat.template?.id === t.id ? " active" : ""}`}
                            onClick={() => handleNewChatSelectTemplate(t)}
                          >
                            <strong>{t.name} <span style={{ color: t.category === "MARKETING" ? "#b45309" : "#0f766e", fontWeight: 700 }}>{t.category}</span></strong>
                            <span>{getTemplateBodyText(t).slice(0, 80)}{getTemplateBodyText(t).length > 80 ? "…" : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Template variable fill */}
                    {newChat.templateVars && (
                      <div className="new-chat-template-vars">
                        {newChat.templateVars.fields.map((field) => (
                          <label key={field.key} className="tmpl-dialog-field">
                            <span>{field.label}</span>
                            {field.kind === "text" ? (
                              <input
                                type="text"
                                placeholder={field.placeholder}
                                value={newChat.templateVars?.values[field.key] ?? ""}
                                onChange={(e) => setNewChat((p) => p.templateVars ? { ...p, templateVars: { ...p.templateVars, values: { ...p.templateVars.values, [field.key]: e.target.value } } } : p)}
                              />
                            ) : (
                              <div className={`tmpl-dialog-upload${newChat.templateVars?.values[field.key] ? " uploaded" : ""}`}>
                                <div className="tmpl-dialog-upload-main">
                                  <div>
                                    <strong>{TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].label} header</strong>
                                    <p className="tmpl-dialog-media-hint">Optional — leaves empty to use template&apos;s approved sample media.</p>
                                  </div>
                                  <label className="tmpl-dialog-upload-btn">
                                    <input
                                      type="file"
                                      accept={TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].accept}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        void handleNewChatFieldFileSelect(field, file);
                                        e.target.value = "";
                                      }}
                                    />
                                    {newChatUploadingFieldKey === field.key ? "Uploading..." : newChat.templateVars?.uploads[field.key] ? "Replace file" : `Upload ${TEMPLATE_MEDIA_INPUT_CONFIG[field.mediaType].label.toLowerCase()}`}
                                  </label>
                                </div>
                                {newChat.templateVars?.uploads[field.key] && (
                                  <div className="tmpl-dialog-upload-meta">
                                    {newChat.templateVars.uploads[field.key]?.previewUrl ? (
                                      <img
                                        src={newChat.templateVars.uploads[field.key]?.previewUrl ?? ""}
                                        alt={newChat.templateVars.uploads[field.key]?.fileName}
                                        className="tmpl-dialog-upload-preview"
                                      />
                                    ) : (
                                      <div className="tmpl-dialog-upload-file">{newChat.templateVars.uploads[field.key]?.fileName}</div>
                                    )}
                                    <div className="tmpl-dialog-upload-caption">
                                      Ready to send: {newChat.templateVars.uploads[field.key]?.fileName}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="tmpl-dialog-actions">
                  {newChatMutation.isError && (
                    <div className="tmpl-dialog-error">{(newChatMutation.error as Error).message}</div>
                  )}
                  <button type="button" className="ghost-btn" onClick={() => setNewChat((p) => ({ ...p, step: "contact", qrMode: null, qrFlowId: null, messageText: "" }))}>Back</button>
                  <button
                    type="button"
                    className="compose-send-btn"
                    disabled={
                      newChatMutation.isPending ||
                      (newChat.channelType === "qr" && !newChat.qrMode) ||
                      (newChat.channelType === "qr" && newChat.qrMode === "manual" && !newChat.messageText.trim()) ||
                      (newChat.channelType === "qr" && newChat.qrMode === "flow" && !newChat.qrFlowId) ||
                      (newChat.channelType === "api" && (!newChat.connectionId || !selectedNewChatConnectionActive || !newChat.templateVars || (newChat.templateVars.fields.length > 0 && !newChat.templateVars.fields.every((f) => f.kind === "media" || Boolean(newChat.templateVars?.values[f.key]?.trim())))))
                    }
                    onClick={() => newChatMutation.mutate()}
                  >
                    {newChatMutation.isPending ? "Starting…" : "Start Chat"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {msgInfoTarget && (
        <div className="tmpl-dialog-overlay" onClick={() => setMsgInfoTarget(null)}>
          <div className="tmpl-dialog msg-info-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="tmpl-dialog-head">
              <span>Message Info</span>
              <button type="button" className="tmpl-dialog-close" onClick={() => setMsgInfoTarget(null)}>✕</button>
            </div>
            <div className="tmpl-dialog-body" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                <tbody>
                  <tr>
                    <td style={{ color: "#5f6f86", paddingBottom: "0.5rem", width: 140 }}>Message Source</td>
                    <td style={{ fontWeight: 500, paddingBottom: "0.5rem" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 4,
                        background: msgInfoTarget.source_type === "broadcast" ? "#dbeafe" : msgInfoTarget.source_type === "sequence" ? "#fef3c7" : msgInfoTarget.source_type === "bot" ? "#d1fae5" : "#f1f5f9",
                        color: msgInfoTarget.source_type === "broadcast" ? "#1d4ed8" : msgInfoTarget.source_type === "sequence" ? "#b45309" : msgInfoTarget.source_type === "bot" ? "#065f46" : "#475569",
                        textTransform: "capitalize"
                      }}>
                        {msgInfoTarget.source_type ?? "manual"}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ color: "#5f6f86", paddingBottom: "0.5rem" }}>Message Status</td>
                    <td style={{ fontWeight: 500, paddingBottom: "0.5rem" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 4,
                        background: msgInfoTarget.delivery_status === "read" ? "#d1fae5" : msgInfoTarget.delivery_status === "delivered" ? "#dbeafe" : msgInfoTarget.delivery_status === "failed" ? "#fee2e2" : "#f1f5f9",
                        color: msgInfoTarget.delivery_status === "read" ? "#065f46" : msgInfoTarget.delivery_status === "delivered" ? "#1d4ed8" : msgInfoTarget.delivery_status === "failed" ? "#b91c1c" : "#475569",
                        textTransform: "capitalize"
                      }}>
                        {msgInfoTarget.delivery_status ?? "sent"}
                      </span>
                    </td>
                  </tr>
                  {msgInfoTarget.sent_at && (
                    <tr>
                      <td style={{ color: "#5f6f86", paddingBottom: "0.5rem" }}>Send Time</td>
                      <td style={{ paddingBottom: "0.5rem" }}>{formatDateTime(msgInfoTarget.sent_at)}</td>
                    </tr>
                  )}
                  {msgInfoTarget.delivered_at && (
                    <tr>
                      <td style={{ color: "#5f6f86", paddingBottom: "0.5rem" }}>Delivered Time</td>
                      <td style={{ paddingBottom: "0.5rem" }}>{formatDateTime(msgInfoTarget.delivered_at)}</td>
                    </tr>
                  )}
                  {msgInfoTarget.read_at && (
                    <tr>
                      <td style={{ color: "#5f6f86", paddingBottom: "0.5rem" }}>Read Time</td>
                      <td style={{ paddingBottom: "0.5rem" }}>{formatDateTime(msgInfoTarget.read_at)}</td>
                    </tr>
                  )}
                  {msgInfoTarget.sender_name && (
                    <tr>
                      <td style={{ color: "#5f6f86", paddingBottom: "0.5rem" }}>Sent By</td>
                      <td style={{ paddingBottom: "0.5rem" }}>{msgInfoTarget.sender_name}</td>
                    </tr>
                  )}
                  {msgInfoTarget.wamid && (
                    <tr>
                      <td style={{ color: "#5f6f86", paddingBottom: "0.5rem" }}>Message ID</td>
                      <td style={{ paddingBottom: "0.5rem", fontSize: "0.75rem", wordBreak: "break-all", color: "#94a3b8" }}>{msgInfoTarget.wamid}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {msgInfoTarget.delivery_status === "failed" && msgInfoTarget.error_code && (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 6, padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <div style={{ fontWeight: 600, color: "#b91c1c", fontSize: "0.85rem" }}>
                    &#9888; Meta Error {msgInfoTarget.error_code}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#374151" }}>{msgInfoTarget.error_message}</div>
                  {META_ERROR_SOLUTIONS[msgInfoTarget.error_code] && (
                    <div style={{ marginTop: "0.3rem", fontSize: "0.82rem", color: "#1d4ed8" }}>
                      <strong>How to fix:</strong> {META_ERROR_SOLUTIONS[msgInfoTarget.error_code]}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchInfiniteQuery(buildInboxConversationsInfiniteQueryOptions(token, { folder: "all", search: "" }));
}
