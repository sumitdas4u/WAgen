import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  fetchIngestionJobs,
  ingestManual,
  ingestKnowledgeFiles,
  ingestWebsite,
  requestTestChatbotReply,
  saveBusinessBasics,
  savePersonality,
  setAgentActive,
  type BusinessBasicsPayload,
  type KnowledgeIngestJob
} from "../lib/api";

type JourneyStep = 1 | 2 | 3 | 4;
type KnowledgeMode = "website" | "file" | "manual";

type ChatRow = {
  id: string;
  sender: "bot" | "user";
  text: string;
  time: string;
};

const MAX_KNOWLEDGE_FILE_UPLOAD_BYTES = 20 * 1024 * 1024;
const KNOWLEDGE_UPLOAD_POLL_INTERVAL_MS = 1500;
const KNOWLEDGE_UPLOAD_TIMEOUT_MS = 5 * 60_000;
const SUPPORTED_KNOWLEDGE_FILE_EXTENSIONS = new Set(["pdf", "txt", "doc", "docx", "xls", "xlsx"]);

function isSupportedKnowledgeFile(file: File): boolean {
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
  return Boolean(extension && SUPPORTED_KNOWLEDGE_FILE_EXTENSIONS.has(extension));
}

const firstBotMessage: ChatRow = {
  id: "seed",
  sender: "bot",
  text: "Hey, how can I help you today?",
  time: "5:30 AM"
};

function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function readSavedString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const cleaned = value.trim();
  return cleaned || fallback;
}

function formatKnowledgeUploadFailure(jobs: KnowledgeIngestJob[]): string {
  const messages = jobs.map((job) => {
    const sourceName = job.source_name?.trim() || "Uploaded file";
    return job.error_message ? `${sourceName}: ${job.error_message}` : `${sourceName}: Upload failed.`;
  });
  return messages.join(" ");
}

export function OnboardingPage() {
  const { token, user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const savedBasics = (user?.business_basics ?? {}) as Record<string, unknown>;
  const [step, setStep] = useState<JourneyStep>(1);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [botName, setBotName] = useState(readSavedString(savedBasics.companyName, user?.name ?? ""));
  const [businessAbout, setBusinessAbout] = useState(readSavedString(savedBasics.whatDoYouSell, ""));
  const [unknownReply, setUnknownReply] = useState(
    readSavedString(savedBasics.complaintHandlingScript, "Sorry, I don't have information on this yet.")
  );
  const [avoidWords, setAvoidWords] = useState(readSavedString(savedBasics.objections, ""));
  const [doRules, setDoRules] = useState(readSavedString(savedBasics.aiDoRules, ""));
  const [dontRules, setDontRules] = useState(readSavedString(savedBasics.aiDontRules, ""));

  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>("website");
  const [websiteUrl, setWebsiteUrl] = useState(readSavedString(savedBasics.websiteUrl, ""));
  const [manualText, setManualText] = useState(readSavedString(savedBasics.manualFaq, ""));
  const [knowledgeFiles, setKnowledgeFiles] = useState<File[]>([]);

  const [chatInput, setChatInput] = useState("");
  const [chatRows, setChatRows] = useState<ChatRow[]>([firstBotMessage]);
  const [botTyping, setBotTyping] = useState(false);

  const canGoStep1 = botName.trim().length >= 2 && businessAbout.trim().length >= 2;
  const canGoStep2 = true;
  const canProceedKnowledge = useMemo(() => {
    if (knowledgeMode === "website") {
      return websiteUrl.trim().length > 0;
    }
    if (knowledgeMode === "manual") {
      return manualText.trim().length >= 20;
    }
    return knowledgeFiles.length > 0;
  }, [knowledgeMode, knowledgeFiles, manualText, websiteUrl]);

  const progressTicks = [24, 41, 57, 73, 88, 100];
  const stepLabel = `${step} of 4`;

  const persistBusinessProfile = async () => {
    if (!token) {
      return;
    }

    const payload: BusinessBasicsPayload = {
      companyName: botName.trim(),
      whatDoYouSell: businessAbout.trim(),
      targetAudience: "WhatsApp users",
      usp: businessAbout.trim(),
      objections: avoidWords.trim().length >= 2 ? avoidWords.trim() : "No restricted words provided.",
      defaultCountry: "IN",
      defaultCurrency: "INR",
      greetingScript: "Greet politely and ask how you can help.",
      availabilityScript: "Share availability and expected timeline clearly.",
      objectionHandlingScript: "Acknowledge concern and provide a practical next step.",
      bookingScript: "Confirm request and collect essential details.",
      feedbackCollectionScript: "Ask for a short feedback summary and one suggestion.",
      complaintHandlingScript: unknownReply.trim(),
      supportEmail: user?.email ?? "",
      aiDoRules: doRules.trim() || "Answer clearly using business context and available knowledge.",
      aiDontRules: dontRules.trim() || "Do not hallucinate policy or pricing details.",
      escalationWhenToEscalate:
        "Escalate when the answer is not available in knowledge, query is unclear after one follow-up, or customer asks for a human.",
      escalationContactPerson: user?.name ?? "",
      escalationPhoneNumber: "",
      escalationEmail: user?.email ?? "",
      websiteUrl: websiteUrl.trim(),
      manualFaq: manualText.trim()
    };

    await saveBusinessBasics(token, payload);
    await savePersonality(token, {
      personality: "custom",
      customPrompt: [
        `Bot identity: ${payload.companyName}`,
        `Business context: ${payload.whatDoYouSell}`,
        `Fallback reply: ${payload.complaintHandlingScript}`,
        `Escalation policy: ${payload.escalationWhenToEscalate}`,
        `Escalation contact person: ${payload.escalationContactPerson || "not configured"}`,
        `Escalation phone: ${payload.escalationPhoneNumber || "not configured"}`,
        `Escalation email: ${payload.escalationEmail || "not configured"}`
      ].join("\n")
    });
  };

  const waitForKnowledgeUploadJobs = async (jobIds: string[]) => {
    if (!token) {
      return;
    }
    if (jobIds.length === 0) {
      throw new Error("Could not start knowledge upload. Please try again.");
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < KNOWLEDGE_UPLOAD_TIMEOUT_MS) {
      const response = await fetchIngestionJobs(token, jobIds);
      const failedJobs = response.jobs.filter((job) => job.status === "failed");
      if (failedJobs.length > 0) {
        throw new Error(formatKnowledgeUploadFailure(failedJobs));
      }

      const allCompleted =
        response.jobs.length === jobIds.length &&
        response.jobs.every((job) => job.status === "completed" || Boolean(job.completed_at) || job.progress >= 100);
      if (allCompleted) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, KNOWLEDGE_UPLOAD_POLL_INTERVAL_MS));
    }

    throw new Error("Knowledge upload is taking longer than expected. Please check the Knowledge Base page in Dashboard.");
  };

  const ingestKnowledge = async () => {
    if (!token) {
      return;
    }

    if (knowledgeMode === "website") {
      await ingestWebsite(token, websiteUrl.trim(), `${botName.trim()} Website`);
      return;
    }

    if (knowledgeMode === "manual") {
      await ingestManual(token, manualText.trim(), `${botName.trim()} Manual`);
      return;
    }

    if (knowledgeFiles.length > 0) {
      const response = await ingestKnowledgeFiles(token, knowledgeFiles);
      await waitForKnowledgeUploadJobs(response.jobs.map((job) => job.id));
    }
  };

  const runTrainingSequence = async () => {
    setIsTraining(true);
    setTrainingProgress(12);

    for (const tick of progressTicks) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      setTrainingProgress(tick);
    }

    setIsTraining(false);
    setStep(4);
  };

  const ensureAgentEnabled = async () => {
    if (!token) {
      return;
    }
    await setAgentActive(token, true);
  };

  const handleStep1Proceed = () => {
    if (!canGoStep1) {
      setError("Enter bot identity details to continue.");
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleStep2Proceed = () => {
    if (!canGoStep2) {
      return;
    }
    setError(null);
    setStep(3);
  };

  const handleStep3Proceed = async () => {
    if (!token) {
      return;
    }
    if (!canProceedKnowledge) {
      setError("Add one knowledge source first, or use skip.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await persistBusinessProfile();
      await ingestKnowledge();
      await ensureAgentEnabled();
      await refreshUser();
      await runTrainingSequence();
    } catch (onboardingError) {
      setError((onboardingError as Error).message);
      setIsTraining(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipKnowledge = async () => {
    if (!token) {
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await persistBusinessProfile();
      await ensureAgentEnabled();
      await refreshUser();
      await runTrainingSequence();
    } catch (onboardingError) {
      setError((onboardingError as Error).message);
      setIsTraining(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || botTyping || !token) {
      return;
    }

    const userMessage: ChatRow = {
      id: `u-${Date.now()}`,
      sender: "user",
      text,
      time: nowTimeLabel()
    };
    const historyRows = [...chatRows, userMessage];

    setChatRows(historyRows);
    setChatInput("");
    setBotTyping(true);

    try {
      const response = await requestTestChatbotReply(token, {
        message: text,
        history: historyRows.map((row) => ({
          sender: row.sender,
          text: row.text
        }))
      });

      setChatRows((current) => [
        ...current,
        {
          id: `b-${Date.now()}`,
          sender: "bot",
          text: response.reply,
          time: nowTimeLabel()
        }
      ]);
    } catch (chatError) {
      setChatRows((current) => [
        ...current,
        {
          id: `b-${Date.now()}`,
          sender: "bot",
          text: `I could not process that right now. ${(chatError as Error).message}`,
          time: nowTimeLabel()
        }
      ]);
    } finally {
      setBotTyping(false);
    }
  };

  const handleFinish = async () => {
    if (token) {
      await setAgentActive(token, true).catch(() => undefined);
      await refreshUser().catch(() => undefined);
    }
    navigate("/dashboard?tab=chatbot_personality", { replace: true });
  };

  return (
    <main className="journey-shell">
      <section className="journey-card">
        <header className="journey-header">
          <p className="journey-step-count">Step {stepLabel}</p>
          <h1>
            {step === 1
              ? "Set your bot identity"
              : step === 2
                ? "Define custom instructions"
                : step === 3
                  ? "Add initial knowledge base"
                  : "Test your chatbot"}
          </h1>
          <p className="journey-sub">
            {step === 1
              ? "Only the essential setup fields."
              : step === 2
                ? "Add do's and don'ts for how your bot should behave."
                : step === 3
                  ? "Import website, documents, or manual content to train responses."
                  : "Ask sample questions and check answer quality."}
          </p>
          <nav className="journey-stepper" aria-label="Onboarding steps">
            {[1, 2, 3, 4].map((item) => (
              <span key={item} className={item <= step ? "active" : ""} />
            ))}
          </nav>
        </header>

        {step === 1 && (
          <section className="journey-step">
            <label>
              Bot name
              <input value={botName} onChange={(event) => setBotName(event.target.value)} placeholder="e.g. FoodStudio" />
            </label>
            <label>
              What is your business about?
              <textarea
                rows={6}
                value={businessAbout}
                onChange={(event) => setBusinessAbout(event.target.value)}
                placeholder="Write here..."
              />
            </label>
            <label>
              What will the bot say when it does not know the answer?
              <input
                value={unknownReply}
                onChange={(event) => setUnknownReply(event.target.value)}
                placeholder="Sorry, I don't have information on this."
              />
            </label>
            <label>
              Words and phrases to avoid in conversations
              <input
                value={avoidWords}
                onChange={(event) => setAvoidWords(event.target.value)}
                placeholder="e.g. abusive terms"
              />
            </label>
            <div className="journey-actions">
              <button type="button" className="primary-btn" disabled={!canGoStep1 || loading} onClick={handleStep1Proceed}>
                Proceed
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="journey-step">
            <label>
              Do's
              <textarea
                rows={5}
                value={doRules}
                onChange={(event) => setDoRules(event.target.value)}
                placeholder="e.g. Be concise, use friendly language, offer next steps."
              />
            </label>
            <label>
              Don'ts
              <textarea
                rows={5}
                value={dontRules}
                onChange={(event) => setDontRules(event.target.value)}
                placeholder="e.g. Don't guess policy details, don't promise unavailable actions."
              />
            </label>
            <div className="journey-actions">
              <button type="button" className="primary-btn" disabled={loading} onClick={handleStep2Proceed}>
                Proceed
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="journey-step">
            <div className="journey-inline-pills">
              <button type="button" className={knowledgeMode === "website" ? "active" : ""} onClick={() => setKnowledgeMode("website")}>
                Website
              </button>
              <button type="button" className={knowledgeMode === "file" ? "active" : ""} onClick={() => setKnowledgeMode("file")}>
                Document Upload
              </button>
              <button type="button" className={knowledgeMode === "manual" ? "active" : ""} onClick={() => setKnowledgeMode("manual")}>
                Manually
              </button>
            </div>

            {knowledgeMode === "website" && (
              <label>
                Website URL
                <input placeholder="e.g. yourwebsite.com/url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
              </label>
            )}

            {knowledgeMode === "manual" && (
              <label>
                Manual Knowledge
                <textarea
                  rows={5}
                  placeholder="Add FAQs, policies, pricing rules, service details..."
                  value={manualText}
                  onChange={(event) => setManualText(event.target.value)}
                />
              </label>
            )}

            {knowledgeMode === "file" && (
              <label>
                Document files
                <input
                  type="file"
                  accept=".pdf,.txt,.doc,.docx,.xls,.xlsx,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    const accepted = files.filter(
                      (file) => isSupportedKnowledgeFile(file) && file.size <= MAX_KNOWLEDGE_FILE_UPLOAD_BYTES
                    );
                    setKnowledgeFiles(accepted);
                  }}
                />
                {knowledgeFiles.length > 0 && <small className="journey-muted">{knowledgeFiles.length} file(s) selected</small>}
              </label>
            )}

            <div className="journey-actions">
              <button type="button" className="primary-btn" disabled={!canProceedKnowledge || loading} onClick={() => void handleStep3Proceed()}>
                {loading ? "Processing..." : "Proceed"}
              </button>
              <button type="button" className="ghost-btn" disabled={loading} onClick={() => void handleSkipKnowledge()}>
                Skip for now
              </button>
            </div>
          </section>
        )}

        {isTraining && (
          <section className="journey-training">
            <div className="journey-bot-pulse" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>Training your chatbot</p>
            <div className="journey-progress-track">
              <div className="journey-progress-value" style={{ width: `${trainingProgress}%` }} />
            </div>
          </section>
        )}

        {step === 4 && !isTraining && (
          <section className="journey-step">
            <article className="journey-chat-preview">
              <header>
                <strong>{botName || "Your Bot"}</strong>
              </header>
              <div className="journey-chat-scroll">
                {chatRows.map((row) => (
                  <div key={row.id} className={row.sender === "bot" ? "bot-row" : "user-row"}>
                    <p>{row.text}</p>
                    <small>{row.time}</small>
                  </div>
                ))}
                {botTyping && <div className="bot-row typing">Typing...</div>}
              </div>
              <form className="journey-chat-input" onSubmit={handleSendTestChat}>
                <input placeholder="Type here..." value={chatInput} onChange={(event) => setChatInput(event.target.value)} />
                <button type="submit" aria-label="Send">
                  {"->"}
                </button>
              </form>
              <small className="journey-powered">Powered by WAgen AI</small>
            </article>

            <div className="journey-actions center">
              <button type="button" className="primary-btn" onClick={() => navigate("/dashboard?tab=knowledge")}>
                Improve quality of answers
              </button>
              <button type="button" className="ghost-btn" onClick={() => navigate("/dashboard?tab=settings")}>
                Choose channel (QR / API)
              </button>
              <button type="button" className="link-btn" onClick={() => void handleFinish()}>
                Go to Dashboard
              </button>
            </div>
          </section>
        )}

        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
