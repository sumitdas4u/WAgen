import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  autofillOnboarding,
  connectWhatsApp,
  deleteKnowledgeSource,
  fetchIngestionJobs,
  fetchKnowledgeSources,
  fetchWhatsAppStatus,
  ingestManual,
  ingestPdf,
  ingestWebsite,
  saveBusinessBasics,
  savePersonality,
  setAgentActive,
  type BusinessBasicsPayload,
  type KnowledgeIngestJob,
  type KnowledgeSource
} from "../lib/api";
import { useRealtime } from "../lib/use-realtime";

const PERSONALITIES = [
  { key: "friendly_warm", label: "Friendly & Warm" },
  { key: "professional", label: "Professional" },
  { key: "hard_closer", label: "Hard Closer" },
  { key: "premium_consultant", label: "Premium Consultant" },
  { key: "custom", label: "Custom Prompt" }
] as const;

type PlaybookKey =
  | "greetingScript"
  | "availabilityScript"
  | "objectionHandlingScript"
  | "bookingScript"
  | "feedbackCollectionScript"
  | "complaintHandlingScript";

const SUPPORT_PLAYBOOKS: Array<{
  index: number;
  key: PlaybookKey;
  title: string;
  hint: string;
  defaultValue: string;
  placeholder: string;
}> = [
  {
    index: 1,
    key: "greetingScript",
    title: "Greeting",
    hint: "How the AI should welcome customers.",
    defaultValue: "Greet politely, introduce yourself as support, and ask how you can help.",
    placeholder: "How should AI greet customers?"
  },
  {
    index: 2,
    key: "availabilityScript",
    title: "Availability",
    hint: "How to respond for stock, timing, and service availability.",
    defaultValue:
      "Share availability and timelines clearly. If unavailable, offer the next available option and expected time.",
    placeholder: "How should AI handle availability questions?"
  },
  {
    index: 3,
    key: "objectionHandlingScript",
    title: "Objection Handling",
    hint: "How to handle concerns and hesitation.",
    defaultValue:
      "Acknowledge concern first, explain clearly with empathy, and provide a practical next support step.",
    placeholder: "How should AI handle objections?"
  },
  {
    index: 4,
    key: "bookingScript",
    title: "Booking",
    hint: "How to assist with booking requests.",
    defaultValue:
      "Confirm booking intent, collect necessary details, and provide a clear next step to complete the booking.",
    placeholder: "How should AI assist in booking?"
  },
  {
    index: 5,
    key: "feedbackCollectionScript",
    title: "Feedback Collection",
    hint: "How to collect feedback after support.",
    defaultValue:
      "Thank the customer, ask for concise feedback, and capture one suggestion to improve support quality.",
    placeholder: "How should AI collect feedback?"
  },
  {
    index: 6,
    key: "complaintHandlingScript",
    title: "Complaint Handling",
    hint: "How to de-escalate and resolve complaints.",
    defaultValue:
      "Apologize clearly, acknowledge the issue, share corrective action, and provide escalation contact if needed.",
    placeholder: "How should AI handle complaints?"
  }
];

const COUNTRY_OPTIONS = [
  { code: "IN", label: "India" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "AE", label: "UAE" },
  { code: "SA", label: "Saudi Arabia" },
  { code: "SG", label: "Singapore" },
  { code: "MY", label: "Malaysia" },
  { code: "AU", label: "Australia" },
  { code: "CA", label: "Canada" }
];

const CURRENCY_OPTIONS = ["INR", "USD", "GBP", "AED", "SAR", "SGD", "MYR", "AUD", "CAD", "EUR"];
const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;

const DEFAULT_BUSINESS_BASICS: BusinessBasicsPayload = {
  whatDoYouSell: "",
  targetAudience: "",
  usp: "",
  objections: "",
  defaultCountry: "IN",
  defaultCurrency: "INR",
  greetingScript: SUPPORT_PLAYBOOKS[0].defaultValue,
  availabilityScript: SUPPORT_PLAYBOOKS[1].defaultValue,
  objectionHandlingScript: SUPPORT_PLAYBOOKS[2].defaultValue,
  bookingScript: SUPPORT_PLAYBOOKS[3].defaultValue,
  feedbackCollectionScript: SUPPORT_PLAYBOOKS[4].defaultValue,
  complaintHandlingScript: SUPPORT_PLAYBOOKS[5].defaultValue,
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

export function OnboardingPage() {
  const { token, user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState(1);
  const [waStatus, setWaStatus] = useState<"not_connected" | "connecting" | "waiting_scan" | "connected">(
    "not_connected"
  );
  const [qrText, setQrText] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [personality, setPersonality] = useState<(typeof PERSONALITIES)[number]["key"]>("friendly_warm");
  const [error, setError] = useState<string | null>(null);
  const [businessBasics, setBusinessBasics] = useState<BusinessBasicsPayload>(DEFAULT_BUSINESS_BASICS);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [manualFaq, setManualFaq] = useState("");
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadedPdfSources, setUploadedPdfSources] = useState<KnowledgeSource[]>([]);
  const [businessDescription, setBusinessDescription] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
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
  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setBusinessBasics(loadSavedBusinessBasics(user?.business_basics));
  }, [user?.business_basics]);

  const refreshUploadedPdfs = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const response = await fetchKnowledgeSources(token, { sourceType: "pdf" });
      setUploadedPdfSources(response.sources);
    } catch {
      setUploadedPdfSources([]);
    }
  }, [token]);

  const updateUploadItem = useCallback(
    (
      id: string,
      patch: Partial<{
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
    ) => {
      setPdfUploadItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    []
  );

  const stopUploadPolling = useCallback(() => {
    if (uploadPollRef.current) {
      clearInterval(uploadPollRef.current);
      uploadPollRef.current = null;
    }
  }, []);

  const applyJobToItem = useCallback(
    (job: KnowledgeIngestJob) => {
      const effectivelyCompleted =
        job.status === "completed" ||
        Boolean(job.completed_at) ||
        (job.progress >= 100 && job.stage.toLowerCase() === "completed");

      setPdfUploadItems((current) =>
        current.map((item) => {
          if (item.jobId !== job.id) {
            return item;
          }

          if (effectivelyCompleted) {
            return {
              ...item,
              status: "done",
              stage: "Completed",
              progress: 100,
              chunks: job.chunks_created,
              error: undefined
            };
          }

          if (job.status === "failed") {
            return {
              ...item,
              status: "error",
              stage: "Failed",
              progress: 100,
              error: job.error_message || "upload error"
            };
          }

          return {
            ...item,
            status: "uploading",
            stage: job.stage || "Processing",
            progress: job.progress ?? 0,
            chunks: job.chunks_created || undefined,
            error: undefined
          };
        })
      );
    },
    []
  );

  const syncIngestionJobs = useCallback(
    async (jobIds: string[]) => {
      if (!token || jobIds.length === 0) {
        stopUploadPolling();
        setUploadingFiles(false);
        return;
      }

      const response = await fetchIngestionJobs(token, jobIds);
      response.jobs.forEach((job) => applyJobToItem(job));

      const pending = response.jobs.some((job) => {
        const done =
          job.status === "completed" ||
          Boolean(job.completed_at) ||
          (job.progress >= 100 && job.stage.toLowerCase() === "completed");
        return !done && (job.status === "queued" || job.status === "processing");
      });
      if (!pending) {
        stopUploadPolling();
        setUploadingFiles(false);
        await refreshUploadedPdfs();
      }
    },
    [applyJobToItem, refreshUploadedPdfs, stopUploadPolling, token]
  );

  const queuePdfUploads = useCallback(
    (files: File[]) => {
      if (!token || files.length === 0) {
        return;
      }

      if (uploadingFiles) {
        setError("A PDF upload is already running. Please wait for it to finish.");
        return;
      }

      const accepted: File[] = [];
      const rejected: Array<{ file: File; reason: string }> = [];
      for (const file of files) {
        if (file.type !== "application/pdf") {
          rejected.push({ file, reason: "Only PDF files are allowed." });
          continue;
        }
        if (file.size > MAX_PDF_UPLOAD_BYTES) {
          rejected.push({
            file,
            reason: `File exceeds 20MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`
          });
          continue;
        }
        accepted.push(file);
      }

      if (rejected.length > 0) {
        const rejectedItems = rejected.map((entry) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${entry.file.name}`,
          name: entry.file.name,
          size: entry.file.size,
          status: "error" as const,
          stage: "Failed",
          progress: 100,
          error: entry.reason
        }));
        setPdfUploadItems((current) => [...rejectedItems, ...current].slice(0, 30));
      }

      if (accepted.length === 0) {
        return;
      }

      const queued = accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`,
        name: file.name,
        size: file.size,
        status: "queued" as const,
        stage: "Uploading file",
        progress: 0
      }));

      setPdfUploadItems((current) => [...queued, ...current].slice(0, 30));

      setUploadingFiles(true);
      stopUploadPolling();

      void ingestPdf(token, accepted)
        .then(async (response) => {
          const jobIds: string[] = [];
          for (let index = 0; index < queued.length; index += 1) {
            const item = queued[index];
            const job = response.jobs[index];
            if (!item) {
              continue;
            }

            if (!job) {
              updateUploadItem(item.id, {
                status: "error",
                stage: "Failed",
                progress: 100,
                error: "Upload job was not created"
              });
              continue;
            }

            jobIds.push(job.id);
            updateUploadItem(item.id, {
              jobId: job.id,
              status: "uploading",
              stage: job.stage || "Queued",
              progress: job.progress ?? 0,
              error: undefined
            });
          }

          if (jobIds.length === 0) {
            setUploadingFiles(false);
            return;
          }

          await syncIngestionJobs(jobIds).catch(() => undefined);
          uploadPollRef.current = setInterval(() => {
            void syncIngestionJobs(jobIds).catch((error) => {
              const message = (error as Error).message || "Failed to sync upload status";
              setPdfUploadItems((current) =>
                current.map((item) =>
                  item.jobId && jobIds.includes(item.jobId)
                    ? { ...item, status: "error", stage: "Failed", progress: 100, error: message }
                    : item
                )
              );
              stopUploadPolling();
              setUploadingFiles(false);
            });
          }, 1500);
        })
        .catch((uploadError) => {
          const message = (uploadError as Error).message;
          queued.forEach((item) => {
            updateUploadItem(item.id, {
              status: "error",
              stage: "Failed",
              progress: 100,
              error: message
            });
          });
          setUploadingFiles(false);
        });
    },
    [stopUploadPolling, syncIngestionJobs, token, updateUploadItem, uploadingFiles]
  );

  useEffect(() => {
    void refreshUploadedPdfs();
  }, [refreshUploadedPdfs]);

  useEffect(
    () => () => {
      stopUploadPolling();
    },
    [stopUploadPolling]
  );

  useRealtime(
    token,
    useCallback((event) => {
      if (event.event === "whatsapp.qr") {
        const payload = event.data as { qr: string };
        setWaStatus("waiting_scan");
        setQrText(payload.qr);
      }

      if (event.event === "whatsapp.status") {
        const payload = event.data as { status: string };
        if (payload.status === "connected") {
          setWaStatus("connected");
          setQrText(null);
          setTimeout(() => {
            setStep((current) => (current >= 2 ? Math.max(current, 3) : current));
          }, 900);
        }
        if (payload.status === "connecting") {
          setWaStatus("connecting");
        }
        if (payload.status === "disconnected") {
          setWaStatus("not_connected");
          setQrText(null);
          setStep((current) => (current <= 3 ? 2 : current));
        }
      }
    }, [])
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    void fetchWhatsAppStatus(token).then((status) => {
      const forceQr = new URLSearchParams(location.search).get("focus") === "qr";
      if (status.status === "connected") {
        setWaStatus("connected");
        if (forceQr) {
          setStep(2);
        }
      } else if (status.status === "connecting") {
        setWaStatus(status.qr ? "waiting_scan" : "connecting");
        setQrText(status.qr);
        setStep(2);
      } else {
        setWaStatus("not_connected");
        setQrText(null);
        setStep(2);
      }
    });
  }, [location.search, token]);

  useEffect(() => {
    if (!token || step !== 2) {
      return;
    }

    const timer = setInterval(() => {
      void fetchWhatsAppStatus(token)
        .then((status) => {
          if (status.status === "connected") {
            setWaStatus("connected");
            setQrText(null);
            setStep(3);
            return;
          }

          if (status.status === "connecting") {
            setWaStatus(status.qr ? "waiting_scan" : "connecting");
            setQrText(status.qr);
            return;
          }

          setWaStatus("not_connected");
          setQrText(null);
        })
        .catch(() => undefined);
    }, 2000);

    return () => clearInterval(timer);
  }, [step, token]);

  useEffect(() => {
    if (!qrText) {
      setQrImage(null);
      return;
    }

    void QRCode.toDataURL(qrText, {
      margin: 1,
      color: {
        dark: "#02102A",
        light: "#ECF7FF"
      }
    }).then(setQrImage);
  }, [qrText]);

  const statusLabel = useMemo(() => {
    if (waStatus === "connected") {
      return "Connected";
    }
    if (waStatus === "waiting_scan") {
      return "Scan Required";
    }
    if (waStatus === "connecting") {
      return "Connecting";
    }
    return "Not Connected";
  }, [waStatus]);

  const handleBasicsChange = (field: keyof BusinessBasicsPayload, value: string) => {
    setBusinessBasics((previous) => ({
      ...previous,
      [field]: value
    }));
  };

  const handleAutofill = async () => {
    if (!token) {
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const response = await autofillOnboarding(token, businessDescription);
      setBusinessBasics(response.draft.businessBasics);
      setPersonality(response.draft.personality);
      setCustomPrompt(response.draft.customPrompt || "");
      setStep(waStatus === "connected" ? 3 : 2);
    } catch (autofillError) {
      setError((autofillError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartConnection = async () => {
    if (!token) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await connectWhatsApp(token);
      setWaStatus("connecting");
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleTrain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    const payload: BusinessBasicsPayload = {
      ...businessBasics,
      defaultCountry: businessBasics.defaultCountry.trim().toUpperCase() || "IN",
      defaultCurrency: businessBasics.defaultCurrency.trim().toUpperCase() || "INR"
    };

    setError(null);
    setLoading(true);
    setProcessingLog(["Saving business profile, support playbooks, and agent guardrails..."]);

    try {
      await saveBusinessBasics(token, payload);
      await refreshUser();

      if (websiteUrl) {
        setProcessingLog((previous) => [...previous, "Reading website and generating vectors..."]);
        await ingestWebsite(token, websiteUrl);
      }

      if (manualFaq.trim().length > 20) {
        setProcessingLog((previous) => [...previous, "Converting FAQ into knowledge chunks..."]);
        await ingestManual(token, manualFaq.trim());
      }

      setProcessingLog((previous) => [...previous, "Support AI knowledge is ready."]);
      setStep(4);
    } catch (trainError) {
      setError((trainError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const removeUploadItem = (id: string) => {
    setPdfUploadItems((current) => current.filter((item) => item.id !== id));
  };

  const handleDeleteUploadedPdf = async (sourceName: string) => {
    if (!token) {
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await deleteKnowledgeSource(token, { sourceType: "pdf", sourceName });
      await refreshUploadedPdfs();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersonality = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await savePersonality(token, {
        personality,
        customPrompt: personality === "custom" ? customPrompt.trim() : undefined
      });
      setStep(5);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!token) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await setAgentActive(token, true);
      await refreshUser();
      navigate("/dashboard", { replace: true });
    } catch (activateError) {
      setError((activateError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="onboarding-shell">
      <aside className="wizard-steps">
        {["AI Prefill", "Connect WhatsApp", "Train AI", "Choose Personality", "Activate"].map((label, index) => {
          const current = index + 1;
          const status = step === current ? "current" : step > current ? "done" : "pending";
          return (
            <div key={label} className={`wizard-step ${status}`}>
              <strong>{current}</strong>
              <span>{label}</span>
            </div>
          );
        })}
      </aside>

      <section className="wizard-content">
        {step === 1 && (
          <article className="panel">
            <h1>Describe Your Agent and Business</h1>
            <p>Tell us what your business does and how your AI agent should behave. We will prefill onboarding for review.</p>
            <label>
              Business + agent description
              <textarea
                value={businessDescription}
                placeholder="Example: We are a D2C skincare brand in India. Customers ask about ingredients, shipping, and refunds. Tone should be warm and professional..."
                onChange={(event) => setBusinessDescription(event.target.value)}
                rows={8}
              />
            </label>
            <div className="chat-actions">
              <button
                className="primary-btn"
                disabled={loading || businessDescription.trim().length < 20}
                onClick={handleAutofill}
                type="button"
              >
                {loading ? "Generating..." : "Auto-fill with AI"}
              </button>
              <button
                className="ghost-btn"
                disabled={loading}
                onClick={() => setStep(waStatus === "connected" ? 3 : 2)}
                type="button"
              >
                Skip and fill manually
              </button>
            </div>
          </article>
        )}

        {step === 2 && (
          <article className="panel">
            <h1>Connect Your WhatsApp</h1>
            <p>Open WhatsApp &gt; Linked Devices &gt; Scan QR.</p>

            <div className="qr-zone">
              {qrImage ? <img src={qrImage} alt="WhatsApp QR" /> : <div className="qr-placeholder">QR appears here</div>}
            </div>

            <p className={`status-pill status-${waStatus}`}>{statusLabel}</p>

            <button className="primary-btn" disabled={loading} onClick={handleStartConnection}>
              {loading ? "Connecting..." : "Generate QR"}
            </button>
          </article>
        )}

        {step === 3 && (
          <article className="panel train-panel">
            <h1>Train Your WAgen</h1>
            <p>Configure customer support behavior, guardrails, and escalation contacts.</p>

            <form className="stack-form train-form" onSubmit={handleTrain}>
              <section className="train-section">
                <h3>Business Basics</h3>
                <div className="train-grid two-col">
                  <label>
                    What do you support?
                    <input
                      name="whatDoYouSell"
                      required
                      placeholder="Example: Salon appointments and order support"
                      value={businessBasics.whatDoYouSell}
                      onChange={(event) => handleBasicsChange("whatDoYouSell", event.target.value)}
                    />
                  </label>
                  <label>
                    Target audience
                    <input
                      name="targetAudience"
                      required
                      placeholder="Example: local customers and repeat buyers"
                      value={businessBasics.targetAudience}
                      onChange={(event) => handleBasicsChange("targetAudience", event.target.value)}
                    />
                  </label>
                  <label>
                    Core promise / USP
                    <textarea
                      name="usp"
                      required
                      placeholder="What support quality promise do you make?"
                      value={businessBasics.usp}
                      onChange={(event) => handleBasicsChange("usp", event.target.value)}
                    />
                  </label>
                  <label>
                    Common customer issues
                    <textarea
                      name="objections"
                      required
                      placeholder="Late delivery, service timing, missing item, app issue..."
                      value={businessBasics.objections}
                      onChange={(event) => handleBasicsChange("objections", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="train-section">
                <h3>Regional Reply Settings</h3>
                <div className="train-grid two-col">
                  <label>
                    Default country
                    <select
                      name="defaultCountry"
                      value={businessBasics.defaultCountry}
                      onChange={(event) => handleBasicsChange("defaultCountry", event.target.value)}
                    >
                      {COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Default currency
                    <input
                      name="defaultCurrency"
                      value={businessBasics.defaultCurrency}
                      list="currency-list"
                      required
                      onChange={(event) => handleBasicsChange("defaultCurrency", event.target.value)}
                    />
                  </label>
                </div>
                <datalist id="currency-list">
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency} />
                  ))}
                </datalist>
                <p className="tiny-note">Currency format follows user phone country code when available.</p>
              </section>

              <section className="train-section">
                <h3>Customer Support Playbooks</h3>
                <p>Define how your AI agent should respond in each support scenario.</p>
                <div className="scenario-grid">
                  {SUPPORT_PLAYBOOKS.map((playbook) => (
                    <label key={playbook.key} className="scenario-card">
                      <span className="scenario-badge">{playbook.index}</span>
                      <strong>{playbook.title}</strong>
                      <small>{playbook.hint}</small>
                      <textarea
                        name={playbook.key}
                        required
                        value={businessBasics[playbook.key]}
                        placeholder={playbook.placeholder}
                        onChange={(event) => handleBasicsChange(playbook.key, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="train-section">
                <h3>Support Escalation Contact</h3>
                <div className="train-grid two-col">
                  <label>
                    Contact name
                    <input
                      name="supportContactName"
                      required
                      placeholder="Example: Priya Sharma"
                      value={businessBasics.supportContactName}
                      onChange={(event) => handleBasicsChange("supportContactName", event.target.value)}
                    />
                  </label>
                  <label>
                    Phone number
                    <input
                      name="supportPhoneNumber"
                      required
                      placeholder="Example: +91 98765 43210"
                      value={businessBasics.supportPhoneNumber}
                      onChange={(event) => handleBasicsChange("supportPhoneNumber", event.target.value)}
                    />
                  </label>
                  <label>
                    Support email
                    <input
                      name="supportEmail"
                      type="email"
                      placeholder="support@yourcompany.com"
                      value={businessBasics.supportEmail}
                      onChange={(event) => handleBasicsChange("supportEmail", event.target.value)}
                    />
                  </label>
                  <label>
                    Support address
                    <textarea
                      name="supportAddress"
                      placeholder="Full support office/service address"
                      value={businessBasics.supportAddress}
                      onChange={(event) => handleBasicsChange("supportAddress", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="train-section">
                <h3>AI Guardrails</h3>
                <div className="train-grid two-col">
                  <label>
                    AI Do
                    <textarea
                      name="aiDoRules"
                      required
                      placeholder="Rules the AI must follow"
                      value={businessBasics.aiDoRules}
                      onChange={(event) => handleBasicsChange("aiDoRules", event.target.value)}
                    />
                  </label>
                  <label>
                    AI Don&apos;t
                    <textarea
                      name="aiDontRules"
                      required
                      placeholder="Rules the AI must never do"
                      value={businessBasics.aiDontRules}
                      onChange={(event) => handleBasicsChange("aiDontRules", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="train-section">
                <h3>Knowledge Sources</h3>
                <div className="train-grid two-col">
                  <label>
                    Website URL
                    <input
                      name="websiteUrl"
                      type="url"
                      placeholder="https://yourcompany.com"
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                    />
                  </label>
                  <label>
                    Upload PDF(s)
                    <input
                      name="pdfFiles"
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        queuePdfUploads(files);
                        event.currentTarget.value = "";
                      }}
                    />
                    {pdfUploadItems.length > 0 && (
                      <div className="file-chip-list">
                        {pdfUploadItems.map((item) => (
                          <span className="file-chip" key={item.id}>
                            {item.name}{" "}
                            {item.status === "uploading"
                              ? `${item.stage || "Uploading file"} (${item.progress ?? 0}%)`
                              : item.status === "done"
                                ? `Done (${item.chunks ?? 0} chunks)`
                                : item.status === "error"
                                  ? `Failed: ${item.error || "upload error"}`
                                  : "Queued"}
                            <button type="button" className="chip-remove" onClick={() => removeUploadItem(item.id)}>
                              Clear
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {uploadedPdfSources.length > 0 && (
                      <div className="uploaded-files-list">
                        <small className="tiny-note">Uploaded PDFs</small>
                        {uploadedPdfSources.map((source) => (
                          <div className="uploaded-file-row" key={`${source.source_name}-${source.last_ingested_at}`}>
                            <span>{source.source_name || "Untitled PDF"}</span>
                            {source.source_name ? (
                              <button
                                type="button"
                                className="ghost-btn"
                                disabled={loading}
                                onClick={() => handleDeleteUploadedPdf(source.source_name as string)}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                    <small className="tiny-note">
                      Files upload immediately after selection. You can upload multiple PDFs in one go.
                    </small>
                  </label>
                  <label className="full-span">
                    Manual FAQ
                    <textarea
                      name="manualFaq"
                      placeholder="Paste FAQs, policies, support scripts, and troubleshooting notes"
                      value={manualFaq}
                      onChange={(event) => setManualFaq(event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <button className="primary-btn" disabled={loading || uploadingFiles} type="submit">
                {uploadingFiles ? "Uploading files..." : loading ? "Processing..." : "Train My WAgen"}
              </button>
            </form>

            {processingLog.length > 0 && (
              <ul className="processing-list">
                {processingLog.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </article>
        )}

        {step === 4 && (
          <article className="panel">
            <h1>Choose WAgen Personality</h1>
            <form className="stack-form" onSubmit={handleSavePersonality}>
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
                  <textarea
                    name="customPrompt"
                    required
                    placeholder="Define your exact tone and support style"
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                  />
                </label>
              )}

              <button className="primary-btn" disabled={loading} type="submit">
                {loading ? "Saving..." : "Save Personality"}
              </button>
            </form>
          </article>
        )}

        {step === 5 && (
          <article className="panel activation-panel">
            <h1>Activate WAgen</h1>
            <p>Your WhatsApp AI is ready to go live.</p>
            <button className="primary-btn huge" disabled={loading} onClick={handleActivate}>
              {loading ? "Activating..." : "Activate WAgen"}
            </button>
          </article>
        )}

        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
