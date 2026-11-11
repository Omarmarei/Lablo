/**
 * The player battery (RELAY step 15c, docs/architecture.md §5 S4 and S5): one check per row of
 * the matrix, written once against `LabPlayer`, so the `<video>` element (S5) and AVPlay (S4,
 * step 15c2, `avplay-player.ts`) answer the same questions:
 *
 * - `formats`: the lab server's media (`/__lab/media`) and what the engine says it plays;
 * - `ts`, `hls`: a live channel's first frame (TS < 2.5 s, < 4 s on the low tier; HLS < 4 s);
 * - `redirect`: the live channel through 3 × 302, in the first container that played;
 * - `redirect-probe` (with `probeRedirect`: AVPlay, S4): the same at the URL the redirect probe
 *   found, where AVPlay may freeze on the 302s themselves;
 * - `hevc-4k`: the 4K HEVC file shows 3840×2160 frames (needed on 2020+ TVs);
 * - `audio-tracks`: the MKV's audio tracks listed, and a switch to another one in < 2 s without
 *   the stream starting over: through the engine's list, else the platform's service (webOS luna
 *   `selectTrack`, step 15c2); the record says which route worked;
 * - `ac3`: its AC3 and E-AC3 5.1 tracks play (chosen the same way);
 * - `subtitles`: in-band SRT (MKV) and mov_text (MP4) tracks listed and their cues arriving;
 * - `suspend` (a person): Home and back, playing again in < 5 s;
 * - `soak` (a person starts it; 60 min by default): the live TS with a stall every ~18 s, each one
 *   recovered in < 10 s by a watchdog that reopens after 6 s without progress, as the app's
 *   PlayerController will (architecture.md §2). An engine without TS soaks on a VOD file instead.
 *
 * Against placeholder bytes (the lab server without `pnpm mock:media`) everything but `formats`
 * skips. No record holds a URL: they carry the mock's test account.
 */
import type { LifecycleEvent, Platform } from '@lablo/platform-api';
import type { RedirectProbe } from './http';
import type { LabMedia, LabMediaId, LabMediaItem } from './media';
import { CONTAINER_MIME, HEVC_MIME, parseLabMedia } from './media';
import type { LabPlayer, LabTrack, OpenOptions, PlayerError, TrackService } from './player';
import type { Check, CheckResult, LabContext } from './types';

export interface BatteryClock {
  /** A monotonic clock in ms. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface BatteryDeps {
  createPlayer(): LabPlayer;
  /** GET and parse JSON (rejects on a network error or a non-200). */
  getJson(url: string): Promise<unknown>;
  readonly clock: BatteryClock;
  /**
   * The redirect probe (`http.ts`), for an engine that may freeze on a 302 (AVPlay, S4): with
   * it the battery adds `redirect-probe`, the redirect row again with the probe's URL.
   */
  probeRedirect?(url: string): Promise<RedirectProbe>;
}

/** The criteria (architecture.md §5) and the battery's own waits. */
export const BATTERY = {
  tsFirstFrameMs: 2500,
  tsFirstFrameLowMs: 4000,
  hlsFirstFrameMs: 4000,
  switchMs: 2000,
  resumeMs: 5000,
  recoverMs: 10_000,
  /** How long a row waits for a first frame before it calls the stream unplayable. */
  frameWaitMs: 10_000,
  /** The watchdog's stall: no progress for this long (architecture.md §2, live). */
  stallMs: 6000,
  /** How long an AC3 track must play on its own to count. */
  trackPlayMs: 2000,
  /**
   * How long the file plays before an audio switch, so that a switch that starts it over shows
   * as the clock going back (AVPlay sends no event for that).
   */
  settleMs: 2000,
  /** Subtitle cues come every 5 s in the generated files. */
  cueWaitMs: 12_000,
  /** The person's Home trip: to leave, then to come back. */
  leaveWaitMs: 5 * 60_000,
  backWaitMs: 30 * 60_000,
  pollMs: 50,
  soakPollMs: 500,
} as const;

export const SOAK_MAX_MINUTES = 180;
export const SOAK_DEFAULT_MINUTES = 60;

export const PLACEHOLDER_NOTE = 'the lab server sends placeholder bytes: pnpm mock:media, then restart pnpm mock';

/** How a row's stream started. */
export interface FrameResult {
  readonly played: boolean;
  /** From the open to the first frame, or to giving up. */
  readonly ms: number;
  readonly width: number;
  readonly height: number;
  /** Media time at the end: a clock that moved without a picture is sound alone. */
  readonly positionMs: number;
  readonly error: PlayerError | null;
  readonly muted: boolean;
}

/** Opens `url` and waits for its first frame, an error, or `timeoutMs`. */
export async function openAndWait(player: LabPlayer, url: string, options: OpenOptions, timeoutMs: number, clock: BatteryClock): Promise<FrameResult> {
  const seen: { frameAt: number | null; error: PlayerError | null } = { frameAt: null, error: null };
  const off = player.on((event) => {
    if (event.type === 'frame' && seen.frameAt === null) seen.frameAt = clock.now();
    else if (event.type === 'error' && seen.error === null) seen.error = event.error;
  });
  const started = clock.now();
  try {
    player.open(url, options);
    while (seen.frameAt === null && seen.error === null && clock.now() - started < timeoutMs) await clock.sleep(BATTERY.pollMs);
  } finally {
    off();
  }
  const s = player.snapshot();
  const played = seen.frameAt !== null;
  return {
    played,
    ms: Math.round((seen.frameAt ?? clock.now()) - started),
    width: s.width,
    height: s.height,
    positionMs: s.positionMs,
    error: seen.error,
    muted: s.muted,
  };
}

/** Why a stream showed no picture, in a few words; `unsupported` when the engine said it can't. */
export function noPicture(r: FrameResult, canPlay: string | null, mime: string): { readonly reason: string; readonly unsupported: boolean } {
  if (r.error !== null) return { reason: r.error.message, unsupported: r.error.unsupported || canPlay === '' };
  if (r.positionMs > 0 && r.width === 0) return { reason: `sound without a picture (the clock reached ${(r.positionMs / 1000).toFixed(1)} s)`, unsupported: true };
  if (canPlay === '') return { reason: `no answer, and the engine says it can't play ${mime} (canPlayType '')`, unsupported: true };
  return { reason: 'no answer', unsupported: false };
}

/** A first-frame row: within `limitMs`, or why not. */
export function frameVerdict(r: FrameResult, limitMs: number, canPlay: string | null, mime: string): CheckResult {
  const value = { played: r.played, ms: r.ms, limitMs, width: r.width, height: r.height, canPlay, muted: r.muted };
  if (r.played) {
    const size = `${r.width}×${r.height}`;
    if (r.ms <= limitMs) return { status: 'pass', value, note: `first frame in ${r.ms} ms (${size})` };
    return { status: 'fail', value, note: `first frame in ${r.ms} ms, over the ${limitMs} ms limit (${size})` };
  }
  const why = noPicture(r, canPlay, mime);
  return { status: 'fail', value: { ...value, positionMs: r.positionMs, error: r.error, unsupported: why.unsupported }, note: `no picture within ${r.ms} ms: ${why.reason}` };
}

/** How an audio switch went. */
export interface SwitchResult {
  readonly accepted: boolean;
  /** Until the track showed as the only one enabled and playback moved on; null: never. */
  readonly ms: number | null;
  /** The stream started over: the clock went back, or the engine reloaded it. */
  readonly restarted: boolean;
  readonly beforeMs: number;
  readonly afterMs: number;
  /** A service's answer, or why it refused (`switchByService`). */
  readonly detail?: string;
}

/** How far playback must move on after a switch. */
const MOVED_ON_MS = 200;

export async function switchAudio(player: LabPlayer, index: number, clock: BatteryClock, timeoutMs = 5000): Promise<SwitchResult> {
  const seen = { restart: false };
  const off = player.on((event) => {
    if (event.type === 'restart') seen.restart = true;
  });
  const beforeMs = player.snapshot().positionMs;
  const started = clock.now();
  let ms: number | null = null;
  let wentBack = false;
  let afterMs = beforeMs;
  try {
    if (!player.selectAudio(index)) return { accepted: false, ms: null, restarted: false, beforeMs, afterMs: beforeMs };
    while (clock.now() - started < timeoutMs) {
      await clock.sleep(BATTERY.pollMs);
      afterMs = player.snapshot().positionMs;
      if (afterMs < beforeMs - 1000) wentBack = true;
      const on = (player.audioTracks() ?? []).filter((t) => t.selected).map((t) => t.index);
      if (on.length === 1 && on[0] === index && afterMs >= beforeMs + MOVED_ON_MS) {
        ms = Math.round(clock.now() - started);
        break;
      }
    }
  } finally {
    off();
  }
  return { accepted: true, ms, restarted: wentBack || seen.restart, beforeMs, afterMs };
}

/**
 * The same switch through the platform's service (webOS luna `selectTrack`): it took over once
 * the service accepted and playback moved on. Which track sounds is for the ear: the service
 * gives no list to read back.
 */
export async function switchByService(player: LabPlayer, service: TrackService, index: number, clock: BatteryClock, timeoutMs = 5000): Promise<SwitchResult> {
  const seen: { restart: boolean; answer: string | null; refusal: string | null } = { restart: false, answer: null, refusal: null };
  const off = player.on((event) => {
    if (event.type === 'restart') seen.restart = true;
  });
  const beforeMs = player.snapshot().positionMs;
  const started = clock.now();
  let ms: number | null = null;
  let wentBack = false;
  let afterMs = beforeMs;
  try {
    service.selectAudio(index).then(
      (answer) => (seen.answer = answer),
      (error: unknown) => (seen.refusal = error instanceof Error ? error.message : String(error)),
    );
    while (seen.refusal === null && clock.now() - started < timeoutMs) {
      await clock.sleep(BATTERY.pollMs);
      afterMs = player.snapshot().positionMs;
      if (afterMs < beforeMs - 1000) wentBack = true;
      if (seen.answer !== null && afterMs >= beforeMs + MOVED_ON_MS) {
        ms = Math.round(clock.now() - started);
        break;
      }
    }
  } finally {
    off();
  }
  const detail = seen.refusal ?? seen.answer ?? 'no answer';
  return { accepted: seen.refusal === null && seen.answer !== null, ms, restarted: wentBack || seen.restart, beforeMs, afterMs, detail };
}

/** A switch in a few words; `ok` when the track took over without a restart (then it is judged by its time). */
export function switchOutcome(s: SwitchResult, to: string): { readonly ok: boolean; readonly text: string } {
  if (!s.accepted) return { ok: false, text: `the switch was refused${s.detail === undefined ? '' : ` (${s.detail})`}` };
  if (s.ms === null) return { ok: false, text: 'the second track never took over' };
  if (s.restarted) return { ok: false, text: `the switch took ${s.ms} ms and the stream started over` };
  return { ok: true, text: `switched to ${to} in ${s.ms} ms` };
}

/** One stall of the soak: when it began (ms into the soak), how long it took back to a picture. */
export interface StallRecord {
  readonly atMs: number;
  /** null: still stalled when the soak ended. */
  readonly recoveredMs: number | null;
  readonly reopens: number;
}

export interface SoakResult {
  readonly first: FrameResult;
  readonly durationMs: number;
  readonly stalls: readonly StallRecord[];
  readonly reopens: number;
  /** A VOD file played to its end and started again. */
  readonly laps: number;
}

/**
 * Plays `url` for `durationMs` with the watchdog: no progress for `stallMs` reopens it (live at
 * the live edge, VOD where it stopped), again every `stallMs` until a frame comes.
 */
export async function soak(player: LabPlayer, url: string, options: OpenOptions, durationMs: number, clock: BatteryClock): Promise<SoakResult> {
  const first = await openAndWait(player, url, options, BATTERY.frameWaitMs, clock);
  if (!first.played) return { first, durationMs: 0, stalls: [], reopens: 0, laps: 0 };
  const seen: { frameAt: number | null; ended: boolean } = { frameAt: null, ended: false };
  const off = player.on((event) => {
    if (event.type === 'frame') seen.frameAt = clock.now();
    else if (event.type === 'ended') seen.ended = true;
  });
  const stalls: StallRecord[] = [];
  const start = clock.now();
  let lastPos = player.snapshot().positionMs;
  let lastMove = start;
  let reopens = 0;
  let laps = 0;
  let stall: { startedAt: number; reopenedAt: number; reopens: number } | null = null;
  const reopen = (): void => {
    reopens += 1;
    seen.frameAt = null;
    player.open(url, options.live ? { live: true } : { live: false, startMs: lastPos });
  };
  try {
    while (clock.now() - start < durationMs) {
      await clock.sleep(BATTERY.soakPollMs);
      const now = clock.now();
      if (stall !== null) {
        if (seen.frameAt !== null) {
          stalls.push({ atMs: Math.round(stall.startedAt - start), recoveredMs: Math.round(seen.frameAt - stall.startedAt), reopens: stall.reopens });
          lastPos = player.snapshot().positionMs;
          lastMove = seen.frameAt;
          stall = null;
        } else if (now - stall.reopenedAt >= BATTERY.stallMs) {
          stall.reopens += 1;
          stall.reopenedAt = now;
          reopen();
        }
        continue;
      }
      if (seen.ended && !options.live) {
        // The VOD stand-in reached its end: round again from the start, not a stall.
        seen.ended = false;
        laps += 1;
        lastPos = -1;
        lastMove = now;
        player.open(url, { live: false });
        continue;
      }
      const pos = player.snapshot().positionMs;
      if (pos !== lastPos) {
        lastPos = pos;
        lastMove = now;
      } else if (now - lastMove >= BATTERY.stallMs) {
        stall = { startedAt: lastMove, reopenedAt: now, reopens: 1 };
        reopen();
      }
    }
    if (stall !== null) stalls.push({ atMs: Math.round(stall.startedAt - start), recoveredMs: null, reopens: stall.reopens });
  } finally {
    off();
  }
  return { first, durationMs: Math.round(clock.now() - start), stalls, reopens, laps };
}

const median = (values: readonly number[]): number => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
};

/** At most this many stalls go into the record (an hour has about 200). */
export const STALLS_RECORDED = 100;

export function soakVerdict(r: SoakResult, source: string, limitMs: number = BATTERY.recoverMs): CheckResult {
  const minutes = Math.round(r.durationMs / 6000) / 10;
  if (!r.first.played) return { status: 'fail', value: { source, first: r.first }, note: `${source} never played: ${noPicture(r.first, null, source).reason}` };
  const times = r.stalls.map((s) => s.recoveredMs).filter((ms): ms is number => ms !== null);
  const slow = r.stalls.filter((s) => s.recoveredMs === null || s.recoveredMs >= limitMs);
  const worst = times.length === 0 ? null : Math.max(...times);
  const value = {
    source,
    minutes,
    stalls: r.stalls.length,
    recovered: times.length,
    slow: slow.length,
    worstMs: worst,
    medianMs: times.length === 0 ? null : median(times),
    reopens: r.reopens,
    laps: r.laps,
    list: r.stalls.slice(0, STALLS_RECORDED).map((s) => [Math.round(s.atMs / 1000), s.recoveredMs, s.reopens]),
  };
  if (r.stalls.length === 0) return { status: 'fail', value, note: `${source}: no stall in ${minutes} min: the stall URL should stall about every 20 s` };
  if (slow.length > 0) {
    const never = slow.filter((s) => s.recoveredMs === null).length;
    return { status: 'fail', value, note: `${source}: ${slow.length} of ${r.stalls.length} stalls took ${limitMs / 1000} s or more${never > 0 ? ` (${never} never recovered)` : ''}; worst ${worst ?? '—'} ms` };
  }
  return { status: 'pass', value, note: `${source}: ${r.stalls.length} stalls in ${minutes} min, each recovered in under ${limitMs / 1000} s (worst ${worst} ms, median ${value.medianMs} ms)` };
}

/** Waits for the platform's lifecycle to report one of `wanted`; false after `timeoutMs`. */
export async function lifecycleEvent(platform: Pick<Platform, 'onLifecycle'>, wanted: readonly LifecycleEvent[], timeoutMs: number, clock: BatteryClock): Promise<boolean> {
  const seen = { hit: false };
  const off = platform.onLifecycle((event) => {
    if (wanted.indexOf(event) !== -1) seen.hit = true;
  });
  const started = clock.now();
  try {
    while (!seen.hit && clock.now() - started < timeoutMs) await clock.sleep(BATTERY.pollMs);
  } finally {
    off();
  }
  return seen.hit;
}

const trackText = (t: LabTrack): string => `${t.lang === '' ? '?' : t.lang}${t.label === '' ? '' : ` "${t.label}"`}`;
const tracksValue = (tracks: readonly LabTrack[]): Array<{ lang: string; label: string; kind: string; selected: boolean }> => tracks.map((t) => ({ lang: t.lang, label: t.label, kind: t.kind, selected: t.selected }));

/** What a run of the battery found so far; `formats` starts a new one. */
interface BatteryRun {
  media: LabMedia | null;
  /** The live containers that showed a picture (`redirect`, `suspend` and `soak` use the first). */
  played: { ts: boolean; hls: boolean };
  /** How `redirect` went without the probe, for `redirect-probe`'s note: null before it ran. */
  redirect: 'played' | 'froze' | 'error' | null;
}

export function batteryChecks(spike: string, deps: BatteryDeps): Check[] {
  const { clock } = deps;
  let run: BatteryRun = { media: null, played: { ts: false, hls: false }, redirect: null };

  /** The row's media item, or why the row skips. */
  const itemFor = (id: LabMediaId): LabMediaItem | CheckResult => {
    if (run.media === null) return { status: 'skip', note: "needs the lab server's media list (the first check)" };
    if (run.media.media !== 'files') return { status: 'skip', note: PLACEHOLDER_NOTE };
    return run.media.items[id] ?? { status: 'skip', note: `the lab server's catalog has no ${id} item` };
  };
  const isItem = (x: LabMediaItem | CheckResult): x is LabMediaItem => typeof (x as LabMediaItem).url === 'string';
  /** The live container a later row uses: TS when it played, else HLS. */
  const liveContainer = (): 'ts' | 'hls' => (run.played.ts || !run.played.hls ? 'ts' : 'hls');

  /** Runs `body` with a fresh player, always disposed. */
  const withPlayer = async (body: (player: LabPlayer) => Promise<CheckResult>): Promise<CheckResult> => {
    const player = deps.createPlayer();
    try {
      return await body(player);
    } finally {
      player.dispose();
    }
  };

  const firstFrameRow = (id: 'ts' | 'hls', title: string): Check => ({
    id,
    title,
    run: async (context) => {
      const item = itemFor(id === 'ts' ? 'live-ts' : 'live-hls');
      if (!isItem(item)) return item;
      const limit = id === 'hls' ? BATTERY.hlsFirstFrameMs : context.info.tier === 'low' ? BATTERY.tsFirstFrameLowMs : BATTERY.tsFirstFrameMs;
      return withPlayer(async (player) => {
        player.caption(`${spike}: live ${id.toUpperCase()}`);
        const r = await openAndWait(player, item.url, { live: true }, BATTERY.frameWaitMs, clock);
        run.played[id] = r.played;
        const mime = CONTAINER_MIME[item.container];
        return frameVerdict(r, limit, player.canPlay(mime), mime);
      });
    },
  });

  const formats: Check = {
    id: 'formats',
    title: "The lab server's media and the formats the engine plays",
    run: async (context) => {
      run = { media: null, played: { ts: false, hls: false }, redirect: null };
      const media = parseLabMedia(await deps.getJson(`${context.server}/__lab/media`));
      if (media === null) return { status: 'fail', note: 'the lab server answered something else than a media list' };
      run.media = media;
      const engine = await withPlayer((player) => Promise.resolve({ status: 'info', value: player.describe() }));
      const items = Object.keys(media.items);
      const value = { media: media.media, items, engine: engine.value };
      const note = media.media === 'files' ? `${items.length} media items on the lab server` : PLACEHOLDER_NOTE;
      return { status: 'info', value, note };
    },
  };

  const redirect: Check = {
    id: 'redirect',
    title: 'A live stream through 3 × 302 plays (redirects followed)',
    run: async () => {
      const container = liveContainer();
      const item = itemFor(container === 'ts' ? 'redirect-ts' : 'redirect-hls');
      if (!isItem(item)) return item;
      return withPlayer(async (player) => {
        player.caption(`${spike}: live ${container.toUpperCase()} through redirects`);
        const r = await openAndWait(player, item.url, { live: true }, BATTERY.frameWaitMs, clock);
        run.redirect = r.played ? 'played' : r.error === null ? 'froze' : 'error';
        const value = { container, fault: item.fault, played: r.played, ms: r.ms };
        if (r.played) return { status: 'pass', value, note: `${container.toUpperCase()} through ${item.fault ?? 'redirects'}: first frame in ${r.ms} ms` };
        const why = noPicture(r, player.canPlay(CONTAINER_MIME[item.container]), CONTAINER_MIME[item.container]);
        return { status: 'fail', value: { ...value, error: r.error, unsupported: why.unsupported }, note: `${container.toUpperCase()} through redirects: no picture within ${r.ms} ms: ${why.reason}` };
      });
    },
  };

  const probeRow = (probe: (url: string) => Promise<RedirectProbe>): Check => ({
    id: 'redirect-probe',
    title: 'The same with the redirect probe first (responseURL at readyState 2)',
    run: async () => {
      const container = liveContainer();
      const item = itemFor(container === 'ts' ? 'redirect-ts' : 'redirect-hls');
      if (!isItem(item)) return item;
      let found: RedirectProbe;
      try {
        found = await probe(item.url);
      } catch (error) {
        return { status: 'fail', value: { container }, note: `the probe failed: ${error instanceof Error ? error.message : String(error)}` };
      }
      // No URL in the record: the final one carries the account too.
      const value = { container, probeMs: found.ms, status: found.status, redirected: found.redirected, withoutProbe: run.redirect };
      if (!found.redirected) return { status: 'fail', value, note: `the probe saw no redirect (HTTP ${found.status}, responseURL unchanged)` };
      const without = run.redirect === 'froze' ? '; without the probe it froze' : run.redirect === 'played' ? '; it played without the probe too' : run.redirect === 'error' ? '; without the probe it failed' : '';
      return withPlayer(async (player) => {
        player.caption(`${spike}: live ${container.toUpperCase()} at the URL the probe found`);
        const r = await openAndWait(player, found.finalUrl, { live: true }, BATTERY.frameWaitMs, clock);
        if (r.played) return { status: 'pass', value: { ...value, played: true, ms: r.ms }, note: `probe ${found.ms} ms (HTTP ${found.status}), then the first frame in ${r.ms} ms${without}` };
        const mime = CONTAINER_MIME[item.container];
        const why = noPicture(r, player.canPlay(mime), mime);
        return { status: 'fail', value: { ...value, played: false, ms: r.ms, error: r.error, unsupported: why.unsupported }, note: `probe ${found.ms} ms, then no picture within ${r.ms} ms: ${why.reason}` };
      });
    },
  });

  const hevc: Check = {
    id: 'hevc-4k',
    title: '4K HEVC VOD plays (2020+ TVs)',
    run: async () => {
      const item = itemFor('hevc-4k');
      if (!isItem(item)) return item;
      return withPlayer(async (player) => {
        player.caption(`${spike}: 4K HEVC`);
        const r = await openAndWait(player, item.url, { live: false }, BATTERY.frameWaitMs, clock);
        const canPlay = player.canPlay(HEVC_MIME);
        const value = { played: r.played, ms: r.ms, width: r.width, height: r.height, canPlay, expected: item.video };
        if (!r.played) {
          const why = noPicture(r, canPlay, HEVC_MIME);
          return { status: 'fail', value: { ...value, positionMs: r.positionMs, error: r.error, unsupported: why.unsupported }, note: `no picture: ${why.reason} (only 2020+ TVs need it)` };
        }
        if (r.width < 3840 || r.height < 2160) return { status: 'fail', value, note: `plays at ${r.width}×${r.height}, not 3840×2160` };
        return { status: 'pass', value, note: `3840×2160, first frame in ${r.ms} ms` };
      });
    },
  };

  /** Opens the multi-audio file; the player and its tracks, or why the row ends there. */
  const openMultiAudio = async (player: LabPlayer, item: LabMediaItem, what: string): Promise<CheckResult | readonly LabTrack[] | null> => {
    player.caption(`${spike}: ${what}`);
    const r = await openAndWait(player, item.url, { live: false }, BATTERY.frameWaitMs, clock);
    if (!r.played) {
      const mime = CONTAINER_MIME[item.container];
      const why = noPicture(r, player.canPlay(mime), mime);
      return { status: 'fail', value: { played: false, error: r.error, unsupported: why.unsupported }, note: `the MKV never played: ${why.reason}` };
    }
    return player.audioTracks();
  };
  const isResult = (x: CheckResult | readonly LabTrack[] | null): x is CheckResult => x !== null && !Array.isArray(x);

  /** The engine's own track route, for the record: AVPlay's `setSelectTrack`, or the element's `audioTracks`. */
  const listRoute = (player: LabPlayer): string => (player.kind === 'avplay' ? 'setSelectTrack' : 'audioTracks');

  const audioTracks: Check = {
    id: 'audio-tracks',
    title: 'Audio track switch < 2 s, no restart (MKV multi-audio)',
    timeoutMs: 60_000,
    run: async () => {
      const item = itemFor('multi-audio');
      if (!isItem(item)) return item;
      const expected = (item.audio ?? []).map((a) => `${a.lang}:${a.codec}`);
      return withPlayer(async (player) => {
        const tracks = await openMultiAudio(player, item, 'audio tracks');
        if (isResult(tracks)) return tracks;
        const base = tracks === null ? { api: false, expected } : { api: true, listed: tracksValue(tracks), expected };
        // The engine's own list first (audioTracks; AVPlay's track info and setSelectTrack)…
        let first: string;
        let viaList: SwitchResult | null = null;
        if (tracks === null) first = 'this engine has no audioTracks API';
        else if (tracks.length < 2) first = `the engine lists ${tracks.length} of the file's ${expected.length} audio tracks: nothing to switch to`;
        else {
          await clock.sleep(BATTERY.settleMs);
          viaList = await switchAudio(player, 1, clock);
          const listed = `${tracks.length} of ${expected.length} tracks listed (${tracks.map(trackText).join(', ')})`;
          const outcome = switchOutcome(viaList, trackText(tracks[1] as LabTrack));
          if (outcome.ok && viaList.ms !== null) {
            const route = listRoute(player);
            return { status: viaList.ms < BATTERY.switchMs ? 'pass' : 'fail', value: { ...base, switch: viaList, route }, note: `${listed}; ${outcome.text}` };
          }
          first = `${listed}; ${outcome.text}`;
        }
        const listed = viaList === null ? base : { ...base, switch: viaList };
        // …then the platform's own service (webOS: luna selectTrack with the element's mediaId),
        // on the file opened again, so the first try's track can't pass for the service's.
        const service = player.audioService();
        if (service === null) return { status: 'fail', value: { ...listed, route: null }, note: first };
        if (viaList !== null) {
          const again = await openMultiAudio(player, item, `audio tracks (${service.name})`);
          if (isResult(again)) return { ...again, note: `${first}; ${again.note ?? ''}` };
        }
        await clock.sleep(BATTERY.settleMs);
        const viaService = await switchByService(player, service, 1, clock);
        const outcome = switchOutcome(viaService, 'the second track');
        const value = { ...listed, service: viaService, route: outcome.ok ? service.name : null };
        if (!outcome.ok || viaService.ms === null) return { status: 'fail', value, note: `${first}; ${service.name}: ${outcome.text}` };
        return { status: viaService.ms < BATTERY.switchMs ? 'pass' : 'fail', value, note: `${first}; ${service.name}: ${outcome.text} (by ear: the second language?)` };
      });
    },
  };

  const ac3: Check = {
    id: 'ac3',
    title: 'AC3 and E-AC3 5.1 play',
    timeoutMs: 60_000,
    run: async () => {
      const item = itemFor('multi-audio');
      if (!isItem(item)) return item;
      const expected = item.audio ?? [];
      const wanted = ['ac3', 'eac3'].map((codec) => ({ codec, index: expected.map((a) => a.codec).indexOf(codec) })).filter((w) => w.index !== -1);
      if (wanted.length === 0) return { status: 'skip', note: 'the lab media lists no AC3 or E-AC3 track' };
      return withPlayer(async (player) => {
        const tracks = await openMultiAudio(player, item, 'AC3 and E-AC3');
        if (isResult(tracks)) return tracks;
        // Without a track list, the platform's service chooses by the file's order (webOS luna).
        const service = tracks === null ? player.audioService() : null;
        if (tracks === null && service === null) return { status: 'skip', note: 'this engine has no audioTracks API, so the 5.1 tracks cannot be chosen' };
        if (tracks !== null && tracks.length !== expected.length) {
          return {
            status: 'fail',
            value: { listed: tracksValue(tracks), expected: expected.map((a) => `${a.lang}:${a.codec}`), unsupported: true },
            note: `the engine lists ${tracks.length} of the file's ${expected.length} audio tracks: it drops the ones it can't decode (AC3, E-AC3)`,
          };
        }
        const route = service === null ? listRoute(player) : service.name;
        const results: Array<{ codec: string; switchMs: number | null; played: boolean; error: PlayerError | null }> = [];
        for (const w of wanted) {
          const switched = service === null ? await switchAudio(player, w.index, clock) : await switchByService(player, service, w.index, clock);
          const from = player.snapshot().positionMs;
          await clock.sleep(BATTERY.trackPlayMs);
          const after = player.snapshot();
          results.push({ codec: w.codec, switchMs: switched.ms, played: switched.ms !== null && after.error === null && after.positionMs >= from + BATTERY.trackPlayMs / 2, error: after.error });
        }
        const failed = results.filter((r) => !r.played).map((r) => r.codec);
        const value = { listed: tracks === null ? null : tracksValue(tracks), route, results };
        if (failed.length > 0) return { status: 'fail', value, note: `${failed.join(' and ')} did not play (${route})` };
        return { status: 'pass', value, note: `${results.map((r) => `${r.codec} in ${r.switchMs} ms`).join(', ')} (${route}); both played on (whether they sound right is for the ear)` };
      });
    },
  };

  const subtitles: Check = {
    id: 'subtitles',
    title: 'In-band subtitles: SRT in MKV, mov_text in MP4',
    timeoutMs: 90_000,
    run: async () => {
      const rows: Array<{ id: LabMediaId; item: LabMediaItem }> = [];
      for (const id of ['subs-mkv', 'subs-mp4'] as const) {
        const item = itemFor(id);
        if (!isItem(item)) return item;
        rows.push({ id, item });
      }
      const found: Array<{ file: string; played: boolean; tracks: ReturnType<typeof tracksValue> | null; cue: string | null; cueMs: number | null }> = [];
      for (const { id, item } of rows) {
        found.push(
          await withPlayer(async (player) => {
            player.caption(`${spike}: subtitles (${item.container.toUpperCase()})`);
            const r = await openAndWait(player, item.url, { live: false }, BATTERY.frameWaitMs, clock);
            const tracks = player.textTracks();
            const base = { file: id, played: r.played, tracks: tracks === null ? null : tracksValue(tracks), cue: null, cueMs: null };
            if (!r.played || tracks === null || tracks.length === 0) return { status: 'info', value: base };
            const seen: { cue: string | null; at: number | null } = { cue: null, at: null };
            const off = player.on((event) => {
              if (event.type === 'cue' && seen.cue === null) {
                seen.cue = event.text;
                seen.at = clock.now();
              }
            });
            const started = clock.now();
            try {
              player.showText(0);
              while (seen.cue === null && clock.now() - started < BATTERY.cueWaitMs) await clock.sleep(BATTERY.pollMs);
            } finally {
              off();
            }
            return { status: 'info', value: { ...base, cue: seen.cue, cueMs: seen.at === null ? null : Math.round(seen.at - started) } };
          }).then((result) => result.value as (typeof found)[number]),
        );
      }
      const summary = found.map((f) => `${f.file}: ${!f.played ? 'never played' : f.tracks === null ? 'no text track API' : f.tracks.length === 0 ? 'no text track' : f.cue === null ? `${f.tracks.length} tracks, no cue` : `${f.tracks.length} tracks, a cue in ${f.cueMs} ms`}`);
      const ok = found.every((f) => f.cue !== null);
      return { status: ok ? 'pass' : 'fail', value: { files: found }, note: summary.join('; ') };
    },
  };

  const ALONE = `run ${spike} alone (OK on its row)`;

  const suspend: Check = {
    id: 'suspend',
    title: 'Home and back: playing again < 5 s',
    timeoutMs: BATTERY.leaveWaitMs + BATTERY.backWaitMs + 60_000,
    run: async (context: LabContext) => {
      if (!context.interactive) return { status: 'skip', note: `${ALONE} and press Home while it plays` };
      const container = liveContainer();
      const item = itemFor(container === 'ts' ? 'live-ts' : 'live-hls');
      if (!isItem(item)) return item;
      return withPlayer(async (player) => {
        player.caption(`${spike}: press Home, wait a few seconds, then come back to the Lablo Lab`);
        const first = await openAndWait(player, item.url, { live: true }, BATTERY.frameWaitMs, clock);
        if (!first.played) return { status: 'fail', value: { container, first }, note: `the live ${container.toUpperCase()} never played` };
        if (!(await lifecycleEvent(context.platform, ['hidden'], BATTERY.leaveWaitMs, clock))) return { status: 'skip', note: 'nobody pressed Home within 5 min' };
        const hiddenAt = clock.now();
        player.suspend();
        if (!(await lifecycleEvent(context.platform, ['visible', 'relaunch'], BATTERY.backWaitMs, clock))) return { status: 'fail', note: 'the lab never came back within 30 min' };
        const awayMs = Math.round(clock.now() - hiddenAt);
        const seen: { frameAt: number | null; error: PlayerError | null } = { frameAt: null, error: null };
        const off = player.on((event) => {
          if (event.type === 'frame' && seen.frameAt === null) seen.frameAt = clock.now();
          else if (event.type === 'error' && seen.error === null) seen.error = event.error;
        });
        const started = clock.now();
        try {
          player.resume();
          while (seen.frameAt === null && seen.error === null && clock.now() - started < BATTERY.frameWaitMs) await clock.sleep(BATTERY.pollMs);
        } finally {
          off();
        }
        const ms = seen.frameAt === null ? null : Math.round(seen.frameAt - started);
        const value = { container, awayMs, resumeMs: ms, error: seen.error };
        if (seen.error !== null) return { status: 'fail', value, note: `coming back failed: ${seen.error.message}` };
        if (ms === null) return { status: 'fail', value, note: `no picture within ${BATTERY.frameWaitMs} ms of coming back` };
        return { status: ms < BATTERY.resumeMs ? 'pass' : 'fail', value, note: `back after ${(awayMs / 1000).toFixed(1)} s away: playing again in ${ms} ms` };
      });
    },
  };

  const soakCheck: Check = {
    id: 'soak',
    title: 'Endless live TS with stalls: each recovered < 10 s',
    timeoutMs: (SOAK_MAX_MINUTES + 5) * 60_000,
    run: async (context) => {
      if (!context.interactive) return { status: 'skip', note: `${ALONE}: ${context.soakMinutes} min of live TS with stalls` };
      // An engine without TS (a desktop browser) soaks on a VOD file with the same stalls.
      const id: LabMediaId = run.played.ts ? 'stall-ts' : 'stall-vod';
      const item = itemFor(id);
      if (!isItem(item)) return item;
      return withPlayer(async (player) => {
        player.caption(`${spike}: ${context.soakMinutes} min with a stall every ~20 s; each must recover in under 10 s`);
        const r = await soak(player, item.url, { live: item.kind === 'live' }, context.soakMinutes * 60_000, clock);
        return soakVerdict(r, id);
      });
    },
  };

  const probe = deps.probeRedirect;
  return [
    formats,
    firstFrameRow('ts', 'Live TS first frame < 2.5 s (< 4 s on the low tier)'),
    firstFrameRow('hls', 'Live HLS first frame < 4 s'),
    redirect,
    ...(probe === undefined ? [] : [probeRow((url) => probe(url))]),
    hevc,
    audioTracks,
    ac3,
    subtitles,
    suspend,
    soakCheck,
  ];
}
