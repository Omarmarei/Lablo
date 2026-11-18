// The development blob route (RELAY step 31d1): the memory blob store's presigned URLs, as R2
// answers its own. 404 on Vercel. The work is in src/server/dev-blob.ts.
import { devBlob } from '../../../../server/dev-blob';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return devBlob(request);
}

export function PUT(request: Request): Promise<Response> {
  return devBlob(request);
}
