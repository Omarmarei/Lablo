import { assertAppVersion, checkAppinfo, checkConfigXml, fillTemplate } from './platform-files';

/**
 * The release checklist's checks (RELAY step 45), pure so they are tested without a repo:
 * `tools/build/release-check.ts` (`pnpm release:check`) reads the files and calls these, then
 * runs `build:tv --release` (legal gate, ES2016/CSS gates, budgets, packages). Each function
 * returns the problems it found, [] when clean. This tool imports no workspace package.
 */

/** One version source: apps/tv/package.json feeds both manifests (`{{version}}`) and About (`__APP_VERSION__`). */
export function versionProblems(version: string, tizenTemplate: string, webosTemplate: string): string[] {
  const problems: string[] = [];
  try {
    assertAppVersion(version);
  } catch (error) {
    return [(error as Error).message];
  }
  if (version === '0.0.0') problems.push('apps/tv version is 0.0.0');
  // A manifest template with a hard-coded version would drift from the one source.
  for (const [name, template] of [['platforms/tizen/config.xml', tizenTemplate], ['platforms/webos/appinfo.json', webosTemplate]] as const) {
    if (template.indexOf('{{version}}') === -1) problems.push(`${name} has no {{version}} placeholder`);
  }
  try {
    checkConfigXml(fillTemplate(tizenTemplate, version), version);
  } catch (error) {
    problems.push((error as Error).message);
  }
  try {
    checkAppinfo(fillTemplate(webosTemplate, version), version);
  } catch (error) {
    problems.push((error as Error).message);
  }
  return problems;
}

/**
 * Placeholders in the store documents that must be filled before a submission (they name things
 * only Omar has: the domain, the test server and its tester account).
 */
export const STORE_PLACEHOLDERS: readonly string[] = ['<official domain>', '<test server address>', '<tester username>', '<tester password>'];

export function storePlaceholderProblems(files: ReadonlyArray<{ readonly name: string; readonly text: string }>): string[] {
  const problems: string[] = [];
  for (const file of files) {
    for (const placeholder of STORE_PLACEHOLDERS) {
      if (file.text.indexOf(placeholder) !== -1) problems.push(`${file.name} still has ${placeholder}`);
    }
  }
  return problems;
}

/** Files that never belong in the public repo, by extension. */
const FORBIDDEN_FILE = /\.(p12|pfx|pem|key|jks|keystore|ipk|wgt|tpk|apk|exe|dll|zip|sdk|crt|cer)$/i;
/** Allowed despite the extension (public test material); none yet. */
const FILE_ALLOWED: readonly string[] = [];
/** `.env` files except the example. */
const ENV_FILE = /(^|\/)\.env(\.|$)(?!example$)/;
/** Biggest file that may be tracked, bytes (a screenshot or a font is well below it). */
export const MAX_TRACKED_BYTES = 5 * 1024 * 1024;

const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['a private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['an API secret key', /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a filled LABLO_RATE_SECRET', /LABLO_RATE_SECRET\s*=\s*[A-Za-z0-9+/_-]{12,}/],
  ['the hotspot address of the Samsung test TV', /\b10\.50\.231\.\d{1,3}\b/],
];

/** File names (from `git ls-files`) that must not be tracked. */
export function trackedFileProblems(files: readonly string[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (FILE_ALLOWED.indexOf(file) !== -1) continue;
    if (FORBIDDEN_FILE.test(file)) problems.push(`${file} is a binary, package or key file: it must not be tracked`);
    else if (ENV_FILE.test(file)) problems.push(`${file} is an env file: it must not be tracked`);
  }
  return problems;
}

/** A text file's content: secrets and personal addresses. */
export function contentProblems(name: string, text: string): string[] {
  const problems: string[] = [];
  for (const [what, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) problems.push(`${name} contains ${what}`);
  }
  return problems;
}

/** Version of a built package's file name: `<id>_<version>_all.ipk` (webOS). */
export function packageNameProblems(files: readonly string[], id: string, version: string): string[] {
  return files.indexOf(`${id}_${version}_all.ipk`) === -1 ? [`dist/tv has no ${id}_${version}_all.ipk (the webOS package of this version)`] : [];
}
