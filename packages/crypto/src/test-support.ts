/** Hex helpers for the tests and the vector checks (not exported from the package). */
const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX.charAt(bytes[i]! >>> 4) + HEX.charAt(bytes[i]! & 15);
  return out;
}

export function fromHex(text: string): Uint8Array {
  if (text.length % 2 !== 0 || !/^[0-9a-f]*$/.test(text)) throw new Error(`not lowercase hex: ${text}`);
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
}

/** Deterministic bytes for tests: `(i * 31 + seed) & 255`. */
export function patternBytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 255;
  return out;
}

/** Flips `mask`'s bits of byte `index` in place (a tampered ciphertext, nonce or signature). */
export function flip(bytes: Uint8Array, index: number, mask: number): void {
  bytes[index] = bytes[index]! ^ mask;
}

/** Byte-for-byte equality, quick for megabytes (Vitest's deep equality is slow there). */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
