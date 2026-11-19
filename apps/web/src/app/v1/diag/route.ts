// The diagnostics report (RELAY step 33d1): a report from the TV, answered with its support code. The work is in src/server/diag.ts.
import { diagRoute, postDiag } from '../../../server/diag';
import { preflight } from '../../../server/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return diagRoute((deps) => postDiag(deps, request));
}

export function OPTIONS(): Response {
  return preflight('POST', 'content-type');
}
