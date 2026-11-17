import nacl from 'tweetnacl';

/**
 * Bytes from the platform's CSPRNG (`crypto.getRandomValues`, through tweetnacl; Node's
 * `crypto.randomBytes` in tests). Throws where there is none: no key is ever made from a
 * weaker source.
 */
export function randomBytes(length: number): Uint8Array {
  return nacl.randomBytes(length);
}
