// Pairing (RELAY step 31a): the phone's progress. The work is in src/server/pair.ts.
import { pairProgress, pairRoute } from '../../../../../server/pair';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  return pairRoute('progress', (deps) => pairProgress(deps, request, code));
}
