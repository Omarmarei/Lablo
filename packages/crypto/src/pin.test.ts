import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pinHash } from './pin';

describe('pinHash (RELAY step 38)', () => {
  it('is b64url(SHA-256(salt + ":" + pin)), checked against Node', () => {
    const node = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64url');
    expect(pinHash('c2FsdA', '1234')).toBe(node('c2FsdA:1234'));
    expect(pinHash('', '0000')).toBe(node(':0000'));
    // A pinned value, so a change to the scheme can't pass by changing both sides.
    expect(pinHash('salt', '1234')).toBe('NcVjFPiQZgVkCNbSadr55pIXuZUyFfKG7shs7DB2Jxo');
  });

  it('differs with the salt and with the PIN', () => {
    expect(pinHash('a', '1234')).not.toBe(pinHash('b', '1234'));
    expect(pinHash('a', '1234')).not.toBe(pinHash('a', '1235'));
    // The separator: "1" + "234" and "12" + "34" don't meet.
    expect(pinHash('1', '234')).not.toBe(pinHash('12', '34'));
  });
});
