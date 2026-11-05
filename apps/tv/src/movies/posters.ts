import type { DeviceTier } from '@zoma/core';

/**
 * Which posters a grid draws (RELAY step 26a). Providers' posters come at their own size (no
 * server may resize them: architecture.md's risk table), and a decoded poster costs its full
 * size in memory, so the caps are the client's:
 *
 * - **Only the rows in view are drawn** (`VirtualGrid`), so at most a view's tiles hold an
 *   image; a row that leaves the view leaves the DOM, and its decoded images can go.
 * - **Nothing loads while the view moves:** the posters of a view are asked once it has rested
 *   (`POSTER_TIERS[tier].restMs`). A tile that comes into view meanwhile shows its title on the
 *   tile's background; one that stays in view keeps its poster.
 * - **A few downloads at a time** (`parallel`), the focused tile's row first, so a slow image
 *   server doesn't hold a TV's connections (a stream may be playing).
 * - **A poster that failed** stays failed (its tile shows the title) until `POSTER_MEMORY` other
 *   posters have been seen.
 *
 * `PosterLoader` holds no DOM: the screen gives each drawn tile `src(url)` as its image, and
 * calls `loaded`/`failed` from the image's events.
 */

export interface PosterTier {
  /** How long the view must rest before its posters are asked. */
  readonly restMs: number;
  /** Posters downloading at once. */
  readonly parallel: number;
}

/** The low tier (2018–19 Samsung, ADR-012) rests longer and downloads fewer at once. */
export const POSTER_TIERS: Readonly<Record<DeviceTier, PosterTier>> = {
  full: { restMs: 150, parallel: 6 },
  low: { restMs: 300, parallel: 2 },
};

/** Posters whose outcome is remembered (loaded or failed), the least recently seen dropped first. */
export const POSTER_MEMORY = 1000;

export class PosterLoader {
  /** Outcomes, the least recently seen first (a Map keeps insertion order). */
  private readonly done = new Map<string, 'shown' | 'failed'>();
  private readonly loading: string[] = [];
  private queue: string[] = [];
  /** The posters whose images may be drawn: the view's at its last rest, loaded or loading. */
  private given: string[] = [];

  constructor(
    private readonly parallel: number,
    private readonly memory: number = POSTER_MEMORY,
  ) {}

  /** The image a tile with poster `url` draws (`undefined`: none, the title on its background). */
  src(url: string | null): string | undefined {
    return url !== null && this.given.indexOf(url) !== -1 ? url : undefined;
  }

  /** Posters downloading now. */
  inFlight(): number {
    return this.loading.length;
  }

  /**
   * The view rested on tiles with posters `urls`, in the order they are wanted: what loaded
   * before draws at once, the others are asked `parallel` at a time. A download of a poster no
   * longer in view is let go (its tile left the DOM, and its event may never come).
   */
  rest(urls: readonly (string | null)[]): void {
    const wanted: string[] = [];
    for (const url of urls) if (url !== null && url !== '' && wanted.indexOf(url) === -1) wanted.push(url);
    for (let i = this.loading.length - 1; i >= 0; i -= 1) if (wanted.indexOf(this.loading[i]!) === -1) this.loading.splice(i, 1);
    this.given = [];
    this.queue = [];
    for (const url of wanted) {
      const outcome = this.done.get(url);
      if (outcome === 'failed') continue;
      if (outcome === 'shown' || this.loading.indexOf(url) !== -1) this.given.push(url);
      else this.queue.push(url);
    }
    this.fill();
  }

  /** Poster `url`'s image arrived. */
  loaded(url: string): void {
    this.settle(url, 'shown');
  }

  /** Poster `url`'s image failed: its tile draws the title from now on. */
  failed(url: string): void {
    this.settle(url, 'failed');
    const at = this.given.indexOf(url);
    if (at !== -1) this.given.splice(at, 1);
  }

  /** Every poster is forgotten (the screen closed, or another catalog came). */
  clear(): void {
    this.done.clear();
    this.loading.length = 0;
    this.queue = [];
    this.given = [];
  }

  private settle(url: string, outcome: 'shown' | 'failed'): void {
    const at = this.loading.indexOf(url);
    if (at !== -1) this.loading.splice(at, 1);
    this.done.delete(url);
    this.done.set(url, outcome);
    if (this.done.size > this.memory) {
      // (No iterator call: it would pull core-js's iterator modules into the TV bundle.)
      const oldest: string[] = [];
      this.done.forEach((_outcome, key) => {
        if (oldest.length === 0) oldest.push(key);
      });
      if (oldest.length > 0) this.done.delete(oldest[0]!);
    }
    this.fill();
  }

  private fill(): void {
    while (this.loading.length < this.parallel && this.queue.length > 0) {
      const url = this.queue.shift()!;
      this.loading.push(url);
      this.given.push(url);
    }
  }
}
