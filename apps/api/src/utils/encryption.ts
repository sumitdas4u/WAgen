import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ENCRYPTION_ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptJsonPayload(payload: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGO, deriveKey(secret), iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptJsonPayload<T>(encryptedPayload: string, secret: string): T {
  const [version, ivB64, tagB64, payloadB64] = encryptedPayload.split(":");
  if (version !== ENCRYPTION_VERSION || !ivB64 || !tagB64 || !payloadB64) {
    throw new Error("Invalid encrypted payload format");
  }

  const decipher = createDecipheriv(ENCRYPTION_ALGO, deriveKey(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payloadB64, "base64")), decipher.final()]).toString(
    "utf8"
  );
  return JSON.parse(decrypted) as T;
}

export function encryptTextPayload(value: string, secret: string): string {
  return encryptJsonPayload({ value }, secret);
}

export function decryptTextPayload(encryptedPayload: string, secret: string): string {
  const parsed = decryptJsonPayload<{ value?: unknown }>(encryptedPayload, secret);
  if (typeof parsed?.value !== "string") {
    throw new Error("Invalid encrypted text payload");
  }
  return parsed.value;
}
