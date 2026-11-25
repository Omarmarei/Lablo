import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SdbRun } from './commands';
import { appStateUrl, describeAppState, inspectApp, packageId, REST_PORT, sdbConnect, sdbDebug, sdbForward, sdbForwardRemove, sdbKill, sdbLaunch, sdbUninstall, tizenAppId } from './commands';

describe('the sdb commands', () => {
  it('connect, launch, debug and forward by the serial', () => {
    expect(sdbConnect('10.0.0.2:26101')).toEqual(['connect', '10.0.0.2:26101']);
    expect(sdbLaunch('10.0.0.2:26101', 'LabloIPTV1.Lablo')).toEqual(['-s', '10.0.0.2:26101', 'shell', '0', 'was_execute', 'LabloIPTV1.Lablo']);
    expect(sdbDebug('10.0.0.2:26101', 'LabloIPTV1.Lablo')).toEqual(['-s', '10.0.0.2:26101', 'shell', '0', 'debug', 'LabloIPTV1.Lablo']);
    expect(sdbForward('10.0.0.2:26101', 37_201)).toEqual(['-s', '10.0.0.2:26101', 'forward', 'tcp:37201', 'tcp:37201']);
  });
});

describe('tizenAppId', () => {
  it("reads the app's id from its config.xml", () => {
    const config = readFileSync(path.resolve(import.meta.dirname, '../../../platforms/tizen/config.xml'), 'utf8');
    expect(tizenAppId(config)).toMatch(/^[A-Za-z0-9]{10}\.[A-Za-z0-9]+$/);
    expect(tizenAppId('<tizen:application  id="Ab12345678.Lab" package="Ab12345678"/>')).toBe('Ab12345678.Lab');
  });

  it('gives null without one', () => {
    expect(tizenAppId('<widget><name>Lablo</name></widget>')).toBeNull();
    expect(tizenAppId('<tizen:application package="x"/>')).toBeNull();
  });
});

describe("the TV's app state", () => {
  it('asks the REST port for the app by its id', () => {
    expect(REST_PORT).toBe(8001);
    expect(appStateUrl('10.0.0.2', 'LabloIPTV1.Lablo')).toBe('http://10.0.0.2:8001/api/v2/applications/LabloIPTV1.Lablo');
    expect(appStateUrl('tv', 'a b/c')).toBe('http://tv:8001/api/v2/applications/a%20b%2Fc');
  });

  it('says whether the app runs and shows', () => {
    expect(describeAppState(200, '{"id":"x","name":"Lablo","running":true,"version":"0.1.0","visible":true}')).toBe('running, visible');
    expect(describeAppState(200, '{"running":true,"visible":false}')).toBe('running, hidden');
    expect(describeAppState(200, '{"running":true}')).toBe('running, visibility unknown');
    expect(describeAppState(200, '{"running":false,"visible":false}')).toBe('not running');
  });

  it('gives the raw answer when it is not the usual one', () => {
    expect(describeAppState(404, 'Not found')).toBe('HTTP 404: Not found');
    expect(describeAppState(200, '{"ok":1}')).toBe('{"ok":1}');
    expect(describeAppState(200, 'null')).toBe('null');
    expect(describeAppState(200, '<html>')).toBe('<html>');
    expect(describeAppState(200, 'x'.repeat(300))).toBe('x'.repeat(200));
    expect(describeAppState(500, 'y'.repeat(300))).toBe(`HTTP 500: ${'y'.repeat(200)}`);
  });
});

const SERIAL = '10.0.0.2:26101';
const APP = 'LabloIPTV1.Lablo';

describe('the fixes from the Samsung session (step 40g)', () => {
  it('kill takes the package id, uninstall the full app id, forward --remove the port', () => {
    expect(packageId(APP)).toBe('LabloIPTV1');
    expect(packageId('NoDot')).toBe('NoDot');
    expect(sdbKill(SERIAL, APP)).toEqual(['-s', SERIAL, 'shell', '0', 'kill', 'LabloIPTV1']);
    expect(sdbUninstall(SERIAL, APP)).toEqual(['-s', SERIAL, 'shell', '0', 'vd_appuninstall', APP]);
    expect(sdbForwardRemove(SERIAL, 37_201)).toEqual(['-s', SERIAL, 'forward', '--remove', 'tcp:37201']);
  });

  /** A fake sdb: records every call, answers by the sub-command. */
  function fakeSdb(answers: { debug?: string; forwardStatus?: number }): { run: SdbRun; calls: string[][] } {
    const calls: string[][] = [];
    const run: SdbRun = (args) => {
      calls.push(args);
      if (args.includes('debug')) return { status: 0, output: answers.debug ?? 'debug port: 37201' };
      if (args.includes('--remove')) return { status: 1, output: 'no such forward' };
      if (args[2] === 'forward') return { status: answers.forwardStatus ?? 0, output: answers.forwardStatus ? 'error: cannot install forward listener' : '' };
      return { status: 0, output: 'Pkgid: LabloIPTV1 is Terminated' };
    };
    return { run, calls };
  }

  it('inspect ends the app first, then debugs, drops stale forwards, then forwards', () => {
    const { run, calls } = fakeSdb({});
    expect(inspectApp(run, SERIAL, APP, 37_000)).toEqual({ port: 37_201 });
    expect(calls).toEqual([
      sdbKill(SERIAL, APP),
      sdbDebug(SERIAL, APP),
      sdbForwardRemove(SERIAL, 37_000),
      sdbForwardRemove(SERIAL, 37_201),
      sdbForward(SERIAL, 37_201),
    ]);
  });

  it('inspect without a saved port only drops the new port', () => {
    const { run, calls } = fakeSdb({});
    inspectApp(run, SERIAL, APP, undefined);
    expect(calls.map((c) => c.join(' '))).toEqual([
      `-s ${SERIAL} shell 0 kill LabloIPTV1`,
      `-s ${SERIAL} shell 0 debug ${APP}`,
      `-s ${SERIAL} forward --remove tcp:37201`,
      `-s ${SERIAL} forward tcp:37201 tcp:37201`,
    ]);
  });

  it("inspect says so when sdb prints no port, and doesn't forward", () => {
    const { run, calls } = fakeSdb({ debug: '' });
    expect(inspectApp(run, SERIAL, APP, undefined)).toEqual({ error: "No inspector port in sdb's answer:\n" });
    expect(calls).toHaveLength(2);
  });

  it("inspect passes on a forward that still fails, with sdb's words", () => {
    const { run } = fakeSdb({ forwardStatus: 1 });
    expect(inspectApp(run, SERIAL, APP, undefined)).toEqual({ error: 'sdb forward failed:\nerror: cannot install forward listener' });
  });
});
