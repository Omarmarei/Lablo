import { describe, expect, it } from 'vitest';
import { createStorageState, isStorageError } from './storage-state';

describe('isStorageError', () => {
  it("knows IndexedDB's error and a refresh's `storage` by their codes", () => {
    expect(isStorageError({ code: 'QuotaExceededError' })).toBe(true);
    expect(isStorageError({ code: 'storage' })).toBe(true);
  });

  it('is false for everything else', () => {
    expect(isStorageError({ code: 'network' })).toBe(false);
    expect(isStorageError({ name: 'QuotaExceededError' })).toBe(false);
    expect(isStorageError(new Error('storage'))).toBe(false);
    expect(isStorageError('storage')).toBe(false);
    expect(isStorageError(null)).toBe(false);
    expect(isStorageError(undefined)).toBe(false);
  });
});

describe('createStorageState', () => {
  it('is full while any write failed for space and has not gone through since', () => {
    const state = createStorageState();
    expect(state.full.value).toBe(false);
    state.failed({ kind: 'source', id: 's1' });
    state.failed({ kind: 'guide', id: 'g1' });
    state.failed({ kind: 'profile' });
    expect(state.full.value).toBe(true);
    state.saved({ kind: 'source', id: 's1' });
    state.saved({ kind: 'profile' });
    expect(state.full.value).toBe(true);
    state.saved({ kind: 'guide', id: 'g1' });
    expect(state.full.value).toBe(false);
  });

  it('keeps each item once, and apart from others of the same id', () => {
    const state = createStorageState();
    state.failed({ kind: 'source', id: 'x' });
    state.failed({ kind: 'source', id: 'x' });
    state.failed({ kind: 'guide', id: 'x' });
    state.saved({ kind: 'source', id: 'x' });
    expect(state.full.value).toBe(true);
    expect(state.sourceFull('x')).toBe(false);
    state.saved({ kind: 'guide', id: 'x' });
    expect(state.full.value).toBe(false);
  });

  it('tells which sources failed for space', () => {
    const state = createStorageState();
    state.failed({ kind: 'source', id: 's1' });
    state.failed({ kind: 'guide', id: 's2' });
    expect(state.sourceFull('s1')).toBe(true);
    expect(state.sourceFull('s2')).toBe(false);
    state.saved({ kind: 'source', id: 's1' });
    expect(state.sourceFull('s1')).toBe(false);
  });

  it('changes nothing when an item that never failed goes through', () => {
    const state = createStorageState();
    const before = state.full;
    state.saved({ kind: 'profile' });
    expect(state.full).toBe(before);
    expect(state.full.value).toBe(false);
  });
});
