/**
 * Luna service calls without LG's webOSTV.js: a web app on a webOS TV gets the
 * `PalmServiceBridge` constructor, and webOSTV.js's `webOS.service.request` is a thin layer over
 * it (`bridge.call(uri, JSON params)`, the answer as a JSON string in `onservicecallback`).
 */

/** The slice of `PalmServiceBridge` a one-shot call needs. */
export interface ServiceBridge {
  onservicecallback: ((message: string) => void) | null;
  call(uri: string, params: string): void;
  cancel?(): void;
}

export type BridgeFactory = () => ServiceBridge | null;

export class LunaError extends Error {
  override readonly name = 'LunaError';
}

/** `new PalmServiceBridge()` on a webOS TV, `null` anywhere else. */
export function palmServiceBridge(): ServiceBridge | null {
  const Bridge = (window as unknown as { PalmServiceBridge?: new () => ServiceBridge }).PalmServiceBridge;
  if (typeof Bridge !== 'function') return null;
  try {
    return new Bridge();
  } catch {
    return null;
  }
}

/**
 * One luna call: resolves the service's answer, rejects with a LunaError when the bridge is
 * missing, the answer isn't JSON, `returnValue` is false, or nothing comes within `timeoutMs`.
 *
 * `params` is the JSON text itself (`'{"idType":["LGUDID"]}'`): a `JSON.stringify` here would
 * pull core-js's es.json.stringify (about 4 KB) into the app's main bundle.
 */
export function lunaRequest(
  uri: string,
  params: string,
  { timeoutMs = 3000, bridge = palmServiceBridge }: { timeoutMs?: number; bridge?: BridgeFactory } = {},
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const service = bridge();
    if (service === null) {
      reject(new LunaError(`no PalmServiceBridge for ${uri}`));
      return;
    }
    let settled = false;
    const finish = (): void => {
      settled = true;
      clearTimeout(timer);
      service.onservicecallback = null;
      try {
        service.cancel?.();
      } catch {
        // Already finished on the service's side.
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new LunaError(`${uri} did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
    // The bridge stays referenced by this closure until the answer: a collected bridge never calls back.
    service.onservicecallback = (message: string) => {
      if (settled) return;
      finish();
      let answer: unknown;
      try {
        answer = JSON.parse(message);
      } catch {
        reject(new LunaError(`${uri} answered with something other than JSON`));
        return;
      }
      if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
        reject(new LunaError(`${uri} answered with something other than an object`));
        return;
      }
      const record = answer as Record<string, unknown>;
      if (record.returnValue === false) {
        const text = typeof record.errorText === 'string' ? record.errorText : 'no errorText';
        reject(new LunaError(`${uri} failed: ${text}${record.errorCode === undefined ? '' : ` (${String(record.errorCode)})`}`));
        return;
      }
      resolve(record);
    };
    try {
      service.call(uri, params);
    } catch (error) {
      finish();
      reject(new LunaError(`${uri} threw: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * `text` as a JSON string literal, for a luna call's params without `JSON.stringify` (see
 * `lunaRequest`): quotes, backslashes and control characters escaped, the rest as it is.
 */
export function jsonText(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === QUOTE || c === BACKSLASH) out += String.fromCharCode(BACKSLASH, c);
    else if (c < 0x20) out += String.fromCharCode(BACKSLASH) + 'u00' + (c < 0x10 ? '0' : '') + c.toString(16);
    else out += text.charAt(i);
  }
  return out + '"';
}

export const DEVICE_ID_URI = 'luna://com.webos.service.sm/deviceid/getIDs';

/** The LGUDID from a `deviceid/getIDs` answer (`idList: [{ idType: 'LGUDID', idValue }]`), or `null`. */
export function lgudidFrom(answer: Record<string, unknown>): string | null {
  const list = answer.idList;
  if (!Array.isArray(list)) return null;
  for (const entry of list as unknown[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const { idType, idValue } = entry as { idType?: unknown; idValue?: unknown };
    if (idType === 'LGUDID' && typeof idValue === 'string' && idValue.trim() !== '') return idValue.trim();
  }
  return null;
}

/** The TV's LGUDID, or `null` when the service is missing, refuses or has none. */
export function readLgudid(bridge: BridgeFactory = palmServiceBridge, timeoutMs = 3000): Promise<string | null> {
  return lunaRequest(DEVICE_ID_URI, '{"idType":["LGUDID"]}', { bridge, timeoutMs }).then(lgudidFrom, () => null);
}
