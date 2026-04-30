import { useEffect, useState } from "react";
import type {
  GeneratedTemplate,
  MessageTemplate,
  MetaBusinessConnection,
  TemplateCategory,
  TemplateComponent,
  TemplateComponentButton
} from "../../../lib/api";
import type { MetaBusinessStatus } from "../../../lib/api";
import { MetaConnectionSelector, isMetaConnectionActive } from "../../../shared/dashboard/meta-connection-selector";
import { AIGeneratorPanel } from "./AIGeneratorPanel";
import { MediaUploader } from "./MediaUploader";
import { TemplatePreviewPanel } from "./TemplatePreviewPanel";
import { useCreateTemplateMutation } from "./queries";

const PLACEHOLDER_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const EMOJI_GLOBAL_PATTERN = /\p{Extended_Pictographic}/gu;

function extractPrefillState(t: MessageTemplate) {
  const header = t.components.find((c) => c.type === "HEADER");
  const body = t.components.find((c) => c.type === "BODY");
  const footer = t.components.find((c) => c.type === "FOOTER");
  const buttonsComp = t.components.find((c) => c.type === "BUTTONS");
  const originalHeaderHandle =
    (header?.example as { header_handle?: string[] } | undefined)?.header_handle?.[0] ?? "";
  const requiresFreshMediaUpload = isMediaHeaderFormat(header?.format ?? "");
  return {
    name: t.name + "_copy",
    category: t.category,
    language: t.language,
    headerFormat: header?.format ?? "NONE",
    headerText: header?.text ?? "",
    headerHandle: requiresFreshMediaUpload ? "" : originalHeaderHandle,
    requiresFreshMediaUpload,
    bodyText: body?.text ?? "",
    footerText: footer?.text ?? "",
    buttons: (buttonsComp?.buttons ?? []).map((b) => ({
      type: b.type,
      text: b.text,
      url: b.url,
      phone: b.phone_number,
      coupon: b.example?.[0] ?? ""
    }))
  };
}

const LANGUAGES = [
  { value: "en_US", label: "English (US)" },
  { value: "en_GB", label: "English (UK)" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "pt_BR", label: "Portuguese (BR)" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "id", label: "Indonesian" },
  { value: "ar", label: "Arabic" },
  { value: "ja", label: "Japanese" }
];

const CATEGORIES: Array<{ value: TemplateCategory; label: string; desc: string }> = [
  { value: "MARKETING", label: "Marketing", desc: "Promotions, offers, announcements" },
  { value: "UTILITY", label: "Utility", desc: "Order updates, confirmations, alerts" },
  { value: "AUTHENTICATION", label: "Authentication", desc: "OTPs and verification codes" }
];

const BUTTON_TYPES = [
  { type: "QUICK_REPLY", label: "↩ Custom replies", section: "Quick reply buttons" },
  { type: "URL", label: "↗ URL", note: "2 buttons maximum", section: "Call to action buttons" },
  { type: "PHONE_NUMBER", label: "📞 Phone", note: "1 button maximum", section: "Call to action buttons" },
  { type: "COPY_CODE", label: "📋 Coupon code", note: "1 button maximum", section: "Call to action buttons" }
] as const;

const MEDIA_HEADER_FORMATS = ["IMAGE", "VIDEO", "DOCUMENT"] as const;
type MediaHeaderFormat = (typeof MEDIA_HEADER_FORMATS)[number];
const MEDIA_HEADER_SAMPLE_MIME_TYPES: Record<MediaHeaderFormat, readonly string[]> = {
  IMAGE: ["image/jpeg", "image/png"],
  VIDEO: ["video/mp4"],
  DOCUMENT: ["application/pdf"]
};
const MEDIA_HEADER_SAMPLE_HELP: Record<MediaHeaderFormat, string> = {
  IMAGE: "JPG or PNG",
  VIDEO: "MP4",
  DOCUMENT: "PDF"
};

const HEADER_FORMAT_OPTIONS = [
  { value: "NONE", label: "None", supported: true },
  { value: "TEXT", label: "Text", supported: true },
  { value: "IMAGE", label: "Image", supported: true },
  { value: "VIDEO", label: "Video", supported: true },
  { value: "DOCUMENT", label: "Document", supported: true },
  { value: "LOCATION", label: "Location", supported: false }
] as const;

function detectVariables(text: string): string[] {
  const matches = [...text.matchAll(PLACEHOLDER_PATTERN)];
  return [...new Set(matches.map((m) => `{{${(m[1] ?? "").trim()}}}`))];
}

function isMediaHeaderFormat(value: string): value is MediaHeaderFormat {
  return MEDIA_HEADER_FORMATS.includes(value as MediaHeaderFormat);
}

function stripEmojiText(value: string): string {
  return value.replace(EMOJI_GLOBAL_PATTERN, "");
}

function decodeTemplateHandleSegment(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    return null;
  }
  try {
    const decoded = atob(value).trim();
    return decoded && /^[\x20-\x7E]+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function inspectTemplateHeaderHandle(handle: string): {
  isUrl: boolean;
  looksLikeSampleHandle: boolean;
  mimeType: string | null;
} {
  const trimmed = handle.trim();
  if (!trimmed) {
    return { isUrl: false, looksLikeSampleHandle: false, mimeType: null };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { isUrl: true, looksLikeSampleHandle: false, mimeType: null };
  }

  const segments = trimmed.split(":");
  if (segments.length < 3) {
    return { isUrl: false, looksLikeSampleHandle: false, mimeType: null };
  }

  return {
    isUrl: false,
    looksLikeSampleHandle: true,
    mimeType: decodeTemplateHandleSegment(segments[2] ?? "")
  };
}

function cleanTemplateCreateErrorMessage(message: string): string {
  const cleaned = message
    .replace(/Please read the Graph API documentation at https?:\/\/\S+/gi, "")
    .replace(/\[status=[^\]]+\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || "Failed to submit this template.";
}

function formatTemplateCreateError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "Failed to submit this template.");
  const message = cleanTemplateCreateErrorMessage(rawMessage);

  if (/unsupported post request/i.test(message) || /object with id/i.test(message)) {
    return "Meta could not use the sample media attached to this template. Upload the header sample again in WAgen before submitting. If you duplicated another template, do not reuse the old media reference.";
  }
  if (/\bsubcode=2388273\b/i.test(rawMessage)) {
    return "Meta rejected the media sample reference for this header. Upload the sample file again in WAgen and use the new handle before submitting.";
  }
  if (/\bsubcode=2388084\b/i.test(rawMessage)) {
    return "Meta rejected the uploaded media sample for this header type. Use JPG or PNG for images, MP4 for videos, and PDF for documents.";
  }
  if (/\bcode=192\b/i.test(rawMessage) && /phone number/i.test(message)) {
    return "Meta rejected the phone button number. Use a full international number with country code, for example +919804735837.";
  }
  if (/\bcode=131009\b/i.test(rawMessage) || /\bcode=100\b/i.test(rawMessage)) {
    return "Meta rejected this template structure. Check that every variable has a sample value, dynamic URL buttons include a sample value, coupon-code buttons include a sample code, and media headers use a fresh uploaded sample handle.";
  }

  return message;
}

function collectDraftVariables(input: {
  headerText: string;
  bodyText: string;
  buttons: Array<{ url?: string }>;
}): string[] {
  return Array.from(
    new Set([
      ...detectVariables(input.headerText),
      ...detectVariables(input.bodyText),
      ...input.buttons.flatMap((button) => detectVariables(button.url ?? ""))
    ])
  );
}

function isPositiveIntegerToken(value: string): boolean {
  return /^[1-9]\d*$/.test(value.trim());
}

function normalizeTemplatePhoneDraft(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return `+${trimmed.replace(/\D/g, "")}`;
}

function validateTemplatePhoneDraft(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Please fill this phone number.";
  }
  if (!trimmed.startsWith("+")) {
    return "Use international format with country code, for example +919804735837.";
  }
  const normalized = normalizeTemplatePhoneDraft(trimmed);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return "Phone number must contain 8 to 15 digits with country code, for example +919804735837.";
  }
  return null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getTemplateComplianceWarnings(input: {
  category: TemplateCategory;
  headerText: string;
  bodyText: string;
  footerText: string;
  buttons: DraftButton[];
}): string[] {
  const text = [input.headerText, input.bodyText, input.footerText, ...input.buttons.map((button) => button.text), ...input.buttons.map((button) => button.url ?? "")]
    .join("\n")
    .toLowerCase();
  const warnings: string[] = [];
  const promotionalSignals = ["sale", "offer", "discount", "coupon", "% off", "limited time", "shop now", "deal"];
  const hasPromo = promotionalSignals.some((signal) => text.includes(signal));
  const hasOptOut = text.includes("reply stop") || text.includes("unsubscribe");

  if ((input.category === "UTILITY" || input.category === "AUTHENTICATION") && hasPromo) {
    warnings.push("Utility/auth templates should not contain promotional language like offers, discounts, or sales.");
  }
  if (input.category === "MARKETING" && !hasOptOut) {
    warnings.push("Marketing templates should include a clear opt-out instruction such as Reply STOP to unsubscribe.");
  }
  return warnings;
}

type DraftButton = { type: string; text: string; url?: string; phone?: string; coupon?: string };

type DraftButtonValidation = {
  text: string | null;
  url: string | null;
  phone: string | null;
  coupon: string | null;
};

type TemplateDraftValidation = {
  formError: string | null;
  footerError: string | null;
  bodyError: string | null;
  headerError: string | null;
  variableErrors: Record<string, string>;
  buttonErrors: DraftButtonValidation[];
};

function validateTemplateDraft(input: {
  category: TemplateCategory;
  headerFormat: string;
  headerHandle: string;
  requiresFreshMediaUpload: boolean;
  headerText: string;
  bodyText: string;
  footerText: string;
  buttons: DraftButton[];
  variableMapping: Record<string, string>;
}): TemplateDraftValidation {
  const buttonErrors: DraftButtonValidation[] = input.buttons.map(() => ({
    text: null,
    url: null,
    phone: null,
    coupon: null
  }));
  const variableErrors: Record<string, string> = {};

  if (input.category === "AUTHENTICATION") {
    return {
      formError:
        "Authentication templates need Meta's dedicated authentication-template format and are not supported in this builder yet.",
      headerError: null,
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }

  if (isMediaHeaderFormat(input.headerFormat) && input.requiresFreshMediaUpload) {
    return {
      formError: "This copied template needs a fresh sample media upload before it can be submitted.",
      headerError: "Upload a fresh sample file for this copied media header.",
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }

  if (isMediaHeaderFormat(input.headerFormat) && !input.headerHandle.trim()) {
    return {
      formError: "Upload a sample media file for the header before submitting this template.",
      headerError: "Please upload the sample media for this header.",
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }
  if (isMediaHeaderFormat(input.headerFormat)) {
    const handleInfo = inspectTemplateHeaderHandle(input.headerHandle);
    if (handleInfo.isUrl) {
      return {
        formError: "Media headers must use the Meta sample handle from Upload Sample Media. Public URLs are not accepted here.",
        headerError: "Public URLs are not accepted. Upload the media here to generate a Meta sample handle.",
        footerError: null,
        bodyError: null,
        variableErrors,
        buttonErrors
      };
    }
    if (!handleInfo.looksLikeSampleHandle) {
      return {
        formError: "This header media reference is not a valid Meta template sample handle. Upload the sample again in WAgen before submitting.",
        headerError: "Upload the sample here to generate a fresh Meta header handle.",
        footerError: null,
        bodyError: null,
        variableErrors,
        buttonErrors
      };
    }
    if (
      handleInfo.mimeType &&
      !MEDIA_HEADER_SAMPLE_MIME_TYPES[input.headerFormat].includes(handleInfo.mimeType)
    ) {
      return {
        formError: `This ${input.headerFormat.toLowerCase()} header sample is not valid. Upload a ${MEDIA_HEADER_SAMPLE_HELP[input.headerFormat]} file and try again.`,
        headerError: `Upload a ${MEDIA_HEADER_SAMPLE_HELP[input.headerFormat]} file for this header.`,
        footerError: null,
        bodyError: null,
        variableErrors,
        buttonErrors
      };
    }
  }
  if (input.headerFormat === "TEXT" && !input.headerText.trim()) {
    return {
      formError: "Please fill the header text or switch the header format to None.",
      headerError: "Please fill the header text.",
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }
  if (input.headerFormat === "TEXT" && EMOJI_PATTERN.test(input.headerText.trim())) {
    return {
      formError: "Header text cannot contain emojis. Remove the emoji from the header and try again.",
      headerError: "Header text cannot contain emojis.",
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }
  if (!input.bodyText.trim()) {
    return {
      formError: "Please fill the message body before submitting.",
      headerError: null,
      footerError: null,
      bodyError: "Please fill the message body.",
      variableErrors,
      buttonErrors
    };
  }

  const footerText = input.footerText.trim();
  if (footerText) {
    if (detectVariables(footerText).length > 0) {
      return {
        formError: "Footer text cannot contain variables. Move dynamic values into the body instead.",
        headerError: null,
        footerError: "Footer text cannot contain variables.",
        bodyError: null,
        variableErrors,
        buttonErrors
      };
    }
    if (EMOJI_PATTERN.test(footerText)) {
      return {
        formError: "Footer text cannot contain emojis. Remove the emoji from the footer and try again.",
        headerError: null,
        footerError: "Footer text cannot contain emojis.",
        bodyError: null,
        variableErrors,
        buttonErrors
      };
    }
  }

  const placeholders = [
    ...detectVariables(input.headerText),
    ...detectVariables(input.bodyText),
    ...input.buttons.flatMap((button) => detectVariables(button.url ?? ""))
  ];

  const invalidPlaceholders = Array.from(
    new Set(
      placeholders.filter((placeholder) => {
        const token = placeholder.replace(/^\{\{|\}\}$/g, "").trim();
        return !isPositiveIntegerToken(token);
      })
    )
  );
  if (invalidPlaceholders.length > 0) {
    return {
      formError: `Use numbered variables like {{1}}, {{2}}, {{3}}. Invalid variable(s): ${invalidPlaceholders.join(", ")}.`,
      headerError: null,
      footerError: null,
      bodyError: "Use numbered variables like {{1}}, {{2}}, {{3}}.",
      variableErrors,
      buttonErrors
    };
  }

  const numericPlaceholders = Array.from(
    new Set(
      placeholders
        .map((placeholder) => Number(placeholder.replace(/^\{\{|\}\}$/g, "").trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ).sort((left, right) => left - right);

  for (let index = 0; index < numericPlaceholders.length; index += 1) {
    const expected = index + 1;
    if (numericPlaceholders[index] !== expected) {
      return {
        formError: `Template variables must be sequential with no gaps. Add {{${expected}}} before using higher numbers.`,
        headerError: null,
        footerError: null,
        bodyError: "Template variables must be sequential with no gaps.",
        variableErrors,
        buttonErrors
      };
    }
  }

  const missingSamples = Array.from(new Set(placeholders)).filter(
    (placeholder) => !input.variableMapping[placeholder]?.trim()
  );
  if (missingSamples.length > 0) {
    for (const placeholder of missingSamples) {
      variableErrors[placeholder] = "Please fill a sample value for Meta review.";
    }
    return {
      formError:
        missingSamples.length === 1
          ? `${missingSamples[0]} needs a sample value before submitting.`
          : "Every template variable needs a sample value before submitting.",
      headerError: null,
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }

  let buttonFormError: string | null = null;
  for (const [index, button] of input.buttons.entries()) {
    if (!button.text.trim()) {
      buttonErrors[index]!.text = "Please fill this button label.";
      buttonFormError ??= `Complete the configuration for button ${index + 1} before submitting.`;
    }
    if (button.type === "URL") {
      const url = button.url?.trim() ?? "";
      if (!url) {
        buttonErrors[index]!.url = "Please fill this URL.";
        buttonFormError ??= `Complete the configuration for button ${index + 1} before submitting.`;
      } else if (!isValidHttpUrl(url.replace(/\{\{[^}]+\}\}$/, "sample"))) {
        buttonErrors[index]!.url = "Enter a full URL starting with http:// or https://.";
        buttonFormError ??= `URL button ${index + 1} needs a valid URL.`;
      } else {
        const urlVars = detectVariables(url);
        if (urlVars.length > 1) {
          buttonErrors[index]!.url = "Only one variable is allowed in a button URL.";
          buttonFormError ??= `URL button ${index + 1} can only use one variable.`;
        } else if (urlVars.length === 1 && !url.endsWith(urlVars[0]!)) {
          buttonErrors[index]!.url = "The variable must be at the end of the URL.";
          buttonFormError ??= `URL button ${index + 1} must place its variable at the end of the URL.`;
        }
      }
    }
    if (button.type === "PHONE_NUMBER") {
      const phoneError = validateTemplatePhoneDraft(button.phone ?? "");
      if (phoneError) {
        buttonErrors[index]!.phone = phoneError;
        buttonFormError ??= `Phone button ${index + 1}: ${phoneError}`;
      }
    }
    if (button.type === "COPY_CODE" && !button.coupon?.trim()) {
      buttonErrors[index]!.coupon = "Please fill the sample coupon code.";
      buttonFormError ??= `Coupon code button ${index + 1} needs a sample coupon code.`;
    }
  }
  if (buttonFormError) {
    return {
      formError: buttonFormError,
      headerError: null,
      footerError: null,
      bodyError: null,
      variableErrors,
      buttonErrors
    };
  }

  return {
    formError: null,
    headerError: null,
    footerError: null,
    bodyError: null,
    variableErrors,
    buttonErrors
  };
}

function buildComponents(
  name_: string,
  headerFormat: string,
  headerText: string,
  headerHandle: string,
  bodyText: string,
  footerText: string,
  buttons: Array<{ type: string; text: string; url?: string; phone?: string; coupon?: string }>,
  variableMapping: Record<string, string>
): TemplateComponent[] {
  void name_;
  const components: TemplateComponent[] = [];

  if (headerFormat !== "NONE") {
    const headerComp: TemplateComponent = {
      type: "HEADER",
      format: headerFormat as TemplateComponent["format"]
    };
    if (headerFormat === "TEXT" && headerText.trim()) {
      headerComp.text = headerText.trim();
      const vars = detectVariables(headerText);
      if (vars.length > 0) {
        headerComp.example = {
          header_text: vars.map((variable) => variableMapping[variable] || variable.replace(/\{\{|\}\}/g, ""))
        };
      }
    }
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && headerHandle) {
      headerComp.example = { header_handle: [headerHandle] };
    }
    components.push(headerComp);
  }

  if (bodyText.trim()) {
    const bodyComp: TemplateComponent = { type: "BODY", text: bodyText.trim() };
    const vars = detectVariables(bodyText);
    if (vars.length > 0) {
      const exampleValues = vars.map((v) => variableMapping[v] || v.replace(/\{\{|\}\}/g, ""));
      bodyComp.example = { body_text: [exampleValues] };
    }
    components.push(bodyComp);
  }

  if (footerText.trim()) {
    components.push({ type: "FOOTER", text: footerText.trim() });
  }

  if (buttons.length > 0) {
    const btns: TemplateComponentButton[] = buttons.map((b) => {
      const btn: TemplateComponentButton = { type: b.type as TemplateComponentButton["type"], text: b.text };
      if (b.url) {
        btn.url = b.url;
        const urlVars = detectVariables(b.url);
        if (urlVars.length > 0) {
          btn.example = [variableMapping[urlVars[0]!] || urlVars[0]!.replace(/\{\{|\}\}/g, "")];
        }
      }
      if (b.phone) btn.phone_number = normalizeTemplatePhoneDraft(b.phone);
      if (b.coupon) btn.example = [b.coupon];
      return btn;
    });
    components.push({ type: "BUTTONS", buttons: btns });
  }

  return components;
}

interface Props {
  token: string;
  metaStatus?: MetaBusinessStatus | null;
  onBack: () => void;
  onCreated: (template: MessageTemplate) => void;
  prefill?: MessageTemplate;
}

export function TemplateCreatePage({ token, metaStatus, onBack, onCreated, prefill }: Props) {
  const init = prefill ? extractPrefillState(prefill) : null;
  const availableConnections = metaStatus?.connections ?? [];
  const hasConnection = (connectionId: string | null | undefined, connections: MetaBusinessConnection[]) =>
    Boolean(connectionId && connections.some((connection) => connection.id === connectionId));
  const resolveDefaultConnectionId = (connections: MetaBusinessConnection[]) =>
    prefill
      ? (hasConnection(prefill.connectionId, connections) ? prefill.connectionId : "")
      : (
    (hasConnection(metaStatus?.connection?.id, connections) ? metaStatus?.connection?.id : null) ??
    "");
  const [name, setName] = useState(init?.name ?? "");
  const [category, setCategory] = useState<TemplateCategory>(init?.category ?? "MARKETING");
  const [language, setLanguage] = useState(init?.language ?? "en_US");
  const [headerFormat, setHeaderFormat] = useState(init?.headerFormat ?? "NONE");
  const [headerText, setHeaderText] = useState(init?.headerText ?? "");
  const [headerHandle, setHeaderHandle] = useState(init?.headerHandle ?? "");
  const [requiresFreshMediaUpload, setRequiresFreshMediaUpload] = useState(init?.requiresFreshMediaUpload ?? false);
  const [headerImageUrl, setHeaderImageUrl] = useState<string | null>(null);
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string | null>(null);
  const [bodyText, setBodyText] = useState(init?.bodyText ?? "");
  const [footerText, setFooterText] = useState(init?.footerText ?? "");
  const [buttons, setButtons] = useState<Array<{ type: string; text: string; url?: string; phone?: string; coupon?: string }>>(init?.buttons ?? []);
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
  const [showButtonMenu, setShowButtonMenu] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [headerFooterSanitizeNotice, setHeaderFooterSanitizeNotice] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState(() => resolveDefaultConnectionId(availableConnections));

  const createMutation = useCreateTemplateMutation(token);
  const connectionId = selectedConnectionId;
  const selectedConnection = availableConnections.find((connection) => connection.id === selectedConnectionId) ?? null;

  useEffect(() => {
    setSelectedConnectionId((current) => {
      if (current && availableConnections.some((connection) => connection.id === current)) {
        return current;
      }
      return resolveDefaultConnectionId(availableConnections);
    });
  }, [availableConnections, metaStatus?.connection?.id, prefill?.connectionId]);

  const detectedVars = collectDraftVariables({
    headerText,
    bodyText,
    buttons
  });
  const draftValidation = validateTemplateDraft({
    category,
    headerFormat,
    headerHandle,
    requiresFreshMediaUpload,
    headerText,
    bodyText,
    footerText,
    buttons,
    variableMapping
  });
  const complianceWarnings = getTemplateComplianceWarnings({
    category,
    headerText,
    bodyText,
    footerText,
    buttons
  });

  useEffect(() => {
    if (formError && draftValidation.formError !== formError) {
      setFormError(draftValidation.formError);
    }
    if (formError && !draftValidation.formError) {
      setFormError(null);
    }
  }, [draftValidation.formError, formError]);

  useEffect(() => {
    if (!createMutation.isError) {
      if (submitError) {
        setSubmitError(null);
      }
      return;
    }
    createMutation.reset();
    if (submitError) {
      setSubmitError(null);
    }
  }, [name, category, language, headerFormat, headerText, headerHandle, bodyText, footerText, JSON.stringify(buttons), JSON.stringify(variableMapping), requiresFreshMediaUpload]);

  const previewComponents = buildComponents(
    name, headerFormat, headerText, headerHandle,
    bodyText, footerText, buttons, variableMapping
  );

  const connectionName = selectedConnection?.displayPhoneNumber ?? selectedConnection?.linkedNumber ?? "Connected";
  const selectedConnectionActive = isMetaConnectionActive(selectedConnection);

  function applyGenerated(gen: GeneratedTemplate) {
    setName(gen.suggestedName);
    setCategory(gen.suggestedCategory);
    const header = gen.components.find((c) => c.type === "HEADER");
    const body = gen.components.find((c) => c.type === "BODY");
    const footer = gen.components.find((c) => c.type === "FOOTER");
    const buttonsComp = gen.components.find((c) => c.type === "BUTTONS");
    setHeaderHandle("");
    setHeaderImageUrl(null);
    setHeaderMediaUrl(null);
    setRequiresFreshMediaUpload(false);

    if (header) {
      setHeaderFormat(header.format ?? "TEXT");
      setHeaderText(header.text ?? "");
    } else {
      setHeaderFormat("NONE");
    }
    setBodyText(body?.text ?? "");
    setFooterText(footer?.text ?? "");
    setButtons(
      (buttonsComp?.buttons ?? []).map((b) => ({
        type: b.type,
        text: b.text,
        url: b.url,
        phone: b.phone_number,
        coupon: b.example?.[0] ?? ""
      }))
    );
    setShowAI(false);
  }

  function handleNameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/\s/g, "_");
    setName(cleaned);
    if (cleaned && !/^[a-z0-9_]+$/.test(cleaned)) {
      setNameError("Only lowercase letters, numbers, and underscores allowed.");
    } else {
      setNameError("");
    }
  }

  function addButton(type: string) {
    setButtons((prev) => [...prev, { type, text: "" }]);
    setShowButtonMenu(false);
  }

  function removeButton(idx: number) {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  }

  function countByType(type: string) {
    return buttons.filter((b) => b.type === type).length;
  }

  function canAddButtonType(type: string) {
    if (type === "QUICK_REPLY") return buttons.filter((b) => b.type === "QUICK_REPLY").length < 3;
    if (type === "URL") return countByType("URL") < 2;
    return countByType(type) < 1;
  }

  async function handleSubmit() {
    if (!connectionId) {
      setFormError("Connect a Meta WhatsApp number before submitting this template.");
      return;
    }
    if (!selectedConnectionActive) {
      setFormError("Select an active WhatsApp API connection before submitting this template.");
      return;
    }
    if (draftValidation.formError) {
      setFormError(draftValidation.formError);
      return;
    }
    const components = buildComponents(
      name, headerFormat, headerText, headerHandle,
      bodyText, footerText, buttons, variableMapping
    );
    try {
      setFormError(null);
      setSubmitError(null);
      const template = await createMutation.mutateAsync({
        connectionId,
        name: name.trim(),
        category,
        language,
        components,
        headerMediaUrl: headerMediaUrl ?? null
      });
      onCreated(template);
    } catch (error) {
      setSubmitError(formatTemplateCreateError(error));
    }
  }

  const isValid =
    name.trim().length > 0 &&
    !nameError &&
    bodyText.trim().length > 0 &&
    connectionId.length > 0 &&
    !draftValidation.formError &&
    !createMutation.isPending;

  return (
    <div style={{ display: "flex", gap: "24px", minHeight: "80vh", position: "relative" }}>
      {/* Left: form */}
      <div style={{ flex: "1 1 60%", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* Top fields */}
        <div>
          <label style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
            Template name <span style={{ color: "#dc2626" }}>*</span>
            <span style={{ color: "#aaa", fontWeight: 400 }}>{name.length}/60</span>
          </label>
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value.slice(0, 60))}
            placeholder="welcome_template, orderconfirmation"
            style={{
              width: "100%",
              borderRadius: "8px",
              border: `1.5px solid ${nameError ? "#dc2626" : "#e0e0e0"}`,
              padding: "10px 12px",
              fontSize: "14px",
              boxSizing: "border-box"
            }}
          />
          {nameError && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "4px" }}>{nameError}</div>}
        </div>

        <div style={{ maxWidth: "420px" }}>
          <MetaConnectionSelector
            connections={availableConnections}
            value={connectionId}
            onChange={setSelectedConnectionId}
            label="WhatsApp API connection"
            required
            allowEmpty
            emptyLabel="Select a WhatsApp API connection"
          />
          {selectedConnection && !selectedConnectionActive ? (
            <div style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>
              This connection is not active. Reconnect or resume it before creating a template.
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
              Category <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              style={{ width: "100%", borderRadius: "8px", border: "1.5px solid #e0e0e0", padding: "10px 12px", fontSize: "14px" }}
            >
              <option value="" disabled>Select Category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value === "AUTHENTICATION" ? `${c.label} (coming soon)` : c.label}
                </option>
              ))}
            </select>
            {category === "AUTHENTICATION" && (
              <div style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>
                Authentication templates use Meta&apos;s separate authentication-template format and are not supported here yet.
              </div>
            )}
            {complianceWarnings.length > 0 && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: "#92400e", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "8px", padding: "8px 10px" }}>
                {complianceWarnings[0]}
              </div>
            )}
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
              Channel <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <div style={{
              borderRadius: "8px",
              border: "1.5px solid #e0e0e0",
              padding: "10px 12px",
              fontSize: "14px",
              background: "#f9f9f9",
              color: connectionId ? "#111" : "#aaa",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <span style={{ color: "#25d366" }}>●</span>
              {connectionId ? connectionName : "No Meta connection"}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 600, fontSize: "13px", marginBottom: "6px" }}>
              Language <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ width: "100%", borderRadius: "8px", border: "1.5px solid #e0e0e0", padding: "10px 12px", fontSize: "14px" }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Header card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px" }}>Message header</span>
            <span style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px", color: "#666" }}>Optional</span>
          </div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {HEADER_FORMAT_OPTIONS.map((option) => (
              <label
                key={option.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: option.supported ? "pointer" : "not-allowed",
                  fontSize: "14px",
                  opacity: option.supported ? 1 : 0.5
                }}
              >
                <input
                  type="radio"
                  name="headerFormat"
                  value={option.value}
                  checked={headerFormat === option.value}
                  disabled={!option.supported}
                  onChange={() => {
                    setHeaderFormat(option.value);
                    setHeaderText("");
                    setHeaderHandle("");
                    setHeaderImageUrl(null);
                    setHeaderMediaUrl(null);
                    setRequiresFreshMediaUpload(false);
                  }}
                  style={{ accentColor: "#25d366" }}
                />
                {option.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#64748b" }}>
            This builder supports text, image, video, and document headers. Use JPG or PNG for image headers, MP4 for video headers, and PDF for document headers. Location headers are still not supported here.
          </div>
          {headerFormat === "TEXT" && (
            <>
              <input
                value={headerText}
                onChange={(e) => {
                  const rawValue = e.target.value.slice(0, 60);
                  const cleanedValue = stripEmojiText(rawValue);
                  setHeaderText(cleanedValue);
                  setHeaderFooterSanitizeNotice(cleanedValue !== rawValue ? "Emojis are not allowed in template header or footer text, so they were removed." : null);
                }}
                placeholder="Header text * (max 60 chars)"
                maxLength={60}
                style={{
                  marginTop: "12px",
                  width: "100%",
                  borderRadius: "8px",
                  border: `1.5px solid ${draftValidation.headerError ? "#dc2626" : "#e0e0e0"}`,
                  padding: "10px 12px",
                  fontSize: "14px",
                  boxSizing: "border-box"
                }}
              />
              {draftValidation.headerError && (
                <div style={{ marginTop: "8px", color: "#dc2626", fontSize: "12px" }}>{draftValidation.headerError}</div>
              )}
              {!draftValidation.headerError && (
                <div style={{ marginTop: "8px", color: "#64748b", fontSize: "12px" }}>
                  Plain text only. Emojis are removed automatically here.
                </div>
              )}
            </>
          )}
          {["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && (
            <div style={{ marginTop: "12px" }}>
              {requiresFreshMediaUpload && (
                <div style={{ marginBottom: "10px", padding: "10px 12px", borderRadius: "8px", background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", fontSize: "12px" }}>
                  This copied template needs a fresh sample upload. Meta does not let new templates reuse the old media sample reference.
                </div>
              )}
              <MediaUploader
                token={token}
                connectionId={connectionId}
                mediaType={headerFormat as "IMAGE" | "VIDEO" | "DOCUMENT"}
                onUploaded={(handle, localPreviewUrl, mediaUrl) => {
                  setHeaderHandle(handle);
                  setHeaderMediaUrl(mediaUrl);
                  setRequiresFreshMediaUpload(false);
                  if (headerFormat === "IMAGE") setHeaderImageUrl(localPreviewUrl ?? mediaUrl ?? null);
                }}
              />
              {draftValidation.headerError && (
                <div style={{ marginTop: "8px", color: "#dc2626", fontSize: "12px" }}>{draftValidation.headerError}</div>
              )}
            </div>
          )}
        </div>

        {/* Body card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px" }}>Message body</span>
            <span style={{ fontSize: "11px", background: "#dc262622", color: "#dc2626", padding: "2px 8px", borderRadius: "999px" }}>Required</span>
          </div>
          <div style={{ position: "relative" }}>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value.slice(0, 1024))}
              placeholder="Hi {{1}}!&#10;&#10;Write your message here. Use numbered variables like {{1}}, {{2}} for dynamic content."
              rows={6}
              style={{
                width: "100%",
                borderRadius: "8px",
                border: `1.5px solid ${draftValidation.bodyError ? "#dc2626" : "#e0e0e0"}`,
                padding: "10px 12px",
                fontSize: "14px",
                boxSizing: "border-box",
                fontFamily: "inherit",
                resize: "vertical"
              }}
            />
            <div style={{ textAlign: "right", fontSize: "11px", color: "#aaa", marginTop: "2px" }}>
              {bodyText.length}/1024
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
            <button
              type="button"
              onClick={() => {
                const next = detectedVars.length + 1;
                setBodyText((t) => t + `{{${next}}}`);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: "999px",
                border: "1.5px solid #25d366",
                color: "#25d366",
                background: "transparent",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer"
              }}
            >
              Add variables
            </button>
            <div style={{ display: "flex", gap: "10px", color: "#666", fontSize: "14px" }}>
              <button type="button" onClick={() => setBodyText((t) => t + "*bold*")} style={{ background: "none", border: "none", fontWeight: 700, cursor: "pointer", color: "#555" }}>B</button>
              <button type="button" onClick={() => setBodyText((t) => t + "_italic_")} style={{ background: "none", border: "none", fontStyle: "italic", cursor: "pointer", color: "#555" }}>I</button>
              <button type="button" onClick={() => setBodyText((t) => t + "~strikethrough~")} style={{ background: "none", border: "none", textDecoration: "line-through", cursor: "pointer", color: "#555" }}>S</button>
            </div>
          </div>

          {draftValidation.bodyError && (
            <div style={{ marginTop: "10px", color: "#dc2626", fontSize: "12px" }}>{draftValidation.bodyError}</div>
          )}

          {/* Variable mapping rows */}
          {detectedVars.length > 0 && (
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#666" }}>Variable examples (shown to Meta for review):</div>
              {detectedVars.map((v) => (
                <div key={v} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <code style={{ background: "#f3f4f6", padding: "3px 8px", borderRadius: "4px", fontSize: "12px", color: "#128c7e" }}>{v}</code>
                  <span style={{ color: "#aaa", fontSize: "13px" }}>→</span>
                  <input
                    value={variableMapping[v] ?? ""}
                    onChange={(e) => setVariableMapping((m) => ({ ...m, [v]: e.target.value }))}
                    placeholder={`Example for ${v}`}
                    style={{
                      flex: 1,
                      borderRadius: "6px",
                      border: `1.5px solid ${draftValidation.variableErrors[v] ? "#dc2626" : "#e0e0e0"}`,
                      padding: "5px 10px",
                      fontSize: "13px"
                    }}
                  />
                  {draftValidation.variableErrors[v] && (
                    <span style={{ color: "#dc2626", fontSize: "12px" }}>{draftValidation.variableErrors[v]}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 700, fontSize: "15px" }}>Footer</span>
              <span style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px", color: "#666" }}>Optional</span>
            </div>
            <span style={{ fontSize: "11px", color: "#aaa" }}>{footerText.length}/60</span>
          </div>
          <input
            value={footerText}
            onChange={(e) => {
              const rawValue = e.target.value.slice(0, 60);
              const cleanedValue = stripEmojiText(rawValue);
              setFooterText(cleanedValue);
              setHeaderFooterSanitizeNotice(cleanedValue !== rawValue ? "Emojis are not allowed in template header or footer text, so they were removed." : null);
              if (formError) {
                setFormError(null);
              }
            }}
            placeholder="Plain text only. Avoid emojis and variables here."
            style={{
              width: "100%",
              borderRadius: "8px",
              border: `1.5px solid ${draftValidation.footerError ? "#dc2626" : "#e0e0e0"}`,
              padding: "10px 12px",
              fontSize: "14px",
              boxSizing: "border-box"
            }}
          />
          <div style={{ marginTop: "8px", fontSize: "12px", color: draftValidation.footerError ? "#dc2626" : "#64748b" }}>
            {draftValidation.footerError ?? "Meta commonly rejects footer text with emojis or variables. Keep the footer plain."}
          </div>
        </div>

        {headerFooterSanitizeNotice && (
          <div style={{ padding: "12px", borderRadius: "8px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "13px" }}>
            {headerFooterSanitizeNotice}
          </div>
        )}

        {/* Buttons card */}
        <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px" }}>Buttons</span>
            <span style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 8px", borderRadius: "999px", color: "#666" }}>Optional</span>
          </div>
          <p style={{ margin: "0 0 4px", fontSize: "13px", color: "#444" }}>
            Create buttons that let customers respond to your message or take action.
          </p>
          <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#888", fontStyle: "italic" }}>
            If you add more than three buttons, they will appear in a list.
          </p>

          {buttons.map((btn, idx) => {
            const buttonError = draftValidation.buttonErrors[idx] ?? { text: null, url: null, phone: null, coupon: null };
            return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={{ width: "20px", fontSize: "14px" }}>
                {btn.type === "URL" ? "↗" : btn.type === "PHONE_NUMBER" ? "📞" : btn.type === "COPY_CODE" ? "📋" : "↩"}
              </div>
              <input
                value={btn.text}
                onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, text: e.target.value } : b))}
                placeholder="Button label *"
                maxLength={25}
                style={{
                  flex: 1,
                  borderRadius: "6px",
                  border: `1.5px solid ${buttonError.text ? "#dc2626" : "#e0e0e0"}`,
                  padding: "7px 10px",
                  fontSize: "13px"
                }}
              />
              {btn.type === "URL" && (
                <input
                  value={btn.url ?? ""}
                  onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, url: e.target.value } : b))}
                  placeholder="https://example.com/path *"
                  style={{
                    flex: 1,
                    borderRadius: "6px",
                    border: `1.5px solid ${buttonError.url ? "#dc2626" : "#e0e0e0"}`,
                    padding: "7px 10px",
                    fontSize: "13px"
                  }}
                />
              )}
              {btn.type === "PHONE_NUMBER" && (
                <input
                  value={btn.phone ?? ""}
                  onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, phone: e.target.value } : b))}
                  placeholder="+919804735837 *"
                  style={{
                    flex: 1,
                    borderRadius: "6px",
                    border: `1.5px solid ${buttonError.phone ? "#dc2626" : "#e0e0e0"}`,
                    padding: "7px 10px",
                    fontSize: "13px"
                  }}
                />
              )}
              {btn.type === "COPY_CODE" && (
                <input
                  value={btn.coupon ?? ""}
                  onChange={(e) => setButtons((prev) => prev.map((b, i) => i === idx ? { ...b, coupon: e.target.value } : b))}
                  placeholder="Coupon sample *"
                  style={{
                    flex: 1,
                    borderRadius: "6px",
                    border: `1.5px solid ${buttonError.coupon ? "#dc2626" : "#e0e0e0"}`,
                    padding: "7px 10px",
                    fontSize: "13px"
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => removeButton(idx)}
                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}
              >
                ×
              </button>
            </div>
              {(buttonError.text || buttonError.url || buttonError.phone || buttonError.coupon) && (
                <div style={{ marginLeft: "28px", color: "#dc2626", fontSize: "12px", display: "flex", flexDirection: "column", gap: "2px" }}>
                  {buttonError.text && <span>{buttonError.text}</span>}
                  {buttonError.url && <span>{buttonError.url}</span>}
                  {buttonError.phone && <span>{buttonError.phone}</span>}
                  {buttonError.coupon && <span>{buttonError.coupon}</span>}
                </div>
              )}
              {btn.type === "PHONE_NUMBER" && !buttonError.phone && (
                <div style={{ marginLeft: "28px", color: "#64748b", fontSize: "12px" }}>
                  Use full international format with country code, for example +919804735837.
                </div>
              )}
            </div>
            );
          })}

          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowButtonMenu((v) => !v)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1.5px solid #d1d5db",
                background: "#f9fafb",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px"
              }}
            >
              + Add a button ▾
            </button>
            {showButtonMenu && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: "1.5px solid #e0e0e0",
                borderRadius: "10px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                zIndex: 20,
                overflow: "hidden"
              }}>
                <div style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Quick reply buttons
                </div>
                {["QUICK_REPLY"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => canAddButtonType(type) && addButton(type)}
                    disabled={!canAddButtonType(type)}
                    style={{
                      display: "flex", alignItems: "center", gap: "10px", width: "100%",
                      padding: "10px 16px", background: "none", border: "none", cursor: canAddButtonType(type) ? "pointer" : "not-allowed",
                      opacity: canAddButtonType(type) ? 1 : 0.4, fontSize: "14px"
                    }}
                  >
                    <span>↩</span> Custom replies
                  </button>
                ))}
                <div style={{ borderTop: "1px solid #f0f0f0", padding: "8px 12px", fontSize: "11px", fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Call to action buttons
                </div>
                {BUTTON_TYPES.filter((bt) => bt.section === "Call to action buttons").map((bt) => (
                  <button
                    key={bt.type}
                    type="button"
                    onClick={() => canAddButtonType(bt.type) && addButton(bt.type)}
                    disabled={!canAddButtonType(bt.type)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                      padding: "10px 16px", background: "none", border: "none", cursor: canAddButtonType(bt.type) ? "pointer" : "not-allowed",
                      opacity: canAddButtonType(bt.type) ? 1 : 0.4
                    }}
                  >
                    <span style={{ fontSize: "14px" }}>{bt.label}</span>
                    <span style={{ fontSize: "11px", color: "#aaa" }}>{bt.note}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {(formError || submitError || createMutation.isError) && (
          <div style={{ padding: "12px", borderRadius: "8px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", fontSize: "13px" }}>
            {formError ?? submitError ?? formatTemplateCreateError(createMutation.error)}
          </div>
        )}
        {!formError && !submitError && !createMutation.isError && !isValid && (
          <div style={{ padding: "12px", borderRadius: "8px", background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", fontSize: "13px" }}>
            Fill all required fields and fix the highlighted inputs before submitting this template.
          </div>
        )}
        {createMutation.isPending && (
          <div style={{ padding: "12px", borderRadius: "8px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, animation: "tpl-spin 1s linear infinite" }} aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Please wait — we are verifying and submitting your template to Meta…
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "10px", paddingTop: "8px" }}>
          <button
            type="button"
            onClick={onBack}
            style={{ padding: "10px 20px", borderRadius: "8px", border: "1.5px solid #e0e0e0", background: "#fff", cursor: "pointer", fontSize: "14px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setShowAI(true)}
            style={{ padding: "10px 20px", borderRadius: "8px", border: "1.5px solid #25d366", background: "#f0fdf4", color: "#166534", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}
          >
            Generate with AI ✨
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid}
            style={{
              marginLeft: "auto",
              padding: "10px 24px",
              borderRadius: "8px",
              background: isValid ? "#25d366" : "#ccc",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: "14px",
              cursor: isValid ? "pointer" : "not-allowed"
            }}
          >
            {createMutation.isPending ? "Submitting..." : "Submit Template"}
          </button>
        </div>
      </div>

      {/* Right: preview */}
      <div style={{ flex: "0 0 320px", position: "sticky", top: "24px", height: "fit-content" }}>
        {showAI ? (
          <div style={{ border: "1.5px solid #e0e0e0", borderRadius: "12px", position: "relative", overflow: "hidden", minHeight: "500px" }}>
            <AIGeneratorPanel
              token={token}
              onClose={() => setShowAI(false)}
              onUse={applyGenerated}
            />
          </div>
        ) : (
          <TemplatePreviewPanel components={previewComponents} businessName={connectionName} headerImageUrl={headerImageUrl ?? undefined} />
        )}
      </div>
    </div>
  );
}
