import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_PHRASES, LEGAL_FILE, checkLegalRelease, legalReleaseProblems } from './legal-gate';

/**
 * The release check of the legal text (RELAY step 40d): a build with `--release` (and step 45's
 * checklist) refuses while the text is still the draft for counsel.
 */

const FINAL = [
  '/** A header comment that says Draft for counsel and before launch. */',
  "export const LEGAL_DRAFT = false;",
  "export const LEGAL_DRAFT_MARK = { en: 'Draft for counsel', ar: 'x' };",
  "const TEXT = 'Counsel wrote this.';",
  '',
].join('\n');

describe('the legal release check', () => {
  it('passes counsel\'s final text: the flag false, no placeholder, the draft mark only defined', () => {
    expect(legalReleaseProblems(FINAL)).toEqual([]);
  });

  it('refuses a draft: the flag still true', () => {
    const problems = legalReleaseProblems(FINAL.replace('= false', '= true'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('still the draft for counsel');
    expect(problems[0]).toContain(LEGAL_FILE);
  });

  it('refuses a file with no flag, and a flag written another way', () => {
    expect(legalReleaseProblems('const x = 1;')[0]).toContain('has no `export const LEGAL_DRAFT = true|false;`');
    expect(legalReleaseProblems(FINAL.replace('LEGAL_DRAFT = false', 'LEGAL_DRAFT: boolean = false'))[0]).toContain('has no');
  });

  it('takes the flag with other spacing', () => {
    expect(legalReleaseProblems(FINAL.replace('LEGAL_DRAFT = false', 'LEGAL_DRAFT=false'))).toEqual([]);
    expect(legalReleaseProblems(FINAL.replace('LEGAL_DRAFT = false', 'LEGAL_DRAFT  =  true'))).toHaveLength(1);
  });

  it('refuses each placeholder sentence that waits for counsel, even with the flag false', () => {
    for (const phrase of DRAFT_PHRASES) {
      const problems = legalReleaseProblems(`${FINAL}const P = 'It ${phrase} here.';\n`);
      expect(problems, phrase).toHaveLength(1);
      expect(problems[0], phrase).toContain(`"${phrase}"`);
    }
    expect(DRAFT_PHRASES).toEqual(['before launch', 'will be named', 'Draft for counsel']);
  });

  it('names the flag and every phrase at once', () => {
    const problems = legalReleaseProblems(`${FINAL.replace('= false', '= true')}const P = 'before launch, will be named, Draft for counsel';\n`);
    expect(problems).toHaveLength(4);
  });

  it('judges the real file as it is: refused exactly while LEGAL_DRAFT is true', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const source = readFileSync(path.join(root, LEGAL_FILE), 'utf8');
    const draft = /export const LEGAL_DRAFT = true;/.test(source);
    const problems = checkLegalRelease(root);
    expect(problems.length > 0).toBe(draft);
    if (draft) expect(problems[0]).toContain('still the draft for counsel');
    // The draft text carries its placeholders, so a flag flipped alone still fails.
    const flipped = legalReleaseProblems(source.replace('LEGAL_DRAFT = true', 'LEGAL_DRAFT = false'));
    expect(flipped.some((p) => p.includes('before launch'))).toBe(true);
    expect(flipped.some((p) => p.includes('will be named'))).toBe(true);
  });

  it('stops `build:tv --release` before it builds anything while the text is a draft', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const draft = /export const LEGAL_DRAFT = true;/.test(readFileSync(path.join(root, LEGAL_FILE), 'utf8'));
    // A release of final text builds for real (minutes): only the refusal is run here.
    if (!draft) return;
    const run = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'tools/build/build-tv.ts'), '--release', '--target', 'vectors', '--skip-package'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('--release refused');
    expect(run.stderr).toContain('still the draft for counsel');
    // It stopped first: nothing of the vectors page was built by this run.
    expect(run.stdout).not.toContain('crypto vectors] built');
  }, 150_000);
});
