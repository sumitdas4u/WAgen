import { describe, expect, it } from "vitest";
import {
  QR_SESSION_DECRYPT_FAILURE_THRESHOLD,
  QR_SESSION_RECONNECT_GRACE_MS,
  QR_SESSION_RECONNECT_THRESHOLD,
  createQrSessionHealthState,
  evaluateQrSessionHealth,
  isDirectChatJid,
  markQrSessionRecovered,
  recordQrInboundSkipReason,
  recordQrSessionHealthEvent
} from "./whatsapp-session-health.js";

describe("whatsapp-session-health", () => {
  it("accepts only direct WhatsApp chat JIDs", () => {
    expect(isDirectChatJid("919804735837@s.whatsapp.net")).toBe(true);
    expect(isDirectChatJid("33956145672305@lid")).toBe(true);
    expect(isDirectChatJid("120363422925329665@g.us")).toBe(false);
    expect(isDirectChatJid("status@broadcast")).toBe(false);
    expect(isDirectChatJid("120363405104300439@newsletter")).toBe(false);
  });

  it("does not degrade from isolated group or status skips", () => {
    let state = createQrSessionHealthState();
    state = recordQrInboundSkipReason(state, "non_direct_jid");
    state = recordQrInboundSkipReason(state, "non_direct_jid");
    state = recordQrInboundSkipReason(state, "no_text");

    const result = evaluateQrSessionHealth(state, Date.now());
    expect(result.degraded).toBe(false);
    expect(result.summary.skippedInboundCounts.non_direct_jid).toBe(2);
  });

  it("marks a session degraded after repeated reconnect thrashing", () => {
    const now = Date.now();
    let state = createQrSessionHealthState();
    for (let index = 0; index < QR_SESSION_RECONNECT_THRESHOLD; index += 1) {
      state = recordQrSessionHealthEvent(state, "registration_attempt", now + index * 1000);
    }

    const result = evaluateQrSessionHealth(state, now + QR_SESSION_RECONNECT_THRESHOLD * 1000);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("reconnect_thrashing");
  });

  it("marks a session degraded after repeated decrypt failures without direct inbound", () => {
    const now = Date.now();
    let state = createQrSessionHealthState();
    state = recordQrSessionHealthEvent(state, "connection_open", now);
    for (let index = 0; index < QR_SESSION_DECRYPT_FAILURE_THRESHOLD; index += 1) {
      state = recordQrSessionHealthEvent(state, "decrypt_failure", now + index * 1000);
    }

    const result = evaluateQrSessionHealth(state, now + QR_SESSION_RECONNECT_GRACE_MS + 1_000);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("decrypt_failures_without_direct_inbound");
  });

  it("does not mark a session degraded when direct inbound succeeds after reconnect", () => {
    const now = Date.now();
    let state = createQrSessionHealthState();
    state = recordQrSessionHealthEvent(state, "connection_open", now);
    for (let index = 0; index < QR_SESSION_DECRYPT_FAILURE_THRESHOLD; index += 1) {
      state = recordQrSessionHealthEvent(state, "decrypt_failure", now + index * 1000);
    }
    state = recordQrSessionHealthEvent(state, "direct_inbound_success", now + 6_000);

    const result = evaluateQrSessionHealth(state, now + 7_000);
    expect(result.degraded).toBe(false);
  });

  it("does not mark a session degraded from decrypt failures during reconnect grace", () => {
    const now = Date.now();
    let state = createQrSessionHealthState();
    state = recordQrSessionHealthEvent(state, "connection_open", now);
    for (let index = 0; index < QR_SESSION_DECRYPT_FAILURE_THRESHOLD; index += 1) {
      state = recordQrSessionHealthEvent(state, "decrypt_failure", now + index * 1000);
    }

    const result = evaluateQrSessionHealth(state, now + QR_SESSION_DECRYPT_FAILURE_THRESHOLD * 1000);
    expect(result.degraded).toBe(false);
  });

  it("applies a recovery cooldown after degradation handling", () => {
    const now = Date.now();
    const state = markQrSessionRecovered(createQrSessionHealthState(), now);
    expect(state.recoveryCooldownUntil).toBeGreaterThan(now);
  });
});
