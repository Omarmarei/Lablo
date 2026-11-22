// The query worker's locks (RELAY step 38): the adult and locked categories marked, and while the
// session is locked nothing of a locked category or channel served by any read; the PIN's check,
// its wait, the session's unlock and relock; the locks read at each reload and taken from each edit.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItem, ContentKind } from '@lablo/core';
import { pinHash } from '@lablo/crypto';
import type { ChannelChange } from './channel-changes';
import { openDatabase } from './idb';
import type { LockRef, ParentalChange } from './parental';
import { emptyProfile, loadProfile, saveProfile } from './profile';
import type { ItemRef } from './query-service';
import { QueryService, UNLOCK_TRIES, UNLOCK_WAIT_MS } from './query-service';
import { favItem, freshFactory, ingest, item } from './test-support';

/**
 * Source `tv` (chunks of 2): live "News" (1-3), "XXX Night" (4-5: adult by its name), "Late" (6:
 * its panel marked channel 6 adult), "Sport" (7-8); movies "Films" (9) and "Adult Films" (10);
 * series "Shows" (11). Source `tw`: live "Misc" (1) and "Misc 2" (2).
 */
const TV: CatalogItem[] = [
  item('tv', 'live', 1, 'News One', 'News'),
  item('tv', 'live', 2, 'News Two', 'News'),
  item('tv', 'live', 3, 'News Three', 'News'),
  item('tv', 'live', 4, 'Night One', 'XXX Night'),
  item('tv', 'live', 5, 'Night Two', 'XXX Night'),
  item('tv', 'live', 6, 'Late One', 'Late'),
  item('tv', 'live', 7, 'Sport One', 'Sport'),
  item('tv', 'live', 8, 'Sport Two', 'Sport'),
  item('tv', 'movie', 9, 'Big Film', 'Films'),
  item('tv', 'movie', 10, 'Night Film', 'Adult Films'),
  item('tv', 'series', 11, 'Night Show', 'Shows'),
];
const TW: CatalogItem[] = [item('tw', 'live', 1, 'Morning', 'Misc'), item('tw', 'live', 2, 'Night Other', 'Misc 2')];
const ch = (n: number): CatalogItem => TV[n - 1]!;
const PIN = '4821';

let db: IDBDatabase;
let q: QueryService;
let now = 1_000_000;
const make = (): QueryService => new QueryService({ openDb: async () => db, now: () => now, random: (n) => new Uint8Array(n).fill(7) });
beforeEach(async () => {
  now = 1_000_000;
  db = await openDatabase(freshFactory());
  await ingest(db, 'tv', TV, { chunkSize: 2, adult: [ch(6).key], recent: { movie: [{ added: 20, item: ch(10) }, { added: 10, item: ch(9) }] } });
  await ingest(db, 'tw', TW, { chunkSize: 2 });
  q = make();
});
afterEach(() => {
  db.close();
});

const parental = (change: ParentalChange): Promise<boolean> => q.editProfile({ kind: 'parental', change });
const choose = (group: LockRef, locked: boolean): Promise<boolean> => parental({ op: 'group', group, locked });
const channel = (change: ChannelChange): Promise<boolean> => q.editProfile({ kind: 'channel', change });
/** The salt a profile document keeps for its PIN. */
const saltOf = (doc: unknown): string => (doc as { parental: { salt: string } }).parental.salt;
const unlocked = async (): Promise<void> => {
  expect(await q.setPin(PIN)).toBe(true);
  expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
};

/** Each category of `src`'s `kind` as served: `name count [marks]`. */
async function cats(src = 'tv', kind: ContentKind = 'live'): Promise<string[]> {
  return (await q.categories(src, kind)).map((c) => `${c.name} ${c.count}${c.adult === true ? ' adult' : ''}${c.locked === true ? ' locked' : ''}${c.hidden ? ` hidden${c.hidden.join(',')}` : ''}`);
}

/** Every item of `src`'s `kind` as served, chunk by chunk, by name. */
async function served(src = 'tv', kind: ContentKind = 'live'): Promise<string[]> {
  const out: string[] = [];
  for (const info of await q.categories(src, kind)) {
    for (let c = 0; c < info.chunks.length; c += 1) for (const x of await q.chunk({ src, kind, catIdx: info.catIdx, chunk: c })) out.push(x.name);
  }
  return out;
}

const found = async (query: string, sources?: string[]): Promise<{ names: string[]; total: number }> => {
  const result = await q.search({ query, sources });
  const items = await q.items(result.hits);
  return { names: items.map((x) => (x === null ? 'null' : `${x.src}:${x.name}`)), total: result.total };
};

/** Where channel `n` of `tv` is stored. */
const LIVE_AT: Record<number, [number, number, number]> = { 1: [0, 0, 0], 2: [0, 0, 1], 3: [0, 1, 0], 4: [1, 0, 0], 5: [1, 0, 1], 6: [2, 0, 0], 7: [3, 0, 0], 8: [3, 0, 1] };
const refOf = (n: number): ItemRef => {
  if (n === 9 || n === 10) return { src: 'tv', kind: 'movie', gen: 1, catIdx: n - 9, chunk: 0, slot: 0 };
  const [catIdx, chunk, slot] = LIVE_AT[n]!;
  return { src: 'tv', kind: 'live', gen: 1, catIdx, chunk, slot };
};
const names = async (ns: number[]): Promise<(string | null)[]> => (await q.items(ns.map(refOf))).map((x) => (x === null ? null : x.name));

const unmatchedNames = async (): Promise<{ rows: string[]; count: number; version: number }> => {
  const page = await q.unmatched({ sources: ['tv', 'tw'], offset: 0, limit: 50 });
  return { rows: page.rows.map((r) => r.name), count: page.count, version: page.version };
};

const ALL_LIVE = ['News One', 'News Two', 'News Three', 'Night One', 'Night Two', 'Late One', 'Sport One', 'Sport Two'];
const OPEN_LIVE = ['News One', 'News Two', 'News Three', 'Sport One', 'Sport Two'];

describe('QueryService: the marks (step 38)', () => {
  it('marks the adult categories, by name or by the panel, and locks them; counts and places stay', async () => {
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult locked', 'Late 1 adult locked', 'Sport 2']);
    expect(await cats('tv', 'movie')).toEqual(['Films 1', 'Adult Films 1 adult locked']);
    expect(await cats('tv', 'series')).toEqual(['Shows 1']);
    expect(await cats('tw')).toEqual(['Misc 1', 'Misc 2 1']);
    // An unmarked category is served as stored, without the fields.
    const news = (await q.categories('tv', 'live'))[0]!;
    expect(Object.keys(news).sort()).toEqual(['catIdx', 'chunks', 'count', 'name']);
    expect((await q.categories('tv', 'live'))[1]).toMatchObject({ catIdx: 1, chunks: [2] });
  });

  it('marks the same while the session is unlocked', async () => {
    await unlocked();
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult locked', 'Late 1 adult locked', 'Sport 2']);
    expect(await cats('tv', 'movie')).toEqual(['Films 1', 'Adult Films 1 adult locked']);
  });

  it('opens the adult categories while "Lock adult groups" is off, still marked adult', async () => {
    expect(await parental({ op: 'adult', on: false })).toBe(true);
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult', 'Late 1 adult', 'Sport 2']);
    expect(await served()).toEqual(ALL_LIVE);
    expect(await q.lockState()).toEqual({ pin: false, unlocked: false, kinds: [] });
  });

  it("follows the user's choice over the default, for that source, kind and name only", async () => {
    expect(await choose({ src: 'tv', kind: 'live', name: 'XXX Night' }, false)).toBe(true);
    expect(await choose({ src: 'tv', kind: 'live', name: 'Sport' }, true)).toBe(true);
    expect(await choose({ src: 'tv', kind: 'movie', name: 'News' }, true)).toBe(true);
    expect(await choose({ src: 'tw', kind: 'live', name: 'Late' }, false)).toBe(true);
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult', 'Late 1 adult locked', 'Sport 2 locked']);
    expect(await served()).toEqual(['News One', 'News Two', 'News Three', 'Night One', 'Night Two']);
    // "Lock adult groups" off leaves the user's own locks.
    expect(await parental({ op: 'adult', on: false })).toBe(true);
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult', 'Late 1 adult', 'Sport 2 locked']);
  });
});

describe('QueryService: nothing locked served while the session is locked (step 38)', () => {
  it('serves no item of a locked category: its chunks are empty; all of it once unlocked', async () => {
    expect(await served()).toEqual(OPEN_LIVE);
    expect(await served('tv', 'movie')).toEqual(['Big Film']);
    expect(await q.chunk({ src: 'tv', kind: 'live', catIdx: 1, chunk: 0 })).toEqual([]);
    await unlocked();
    expect(await served()).toEqual(ALL_LIVE);
    expect(await served('tv', 'movie')).toEqual(['Big Film', 'Night Film']);
  });

  it('gives null for a locked item read by its place', async () => {
    expect(await names([1, 4, 6, 7, 9, 10])).toEqual(['News One', null, null, 'Sport One', 'Big Film', null]);
    await unlocked();
    expect(await names([1, 4, 6, 7, 9, 10])).toEqual(['News One', 'Night One', 'Late One', 'Sport One', 'Big Film', 'Night Film']);
  });

  it('finds nothing locked in search, nor counts it; in any source order', async () => {
    expect(await found('night')).toEqual({ names: ['tw:Night Other', 'tv:Night Show'], total: 2 });
    expect(await found('night', ['tw', 'tv'])).toEqual({ names: ['tw:Night Other', 'tv:Night Show'], total: 2 });
    expect(await found('night', ['tv'])).toEqual({ names: ['tv:Night Show'], total: 1 });
    await unlocked();
    expect(await found('night')).toEqual({ names: ['tv:Night One', 'tv:Night Two', 'tw:Night Other', 'tv:Night Film', 'tv:Night Show'], total: 5 });
  });

  it('leaves locked items out of a key lookup, where they take no place among the first asked', async () => {
    const ask = (limit: number) => q.itemsByKey({ keys: [ch(4).key, ch(1).key, ch(6).key, ch(2).key], kind: 'live', sources: ['tv'], limit });
    expect((await ask(2)).map((x) => x.name)).toEqual(['News One', 'News Two']);
    expect((await q.itemsByKey({ keys: [ch(10).key, ch(9).key], kind: 'movie', sources: ['tv'], limit: 1 })).map((x) => x.name)).toEqual(['Big Film']);
    await unlocked();
    expect((await ask(2)).map((x) => x.name)).toEqual(['Night One', 'News One']);
  });

  it('finds no channel by a number the user gave a locked one', async () => {
    expect(await channel({ op: 'number', item: favItem(ch(4)), number: 50 })).toBe(true);
    expect(await channel({ op: 'number', item: favItem(ch(1)), number: 51 })).toBe(true);
    expect(await q.numbered({ number: 50, sources: ['tv'] })).toBeNull();
    expect((await q.numbered({ number: 51, sources: ['tv'] }))!.item.name).toBe('News One');
    await unlocked();
    expect((await q.numbered({ number: 50, sources: ['tv'] }))!.item.name).toBe('Night One');
  });

  it('leaves locked items out of "Recently added"', async () => {
    expect((await q.recent({ sources: ['tv'], kind: 'movie' })).map((r) => r.item.name)).toEqual(['Big Film']);
    await unlocked();
    expect((await q.recent({ sources: ['tv'], kind: 'movie' })).map((r) => r.item.name)).toEqual(['Night Film', 'Big Film']);
  });

  it('leaves locked channels out of the channels without a guide; a new version at each change', async () => {
    const before = await unmatchedNames();
    expect(before.rows).toEqual(OPEN_LIVE.concat(['Morning', 'Night Other']));
    expect(before.count).toBe(7);
    await unlocked();
    const after = await unmatchedNames();
    expect(after.rows).toEqual(ALL_LIVE.concat(['Morning', 'Night Other']));
    expect(after.version).toBeGreaterThan(before.version);
    await q.relock();
    const again = await unmatchedNames();
    expect(again.rows).toEqual(before.rows);
    expect(again.version).toBeGreaterThan(after.version);
    expect(await choose({ src: 'tv', kind: 'live', name: 'Sport' }, true)).toBe(true);
    const sport = await unmatchedNames();
    expect(sport.rows).toEqual(['News One', 'News Two', 'News Three', 'Morning', 'Night Other']);
    expect(sport.version).toBeGreaterThan(again.version);
  });
});

describe("QueryService: a channel the user locked (step 38)", () => {
  beforeEach(async () => {
    expect(await channel({ op: 'lock', item: favItem(ch(7)) })).toBe(true);
  });

  it('leaves it out of its served chunk with its place, and of every read, while the session is locked', async () => {
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult locked', 'Late 1 adult locked', 'Sport 2 hidden0']);
    expect(await served()).toEqual(['News One', 'News Two', 'News Three', 'Sport Two']);
    expect(await names([7, 8])).toEqual([null, 'Sport Two']);
    expect(await found('sport')).toEqual({ names: ['tv:Sport Two'], total: 1 });
    expect((await q.itemsByKey({ keys: [ch(7).key, ch(8).key], kind: 'live', sources: ['tv'], limit: 1 })).map((x) => x.name)).toEqual(['Sport Two']);
    expect((await unmatchedNames()).rows).toEqual(['News One', 'News Two', 'News Three', 'Sport Two', 'Morning', 'Night Other']);
    expect(await channel({ op: 'number', item: favItem(ch(7)), number: 70 })).toBe(true);
    expect(await q.numbered({ number: 70, sources: ['tv'] })).toBeNull();
  });

  it('serves it again once unlocked, not hidden', async () => {
    await unlocked();
    expect(await cats()).toEqual(['News 3', 'XXX Night 2 adult locked', 'Late 1 adult locked', 'Sport 2']);
    expect(await served()).toEqual(ALL_LIVE);
    expect(await found('sport')).toEqual({ names: ['tv:Sport One', 'tv:Sport Two'], total: 2 });
  });

  it('stays out when hidden too, and when unlocked by the user is served again', async () => {
    expect(await channel({ op: 'hide', item: favItem(ch(7)) })).toBe(true);
    await unlocked();
    expect(await served()).toEqual(ALL_LIVE.filter((n) => n !== 'Sport One'));
    await q.relock();
    expect(await channel({ op: 'unlock', key: ch(7).key })).toBe(true);
    expect(await channel({ op: 'show', key: ch(7).key })).toBe(true);
    expect(await served()).toEqual(OPEN_LIVE);
  });

  it('counts as something locked in the live kind alone', async () => {
    expect(await parental({ op: 'adult', on: false })).toBe(true);
    expect((await q.lockState()).kinds).toEqual(['live']);
  });
});

describe('QueryService: the PIN and the session (step 38)', () => {
  it('unlocks nothing without a PIN', async () => {
    expect(await q.unlock(PIN)).toEqual({ result: 'no-pin', waitMs: 0 });
    expect(await q.lockState()).toEqual({ pin: false, unlocked: false, kinds: ['live', 'movie'] });
    expect(await served()).toEqual(OPEN_LIVE);
  });

  it("keeps a new PIN's salt and hash, never the PIN; refuses one that isn't four digits", async () => {
    expect(await q.setPin('12a4')).toBe(false);
    expect(await q.setPin('12345')).toBe(false);
    expect(await q.setPin(PIN)).toBe(true);
    const doc = (await loadProfile(db))!.doc as { parental?: { salt: string; hash: string } };
    expect(doc.parental).toEqual({ salt: 'BwcHBwcHBwcHBwcHBwcHBw', hash: pinHash('BwcHBwcHBwcHBwcHBwcHBw', PIN) });
    expect(JSON.stringify(doc)).not.toContain(PIN);
    expect(await q.lockState()).toEqual({ pin: true, unlocked: false, kinds: ['live', 'movie'] });
  });

  it('draws a new salt for each PIN', async () => {
    let n = 0;
    q = new QueryService({ openDb: async () => db, random: (length) => new Uint8Array(length).fill((n += 1)) });
    expect(await q.setPin(PIN)).toBe(true);
    const first = saltOf((await loadProfile(db))!.doc);
    expect(await q.setPin(PIN)).toBe(true);
    const second = saltOf((await loadProfile(db))!.doc);
    expect(second).not.toBe(first);
  });

  it('draws the salt from crypto.getRandomValues by default', async () => {
    q = new QueryService({ openDb: async () => db });
    expect(await q.setPin(PIN)).toBe(true);
    expect(await q.setPin(PIN)).toBe(true);
    const salt = saltOf((await loadProfile(db))!.doc);
    expect(salt).toHaveLength(22);
    expect(await q.setPin(PIN)).toBe(true);
    expect(saltOf((await loadProfile(db))!.doc)).not.toBe(salt);
    expect(salt).not.toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
  });

  it('unlocks with the PIN only, and locks again', async () => {
    expect(await q.setPin(PIN)).toBe(true);
    for (const wrong of ['4820', '1234', '', 'abcd', '48210']) {
      expect(await q.unlock(wrong)).toEqual({ result: 'wrong', waitMs: 0 });
      expect(await served()).toEqual(OPEN_LIVE);
      // (The right one between them: five wrong ones in a row would wait.)
      expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
      await q.relock();
    }
    expect(await served()).toEqual(OPEN_LIVE);
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
    expect(await q.lockState()).toEqual({ pin: true, unlocked: true, kinds: ['live', 'movie'] });
    expect(await served()).toEqual(ALL_LIVE);
    await q.relock();
    expect((await q.lockState()).unlocked).toBe(false);
    expect(await served()).toEqual(OPEN_LIVE);
    // Relocked twice, and unlocked twice: the same.
    await q.relock();
    expect(await served()).toEqual(OPEN_LIVE);
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
    expect(await served()).toEqual(ALL_LIVE);
  });

  it(`waits ${UNLOCK_WAIT_MS / 1000} s after ${UNLOCK_TRIES} wrong PINs in a row, checking none meanwhile`, async () => {
    expect(UNLOCK_TRIES).toBe(5);
    expect(UNLOCK_WAIT_MS).toBe(60_000);
    expect(await q.setPin(PIN)).toBe(true);
    for (let i = 1; i < UNLOCK_TRIES; i += 1) expect(await q.unlock('0000')).toEqual({ result: 'wrong', waitMs: 0 });
    expect(await q.unlock('0000')).toEqual({ result: 'wait', waitMs: UNLOCK_WAIT_MS });
    now += 15_000;
    expect(await q.unlock(PIN)).toEqual({ result: 'wait', waitMs: 45_000 });
    now += 44_999;
    expect(await q.unlock(PIN)).toEqual({ result: 'wait', waitMs: 1 });
    expect(await served()).toEqual(OPEN_LIVE);
    now += 1;
    // The wait over: a wrong one counts from one again.
    for (let i = 1; i < UNLOCK_TRIES; i += 1) expect(await q.unlock('0000')).toEqual({ result: 'wrong', waitMs: 0 });
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
  });

  it('counts wrong PINs in a row only: the right one starts the count again', async () => {
    expect(await q.setPin(PIN)).toBe(true);
    for (let i = 1; i < UNLOCK_TRIES; i += 1) expect(await q.unlock('0000')).toEqual({ result: 'wrong', waitMs: 0 });
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
    await q.relock();
    for (let i = 1; i < UNLOCK_TRIES; i += 1) expect(await q.unlock('0000')).toEqual({ result: 'wrong', waitMs: 0 });
    expect(await q.unlock(PIN)).toEqual({ result: 'ok', waitMs: 0 });
  });

  it('checks the PIN as the profile has it now, written by any worker (a restore)', async () => {
    // (Loaded first: the first load would read the profile anyway.)
    await q.reload();
    expect(await q.setPin(PIN)).toBe(true);
    await saveProfile(db, { ...emptyProfile(), parental: { salt: 'other', hash: pinHash('other', '1111') } });
    expect(await q.unlock(PIN)).toEqual({ result: 'wrong', waitMs: 0 });
    expect(await q.unlock('1111')).toEqual({ result: 'ok', waitMs: 0 });
    await saveProfile(db, emptyProfile());
    expect((await q.lockState()).pin).toBe(false);
  });

  it('starts locked in a new worker', async () => {
    await unlocked();
    q = make();
    expect(await served()).toEqual(OPEN_LIVE);
    expect((await q.lockState()).unlocked).toBe(false);
  });
});

describe('QueryService: the locks read and taken (step 38)', () => {
  it('reads the locks at the first load and again at each reload', async () => {
    await saveProfile(db, { ...emptyProfile(), parental: { adult: false } });
    // A fresh worker whose first read is `items`: the profile is read first.
    expect(await names([4])).toEqual(['Night One']);
    await saveProfile(db, emptyProfile());
    expect(await names([4])).toEqual(['Night One']);
    await q.reload();
    expect(await names([4])).toEqual([null]);
  });

  it('takes each edit at once, and never lets a read that went out before it undo it', async () => {
    const reload = q.reload();
    expect(await choose({ src: 'tv', kind: 'live', name: 'Sport' }, true)).toBe(true);
    await reload;
    expect(await served()).toEqual(['News One', 'News Two', 'News Three']);
    await q.reload();
    expect(await served()).toEqual(['News One', 'News Two', 'News Three']);
  });

  it('keeps the locks through edits of other kinds', async () => {
    expect(await q.editProfile({ kind: 'cleanNames', on: true })).toBe(true);
    expect(await q.editProfile({ kind: 'answers', answers: { language: 'ar' } })).toBe(true);
    expect(await served()).toEqual(OPEN_LIVE);
  });

  it("says which kinds have something locked, in the kinds' order", async () => {
    expect((await q.lockState()).kinds).toEqual(['live', 'movie']);
    expect(await choose({ src: 'tv', kind: 'series', name: 'Shows' }, true)).toBe(true);
    expect(await choose({ src: 'tv', kind: 'live', name: 'XXX Night' }, false)).toBe(true);
    expect(await choose({ src: 'tv', kind: 'live', name: 'Late' }, false)).toBe(true);
    expect((await q.lockState()).kinds).toEqual(['movie', 'series']);
  });

  it("locks a new catalog's adult categories from the reload after its ingest", async () => {
    await ingest(db, 'tx', [item('tx', 'live', 1, 'X One', 'XXX'), item('tx', 'live', 2, 'Y One', 'Y')], { chunkSize: 2 });
    await q.reload();
    expect(await cats('tx')).toEqual(['XXX 1 adult locked', 'Y 1']);
    expect(await served('tx')).toEqual(['Y One']);
  });
});
