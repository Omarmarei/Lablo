import { buildSearchSegment } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import {
  GenerationError,
  beginGeneration,
  commitGeneration,
  deleteGeneration,
  deleteSource,
  getSources,
  pruneGenerations,
  putCatalogKind,
  readCategories,
  readChunks,
  readIndexes,
} from './catalog-store';
import type { CatalogChunk } from './chunker';
import { CatalogChunker } from './chunker';
import { openDatabase } from './idb';
import { STORE } from './schema';
import { dumpStore, freshFactory, ingest, item } from './test-support';

describe('CatalogChunker', () => {
  const summary = (chunks: CatalogChunk[]): string[] => chunks.map((c) => `${c.catIdx}/${c.chunk}:${c.items.map((i) => i.name).join(',')}`);

  it('fills one category per chunk, numbers categories by first appearance, and flushes the rest at the end', () => {
    const chunker = new CatalogChunker('live', { chunkSize: 2 });
    const out: CatalogChunk[] = [];
    let id = 0;
    for (const [n, g] of [['a1', 'A'], ['b1', 'B'], ['a2', 'A'], ['a3', 'A'], ['b2', 'B'], ['c1', ''], ['a4', 'A'], ['a5', 'A']]) {
      out.push(...chunker.push(item('tv', 'live', id++, n!, g)));
    }
    expect(summary(out)).toEqual(['0/0:a1,a2', '1/0:b1,b2', '0/1:a3,a4']);
    expect(summary(chunker.end())).toEqual(['0/2:a5', '2/0:c1']);
    expect(chunker.categories()).toEqual([
      { catIdx: 0, name: 'A', count: 5, chunks: [2, 2, 1] },
      { catIdx: 1, name: 'B', count: 2, chunks: [2] },
      { catIdx: 2, name: '', count: 1, chunks: [1] },
    ]);
  });

  it('flushes the largest buffer early to bound memory when categories interleave', () => {
    const chunker = new CatalogChunker('movie', { chunkSize: 4, maxBuffered: 5 });
    const out: CatalogChunk[] = [];
    let id = 0;
    for (const g of ['A', 'B', 'A', 'C', 'A', 'B']) out.push(...chunker.push(item('tv', 'movie', id++, `${g}${id}`, g)));
    // Six buffered (A3 B2 C1) is over the limit of 5: A's three go out as a partial chunk.
    expect(summary(out)).toEqual(['0/0:A1,A3,A5']);
    expect(summary(chunker.end())).toEqual(['1/0:B2,B6', '2/0:C4']);
    expect(chunker.categories().map((c) => c.chunks)).toEqual([[3], [2], [1]]);
  });

  it('refuses items of another kind', () => {
    expect(() => new CatalogChunker('live').push(item('tv', 'movie', 1, 'x'))).toThrow(RangeError);
  });
});

describe('catalog generations', () => {
  const live = (n: number, prefix = 'Ch'): ReturnType<typeof item>[] => Array.from({ length: n }, (_, i) => item('tv', 'live', i, `${prefix} ${i}`, i % 2 ? 'News' : 'Sport'));

  it('writes a generation, then swaps to the next one in a single commit', async () => {
    const db = await openDatabase(freshFactory());
    const first = await ingest(db, 'tv', live(5), { chunkSize: 2, now: 100 });
    expect(first).toEqual({ gen: 1, previous: 0 });
    expect(await getSources(db)).toEqual([{ src: 'tv', gen: 1, building: null, nextGen: 2, updatedAt: 100, counts: { live: 5 } }]);
    expect(await readCategories(db, 'tv', 1, 'live')).toEqual([
      { catIdx: 0, name: 'Sport', count: 3, chunks: [2, 1] },
      { catIdx: 1, name: 'News', count: 2, chunks: [2] },
    ]);
    const [chunk] = await readChunks(db, [{ src: 'tv', gen: 1, kind: 'live', catIdx: 0, chunk: 1 }]);
    expect(chunk!.map((i) => i.name)).toEqual(['Ch 4']);

    const second = await ingest(db, 'tv', live(3, 'New'), { chunkSize: 2, now: 200 });
    expect(second).toEqual({ gen: 2, previous: 1 });
    // Both generations exist until the old one is deleted in the background.
    expect((await readIndexes(db, [{ src: 'tv', gen: 1, kind: 'live' }, { src: 'tv', gen: 2, kind: 'live' }])).map((d) => d?.count)).toEqual([5, 3]);
    await deleteGeneration(db, 'tv', 1);
    expect(await readIndexes(db, [{ src: 'tv', gen: 1, kind: 'live' }])).toEqual([null]);
    expect((await dumpStore(db, STORE.chunks)).map(([k]) => (k as unknown[])[1])).toEqual([2, 2]);
    db.close();
  });

  it('keeps the active generation when a refresh dies before its commit, and prunes the leftovers', async () => {
    const db = await openDatabase(freshFactory());
    await ingest(db, 'tv', live(4), { chunkSize: 2 });
    // A refresh that wrote chunks, categories and index, then the app died.
    const crashed = await ingest(db, 'tv', live(6, 'Half'), { chunkSize: 2, commit: false });
    expect(crashed.gen).toBe(2);
    expect((await getSources(db))[0]).toMatchObject({ gen: 1, building: 2 });
    // Next start: nothing is refreshing, so the half-written generation goes.
    await pruneGenerations(db, 'tv', { abandon: true });
    expect((await getSources(db))[0]).toMatchObject({ gen: 1, building: null, nextGen: 3 });
    const chunkGens = (await dumpStore(db, STORE.chunks)).map(([k]) => (k as unknown[])[1]);
    expect(new Set(chunkGens)).toEqual(new Set([1]));
    expect((await dumpStore(db, STORE.index)).map(([k]) => k)).toEqual([['tv', 1, 'live']]);
    // Committing the abandoned generation is refused.
    await expect(commitGeneration(db, 'tv', 2, { live: 6 })).rejects.toBeInstanceOf(GenerationError);
    db.close();
  });

  it('prunes every generation except the active one and the one being built, for one source only', async () => {
    const db = await openDatabase(freshFactory());
    for (let i = 0; i < 4; i++) await ingest(db, 'tv', live(2), { chunkSize: 1 }); // gens 1-4, 4 active
    await ingest(db, 'tv2', live(2), { chunkSize: 1 });
    await ingest(db, 'tv', live(2), { chunkSize: 1, commit: false }); // gen 5 being built
    await pruneGenerations(db, 'tv');
    const keys = (await dumpStore(db, STORE.cats)).map(([k]) => (k as unknown[]).slice(0, 2).join(':'));
    expect(keys).toEqual(['tv:4', 'tv:5', 'tv2:1']);
    expect((await dumpStore(db, STORE.chunks)).length).toBe(6);
    db.close();
  });

  it('refuses a stale commit when a newer refresh began', async () => {
    const db = await openDatabase(freshFactory());
    const a = await beginGeneration(db, 'tv');
    const b = await beginGeneration(db, 'tv');
    await expect(commitGeneration(db, 'tv', a, {})).rejects.toThrow(/Generation 1 of tv is not being built/);
    expect(await commitGeneration(db, 'tv', b, {}, 7)).toBe(0);
    await expect(commitGeneration(db, 'tv', b, {})).rejects.toBeInstanceOf(GenerationError);
    await expect(commitGeneration(db, 'nope', 1, {})).rejects.toBeInstanceOf(GenerationError);
    db.close();
  });

  it('checks that a search segment matches where it is stored', async () => {
    const db = await openDatabase(freshFactory());
    const seg = buildSearchSegment('tv', 'live', [], 1);
    expect(() => putCatalogKind(db, 'tv', 2, 'live', [], seg)).toThrow(RangeError);
    expect(() => putCatalogKind(db, 'tv', 1, 'movie', [], seg)).toThrow(RangeError);
    db.close();
  });

  it('deletes a whole source and nothing else; missing records read as null', async () => {
    const db = await openDatabase(freshFactory());
    await ingest(db, 'a', live(3).map((i) => ({ ...i, src: 'a', key: i.key.replace(':tv:', ':a:') })), { chunkSize: 2 });
    await ingest(db, 'b', live(3).map((i) => ({ ...i, src: 'b', key: i.key.replace(':tv:', ':b:') })), { chunkSize: 2 });
    await deleteSource(db, 'a');
    expect((await getSources(db)).map((s) => s.src)).toEqual(['b']);
    for (const store of [STORE.chunks, STORE.cats, STORE.index]) {
      expect(new Set((await dumpStore(db, store)).map(([k]) => (k as unknown[])[0]))).toEqual(new Set(['b']));
    }
    expect(await readChunks(db, [{ src: 'a', gen: 1, kind: 'live', catIdx: 0, chunk: 0 }])).toEqual([null]);
    expect(await readCategories(db, 'a', 1, 'live')).toBeNull();
    db.close();
  });
});
