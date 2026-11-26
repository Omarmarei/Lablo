/**
 * The soak monitor (RELAY step 39s6, from the Samsung session's soak-monitor.js and stalls.js).
 *
 * - **On the TV**, `SOAK_SAMPLER` only records: every 100 ms the player's state and position
 *   (AVPlay's on Tizen, the page's `<video>` elsewhere), AVPlay's inflow where it gives one (RELAY
 *   step 40g(e): `CURRENT_BANDWIDTH`, else an HLS live window's end, as the app's watchdog reads
 *   it since step 39s7), and the JS heap every 5 minutes, into a buffer capped at an hour of
 *   samples. `SOAK_DRAIN` hands the buffer over and empties it.
 * - **On the PC**, `StallDetector` finds the stalls in the drained samples, so the rule is tested
 *   here and a recorded soak can be read again (`pnpm tv soak report <file>`).
 */

export const SAMPLE_MS = 100;
/** An hour of samples: what the TV keeps while the PC can't drain (sdb dropped). */
export const SAMPLE_CAP = 36_000;
/** The heap every 3,000 samples: 5 minutes. */
export const HEAP_EVERY = 3000;

/** Installs (or restarts) the sampler in the page. ES5: it runs on the TV's engine. */
export const SOAK_SAMPLER = `(function () {
  var w = window;
  if (w.__labloSoak) clearInterval(w.__labloSoak.timer);
  var s = { started: Date.now(), buf: [], heap: [], dropped: 0, n: 0, timer: 0 };
  function prop(a, name) {
    var v = null;
    try { v = a.getStreamingProperty(name); } catch (e) { v = null; }
    return v === null || v === undefined || String(v) === '' ? null : String(v);
  }
  function flow(a) {
    if (!a.getStreamingProperty) return null;
    var b = prop(a, 'CURRENT_BANDWIDTH');
    if (b !== null) return 'b' + b;
    var e = prop(a, 'GET_LIVE_DURATION');
    return e === null ? null : 'w' + e;
  }
  function read() {
    var a = w.webapis && w.webapis.avplay;
    var st, pos, f;
    if (a) {
      try { st = a.getState(); } catch (e) { st = 'ERR'; }
      try { pos = a.getCurrentTime(); } catch (e) { pos = -1; }
      f = flow(a);
      return f === null ? [st, pos] : [st, pos, f];
    }
    var v = document.querySelector('video');
    if (!v) return ['NONE', -1];
    return [v.paused ? 'PAUSED' : v.readyState < 3 ? 'BUFFERING' : 'PLAYING', Math.round(v.currentTime * 1000)];
  }
  function heap() {
    var m = performance.memory;
    s.heap.push([Date.now(), m ? Math.round(m.usedJSHeapSize / 1048576) : null]);
  }
  heap();
  s.timer = setInterval(function () {
    var r = read();
    if (s.buf.length >= ${SAMPLE_CAP}) { s.buf.shift(); s.dropped++; }
    var row = [Date.now(), r[0], r[1]];
    if (r.length > 2) row.push(r[2]);
    s.buf.push(row);
    s.n++;
    if (s.n % ${HEAP_EVERY} === 0) heap();
  }, ${SAMPLE_MS});
  w.__labloSoak = s;
  return 'sampler on';
})()`;

/** The samples and heap readings since the last drain, or null when no sampler runs (the page reloaded). */
export const SOAK_DRAIN = `(function () {
  var s = window.__labloSoak;
  if (!s) return null;
  var out = { started: s.started, samples: s.buf, heap: s.heap, dropped: s.dropped };
  s.buf = []; s.heap = []; s.dropped = 0;
  return out;
})()`;

/**
 * `[time ms, state, position ms, inflow?]`: AVPlay's `getState()` (`PLAYING`, `PAUSED`...),
 * `getCurrentTime()`, and its inflow reading where it gives one (`b<bandwidth>` or `w<live window>`).
 */
export type Sample = readonly [number, string, number] | readonly [number, string, number, string];
/** `[time ms, used JS heap MB or null]`. */
export type HeapReading = readonly [number, number | null];

export interface Drain {
  readonly started: number;
  readonly samples: readonly Sample[];
  readonly heap: readonly HeapReading[];
  readonly dropped: number;
}

/** A drain as the page returned it, or null if it isn't one. */
export function readDrain(value: unknown): Drain | null {
  if (typeof value !== 'object' || value === null) return null;
  const { started, samples, heap, dropped } = value as Record<string, unknown>;
  if (typeof started !== 'number' || !Array.isArray(samples) || !Array.isArray(heap) || typeof dropped !== 'number') return null;
  const isSample = (x: unknown): x is Sample =>
    Array.isArray(x) && (x.length === 3 || (x.length === 4 && typeof x[3] === 'string')) && typeof x[0] === 'number' && typeof x[1] === 'string' && typeof x[2] === 'number';
  const isHeap = (x: unknown): x is HeapReading =>
    Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && (typeof x[1] === 'number' || x[1] === null);
  if (!samples.every(isSample) || !heap.every(isHeap)) return null;
  return { started, samples, heap, dropped };
}

export interface Stall {
  /** The last sample where the position moved before it froze. */
  readonly startMs: number;
  readonly ms: number;
  /** Samples per player state while frozen. */
  readonly states: Readonly<Record<string, number>>;
  readonly posBefore: number;
  readonly posAfter: number;
}

/** The position frozen this long counts as a stall (soak-monitor.js's 1.5 s). */
export const STALL_MS = 1500;

/**
 * The inflow unchanged this long while `PLAYING` counts as no data (RELAY step 40g(e)): a TS
 * stream's bandwidth changes every second while bytes arrive, an HLS live window at each segment
 * (10 s at most on the panels seen so far). A `b0` keeps the last reading, as the app's does.
 */
export const NO_DATA_MS = 12_000;

/** A stretch with no data: from the last reading that showed bytes to the next one. */
export interface NoData {
  readonly startMs: number;
  readonly ms: number;
}

/**
 * Stalls in a stream of samples. The position "moves" when two samples in a row are `PLAYING`
 * and their positions differ (a reopen that restarts near 0 moves too). A stall starts at the
 * last move once nothing has moved for `STALL_MS`, and ends at the next move. Before the first
 * move nothing counts: a soak starts when the picture does.
 */
export class StallDetector {
  readonly stalls: Stall[] = [];
  private lastMove: number | null = null;
  private lastState: string | null = null;
  /** Read only after a `PLAYING` sample, so its first value never counts. */
  private lastPos = -1;
  private open: { start: number; pos: number; states: Record<string, number> } | null = null;
  private last: Sample | null = null;
  private first: number | null = null;
  /** The no-data stretches (RELAY step 40g(e)): the 2026-11-25 freezes the position never showed. */
  readonly noData: NoData[] = [];
  private flow: string | null = null;
  private flowAt: number | null = null;
  private dry: number | null = null;

  constructor(
    private readonly stallMs = STALL_MS,
    private readonly noDataMs = NO_DATA_MS,
  ) {}

  push(sample: Sample): Stall | null {
    const [now, state, pos] = sample;
    if (this.first === null) this.first = now;
    this.last = sample;
    let ended: Stall | null = null;
    const moved = state === 'PLAYING' && this.lastState === 'PLAYING' && pos !== this.lastPos;
    if (moved) {
      if (this.open !== null) {
        ended = { startMs: this.open.start, ms: now - this.open.start, states: this.open.states, posBefore: this.open.pos, posAfter: pos };
        this.stalls.push(ended);
        this.open = null;
      }
      this.lastMove = now;
    } else if (this.open === null && this.lastMove !== null && now - this.lastMove >= this.stallMs) {
      this.open = { start: this.lastMove, pos: this.lastPos, states: {} };
    }
    if (this.open !== null) this.open.states[state] = (this.open.states[state] ?? 0) + 1;
    this.lastState = state;
    this.lastPos = pos;
    this.pushFlow(now, state, sample.length === 4 ? sample[3] : null);
    return ended;
  }

  /** Bytes arrived when the reading changed to anything but `b0`; nothing for `noDataMs` while playing is a stretch. */
  private pushFlow(now: number, state: string, reading: string | null): void {
    if (reading === null) return;
    if (reading !== this.flow && reading !== 'b0') {
      if (this.dry !== null) this.noData.push({ startMs: this.dry, ms: now - this.dry });
      this.dry = null;
      this.flow = reading;
      this.flowAt = now;
    } else if (this.dry === null && state === 'PLAYING' && this.flowAt !== null && now - this.flowAt >= this.noDataMs) {
      this.dry = this.flowAt;
    }
  }

  /** The no-data stretch still going at the last sample: its length so far. */
  openNoDataMs(): number | null {
    return this.dry === null || this.last === null ? null : this.last[0] - this.dry;
  }

  /** The stall still going at the last sample: its length so far. */
  openStallMs(): number | null {
    return this.open === null || this.last === null ? null : this.last[0] - this.open.start;
  }

  /** The last `count` stalls, timed in minutes from the first sample (soak-monitor.js's `atMin`). */
  recent(count: number): StallRow[] {
    return this.stalls.slice(-count).map((stall) => ({
      atMin: this.first === null ? 0 : round1((stall.startMs - this.first) / 60_000),
      ms: stall.ms,
      states: stall.states,
      posBefore: stall.posBefore,
      posAfter: stall.posAfter,
    }));
  }

  summary(heap: readonly HeapReading[]): SoakSummary {
    const ms = this.stalls.map((stall) => stall.ms).sort((a, b) => a - b);
    return {
      minutes: this.first === null || this.last === null ? 0 : round1((this.last[0] - this.first) / 60_000),
      played: this.lastMove !== null,
      state: this.last?.[1] ?? null,
      position: this.last?.[2] ?? null,
      stalls: ms.length,
      over10s: ms.filter((x) => x > 10_000).length,
      medianMs: ms.length === 0 ? null : (ms[Math.floor(ms.length / 2)] ?? null),
      maxMs: ms.length === 0 ? null : (ms[ms.length - 1] ?? null),
      openStallMs: this.openStallMs(),
      inflow: this.flow !== null,
      noData: this.noData.length,
      longestNoDataMs: this.noData.reduce<number | null>((most, stretch) => (most === null || stretch.ms > most ? stretch.ms : most), null),
      openNoDataMs: this.openNoDataMs(),
      heapMB: heap.map(([at, mb]) => [this.first === null ? 0 : Math.round((at - this.first) / 60_000), mb]),
    };
  }
}

export interface StallRow extends Omit<Stall, 'startMs'> {
  readonly atMin: number;
}

/** Stalls listed after a soak. */
export const LISTED_STALLS = 40;

export interface SoakSummary {
  readonly minutes: number;
  /** False while the picture has never moved. */
  readonly played: boolean;
  readonly state: string | null;
  readonly position: number | null;
  readonly stalls: number;
  /** Step 21's rule: each stall recovered in 10 s or less. */
  readonly over10s: number;
  readonly medianMs: number | null;
  readonly maxMs: number | null;
  readonly openStallMs: number | null;
  /** Whether AVPlay gave an inflow reading (RELAY step 40g(e)); the no-data counts mean nothing without one. */
  readonly inflow: boolean;
  /** Stretches with no data for `NO_DATA_MS` or more while playing, the longest, and one still going. */
  readonly noData: number;
  readonly longestNoDataMs: number | null;
  readonly openNoDataMs: number | null;
  /** `[minutes from the first sample, MB]`. */
  readonly heapMB: readonly (readonly [number, number | null])[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** One line per drain while `pnpm tv soak watch` runs. */
export function summaryLine(summary: SoakSummary): string {
  const heap = summary.heapMB[summary.heapMB.length - 1]?.[1];
  const parts = [
    `${summary.minutes} min`,
    summary.state ?? 'no samples',
    summary.played ? `stalls ${summary.stalls} (over 10 s: ${summary.over10s}, longest ${seconds(summary.maxMs)})` : 'never played',
  ];
  if (summary.openStallMs !== null) parts.push(`frozen now ${seconds(summary.openStallMs)}`);
  if (summary.inflow) parts.push(`no data ${summary.noData} (longest ${seconds(summary.longestNoDataMs)})`);
  if (summary.openNoDataMs !== null) parts.push(`no data now ${seconds(summary.openNoDataMs)}`);
  if (heap !== undefined && heap !== null) parts.push(`heap ${heap} MB`);
  return parts.join(', ');
}

function seconds(ms: number | null): string {
  return ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`;
}

/** A recorded soak (one drain per ndjson line) read again. */
export function replaySoak(ndjson: string): { readonly detector: StallDetector; readonly heap: HeapReading[]; readonly dropped: number } {
  const detector = new StallDetector();
  const heap: HeapReading[] = [];
  let dropped = 0;
  for (const line of ndjson.split('\n')) {
    if (line.trim() === '') continue;
    const drain = readDrain(JSON.parse(line));
    if (drain === null) throw new Error(`not a soak drain: ${line.slice(0, 80)}`);
    for (const sample of drain.samples) detector.push(sample);
    heap.push(...drain.heap);
    dropped += drain.dropped;
  }
  return { detector, heap, dropped };
}
