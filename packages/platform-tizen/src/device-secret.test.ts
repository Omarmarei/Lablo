import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTizenPlatform } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A window with Samsung's Product API answering `getDuid` as given. */
function withProductInfo(getDuid?: () => unknown): void {
  vi.stubGlobal('window', getDuid === undefined ? {} : { webapis: { productinfo: { getDuid } } });
}

describe('the DUID (deviceSecret on Tizen)', () => {
  it('reads webapis.productinfo.getDuid()', async () => {
    withProductInfo(() => ' Q3CNHKHUDLN5W ');
    expect(await createTizenPlatform().deviceSecret()).toBe('Q3CNHKHUDLN5W');
  });

  it.each([
    ['no webapis (a desktop browser)', undefined],
    ['an empty DUID', () => ''],
    ['a DUID that is not text', () => 42],
    ['a call that throws (no privilege)', () => {
      throw new Error('SecurityError');
    }],
  ])('is null with %s', async (_what, getDuid) => {
    withProductInfo(getDuid);
    expect(await createTizenPlatform().deviceSecret()).toBeNull();
  });
});
