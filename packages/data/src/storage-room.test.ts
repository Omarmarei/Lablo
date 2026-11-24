import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdbError, openDatabase, transact } from './idb';
import { RpcError } from './rpc';
import { STORE } from './schema';
import { QUOTA_ERROR, Room, dropGuides, isQuotaError } from './storage-room';
import { dumpStore, fillStore, freshFactory } from './test-support';

let db: IDBDatabase;

beforeEach(async () => {
  db = await openDatabase(freshFactory());
});

afterEach(() => {
  db.close();
});

const quota = (): DOMException => new DOMException('full', QUOTA_ERROR);

function seed(): Promise<void> {
  return transact(db, [STORE.epgMeta, STORE.epgBuckets, STORE.epgChannels, STORE.chunks, STORE.profile, STORE.kv], 'readwrite', (tx) => {
    tx.objectStore(STORE.epgMeta).put({ epgSrc: 'g1', gen: 2, building: 3, nextGen: 4, updatedAt: 1, checkedAt: 1, rank: 0 });
    tx.objectStore(STORE.epgMeta).put({ epgSrc: 'g2', gen: 1, building: null, nextGen: 2, updatedAt: 1, checkedAt: 1, rank: 1 });
    tx.objectStore(STORE.epgBuckets).put({ start: [1] }, ['g1', 2, 'c', 0]);
    tx.objectStore(STORE.epgBuckets).put({ start: [2] }, ['g1', 3, 'c', 0]);
    tx.objectStore(STORE.epgBuckets).put({ start: [3] }, ['g2', 1, 'c', 0]);
    tx.objectStore(STORE.epgChannels).put({ matches: [] }, ['g2', 1]);
    tx.objectStore(STORE.chunks).put({ items: [] }, ['s', 1, 'live', 0, 0]);
    tx.objectStore(STORE.profile).put({ id: 'current', savedAt: 1, doc: { v: 1 } });
    tx.objectStore(STORE.kv).put('x', 'k');
  });
}

describe('isQuotaError', () => {
  it("knows IndexedDB's error by its name, and by its code once wrapped or sent across a worker", () => {
    expect(isQuotaError(quota())).toBe(true);
    expect(isQuotaError(new IdbError('full', QUOTA_ERROR))).toBe(true);
    expect(isQuotaError(new RpcError('full', QUOTA_ERROR, 'IdbError'))).toBe(true);
  });

  it('is false for every other failure', () => {
    expect(isQuotaError(new DOMException('gone', 'AbortError'))).toBe(false);
    expect(isQuotaError(new IdbError('gone', 'AbortError'))).toBe(false);
    expect(isQuotaError(new Error(QUOTA_ERROR))).toBe(false);
    expect(isQuotaError(QUOTA_ERROR)).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });
});

describe('dropGuides', () => {
  it('deletes every guide (its record, programmes and match table) and nothing else', async () => {
    await seed();
    await dropGuides(db);
    expect(await dumpStore(db, STORE.epgMeta)).toEqual([]);
    expect(await dumpStore(db, STORE.epgBuckets)).toEqual([]);
    expect(await dumpStore(db, STORE.epgChannels)).toEqual([]);
    expect(await dumpStore(db, STORE.chunks)).toHaveLength(1);
    expect(await dumpStore(db, STORE.profile)).toHaveLength(1);
    expect(await dumpStore(db, STORE.kv)).toHaveLength(1);
  });

  it('goes through on a full store: it only deletes', async () => {
    await seed();
    const full = fillStore(db, () => true);
    await dropGuides(db);
    expect(await dumpStore(db, STORE.epgBuckets)).toEqual([]);
    expect(full.refused).toEqual([]);
  });
});

describe('Room', () => {
  it('makes room once when a write fails for space, then writes again', async () => {
    const calls: string[] = [];
    let full = true;
    const room = new Room(
      async () => {
        calls.push('drop');
        full = false;
      },
      () => calls.push('made'),
    );
    expect(
      await room.write(async () => {
        calls.push(full ? 'refused' : 'written');
        if (full) throw quota();
        return 7;
      }),
    ).toBe(7);
    expect(calls).toEqual(['refused', 'drop', 'made', 'written']);
    expect(room.made).toBe(true);
  });

  it('passes a write that works without making room', async () => {
    let drops = 0;
    const room = new Room(async () => {
      drops++;
    });
    expect(await room.write(async () => 'ok')).toBe('ok');
    expect(drops).toBe(0);
    expect(room.made).toBe(false);
  });

  it('fails a write still refused after the room, and never makes room twice', async () => {
    let drops = 0;
    let made = 0;
    const room = new Room(
      async () => {
        drops++;
      },
      () => made++,
    );
    const refused = async (): Promise<never> => {
      throw quota();
    };
    await expect(room.write(refused)).rejects.toMatchObject({ name: QUOTA_ERROR });
    await expect(room.write(refused)).rejects.toMatchObject({ name: QUOTA_ERROR });
    expect(drops).toBe(1);
    expect(made).toBe(1);
  });

  it('makes no room for another failure', async () => {
    let drops = 0;
    const room = new Room(async () => {
      drops++;
    });
    await expect(
      room.write(async () => {
        throw new IdbError('gone', 'AbortError');
      }),
    ).rejects.toMatchObject({ code: 'AbortError' });
    expect(drops).toBe(0);
    expect(room.made).toBe(false);
  });

  it('fails as the drop failed, without writing again', async () => {
    let writes = 0;
    const room = new Room(async () => {
      throw new Error('drop failed');
    });
    await expect(
      room.write(async () => {
        writes++;
        throw quota();
      }),
    ).rejects.toThrow('drop failed');
    expect(writes).toBe(1);
  });
});
