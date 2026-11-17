/**
 * The TV's signed-config client (architecture.md §3.3 C, RELAY step 30b1): fetch
 * `GET <api>/v1/config`, check it (config-check.ts), keep the verified copy in IndexedDB, and give
 * this TV's policy (config-policy.ts). The config worker serves it (step 30b2): the app starts
 * one after the first paint and every `CONFIG_REFRESH_MS`, without waiting for it.
 *
 * - `load` gives the cached copy's policy (or `noPolicy()`), without the network.
 * - `refresh` fetches with `CONFIG_TIMEOUT_MS` for the whole answer and a `CONFIG_MAX_BYTES` cap.
 *   A good answer replaces the cached copy (with the country it carried); on any failure the
 *   cached copy stays in force and the result says why. If IndexedDB can't keep a good answer,
 *   its policy still holds for this run (`stored: false`): a kill must not wait on storage.
 */
import type { ByteResponse, ByteTransport } from './bytes';
import { decodeUtf8, tapBytes } from './bytes';
import type { CachedConfig, ConfigRefusal, VerifiedConfig } from './config-check';
import { checkConfigResponse, readCachedConfig } from './config-check';
import type { ConfigPlatform, ConfigPolicy } from './config-policy';
import { configPolicy, noPolicy } from './config-policy';
import { getValue, transact } from './idb';
import { STORE } from './schema';
import type { Clock } from './throttle';
import { REAL_CLOCK } from './throttle';

/** The cached copy's key in the `kv` store. */
export const CONFIG_KEY = 'config';
/** The whole answer must arrive within this (§3.3 C: "3 s timeout"). */
export const CONFIG_TIMEOUT_MS = 3000;
/** How often the app refreshes the config while it runs (§3.3 C: "every 6 h"). */
export const CONFIG_REFRESH_MS = 6 * 60 * 60 * 1000;
/** A larger answer is refused unread (a doc is at most 1 MiB of text; JSON escaping adds a little). */
export const CONFIG_MAX_BYTES = 4 * 1024 * 1024;

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

  /** Fetches, checks and keeps a new copy; on any failure, the cached copy's policy and why. */
  async refresh(request: ConfigRequest): Promise<ConfigResult> {
    const cached = await this.readCache();
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

  /** The cached copy if it still checks out; `null` when there is none or IndexedDB fails. */
  private async readCache(): Promise<VerifiedConfig | null> {
    try {
      return readCachedConfig(await getValue<unknown>(await this.db(), STORE.kv, CONFIG_KEY), this.options.keys);
    } catch {
      return null;
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
