import { pool } from "../db/pool.js";
import type { Contact, MarketingConsentStatus } from "../types/models.js";
import { findSuppressedRecipients, type ContactDeliverySuppression } from "./message-delivery-data-service.js";
import type { TemplateCategory } from "./template-service.js";

export type OutboundPolicyReasonCode =
  | "marketing_disabled"
  | "missing_contact"
  | "global_opt_out"
  | "marketing_unsubscribed"
  | "missing_marketing_consent"
  | "suppressed_blocked"
  | "suppressed_invalid_number"
  | "suppressed_opt_out"
  | "frequency_cap_24h";

export interface OutboundPolicyResult {
  allowed: boolean;
  category: TemplateCategory;
  reasonCodes: OutboundPolicyReasonCode[];
  nextAllowedAt: string | null;
  suppressionAction: "none" | "skip" | "block";
}

export interface FrequencyCapResult {
  exceeded: boolean;
  nextAllowedAt: string | null;
}

function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function isMarketingCategory(category: TemplateCategory): boolean {
  return category === "MARKETING";
}

function nextAllowedAfter24h(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed + 24 * 60 * 60_000).toISOString();
}

function hasValidMarketingConsent(status: MarketingConsentStatus): boolean {
  return status === "subscribed";
}

function classifySuppression(
  suppression: ContactDeliverySuppression | undefined,
  category: TemplateCategory
): OutboundPolicyReasonCode | null {
  if (!suppression) {
    return null;
  }
  if (suppression.reason_code === "blocked") {
    return "suppressed_blocked";
  }
  if (suppression.reason_code === "invalid_number") {
    return "suppressed_invalid_number";
  }
  if (suppression.reason_code === "opt_out" && category === "MARKETING") {
    return "suppressed_opt_out";
  }
  return null;
}

// ─── Explicit layer functions ────────────────────────────────────────────────

/**
 * Hard blocks: suppression list, global opt-out, marketing disabled.
 * Always evaluated on every send path.
 */
export function evaluateHardBlocks(input: {
  category: TemplateCategory;
  suppression?: ContactDeliverySuppression | null;
  globalOptOut?: boolean;
  marketingEnabled?: boolean;
}): { codes: OutboundPolicyReasonCode[]; suppressionAction: OutboundPolicyResult["suppressionAction"] } {
  const codes: OutboundPolicyReasonCode[] = [];
  let suppressionAction: OutboundPolicyResult["suppressionAction"] = "none";

  if (isMarketingCategory(input.category) && !(input.marketingEnabled ?? false)) {
    codes.push("marketing_disabled");
    suppressionAction = "block";
  }

  const suppressionCode = classifySuppression(input.suppression ?? undefined, input.category);
  if (suppressionCode) {
    codes.push(suppressionCode);
    suppressionAction = "block";
  }

  if (input.globalOptOut) {
    codes.push("global_opt_out");
    suppressionAction = "block";
  }

  return { codes, suppressionAction };
}

/**
 * Consent checks: opt-in status for MARKETING templates.
 * Controlled by caller — omit when enforce_marketing_policy=false.
 */
export function evaluateMarketingConsent(input: {
  category: TemplateCategory;
  contact: Contact | null;
}): OutboundPolicyReasonCode[] {
  if (!isMarketingCategory(input.category)) return [];
  const { contact } = input;
  if (!contact) return ["missing_contact"];
  if (contact.marketing_consent_status === "unsubscribed" || contact.marketing_consent_status === "revoked") {
    return ["marketing_unsubscribed"];
  }
  if (!hasValidMarketingConsent(contact.marketing_consent_status)) {
    return ["missing_marketing_consent"];
  }
  return [];
}

/**
 * 24h frequency cap for MARKETING templates.
 * Always enforced on every send path — not consent-controlled.
 */
export function evaluateFrequencyCap(
  category: TemplateCategory,
  contact: Contact | null
): FrequencyCapResult {
  if (!isMarketingCategory(category) || !contact?.last_outgoing_marketing_at) {
    return { exceeded: false, nextAllowedAt: null };
  }
  const lastSentMs = Date.parse(contact.last_outgoing_marketing_at);
  if (!Number.isFinite(lastSentMs) || Date.now() - lastSentMs >= 24 * 60 * 60_000) {
    return { exceeded: false, nextAllowedAt: null };
  }
  return {
    exceeded: true,
    nextAllowedAt: nextAllowedAfter24h(contact.last_outgoing_marketing_at)
  };
}

// ─── Composer ────────────────────────────────────────────────────────────────

/**
 * Full policy evaluation. Composes all three layers.
 *
 * enforceConsentPolicy=true  → hard blocks + consent + frequency cap
 * enforceConsentPolicy=false → hard blocks + frequency cap only (consent skipped)
 */
export async function evaluateOutboundTemplatePolicy(input: {
  userId: string;
  phoneNumber: string;
  category: TemplateCategory;
  contact?: Contact | null;
  suppression?: ContactDeliverySuppression | null;
  marketingEnabled?: boolean;
  enforceConsentPolicy?: boolean;
}): Promise<OutboundPolicyResult> {
  const normalizedPhone = normalizePhoneDigits(input.phoneNumber);
  const enforceConsentPolicy = input.enforceConsentPolicy ?? true;
  const contact = input.contact ?? null;
  const suppression =
    input.suppression ??
    (normalizedPhone
      ? (await findSuppressedRecipients(input.userId, [normalizedPhone])).get(normalizedPhone) ?? null
      : null);

  const reasonCodes: OutboundPolicyReasonCode[] = [];
  let nextAllowedAt: string | null = null;
  let suppressionAction: OutboundPolicyResult["suppressionAction"] = "none";

  const hard = evaluateHardBlocks({
    category: input.category,
    suppression,
    globalOptOut: !!contact?.global_opt_out_at,
    marketingEnabled: input.marketingEnabled
  });
  reasonCodes.push(...hard.codes);
  if (hard.suppressionAction !== "none") suppressionAction = hard.suppressionAction;

  if (isMarketingCategory(input.category) && enforceConsentPolicy) {
    const consentCodes = evaluateMarketingConsent({ category: input.category, contact });
    reasonCodes.push(...consentCodes);
    if (consentCodes.length > 0) suppressionAction = "block";
  }

  const cap = evaluateFrequencyCap(input.category, contact);
  if (cap.exceeded) {
    reasonCodes.push("frequency_cap_24h");
    nextAllowedAt = cap.nextAllowedAt;
    suppressionAction = "block";
  }

  return {
    allowed: reasonCodes.length === 0,
    category: input.category,
    reasonCodes,
    nextAllowedAt,
    suppressionAction
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function summarizeOutboundPolicyReasons(codes: OutboundPolicyReasonCode[]): string[] {
  return codes.map((code) => {
    switch (code) {
      case "marketing_disabled":
        return "Marketing templates are disabled for proactive outbound.";
      case "missing_contact":
        return "Marketing sends require a known contact record.";
      case "global_opt_out":
        return "Contact globally opted out of business messaging.";
      case "marketing_unsubscribed":
        return "Contact unsubscribed from marketing messages.";
      case "missing_marketing_consent":
        return "Contact does not have explicit documented marketing consent.";
      case "suppressed_blocked":
        return "Recipient previously blocked messages.";
      case "suppressed_invalid_number":
        return "Recipient phone number is marked invalid.";
      case "suppressed_opt_out":
        return "Recipient opted out of marketing messages.";
      case "frequency_cap_24h":
        return "24-hour proactive frequency cap reached for this contact.";
      default:
        return code;
    }
  });
}

export async function loadContactsByPhone(userId: string, phoneNumbers: string[]): Promise<Map<string, Contact>> {
  const normalized = Array.from(new Set(phoneNumbers.map((value) => normalizePhoneDigits(value)).filter(Boolean))) as string[];
  if (normalized.length === 0) {
    return new Map();
  }

  const result = await pool.query<Contact>(
    `SELECT *
     FROM contacts
     WHERE user_id = $1
       AND phone_number = ANY($2::text[])`,
    [userId, normalized]
  );
  return new Map(result.rows.map((row) => [row.phone_number, row]));
}
