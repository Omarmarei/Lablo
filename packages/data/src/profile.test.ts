import { describe, expect, it } from 'vitest';
import { openDatabase, transact } from './idb';
import type { EpgPin } from './epg-overrides';
import { epgOverridesOf } from './epg-overrides';
import type { StoredGuide, UserGuide } from './epg-sources';
import { EPG_OFFSET_MAX, EPG_OFFSET_STEP, epgOffsetsOf, isEpgOffset } from './epg-sources';
import type { AnyProfile, GuideChange, LastChannel, PlayerChange, ProfileDoc, ProfileMigration, ShowProgress, SourceRecord, SourceRecordV3, SourceRecordV7, StoredSource, StoredTrackChoice, WatchProgress } from './profile';
import { MAX_NOTICES } from './config-constants';
import { backupDoc } from './logins';
import {
  MAX_CHANNELS,
  MAX_PROGRESS,
  MAX_SHOWS,
  MAX_TRACK_CHOICES,
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  ProfileError,
  SNAPSHOT_EVERY_MS,
  applyProfileEdit,
  emptyProfile,
  isShowProgress,
  isWatchProgress,
  listSnapshots,
  loadProfile,
  migrateProfile,
  noPlayerMemory,
  readEpgOffsets,
  readEpgOverrides,
  restoreSnapshot,
  putProfileIfNone,
  putProfileOver,
  saveProfile,
  storedProfileDoc,
  updateProfile,
} from './profile';
import { STORE } from './schema';
import { freshFactory } from './test-support';

const DAY = SNAPSHOT_EVERY_MS;
const fav = (n: number): ProfileDoc['favourites'][number] => ({ key: `x:tv:live:${n}`, src: 'tv', kind: 'live', normName: `ch ${n}`, added: n, missingSince: null });
/** A current (version 6) profile with these favourites. */
const withFavs = (...ns: number[]): ProfileDoc => ({ ...emptyProfile(), favourites: ns.map(fav) });
/** A version 1 document, as step 7 stored it. */
const v1 = (...ns: number[]): AnyProfile => ({ v: 1, favourites: ns.map(fav) });
const NO_ANSWERS = { language: null, disclaimerAt: null, consent: null };
const xtreamSource = (id: string, name = 'Home'): SourceRecordV7 => ({
  id,
  type: 'xtream',
  name,
  account: { base: 'http://panel.test', username: 'u', password: 'p' },
  added: 7,
});
/** A source as versions 2 and 3 stored it, with the guide link typed in onboarding. */
const v3Source = (id: string, epgUrl: string | null = null): SourceRecordV3 => ({ ...xtreamSource(id), epgUrl });

async function writeCurrent(db: IDBDatabase, doc: unknown): Promise<void> {
  await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc }));
}

// Synthetic future versions: 2 renames `favourites` to `favouriteLists`, 3 adds `settings`.
const toV2: ProfileMigration = ({ favourites, ...rest }) => ({ ...rest, v: 2, favouriteLists: [{ name: 'Favourites', items: favourites }] });
const toV3: ProfileMigration = (doc) => ({ ...doc, v: 3, settings: { language: 'ar' } });

describe('profile migrations', () => {
  it('is at version 9, with the shape of every version pinned', () => {
    expect(PROFILE_VERSION).toBe(9);
    expect(PROFILE_VERSION).toBe(PROFILE_MIGRATIONS.length + 1);
    const NOTHING_KEPT = { last: null, containers: {}, redirects: {}, tracks: {}, subtitleSize: null };
    expect(noPlayerMemory()).toEqual(NOTHING_KEPT);
    expect(emptyProfile()).toEqual({ v: 9, favourites: [], sources: [], onboarding: NO_ANSWERS, player: NOTHING_KEPT, guides: [], progress: {}, shows: {}, channels: [] });
    // 1 → 2 (step 13b): the favourites stay; no sources and no answers yet.
    expect(PROFILE_MIGRATIONS[0]!(v1(1, 2))).toEqual({ v: 2, favourites: [fav(1), fav(2)], sources: [], onboarding: NO_ANSWERS });
    // 2 → 3 (step 20c1): nothing kept for the player yet; the rest stays.
    const v2 = { v: 2, favourites: [fav(1)], sources: [v3Source('s1', 'http://g.test/a.xml')], onboarding: { ...NO_ANSWERS, language: 'ar' } };
    expect(PROFILE_MIGRATIONS[1]!(v2)).toEqual({ ...v2, v: 3, player: NOTHING_KEPT });
    // 3 → 4 (step 22b): the sources' guide links become the guide list, under the sources' ids.
    const v3 = { ...v2, v: 3, player: NOTHING_KEPT };
    expect(PROFILE_MIGRATIONS[2]!(v3)).toEqual({ ...v3, v: 4, sources: [xtreamSource('s1')], guides: [{ id: 's1', url: 'http://g.test/a.xml' }] });
    // 4 → 5 (step 26d): no movie left part way yet; the rest stays.
    const v4 = { ...v3, v: 4, sources: [xtreamSource('s1')], guides: [{ id: 's1', url: 'http://g.test/a.xml' }], epgOffsets: { 'u~s1': 30 } };
    expect(PROFILE_MIGRATIONS[3]!(v4)).toEqual({ ...v4, v: 5, progress: {} });
    // 5 → 6 (step 27c1): no show's episode played yet; the movies' places stay.
    const v5 = { ...v4, v: 5, progress: { 'x:s1:movie:201': { positionMs: 60_000, lengthMs: 600_000, updated: 3 } } };
    expect(PROFILE_MIGRATIONS[4]!(v5)).toEqual({ ...v5, v: 6, shows: {} });
    // 6 → 7 (step 28b2): the channel played last leads the channels played last; with none, none.
    const v6 = { ...v5, v: 6, shows: { 'x:s1:series:301': { episode: 'x:s1:episode:3002', watched: false, updated: 4 } } };
    expect(PROFILE_MIGRATIONS[5]!(v6)).toEqual({ ...v6, v: 7, channels: [] });
    const playing = { ...v6, player: { ...NOTHING_KEPT, last: { item: { key: 'x:s1:live:1' }, number: 1, category: null, index: 0, started: 2 } } };
    expect(PROFILE_MIGRATIONS[5]!(playing)).toEqual({ ...playing, v: 7, channels: [playing.player.last] });
    // A player section that isn't one keeps no channel (and is left as it is).
    for (const player of [null, 'x', undefined]) expect(PROFILE_MIGRATIONS[5]!({ ...v6, player })).toEqual({ ...v6, player, v: 7, channels: [] });
    // 7 → 8 (step 31d2b1): only the version (an older app must not read a file source as a link).
    const v7 = { ...playing, v: 7, channels: [playing.player.last], sources: [xtreamSource('s1'), { id: 's2', type: 'm3u', name: 'Link', url: 'http://p.test/list.m3u', added: 2 }], noticesShown: ['r1'] };
    expect(PROFILE_MIGRATIONS[6]!(v7)).toEqual({ ...v7, v: 8 });
    expect(migrateProfile(v7)).toEqual({ doc: { ...v7, v: 9 }, from: 7, migrated: true, newer: false });
    // 8 → 9 (step 32d4a): only the version (every version 8 source and guide has its login).
    const v8 = { ...v7, v: 8, sources: [...v7.sources, { id: 's3', type: 'm3u-file', name: 'Phone', added: 3 }] };
    expect(PROFILE_MIGRATIONS[7]!(v8)).toEqual({ ...v8, v: 9 });
    expect(migrateProfile(v8)).toEqual({ doc: { ...v8, v: 9 }, from: 8, migrated: true, newer: false });
    expect(migrateProfile(v1(1, 2))).toEqual({
      doc: { v: 9, favourites: [fav(1), fav(2)], sources: [], onboarding: NO_ANSWERS, player: NOTHING_KEPT, guides: [], progress: {}, shows: {}, channels: [] },
      from: 1,
      migrated: true,
      newer: false,
    });
    expect(migrateProfile(v2)).toMatchObject({
      doc: { ...v2, v: 9, sources: [xtreamSource('s1')], player: NOTHING_KEPT, guides: [{ id: 's1', url: 'http://g.test/a.xml' }], progress: {}, shows: {}, channels: [] },
      from: 2,
      migrated: true,
    });
    // Fields an older document had that the new version doesn't name are kept, never dropped.
    expect(migrateProfile({ ...v1(), kept: 'x' }).doc).toMatchObject({ v: 9, kept: 'x' });
    expect(migrateProfile(v4)).toEqual({ doc: { ...v4, v: 9, progress: {}, shows: {}, channels: [] }, from: 4, migrated: true, newer: false });
    expect(migrateProfile(v5)).toEqual({ doc: { ...v5, v: 9, shows: {}, channels: [] }, from: 5, migrated: true, newer: false });
    expect(migrateProfile(playing)).toEqual({ doc: { ...playing, v: 9, channels: [playing.player.last] }, from: 6, migrated: true, newer: false });
  });

  it('upgrades a stored version 4 profile on load, keeping the old one as a snapshot (4 to 9, steps 26d, 27c1, 28b2, 31d2b1 and 32d4a)', async () => {
    const db = await openDatabase(freshFactory());
    // A version 4 document as steps 22b–26c wrote it: the guides, an offset, a mapping, the player's memory.
    const v4 = {
      v: 4,
      favourites: [fav(1)],
      sources: [xtreamSource('s1')],
      onboarding: { ...NO_ANSWERS, language: 'ar' },
      player: { ...noPlayerMemory(), containers: { s1: 'hls' }, picture: 'zoom' },
      guides: [{ id: 's1', url: 'http://g.test/a.xml' }],
      epgOffsets: { 'u~s1': -60 },
      epgOverrides: { 'x:s1:live:1': { epgSrc: 's1:xmltv', channel: 'one.tv' } },
    };
    await writeCurrent(db, v4);
    const loaded = await loadProfile(db, { now: 5 * DAY });
    expect(loaded).toEqual({ doc: { ...v4, v: 9, progress: {}, shows: {}, channels: [] }, newer: false, migratedFrom: 4 });
    const snaps = await listSnapshots(db);
    expect(snaps.map((s) => [s.reason, s.doc])).toEqual([['migration', v4]]);
    // The first position saved after it lands in the upgraded document.
    const saved: WatchProgress = { positionMs: 754_000, lengthMs: 888_000, updated: 6 * DAY };
    expect(await updateProfile(db, (doc) => applyProfileEdit(doc, { kind: 'progress', key: 'x:s1:movie:202', progress: saved }), { now: 6 * DAY })).toBe(true);
    expect((await loadProfile(db))!.doc).toEqual({ ...v4, v: 9, progress: { 'x:s1:movie:202': saved }, shows: {}, channels: [] });
    db.close();
  });

  it("upgrades a stored version 5 profile on load, then keeps a show's last episode in it (5 to 9, steps 27c1, 28b2, 31d2b1 and 32d4a)", async () => {
    const db = await openDatabase(freshFactory());
    const kept: WatchProgress = { positionMs: 754_000, lengthMs: 888_000, updated: 4 * DAY };
    const v5 = { ...emptyProfile(), v: 5, favourites: [fav(1)], sources: [xtreamSource('s1')], progress: { 'x:s1:movie:202': kept } } as AnyProfile;
    delete v5['shows'];
    delete v5['channels'];
    await writeCurrent(db, v5);
    const loaded = await loadProfile(db, { now: 5 * DAY });
    expect(loaded).toEqual({ doc: { ...v5, v: 9, shows: {}, channels: [] }, newer: false, migratedFrom: 5 });
    expect((await listSnapshots(db)).map((s) => [s.reason, s.doc])).toEqual([['migration', v5]]);
    const last: ShowProgress = { episode: 'x:s1:episode:3002', watched: false, updated: 6 * DAY };
    const place: WatchProgress = { positionMs: 40_000, lengthMs: 300_000, updated: 6 * DAY };
    expect(await updateProfile(db, (doc) => applyProfileEdit(doc, { kind: 'episode', show: 'x:s1:series:301', last, progress: place }), { now: 6 * DAY })).toBe(true);
    expect((await loadProfile(db))!.doc).toEqual({ ...v5, v: 9, progress: { 'x:s1:movie:202': kept, 'x:s1:episode:3002': place }, shows: { 'x:s1:series:301': last }, channels: [] });
    db.close();
  });

  it('upgrades a stored version 6 profile on load: its last channel leads the channels played last (6 to 9, steps 28b2, 31d2b1 and 32d4a)', async () => {
    const db = await openDatabase(freshFactory());
    const one = { item: { key: 'x:s1:live:1', src: 's1', kind: 'live', name: 'One', url: 'http://panel.test/live/u/p/1.ts' }, number: 1, category: { src: 's1', name: 'News' }, index: 0, started: 3 * DAY };
    const v6 = { ...emptyProfile(), v: 6, sources: [xtreamSource('s1')], player: { ...noPlayerMemory(), last: one } } as AnyProfile;
    delete v6['channels'];
    await writeCurrent(db, v6);
    expect(await loadProfile(db, { now: 5 * DAY })).toEqual({ doc: { ...v6, v: 9, channels: [one] }, newer: false, migratedFrom: 6 });
    expect((await listSnapshots(db)).map((s) => [s.reason, s.doc])).toEqual([['migration', v6]]);
    // The next channel played comes first.
    const two = { ...one, item: { ...one.item, key: 'x:s1:live:2', name: 'Two' }, number: 2, index: 1, started: 6 * DAY } as LastChannel;
    expect(await updateProfile(db, (doc) => applyProfileEdit(doc, { kind: 'player', change: { field: 'last', last: two } }), { now: 6 * DAY })).toBe(true);
    expect((await loadProfile(db))!.doc).toMatchObject({ v: 9, player: { last: two }, channels: [two, one] });
    db.close();
  });

  it("moves each source's guide link to the guide list in source order, once per link (3 to 4)", () => {
    const migrate = PROFILE_MIGRATIONS[2]!;
    const v3 = (sources: unknown): AnyProfile => ({ v: 3, favourites: [], sources, onboarding: NO_ANSWERS, player: noPlayerMemory(), kept: 1 });
    const start = v3([v3Source('s1', 'http://g.test/a.xml'), v3Source('s2'), v3Source('s3', 'http://g.test/b.xml'), v3Source('s4', 'http://g.test/a.xml'), v3Source('s5', '')]);
    const frozen = JSON.stringify(start);
    const out = migrate(start);
    expect(out).toEqual({
      ...start,
      v: 4,
      // Every field but the link stays on each source.
      sources: ['s1', 's2', 's3', 's4', 's5'].map((id) => xtreamSource(id)),
      // s4 shares s1's link (the refresh read it once, as `u~s1`); s2 has none, s5 an empty one.
      guides: [
        { id: 's1', url: 'http://g.test/a.xml' },
        { id: 's3', url: 'http://g.test/b.xml' },
      ],
    });
    expect(JSON.stringify(start)).toBe(frozen);
    // Sources that aren't a list, or entries that aren't records, stay as they are.
    expect(migrate(v3('odd'))).toEqual({ ...v3('odd'), v: 4, guides: [] });
    expect(migrate(v3([null, 7, { epgUrl: 'http://g.test/c.xml' }]))).toEqual({ ...v3([null, 7, {}]), v: 4, guides: [] });
    const none: AnyProfile = { v: 3, favourites: [], onboarding: NO_ANSWERS, player: noPlayerMemory() };
    expect(migrate(none)).toEqual({ ...none, v: 4, guides: [] });
  });

  it('upgrades from every earlier version, step by step, without touching the input', () => {
    const start = v1(1, 2);
    const frozen = JSON.stringify(start);
    const fromV1 = migrateProfile(start, [toV2, toV3]);
    expect(fromV1).toEqual({
      doc: { v: 3, favouriteLists: [{ name: 'Favourites', items: [fav(1), fav(2)] }], settings: { language: 'ar' } },
      from: 1,
      migrated: true,
      newer: false,
    });
    expect(JSON.stringify(start)).toBe(frozen);
    const fromV2 = migrateProfile(toV2(JSON.parse(frozen) as AnyProfile), [toV2, toV3]);
    expect(fromV2.doc).toEqual(fromV1.doc);
    expect(fromV2.from).toBe(2);
    expect(migrateProfile(fromV1.doc, [toV2, toV3])).toMatchObject({ migrated: false, newer: false });
    expect(migrateProfile(fromV1.doc, [toV2])).toMatchObject({ migrated: false, newer: true, from: 3 });
  });

  it('rejects documents without a version and migrations that skip one', () => {
    for (const bad of [null, 'x', {}, { v: 0 }, { v: 1.5 }, { v: '1' }]) expect(() => migrateProfile(bad)).toThrow(ProfileError);
    expect(() => migrateProfile({ v: 1 }, [(d) => ({ ...d, v: 3 })])).toThrow(/returned version 3/);
  });
});

describe('profile storage', () => {
  it('returns null when there is no profile, and loads what was saved', async () => {
    const db = await openDatabase(freshFactory());
    expect(await loadProfile(db)).toBeNull();
    await saveProfile(db, withFavs(1), { now: 10 });
    expect(await loadProfile(db)).toEqual({ doc: withFavs(1), newer: false, migratedFrom: null });
    db.close();
  });

  it('upgrades an old stored profile in place and keeps the old document as a snapshot', async () => {
    const db = await openDatabase(freshFactory());
    await writeCurrent(db, v1(1, 2));
    const loaded = await loadProfile(db, { now: 50, migrations: [toV2, toV3] });
    expect(loaded).toMatchObject({ migratedFrom: 1, newer: false, doc: { v: 3 } });
    const snaps = await listSnapshots(db);
    expect(snaps).toEqual([{ id: 'snap:0', savedAt: 50, doc: v1(1, 2), reason: 'migration' }]);
    // The upgrade was written: the next load has nothing to migrate.
    expect(await loadProfile(db, { now: 60, migrations: [toV2, toV3] })).toMatchObject({ migratedFrom: null, doc: { v: 3 } });
    db.close();
  });

  it('upgrades a stored version 1 profile with the real migrations', async () => {
    const db = await openDatabase(freshFactory());
    await writeCurrent(db, v1(4));
    expect(await loadProfile(db, { now: 70 })).toEqual({ doc: withFavs(4), newer: false, migratedFrom: 1 });
    expect(await listSnapshots(db)).toEqual([{ id: 'snap:0', savedAt: 70, doc: v1(4), reason: 'migration' }]);
    expect(await loadProfile(db)).toEqual({ doc: withFavs(4), newer: false, migratedFrom: null });
    db.close();
  });

  it('keeps the stored profile untouched when a migration fails', async () => {
    const db = await openDatabase(freshFactory());
    await writeCurrent(db, v1(3));
    const failing: ProfileMigration = () => {
      throw new Error('bad migration');
    };
    await expect(loadProfile(db, { migrations: [failing] })).rejects.toThrow('bad migration');
    // Still the version 1 document (read by an app with no migrations, so nothing is upgraded).
    expect(await loadProfile(db, { migrations: [] })).toEqual({ doc: v1(3), newer: false, migratedFrom: null });
    expect(await listSnapshots(db)).toEqual([]);
    db.close();
  });

  it('shows a newer profile but never saves over it', async () => {
    const db = await openDatabase(freshFactory());
    await writeCurrent(db, { v: 10, favourites: [], future: true });
    expect(await loadProfile(db)).toEqual({ doc: { v: 10, favourites: [], future: true }, newer: true, migratedFrom: null });
    await expect(saveProfile(db, withFavs(1))).rejects.toThrow(/newer app version/);
    expect((await loadProfile(db))!.doc).toMatchObject({ v: 10, future: true });
    expect(() => saveProfile(db, { v: 10 } as unknown as ProfileDoc)).toThrow(/Can't save a version 10/);
    db.close();
  });

  it('snapshots the replaced document at most once a day, in 3 rolling slots', async () => {
    const db = await openDatabase(freshFactory());
    await saveProfile(db, withFavs(0), { now: 0 }); // nothing to snapshot yet
    expect(await listSnapshots(db)).toEqual([]);
    await saveProfile(db, withFavs(1), { now: 1 }); // first snapshot: of favs(0)
    await saveProfile(db, withFavs(2), { now: 2 }); // same day: none
    await saveProfile(db, withFavs(3), { now: DAY + 1 }); // of favs(2)
    await saveProfile(db, withFavs(4), { now: 2 * DAY + 1 }); // of favs(3)
    await saveProfile(db, withFavs(5), { now: 3 * DAY + 1 }); // of favs(4), replaces the oldest
    const snaps = await listSnapshots(db);
    expect(snaps.map((s) => [s.id, s.savedAt, s.doc.favourites])).toEqual([
      ['snap:0', 3 * DAY + 1, [fav(4)]],
      ['snap:2', 2 * DAY + 1, [fav(3)]],
      ['snap:1', DAY + 1, [fav(2)]],
    ]);
    expect((await loadProfile(db))!.doc).toEqual(withFavs(5));
    db.close();
  });

  it('restores a snapshot and keeps the replaced document, so a rollback can be undone', async () => {
    const db = await openDatabase(freshFactory());
    await saveProfile(db, withFavs(0), { now: 0 });
    await saveProfile(db, withFavs(1), { now: 1 });
    await saveProfile(db, withFavs(2), { now: DAY + 1 });
    await saveProfile(db, withFavs(3), { now: 2 * DAY + 1 });
    // Slots now: snap:0 = favs(0), snap:1 = favs(1), snap:2 = favs(2).
    await restoreSnapshot(db, 'snap:0', { now: 3 * DAY });
    expect((await loadProfile(db))!.doc).toEqual(withFavs(0));
    const snaps = await listSnapshots(db);
    expect(snaps.find((s) => s.id === 'snap:0')!.doc).toEqual(withFavs(0));
    expect(snaps.find((s) => s.reason === 'restore')).toMatchObject({ id: 'snap:1', doc: withFavs(3) });
    await restoreSnapshot(db, 'snap:1', { now: 3 * DAY + 5 });
    expect((await loadProfile(db))!.doc).toEqual(withFavs(3));
    await expect(restoreSnapshot(db, 'snap:9')).rejects.toThrow(/No profile snapshot snap:9/);
    db.close();
  });
});

describe('the stored document for the backup (step 32c1)', () => {
  it('reads the current document as it is stored: an older one not upgraded, nothing written', async () => {
    const db = await openDatabase(freshFactory());
    expect(await storedProfileDoc(db)).toBeUndefined();
    await writeCurrent(db, v1(1, 2));
    expect(await storedProfileDoc(db)).toEqual(v1(1, 2));
    expect(await storedProfileDoc(db)).toEqual(v1(1, 2));
    expect(await listSnapshots(db)).toEqual([]);
    await writeCurrent(db, 'not a profile');
    expect(await storedProfileDoc(db)).toBe('not a profile');
    db.close();
  });

  it("puts a restored document only where there is none, in the caller's transaction", async () => {
    const db = await openDatabase(freshFactory());
    const put = (doc: AnyProfile, now: number): Promise<boolean> =>
      transact<boolean>(db, STORE.profile, 'readwrite', (tx, done) => {
        putProfileIfNone(tx.objectStore(STORE.profile), doc, now, done);
      });
    expect(await put(withFavs(1), 5 * DAY)).toBe(true);
    expect(await transact<unknown>(db, STORE.profile, 'readonly', (tx, done) => onRequest(tx.objectStore(STORE.profile).get('current'), done))).toEqual({ id: 'current', savedAt: 5 * DAY, doc: withFavs(1) });
    expect(await put(withFavs(2), 6 * DAY)).toBe(false);
    expect((await loadProfile(db))!.doc).toEqual(withFavs(1));
    // A broken document there counts as one.
    await writeCurrent(db, null);
    expect(await put(withFavs(3), 7 * DAY)).toBe(false);
    expect(await listSnapshots(db)).toEqual([]);
    db.close();
  });

  it('puts a held backup over the profile, the replaced one kept as a snapshot (step 32d2a)', async () => {
    const db = await openDatabase(freshFactory());
    const over = (doc: AnyProfile, now: number): Promise<boolean> =>
      transact<boolean>(db, STORE.profile, 'readwrite', (tx, done) => {
        putProfileOver(tx.objectStore(STORE.profile), doc, now, done);
      });
    const current = (): Promise<unknown> => transact<unknown>(db, STORE.profile, 'readonly', (tx, done) => onRequest(tx.objectStore(STORE.profile).get('current'), done));
    // None there: put, no snapshot.
    expect(await over(withFavs(1), 5 * DAY)).toBe(true);
    expect(await current()).toEqual({ id: 'current', savedAt: 5 * DAY, doc: withFavs(1) });
    expect(await listSnapshots(db)).toEqual([]);
    // Over one: the old one in a slot as `restore`, whatever the newest snapshot's age.
    expect(await over(withFavs(2), 5 * DAY + 1)).toBe(true);
    expect(await current()).toEqual({ id: 'current', savedAt: 5 * DAY + 1, doc: withFavs(2) });
    expect(await listSnapshots(db)).toEqual([{ id: 'snap:0', savedAt: 5 * DAY + 1, doc: withFavs(1), reason: 'restore' }]);
    await over(withFavs(3), 5 * DAY + 2);
    await over(withFavs(4), 5 * DAY + 3);
    // Three slots full: the oldest goes.
    await over(withFavs(5), 5 * DAY + 4);
    expect((await listSnapshots(db)).map((s) => [s.id, s.doc])).toEqual([
      ['snap:0', withFavs(4)],
      ['snap:2', withFavs(3)],
      ['snap:1', withFavs(2)],
    ]);
    // A broken document is written over, and kept.
    await writeCurrent(db, null);
    expect(await over(withFavs(6), 6 * DAY)).toBe(true);
    expect((await listSnapshots(db))[0]).toMatchObject({ savedAt: 6 * DAY, doc: null, reason: 'restore' });
    await writeCurrent(db, undefined);
    expect(await over(withFavs(7), 6 * DAY + 1)).toBe(true);
    await writeCurrent(db, 'text');
    expect(await over(withFavs(7), 6 * DAY + 1)).toBe(true);
    await writeCurrent(db, { v: 'x' });
    expect(await over(withFavs(7), 6 * DAY + 1)).toBe(true);
    // A newer app's document never is.
    const newer = { ...withFavs(8), v: PROFILE_VERSION + 1 };
    await writeCurrent(db, newer);
    expect(await over(withFavs(9), 7 * DAY)).toBe(false);
    expect(await current()).toMatchObject({ doc: newer });
    expect((await listSnapshots(db))[0]!.savedAt).toBe(6 * DAY + 1);
    // This version's is.
    await writeCurrent(db, { ...withFavs(8), v: PROFILE_VERSION });
    expect(await over(withFavs(9), 7 * DAY)).toBe(true);
    db.close();
  });
});

/** Hands a request's result to `done` when it succeeds. */
function onRequest(request: IDBRequest, done: (value: unknown) => void): void {
  request.onsuccess = () => done(request.result);
}

describe('updateProfile', () => {
  it('reads, changes and writes the current profile in one transaction', async () => {
    const db = await openDatabase(freshFactory());
    expect(await updateProfile(db, () => withFavs(9))).toBe(false);
    expect(await loadProfile(db)).toBeNull();
    await saveProfile(db, withFavs(1), { now: 0 });
    let seen: ProfileDoc | null = null;
    expect(
      await updateProfile(
        db,
        (doc) => {
          seen = doc;
          return { ...doc, favourites: [...doc.favourites, fav(2)] };
        },
        { now: 5 },
      ),
    ).toBe(true);
    expect(seen).toEqual(withFavs(1));
    expect((await loadProfile(db))!.doc).toEqual(withFavs(1, 2));
    // Returning null writes nothing.
    expect(await updateProfile(db, () => null, { now: 6 })).toBe(false);
    expect((await loadProfile(db))!.doc).toEqual(withFavs(1, 2));
    db.close();
  });

  it('snapshots like saveProfile, upgrades old documents and never writes over a newer one', async () => {
    const db = await openDatabase(freshFactory());
    await saveProfile(db, withFavs(1), { now: 0 });
    await updateProfile(db, (doc) => ({ ...doc, favourites: [fav(2)] }), { now: DAY });
    expect((await listSnapshots(db)).map((s) => [s.reason, s.doc])).toEqual([['daily', withFavs(1)]]);

    // A version 1 document: upgraded before the update sees it, the old one snapshotted.
    await writeCurrent(db, v1(2));
    let seen: ProfileDoc | null = null;
    const update = (doc: ProfileDoc): ProfileDoc => {
      seen = doc;
      return { ...doc, favourites: [fav(3)] };
    };
    expect(await updateProfile(db, update, { now: DAY + 1 })).toBe(true);
    expect(seen).toEqual(withFavs(2));
    expect((await listSnapshots(db))[0]).toMatchObject({ reason: 'migration', doc: v1(2) });
    expect((await loadProfile(db))!.doc).toEqual(withFavs(3));
    // An app that only knows version 1 sees a newer document and leaves it alone.
    await expect(updateProfile(db, (doc) => doc, { migrations: [] })).resolves.toBe(false);

    await writeCurrent(db, { v: 10, favourites: [] });
    expect(await updateProfile(db, () => withFavs(3))).toBe(false);
    db.close();
  });

  it('rejects (and writes nothing) when the update returns another version', async () => {
    const db = await openDatabase(freshFactory());
    await saveProfile(db, withFavs(1), { now: 0 });
    await expect(updateProfile(db, (doc) => ({ ...doc, v: 10 }) as unknown as ProfileDoc)).rejects.toThrow(ProfileError);
    expect((await loadProfile(db))!.doc).toEqual(withFavs(1));
    db.close();
  });

  it('creates the profile from an empty one only when asked to', async () => {
    const db = await openDatabase(freshFactory());
    // A refresh's favourites update never creates one.
    expect(await updateProfile(db, (doc) => ({ ...doc, favourites: [fav(1)] }))).toBe(false);
    expect(await loadProfile(db)).toBeNull();
    let seen: ProfileDoc | null = null;
    const answer = (doc: ProfileDoc): ProfileDoc => {
      seen = doc;
      return { ...doc, onboarding: { ...doc.onboarding, language: 'ar' } };
    };
    expect(await updateProfile(db, answer, { create: true, now: 3 })).toBe(true);
    expect(seen).toEqual(emptyProfile());
    expect((await loadProfile(db))!.doc).toEqual({ ...emptyProfile(), onboarding: { ...NO_ANSWERS, language: 'ar' } });
    // Nothing to snapshot: there was no document before.
    expect(await listSnapshots(db)).toEqual([]);
    // With a profile there, `create` changes nothing: the stored one is updated.
    expect(await updateProfile(db, (doc) => ({ ...doc, favourites: [fav(2)] }), { create: true, now: 4 })).toBe(true);
    expect((await loadProfile(db))!.doc).toMatchObject({ favourites: [fav(2)], onboarding: { language: 'ar' } });
    db.close();
  });
});

describe('applyProfileEdit', () => {
  it('sets the answers given and leaves the others; the same answers change nothing', () => {
    const doc = withFavs(1);
    const one = applyProfileEdit(doc, { kind: 'answers', answers: { language: 'ar' } });
    expect(one).toEqual({ ...doc, onboarding: { ...NO_ANSWERS, language: 'ar' } });
    expect(doc.onboarding).toEqual(NO_ANSWERS);
    const two = applyProfileEdit(one!, { kind: 'answers', answers: { disclaimerAt: 5, consent: false } });
    expect(two!.onboarding).toEqual({ language: 'ar', disclaimerAt: 5, consent: false });
    expect(applyProfileEdit(two!, { kind: 'answers', answers: { language: 'ar', consent: false } })).toBeNull();
    expect(applyProfileEdit(two!, { kind: 'answers', answers: {} })).toBeNull();
    // A language can be cleared again (back to the TV's).
    expect(applyProfileEdit(two!, { kind: 'answers', answers: { language: null } })!.onboarding.language).toBeNull();
    expect(applyProfileEdit(two!, { kind: 'answers', answers: { consent: true } })!.onboarding.consent).toBe(true);
  });

  it('adds a source at the end, and replaces one with the same id in place', () => {
    const doc = withFavs(1);
    const a = applyProfileEdit(doc, { kind: 'source', source: xtreamSource('s1', 'A') })!;
    const b = applyProfileEdit(a, { kind: 'source', source: xtreamSource('s2', 'B') })!;
    expect(b.sources.map((s) => [s.id, s.name])).toEqual([
      ['s1', 'A'],
      ['s2', 'B'],
    ]);
    const renamed = applyProfileEdit(b, { kind: 'source', source: xtreamSource('s1', 'A2') })!;
    expect(renamed.sources.map((s) => [s.id, s.name])).toEqual([
      ['s1', 'A2'],
      ['s2', 'B'],
    ]);
    expect(b.sources.map((s) => s.name)).toEqual(['A', 'B']);
    expect(renamed.favourites).toEqual([fav(1)]);
    expect(doc.sources).toEqual([]);
  });

  it("keeps a file from the phone as a source with no link, and replaces it in place when it's sent again (step 31d2b1)", async () => {
    const file: SourceRecord = { id: 's2', type: 'm3u-file', name: 'Phone list', added: 5 };
    const doc = applyProfileEdit(applyProfileEdit(withFavs(1), { kind: 'source', source: xtreamSource('s1', 'A') })!, { kind: 'source', source: file })!;
    expect(doc.sources[1]).toEqual(file);
    const again = applyProfileEdit(doc, { kind: 'source', source: { ...file, added: 5 } });
    expect(again!.sources).toEqual([xtreamSource('s1', 'A'), file]);
    const db = await openDatabase(freshFactory());
    await saveProfile(db, doc, { now: 0 });
    expect((await loadProfile(db))!.doc.sources).toEqual([xtreamSource('s1', 'A'), { id: 's2', type: 'm3u-file', name: 'Phone list', added: 5 }]);
    db.close();
  });
});

describe("applyProfileEdit: the user's guides (step 22b)", () => {
  const guide = (id: string, url = `http://g.test/${id}.xml`): UserGuide => ({ id, url });
  const ids = (doc: ProfileDoc | null): string[] | null => (doc === null ? null : doc.guides.map((g) => g.id));
  const edit = (doc: ProfileDoc, change: GuideChange): ProfileDoc | null => applyProfileEdit(doc, { kind: 'guide', change });
  const listed = (...names: string[]): ProfileDoc => ({ ...withFavs(1), guides: names.map((n) => guide(n)) });

  it('adds a guide at the end; an id or a link already listed changes nothing', () => {
    const doc = listed('s1', 'g1');
    const added = edit(doc, { op: 'add', guide: { id: 'g2', url: 'http://g.test/new.xml', offsetMinutes: 180 } });
    expect(added!.guides).toEqual([guide('s1'), guide('g1'), { id: 'g2', url: 'http://g.test/new.xml', offsetMinutes: 180 }]);
    expect(added!.favourites).toEqual([fav(1)]);
    expect(ids(doc)).toEqual(['s1', 'g1']);
    expect(edit(doc, { op: 'add', guide: guide('g1', 'http://g.test/other.xml') })).toBeNull();
    expect(edit(doc, { op: 'add', guide: guide('g9', 'http://g.test/s1.xml') })).toBeNull();
    expect(ids(edit(emptyProfile(), { op: 'add', guide: guide('g1') }))).toEqual(['g1']);
  });

  it('removes a guide by its id; an unknown id changes nothing', () => {
    const doc = listed('s1', 'g1', 'g2');
    expect(ids(edit(doc, { op: 'remove', id: 'g1' }))).toEqual(['s1', 'g2']);
    expect(ids(edit(doc, { op: 'remove', id: 's1' }))).toEqual(['g1', 'g2']);
    expect(ids(edit(doc, { op: 'remove', id: 'g2' }))).toEqual(['s1', 'g1']);
    expect(edit(doc, { op: 'remove', id: 'g3' })).toBeNull();
    expect(ids(doc)).toEqual(['s1', 'g1', 'g2']);
  });

  it('moves a guide to a place, clamped to the list; its own place changes nothing', () => {
    const doc = listed('a', 'b', 'c', 'd');
    expect(ids(edit(doc, { op: 'move', id: 'c', to: 0 }))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(edit(doc, { op: 'move', id: 'b', to: 2 }))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(edit(doc, { op: 'move', id: 'a', to: 3 }))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(edit(doc, { op: 'move', id: 'b', to: 99 }))).toEqual(['a', 'c', 'd', 'b']);
    expect(ids(edit(doc, { op: 'move', id: 'c', to: -4 }))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(edit(doc, { op: 'move', id: 'd', to: 1.7 }))).toEqual(['a', 'd', 'b', 'c']);
    expect(edit(doc, { op: 'move', id: 'b', to: 1 })).toBeNull();
    // Clamped or rounded down to its own place: no change either.
    expect(edit(doc, { op: 'move', id: 'b', to: 1.2 })).toBeNull();
    expect(edit(doc, { op: 'move', id: 'a', to: -1 })).toBeNull();
    expect(edit(doc, { op: 'move', id: 'd', to: 9 })).toBeNull();
    expect(edit(doc, { op: 'move', id: 'x', to: 0 })).toBeNull();
    expect(ids(doc)).toEqual(['a', 'b', 'c', 'd']);
  });

  it("gives a guide its link in its place, with its id and zone; a link listed already changes nothing (step 32d4a)", () => {
    const bare = (id: string, offsetMinutes?: number): StoredGuide => (offsetMinutes === undefined ? { id, url: null, origin: 'http://g.test' } : { id, url: null, origin: 'http://g.test', offsetMinutes });
    const doc: ProfileDoc = { ...withFavs(1), guides: [guide('a'), bare('b', -90), bare('c')] };
    const b = edit(doc, { op: 'link', id: 'b', url: 'http://g.test/b2.xml' });
    expect(b!.guides).toEqual([guide('a'), { id: 'b', url: 'http://g.test/b2.xml', offsetMinutes: -90 }, bare('c')]);
    expect(b!.favourites).toEqual([fav(1)]);
    const c = edit(b!, { op: 'link', id: 'c', url: 'http://g.test/c2.xml' })!;
    expect(c.guides[2]).toEqual({ id: 'c', url: 'http://g.test/c2.xml' });
    expect(Object.keys(c.guides[2]!)).toEqual(['id', 'url']);
    expect(doc.guides).toEqual([guide('a'), bare('b', -90), bare('c')]);
    // A link listed already, on another guide or on this one; an unknown id.
    expect(edit(doc, { op: 'link', id: 'b', url: 'http://g.test/a.xml' })).toBeNull();
    expect(edit(b!, { op: 'link', id: 'b', url: 'http://g.test/b2.xml' })).toBeNull();
    expect(edit(doc, { op: 'link', id: 'x', url: 'http://g.test/x.xml' })).toBeNull();
    // A guide with a link gets the new one.
    expect(edit(doc, { op: 'link', id: 'a', url: 'http://g.test/a2.xml' })!.guides[0]).toEqual({ id: 'a', url: 'http://g.test/a2.xml' });
  });
});

describe('applyProfileEdit: the backup without logins (step 32d4a)', () => {
  it('keeps the choice off as `backupLogins: false`, takes the field away when on, and changes nothing for the same choice', () => {
    const doc = withFavs(1);
    expect(applyProfileEdit(doc, { kind: 'backupLogins', on: true })).toBeNull();
    const off = applyProfileEdit(doc, { kind: 'backupLogins', on: false })!;
    expect(off).toEqual({ ...doc, backupLogins: false });
    expect('backupLogins' in doc).toBe(false);
    expect(applyProfileEdit(off, { kind: 'backupLogins', on: false })).toBeNull();
    const on = applyProfileEdit(off, { kind: 'backupLogins', on: true })!;
    expect(on).toEqual(doc);
    expect('backupLogins' in on).toBe(false);
    expect(off.backupLogins).toBe(false);
    for (const odd of ['yes', 1, null, undefined]) {
      expect(applyProfileEdit(doc, { kind: 'backupLogins', on: odd as unknown as boolean })).toBeNull();
      expect(applyProfileEdit(off, { kind: 'backupLogins', on: odd as unknown as boolean })).toBeNull();
    }
  });

  it("keeps telemetry's switch off as `telemetry: false` (step 33b1), takes the field away when on, and changes nothing for the same choice", () => {
    const doc = withFavs(1);
    expect(applyProfileEdit(doc, { kind: 'telemetry', on: true })).toBeNull();
    const off = applyProfileEdit(doc, { kind: 'telemetry', on: false })!;
    expect(off).toEqual({ ...doc, telemetry: false });
    expect('telemetry' in doc).toBe(false);
    expect(applyProfileEdit(off, { kind: 'telemetry', on: false })).toBeNull();
    const on = applyProfileEdit(off, { kind: 'telemetry', on: true })!;
    expect(on).toEqual(doc);
    expect('telemetry' in on).toBe(false);
    expect(off.telemetry).toBe(false);
    for (const odd of ['yes', 1, null, undefined]) {
      expect(applyProfileEdit(doc, { kind: 'telemetry', on: odd as unknown as boolean })).toBeNull();
      expect(applyProfileEdit(off, { kind: 'telemetry', on: odd as unknown as boolean })).toBeNull();
    }
    // The backup's choice and this one are apart, and both travel in what a backup sends.
    const both = applyProfileEdit(applyProfileEdit(doc, { kind: 'backupLogins', on: false })!, { kind: 'telemetry', on: false })!;
    expect(both).toEqual({ ...doc, backupLogins: false, telemetry: false });
    expect((backupDoc(both) as { telemetry?: unknown }).telemetry).toBe(false);
  });

  it('gives a source its login back in its place (the source edit)', () => {
    const bare: StoredSource = { id: 's1', type: 'xtream', name: 'A', account: null, base: 'http://panel.test', added: 1 };
    const doc: ProfileDoc = { ...withFavs(1), sources: [bare, { id: 's2', type: 'm3u', name: 'B', url: null, origin: 'http://l.test', added: 2 }] };
    const given = applyProfileEdit(doc, { kind: 'source', source: xtreamSource('s1', 'A') })!;
    expect(given.sources).toEqual([xtreamSource('s1', 'A'), doc.sources[1]]);
    const link: SourceRecord = { id: 's2', type: 'm3u', name: 'B', url: 'http://l.test/list.m3u', added: 2 };
    expect(applyProfileEdit(given, { kind: 'source', source: link })!.sources).toEqual([xtreamSource('s1', 'A'), link]);
  });
});

describe('applyProfileEdit: what the player keeps (step 20c1)', () => {
  const item = (n: number): LastChannel['item'] => ({
    key: `s1:live:${n}`,
    src: 's1',
    kind: 'live',
    name: `Channel ${n}`,
    normName: `channel ${n}`,
    group: 'News',
    url: `http://panel.test/live/u/p/${n}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: `channel ${n}`,
    chno: n,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  });
  const last = (n: number): LastChannel => ({ item: item(n), number: n, category: { src: 's1', name: 'News' }, index: n - 1, started: 1000 + n });
  const choice = (lang: string, used: number): StoredTrackChoice => ({ audio: { id: '1', lang, label: '' }, text: 'off', used });
  const player = (doc: ProfileDoc, change: PlayerChange): ProfileDoc | null => applyProfileEdit(doc, { kind: 'player', change });

  it('keeps the last channel, replacing the one before', () => {
    const doc = emptyProfile();
    const one = player(doc, { field: 'last', last: last(5) })!;
    expect(one.player).toEqual({ ...noPlayerMemory(), last: last(5) });
    expect(player(one, { field: 'last', last: last(6) })!.player.last).toEqual(last(6));
    // The input is left alone, and the rest of the profile kept.
    expect(doc.player.last).toBeNull();
    expect(player(withFavs(1), { field: 'last', last: last(5) })!.favourites).toEqual([fav(1)]);
  });

  it('keeps the channels played last with the last channel: newest first, each once, at most MAX_CHANNELS (step 28b2)', () => {
    expect(MAX_CHANNELS).toBe(20);
    const doc = emptyProfile();
    const one = player(doc, { field: 'last', last: last(5) })!;
    expect(one.channels).toEqual([last(5)]);
    const two = player(one, { field: 'last', last: last(6) })!;
    expect(two.channels).toEqual([last(6), last(5)]);
    // A channel played again moves to the front, as it played now (another row, another category).
    const again = { ...last(5), category: null, index: 40, started: 3000 };
    expect(player(two, { field: 'last', last: again })!.channels).toEqual([again, last(6)]);
    // The same channel twice: once.
    expect(player(two, { field: 'last', last: last(6) })!.channels).toEqual([last(6), last(5)]);
    // The inputs are left alone.
    expect(doc.channels).toEqual([]);
    expect(one.channels).toEqual([last(5)]);
    // Past MAX_CHANNELS, the one played longest ago goes.
    let full = doc;
    for (let n = 1; n <= MAX_CHANNELS; n += 1) full = player(full, { field: 'last', last: last(n) })!;
    expect(full.channels.map((c) => c.number)).toEqual(Array.from({ length: MAX_CHANNELS }, (_, i) => MAX_CHANNELS - i));
    const more = player(full, { field: 'last', last: last(MAX_CHANNELS + 1) })!;
    expect(more.channels).toHaveLength(MAX_CHANNELS);
    expect(more.channels[0]).toEqual(last(MAX_CHANNELS + 1));
    expect(more.channels[MAX_CHANNELS - 1]).toEqual(last(2));
    // Played again from the full list: nothing else goes.
    expect(player(full, { field: 'last', last: last(1) })!.channels.map((c) => c.number)).toEqual([1].concat(Array.from({ length: MAX_CHANNELS - 1 }, (_, i) => MAX_CHANNELS - i)));
    // The player's other fields leave the list alone.
    expect(player(two, { field: 'subtitleSize', size: 'l' })!.channels).toBe(two.channels);
    expect(player(two, { field: 'container', src: 's1', container: 'hls' })!.channels).toBe(two.channels);
  });

  it("keeps each source's container and redirect answer; the same answer changes nothing", () => {
    const a = player(emptyProfile(), { field: 'container', src: 's1', container: 'hls' })!;
    const b = player(a, { field: 'container', src: 's2', container: 'ts' })!;
    expect(b.player.containers).toEqual({ s1: 'hls', s2: 'ts' });
    expect(player(b, { field: 'container', src: 's1', container: 'hls' })).toBeNull();
    expect(player(b, { field: 'container', src: 's1', container: 'ts' })!.player.containers).toEqual({ s1: 'ts', s2: 'ts' });
    expect(a.player.containers).toEqual({ s1: 'hls' });
    const r = player(b, { field: 'redirect', src: 's1', mode: 'redirects' })!;
    expect(r.player.redirects).toEqual({ s1: 'redirects' });
    expect(r.player.containers).toEqual({ s1: 'hls', s2: 'ts' });
    expect(player(r, { field: 'redirect', src: 's1', mode: 'redirects' })).toBeNull();
    expect(player(r, { field: 'redirect', src: 's1', mode: 'none' })!.player.redirects).toEqual({ s1: 'none' });
    // An inherited name is no entry.
    expect(player(emptyProfile(), { field: 'container', src: 'toString', container: 'ts' })!.player.containers).toEqual({ toString: 'ts' });
  });

  it('keeps the subtitle size; the same size changes nothing', () => {
    const l = player(emptyProfile(), { field: 'subtitleSize', size: 'l' })!;
    expect(l.player.subtitleSize).toBe('l');
    expect(player(l, { field: 'subtitleSize', size: 'l' })).toBeNull();
    expect(player(l, { field: 'subtitleSize', size: 's' })!.player.subtitleSize).toBe('s');
  });

  it('keeps the picture mode in a document without one (no migration); the same mode changes nothing', () => {
    const before = emptyProfile();
    expect('picture' in before.player).toBe(false);
    const zoom = player(before, { field: 'picture', mode: 'zoom' })!;
    expect(zoom.v).toBe(PROFILE_VERSION);
    expect(zoom.player).toEqual({ ...before.player, picture: 'zoom' });
    expect(player(zoom, { field: 'picture', mode: 'zoom' })).toBeNull();
    expect(player(zoom, { field: 'picture', mode: '4:3' })!.player.picture).toBe('4:3');
    expect(before.player.picture).toBeUndefined();
  });

  it('keeps the track languages in a document without them (step 38d3, no migration): null takes one away; the same value changes nothing', () => {
    const before = emptyProfile();
    expect('audioLang' in before.player || 'subtitleLang' in before.player).toBe(false);
    // Nothing to take away.
    expect(player(before, { field: 'audioLang', lang: null })).toBeNull();
    expect(player(before, { field: 'subtitleLang', lang: null })).toBeNull();
    const ar = player(before, { field: 'audioLang', lang: 'ar' })!;
    expect(ar.v).toBe(PROFILE_VERSION);
    expect(ar.player).toEqual({ ...before.player, audioLang: 'ar' });
    expect(player(ar, { field: 'audioLang', lang: 'ar' })).toBeNull();
    const both = player(ar, { field: 'subtitleLang', lang: 'en' })!;
    expect(both.player).toEqual({ ...before.player, audioLang: 'ar', subtitleLang: 'en' });
    expect(player(both, { field: 'subtitleLang', lang: 'en' })).toBeNull();
    expect(player(both, { field: 'audioLang', lang: 'en' })!.player).toMatchObject({ audioLang: 'en', subtitleLang: 'en' });
    // Taken away, the field is gone, the other one kept.
    const noAudio = player(both, { field: 'audioLang', lang: null })!;
    expect('audioLang' in noAudio.player).toBe(false);
    expect(noAudio.player.subtitleLang).toBe('en');
    const none = player(noAudio, { field: 'subtitleLang', lang: null })!;
    expect('subtitleLang' in none.player).toBe(false);
    expect(none.player).toEqual(before.player);
    // The documents before are left as they were.
    expect(both.player).toEqual({ ...before.player, audioLang: 'ar', subtitleLang: 'en' });
    expect(before.player.audioLang).toBeUndefined();
  });

  it("keeps each content's track choice, dropping the one changed longest ago past the cap", () => {
    let doc = emptyProfile();
    for (let i = 0; i < MAX_TRACK_CHOICES; i++) doc = player(doc, { field: 'track', key: `k${i}`, choice: choice('ar', 1000 - i) })!;
    expect(Object.keys(doc.player.tracks)).toHaveLength(MAX_TRACK_CHOICES);
    // Changing a kept one drops nothing.
    const same = player(doc, { field: 'track', key: 'k3', choice: choice('en', 5000) })!;
    expect(Object.keys(same.player.tracks)).toHaveLength(MAX_TRACK_CHOICES);
    expect(same.player.tracks['k3']).toEqual(choice('en', 5000));
    // A new one drops the oldest (`k299`, used 701), never itself.
    const more = player(same, { field: 'track', key: 'new', choice: choice('en', 1) })!;
    expect(Object.keys(more.player.tracks)).toHaveLength(MAX_TRACK_CHOICES);
    expect(more.player.tracks['new']).toEqual(choice('en', 1));
    expect(more.player.tracks['k299']).toBeUndefined();
    expect(more.player.tracks['k298']).toEqual(choice('ar', 702));
    expect(same.player.tracks['k299']).toEqual(choice('ar', 701));
  });
});

describe("applyProfileEdit: movies' positions (step 26d)", () => {
  const at = (positionMs: number, updated: number, lengthMs: number | null = 600_000): WatchProgress => ({ positionMs, lengthMs, updated });
  const keep = (doc: ProfileDoc, key: string, progress: WatchProgress | null): ProfileDoc | null => applyProfileEdit(doc, { kind: 'progress', key, progress });

  it('keeps, moves and takes away a position, and changes nothing for the same one or one that is no position', () => {
    const before = withFavs(1);
    const one = keep(before, 'x:s1:movie:201', at(30_000, 1))!;
    expect(one).toEqual({ ...before, progress: { 'x:s1:movie:201': at(30_000, 1) } });
    expect(before.progress).toEqual({});
    // The same place and length again: nothing to write (when it was saved alone doesn't count).
    expect(keep(one, 'x:s1:movie:201', at(30_000, 9))).toBeNull();
    // Moved on, or its length learnt: written, with the new time.
    expect(keep(one, 'x:s1:movie:201', at(40_000, 9))!.progress).toEqual({ 'x:s1:movie:201': at(40_000, 9) });
    expect(keep(one, 'x:s1:movie:201', at(30_000, 9, 596_000))!.progress).toEqual({ 'x:s1:movie:201': at(30_000, 9, 596_000) });
    expect(keep(one, 'x:s1:movie:201', at(30_000, 9, null))!.progress).toEqual({ 'x:s1:movie:201': at(30_000, 9, null) });
    // Watched: taken away; one that isn't kept changes nothing.
    const two = keep(one, 'm:s2:abc:0', at(5_000, 2, null))!;
    expect(keep(two, 'x:s1:movie:201', null)!.progress).toEqual({ 'm:s2:abc:0': at(5_000, 2, null) });
    expect(keep(one, 'x:s1:movie:999', null)).toBeNull();
    // Only the fields of a position are kept.
    expect(keep(before, 'k', { ...at(1, 1), extra: 'x' } as WatchProgress)!.progress).toEqual({ k: at(1, 1) });
    // Not a position: nothing changes.
    const bad: unknown[] = [
      { positionMs: -1, lengthMs: null, updated: 1 },
      { positionMs: Infinity, lengthMs: null, updated: 1 },
      { positionMs: NaN, lengthMs: null, updated: 1 },
      { positionMs: '5', lengthMs: null, updated: 1 },
      { positionMs: 5, lengthMs: 0, updated: 1 },
      { positionMs: 5, lengthMs: -10, updated: 1 },
      { positionMs: 5, lengthMs: Infinity, updated: 1 },
      { positionMs: 5, lengthMs: '600', updated: 1 },
      { positionMs: 5, updated: 1 },
      { positionMs: 5, lengthMs: null, updated: NaN },
      { positionMs: 5, lengthMs: null },
      'x',
      5,
    ];
    for (const progress of bad) expect(keep(one, 'x:s1:movie:201', progress as WatchProgress)).toBeNull();
    expect(isWatchProgress(null)).toBe(false);
    expect(isWatchProgress(undefined)).toBe(false);
    expect(isWatchProgress(at(0, 0, null))).toBe(true);
    expect(isWatchProgress(at(0, -5, 1))).toBe(true);
  });

  it(`keeps the latest ${MAX_PROGRESS}, dropping the one saved longest ago, never the one being saved`, () => {
    expect(MAX_PROGRESS).toBe(500);
    let doc = emptyProfile();
    for (let i = 0; i < MAX_PROGRESS; i++) doc = keep(doc, `k${i}`, at(60_000, 1000 - i))!;
    expect(Object.keys(doc.progress)).toHaveLength(MAX_PROGRESS);
    // Moving a kept one drops nothing.
    const same = keep(doc, 'k3', at(90_000, 5000))!;
    expect(Object.keys(same.progress)).toHaveLength(MAX_PROGRESS);
    // A new one drops the oldest (`k499`, saved at 501), even when it is older still itself.
    const more = keep(same, 'new', at(70_000, 1))!;
    expect(Object.keys(more.progress)).toHaveLength(MAX_PROGRESS);
    expect(more.progress['new']).toEqual(at(70_000, 1));
    expect(more.progress['k499']).toBeUndefined();
    expect(more.progress['k498']).toEqual(at(60_000, 502));
    expect(more.progress['k3']).toEqual(at(90_000, 5000));
    expect(same.progress['k499']).toEqual(at(60_000, 501));
    // A document over the cap (a later version's) comes back to it.
    const over: ProfileDoc = { ...emptyProfile(), progress: {} };
    for (let i = 0; i < MAX_PROGRESS + 3; i++) over.progress[`o${i}`] = at(60_000, i);
    const trimmed = keep(over, 'o-new', at(1, 10_000))!;
    expect(Object.keys(trimmed.progress)).toHaveLength(MAX_PROGRESS);
    for (const gone of ['o0', 'o1', 'o2', 'o3']) expect(trimmed.progress[gone]).toBeUndefined();
    expect(trimmed.progress['o4']).toEqual(at(60_000, 4));
  });
});

describe("applyProfileEdit: a show's last episode (step 27c1)", () => {
  const SHOW = 'x:s1:series:301';
  const E1 = 'x:s1:episode:3001';
  const E2 = 'x:s1:episode:3002';
  const last = (episode: string, watched: boolean, updated: number): ShowProgress => ({ episode, watched, updated });
  const place = (positionMs: number, updated: number): WatchProgress => ({ positionMs, lengthMs: 300_000, updated });
  const play = (doc: ProfileDoc, show: string, entry: ShowProgress, progress: WatchProgress | null): ProfileDoc | null => applyProfileEdit(doc, { kind: 'episode', show, last: entry, progress });

  it("keeps the show's last episode and the episode's place in one edit; the same twice changes nothing", () => {
    const before = withFavs(1);
    // Played, no place yet (left at once): the show's last episode alone.
    const one = play(before, SHOW, last(E1, false, 1), null)!;
    expect(one).toEqual({ ...before, shows: { [SHOW]: last(E1, false, 1) } });
    expect(before.shows).toEqual({});
    expect(play(one, SHOW, last(E1, false, 2), null)).toBeNull();
    // Another episode played (left at once too): the show's last moves.
    expect(play(one, SHOW, last(E2, false, 2), null)!.shows).toEqual({ [SHOW]: last(E2, false, 2) });
    // Left part way: its place, and the show's save time with it.
    const two = play(one, SHOW, last(E1, false, 3), place(40_000, 3))!;
    expect(two).toEqual({ ...before, progress: { [E1]: place(40_000, 3) }, shows: { [SHOW]: last(E1, false, 3) } });
    expect(play(two, SHOW, last(E1, false, 4), place(40_000, 4))).toBeNull();
    // Watched: its place goes, the show's last episode says so.
    const three = play(two, SHOW, last(E1, true, 5), null)!;
    expect(three).toEqual({ ...before, progress: {}, shows: { [SHOW]: last(E1, true, 5) } });
    // A place taken away with the show's entry the same: written, the show's time renewed.
    const four = play(play(three, SHOW, last(E2, false, 6), place(50_000, 6))!, SHOW, last(E2, false, 7), null)!;
    expect(four).toEqual({ ...before, progress: {}, shows: { [SHOW]: last(E2, false, 7) } });
    // The show's entry alone changes (watched): the places stay as they are.
    const five = play(two, SHOW, last(E1, true, 8), place(40_000, 8))!;
    expect(five.progress).toBe(two.progress);
    expect(five.shows).toEqual({ [SHOW]: last(E1, true, 8) });
    // Another show's entry stays.
    const other = play(two, 'x:s1:series:302', last('x:s1:episode:3021', false, 9), null)!;
    expect(other.shows).toEqual({ [SHOW]: last(E1, false, 3), 'x:s1:series:302': last('x:s1:episode:3021', false, 9) });
    expect(other.progress).toBe(two.progress);
    // Only the fields of each are kept.
    const extra = play(before, SHOW, { ...last(E1, false, 1), extra: 'x' } as ShowProgress, { ...place(40_000, 1), extra: 'y' } as WatchProgress)!;
    expect(extra.shows).toEqual({ [SHOW]: last(E1, false, 1) });
    expect(extra.progress).toEqual({ [E1]: place(40_000, 1) });
  });

  it('changes nothing for a last episode or a place that is not one', () => {
    const before = withFavs(1);
    const bad: unknown[] = [
      { episode: '', watched: false, updated: 1 },
      { episode: 5, watched: false, updated: 1 },
      { episode: E1, watched: 'no', updated: 1 },
      { episode: E1, updated: 1 },
      { episode: E1, watched: false, updated: NaN },
      { episode: E1, watched: false, updated: Infinity },
      { episode: E1, watched: false, updated: '5' },
      { episode: E1, watched: false },
      null,
      'x',
    ];
    for (const entry of bad) expect(play(before, SHOW, entry as ShowProgress, place(40_000, 1))).toBeNull();
    expect(play(before, SHOW, last(E1, false, 1), { positionMs: -1, lengthMs: null, updated: 1 })).toBeNull();
    expect(isShowProgress(last(E1, true, -5))).toBe(true);
    expect(isShowProgress(undefined)).toBe(false);
  });

  it('keeps whether an episode came after it, when the entry says (optional, no migration: step 27d)', () => {
    const before = withFavs(1);
    const watched = (more: boolean | undefined, updated: number): ShowProgress => (more === undefined ? last(E1, true, updated) : { ...last(E1, true, updated), more });
    // Said: kept with the entry.
    const one = play(before, SHOW, watched(true, 1), null)!;
    expect(one.shows).toStrictEqual({ [SHOW]: { episode: E1, watched: true, more: true, updated: 1 } });
    expect(play(one, SHOW, watched(true, 2), null)).toBeNull();
    // The same episode with another answer: written (the panel gained or lost an episode).
    const two = play(one, SHOW, watched(false, 3), null)!;
    expect(two.shows).toStrictEqual({ [SHOW]: { episode: E1, watched: true, more: false, updated: 3 } });
    // Not said (an entry from before step 27d): written without the field, never as `undefined`.
    const three = play(two, SHOW, watched(undefined, 4), null)!;
    expect(three.shows).toStrictEqual({ [SHOW]: { episode: E1, watched: true, updated: 4 } });
    expect(Object.keys(three.shows[SHOW]!)).toEqual(['episode', 'watched', 'updated']);
    expect(play(three, SHOW, watched(undefined, 5), null)).toBeNull();
    // Anything but a boolean is no entry.
    for (const more of ['yes', 1, null]) expect(play(before, SHOW, { ...last(E1, true, 1), more } as unknown as ShowProgress, null)).toBeNull();
    expect(isShowProgress({ ...last(E1, false, 1), more: false })).toBe(true);
  });

  it(`keeps the latest ${MAX_SHOWS} shows, dropping the one saved longest ago, never the one being saved`, () => {
    expect(MAX_SHOWS).toBe(200);
    let doc = emptyProfile();
    for (let i = 0; i < MAX_SHOWS; i++) doc = play(doc, `s${i}`, last(`e${i}`, false, 1000 - i), null)!;
    expect(Object.keys(doc.shows)).toHaveLength(MAX_SHOWS);
    // Moving a kept one on drops nothing.
    const same = play(doc, 's3', last('e3b', false, 5000), null)!;
    expect(Object.keys(same.shows)).toHaveLength(MAX_SHOWS);
    // A new one drops the oldest (`s199`, saved at 801), even when it is older still itself.
    const more = play(same, 'new', last('e-new', false, 1), null)!;
    expect(Object.keys(more.shows)).toHaveLength(MAX_SHOWS);
    expect(more.shows['new']).toEqual(last('e-new', false, 1));
    expect(more.shows['s199']).toBeUndefined();
    expect(more.shows['s198']).toEqual(last('e198', false, 802));
    expect(more.shows['s3']).toEqual(last('e3b', false, 5000));
  });
});

describe('applyProfileEdit: the config notices shown (step 30c2a)', () => {
  const notice = (doc: ProfileDoc, id: string): ProfileDoc | null => applyProfileEdit(doc, { kind: 'notice', id });

  it('keeps each notice shown once, in order, in a document without any (no migration)', () => {
    const doc = withFavs(1);
    expect(doc.noticesShown).toBeUndefined();
    const one = notice(doc, 'welcome')!;
    expect(one.noticesShown).toEqual(['welcome']);
    expect(one.v).toBe(PROFILE_VERSION);
    expect(one.favourites).toEqual([fav(1)]);
    const two = notice(one, 'fix-104')!;
    expect(two.noticesShown).toEqual(['welcome', 'fix-104']);
    // The same id again changes nothing; the input is left alone.
    expect(notice(two, 'welcome')).toBeNull();
    expect(one.noticesShown).toEqual(['welcome']);
    expect(doc.noticesShown).toBeUndefined();
  });

  it("changes nothing for an id the config wouldn't take", () => {
    for (const bad of ['', 'Welcome', 'a_b', 'a b', 'x'.repeat(41), 'é', 7, null]) {
      expect(applyProfileEdit(withFavs(1), { kind: 'notice', id: bad as string }), String(bad)).toBeNull();
    }
    expect(notice(withFavs(1), 'x'.repeat(40))!.noticesShown).toEqual(['x'.repeat(40)]);
  });

  it(`keeps the latest ${MAX_NOTICES}, dropping the one shown longest ago`, () => {
    let doc: ProfileDoc = withFavs(1);
    for (let i = 0; i < MAX_NOTICES; i += 1) doc = notice(doc, `n${i}`)!;
    expect(doc.noticesShown).toHaveLength(MAX_NOTICES);
    const next = notice(doc, 'newest')!;
    expect(next.noticesShown).toHaveLength(MAX_NOTICES);
    expect(next.noticesShown![0]).toBe('n1');
    expect(next.noticesShown![MAX_NOTICES - 1]).toBe('newest');
    // A list already past the cap (a newer app's) comes back to it.
    const long = { ...withFavs(1), noticesShown: Array.from({ length: MAX_NOTICES + 5 }, (_v, i) => `l${i}`) };
    const cut = notice(long, 'newest')!;
    expect(cut.noticesShown).toHaveLength(MAX_NOTICES);
    expect(cut.noticesShown![0]).toBe('l6');
  });
});

describe("applyProfileEdit: the guides' time offsets (step 24b)", () => {
  const offset = (doc: ProfileDoc, epgSrc: string, minutes: number): ProfileDoc | null => applyProfileEdit(doc, { kind: 'epgOffset', epgSrc, minutes });
  const listed = (...names: string[]): ProfileDoc => ({ ...withFavs(1), guides: names.map((n) => ({ id: n, url: `http://g.test/${n}.xml` })) });

  it("sets, changes and takes away a guide's offset in a document without any (no migration)", () => {
    const doc = listed('g1');
    expect(doc.epgOffsets).toBeUndefined();
    const one = offset(doc, 'u~g1', 60)!;
    expect(one.epgOffsets).toEqual({ 'u~g1': 60 });
    expect(one.guides).toEqual(doc.guides);
    expect(one.favourites).toEqual([fav(1)]);
    expect(one.v).toBe(PROFILE_VERSION);
    // A source's own guide, by its id; the other offsets stay.
    const two = offset(one, 'tv:xmltv', -720)!;
    expect(two.epgOffsets).toEqual({ 'u~g1': 60, 'tv:xmltv': -720 });
    expect(offset(two, 'tv:xmltv', 720)!.epgOffsets).toEqual({ 'u~g1': 60, 'tv:xmltv': 720 });
    // 0 takes it away (no entry), and -0 is 0.
    expect(offset(two, 'u~g1', 0)!.epgOffsets).toEqual({ 'tv:xmltv': -720 });
    expect(offset(two, 'u~g1', -0)!.epgOffsets).toEqual({ 'tv:xmltv': -720 });
    // The input is left alone.
    expect(one.epgOffsets).toEqual({ 'u~g1': 60 });
    expect(doc.epgOffsets).toBeUndefined();
  });

  it('changes nothing for the offset a guide has already, or for one that is not an offset', () => {
    const doc = offset(listed('g1'), 'u~g1', 90)!;
    expect(offset(doc, 'u~g1', 90)).toBeNull();
    expect(offset(listed('g1'), 'u~g1', 0)).toBeNull();
    expect(offset(listed('g1'), 'u~g1', -0)).toBeNull();
    // None for this guide among the others' offsets.
    expect(offset(doc, 'tv:xmltv', 0)).toBeNull();
    for (const bad of [15, 31, 30.5, 750, -750, 12 * 60 + 30, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(offset(doc, 'u~g1', bad), String(bad)).toBeNull();
    }
    expect(applyProfileEdit(doc, { kind: 'epgOffset', epgSrc: 'u~g1', minutes: '60' as unknown as number })).toBeNull();
  });

  it("takes a removed guide's offset away with it, and keeps every other", () => {
    let doc = listed('g1', 'g2');
    doc = offset(doc, 'u~g1', 30)!;
    doc = offset(doc, 'u~g2', -30)!;
    doc = offset(doc, 'tv:xmltv', 60)!;
    const removed = applyProfileEdit(doc, { kind: 'guide', change: { op: 'remove', id: 'g1' } })!;
    expect(removed.guides.map((g) => g.id)).toEqual(['g2']);
    expect(removed.epgOffsets).toEqual({ 'u~g2': -30, 'tv:xmltv': 60 });
    // A guide added again with that id starts with none.
    const again = applyProfileEdit(removed, { kind: 'guide', change: { op: 'add', guide: { id: 'g1', url: 'http://g.test/new.xml' } } })!;
    expect(again.epgOffsets).toEqual({ 'u~g2': -30, 'tv:xmltv': 60 });
    // Removing a guide without one, and moving one, leave the offsets as they are.
    const plain = applyProfileEdit(offset(listed('g1', 'g2'), 'u~g2', 30)!, { kind: 'guide', change: { op: 'remove', id: 'g1' } })!;
    expect(plain.epgOffsets).toEqual({ 'u~g2': 30 });
    expect(applyProfileEdit(listed('g1', 'g2'), { kind: 'guide', change: { op: 'remove', id: 'g1' } })!.epgOffsets).toBeUndefined();
    const moved = applyProfileEdit(doc, { kind: 'guide', change: { op: 'move', id: 'g2', to: 0 } })!;
    expect(moved.epgOffsets).toBe(doc.epgOffsets);
  });
});

describe("the guides' time offsets as stored (step 24b)", () => {
  it('isEpgOffset: whole half hours up to 12 hours either way', () => {
    const steps: number[] = [];
    for (let m = -720; m <= 720; m += 30) steps.push(m);
    expect(steps).toHaveLength(49);
    expect(steps.every((m) => isEpgOffset(m))).toBe(true);
    expect(EPG_OFFSET_STEP).toBe(30);
    expect(EPG_OFFSET_MAX).toBe(720);
    for (const bad of [-750, 750, 1, 29, 45, 30.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, '30', null, undefined, {}]) expect(isEpgOffset(bad), String(bad)).toBe(false);
  });

  it('epgOffsetsOf keeps the offsets that are offsets and not 0, from a document of any version', () => {
    expect(epgOffsetsOf({ v: 4, epgOffsets: { a: 30, b: 0, c: 45, d: -720, e: '60', f: 750, g: null } })).toEqual({ a: 30, d: -720 });
    // A newer app's document keeps the field's meaning (fields are only added).
    expect(epgOffsetsOf({ v: 9, epgOffsets: { a: -30 } })).toEqual({ a: -30 });
    for (const none of [null, undefined, 3, 'x', { v: 3 }, { v: 4, epgOffsets: null }, { v: 4, epgOffsets: 5 }, emptyProfile()]) expect(epgOffsetsOf(none)).toEqual({});
    // Inherited keys aren't offsets.
    expect(epgOffsetsOf({ v: 4, epgOffsets: Object.create({ inherited: 30 }) as object })).toEqual({});
  });

  it('readEpgOffsets reads the current profile without writing it: {} when there is none', async () => {
    const db = await openDatabase(freshFactory());
    expect(await readEpgOffsets(db)).toEqual({});
    // A version 1 document: read as it is (no upgrade, no snapshot).
    await transact(db, STORE.profile, 'readwrite', (tx) => {
      tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 1, doc: v1(1) });
    });
    expect(await readEpgOffsets(db)).toEqual({});
    expect(await listSnapshots(db)).toEqual([]);
    await saveProfile(db, { ...emptyProfile(), epgOffsets: { 'u~g1': 90, 'tv:xmltv': -60 } }, { now: 2 });
    expect(await readEpgOffsets(db)).toEqual({ 'u~g1': 90, 'tv:xmltv': -60 });
    db.close();
  });
});

describe('applyProfileEdit: manual EPG mappings (step 24d)', () => {
  const listed = (...names: string[]): ProfileDoc => ({ ...withFavs(1), guides: names.map((n) => ({ id: n, url: `http://g.test/${n}.xml` })) });
  const pin = (doc: ProfileDoc, key: string, to: EpgPin | null): ProfileDoc | null => applyProfileEdit(doc, { kind: 'epgOverride', key, pin: to });

  it("sets, changes and takes away a channel's mapping in a document without any (no migration)", () => {
    const doc = listed('g1');
    expect(doc.epgOverrides).toBeUndefined();
    const one = pin(doc, 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'one.tv' })!;
    expect(one.v).toBe(PROFILE_VERSION);
    expect(one.epgOverrides).toEqual({ 'x:s1:live:1': { epgSrc: 'u~g1', channel: 'one.tv' } });
    expect(pin(one, 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'one.tv' })).toBeNull();
    const two = pin(one, 'x:s1:live:2', { epgSrc: 's1:xmltv', channel: 'two.tv' })!;
    expect(two.epgOverrides).toEqual({ 'x:s1:live:1': { epgSrc: 'u~g1', channel: 'one.tv' }, 'x:s1:live:2': { epgSrc: 's1:xmltv', channel: 'two.tv' } });
    // Another channel of the same guide, then the same channel of another guide.
    expect(pin(two, 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'three.tv' })!.epgOverrides!['x:s1:live:1']).toEqual({ epgSrc: 'u~g1', channel: 'three.tv' });
    expect(pin(two, 'x:s1:live:1', { epgSrc: 's1:xmltv', channel: 'one.tv' })!.epgOverrides!['x:s1:live:1']).toEqual({ epgSrc: 's1:xmltv', channel: 'one.tv' });
    expect(pin(two, 'x:s1:live:1', null)!.epgOverrides).toEqual({ 'x:s1:live:2': { epgSrc: 's1:xmltv', channel: 'two.tv' } });
    expect(pin(one, 'x:s1:live:1', null)!.epgOverrides).toEqual({});
    expect(pin(one, 'x:s1:live:2', null)).toBeNull();
    expect(pin(doc, 'x:s1:live:1', null)).toBeNull();
    // Nothing was changed in place.
    expect(one.epgOverrides).toEqual({ 'x:s1:live:1': { epgSrc: 'u~g1', channel: 'one.tv' } });
    expect(doc.epgOverrides).toBeUndefined();
  });

  it('keeps a mapping to no guide as no guide, whichever guide it names', () => {
    const doc = listed('g1');
    const off = pin(doc, 'x:s1:live:1', { epgSrc: 'u~g1', channel: null })!;
    expect(off.epgOverrides).toEqual({ 'x:s1:live:1': { epgSrc: '', channel: null } });
    expect(pin(off, 'x:s1:live:1', { epgSrc: '', channel: null })).toBeNull();
    expect(pin(off, 'x:s1:live:1', { epgSrc: 's1:xmltv', channel: null })).toBeNull();
    expect(pin(off, 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'one.tv' })!.epgOverrides).toEqual({ 'x:s1:live:1': { epgSrc: 'u~g1', channel: 'one.tv' } });
    const back = pin(pin(doc, 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'one.tv' })!, 'x:s1:live:1', { epgSrc: 'u~g1', channel: null })!;
    expect(back.epgOverrides).toEqual({ 'x:s1:live:1': { epgSrc: '', channel: null } });
  });

  it("changes nothing for a mapping that isn't one", () => {
    const doc = pin(listed('g1'), 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'one.tv' })!;
    for (const bad of [
      { epgSrc: '', channel: 'two.tv' },
      { epgSrc: 'u~g1', channel: '' },
      { epgSrc: 'u~g1', channel: '  ' },
      { epgSrc: 'u~g1', channel: 2 as unknown as string },
    ]) {
      expect(pin(doc, 'x:s1:live:1', bad), JSON.stringify(bad)).toBeNull();
      expect(pin(doc, 'x:s1:live:2', bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("takes the mappings into a removed guide away with it, and keeps every other", () => {
    let doc = listed('g1', 'g2');
    doc = pin(doc, 'x:s1:live:1', { epgSrc: 'u~g1', channel: 'one.tv' })!;
    doc = pin(doc, 'x:s1:live:2', { epgSrc: 'u~g2', channel: 'two.tv' })!;
    doc = pin(doc, 'x:s1:live:3', { epgSrc: 'u~g1', channel: 'three.tv' })!;
    doc = pin(doc, 'x:s1:live:4', { epgSrc: '', channel: null })!;
    doc = pin(doc, 'x:s1:live:5', { epgSrc: 's1:xmltv', channel: 'one.tv' })!;
    doc = applyProfileEdit(doc, { kind: 'epgOffset', epgSrc: 'u~g1', minutes: 60 })!;
    const removed = applyProfileEdit(doc, { kind: 'guide', change: { op: 'remove', id: 'g1' } })!;
    expect(removed.guides.map((g) => g.id)).toEqual(['g2']);
    expect(removed.epgOverrides).toEqual({
      'x:s1:live:2': { epgSrc: 'u~g2', channel: 'two.tv' },
      'x:s1:live:4': { epgSrc: '', channel: null },
      'x:s1:live:5': { epgSrc: 's1:xmltv', channel: 'one.tv' },
    });
    expect(removed.epgOffsets).toEqual({});
    expect(doc.epgOverrides!['x:s1:live:1']).toEqual({ epgSrc: 'u~g1', channel: 'one.tv' });
    // A guide removed with no mapping into it, or none at all, or a move, leave them as they are.
    const plain = applyProfileEdit(removed, { kind: 'guide', change: { op: 'remove', id: 'g2' } })!;
    expect(plain.epgOverrides).toEqual({ 'x:s1:live:4': { epgSrc: '', channel: null }, 'x:s1:live:5': { epgSrc: 's1:xmltv', channel: 'one.tv' } });
    const none = applyProfileEdit(plain, { kind: 'guide', change: { op: 'add', guide: { id: 'g3', url: 'http://g.test/g3.xml' } } })!;
    expect(applyProfileEdit(none, { kind: 'guide', change: { op: 'remove', id: 'g3' } })!.epgOverrides).toBe(plain.epgOverrides);
    expect(applyProfileEdit(listed('g1'), { kind: 'guide', change: { op: 'remove', id: 'g1' } })!.epgOverrides).toBeUndefined();
    const moved = applyProfileEdit(doc, { kind: 'guide', change: { op: 'move', id: 'g2', to: 0 } })!;
    expect(moved.epgOverrides).toBe(doc.epgOverrides);
    expect(moved.epgOffsets).toBe(doc.epgOffsets);
  });
});

describe('manual EPG mappings as stored (step 24d)', () => {
  it('readEpgOverrides reads the current profile without writing it: [] when there is none', async () => {
    const db = await openDatabase(freshFactory());
    expect(await readEpgOverrides(db)).toEqual([]);
    await transact(db, STORE.profile, 'readwrite', (tx) => {
      tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 1, doc: v1(1) });
    });
    expect(await readEpgOverrides(db)).toEqual([]);
    expect(await listSnapshots(db)).toEqual([]);
    await saveProfile(db, { ...emptyProfile(), epgOverrides: { 'x:s1:live:1': { epgSrc: 'u~g1', channel: 'one.tv' }, 'x:s1:live:2': { epgSrc: '', channel: null } } }, { now: 2 });
    expect(await readEpgOverrides(db)).toEqual([
      { key: 'x:s1:live:1', epgSrc: 'u~g1', channel: 'one.tv' },
      { key: 'x:s1:live:2', epgSrc: '', channel: null },
    ]);
    db.close();
  });

  it("epgOverridesOf skips inherited keys", () => {
    expect(epgOverridesOf({ v: 4, epgOverrides: Object.create({ 'x:s1:live:1': { epgSrc: '', channel: null } }) as object })).toEqual([]);
  });
});
