// Pairing (RELAY step 31a): a presigned PUT for the phone's encrypted file. The work is in src/server/pair.ts.
import { pairRoute, pairUploadUrl } from '../../../../../server/pair';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  return pairRoute('upload', (deps) => pairUploadUrl(deps, request, code));
}
