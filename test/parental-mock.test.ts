// RELAY step 38: parental control against the in-process mock provider over a real socket. The mock
// imports nothing from core or data, so its catalog is an independent oracle: category 6 "18+ Test
// (lock check)" holds channel 109, which its panel marks `is_adult`. Nothing of it is served while
// the session is locked (the phase's lock check, in the data); the panel's flag alone locks a
// group the playlist can't tell; and a channel the user locked stays locked through a refresh
// where the provider moved every id.

import type { CatalogItem, ContentKind } from '@lablo/core';
import type { IngestJob } from '@lablo/data';
import { QueryService, fetchTransport, openDatabase, runIngest } from '@lablo/data';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { favItem, freshFactory } from '../packages/data/src/test-support';

const catalog = loadCatalog();
const PIN = '2580';
const LOCK_CHECK = '18+ Test (lock check)';
const ADULT_CHANNEL = '18+ Test Pattern';

let app: MockServer;
let base: string;
let db: IDBDatabase;
let q: QueryService;

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  app.mockState.catalog = catalog;
  db = await openDatabase(freshFactory());
  q = new QueryService({ openDb: async () => db });
});
afterEach(() => {
  db.close();
});

const xtream = (): IngestJob => ({ src: 'xt', source: { type: 'xtream', account: { base, username: U, password: P } } });
const m3u = (): IngestJob => ({ src: 'pl', source: { type: 'm3u', url: `${base}/get.php?username=${U}&password=${P}&type=m3u_plus` } });
const ingest = async (job: IngestJob): Promise<void> => {
  expect(await runIngest(job, { db, transport: fetchTransport(), now: () => NOW })).toMatchObject({ status: 'committed' });
  await q.reload();
};

/** Every item of `src`'s `kind` as the query worker serves it now. */
async function served(src: string, kind: ContentKind = 'live'): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  for (const cat of await q.categories(src, kind)) for (let n = 0; n < cat.chunks.length; n++) out.push(...(await q.chunk({ src, kind, catIdx: cat.catIdx, chunk: n })));
  return out;
}
const servedNames = async (src: string): Promise<string[]> => (await served(src)).map((i) => i.name);
/** The live channels search finds (the mock's movies have test patterns too). */
const searched = async (query: string): Promise<string[]> => (await q.items((await q.search({ query, kinds: ['live'] })).hits)).map((i) => (i === null ? 'null' : i.name));
const marks = async (src: string): Promise<string[]> =>
  (await q.categories(src, 'live')).filter((c) => c.adult === true || c.locked === true).map((c) => `${c.name}${c.adult === true ? ' adult' : ''}${c.locked === true ? ' locked' : ''}`);

/** The mock's catalog with category 6 named `name`. */
const renamed = (name: string): Catalog => ({ ...catalog, liveCategories: catalog.liveCategories.map((c) => (c.id === 6 ? { ...c, name } : c)) });

describe('parental control against the mock provider (step 38)', () => {
  it('serves nothing of "18+ Test (lock check)" until the PIN, from Xtream and from the playlist', async () => {
    await ingest(xtream());
    await ingest(m3u());
    for (const src of ['xt', 'pl']) {
      expect(await marks(src)).toEqual([`${LOCK_CHECK} adult locked`]);
      expect(await servedNames(src)).not.toContain(ADULT_CHANNEL);
      expect((await servedNames(src)).length).toBe(catalog.live.length - 1);
    }
    expect(await searched('test pattern')).toEqual([]);
    expect(await searched('18+')).toEqual([]);
    expect(await q.lockState()).toEqual({ pin: false, unlocked: false, kinds: ['live'] });

    expect(await q.setPin(PIN)).toBe(true);
    expect(await q.unlock('0000')).toEqual({ result: 'wrong', waitMs: 0 });
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
    for (const src of ['xt', 'pl']) expect(await servedNames(src)).toContain(ADULT_CHANNEL);
    expect(await searched('test pattern')).toEqual([ADULT_CHANNEL, ADULT_CHANNEL]);

    await q.relock();
    expect(await searched('test pattern')).toEqual([]);
  });

  it("locks a group by its panel's flag alone; a playlist, which has no flag, can only tell by the name", async () => {
    app.mockState.catalog = renamed('Late Night');
    await ingest(xtream());
    await ingest(m3u());
    expect(await marks('xt')).toEqual(['Late Night adult locked']);
    expect(await servedNames('xt')).not.toContain(ADULT_CHANNEL);
    expect(await marks('pl')).toEqual([]);
    expect(await servedNames('pl')).toContain(ADULT_CHANNEL);
  });

  it('opens the group for good when the user says so, by its name', async () => {
    await ingest(xtream());
    expect(await q.editProfile({ kind: 'parental', change: { op: 'group', group: { src: 'xt', kind: 'live', name: LOCK_CHECK }, locked: false } })).toBe(true);
    expect(await marks('xt')).toEqual([`${LOCK_CHECK} adult`]);
    expect(await servedNames('xt')).toContain(ADULT_CHANNEL);
  });

  it('keeps a channel the user locked locked through a refresh where the provider moved every id', async () => {
    await ingest(xtream());
    const sports = (await served('xt')).find((i) => i.name === 'Lablo Sports Test HD')!;
    expect(sports.key).toBe('x:xt:live:106');
    expect(await q.editProfile({ kind: 'channel', change: { op: 'lock', item: favItem(sports) } })).toBe(true);
    expect(await servedNames('xt')).not.toContain('Lablo Sports Test HD');

    app.mockState.catalog = { ...catalog, live: catalog.live.map((x) => ({ ...x, id: x.id + 1000 })) };
    await ingest(xtream());
    expect(await servedNames('xt')).not.toContain('Lablo Sports Test HD');
    expect(await searched('sports test hd')).toEqual(['Lablo Sports Test FHD']);
    expect(await q.setPin(PIN)).toBe(true);
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
    expect((await served('xt')).find((i) => i.name === 'Lablo Sports Test HD')!.key).toBe('x:xt:live:1106');
  });
});
