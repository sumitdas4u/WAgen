type CacheKey = string;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryCache<T> {
  private store = new Map<CacheKey, CacheEntry<T>>();

  constructor(private readonly defaultTtlMs: number) {}

  get(key: CacheKey): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: CacheKey, value: T, ttlOverrideMs?: number): void {
    const ttl = ttlOverrideMs ?? this.defaultTtlMs;
    if (ttl <= 0) {
      this.store.delete(key);
      return;
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  delete(key: CacheKey): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

