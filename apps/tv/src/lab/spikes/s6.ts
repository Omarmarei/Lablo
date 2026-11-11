/**
 * S6 from docs/architecture.md §5: scale on the low-end webOS 4 TV (RELAY step 15b). Everything
 * runs on the app's own data engine (its real query, ingest and EPG workers, in the lab's copy of
 * the app database) and the app's live screen:
 *
 * - `source`: the lab server (the mock) hands out an M3U of its test account and a guide whose
 *   dates it moved to this TV's (`/__lab/source`), so the lab holds no account;
 * - `ingest`: the M3U ingest (≤ 90 s, no crash);
 * - `search`: a few searches over what was stored (≤ 200 ms each);
 * - `keys`: key presses on the live screen while a refresh of the source runs (< 200 ms from the
 *   key to the painted focus, each);
 * - `guide`: the guide's filtered ingest (≤ 4 min);
 * - `cold-start`: this launch's boot (the page to the lab's script) plus a fresh data engine to
 *   the live screen's painted rows, as the app starts with a source stored (≤ 3 s);
 * - `cleanup`: the lab's copy of the app database deleted.
 *
 * The criteria are about the scale catalog (200k items) and the 150 MB guide: against the mock's
 * own small catalog the checks measure and report `info`. A check that finds the app's own data
 * on this origin (the lab page shares the dev app's origin under `pnpm dev`) skips the whole spike
 * and never deletes anything.
 */
import type { ContentKind } from '@lablo/core';
import type { EpgCatalogSource, EpgProgress, EpgRefreshResult, IngestJob, IngestProgress, IngestResult, LoadedProfile, ProfileEdit } from '@lablo/data';
import { CancelSource } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { DataSummary, EpgRefreshOptions, RefreshOptions, SearchSummary } from '../../data/engine';
import { createAppDataEngine } from '../../data/workers';
import type { LiveEngine } from '../../live/live-state';
import { storedSources } from '../../onboarding/engine-loader';
import { readStartProfile, startPoint } from '../../onboarding/start';
import { xhrJson } from '../http';
import { deleteDatabaseAndWait } from '../idb-delete';
import type { LiveStage, PressTiming } from '../live-stage';
import { mountLiveStage } from '../live-stage';
import type { LabSource } from '../scale';
import {
  APP_DB,
  S6_CRITERIA,
  S6_GUIDE_ID,
  S6_PRESSES,
  S6_PRESS_GAP_MS,
  S6_QUERIES,
  S6_SOURCE_ID,
  atScale,
  foreignSources,
  formatMs,
  judge,
  parseLabSource,
  summarizeMs,
} from '../scale';
import type { Check, CheckResult, Spike } from '../types';

/** What S6 needs of the data engine (`DataEngine` fits; unit tests pass a fake). */
export interface S6Engine extends LiveEngine {
  start(): Promise<number>;
  sourceIds(): Promise<string[]>;
  profile(): Promise<LoadedProfile | null>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
  refresh(job: IngestJob, options?: RefreshOptions): Promise<IngestResult>;
  refreshEpg(catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions): Promise<EpgRefreshResult>;
  search(query: string, options?: { limit?: number; names?: number }): Promise<SearchSummary>;
  summary(): Promise<DataSummary>;
  dispose(): void;
}

export interface S6Deps {
  createEngine(): S6Engine;
  mountStage(platform: Platform, engine: LiveEngine): LiveStage;
  /** GET and parse JSON (rejects on a network error or a non-200). */
  getJson(url: string): Promise<unknown>;
  indexedDB(): IDBFactory | null;
  /** A monotonic clock in ms. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** What one run of the spike found so far; `source` starts a new one. */
interface S6Run {
  engine: S6Engine | null;
  source: LabSource | null;
  scale: { catalog: boolean; guide: boolean };
  /** Why S6 can't run on this origin (the app's own data is here). */
  blocked: string | null;
  /** The database holds only S6's data, so cleanup may delete it. */
  owned: boolean;
  ingested: boolean;
}

const MINUTE_MS = 60_000;

export const DEFAULT_S6_DEPS: S6Deps = {
  createEngine: () => createAppDataEngine(),
  mountStage: (platform, engine) => mountLiveStage(platform, engine),
  getJson: (url) => xhrJson(url),
  indexedDB: () => (typeof indexedDB === 'undefined' ? null : indexedDB),
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const count = (counts: Partial<Record<ContentKind, number>>): number => (counts.live ?? 0) + (counts.movie ?? 0) + (counts.series ?? 0);
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createS6(deps: S6Deps = DEFAULT_S6_DEPS): Spike {
  let run: S6Run = { engine: null, source: null, scale: { catalog: false, guide: false }, blocked: null, owned: false, ingested: false };

  /** The check can't run: S6 is blocked here, or an earlier check didn't get as far. */
  const cannot = (needs: 'source' | 'ingest'): CheckResult | null => {
    if (run.blocked !== null) return { status: 'skip', note: run.blocked };
    if (run.engine === null || run.source === null) return { status: 'skip', note: 'needs the source (the first check)' };
    if (needs === 'ingest' && !run.ingested) return { status: 'skip', note: 'needs the ingest' };
    return null;
  };
  const engineOf = (): S6Engine => run.engine as S6Engine;
  const sourceOf = (): LabSource => run.source as LabSource;
  const refreshJob = (force: boolean): IngestJob => ({ src: S6_SOURCE_ID, source: { type: 'm3u', url: sourceOf().m3u }, force });

  const source: Check = {
    id: 'source',
    title: 'The scale source from the lab server',
    timeoutMs: 3 * MINUTE_MS,
    run: async (context) => {
      run.engine?.dispose();
      run = { engine: null, source: null, scale: { catalog: false, guide: false }, blocked: null, owned: false, ingested: false };
      const parsed = parseLabSource(await deps.getJson(`${context.server}/__lab/source?around=${Date.now()}`));
      if (parsed === null) return { status: 'fail', note: 'the lab server answered something else than a source' };
      const engine = deps.createEngine();
      run.engine = engine;
      await engine.start();
      const foreign = foreignSources((await engine.sourceIds()).concat(storedSources(await engine.profile()).map((s) => s.id)));
      if (foreign.length > 0) {
        run.blocked = `this origin holds the app's own data (${foreign.length} source${foreign.length === 1 ? '' : 's'}): S6 would overwrite it. On a TV the lab has its own storage; under pnpm dev open the lab from a dev server on another port`;
        return { status: 'skip', note: run.blocked };
      }
      run.owned = true;
      run.source = parsed;
      run.scale = atScale(parsed);
      // Never the URLs: they carry the test account.
      const value = { items: parsed.items, live: parsed.live, guide: { static: parsed.guide.static, bytes: parsed.guide.bytes, gzBytes: parsed.guide.gzBytes, shiftDays: parsed.guide.shiftDays }, atScale: run.scale };
      const what = `${thousands(parsed.items)} playlist entries, a ${(parsed.guide.bytes / 1e6).toFixed(1)} MB guide moved ${parsed.guide.shiftDays} days`;
      if (run.scale.catalog && run.scale.guide) return { status: 'pass', value, note: `${what}: the scale fixtures` };
      return { status: 'info', value, note: `${what}: not the scale fixtures, so S6 measures without judging (pnpm lab:scale, or pnpm mock --catalog .cache/fixtures/catalog.json --xmltv .cache/fixtures/xmltv-150mb.xml.gz)` };
    },
  };

  const ingest: Check = {
    id: 'ingest',
    title: '200k M3U ingest ≤ 90 s, no crash',
    timeoutMs: 5 * MINUTE_MS,
    run: async (context) => {
      const blocked = cannot('source');
      if (blocked !== null) return blocked;
      const engine = engineOf();
      const lowTier = context.info.tier === 'low';
      await engine.editProfile({ kind: 'source', source: { id: S6_SOURCE_ID, type: 'm3u', name: 'Lablo Lab S6', url: sourceOf().m3u, added: Date.now() } });
      let events = 0;
      const started = deps.now();
      let result: IngestResult;
      try {
        result = await engine.refresh(refreshJob(true), { lowTier, onProgress: () => (events += 1) });
      } catch (error) {
        return { status: 'fail', value: { ms: Math.round(deps.now() - started), lowTier }, note: `the ingest failed: ${message(error)}` };
      }
      const ms = Math.round(deps.now() - started);
      const items = count(result.counts);
      run.ingested = items > 0;
      const value = { ms, items, counts: result.counts, expected: sourceOf().items, bytes: result.fetch === null ? null : result.fetch.bytes, lowTier, progressEvents: events, throttle: result.throttle };
      const status = judge(run.scale.catalog, ms <= S6_CRITERIA.ingestMs, items === 0);
      return { status, value, note: `${thousands(items)} items in ${formatMs(ms)}${lowTier ? ' (low tier)' : ''}` };
    },
  };

  const search: Check = {
    id: 'search',
    title: 'Search ≤ 200 ms',
    timeoutMs: MINUTE_MS,
    run: async () => {
      const blocked = cannot('ingest');
      if (blocked !== null) return blocked;
      const engine = engineOf();
      const queries: { q: string; ms: number; total: number }[] = [];
      for (const q of S6_QUERIES) {
        const started = deps.now();
        const result = await engine.search(q, { names: 3 });
        queries.push({ q, ms: Math.round((deps.now() - started) * 10) / 10, total: result.total });
      }
      const summary = summarizeMs(queries.map((x) => x.ms));
      const found = queries.some((x) => x.total > 0);
      const status = judge(run.scale.catalog, summary.max <= S6_CRITERIA.searchMs, !found);
      return { status, value: { ...summary, queries }, note: found ? `${queries.length} searches: median ${formatMs(summary.median)}, slowest ${formatMs(summary.max)}` : 'no search found anything' };
    },
  };

  const keys: Check = {
    id: 'keys',
    title: 'Key to focus < 200 ms during a refresh',
    timeoutMs: 4 * MINUTE_MS,
    run: async (context) => {
      const blocked = cannot('ingest');
      if (blocked !== null) return blocked;
      const engine = engineOf();
      const stage = deps.mountStage(context.platform, engine);
      try {
        await stage.painted();
        const cancel = new CancelSource();
        // Set from the refresh's callbacks (an object, so the reads below aren't narrowed away).
        const state: { running: boolean; items: number; ended: 'finished' | 'cancelled' | 'failed' } = { running: true, items: 0, ended: 'finished' };
        const refreshing = engine
          .refresh(refreshJob(true), {
            lowTier: context.info.tier === 'low',
            cancel: cancel.token,
            onProgress: (p: IngestProgress) => {
              state.items = p.items;
            },
          })
          .then(
            () => undefined,
            (error: unknown) => {
              state.ended = cancel.token.cancelled ? 'cancelled' : 'failed';
              return message(error);
            },
          )
          .then((failure) => {
            state.running = false;
            return failure;
          });
        // Press once the refresh is parsing (or over, on a small source).
        const waitStarted = deps.now();
        while (state.running && state.items === 0 && deps.now() - waitStarted < MINUTE_MS) await deps.sleep(50);
        const itemsAtStart = state.items;
        const presses: (PressTiming & { during: boolean })[] = [];
        for (const intent of S6_PRESSES) {
          const timing = await stage.press(intent);
          presses.push({ ...timing, during: state.running });
          await deps.sleep(S6_PRESS_GAP_MS);
        }
        const itemsAtEnd = state.items;
        if (state.running) cancel.cancel();
        const failure = await refreshing;
        const ended = state.ended;
        const missed = presses.filter((p) => p.ms === null).map((p) => `${p.intent} to ${p.path}`);
        const timed = presses.filter((p) => p.ms !== null).map((p) => p.ms as number);
        const summary = summarizeMs(timed);
        const during = presses.filter((p) => p.during).length;
        const value = {
          ...summary,
          during,
          refresh: { ended, itemsAtStart, itemsAtEnd, error: ended === 'failed' ? failure : null },
          presses: presses.map((p) => [p.intent, p.path, p.ms === null ? null : Math.round(p.ms)]),
        };
        if (missed.length > 0) return { status: 'fail', value, note: `the focus never showed for ${missed.length} press${missed.length === 1 ? '' : 'es'}: ${missed[0]}` };
        if (ended === 'failed') return { status: 'fail', value, note: `the refresh failed: ${String(failure)}` };
        const status = judge(run.scale.catalog, summary.max < S6_CRITERIA.pressMs && during === presses.length);
        return { status, value, note: `${presses.length} presses (${during} during the refresh): median ${formatMs(summary.median)}, slowest ${formatMs(summary.max)}` };
      } finally {
        stage.close();
      }
    },
  };

  const guide: Check = {
    id: 'guide',
    title: '150 MB gzipped guide ingest ≤ 4 min',
    timeoutMs: 10 * MINUTE_MS,
    run: async (context) => {
      const blocked = cannot('ingest');
      if (blocked !== null) return blocked;
      const engine = engineOf();
      const tier = context.info.tier;
      let bytes = 0;
      const started = deps.now();
      const result = await engine.refreshEpg([], {
        tier,
        user: [{ id: S6_GUIDE_ID, url: sourceOf().guide.url }],
        force: true,
        onProgress: (p: EpgProgress) => {
          bytes = p.bytes;
        },
      });
      const ms = Math.round(deps.now() - started);
      const outcome = result.outcomes[0];
      if (outcome === undefined) return { status: 'fail', value: { ms }, note: 'no guide was read' };
      if (outcome.result === null) return { status: 'fail', value: { ms, error: outcome.error }, note: `the guide failed: ${outcome.error.code} ${outcome.error.message}` };
      const s = outcome.result.summary;
      const value = {
        ms,
        tier,
        wanted: result.wanted,
        matched: s === null ? 0 : s.matched,
        kept: s === null ? 0 : s.kept,
        programmes: s === null ? 0 : s.programmes,
        buckets: s === null ? 0 : s.buckets,
        days: s === null ? null : { past: s.pastDays, future: s.futureDays },
        received: bytes,
        gzipped: outcome.result.gzipped,
        guide: { bytes: sourceOf().guide.bytes, gzBytes: sourceOf().guide.gzBytes },
      };
      const status = judge(run.scale.guide, ms <= S6_CRITERIA.guideMs, value.kept === 0);
      const note = value.kept === 0 ? 'the guide kept no programme' : `${thousands(value.kept)} programmes kept for ${thousands(value.matched)} of ${thousands(value.wanted)} channels in ${formatMs(ms)}`;
      return { status, value, note };
    },
  };

  const coldStart: Check = {
    id: 'cold-start',
    title: 'Cached cold start to the live screen ≤ 3 s',
    timeoutMs: 2 * MINUTE_MS,
    run: async (context) => {
      const blocked = cannot('ingest');
      if (blocked !== null) return blocked;
      // A cold start has no workers running: the app's start with a source stored (main.tsx).
      engineOf().dispose();
      run.engine = null;
      const started = deps.now();
      const engine = deps.createEngine();
      run.engine = engine;
      const point = startPoint(await readStartProfile(engine));
      const mounted = deps.now();
      const stage = deps.mountStage(context.platform, engine);
      try {
        const painted = await stage.painted();
        const dataMs = Math.round(mounted - started + painted);
        const idleMs = Math.round(mounted - started + (await stage.idle()));
        const bootMs = Math.round(context.bootMs);
        const totalMs = bootMs + dataMs;
        const value = { bootMs, dataMs, totalMs, idleMs, start: point.screen };
        if (point.screen !== 'home') return { status: 'fail', value, note: 'the stored profile would start onboarding, not the live screen' };
        return { status: judge(run.scale.catalog, totalMs <= S6_CRITERIA.coldStartMs), value, note: `${formatMs(totalMs)}: boot ${formatMs(bootMs)}, data to painted rows ${formatMs(dataMs)} (idle at ${formatMs(idleMs)})` };
      } finally {
        stage.close();
      }
    },
  };

  const cleanup: Check = {
    id: 'cleanup',
    title: "Delete the lab's copy of the app database",
    run: async () => {
      if (run.blocked !== null) return { status: 'skip', note: run.blocked };
      if (!run.owned) return { status: 'skip', note: 'nothing of S6 to delete' };
      run.engine?.dispose();
      run.engine = null;
      run.owned = false;
      run.ingested = false;
      const factory = deps.indexedDB();
      if (factory === null) return { status: 'fail', note: 'no indexedDB' };
      const error = await deleteDatabaseAndWait(factory, APP_DB);
      // Housekeeping, not a criterion: `info` when done, so it never makes the spike look judged.
      return error === null ? { status: 'info', note: `deleted "${APP_DB}"` } : { status: 'fail', note: `could not delete "${APP_DB}": ${error}` };
    },
  };

  return {
    id: 'S6',
    title: 'Scale',
    question: 'Scale on the low-end webOS 4 TV: 200k M3U ingest ≤ 90 s, key to focus < 200 ms during ingest, 150 MB guide ≤ 4 min, cached cold start ≤ 3 s, search ≤ 200 ms',
    checks: [source, ingest, search, keys, guide, coldStart, cleanup],
  };
}

export const S6 = createS6();
