/**
 * The TV app's build-time constants (RELAY step 30b2): the one place both the Vite dev loop
 * (apps/tv/vite.config.ts) and the TV build (tools/build/src/bundle.ts) take them from, declared
 * for the app in apps/tv/src/env.d.ts.
 *
 * - `__API_BASE__`: the backend's origin the config client asks (`GET <base>/v1/config`).
 *   `http://127.0.0.1:3100` (the local `pnpm web:dev` / `next start`) until step 34 gives the
 *   production domain. On a TV, 127.0.0.1 is the TV itself: the fetch fails, and the cached copy
 *   or the defaults (nothing killed) stay in force.
 * - `__APP_VERSION__`: `apps/tv/package.json`'s version (the policy's `minVersion`).
 * - `__CONFIG_KEYS__`: the Ed25519 public keys whose signatures the build trusts, from
 *   `config/keys.json`. A TV build (`package`) takes the production keys, or the dev key while
 *   there are none, never both: a build with production keys never trusts the dev key, whose seed
 *   is public. The desktop dev app (`dev`) trusts the production keys and the dev key, so it can
 *   run a config signed by either.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The backend in development (apps/web on port 3100). */
export const DEV_API_BASE = 'http://127.0.0.1:3100';
/** The production API's origin: none until step 34. */
export const PRODUCTION_API_BASE: string | null = null;

/** `package`: a TV build (tools/build); `dev`: the desktop dev app (`pnpm dev`, the e2e tests). */
export type TvBuildKind = 'package' | 'dev';

export interface TvDefines {
  readonly apiBase: string;
  readonly version: string;
  readonly configKeys: readonly string[];
}

/** A 32-byte Ed25519 public key in unpadded base64url (its last character holds 2 unused bits). */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** `config/keys.json`'s keys, checked (tools/sign-config checks the file in full). */
export function readConfigKeys(text: string): { production: string[]; dev: string } {
  const raw = JSON.parse(text) as { production?: unknown; dev?: unknown };
  const { production, dev } = raw;
  if (!Array.isArray(production) || !production.every((key) => typeof key === 'string' && PUBLIC_KEY.test(key))) {
    throw new Error('config/keys.json: production must be a list of 32-byte base64url keys');
  }
  if (typeof dev !== 'string' || !PUBLIC_KEY.test(dev)) throw new Error('config/keys.json: dev must be a 32-byte base64url key');
  if (production.includes(dev)) throw new Error('config/keys.json: the dev key is listed as a production key');
  return { production: production as string[], dev };
}

/** The keys a build of `kind` trusts. */
export function trustedConfigKeys(kind: TvBuildKind, keys: { production: readonly string[]; dev: string }): string[] {
  if (kind === 'dev') return [...keys.production, keys.dev];
  return keys.production.length > 0 ? [...keys.production] : [keys.dev];
}

/** The constants of a build of `kind`, read from the repo at `root`. */
export function tvDefines(kind: TvBuildKind, root: string = import.meta.dirname): TvDefines {
  const keys = readConfigKeys(readFileSync(join(root, 'config/keys.json'), 'utf8'));
  const { version } = JSON.parse(readFileSync(join(root, 'apps/tv/package.json'), 'utf8')) as { version: string };
  return {
    apiBase: kind === 'package' && PRODUCTION_API_BASE !== null ? PRODUCTION_API_BASE : DEV_API_BASE,
    version,
    configKeys: trustedConfigKeys(kind, keys),
  };
}

/** The constants as `define` / replace values (JSON literals). */
export function defineValues(defines: TvDefines): Record<string, string> {
  return {
    __API_BASE__: JSON.stringify(defines.apiBase),
    __APP_VERSION__: JSON.stringify(defines.version),
    __CONFIG_KEYS__: JSON.stringify(defines.configKeys),
  };
}
