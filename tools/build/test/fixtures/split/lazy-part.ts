// Build fixture (RELAY step 35e): the lazy part. Modern syntax, a polyfill and a worker that only
// it needs, so they belong in its own file.
import FixtureWorker from '../echo.worker?worker';
import { count, label, tick } from './shared';

async function settled(): Promise<number> {
  return 1;
}

export async function describe(from: string): Promise<string> {
  tick();
  const { a, ...rest } = { a: await settled(), b: 2 };
  return `${label(from)} ${String(count).padStart(3, '0')} ${a}${Object.keys(rest).join('')} lazy-part-marker`;
}

export function makeWorker(): unknown {
  return new FixtureWorker();
}
