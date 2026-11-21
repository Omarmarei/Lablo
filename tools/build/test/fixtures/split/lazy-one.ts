// Build fixture (RELAY step 35e): see two-lazy.ts.
import { both } from './lazy-shared';

export function one(): string {
  return both('one');
}
