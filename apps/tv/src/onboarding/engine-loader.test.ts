import type { EpgCatalogSource, IngestResult, IngestSource, LoadedProfile, ProfileEdit, SourceRecord } from '@lablo/data';
import { CancelError, RpcError } from '@lablo/data/client';
import { describe, expect, it } from 'vitest';
import type { EpgRefreshOptions, RefreshOptions } from '../data/engine';
import type { LoaderEngine } from './engine-loader';
import { createEngineLoader, loadError, nextSourceId, storedSources, typedGuide, userGuides } from './engine-loader';
import type { SourceDraft } from './form';
import type { LoadProgress, LoadResult } from './loader';
import { LoadError } from './loader';

const ACCOUNT = { base: 'http://panel.test', username: 'u', password: 'p' };
const XTREAM: SourceDraft = { type: 'xtream', name: 'Home', account: ACCOUNT, epgUrl: 'http://guide.test/x.xml' };
const M3U: SourceDraft = { type: 'm3u', name: 'List', url: 'http://p.test/l.m3u', epgUrl: null };

/** Resolves on the next turns of the event loop (lets chained promises run). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Whether `promise` settled (either way) by now. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await settle();
  return done;
}

interface Gate<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function gate<T>(): Gate<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ingestResult(src: string, counts: IngestResult['counts']): IngestResult {
  return { src, status: 'committed', gen: 1, previous: 0, counts } as IngestResult;
}

interface FakeOptions {
  profile?: LoadedProfile | null;
  ids?: string[];
  /** The refresh's answer: a result, an error, or a gate the test settles. */
  refresh?: (job: { src: string; source: IngestSource }, options: RefreshOptions) => Promise<IngestResult>;
  refreshEpg?: (catalogs: readonly EpgCatalogSource[], options: EpgRefreshOptions) => Promise<unknown>;
}

function fake(options: FakeOptions = {}) {
  const calls = {
    refresh: [] as Array<{ job: { src: string; source: IngestSource }; options: RefreshOptions }>,
    epg: [] as Array<{ catalogs: readonly EpgCatalogSource[]; options: EpgRefreshOptions }>,
    edits: [] as ProfileEdit[],
    profile: 0,
  };
  const engine: LoaderEngine = {
    refresh: (job, opts) => {
      calls.refresh.push({ job, options: opts });
      if (options.refresh) return options.refresh(job, opts);
      opts.onProgress?.({ src: job.src, phase: 'download', bytes: 10, total: 100, items: 5, kind: 'live' });
      opts.onProgress?.({ src: job.src, phase: 'commit', bytes: 100, total: 100, items: 6, kind: null });
      return Promise.resolve(ingestResult(job.src, { live: 3, movie: 2, series: 1 }));
    },
    refreshEpg: (catalogs, opts) => {
      calls.epg.push({ catalogs, options: opts });
      if (options.refreshEpg) return options.refreshEpg(catalogs, opts);
      opts.onProgress?.({ epgSrc: 'x', bytes: 40, total: 80, kept: 7 });
      return Promise.resolve({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    },
    sourceIds: () => Promise.resolve(options.ids ?? []),
    profile: () => {
      calls.profile += 1;
      return Promise.resolve(options.profile ?? null);
    },
    editProfile: (edit) => {
      calls.edits.push(edit);
      return Promise.resolve(true);
    },
  };
  return { engine, calls };
}

function loaderFor(engine: LoaderEngine, tier: 'low' | 'full' = 'full') {
  return createEngineLoader({ engine, tier: () => Promise.resolve(tier), languages: () => ['ar'], now: () => 777 });
}

describe('nextSourceId', () => {
  it('is one past the highest s<n> taken, ignoring other ids', () => {
    expect(nextSourceId([])).toBe('s1');
    expect(nextSourceId(['s1'])).toBe('s2');
    expect(nextSourceId(['s3', 's1', 'debug', 'S9', 's2x', 'xs7', 's'])).toBe('s4');
    // A gap is never filled: an id is never reused.
    expect(nextSourceId(['s5'])).toBe('s6');
    expect(nextSourceId(['s999999999'])).toBe('s1000000000');
  });
});

describe('storedSources', () => {
  it('reads the sources of any profile version that has them', () => {
    const source: SourceRecord = { id: 's1', type: 'm3u', name: 'A', url: 'http://a.test', added: 1 };
    expect(storedSources(null)).toEqual([]);
    expect(storedSources({ doc: { v: 1, favourites: [] }, newer: false, migratedFrom: null })).toEqual([]);
    expect(storedSources({ doc: { v: 2, sources: [source] }, newer: false, migratedFrom: null })).toEqual([source]);
    expect(storedSources({ doc: { v: 9, sources: 'x' }, newer: true, migratedFrom: null })).toEqual([]);
  });
});

describe('userGuides', () => {
  it("reads the user's guide list of a profile that has one (version 4)", () => {
    const guides = [
      { id: 's1', url: 'http://g.test/a.xml' },
      { id: 'g1', url: 'http://g.test/b.xml', offsetMinutes: 60 },
    ];
    expect(userGuides(null)).toEqual([]);
    expect(userGuides({ doc: { v: 3, sources: [] }, newer: false, migratedFrom: null })).toEqual([]);
    expect(userGuides({ doc: { v: 4, guides }, newer: false, migratedFrom: null })).toEqual(guides);
    expect(userGuides({ doc: { v: 9, guides: 'x' }, newer: true, migratedFrom: null })).toEqual([]);
  });
});

describe('typedGuide', () => {
  it("is the guide link typed with a new source, under the source's id; none when none was typed or it is listed", () => {
    const listed = [{ id: 's1', url: 'http://g.test/a.xml' }];
    expect(typedGuide('s2', 'http://g.test/b.xml', listed)).toEqual({ id: 's2', url: 'http://g.test/b.xml' });
    expect(typedGuide('s2', null, listed)).toBeNull();
    expect(typedGuide('s2', 'http://g.test/a.xml', listed)).toBeNull();
    expect(typedGuide('s1', 'http://g.test/b.xml', [])).toEqual({ id: 's1', url: 'http://g.test/b.xml' });
  });
});

describe('loadError', () => {
  it("maps the ingest's codes (from the worker) to the loader's", () => {
    const rpc = (code: string, status: number | null = null): RpcError => new RpcError('failed', code, 'IngestError', status);
    for (const code of ['auth', 'expired', 'blocked', 'network', 'format', 'empty'] as const) expect(loadError(rpc(code))).toMatchObject({ code, status: null });
    expect(loadError(rpc('http', 404))).toMatchObject({ code: 'http', status: 404 });
    expect(loadError(rpc('http'))).toMatchObject({ code: 'http', status: null });
    expect(loadError(rpc('superseded'))).toMatchObject({ code: 'other' });
    expect(loadError(new CancelError())).toMatchObject({ code: 'other' });
    expect(loadError(new Error('A catalog refresh is already running'))).toMatchObject({ code: 'other' });
    expect(loadError(null)).toMatchObject({ code: 'other' });
    const own = new LoadError('empty');
    expect(loadError(own)).toBe(own);
  });
});

describe('createEngineLoader', () => {
  it('loads an Xtream source: checking, download, saving, guide; then saves it in the profile', async () => {
    const { engine, calls } = fake();
    const progress: LoadProgress[] = [];
    const result = await loaderFor(engine).start(XTREAM, (p) => progress.push(p)).done;
    expect(result).toEqual<LoadResult>({ live: 3, movies: 2, series: 1 });
    expect(progress).toEqual<LoadProgress[]>([
      { phase: 'checking', bytes: 0, total: null, items: 0 },
      { phase: 'download', bytes: 10, total: 100, items: 5 },
      { phase: 'saving', bytes: 100, total: 100, items: 6 },
      { phase: 'guide', bytes: 0, total: null, items: 6 },
      { phase: 'guide', bytes: 40, total: 80, items: 6 },
    ]);
    expect(calls.refresh).toHaveLength(1);
    expect(calls.refresh[0]!.job).toEqual({ src: 's1', source: { type: 'xtream', account: ACCOUNT } });
    expect(calls.refresh[0]!.options.lowTier).toBe(false);
    expect(calls.epg[0]!.catalogs).toEqual([{ src: 's1', type: 'xtream', account: ACCOUNT }]);
    expect(calls.epg[0]!.options).toMatchObject({ tier: 'full', due: true, languages: ['ar'], user: [{ id: 's1', url: 'http://guide.test/x.xml' }] });
    // The source, then its guide link in the guide list (profile version 4), under the source's id.
    expect(calls.edits).toEqual([
      { kind: 'source', source: { id: 's1', type: 'xtream', name: 'Home', account: ACCOUNT, added: 777 } },
      { kind: 'guide', change: { op: 'add', guide: { id: 's1', url: 'http://guide.test/x.xml' } } },
    ]);
  });

  it("takes the next free id, lists every stored source's guides and the user's, and runs at the duty cycle on a low-tier TV", async () => {
    const old: SourceRecord = { id: 's1', type: 'm3u', name: 'Old', url: 'http://o.test/l.m3u', added: 1 };
    // `s2` has a catalog but never reached the profile (a crash): its id isn't reused.
    const doc = { v: 4, sources: [old], guides: [{ id: 's1', url: 'http://o.test/g.xml' }] };
    const { engine, calls } = fake({ profile: { doc, newer: false, migratedFrom: null }, ids: ['s1', 's2'] });
    await loaderFor(engine, 'low').start(M3U, () => undefined).done;
    expect(calls.refresh[0]!.job).toEqual({ src: 's3', source: { type: 'm3u', url: 'http://p.test/l.m3u' } });
    expect(calls.refresh[0]!.options.lowTier).toBe(true);
    expect(calls.epg[0]!.catalogs).toEqual([
      { src: 's1', type: 'm3u' },
      { src: 's3', type: 'm3u' },
    ]);
    expect(calls.epg[0]!.options).toMatchObject({ tier: 'low', user: [{ id: 's1', url: 'http://o.test/g.xml' }] });
    // No guide typed: only the source.
    expect(calls.edits).toEqual([{ kind: 'source', source: { id: 's3', type: 'm3u', name: 'List', url: 'http://p.test/l.m3u', added: 777 } }]);
  });

  it("puts a typed guide after the user's guides, and one already listed in no second time", async () => {
    const doc = { v: 4, sources: [], guides: [{ id: 'g1', url: 'http://g.test/a.xml' }] };
    const { engine, calls } = fake({ profile: { doc, newer: false, migratedFrom: null } });
    await loaderFor(engine).start({ ...M3U, epgUrl: 'http://g.test/b.xml' }, () => undefined).done;
    expect(calls.epg[0]!.options.user).toEqual([
      { id: 'g1', url: 'http://g.test/a.xml' },
      { id: 's1', url: 'http://g.test/b.xml' },
    ]);
    expect(calls.edits[1]).toEqual({ kind: 'guide', change: { op: 'add', guide: { id: 's1', url: 'http://g.test/b.xml' } } });
    const again = fake({ profile: { doc, newer: false, migratedFrom: null } });
    await loaderFor(again.engine).start({ ...M3U, epgUrl: 'http://g.test/a.xml' }, () => undefined).done;
    expect(again.calls.epg[0]!.options.user).toEqual([{ id: 'g1', url: 'http://g.test/a.xml' }]);
    expect(again.calls.edits.map((e) => e.kind)).toEqual(['source']);
  });

  it("fails with the refresh's error and saves nothing", async () => {
    const { engine, calls } = fake({ refresh: () => Promise.reject(new RpcError('Catalog refresh failed: http (HTTP 404)', 'http', 'IngestError', 404)) });
    await expect(loaderFor(engine).start(M3U, () => undefined).done).rejects.toMatchObject({ name: 'LoadError', code: 'http', status: 404 });
    expect(calls.epg).toEqual([]);
    expect(calls.edits).toEqual([]);
    const expired = fake({ refresh: () => Promise.reject(new RpcError('x', 'expired', 'IngestError')) });
    await expect(loaderFor(expired.engine).start(XTREAM, () => undefined).done).rejects.toMatchObject({ code: 'expired' });
  });

  it("adds the source even when its guide can't be read, and keeps the guide (a later refresh tries it again)", async () => {
    const { engine, calls } = fake({ refreshEpg: () => Promise.reject(new RpcError('guide down', 'network', 'IngestError')) });
    await expect(loaderFor(engine).start(XTREAM, () => undefined).done).resolves.toEqual({ live: 3, movies: 2, series: 1 });
    expect(calls.edits.map((e) => e.kind)).toEqual(['source', 'guide']);
  });

  it('fails as other when the profile write fails', async () => {
    const { engine } = fake();
    engine.editProfile = () => Promise.reject(new RpcError('quota', 'QuotaExceededError', 'DOMException'));
    await expect(loaderFor(engine).start(M3U, () => undefined).done).rejects.toMatchObject({ code: 'other' });
  });

  it('cancel stops the refresh, reports nothing more and never settles; the next load waits for it to let go', async () => {
    // The first refresh's worker takes a while to stop: it rejects only when the test says.
    const first = gate<IngestResult>();
    const { engine, calls } = fake({
      refresh: (job) => (calls.refresh.length === 1 ? first.promise : Promise.resolve(ingestResult(job.src, { live: 1 }))),
    });
    const loader = loaderFor(engine);
    const progress: LoadProgress[] = [];
    const one = loader.start(M3U, (p) => progress.push(p));
    await settle();
    expect(calls.refresh).toHaveLength(1);
    const { cancel: token, onProgress } = calls.refresh[0]!.options;
    expect(token!.cancelled).toBe(false);
    one.cancel();
    expect(token!.cancelled).toBe(true);
    // A progress event already on its way from the worker is dropped.
    onProgress!({ src: 's1', phase: 'download', bytes: 1, total: null, items: 1, kind: 'live' });
    // The second load waits while the first one's refresh still holds the slot...
    const two = loader.start(M3U, () => undefined);
    await settle();
    expect(calls.refresh).toHaveLength(1);
    // ...and runs once it has stopped.
    first.reject(new CancelError());
    await expect(two.done).resolves.toEqual({ live: 1, movies: 0, series: 0 });
    expect(calls.refresh).toHaveLength(2);
    expect(await settled(one.done)).toBe(false);
    expect(progress).toEqual([{ phase: 'checking', bytes: 0, total: null, items: 0 }]);
    expect(calls.epg).toHaveLength(1);
    expect(calls.edits).toHaveLength(1);
  });

  it('a guide that finishes just as the load is cancelled saves nothing', async () => {
    const guide = gate<unknown>();
    const { engine, calls } = fake({ refreshEpg: () => guide.promise });
    const handle = loaderFor(engine).start(XTREAM, () => undefined);
    await settle();
    expect(calls.epg).toHaveLength(1);
    handle.cancel();
    guide.resolve({ outcomes: [], deleted: [], reranked: [], wanted: 0 });
    expect(await settled(handle.done)).toBe(false);
    expect(calls.edits).toEqual([]);
  });

  it('a cancel during the guide stops it too, and the source is not saved', async () => {
    const guide = gate<unknown>();
    const { engine, calls } = fake({
      refreshEpg: (_catalogs, opts) => {
        opts.cancel?.onCancel(() => guide.reject(new CancelError()));
        return guide.promise;
      },
    });
    const handle = loaderFor(engine).start(XTREAM, () => undefined);
    await settle();
    expect(calls.epg).toHaveLength(1);
    handle.cancel();
    expect(await settled(handle.done)).toBe(false);
    expect(calls.edits).toEqual([]);
  });

  it('a load cancelled before it starts never reaches the engine', async () => {
    const busy = gate<IngestResult>();
    const { engine, calls } = fake({ refresh: () => busy.promise });
    const loader = loaderFor(engine);
    loader.start(M3U, () => undefined);
    await settle();
    const queued = loader.start(M3U, () => undefined);
    queued.cancel();
    busy.resolve(ingestResult('s1', { live: 1 }));
    await settle();
    expect(calls.refresh).toHaveLength(1);
    // Not even the profile is read for it.
    expect(calls.profile).toBe(1);
    expect(await settled(queued.done)).toBe(false);
  });
});
