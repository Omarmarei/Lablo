/**
 * Non-cryptographic string hashing for keys (ES2017, `Math.imul` only).
 *
 * FROZEN: M3U ContentKeys contain `hash53` output (ADR-009), and users' favourites reference
 * those keys. Changing this function needs a profile migration; `hash.test.ts` pins its output.
 */

/**
 * A 53-bit hash of a string's UTF-16 code units, returned as a safe integer. Two 32-bit lanes
 * (FNV-1a, and a multiply-xorshift lane) are each finished with the MurmurHash3 fmix32
 * avalanche and cross-mixed. 53 bits keep a 200k-item playlist collision-free in practice
 * (expected collisions about 2e-6; a 32-bit hash would give about 5).
 */
export function hash53(text: string): number {
  let a = 0x811c9dc5 | 0;
  let b = 0x9e3779b9 | 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  a = fmix32(a ^ text.length);
  b = fmix32(b ^ Math.imul(text.length, 0x27d4eb2f));
  a ^= Math.imul(b, 0x165667b1);
  b ^= a >>> 7;
  return (b & 0x1fffff) * 0x100000000 + (a >>> 0);
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/** `hash53` in base 36 (at most 11 characters), the form used inside keys. */
export function hash53Base36(text: string): string {
  return hash53(text).toString(36);
}
