/**
 * The IndexedDB schema (architecture.md §1.3) and its migrations.
 *
 * Stores (version 1, RELAY step 7):
 * - `sources_meta` (keyPath `src`): ingest bookkeeping per source, including the active catalog
 *   generation `gen` and the one being built (`SourceMeta`, catalog-store.ts);
 * - `catalog_chunks` (key `[src, gen, kind, catIdx, chunk]`): `{ items }`, up to 500 catalog
 *   items each;
 * - `catalog_cats` (key `[src, gen, kind]`): `{ cats }`, the categories with their chunk sizes;
 * - `catalog_index` (key `[src, gen, kind]`): the search segment (core `SearchSegmentData`);
 * - `profile` (keyPath `id`): the profile document (`current`) and 3 rolling snapshots
 *   (`snap:0`..`snap:2`), profile.ts;
 * - `kv`: small cached documents (the signed remote config, step 30).
 *
 * Stores added in version 2 (RELAY step 9b, epg-store.ts):
 * - `epg_meta` (keyPath `epgSrc`): refresh bookkeeping per guide, including its active generation
 *   `gen` and the one being built (`EpgMeta`);
 * - `epg_buckets` (key `[epgSrc, gen, channel, day]`): one XMLTV channel's programmes starting on
 *   one UTC day, as column arrays (core `EpgBucket` without `channel`, `day` and `merge`);
 * - `epg_channels` (key `[epgSrc, gen]`): the guide's match table (which XMLTV channel feeds which
 *   live channel, and how) and the XMLTV channels it uses.
 *
 * Everything except `profile` can be rebuilt from the provider.
 *
 * Rules for migrations:
 * - `MIGRATIONS[v]` upgrades version `v` to `v + 1`; the database version is the list's length.
 * - Append only. Never edit, reorder or remove a migration once it has shipped: installed TVs
 *   only run the ones above their stored version. `schema.test.ts` pins every version's shape.
 * - A migration never drops profile data. It runs synchronously inside the upgrade transaction
 *   (requests are fine, `await` is not); throwing aborts the whole upgrade.
 */

export const DB_NAME = 'lablo';

export const STORE = {
  sources: 'sources_meta',
  chunks: 'catalog_chunks',
  cats: 'catalog_cats',
  index: 'catalog_index',
  profile: 'profile',
  kv: 'kv',
  epgMeta: 'epg_meta',
  epgBuckets: 'epg_buckets',
  epgChannels: 'epg_channels',
} as const;

export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: readonly Migration[] = [
  // 0 → 1 (RELAY step 7): catalog, search index, profile, kv.
  (db) => {
    db.createObjectStore(STORE.sources, { keyPath: 'src' });
    db.createObjectStore(STORE.chunks);
    db.createObjectStore(STORE.cats);
    db.createObjectStore(STORE.index);
    db.createObjectStore(STORE.profile, { keyPath: 'id' });
    db.createObjectStore(STORE.kv);
  },
  // 1 → 2 (RELAY step 9b): EPG guides, programmes and match tables.
  (db) => {
    db.createObjectStore(STORE.epgMeta, { keyPath: 'epgSrc' });
    db.createObjectStore(STORE.epgBuckets);
    db.createObjectStore(STORE.epgChannels);
  },
];

export const DB_VERSION = MIGRATIONS.length;
