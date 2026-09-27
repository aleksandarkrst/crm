/** At most `limit` requests per `windowMs` for one key. */
export interface RateRule {
  limit: number;
  windowMs: number;
}

export interface RateVerdict {
  allowed: boolean;
  /** Seconds until the key's window resets (at least 1). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters in memory (CD-18). Enough for the single API container production runs;
 * running several API replicas would need a shared store (e.g. PostgreSQL or Redis) instead,
 * because each replica would count on its own.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private hits = 0;

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, rule: RateRule): RateVerdict {
    const now = this.now();
    // Drop finished windows now and then, so keys of past clients don't pile up.
    if (++this.hits % 1000 === 0) this.sweep(now);

    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + rule.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return { allowed: window.count <= rule.limit, retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
  }

  /** Number of keys held (for tests). */
  get size(): number {
    return this.windows.size;
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
