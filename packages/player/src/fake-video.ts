/**
 * A `<video>` element for the Html5Engine's tests, on a `FakeClock`. Not exported from the
 * package entry.
 *
 * A browser changes the element's state first and fires the event later (a queued task), so the
 * fake keeps them apart: `move()`, `freeze()`, `showPicture()` and `failWith()` only change state,
 * and `fire()` sends an event. A test scripts the order and the time between them.
 */

import type { FakeClock } from './fake-engine';
import type { AudioTrackLike, AudioTrackListLike, MediaElementLike, TextTrackLike, TrackListLike } from './html5-engine';

export class FakeAudioTrack implements AudioTrackLike {
  /** Every value written to `enabled`, across all tracks of a list (set by `trackList`). */
  writes: string[] | null = null;
  private on: boolean;

  constructor(
    readonly language: string,
    readonly label: string,
    enabled: boolean,
    /** An element that lists tracks but ignores switches (the S5 "unreliable" case). */
    private readonly stuck = false,
  ) {
    this.on = enabled;
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    if (this.writes !== null) this.writes.push(this.language + '=' + String(value));
    if (!this.stuck) this.on = value;
  }
}

export class FakeTextTrack implements TextTrackLike {
  constructor(
    readonly language: string,
    readonly label: string,
    public mode: string = 'disabled',
  ) {}
}

type Listener = () => void;

/** A track list with the element's event methods; `writes` logs every `enabled` write. */
export function audioTrackList(tracks: FakeAudioTrack[]): AudioTrackListLike & { readonly writes: string[]; readonly listeners: Record<string, Listener[]>; fire(type: string): void } {
  const writes: string[] = [];
  const listeners: Record<string, Listener[]> = {};
  const list: { [index: number]: FakeAudioTrack } = {};
  tracks.forEach((track, i) => {
    track.writes = writes;
    list[i] = track;
  });
  return Object.assign(list, {
    length: tracks.length,
    writes,
    listeners,
    addEventListener(type: string, listener: Listener): void {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener(type: string, listener: Listener): void {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
    fire(type: string): void {
      for (const listener of (listeners[type] ?? []).slice()) listener();
    },
  });
}

export function textTrackList(tracks: FakeTextTrack[]): TrackListLike<TextTrackLike> {
  const list: { [index: number]: FakeTextTrack } = {};
  tracks.forEach((track, i) => {
    list[i] = track;
  });
  return Object.assign(list, { length: tracks.length });
}

export class FakeVideo implements MediaElementLike {
  muted = false;
  /** Seconds (NaN: no metadata yet). */
  duration = NaN;
  videoWidth = 0;
  videoHeight = 0;
  error: { readonly code: number } | null = null;
  readonly style = { left: '', top: '', width: '', height: '', objectFit: '' };
  audioTracks?: AudioTrackListLike;
  textTracks?: TrackListLike<TextTrackLike>;
  mediaId?: string;
  getVideoPlaybackQuality?: () => { readonly droppedVideoFrames: number; readonly totalVideoFrames?: number };
  webkitDecodedFrameCount?: number;
  webkitDroppedFrameCount?: number;
  webkitVideoDecodedByteCount?: number;
  webkitAudioDecodedByteCount?: number;
  /** What the engine did to the element, in order: `src <url>`, `play`, `pause`, `removeAttribute src`, `load`, `seek <s>`, `muted`. */
  readonly log: string[] = [];
  /** `canPlayType` answers by MIME type ('' for any other). */
  canPlay: Record<string, string> = {};
  /** What `play()` returns. */
  playResult: () => Promise<void> | undefined = () => Promise.resolve();
  readonly listeners: Record<string, Listener[]> = {};
  private base = 0;
  private movingSince: number | null = null;
  private srcValue = '';

  constructor(private readonly clock: FakeClock) {}

  get src(): string {
    return this.srcValue;
  }

  set src(url: string) {
    this.srcValue = url;
    this.log.push('src ' + url);
  }

  get currentTime(): number {
    return this.base + (this.movingSince === null ? 0 : (this.clock.now() - this.movingSince) / 1000);
  }

  set currentTime(seconds: number) {
    this.log.push('seek ' + String(seconds));
    this.base = seconds;
    if (this.movingSince !== null) this.movingSince = this.clock.now();
  }

  addEventListener(type: string, listener: Listener): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  get listenerCount(): number {
    let n = 0;
    for (const type of Object.keys(this.listeners)) n += (this.listeners[type] ?? []).length;
    return n;
  }

  removeAttribute(name: string): void {
    this.log.push('removeAttribute ' + name);
    if (name === 'src') this.srcValue = '';
  }

  load(): void {
    this.log.push('load');
    this.base = 0;
    this.movingSince = null;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.error = null;
  }

  play(): Promise<void> | undefined {
    this.log.push('play');
    return this.playResult();
  }

  pause(): void {
    this.log.push('pause');
    this.freeze();
  }

  canPlayType(type: string): string {
    return this.canPlay[type] ?? '';
  }

  /** The clock starts moving (no event). */
  move(): void {
    if (this.movingSince === null) this.movingSince = this.clock.now();
  }

  /** The clock stops (no event). */
  freeze(): void {
    if (this.movingSince === null) return;
    this.base = this.currentTime;
    this.movingSince = null;
  }

  /** The picture size is known (no event). */
  showPicture(width = 1920, height = 1080): void {
    this.videoWidth = width;
    this.videoHeight = height;
  }

  /** `error` is set (no event). */
  failWith(code: number): void {
    this.error = { code };
  }

  /** Fires `type` to the element's listeners. */
  fire(type: string): void {
    for (const listener of (this.listeners[type] ?? []).slice()) listener();
  }
}
