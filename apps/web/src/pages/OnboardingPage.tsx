import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import {
  connectWhatsApp,
  fetchWhatsAppStatus,
  ingestManual,
  ingestPdf,
  ingestWebsite,
  saveBusinessBasics,
  savePersonality,
  setAgentActive,
  type BusinessBasicsPayload
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
  | "pricingInquiryScript"
  | "availabilityScript"
  | "objectionHandlingScript"
  | "bookingScript"
  | "feedbackCollectionScript"
  | "complaintHandlingScript";

const SALES_PLAYBOOKS: Array<{
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
    hint: "How the AI opens the conversation.",
    defaultValue: "Greet warmly, mention the brand quickly, and ask one need-based question.",
    placeholder: "How should AI greet the lead?"
  },
  {
    index: 2,
    key: "pricingInquiryScript",
    title: "Pricing Inquiry",
    hint: "How to answer price questions.",
    defaultValue:
      "Share pricing clearly in the lead's currency, mention inclusions, and ask one qualifier about requirement or budget.",
    placeholder: "How should AI handle pricing questions?"
  },
  {
    index: 3,
    key: "availabilityScript",
    title: "Availability",
    hint: "How to answer stock/time-slot questions.",
    defaultValue:
      "Confirm current availability with clear timing. If unavailable, offer the nearest alternative and ask preference.",
    placeholder: "How should AI answer availability?"
  },
  {
    index: 4,
    key: "objectionHandlingScript",
    title: "Objection Handling",
    hint: "How to handle hesitation and concerns.",
    defaultValue:
      "Acknowledge concerns first, respond with proof/USP, keep tone calm, and move the lead forward with one question.",
    placeholder: "How should AI handle objections?"
  },
  {
    index: 5,
    key: "bookingScript",
    title: "Booking",
    hint: "How to convert into appointment/order.",
    defaultValue:
      "Confirm intent, ask date/time or order details, and give one simple next step to complete booking.",
    placeholder: "How should AI drive booking?"
  },
  {
    index: 6,
    key: "feedbackCollectionScript",
    title: "Feedback Collection",
    hint: "How to ask and process feedback.",
    defaultValue:
      "Thank the user, request concise feedback, and ask one follow-up about their experience or improvement ideas.",
    placeholder: "How should AI collect feedback?"
  },
  {
    index: 7,
    key: "complaintHandlingScript",
    title: "Complaint Handling",
    hint: "How to de-escalate and recover trust.",
    defaultValue:
      "Apologize sincerely, acknowledge the issue, offer corrective action or escalation, and confirm follow-up expectations.",
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

export function OnboardingPage() {
  const { token, refreshUser } = useAuth();
  const navigate = useNavigate();

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
            setStep((current) => Math.max(current, 2));
          }, 900);
        }
        if (payload.status === "connecting") {
          setWaStatus("connecting");
        }
        if (payload.status === "disconnected") {
          setWaStatus("not_connected");
        }
      }
    }, [])
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    void fetchWhatsAppStatus(token).then((status) => {
      if (status.status === "connected") {
        setWaStatus("connected");
        setStep(2);
      } else if (status.status === "connecting") {
        setWaStatus(status.qr ? "waiting_scan" : "connecting");
        setQrText(status.qr);
      }
    });
  }, [token]);

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

    const form = new FormData(event.currentTarget);
    const readValue = (name: string, fallback = "") => String(form.get(name) || fallback).trim();

    const businessBasics: BusinessBasicsPayload = {
      whatDoYouSell: readValue("whatDoYouSell"),
      priceRange: readValue("priceRange"),
      targetAudience: readValue("targetAudience"),
      usp: readValue("usp"),
      objections: readValue("objections"),
      defaultCountry: readValue("defaultCountry", "IN"),
      defaultCurrency: readValue("defaultCurrency", "INR").toUpperCase(),
      greetingScript: readValue("greetingScript"),
      pricingInquiryScript: readValue("pricingInquiryScript"),
      availabilityScript: readValue("availabilityScript"),
      objectionHandlingScript: readValue("objectionHandlingScript"),
      bookingScript: readValue("bookingScript"),
      feedbackCollectionScript: readValue("feedbackCollectionScript"),
      complaintHandlingScript: readValue("complaintHandlingScript")
    };

    const websiteUrl = readValue("websiteUrl");
    const manualFaq = readValue("manualFaq");
    const pdfFile = form.get("pdfFile") as File | null;

    setError(null);
    setLoading(true);
    setProcessingLog(["Saving business profile, playbooks, and locale settings..."]);

    try {
      await saveBusinessBasics(token, businessBasics);

      if (websiteUrl) {
        setProcessingLog((previous) => [...previous, "Reading website and generating vectors..."]);
        await ingestWebsite(token, websiteUrl);
      }

      if (manualFaq.length > 20) {
        setProcessingLog((previous) => [...previous, "Converting FAQ into knowledge chunks..."]);
        await ingestManual(token, manualFaq);
      }

      if (pdfFile && pdfFile.size > 0) {
        setProcessingLog((previous) => [...previous, "Parsing PDF and embedding content..."]);
        await ingestPdf(token, pdfFile);
      }

      setProcessingLog((previous) => [...previous, "AI playbooks and knowledge are ready."]);
      setStep(3);
    } catch (trainError) {
      setError((trainError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersonality = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const customPrompt = String(form.get("customPrompt") || "").trim();

    setError(null);
    setLoading(true);

    try {
      await savePersonality(token, {
        personality,
        customPrompt: personality === "custom" ? customPrompt : undefined
      });
      setStep(4);
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
        {["Connect WhatsApp", "Train AI", "Choose Personality", "Activate"].map((label, index) => {
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

        {step === 2 && (
          <article className="panel train-panel">
            <h1>Train Your WAgen</h1>
            <p>Configure full conversation playbooks and locale-aware pricing replies.</p>

            <form className="stack-form train-form" onSubmit={handleTrain}>
              <section className="train-section">
                <h3>Business Basics</h3>
                <div className="train-grid two-col">
                  <label>
                    What do you sell?
                    <input name="whatDoYouSell" required placeholder="Example: Restaurant services" />
                  </label>
                  <label>
                    Price range
                    <input name="priceRange" required placeholder="Example: 500-2500" />
                  </label>
                  <label>
                    Target audience
                    <input name="targetAudience" required placeholder="Example: local families and professionals" />
                  </label>
                  <label>
                    USP
                    <textarea name="usp" required placeholder="Why customers should choose you" />
                  </label>
                  <label className="full-span">
                    Common objections
                    <textarea name="objections" required placeholder="Budget, trust, delivery time, location..." />
                  </label>
                </div>
              </section>

              <section className="train-section">
                <h3>Regional Reply Settings</h3>
                <div className="train-grid two-col">
                  <label>
                    Default country
                    <select name="defaultCountry" defaultValue="IN">
                      {COUNTRY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Default currency
                    <input name="defaultCurrency" defaultValue="INR" list="currency-list" required />
                  </label>
                </div>
                <datalist id="currency-list">
                  {CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency} value={currency} />
                  ))}
                </datalist>
                <p className="tiny-note">
                  Replies auto-adapt by lead country code when possible (example: +91 uses INR, +1 uses USD).
                </p>
              </section>

              <section className="train-section">
                <h3>Conversation Flow Playbooks</h3>
                <p>Define exactly how your AI should respond at each stage.</p>
                <div className="scenario-grid">
                  {SALES_PLAYBOOKS.map((playbook) => (
                    <label key={playbook.key} className="scenario-card">
                      <span className="scenario-badge">{playbook.index}</span>
                      <strong>{playbook.title}</strong>
                      <small>{playbook.hint}</small>
                      <textarea
                        name={playbook.key}
                        required
                        defaultValue={playbook.defaultValue}
                        placeholder={playbook.placeholder}
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="train-section">
                <h3>Knowledge Sources</h3>
                <div className="train-grid two-col">
                  <label>
                    Website URL
                    <input name="websiteUrl" type="url" placeholder="https://yourcompany.com" />
                  </label>
                  <label>
                    Upload PDF
                    <input name="pdfFile" type="file" accept="application/pdf" />
                  </label>
                  <label className="full-span">
                    Manual FAQ
                    <textarea name="manualFaq" placeholder="Paste FAQs, menu details, policies, and product notes" />
                  </label>
                </div>
              </section>

              <button className="primary-btn" disabled={loading} type="submit">
                {loading ? "Processing..." : "Train My WAgen"}
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

        {step === 3 && (
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
                    placeholder="Define your exact tone, offer framing, and objection handling style"
                  />
                </label>
              )}

              <button className="primary-btn" disabled={loading} type="submit">
                {loading ? "Saving..." : "Save Personality"}
              </button>
            </form>
          </article>
        )}

        {step === 4 && (
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
