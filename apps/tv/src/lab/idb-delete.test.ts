import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDatabaseAndWait } from './idb-delete';

describe('deleting a database, waiting out closing connections', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  type Handlers = { onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null; error: { message: string } | null };
  const factory = (act: (req: Handlers) => void): IDBFactory =>
    ({
      deleteDatabase: () => {
        const req: Handlers = { onsuccess: null, onerror: null, onblocked: null, error: null };
        setTimeout(() => act(req), 0);
        return req;
      },
    }) as unknown as IDBFactory;

  it('resolves once the delete succeeds, even after a blocked event', async () => {
    const answer = deleteDatabaseAndWait(
      factory((req) => {
        req.onblocked?.();
        setTimeout(() => req.onsuccess?.(), 5);
      }),
      'zoma',
    );
    expect(await answer).toBeNull();
  });

  it('reports an error, a throw and a delete still blocked at the timeout', async () => {
    expect(
      await deleteDatabaseAndWait(
        factory((req) => {
          req.error = { message: 'UnknownError' };
          req.onerror?.();
        }),
        'zoma',
      ),
    ).toBe('UnknownError');
    const throwing = {
      deleteDatabase: () => {
        throw new Error('SecurityError');
      },
    } as unknown as IDBFactory;
    expect(await deleteDatabaseAndWait(throwing, 'zoma')).toBe('SecurityError');
    vi.useFakeTimers();
    const stuck = deleteDatabaseAndWait(factory((req) => req.onblocked?.()), 'zoma', 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await stuck).toBe('still blocked after 1000 ms');
  });
});
