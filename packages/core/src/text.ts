/** Small text helpers shared by the parsers. */

import { MAX_TEXT } from './model';

/** Trims and caps a display text at `max` code units, never splitting a surrogate pair. */
export function cutText(value: string, max = MAX_TEXT): string {
  const text = value.trim();
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max).trim();
}

/** Collapses runs of whitespace (newlines included) to one space, and trims. */
export function collapseSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charAt(i)] = i;

/**
 * Decodes base64 (standard alphabet, padding optional, whitespace ignored) holding UTF-8 text.
 * `null` when it is not base64 or not valid UTF-8, or decodes to control characters: the
 * caller then keeps the raw text (some panels send plain text where base64 is expected).
 * Pure: `atob` and `TextDecoder` are platform APIs, which `core` doesn't use.
 */
export function decodeBase64Utf8(input: string): string | null {
  const text = input.replace(/\s+/g, '').replace(/=+$/, '');
  if (text.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(text)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    buffer = (buffer << 6) | B64_INDEX[text.charAt(i)]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number;
    let need: number;
    if (b < 0x80) {
      cp = b;
      need = 0;
    } else if (b >= 0xc2 && b < 0xe0) {
      cp = b & 0x1f;
      need = 1;
    } else if (b >= 0xe0 && b < 0xf0) {
      cp = b & 0x0f;
      need = 2;
    } else if (b >= 0xf0 && b < 0xf5) {
      cp = b & 0x07;
      need = 3;
    } else {
      return null;
    }
    if (i + need >= bytes.length && need > 0) return null;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]!;
      if ((c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    // Overlong forms, surrogates and out-of-range code points are not UTF-8.
    if ((need === 2 && cp < 0x800) || (need === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) return null;
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
