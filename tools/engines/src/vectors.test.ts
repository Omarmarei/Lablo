import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VectorCheck, VectorsRun, VectorsRunState } from './vectors';
import { BACKUP_CHECKS, VECTORS_DIR, VECTORS_SEED, VECTORS_STATE_EXPRESSION, evaluateVectors, stageVectors, stageVectorsSeed, vectorsSummary, vectorsUrl } from './vectors';

const NAMES = ['sha256[0]', 'sha256[1]', 'backup[0].master', 'random'];
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';

const checks = (failing: string | null = null): VectorCheck[] =>
  NAMES.map((name) => ({ name, ok: name !== failing, detail: name === failing ? 'digest: got a, expected b' : '', ms: name === 'backup[0].master' ? 1500 : 3 }));
const runState = (results: VectorCheck[] | null, ms = 2000, error: string | null = null, where = 'page'): VectorsRunState => ({ results, ms, error, where });
const workerState = (results: VectorCheck[] | null, ms = 2000, error: string | null = null): VectorsRunState => runState(results, ms, error, 'worker');
/** The backup worker's run (step 32b): every check passing, `failing` failing, scrypt 1.2 s. */
const backupState = (failing: string | null = null, names: readonly string[] = BACKUP_CHECKS, where = 'worker'): VectorsRunState =>
  runState(
    names.map((name) => ({ name, ok: name !== failing, detail: name === failing ? 'master: got a, expected b; ' : '', ms: name === 'backup.device' ? 1200 : 4 })),
    1400,
    null,
    where,
  );

function run(page: VectorsRunState, worker: VectorsRunState, extra: Partial<VectorsRun> = {}, userAgent = UA, backup: VectorsRunState | null = backupState()): VectorsRun {
  return {
    url: vectorsUrl(VECTORS_DIR),
    state: { href: 'file:///app/vectors/index.html', report: backup === null ? { page, worker, userAgent } : { page, worker, backup, userAgent }, userAgent },
    finished: true,
    exceptions: [],
    durationMs: 5000,
    ...extra,
  };
}

describe('evaluateVectors', () => {
  it('passes when the page and the worker answer every check under Node’s names', () => {
    expect(evaluateVectors(run(runState(checks()), workerState(checks())), { major: 53 }, NAMES)).toEqual([]);
  });

  it("names a failing check in the page or in the worker, with what differed", () => {
    expect(evaluateVectors(run(runState(checks('sha256[1]')), workerState(checks())), { major: 53 }, NAMES)).toEqual(['page: sha256[1]: digest: got a, expected b']);
    expect(evaluateVectors(run(runState(checks()), workerState(checks('random'))), { major: 53 }, NAMES)).toEqual(['worker: random: digest: got a, expected b']);
  });

  it('fails a run with other checks than Node’s, or none', () => {
    const fewer = checks().slice(0, 3);
    expect(evaluateVectors(run(runState(fewer), workerState(checks())), { major: 53 }, NAMES)).toEqual([
      "page: 3 checks, expected Node's 4 under the same names (a stale dist/tv-vectors? run pnpm build:tv)",
    ]);
    const renamed = checks().map((c, i) => (i === 0 ? { ...c, name: 'sha256[9]' } : c));
    expect(evaluateVectors(run(runState(checks()), workerState(renamed)), { major: 53 }, NAMES)).toHaveLength(1);
    expect(evaluateVectors(run(runState(checks()), workerState(null, 90000, 'the worker did not answer')), { major: 53 }, NAMES)).toEqual([
      'worker: no results (the worker did not answer)',
    ]);
  });

  it('fails a run that did not run where it says: the worker run must have had no document', () => {
    expect(evaluateVectors(run(runState(checks()), runState(checks())), { major: 53 }, NAMES)).toEqual(['worker: ran in the page']);
    expect(evaluateVectors(run(workerState(checks()), workerState(checks())), { major: 53 }, NAMES)).toEqual(['page: ran in the worker']);
  });

  it('fails without a report, on an uncaught error, or in another engine', () => {
    const unfinished: VectorsRun = { ...run(runState(checks()), workerState(checks())), finished: false, state: { href: 'x', report: null, userAgent: UA } };
    expect(evaluateVectors(unfinished, { major: 53 }, NAMES)).toEqual(['no report from the vectors page (still running)']);
    expect(evaluateVectors({ ...unfinished, state: null }, { major: 53 }, NAMES)).toEqual(['no report from the vectors page (it never answered the probe)']);
    expect(evaluateVectors(run(runState(checks()), workerState(checks()), { exceptions: ['ReferenceError: BigInt is not defined'] }), { major: 53 }, NAMES)).toEqual([
      'uncaught: ReferenceError: BigInt is not defined',
    ]);
    expect(evaluateVectors(run(runState(checks()), workerState(checks())), { major: 68 }, NAMES)).toEqual([`user agent ${UA}: expected Chrome 68`]);
  });
});

describe('the backup worker run (step 32b)', () => {
  const both = (): [VectorsRunState, VectorsRunState] => [runState(checks()), workerState(checks())];

  it('names the backup worker checks in their order', () => {
    expect(BACKUP_CHECKS).toEqual(['backup.reset', 'backup.device', 'backup.master', 'backup.lookupId', 'backup.cached', 'backup.code', 'backup.codeKept', 'backup.cleanup']);
  });

  it('fails each backup check that fails, a run in the page, other names, and no run', () => {
    expect(evaluateVectors(run(...both(), {}, UA, backupState('backup.master')), { major: 53 }, NAMES)).toEqual(['backup: backup.master: master: got a, expected b; ']);
    expect(evaluateVectors(run(...both(), {}, UA, backupState(null, BACKUP_CHECKS, 'page')), { major: 53 }, NAMES)).toEqual(['backup: ran in the page']);
    expect(evaluateVectors(run(...both(), {}, UA, backupState(null, BACKUP_CHECKS.slice(1))), { major: 53 }, NAMES)).toEqual([
      "backup: 7 checks, expected Node's 8 under the same names (a stale dist/tv-vectors? run pnpm build:tv)",
    ]);
    expect(evaluateVectors(run(...both(), {}, UA, workerState(null, 90000, 'the worker did not answer')), { major: 53 }, NAMES)).toEqual(['backup: no results (the worker did not answer)']);
    expect(evaluateVectors(run(...both(), {}, UA, null), { major: 53 }, NAMES)).toEqual(['backup: no run (a stale dist/tv-vectors? run pnpm build:tv)']);
  });
});

describe('vectorsSummary', () => {
  it('gives each run’s count and time and the backup’s scrypt in each', () => {
    expect(vectorsSummary(run(runState(checks()), workerState(checks('random'), 2500)))).toBe(
      "  page 4/4 in 2.0 s, worker 3/4 in 2.5 s, backup worker 8/8 in 1.4 s; the backup's scrypt 1.5 s / 1.5 s / 1.2 s",
    );
    expect(vectorsSummary(run(runState(checks()), workerState(checks()), {}, UA, null))).toBe("  page 4/4 in 2.0 s, worker 4/4 in 2.0 s, no backup worker run; the backup's scrypt 1.5 s / 1.5 s");
    expect(vectorsSummary({ ...run(runState(null), workerState(null)), state: null })).toBe('');
  });
});

describe('staging', () => {
  function dist(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-vectors-'));
    mkdirSync(path.join(dir, 'dist'));
    writeFileSync(path.join(dir, 'dist', 'index.html'), '<body>\n<script src="vectors.js"></script>\n<script src="main.js"></script>\n</body>\n');
    writeFileSync(path.join(dir, 'dist', 'main.js'), '');
    writeFileSync(path.join(dir, 'dist', 'vectors.js'), 'window.LABLO_CRYPTO_VECTORS = {};\n');
    return dir;
  }

  it('copies the built page, and answers null when it was not built', () => {
    const dir = dist();
    const staged = stageVectors(path.join(dir, 'dist'), path.join(dir, 'app'));
    expect(staged).toBe(path.join(dir, 'app', VECTORS_DIR));
    expect(readFileSync(path.join(staged!, 'vectors.js'), 'utf8')).toContain('LABLO_CRYPTO_VECTORS');
    expect(stageVectors(path.join(dir, 'missing'), path.join(dir, 'app2'))).toBeNull();
  });

  it('seeds a changed vector before the page runs', () => {
    const dir = dist();
    const staged = stageVectors(path.join(dir, 'dist'), path.join(dir, 'app'))!;
    const seed = stageVectorsSeed(staged, path.join(dir, 'app'));
    const html = readFileSync(path.join(seed, 'index.html'), 'utf8');
    expect(html.indexOf(VECTORS_SEED.script)).toBeGreaterThan(html.indexOf('vectors.js'));
    expect(html.indexOf(VECTORS_SEED.script)).toBeLessThan(html.indexOf('main.js'));
    expect(VECTORS_SEED.script).toContain(VECTORS_SEED.failing.replace('[1]', ''));
    expect(vectorsUrl(VECTORS_SEED.id)).toBe('file:///app/vectors-seed-changed/index.html');
  });

  it('probes with ES5 only', async () => {
    const { checkSyntax } = await import('../../build/src/syntax-gate');
    expect(checkSyntax(VECTORS_STATE_EXPRESSION, 'probe')).toBeNull();
    expect(VECTORS_STATE_EXPRESSION).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });
});
