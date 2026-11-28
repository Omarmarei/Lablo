// Uses Map, Set, Uint8Array, array .map/.filter and JSON.parse, which make Babel's usage
// detection inject the ES2025/ES2026 polyfills listed in UNUSED_POLYFILLS; padStart, which
// Chromium 68 has (57); and Object.fromEntries, which it lacks (73) and core-js fills.
export function run(): string {
  const seen = new Set<number>([3, 1, 2]);
  const names = new Map<number, string>([...seen].map((n) => [n, `n${n}`] as [number, string]));
  const bytes = new Uint8Array([...seen].filter((n) => n > 1));
  const parsed = (JSON.parse('{"a":7}') as { a: number }).a;
  const counts = Object.fromEntries([['size', seen.size]]) as { size: number };
  return `${[...names.values()].join(',')}|${bytes.join(',')}|${'7'.padStart(3, '0')}|${parsed}|${counts.size}`;
}
(globalThis as { fixture?: unknown }).fixture = { run };
