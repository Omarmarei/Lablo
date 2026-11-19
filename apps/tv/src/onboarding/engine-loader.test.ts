import type { EpgCatalogSource, IngestResult, IngestSource, LoadedProfile, ProfileEdit, SourceRecord, StoredSource } from '@lablo/data';
import type { FileFeed } from '@lablo/data/client';
import { CancelError, RpcError } from '@lablo/data/client';
import { describe, expect, it } from 'vitest';
import type { EpgRefreshOptions, RefreshOptions } from '../data/engine';
import { BlockedSourceError } from '../data/engine';
import type { LoaderEngine } from './engine-loader';
import {
  SLOT_WAIT_MS,
  catalogOf,
  createEngineLoader,
  freshGuides,
  ingestSourceOf,
  loadError,
  nextGuideId,
  nextSourceId,
  sameFile,
  storedGuideIds,
  storedSources,
  typedGuides,
  userGuides,
} from './engine-loader';
import type { SourceDraft } from './form';
import type { LoadProgress, LoadResult } from './loader';
import { LoadError } from './loader';

const ACCOUNT = { base: 'http://panel.test', username: 'u', password: 'p' };
const XTREAM: SourceDraft = { type: 'xtream', name: 'Home', account: ACCOUNT, epgUrls: ['http://guide.test/x.xml'] };
const M3U: SourceDraft = { type: 'm3u', name: 'List', url: 'http://p.test/l.m3u', epgUrls: [] };
const FEED: FileFeed = { port: { postMessage: () => undefined, onmessage: null } as unknown as FileFeed['port'], size: 2048 };
/** A file draft from the phone (step 31d2b1) whose fetch is counted and answers `answer`. */
function fileDraft(name: string, epgUrls: readonly string[] = [], answer: () => Promise<FileFeed> = () => Promise.resolve(FEED)) {
  const asked = { n: 0 };
  const draft: SourceDraft = {
    type: 'm3u-file',
    name,
    epgUrls,
    file: () => {
      asked.n += 1;
      return answer();
    },
  };
  return { draft, asked };
}

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
  /** The stored guides' sources (`u~<id>`, `<src>:xmltv`…). */
  stored?: string[];
}

function fake(options: FakeOptions = {}) {
  const calls = {
    refresh: [] as Array<{ job: { src: string; source: IngestSource }; options: RefreshOptions }>,
    epg: [] as Array<{ catalogs: readonly EpgCatalogSource[]; options: EpgRefreshOptions }>,
    edits: [] as ProfileEdit[],
    profile: 0,
    epgStatus: 0,
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
    epgStatus: () => {
      calls.epgStatus += 1;
      return Promise.resolve({ guides: (options.stored ?? []).map((epgSrc) => ({ epgSrc })) });
    },
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

describe('typedGuides', () => {
  it("is the guide links given with a new source, named after the source; none when none was given or each is listed", () => {
    const listed = [{ id: 's1', url: 'http://g.test/a.xml' }];
    expect(typedGuides('s2', ['http://g.test/b.xml'], listed)).toEqual([{ id: 's2', url: 'http://g.test/b.xml' }]);
    expect(typedGuides('s2', [], listed)).toEqual([]);
    expect(typedGuides('s2', ['http://g.test/a.xml'], listed)).toEqual([]);
    expect(typedGuides('s1', ['http://g.test/b.xml'], [])).toEqual([{ id: 's1', url: 'http://g.test/b.xml' }]);
  });

  it('names the second to fourth by their place, and leaves out a listed link and one given twice (step 31c2a)', () => {
    const listed = [{ id: 'g1', url: 'http://g.test/a.xml' }];
    const urls = ['http://g.test/b.xml', 'http://g.test/c.xml', 'http://g.test/d.xml', 'http://g.test/e.xml'];
    expect(typedGuides('s7', urls, listed)).toEqual([
      { id: 's7', url: 'http://g.test/b.xml' },
      { id: 's7-2', url: 'http://g.test/c.xml' },
      { id: 's7-3', url: 'http://g.test/d.xml' },
      { id: 's7-4', url: 'http://g.test/e.xml' },
    ]);
    // The place names the guide: a first link already listed leaves `s7` unused.
    expect(typedGuides('s7', ['http://g.test/a.xml', 'http://g.test/c.xml', 'http://g.test/c.xml', 'http://g.test/e.xml'], listed)).toEqual([
      { id: 's7-2', url: 'http://g.test/c.xml' },
      { id: 's7-4', url: 'http://g.test/e.xml' },
    ]);
  });
});

describe('nextGuideId', () => {
  it('is one past the highest g<n> taken, ignoring other ids', () => {
    expect(nextGuideId([])).toBe('g1');
    expect(nextGuideId(['s1', 's7', 'g', 'gx', 'g2b', 'xg9'])).toBe('g1');
    expect(nextGuideId(['g3', 's1', 'g1'])).toBe('g4');
  });
});

describe('a source without its login, stored (step 32d4a)', () => {
  it('gives what it kept to the refresh (which the data engine refuses), and no panel guide', () => {
    const panel: StoredSource = { id: 's1', type: 'xtream', name: 'A', account: null, base: 'http://panel.test:8080', added: 1 };
    const link: StoredSource = { id: 's2', type: 'm3u', name: 'B', url: null, origin: 'http://lists.test', added: 2 };
    expect(ingestSourceOf(panel)).toEqual({ type: 'xtream', account: null, base: 'http://panel.test:8080' });
    expect(ingestSourceOf(link)).toEqual({ type: 'm3u', url: null, origin: 'http://lists.test' });
    expect(catalogOf(panel)).toEqual({ src: 's1', type: 'xtream', account: null });
    expect(catalogOf(link)).toEqual({ src: 's2', type: 'm3u' });
    const doc = { v: 9, sources: [panel, link], guides: [{ id: 'g1', url: null, origin: 'http://g.test' }] };
    expect(storedSources({ doc, newer: false, migratedFrom: null })).toEqual([panel, link]);
    expect(userGuides({ doc, newer: false, migratedFrom: null })).toEqual([{ id: 'g1', url: null, origin: 'http://g.test' }]);
  });
});

describe('a file from the phone, stored (step 31d2b1)', () => {
  const file: SourceRecord = { id: 's4', type: 'm3u-file', name: 'Kitchen', added: 3 };

  it('has no link to refresh, and its guides are a playlist\'s (its header names them)', () => {
    expect(ingestSourceOf(file)).toBeNull();
    expect(ingestSourceOf({ id: 's1', type: 'm3u', name: 'A', url: 'http://a.test/l.m3u', added: 1 })).toEqual({ type: 'm3u', url: 'http://a.test/l.m3u' });
    expect(ingestSourceOf({ id: 's2', type: 'xtream', name: 'B', account: ACCOUNT, added: 1 })).toEqual({ type: 'xtream', account: ACCOUNT });
    expect(catalogOf(file)).toEqual({ src: 's4', type: 'm3u' });
  });

  it('is found by its exact name among the file sources only', () => {
    const link: SourceRecord = { id: 's1', type: 'm3u', name: 'Kitchen', url: 'http://a.test/l.m3u', added: 1 };
    const other: SourceRecord = { id: 's2', type: 'm3u-file', name: 'Den', added: 2 };
    expect(sameFile([link, other, file], 'Kitchen')).toBe(file);
    expect(sameFile([link, other], 'Kitchen')).toBeNull();
    expect(sameFile([file], 'kitchen')).toBeNull();
    expect(sameFile([], 'Kitchen')).toBeNull();
  });

  it("names a file's new guide links past every listed and stored id, and leaves out a listed link or one given twice", () => {
    const listed = [
      { id: 's4', url: 'http://g.test/a.xml' },
      { id: 'g2', url: 'http://g.test/b.xml' },
    ];
    expect(freshGuides(['http://g.test/a.xml', 'http://g.test/c.xml', 'http://g.test/c.xml', 'http://g.test/d.xml'], listed, ['g5'])).toEqual([
      { id: 'g6', url: 'http://g.test/c.xml' },
      { id: 'g7', url: 'http://g.test/d.xml' },
    ]);
    expect(freshGuides(['http://g.test/c.xml'], listed, [])).toEqual([{ id: 'g3', url: 'http://g.test/c.xml' }]);
    expect(freshGuides(['http://g.test/b.xml'], listed, [])).toEqual([]);
    expect(storedGuideIds([{ epgSrc: 'u~g5' }, { epgSrc: 's1:xmltv' }, { epgSrc: 'u~s4-2' }, { epgSrc: 'xu~g9' }])).toEqual(['g5', 's4-2']);
  });
});

describe('loadError', () => {
  it("maps the ingest's codes (from the worker) to the loader's", () => {
    const rpc = (code: string, status: number | null = null): RpcError => new RpcError('failed', code, 'IngestError', status);
    for (const code of ['auth', 'expired', 'blocked', 'blocklisted', 'network', 'format', 'empty', 'file'] as const) expect(loadError(rpc(code))).toMatchObject({ code, status: null });
    // The data engine's own refusal (step 30c3a): not an RpcError, the same code.
    expect(loadError(new BlockedSourceError())).toMatchObject({ name: 'LoadError', code: 'blocklisted', status: null });
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
    await loaderFor(engine).start({ ...M3U, epgUrls: ['http://g.test/b.xml'] }, () => undefined).done;
    expect(calls.epg[0]!.options.user).toEqual([
      { id: 'g1', url: 'http://g.test/a.xml' },
      { id: 's1', url: 'http://g.test/b.xml' },
    ]);
    expect(calls.edits[1]).toEqual({ kind: 'guide', change: { op: 'add', guide: { id: 's1', url: 'http://g.test/b.xml' } } });
    const again = fake({ profile: { doc, newer: false, migratedFrom: null } });
    await loaderFor(again.engine).start({ ...M3U, epgUrls: ['http://g.test/a.xml'] }, () => undefined).done;
    expect(again.calls.epg[0]!.options.user).toEqual([{ id: 'g1', url: 'http://g.test/a.xml' }]);
    expect(again.calls.edits.map((e) => e.kind)).toEqual(['source']);
  });

  it('lists and keeps every guide link a source came with, in their order (step 31c2a)', async () => {
    const doc = { v: 4, sources: [], guides: [{ id: 'g1', url: 'http://g.test/a.xml' }] };
    const { engine, calls } = fake({ profile: { doc, newer: false, migratedFrom: null } });
    await loaderFor(engine).start({ ...M3U, epgUrls: ['http://g.test/b.xml', 'http://g.test/a.xml', 'http://g.test/c.xml'] }, () => undefined).done;
    expect(calls.epg[0]!.options.user).toEqual([
      { id: 'g1', url: 'http://g.test/a.xml' },
      { id: 's1', url: 'http://g.test/b.xml' },
      { id: 's1-3', url: 'http://g.test/c.xml' },
    ]);
    expect(calls.edits).toEqual([
      { kind: 'source', source: { id: 's1', type: 'm3u', name: 'List', url: 'http://p.test/l.m3u', added: 777 } },
      { kind: 'guide', change: { op: 'add', guide: { id: 's1', url: 'http://g.test/b.xml' } } },
      { kind: 'guide', change: { op: 'add', guide: { id: 's1-3', url: 'http://g.test/c.xml' } } },
    ]);
  });

  it('waits while another refresh holds the slot, before the catalog and before the guides (step 31c2a)', async () => {
    const { engine, calls } = fake();
    const held = { on: true };
    const waits: number[] = [];
    const slotted: LoaderEngine = {
      get refreshing() {
        return held.on;
      },
      refresh: (job, opts) => {
        // Taken: the background refresh comes back for the guides.
        held.on = true;
        return engine.refresh(job, opts);
      },
      refreshEpg: (catalogs, opts) => engine.refreshEpg(catalogs, opts),
      sourceIds: () => engine.sourceIds(),
      epgStatus: () => engine.epgStatus(),
      profile: () => engine.profile(),
      editProfile: (edit) => engine.editProfile(edit),
    };
    const sleep = (ms: number): Promise<void> => {
      waits.push(ms);
      // Free after three looks before the catalog, and after one before the guides.
      if (waits.length === 3 || waits.length === 4) held.on = false;
      return Promise.resolve();
    };
    const loader = createEngineLoader({ engine: slotted, tier: () => Promise.resolve('full'), languages: () => [], now: () => 1, sleep });
    await loader.start(M3U, () => undefined).done;
    expect(SLOT_WAIT_MS).toBe(500);
    expect(waits).toEqual([SLOT_WAIT_MS, SLOT_WAIT_MS, SLOT_WAIT_MS, SLOT_WAIT_MS]);
    expect(calls.refresh).toHaveLength(1);
    expect(calls.epg).toHaveLength(1);
  });

  it('asks nothing of a slot never freed once cancelled, and asks for no refresh', async () => {
    const { engine, calls } = fake();
    const slotted: LoaderEngine = { ...engine, refreshing: true };
    let wake: () => void = () => undefined;
    let sleeps = 0;
    const sleep = (): Promise<void> =>
      new Promise<void>((resolve) => {
        sleeps += 1;
        wake = resolve;
      });
    const loader = createEngineLoader({ engine: slotted, tier: () => Promise.resolve('full'), languages: () => [], now: () => 1, sleep });
    const handle = loader.start(M3U, () => undefined);
    await settle();
    handle.cancel();
    wake();
    expect(await settled(handle.done)).toBe(false);
    await settle();
    // The wait ends with the cancel: no further sleep for a slot nobody wants.
    expect(sleeps).toBe(1);
    expect(calls.refresh).toEqual([]);
    expect(calls.edits).toEqual([]);
  });

  it("loads the phone's file (step 31d2b1): its feed asked for once the slot is free, given to the refresh, kept as a source with no link", async () => {
    const order: string[] = [];
    const { engine, calls } = fake({ ids: ['s1'] });
    const asking = { slotLooks: 0 };
    const slotted: LoaderEngine = {
      ...engine,
      get refreshing() {
        asking.slotLooks += 1;
        order.push('slot');
        return false;
      },
      refresh: (job, opts) => {
        order.push('refresh');
        return engine.refresh(job, opts);
      },
    };
    const { draft, asked } = fileDraft('Kitchen', ['http://g.test/k.xml'], () => {
      order.push('file');
      return Promise.resolve(FEED);
    });
    const progress: LoadProgress[] = [];
    const result = await loaderFor(slotted).start(draft, (p) => progress.push(p)).done;
    expect(result).toEqual<LoadResult>({ live: 3, movies: 2, series: 1 });
    expect(asked.n).toBe(1);
    // The slot, the file, the slot again, the refresh at once; then the slot for the guides.
    expect(order).toEqual(['slot', 'file', 'slot', 'refresh', 'slot']);
    expect(calls.refresh[0]!.job).toEqual({ src: 's2', source: { type: 'm3u-file' } });
    expect(calls.refresh[0]!.options.file).toBe(FEED);
    expect(calls.epg[0]!.catalogs).toEqual([{ src: 's2', type: 'm3u' }]);
    expect(progress.map((p) => p.phase)).toEqual(['checking', 'download', 'saving', 'guide', 'guide']);
    // A new file: a new source, its guide link named after it; no stored guides asked for.
    expect(calls.epgStatus).toBe(0);
    expect(calls.edits).toEqual([
      { kind: 'source', source: { id: 's2', type: 'm3u-file', name: 'Kitchen', added: 777 } },
      { kind: 'guide', change: { op: 'add', guide: { id: 's2', url: 'http://g.test/k.xml' } } },
    ]);
  });

  it('gives a link or a login no file, and asks the file of a file draft only', async () => {
    const { engine, calls } = fake();
    await loaderFor(engine).start(M3U, () => undefined).done;
    expect('file' in calls.refresh[0]!.options).toBe(false);
  });

  it("waits for the slot again after the file's feed when a refresh took it meanwhile", async () => {
    const { engine, calls } = fake();
    const held = { on: false };
    const waits: number[] = [];
    const slotted: LoaderEngine = {
      ...engine,
      get refreshing() {
        return held.on;
      },
    };
    const { draft } = fileDraft('Kitchen', [], () => {
      // A background refresh starts while the file's requests run.
      held.on = true;
      return Promise.resolve(FEED);
    });
    const sleep = (ms: number): Promise<void> => {
      waits.push(ms);
      expect(calls.refresh).toEqual([]);
      if (waits.length === 2) held.on = false;
      return Promise.resolve();
    };
    const loader = createEngineLoader({ engine: slotted, tier: () => Promise.resolve('full'), languages: () => [], now: () => 1, sleep });
    await loader.start(draft, () => undefined).done;
    expect(waits).toEqual([SLOT_WAIT_MS, SLOT_WAIT_MS]);
    expect(calls.refresh).toHaveLength(1);
  });

  it("fails with the file's own error when its feed can't be had, asking for no refresh and saving nothing", async () => {
    for (const code of ['file', 'network'] as const) {
      const { engine, calls } = fake();
      const { draft } = fileDraft('Kitchen', [], () => Promise.reject(new LoadError(code)));
      await expect(loaderFor(engine).start(draft, () => undefined).done).rejects.toMatchObject({ name: 'LoadError', code });
      expect(calls.refresh).toEqual([]);
      expect(calls.epg).toEqual([]);
      expect(calls.edits).toEqual([]);
    }
  });

  it("fails as file when the ingest can't open a frame of it", async () => {
    const { engine, calls } = fake({ refresh: () => Promise.reject(new RpcError('Catalog refresh failed: file', 'file', 'IngestError')) });
    await expect(loaderFor(engine).start(fileDraft('Kitchen').draft, () => undefined).done).rejects.toMatchObject({ name: 'LoadError', code: 'file' });
    expect(calls.edits).toEqual([]);
  });

  it('asks for no refresh when the load is cancelled while the file is fetched', async () => {
    const { engine, calls } = fake();
    const answer = gate<FileFeed>();
    const { draft, asked } = fileDraft('Kitchen', [], () => answer.promise);
    const handle = loaderFor(engine).start(draft, () => undefined);
    await settle();
    expect(asked.n).toBe(1);
    handle.cancel();
    answer.resolve(FEED);
    expect(await settled(handle.done)).toBe(false);
    expect(calls.refresh).toEqual([]);
    expect(calls.edits).toEqual([]);
  });

  it("replaces a file sent again under a stored file source's name: its id and when it was added kept, its new guide links as g<n>", async () => {
    const kept: SourceRecord = { id: 's2', type: 'm3u-file', name: 'Kitchen', added: 5 };
    const link: SourceRecord = { id: 's1', type: 'm3u', name: 'Den', url: 'http://p.test/l.m3u', added: 1 };
    const guides = [
      { id: 's2', url: 'http://g.test/k.xml' },
      { id: 'g1', url: 'http://g.test/x.xml' },
    ];
    const doc = { v: 8, sources: [link, kept], guides };
    // `u~g3` is a removed guide whose records are still stored: its id isn't given again.
    const { engine, calls } = fake({ profile: { doc, newer: false, migratedFrom: null }, ids: ['s1', 's2', 's3'], stored: ['u~s2', 'u~g1', 'u~g3', 's1:xmltv'] });
    const { draft } = fileDraft('Kitchen', ['http://g.test/k.xml', 'http://g.test/new.xml']);
    await loaderFor(engine).start(draft, () => undefined).done;
    expect(calls.epgStatus).toBe(1);
    expect(calls.refresh[0]!.job).toEqual({ src: 's2', source: { type: 'm3u-file' } });
    // The source list keeps one entry for it: the stored one replaced, not a second.
    expect(calls.epg[0]!.catalogs).toEqual([
      { src: 's1', type: 'm3u' },
      { src: 's2', type: 'm3u' },
    ]);
    expect(calls.epg[0]!.options.user).toEqual(guides.concat([{ id: 'g4', url: 'http://g.test/new.xml' }]));
    expect(calls.edits).toEqual([
      { kind: 'source', source: { id: 's2', type: 'm3u-file', name: 'Kitchen', added: 5 } },
      { kind: 'guide', change: { op: 'add', guide: { id: 'g4', url: 'http://g.test/new.xml' } } },
    ]);
  });

  it("fetches no file when the load is cancelled while a file sent again reads the stored guides", async () => {
    const doc = { v: 8, sources: [{ id: 's2', type: 'm3u-file', name: 'Kitchen', added: 5 }], guides: [] };
    const { engine, calls } = fake({ profile: { doc, newer: false, migratedFrom: null } });
    const status = gate<{ guides: { epgSrc: string }[] }>();
    engine.epgStatus = () => status.promise;
    const { draft, asked } = fileDraft('Kitchen');
    const handle = loaderFor(engine).start(draft, () => undefined);
    await settle();
    handle.cancel();
    status.resolve({ guides: [] });
    expect(await settled(handle.done)).toBe(false);
    expect(asked.n).toBe(0);
    expect(calls.refresh).toEqual([]);
  });

  it("adds a file under a new id when its name is another file's, or a link's", async () => {
    const doc = {
      v: 8,
      sources: [
        { id: 's1', type: 'm3u', name: 'Kitchen', url: 'http://p.test/l.m3u', added: 1 },
        { id: 's2', type: 'm3u-file', name: 'Den', added: 2 },
      ],
      guides: [],
    };
    const { engine, calls } = fake({ profile: { doc, newer: false, migratedFrom: null }, ids: ['s1', 's2'] });
    await loaderFor(engine).start(fileDraft('Kitchen', ['http://g.test/k.xml']).draft, () => undefined).done;
    expect(calls.refresh[0]!.job.src).toBe('s3');
    expect(calls.epgStatus).toBe(0);
    expect(calls.edits).toEqual([
      { kind: 'source', source: { id: 's3', type: 'm3u-file', name: 'Kitchen', added: 777 } },
      { kind: 'guide', change: { op: 'add', guide: { id: 's3', url: 'http://g.test/k.xml' } } },
    ]);
  });

  it("fails with the refresh's error and saves nothing", async () => {
    const { engine, calls } = fake({ refresh: () => Promise.reject(new RpcError('Catalog refresh failed: http (HTTP 404)', 'http', 'IngestError', 404)) });
    await expect(loaderFor(engine).start(M3U, () => undefined).done).rejects.toMatchObject({ name: 'LoadError', code: 'http', status: 404 });
    expect(calls.epg).toEqual([]);
    expect(calls.edits).toEqual([]);
    const expired = fake({ refresh: () => Promise.reject(new RpcError('x', 'expired', 'IngestError')) });
    await expect(loaderFor(expired.engine).start(XTREAM, () => undefined).done).rejects.toMatchObject({ code: 'expired' });
  });

  it('fails as blocklisted when the data engine refuses the source, after checking, and saves nothing (step 30c3a)', async () => {
    const { engine, calls } = fake({ refresh: () => Promise.reject(new BlockedSourceError()) });
    const phases: string[] = [];
    await expect(loaderFor(engine).start(XTREAM, (p) => phases.push(p.phase)).done).rejects.toMatchObject({ name: 'LoadError', code: 'blocklisted' });
    expect(phases).toEqual(['checking']);
    expect(calls.refresh).toHaveLength(1);
    expect(calls.epg).toEqual([]);
    expect(calls.edits).toEqual([]);
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
