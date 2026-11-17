import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter, rateKey, retryAfterSeconds } from '../src/server/rate-limit';

const SECRET = 's'.repeat(32);

function limiter(): { rate: MemoryRateLimiter; clock: { now: number } } {
  const clock = { now: 1_800_000_000_000 };
  return { rate: new MemoryRateLimiter({ now: () => clock.now }), clock };
}

describe('MemoryRateLimiter', () => {
  it('lets `limit` requests through in a window, then says when the next one may come', async () => {
    const { rate, clock } = limiter();
    const rule = { limit: 3, windowMs: 60_000 };
    expect(await rate.limit('k', rule)).toEqual({ ok: true, remaining: 2 });
    clock.now += 10_000;
    expect(await rate.limit('k', rule)).toEqual({ ok: true, remaining: 1 });
    clock.now += 10_000;
    expect(await rate.limit('k', rule)).toEqual({ ok: true, remaining: 0 });
    clock.now += 5_000;
    // The first request leaves the window 60 s after it came: 35 s from now.
    expect(await rate.limit('k', rule)).toEqual({ ok: false, retryAfterMs: 35_000 });
    clock.now += 34_999;
    expect(await rate.limit('k', rule)).toEqual({ ok: false, retryAfterMs: 1 });
    clock.now += 1;
    expect(await rate.limit('k', rule)).toEqual({ ok: true, remaining: 0 });
    // Now the second request is the oldest in the window.
    expect(await rate.limit('k', rule)).toEqual({ ok: false, retryAfterMs: 10_000 });
  });

  it("doesn't count refused requests", async () => {
    const { rate, clock } = limiter();
    const rule = { limit: 1, windowMs: 1_000 };
    expect((await rate.limit('k', rule)).ok).toBe(true);
    for (let i = 0; i < 5; i++) {
      clock.now += 100;
      expect((await rate.limit('k', rule)).ok).toBe(false);
    }
    clock.now += 500;
    expect(await rate.limit('k', rule)).toEqual({ ok: true, remaining: 0 });
  });

  it('keeps keys apart', async () => {
    const { rate } = limiter();
    const rule = { limit: 1, windowMs: 1_000 };
    expect((await rate.limit('a', rule)).ok).toBe(true);
    expect((await rate.limit('b', rule)).ok).toBe(true);
    expect((await rate.limit('a', rule)).ok).toBe(false);
  });

  it('drops keys whose window has passed', async () => {
    const { rate, clock } = limiter();
    await rate.limit('a', { limit: 5, windowMs: 1_000 });
    await rate.limit('b', { limit: 5, windowMs: 10_000 });
    expect(rate.keys).toBe(2);
    clock.now += 1_000;
    await rate.limit('c', { limit: 5, windowMs: 1_000 });
    expect(rate.keys).toBe(2);
    clock.now += 9_000;
    await rate.limit('c', { limit: 5, windowMs: 1_000 });
    expect(rate.keys).toBe(1);
  });

  it('keeps a key long enough for the longest rule it was used with', async () => {
    const { rate, clock } = limiter();
    const long = { limit: 2, windowMs: 10_000 };
    await rate.limit('k', { limit: 9, windowMs: 1_000 });
    await rate.limit('k', long);
    clock.now += 5_000;
    await rate.limit('other', { limit: 1, windowMs: 1_000 });
    expect(await rate.limit('k', long)).toEqual({ ok: false, retryAfterMs: 5_000 });
  });

  it('counts from the right request when a key served a looser rule', async () => {
    const { rate, clock } = limiter();
    const loose = { limit: 5, windowMs: 10_000 };
    for (let i = 0; i < 3; i++) {
      expect((await rate.limit('k', loose)).ok).toBe(true);
      clock.now += 1_000;
    }
    // Three requests in the window, two allowed: the second-oldest must leave first.
    expect(await rate.limit('k', { limit: 2, windowMs: 10_000 })).toEqual({ ok: false, retryAfterMs: 8_000 });
  });

  it('refuses a rule that allows nothing or has no window', async () => {
    const { rate } = limiter();
    for (const rule of [
      { limit: 0, windowMs: 1_000 },
      { limit: 1.5, windowMs: 1_000 },
      { limit: 1, windowMs: 0 },
      { limit: 1, windowMs: 0.5 },
    ]) {
      expect(() => rate.limit('k', rule)).toThrow(RangeError);
    }
  });
});

describe('rateKey', () => {
  it('keys on an HMAC of the value, never the value itself', () => {
    const key = rateKey('pair-create', '203.0.113.7', SECRET);
    expect(key).toMatch(/^pair-create:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain('203.0.113.7');
    expect(rateKey('pair-create', '203.0.113.7', SECRET)).toBe(key);
    expect(rateKey('pair-create', '203.0.113.8', SECRET)).not.toBe(key);
    expect(rateKey('pair-create', '203.0.113.7', 't'.repeat(32))).not.toBe(key);
    expect(rateKey('pair-code', '203.0.113.7', SECRET).slice(10)).toBe(key.slice(12));
  });

  it('refuses a scope that is not a short name, and a short secret', () => {
    for (const scope of ['', 'Pair', 'pair:x', '1pair', 'a'.repeat(33)]) expect(() => rateKey(scope, 'x', SECRET)).toThrow(RangeError);
    expect(rateKey('a'.repeat(32), 'x', SECRET)).toMatch(/^a{32}:/);
    expect(() => rateKey('pair', 'x', 's'.repeat(31))).toThrow(RangeError);
  });
});

describe('retryAfterSeconds', () => {
  it('rounds up to whole seconds, at least 1', () => {
    expect(retryAfterSeconds({ ok: false, retryAfterMs: 1 })).toBe('1');
    expect(retryAfterSeconds({ ok: false, retryAfterMs: 0 })).toBe('1');
    expect(retryAfterSeconds({ ok: false, retryAfterMs: 1000 })).toBe('1');
    expect(retryAfterSeconds({ ok: false, retryAfterMs: 1001 })).toBe('2');
    expect(retryAfterSeconds({ ok: false, retryAfterMs: 35_000 })).toBe('35');
  });
});
