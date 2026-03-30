import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Conversation, ConversationMessage } from "../../../lib/api";
import type { DashboardModulePrefetchContext } from "../../../shared/dashboard/module-contracts";
import { useDashboardShell } from "../../../shared/dashboard/shell-context";
import { DashboardIcon } from "../../../shared/dashboard/icons";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";
import {
  assignInboxFlow,
  sendManualConversationMessage,
  updateConversationAiMode
} from "./api";
import {
  buildInboxConversationsQueryOptions,
  useInboxConversationsQuery,
  useInboxMessagesQuery,
  useInboxPublishedFlowsQuery
} from "./queries";

type LeadStageFilter = "all" | "hot" | "warm" | "cold";
type ChannelFilter = "all" | "web" | "qr" | "api";
type ScoreFilter = "all" | "hot" | "warm" | "cold";
type AssignmentFilter = "all" | "me" | "team" | "unassigned";
type DateRangeFilter = "all" | "today" | "7d" | "30d";
type AiModeFilter = "all" | "live" | "human";
type LeadKindFilter = "all" | "lead" | "feedback" | "complaint" | "other";
type ChatFolderFilter = "all" | "unassigned" | "mine" | "bot";

type ChatAiTimedAction = {
  switchToPaused: boolean;
  executeAt: number;
};

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

function getOptionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function normalizeStage(stage: string | null | undefined): "hot" | "warm" | "cold" {
  if (stage === "hot" || stage === "warm" || stage === "cold") {
    return stage;
  }
  return "cold";
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Not available";
  }
  return new Date(timestamp).toLocaleString();
}

function formatRelativeTime(value: string | null | undefined, now: number): string {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  const diffMs = timestamp - now;
  const diffMinutes = Math.round(diffMs / 60_000);
  if (Math.abs(diffMinutes) < 1) {
    return "Just now";
  }
  if (Math.abs(diffMinutes) < 60) {
    return `${Math.abs(diffMinutes)}m ${diffMinutes < 0 ? "ago" : "from now"}`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return `${Math.abs(diffHours)}h ${diffHours < 0 ? "ago" : "from now"}`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${Math.abs(diffDays)}d ${diffDays < 0 ? "ago" : "from now"}`;
}

function getConversationDisplayName(conversation: Conversation): string {
  return conversation.contact_name || formatPhone(conversation.contact_phone || conversation.phone_number);
}

function getConversationChannelBadge(channelType: Conversation["channel_type"]) {
  if (channelType === "api") {
    return "WA API";
  }
  if (channelType === "qr") {
    return "WA QR";
  }
  return "Web";
}

function getConversationChannelLabel(channelType: Conversation["channel_type"]) {
  if (channelType === "api") {
    return "WhatsApp Business API";
  }
  if (channelType === "qr") {
    return "WhatsApp QR";
  }
  return "Website Chat";
}

function getLeadKindLabel(kind: Conversation["lead_kind"]) {
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
}

function getLeadScoreBand(conversation: Conversation): "hot" | "warm" | "cold" {
  if (conversation.score >= 80) {
    return "hot";
  }
  if (conversation.score >= 55) {
    return "warm";
  }
  return "cold";
}

function getLeadScoreLabel(conversation: Conversation): string {
  return `${conversation.score}/100`;
}

function matchesStageFilter(conversation: Conversation, filter: LeadStageFilter): boolean {
  if (filter === "all") {
    return true;
  }
  return normalizeStage(conversation.stage) === filter;
}

function matchesChannelFilter(conversation: Conversation, filter: ChannelFilter): boolean {
  if (filter === "all") {
    return true;
  }
  return conversation.channel_type === filter;
}

function matchesScoreFilter(conversation: Conversation, filter: ScoreFilter): boolean {
  if (filter === "all") {
    return true;
  }
  return getLeadScoreBand(conversation) === filter;
}

function matchesAssignmentFilter(
  conversation: Conversation,
  filter: AssignmentFilter,
  currentUserName: string
): boolean {
  const assignedName = conversation.assigned_agent_name?.trim().toLowerCase() ?? "";
  const hasAssignment = Boolean(conversation.assigned_agent_profile_id || assignedName);

  if (filter === "all") {
    return true;
  }
  if (filter === "unassigned") {
    return !hasAssignment;
  }
  if (filter === "me") {
    if (!currentUserName) {
      return conversation.manual_takeover;
    }
    return assignedName === currentUserName;
  }
  if (!currentUserName) {
    return hasAssignment;
  }
  return hasAssignment && assignedName !== currentUserName;
}

function matchesDateRangeFilter(conversation: Conversation, filter: DateRangeFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (!conversation.last_message_at) {
    return false;
  }
  const timestamp = Date.parse(conversation.last_message_at);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const diffMs = Date.now() - timestamp;
  if (filter === "today") {
    const now = new Date();
    const sample = new Date(timestamp);
    return (
      now.getFullYear() === sample.getFullYear() &&
      now.getMonth() === sample.getMonth() &&
      now.getDate() === sample.getDate()
    );
  }
  if (filter === "7d") {
    return diffMs <= 7 * 24 * 60 * 60 * 1000;
  }
  return diffMs <= 30 * 24 * 60 * 60 * 1000;
}

function matchesAiModeFilter(conversation: Conversation, filter: AiModeFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "live") {
    return !conversation.ai_paused && !conversation.manual_takeover;
  }
  return conversation.ai_paused || conversation.manual_takeover;
}

function matchesLeadKindFilter(conversation: Conversation, filter: LeadKindFilter): boolean {
  if (filter === "all") {
    return true;
  }
  return conversation.lead_kind === filter;
}

function sortConversationsByRecent(rows: Conversation[]): Conversation[] {
  return [...rows].sort((a, b) => {
    const left = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const right = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return right - left;
  });
}

function getLeadIntentLabel(conversation: Conversation | null): string {
  if (!conversation) {
    return "General enquiry";
  }
  const message = conversation.last_message?.toLowerCase() ?? "";
  if (conversation.lead_kind === "complaint") {
    return "Issue resolution";
  }
  if (conversation.lead_kind === "feedback") {
    return "Product feedback";
  }
  if (message.includes("price") || message.includes("pricing") || message.includes("cost")) {
    return "Pricing enquiry";
  }
  if (message.includes("menu")) {
    return "Menu request";
  }
  if (message.includes("demo") || message.includes("book") || message.includes("call")) {
    return "Booking / callback";
  }
  if (message.includes("apply") || message.includes("application")) {
    return "Application follow-up";
  }
  return "General enquiry";
}

function getLeadSuggestedAction(conversation: Conversation | null): string {
  if (!conversation) {
    return "Share the core info, collect missing details, and keep AI qualifying.";
  }
  if (conversation.lead_kind === "complaint") {
    return "Route to a human agent and confirm the resolution path quickly.";
  }
  if (conversation.ai_paused || conversation.manual_takeover) {
    return "Keep the conversation personal and close the next action with a human reply.";
  }
  if (normalizeStage(conversation.stage) === "hot") {
    return "Reply fast with pricing, proof, and a clear conversion CTA.";
  }
  if (normalizeStage(conversation.stage) === "warm") {
    return "Qualify the requirement, budget, and preferred timeline.";
  }
  return "Share the core info, collect missing details, and keep AI qualifying.";
}

function getNextFollowUpLabel(conversation: Conversation): string {
  if (conversation.lead_kind === "complaint") {
    return "Within 15 minutes";
  }
  if (normalizeStage(conversation.stage) === "hot") {
    return "Within 30 minutes";
  }
  if (normalizeStage(conversation.stage) === "warm") {
    return "Today";
  }
  return "Within 24 hours";
}

function getReplySuggestions(conversation: Conversation): string[] {
  if (conversation.lead_kind === "complaint") {
    return [
      "I'm sorry about the trouble. I'm checking this for you right now.",
      "Thanks for flagging this. Let me fix it and share the next update shortly.",
      "I understand the concern. Can you share one more detail so I can resolve it quickly?"
    ];
  }
  if (normalizeStage(conversation.stage) === "hot") {
    return [
      "Happy to help. I can share pricing and the next step right away.",
      "Thanks for reaching out. Would you like the full details or a quick callback?",
      "I can help with that now. Tell me your preferred option and I'll guide you."
    ];
  }
  if (conversation.channel_type === "web") {
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

function getConversationTags(conversation: Conversation): string[] {
  const tags = [
    normalizeStage(conversation.stage) === "hot"
      ? "High intent"
      : normalizeStage(conversation.stage) === "warm"
        ? "Needs follow-up"
        : "Early stage",
    getConversationChannelBadge(conversation.channel_type),
    getLeadKindLabel(conversation.lead_kind),
    conversation.ai_paused || conversation.manual_takeover ? "Human handling" : "AI live"
  ];
  if (conversation.assigned_agent_name) {
    tags.push(`Owner: ${conversation.assigned_agent_name}`);
  }
  return tags;
}

function buildTimeline(
  conversation: Conversation,
  messages: ConversationMessage[]
): Array<{ label: string; detail: string; at: string | null }> {
  const inbound = messages.filter((message) => message.direction === "inbound");
  const outbound = messages.filter((message) => message.direction === "outbound");
  const lastInbound = inbound.at(-1) ?? null;
  const lastOutbound = outbound.at(-1) ?? null;

  return [
    {
      label: "Conversation opened",
      detail: `${getConversationChannelLabel(conversation.channel_type)} conversation created`,
      at: inbound[0]?.created_at ?? lastOutbound?.created_at ?? conversation.last_message_at
    },
    {
      label: "Latest customer message",
      detail: lastInbound?.message_text || conversation.last_message || "No inbound message recorded yet.",
      at: lastInbound?.created_at ?? conversation.last_message_at
    },
    {
      label: "Latest reply",
      detail: lastOutbound?.sender_name || (conversation.ai_paused ? "Human agent response" : "AI response"),
      at: lastOutbound?.created_at ?? null
    },
    {
      label: "Current handling mode",
      detail: conversation.ai_paused || conversation.manual_takeover ? "Human-led conversation" : "AI is actively replying",
      at: conversation.last_message_at
    }
  ];
}

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const { token, bootstrap, loading } = useDashboardShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false);
  const [isDesktopFilterPanelOpen, setIsDesktopFilterPanelOpen] = useState(true);
  const [isDesktopLeadPanelOpen, setIsDesktopLeadPanelOpen] = useState(true);
  const [chatAiMenuOpen, setChatAiMenuOpen] = useState(false);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [chatAiTimers, setChatAiTimers] = useState<Record<string, ChatAiTimedAction>>({});
  const [manualComposeConversationId, setManualComposeConversationId] = useState<string | null>(null);
  const [agentReplyText, setAgentReplyText] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const chatAiMenuRef = useRef<HTMLDivElement | null>(null);

  const legacyFolder = (searchParams.get("folder") as ChatFolderFilter | null) ?? null;
  const stageFilter = (searchParams.get("stage") as LeadStageFilter | null) ?? "all";
  const channelFilter = (searchParams.get("channel") as ChannelFilter | null) ?? "all";
  const scoreFilter = (searchParams.get("score") as ScoreFilter | null) ?? "all";
  const assignmentFilter =
    (searchParams.get("assignment") as AssignmentFilter | null) ??
    (legacyFolder === "unassigned" ? "unassigned" : legacyFolder === "mine" ? "me" : "all");
  const dateRangeFilter = (searchParams.get("range") as DateRangeFilter | null) ?? "all";
  const aiModeFilter =
    (searchParams.get("ai") as AiModeFilter | null) ?? (legacyFolder === "bot" ? "live" : "all");
  const leadKindFilter = (searchParams.get("kind") as LeadKindFilter | null) ?? "all";
  const search = searchParams.get("q") ?? "";
  const selectedConversationId = params.conversationId ?? null;
  const searchParamString = searchParams.toString();
  const currentUserName = bootstrap?.userSummary.name.trim().toLowerCase() ?? "";

  const conversationsQuery = useInboxConversationsQuery(token, { folder: "all", search });
  const messagesQuery = useInboxMessagesQuery(token, selectedConversationId);
  const publishedFlowsQuery = useInboxPublishedFlowsQuery(token);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobileViewport(window.innerWidth <= 1100);
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1100px)");
    const syncViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };
    syncViewport();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => {
        mediaQuery.removeEventListener("change", syncViewport);
      };
    }

    mediaQuery.addListener(syncViewport);
    return () => {
      mediaQuery.removeListener(syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileConversationOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!chatAiMenuOpen && !flowMenuOpen) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      if (chatAiMenuRef.current && event.target instanceof Node && !chatAiMenuRef.current.contains(event.target)) {
        setChatAiMenuOpen(false);
        setFlowMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setChatAiMenuOpen(false);
        setFlowMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatAiMenuOpen, flowMenuOpen]);

  useEffect(() => {
    setChatAiMenuOpen(false);
    setFlowMenuOpen(false);
    setAgentReplyText("");
    setManualComposeConversationId(null);
  }, [selectedConversationId]);

  const allConversations = useMemo(() => sortConversationsByRecent(conversationsQuery.data ?? []), [conversationsQuery.data]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allConversations.filter((conversation) => {
      if (!matchesStageFilter(conversation, stageFilter)) {
        return false;
      }
      if (!matchesChannelFilter(conversation, channelFilter)) {
        return false;
      }
      if (!matchesScoreFilter(conversation, scoreFilter)) {
        return false;
      }
      if (!matchesAssignmentFilter(conversation, assignmentFilter, currentUserName)) {
        return false;
      }
      if (!matchesDateRangeFilter(conversation, dateRangeFilter)) {
        return false;
      }
      if (!matchesAiModeFilter(conversation, aiModeFilter)) {
        return false;
      }
      if (!matchesLeadKindFilter(conversation, leadKindFilter)) {
        return false;
      }
      if (!query) {
        return true;
      }

      const haystack =
        `${conversation.contact_name ?? ""} ${
          formatPhone(conversation.contact_phone || conversation.phone_number)
        } ${conversation.contact_email ?? ""} ${conversation.last_message ?? ""} ${
          conversation.assigned_agent_name ?? ""
        } ${getConversationChannelBadge(conversation.channel_type)} ${getLeadKindLabel(conversation.lead_kind)}`.toLowerCase();

      return haystack.includes(query);
    });
  }, [
    aiModeFilter,
    allConversations,
    assignmentFilter,
    channelFilter,
    currentUserName,
    dateRangeFilter,
    leadKindFilter,
    scoreFilter,
    search,
    stageFilter
  ]);

  const selectedConversation = useMemo(
    () => filteredConversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [filteredConversations, selectedConversationId]
  );

  useEffect(() => {
    if (filteredConversations.length === 0) {
      if (selectedConversationId) {
        navigate(
          {
            pathname: "/dashboard/inbox",
            search: searchParamString ? `?${searchParamString}` : ""
          },
          { replace: true }
        );
      }
      return;
    }

    if (!selectedConversation) {
      navigate(
        {
          pathname: `/dashboard/inbox/${filteredConversations[0].id}`,
          search: searchParamString ? `?${searchParamString}` : ""
        },
        { replace: true }
      );
    }
  }, [filteredConversations, navigate, searchParamString, selectedConversation, selectedConversationId]);

  const toggleMutation = useMutation({
    mutationFn: async ({
      conversationId,
      paused,
      durationMinutes
    }: {
      conversationId: string;
      paused: boolean;
      durationMinutes: number | null;
    }) => {
      await updateConversationAiMode(token, conversationId, paused);
      setChatAiTimers((current) => {
        const next = { ...current };
        delete next[conversationId];
        if (durationMinutes !== null) {
          next[conversationId] = {
            switchToPaused: !paused,
            executeAt: Date.now() + durationMinutes * 60_000
          };
        }
        return next;
      });
      return { paused, durationMinutes };
    },
    onSuccess: async ({ paused, durationMinutes }) => {
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
      setInfo(
        paused
          ? durationMinutes === null
            ? "AI turned off for this chat."
            : `AI turned off for ${durationMinutes} minutes.`
          : durationMinutes === null
            ? "AI turned on for this chat."
            : `AI turned on for ${durationMinutes} minutes.`
      );
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const assignFlowMutation = useMutation({
    mutationFn: async ({ conversationId, flowId, flowName }: { conversationId: string; flowId: string; flowName: string }) => {
      await assignInboxFlow(token, conversationId, flowId);
      return { flowName };
    },
    onSuccess: async ({ flowName }) => {
      setFlowMenuOpen(false);
      setChatAiMenuOpen(false);
      setManualComposeConversationId(null);
      setAgentReplyText("");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
      if (selectedConversationId) {
        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(selectedConversationId) });
      }
      setInfo(`Assigned flow "${flowName}".`);
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!selectedConversationId) {
        throw new Error("No conversation selected.");
      }
      await sendManualConversationMessage(token, selectedConversationId, text);
    },
    onSuccess: async () => {
      setAgentReplyText("");
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxRoot });
      if (selectedConversationId) {
        await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.inboxMessages(selectedConversationId) });
      }
    },
    onError: (mutationError) => setError((mutationError as Error).message)
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClockTick(now);
      for (const [conversationId, schedule] of Object.entries(chatAiTimers)) {
        if (schedule.executeAt > now || toggleMutation.isPending) {
          continue;
        }
        toggleMutation.mutate({
          conversationId,
          paused: schedule.switchToPaused,
          durationMinutes: null
        });
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [chatAiTimers, toggleMutation]);

  const publishedFlows = publishedFlowsQuery.data ?? [];
  const selectedConversationMessages = messagesQuery.data ?? [];
  const selectedConversationLabel = selectedConversation ? getConversationDisplayName(selectedConversation) : "Select a conversation";
  const selectedConversationStage = selectedConversation ? normalizeStage(selectedConversation.stage) : "cold";
  const selectedConversationAiTimer = selectedConversation ? chatAiTimers[selectedConversation.id] ?? null : null;
  const selectedConversationAiTimerLabel = selectedConversationAiTimer
    ? (() => {
        const remainingMs = Math.max(0, selectedConversationAiTimer.executeAt - clockTick);
        const totalMinutes = Math.ceil(remainingMs / 60_000);
        if (totalMinutes >= 60) {
          return `${Math.ceil(totalMinutes / 60)}h`;
        }
        return `${Math.max(1, totalMinutes)}m`;
      })()
    : null;

  const replySuggestions = useMemo(
    () => (selectedConversation ? getReplySuggestions(selectedConversation) : []),
    [selectedConversation]
  );

  const conversationTags = useMemo(
    () => (selectedConversation ? getConversationTags(selectedConversation) : []),
    [selectedConversation]
  );

  const timelineItems = useMemo(
    () => (selectedConversation ? buildTimeline(selectedConversation, selectedConversationMessages) : []),
    [selectedConversation, selectedConversationMessages]
  );

  const inboxStats = useMemo(
    () => ({
      total: allConversations.length,
      hot: allConversations.filter((conversation) => normalizeStage(conversation.stage) === "hot").length,
      human: allConversations.filter((conversation) => conversation.ai_paused || conversation.manual_takeover).length,
      unassigned: allConversations.filter(
        (conversation) => !conversation.assigned_agent_profile_id && !conversation.assigned_agent_name
      ).length
    }),
    [allConversations]
  );

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (stageFilter !== "all") {
      chips.push(`Status: ${getOptionLabel(LEAD_STAGE_OPTIONS, stageFilter)}`);
    }
    if (channelFilter !== "all") {
      chips.push(`Source: ${getOptionLabel(CHANNEL_OPTIONS, channelFilter)}`);
    }
    if (scoreFilter !== "all") {
      chips.push(`AI score: ${getOptionLabel(SCORE_OPTIONS, scoreFilter)}`);
    }
    if (leadKindFilter !== "all") {
      chips.push(`Type: ${getOptionLabel(LEAD_KIND_OPTIONS, leadKindFilter)}`);
    }
    if (assignmentFilter !== "all") {
      chips.push(`Assigned: ${getOptionLabel(ASSIGNMENT_OPTIONS, assignmentFilter)}`);
    }
    if (aiModeFilter !== "all") {
      chips.push(`AI status: ${getOptionLabel(AI_MODE_OPTIONS, aiModeFilter)}`);
    }
    if (dateRangeFilter !== "all") {
      chips.push(`Date: ${getOptionLabel(DATE_RANGE_OPTIONS, dateRangeFilter)}`);
    }
    if (search.trim()) {
      chips.push(`Search: "${search.trim()}"`);
    }
    return chips;
  }, [
    aiModeFilter,
    assignmentFilter,
    channelFilter,
    dateRangeFilter,
    leadKindFilter,
    scoreFilter,
    search,
    stageFilter
  ]);

  const activeFilterCount = activeFilterChips.length;
  const showManualComposer = Boolean(
    selectedConversation &&
      (selectedConversation.ai_paused ||
        selectedConversation.manual_takeover ||
        manualComposeConversationId === selectedConversation.id)
  );

  const updateSearchParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("folder");
    if (!value || value === "all") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const openConversation = (conversationId: string) => {
    navigate({
      pathname: `/dashboard/inbox/${conversationId}`,
      search: searchParamString ? `?${searchParamString}` : ""
    });
    if (isMobileViewport) {
      setIsMobileConversationOpen(true);
    }
  };

  const hasConfiguredAgentProfile = Boolean(bootstrap?.agentSummary.hasConfiguredProfile);
  const websiteChannelEnabled = Boolean(bootstrap?.channelSummary.website.enabled);
  const qrChannelStatus = bootstrap?.channelSummary.whatsapp.status ?? "disconnected";
  const apiChannelConnected = Boolean(bootstrap?.channelSummary.metaApi.connected);
  const isAnyChannelConnected = Boolean(bootstrap?.channelSummary.anyConnected);
  const isInboxStatusLoading = loading && !bootstrap;
  const waitingStateDescription = hasConfiguredAgentProfile
    ? "No live channel is connected yet. Conversations will appear here as soon as your agent comes online."
    : "No agent found yet. Create or activate an agent workflow, then connect a channel to start receiving chats.";
  const waitingStatusItems = [
    {
      label: hasConfiguredAgentProfile ? "Agent ready" : "No agent configured",
      tone: hasConfiguredAgentProfile ? "connected" : "not_connected"
    },
    {
      label: websiteChannelEnabled ? "Website connected" : "Website offline",
      tone: websiteChannelEnabled ? "connected" : "not_connected"
    },
    {
      label:
        qrChannelStatus === "connected"
          ? "WhatsApp QR connected"
          : qrChannelStatus === "waiting_scan"
            ? "WhatsApp QR waiting for scan"
            : qrChannelStatus === "connecting"
              ? "WhatsApp QR connecting"
              : "WhatsApp QR offline",
      tone:
        qrChannelStatus === "connected"
          ? "connected"
          : qrChannelStatus === "waiting_scan"
            ? "waiting_scan"
            : qrChannelStatus === "connecting"
              ? "connecting"
              : "not_connected"
    },
    {
      label: apiChannelConnected ? "WhatsApp API connected" : "WhatsApp API offline",
      tone: apiChannelConnected ? "connected" : "not_connected"
    }
  ];
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
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="clone-chat-wrap">
      {(info || error) && (
        <div className="dashboard-toast-stack" aria-live="polite" aria-atomic="true">
          {info ? (
            <div className="dashboard-toast dashboard-toast-success" role="status">
              <p>{info}</p>
              <button type="button" className="dashboard-toast-close" onClick={() => setInfo(null)}>
                x
              </button>
            </div>
          ) : null}
          {error ? (
            <div className="dashboard-toast dashboard-toast-error" role="alert">
              <p>{error}</p>
              <button type="button" className="dashboard-toast-close" onClick={() => setError(null)}>
                x
              </button>
            </div>
          ) : null}
        </div>
      )}

      {isInboxStatusLoading ? (
        <section className="clone-chat-setup clone-chat-waiting">
          <h2>Checking inbox status</h2>
          <p>Looking for a connected agent and active channel.</p>
        </section>
      ) : !isAnyChannelConnected ? (
        <section className="clone-chat-setup">
          <h2>Waiting for agent to connect</h2>
          <p>{waitingStateDescription}</p>
          <article className="clone-setup-panel inbox-waiting-panel">
            <div className="clone-setup-head">
              <span className="clone-setup-icon">
                <DashboardIcon name="agents" />
              </span>
              <div>
                <h3>{hasConfiguredAgentProfile ? "Inbox is standing by" : "Agent setup required"}</h3>
                <p>
                  {hasConfiguredAgentProfile
                    ? "Your workflow is ready. As soon as one channel connects, new chats will start showing here."
                    : "There is no active workflow attached to this workspace yet."}
                </p>
              </div>
            </div>
            <div className="inbox-waiting-status">
              {waitingStatusItems.map((item) => (
                <span key={item.label} className={`status-badge status-${item.tone}`}>
                  {item.label}
                </span>
              ))}
            </div>
            <div className="clone-hero-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => navigate(hasConfiguredAgentProfile ? "/dashboard/settings/api" : "/dashboard/agents")}
              >
                {hasConfiguredAgentProfile ? "Open channel settings" : "Open AI Agents"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => navigate(hasConfiguredAgentProfile ? "/dashboard/agents" : "/dashboard/settings/api")}
              >
                {hasConfiguredAgentProfile ? "Open AI Agents" : "Open channel settings"}
              </button>
            </div>
          </article>
        </section>
      ) : (
        <section className={workbenchClassName}>
          {showConversationListPane ? (
            <>
              {showFilterPane ? (
                <aside className="inbox-filter-panel">
                  <div className="inbox-panel-head">
                    <div>
                      <h3>Lead Filters</h3>
                      <p>Lead intelligence filters that update the inbox instantly.</p>
                    </div>
                    {activeFilterCount > 0 ? (
                      <button type="button" className="ghost-btn" onClick={clearFilters}>
                        Clear
                      </button>
                    ) : null}
                  </div>

                  <section className={activeFilterCount > 0 ? "inbox-active-filter-summary is-active" : "inbox-active-filter-summary"}>
                    <div className="inbox-active-filter-copy">
                      <strong>
                        {activeFilterCount > 0
                          ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
                          : "No lead filter applied"}
                      </strong>
                      <span>
                        {activeFilterCount > 0
                          ? "These filters are controlling the chat list right now."
                          : "All conversations are visible until you apply a filter below."}
                      </span>
                    </div>
                    {activeFilterChips.length > 0 ? (
                      <div className="inbox-active-filter-chips">
                        {activeFilterChips.map((chip) => (
                          <span key={chip} className="inbox-active-filter-chip">
                            {chip}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </section>

                  <div className="inbox-stat-grid">
                    <article className="inbox-stat-card">
                      <span>All chats</span>
                      <strong>{inboxStats.total}</strong>
                    </article>
                    <article className="inbox-stat-card hot">
                      <span>Hot leads</span>
                      <strong>{inboxStats.hot}</strong>
                    </article>
                    <article className="inbox-stat-card human">
                      <span>Human handling</span>
                      <strong>{inboxStats.human}</strong>
                    </article>
                    <article className="inbox-stat-card">
                      <span>Unassigned</span>
                      <strong>{inboxStats.unassigned}</strong>
                    </article>
                  </div>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>Status</strong>
                      <span>Lead stage</span>
                    </div>
                    <div className="inbox-choice-grid">
                      {LEAD_STAGE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={stageFilter === option.value ? "active" : ""}
                          onClick={() => updateSearchParam("stage", option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>Source</strong>
                      <span>Conversation channel</span>
                    </div>
                    <select
                      className="inbox-select"
                      value={channelFilter}
                      onChange={(event) => updateSearchParam("channel", event.target.value)}
                    >
                      {CHANNEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </section>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>AI Score</strong>
                      <span>Derived from lead score</span>
                    </div>
                    <div className="inbox-choice-grid">
                      {SCORE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={scoreFilter === option.value ? "active" : ""}
                          onClick={() => updateSearchParam("score", option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>Lead Type</strong>
                      <span>Intent classification</span>
                    </div>
                    <select
                      className="inbox-select"
                      value={leadKindFilter}
                      onChange={(event) => updateSearchParam("kind", event.target.value)}
                    >
                      {LEAD_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </section>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>Assigned</strong>
                      <span>Owner routing</span>
                    </div>
                    <select
                      className="inbox-select"
                      value={assignmentFilter}
                      onChange={(event) => updateSearchParam("assignment", event.target.value)}
                    >
                      {ASSIGNMENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </section>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>AI Status</strong>
                      <span>Automation mode</span>
                    </div>
                    <select
                      className="inbox-select"
                      value={aiModeFilter}
                      onChange={(event) => updateSearchParam("ai", event.target.value)}
                    >
                      {AI_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </section>

                  <section className="inbox-filter-group">
                    <div className="inbox-filter-group-head">
                      <strong>Date</strong>
                      <span>Latest message window</span>
                    </div>
                    <select
                      className="inbox-select"
                      value={dateRangeFilter}
                      onChange={(event) => updateSearchParam("range", event.target.value)}
                    >
                      {DATE_RANGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </section>
                </aside>
              ) : null}

              <aside className="clone-thread-list inbox-chat-list">
                <div className="clone-thread-toolbar inbox-list-toolbar">
                  <div className="inbox-list-heading">
                    <div className="inbox-list-heading-row">
                      {!isMobileViewport ? (
                        <button
                          type="button"
                          className="inbox-panel-toggle"
                          aria-label={showFilterPane ? "Hide filters panel" : "Show filters panel"}
                          title={showFilterPane ? "Hide filters panel" : "Show filters panel"}
                          onClick={() => setIsDesktopFilterPanelOpen((current) => !current)}
                        >
                          {showFilterPane ? "<" : ">"}
                        </button>
                      ) : null}
                      <h3>
                        Chat List <span>{filteredConversations.length}</span>
                      </h3>
                    </div>
                    <p>Search, scan, and pick the lead to work.</p>
                    {!showFilterPane && activeFilterCount > 0 ? (
                      <button type="button" className="ghost-btn" onClick={clearFilters}>
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                  <label className="clone-chat-search inbox-chat-search">
                    <input
                      value={search}
                      onChange={(event) => updateSearchParam("q", event.target.value)}
                      placeholder="Search name, phone, email..."
                    />
                  </label>
                </div>

                {conversationsQuery.isLoading ? (
                  <p className="empty-note inbox-empty-state">Loading conversations...</p>
                ) : filteredConversations.length === 0 ? (
                  <p className="empty-note inbox-empty-state">
                    {search.trim() || activeFilterCount > 0
                      ? "No conversations match the current lead filters."
                      : "No conversations yet. Send a new inbound message to start chat tracking."}
                  </p>
                ) : (
                  filteredConversations.map((conversation) => {
                    const label = getConversationDisplayName(conversation);
                    const stage = normalizeStage(conversation.stage);
                    const scoreBand = getLeadScoreBand(conversation);
                    const initials = label
                      .split(" ")
                      .map((part) => part[0] ?? "")
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        className={
                          conversation.id === selectedConversationId
                            ? `clone-thread-item inbox-thread-item stage-${stage} active`
                            : `clone-thread-item inbox-thread-item stage-${stage}`
                        }
                        onClick={() => openConversation(conversation.id)}
                      >
                        <span className="clone-thread-avatar">{initials || "U"}</span>
                        <div className="inbox-thread-body">
                          <header>
                            <div className="clone-thread-title">
                              <strong>{label}</strong>
                              <div className="inbox-thread-badges">
                                <span className={`clone-thread-stage ${stage}`}>{stage}</span>
                                <span className={`inbox-chip inbox-chip-score ${scoreBand}`}>{getLeadScoreLabel(conversation)}</span>
                              </div>
                            </div>
                            <small>{formatRelativeTime(conversation.last_message_at, clockTick)}</small>
                          </header>
                          <p>{conversation.last_message || "No messages yet"}</p>
                          <div className="inbox-thread-meta">
                            <span className="inbox-chip">{getConversationChannelBadge(conversation.channel_type)}</span>
                            <span className={conversation.ai_paused || conversation.manual_takeover ? "inbox-chip human" : "inbox-chip live"}>
                              {conversation.ai_paused || conversation.manual_takeover ? "Human" : "AI Live"}
                            </span>
                            <span className="inbox-thread-owner">{conversation.assigned_agent_name || "Unassigned"}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </aside>
            </>
          ) : null}

          {showConversationDetailPane ? (
            <>
              <section className="clone-chat-panel inbox-conversation-panel">
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
                          <span className="chat-channel-badge">
                            {getConversationChannelBadge(selectedConversation.channel_type)}
                          </span>
                          <span>{getLeadKindLabel(selectedConversation.lead_kind)}</span>
                          <span>Score {selectedConversation.score}</span>
                          <span className={`clone-thread-stage ${selectedConversationStage}`}>{selectedConversation.stage}</span>
                          <span
                            className={
                              selectedConversation.ai_paused || selectedConversation.manual_takeover ? "chat-flag paused" : "chat-flag live"
                            }
                          >
                            {selectedConversation.ai_paused || selectedConversation.manual_takeover ? "Human" : "AI Live"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="chat-actions" ref={chatAiMenuRef}>
                    {!isMobileViewport ? (
                      <button
                        type="button"
                        className="inbox-panel-toggle"
                        aria-label={showLeadDetailPane ? "Hide details panel" : "Show details panel"}
                        title={showLeadDetailPane ? "Hide details panel" : "Show details panel"}
                        onClick={() => setIsDesktopLeadPanelOpen((current) => !current)}
                      >
                        {showLeadDetailPane ? ">" : "<"}
                      </button>
                    ) : null}
                    {selectedConversation ? (
                      <>
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={assignFlowMutation.isPending}
                        onClick={() => {
                          setFlowMenuOpen((current) => !current);
                          setChatAiMenuOpen(false);
                        }}
                      >
                        {assignFlowMutation.isPending ? "Assigning..." : "Assign flow"}
                      </button>
                      {flowMenuOpen ? (
                        <div className="chat-ai-menu">
                          {publishedFlowsQuery.isLoading ? (
                            <button type="button" disabled>
                              Loading flows...
                            </button>
                          ) : publishedFlows.length === 0 ? (
                            <button type="button" disabled>
                              No published flows
                            </button>
                          ) : (
                            publishedFlows.map((flow) => (
                              <button
                                key={flow.id}
                                type="button"
                                onClick={() =>
                                  assignFlowMutation.mutate({
                                    conversationId: selectedConversation.id,
                                    flowId: flow.id,
                                    flowName: flow.name
                                  })
                                }
                              >
                                {flow.name}
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={toggleMutation.isPending}
                        onClick={() => {
                          if (selectedConversation.ai_paused || selectedConversation.manual_takeover) {
                            setFlowMenuOpen(false);
                            setChatAiMenuOpen((current) => !current);
                            return;
                          }
                          setFlowMenuOpen(false);
                          toggleMutation.mutate({
                            conversationId: selectedConversation.id,
                            paused: true,
                            durationMinutes: null
                          });
                          setManualComposeConversationId(selectedConversation.id);
                        }}
                      >
                        {selectedConversation.ai_paused || selectedConversation.manual_takeover ? "Turn on AI" : "Take over"}
                      </button>
                      {selectedConversationAiTimerLabel ? (
                        <span className="chat-ai-timer-badge">Timer {selectedConversationAiTimerLabel}</span>
                      ) : null}
                      {selectedConversation.ai_paused && chatAiMenuOpen ? (
                        <div className="chat-ai-menu">
                          {CHAT_AI_DURATION_OPTIONS.map((option) => (
                            <button
                              key={option.label}
                              type="button"
                              onClick={() => {
                                setChatAiMenuOpen(false);
                                toggleMutation.mutate({
                                  conversationId: selectedConversation.id,
                                  paused: false,
                                  durationMinutes: option.minutes
                                });
                              }}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      </>
                    ) : null}
                  </div>
                </header>

                {selectedConversation && false ? (
                  <div className="inbox-reply-assist">
                    <div className="inbox-reply-assist-copy">
                      <strong>AI Suggested Reply</strong>
                      <span>
                        {getLeadIntentLabel(selectedConversation)} · {getLeadSuggestedAction(selectedConversation)}
                      </span>
                    </div>
                    <div className="inbox-suggestion-strip">
                      {replySuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            setManualComposeConversationId(selectedConversation?.id ?? null);
                            setAgentReplyText(suggestion);
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="clone-messages messages-scroll">
                  {!selectedConversation ? (
                    <p className="empty-note">Select a conversation to view messages.</p>
                  ) : messagesQuery.isLoading ? (
                    <p className="empty-note">Loading conversation...</p>
                  ) : selectedConversationMessages.length === 0 ? (
                    <p className="empty-note">No messages in this chat yet.</p>
                  ) : (
                    selectedConversationMessages.map((message: ConversationMessage) => (
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

                {selectedConversation ? (
                  <div className="inbox-compose-stack">
                    {showManualComposer ? (
                      <div className="inbox-reply-assist">
                        <div className="inbox-reply-assist-copy">
                          <strong>AI Suggested Replies</strong>
                          <span>
                            {getLeadIntentLabel(selectedConversation)} - {getLeadSuggestedAction(selectedConversation)}
                          </span>
                          <small className="inbox-reply-assist-tip">Tap one reply to place it in the message box below.</small>
                        </div>
                        <div className="inbox-suggestion-strip">
                          {replySuggestions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              onClick={() => {
                                setManualComposeConversationId(selectedConversation.id);
                                setAgentReplyText(suggestion);
                              }}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {showManualComposer ? (
                      <form
                        className="chat-manual-compose"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const text = agentReplyText.trim();
                          if (!text) {
                            return;
                          }
                          sendMessageMutation.mutate(text);
                        }}
                      >
                        <input
                          value={agentReplyText}
                          onChange={(event) => setAgentReplyText(event.target.value)}
                          placeholder='Type message or "/" for quick response'
                        />
                        <button
                          type="submit"
                          className="primary-btn"
                          disabled={sendMessageMutation.isPending || !agentReplyText.trim()}
                        >
                          {sendMessageMutation.isPending ? "Sending..." : "Send"}
                        </button>
                      </form>
                    ) : (
                      <div className="inbox-manual-hint">
                        Switch to manual mode if you want to take over the chat and draft a reply here.
                      </div>
                    )}
                  </div>
                ) : null}
              </section>

              {showLeadDetailPane ? (
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
                          <div>
                            <dt>Name</dt>
                            <dd>{getConversationDisplayName(selectedConversation)}</dd>
                          </div>
                          <div>
                            <dt>Phone</dt>
                            <dd>{formatPhone(selectedConversation.contact_phone || selectedConversation.phone_number)}</dd>
                          </div>
                          <div>
                            <dt>Email</dt>
                            <dd>{selectedConversation.contact_email || "Not captured yet"}</dd>
                          </div>
                          <div>
                            <dt>Owner</dt>
                            <dd>{selectedConversation.assigned_agent_name || "Unassigned"}</dd>
                          </div>
                          <div>
                            <dt>Last touch</dt>
                            <dd>{formatDateTime(selectedConversation.last_message_at)}</dd>
                          </div>
                          <div>
                            <dt>Connected number</dt>
                            <dd>{selectedConversation.channel_linked_number || "Workspace default"}</dd>
                          </div>
                        </dl>
                      </section>

                      <section className="inbox-detail-card">
                        <div className="inbox-detail-card-head">
                          <h3>AI Insights</h3>
                          <span>Live</span>
                        </div>
                        <div className="inbox-insight-grid">
                          <article>
                            <span>Intent</span>
                            <strong>{getLeadIntentLabel(selectedConversation)}</strong>
                          </article>
                          <article>
                            <span>Buying Probability</span>
                            <strong>{selectedConversation.score}%</strong>
                          </article>
                          <article>
                            <span>Classifier Confidence</span>
                            <strong>{selectedConversation.classification_confidence}%</strong>
                          </article>
                          <article>
                            <span>Next Follow-up</span>
                            <strong>{getNextFollowUpLabel(selectedConversation)}</strong>
                          </article>
                        </div>
                        <p className="inbox-detail-summary">{getLeadSuggestedAction(selectedConversation)}</p>
                      </section>

                      <section className="inbox-detail-card">
                        <div className="inbox-detail-card-head">
                          <h3>Tags</h3>
                          <span>{conversationTags.length}</span>
                        </div>
                        <div className="inbox-tag-cloud">
                          {conversationTags.map((tag) => (
                            <span key={tag} className="inbox-tag">
                              {tag}
                            </span>
                          ))}
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
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildInboxConversationsQueryOptions(token, { folder: "all", search: "" }));
}
