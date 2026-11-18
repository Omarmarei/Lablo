import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BACKUP_CODE_BYTES, BACKUP_CODE_LENGTH, backupCodeText, readBackupCode } from './backup-code';
import * as index from './index';

/**
 * The oracle, by another road: the 16 bytes as a string of 128 bits, two zero bits in front (the
 * number is big-endian), cut into 26 groups of five, each a Crockford digit.
 */
function oracle(bytes: Uint8Array): string {
  const bits = '00' + [...bytes].map((byte) => byte.toString(2).padStart(8, '0')).join('');
  const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 130; i += 5) out += crockford[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

const fill = (value: number): Uint8Array => new Uint8Array(16).fill(value);

/** 0123456789abcdeffedcba9876543210 as a code. */
const CODE = '014D2PF2DBSQQZXQ5TK1V58CGG';

describe('the backup code', () => {
  it('is 16 bytes shown as 26 characters', () => {
    expect(BACKUP_CODE_BYTES).toBe(16);
    expect(BACKUP_CODE_LENGTH).toBe(26);
    expect(index.backupCodeText).toBe(backupCodeText);
    expect(index.readBackupCode).toBe(readBackupCode);
  });

  it('is the number in base 32, big-endian, with Crockford digits (pinned)', () => {
    expect(backupCodeText(fill(0))).toBe('00000000000000000000000000');
    expect(backupCodeText(fill(255))).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    const one = fill(0);
    one[15] = 1;
    expect(backupCodeText(one)).toBe('00000000000000000000000001');
    const top = fill(0);
    top[0] = 0x80;
    expect(backupCodeText(top)).toBe('40000000000000000000000000');
    const bytes = Uint8Array.from(Buffer.from('0123456789abcdeffedcba9876543210', 'hex'));
    expect(backupCodeText(bytes)).toBe(CODE);
    expect(oracle(bytes)).toBe(CODE);
  });

  it('agrees with the oracle on random codes, and reads back as itself', () => {
    for (let i = 0; i < 500; i++) {
      const bytes = new Uint8Array(nodeRandomBytes(16));
      const code = backupCodeText(bytes);
      expect(code).toBe(oracle(bytes));
      expect(code).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(readBackupCode(code)).toBe(code);
    }
  });

  it('gives each bit its own place (no two single-bit codes alike)', () => {
    const seen = new Set<string>();
    for (let bit = 0; bit < 128; bit++) {
      const bytes = fill(0);
      bytes[bit >> 3] = 0x80 >> (bit & 7);
      const code = backupCodeText(bytes);
      expect(code).toBe(oracle(bytes));
      seen.add(code);
    }
    expect(seen.size).toBe(128);
  });

  it.each([0, 15, 17, 32])('refuses %i bytes', (length) => {
    expect(() => backupCodeText(new Uint8Array(length))).toThrow(RangeError);
  });
});

describe('readBackupCode', () => {
  it('reads the code as people type it: groups, dashes, lower case, stray spacing', () => {
    expect(readBackupCode('014D2 PF2DB SQQZX Q5TK1 V58CG G')).toBe(CODE);
    expect(readBackupCode('014d-2pf2-dbsq-qzxq-5tk1-v58c-gg')).toBe(CODE);
    expect(readBackupCode(' 014d2pf2dbsqqzxq5tk1v58cgg' + String.fromCharCode(10))).toBe(CODE);
    expect(readBackupCode('014D2PF2DBSQQZXQ5TK1V58CGG' + String.fromCharCode(9))).toBe(CODE);
  });

  it('reads I and L as 1 and O as 0, in either case', () => {
    expect(readBackupCode('OI4D2PF2DBSQQZXQ5TKLV58CGG')).toBe(CODE);
    expect(readBackupCode('ol4D2PF2DBSQQZXQ5TKiV58CGG')).toBe(CODE);
    expect(readBackupCode('0L4D2PF2DBSQQZXQ5TKIV58CGG')).toBe(CODE);
  });

  it.each([
    ['too short', '014D2PF2DBSQQZXQ5TK1V58CG'],
    ['too long', '014D2PF2DBSQQZXQ5TK1V58CGG0'],
    ['a U', '014D2PF2DBSQQZXQ5TK1V58CGU'],
    ['another symbol', '014D2PF2DBSQQZXQ5TK1V58CG.'],
    ['an underscore', '014D2PF2DBSQQZXQ5TK1V58C_G'],
    ['a first character above 7', '814D2PF2DBSQQZXQ5TK1V58CGG'],
    ['nothing', ''],
    ['only separators', ' - - '],
  ])('refuses %s', (_, typed) => {
    expect(readBackupCode(typed)).toBeNull();
  });

  it('takes 7 as a first character, and Z anywhere', () => {
    expect(readBackupCode('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
  });
});
