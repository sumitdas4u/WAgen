import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  connectWhatsApp,
  deleteKnowledgeSource,
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
  setManualTakeover,
  type BusinessBasicsPayload,
  type Conversation,
  type ConversationMessage,
  type DashboardOverviewResponse,
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
  const [activeTab, setActiveTab] = useState<"knowledge" | "bot_settings" | "conversations">("knowledge");
  const [businessBasics, setBusinessBasics] = useState<BusinessBasicsPayload>(DEFAULT_BUSINESS_BASICS);
  const [personality, setPersonality] = useState<(typeof PERSONALITIES)[number]["key"]>("friendly_warm");
  const [customPrompt, setCustomPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [manualFaq, setManualFaq] = useState("");
  const [showKnowledgeMenu, setShowKnowledgeMenu] = useState(false);
  const [knowledgeModal, setKnowledgeModal] = useState<"manual" | "website" | "pdf" | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState<"add" | "edit">("add");
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

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const formatPhone = useCallback((value: string | null | undefined) => {
    if (!value) {
      return "Unknown";
    }
    const digits = value.replace(/\D/g, "");
    if (!digits) {
      return value;
    }
    return `+${digits}`;
  }, []);

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

    setOverview(overviewResponse);
    setConversations(conversationsResponse.conversations);
    setSelectedConversationId((current) => current ?? conversationsResponse.conversations[0]?.id ?? null);
  }, [token]);

  useEffect(() => {
    void loadData().catch((loadError) => {
      setError((loadError as Error).message);
    });
    void refreshKnowledge();
  }, [loadData, refreshKnowledge]);

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

  const handleManualToggle = async () => {
    if (!token || !selectedConversation) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await setManualTakeover(token, selectedConversation.id, !selectedConversation.manual_takeover);
      await loadData();
      setInfo(selectedConversation.manual_takeover ? "Manual takeover disabled." : "Manual takeover enabled.");
    } catch (toggleError) {
      setError((toggleError as Error).message);
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <main className="dashboard-shell dashboard-frame">
      <aside className="dashboard-left">
        <div className="dashboard-left-brand">
          <strong>{companyLabel}</strong>
          <small>Agent Console</small>
        </div>
        <nav className="dashboard-left-nav">
          <button className={activeTab === "knowledge" ? "left-nav-btn active" : "left-nav-btn"} onClick={() => setActiveTab("knowledge")}>
            Knowledge Base
          </button>
          <button className={activeTab === "bot_settings" ? "left-nav-btn active" : "left-nav-btn"} onClick={() => setActiveTab("bot_settings")}>
            Bot Settings
          </button>
          <button className={activeTab === "conversations" ? "left-nav-btn active" : "left-nav-btn"} onClick={() => setActiveTab("conversations")}>
            Chats
          </button>
        </nav>
        <div className="dashboard-left-actions">
          <button className="primary-btn" onClick={() => navigate("/onboarding?focus=qr")}>Scan QR</button>
          <button
            className="ghost-btn"
            onClick={() => {
              logout();
              navigate("/signup", { replace: true });
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      <section className="dashboard-right">
      <header className="dashboard-header">
        <h1>{activeTab === "knowledge" ? "Knowledge Base" : activeTab === "bot_settings" ? "Bot Settings" : "Chats"} <small className="tiny-note">v2</small></h1>
        <div className="header-actions">
          <button className="ghost-btn" disabled={busy} onClick={handleReconnectWhatsApp}>Reconnect WhatsApp</button>
          <button className="ghost-btn" disabled={busy} onClick={handlePauseAgent}>
            {overview?.agent.active ? "Pause Agent" : "Activate Agent"}
          </button>
        </div>
      </header>

      <section className="overview-grid">
        <article>
          <h3>Conversations Today</h3>
          <p>{overview?.overview.leadsToday ?? 0}</p>
        </article>
        <article>
          <h3>Priority Chats</h3>
          <p>{overview?.overview.hotLeads ?? 0}</p>
        </article>
        <article>
          <h3>Active Follow-ups</h3>
          <p>{overview?.overview.warmLeads ?? 0}</p>
        </article>
        <article>
          <h3>Resolved Threads</h3>
          <p>{overview?.overview.closedDeals ?? 0}</p>
        </article>
      </section>

      <section className="status-row">
        <span>
          WhatsApp: <strong>{overview?.whatsapp.status ?? "disconnected"}</strong>
        </span>
        {overview?.whatsapp.hasQr ? <span>QR ready. Open Onboarding to scan.</span> : null}
        <span>
          Knowledge Chunks: <strong>{overview?.knowledge.chunks ?? 0}</strong>
        </span>
        <span>
          WAgen: <strong>{overview?.agent.active ? "Live" : "Paused"}</strong>
        </span>
      </section>

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
        <section className="finance-shell">
          <article className="finance-panel">
            <h2>Bot Settings</h2>
            <form className="stack-form" onSubmit={handleSaveBotSettings}>
              <div className="train-grid two-col">
                <label>
                  Company Name
                  <input required value={businessBasics.companyName} onChange={(event) => handleBasicsChange("companyName", event.target.value)} />
                </label>
                <label>
                  Support Domain
                  <input required value={businessBasics.whatDoYouSell} onChange={(event) => handleBasicsChange("whatDoYouSell", event.target.value)} />
                </label>
                <label>
                  Target Audience
                  <input required value={businessBasics.targetAudience} onChange={(event) => handleBasicsChange("targetAudience", event.target.value)} />
                </label>
                <label>
                  USP
                  <textarea required value={businessBasics.usp} onChange={(event) => handleBasicsChange("usp", event.target.value)} />
                </label>
                <label>
                  Common Issues
                  <textarea required value={businessBasics.objections} onChange={(event) => handleBasicsChange("objections", event.target.value)} />
                </label>
                <label>
                  Escalation Contact Name
                  <input required value={businessBasics.supportContactName} onChange={(event) => handleBasicsChange("supportContactName", event.target.value)} />
                </label>
                <label>
                  Escalation Phone
                  <input required value={businessBasics.supportPhoneNumber} onChange={(event) => handleBasicsChange("supportPhoneNumber", event.target.value)} />
                </label>
                <label className="full-span">
                  AI Do Rules
                  <textarea required value={businessBasics.aiDoRules} onChange={(event) => handleBasicsChange("aiDoRules", event.target.value)} />
                </label>
                <label className="full-span">
                  AI Don't Rules
                  <textarea required value={businessBasics.aiDontRules} onChange={(event) => handleBasicsChange("aiDontRules", event.target.value)} />
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
          </article>
        </section>
      )}

      {activeTab === "conversations" && (
        <section className="dashboard-main">
          <aside className="conversation-list whatsapp-list">
            <div className="conversation-list-head">
              <h2>All chats</h2>
              <small>{conversations.length}</small>
            </div>
            <div className="conversation-list-scroll">
              {conversations.length === 0 ? (
                <p className="empty-note">
                  No conversations yet. Send a new inbound message from another number to this WhatsApp to create leads.
                </p>
              ) : null}
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={conversation.id === selectedConversationId ? "conversation-item active" : "conversation-item"}
                  onClick={() => setSelectedConversationId(conversation.id)}
                >
                  <header>
                    <strong>{conversation.contact_name || formatPhone(conversation.phone_number)}</strong>
                    <small>{conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString() : ""}</small>
                  </header>
                  <p>{conversation.last_message || "No messages yet"}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="chat-panel whatsapp-chat">
            <header className="whatsapp-chat-head">
              <div>
                <h2>{selectedConversation ? selectedConversation.contact_name || formatPhone(selectedConversation.phone_number) : "Select a conversation"}</h2>
                {selectedConversation ? (
                  <small className="tiny-note">{formatPhone(selectedConversation.phone_number)} | Score {selectedConversation.score} | {selectedConversation.stage}</small>
                ) : null}
              </div>
              {selectedConversation && (
                <div className="chat-actions">
                  <button className="ghost-btn" disabled={busy} onClick={handleManualToggle}>
                    {selectedConversation.manual_takeover ? "Disable Manual" : "Manual Takeover"}
                  </button>
                  <button className="ghost-btn" disabled={busy} onClick={handlePauseToggle}>
                    {selectedConversation.ai_paused ? "Resume AI" : "Pause AI"}
                  </button>
                </div>
              )}
            </header>

            <div className="messages-scroll">
              {messages.map((message) => (
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
              ))}
            </div>
          </section>
        </section>
      )}

      {info && <p className="info-text">{info}</p>}
      {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
