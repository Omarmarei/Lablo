import { describe, expect, it } from 'vitest';
import { NO_AVPLAYSTORE } from '../avplay-deps';
import type { AvplayStage } from '../avplay-player';
import { createAvplayPlayer } from '../avplay-player';
import { PLACEHOLDER_NOTE } from '../battery';
import type { AvplayPlan } from '../fakes';
import { FakeAvplay, FakeClock, LAB_MEDIA_FIXTURE, fakeAvplayStage } from '../fakes';
import { runSpikes } from '../runner';
import type { CheckResult, LabContext } from '../types';
import type { S8Deps } from './s8';
import { S8_LIMITS, S8_NOT_TIZEN, createS8 } from './s8';

/** `avplaystore` on a fake clock: each getPlayer a new fake AVPlay, playing as `plan` says. */
function s8(options: { plan?: (player: number, url: string, n: number) => AvplayPlan; media?: unknown; limit?: number; missing?: string | null } = {}) {
  const clock = new FakeClock();
  const apis: FakeAvplay[] = [];
  const stages: Array<ReturnType<typeof fakeAvplayStage>> = [];
  const deps: S8Deps = {
    missing: () => options.missing ?? null,
    mountStage: () => {
      const stage = fakeAvplayStage();
      stages.push(stage);
      return stage;
    },
    createPlayer: (stage: AvplayStage) => {
      if (apis.length >= (options.limit ?? 99)) throw Object.assign(new Error('the TV has no more players'), { name: 'QUOTA_EXCEEDED_ERR' });
      const which = apis.length;
      const api = new FakeAvplay(clock, (url, n) => (options.plan ?? (() => ({ prepareAfterMs: 100 })))(which, url, n));
      apis.push(api);
      return createAvplayPlayer(api, stage, { timers: clock.timers, now: clock.now });
    },
    getJson: () => Promise.resolve(options.media ?? LAB_MEDIA_FIXTURE),
    clock,
  };
  const spike = createS8(() => deps);
  /** How long each check took on the fake clock, from the last run. */
  const took: Record<string, number> = {};
  const runAll = async (modelYear: number | null = 2021): Promise<Record<string, CheckResult>> => {
    const out: Record<string, CheckResult> = {};
    let started = 0;
    await runSpikes(
      [spike],
      { server: 'http://lab:8080', info: { tier: 'full', modelYear }, interactive: false } as unknown as LabContext,
      (o) => {
        out[o.check] = o.result;
        took[o.check] = clock.t - started;
      },
      () => (started = clock.t),
    );
    return out;
  };
  return { clock, apis, stages, spike, runAll, took };
}

describe('S8, pre-buffering with avplaystore (RELAY step 15c2)', () => {
  it('gets two players, prepares both at once, and switches to the prepared one three times', async () => {
    const b = s8();
    expect(b.spike).toMatchObject({ id: 'S8', title: 'AVPlay pre-buffering' });
    const results = await b.runAll();
    expect(results['store']).toMatchObject({ status: 'pass', note: 'avplaystore.getPlayer() gave two players', value: { players: 2, media: 'files', engines: [{ engine: 'avplay' }, { engine: 'avplay' }] } });
    expect(results['prebuffer']).toEqual({ status: 'pass', value: { prepareMs: [100, 100], error: null }, note: 'both prepared, in 100 ms and 100 ms' });
    // The switch: stop the one, play the other, and its clock moves 100 ms later (seen 50 ms after).
    expect(results['switch']).toMatchObject({ status: 'pass', note: '150 ms, 150 ms, 150 ms, each ≤ 700 ms', value: { worstMs: 150, limitMs: 700, modelYear: 2021, judged: true } });
    expect((results['switch']?.value as { switches: unknown[] }).switches).toEqual([
      { ms: 150, prepareMs: 100, error: null },
      { ms: 150, prepareMs: 100, error: null },
      { ms: 150, prepareMs: 100, error: null },
    ]);
    // Three rows, two players each, one stage each, all gone again; nothing left open.
    expect(b.apis).toHaveLength(6);
    expect(b.stages.map((s) => s.removed)).toEqual([1, 1, 1]);
    expect(b.stages[2]?.captions).toEqual(['S8: switching between two players']);
    expect(b.apis.every((a) => a.state === 'NONE')).toBe(true);
    // The switch row: player A plays, B prepares; A stops as B starts; then A prepares again.
    const [a, bb] = [b.apis[4] as FakeAvplay, b.apis[5] as FakeAvplay];
    expect(a.urls).toEqual(['http://lab/live/104.ts', 'http://lab/live/104.ts']);
    // A plays; stopped (and closed) for switch 1; prepares again; plays at switch 2; stopped at switch 3; disposed.
    const open = ['stop', 'close', 'open', 'setListener', 'setDisplayRect 1112,556,768,432', 'prepareAsync'];
    expect(a.calls).toEqual([...open, 'play', 'stop', 'close', ...open, 'play', 'stop', 'close', 'stop', 'close']);
    expect(bb.urls).toEqual(['http://lab/live/104.ts', 'http://lab/live/104.ts']);
    expect(JSON.stringify(results)).not.toMatch(/http:|lablo-test/);
  });

  it('judges the switch only on 2020+ TVs, at 700 ms or less', async () => {
    // Players 0-1 are the store row's, 2-3 prebuffer's, 4-5 the switch row's (4 plays first).
    const at = async (startAfterMs: number, year: number | null = 2021) => (await s8({ plan: (p, _u, n) => ({ prepareAfterMs: 100, startAfterMs: p === 4 && n === 1 ? 100 : startAfterMs }) }).runAll(year))['switch'];
    expect(await at(650)).toMatchObject({ status: 'pass', note: '700 ms, 700 ms, 700 ms, each ≤ 700 ms' });
    expect(await at(700)).toMatchObject({ status: 'fail', note: '750 ms, 750 ms, 750 ms: the slowest over 700 ms', value: { worstMs: 750 } });
    expect(await at(700, 2019)).toMatchObject({ status: 'info', note: '750 ms, 750 ms, 750 ms; only 2020+ TVs are held to 700 ms', value: { judged: false } });
    expect(await at(100, null)).toMatchObject({ status: 'info', value: { modelYear: null, judged: false } });
    expect(await at(100, 2020)).toMatchObject({ status: 'pass', value: { judged: true } });
    expect(S8_LIMITS.switchMs).toBe(700);
  });

  it('fails when the store refuses a second player', async () => {
    const b = s8({ limit: 1 });
    const results = await b.runAll();
    expect(results['store']).toEqual({ status: 'fail', value: { media: 'files' }, note: 'avplaystore.getPlayer() failed: the TV has no more players' });
    // The one it gave is closed, and the stage gone.
    expect(b.apis[0]?.state).toBe('NONE');
    expect(b.stages.every((s) => s.removed === 1)).toBe(true);
    // The next rows can't get their players either: the runner records the throw.
    expect(results['prebuffer']).toMatchObject({ status: 'fail', note: 'threw QUOTA_EXCEEDED_ERR: the TV has no more players' });
  });

  it("fails a prepare that fails or never ends, and a switch that doesn't come", async () => {
    const failingRun = s8({ plan: (p) => (p === 3 ? { prepareAfterMs: 300, prepareError: { name: 'PLAYER_ERROR_CONNECTION_FAILED' } } : { prepareAfterMs: 100 }) });
    const failing = await failingRun.runAll();
    expect(failing['prebuffer']).toMatchObject({ status: 'fail', note: 'a prepare failed: prepareAsync: PLAYER_ERROR_CONNECTION_FAILED' });
    // It ends at the failure, not after the whole wait.
    expect(failingRun.took['prebuffer']).toBe(300);
    // Prepared, then an error before it ever played.
    const broke = await s8({ plan: (p) => ({ prepareAfterMs: 100, readyError: p === 3 ? 'PLAYER_ERROR_CONNECTION_FAILED' : undefined }) }).runAll();
    expect(broke['prebuffer']).toMatchObject({ status: 'fail', value: { prepareMs: [100, 100] }, note: 'a prepare failed: PLAYER_ERROR_CONNECTION_FAILED' });
    const frozen = await s8({ plan: (p) => ({ prepareAfterMs: p === 3 ? null : 100 }) }).runAll();
    expect(frozen['prebuffer']).toEqual({ status: 'fail', value: { prepareMs: [100, null], error: null }, note: 'not both prepared within 10000 ms (100 ms, no)' });
    // The second player's second prepare (switch 2) never ends.
    const late = await s8({ plan: (p, _u, n) => ({ prepareAfterMs: p === 4 && n === 2 ? null : 100 }) }).runAll();
    expect(late['switch']).toMatchObject({ status: 'fail', note: 'switch 2 of 3 failed: not prepared in time' });
    const broken = await s8({ plan: (p, _u, n) => (p === 5 && n === 1 ? { prepareAfterMs: 100, startAfterMs: null } : { prepareAfterMs: 100 }) }).runAll();
    expect(broken['switch']).toMatchObject({ status: 'fail', note: 'switch 1 of 3 failed: no frame' });
    const erring = await s8({ plan: (p) => (p === 5 ? { prepareAfterMs: 100, error: { afterMs: 20, name: 'PLAYER_ERROR_CONNECTION_FAILED' } } : { prepareAfterMs: 100 }) }).runAll();
    expect(erring['switch']).toMatchObject({ status: 'fail', note: 'switch 1 of 3 failed: PLAYER_ERROR_CONNECTION_FAILED' });
    const unplayed = await s8({ plan: (p) => (p === 4 ? { prepareAfterMs: null } : { prepareAfterMs: 100 }) }).runAll();
    expect(unplayed['switch']).toMatchObject({ status: 'fail', note: 'the first player never played: no answer' });
  });

  it('skips every row without avplaystore, and the playing rows on placeholder bytes', async () => {
    const none = createS8(() => null);
    expect(none.checks.map((c) => c.id)).toEqual(['store', 'prebuffer', 'switch']);
    for (const check of none.checks) expect(await check.run({} as LabContext)).toEqual({ status: 'skip', note: S8_NOT_TIZEN });
    const older = s8({ missing: NO_AVPLAYSTORE });
    expect(Object.values(await older.runAll()).map((r) => [r.status, r.note])).toEqual([
      ['skip', NO_AVPLAYSTORE],
      ['skip', NO_AVPLAYSTORE],
      ['skip', NO_AVPLAYSTORE],
    ]);
    expect(older.apis).toHaveLength(0);
    const placeholder = await s8({ media: { ...LAB_MEDIA_FIXTURE, media: 'placeholder' } }).runAll();
    expect(placeholder['store']).toMatchObject({ status: 'pass', value: { media: 'placeholder' } });
    expect(placeholder['prebuffer']).toEqual({ status: 'skip', note: PLACEHOLDER_NOTE });
    expect(placeholder['switch']).toEqual({ status: 'skip', note: PLACEHOLDER_NOTE });
    const odd = await s8({ media: { nothing: true } }).runAll();
    expect(odd['store']).toEqual({ status: 'fail', note: 'the lab server answered something else than a media list' });
    expect(odd['prebuffer']).toEqual({ status: 'skip', note: "needs the lab server's media list (the first check)" });
    // A later run whose media list fails forgets the earlier one's.
    let answer: unknown = LAB_MEDIA_FIXTURE;
    const again = s8();
    const spike = createS8(() => ({ ...(again.spike.checks.length > 0 ? {} : {}), missing: () => null, mountStage: fakeAvplayStage, createPlayer: (stage) => createAvplayPlayer(new FakeAvplay(again.clock), stage, { timers: again.clock.timers, now: again.clock.now }), getJson: () => Promise.resolve(answer), clock: again.clock }));
    const ctx = { server: 'http://lab:8080', info: { tier: 'full', modelYear: 2021 }, interactive: false } as unknown as LabContext;
    expect((await spike.checks[0]!.run(ctx)).status).toBe('pass');
    expect((await spike.checks[1]!.run(ctx)).status).toBe('pass');
    answer = { nothing: true };
    expect((await spike.checks[0]!.run(ctx)).status).toBe('fail');
    expect(await spike.checks[1]!.run(ctx)).toEqual({ status: 'skip', note: "needs the lab server's media list (the first check)" });
    const noTs = await s8({ media: { media: 'files', items: {} } }).runAll();
    expect(noTs['switch']).toEqual({ status: 'skip', note: "the lab server's catalog has no live-ts item" });
  });
});
