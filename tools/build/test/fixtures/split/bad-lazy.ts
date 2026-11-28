// Build fixture (RELAY step 35e): a lazy file with syntax Babel cannot transpile; the gate checks it too.
(globalThis as unknown as { fixture: unknown }).fixture = { load: () => import('../match-indices') };
