/**
 * AVPlay, Samsung's native player, typed (RELAY step 15c2): the lab's S4 and S8 batteries drive it
 * now, and the app's AvplayEngine (step 19) will. From `$WEBAPIS/webapis/webapis.js`, which exists
 * only on a TV:
 * - `webapis.avplay`: the one player every Tizen TV has;
 * - `webapis.avplaystore.getPlayer()`: another player instance, for pre-buffering (up to 4 at once;
 *   past that, or short of memory, it throws `QUOTA_EXCEEDED_ERR`). Spike S8 asks which TVs have it.
 *
 * AVPlay draws on the TV's video plane, under the page, inside the rect `setDisplayRect` gives
 * (in a 1920×1080 space): whatever covers that rect must be transparent (docs/architecture.md §2,
 * "AVPlay layering"). Every call can throw a `WebAPIException` (a wrong state, a bad argument).
 * https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html
 * https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplaystore-api.html
 */

/** `getState()`: NONE, IDLE (opened), READY (prepared), PLAYING, PAUSED. */
export type AvplayState = 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED';

/** A stream of the file as `getTotalTrackInfo()` and `getCurrentStreamInfo()` list it. */
export interface AvplayStreamInfo {
  /** The stream's index in the file, which `setSelectTrack` takes. */
  readonly index: number;
  /** `VIDEO`, `AUDIO` or `TEXT`. */
  readonly type: string;
  /** JSON text: VIDEO `fourCC, Width, Height, Bit_rate`; AUDIO `language, channels, sample_rate, bit_rate, fourCC`; TEXT `track_num, track_lang, subtitle_type, fourCC`. */
  readonly extra_info: string;
}

/** What a failed call or `prepareAsync`'s error callback gives (a `WebAPIException` or `WebAPIError`). */
export interface AvplayError {
  readonly name?: string;
  readonly code?: number;
  readonly message?: string;
}

/** `setListener`'s callbacks. */
export interface AvplayListener {
  onbufferingstart?(): void;
  onbufferingprogress?(percent: number): void;
  onbufferingcomplete?(): void;
  /** The playback position in ms, while playing. */
  oncurrentplaytime?(ms: number): void;
  onstreamcompleted?(): void;
  onevent?(event: string, data: string): void;
  /** An `AVPlayError` name: `PLAYER_ERROR_CONNECTION_FAILED`, `PLAYER_ERROR_NOT_SUPPORTED_FORMAT`… */
  onerror?(error: string): void;
  /** An embedded subtitle's text; `type` '0' is text, '1' an image. */
  onsubtitlechange?(duration: string | number, text: string, type: string | number, attributes?: unknown): void;
}

/** The slice of an AVPlay player (`webapis.avplay`, or one from `avplaystore.getPlayer()`). */
export interface AvplayManager {
  open(url: string): void;
  close(): void;
  prepareAsync(onsuccess?: () => void, onerror?: (error: AvplayError) => void): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setListener(listener: AvplayListener): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo?(ms: number, onsuccess?: () => void, onerror?: (error: AvplayError) => void): void;
  getState(): string;
  getCurrentTime(): number;
  getDuration?(): number;
  getTotalTrackInfo(): readonly AvplayStreamInfo[];
  getCurrentStreamInfo(): readonly AvplayStreamInfo[];
  /** `AUDIO` or `TEXT`, and the stream's `index`. */
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void;
  /** true hides the embedded subtitles (and stops their callback). */
  setSilentSubtitle?(silent: boolean): void;
  /** Called when the app goes to the background (READY, PLAYING, PAUSED). */
  suspend(): void;
  /** Back from the background: `url` null keeps the stored one; `resumeTime` means nothing for live and must not be 0. */
  restore(url?: string | null, resumeTime?: number | null, prepare?: boolean | null): void;
  getVersion?(): string;
}

export interface AvplayStore {
  /** A new player instance; throws `QUOTA_EXCEEDED_ERR` past 4 or short of memory. */
  getPlayer(): AvplayManager;
}

/** The slice of `webapis` this module reads. */
export interface AvplayWebApis {
  readonly avplay?: AvplayManager;
  readonly avplaystore?: AvplayStore;
}

function pageWebapis(): AvplayWebApis | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { webapis?: AvplayWebApis }).webapis;
}

/** `webapis.avplay` on a Samsung TV, or null (a desktop browser, the old-engine harness). */
export function tizenAvplay(webapis: AvplayWebApis | undefined = pageWebapis()): AvplayManager | null {
  const avplay = webapis?.avplay;
  return avplay !== undefined && avplay !== null && typeof avplay.open === 'function' ? avplay : null;
}

/** `webapis.avplaystore` on a TV that has it, or null. */
export function tizenAvplayStore(webapis: AvplayWebApis | undefined = pageWebapis()): AvplayStore | null {
  const store = webapis?.avplaystore;
  return store !== undefined && store !== null && typeof store.getPlayer === 'function' ? store : null;
}

/** An error from AVPlay in a few words: its name, code and message, whichever it has. */
export function avplayErrorText(error: unknown): string {
  if (typeof error === 'string') return error === '' ? 'no details' : error;
  if (error === null || typeof error !== 'object') return String(error);
  const { name, code, message } = error as AvplayError;
  const parts: string[] = [];
  if (typeof name === 'string' && name !== '') parts.push(name);
  if (typeof code === 'number') parts.push(`code ${code}`);
  if (typeof message === 'string' && message !== '' && message !== name) parts.push(message);
  return parts.length === 0 ? 'no details' : parts.join(', ');
}

/** The `AVPlayError` names that mean "this TV can't play this file or codec". */
const UNSUPPORTED_ERRORS = ['PLAYER_ERROR_NOT_SUPPORTED_FILE', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', 'PLAYER_ERROR_NOT_SUPPORTED_AUDIO_CODEC', 'PLAYER_ERROR_NOT_SUPPORTED_VIDEO_CODEC'];

export function avplayUnsupported(name: string): boolean {
  return UNSUPPORTED_ERRORS.indexOf(name) !== -1;
}

/** A stream with its `extra_info` read. */
export interface AvplayTrack {
  /** The stream's index in the file (for `setSelectTrack`). */
  readonly index: number;
  readonly type: string;
  /** AUDIO `language`, TEXT `track_lang`; '' when absent. */
  readonly lang: string;
  /** `fourCC`; '' when absent. */
  readonly codec: string;
  readonly channels: number | null;
  readonly width: number | null;
  readonly height: number | null;
  /** Every field of `extra_info`, as text. */
  readonly extra: Readonly<Record<string, string>>;
}

function intOf(text: string | undefined): number | null {
  if (text === undefined || !/^\d+$/.test(text)) return null;
  return Number(text);
}

/** `extra_info`'s fields as text; {} when it isn't a JSON object. */
export function avplayExtraInfo(text: unknown): Record<string, string> {
  if (typeof text !== 'string') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  const record = parsed as Record<string, unknown>;
  for (const key in record) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

/** The streams `getTotalTrackInfo()` or `getCurrentStreamInfo()` gave, read; entries without an index or a type are left out. */
export function avplayTracks(infos: unknown): AvplayTrack[] {
  const tracks: AvplayTrack[] = [];
  if (infos === null || typeof infos !== 'object' || typeof (infos as { length?: unknown }).length !== 'number') return tracks;
  const list = infos as ArrayLike<unknown>;
  for (let i = 0; i < list.length; i += 1) {
    const info = list[i] as Partial<AvplayStreamInfo> | null | undefined;
    if (info === null || typeof info !== 'object' || typeof info.type !== 'string') continue;
    // A long by the reference; some firmware may hand it over as text.
    const raw = info.index as unknown;
    const index = typeof raw === 'number' ? raw : typeof raw === 'string' ? intOf(raw) : null;
    if (index === null) continue;
    const extra = avplayExtraInfo(info.extra_info);
    tracks.push({
      index,
      type: info.type,
      lang: extra.language ?? extra.track_lang ?? '',
      codec: extra.fourCC ?? '',
      channels: intOf(extra.channels),
      width: intOf(extra.Width),
      height: intOf(extra.Height),
      extra,
    });
  }
  return tracks;
}
