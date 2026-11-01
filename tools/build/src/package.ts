import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export type PackageResult = { readonly ok: true; readonly file: string } | { readonly ok: false; readonly skipped: string };

/**
 * Builds the webOS `.ipk` with `ares-package` from @webos-tools/cli (a devDependency, so
 * no global install is needed). `--no-minify` keeps the bundle byte-identical to the one the
 * syntax gate and budgets checked.
 */
export function packageWebos(stageDir: string, outDir: string, expected: { id: string; version: string }): PackageResult {
  const file = path.join(outDir, `${expected.id}_${expected.version}_all.ipk`);
  mkdirSync(outDir, { recursive: true });
  rmSync(file, { force: true });
  const cli = require.resolve('@webos-tools/cli/bin/ares-package.js');
  const run = spawnSync(process.execPath, [cli, '--no-minify', '--outdir', outDir, stageDir], { encoding: 'utf8' });
  if (run.status !== 0 || !existsSync(file)) {
    throw new Error(`ares-package failed (exit ${run.status ?? 'none'}):\n${run.stdout}\n${run.stderr}`);
  }
  return { ok: true, file };
}

function tizenCliAvailable(): boolean {
  const probe = spawnSync('tizen', ['version'], { encoding: 'utf8', shell: true });
  return probe.status === 0;
}

/**
 * Builds the signed Tizen `.wgt` with the Tizen Studio CLI when it is installed and a signing
 * profile is named in `TIZEN_SIGNING_PROFILE`. Otherwise it reports why it skipped; the
 * manual route is in docs/runbooks/tv-build.md.
 */
export function packageTizen(stageDir: string, outDir: string): PackageResult {
  const profile = process.env.TIZEN_SIGNING_PROFILE;
  if (profile === undefined || profile === '') {
    return { ok: false, skipped: 'TIZEN_SIGNING_PROFILE is not set (see docs/runbooks/tv-build.md)' };
  }
  if (!tizenCliAvailable()) {
    return { ok: false, skipped: 'the Tizen CLI is not installed (see docs/runbooks/tv-build.md)' };
  }
  // `tizen` is a .bat on Windows, so it needs a shell; quote the arguments that may hold spaces.
  const run = spawnSync('tizen', ['package', '-t', 'wgt', '-s', `"${profile}"`, '--', `"${stageDir}"`], {
    encoding: 'utf8',
    shell: true,
  });
  const built = readdirSync(stageDir).find((name) => name.endsWith('.wgt'));
  if (run.status !== 0 || built === undefined) {
    throw new Error(`tizen package failed (exit ${run.status ?? 'none'}):\n${run.stdout}\n${run.stderr}`);
  }
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, built);
  rmSync(file, { force: true });
  renameSync(path.join(stageDir, built), file);
  return { ok: true, file };
}
