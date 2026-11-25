import { describe, expect, it } from 'vitest';
import { getSources } from './catalog-store';
import { openDatabase } from './idb';
import { IngestService } from './ingest-service';
import { STORE } from './schema';
import { dumpStore, freshFactory, ingest, item } from './test-support';

describe("the ingest worker's removeSource (step 40f)", () => {
  it("deletes the one source's catalog and bookkeeping through its RPC handler, the other source's stays", async () => {
    const db = await openDatabase(freshFactory());
    await ingest(db, 'a', [item('a', 'live', 1, 'A1', 'News')]);
    await ingest(db, 'b', [item('b', 'live', 1, 'B1', 'News')]);
    const service = new IngestService({ openDb: () => Promise.resolve(db), transport: { fetch: () => Promise.reject(new Error('no network')) } as never });
    await service.handlers().removeSource({ src: 'a' });
    expect((await getSources(db)).map((s) => s.src)).toEqual(['b']);
    for (const store of [STORE.chunks, STORE.cats, STORE.index]) {
      expect(new Set((await dumpStore(db, store)).map(([k]) => (k as unknown[])[0]))).toEqual(new Set(['b']));
    }
    // A source that isn't stored changes nothing, and doesn't fail.
    await service.handlers().removeSource({ src: 'zz' });
    expect((await getSources(db)).map((s) => s.src)).toEqual(['b']);
    db.close();
  });
});
