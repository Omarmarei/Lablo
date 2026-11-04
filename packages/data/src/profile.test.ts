import { describe, expect, it } from 'vitest';
import { openDatabase, transact } from './idb';
import type { UserGuide } from './epg-sources';
import type { AnyProfile, GuideChange, LastChannel, PlayerChange, ProfileDoc, ProfileMigration, SourceRecord, SourceRecordV3, StoredTrackChoice } from './profile';
import {
  MAX_TRACK_CHOICES,
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  ProfileError,
  SNAPSHOT_EVERY_MS,
  applyProfileEdit,
  emptyProfile,
  listSnapshots,
  loadProfile,
  migrateProfile,
  noPlayerMemory,
  restoreSnapshot,
  saveProfile,
  updateProfile,
} from './profile';
import { STORE } from './schema';
import { freshFactory } from './test-support';

const DAY = SNAPSHOT_EVERY_MS;
const fav = (n: number): ProfileDoc['favourites'][number] => ({ key: `x:tv:live:${n}`, src: 'tv', kind: 'live', normName: `ch ${n}`, added: n, missingSince: null });
/** A current (version 4) profile with these favourites. */
const withFavs = (...ns: number[]): ProfileDoc => ({ ...emptyProfile(), favourites: ns.map(fav) });
/** A version 1 document, as step 7 stored it. */
const v1 = (...ns: number[]): AnyProfile => ({ v: 1, favourites: ns.map(fav) });
const NO_ANSWERS = { language: null, disclaimerAt: null, consent: null };
const xtreamSource = (id: string, name = 'Home'): SourceRecord => ({
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
  it('is at version 4, with the shape of every version pinned', () => {
    expect(PROFILE_VERSION).toBe(4);
    expect(PROFILE_VERSION).toBe(PROFILE_MIGRATIONS.length + 1);
    const NOTHING_KEPT = { last: null, containers: {}, redirects: {}, tracks: {}, subtitleSize: null };
    expect(noPlayerMemory()).toEqual(NOTHING_KEPT);
    expect(emptyProfile()).toEqual({ v: 4, favourites: [], sources: [], onboarding: NO_ANSWERS, player: NOTHING_KEPT, guides: [] });
    // 1 → 2 (step 13b): the favourites stay; no sources and no answers yet.
    expect(PROFILE_MIGRATIONS[0]!(v1(1, 2))).toEqual({ v: 2, favourites: [fav(1), fav(2)], sources: [], onboarding: NO_ANSWERS });
    // 2 → 3 (step 20c1): nothing kept for the player yet; the rest stays.
    const v2 = { v: 2, favourites: [fav(1)], sources: [v3Source('s1', 'http://g.test/a.xml')], onboarding: { ...NO_ANSWERS, language: 'ar' } };
    expect(PROFILE_MIGRATIONS[1]!(v2)).toEqual({ ...v2, v: 3, player: NOTHING_KEPT });
    // 3 → 4 (step 22b): the sources' guide links become the guide list, under the sources' ids.
    const v3 = { ...v2, v: 3, player: NOTHING_KEPT };
    expect(PROFILE_MIGRATIONS[2]!(v3)).toEqual({ ...v3, v: 4, sources: [xtreamSource('s1')], guides: [{ id: 's1', url: 'http://g.test/a.xml' }] });
    expect(migrateProfile(v1(1, 2))).toEqual({
      doc: { v: 4, favourites: [fav(1), fav(2)], sources: [], onboarding: NO_ANSWERS, player: NOTHING_KEPT, guides: [] },
      from: 1,
      migrated: true,
      newer: false,
    });
    expect(migrateProfile(v2)).toMatchObject({
      doc: { ...v2, v: 4, sources: [xtreamSource('s1')], player: NOTHING_KEPT, guides: [{ id: 's1', url: 'http://g.test/a.xml' }] },
      from: 2,
      migrated: true,
    });
    // Fields an older document had that the new version doesn't name are kept, never dropped.
    expect(migrateProfile({ ...v1(), kept: 'x' }).doc).toMatchObject({ v: 4, kept: 'x' });
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
    await writeCurrent(db, { v: 9, favourites: [], future: true });
    expect(await loadProfile(db)).toEqual({ doc: { v: 9, favourites: [], future: true }, newer: true, migratedFrom: null });
    await expect(saveProfile(db, withFavs(1))).rejects.toThrow(/newer app version/);
    expect((await loadProfile(db))!.doc).toMatchObject({ v: 9, future: true });
    expect(() => saveProfile(db, { v: 5 } as unknown as ProfileDoc)).toThrow(/Can't save a version 5/);
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

    await writeCurrent(db, { v: 9, favourites: [] });
    expect(await updateProfile(db, () => withFavs(3))).toBe(false);
    db.close();
  });

  it('rejects (and writes nothing) when the update returns another version', async () => {
    const db = await openDatabase(freshFactory());
    await saveProfile(db, withFavs(1), { now: 0 });
    await expect(updateProfile(db, (doc) => ({ ...doc, v: 5 }) as unknown as ProfileDoc)).rejects.toThrow(ProfileError);
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
    expect(edit(doc, { op: 'move', id: 'd', to: 9 })).toBeNull();
    expect(edit(doc, { op: 'move', id: 'x', to: 0 })).toBeNull();
    expect(ids(doc)).toEqual(['a', 'b', 'c', 'd']);
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
