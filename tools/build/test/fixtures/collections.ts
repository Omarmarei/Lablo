// Uses Map, Set, Uint8Array, array .map/.filter and JSON.parse, which make Babel's usage
// detection inject the ES2025/ES2026 polyfills listed in UNUSED_POLYFILLS, plus padStart, which
// still needs one.
export function run(): string {
  const seen = new Set<number>([3, 1, 2]);
  const names = new Map<number, string>([...seen].map((n) => [n, `n${n}`] as [number, string]));
  const bytes = new Uint8Array([...seen].filter((n) => n > 1));
  const parsed = (JSON.parse('{"a":7}') as { a: number }).a;
  return `${[...names.values()].join(',')}|${bytes.join(',')}|${'7'.padStart(3, '0')}|${parsed}`;
}
(globalThis as { fixture?: unknown }).fixture = { run };
