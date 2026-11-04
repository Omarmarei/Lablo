/**
 * S6's criteria and the arithmetic behind its checks (RELAY step 15b, docs/architecture.md §5:
 * "Scale on the low-end webOS 4 TV"). No DOM here, so unit tests cover it directly.
 */
import type { Intent } from '@zoma/platform-api';
import type { LabStatus } from './types';

/** architecture.md §5, S6's pass criteria. */
export const S6_CRITERIA = {
  /** 200k M3U ingest ≤ 90 s with no crash. */
  ingestMs: 90_000,
  /** Key press to focus move < 200 ms during ingest. */
  pressMs: 200,
  /** 150 MB gzipped XMLTV filtered ingest ≤ 4 min. */
  guideMs: 240_000,
  /** Cached cold start to usable ≤ 3 s. */
  coldStartMs: 3_000,
  /** Search ≤ 200 ms. */
  searchMs: 200,
} as const;

/**
 * What makes a run "at scale": the scale catalog (200k playlist entries) and the 150 MB guide
 * (148 MB of XMLTV). Against a smaller source the checks still measure, but report `info`: a
 * fast ingest of 20 channels says nothing about 200k.
 */
export const S6_SCALE = { items: 200_000, guideBytes: 140_000_000 } as const;

/** The source id S6's catalog is stored under, in the lab's copy of the app database. */
export const S6_SOURCE_ID = 'lab-s6';
/** The guide's user-guide id (stored as `u~lab-s6`). */
export const S6_GUIDE_ID = 'lab-s6';
/** The app's database name (packages/data/src/schema.ts `DB_NAME`; a test keeps them equal). */
export const APP_DB = 'zoma';

/** Search terms found in both the mock's own catalog and the scale catalog (Latin, Arabic, a prefix). */
export const S6_QUERIES: readonly string[] = ['zoma', 'sport', 'زوما', 'night', 'ki', 'الليل'];

/**
 * The keys pressed on the live screen while a refresh runs: down the list, page by page (each
 * page reads its chunks), to the rail and down it, OK on a category, back into the list.
 */
export const S6_PRESSES: readonly Intent[] = [
  ...repeat<Intent>('DOWN', 10),
  ...repeat<Intent>('CH_DOWN', 12),
  'LEFT',
  ...repeat<Intent>('DOWN', 5),
  'OK',
  'RIGHT',
  ...repeat<Intent>('DOWN', 5),
];
/** A viewer's pace between presses (after each press has painted). */
export const S6_PRESS_GAP_MS = 150;

function repeat<T>(value: T, times: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < times; i += 1) out.push(value);
  return out;
}

/** `pass`/`fail` against the criterion at scale, `info` otherwise; a broken run always fails. */
export function judge(atScale: boolean, met: boolean, broken = false): LabStatus {
  if (broken) return 'fail';
  if (!atScale) return 'info';
  return met ? 'pass' : 'fail';
}

export interface MsSummary {
  readonly count: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

/** Median, 95th percentile (nearest rank) and maximum, rounded to 0.1 ms. */
export function summarizeMs(values: readonly number[]): MsSummary {
  if (values.length === 0) return { count: 0, median: 0, p95: 0, max: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  const round = (v: number): number => Math.round(v * 10) / 10;
  const middle = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  return { count: sorted.length, median: round(middle), p95: round(rank(0.95)), max: round(sorted[sorted.length - 1]!) };
}

/** `/__lab/source`'s answer (apps/mock-provider/src/lab-source.ts). */
export interface LabSource {
  readonly m3u: string;
  /** Entries the playlist lists. */
  readonly items: number;
  readonly live: number;
  readonly guide: {
    readonly url: string;
    readonly static: boolean;
    /** The XMLTV text's size; `gzBytes` what travels. */
    readonly bytes: number;
    readonly gzBytes: number;
    readonly shiftDays: number;
  };
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);

/** The answer checked, or `null` when it isn't one. */
export function parseLabSource(raw: unknown): LabSource | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const g = r.guide as Record<string, unknown> | null | undefined;
  if (!isHttp(r.m3u) || !isNumber(r.items) || !isNumber(r.live) || g === null || typeof g !== 'object') return null;
  if (!isHttp(g.url) || typeof g.static !== 'boolean' || !isNumber(g.bytes) || !isNumber(g.gzBytes) || !isNumber(g.shiftDays)) return null;
  return { m3u: r.m3u, items: r.items, live: r.live, guide: { url: g.url, static: g.static, bytes: g.bytes, gzBytes: g.gzBytes, shiftDays: g.shiftDays } };
}

/** Is the source the scale catalog, and the guide the 150 MB one? */
export function atScale(source: LabSource): { catalog: boolean; guide: boolean } {
  return { catalog: source.items >= S6_SCALE.items, guide: source.guide.static && source.guide.bytes >= S6_SCALE.guideBytes };
}

/**
 * Sources stored on this origin that aren't S6's own: the app's data, which S6 must never
 * overwrite. On a TV the lab has its own storage; under `pnpm dev` the lab page shares the
 * dev app's origin.
 */
export function foreignSources(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) if (id !== S6_SOURCE_ID && out.indexOf(id) === -1) out.push(id);
  return out;
}

/** "1.2 s" or "850 ms". */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
