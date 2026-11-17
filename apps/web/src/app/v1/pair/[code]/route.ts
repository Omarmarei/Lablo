// Pairing (RELAY step 31a): the TV's key for a typed code (the phone). The work is in src/server/pair.ts.
import { pairRoute, pairTvKey } from '../../../../server/pair';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  return pairRoute('key', (deps) => pairTvKey(deps, request, code));
}
