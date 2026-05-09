import { pool } from "../db/pool.js";
import { firstRow } from "../db/sql-helpers.js";

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export async function checkFeatureFlag(workspaceId: string, flagKey: string): Promise<boolean> {
  const cacheKey = `${workspaceId}:${flagKey}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    // Workspace override takes priority over global settings
    const overrideResult = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM workspace_feature_overrides
       WHERE workspace_id = $1 AND flag_key = $2 LIMIT 1`,
      [workspaceId, flagKey]
    );
    const override = firstRow(overrideResult);

    let value: boolean;
    if (override !== null) {
      value = override.enabled;
    } else {
      const flagResult = await pool.query<{ enabled_globally: boolean; rollout_percent: number }>(
        `SELECT enabled_globally, rollout_percent FROM feature_flags WHERE key = $1 LIMIT 1`,
        [flagKey]
      );
      const flag = firstRow(flagResult);
      if (!flag) {
        value = false;
      } else if (flag.enabled_globally) {
        value = true;
      } else if (flag.rollout_percent > 0) {
        // Deterministic rollout: hash workspace_id to 0-99
        const hash = workspaceId.split("").reduce((acc, c) => ((acc * 31 + c.charCodeAt(0)) & 0xfffffff), 0);
        value = (hash % 100) < flag.rollout_percent;
      } else {
        value = false;
      }
    }

    cache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch {
    return false; // Fail open — feature flag check must never break app flows
  }
}

export function invalidateFeatureFlagCache(workspaceId?: string, flagKey?: string): void {
  if (!workspaceId && !flagKey) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (workspaceId && key.startsWith(`${workspaceId}:`)) {
      cache.delete(key);
    } else if (flagKey && key.endsWith(`:${flagKey}`)) {
      cache.delete(key);
    }
  }
}
