import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AgentProfile, BusinessBasicsPayload } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import type { DashboardModulePrefetchContext } from "../../../../shared/dashboard/module-contracts";
import { dashboardQueryKeys } from "../../../../shared/dashboard/query-keys";
import { useDashboardShell } from "../../../../shared/dashboard/shell-context";
import { persistBusinessBasics, persistPersonality, syncAgentProfile } from "./api";
import { buildPersonalityAgentsQueryOptions, usePersonalityAgentsQuery } from "./queries";

type PersonalityPanelTab = "answer_formatting" | "bot_identity" | "custom_instructions" | "escalation";
type ResponseLengthPreference = "descriptive" | "medium" | "short";
type TonePreference = "matter_of_fact" | "friendly" | "humorous" | "neutral" | "professional";
type GenderPreference = "female" | "male" | "neutral";
type LanguagePreference = "english" | "hindi" | "hinglish" | "bengali" | "none";

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
    "Do not ask customer budget or pricing qualification questions.\nDo not promise actions you cannot perform.\nDo not share sensitive data.",
  escalationWhenToEscalate:
    "Escalate when the query is outside knowledge, details are unclear after one follow-up, or customer asks for a human.",
  escalationContactPerson: "",
  escalationPhoneNumber: "",
  escalationEmail: ""
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
    aiDontRules: readSavedString(saved.aiDontRules, DEFAULT_BUSINESS_BASICS.aiDontRules),
    escalationWhenToEscalate: readSavedString(
      saved.escalationWhenToEscalate,
      DEFAULT_BUSINESS_BASICS.escalationWhenToEscalate
    ),
    escalationContactPerson: readSavedString(
      saved.escalationContactPerson,
      DEFAULT_BUSINESS_BASICS.escalationContactPerson
    ),
    escalationPhoneNumber: readSavedString(saved.escalationPhoneNumber, DEFAULT_BUSINESS_BASICS.escalationPhoneNumber),
    escalationEmail: readSavedString(saved.escalationEmail, DEFAULT_BUSINESS_BASICS.escalationEmail)
  };
}

function buildSimplifiedBasics(
  businessBasics: BusinessBasicsPayload,
  botName: string,
  botBusinessAbout: string,
  botUnknownReply: string,
  botAvoidWords: string,
  doRules: string[],
  dontRules: string[],
  userEmail: string | null | undefined
): BusinessBasicsPayload {
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
      cleanDontRules.length > 0 ? cleanDontRules.join("\n") : "Do not hallucinate policy or pricing details.",
    escalationWhenToEscalate:
      businessBasics.escalationWhenToEscalate.trim().length > 0
        ? businessBasics.escalationWhenToEscalate.trim()
        : DEFAULT_BUSINESS_BASICS.escalationWhenToEscalate,
    escalationContactPerson: businessBasics.escalationContactPerson.trim(),
    escalationPhoneNumber: businessBasics.escalationPhoneNumber.trim(),
    escalationEmail:
      businessBasics.escalationEmail.trim() ||
      businessBasics.supportEmail.trim() ||
      userEmail?.trim() ||
      ""
  };
}

function buildPersonalityPrompt(
  basics: BusinessBasicsPayload,
  responseLengthPreference: ResponseLengthPreference,
  tonePreference: TonePreference,
  genderPreference: GenderPreference,
  languagePreference: LanguagePreference,
  enableEmojis: boolean,
  enableBulletPoints: boolean
) {
  const lines = [
    `Response length: ${responseLengthPreference}.`,
    `Tone: ${tonePreference}.`,
    `Voice preference: ${genderPreference}.`,
    `Preferred language: ${languagePreference}.`,
    enableEmojis ? "Use emojis only when they improve clarity." : "Do not use emojis.",
    enableBulletPoints ? "Use bullet points for multi-step answers." : "Avoid bullet points unless asked.",
    `Bot identity: ${basics.companyName}.`,
    `Business context: ${basics.whatDoYouSell}.`,
    `Fallback when answer is unknown: ${basics.complaintHandlingScript}.`,
    `Escalation trigger: ${basics.escalationWhenToEscalate}.`,
    `Escalation contact person: ${basics.escalationContactPerson || "not provided"}.`,
    basics.escalationPhoneNumber
      ? `Escalation phone: ${basics.escalationPhoneNumber}.`
      : "Escalation phone: not provided.",
    basics.escalationEmail ? `Escalation email: ${basics.escalationEmail}.` : "Escalation email: not provided."
  ];
  return lines.join("\n");
}

function getPrimaryAgentProfile(profiles: AgentProfile[] | undefined) {
  const sorted = [...(profiles ?? [])].sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return Number(b.isActive) - Number(a.isActive);
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return sorted[0] ?? null;
}

export function Component() {
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  const { token } = useDashboardShell();
  const agentsQuery = usePersonalityAgentsQuery(token);
  const [personalityPanelTab, setPersonalityPanelTab] = useState<PersonalityPanelTab>("answer_formatting");
  const [businessBasics, setBusinessBasics] = useState<BusinessBasicsPayload>(DEFAULT_BUSINESS_BASICS);
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
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedBasics = loadSavedBusinessBasics(user?.business_basics);
    setBusinessBasics(savedBasics);
    setBotName(savedBasics.companyName || user?.name || "WAgen AI Bot");
    setBotBusinessAbout(savedBasics.whatDoYouSell);
    setBotUnknownReply(savedBasics.complaintHandlingScript || "Sorry, I don't have information on this yet.");
    setBotAvoidWords(savedBasics.objections);
    setDoRules(parseRuleLines(savedBasics.aiDoRules));
    setDontRules(parseRuleLines(savedBasics.aiDontRules));
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const basics = buildSimplifiedBasics(
        businessBasics,
        botName,
        botBusinessAbout,
        botUnknownReply,
        botAvoidWords,
        doRules,
        dontRules,
        user?.email
      );
      const prompt = buildPersonalityPrompt(
        basics,
        responseLengthPreference,
        tonePreference,
        genderPreference,
        languagePreference,
        enableEmojis,
        enableBulletPoints
      );
      await persistBusinessBasics(token, {
        ...basics,
        defaultCountry: basics.defaultCountry.trim().toUpperCase() || "IN",
        defaultCurrency: basics.defaultCurrency.trim().toUpperCase() || "INR"
      });
      await persistPersonality(token, {
        personality: "custom",
        customPrompt: prompt.trim()
      });

      const primaryProfile = getPrimaryAgentProfile(agentsQuery.data);
      if (primaryProfile) {
        await syncAgentProfile(token, primaryProfile, {
          businessBasics: basics,
          personality: "custom",
          customPrompt: prompt.trim()
        });
      }

      await refreshUser();
      await queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.agentsRoot });
      return { basics, prompt };
    },
    onSuccess: () => {
      setInfo("Chatbot personality saved.");
      setError(null);
    },
    onError: (mutationError) => {
      setError((mutationError as Error).message);
      setInfo(null);
    }
  });

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

  return (
    <section className="chatbot-personality-view">
      <article className="chatbot-personality-panel">
        {info ? <p className="info-text">{info}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <header className="chatbot-personality-head">
          <h2>Bot settings</h2>
          <div className="clone-hero-actions">
            <button type="button" className="primary-btn" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              Save settings
            </button>
          </div>
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
          <button
            type="button"
            className={personalityPanelTab === "escalation" ? "active" : ""}
            onClick={() => setPersonalityPanelTab("escalation")}
          >
            Escalation
          </button>
        </nav>

        {personalityPanelTab === "answer_formatting" ? (
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
        ) : null}

        {personalityPanelTab === "bot_identity" ? (
          <div className="chatbot-personality-body">
            <label>
              Bot name
              <input value={botName} onChange={(event) => setBotName(event.target.value)} placeholder="e.g. FoodStudio" />
            </label>
            <label>
              What is your business about?
              <textarea rows={6} value={botBusinessAbout} onChange={(event) => setBotBusinessAbout(event.target.value)} />
            </label>
            <label>
              What will the bot say when it does not know the answer?
              <input value={botUnknownReply} onChange={(event) => setBotUnknownReply(event.target.value)} />
            </label>
            <label>
              Words and phrases to avoid in conversations
              <input value={botAvoidWords} onChange={(event) => setBotAvoidWords(event.target.value)} />
            </label>
          </div>
        ) : null}

        {personalityPanelTab === "custom_instructions" ? (
          <div className="chatbot-personality-body">
            <h3>Add custom behavior commands/prompt for your bot</h3>
            <div className="instruction-group">
              <strong>Do's</strong>
              {doRules.map((rule, index) => (
                <div key={`do-${index}`} className="instruction-row">
                  <textarea value={rule} onChange={(event) => handleRuleChange("do", index, event.target.value)} />
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
                  <textarea value={rule} onChange={(event) => handleRuleChange("dont", index, event.target.value)} />
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
        ) : null}

        {personalityPanelTab === "escalation" ? (
          <div className="chatbot-personality-body">
            <label>
              When to escalate to human
              <textarea
                rows={4}
                value={businessBasics.escalationWhenToEscalate}
                onChange={(event) =>
                  setBusinessBasics((current) => ({
                    ...current,
                    escalationWhenToEscalate: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Contact person
              <input
                value={businessBasics.escalationContactPerson}
                onChange={(event) =>
                  setBusinessBasics((current) => ({
                    ...current,
                    escalationContactPerson: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Phone number
              <input
                value={businessBasics.escalationPhoneNumber}
                onChange={(event) =>
                  setBusinessBasics((current) => ({
                    ...current,
                    escalationPhoneNumber: event.target.value
                  }))
                }
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={businessBasics.escalationEmail}
                onChange={(event) =>
                  setBusinessBasics((current) => ({
                    ...current,
                    escalationEmail: event.target.value
                  }))
                }
              />
            </label>
          </div>
        ) : null}
      </article>
    </section>
  );
}

export async function prefetchData({ token, queryClient }: DashboardModulePrefetchContext) {
  await queryClient.prefetchQuery(buildPersonalityAgentsQueryOptions(token));
}
