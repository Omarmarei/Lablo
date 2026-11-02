import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { M3uKeyAllocator, isSourceId, m3uKeyHash, parseContentKey, xtreamKey } from './content-key';
import { hash53, hash53Base36 } from './hash';
import { normalizeName } from './normalize';

describe('hash53', () => {
  it('is pinned: stored M3U keys depend on these exact values', () => {
    expect(hash53Base36('')).toBe('14ahjukz9gl');
    expect(hash53Base36('a')).toBe('2anprqldv96');
    expect(hash53Base36('b')).toBe('18chrnwmejl');
    expect(hash53Base36('ab')).toBe('s4jcso2wfd');
    expect(hash53Base36('قناه الجزيره')).toBe(hash53Base36('قناه الجزيره'));
  });

  it('returns safe integers below 2^53', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 50 }), (s) => {
        const h = hash53(s);
        expect(Number.isSafeInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(hash53Base36(s)).toMatch(/^[0-9a-z]{1,11}$/);
      }),
    );
  });

  it('has no collisions over 300k similar names, and uses the high bits', () => {
    const seen = new Set<number>();
    let high = 0;
    for (let i = 0; i < 100_000; i++) {
      for (const s of [`channel ${i}`, `قناه ${i}`, `n${String.fromCharCode(1)}film ${i}${String.fromCharCode(1)}group ${i % 97}`]) {
        const h = hash53(s);
        seen.add(h);
        if (h >= 2 ** 52) high++;
      }
    }
    expect(seen.size).toBe(300_000);
    // About half the hashes have the top bit set if the 21 high bits are well mixed.
    expect(high / 300_000).toBeGreaterThan(0.45);
    expect(high / 300_000).toBeLessThan(0.55);
  });

  it('changes about half the bits when one character changes (avalanche)', () => {
    let flips = 0;
    let pairs = 0;
    for (let i = 0; i < 2000; i++) {
      const a = hash53(`name ${i}`);
      const b = hash53(`name ${i + 1}`);
      const lo = ((a % 2 ** 32) ^ (b % 2 ** 32)) >>> 0;
      const hi = (Math.floor(a / 2 ** 32) ^ Math.floor(b / 2 ** 32)) >>> 0;
      flips += popcount(lo) + popcount(hi);
      pairs++;
    }
    const mean = flips / pairs;
    expect(mean).toBeGreaterThan(53 / 2 - 2);
    expect(mean).toBeLessThan(53 / 2 + 2);
  });
});

function popcount(n: number): number {
  let c = 0;
  for (let x = n; x !== 0; x >>>= 1) c += x & 1;
  return c;
}

describe('xtreamKey', () => {
  it('builds x:<src>:<kind>:<id>', () => {
    expect(xtreamKey('s1', 'live', 12345)).toBe('x:s1:live:12345');
    expect(xtreamKey('src_2', 'movie', ' 200001 ')).toBe('x:src_2:movie:200001');
    expect(xtreamKey('s1', 'series', '400001')).toBe('x:s1:series:400001');
    expect(xtreamKey('s1', 'episode', 500123)).toBe('x:s1:episode:500123');
  });

  it('rejects bad source ids and ids', () => {
    expect(() => xtreamKey('s:1', 'live', 1)).toThrow(RangeError);
    expect(() => xtreamKey('', 'live', 1)).toThrow(RangeError);
    expect(() => xtreamKey('s1', 'live', -1)).toThrow(RangeError);
    expect(() => xtreamKey('s1', 'live', 1.5)).toThrow(RangeError);
    expect(() => xtreamKey('s1', 'live', Number.NaN)).toThrow(RangeError);
    expect(() => xtreamKey('s1', 'live', 'a:b')).toThrow(RangeError);
    expect(() => xtreamKey('s1', 'live', '  ')).toThrow(RangeError);
    expect(isSourceId('s1')).toBe(true);
    expect(isSourceId('x'.repeat(33))).toBe(false);
  });
});

describe('M3U keys', () => {
  it('are pinned for a tvg-id entry and a name+group entry', () => {
    // Golden values: if these change, every stored M3U favourite is orphaned (ADR-009).
    expect(m3uKeyHash({ tvgId: 'bbc1.uk', normName: 'bbc one', normGroup: 'uk' })).toBe('1dp8o63arjt');
    expect(m3uKeyHash({ tvgId: null, normName: 'bbc one', normGroup: 'uk' })).toBe('1hl9g6qycux');
    const keys = new M3uKeyAllocator('s1');
    const fields = { tvgId: null, normName: normalizeName('قناة الجزيرة'), normGroup: normalizeName('AR | أخبار') };
    expect(keys.next(fields)).toBe(`m:s1:${m3uKeyHash(fields)}:0`);
    expect(keys.next(fields)).toBe(`m:s1:${m3uKeyHash(fields)}:1`);
  });

  it('ignore tvg-id case and surrounding spaces, and the group when a tvg-id is present', () => {
    const a = m3uKeyHash({ tvgId: ' BBC1.uk ', normName: 'bbc one', normGroup: 'uk' });
    expect(a).toBe(m3uKeyHash({ tvgId: 'bbc1.uk', normName: 'bbc one', normGroup: 'news' }));
    // An empty tvg-id is no tvg-id.
    expect(m3uKeyHash({ tvgId: ' ', normName: 'bbc one', normGroup: 'uk' })).toBe(m3uKeyHash({ tvgId: null, normName: 'bbc one', normGroup: 'uk' }));
  });

  it('keep HD and SD variants that share a tvg-id apart', () => {
    const hd = m3uKeyHash({ tvgId: 'mbc1.ae', normName: 'mbc 1 hd', normGroup: 'ar' });
    const sd = m3uKeyHash({ tvgId: 'mbc1.ae', normName: 'mbc 1 sd', normGroup: 'ar' });
    expect(hd).not.toBe(sd);
  });

  it('do not let field boundaries blur', () => {
    expect(m3uKeyHash({ tvgId: null, normName: 'ab', normGroup: 'c' })).not.toBe(m3uKeyHash({ tvgId: null, normName: 'a', normGroup: 'bc' }));
  });

  it('number duplicates per source in order', () => {
    const keys = new M3uKeyAllocator('s9');
    const f = { tvgId: 'x', normName: 'n', normGroup: '' };
    const g = { tvgId: 'y', normName: 'n', normGroup: '' };
    expect([keys.next(f), keys.next(g), keys.next(f), keys.next(f)].map((k) => k.split(':')[3])).toEqual(['0', '0', '1', '2']);
    expect(() => new M3uKeyAllocator('bad id')).toThrow(RangeError);
  });
});

describe('parseContentKey', () => {
  it('round-trips both key types', () => {
    expect(parseContentKey('x:s1:episode:500123')).toEqual({ type: 'xtream', src: 's1', kind: 'episode', id: '500123' });
    expect(parseContentKey('m:s1:1dp8o63arjt:2')).toEqual({ type: 'm3u', src: 's1', hash: '1dp8o63arjt', dup: 2 });
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{1,32}$/), fc.constantFrom('live', 'movie', 'series', 'episode') as fc.Arbitrary<'live'>, fc.nat(), (src, kind, id) => {
        expect(parseContentKey(xtreamKey(src, kind, id))).toEqual({ type: 'xtream', src, kind, id: String(id) });
      }),
    );
  });

  it('rejects malformed keys', () => {
    for (const bad of ['', 'x:s1:live', 'x:s1:radio:1', 'x:s 1:live:1', 'm:s1:UPPER:0', 'm:s1:abc:01', 'm:s1:abc:-1', 'q:s1:live:1', 'x:s1:live:1:2']) {
      expect(parseContentKey(bad), bad).toBeNull();
    }
  });
});
