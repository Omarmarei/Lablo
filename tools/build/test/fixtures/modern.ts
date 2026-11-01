// Build fixture: modern source that must come out as Chromium 53 code with working polyfills.
import FixtureWorker from './echo.worker?worker';

interface Point {
  x: number;
  y: number;
  label?: { text: string };
}

async function one(): Promise<number> {
  return 1;
}

async function run(): Promise<string> {
  const base: Point = { x: 1, y: 2 };
  const moved: Point = { ...base, x: (await one()) + 1 };
  const { x, ...rest } = moved;
  const label = moved.label?.text ?? 'none';
  const pairs = Object.entries(rest).map(([key, value]) => `${key}=${String(value).padStart(3, '0')}`);
  return [x, label, ...pairs].join(',');
}

(globalThis as unknown as { fixture: unknown }).fixture = { run, createWorker: () => new FixtureWorker() };
