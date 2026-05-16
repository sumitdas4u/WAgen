import { createHmac, randomInt } from "node:crypto";
import type { User } from "../types/models.js";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { firstRow, requireRow } from "../db/sql-helpers.js";

const OTP_LENGTH = 6;
const MAX_VERIFY_ATTEMPTS = 5;

export type PhoneOtpErrorCode =
  | "invalid_phone"
  | "rate_limited"
  | "sms_not_configured"
  | "send_failed"
  | "invalid_or_expired"
  | "too_many_attempts"
  | "phone_in_use";

export class PhoneOtpError extends Error {
  constructor(message: string, readonly code: PhoneOtpErrorCode, readonly statusCode: number) {
    super(message);
    this.name = "PhoneOtpError";
  }
}

export interface RequestPhoneOtpResult {
  phoneNumber: string;
  expiresAt: string;
  resendAfterSeconds: number;
  devCode?: string;
}

export function normalizeAccountPhoneNumber(input: string): string {
  const trimmed = input.trim();
  const withoutSeparators = trimmed.replace(/[\s().-]/g, "");
  const digits = withoutSeparators.startsWith("+")
    ? withoutSeparators.slice(1).replace(/\D/g, "")
    : withoutSeparators.replace(/\D/g, "").replace(/^00/, "");

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new PhoneOtpError("Enter phone in international format, for example +91XXXXXXXXXX.", "invalid_phone", 400);
  }

  return `+${digits}`;
}

export function buildOtpMessage(input: { name: string; otp: string; template?: string }): string {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80) || "Customer";
  const otp = input.otp;
  let message = (input.template ?? env.DIGITAL_SMS_OTP_TEMPLATE)
    .replace(/\{name\}/gi, name)
    .replace(/\{otp\}/gi, otp);

  for (const value of [name, otp]) {
    message = message.replace(/\{#var#\}/i, value);
  }

  return message;
}

function generateOtp(): string {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(min, max));
}

function hashOtp(otp: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(otp, "utf8").digest("hex");
}

function smsRecipient(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

async function assertPhoneAvailableForUser(userId: string, phoneNumber: string): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE phone_number = $1
       AND id != $2
     LIMIT 1`,
    [phoneNumber, userId]
  );

  if (firstRow(result)) {
    throw new PhoneOtpError("This phone number is already linked to another account.", "phone_in_use", 409);
  }
}

async function sendOtpSms(input: { recipient: string; message: string }): Promise<{ skipped: boolean }> {
  const token = env.DIGITAL_SMS_API_TOKEN?.trim();
  if (!token) {
    if (env.NODE_ENV === "production") {
      throw new PhoneOtpError("SMS gateway is not configured.", "sms_not_configured", 503);
    }
    return { skipped: true };
  }

  const baseUrl = env.DIGITAL_SMS_API_BASE_URL.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/sendsms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`
    },
    body: JSON.stringify({
      recipient: input.recipient,
      sender_id: env.DIGITAL_SMS_SENDER_ID,
      entity_id: env.DIGITAL_SMS_ENTITY_ID,
      type: env.DIGITAL_SMS_TYPE,
      dlt_template_id: env.DIGITAL_SMS_DLT_TEMPLATE_ID,
      message: input.message
    })
  });

  const responseText = await response.text();
  let responsePayload: unknown = null;
  if (responseText.trim()) {
    try {
      responsePayload = JSON.parse(responseText) as unknown;
    } catch {
      responsePayload = null;
    }
  }
  const providerStatus =
    responsePayload && typeof responsePayload === "object" && "status" in responsePayload
      ? String((responsePayload as { status?: unknown }).status ?? "").toLowerCase()
      : "";
  if (!response.ok) {
    const detail = responseText.trim().slice(0, 300);
    throw new PhoneOtpError(
      detail ? `SMS gateway rejected the OTP request: ${detail}` : "SMS gateway rejected the OTP request.",
      "send_failed",
      502
    );
  }
  if (providerStatus === "error" || providerStatus === "failed" || providerStatus === "failure") {
    const providerMessage =
      responsePayload && typeof responsePayload === "object" && "message" in responsePayload
        ? String((responsePayload as { message?: unknown }).message ?? "").trim()
        : "";
    throw new PhoneOtpError(
      providerMessage || "SMS gateway rejected the OTP request.",
      "send_failed",
      502
    );
  }

  return { skipped: false };
}

export async function requestPhoneOtp(input: {
  userId: string;
  userName: string;
  phoneNumber: string;
}): Promise<RequestPhoneOtpResult> {
  const phoneNumber = normalizeAccountPhoneNumber(input.phoneNumber);
  await assertPhoneAvailableForUser(input.userId, phoneNumber);

  const recentResult = await pool.query<{ sent_at: Date }>(
    `SELECT sent_at
     FROM phone_verification_otps
     WHERE user_id = $1
       AND phone_number = $2
       AND consumed_at IS NULL
     ORDER BY sent_at DESC
     LIMIT 1`,
    [input.userId, phoneNumber]
  );
  const recent = firstRow(recentResult);
  if (recent) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(recent.sent_at).getTime()) / 1000);
    const waitSeconds = env.DIGITAL_SMS_OTP_RESEND_SECONDS - elapsedSeconds;
    if (waitSeconds > 0) {
      throw new PhoneOtpError(`Please wait ${waitSeconds}s before requesting another OTP.`, "rate_limited", 429);
    }
  }

  const otp = generateOtp();
  const message = buildOtpMessage({ name: input.userName, otp });
  const smsResult = await sendOtpSms({
    recipient: smsRecipient(phoneNumber),
    message
  });

  const expiresAt = new Date(Date.now() + env.DIGITAL_SMS_OTP_TTL_MINUTES * 60_000);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE phone_verification_otps
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND consumed_at IS NULL`,
      [input.userId]
    );
    await client.query(
      `INSERT INTO phone_verification_otps (user_id, phone_number, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.userId, phoneNumber, hashOtp(otp), expiresAt]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    phoneNumber,
    expiresAt: expiresAt.toISOString(),
    resendAfterSeconds: env.DIGITAL_SMS_OTP_RESEND_SECONDS,
    ...(smsResult.skipped && env.NODE_ENV !== "production" ? { devCode: otp } : {})
  };
}

export async function verifyPhoneOtp(input: {
  userId: string;
  phoneNumber: string;
  otp: string;
}): Promise<User> {
  const phoneNumber = normalizeAccountPhoneNumber(input.phoneNumber);
  const otp = input.otp.trim();
  if (!/^\d{6}$/.test(otp)) {
    throw new PhoneOtpError("Enter the 6-digit OTP.", "invalid_or_expired", 400);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const otpResult = await client.query<{
      id: string;
      otp_hash: string;
      attempts: number;
    }>(
      `SELECT id, otp_hash, attempts
       FROM phone_verification_otps
       WHERE user_id = $1
         AND phone_number = $2
         AND consumed_at IS NULL
         AND expires_at > NOW()
       ORDER BY sent_at DESC
       LIMIT 1
       FOR UPDATE`,
      [input.userId, phoneNumber]
    );

    const row = firstRow(otpResult);
    if (!row) {
      await client.query("ROLLBACK");
      throw new PhoneOtpError("OTP is invalid or expired. Request a new code.", "invalid_or_expired", 400);
    }

    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      await client.query(
        `UPDATE phone_verification_otps
         SET consumed_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
      await client.query("COMMIT");
      throw new PhoneOtpError("Too many incorrect attempts. Request a new OTP.", "too_many_attempts", 429);
    }

    if (row.otp_hash !== hashOtp(otp)) {
      const nextAttempts = row.attempts + 1;
      await client.query(
        `UPDATE phone_verification_otps
         SET attempts = $2,
             consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END
         WHERE id = $1`,
        [row.id, nextAttempts, MAX_VERIFY_ATTEMPTS]
      );
      await client.query("COMMIT");
      throw new PhoneOtpError(
        nextAttempts >= MAX_VERIFY_ATTEMPTS
          ? "Too many incorrect attempts. Request a new OTP."
          : "Incorrect OTP. Please try again.",
        nextAttempts >= MAX_VERIFY_ATTEMPTS ? "too_many_attempts" : "invalid_or_expired",
        nextAttempts >= MAX_VERIFY_ATTEMPTS ? 429 : 400
      );
    }

    await assertPhoneAvailableForUser(input.userId, phoneNumber);
    await client.query(
      `UPDATE phone_verification_otps
       SET consumed_at = NOW()
       WHERE user_id = $1
         AND consumed_at IS NULL`,
      [input.userId]
    );

    const userResult = await client.query<User>(
      `UPDATE users
       SET phone_number = $1,
           phone_verified = TRUE
       WHERE id = $2
       RETURNING id, name, email, business_type, subscription_plan, business_basics, personality, custom_personality_prompt, ai_active, phone_number, phone_verified, ai_token_balance`,
      [phoneNumber, input.userId]
    );

    const user = requireRow(userResult, "Expected verified user row");
    await client.query("COMMIT");
    return user;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      throw new PhoneOtpError("This phone number is already linked to another account.", "phone_in_use", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}
