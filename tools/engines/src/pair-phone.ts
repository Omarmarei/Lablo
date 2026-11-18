import { FILE_FRAME_BYTES, fileCipherLength, fileFrameCount, fromBase64Url, newFileKey, newFileNonceBase, sealFile, sealPairPayload, toBase64Url, utf8 } from '@lablo/crypto';
import type { PairPayload, PairProgressResponse } from '@lablo/protocol';
import { pairUploadResponseSchema } from '@lablo/protocol';

/**
 * A scripted phone (RELAY step 31c2a; moved here from e2e/ in 31c2b, so the old-engine walk
 * uses it too) over the pairing API's phone routes, as the phone page (apps/web, step 31b) uses
 * them on the typed-code path: the TV's key for the code, the payload sealed to it in this
 * process, then the progress. Only ciphertext goes to the server.
 *
 * Its links carry their scheme (`http://…`): the pairing payload's schema refuses one without,
 * and the TV then treats the payload as unreadable (the phone page adds it before sealing).
 *
 * An M3U file (step 31d2b2a) goes as the phone page sends it (apps/web's `send`): sealed in 1 MiB
 * frames under a new key and nonce base, uploaded to the URL the API gives for exactly its
 * encrypted length, then announced in the sealed payload with its keys.
 */

/** The TV's key for `code` (`GET /v1/pair/:code`). */
async function tvKey(origin: string, code: string): Promise<Uint8Array> {
  const key = await fetch(`${origin}/v1/pair/${code}`);
  if (key.status !== 200) throw new Error(`The TV's key for ${code}: HTTP ${key.status}`);
  const tvPk = fromBase64Url(((await key.json()) as { tvPk: string }).tvPk);
  if (tvPk === null) throw new Error("The TV's key is not base64url");
  return tvPk;
}

/** `payload` sealed to `tvPk` and posted for `code`. */
async function post(origin: string, code: string, payload: PairPayload, tvPk: Uint8Array): Promise<void> {
  const sealed = sealPairPayload(utf8(JSON.stringify(payload)), tvPk);
  const posted = await fetch(`${origin}/v1/pair/${code}/payload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sealed) });
  if (posted.status !== 200) throw new Error(`The payload for ${code}: HTTP ${posted.status}`);
}

/** The TV's key for `code` (`GET /v1/pair/:code`), the payload sealed to it and posted. */
export async function phoneSends(origin: string, code: string, payload: PairPayload): Promise<void> {
  await post(origin, code, payload, await tvKey(origin, code));
}

export interface PhoneFileOptions {
  readonly name?: string;
  readonly epg?: readonly string[];
  /** One bit of the last frame flipped after sealing: the frames before it open, the last fails its check. */
  readonly broken?: true;
}

/**
 * `plain` sent as the phone page sends an M3U file: the TV's key; the frames sealed; the upload's
 * URL for their length (`POST /v1/pair/:code/upload-url`), a path resolved against `origin`; the
 * PUT; then the payload with the file's key, frame key, nonce base and length.
 */
export async function phoneSendsFile(origin: string, code: string, plain: Uint8Array, options: PhoneFileOptions = {}): Promise<void> {
  const tvPk = await tvKey(origin, code);
  const fileKey = newFileKey();
  const base = newFileNonceBase();
  const sealed = sealFile(plain, fileKey, base);
  if (options.broken === true) sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 1;
  const asked = await fetch(`${origin}/v1/pair/${code}/upload-url`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: fileCipherLength(plain.length) }) });
  if (asked.status !== 200) throw new Error(`The upload URL for ${code}: HTTP ${asked.status}`);
  const target = pairUploadResponseSchema.parse(await asked.json());
  const put = await fetch(target.url.charAt(0) === '/' ? origin + target.url : target.url, { method: 'PUT', body: sealed as Uint8Array<ArrayBuffer> });
  if (put.status !== 200) throw new Error(`The upload for ${code}: HTTP ${put.status}`);
  const payload: PairPayload = {
    v: 1,
    source: { type: 'm3u-file', file: { key: target.key, fileKey: toBase64Url(fileKey), base: toBase64Url(base), size: plain.length } },
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.epg === undefined ? {} : { epg: [...options.epg] }),
  };
  await post(origin, code, payload, tvPk);
}

/** A comment line a parser skips, 1 KiB long. */
const PAD_LINE = `#PAD ${'.'.repeat(1018)}\n`;

/** `text` with `#PAD` lines at its end until it needs exactly `frames` frames (the last holds at least one byte). */
export function phonePadded(text: string, frames: number): Uint8Array {
  const body = text.endsWith('\n') ? text : `${text}\n`;
  const lines = Math.max(0, Math.ceil(((frames - 1) * FILE_FRAME_BYTES + 1 - utf8(body).length) / PAD_LINE.length));
  const padded = utf8(body + PAD_LINE.repeat(lines));
  if (fileFrameCount(padded.length) !== frames) throw new Error(`The padded playlist needs ${fileFrameCount(padded.length)} frames, not ${frames}`);
  return padded;
}

/** How far the phone's payload got (`GET /v1/pair/:code/status`), as the phone page reads it. */
export async function phoneSees(origin: string, code: string): Promise<PairProgressResponse | number> {
  const answer = await fetch(`${origin}/v1/pair/${code}/status`);
  return answer.status === 200 ? ((await answer.json()) as PairProgressResponse) : answer.status;
}
