// Pairing (RELAY step 31a): the phone's sealed payload. The work is in src/server/pair.ts.
import { pairRoute, postPairPayload } from '../../../../../server/pair';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  return pairRoute('payload', (deps) => postPairPayload(deps, request, code));
}
