/**
 * The development blob route (RELAY step 31d1): `/dev/blob/<key>?…` answers the memory blob
 * store's presigned URLs as R2 answers its own, so the phone page's upload and the TV's download
 * work the same in development and tests as against R2. The URLs are paths on the API's origin
 * (`DEV_BLOB_PATH`), so a phone on the LAN and the e2e test front need no address set.
 *
 * Never on Vercel: there it answers 404 before the services are even asked, and so it does
 * wherever the services' store isn't the memory one (step 34's R2 adapter serves its own URLs).
 *
 * - `PUT`: the phone's upload of the encrypted file, exactly the URL's size. Its body is read
 *   with a cap of that size (at most `PAIR_FILE_MAX_BYTES`): past it the URL's check still comes
 *   first (403), then the length (400). Same origin as the page: no CORS headers.
 * - `GET`: the TV's download, from another origin (a packaged app, or the dev app's port): any
 *   origin may read it, as R2's CORS rule will allow (step 34).
 *
 * Every answer has no body but the file's, and `cache-control: no-store`.
 */
import { PAIR_FILE_MAX_BYTES } from '@lablo/protocol';
import { MemoryBlobStore } from './blob-store';
import { readBytes } from './http';
import type { Services } from './services';
import { services } from './services';

type Env = Readonly<Record<string, string | undefined>>;

const NO_STORE: Readonly<Record<string, string>> = { 'cache-control': 'no-store' };
/** The TV reads the file from another origin. */
const GET_HEADERS: Readonly<Record<string, string>> = { ...NO_STORE, 'access-control-allow-origin': '*' };

function empty(status: number, headers: Readonly<Record<string, string>>): Response {
  return new Response(null, { status, headers });
}

/** The size a PUT URL's query names, when it is one an upload can have; 0 otherwise (its check refuses it). */
function declaredSize(search: string): number {
  const n = Number(new URLSearchParams(search).get('n') ?? '');
  return Number.isSafeInteger(n) && n >= 0 && n <= PAIR_FILE_MAX_BYTES ? n : 0;
}

export async function devBlob(request: Request, env: Env = process.env, servicesOf: (env: Env) => Services = services): Promise<Response> {
  const get = request.method === 'GET';
  const headers = get ? GET_HEADERS : NO_STORE;
  if ((env.VERCEL !== undefined && env.VERCEL !== '') || (!get && request.method !== 'PUT')) return empty(404, headers);
  const blobs = servicesOf(env).blobs;
  if (!(blobs instanceof MemoryBlobStore)) return empty(404, headers);
  const url = new URL(request.url);
  const target = `${url.pathname}${url.search}`;
  if (get) {
    const answer = await blobs.redeem('GET', target);
    // Only a 200 has a body: the store's own copy, in a buffer of its own.
    if (answer.body === undefined) return empty(answer.status, headers);
    return new Response(answer.body as Uint8Array<ArrayBuffer>, { status: 200, headers: { ...headers, 'content-type': 'application/octet-stream' } });
  }
  const body = await readBytes(request, declaredSize(url.search));
  // Past the cap: no body the URL could take, so the store refuses it (403 or 400, as R2 would).
  const answer = await blobs.redeem('PUT', target, body ?? undefined);
  return empty(answer.status, headers);
}
