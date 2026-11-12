import type { DeviceTier } from '@lablo/core';
import type { EpgCatalogSource, EpgOutcome, EpgRefreshResult, IngestResult, IngestSource, LoadedProfile, SourceMeta, SourceRecord } from '@lablo/data';
import { INGEST_VERSION } from '@lablo/data/client';
import type { LifecycleEvent } from '@lablo/platform-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EpgRefreshOptions, RefreshOptions } from './engine';
import type { SchedulerEngine, SchedulerTimers } from './refresh-scheduler';
import { BUSY_RETRY_MS, CATALOG_REFRESH_MS, CATALOG_RETRY_MS, CHECK_MS, FIRST_CHECK_MS, catalogRefreshDue, createRefreshScheduler } from './refresh-scheduler';

const HOUR = 3_600_000;
/** 2026-11-04 20:00 UTC. */
const T0 = Date.UTC(2026, 10, 4, 20, 0, 0);

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = {
  id: 's2',
  type: 'xtream',
  name: 'Panel',
  account: { base: 'http://panel.test', username: 'u', password: 'p' },
  added: 2,
};

function meta(src: string, checkedAt: number | null | undefined, gen = 3, updatedAt: number | null = null): SourceMeta {
  const out: SourceMeta = { src, gen, building: null, nextGen: gen + 1, updatedAt, counts: { live: 10 } };
  if (checkedAt !== undefined) out.checkedAt = checkedAt;
  return out;
}

function ingestResult(src: string, status: 'committed' | 'unchanged'): IngestResult {
  return { src, status, gen: 4, previous: status === 'committed' ? 3 : 4, counts: {}, fetch: null, gzipped: false, elapsedMs: 1, m3u: null } as IngestResult;
}

const committedGuide = (epgSrc: string): EpgOutcome => ({ epgSrc, result: { status: 'committed' } as EpgOutcome['result'] & object, error: null }) as EpgOutcome;
const unchangedGuide = (epgSrc: string): EpgOutcome => ({ epgSrc, result: { status: 'unchanged' } as EpgOutcome['result'] & object, error: null }) as EpgOutcome;
const failedGuide = (epgSrc: string): EpgOutcome => ({ epgSrc, result: null, error: { code: 'network', status: null, message: 'down' } });

interface Held<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface RefreshCall {
  readonly job: { src: string; source: IngestSource };
  readonly options: RefreshOptions;
}

interface EpgCall {
  readonly catalogs: readonly EpgCatalogSource[];
  readonly options: EpgRefreshOptions;
}

/** A data engine whose refreshes answer at once (unchanged, nothing new), or are held when asked. */
class FakeEngine implements SchedulerEngine {
  refreshing = false;
  /** The guide typed in onboarding with s1 (profile version 4 keeps it in `guides`, under s1's id). */
  profileDoc: LoadedProfile | null = { doc: { v: 4, sources: [S1, S2], guides: [{ id: 's1', url: 'http://guides.test/a.xml' }] }, newer: false, migratedFrom: null };
  failProfile = false;
  metas: SourceMeta[] = [meta('s1', T0), meta('s2', T0)];
  /** Each source's answer: a status, an error, or `hold` (settled by hand through `held`). */
  answers = new Map<string, 'committed' | 'unchanged' | Error | 'hold'>();
  epgAnswer: EpgRefreshResult | Error | 'hold' = { outcomes: [], deleted: [], reranked: [], wanted: 0 };
  readonly refreshCalls: RefreshCall[] = [];
  readonly epgCalls: EpgCall[] = [];
  readonly heldRefresh: Held<IngestResult>[] = [];
  readonly heldEpg: Held<EpgRefreshResult>[] = [];
  profiles = 0;

  profile(): Promise<LoadedProfile | null> {
    this.profiles += 1;
    return this.failProfile ? Promise.reject(new Error('no IndexedDB')) : Promise.resolve(this.profileDoc);
  }

  statusReads = 0;

  sourceStatus(): Promise<SourceMeta[]> {
    this.statusReads += 1;
    return Promise.resolve(this.metas);
  }

  refresh(job: { src: string; source: IngestSource }, options: RefreshOptions): Promise<IngestResult> {
    this.refreshCalls.push({ job, options });
    const answer = this.answers.get(job.src) ?? 'unchanged';
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer === 'hold') return new Promise((resolve, reject) => this.heldRefresh.push({ resolve, reject }));
    return Promise.resolve(ingestResult(job.src, answer));
  }

  refreshEpg(catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions): Promise<EpgRefreshResult> {
    this.epgCalls.push({ catalogs, options });
    const answer = this.epgAnswer;
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer === 'hold') return new Promise((resolve, reject) => this.heldEpg.push({ resolve, reject }));
    return Promise.resolve(answer);
  }
}

/** Timers run by hand, with a clock that `advance` moves. */
function manualTimers(start: number) {
  let now = start;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: SchedulerTimers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    now: () => now,
    /** When the timers waiting are due, in ms from now. */
    due: () => queue.map((t) => t.at - now).sort((a, b) => a - b),
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

/** Lets every promise the pass is waiting on settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(options: { engine?: FakeEngine; tier?: DeviceTier; languages?: string[] } = {}) {
  const engine = options.engine ?? new FakeEngine();
  const clock = manualTimers(T0);
  const catalogs: string[][] = [];
  let guides = 0;
  let listener: ((event: LifecycleEvent) => void) | null = null;
  let subscriptions = 0;
  let unsubscribed = 0;
  const scheduler = createRefreshScheduler({
    engine,
    tier: () => Promise.resolve(options.tier ?? 'full'),
    languages: () => options.languages ?? ['ar'],
    lifecycle: (l) => {
      subscriptions += 1;
      listener = l;
      return () => {
        unsubscribed += 1;
        listener = null;
      };
    },
    onCatalog: (srcs) => catalogs.push(srcs),
    onGuides: () => {
      guides += 1;
    },
    now: clock.now,
    timers: clock.timers,
  });
  /** Moves the clock and lets the pass run. */
  const run = async (ms: number): Promise<void> => {
    clock.advance(ms);
    await settle();
  };
  const emit = (event: LifecycleEvent): void => {
    if (listener === null) throw new Error('no lifecycle listener');
    listener(event);
  };
  return {
    engine,
    clock,
    scheduler,
    catalogs,
    guides: () => guides,
    subscriptions: () => subscriptions,
    unsubscribed: () => unsubscribed,
    listening: () => listener !== null,
    run,
    emit,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('catalogRefreshDue', () => {
  it('is due 12 h after the last check, to the millisecond', () => {
    expect(catalogRefreshDue(meta('s1', T0), undefined, T0 + CATALOG_REFRESH_MS - 1)).toBe(false);
    expect(catalogRefreshDue(meta('s1', T0), undefined, T0 + CATALOG_REFRESH_MS)).toBe(true);
    expect(CATALOG_REFRESH_MS).toBe(12 * HOUR);
  });

  it('is due for a source with no catalog: none stored, or generation 0 (a wiped database)', () => {
    expect(catalogRefreshDue(undefined, undefined, T0)).toBe(true);
    expect(catalogRefreshDue(meta('s1', T0, 0), undefined, T0)).toBe(true);
  });

  it('reads the last commit when a record has no check time, and is due when it has neither', () => {
    expect(catalogRefreshDue(meta('s1', undefined, 3, T0), undefined, T0 + CATALOG_REFRESH_MS - 1)).toBe(false);
    expect(catalogRefreshDue(meta('s1', undefined, 3, T0), undefined, T0 + CATALOG_REFRESH_MS)).toBe(true);
    expect(catalogRefreshDue(meta('s1', null, 3, T0), undefined, T0 + CATALOG_REFRESH_MS - 1)).toBe(false);
    expect(catalogRefreshDue(meta('s1', null, 3, T0), undefined, T0 + CATALOG_REFRESH_MS)).toBe(true);
    expect(catalogRefreshDue(meta('s1', undefined, 3, null), undefined, T0)).toBe(true);
    expect(catalogRefreshDue(meta('s1', null, 3, null), undefined, T0)).toBe(true);
  });

  it('holds a source whose refresh failed for 2 h, even one with no catalog', () => {
    const stale = meta('s1', T0 - CATALOG_REFRESH_MS);
    expect(catalogRefreshDue(stale, T0, T0 + CATALOG_RETRY_MS - 1)).toBe(false);
    expect(catalogRefreshDue(stale, T0, T0 + CATALOG_RETRY_MS)).toBe(true);
    expect(catalogRefreshDue(undefined, T0, T0 + 1)).toBe(false);
    // A failure long ago doesn't make a fresh catalog due.
    expect(catalogRefreshDue(meta('s1', T0), T0 - 5 * HOUR, T0 + 1)).toBe(false);
    expect(CATALOG_RETRY_MS).toBe(2 * HOUR);
  });

  it('is due at once for a catalog an older ingest version built (step 26e), unless its refresh failed', () => {
    const stamped = (v: number): SourceMeta => ({ ...meta('s1', T0), fetch: { v, hash: 'h', bytes: 1, etag: null, lastModified: null } });
    expect(INGEST_VERSION).toBe(2);
    expect(catalogRefreshDue(stamped(INGEST_VERSION - 1), undefined, T0 + 1)).toBe(true);
    expect(catalogRefreshDue(stamped(INGEST_VERSION), undefined, T0 + 1)).toBe(false);
    // A newer version's stamp (an app rolled back) is no reason, nor is a record from before the stamps.
    expect(catalogRefreshDue(stamped(INGEST_VERSION + 1), undefined, T0 + 1)).toBe(false);
    expect(catalogRefreshDue({ ...meta('s1', T0), fetch: null }, undefined, T0 + 1)).toBe(false);
    expect(catalogRefreshDue(stamped(INGEST_VERSION - 1), T0, T0 + 1)).toBe(false);
  });
});

describe('the refresh schedule', () => {
  it('checks first 15 s after the start, then every 15 min', async () => {
    const t = setup();
    expect(t.clock.due()).toEqual([]);
    t.scheduler.start();
    expect(t.clock.due()).toEqual([FIRST_CHECK_MS]);
    await t.run(FIRST_CHECK_MS - 1);
    expect(t.engine.profiles).toBe(0);
    await t.run(1);
    expect(t.engine.profiles).toBe(1);
    expect(t.clock.due()).toEqual([CHECK_MS]);
    await t.run(CHECK_MS - 1);
    expect(t.engine.profiles).toBe(1);
    await t.run(1);
    expect(t.engine.profiles).toBe(2);
    expect([FIRST_CHECK_MS, CHECK_MS]).toEqual([15_000, 15 * 60_000]);
  });

  it('starts once', async () => {
    const t = setup();
    t.scheduler.start();
    t.scheduler.start();
    expect(t.clock.due()).toEqual([FIRST_CHECK_MS]);
    expect(t.subscriptions()).toBe(1);
  });

  it('with fresh catalogs refreshes none, and asks only for the guides that are due', async () => {
    const t = setup({ languages: ['ar'] });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(t.engine.refreshCalls).toEqual([]);
    expect(t.engine.epgCalls).toHaveLength(1);
    const { catalogs, options } = t.engine.epgCalls[0]!;
    expect(catalogs).toEqual([
      { src: 's1', type: 'm3u' },
      { src: 's2', type: 'xtream', account: S2.account },
    ]);
    expect(options.due).toBe(true);
    expect(options.tier).toBe('full');
    expect(options.languages).toEqual(['ar']);
    // The user's guides, from the profile's list.
    expect(options.user).toEqual([{ id: 's1', url: 'http://guides.test/a.xml' }]);
    expect(options.cancel?.cancelled).toBe(false);
    expect(t.catalogs).toEqual([]);
    expect(t.guides()).toBe(0);
  });

  it('does nothing without sources, and checks again later', async () => {
    const engine = new FakeEngine();
    engine.profileDoc = null;
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.refreshCalls).toEqual([]);
    expect(engine.epgCalls).toEqual([]);
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('refreshes each stale catalog, one at a time and in order, with the source and the tier', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0 - CATALOG_REFRESH_MS)];
    engine.answers.set('s1', 'hold');
    engine.answers.set('s2', 'hold');
    const t = setup({ engine, tier: 'low' });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job)).toEqual([{ src: 's1', source: { type: 'm3u', url: S1.url } }]);
    expect(engine.refreshCalls[0]!.options.lowTier).toBe(true);
    engine.heldRefresh[0]!.resolve(ingestResult('s1', 'unchanged'));
    await settle();
    expect(engine.refreshCalls.map((c) => c.job)).toEqual([
      { src: 's1', source: { type: 'm3u', url: S1.url } },
      { src: 's2', source: { type: 'xtream', account: S2.account } },
    ]);
    expect(engine.epgCalls).toEqual([]);
    engine.heldRefresh[1]!.resolve(ingestResult('s2', 'unchanged'));
    await settle();
    expect(engine.epgCalls).toHaveLength(1);
    expect(engine.epgCalls[0]!.options.tier).toBe('low');
  });

  it('refreshes only the stale one, and a source the database lost', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 + FIRST_CHECK_MS - CATALOG_REFRESH_MS + 1)];
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s2']);
    await t.run(CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s2', 's1', 's2']);
  });

  it('after a catalog commits: the screens hear of it, then every guide is read', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0 - CATALOG_REFRESH_MS)];
    engine.answers.set('s1', 'unchanged');
    engine.answers.set('s2', 'committed');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(t.catalogs).toEqual([['s2']]);
    expect(engine.epgCalls).toHaveLength(1);
    expect(engine.epgCalls[0]!.options.due).toBe(false);
    // The next pass asks only for what is due again.
    engine.metas = [meta('s1', T0 + FIRST_CHECK_MS), meta('s2', T0 + FIRST_CHECK_MS)];
    await t.run(CHECK_MS);
    expect(engine.epgCalls).toHaveLength(2);
    expect(engine.epgCalls[1]!.options.due).toBe(true);
    expect(t.catalogs).toEqual([['s2']]);
  });

  it('names every catalog that committed in one call', async () => {
    const engine = new FakeEngine();
    engine.metas = [];
    engine.answers.set('s1', 'committed');
    engine.answers.set('s2', 'committed');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(t.catalogs).toEqual([['s1', 's2']]);
  });

  it('holds a failed catalog for 2 h and still reads the guides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0)];
    engine.answers.set('s1', new Error('network'));
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
    expect(warn).toHaveBeenCalledWith('A catalog refresh failed', expect.any(Error));
    expect(engine.epgCalls).toHaveLength(1);
    expect(engine.epgCalls[0]!.options.due).toBe(true);
    // 15 min later, and up to 2 h after the failure: not again.
    for (let i = 0; i < 7; i += 1) await t.run(CHECK_MS);
    expect(t.clock.now() - (T0 + FIRST_CHECK_MS)).toBe(7 * CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
    await t.run(CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1', 's1']);
  });

  it('tells the screens when a guide swapped in, was deleted or moved, not when nothing changed', async () => {
    const engine = new FakeEngine();
    const t = setup({ engine });
    t.scheduler.start();
    engine.epgAnswer = { outcomes: [unchangedGuide('s2:xmltv'), failedGuide('u~s1')], deleted: [], reranked: [], wanted: 10 };
    await t.run(FIRST_CHECK_MS);
    expect(t.guides()).toBe(0);
    engine.epgAnswer = { outcomes: [unchangedGuide('s2:xmltv'), committedGuide('u~s1')], deleted: [], reranked: [], wanted: 10 };
    await t.run(CHECK_MS);
    expect(t.guides()).toBe(1);
    engine.epgAnswer = { outcomes: [], deleted: ['s3:xmltv'], reranked: [], wanted: 10 };
    await t.run(CHECK_MS);
    expect(t.guides()).toBe(2);
    engine.epgAnswer = { outcomes: [], deleted: [], reranked: ['u~g1'], wanted: 0 };
    await t.run(CHECK_MS);
    expect(t.guides()).toBe(3);
  });

  it('reads no guide list from a profile without one', async () => {
    const engine = new FakeEngine();
    engine.profileDoc = { doc: { v: 4, sources: [S1, S2], guides: 'odd' }, newer: false, migratedFrom: null };
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.epgCalls[0]!.options.user).toEqual([]);
  });

  it('when another refresh holds the slot, tries again in a minute', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0)];
    engine.refreshing = true;
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.refreshCalls).toEqual([]);
    expect(engine.epgCalls).toEqual([]);
    expect(t.clock.due()).toEqual([BUSY_RETRY_MS]);
    expect(BUSY_RETRY_MS).toBe(60_000);
    engine.refreshing = false;
    await t.run(BUSY_RETRY_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
    expect(engine.epgCalls).toHaveLength(1);
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('a slot taken before the guides: the committed catalogs are told, and the next pass reads every guide', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0 - CATALOG_REFRESH_MS)];
    engine.answers.set('s1', 'hold');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    // s1 commits; meanwhile something else takes the slot (onboarding, the hello screen).
    engine.refreshing = true;
    engine.heldRefresh[0]!.resolve(ingestResult('s1', 'committed'));
    await settle();
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
    expect(t.catalogs).toEqual([['s1']]);
    expect(engine.epgCalls).toEqual([]);
    expect(t.clock.due()).toEqual([BUSY_RETRY_MS]);
    // A minute later: s2 (still stale) unchanged, and every guide is read for s1's new catalog.
    engine.refreshing = false;
    engine.metas = [meta('s1', T0 + FIRST_CHECK_MS), meta('s2', T0 - CATALOG_REFRESH_MS)];
    await t.run(BUSY_RETRY_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1', 's2']);
    expect(engine.epgCalls).toHaveLength(1);
    expect(engine.epgCalls[0]!.options.due).toBe(false);
    expect(t.catalogs).toEqual([['s1']]);
  });

  it('a slot taken just before the guides, with nothing committed: tries again in a minute', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0)];
    engine.answers.set('s1', 'hold');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    engine.refreshing = true;
    engine.heldRefresh[0]!.resolve(ingestResult('s1', 'unchanged'));
    await settle();
    expect(engine.epgCalls).toEqual([]);
    expect(t.clock.due()).toEqual([BUSY_RETRY_MS]);
    engine.refreshing = false;
    engine.metas = [meta('s1', T0 + FIRST_CHECK_MS), meta('s2', T0)];
    await t.run(BUSY_RETRY_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
    expect(engine.epgCalls).toHaveLength(1);
    expect(engine.epgCalls[0]!.options.due).toBe(true);
  });

  it('a failed guide refresh keeps the "every guide" for the next pass', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0)];
    engine.answers.set('s1', 'committed');
    engine.epgAnswer = new Error('the EPG worker died');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(warn).toHaveBeenCalledWith('The scheduled refresh failed', expect.any(Error));
    expect(t.clock.due()).toEqual([CHECK_MS]);
    engine.metas = [meta('s1', T0 + FIRST_CHECK_MS), meta('s2', T0)];
    engine.epgAnswer = { outcomes: [], deleted: [], reranked: [], wanted: 0 };
    await t.run(CHECK_MS);
    expect(engine.epgCalls.map((c) => c.options.due)).toEqual([false, false]);
    await t.run(CHECK_MS);
    expect(engine.epgCalls.map((c) => c.options.due)).toEqual([false, false, true]);
  });

  it('counts the next check from the end of a long pass, and never runs two passes at once', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.epgCalls).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
    // Visible again while it runs: no second pass.
    t.emit('visible');
    await t.run(FIRST_CHECK_MS);
    expect(engine.profiles).toBe(1);
    await t.run(20 * 60_000);
    engine.heldEpg[0]!.resolve({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    await settle();
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('a pass that fails checks again in 15 min', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.failProfile = true;
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(warn).toHaveBeenCalledWith('The scheduled refresh failed', expect.any(Error));
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('hidden, checks nothing; visible again, checks 15 s later', async () => {
    const t = setup();
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(t.engine.profiles).toBe(1);
    t.emit('hidden');
    expect(t.clock.due()).toEqual([]);
    await t.run(5 * HOUR);
    expect(t.engine.profiles).toBe(1);
    t.emit('visible');
    expect(t.clock.due()).toEqual([FIRST_CHECK_MS]);
    await t.run(FIRST_CHECK_MS);
    expect(t.engine.profiles).toBe(2);
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('a relaunch counts as visible', async () => {
    const t = setup();
    t.scheduler.start();
    t.emit('hidden');
    t.emit('relaunch');
    expect(t.clock.due()).toEqual([FIRST_CHECK_MS]);
  });

  it('hidden during a pass: no next check until visible', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    t.emit('hidden');
    engine.heldEpg[0]!.resolve({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    await settle();
    expect(t.clock.due()).toEqual([]);
    t.emit('visible');
    expect(t.clock.due()).toEqual([FIRST_CHECK_MS]);
  });

  it('dispose stops the checks, cancels a running refresh and tells the screens nothing more', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0), meta('s2', T0 - CATALOG_REFRESH_MS)];
    engine.answers.set('s2', 'hold');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    const token = engine.refreshCalls[0]!.options.cancel!;
    expect(token.cancelled).toBe(false);
    t.scheduler.dispose();
    expect(token.cancelled).toBe(true);
    expect(t.unsubscribed()).toBe(1);
    expect(t.listening()).toBe(false);
    engine.heldRefresh[0]!.resolve(ingestResult('s2', 'committed'));
    await settle();
    expect(t.catalogs).toEqual([]);
    expect(engine.epgCalls).toEqual([]);
    expect(t.clock.due()).toEqual([]);
    t.scheduler.dispose();
    expect(t.unsubscribed()).toBe(1);
    t.scheduler.start();
    expect(t.clock.due()).toEqual([]);
  });

  it('refreshes no further catalog after dispose', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0 - CATALOG_REFRESH_MS)];
    engine.answers.set('s1', 'hold');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    t.scheduler.dispose();
    engine.heldRefresh[0]!.resolve(ingestResult('s1', 'unchanged'));
    await settle();
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
    expect(engine.epgCalls).toEqual([]);
  });

  it('a guide refresh that fails after dispose is no failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    t.scheduler.dispose();
    engine.heldEpg[0]!.reject(new Error('cancelled'));
    await settle();
    expect(warn).not.toHaveBeenCalled();
    expect(t.clock.due()).toEqual([]);
  });

  it('dispose before the first check', async () => {
    const t = setup();
    t.scheduler.start();
    t.scheduler.dispose();
    expect(t.clock.due()).toEqual([]);
    await t.run(HOUR);
    expect(t.engine.profiles).toBe(0);
  });

  it('a refresh cancelled by dispose is no failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0 - CATALOG_REFRESH_MS)];
    engine.answers.set('s1', 'hold');
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    t.scheduler.dispose();
    engine.heldRefresh[0]!.reject(new Error('cancelled'));
    await settle();
    expect(warn).not.toHaveBeenCalled();
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
  });

  it('a guide swap after dispose is not told', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    t.scheduler.dispose();
    engine.heldEpg[0]!.resolve({ outcomes: [committedGuide('u~s1')], deleted: [], reranked: [], wanted: 1 });
    await settle();
    expect(t.guides()).toBe(0);
  });
});

describe('refreshNow (the guides screen, step 22b)', () => {
  const EMPTY: EpgRefreshResult = { outcomes: [], deleted: [], reranked: [], wanted: 0 };

  it('reads the due guides at once, and no catalog, even a stale one; the next check comes 15 min later', async () => {
    const engine = new FakeEngine();
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0)];
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(5_000);
    let settled = false;
    const now = t.scheduler.refreshNow().then(() => {
      settled = true;
    });
    // The first check's timer is replaced by the pass that runs now.
    expect(t.clock.due()).toEqual([]);
    await now;
    expect(settled).toBe(true);
    expect(engine.refreshCalls).toEqual([]);
    // The catalogs aren't even looked at.
    expect(engine.statusReads).toBe(0);
    expect(engine.epgCalls).toHaveLength(1);
    expect(engine.epgCalls[0]!.options).toMatchObject({ due: true, user: [{ id: 's1', url: 'http://guides.test/a.xml' }] });
    expect(t.clock.due()).toEqual([CHECK_MS]);
    // The stale catalog waits for that check.
    await t.run(CHECK_MS);
    expect(engine.refreshCalls.map((c) => c.job.src)).toEqual(['s1']);
  });

  it('settles only once its pass has ended', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    let settled = false;
    void t.scheduler.refreshNow().then(() => {
      settled = true;
    });
    await settle();
    expect(engine.epgCalls).toHaveLength(1);
    expect(settled).toBe(false);
    engine.heldEpg[0]!.resolve(EMPTY);
    await settle();
    expect(settled).toBe(true);
  });

  it('during a pass: one guides pass right after it for every call meanwhile, settled by that pass', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    expect(engine.epgCalls).toHaveLength(1);
    const settled: number[] = [];
    void t.scheduler.refreshNow().then(() => settled.push(1));
    void t.scheduler.refreshNow().then(() => settled.push(2));
    await settle();
    expect(engine.epgCalls).toHaveLength(1);
    engine.metas = [meta('s1', T0 - CATALOG_REFRESH_MS), meta('s2', T0)];
    engine.heldEpg[0]!.resolve(EMPTY);
    await settle();
    // The first pass's end settles nothing; the guides pass starts at once, with no catalog.
    expect(settled).toEqual([]);
    expect(engine.epgCalls).toHaveLength(2);
    expect(engine.refreshCalls).toEqual([]);
    expect(t.clock.due()).toEqual([]);
    engine.heldEpg[1]!.resolve(EMPTY);
    await settle();
    expect(settled).toEqual([1, 2]);
    expect(engine.epgCalls).toHaveLength(2);
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('a call during the pass it started waits for one more pass', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    const settled: number[] = [];
    void t.scheduler.refreshNow().then(() => settled.push(1));
    await settle();
    void t.scheduler.refreshNow().then(() => settled.push(2));
    engine.heldEpg[0]!.resolve(EMPTY);
    await settle();
    expect(settled).toEqual([1]);
    expect(engine.epgCalls).toHaveLength(2);
    engine.heldEpg[1]!.resolve(EMPTY);
    await settle();
    expect(settled).toEqual([1, 2]);
  });

  it('a pass that fails settles it too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.epgAnswer = new Error('no worker');
    const t = setup({ engine });
    t.scheduler.start();
    await t.scheduler.refreshNow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.clock.due()).toEqual([CHECK_MS]);
  });

  it('hidden: reads at once, and the next check waits for visible', async () => {
    const t = setup();
    t.scheduler.start();
    t.emit('hidden');
    await t.scheduler.refreshNow();
    expect(t.engine.epgCalls).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
    t.emit('visible');
    expect(t.clock.due()).toEqual([FIRST_CHECK_MS]);
  });

  it('after dispose settles at once and reads nothing; dispose settles the calls still waiting', async () => {
    const engine = new FakeEngine();
    engine.epgAnswer = 'hold';
    const t = setup({ engine });
    t.scheduler.start();
    await t.run(FIRST_CHECK_MS);
    const settled: number[] = [];
    void t.scheduler.refreshNow().then(() => settled.push(1));
    t.scheduler.dispose();
    await settle();
    expect(settled).toEqual([1]);
    await t.scheduler.refreshNow();
    engine.heldEpg[0]!.resolve(EMPTY);
    await settle();
    expect(engine.epgCalls).toHaveLength(1);
    expect(t.clock.due()).toEqual([]);
  });
});
