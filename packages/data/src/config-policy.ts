/**
 * The signed config's policy for this TV (architecture.md §3.3 C, RELAY step 30b1): the kill rule
 * that applies, the notices to show, and whether this build is below its platform's
 * `minVersion`. Pure: the config worker works it out from the verified doc and posts it to the
 * main thread (step 30b2), which enforces it (step 30c).
 *
 * The kill modes form a ladder, each including the ones below it: `notice` (tell the user once)
 * < `block-new-sources` < `disable-playback` < `disable-app`. A notice never stops anything, so
 * notices are listed apart from the strongest rule.
 *
 * TV code (a worker bundle): no `split`, array destructuring or object spread (Babel's helpers and
 * by-name polyfills), version numbers read with `charCodeAt`.
 */
import type { ConfigDoc, KillMode } from '@lablo/protocol';

/** The platforms a build reports; `browser` is the desktop dev app. */
export type ConfigPlatform = 'tizen' | 'webos' | 'browser';

/** What the policy depends on besides the doc. */
export interface PolicyInput {
  platform: ConfigPlatform;
  /** This build's version, major.minor.patch. */
  version: string;
  /** The country `GET /v1/config` saw (ISO 3166-1 alpha-2), `null` when it didn't know. */
  country: string | null;
}

/** A matching kill rule, as the app shows it. */
export interface PolicyRule {
  /** The rule's stable name (a notice is shown once per id). */
  id: string;
  mode: KillMode;
  /** The doc's own text in both languages, `null` when the rule has none (the app's own text then). */
  message: { en: string; ar: string } | null;
}

export interface ConfigPolicy {
  /** The strongest matching rule other than a notice (the doc's first among equals), or `null`. */
  kill: PolicyRule | null;
  /** The matching notices, in the doc's order. */
  notices: PolicyRule[];
  /** This build is below its platform's `minVersion`: the app asks for an update. */
  updateRequired: boolean;
  /** The platform's `minVersion`, `null` when the doc sets none. */
  minVersion: string | null;
  /** Feature flags (what is missing is the app's default). */
  flags: ConfigDoc['flags'];
  /** Tuning (what is missing is the app's default). */
  tunables: ConfigDoc['tunables'];
}

type KillRule = ConfigDoc['kill'][number];

/** Each mode's place on the ladder. */
export const KILL_STRENGTH: Readonly<Record<KillMode, number>> = {
  notice: 0,
  'block-new-sources': 1,
  'disable-playback': 2,
  'disable-app': 3,
};

/** No config yet (or none that verifies): nothing killed, nothing blocked, no update asked for. */
export function noPolicy(): ConfigPolicy {
  return { kill: null, notices: [], updateRequired: false, minVersion: null, flags: {}, tunables: {} };
}

/** True when the policy's kill rule is `mode` or stronger (`policyStops(p, 'disable-playback')`). */
export function policyStops(policy: ConfigPolicy, mode: Exclude<KillMode, 'notice'>): boolean {
  return policy.kill !== null && KILL_STRENGTH[policy.kill.mode] >= KILL_STRENGTH[mode];
}

/**
 * major.minor.patch as three numbers, or `null` for anything else (a sign, a fourth part, a
 * missing part, more than 5 digits in a part).
 */
export function versionParts(version: string): number[] | null {
  const parts = [0, 0, 0];
  let part = 0;
  let digits = 0;
  for (let i = 0; i < version.length; i++) {
    const c = version.charCodeAt(i);
    if (c === 46 /* . */) {
      if (digits === 0 || part === 2) return null;
      part++;
      digits = 0;
    } else if (c >= 48 && c <= 57 && digits < 5) {
      parts[part] = parts[part]! * 10 + (c - 48);
      digits++;
    } else {
      return null;
    }
  }
  return digits === 0 || part !== 2 ? null : parts;
}

/**
 * Below zero when `a` is older than `b`, zero when equal, above zero when newer; `NaN` when either
 * isn't major.minor.patch (so no comparison holds: a rule naming versions doesn't match, and no
 * update is asked for).
 */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  if (x === null || y === null) return NaN;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return 0;
}

/**
 * True when every condition the rule has holds for this TV. A rule naming countries needs a known
 * country; the desktop `browser` platform matches only rules without a platform.
 */
export function ruleMatches(rule: KillRule, input: PolicyInput): boolean {
  const match = rule.match;
  if (match.platform !== undefined && match.platform !== input.platform) return false;
  const versions = match.versions;
  if (versions !== undefined) {
    if (versions.min !== undefined && !(compareVersions(input.version, versions.min) >= 0)) return false;
    if (versions.max !== undefined && !(compareVersions(input.version, versions.max) <= 0)) return false;
  }
  const countries = match.countries;
  if (countries !== undefined && (input.country === null || countries.indexOf(input.country) === -1)) return false;
  return true;
}

function policyRule(rule: KillRule): PolicyRule {
  return { id: rule.id, mode: rule.mode, message: rule.message === undefined ? null : { en: rule.message.en, ar: rule.message.ar } };
}

/** The doc's policy for this TV (`doc` is verified and parsed by `configDocSchema`). */
export function configPolicy(doc: ConfigDoc, input: PolicyInput): ConfigPolicy {
  let kill: KillRule | null = null;
  const notices: PolicyRule[] = [];
  for (let i = 0; i < doc.kill.length; i++) {
    const rule = doc.kill[i]!;
    if (!ruleMatches(rule, input)) continue;
    if (rule.mode === 'notice') notices.push(policyRule(rule));
    else if (kill === null || KILL_STRENGTH[rule.mode] > KILL_STRENGTH[kill.mode]) kill = rule;
  }
  const minVersion = input.platform === 'browser' ? null : (doc.minVersion[input.platform] ?? null);
  return {
    kill: kill === null ? null : policyRule(kill),
    notices,
    updateRequired: minVersion !== null && compareVersions(input.version, minVersion) < 0,
    minVersion,
    flags: doc.flags,
    tunables: doc.tunables,
  };
}
