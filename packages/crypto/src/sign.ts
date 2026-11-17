/**
 * The config's signature (architecture.md §3.3 C): Ed25519, verified against the public keys
 * the app embeds (two, so the offline key can be rotated). Signing is for `tools/sign-config`
 * and the test vectors.
 */
import nacl from 'tweetnacl';

const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/** True when `signature` is a valid signature of `message` by one of `publicKeys`. */
export function verifySignature(message: Uint8Array, signature: Uint8Array, publicKeys: readonly Uint8Array[]): boolean {
  if (signature.length !== SIGNATURE_BYTES) return false;
  for (let i = 0; i < publicKeys.length; i++) {
    const key = publicKeys[i]!;
    if (key.length === PUBLIC_KEY_BYTES && nacl.sign.detached.verify(message, signature, key)) return true;
  }
  return false;
}

export interface SignKeyPair {
  readonly publicKey: Uint8Array;
  /** tweetnacl's 64-byte form: the seed, then the public key. */
  readonly secretKey: Uint8Array;
}

/** The Ed25519 key pair of a 32-byte seed (RFC 8032's private key). */
export function signKeyPairFromSeed(seed: Uint8Array): SignKeyPair {
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

export function signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}
