// Pairing (RELAY step 31a): a presigned GET of the session's file (the TV). The work is in src/server/pair.ts.
import { preflight, TV_CORS } from '../../../../../../server/http';
import { pairFileUrl, pairRoute } from '../../../../../../server/pair';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ sid: string }> }): Promise<Response> {
  const { sid } = await context.params;
  return pairRoute('file', (deps) => pairFileUrl(deps, request, sid), TV_CORS);
}

export function OPTIONS(): Response {
  return preflight('GET');
}
