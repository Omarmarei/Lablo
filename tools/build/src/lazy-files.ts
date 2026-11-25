import path from 'node:path';
import type { BundleResult } from './bundle';

/**
 * What a split app build must load later (RELAY step 35e): its lazy files, by name, and the
 * folders whose modules must all be in them. A module of such a folder in main.js means that
 * something main.js holds imports it statically (not through the `import()` that loads the
 * settings), so it costs main.js again without a word: the build fails instead, naming it.
 */
/** The terms and the privacy policy (step 40d): shared with the web app, read only by the settings, so only settings.js may hold it. */
export const LEGAL_MODULE = 'packages/protocol/src/legal.ts';

export interface LazyRule {
  /** The lazy files the build writes, in order (`settings.js`). */
  readonly files: readonly string[];
  /** Folders (relative to the repo's root, ending in `/`) none of whose modules may be in main.js. */
  readonly only: readonly string[];
}

/**
 * The app's (its test copy's too): settings.js holds everything under apps/tv/src/settings/ and the legal text. What
 * main.js keeps to open it is elsewhere (apps/tv/src/lazy/, the guide's MappingReading, the backup
 * code's codeGroups).
 */
export const APP_LAZY: LazyRule = { files: ['settings.js'], only: ['apps/tv/src/settings/', LEGAL_MODULE] };

/** What breaks `rule` in a split build of the app; [] when nothing does. */
export function lazyProblems(bundle: Pick<BundleResult, 'modules' | 'lazy'>, rule: LazyRule, root: string): string[] {
  const problems: string[] = [];
  const files = bundle.lazy.map((file) => file.fileName);
  if (files.join(',') !== rule.files.join(',')) {
    problems.push(`the lazy files are ${files.length === 0 ? 'none' : files.join(', ')}, not ${rule.files.join(', ')}`);
  }
  for (const id of bundle.modules) {
    // (Rollup's own modules: the worker strings, CommonJS helpers.)
    if (id.startsWith('\0')) continue;
    const file = path.relative(root, id).split(path.sep).join('/');
    if (rule.only.some((folder) => file.startsWith(folder))) {
      problems.push(`${file} is in main.js: something main.js holds imports it statically (only the import() that loads ${rule.files.join(', ')} may)`);
    }
  }
  return problems;
}
