/**
 * A panel's answers kept per item (RELAY steps 26c and 27b): a movie's `get_vod_info`
 * (`vod-info.ts`), a show's `get_series_info` (`series-info.ts`). Each is asked only when the
 * user opens the item's details.
 *
 * - An answer is kept for `ttlMs` from when it came. The oldest goes first once more than `size`
 *   are kept.
 * - A failed ask isn't kept, so the next open asks again. A panel's "not found" (`null`) is an
 *   answer, and is kept.
 * - Two asks for one item while a request runs share it.
 * - Keyed by ContentKey, which holds no credentials.
 */

import type { ContentKey } from '@lablo/core';

export class PanelAnswers<T> {
  private readonly kept = new Map<ContentKey, { at: number; answer: T | null }>();
  private readonly running = new Map<ContentKey, Promise<T | null>>();

  constructor(
    private readonly ttlMs: number,
    private readonly size: number,
    private readonly now: () => number,
  ) {}

  /** The item's answer: the kept one while it is under `ttlMs` old, else `ask`'s. */
  get(key: ContentKey, ask: () => Promise<T | null>): Promise<T | null> {
    const hit = this.kept.get(key);
    if (hit !== undefined && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.answer);
    let request = this.running.get(key);
    if (request === undefined) {
      request = this.keep(key, ask);
      this.running.set(key, request);
    }
    return request;
  }

  private async keep(key: ContentKey, ask: () => Promise<T | null>): Promise<T | null> {
    try {
      const answer = await ask();
      this.kept.delete(key);
      this.kept.set(key, { at: this.now(), answer });
      while (this.kept.size > this.size) this.kept.delete(this.kept.keys().next().value as ContentKey);
      return answer;
    } finally {
      this.running.delete(key);
    }
  }
}
