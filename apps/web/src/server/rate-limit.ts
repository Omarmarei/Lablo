/**
 * Rate limiting (architecture.md §3.2-3.3; RELAY step 29b2a): Upstash Redis in production (step
 * 31 or 34 adds that adapter, with a narrow exception in the outbound-network lint),
 * `MemoryRateLimiter` in development and tests.
 *
 * IP addresses are used for rate limiting only and never stored: a route limits on `rateKey`,
 * an HMAC of the address under a server secret, so not even the limiter's store holds an IP.
 */
import { createHmac } from 'node:crypto';

/** At most `limit` requests in any `windowMs`. */
export interface RateRule {
  readonly limit: number;
  readonly windowMs: number;
}

export type RateDecision = { readonly ok: true; readonly remaining: number } | { readonly ok: false; readonly retryAfterMs: number };

export interface RateLimiter {
  /** Counts one request against `key` and says whether it may go ahead. */
  limit(key: string, rule: RateRule): Promise<RateDecision>;
}

/** `<scope>:<b64url(HMAC-SHA256(secret, value))>`: what the limiter keys on instead of an IP. */
export function rateKey(scope: string, value: string, secret: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(scope)) throw new RangeError('a scope is a short lower-case name');
  if (secret.length < 32) throw new RangeError('the rate key secret is at least 32 characters');
  return `${scope}:${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

/** The `Retry-After` header's value: whole seconds, at least 1. */
export function retryAfterSeconds(decision: Extract<RateDecision, { ok: false }>): string {
  return String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
}

function checkRule(rule: RateRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit < 1) throw new RangeError('a limit is at least 1 request');
  if (!Number.isInteger(rule.windowMs) || rule.windowMs < 1) throw new RangeError('a window is at least 1 ms');
}

/**
 * A sliding-window log in memory: exact, for development and tests. Each key keeps the times of
 * its requests inside the window; a refused request isn't counted. Keys whose window has passed
 * are dropped as calls come in, so memory follows the keys active in the last window.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly log = new Map<string, { times: number[]; windowMs: number }>();
  private readonly now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  limit(key: string, rule: RateRule): Promise<RateDecision> {
    checkRule(rule);
    const now = this.now();
    this.sweep(now);
    const entry = this.log.get(key) ?? { times: [], windowMs: rule.windowMs };
    entry.windowMs = Math.max(entry.windowMs, rule.windowMs);
    const recent = entry.times.filter((at) => at > now - rule.windowMs);
    if (recent.length >= rule.limit) {
      const oldest = recent[recent.length - rule.limit]!;
      return Promise.resolve({ ok: false, retryAfterMs: oldest + rule.windowMs - now });
    }
    entry.times = [...entry.times.filter((at) => at > now - entry.windowMs), now];
    this.log.set(key, entry);
    return Promise.resolve({ ok: true, remaining: rule.limit - recent.length - 1 });
  }

  /** The keys it holds (tests). */
  get keys(): number {
    return this.log.size;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.log) {
      const last = entry.times[entry.times.length - 1];
      if (last === undefined || last <= now - entry.windowMs) this.log.delete(key);
    }
  }
}
