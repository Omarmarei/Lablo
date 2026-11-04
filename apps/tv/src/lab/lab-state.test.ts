import type { RootBackPolicy } from '@zoma/platform-api';
import { describe, expect, it, vi } from 'vitest';
import { createLab, outcomeKey } from './lab-state';
import type { Post } from './reporter';
import { createReporter } from './reporter';
import { S3 } from './spikes/s2-s3';
import type { Check, LabContext, LabMarker, Spike } from './types';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(spikes: Spike[], platform: { rootBackPolicy: () => RootBackPolicy; exitApp: () => void } = { rootBackPolicy: () => 'exit-dialog', exitApp: vi.fn() }) {
  const bodies: string[] = [];
  const post: Post = (_url, body) => {
    bodies.push(body);
    return Promise.resolve();
  };
  const reporter = createReporter({ server: 'http://h:1', session: 's', post });
  const lab = createLab({ platform, spikes, context: {} as LabContext, reporter });
  return { lab, reporter, bodies, platform };
}

const check = (id: string, status: 'pass' | 'fail' = 'pass', run?: () => Promise<{ status: 'pass' | 'fail' }>): Check => ({
  id,
  title: id,
  run: run ?? (() => Promise.resolve({ status })),
});

const SPIKES: Spike[] = [
  { id: 'S0', title: 'a', question: '', checks: [check('one')] },
  { id: 'S1', title: 'b', question: '', checks: [check('two'), check('three', 'fail')] },
];

describe('the lab screen state', () => {
  it('starts on Run all; OK runs every spike and records each check, then the end', async () => {
    const { lab, reporter } = setup(SPIKES);
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab', zone: 'actions', index: 0 });
    expect(lab.phase.value).toBe('ready');
    lab.nav.handle('OK');
    expect(lab.phase.value).toBe('running');
    await vi.waitFor(() => expect(lab.phase.value).toBe('done'));
    expect(lab.runs.value).toBe(1);
    expect(Object.keys(lab.outcomes.value)).toEqual(['S0/one', 'S1/two', 'S1/three']);
    expect(lab.outcomes.value[outcomeKey('S1', 'three')]?.result.status).toBe('fail');
    expect(reporter.records.map((r) => [r.type, r.spike, r.check, r.status])).toEqual([
      ['check', 'S0', 'one', 'pass'],
      ['check', 'S1', 'two', 'pass'],
      ['check', 'S1', 'three', 'fail'],
      ['end', undefined, undefined, undefined],
    ]);
    expect(reporter.records[3]?.value).toMatchObject({ run: 1, spikes: ['S0', 'S1'], counts: { pass: 2, fail: 1, info: 0, skip: 0 } });
    expect(reporter.records[3]?.note).toBe('all spikes');
  });

  it('runs the spike in focus alone on OK', async () => {
    const { lab, reporter } = setup(SPIKES);
    lab.nav.handle('DOWN');
    lab.nav.handle('DOWN');
    expect(lab.nav.snapshot()).toMatchObject({ zone: 'spikes', index: 1 });
    lab.nav.handle('OK');
    await vi.waitFor(() => expect(lab.phase.value).toBe('done'));
    expect(reporter.records.filter((r) => r.type === 'check').map((r) => r.check)).toEqual(['two', 'three']);
    expect(reporter.records[reporter.records.length - 1]).toMatchObject({ type: 'end', note: 'S1', value: { spikes: ['S1'] } });
  });

  it('ignores a run asked for while one is running, and shows the check in progress', async () => {
    let release: () => void = () => undefined;
    const slow = check('slow', 'pass', () => new Promise((resolve) => (release = () => resolve({ status: 'pass' }))));
    const { lab, reporter } = setup([{ id: 'S0', title: '', question: '', checks: [slow] }]);
    void lab.runAll();
    await tick();
    expect(lab.current.value).toBe('S0/slow');
    await lab.runAll();
    await lab.runSpike('S0');
    release();
    await vi.waitFor(() => expect(lab.phase.value).toBe('done'));
    expect(lab.current.value).toBeNull();
    expect(lab.runs.value).toBe(1);
    expect(reporter.records.filter((r) => r.type === 'end')).toHaveLength(1);
  });

  it('asks before leaving on Tizen and in the browser; Exit leaves', () => {
    const { lab, platform } = setup(SPIKES);
    lab.nav.handle('BACK');
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'exit', zone: 'buttons', index: 0 });
    lab.nav.handle('OK');
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab' });
    expect(platform.exitApp).not.toHaveBeenCalled();
    lab.nav.handle('BACK');
    lab.nav.handle('RIGHT');
    lab.nav.handle('OK');
    expect(platform.exitApp).toHaveBeenCalledTimes(1);
  });

  it('hands Back to the system on webOS', () => {
    const { lab, platform } = setup(SPIKES, { rootBackPolicy: () => 'platform-back' as const, exitApp: vi.fn() });
    lab.nav.handle('BACK');
    expect(platform.exitApp).toHaveBeenCalledTimes(1);
  });
});

describe('S3 against what an earlier run stored', () => {
  const marker = (hash: string | null): LabMarker => ({ version: '0.1.0', session: 'old', at: '2026-11-03T20:00:00.000Z', runs: 1, deviceIdHash: hash });
  const context = (over: Partial<LabContext>): LabContext =>
    ({
      platform: { deviceSecret: () => Promise.resolve(null) },
      info: { platform: 'webos' },
      previous: { localStorage: null, indexedDB: null },
      deviceIdHash: null,
      ...over,
    }) as unknown as LabContext;
  const [deviceId, stable] = S3.checks as [Check, Check];

  it('skips in a desktop browser, fails on a TV without an ID, passes with one', async () => {
    expect(await deviceId.run(context({ info: { platform: 'browser' } as LabContext['info'] }))).toEqual({ status: 'skip', note: 'a desktop browser has no device ID' });
    expect(await deviceId.run(context({}))).toEqual({ status: 'fail', note: 'the LGUDID is not available' });
    expect(await deviceId.run(context({ info: { platform: 'tizen' } as LabContext['info'] }))).toEqual({ status: 'fail', note: 'the DUID is not available' });
    const found = await deviceId.run(context({ platform: { deviceSecret: () => Promise.resolve('095f142a-8f3e-4a2c-9b10-6c1d2e3f4a5b') } as unknown as LabContext['platform'] }));
    expect(found).toMatchObject({ status: 'pass', value: { length: 36, groups: '8-4-4-4-12' } });
    expect(JSON.stringify(found)).not.toContain('095f142a');
  });

  it('compares the hash with the stored marker', async () => {
    expect((await stable.run(context({}))).status).toBe('skip');
    expect(await stable.run(context({ deviceIdHash: 'h1' }))).toMatchObject({ status: 'info', note: expect.stringMatching(/^no earlier run in this storage/) });
    expect(await stable.run(context({ deviceIdHash: 'h1', previous: { localStorage: marker(null), indexedDB: null } }))).toMatchObject({ status: 'info' });
    expect(await stable.run(context({ deviceIdHash: 'h1', previous: { localStorage: marker('h0'), indexedDB: marker('h1') } }))).toMatchObject({ status: 'pass' });
    expect(await stable.run(context({ deviceIdHash: 'h1', previous: { localStorage: null, indexedDB: marker('h2') } }))).toMatchObject({
      status: 'fail',
      value: { now: 'h1', before: 'h2' },
    });
  });
});
