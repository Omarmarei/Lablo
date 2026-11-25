import { describe, expect, it } from 'vitest';
import { getSources } from './catalog-store';
import { openDatabase } from './idb';
import { IngestService } from './ingest-service';
import type { ProfileDoc, SourceRecord } from './profile';
import { emptyProfile, loadProfile, saveProfile } from './profile';
import { STORE } from './schema';
import { dumpStore, freshFactory, ingest, item } from './test-support';

const source = (id: string): SourceRecord => ({ id, type: 'm3u', name: id, url: `http://${id}.test/a.m3u`, added: 1 });
const fav = (src: string, n: number): ProfileDoc['favourites'][number] => ({ key: `m:${src}:h${n}:0`, src, kind: 'live', normName: `ch ${n}`, added: n, missingSince: null });

describe("the ingest worker's removeSource (step 40f)", () => {
  it("deletes the source's catalog and the profile's record of it and of everything naming it; the other source stays", async () => {
    const db = await openDatabase(freshFactory());
    await ingest(db, 'a', [item('a', 'live', 1, 'A1', 'News')]);
    await ingest(db, 'b', [item('b', 'live', 1, 'B1', 'News')]);
    await saveProfile(db, { ...emptyProfile(), sources: [source('a'), source('b')], favourites: [fav('a', 1), fav('b', 2)] }, { now: 0 });
    const service = new IngestService({ openDb: () => Promise.resolve(db), transport: { fetch: () => Promise.reject(new Error('no network')) } as never });
    expect(await service.handlers().removeSource({ src: 'a' })).toBe(true);
    expect((await getSources(db)).map((s) => s.src)).toEqual(['b']);
    for (const store of [STORE.chunks, STORE.cats, STORE.index]) {
      expect(new Set((await dumpStore(db, store)).map(([k]) => (k as unknown[])[0]))).toEqual(new Set(['b']));
    }
    const doc = (await loadProfile(db))!.doc as ProfileDoc;
    expect(doc.sources.map((s) => s.id)).toEqual(['b']);
    expect(doc.favourites.map((f) => f.src)).toEqual(['b']);
    // A source the profile doesn't hold changes nothing, and doesn't fail.
    expect(await service.handlers().removeSource({ src: 'zz' })).toBe(false);
    expect((await getSources(db)).map((s) => s.src)).toEqual(['b']);
    db.close();
  });

  it('still takes a catalog the profile never listed (a refresh that never reached it), and writes no profile when there is none', async () => {
    const db = await openDatabase(freshFactory());
    await ingest(db, 'a', [item('a', 'live', 1, 'A1', 'News')]);
    const service = new IngestService({ openDb: () => Promise.resolve(db), transport: { fetch: () => Promise.reject(new Error('no network')) } as never });
    expect(await service.handlers().removeSource({ src: 'a' })).toBe(false);
    expect(await getSources(db)).toEqual([]);
    expect(await loadProfile(db)).toBeNull();
    db.close();
  });
});
