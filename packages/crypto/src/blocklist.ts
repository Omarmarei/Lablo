import { toBase64Url, utf8 } from './bytes';
import { sha256 } from './hash';

/**
 * A blocklist entry (architecture.md §3.3 C): b64url(SHA-256(UTF-8(salt + host))). The config
 * lists only these hashes, so it names no domain. `host` is as the client normalises it
 * (step 30: lowercase, ASCII, no trailing dot); the client hashes the host and each parent.
 */
export function blocklistHash(salt: string, host: string): string {
  return toBase64Url(sha256(utf8(salt + host)));
}
