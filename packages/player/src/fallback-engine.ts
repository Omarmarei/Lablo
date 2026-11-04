/**
 * FallbackEngine (architecture.md §2, RELAY step 19): two engines as one, for the controller,
 * which drives a single engine. Every load goes to the primary; when the primary refuses the
 * source before it plays, and `accepts` says the fallback should try, the same source goes to
 * the fallback within the same `load()` call, with the same token. On Tizen the primary is
 * AVPlay and the fallback the `<video>` element, for HLS only ("used when AVPlay fails with
 * specific error codes"): which codes is the TV's answer (step 21), so the default is HLS
 * refused as unsupported.
 *
 * - Only the active engine's events reach the listeners: a late event from the other changes
 *   nothing.
 * - `stop()` stops both (an idle engine's stop does nothing), and a load still waiting for the
 *   primary's stop before the fallback opens rejects with `app`/`ABORTED`.
 * - `onActive` tells the platform which engine shows its picture (Tizen hides the `<video>`
 *   while AVPlay plays: AVPlay paints under the page).
 */

import type { EngineCaps, EngineEvent, EngineSource, EngineStats, LoadOptions, PlaybackError, PlayerEngine, Rect, Track } from './engine';
import { isPlaybackError } from './engine';

export interface FallbackOptions {
  /** Whether the fallback tries a source the primary refused with `error` (default: HLS refused as unsupported). */
  readonly accepts?: (source: EngineSource, error: PlaybackError) => boolean;
  /** The engine that plays now, on every change (and once at the start: the primary). */
  readonly onActive?: (engine: PlayerEngine) => void;
}

/** The default rule: an HLS source the primary says it can't play. */
export function hlsRefused(source: EngineSource, error: PlaybackError): boolean {
  return source.container === 'hls' && error.kind === 'unsupported';
}

const ABORTED: PlaybackError = { kind: 'app', code: 'ABORTED' };

export class FallbackEngine implements PlayerEngine {
  private readonly accepts: (source: EngineSource, error: PlaybackError) => boolean;
  private readonly onActive: ((engine: PlayerEngine) => void) | null;
  private active: PlayerEngine;
  /** Counts loads and stops: a fallback step of an older one is dropped. */
  private seq = 0;
  private listeners: ((e: EngineEvent & { readonly token: number }) => void)[] = [];
  private readonly unsubscribe: (() => void)[];

  constructor(
    private readonly primary: PlayerEngine,
    private readonly fallback: PlayerEngine,
    options: FallbackOptions = {},
  ) {
    this.accepts = options.accepts ?? hlsRefused;
    this.onActive = options.onActive ?? null;
    this.active = primary;
    this.unsubscribe = [primary, fallback].map((engine) =>
      engine.on((e) => {
        if (engine === this.active) this.emit(e);
      }),
    );
    if (this.onActive !== null) this.onActive(primary);
  }

  /** The engine that plays now. */
  get kind(): PlayerEngine['kind'] {
    return this.active.kind;
  }

  get caps(): EngineCaps {
    return this.active.caps;
  }

  /** The engine that plays now (for the platform's picture and tests). */
  get current(): PlayerEngine {
    return this.active;
  }

  load(source: EngineSource, token: number, opts?: LoadOptions): Promise<void> {
    const mine = ++this.seq;
    this.use(this.primary);
    return this.primary.load(source, token, opts).then(undefined, (reason: unknown) => {
      if (mine !== this.seq || !isPlaybackError(reason) || !this.accepts(source, reason)) throw reason;
      // The primary lets go of the source (and its connection) before the fallback opens it.
      return this.primary.stop().then(() => {
        if (mine !== this.seq) throw ABORTED;
        this.use(this.fallback);
        return this.fallback.load(source, token, opts);
      });
    });
  }

  stop(): Promise<void> {
    ++this.seq;
    return Promise.all([this.primary.stop(), this.fallback.stop()]).then(() => undefined);
  }

  play(): void {
    this.active.play();
  }

  pause(): void {
    this.active.pause();
  }

  seek(ms: number): Promise<void> {
    return this.active.seek(ms);
  }

  /** Both engines keep the rect, so either shows its picture there. */
  setRect(r: Rect | 'full'): void {
    this.primary.setRect(r);
    this.fallback.setRect(r);
  }

  getTracks(): { audio: Track[]; text: Track[] } {
    return this.active.getTracks();
  }

  selectAudio(id: string): Promise<boolean> {
    return this.active.selectAudio(id);
  }

  selectText(id: string | null): Promise<boolean> {
    return this.active.selectText(id);
  }

  positionMs(): number {
    return this.active.positionMs();
  }

  stats(): EngineStats {
    return this.active.stats();
  }

  suspend(): void {
    this.active.suspend();
  }

  resume(): void {
    this.active.resume();
  }

  on(cb: (e: EngineEvent & { readonly token: number }) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  destroy(): void {
    ++this.seq;
    for (const off of this.unsubscribe) off();
    this.primary.destroy();
    this.fallback.destroy();
    this.listeners = [];
  }

  private use(engine: PlayerEngine): void {
    if (engine === this.active) return;
    this.active = engine;
    if (this.onActive !== null) this.onActive(engine);
  }

  private emit(e: EngineEvent & { readonly token: number }): void {
    for (const listener of this.listeners.slice()) listener(e);
  }
}
