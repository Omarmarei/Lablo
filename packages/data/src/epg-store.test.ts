import type { EpgBucket, EpgProgramme } from '@zoma/core';
import { buildEpgBucket, epgProgrammes } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceMeta } from './catalog-store';
import type { EpgChannelTable, EpgMeta } from './epg-store';
import {
  abandonEpgGeneration,
  beginEpgGeneration,
  commitEpgGeneration,
  deleteEpgGeneration,
  deleteEpgSource,
  epgDeclared,
  epgFirstDay,
  getEpgMeta,
  markEpgChecked,
  markEpgFailed,
  setEpgRank,
  pruneEpgDays,
  pruneEpgGenerations,
  putEpgBuckets,
  putEpgChannels,
  putEpgDeclared,
  readEpgBuckets,
  readEpgChannels,
  readEpgDeclared,
} from './epg-store';
import { EPG_AHEAD_MS, EPG_REFRESH_MS, EPG_RETRY_MS, epgGuides, epgRefreshDue } from './epg-sources';
import { openDatabase } from './idb';
import { STORE } from './schema';
import { dumpStore, freshFactory } from './test-support';

const DAY = 1440;
const D0 = 20394; // 2025-11-02, a UTC day number

let db: IDBDatabase;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
});
afterEach(() => {
  db.close();
});

const prog = (start: number, end: number, title: string, flags = 0): EpgProgramme => ({ start, end, title, sub: '', desc: `about ${title}`, category: '', episode: '', flags });
const bucket = (channel: string, day: number, rows: EpgProgramme[], merge = false): EpgBucket => buildEpgBucket(channel, day, rows, merge);
const titles = (b: EpgBucket | null): string[] => (b === null ? [] : epgProgrammes(b).map((p) => `${p.start - b.day * DAY}:${p.title}`));
const table = (ids: string[]): EpgChannelTable => ({ matches: ids.map((id) => ({ key: `x:tv:live:${id}`, channel: id, method: 'id', ambiguous: false, shift: 0 })), channels: ids.map((id) => ({ id, name: id, icon: null })), unmatched: [] });

async function gens(epgSrc: string): Promise<number[]> {
  const out = new Set<number>();
  for (const store of [STORE.epgBuckets, STORE.epgChannels]) for (const [key] of await dumpStore(db, store)) if ((key as unknown[])[0] === epgSrc) out.add((key as [string, number])[1]);
  return [...out].sort((a, b) => a - b);
}

describe('EPG buckets in IndexedDB', () => {
  it('round-trips the typed columns and merges fragments into the stored record', async () => {
    const gen = await beginEpgGeneration(db, 'g');
    const day = D0 * DAY;
    await putEpgBuckets(db, 'g', gen, [bucket('a', D0, [prog(day + 60, day + 120, 'A1', 1), prog(day, day + 60, 'A0')]), bucket('b', D0, [prog(day, day + 30, 'B0')])]);
    // A later fragment of a.D0, two fragments of b.D0 in one batch, and a fresh bucket of a.D0+1.
    await putEpgBuckets(db, 'g', gen, [
      bucket('a', D0, [prog(day + 120, day + 180, 'A2'), prog(day + 60, day + 90, 'A1 again')], true),
      bucket('b', D0, [prog(day + 30, day + 60, 'B1')], true),
      bucket('b', D0, [prog(day + 60, day + 90, 'B2'), prog(day, day + 30, 'B0 again')], true),
      bucket('a', D0 + 1, [prog(day + DAY, day + DAY + 60, 'A3')]),
    ]);
    const [a, b, a1, missing] = await readEpgBuckets(db, [
      { epgSrc: 'g', gen, channel: 'a', day: D0 },
      { epgSrc: 'g', gen, channel: 'b', day: D0 },
      { epgSrc: 'g', gen, channel: 'a', day: D0 + 1 },
      { epgSrc: 'g', gen, channel: 'c', day: D0 },
    ]);
    // The stored record wins on equal starts: it came first in the guide.
    expect(titles(a!)).toEqual(['0:A0', '60:A1', '120:A2']);
    expect(titles(b!)).toEqual(['0:B0', '30:B1', '60:B2']);
    expect(titles(a1!)).toEqual(['0:A3']);
    expect(missing).toBeNull();
    expect(a!.start).toBeInstanceOf(Int32Array);
    expect(a!.flags).toBeInstanceOf(Uint8Array);
    expect(Array.from(a!.flags)).toEqual([0, 1, 0]);
    expect(a).toMatchObject({ channel: 'a', day: D0, merge: false, desc: ['about A0', 'about A1', 'about A2'] });
    // Stored without the key's fields.
    const [, raw] = (await dumpStore(db, STORE.epgBuckets)).find(([k]) => (k as unknown[])[2] === 'a' && (k as unknown[])[3] === D0)!;
    expect(Object.keys(raw as object).sort()).toEqual(['category', 'desc', 'end', 'episode', 'flags', 'start', 'sub', 'title']);
  });

  it('writes a fragment whose first part is not stored as a bucket of its own', async () => {
    const gen = await beginEpgGeneration(db, 'g');
    await putEpgBuckets(db, 'g', gen, [bucket('a', D0, [prog(D0 * DAY, D0 * DAY + 5, 'x')], true)]);
    expect(titles((await readEpgBuckets(db, [{ epgSrc: 'g', gen, channel: 'a', day: D0 }]))[0]!)).toEqual(['0:x']);
  });
});

describe('EPG generations', () => {
  it('commits, keeps the active generation through an abandoned one, and deletes the previous one', async () => {
    const g1 = await beginEpgGeneration(db, 'g', 2);
    await putEpgBuckets(db, 'g', g1, [bucket('a', D0, [prog(D0 * DAY, D0 * DAY + 60, 'one')])]);
    await putEpgChannels(db, 'g', g1, table(['a']));
    expect(await commitEpgGeneration(db, 'g', g1, 100, { until: 7, rank: 2 })).toBe(0);
    expect(await getEpgMeta(db, 'g')).toMatchObject({ gen: 1, building: null, nextGen: 2, updatedAt: 100, checkedAt: 100, until: 7, rank: 2, failedAt: null });

    const g2 = await beginEpgGeneration(db, 'g');
    await putEpgBuckets(db, 'g', g2, [bucket('a', D0, [prog(D0 * DAY, D0 * DAY + 60, 'two')])]);
    await abandonEpgGeneration(db, 'g', g2);
    expect(await gens('g')).toEqual([1]);
    expect((await getEpgMeta(db, 'g'))!.building).toBeNull();
    await expect(commitEpgGeneration(db, 'g', g2, 200)).rejects.toThrow('not being built');

    const g3 = await beginEpgGeneration(db, 'g');
    await putEpgChannels(db, 'g', g3, table(['b']));
    expect(await commitEpgGeneration(db, 'g', g3, 300)).toBe(1);
    expect((await readEpgChannels(db, [{ epgSrc: 'g', gen: 3 }, { epgSrc: 'g', gen: 1 }]))[0]!.channels[0]!.id).toBe('b');
  });

  it('prunes leftovers around the active and building generations, and deletes a whole guide', async () => {
    // Generations 1 (active), 2 (left over), 3 (building), and another guide sharing a prefix.
    for (const g of ['g', 'gg']) {
      for (let n = 1; n <= 3; n++) {
        const gen = await beginEpgGeneration(db, g);
        await putEpgBuckets(db, g, gen, [bucket('a', D0, [prog(D0 * DAY, D0 * DAY + 60, `${g}${n}`)])]);
        await putEpgChannels(db, g, gen, table(['a']));
        if (n === 1) await commitEpgGeneration(db, g, gen, 1);
      }
    }
    await pruneEpgGenerations(db, 'g');
    expect(await gens('g')).toEqual([1, 3]);
    await pruneEpgGenerations(db, 'g', { abandon: true });
    expect(await gens('g')).toEqual([1]);
    expect((await getEpgMeta(db, 'g'))!.building).toBeNull();
    expect(await gens('gg')).toEqual([1, 2, 3]);
    await deleteEpgSource(db, 'gg');
    expect(await gens('gg')).toEqual([]);
    expect(await getEpgMeta(db, 'gg')).toBeNull();
    expect(await gens('g')).toEqual([1]);
  });

  it('prunes the past days of the active generation only', async () => {
    const gen = await beginEpgGeneration(db, 'g');
    const rows = (d: number): EpgProgramme[] => [prog(d * DAY, d * DAY + 60, `d${d}`)];
    const all: EpgBucket[] = [];
    for (let d = D0 - 4; d <= D0 + 1; d++) for (const c of ['a', 'b', 'c']) all.push(bucket(c, d, rows(d)));
    await putEpgBuckets(db, 'g', gen, all);
    // Channel c is no longer in the match table: its buckets are never read, and stay until the next generation.
    await putEpgChannels(db, 'g', gen, table(['a', 'b']));
    await commitEpgGeneration(db, 'g', gen, 1);
    const nowMs = (D0 * DAY + 720) * 60_000;
    expect(epgFirstDay(nowMs, 2)).toBe(D0 - 3);
    expect(await pruneEpgDays(db, 'g', epgFirstDay(nowMs, 2))).toBe(2);
    const days = (await dumpStore(db, STORE.epgBuckets)).map(([k]) => `${(k as unknown[])[2]}${(k as number[])[3]! - D0}`);
    expect(days.sort()).toEqual(['a-1', 'a-2', 'a-3', 'a0', 'a1', 'b-1', 'b-2', 'b-3', 'b0', 'b1', 'c-1', 'c-2', 'c-3', 'c-4', 'c0', 'c1'].sort());
    expect(await pruneEpgDays(db, 'missing', D0)).toBe(0);
  });

  it('records checks and failures, with why it failed', async () => {
    await markEpgChecked(db, 'none', 5);
    expect(await getEpgMeta(db, 'none')).toBeNull();
    await markEpgFailed(db, 'new', 10, 3, { code: 'http', status: 404 });
    expect(await getEpgMeta(db, 'new')).toMatchObject({ gen: 0, failedAt: 10, rank: 3, failure: { code: 'http', status: 404 } });
    const gen = await beginEpgGeneration(db, 'new');
    await commitEpgGeneration(db, 'new', gen, 20);
    expect(await getEpgMeta(db, 'new')).toMatchObject({ gen: 1, failedAt: null, failure: null, checkedAt: 20 });
    await markEpgFailed(db, 'new', 30, 0, { code: 'network', status: null });
    expect(await getEpgMeta(db, 'new')).toMatchObject({ failedAt: 30, failure: { code: 'network', status: null } });
    await markEpgChecked(db, 'new', 40, { until: 9 });
    expect(await getEpgMeta(db, 'new')).toMatchObject({ failedAt: null, failure: null, checkedAt: 40, until: 9, updatedAt: 20 });
    // A failure without a reason stores none (and replaces an older one).
    await markEpgFailed(db, 'new', 50, 0, { code: 'format', status: null });
    await markEpgFailed(db, 'new', 60);
    expect(await getEpgMeta(db, 'new')).toMatchObject({ failedAt: 60, failure: null });
  });

  it("sets a stored guide's rank, and nothing for an unknown one", async () => {
    await markEpgFailed(db, 'g', 10, 3);
    await setEpgRank(db, 'g', 0);
    expect(await getEpgMeta(db, 'g')).toMatchObject({ rank: 0, failedAt: 10, gen: 0 });
    await setEpgRank(db, 'none', 2);
    expect(await getEpgMeta(db, 'none')).toBeNull();
  });
});

describe("a guide's declared channels (step 24d)", () => {
  const SEP = String.fromCharCode(1);
  const declared = (...ids: string[]) => epgDeclared(ids.map((id) => ({ id, name: `Name ${id}`, names: [`Name ${id}`] })));

  it('searches the id and every display name, normalized, and shows the name for the UI languages', () => {
    expect(
      epgDeclared([
        { id: 'BBCOne.uk', name: 'BBC One', names: ['BBC One', 'Ãrte Ünïcode', 'قناة الجزيرة'] },
        { id: 'only.id', name: 'only.id', names: [] },
      ]),
    ).toEqual({
      ids: ['BBCOne.uk', 'only.id'],
      names: ['BBC One', 'only.id'],
      search: [`bbconeuk${SEP}bbc one${SEP}arte unicode${SEP}قناه الجزيره`, 'onlyid'],
    });
    expect(epgDeclared([])).toEqual({ ids: [], names: [], search: [] });
  });

  it('is stored beside the match table, and goes with its generation and its guide', async () => {
    const g1 = await beginEpgGeneration(db, 'g');
    await putEpgChannels(db, 'g', g1, table(['a']));
    await putEpgDeclared(db, 'g', g1, declared('a', 'b', 'c'));
    await commitEpgGeneration(db, 'g', g1, 1);
    const g2 = await beginEpgGeneration(db, 'g');
    await putEpgDeclared(db, 'g', g2, declared('d'));
    const gg = await beginEpgGeneration(db, 'gg');
    await putEpgDeclared(db, 'gg', gg, declared('e'));

    expect(await readEpgDeclared(db, 'g', g1)).toEqual(declared('a', 'b', 'c'));
    expect(await readEpgDeclared(db, 'g', g2)).toEqual(declared('d'));
    // The match table is read as it was: the declared record is a key of its own.
    expect((await readEpgChannels(db, [{ epgSrc: 'g', gen: g1 }]))[0]).toEqual(table(['a']));
    expect(await readEpgDeclared(db, 'g', 9)).toBeNull();

    await abandonEpgGeneration(db, 'g', g2);
    expect(await readEpgDeclared(db, 'g', g2)).toBeNull();
    const g3 = await beginEpgGeneration(db, 'g');
    await putEpgDeclared(db, 'g', g3, declared('f'));
    await pruneEpgGenerations(db, 'g', { abandon: true });
    expect(await readEpgDeclared(db, 'g', g3)).toBeNull();
    expect(await readEpgDeclared(db, 'g', g1)).toEqual(declared('a', 'b', 'c'));
    await deleteEpgGeneration(db, 'g', g1);
    expect(await readEpgDeclared(db, 'g', g1)).toBeNull();
    expect(await readEpgDeclared(db, 'gg', gg)).toEqual(declared('e'));
    await deleteEpgSource(db, 'gg');
    expect(await readEpgDeclared(db, 'gg', gg)).toBeNull();
  });
});

describe('which guides, and when', () => {
  const meta = (src: string, extra: Partial<SourceMeta> = {}): SourceMeta => ({ src, gen: 1, building: null, nextGen: 2, updatedAt: 1, counts: {}, ...extra });

  it('lists the user guides first, then each source own guides, each URL once', () => {
    const account = { base: 'http://panel.test:8080', username: 'u', password: 'p w' };
    const guides = epgGuides(
      [
        { src: 'pl', type: 'm3u' },
        { src: 'xt', type: 'xtream', account },
        { src: 'none', type: 'm3u' },
      ],
      [meta('xt'), meta('pl', { epgUrls: ['http://a.test/guide.xml', 'http://u.test/mine.xml.gz'] }), meta('none')],
      [{ id: 'mine', url: 'http://u.test/mine.xml.gz', offsetMinutes: 180 }],
    );
    expect(guides).toEqual([
      { epgSrc: 'u~mine', url: 'http://u.test/mine.xml.gz', zone: { minutes: 180 } },
      { epgSrc: 'pl:tvg0', url: 'http://a.test/guide.xml', zone: { minutes: 0 } },
      { epgSrc: 'xt:xmltv', url: 'http://panel.test:8080/xmltv.php?username=u&password=p%20w', zone: { panel: 'xt' } },
    ]);
    expect(epgGuides([{ src: 'pl', type: 'm3u' }], [])).toEqual([]);
  });

  it("reads a playlist's own panel guide (xmltv.php with a login) in its panel's zone (step 25b)", () => {
    const panelGuide = 'http://panel.test:8080/xmltv.php?username=u&password=p';
    const guides = epgGuides([{ src: 'pl', type: 'm3u' }], [meta('pl', { epgUrls: [panelGuide, 'http://a.test/xmltv.php', 'http://a.test/guide.xml?username=u&password=p'] })]);
    expect(guides).toEqual([
      { epgSrc: 'pl:tvg0', url: panelGuide, zone: { panel: 'pl' } },
      // Without a login, or another page: not a panel's guide.
      { epgSrc: 'pl:tvg1', url: 'http://a.test/xmltv.php', zone: { minutes: 0 } },
      { epgSrc: 'pl:tvg2', url: 'http://a.test/guide.xml?username=u&password=p', zone: { minutes: 0 } },
    ]);
  });

  it('is due when new, stale, or running out, but never right after a refresh or a failure', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const base: EpgMeta = { epgSrc: 'g', gen: 1, building: null, nextGen: 2, updatedAt: now, checkedAt: now, rank: 0, until: (now + 3 * 86_400_000) / 60_000 };
    expect(epgRefreshDue(null, now)).toBe('new');
    expect(epgRefreshDue({ ...base, gen: 0 }, now)).toBe('new');
    expect(epgRefreshDue(base, now)).toBeNull();
    expect(epgRefreshDue(base, now + EPG_REFRESH_MS - 1)).toBeNull();
    expect(epgRefreshDue(base, now + EPG_REFRESH_MS)).toBe('stale');
    expect(epgRefreshDue({ ...base, checkedAt: null }, now)).toBe('stale');
    const short = { ...base, until: (now + EPG_AHEAD_MS - 60_000) / 60_000 };
    expect(epgRefreshDue(short, now + EPG_RETRY_MS - 1)).toBeNull();
    expect(epgRefreshDue(short, now + EPG_RETRY_MS)).toBe('running-out');
    expect(epgRefreshDue({ ...base, until: null }, now + EPG_RETRY_MS)).toBe('running-out');
    expect(epgRefreshDue({ ...base, failedAt: now }, now + EPG_REFRESH_MS + EPG_RETRY_MS - 1)).toBe('stale');
    expect(epgRefreshDue({ ...base, failedAt: now + EPG_REFRESH_MS }, now + EPG_REFRESH_MS + 1)).toBeNull();
    expect(epgRefreshDue({ ...base, gen: 0, failedAt: now }, now + EPG_RETRY_MS - 1)).toBeNull();
    expect(epgRefreshDue({ ...base, gen: 0, failedAt: now }, now + EPG_RETRY_MS)).toBe('new');
  });

  it('is due at once when matched with other manual mappings, but not right after a failure (step 24d)', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const base: EpgMeta = { epgSrc: 'g', gen: 1, building: null, nextGen: 2, updatedAt: now, checkedAt: now, rank: 0, until: (now + 3 * 86_400_000) / 60_000, mapping: 'k1' };
    expect(epgRefreshDue(base, now, 'k1')).toBeNull();
    expect(epgRefreshDue(base, now, 'k2')).toBe('mapping');
    expect(epgRefreshDue(base, now)).toBe('mapping');
    expect(epgRefreshDue({ ...base, mapping: '-' }, now)).toBeNull();
    // A guide read before step 24d was matched with none.
    expect(epgRefreshDue({ ...base, mapping: undefined }, now)).toBeNull();
    expect(epgRefreshDue({ ...base, mapping: undefined }, now, 'k1')).toBe('mapping');
    expect(epgRefreshDue({ ...base, failedAt: now }, now + EPG_RETRY_MS - 1, 'k2')).toBeNull();
    expect(epgRefreshDue({ ...base, failedAt: now }, now + EPG_RETRY_MS, 'k2')).toBe('mapping');
    expect(epgRefreshDue({ ...base, gen: 0 }, now, 'k2')).toBe('new');
    // Stale too: the mapping is told first.
    expect(epgRefreshDue(base, now + EPG_REFRESH_MS, 'k2')).toBe('mapping');
  });
});
