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

export async function evaluateOutboundTemplatePolicy(input: {
  userId: string;
  phoneNumber: string;
  category: TemplateCategory;
  contact?: Contact | null;
  suppression?: ContactDeliverySuppression | null;
  marketingEnabled?: boolean;
}): Promise<OutboundPolicyResult> {
  const normalizedPhone = normalizePhoneDigits(input.phoneNumber);
  const marketingEnabled = input.marketingEnabled ?? false;
  const contact = input.contact ?? null;
  const suppression =
    input.suppression ??
    (normalizedPhone
      ? (await findSuppressedRecipients(input.userId, [normalizedPhone])).get(normalizedPhone) ?? null
      : null);

  const reasonCodes: OutboundPolicyReasonCode[] = [];
  let nextAllowedAt: string | null = null;
  let suppressionAction: OutboundPolicyResult["suppressionAction"] = "none";

  if (isMarketingCategory(input.category) && !marketingEnabled) {
    reasonCodes.push("marketing_disabled");
    suppressionAction = "block";
  }

  const suppressionCode = classifySuppression(suppression ?? undefined, input.category);
  if (suppressionCode) {
    reasonCodes.push(suppressionCode);
    suppressionAction = "block";
  }

  if (contact?.global_opt_out_at) {
    reasonCodes.push("global_opt_out");
    suppressionAction = "block";
  }

  if (isMarketingCategory(input.category)) {
    if (!contact) {
      reasonCodes.push("missing_contact");
      suppressionAction = "block";
    } else if (contact.marketing_consent_status === "unsubscribed" || contact.marketing_consent_status === "revoked") {
      reasonCodes.push("marketing_unsubscribed");
      suppressionAction = "block";
    } else if (!hasValidMarketingConsent(contact.marketing_consent_status)) {
      reasonCodes.push("missing_marketing_consent");
      suppressionAction = "block";
    }
  }

  if (contact?.last_outgoing_template_at) {
    const nextAllowed = nextAllowedAfter24h(contact.last_outgoing_template_at);
    if (nextAllowed && Date.parse(nextAllowed) > Date.now()) {
      reasonCodes.push("frequency_cap_24h");
      nextAllowedAt = nextAllowed;
      suppressionAction = suppressionAction === "none" ? "skip" : suppressionAction;
    }
  }

  return {
    allowed: reasonCodes.length === 0,
    category: input.category,
    reasonCodes,
    nextAllowedAt,
    suppressionAction
  };
}

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
