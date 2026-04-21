export type QrChannelStatus = "connected" | "connecting" | "disconnected" | "degraded";

export type QrSessionHealthEvent =
  | "registration_attempt"
  | "connection_open"
  | "connection_close"
  | "decrypt_failure"
  | "direct_inbound_success";

export type QrInboundSkipReason = "non_direct_jid" | "from_me" | "no_text" | "missing_phone";

export interface QrSessionHealthState {
  eventTimestamps: Record<QrSessionHealthEvent, number[]>;
  skippedInboundCounts: Record<QrInboundSkipReason, number>;
  lastEvaluatedAt: number | null;
  lastDegradedAt: number | null;
  recoveryCooldownUntil: number | null;
  lastConnectionOpenAt: number | null;
}

export interface QrSessionHealthSummary {
  registrationAttempts: number;
  connectionOpens: number;
  connectionCloses: number;
  decryptFailures: number;
  successfulDirectInbound: number;
  skippedInboundCounts: Record<QrInboundSkipReason, number>;
}

export interface QrSessionHealthEvaluation {
  degraded: boolean;
  reason: "reconnect_thrashing" | "decrypt_failures_without_direct_inbound" | null;
  summary: QrSessionHealthSummary;
}

export const QR_SESSION_HEALTH_WINDOW_MS = 10 * 60 * 1000;
export const QR_SESSION_DECRYPT_FAILURE_THRESHOLD = 8;
export const QR_SESSION_RECONNECT_THRESHOLD = 4;
export const QR_SESSION_RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;
// After a reconnect, WA delivers queued offline messages whose Signal keys may
// be out of sync. Decrypt failures during this window are noise, not corruption.
export const QR_SESSION_RECONNECT_GRACE_MS = 3 * 60 * 1000;

function pruneTimestamps(values: number[], now: number, windowMs = QR_SESSION_HEALTH_WINDOW_MS): number[] {
  return values.filter((value) => now - value <= windowMs);
}

export function createQrSessionHealthState(): QrSessionHealthState {
  return {
    eventTimestamps: {
      registration_attempt: [],
      connection_open: [],
      connection_close: [],
      decrypt_failure: [],
      direct_inbound_success: []
    },
    skippedInboundCounts: {
      non_direct_jid: 0,
      from_me: 0,
      no_text: 0,
      missing_phone: 0
    },
    lastEvaluatedAt: null,
    lastDegradedAt: null,
    recoveryCooldownUntil: null,
    lastConnectionOpenAt: null
  };
}

export function recordQrSessionHealthEvent(
  state: QrSessionHealthState,
  event: QrSessionHealthEvent,
  now: number
): QrSessionHealthState {
  const nextValues = {
    ...state.eventTimestamps,
    [event]: pruneTimestamps([...state.eventTimestamps[event], now], now)
  };

  for (const key of Object.keys(nextValues) as QrSessionHealthEvent[]) {
    if (key !== event) {
      nextValues[key] = pruneTimestamps(nextValues[key], now);
    }
  }

  return {
    ...state,
    eventTimestamps: nextValues,
    lastEvaluatedAt: now,
    lastConnectionOpenAt: event === "connection_open" ? now : state.lastConnectionOpenAt
  };
}

export function recordQrInboundSkipReason(
  state: QrSessionHealthState,
  reason: QrInboundSkipReason
): QrSessionHealthState {
  return {
    ...state,
    skippedInboundCounts: {
      ...state.skippedInboundCounts,
      [reason]: state.skippedInboundCounts[reason] + 1
    }
  };
}

export function evaluateQrSessionHealth(
  state: QrSessionHealthState,
  now: number
): QrSessionHealthEvaluation {
  const registrationAttempts = pruneTimestamps(state.eventTimestamps.registration_attempt, now).length;
  const connectionOpens = pruneTimestamps(state.eventTimestamps.connection_open, now).length;
  const connectionCloses = pruneTimestamps(state.eventTimestamps.connection_close, now).length;
  const decryptFailures = pruneTimestamps(state.eventTimestamps.decrypt_failure, now).length;
  const successfulDirectInbound = pruneTimestamps(state.eventTimestamps.direct_inbound_success, now).length;

  const inReconnectGrace =
    state.lastConnectionOpenAt !== null &&
    now - state.lastConnectionOpenAt <= QR_SESSION_RECONNECT_GRACE_MS;

  let reason: QrSessionHealthEvaluation["reason"] = null;
  if (registrationAttempts >= QR_SESSION_RECONNECT_THRESHOLD || connectionCloses >= QR_SESSION_RECONNECT_THRESHOLD) {
    reason = "reconnect_thrashing";
  } else if (
    !inReconnectGrace &&
    decryptFailures >= QR_SESSION_DECRYPT_FAILURE_THRESHOLD &&
    successfulDirectInbound === 0 &&
    connectionOpens + registrationAttempts > 0
  ) {
    reason = "decrypt_failures_without_direct_inbound";
  }

  return {
    degraded: reason !== null,
    reason,
    summary: {
      registrationAttempts,
      connectionOpens,
      connectionCloses,
      decryptFailures,
      successfulDirectInbound,
      skippedInboundCounts: { ...state.skippedInboundCounts }
    }
  };
}

export function canRecoverDegradedQrSession(state: QrSessionHealthState, now: number): boolean {
  return !state.recoveryCooldownUntil || state.recoveryCooldownUntil <= now;
}

export function markQrSessionRecovered(state: QrSessionHealthState, now: number): QrSessionHealthState {
  return {
    ...createQrSessionHealthState(),
    lastDegradedAt: now,
    recoveryCooldownUntil: now + QR_SESSION_RECOVERY_COOLDOWN_MS,
    lastConnectionOpenAt: null
  };
}

export function describeQrSessionHealthSummary(summary: QrSessionHealthSummary): string {
  return [
    `registrations=${summary.registrationAttempts}`,
    `opens=${summary.connectionOpens}`,
    `closes=${summary.connectionCloses}`,
    `decrypt_failures=${summary.decryptFailures}`,
    `direct_inbound=${summary.successfulDirectInbound}`,
    `skips=${JSON.stringify(summary.skippedInboundCounts)}`
  ].join(" ");
}

export function getQrSessionDegradedMessage(reason: NonNullable<QrSessionHealthEvaluation["reason"]>): string {
  if (reason === "reconnect_thrashing") {
    return "QR session needs re-link. WhatsApp connection kept reconnecting and lost sync. Keep the phone online, remove the stale linked device, and scan a fresh QR code.";
  }

  return "QR session needs re-link. WhatsApp encryption/session sync was lost. Keep the phone online, remove the stale linked device, and scan a fresh QR code.";
}

export function isDirectChatJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}
