import { describe, expect, it } from 'vitest';
import type { Flushable } from './exit';
import { endProcess, exitCode } from './exit';

describe('the end of a command (step 58d)', () => {
  it('reads process.exitCode: unset is 0, a number stays, anything else is 1', () => {
    expect([exitCode(undefined), exitCode(null), exitCode(''), exitCode(0), exitCode(1), exitCode(4), exitCode('2'), exitCode('x')]).toEqual([0, 0, 0, 0, 1, 4, 2, 1]);
  });

  it('exits only once what was printed is written out', async () => {
    let flush: () => void = () => undefined;
    const out: Flushable = {
      write: (chunk, done) => {
        expect(chunk).toBe('');
        flush = done;
        return false;
      },
    };
    const exits: number[] = [];
    const ended = endProcess(out, 1, (code) => exits.push(code));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exits).toEqual([]);
    flush();
    await ended;
    expect(exits).toEqual([1]);
  });
});
