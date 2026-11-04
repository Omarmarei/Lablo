import type { EpgRefreshResult, IngestResult, LoadedProfile } from '@zoma/data';
import { describe, expect, it } from 'vitest';
import type { LiveStage, PressTiming } from '../live-stage';
import { S6_PRESSES, S6_SOURCE_ID } from '../scale';
import type { Check, CheckResult, LabContext } from '../types';
import type { S6Deps, S6Engine } from './s6';
import { createS6 } from './s6';

/** The small source the mock hands out by default, and the scale one. */
const SMALL = { m3u: 'http://lab:8080/get.php?username=u&password=p&type=m3u_plus', items: 25, live: 12, guide: { url: 'http://lab:8080/__lab/guide.xml.gz?days=2', static: false, bytes: 393_087, gzBytes: 21_751, shiftDays: 2 } };
const SCALE = { ...SMALL, items: 200_000, live: 20_000, guide: { ...SMALL.guide, static: true, bytes: 148_344_801, gzBytes: 10_506_487 } };

const profileOf = (ids: string[]): LoadedProfile => ({ doc: { v: 2, favourites: [], sources: ids.map((id) => ({ id, type: 'm3u', name: id, url: 'http://x', epgUrl: null, added: 0 })), onboarding: { language: null, disclaimerAt: null, consent: null } } }) as unknown as LoadedProfile;

function ingestResult(items: number): IngestResult {
  return { src: S6_SOURCE_ID, status: 'committed', gen: 1, previous: 0, counts: { live: items }, fetch: { v: 1, hash: 'h', bytes: 1000, etag: null, lastModified: null }, gzipped: false, elapsedMs: 1, m3u: null, xtream: null, favourites: null, favouritesError: null, throttle: { checkpoints: 1, busyMs: 0, sleptMs: 0 } } as unknown as IngestResult;
}

function epgResult(kept: number): EpgRefreshResult {
  return {
    outcomes: [{ epgSrc: 'u~lab-s6', error: null, result: { epgSrc: 'u~lab-s6', status: 'committed', gen: 1, previous: 0, summary: { wanted: 12, matched: 11, byMethod: {}, ambiguous: 0, declared: 12, used: 11, programmes: kept, kept, buckets: 3, pastDays: 1, futureDays: 2 }, fetch: null, gzipped: true, elapsedMs: 1, throttle: { checkpoints: 0, busyMs: 0, sleptMs: 0 } } }],
    deleted: [],
    wanted: 12,
  } as unknown as EpgRefreshResult;
}

interface Fake {
  readonly deps: S6Deps;
  readonly calls: string[];
  /** Advances the fake clock. */
  tick(ms: number): void;
  engines: number;
}

/**
 * A fake engine, stage and clock. `ingestMs` and `guideMs` pass on the clock during those
 * calls; `pressMs` is each press's time (`null`: never drawn).
 */
function fake(options: { source?: unknown; ids?: string[]; profileIds?: string[]; items?: number; ingestMs?: number; guideMs?: number; pressMs?: number | null; kept?: number; refreshFails?: boolean; refreshEnds?: boolean } = {}): Fake {
  let clock = 0;
  const calls: string[] = [];
  const state = { engines: 0, stored: options.profileIds ?? [] };
  const engine = (): S6Engine => {
    state.engines += 1;
    let refreshes = 0;
    return {
      start: () => {
        calls.push('start');
        return Promise.resolve(0);
      },
      sourceIds: () => Promise.resolve(options.ids ?? []),
      profile: () => Promise.resolve(state.stored.length === 0 ? null : profileOf(state.stored)),
      editProfile: (edit) => {
        calls.push(`edit ${edit.kind}`);
        if (edit.kind === 'source') state.stored = [edit.source.id];
        return Promise.resolve(true);
      },
      refresh: (job, refresh) => {
        refreshes += 1;
        calls.push(`refresh ${job.src} force=${String(job.force)} cancel=${String(refresh?.cancel !== undefined)}`);
        refresh?.onProgress?.({ src: job.src, phase: 'download', bytes: 10, total: null, items: 5, kind: null });
        if (refreshes === 1) {
          clock += options.ingestMs ?? 1000;
          return Promise.resolve(ingestResult(options.items ?? 25));
        }
        // The second refresh (during the presses) runs until it is cancelled.
        return new Promise((resolve, reject) => {
          if (options.refreshFails) {
            reject(new Error('the network went away'));
            return;
          }
          if (options.refreshEnds) {
            resolve(ingestResult(options.items ?? 25));
            return;
          }
          refresh?.cancel?.onCancel(() => reject(new Error('cancelled')));
        });
      },
      refreshEpg: (catalogs, epg) => {
        calls.push(`refreshEpg ${catalogs.length} ${epg.user?.map((u) => u.id).join(',') ?? ''} force=${String(epg.force)}`);
        clock += options.guideMs ?? 2000;
        return Promise.resolve(epgResult(options.kept ?? 1360));
      },
      search: (query) => Promise.resolve({ query, total: query === 'night' ? 0 : 3, names: [], keys: [], live: [] }),
      summary: () => Promise.resolve({ sources: 1, items: 25, stale: 0 }),
      categories: () => Promise.resolve([]),
      chunk: () => Promise.resolve([]),
      nowNext: () => Promise.resolve([]),
      focusChannel: () => Promise.resolve(null),
      noteActivity: () => undefined,
      dispose: () => calls.push('dispose'),
    };
  };
  const stage = (): LiveStage => {
    calls.push('mount');
    return {
      live: {} as LiveStage['live'],
      painted: () => {
        clock += 40;
        return Promise.resolve(40);
      },
      idle: () => Promise.resolve(640),
      press: (intent): Promise<PressTiming> => Promise.resolve({ intent, path: 'live/channels/1', ms: options.pressMs === undefined ? 12 : options.pressMs }),
      close: () => calls.push('close'),
    };
  };
  const deps: S6Deps = {
    createEngine: engine,
    mountStage: stage,
    getJson: (url) => {
      calls.push(`get ${url.replace(/around=\d+/, 'around=T')}`);
      return Promise.resolve(options.source === undefined ? SMALL : options.source);
    },
    indexedDB: () =>
      ({
        deleteDatabase: (name: string) => {
          calls.push(`delete ${name}`);
          const req: { onsuccess: (() => void) | null; onerror: null } = { onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      }) as unknown as IDBFactory,
    now: () => clock,
    sleep: () => Promise.resolve(),
  };
  return {
    deps,
    calls,
    tick: (ms) => {
      clock += ms;
    },
    get engines() {
      return state.engines;
    },
  };
}

const CONTEXT = { server: 'http://lab:8080', info: { tier: 'full' }, platform: {}, bootMs: 900 } as unknown as LabContext;

async function runAll(f: Fake, context = CONTEXT): Promise<Record<string, CheckResult>> {
  const out: Record<string, CheckResult> = {};
  for (const check of createS6(f.deps).checks as Check[]) out[check.id] = await check.run(context);
  return out;
}

const statuses = (results: Record<string, CheckResult>): string[] => Object.keys(results).map((k) => `${k}:${results[k]!.status}`);

describe('S6 (RELAY step 15b) on a fake data engine', () => {
  it('measures everything against a small source and judges nothing', async () => {
    const f = fake();
    const results = await runAll(f);
    expect(statuses(results)).toEqual(['source:info', 'ingest:info', 'search:info', 'keys:info', 'guide:info', 'cold-start:info', 'cleanup:info']);
    expect(results.source!.note).toMatch(/^25 playlist entries, a 0\.4 MB guide moved 2 days: not the scale fixtures/);
    // The records never carry the URLs (the test account).
    expect(JSON.stringify(results)).not.toMatch(/password|get\.php|guide\.xml/);
    expect(results.ingest!.value).toMatchObject({ ms: 1000, items: 25, expected: 25, lowTier: false, progressEvents: 1 });
    expect(results.search!.value).toMatchObject({ count: 6 });
    expect(results.keys!.value).toMatchObject({ count: S6_PRESSES.length, during: S6_PRESSES.length, refresh: { ended: 'cancelled', itemsAtStart: 5 } });
    expect(results.guide!.value).toMatchObject({ ms: 2000, wanted: 12, matched: 11, kept: 1360, gzipped: true });
    expect(results['cold-start']!.value).toEqual({ bootMs: 900, dataMs: 40, totalMs: 940, idleMs: 640, start: 'home' });
    expect(results.cleanup!.note).toBe('deleted "zoma"');
    expect(f.calls).toEqual([
      'get http://lab:8080/__lab/source?around=T',
      'start',
      'edit source',
      `refresh ${S6_SOURCE_ID} force=true cancel=false`,
      'mount',
      `refresh ${S6_SOURCE_ID} force=true cancel=true`,
      'close',
      'refreshEpg 0 lab-s6 force=true',
      // The cold start: the first engine stops, a fresh one starts the live screen.
      'dispose',
      'mount',
      'close',
      'dispose',
      'delete zoma',
    ]);
    expect(f.engines).toBe(2);
  });

  it('passes at scale when every criterion is met, and fails each one that is not', async () => {
    expect(statuses(await runAll(fake({ source: SCALE, items: 200_000, ingestMs: 90_000, guideMs: 240_000, pressMs: 199 })))).toEqual([
      'source:pass',
      'ingest:pass',
      'search:pass',
      'keys:pass',
      'guide:pass',
      'cold-start:pass',
      'cleanup:info',
    ]);
    const slow = await runAll(fake({ source: SCALE, items: 200_000, ingestMs: 90_001, guideMs: 240_001, pressMs: 200 }), { ...CONTEXT, bootMs: 2961 });
    expect(statuses(slow)).toEqual(['source:pass', 'ingest:fail', 'search:pass', 'keys:fail', 'guide:fail', 'cold-start:fail', 'cleanup:info']);
    expect(slow['cold-start']!.note).toMatch(/^3\.0 s: boot 3\.0 s, data to painted rows 40 ms/);
  });

  it('fails the presses at scale when the refresh was over before they were', async () => {
    const results = await runAll(fake({ source: SCALE, items: 200_000, refreshEnds: true }));
    expect(results.keys!.status).toBe('fail');
    expect(results.keys!.value).toMatchObject({ refresh: { ended: 'finished' } });
    expect((results.keys!.value as { during: number }).during).toBeLessThan(S6_PRESSES.length);
  });

  it('judges the guide on its own: the scale guide with a small catalog', async () => {
    const results = await runAll(fake({ source: { ...SMALL, guide: SCALE.guide } }));
    expect(statuses(results).slice(0, 5)).toEqual(['source:info', 'ingest:info', 'search:info', 'keys:info', 'guide:pass']);
  });

  it('skips the whole spike, and deletes nothing, where the app keeps its own data', async () => {
    for (const f of [fake({ ids: ['m3u-1'] }), fake({ profileIds: ['xt-2'] })]) {
      const results = await runAll(f);
      expect(statuses(results)).toEqual(['source:skip', 'ingest:skip', 'search:skip', 'keys:skip', 'guide:skip', 'cold-start:skip', 'cleanup:skip']);
      expect(results.cleanup!.note).toMatch(/^this origin holds the app's own data \(1 source\): S6 would overwrite it/);
      expect(f.calls.some((c) => c.startsWith('delete') || c.startsWith('refresh') || c.startsWith('edit'))).toBe(false);
    }
    // Its own source from an aborted run is no reason to stop.
    expect(statuses(await runAll(fake({ ids: [S6_SOURCE_ID], profileIds: [S6_SOURCE_ID] })))[0]).toBe('source:info');
  });

  it('fails a bad source answer, and the rest needs it', async () => {
    const f = fake({ source: { m3u: 'nope' } });
    const results = await runAll(f);
    expect(statuses(results)).toEqual(['source:fail', 'ingest:skip', 'search:skip', 'keys:skip', 'guide:skip', 'cold-start:skip', 'cleanup:skip']);
    expect(results.ingest!.note).toBe('needs the source (the first check)');
    expect(results.cleanup!.note).toBe('nothing of S6 to delete');
  });

  it('fails a crashed ingest, an empty one, a press never drawn, a failed refresh and a guide that kept nothing', async () => {
    const empty = await runAll(fake({ source: SCALE, items: 0 }));
    expect(statuses(empty).slice(1, 3)).toEqual(['ingest:fail', 'search:skip']);
    expect(empty.search!.note).toBe('needs the ingest');

    const crashed = fake();
    crashed.deps.createEngine = ((create) => () => ({ ...create(), refresh: () => Promise.reject(new Error('Ingest worker failed: out of memory')) }))(crashed.deps.createEngine);
    const results = await runAll(crashed);
    expect(results.ingest).toMatchObject({ status: 'fail', note: 'the ingest failed: Ingest worker failed: out of memory' });

    const missed = await runAll(fake({ pressMs: null }));
    expect(missed.keys).toMatchObject({ status: 'fail', note: `the focus never showed for ${S6_PRESSES.length} presses: DOWN to live/channels/1` });

    const failing = await runAll(fake({ refreshFails: true }));
    expect(failing.keys).toMatchObject({ status: 'fail', note: 'the refresh failed: the network went away' });
    expect(failing.keys!.value).toMatchObject({ refresh: { ended: 'failed', error: 'the network went away' } });

    expect((await runAll(fake({ kept: 0 }))).guide).toMatchObject({ status: 'fail', note: 'the guide kept no programme' });
  });

  it('fails a cold start that would open onboarding', async () => {
    const f = fake();
    f.deps.createEngine = ((create) => {
      let n = 0;
      return () => {
        n += 1;
        const engine = create();
        return n === 1 ? engine : { ...engine, profile: () => Promise.resolve(null) };
      };
    })(f.deps.createEngine);
    expect((await runAll(f))['cold-start']).toMatchObject({ status: 'fail', note: 'the stored profile would start onboarding, not the live screen' });
  });

  it('uses the low tier the TV reports', async () => {
    const results = await runAll(fake(), { ...CONTEXT, info: { tier: 'low' } } as unknown as LabContext);
    expect(results.ingest).toMatchObject({ value: { lowTier: true }, note: '25 items in 1.0 s (low tier)' });
    expect(results.guide!.value).toMatchObject({ tier: 'low' });
  });
});
