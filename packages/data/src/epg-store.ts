/**
 * EPG records in IndexedDB (architecture.md §1.5 steps 7-8), versioned by generation the way the
 * catalog is (catalog-store.ts):
 * 1. `beginEpgGeneration` reserves the next generation of a guide and marks it as being built;
 * 2. `putEpgBuckets` (about 10 per transaction) writes its channel-day buckets, merging a
 *    fragment (`merge: true`) into the record written before it, and `putEpgChannels` its match
 *    table;
 * 3. `commitEpgGeneration` switches `epg_meta.gen` to it in one transaction;
 * 4. `deleteEpgGeneration` removes the previous one.
 *
 * If the app dies before step 3, the active generation is untouched; the half-written one is
 * removed by `pruneEpgGenerations` at the next start. Key layout: buckets
 * `[epgSrc, gen, channel, day]` (`day` = UTC day of the starts), match tables `[epgSrc, gen]`, and
 * beside each the guide's declared channels `[epgSrc, gen, 'declared']` (step 24d), which a
 * generation's range covers too.
 * `pruneEpgDays` drops the past days a guide that can't be refreshed keeps showing.
 */

import type { ContentKey, EpgBucket, EpgMatchMethod } from '@lablo/core';
import { EPG_DAY_MINUTES, epgDay, mergeEpgBuckets, normalizeName } from '@lablo/core';
import type { FetchStamp } from './catalog-store';
import { GenerationError, otherGenerations } from './catalog-store';
import { onSuccess, transact } from './idb';
import { STORE } from './schema';

/** What a committed generation matched and kept (the diagnostics' match rate; step 24 shows it). */
export interface EpgSummary {
  /** Live channels this guide may match, and how many it does. */
  wanted: number;
  matched: number;
  byMethod: Record<EpgMatchMethod, number>;
  ambiguous: number;
  /** XMLTV channels declared, and those feeding a live channel. */
  declared: number;
  used: number;
  /** Programmes of used channels read, and kept in the window. */
  programmes: number;
  kept: number;
  buckets: number;
  pastDays: number;
  futureDays: number;
}

/**
 * Why a guide's refresh failed: the ingest's code (`http` with its status; `network`, `format`,
 * `auth`…), or `failed` for anything else. Never a URL or a message.
 */
export interface EpgFailure {
  code: string;
  status: number | null;
}

/** Refresh bookkeeping for one guide. */
export interface EpgMeta {
  epgSrc: string;
  /** Active generation (0: nothing stored yet). */
  gen: number;
  /** Generation being written (`null`: none). */
  building: number | null;
  nextGen: number;
  /** Epoch ms of the last committed refresh. */
  updatedAt: number | null;
  /** Epoch ms of the last refresh that finished: committed, or found nothing new. */
  checkedAt: number | null;
  /** Epoch ms of the last refresh that failed (cleared by one that finishes). */
  failedAt?: number | null;
  /**
   * Why the last refresh failed (step 22b: the guides screen says it), cleared with `failedAt`.
   * Optional: records written before it have none (the store is schemaless, so no migration).
   */
  failure?: EpgFailure | null;
  /** Priority among the guides at the last refresh (0 first): the tie-break between them. */
  rank: number;
  /** The download the active generation was built from (conditional fetch). */
  fetch?: FetchStamp | null;
  /**
   * What it was matched against: the ingest version, tier, catalog generations and overrides.
   * When that changes, unchanged bytes are read again.
   */
  basis?: string | null;
  /** UTC epoch minutes: the latest programme end stored (refresh when under 24 h ahead). */
  until?: number | null;
  summary?: EpgSummary | null;
  /**
   * The user's manual mappings the active generation was matched with (`epgMappingKey`, step
   * 24d; `-`: none). Other mappings make the guide due at once (`epgRefreshDue`). Optional:
   * generations committed before it had none.
   */
  mapping?: string;
}

/** Optional fields `commitEpgGeneration` and `markEpgChecked` also set. */
export type EpgMetaPatch = Partial<Pick<EpgMeta, 'fetch' | 'basis' | 'until' | 'summary' | 'rank' | 'mapping'>>;

/** One live channel's guide channel, as stored. */
export interface StoredEpgMatch {
  key: ContentKey;
  /** XMLTV channel id. */
  channel: string;
  method: EpgMatchMethod;
  ambiguous: boolean;
  /** The live channel's tvg-shift in hours, applied when reading (epg-guide.ts). */
  shift: number;
}

/** A generation's match table (`epg_channels`). */
export interface EpgChannelTable {
  matches: StoredEpgMatch[];
  /** The XMLTV channels feeding at least one live channel. */
  channels: { id: string; name: string; icon: string | null }[];
  /** Live channels this guide may match but doesn't (diagnostics, manual mapping). */
  unmatched: { key: ContentKey; name: string; epgId: string | null }[];
}

/**
 * Every XMLTV channel a generation's guide declares (step 24d), not only those in use, as columns
 * in declaration order: a live channel can be mapped by hand to one that nothing matched. Stored
 * beside the match table, so a reload never reads it.
 */
export interface EpgDeclaredChannels {
  ids: string[];
  /** The name shown: the display name for the UI languages (the id when it has none). */
  names: string[];
  /**
   * What a search looks in: `normalizeName` of each display name and of the id, joined by a
   * character no normalized name holds (so a word never runs from one name into the next). Built
   * when the guide is read, off the screens' way.
   */
  search: string[];
}

/** A declared channel, as the matcher keeps it (core `XmltvChannel` fits). */
export interface DeclaredChannel {
  id: string;
  /** The display name for the UI languages. */
  name: string;
  /** Every display name. */
  names: readonly string[];
}

/** The declared-channels record of `channels` (see `EpgDeclaredChannels`). */
export function epgDeclared(channels: readonly DeclaredChannel[]): EpgDeclaredChannels {
  const out: EpgDeclaredChannels = { ids: [], names: [], search: [] };
  for (const c of channels) {
    let search = normalizeName(c.id);
    for (const n of c.names) search += SEP + normalizeName(n);
    out.ids.push(c.id);
    out.names.push(c.name);
    out.search.push(search);
  }
  return out;
}

/** A bucket as stored: the key holds its channel and day. */
type StoredBucket = Omit<EpgBucket, 'channel' | 'day' | 'merge'>;

const SEP = String.fromCharCode(1);
const DECLARED = 'declared';
const EPG_STORES = [STORE.epgBuckets, STORE.epgChannels];
const generationRange = (epgSrc: string, gen: number): IDBKeyRange => IDBKeyRange.bound([epgSrc, gen], [epgSrc, gen, []]);
const guideRange = (epgSrc: string): IDBKeyRange => IDBKeyRange.bound([epgSrc], [epgSrc, []]);

function stored(b: EpgBucket): StoredBucket {
  return { start: b.start, end: b.end, title: b.title, sub: b.sub, desc: b.desc, category: b.category, episode: b.episode, flags: b.flags };
}

function bucketOf(channel: string, day: number, value: StoredBucket): EpgBucket {
  return { channel, day, ...value, merge: false };
}

export function newEpgMeta(epgSrc: string, rank = 0): EpgMeta {
  return { epgSrc, gen: 0, building: null, nextGen: 1, updatedAt: null, checkedAt: null, rank };
}

export function getEpgMetas(db: IDBDatabase): Promise<EpgMeta[]> {
  return transact<EpgMeta[]>(db, STORE.epgMeta, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.epgMeta).getAll(), (all) => done(all as EpgMeta[]));
  });
}

/** One guide's bookkeeping (`null`: never refreshed). */
export function getEpgMeta(db: IDBDatabase, epgSrc: string): Promise<EpgMeta | null> {
  return transact<EpgMeta | null>(db, STORE.epgMeta, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.epgMeta).get(epgSrc), (value) => done((value as EpgMeta | undefined) ?? null));
  });
}

/** Reserves a new generation of `epgSrc` and marks it as being built. Returns its number. */
export function beginEpgGeneration(db: IDBDatabase, epgSrc: string, rank = 0): Promise<number> {
  return transact<number>(db, STORE.epgMeta, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.epgMeta);
    onSuccess(store.get(epgSrc), (value) => {
      const meta = (value as EpgMeta | undefined) ?? newEpgMeta(epgSrc, rank);
      const gen = meta.nextGen;
      store.put({ ...meta, building: gen, nextGen: gen + 1 } satisfies EpgMeta);
      done(gen);
    });
  });
}

/**
 * Writes buckets of a generation in one transaction (callers batch about 10). A bucket with
 * `merge: true` is a later fragment of a channel-day: it is merged into the stored record, which
 * wins on equal starts (it came first in the guide). Fragments of one channel-day within the
 * batch are merged in memory first: a second `get` of a key would be answered before the `put`
 * that the first one's callback issues.
 */
export function putEpgBuckets(db: IDBDatabase, epgSrc: string, gen: number, buckets: readonly EpgBucket[]): Promise<void> {
  const groups = new Map<string, EpgBucket>();
  for (const b of buckets) {
    const id = b.channel + SEP + b.day;
    const before = groups.get(id);
    groups.set(id, before === undefined ? b : { ...mergeEpgBuckets(before, b), merge: before.merge });
  }
  return transact<void>(db, STORE.epgBuckets, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.epgBuckets);
    groups.forEach((b) => {
      const key = [epgSrc, gen, b.channel, b.day];
      if (!b.merge) {
        store.put(stored(b), key);
        return;
      }
      onSuccess(store.get(key), (value) => {
        const merged = value === undefined ? b : mergeEpgBuckets(bucketOf(b.channel, b.day, value as StoredBucket), b);
        store.put(stored(merged), key);
      });
    });
  });
}

/** Writes the match table of a generation. */
export function putEpgChannels(db: IDBDatabase, epgSrc: string, gen: number, table: EpgChannelTable): Promise<void> {
  return transact<void>(db, STORE.epgChannels, 'readwrite', (tx) => {
    tx.objectStore(STORE.epgChannels).put(table, [epgSrc, gen]);
  });
}

/** Writes the declared channels of a generation (step 24d). */
export function putEpgDeclared(db: IDBDatabase, epgSrc: string, gen: number, declared: EpgDeclaredChannels): Promise<void> {
  return transact<void>(db, STORE.epgChannels, 'readwrite', (tx) => {
    tx.objectStore(STORE.epgChannels).put(declared, [epgSrc, gen, DECLARED]);
  });
}

/**
 * Makes `gen` the active generation of `epgSrc` in one transaction, and returns the previous one
 * (0 if none). Fails if `gen` is not the one being built.
 */
export function commitEpgGeneration(db: IDBDatabase, epgSrc: string, gen: number, now: number, patch: EpgMetaPatch = {}): Promise<number> {
  return transact<number>(db, STORE.epgMeta, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.epgMeta);
    onSuccess(store.get(epgSrc), (value) => {
      const meta = value as EpgMeta | undefined;
      if (!meta || meta.building !== gen) throw new GenerationError(`Generation ${gen} of guide ${epgSrc} is not being built`);
      store.put({ ...meta, ...patch, gen, building: null, updatedAt: now, checkedAt: now, failedAt: null, failure: null } satisfies EpgMeta);
      done(meta.gen);
    });
  });
}

/** Records a refresh that found nothing new. No-op for an unknown guide. */
export function markEpgChecked(db: IDBDatabase, epgSrc: string, now: number, patch: EpgMetaPatch = {}): Promise<void> {
  return transact<void>(db, STORE.epgMeta, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.epgMeta);
    onSuccess(store.get(epgSrc), (value) => {
      const meta = value as EpgMeta | undefined;
      if (meta) store.put({ ...meta, ...patch, checkedAt: now, failedAt: null, failure: null } satisfies EpgMeta);
    });
  });
}

/** Records a refresh that failed and why, so it isn't retried at once (`epgRefreshDue`). */
export function markEpgFailed(db: IDBDatabase, epgSrc: string, now: number, rank = 0, failure: EpgFailure | null = null): Promise<void> {
  return transact<void>(db, STORE.epgMeta, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.epgMeta);
    onSuccess(store.get(epgSrc), (value) => {
      const meta = (value as EpgMeta | undefined) ?? newEpgMeta(epgSrc, rank);
      store.put({ ...meta, failedAt: now, failure } satisfies EpgMeta);
    });
  });
}

/**
 * Sets a stored guide's priority (step 22b: the user moved a guide), with no download: the query
 * worker orders the guides by it at its next reload. No-op for an unknown guide.
 */
export function setEpgRank(db: IDBDatabase, epgSrc: string, rank: number): Promise<void> {
  return transact<void>(db, STORE.epgMeta, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.epgMeta);
    onSuccess(store.get(epgSrc), (value) => {
      const meta = value as EpgMeta | undefined;
      if (meta) store.put({ ...meta, rank } satisfies EpgMeta);
    });
  });
}

/** Drops a generation that will never be committed, and its `building` mark. */
export function abandonEpgGeneration(db: IDBDatabase, epgSrc: string, gen: number): Promise<void> {
  return transact<void>(db, [STORE.epgMeta, ...EPG_STORES], 'readwrite', (tx) => {
    const metas = tx.objectStore(STORE.epgMeta);
    onSuccess(metas.get(epgSrc), (value) => {
      const meta = value as EpgMeta | undefined;
      if (meta && meta.building === gen) metas.put({ ...meta, building: null } satisfies EpgMeta);
    });
    if (gen > 0) for (const name of EPG_STORES) tx.objectStore(name).delete(generationRange(epgSrc, gen));
  });
}

/** Deletes every record of one generation (buckets and match table). */
export function deleteEpgGeneration(db: IDBDatabase, epgSrc: string, gen: number): Promise<void> {
  return transact<void>(db, EPG_STORES, 'readwrite', (tx) => {
    for (const name of EPG_STORES) tx.objectStore(name).delete(generationRange(epgSrc, gen));
  });
}

/**
 * Deletes the generations of `epgSrc` that are neither active nor being built (with `abandon`,
 * the one being built too: no refresh runs in this session).
 */
export function pruneEpgGenerations(db: IDBDatabase, epgSrc: string, options: { abandon?: boolean } = {}): Promise<void> {
  return transact<void>(db, [STORE.epgMeta, ...EPG_STORES], 'readwrite', (tx) => {
    const metas = tx.objectStore(STORE.epgMeta);
    onSuccess(metas.get(epgSrc), (value) => {
      const meta = value as EpgMeta | undefined;
      const keep: number[] = [];
      if (meta && meta.gen > 0) keep.push(meta.gen);
      if (meta && meta.building !== null && !options.abandon) keep.push(meta.building);
      if (meta && meta.building !== null && options.abandon) metas.put({ ...meta, building: null } satisfies EpgMeta);
      const ranges = otherGenerations(epgSrc, keep);
      for (const name of EPG_STORES) {
        const store = tx.objectStore(name);
        for (const range of ranges) store.delete(range);
      }
    });
  });
}

/** Deletes a guide: its bookkeeping and every generation. */
export function deleteEpgSource(db: IDBDatabase, epgSrc: string): Promise<void> {
  return transact<void>(db, [STORE.epgMeta, ...EPG_STORES], 'readwrite', (tx) => {
    tx.objectStore(STORE.epgMeta).delete(epgSrc);
    for (const name of EPG_STORES) tx.objectStore(name).delete(guideRange(epgSrc));
  });
}

/**
 * The first UTC day a guide still needs at `nowMs`, keeping `pastDays` of past programmes: a
 * programme starting the day before the window can still be on air at its start (24 h at most).
 */
export function epgFirstDay(nowMs: number, pastDays: number): number {
  return epgDay(Math.floor(nowMs / 60_000) - pastDays * EPG_DAY_MINUTES) - 1;
}

/**
 * Deletes the active generation's buckets of days before `firstDay`, for every channel of its
 * match table (the past days "pruned daily" of §1.5 step 8, for a guide that can't be refreshed).
 * Returns how many channels were pruned.
 */
export function pruneEpgDays(db: IDBDatabase, epgSrc: string, firstDay: number): Promise<number> {
  return transact<number>(db, [STORE.epgMeta, ...EPG_STORES], 'readwrite', (tx, done) => {
    done(0);
    onSuccess(tx.objectStore(STORE.epgMeta).get(epgSrc), (value) => {
      const meta = value as EpgMeta | undefined;
      if (!meta || meta.gen === 0) return;
      const gen = meta.gen;
      onSuccess(tx.objectStore(STORE.epgChannels).get([epgSrc, gen]), (table) => {
        if (!table) return;
        const buckets = tx.objectStore(STORE.epgBuckets);
        const channels = (table as EpgChannelTable).channels;
        // `[epgSrc, gen, channel]` sorts before every day of that channel.
        for (const c of channels) buckets.delete(IDBKeyRange.bound([epgSrc, gen, c.id], [epgSrc, gen, c.id, firstDay], false, true));
        done(channels.length);
      });
    });
  });
}

/** Reads match tables in one transaction (missing: `null`). */
export function readEpgChannels(db: IDBDatabase, keys: readonly { epgSrc: string; gen: number }[]): Promise<(EpgChannelTable | null)[]> {
  return transact<(EpgChannelTable | null)[]>(db, STORE.epgChannels, 'readonly', (tx, done) => {
    const store = tx.objectStore(STORE.epgChannels);
    const out: (EpgChannelTable | null)[] = keys.map(() => null);
    done(out);
    keys.forEach((k, i) => {
      onSuccess(store.get([k.epgSrc, k.gen]), (value) => {
        out[i] = (value as EpgChannelTable | undefined) ?? null;
      });
    });
  });
}

/**
 * Reads the declared channels of a generation (step 24d): `null` when it has none stored, as a
 * generation read before step 24d (`EPG_INGEST_VERSION` 1) doesn't.
 */
export function readEpgDeclared(db: IDBDatabase, epgSrc: string, gen: number): Promise<EpgDeclaredChannels | null> {
  return transact<EpgDeclaredChannels | null>(db, STORE.epgChannels, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.epgChannels).get([epgSrc, gen, DECLARED]), (value) => done((value as EpgDeclaredChannels | undefined) ?? null));
  });
}

/** Key of a stored bucket. */
export interface EpgBucketKey {
  epgSrc: string;
  gen: number;
  channel: string;
  day: number;
}

/** Reads buckets in one transaction (missing: `null`). */
export function readEpgBuckets(db: IDBDatabase, keys: readonly EpgBucketKey[]): Promise<(EpgBucket | null)[]> {
  return transact<(EpgBucket | null)[]>(db, STORE.epgBuckets, 'readonly', (tx, done) => {
    const store = tx.objectStore(STORE.epgBuckets);
    const out: (EpgBucket | null)[] = keys.map(() => null);
    done(out);
    keys.forEach((k, i) => {
      onSuccess(store.get([k.epgSrc, k.gen, k.channel, k.day]), (value) => {
        out[i] = value === undefined ? null : bucketOf(k.channel, k.day, value as StoredBucket);
      });
    });
  });
}
