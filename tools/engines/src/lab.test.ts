import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'acorn';
import { afterEach, describe, expect, it } from 'vitest';
import type { LabRecord, LabRun, LabState } from './lab';
import {
  EXPECTED_STATUSES,
  LAB_SEED,
  LAB_STATE_EXPRESSION,
  NATIVE_SINCE,
  evaluateLab,
  expectedStatuses,
  isExpectedRefusal,
  labErrorGate,
  labSummary,
  labUrl,
  readCollected,
  stageLab,
  stageLabSeed,
} from './lab';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zoma-engines-lab-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The built-ins a given Chromium lacks, as the native probe would report them. */
const lacking = (major: number): string[] => Object.keys(NATIVE_SINCE).filter((name) => (NATIVE_SINCE[name] ?? 0) > major);

/** A finished lab run as a correct bundle gives it on an engine of `major`. */
function goodRun(major: number, edit: (records: LabRecord[]) => LabRecord[] = (r) => r, platform: 'tizen' | 'webos' = 'webos'): LabRun {
  const session = `${platform}-unknown-20261104-030000-abcd`;
  const checks: LabRecord[] = expectedStatuses(platform).map(([key, status], i) => {
    const [spike, check] = key.split('/');
    return {
      type: 'check',
      session,
      seq: i + 2,
      spike,
      check,
      status,
      value: key === 'S1/polyfills' ? { working: [], broken: [], polyfilled: lacking(major) } : key === 'S1/idb-bulk-worker' ? { writeMs: 202 } : undefined,
    };
  });
  const records = edit([{ type: 'start', session, seq: 1 }, ...checks, { type: 'end', session, seq: checks.length + 2 }]);
  const state: LabState = {
    href: 'file:///app/lab/webos/index.html',
    bootError: '',
    ready: 'true',
    error: null,
    session,
    runs: 1,
    phase: 'done',
    sent: { sent: records.length, pending: 0, failures: 0, lastError: null },
    records,
    userAgent: 'Chrome/53',
  };
  return { platform, url: state.href, state, finished: true, collected: records, exceptions: [], durationMs: 900, reset: 'ok' };
}

describe('evaluateLab (RELAY step 15a)', () => {
  it('passes a run with every expected answer, on each engine', () => {
    for (const major of [53, 56, 68]) expect(evaluateLab(goodRun(major), { major })).toEqual([]);
    expect(evaluateLab(goodRun(56, undefined, 'tizen'), { major: 56 })).toEqual([]);
  });

  it("expects each platform's own screensaver answer (RELAY step 15b2)", () => {
    // Tizen has the call, so its absence fails; webOS has none to call.
    expect(expectedStatuses('tizen').find(([k]) => k === 'S11/screensaver')?.[1]).toBe('fail');
    expect(expectedStatuses('webos').find(([k]) => k === 'S11/screensaver')?.[1]).toBe('info');
    expect(expectedStatuses('webos').filter(([k, s]) => EXPECTED_STATUSES.find(([key]) => key === k)?.[1] !== s)).toEqual([['S11/screensaver', 'info']]);
    const webosFailing = goodRun(53, (records) => records.map((r) => (r.check === 'screensaver' ? { ...r, status: 'fail' } : r)));
    expect(evaluateLab(webosFailing, { major: 53 })).toEqual(['S11/screensaver: fail, expected info']);
    // S9 must pass on every engine: a font that did not load is a failure.
    const noFont = goodRun(53, (records) => records.map((r) => (r.check === 'fonts' ? { ...r, status: 'fail', note: 'ar700 is error' } : r)));
    expect(evaluateLab(noFont, { major: 53 })).toEqual(['S9/fonts: fail, expected pass (ar700 is error)']);
  });

  it('takes lifecycle event records between the others', () => {
    const run = goodRun(53, (records) => [records[0] as LabRecord, { type: 'event', session: 's', seq: 2, check: 'lifecycle', note: 'hidden' }, ...records.slice(1).map((r) => ({ ...r, seq: r.seq + 1 }))]);
    expect(evaluateLab(run, { major: 53 })).toEqual([]);
  });

  it('wants exactly the polyfills the engine lacks', () => {
    expect(lacking(53)).toEqual(['String.prototype.padStart', 'Object.entries', 'Object.values', 'Object.fromEntries', 'Promise.prototype.finally', 'Array.prototype.flat', 'globalThis', 'queueMicrotask']);
    expect(lacking(68)).toEqual(['Object.fromEntries', 'Array.prototype.flat', 'globalThis', 'queueMicrotask']);
    // The 53 run's list on 68: four too many.
    expect(evaluateLab(goodRun(53), { major: 68 })).toEqual([
      expect.stringMatching(/^S1\/polyfills: filled .*padStart.*, expected Array\.prototype\.flat, Object\.fromEntries, globalThis, queueMicrotask$/),
    ]);
    const noProbe = goodRun(53, (records) => records.map((r) => (r.check === 'polyfills' ? { ...r, value: { polyfilled: null } } : r)));
    expect(evaluateLab(noProbe, { major: 53 })).toEqual(['S1/polyfills: no native-probe record (the probe did not run before the bundle)']);
  });

  it("waits out S7's own refusals, and gives up on any other error after the grace", () => {
    const refusal = "Fetch API cannot load http://host.docker.internal:8080/__lab/echo?cors=0. No 'Access-Control-Allow-Origin' header is present on the requested resource.";
    const errors: string[] = [refusal];
    let now = 0;
    const gate = labErrorGate(() => errors, () => now, 2000);
    expect(gate()).toBe(false);
    // A minute of S6 after S7's refusals: still waiting.
    now = 60_000;
    expect(gate()).toBe(false);
    errors.push('Uncaught TypeError: x is not a function');
    expect(gate()).toBe(false);
    now += 2000;
    expect(gate()).toBe(false);
    now += 1;
    expect(gate()).toBe(true);
  });

  it("fails a lab run whose app database could not be deleted first", () => {
    expect(evaluateLab({ ...goodRun(53), reset: 'error: blocked' }, { major: 53 })).toEqual(["the app's database was not deleted before the lab: error: blocked"]);
    expect(evaluateLab({ ...goodRun(53), reset: 'no answer', state: null }, { major: 53 })).toEqual(["the app's database was not deleted before the lab: no answer", 'the lab page never answered the probe']);
  });

  it('names a check with the wrong answer, or none', () => {
    const wrong = goodRun(56, (records) => records.map((r) => (r.check === 'blob-worker' ? { ...r, status: 'fail', note: 'threw Error: no Worker' } : r)));
    expect(evaluateLab(wrong, { major: 56 })).toEqual(['S1/blob-worker: fail, expected pass (threw Error: no Worker)']);
    const missing = goodRun(56, (records) => records.filter((r) => r.check !== 'write-test'));
    expect(evaluateLab(missing, { major: 56 })).toEqual(['39 check records, expected 40', 'S2/write-test: no record']);
    // A browser that let a no-CORS request through would be news, not a pass.
    const open = goodRun(56, (records) => records.map((r) => (r.check === 'xhr-no-cors' ? { ...r, status: 'pass' } : r)));
    expect(evaluateLab(open, { major: 56 })).toEqual(['S7/xhr-no-cors: pass, expected fail']);
  });

  it('needs every record in the collector, in order', () => {
    const run = goodRun(53);
    expect(evaluateLab({ ...run, collected: null }, { major: 53 })).toEqual(['the collector has no file for this session']);
    expect(evaluateLab({ ...run, collected: run.collected?.slice(1) ?? [] }, { major: 53 })).toEqual([expect.stringMatching(/^the collector has 41 records, the page 42/)]);
  });

  it('fails a run that never finished, crashed or threw', () => {
    const run = goodRun(53);
    const state = run.state as LabState;
    expect(evaluateLab({ ...run, state: null }, { major: 53 })).toEqual(['the lab page never answered the probe']);
    expect(evaluateLab({ ...run, finished: false, state: { ...state, records: null, runs: 0, phase: 'running' } }, { major: 53 })).toEqual([
      expect.stringMatching(/^no finished run with every record sent \(runs 0, phase running/),
    ]);
    expect(evaluateLab({ ...run, state: { ...state, bootError: 'Boot error: Unexpected token' } }, { major: 53 })).toEqual(['boot error: Boot error: Unexpected token']);
    expect(evaluateLab({ ...run, state: { ...state, ready: 'error', error: 'no server' } }, { major: 53 })).toEqual(['the lab could not start: no server']);
    expect(evaluateLab({ ...run, exceptions: ['TypeError: x is not a function'] }, { major: 53 })).toEqual(['uncaught: TypeError: x is not a function']);
  });

  it("ignores only S7's own refusals among the console errors", () => {
    const refusal = "XMLHttpRequest cannot load http://host.docker.internal:5/__lab/echo?cors=0. No 'Access-Control-Allow-Origin' header is present on the requested resource.";
    const redirect = "XMLHttpRequest cannot load http://h:5/__lab/redirect?cors=0&to=/__lab/echo?cors=0. No 'Access-Control-Allow-Origin' header is present";
    const other = "Fetch API cannot load http://h:5/__lab/bytes?lines=20000. No 'Access-Control-Allow-Origin' header is present";
    expect([refusal, redirect, other].map(isExpectedRefusal)).toEqual([true, true, false]);
    expect(evaluateLab({ ...goodRun(53), exceptions: [refusal, redirect] }, { major: 53 })).toEqual([]);
    expect(evaluateLab({ ...goodRun(53), exceptions: [other] }, { major: 53 })).toEqual([`uncaught: ${other}`]);
  });

  it('sums a run up for the log', () => {
    expect(labSummary(goodRun(53))).toBe('  [fail 4, info 17, pass 16, skip 3; 10k items 202 ms; IDB ? MB/s; 42 records collected]');
  });
});

describe('the lab in the harness', () => {
  it('keeps the expected statuses equal to the e2e test of the bundles', () => {
    // e2e/lab.spec.ts's DESKTOP list, with what its BUNDLE table changes for each TV platform.
    const spec = readFileSync(path.join(ROOT, 'e2e/lab.spec.ts'), 'utf8');
    const table = spec.slice(spec.indexOf('const DESKTOP'), spec.indexOf('];', spec.indexOf('const DESKTOP')));
    const desktop = [...table.matchAll(/\['(S\d+\/[a-z-]+)', '(pass|fail|info|skip)'\]/g)].map((m) => [m[1] ?? '', m[2] ?? ''] as const);
    expect(desktop).toHaveLength(EXPECTED_STATUSES.length);
    for (const platform of ['tizen', 'webos'] as const) {
      const bundle = spec.slice(spec.indexOf(`  ${platform}: {`), spec.indexOf('},', spec.indexOf(`  ${platform}: {`)));
      const changes = new Map([...bundle.matchAll(/'(S\d+\/[a-z-]+)': '(pass|fail|info|skip)'/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
      expect(changes.size).toBeGreaterThan(0);
      expect(desktop.map(([k, s]) => [k, changes.get(k) ?? s])).toEqual(expectedStatuses(platform).map(([k, s]) => [k, s]));
    }
  });

  it('knows each built-in the native probe records', () => {
    const probe = readFileSync(path.join(ROOT, 'apps/tv/src/lab/native-probe.js'), 'utf8');
    const names = [...probe.matchAll(/^\s+'?([A-Za-z.]+)'?: /gm)].map((m) => m[1]);
    expect(names.sort()).toEqual(Object.keys(NATIVE_SINCE).sort());
  });

  it('probes the page in ES5', () => {
    expect(() => parse(LAB_STATE_EXPRESSION, { ecmaVersion: 5 })).not.toThrow();
  });

  it('opens the lab at launch with the host mock as its server and a 16 MB write test', () => {
    expect(labUrl('lab', 'tizen', 54461)).toBe('file:///app/lab/tizen/index.html?server=http://host.docker.internal:54461&mb=16&auto=1');
  });

  it('stages both lab builds, and a seed that loses Worker before the bundle', () => {
    const dist = scratch();
    const variants = scratch();
    expect(stageLab(dist, variants)).toBeNull();
    for (const platform of ['tizen', 'webos']) {
      mkdirSync(path.join(dist, platform), { recursive: true });
      writeFileSync(path.join(dist, platform, 'index.html'), '<head></head><body><script src="main.js"></script></body>');
    }
    const lab = stageLab(dist, variants);
    expect(lab).toBe(path.join(variants, 'lab'));
    const seed = stageLabSeed(lab ?? '', variants);
    const html = readFileSync(path.join(seed, 'webos', 'index.html'), 'utf8');
    expect(html.indexOf(LAB_SEED.script)).toBeGreaterThan(-1);
    expect(html.indexOf(LAB_SEED.script)).toBeLessThan(html.indexOf('main.js'));
    // The real lab is untouched.
    expect(readFileSync(path.join(variants, 'lab', 'webos', 'index.html'), 'utf8')).not.toContain('Worker');
  });

  it('reads the collector file of a session', () => {
    const dir = scratch();
    expect(readCollected(dir, 's')).toBeNull();
    writeFileSync(path.join(dir, 's.ndjson'), '{"type":"start","seq":1}\n{"type":"end","seq":2}\n');
    expect(readCollected(dir, 's')?.map((r) => r.type)).toEqual(['start', 'end']);
  });
});
