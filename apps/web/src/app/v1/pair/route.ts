// Pairing (RELAY step 31a): the TV registers its key and gets a code. The work is in src/server/pair.ts.
import { preflight, TV_CORS } from '../../../server/http';
import { createPair, pairRoute } from '../../../server/pair';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return pairRoute('create', (deps) => createPair(deps, request), TV_CORS);
}

export function OPTIONS(): Response {
  return preflight('POST');
}
