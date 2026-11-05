import { describe, expect, it } from 'vitest';
import { POSTER_MEMORY, POSTER_TIERS, PosterLoader } from './posters';

const u = (n: number): string => `http://img.test/${n}.jpg`;
const urls = (...ns: number[]): string[] => ns.map(u);
/** The posters that draw, of `ns`. */
const drawn = (p: PosterLoader, ...ns: number[]): number[] => ns.filter((n) => p.src(u(n)) !== undefined);

describe('the posters a grid draws (RELAY step 26a)', () => {
  it('rests longer and downloads fewer at once on the low tier', () => {
    expect(POSTER_TIERS.full).toEqual({ restMs: 150, parallel: 6 });
    expect(POSTER_TIERS.low).toEqual({ restMs: 300, parallel: 2 });
    expect(POSTER_MEMORY).toBe(1000);
  });

  it('draws nothing before a rest, then asks `parallel` posters at a time, in the order wanted', () => {
    const p = new PosterLoader(2);
    expect(drawn(p, 1, 2, 3)).toEqual([]);
    expect(p.inFlight()).toBe(0);
    p.rest(urls(3, 1, 2, 4));
    expect(drawn(p, 1, 2, 3, 4)).toEqual([1, 3]);
    expect(p.inFlight()).toBe(2);
    p.loaded(u(3));
    expect(drawn(p, 1, 2, 3, 4)).toEqual([1, 2, 3]);
    expect(p.inFlight()).toBe(2);
    p.loaded(u(1));
    p.loaded(u(2));
    expect(drawn(p, 1, 2, 3, 4)).toEqual([1, 2, 3, 4]);
    expect(p.inFlight()).toBe(1);
    p.loaded(u(4));
    expect(p.inFlight()).toBe(0);
  });

  it('skips tiles without a poster and asks a poster shared by two tiles once', () => {
    const p = new PosterLoader(6);
    p.rest([null, u(1), '', u(1), u(2)]);
    expect(p.inFlight()).toBe(2);
    expect(p.src(null)).toBeUndefined();
    expect(drawn(p, 1, 2)).toEqual([1, 2]);
  });

  it('keeps what loaded for the next rest, and lets go of downloads that left the view', () => {
    const p = new PosterLoader(2);
    p.rest(urls(1, 2, 3));
    p.loaded(u(1));
    expect(drawn(p, 1, 2, 3)).toEqual([1, 2, 3]);
    // The view moved on before 2 and 3 came: 1 and 4 now.
    p.rest(urls(4, 1));
    expect(drawn(p, 1, 2, 3, 4)).toEqual([1, 4]);
    expect(p.inFlight()).toBe(1);
    // A late event of a tile that left the DOM is no harm: 2 draws at once when it comes back.
    p.loaded(u(2));
    expect(p.inFlight()).toBe(1);
    p.rest(urls(2, 5));
    expect(drawn(p, 2, 5)).toEqual([2, 5]);
  });

  it("asks nothing the view moved away from before its turn came", () => {
    const p = new PosterLoader(1);
    p.rest(urls(1, 2, 3));
    p.rest(urls(4));
    expect(drawn(p, 1, 2, 3, 4)).toEqual([4]);
    p.loaded(u(4));
    expect(drawn(p, 1, 2, 3, 4)).toEqual([4]);
    expect(p.inFlight()).toBe(0);
  });

  it('keeps a poster that is still downloading through a rest that still wants it', () => {
    const p = new PosterLoader(1);
    p.rest(urls(1, 2));
    p.rest(urls(2, 1));
    // 1 is downloading still: it keeps its place and its image; 2 waits for it.
    expect(drawn(p, 1, 2)).toEqual([1]);
    expect(p.inFlight()).toBe(1);
    p.loaded(u(1));
    expect(drawn(p, 1, 2)).toEqual([1, 2]);
  });

  it('draws the title instead of a poster that failed, and asks it no more', () => {
    const p = new PosterLoader(2);
    p.rest(urls(1, 2, 3));
    p.failed(u(1));
    expect(drawn(p, 1, 2, 3)).toEqual([2, 3]);
    p.rest(urls(1, 2, 3));
    expect(drawn(p, 1, 2, 3)).toEqual([2, 3]);
    expect(p.inFlight()).toBe(2);
  });

  it('forgets the least recently seen outcome past its memory, so an old failure is asked again', () => {
    const p = new PosterLoader(1, 2);
    p.rest(urls(1));
    p.failed(u(1));
    p.rest(urls(2));
    p.loaded(u(2));
    p.rest(urls(3));
    p.loaded(u(3));
    p.rest(urls(1));
    expect(drawn(p, 1)).toEqual([1]);
    expect(p.inFlight()).toBe(1);
  });

  it('counts a poster drawn again as seen: the least recently seen goes, not the oldest', () => {
    const p = new PosterLoader(1, 2);
    p.rest(urls(1));
    p.loaded(u(1));
    p.rest(urls(2));
    p.loaded(u(2));
    // 1 draws again (its image's load event comes again), then 3 comes: 2 is forgotten.
    p.rest(urls(1));
    p.loaded(u(1));
    p.rest(urls(3));
    p.loaded(u(3));
    p.rest(urls(1));
    expect(p.inFlight()).toBe(0);
    p.rest(urls(2));
    expect(drawn(p, 2)).toEqual([2]);
    expect(p.inFlight()).toBe(1);
  });

  it('forgets everything on clear', () => {
    const p = new PosterLoader(2);
    p.rest(urls(1, 2, 3));
    p.loaded(u(1));
    p.failed(u(2));
    p.clear();
    expect(drawn(p, 1, 2, 3)).toEqual([]);
    expect(p.inFlight()).toBe(0);
    p.rest(urls(2));
    expect(drawn(p, 2)).toEqual([2]);
  });
});
