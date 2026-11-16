import { databaseProbe } from '../../../server/db';
import { health } from '../../../server/health';

// Asked at request time, never at build time or from a cache.
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return health(() => databaseProbe());
}
