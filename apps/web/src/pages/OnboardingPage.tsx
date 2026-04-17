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
  updateMyProfile,
  type BusinessBasicsPayload,
  type KnowledgeIngestJob
} from "../lib/api";

type JourneyStep = 1 | 2 | 3 | 4 | 5;
type KnowledgeMode = "website" | "file" | "manual";
type PhoneStep = "idle" | "sent" | "verifying" | "done" | "error";

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
const TOTAL_STEPS = 5;
const MOCK_OTP = "0000";

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
  if (typeof value !== "string") return fallback;
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

  // Start at step 1 (phone verify) unless already verified
  const [step, setStep] = useState<JourneyStep>(() => (user?.phone_verified ? 2 : 1));
  const [isTraining, setIsTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1: Phone verify (mock OTP) ─────────────────────────────────────
  const [phone, setPhone] = useState(user?.phone_number ?? "");
  const [otp, setOtp] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>(
    user?.phone_verified ? "done" : "idle"
  );
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const sendOtp = () => {
    setPhoneError(null);
    const normalized = phone.trim();
    if (!normalized.startsWith("+") || normalized.length < 8) {
      setPhoneError("Enter phone in international format: +91XXXXXXXXXX");
      return;
    }
    // Mock: just advance to OTP entry — no real SMS sent yet
    setPhoneStep("sent");
  };

  const verifyOtp = async () => {
    setPhoneError(null);
    if (otp.trim() !== MOCK_OTP) {
      setPhoneError(`Incorrect OTP. (Use ${MOCK_OTP} during testing.)`);
      return;
    }
    setPhoneStep("verifying");
    try {
      if (token) {
        await updateMyProfile(token, { phoneNumber: phone.trim(), phoneVerified: true });
        await refreshUser();
      }
      setPhoneStep("done");
    } catch (e) {
      setPhoneError((e as Error).message);
      setPhoneStep("sent");
    }
  };

  // ── Step 2: Bot identity ─────────────────────────────────────────────────
  const [botName, setBotName] = useState(readSavedString(savedBasics.companyName, user?.name ?? ""));
  const [businessAbout, setBusinessAbout] = useState(readSavedString(savedBasics.whatDoYouSell, ""));
  const [unknownReply, setUnknownReply] = useState(
    readSavedString(savedBasics.complaintHandlingScript, "Sorry, I don't have information on this yet.")
  );
  const [avoidWords, setAvoidWords] = useState(readSavedString(savedBasics.objections, ""));
  const [doRules, setDoRules] = useState(readSavedString(savedBasics.aiDoRules, ""));
  const [dontRules, setDontRules] = useState(readSavedString(savedBasics.aiDontRules, ""));

  // ── Step 4: Knowledge ────────────────────────────────────────────────────
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>("website");
  const [websiteUrl, setWebsiteUrl] = useState(readSavedString(savedBasics.websiteUrl, ""));
  const [manualText, setManualText] = useState(readSavedString(savedBasics.manualFaq, ""));
  const [knowledgeFiles, setKnowledgeFiles] = useState<File[]>([]);

  // ── Step 5: Test chatbot ─────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const [chatRows, setChatRows] = useState<ChatRow[]>([firstBotMessage]);
  const [botTyping, setBotTyping] = useState(false);

  const canGoStep2 = botName.trim().length >= 2 && businessAbout.trim().length >= 2;
  const canProceedKnowledge = useMemo(() => {
    if (knowledgeMode === "website") return websiteUrl.trim().length > 0;
    if (knowledgeMode === "manual") return manualText.trim().length >= 20;
    return knowledgeFiles.length > 0;
  }, [knowledgeMode, knowledgeFiles, manualText, websiteUrl]);

  const progressTicks = [24, 41, 57, 73, 88, 100];

  const persistBusinessProfile = async () => {
    if (!token) return;
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
    if (!token) return;
    if (jobIds.length === 0) throw new Error("Could not start knowledge upload. Please try again.");
    const startedAt = Date.now();
    while (Date.now() - startedAt < KNOWLEDGE_UPLOAD_TIMEOUT_MS) {
      const response = await fetchIngestionJobs(token, jobIds);
      const failedJobs = response.jobs.filter((job) => job.status === "failed");
      if (failedJobs.length > 0) throw new Error(formatKnowledgeUploadFailure(failedJobs));
      const allCompleted =
        response.jobs.length === jobIds.length &&
        response.jobs.every((job) => job.status === "completed" || Boolean(job.completed_at) || job.progress >= 100);
      if (allCompleted) return;
      await new Promise((resolve) => setTimeout(resolve, KNOWLEDGE_UPLOAD_POLL_INTERVAL_MS));
    }
    throw new Error("Knowledge upload is taking longer than expected. Please check the Knowledge Base page in Dashboard.");
  };

  const ingestKnowledge = async () => {
    if (!token) return;
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
    setStep(5);
  };

  const ensureAgentEnabled = async () => {
    if (!token) return;
    await setAgentActive(token, true);
  };

  // Step handlers
  const handleStep1Proceed = () => { setError(null); setStep(2); };

  const handleStep2Proceed = () => {
    if (!canGoStep2) { setError("Enter bot identity details to continue."); return; }
    setError(null);
    setStep(3);
  };

  const handleStep3Proceed = () => { setError(null); setStep(4); };

  const handleStep4Proceed = async () => {
    if (!token) return;
    if (!canProceedKnowledge) { setError("Add one knowledge source first, or use skip."); return; }
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
    if (!token) return;
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
    if (!text || botTyping || !token) return;
    const userMessage: ChatRow = { id: `u-${Date.now()}`, sender: "user", text, time: nowTimeLabel() };
    const historyRows = [...chatRows, userMessage];
    setChatRows(historyRows);
    setChatInput("");
    setBotTyping(true);
    try {
      const response = await requestTestChatbotReply(token, {
        message: text,
        history: historyRows.map((row) => ({ sender: row.sender, text: row.text }))
      });
      setChatRows((current) => [
        ...current,
        { id: `b-${Date.now()}`, sender: "bot", text: response.reply, time: nowTimeLabel() }
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

  const stepTitles: Record<JourneyStep, string> = {
    1: "Verify your phone number",
    2: "Set your bot identity",
    3: "Define custom instructions",
    4: "Add initial knowledge base",
    5: "Test your chatbot"
  };

  const stepSubs: Record<JourneyStep, string> = {
    1: "We'll send a one-time code to confirm your number.",
    2: "Only the essential setup fields.",
    3: "Add do's and don'ts for how your bot should behave.",
    4: "Import website, documents, or manual content to train responses.",
    5: "Ask sample questions and check answer quality."
  };

  return (
    <main className="journey-shell">
      <section className="journey-card">
        <header className="journey-header">
          <p className="journey-step-count">Step {step} of {TOTAL_STEPS}</p>
          <h1>{stepTitles[step]}</h1>
          <p className="journey-sub">{stepSubs[step]}</p>
          <nav className="journey-stepper" aria-label="Onboarding steps">
            {[1, 2, 3, 4, 5].map((item) => (
              <span key={item} className={item <= step ? "active" : ""} />
            ))}
          </nav>
        </header>

        {/* ── Step 1: Phone verification ────────────────────────────────── */}
        {step === 1 && (
          <section className="journey-step">
            {phoneStep === "done" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    padding: "0.85rem 1rem",
                    borderRadius: "10px",
                    background: "#dcfce7",
                    border: "1px solid #bbf7d0"
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>✓</span>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 700, color: "#166534" }}>
                      Phone verified
                    </p>
                    <p style={{ margin: 0, fontSize: "0.78rem", color: "#166534" }}>{phone}</p>
                  </div>
                </div>
                <div className="journey-actions">
                  <button type="button" className="primary-btn" onClick={handleStep1Proceed}>
                    Continue
                  </button>
                </div>
              </div>
            ) : (
              <>
                {(phoneStep === "idle" || phoneStep === "error") && (
                  <>
                    <label>
                      Phone number
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91XXXXXXXXXX"
                      />
                      <small className="journey-muted">Include country code — e.g. +91 for India</small>
                    </label>
                    {phoneError && <p className="error-text">{phoneError}</p>}
                    <div className="journey-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={sendOtp}
                        disabled={phone.trim().length < 8}
                      >
                        Send OTP
                      </button>
                      <button type="button" className="ghost-btn" onClick={handleStep1Proceed}>
                        Skip for now
                      </button>
                    </div>
                  </>
                )}

                {(phoneStep === "sent" || phoneStep === "verifying") && (
                  <>
                    <p style={{ fontSize: "0.83rem", color: "#334155" }}>
                      OTP sent to <strong>{phone}</strong>. Enter the 4-digit code below.
                    </p>
                    <label>
                      One-time code
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                        placeholder="0000"
                        autoFocus
                      />
                    </label>
                    {phoneError && <p className="error-text">{phoneError}</p>}
                    <div className="journey-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => { setPhoneStep("idle"); setOtp(""); setPhoneError(null); }}
                        disabled={phoneStep === "verifying"}
                      >
                        Change number
                      </button>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => void verifyOtp()}
                        disabled={phoneStep === "verifying" || otp.length !== 4}
                      >
                        {phoneStep === "verifying" ? "Verifying…" : "Verify OTP"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* ── Step 2: Bot identity ──────────────────────────────────────── */}
        {step === 2 && (
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
              <button type="button" className="primary-btn" disabled={!canGoStep2 || loading} onClick={handleStep2Proceed}>
                Proceed
              </button>
            </div>
          </section>
        )}

        {/* ── Step 3: Custom instructions ───────────────────────────────── */}
        {step === 3 && (
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
              <button type="button" className="primary-btn" disabled={loading} onClick={handleStep3Proceed}>
                Proceed
              </button>
            </div>
          </section>
        )}

        {/* ── Step 4: Knowledge base ────────────────────────────────────── */}
        {step === 4 && (
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
              <button type="button" className="primary-btn" disabled={!canProceedKnowledge || loading} onClick={() => void handleStep4Proceed()}>
                {loading ? "Processing..." : "Proceed"}
              </button>
              <button type="button" className="ghost-btn" disabled={loading} onClick={() => void handleSkipKnowledge()}>
                Skip for now
              </button>
            </div>
          </section>
        )}

        {/* ── Training animation ────────────────────────────────────────── */}
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

        {/* ── Step 5: Test chatbot ──────────────────────────────────────── */}
        {step === 5 && !isTraining && (
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
