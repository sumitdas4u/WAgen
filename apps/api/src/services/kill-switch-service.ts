import { pool } from "../db/pool.js";

interface CacheEntry { enabled: boolean; fetchedAt: number }

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

/**
 * Returns true if the named kill switch is currently enabled.
 * Uses an in-process 5s cache to avoid a DB round-trip on every message.
 * Fails open (returns false) on any DB error so production is never blocked by admin infra.
 */
export async function isKillSwitchEnabled(key: string): Promise<boolean> {
  const now = Date.now();
  const entry = cache.get(key);
  if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.enabled;
  }
  try {
    const result = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM admin_kill_switches WHERE key = $1 LIMIT 1`,
      [key]
    );
    const enabled = result.rows[0]?.enabled ?? false;
    cache.set(key, { enabled, fetchedAt: now });
    return enabled;
  } catch {
    // Fail open — admin infra must never break production message flow
    return false;
  }
}

export function invalidateKillSwitchCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
