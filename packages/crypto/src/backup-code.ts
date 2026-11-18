/**
 * The backup code (architecture.md §3.3 B, RELAY step 32b): the secret a TV without a device ID
 * backs up under ("Not now" at the consent screen, or a platform that gives none). 128 random
 * bits, made on the TV and kept in IndexedDB; Settings shows it for the user to photograph, and
 * after a wipe they type it back (step 32d).
 *
 * Its text is the 128-bit number in base 32, big-endian, as 26 Crockford characters (no I, L, O
 * or U). 26 × 5 = 130 bits, so the first character is 0 to 7. That text is the secret scrypt
 * takes (`deriveBackupMaster`).
 */

/** Crockford's base32: the code's alphabet. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The code's bytes: 128 bits. */
export const BACKUP_CODE_BYTES = 16;
/** The code's characters. */
export const BACKUP_CODE_LENGTH = 26;

/** 26 characters of the alphabet, the first one 0 to 7. */
const CODE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** The code's text for its 16 bytes. */
export function backupCodeText(bytes: Uint8Array): string {
  if (bytes.length !== BACKUP_CODE_BYTES) throw new RangeError('a backup code is 16 bytes');
  // Read from the last character back: 5 bits at a time from the low end of the number.
  let code = '';
  let value = 0;
  let bits = 0;
  for (let i = BACKUP_CODE_BYTES - 1; i >= 0; i--) {
    value |= bytes[i]! << bits;
    bits += 8;
    while (bits >= 5) {
      code = ALPHABET.charAt(value & 31) + code;
      value >>>= 5;
      bits -= 5;
    }
  }
  // 128 = 25 × 5 + 3: the last 3 bits are the first character.
  return ALPHABET.charAt(value) + code;
}

/** Crockford's reading of the letters it leaves out. */
function readAs(char: string): string {
  if (char === 'I' || char === 'L') return '1';
  if (char === 'O') return '0';
  return char;
}

/**
 * The code as the TV made it, from what a person typed: spaces and dashes dropped, lower case
 * read as upper, I and L as 1, O as 0. `null` when it can't be a code (U, another symbol, a
 * length other than 26, or a first character above 7).
 */
export function readBackupCode(typed: string): string | null {
  let code = '';
  for (let i = 0; i < typed.length; i++) {
    const char = typed.charAt(i);
    if (char === ' ' || char === '-' || char === '\t' || char === '\n') continue;
    code += readAs(char.toUpperCase());
  }
  return CODE.exec(code) === null ? null : code;
}
