// Build fixture (RELAY step 35e): two lazy parts that share a module main doesn't have, so Rollup
// makes a third file both need. The loader loads one file per import(): the build refuses it.
(globalThis as unknown as { fixture: unknown }).fixture = {
  one: () => import('./lazy-one').then((m) => m.one()),
  two: () => import('./lazy-two').then((m) => m.two()),
};
