// Telemetry (RELAY step 33a): the TV's batches of events. The work is in src/server/telemetry.ts.
import { preflight } from '../../../server/http';
import { postTelemetry, telemetryRoute } from '../../../server/telemetry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return telemetryRoute((deps) => postTelemetry(deps, request));
}

export function OPTIONS(): Response {
  return preflight('POST', 'content-type');
}
