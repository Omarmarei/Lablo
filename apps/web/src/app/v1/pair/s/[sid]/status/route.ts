// Pairing (RELAY step 31a): the TV's status category. The work is in src/server/pair.ts.
import { preflight, TV_CORS } from '../../../../../../server/http';
import { pairRoute, pairStatus } from '../../../../../../server/pair';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ sid: string }> }): Promise<Response> {
  const { sid } = await context.params;
  return pairRoute('status', (deps) => pairStatus(deps, request, sid), TV_CORS);
}

export function OPTIONS(): Response {
  return preflight('POST');
}
