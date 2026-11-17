/**
 * Pairing's encryption (architecture.md §3.3 A): the server only ever sees ciphertext.
 *
 * - The TV makes an ephemeral X25519 key pair and shows its public key in the QR code.
 * - The phone seals the payload with `box` from its own ephemeral key pair and posts
 *   `{phonePk, nonce, ct}`.
 * - A file goes up encrypted under a random `fileKey` in 1 MiB `secretbox` frames. Frame i's
 *   nonce is base + i, the 24-byte base read as a little-endian number (as libsodium's
 *   `sodium_add`). `fileKey`, the base and the plain size travel inside the boxed payload, so
 *   frames can't be reordered, dropped or cut off unnoticed.
 */
import nacl from 'tweetnacl';
import { fromBase64Url, toBase64Url } from './bytes';
import { randomBytes } from './random';

const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;

/** A file frame's plaintext (the last one may be shorter). */
export const FILE_FRAME_BYTES = 1048576;
/** What `secretbox` adds to each frame. */
export const FILE_FRAME_OVERHEAD = TAG_BYTES;

export interface BoxKeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

export function newBoxKeyPair(): BoxKeyPair {
  const pair = nacl.box.keyPair();
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

/** The key pair of a known secret key (test vectors). */
export function boxKeyPairFromSecretKey(secretKey: Uint8Array): BoxKeyPair {
  const pair = nacl.box.keyPair.fromSecretKey(secretKey);
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

/** The phone's post: its ephemeral public key, the nonce and the boxed payload, base64url. */
export interface SealedPayload {
  readonly phonePk: string;
  readonly nonce: string;
  readonly ct: string;
}

/**
 * Seals the payload to the TV's public key. `phone` and `nonce` are for test vectors only:
 * by default each payload gets a fresh key pair and nonce.
 */
export function sealPairPayload(
  plain: Uint8Array,
  tvPk: Uint8Array,
  phone: BoxKeyPair = newBoxKeyPair(),
  nonce: Uint8Array = randomBytes(NONCE_BYTES),
): SealedPayload {
  if (tvPk.length !== KEY_BYTES) throw new RangeError("the TV's public key is 32 bytes");
  if (nonce.length !== NONCE_BYTES) throw new RangeError('a box nonce is 24 bytes');
  return { phonePk: toBase64Url(phone.publicKey), nonce: toBase64Url(nonce), ct: toBase64Url(nacl.box(plain, nonce, tvPk, phone.secretKey)) };
}

/** The payload, or null when the post is malformed or doesn't open with the TV's secret key. */
export function openPairPayload(sealed: SealedPayload, tvSecretKey: Uint8Array): Uint8Array | null {
  if (tvSecretKey.length !== KEY_BYTES) throw new RangeError("the TV's secret key is 32 bytes");
  const phonePk = fromBase64Url(sealed.phonePk);
  const nonce = fromBase64Url(sealed.nonce);
  const ct = fromBase64Url(sealed.ct);
  if (phonePk === null || phonePk.length !== KEY_BYTES || nonce === null || nonce.length !== NONCE_BYTES || ct === null || ct.length < TAG_BYTES) return null;
  return nacl.box.open(ct, nonce, phonePk, tvSecretKey);
}

/** A file's random key and nonce base. */
export function newFileKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

export function newFileNonceBase(): Uint8Array {
  return randomBytes(NONCE_BYTES);
}

/** Frame `index`'s nonce: `base` + `index`, little-endian, with carry. */
export function frameNonce(base: Uint8Array, index: number): Uint8Array {
  if (base.length !== NONCE_BYTES) throw new RangeError('a frame nonce base is 24 bytes');
  if (!(index >= 0 && index <= 0xffffffff && Math.floor(index) === index)) throw new RangeError('a frame index is a whole number below 2^32');
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(base);
  let add = index;
  let carry = 0;
  for (let i = 0; i < NONCE_BYTES && (add > 0 || carry > 0); i++) {
    const sum = nonce[i]! + (add % 256) + carry;
    nonce[i] = sum & 255;
    carry = sum >>> 8;
    add = Math.floor(add / 256);
  }
  return nonce;
}

/** How many frames a file of `size` plain bytes has (none for an empty file). */
export function fileFrameCount(size: number): number {
  return Math.ceil(size / FILE_FRAME_BYTES);
}

/** The encrypted file's length: every frame's plaintext plus its tag. */
export function fileCipherLength(size: number): number {
  return size + fileFrameCount(size) * FILE_FRAME_OVERHEAD;
}

export function sealFileFrame(plain: Uint8Array, fileKey: Uint8Array, base: Uint8Array, index: number): Uint8Array {
  if (plain.length > FILE_FRAME_BYTES) throw new RangeError('a file frame holds at most 1 MiB');
  if (fileKey.length !== KEY_BYTES) throw new RangeError('a file key is 32 bytes');
  return nacl.secretbox(plain, frameNonce(base, index), fileKey);
}

/** Frame `index`'s plaintext, or null when it doesn't open there. */
export function openFileFrame(ct: Uint8Array, fileKey: Uint8Array, base: Uint8Array, index: number): Uint8Array | null {
  if (fileKey.length !== KEY_BYTES) throw new RangeError('a file key is 32 bytes');
  if (ct.length < FILE_FRAME_OVERHEAD || ct.length > FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD) return null;
  return nacl.secretbox.open(ct, frameNonce(base, index), fileKey);
}

/** The whole file encrypted: its frames one after the other. */
export function sealFile(plain: Uint8Array, fileKey: Uint8Array, base: Uint8Array): Uint8Array {
  const count = fileFrameCount(plain.length);
  const out = new Uint8Array(fileCipherLength(plain.length));
  for (let i = 0; i < count; i++) {
    const chunk = plain.subarray(i * FILE_FRAME_BYTES, Math.min((i + 1) * FILE_FRAME_BYTES, plain.length));
    out.set(sealFileFrame(chunk, fileKey, base, i), i * (FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD));
  }
  return out;
}

/**
 * The file of `size` plain bytes (from the boxed payload), or null when `ct` isn't exactly
 * its frames or any frame fails to open in its place.
 */
export function openFile(ct: Uint8Array, fileKey: Uint8Array, base: Uint8Array, size: number): Uint8Array | null {
  if (!(size >= 0 && Math.floor(size) === size) || ct.length !== fileCipherLength(size)) return null;
  const out = new Uint8Array(size);
  const count = fileFrameCount(size);
  for (let i = 0; i < count; i++) {
    const start = i * (FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD);
    const plain = openFileFrame(ct.subarray(start, Math.min(start + FILE_FRAME_BYTES + FILE_FRAME_OVERHEAD, ct.length)), fileKey, base, i);
    if (plain === null) return null;
    out.set(plain, i * FILE_FRAME_BYTES);
  }
  return out;
}
