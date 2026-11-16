import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/server/db';

/** The process's database client (RELAY step 29a). Creating one opens no connection. */

const saved = process.env.DATABASE_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
  vi.restoreAllMocks();
});

describe('db', () => {
  it('keeps one client per URL', () => {
    process.env.DATABASE_URL = 'postgresql://lablo@127.0.0.1:1/one';
    expect(db()).toBe(db());
  });

  it('follows DATABASE_URL, and closes the client it replaces', () => {
    process.env.DATABASE_URL = 'postgresql://lablo@127.0.0.1:1/two';
    const first = db();
    const closed = vi.spyOn(first, '$disconnect');
    process.env.DATABASE_URL = 'postgresql://lablo@127.0.0.1:1/three';
    const second = db();
    expect(second).not.toBe(first);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(db()).toBe(second);
  });

  it('throws without a DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    expect(() => db()).toThrow('DATABASE_URL is not set');
  });
});
