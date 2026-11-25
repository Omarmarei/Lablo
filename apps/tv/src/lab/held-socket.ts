/**
 * S4's `held-socket` row (RELAY step 49, the lab half of step 39s7): which of AVPlay's signals see
 * a held socket. On the Samsung TV (docs/spikes/results.md, "From the Samsung TV (2026-11-25)") a
 * provider that stopped sending and held the connection froze the picture while `getState()`
 * stayed `PLAYING` and `getCurrentTime()` ran on at wall-clock speed, so neither AVPlay nor the
 * app's watchdog reconnected. This row plays the mock's `outage-ts` (live TS that stops `after_ms`
 * into each response and holds every request for `outage_ms`), samples every candidate once a
 * second, and says which ones behave otherwise during the outage than before it, and whether they
 * are back to normal after it. Step 39s7 gives the watchdog the one that works.
 *
 * - **Polled:** whatever the player's `signals()` reads (AVPlay: `getState`, `getCurrentTime`,
 *   `CURRENT_BANDWIDTH`, `GET_LIVE_DURATION`, `IS_LIVE`, `AVAILABLE_BITRATE`,
 *   `getCurrentStreamInfo`), plus `lastPlaytime`, the last `oncurrentplaytime` value.
 * - **Counted:** each callback's calls between two samples (`WATCHED_CALLBACKS`).
 * - **The phases** (ms from the open, from the fault's numbers): `start` (to the first frame and
 *   the start's own settling); `before` (to the data stopping); `drain` (the picture plays on from
 *   AVPlay's buffer); `outage` (frozen for sure, to the outage's end); `reconnect` (AVPlay's new
 *   request and its buffering); `after` (to the row's end, before the next stop). A polled signal
 *   is judged on `before`, `outage` and `after`, a callback on `before`, `drain` + `outage` and
 *   `after`: a callback that fires once when the buffer runs dry counts, one that fires only once
 *   the provider closes the socket does not (a real held socket may never close).
 * - **A change** (`polledChange`, `callChange`): moving, then still, or still, then moving; a value
 *   never seen before while it was still (in `drain` too); a clock's rate or a level halved or
 *   doubled; a callback that starts or stops, or runs three times faster or slower. The raw samples
 *   go in the record, so step 39s7 can read them again.
 *
 * No URL reaches the record: the item's carries the mock's test account.
 */
import type { BatteryClock } from './battery';
import { BATTERY, PLACEHOLDER_NOTE, noPicture, openAndWait } from './battery';
import { CONTAINER_MIME, parseLabMedia } from './media';
import type { SignalPlayer } from './player';
import type { Check, CheckResult } from './types';

export const HELD = {
  sampleMs: 1000,
  /** After the first frame: the start's own buffering settles. */
  settleMs: 2000,
  /** After the data stops, AVPlay plays on from its buffer (the mock's 6 s burst ahead, and more). */
  bufferMs: 10_000,
  /** After the outage: AVPlay's new request and its buffering. */
  reconnectMs: 10_000,
  /** How long the row watches after the outage. */
  afterMs: 25_000,
  /** Callback texts kept per sample (`onevent`, `onerror`, `onerrormsg`). */
  saidPerSample: 3,
} as const;

/** The callbacks the row counts, in the order the record lists them. */
export const WATCHED_CALLBACKS = ['onbufferingstart', 'onbufferingprogress', 'onbufferingcomplete', 'oncurrentplaytime', 'onevent', 'onerror', 'onerrormsg'] as const;
/** The callbacks whose text the record keeps. */
const SAID = ['onevent', 'onerror', 'onerrormsg'];

export const NO_OUTAGE_ITEM = "the lab server's catalog has no outage-ts item (a mock from before RELAY step 49?)";

/** What the item's fault says: the data stops `afterMs` into each response, then `outageMs` down. */
export interface OutageTiming {
  readonly afterMs: number;
  readonly outageMs: number;
}

/** `stall:after_ms=30000:outage_ms=30000` → its two numbers, or null without both. */
export function outageTiming(fault: string | null): OutageTiming | null {
  if (fault === null) return null;
  const after = /(?:^|:)after_ms=(\d+)/.exec(fault);
  const outage = /(?:^|:)outage_ms=(\d+)/.exec(fault);
  if (after === null || outage === null) return null;
  const timing = { afterMs: Number(after[1]), outageMs: Number(outage[1]) };
  return timing.afterMs > 0 && timing.outageMs > 0 ? timing : null;
}

export type HeldPhase = 'start' | 'before' | 'drain' | 'outage' | 'reconnect' | 'after';

/** Where each phase starts, in ms from the open; `endMs` ends the row. */
export interface HeldWindows {
  readonly beforeMs: number;
  readonly drainMs: number;
  readonly outageMs: number;
  readonly reconnectMs: number;
  readonly afterMs: number;
  readonly endMs: number;
}

/**
 * The phases for a first frame `frameMs` after the open. Each margin is at most a third of what it
 * cuts into, so a short outage (a test's) still has every phase.
 */
export function heldWindows(timing: OutageTiming, frameMs: number): HeldWindows {
  const stop = timing.afterMs;
  const back = stop + timing.outageMs;
  return {
    beforeMs: frameMs + Math.min(HELD.settleMs, stop / 3),
    drainMs: stop,
    outageMs: stop + Math.min(HELD.bufferMs, timing.outageMs / 3),
    reconnectMs: back,
    afterMs: back + Math.min(HELD.reconnectMs, timing.outageMs / 3),
    // Before the next stop: the new response plays `afterMs` again from AVPlay's reconnect.
    endMs: back + Math.min(HELD.afterMs, (stop * 4) / 5),
  };
}

export function phaseAt(t: number, w: HeldWindows): HeldPhase {
  if (t >= w.afterMs) return 'after';
  if (t >= w.reconnectMs) return 'reconnect';
  if (t >= w.outageMs) return 'outage';
  if (t >= w.drainMs) return 'drain';
  if (t >= w.beforeMs) return 'before';
  return 'start';
}

/** One reading of every signal. */
export interface HeldSample {
  /** ms from the open. */
  readonly t: number;
  readonly phase: HeldPhase;
  readonly polled: Readonly<Record<string, string>>;
  /** Each watched callback's calls since the previous sample. */
  readonly calls: Readonly<Record<string, number>>;
  /** What `onevent`, `onerror` and `onerrormsg` said since the previous sample. */
  readonly said: readonly string[];
}

/** A polled signal over one phase. */
export interface PolledStats {
  readonly n: number;
  /** Its first few distinct values, for the record. */
  readonly values: readonly string[];
  /** The share of steps (sample to sample) where it changed. */
  readonly moving: number;
  /** Numbers only: the median change per second, and the median value. */
  readonly rate: number | null;
  readonly level: number | null;
  /** Numbers only: it went up or stayed in at least 4 steps of 5 (a clock). */
  readonly rising: boolean;
}

/** A callback over one phase. */
export interface CallStats {
  readonly n: number;
  readonly calls: number;
  /** Calls per 10 samples (about 10 s). */
  readonly per10s: number;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function distinct(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (out.indexOf(v) === -1) out.push(v);
  return out;
}

export function polledStats(samples: readonly HeldSample[], name: string): PolledStats {
  const values = samples.map((s) => s.polled[name] ?? '');
  const steps = values.length - 1;
  let changed = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i] !== values[i - 1]) changed += 1;
  const numeric = values.length > 0 && values.every((v) => NUMBER.test(v));
  let rate: number | null = null;
  let level: number | null = null;
  let rising = false;
  if (numeric) {
    const nums = values.map(Number);
    level = median(nums);
    const rates: number[] = [];
    let up = 0;
    for (let i = 1; i < nums.length; i += 1) {
      const dt = (samples[i] as HeldSample).t - (samples[i - 1] as HeldSample).t;
      const dv = (nums[i] as number) - (nums[i - 1] as number);
      if (dv >= 0) up += 1;
      if (dt > 0) rates.push((dv * 1000) / dt);
    }
    rate = median(rates);
    rising = steps > 0 && up * 5 >= steps * 4;
  }
  return { n: values.length, values: distinct(values).slice(0, 4), moving: steps > 0 ? changed / steps : 0, rate, level, rising };
}

export function callStats(samples: readonly HeldSample[], name: string): CallStats {
  let calls = 0;
  for (const s of samples) calls += s.calls[name] ?? 0;
  return { n: samples.length, calls, per10s: samples.length === 0 ? 0 : (calls * 10) / samples.length };
}

const round = (x: number): number => Math.round(x * 10) / 10;
const shown = (v: string): string => (v.length > 24 ? `${v.slice(0, 24)}…` : v);

/**
 * How a polled signal changed from `a` to `b`, or null. `fresh` holds the values of the later
 * span to look for one never seen in `a` (the drain's too: a blip as the buffer runs dry).
 */
export function polledChange(a: PolledStats, b: PolledStats, seen: readonly string[], fresh: readonly string[]): string | null {
  if (a.n < 2 || b.n < 2) return null;
  if (a.moving >= 0.6 && b.moving <= 0.2) return 'moving, then still';
  if (a.moving <= 0.2 && b.moving >= 0.6) return 'still, then moving';
  if (a.moving <= 0.2) {
    for (const v of fresh) if (seen.indexOf(v) === -1) return `${shown(a.values[0] ?? '')} → ${shown(v)}`;
  }
  // A clock rises at a rate; anything else numeric is a level.
  const clock = a.rising && a.rate !== null && a.rate > 0;
  if (clock && a.rate !== null && b.rate !== null && (b.rate <= a.rate / 2 || b.rate >= a.rate * 2)) return `${round(a.rate)} → ${round(b.rate)} per s`;
  if (!clock && a.level !== null && b.level !== null && (a.level > 0 ? b.level <= a.level / 2 || b.level >= a.level * 2 : b.level > 0)) return `level ${round(a.level)} → ${round(b.level)}`;
  return null;
}

/** How a callback changed from `a` to `b`, or null. */
export function callChange(a: CallStats, b: CallStats): string | null {
  if (a.n < 2 || b.n < 2 || (a.calls === 0 && b.calls === 0)) return null;
  if (a.calls === 0) return `none, then ${round(b.per10s)} per 10 s`;
  if (b.calls === 0) return `${round(a.per10s)} per 10 s, then none`;
  if (b.per10s >= a.per10s * 3 || b.per10s <= a.per10s / 3) return `${round(a.per10s)} → ${round(b.per10s)} per 10 s`;
  return null;
}

export interface SignalReport {
  readonly kind: 'polled' | 'callback';
  readonly before: PolledStats | CallStats;
  readonly outage: PolledStats | CallStats;
  readonly after: PolledStats | CallStats;
  /** How it changed at the outage, or null. */
  readonly change: string | null;
  /** After the outage: like before again (true), still changed (false), or unknown (null: no change, or too few samples). */
  readonly back: boolean | null;
}

const inPhase = (samples: readonly HeldSample[], ...phases: HeldPhase[]): HeldSample[] => samples.filter((s) => phases.indexOf(s.phase) !== -1);

/** Every signal's report, polled first (in the player's order), then the callbacks. */
export function signalReports(samples: readonly HeldSample[]): Record<string, SignalReport> {
  const before = inPhase(samples, 'before');
  const outage = inPhase(samples, 'outage');
  const down = inPhase(samples, 'drain', 'outage');
  const after = inPhase(samples, 'after');
  const out: Record<string, SignalReport> = {};
  const first = samples[0];
  for (const name of first === undefined ? [] : Object.keys(first.polled)) {
    const values = (list: readonly HeldSample[]): string[] => list.map((s) => s.polled[name] ?? '');
    const b = polledStats(before, name);
    const o = polledStats(outage, name);
    const a = polledStats(after, name);
    const change = polledChange(b, o, values(before), values(down));
    const back = change === null || a.n < 2 ? null : polledChange(b, a, values(before), values(after)) === null;
    out[name] = { kind: 'polled', before: b, outage: o, after: a, change, back };
  }
  for (const name of WATCHED_CALLBACKS) {
    const b = callStats(before, name);
    const o = callStats(down, name);
    const a = callStats(after, name);
    const change = callChange(b, o);
    const back = change === null || a.n < 2 ? null : callChange(b, a) === null;
    out[name] = { kind: 'callback', before: b, outage: o, after: a, change, back };
  }
  return out;
}

/** Long values that repeat the previous sample's become `=` in the record. */
function sampleRows(samples: readonly HeldSample[], polled: readonly string[]): Array<Array<string | number>> {
  const previous: Record<string, string> = {};
  return samples.map((s) => {
    const row: Array<string | number> = [s.t, s.phase];
    for (const name of polled) {
      const v = s.polled[name] ?? '';
      row.push(v.length > 24 && previous[name] === v ? '=' : v);
      previous[name] = v;
    }
    for (const name of WATCHED_CALLBACKS) row.push(s.calls[name] ?? 0);
    row.push(s.said.join('; '));
    return row;
  });
}

/** The row's result from its samples: pass when at least one signal changed at the outage. */
export function heldVerdict(samples: readonly HeldSample[], windows: HeldWindows, frameMs: number, fault: string | null): CheckResult {
  const signals = signalReports(samples);
  const names = Object.keys(signals);
  const polled = names.filter((name) => signals[name]?.kind === 'polled');
  const count = (phase: HeldPhase): number => inPhase(samples, phase).length;
  const value = {
    fault,
    frameMs,
    windows,
    samplesPerPhase: { before: count('before'), drain: count('drain'), outage: count('outage'), after: count('after') },
    changed: names.filter((name) => signals[name]?.change !== null),
    signals,
    columns: ['t', 'phase', ...polled, ...WATCHED_CALLBACKS, 'said'],
    samples: sampleRows(samples, polled),
  };
  if (count('before') < 2 || count('outage') < 2) return { status: 'fail', value, note: `too few samples to compare: ${count('before')} before the outage, ${count('outage')} during it` };
  const unchanged = names.filter((name) => signals[name]?.change === null);
  if (value.changed.length === 0) return { status: 'fail', value, note: `no signal changed at the outage (did the mock log "outage … down"?); unchanged: ${unchanged.join(', ')}` };
  const changes = value.changed.map((name) => {
    const r = signals[name] as SignalReport;
    const after = r.back === null ? 'after: unknown' : r.back ? 'back after' : 'still changed after';
    return `${name} (${r.change ?? ''}; ${after})`;
  });
  return { status: 'pass', value, note: `changed at the outage: ${changes.join(', ')}; unchanged: ${unchanged.join(', ')}` };
}

export interface HeldSocketDeps {
  createPlayer(): SignalPlayer;
  /** GET and parse JSON (rejects on a network error or a non-200). */
  getJson(url: string): Promise<unknown>;
  readonly clock: BatteryClock;
}

const zeroCalls = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const name of WATCHED_CALLBACKS) out[name] = 0;
  return out;
};

/** Plays the outage item and samples it to the row's end. */
async function watch(spike: string, player: SignalPlayer, url: string, timing: OutageTiming, fault: string | null, clock: BatteryClock): Promise<CheckResult> {
  let calls = zeroCalls();
  let said: string[] = [];
  let lastPlaytime = 'none';
  const off = player.on((event) => {
    if (event.type !== 'signal') return;
    if (calls[event.name] !== undefined) calls[event.name] = (calls[event.name] as number) + 1;
    if (event.name === 'oncurrentplaytime') lastPlaytime = event.data;
    else if (SAID.indexOf(event.name) !== -1 && said.length < HELD.saidPerSample) said.push(`${event.name} ${event.data}`.trim());
  });
  try {
    player.caption(`${spike}: live TS; from ${timing.afterMs / 1000} s the provider holds the socket for ${timing.outageMs / 1000} s (the picture freezes, then comes back)`);
    const openedAt = clock.now();
    const first = await openAndWait(player, url, { live: true }, BATTERY.frameWaitMs, clock);
    if (!first.played) {
      const why = noPicture(first, player.canPlay(CONTAINER_MIME.ts), CONTAINER_MIME.ts);
      return { status: 'fail', value: { fault, played: false, error: first.error }, note: `the live TS never played: ${why.reason}` };
    }
    const windows = heldWindows(timing, first.ms);
    const samples: HeldSample[] = [];
    for (;;) {
      const t = Math.round(clock.now() - openedAt);
      if (t >= windows.endMs) break;
      const polled: Record<string, string> = {};
      const read = player.signals();
      for (const name of Object.keys(read)) polled[name] = read[name] as string;
      polled['lastPlaytime'] = lastPlaytime;
      samples.push({ t, phase: phaseAt(t, windows), polled, calls, said });
      calls = zeroCalls();
      said = [];
      await clock.sleep(HELD.sampleMs);
    }
    return heldVerdict(samples, windows, first.ms, fault);
  } finally {
    off();
  }
}

/** S4's row (AVPlay only: off Tizen the spike skips it with the rest). */
export function heldSocketRow(spike: string, deps: HeldSocketDeps): Check {
  return {
    id: 'held-socket',
    title: 'A held socket: which signals change at the outage',
    timeoutMs: 4 * 60_000,
    run: async (context) => {
      const media = parseLabMedia(await deps.getJson(`${context.server}/__lab/media`));
      if (media === null) return { status: 'fail', note: 'the lab server answered something else than a media list' };
      if (media.media !== 'files') return { status: 'skip', note: PLACEHOLDER_NOTE };
      const item = media.items['outage-ts'];
      if (item === undefined) return { status: 'skip', note: NO_OUTAGE_ITEM };
      const timing = outageTiming(item.fault);
      if (timing === null) return { status: 'fail', value: { fault: item.fault }, note: 'the outage-ts item carries no after_ms and outage_ms' };
      const player = deps.createPlayer();
      try {
        return await watch(spike, player, item.url, timing, item.fault, deps.clock);
      } finally {
        player.dispose();
      }
    },
  };
}
