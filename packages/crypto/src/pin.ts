import { toBase64Url, utf8 } from './bytes';
import { sha256 } from './hash';

/**
 * The parental PIN's hash (RELAY step 38): b64url(SHA-256(UTF-8(salt + ":" + pin))), with the
 * salt the TV drew when the PIN was set. Four digits are found from it in no time; it only keeps
 * the PIN out of plain sight in the profile and its backup.
 */
export function pinHash(salt: string, pin: string): string {
  return toBase64Url(sha256(utf8(salt + ':' + pin)));
}
