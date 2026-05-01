import { pool } from "../db/pool.js";
import type { Contact, MarketingConsentStatus } from "../types/models.js";
import { findSuppressedRecipients, type ContactDeliverySuppression } from "./message-delivery-data-service.js";
import { getQueueRedisConnection } from "./queue-service.js";
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
  | "frequency_cap_24h"; // kept for backwards compat — no longer a hard block

/**
 * What to do when a per-template 24h frequency cap is hit.
 * "send"    — no cap, proceed normally
 * "variant" — send variantTemplateId instead (same intent, different wording)
 * "delay"   — queue the message to fire at delayUntil
 */
export type FrequencyCapDecision =
  | { action: "send" }
  | { action: "variant"; variantTemplateId: string }
  | { action: "delay"; delayUntil: string };

export interface OutboundPolicyResult {
  allowed: boolean;
  category: TemplateCategory;
  reasonCodes: OutboundPolicyReasonCode[];
  nextAllowedAt: string | null;
  suppressionAction: "none" | "skip" | "block";
  /** Routing decision for frequency cap. action="send" when no cap is hit. */
  frequencyCapDecision: FrequencyCapDecision;
}

function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function isMarketingCategory(category: TemplateCategory): boolean {
  return category === "MARKETING";
}

function hasValidMarketingConsent(status: MarketingConsentStatus): boolean {
  return status === "subscribed";
}

function classifySuppression(
  suppression: ContactDeliverySuppression | undefined,
  category: TemplateCategory
): OutboundPolicyReasonCode | null {
  if (!suppression) return null;
  if (suppression.reason_code === "blocked") return "suppressed_blocked";
  if (suppression.reason_code === "invalid_number") return "suppressed_invalid_number";
  if (suppression.reason_code === "opt_out" && category === "MARKETING") return "suppressed_opt_out";
  return null;
}

// ─── Frequency cap Redis helpers ─────────────────────────────────────────────

const FREQ_CAP_WINDOW_MS = 24 * 60 * 60_000;
const FREQ_CAP_TTL_SECONDS = 25 * 60 * 60; // 25h TTL, 1h buffer over the window

function freqCapKey(contactId: string, templateId: string): string {
  return `freq_cap:${contactId}:${templateId}`;
}

async function getFreqCapSentAt(contactId: string, templateId: string): Promise<number | null> {
  const redis = getQueueRedisConnection();
  if (!redis) return null;
  const raw = await redis.get(freqCapKey(contactId, templateId));
  if (!raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Record a successful MARKETING template send so future sends can check the cap.
 * Call this after every successful MARKETING template dispatch.
 */
export async function recordFrequencyCapSend(contactId: string, templateId: string): Promise<void> {
  const redis = getQueueRedisConnection();
  if (!redis) return;
  await redis.set(freqCapKey(contactId, templateId), String(Date.now()), "EX", FREQ_CAP_TTL_SECONDS);
}

/**
 * Look up an approved variant template for the given templateId.
 * Returns null until a variant_template_id column is configured on message_templates.
 *
 * To enable Scenario 2 (smart swap): add a `variant_template_id` column to
 * message_templates and remove the early return below.
 */
async function getApprovedVariantTemplateId(templateId: string, userId: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM message_templates
     WHERE user_id = $1
       AND variant_of_template_id = $2
       AND status = 'APPROVED'
     LIMIT 1`,
    [userId, templateId]
  ).catch(() => null); // column may not exist yet — fail gracefully
  return result?.rows[0]?.id ?? null;
}

// ─── Explicit layer functions ─────────────────────────────────────────────────

/**
 * Hard blocks: suppression list, global opt-out, marketing disabled.
 * Always evaluated on every send path. Failure = hard drop.
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
 * Per-template 24h frequency cap for MARKETING sends.
 *
 * Returns a routing decision — never a hard block:
 *   "send"    → no cap, proceed normally
 *   "variant" → swap to variantTemplateId (same intent, different wording)
 *   "delay"   → queue to fire at delayUntil (last_sent_at + 24h)
 *
 * Scenario 1 — first send: Redis key absent → action "send". Key is written
 *   by recordFrequencyCapSend() after a successful dispatch.
 *
 * Scenario 2 — resend within 24h, variant configured: action "variant".
 *   Requires variant_of_template_id column on message_templates.
 *
 * Scenario 3 — resend within 24h, no variant: action "delay".
 *   Caller queues the message to fire when the window expires.
 */
export async function evaluateFrequencyCap(input: {
  category: TemplateCategory;
  templateId: string | null | undefined;
  contactId: string | null | undefined;
  contact: Contact | null;
  userId: string;
}): Promise<FrequencyCapDecision> {
  if (!isMarketingCategory(input.category)) {
    return { action: "send" };
  }

  const now = Date.now();
  let sentAtMs: number | null = null;

  // Prefer per-template Redis key (accurate, per-template)
  if (input.contactId && input.templateId) {
    sentAtMs = await getFreqCapSentAt(input.contactId, input.templateId);
  }

  // Fall back to contact-level field (covers sends before Redis tracking was added)
  if (sentAtMs === null && input.contact?.last_outgoing_marketing_at) {
    const parsed = Date.parse(input.contact.last_outgoing_marketing_at);
    if (Number.isFinite(parsed)) sentAtMs = parsed;
  }

  if (sentAtMs === null || now - sentAtMs >= FREQ_CAP_WINDOW_MS) {
    return { action: "send" };
  }

  // Cap is active — try variant first
  if (input.templateId && input.userId) {
    const variantId = await getApprovedVariantTemplateId(input.templateId, input.userId);
    if (variantId) {
      return { action: "variant", variantTemplateId: variantId };
    }
  }

  // No variant — delay until window expires
  return { action: "delay", delayUntil: new Date(sentAtMs + FREQ_CAP_WINDOW_MS).toISOString() };
}

// ─── Composer ─────────────────────────────────────────────────────────────────

/**
 * Full policy evaluation. Composes all three layers.
 *
 * enforceConsentPolicy=true  → hard blocks + consent + frequency cap routing
 * enforceConsentPolicy=false → hard blocks + frequency cap routing (consent skipped)
 *
 * policy.allowed is false ONLY for hard blocks and consent failures.
 * Frequency cap is communicated via policy.frequencyCapDecision — it is
 * a routing decision, never a hard block.
 */
export async function evaluateOutboundTemplatePolicy(input: {
  userId: string;
  phoneNumber: string;
  templateId?: string | null;
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

  // Frequency cap — routing decision, not a hard block
  const frequencyCapDecision = await evaluateFrequencyCap({
    category: input.category,
    templateId: input.templateId,
    contactId: contact?.id ?? null,
    contact,
    userId: input.userId
  });

  return {
    allowed: reasonCodes.length === 0,
    category: input.category,
    reasonCodes,
    nextAllowedAt: frequencyCapDecision.action === "delay" ? frequencyCapDecision.delayUntil : null,
    suppressionAction,
    frequencyCapDecision
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function summarizeOutboundPolicyReasons(codes: OutboundPolicyReasonCode[]): string[] {
  return codes.map((code) => {
    switch (code) {
      case "marketing_disabled":        return "Marketing templates are disabled for proactive outbound.";
      case "missing_contact":           return "Marketing sends require a known contact record.";
      case "global_opt_out":            return "Contact globally opted out of business messaging.";
      case "marketing_unsubscribed":    return "Contact unsubscribed from marketing messages.";
      case "missing_marketing_consent": return "Contact does not have explicit documented marketing consent.";
      case "suppressed_blocked":        return "Recipient previously blocked messages.";
      case "suppressed_invalid_number": return "Recipient phone number is marked invalid.";
      case "suppressed_opt_out":        return "Recipient opted out of marketing messages.";
      case "frequency_cap_24h":         return "24-hour proactive frequency cap reached for this contact.";
      default:                          return code;
    }
  });
}

export async function loadContactsByPhone(userId: string, phoneNumbers: string[]): Promise<Map<string, Contact>> {
  const normalized = Array.from(new Set(phoneNumbers.map((v) => normalizePhoneDigits(v)).filter(Boolean))) as string[];
  if (normalized.length === 0) return new Map();
  const result = await pool.query<Contact>(
    `SELECT * FROM contacts WHERE user_id = $1 AND phone_number = ANY($2::text[])`,
    [userId, normalized]
  );
  return new Map(result.rows.map((row) => [row.phone_number, row]));
}
