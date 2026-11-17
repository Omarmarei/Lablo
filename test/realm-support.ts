// What the bundled-worker tests share (RELAY steps 7, 29b1 and 30b2): a message channel between
// realms, and the list of what Chromium 53 lacks that core-js or the code could lean on.
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

/** What Chromium 53 lacks that core-js or the code could lean on: run it in a realm before the bundle. */
export const CHROMIUM_53_MISSING = [
  'delete globalThis.BigInt;',
  'delete globalThis.BigInt64Array;',
  'delete globalThis.BigUint64Array;',
  'delete Object.entries; delete Object.values; delete Object.getOwnPropertyDescriptors; delete Object.fromEntries;',
  'delete String.prototype.padStart; delete String.prototype.padEnd;',
  // ES2019 and later (Chromium 66 and newer); `trimLeft` stays, Chromium 53 has it.
  'delete String.prototype.trimStart; delete String.prototype.trimEnd;',
  'delete Object.hasOwn; delete Array.prototype.at; delete String.prototype.at; delete Array.prototype.findLast; delete Array.prototype.findLastIndex;',
  'delete String.prototype.replaceAll; delete String.prototype.matchAll; delete Promise.allSettled; delete Promise.any;',
  'delete Array.prototype.flat; delete Array.prototype.flatMap;',
  'delete Promise.prototype.finally;',
  'delete globalThis.queueMicrotask;',
  // Last: from here on the realm's own global is reachable only as `self`.
  'delete globalThis.globalThis;',
].join('\n');
