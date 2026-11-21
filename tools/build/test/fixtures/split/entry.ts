// Build fixture (RELAY step 35e): an entry that loads its lazy part on demand.
import { count, tick } from './shared';

function open(from: string): Promise<string> {
  return import('./lazy-part').then((part) => part.describe(from));
}

tick();
(globalThis as unknown as { fixture: unknown }).fixture = { open, count: () => count };
