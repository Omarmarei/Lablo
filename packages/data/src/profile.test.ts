import { describe, expect, it } from 'vitest';
import { openDatabase, transact } from './idb';
import type { AnyProfile, ProfileDoc, ProfileMigration } from './profile';
import {
  PROFILE_MIGRATIONS,
  PROFILE_VERSION,
  ProfileError,
  SNAPSHOT_EVERY_MS,
  emptyProfile,
  listSnapshots,
  loadProfile,
  migrateProfile,
  restoreSnapshot,
  saveProfile,
  updateProfile,
} from './profile';
import { STORE } from './schema';
import { freshFactory } from './test-support';

const DAY = SNAPSHOT_EVERY_MS;
const fav = (n: number): ProfileDoc['favourites'][number] => ({ key: `x:tv:live:${n}`, src: 'tv', kind: 'live', normName: `ch ${n}`, added: n, missingSince: null });
const withFavs = (...ns: number[]): ProfileDoc => ({ v: 1, favourites: ns.map(fav) });

async function writeCurrent(db: IDBDatabase, doc: unknown): Promise<void> {
  await transact(db, STORE.profile, 'readwrite', (tx) => tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 0, doc }));
}

// Synthetic future versions: 2 renames `favourites` to `favouriteLists`, 3 adds `settings`.
const toV2: ProfileMigration = ({ favourites, ...rest }) => ({ ...rest, v: 2, favouriteLists: [{ name: 'Favourites', items: favourites }] });
const toV3: ProfileMigration = (doc) => ({ ...doc, v: 3, settings: { language: 'ar' } });

describe('profile migrations', () => {
  it('is at version 1 with no migrations yet', () => {
    expect(PROFILE_VERSION).toBe(PROFILE_MIGRATIONS.length + 1);
    expect(emptyProfile()).toEqual({ v: 1, favourites: [] });
  });

  it('upgrades from every earlier version, step by step, without touching the input', () => {
    const v1 = withFavs(1, 2);
    const frozen = JSON.stringify(v1);
    const fromV1 = migrateProfile(v1, [toV2, toV3]);
    expect(fromV1).toEqual({
      doc: { v: 3, favouriteLists: [{ name: 'Favourites', items: [fav(1), fav(2)] }], settings: { language: 'ar' } },
      from: 1,
      migrated: true,
      newer: false,
    });
    expect(JSON.stringify(v1)).toBe(frozen);
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
    await writeCurrent(db, withFavs(1, 2));
    const loaded = await loadProfile(db, { now: 50, migrations: [toV2, toV3] });
    expect(loaded).toMatchObject({ migratedFrom: 1, newer: false, doc: { v: 3 } });
    const snaps = await listSnapshots(db);
    expect(snaps).toEqual([{ id: 'snap:0', savedAt: 50, doc: withFavs(1, 2), reason: 'migration' }]);
    // The upgrade was written: the next load has nothing to migrate.
    expect(await loadProfile(db, { now: 60, migrations: [toV2, toV3] })).toMatchObject({ migratedFrom: null, doc: { v: 3 } });
    db.close();
  });

  it('keeps the stored profile untouched when a migration fails', async () => {
    const db = await openDatabase(freshFactory());
    await writeCurrent(db, withFavs(3));
    const failing: ProfileMigration = () => {
      throw new Error('bad migration');
    };
    await expect(loadProfile(db, { migrations: [failing] })).rejects.toThrow('bad migration');
    expect(await loadProfile(db)).toEqual({ doc: withFavs(3), newer: false, migratedFrom: null });
    expect(await listSnapshots(db)).toEqual([]);
    db.close();
  });

  it('shows a newer profile but never saves over it', async () => {
    const db = await openDatabase(freshFactory());
    await writeCurrent(db, { v: 9, favourites: [], future: true });
    expect(await loadProfile(db)).toEqual({ doc: { v: 9, favourites: [], future: true }, newer: true, migratedFrom: null });
    await expect(saveProfile(db, withFavs(1))).rejects.toThrow(/newer app version/);
    expect((await loadProfile(db))!.doc).toMatchObject({ v: 9, future: true });
    expect(() => saveProfile(db, { v: 2 } as unknown as ProfileDoc)).toThrow(/Can't save a version 2/);
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

    // A version-1 document under an app that writes version 2: upgraded, the old one snapshotted.
    expect(await updateProfile(db, (doc) => ({ ...doc, extra: true }) as ProfileDoc, { now: DAY + 1, migrations: [toV2] })).toBe(true);
    const snaps = await listSnapshots(db);
    expect(snaps[0]).toMatchObject({ reason: 'migration', doc: withFavs(2) });
    await expect(updateProfile(db, (doc) => doc, { migrations: [] })).resolves.toBe(false);

    await writeCurrent(db, { v: 9, favourites: [] });
    expect(await updateProfile(db, () => withFavs(3))).toBe(false);
    db.close();
  });

  it('rejects (and writes nothing) when the update returns another version', async () => {
    const db = await openDatabase(freshFactory());
    await saveProfile(db, withFavs(1), { now: 0 });
    await expect(updateProfile(db, (doc) => ({ ...doc, v: 2 }) as unknown as ProfileDoc)).rejects.toThrow(ProfileError);
    expect((await loadProfile(db))!.doc).toEqual(withFavs(1));
    db.close();
  });
});
