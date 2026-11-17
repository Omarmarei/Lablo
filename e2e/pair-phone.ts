import { fromBase64Url, utf8 } from '../packages/crypto/src/bytes';
import { sealPairPayload } from '../packages/crypto/src/pairing';
import type { PairPayload, PairProgressResponse } from '../packages/protocol/src/pairing';

/**
 * A scripted phone (RELAY step 31c2a) over the pairing API's phone routes, as the phone page
 * (apps/web, step 31b) uses them on the typed-code path: the TV's key for the code, the payload
 * sealed to it in this process, then the progress. Only ciphertext goes to the server.
 */

/** The TV's key for `code` (`GET /v1/pair/:code`), the payload sealed to it and posted. */
export async function phoneSends(origin: string, code: string, payload: PairPayload): Promise<void> {
  const key = await fetch(`${origin}/v1/pair/${code}`);
  if (key.status !== 200) throw new Error(`The TV's key for ${code}: HTTP ${key.status}`);
  const tvPk = fromBase64Url(((await key.json()) as { tvPk: string }).tvPk);
  if (tvPk === null) throw new Error("The TV's key is not base64url");
  const sealed = sealPairPayload(utf8(JSON.stringify(payload)), tvPk);
  const posted = await fetch(`${origin}/v1/pair/${code}/payload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sealed) });
  if (posted.status !== 200) throw new Error(`The payload for ${code}: HTTP ${posted.status}`);
}

/** How far the phone's payload got (`GET /v1/pair/:code/status`), as the phone page reads it. */
export async function phoneSees(origin: string, code: string): Promise<PairProgressResponse | number> {
  const answer = await fetch(`${origin}/v1/pair/${code}/status`);
  return answer.status === 200 ? ((await answer.json()) as PairProgressResponse) : answer.status;
}
