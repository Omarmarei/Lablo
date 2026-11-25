/**
 * The release checklist (RELAY step 45): `pnpm release:check [--no-build]`.
 *
 *   1. legal text is final (legal-gate.ts, the same check as `build:tv --release`)
 *   2. one version: apps/tv/package.json feeds both manifests and About
 *   3. the store documents have no placeholders left (domain, test server, tester account)
 *   4. no keys, packages, env files, big files, secrets or LAN addresses are tracked in git
 *   5. unless --no-build: `build:tv --release` (ES2016/CSS gates, bundle budgets, packages),
 *      then the webOS .ipk of this version exists; the Tizen .wgt is reported (it needs the
 *      Tizen CLI and TIZEN_SIGNING_PROFILE, which are Omar's)
 *
 * It lists every problem, then exits 1 if any. Nothing is deployed or submitted.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkLegalRelease } from './src/legal-gate';
import { checkAppinfo, fillTemplate } from './src/platform-files';
import {
  MAX_TRACKED_BYTES,
  contentProblems,
  packageNameProblems,
  storePlaceholderProblems,
  trackedFileProblems,
  versionProblems,
} from './src/release-check';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|xml|css|html|yml|yaml|txt|sql|prisma|env|example)$/i;
/** Lock files and the archive carry long hashes, not secrets. */
const SKIP_CONTENT = /(^|\/)(pnpm-lock\.yaml|docs\/relay-archive\.md)$/;

function git(args: string[]): string {
  const run = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout;
}

function main(): void {
  const { values } = parseArgs({ options: { 'no-build': { type: 'boolean', default: false } } });
  const problems: string[] = [];
  const notes: string[] = [];
  const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

  problems.push(...checkLegalRelease(ROOT));

  const version = (JSON.parse(read('apps/tv/package.json')) as { version: string }).version;
  const tizen = read('platforms/tizen/config.xml');
  const webos = read('platforms/webos/appinfo.json');
  problems.push(...versionProblems(version, tizen, webos));

  const storeDir = path.join(ROOT, 'docs', 'store');
  const storeFiles = readdirSync(storeDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ name: `docs/store/${name}`, text: readFileSync(path.join(storeDir, name), 'utf8') }));
  problems.push(...storePlaceholderProblems(storeFiles));

  const tracked = git(['ls-files', '-z']).split('\0').filter((f) => f !== '' && existsSync(path.join(ROOT, f)));
  problems.push(...trackedFileProblems(tracked));
  for (const file of tracked) {
    const size = statSync(path.join(ROOT, file)).size;
    if (size > MAX_TRACKED_BYTES && !SKIP_CONTENT.test(file)) problems.push(`${file} is ${(size / 1048576).toFixed(1)} MB (the limit for a tracked file is 5 MB)`);
    else if (TEXT_FILE.test(file) && !SKIP_CONTENT.test(file)) problems.push(...contentProblems(file, read(file)));
  }

  if (!values['no-build']) {
    console.log('build:tv --release ...');
    const build = spawnSync('pnpm', ['build:tv', '--release'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) problems.push('pnpm build:tv --release failed (see its output above)');
    else {
      const { id } = checkAppinfo(fillTemplate(webos, version), version);
      const dist = path.join(ROOT, 'dist', 'tv');
      problems.push(...packageNameProblems(existsSync(dist) ? readdirSync(dist) : [], id, version));
      notes.push(existsSync(path.join(dist, 'Lablo.wgt')) ? 'Tizen Lablo.wgt built' : 'Tizen Lablo.wgt not built here (needs the Tizen CLI and TIZEN_SIGNING_PROFILE: Omar)');
    }
  } else notes.push('build skipped (--no-build): budgets and packages not checked');

  console.log(`\nLablo release check, version ${version}`);
  for (const note of notes) console.log(`  note: ${note}`);
  if (problems.length === 0) {
    console.log('  OK: nothing blocks a release.');
    return;
  }
  console.log(`  ${problems.length} problem(s):`);
  for (const problem of problems) console.log(`   - ${problem}`);
  process.exitCode = 1;
}

main();
