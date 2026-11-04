// The Zoma Lab's native-feature probe (RELAY step 15a). It runs before the lab's bundle, so
// before core-js fills any gap, and records which built-ins the engine itself has: S1 reports
// them next to what the bundle made work. Plain ES5: the TV build inlines it into index.html
// and runs its syntax gate on it; lab.html loads it as a classic script under `pnpm dev`.
/* global window */
(function (g) {
  var fn = function (value) {
    return typeof value === 'function';
  };
  g.__ZOMA_LAB_NATIVE__ = {
    'String.prototype.padStart': fn(String.prototype.padStart),
    'Object.entries': fn(Object.entries),
    'Object.values': fn(Object.values),
    'Object.fromEntries': fn(Object.fromEntries),
    'Promise.prototype.finally': typeof Promise === 'function' && fn(Promise.prototype['finally']),
    'Array.prototype.flat': fn(Array.prototype.flat),
    'Array.prototype.includes': fn(Array.prototype.includes),
    globalThis: typeof g.globalThis === 'object',
    queueMicrotask: fn(g.queueMicrotask)
  };
})(window);
