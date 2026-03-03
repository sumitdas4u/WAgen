import { pool } from "../db/pool.js";

const AGENT_NUMBER_CACHE_TTL_MS = 30_000;

let cachedAgentNumbers: Set<string> | null = null;
let cacheExpiresAtMs = 0;
let refreshPromise: Promise<Set<string>> | null = null;

function normalizePhoneDigits(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

async function loadAgentNumbersFromDb(): Promise<Set<string>> {
  const result = await pool.query<{ phone: string | null }>(`
    WITH raw_numbers AS (
      SELECT phone_number AS phone
      FROM whatsapp_sessions
      WHERE status = 'connected'
        AND phone_number IS NOT NULL

      UNION

      SELECT linked_number AS phone
      FROM whatsapp_business_connections
      WHERE status = 'connected'
        AND linked_number IS NOT NULL

      UNION

      SELECT regexp_replace(display_phone_number, '\\D', '', 'g') AS phone
      FROM whatsapp_business_connections
      WHERE status = 'connected'
        AND linked_number IS NULL
        AND display_phone_number IS NOT NULL

      UNION

      SELECT linked_number AS phone
      FROM agent_profiles
      WHERE is_active = TRUE
        AND channel_type IN ('qr', 'api')
        AND linked_number IS NOT NULL
        AND linked_number <> 'web'
    )
    SELECT phone FROM raw_numbers
  `);

  const numbers = new Set<string>();
  for (const row of result.rows) {
    const normalized = normalizePhoneDigits(row.phone);
    if (normalized) {
      numbers.add(normalized);
    }
  }

  return numbers;
}

async function getKnownAgentNumbers(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedAgentNumbers && now < cacheExpiresAtMs) {
    return cachedAgentNumbers;
  }

  if (!refreshPromise) {
    refreshPromise = loadAgentNumbersFromDb()
      .then((numbers) => {
        cachedAgentNumbers = numbers;
        cacheExpiresAtMs = Date.now() + AGENT_NUMBER_CACHE_TTL_MS;
        return numbers;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function isAgentSenderPhone(phoneNumber: string): Promise<boolean> {
  const normalized = normalizePhoneDigits(phoneNumber);
  if (!normalized) {
    return false;
  }

  const known = await getKnownAgentNumbers();
  return known.has(normalized);
}

