/**
 * The TV's signed-config client (architecture.md §3.3 C, RELAY step 30b1): fetch
 * `GET <api>/v1/config`, check it (config-check.ts), keep the verified copy in IndexedDB, and give
 * this TV's policy (config-policy.ts). The config worker serves it (`configHandlers`, step 30b2):
 * the app starts one after the first paint and every `CONFIG_REFRESH_MS`, without waiting for it.
 *
 * - `load` gives the cached copy's policy (or `noPolicy()`), without the network.
 * - `refresh` fetches with `CONFIG_TIMEOUT_MS` for the whole answer and a `CONFIG_MAX_BYTES` cap.
 *   A good answer replaces the cached copy (with the country it carried); on any failure the
 *   cached copy stays in force and the result says why. If IndexedDB can't keep a good answer,
 *   its policy still holds for this run (`stored: false`): a kill must not wait on storage.
 */
import { fromBase64Url } from '@lablo/crypto';
import type { ByteResponse, ByteTransport } from './bytes';
import { decodeUtf8, tapBytes } from './bytes';
import type { CachedConfig, ConfigRefusal, VerifiedConfig } from './config-check';
import { checkConfigResponse, readCachedConfig } from './config-check';
import type { ConfigPlatform, ConfigPolicy } from './config-policy';
import { configPolicy, noPolicy } from './config-policy';
import { CONFIG_KEY, CONFIG_MAX_BYTES, CONFIG_TIMEOUT_MS } from './config-constants';
import { getValue, transact } from './idb';
import type { RpcContext } from './rpc';
import { STORE } from './schema';
import type { Clock } from './throttle';
import { REAL_CLOCK } from './throttle';

export { CONFIG_KEY, CONFIG_MAX_BYTES, CONFIG_REFRESH_MS, CONFIG_RETRY_MS, CONFIG_TIMEOUT_MS } from './config-constants';

/** Why a fetched answer wasn't taken. */
export type ConfigFailure = ConfigRefusal | 'network' | 'timeout' | 'status' | 'too-large';

/** Where the result's policy comes from: the answer just fetched, the cached copy, or none (the defaults). */
export type ConfigStatus = 'fresh' | 'cached' | 'none';

/** Which build asks. */
export interface ConfigTarget {
  platform: ConfigPlatform;
  /** major.minor.patch. */
  version: string;
}

export interface ConfigRequest extends ConfigTarget {
  /** The API's origin, without a trailing slash (`http://127.0.0.1:3100` in development). */
  base: string;
}

export interface ConfigResult {
  status: ConfigStatus;
  policy: ConfigPolicy;
  /** The doc's `issuedAt` and `expiresAt`, `null` without a doc. */
  issuedAt: number | null;
  expiresAt: number | null;
  /** Why the fetch didn't give a new doc (`null` for `fresh` and for `load`). */
  failure: ConfigFailure | null;
  /** The doc is in IndexedDB (`false` without a doc, or when a fresh one couldn't be written). */
  stored: boolean;
}

export interface ConfigServiceOptions {
  openDb: () => Promise<IDBDatabase>;
  transport: ByteTransport;
  /** The Ed25519 public keys this build trusts. */
  keys: readonly Uint8Array[];
  /** The clock for expiry and the time limit (default the real one). */
  clock?: Clock;
}

/** One run of the config worker: the request, with the keys the app's build embeds. */
export interface ConfigRunRequest extends ConfigRequest {
  /** The Ed25519 public keys this build trusts, base64url (32 bytes each; at least one). */
  keys: string[];
}

/** Events the config worker pushes. */
export interface ConfigEvents extends Record<string, unknown> {
  /** The cached copy's policy (or the defaults), before the fetch: the app applies it at once. */
  cached: ConfigResult;
}

type Answer = { failure: null; text: string } | { failure: ConfigFailure };

function result(status: ConfigStatus, config: VerifiedConfig | null, target: ConfigTarget, failure: ConfigFailure | null, stored: boolean): ConfigResult {
  if (config === null) return { status, policy: noPolicy(), issuedAt: null, expiresAt: null, failure, stored: false };
  return {
    status,
    policy: configPolicy(config.doc, { platform: target.platform, version: target.version, country: config.cached.country }),
    issuedAt: config.doc.issuedAt,
    expiresAt: config.doc.expiresAt,
    failure,
    stored,
  };
}

export class ConfigService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly clock: Clock;

  constructor(private readonly options: ConfigServiceOptions) {
    this.clock = options.clock ?? REAL_CLOCK;
  }

  /** The cached copy's policy (no network). */
  async load(target: ConfigTarget): Promise<ConfigResult> {
    const cached = await this.readCache();
    return result(cached === null ? 'none' : 'cached', cached, target, null, true);
  }

  /**
   * Fetches, checks and keeps a new copy; on any failure, the cached copy's policy and why.
   * `onCached` gets the cached copy's policy (`load`'s answer) before the fetch starts.
   */
  async refresh(request: ConfigRequest, onCached?: (result: ConfigResult) => void): Promise<ConfigResult> {
    const cached = await this.readCache();
    if (onCached) onCached(result(cached === null ? 'none' : 'cached', cached, request, null, true));
    const answer = await this.download(request.base + '/v1/config');
    let failure: ConfigFailure;
    if (answer.failure === null) {
      const check = checkConfigResponse(answer.text, this.options.keys, cached === null ? null : cached.doc.issuedAt, this.clock.now());
      if (check.ok) return result('fresh', check.config, request, null, await this.write(check.config.cached));
      failure = check.refusal;
    } else {
      failure = answer.failure;
    }
    return result(cached === null ? 'none' : 'cached', cached, request, failure, true);
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.options.openDb();
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  /**
   * The cached copy if it still checks out; `null` when there is none or IndexedDB fails. A copy
   * this build doesn't trust (a key rotated out, a dev-signed copy once a build trusts only
   * production keys, a broken record) is deleted: the query worker reads the blocklist from the
   * same record without checking it again (step 30b2).
   */
  private async readCache(): Promise<VerifiedConfig | null> {
    let record: unknown;
    try {
      record = await getValue<unknown>(await this.db(), STORE.kv, CONFIG_KEY);
    } catch {
      return null;
    }
    if (record === undefined) return null;
    const verified = readCachedConfig(record, this.options.keys);
    if (verified === null) await this.remove();
    return verified;
  }

  private async remove(): Promise<void> {
    try {
      await transact(await this.db(), STORE.kv, 'readwrite', (tx) => {
        tx.objectStore(STORE.kv).delete(CONFIG_KEY);
      });
    } catch {
      // Tried again at the next run; the copy is ignored meanwhile.
    }
  }

  private async write(cached: CachedConfig): Promise<boolean> {
    try {
      const db = await this.db();
      await transact(db, STORE.kv, 'readwrite', (tx) => {
        tx.objectStore(STORE.kv).put(cached, CONFIG_KEY);
      });
      return true;
    } catch {
      return false;
    }
  }

  /** The answer's text within `CONFIG_TIMEOUT_MS` (Chromium 53 can't abort a fetch: a late answer is cancelled when it comes). */
  private download(url: string): Promise<Answer> {
    return new Promise<Answer>((resolve) => {
      let settled = false;
      let response: ByteResponse | null = null;
      void this.clock.sleep(CONFIG_TIMEOUT_MS).then(() => {
        if (settled) return;
        settled = true;
        if (response !== null) response.cancel();
        resolve({ failure: 'timeout' });
      });
      void this.read(url, (r) => {
        response = r;
        if (settled) r.cancel();
      }).then((answer) => {
        // After the time limit this changes nothing: the promise has settled.
        settled = true;
        resolve(answer);
      });
    });
  }

  private async read(url: string, opened: (response: ByteResponse) => void): Promise<Answer> {
    let response: ByteResponse;
    try {
      response = await this.options.transport.get(url);
    } catch {
      return { failure: 'network' };
    }
    opened(response);
    if (response.status !== 200) {
      response.cancel();
      return { failure: 'status' };
    }
    let bytes = 0;
    let tooLarge = false;
    const text = decodeUtf8(
      tapBytes(response, (chunk) => {
        bytes += chunk.length;
        if (bytes > CONFIG_MAX_BYTES) {
          tooLarge = true;
          throw new Error('The config answer is too large');
        }
      }),
    );
    let out = '';
    try {
      for (;;) {
        const piece = await text.read();
        if (piece === null) return { failure: null, text: out };
        out += piece;
      }
    } catch {
      text.cancel();
      return { failure: tooLarge ? 'too-large' : 'network' };
    }
  }
}

/** The keys of a run request, or an error (a build that embeds no key, or a broken one). */
function decodeKeys(keys: readonly string[]): Uint8Array[] {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('The config run has no public key');
  const out: Uint8Array[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = fromBase64Url(keys[i]!);
    if (key === null || key.length !== 32) throw new Error(`Config public key ${i} is not 32 bytes of base64url`);
    out.push(key);
  }
  return out;
}

/**
 * The config worker's RPC methods (config.worker.ts): `run` reads the cached copy, pushes its
 * policy (`cached`), then refreshes and answers the result. The worker is started for one run and
 * terminated after it, so each run builds its service with the keys the request carries.
 */
export function configHandlers(options: { openDb: () => Promise<IDBDatabase>; transport: ByteTransport; clock?: Clock }) {
  return {
    run: (req: ConfigRunRequest, ctx: RpcContext): Promise<ConfigResult> => {
      const service = new ConfigService({ openDb: options.openDb, transport: options.transport, clock: options.clock, keys: decodeKeys(req.keys) });
      return service.refresh({ base: req.base, platform: req.platform, version: req.version }, (cached) => ctx.emit('cached', cached));
    },
  };
}
