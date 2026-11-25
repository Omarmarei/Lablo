import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The release check of the legal text (RELAY step 40d): `pnpm build:tv --release` (and step 45's
 * release checklist, which calls `legalReleaseProblems`) refuses to build while
 * `packages/protocol/src/legal.ts` is still the draft for counsel.
 *
 * It reads the file as text (this tool imports no workspace package): `LEGAL_DRAFT` must be
 * `false`, and no text may still carry a placeholder sentence that waits for counsel. Counsel's
 * final text removes both; the draft's own mark stays defined in the file but is shown only while
 * `LEGAL_DRAFT` is true.
 */

/** The file, from the repo's root. */
export const LEGAL_FILE = 'packages/protocol/src/legal.ts';

/** Phrases only the draft carries: a final text has none of them. */
export const DRAFT_PHRASES: readonly string[] = ['before launch', 'will be named', 'Draft for counsel'];

/** What stops a release in `source` (the legal file's text); [] when nothing does. */
export function legalReleaseProblems(source: string): string[] {
  const problems: string[] = [];
  const flag = /export const LEGAL_DRAFT\s*=\s*(true|false)\s*;/.exec(source);
  if (flag === null) problems.push(`${LEGAL_FILE} has no \`export const LEGAL_DRAFT = true|false;\``);
  else if (flag[1] === 'true') problems.push(`${LEGAL_FILE} is still the draft for counsel (LEGAL_DRAFT is true): counsel's text replaces it and sets it to false`);
  // The draft's mark is defined in the file: look for the phrases outside its own line and comments.
  const lines = source.split('\n').filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line) && line.indexOf('LEGAL_DRAFT_MARK') === -1);
  const text = lines.join('\n');
  for (const phrase of DRAFT_PHRASES) {
    if (text.indexOf(phrase) !== -1) problems.push(`${LEGAL_FILE} still says "${phrase}": a placeholder that waits for counsel`);
  }
  return problems;
}

/** The check on the repo at `root`. */
export function checkLegalRelease(root: string): string[] {
  return legalReleaseProblems(readFileSync(path.join(root, LEGAL_FILE), 'utf8'));
}
