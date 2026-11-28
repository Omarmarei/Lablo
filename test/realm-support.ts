// What the bundled-worker tests share (RELAY steps 7, 29b1 and 30b2): a message channel between
// realms, and the list of what Chromium 68 lacks that core-js or the code could lean on.
import type { RpcPort } from '@lablo/data';

type Listener = (event: MessageEvent) => void;

/** Two ends of a message channel between realms: structured clone, asynchronous delivery. */
export function pipe(): [RpcPort, RpcPort] {
  const listeners: [Listener[], Listener[]] = [[], []];
  const end = (mine: Listener[], theirs: Listener[]): RpcPort => ({
    postMessage: (message) => {
      const data = structuredClone(message);
      setTimeout(() => {
        for (const l of theirs.slice()) l({ data } as MessageEvent);
      }, 0);
    },
    addEventListener: (_type, l) => {
      mine.push(l);
    },
    removeEventListener: (_type, l) => {
      const i = mine.indexOf(l);
      if (i !== -1) mine.splice(i, 1);
    },
  });
  return [end(listeners[0], listeners[1]), end(listeners[1], listeners[0])];
}

/**
 * The APIs Chromium 68 (the oldest TV engine since RELAY step 61a) lacks that core-js or the code
 * could lean on, with the Chromium version that added each. It has what 53 lacked up to ES2018:
 * `Object.entries`/`values` (54), `padStart` (57), `Promise.prototype.finally` (63), `trimStart`
 * (66), `BigInt` (67). A realm that keeps its `globalThis` runs this; others `CHROMIUM_68_MISSING`.
 */
export const CHROMIUM_68_MISSING_APIS = [
  'delete Array.prototype.flat; delete Array.prototype.flatMap;', // 69
  'delete globalThis.queueMicrotask;', // 71
  'delete Object.fromEntries; delete String.prototype.matchAll;', // 73
  'delete Promise.allSettled;', // 76
  'delete Promise.any; delete String.prototype.replaceAll;', // 85
  'delete Array.prototype.at; delete String.prototype.at; delete Object.hasOwn;', // 92, 93
  'delete Array.prototype.findLast; delete Array.prototype.findLastIndex;', // 97
].join('\n');

/** What Chromium 68 lacks, `globalThis` (71) too: run it in a realm before the bundle. */
export const CHROMIUM_68_MISSING = [
  CHROMIUM_68_MISSING_APIS,
  // Last: from here on the realm's own global is reachable only as `self`.
  'delete globalThis.globalThis;',
].join('\n');
