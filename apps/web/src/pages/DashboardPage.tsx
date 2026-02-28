import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { useAuth } from "../lib/auth-context";
import {
  connectWhatsApp,
  deleteKnowledgeSource,
  fetchLeadConversations,
  fetchConversationMessages,
  fetchConversations,
  fetchDashboardOverview,
  fetchIngestionJobs,
  fetchKnowledgeChunks,
  fetchKnowledgeSources,
  ingestManual,
  ingestPdf,
  ingestWebsite,
  saveBusinessBasics,
  savePersonality,
  setAgentActive,
  setConversationPaused,
  summarizeLeadConversations,
  type BusinessBasicsPayload,
  type Conversation,
  type ConversationMessage,
  type DashboardOverviewResponse,
  type LeadConversation,
  type KnowledgeIngestJob,
  type KnowledgeChunkPreview,
  type KnowledgeSource
} from "../lib/api";
import { useRealtime } from "../lib/use-realtime";

const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
const PERSONALITIES = [
  { key: "friendly_warm", label: "Friendly & Warm" },
  { key: "professional", label: "Professional" },
  { key: "hard_closer", label: "Hard Closer" },
  { key: "premium_consultant", label: "Premium Consultant" },
  { key: "custom", label: "Custom Prompt" }
] as const;
const DASHBOARD_TAB_OPTIONS = [
  { value: "conversations", label: "Chats", subtitle: "Live Inbox", icon: "C" },
  { value: "leads", label: "Leads", subtitle: "Priority Queue", icon: "L" },
  { value: "knowledge", label: "Knowledge", subtitle: "Content Library", icon: "K" },
  { value: "bot_settings", label: "Settings", subtitle: "Agent Controls", icon: "S" }
] as const;
type DashboardTab = (typeof DASHBOARD_TAB_OPTIONS)[number]["value"];
type ChatLeadFilter = "hot" | "warm" | "cold";

const CHAT_LEAD_FILTER_OPTIONS: Array<{ value: ChatLeadFilter; label: string; icon: string }> = [
  { value: "hot", label: "Hot Leads", icon: "H" },
  { value: "warm", label: "Warm Leads", icon: "W" },
  { value: "cold", label: "Cold Leads", icon: "C" }
];

function matchesChatLeadFilter(conversation: Conversation, filter: ChatLeadFilter): boolean {
  return conversation.stage.toLowerCase() === filter;
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
  supportAddress: "",
  supportPhoneNumber: "",
  supportContactName: "",
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
    supportAddress: readSavedString(saved.supportAddress, DEFAULT_BUSINESS_BASICS.supportAddress),
    supportPhoneNumber: readSavedString(saved.supportPhoneNumber, DEFAULT_BUSINESS_BASICS.supportPhoneNumber),
    supportContactName: readSavedString(saved.supportContactName, DEFAULT_BUSINESS_BASICS.supportContactName),
    supportEmail: readSavedString(saved.supportEmail, DEFAULT_BUSINESS_BASICS.supportEmail),
    aiDoRules: readSavedString(saved.aiDoRules, DEFAULT_BUSINESS_BASICS.aiDoRules),
    aiDontRules: readSavedString(saved.aiDontRules, DEFAULT_BUSINESS_BASICS.aiDontRules)
  };
}

export function DashboardPage() {
  const { token, user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activeTab, setActiveTab] = useState<DashboardTab>("conversations");
  const [chatLeadFilter, setChatLeadFilter] = useState<ChatLeadFilter | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [leadStageFilter, setLeadStageFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [leadRows, setLeadRows] = useState<LeadConversation[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [summarizingLeads, setSummarizingLeads] = useState(false);
  const [expandedLeadSummaries, setExpandedLeadSummaries] = useState<Record<string, boolean>>({});
  const [expandedLeadMessages, setExpandedLeadMessages] = useState<Record<string, boolean>>({});
  const [businessBasics, setBusinessBasics] = useState<BusinessBasicsPayload>(DEFAULT_BUSINESS_BASICS);
  const [personality, setPersonality] = useState<(typeof PERSONALITIES)[number]["key"]>("friendly_warm");
  const [customPrompt, setCustomPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [manualFaq, setManualFaq] = useState("");
  const [showKnowledgeMenu, setShowKnowledgeMenu] = useState(false);
  const [knowledgeModal, setKnowledgeModal] = useState<"manual" | "website" | "pdf" | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState<"add" | "edit">("add");
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
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
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );
  const leads = useMemo(() => {
    const sorted = [...leadRows].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTime - aTime;
    });
    if (leadStageFilter === "all") {
      return sorted;
    }
    return sorted.filter((lead) => lead.stage === leadStageFilter);
  }, [leadRows, leadStageFilter]);

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
    const inFolder = chatLeadFilter
      ? conversations.filter((conversation) => matchesChatLeadFilter(conversation, chatLeadFilter))
      : conversations;
    const query = chatSearch.trim().toLowerCase();
    if (!query) {
      return sortConversationsByRecent(inFolder);
    }
    return sortConversationsByRecent(
      inFolder.filter((conversation) => {
        const haystack = `${conversation.contact_name ?? ""} ${formatPhone(conversation.phone_number)} ${
          conversation.last_message ?? ""
        }`.toLowerCase();
        return haystack.includes(query);
      })
    );
  }, [chatSearch, conversations, formatPhone, chatLeadFilter]);

  const chatLeadCounts = useMemo(
    () =>
      CHAT_LEAD_FILTER_OPTIONS.reduce<Record<ChatLeadFilter, number>>(
        (counts, option) => ({ ...counts, [option.value]: conversations.filter((row) => matchesChatLeadFilter(row, option.value)).length }),
        {
          hot: 0,
          warm: 0,
          cold: 0
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

  const loadData = useCallback(async () => {
    if (!token) {
      return;
    }

    setError(null);
    const [overviewResponse, conversationsResponse] = await Promise.all([
      fetchDashboardOverview(token),
      fetchConversations(token)
    ]);

    const sortedConversations = sortConversationsByRecent(conversationsResponse.conversations);
    setOverview(overviewResponse);
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
      const response = await fetchLeadConversations(token, { limit: 300 });
      setLeadRows(response.leads);
    } finally {
      setLeadsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData().catch((loadError) => {
      setError((loadError as Error).message);
    });
    void refreshKnowledge();
  }, [loadData, refreshKnowledge]);

  useEffect(() => {
    if (activeTab !== "leads") {
      return;
    }
    void loadLeads().catch((loadError) => {
      setError((loadError as Error).message);
    });
  }, [activeTab, loadLeads]);

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
    if (!showSettingsMenu) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const menuRoot = settingsMenuRef.current;
      if (!menuRoot) {
        return;
      }
      if (event.target instanceof Node && !menuRoot.contains(event.target)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [showSettingsMenu]);

  useEffect(() => {
    if (activeTab !== "bot_settings" && showSettingsMenu) {
      setShowSettingsMenu(false);
    }
  }, [activeTab, showSettingsMenu]);

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

  useRealtime(
    token,
    useCallback(
      (event) => {
        if (event.event === "conversation.updated") {
          void loadData();
          if (selectedConversationId && token) {
            void fetchConversationMessages(token, selectedConversationId)
              .then((response) => setMessages(response.messages))
              .catch(() => undefined);
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
      [loadData, selectedConversationId, token]
    )
  );

  const handlePauseToggle = async () => {
    if (!token || !selectedConversation) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setConversationPaused(token, selectedConversation.id, !selectedConversation.ai_paused);
      await loadData();
      setInfo(selectedConversation.ai_paused ? "AI resumed for this chat." : "AI paused for this chat.");
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

  const handleExportLeads = () => {
    if (leads.length === 0) {
      setInfo("No leads available to export.");
      return;
    }

    const rows = leads.map((lead) => ({
      Name: lead.contact_name || "",
      Phone: formatPhone(lead.phone_number),
      Stage: lead.stage,
      Score: lead.score,
      "AI Summary": lead.ai_summary || "",
      "Last Message": lead.last_message || "",
      "Last Activity": lead.last_message_at ? new Date(lead.last_message_at).toLocaleString() : ""
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Leads");
    const fileData = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([fileData], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `leads-summary-${stamp}.xlsx`;
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
      const response = await summarizeLeadConversations(token, { limit: 300 });
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

  const handleBasicsChange = (field: keyof BusinessBasicsPayload, value: string) => {
    setBusinessBasics((current) => ({ ...current, [field]: value }));
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

  const handleSaveBotSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await saveBusinessBasics(token, {
        ...businessBasics,
        defaultCountry: businessBasics.defaultCountry.trim().toUpperCase() || "IN",
        defaultCurrency: businessBasics.defaultCurrency.trim().toUpperCase() || "INR",
        websiteUrl: websiteUrl.trim(),
        manualFaq: manualFaq.trim()
      });
      await savePersonality(token, {
        personality,
        customPrompt: personality === "custom" ? customPrompt.trim() : undefined
      });
      await refreshUser();
      setInfo("Bot settings saved.");
    } catch (saveError) {
      setError((saveError as Error).message);
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
    "WAgen";
  const currentSection = DASHBOARD_TAB_OPTIONS.find((option) => option.value === activeTab) ?? DASHBOARD_TAB_OPTIONS[0];
  const selectedConversationLabel = selectedConversation
    ? selectedConversation.contact_name || formatPhone(selectedConversation.phone_number)
    : "Select a conversation";

  return (
    <main className="dashboard-shell dashboard-clone-shell">
      <section className="clone-workspace">
        <aside className="clone-icon-rail">
          <button className="clone-rail-logo" type="button" onClick={() => setActiveTab("conversations")}>
            <span className="clone-rail-icon">W</span>
            <span className="clone-rail-label">WAgenai</span>
          </button>
          <nav className="clone-rail-menu">
            {DASHBOARD_TAB_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={activeTab === option.value ? "clone-rail-btn active" : "clone-rail-btn"}
                type="button"
                title={option.label}
                onClick={() => setActiveTab(option.value)}
              >
                <span className="clone-rail-icon">{option.icon}</span>
                <span className="clone-rail-label">{option.label}</span>
              </button>
            ))}
          </nav>
          <div className="clone-rail-divider" />
          <div className="clone-rail-spacer" />
          <button
            className="clone-rail-btn"
            type="button"
            title="Logout"
            onClick={() => {
              logout();
              navigate("/signup", { replace: true });
            }}
          >
            <span className="clone-rail-icon">L</span>
            <span className="clone-rail-label">Logout</span>
          </button>
        </aside>

        <section className="clone-main">
          <header className="clone-main-header">
            <div>
              <h1>{activeTab === "conversations" ? "Unassigned" : currentSection.label}</h1>
              <p>{currentSection.subtitle}</p>
            </div>
            <div className="clone-main-actions">
              <span className={`status-badge status-${overview?.whatsapp.status ?? "not_connected"}`}>
                {overview?.whatsapp.status ?? "disconnected"}
              </span>
              <button className="ghost-btn" type="button" onClick={() => navigate("/purchase")}>
                Billing
              </button>
              <button className="ghost-btn" type="button" disabled={busy} onClick={handlePauseAgent}>
                {overview?.agent.active ? "Pause Agent" : "Activate Agent"}
              </button>
            </div>
          </header>

      {activeTab === "knowledge" && (
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

      {activeTab === "bot_settings" && (
        <section className="clone-settings-view">
          <div className="clone-settings-top">
            <h2>Settings</h2>
            <div className="clone-settings-top-actions">
              <span>{overview?.whatsapp.phoneNumber || "No number"}</span>
              <div className="clone-settings-menu-wrap" ref={settingsMenuRef}>
                <button
                  type="button"
                  className="clone-settings-menu-trigger"
                  aria-label="Settings quick actions"
                  aria-expanded={showSettingsMenu}
                  onClick={() => setShowSettingsMenu((current) => !current)}
                >
                  ≡
                </button>
                {showSettingsMenu && (
                  <div className="clone-settings-menu-dropdown">
                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        navigate("/widget");
                      }}
                    >
                      <span className="clone-rail-icon">W</span>
                      <span>Widget Builder</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setShowSettingsMenu(false);
                        void handleReconnectWhatsApp();
                      }}
                    >
                      <span className="clone-rail-icon">R</span>
                      <span>Reconnect</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        navigate("/onboarding?focus=qr");
                      }}
                    >
                      <span className="clone-rail-icon">Q</span>
                      <span>Scan QR</span>
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className="primary-btn" onClick={() => navigate("/onboarding?focus=qr")}>
                Manage Connections
              </button>
            </div>
          </div>

          <form className="stack-form clone-settings-form" onSubmit={handleSaveBotSettings}>
            <div className="train-grid two-col">
              <label>
                Company Name
                <input
                  required
                  value={businessBasics.companyName}
                  onChange={(event) => handleBasicsChange("companyName", event.target.value)}
                />
              </label>
              <label>
                Support Domain
                <input
                  required
                  value={businessBasics.whatDoYouSell}
                  onChange={(event) => handleBasicsChange("whatDoYouSell", event.target.value)}
                />
              </label>
              <label>
                Target Audience
                <input
                  required
                  value={businessBasics.targetAudience}
                  onChange={(event) => handleBasicsChange("targetAudience", event.target.value)}
                />
              </label>
              <label>
                Default Country
                <input
                  required
                  value={businessBasics.defaultCountry}
                  onChange={(event) => handleBasicsChange("defaultCountry", event.target.value.toUpperCase())}
                />
              </label>
              <label>
                Default Currency
                <input
                  required
                  value={businessBasics.defaultCurrency}
                  onChange={(event) => handleBasicsChange("defaultCurrency", event.target.value.toUpperCase())}
                />
              </label>
              <label>
                Escalation Contact Name
                <input
                  required
                  value={businessBasics.supportContactName}
                  onChange={(event) => handleBasicsChange("supportContactName", event.target.value)}
                />
              </label>
              <label>
                Escalation Phone
                <input
                  required
                  value={businessBasics.supportPhoneNumber}
                  onChange={(event) => handleBasicsChange("supportPhoneNumber", event.target.value)}
                />
              </label>
              <label>
                Escalation Email
                <input
                  required
                  type="email"
                  value={businessBasics.supportEmail}
                  onChange={(event) => handleBasicsChange("supportEmail", event.target.value)}
                />
              </label>
              <label className="full-span">
                Address
                <textarea
                  required
                  value={businessBasics.supportAddress}
                  onChange={(event) => handleBasicsChange("supportAddress", event.target.value)}
                />
              </label>
              <label className="full-span">
                USP / Business Description
                <textarea required value={businessBasics.usp} onChange={(event) => handleBasicsChange("usp", event.target.value)} />
              </label>
              <label className="full-span">
                Common Issues / Objections
                <textarea
                  required
                  value={businessBasics.objections}
                  onChange={(event) => handleBasicsChange("objections", event.target.value)}
                />
              </label>
              <label className="full-span">
                Greeting Script
                <textarea
                  required
                  value={businessBasics.greetingScript}
                  onChange={(event) => handleBasicsChange("greetingScript", event.target.value)}
                />
              </label>
              <label className="full-span">
                Availability Script
                <textarea
                  required
                  value={businessBasics.availabilityScript}
                  onChange={(event) => handleBasicsChange("availabilityScript", event.target.value)}
                />
              </label>
              <label className="full-span">
                Objection Handling Script
                <textarea
                  required
                  value={businessBasics.objectionHandlingScript}
                  onChange={(event) => handleBasicsChange("objectionHandlingScript", event.target.value)}
                />
              </label>
              <label className="full-span">
                Booking Script
                <textarea
                  required
                  value={businessBasics.bookingScript}
                  onChange={(event) => handleBasicsChange("bookingScript", event.target.value)}
                />
              </label>
              <label className="full-span">
                Feedback Collection Script
                <textarea
                  required
                  value={businessBasics.feedbackCollectionScript}
                  onChange={(event) => handleBasicsChange("feedbackCollectionScript", event.target.value)}
                />
              </label>
              <label className="full-span">
                Complaint Handling Script
                <textarea
                  required
                  value={businessBasics.complaintHandlingScript}
                  onChange={(event) => handleBasicsChange("complaintHandlingScript", event.target.value)}
                />
              </label>
              <label className="full-span">
                AI Do Rules
                <textarea required value={businessBasics.aiDoRules} onChange={(event) => handleBasicsChange("aiDoRules", event.target.value)} />
              </label>
              <label className="full-span">
                AI Do Not Rules
                <textarea
                  required
                  value={businessBasics.aiDontRules}
                  onChange={(event) => handleBasicsChange("aiDontRules", event.target.value)}
                />
              </label>
            </div>

            <fieldset className="personality-grid">
              {PERSONALITIES.map((option) => (
                <label key={option.key} className={personality === option.key ? "selected" : ""}>
                  <input
                    type="radio"
                    name="personality"
                    value={option.key}
                    checked={personality === option.key}
                    onChange={() => setPersonality(option.key)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            {personality === "custom" && (
              <label>
                Custom Prompt
                <textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} />
              </label>
            )}

            <button className="primary-btn" type="submit" disabled={busy}>
              Save Bot Settings
            </button>
          </form>
        </section>
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
              </div>
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
                      <th>Stage</th>
                      <th>Score</th>
                      <th>AI Summary</th>
                      <th>Last Message</th>
                      <th>Last Activity</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
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
                          <td className="lead-phone">{formatPhone(lead.phone_number)}</td>
                          <td>
                            <span className={`lead-stage ${lead.stage}`}>{lead.stage}</span>
                          </td>
                          <td className="lead-score">{lead.score}</td>
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
          <div className="clone-chat-filterbar">
            <label className="clone-chat-search">
              <input
                value={chatSearch}
                onChange={(event) => setChatSearch(event.target.value)}
                placeholder="Search chats..."
              />
            </label>
            <nav className="clone-chat-filter-pills">
              {CHAT_LEAD_FILTER_OPTIONS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={chatLeadFilter === filter.value ? "active" : ""}
                  onClick={() => setChatLeadFilter((current) => (current === filter.value ? null : filter.value))}
                >
                  {filter.label} ({chatLeadCounts[filter.value]})
                </button>
              ))}
            </nav>
          </div>
          <section className="clone-chat-layout">
            <aside className="clone-thread-list">
              {filteredConversations.length === 0 ? (
                <p className="empty-note">
                  {chatSearch.trim()
                    ? "No conversations match your search."
                    : "No conversations yet. Send a new inbound message to start chat tracking."}
                </p>
              ) : (
                filteredConversations.map((conversation) => {
                  const label = conversation.contact_name || formatPhone(conversation.phone_number);
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
                      onClick={() => setSelectedConversationId(conversation.id)}
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

            <section className="clone-chat-panel">
              <header className="clone-chat-head">
                <div>
                  <h2>{selectedConversationLabel}</h2>
                  {selectedConversation ? (
                    <small>
                      {formatPhone(selectedConversation.phone_number)} | Score {selectedConversation.score} | {selectedConversation.stage}
                    </small>
                  ) : null}
                </div>
                {selectedConversation && (
                  <div className="chat-actions">
                    <button className="ghost-btn" disabled={busy} onClick={handlePauseToggle}>
                      {selectedConversation.ai_paused ? "Resume AI" : "Pause AI"}
                    </button>
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

            </section>
          </section>
        </section>
      )}

        </section>
      </section>

      {info && <p className="info-text">{info}</p>}
      {error && <p className="error-text">{error}</p>}
    </main>
  );
}
