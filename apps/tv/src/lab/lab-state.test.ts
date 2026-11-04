import type { Intent, KeyLike, RootBackPolicy, TextKey } from '@zoma/platform-api';
import { describe, expect, it, vi } from 'vitest';
import { KEYS_SCREEN, TYPE_FIELD, TYPE_SCREEN, createLab, outcomeKey } from './lab-state';
import type { Post } from './reporter';
import { createReporter } from './reporter';
import { S3 } from './spikes/s2-s3';
import type { Check, KeyTest, KeyTestResult, LabAnswer, LabBaseContext, LabContext, LabMarker, LabQuestion, Spike, TextTest, TextTestResult } from './types';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A remote by key code: what the fake adapter maps. */
const INTENT_CODES: Readonly<Record<number, Intent>> = { 13: 'OK', 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN', 403: 'RED', 404: 'GREEN', 461: 'BACK' };
const TEXT_CODES: Readonly<Record<number, TextKey>> = { 13: 'done', 461: 'close', 38: 'up', 40: 'down' };

function setup(spikes: Spike[], platform: { rootBackPolicy: () => RootBackPolicy; exitApp: () => void } = { rootBackPolicy: () => 'exit-dialog', exitApp: vi.fn() }) {
  const bodies: string[] = [];
  const post: Post = (_url, body) => {
    bodies.push(body);
    return Promise.resolve();
  };
  const reporter = createReporter({ server: 'http://h:1', session: 's', post });
  const target = new EventTarget();
  const input = { focus: vi.fn(), blur: vi.fn() };
  const clock = { t: 1000 };
  const listeners: { pointer: Array<(visible: boolean) => void>; keyboard: Array<(visible: boolean) => void> } = { pointer: [], keyboard: [] };
  const subscribe = (list: Array<(visible: boolean) => void>) => (listener: (visible: boolean) => void) => {
    list.push(listener);
    return () => list.splice(list.indexOf(listener), 1);
  };
  const fakePlatform = {
    ...platform,
    keyToIntent: (event: KeyLike): Intent | null => INTENT_CODES[event.keyCode] ?? null,
    textKey: (event: KeyLike): TextKey | null => TEXT_CODES[event.keyCode] ?? null,
    onPointer: subscribe(listeners.pointer),
    onSoftKeyboard: subscribe(listeners.keyboard),
  };
  const lab = createLab({
    platform: fakePlatform,
    spikes,
    context: {} as LabBaseContext,
    reporter,
    target,
    findInput: (id) => (id === TYPE_FIELD ? input : null),
    now: () => clock.t,
  });
  return { lab, reporter, bodies, platform, target, input, clock, listeners };
}

/** A key as the window gets it, then (when the adapter maps it) as the remote wiring hands it on. */
function press(lab: ReturnType<typeof setup>['lab'], target: EventTarget, keyCode: number, key = ''): void {
  target.dispatchEvent(Object.assign(new Event('keydown'), { keyCode, key }));
  const intent = INTENT_CODES[keyCode];
  if (intent !== undefined) lab.nav.handle(intent);
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

describe('a question for the person in front of the TV (RELAY step 15b2)', () => {
  const QUESTION: LabQuestion = { title: 'Heard?', prompt: 'GREEN yes', labels: ['a', 'b', 'c'], mode: 'focus', timeoutMs: 60_000 };

  /** A spike whose one check asks QUESTION (when it may) and keeps the context it was given. */
  function asking() {
    const seen: LabContext[] = [];
    const answers: LabAnswer[] = [];
    const ask = check('ask', 'pass', async () => {
      return { status: 'pass' };
    });
    const spike: Spike = {
      id: 'S11',
      title: '',
      question: '',
      checks: [
        {
          ...ask,
          run: async (context) => {
            seen.push(context);
            if (context.interactive) answers.push(await context.ask(QUESTION));
            return { status: 'pass' };
          },
        },
      ],
    };
    return { spike, seen, answers };
  }

  it('lets only a run started from a spike row ask', async () => {
    const { spike, seen, answers } = asking();
    const { lab } = setup([spike]);
    await lab.runAll();
    expect(seen[0]?.interactive).toBe(false);
    expect(answers).toEqual([]);
    expect(lab.nav.snapshot().screen).toBe('lab');
  });

  it('shows the question on its own screen and takes GREEN as yes, counting the moves', async () => {
    const { spike, answers } = asking();
    const { lab } = setup([spike]);
    const running = lab.runSpike('S11');
    await tick();
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'ask', zone: 'items', index: 0 });
    expect(lab.question.value).toEqual(QUESTION);
    lab.nav.handle('RIGHT');
    lab.nav.handle('RIGHT');
    lab.nav.handle('RIGHT');
    lab.nav.handle('LEFT');
    // The pointer showing and hiding changes the focus state, not the button: no move.
    lab.nav.pointer(true);
    lab.nav.pointer(false);
    // OK and other keys are no answer.
    lab.nav.handle('OK');
    lab.nav.handle('YELLOW');
    expect(lab.nav.snapshot().screen).toBe('ask');
    lab.nav.handle('GREEN');
    await running;
    // Right twice (the third press hit the edge), then left.
    expect(answers).toEqual([{ answer: 'yes', moves: 3 }]);
    expect(lab.question.value).toBeNull();
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab', depth: 1 });
  });

  it('takes RED as no and Back as skip, closing the question either way', async () => {
    for (const [key, answer] of [
      ['RED', 'no'],
      ['BACK', 'skip'],
    ] as const) {
      const { spike, answers } = asking();
      const { lab, platform } = setup([spike]);
      const running = lab.runSpike('S11');
      await tick();
      lab.nav.handle(key);
      await running;
      expect(answers).toEqual([{ answer, moves: 0 }]);
      expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab', depth: 1 });
      // Back answered the question: it never reached the root (no exit dialog).
      expect(platform.exitApp).not.toHaveBeenCalled();
    }
  });

  it('closes as timeout when nobody answers, and ignores keys after', async () => {
    vi.useFakeTimers();
    try {
      const { spike, answers } = asking();
      const { lab } = setup([spike]);
      const running = lab.runSpike('S11');
      await vi.advanceTimersByTimeAsync(59_999);
      expect(lab.nav.snapshot().screen).toBe('ask');
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(answers).toEqual([{ answer: 'timeout', moves: 0 }]);
      expect(lab.nav.snapshot().screen).toBe('lab');
      expect(lab.question.value).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("S10's key tester (RELAY step 15b3)", () => {
  const TEST: KeyTest = { title: 'Keys', prompt: 'Press', intents: ['UP', 'OK', 'BACK', 'RED'], timeoutMs: 60_000 };

  /** A spike whose one check opens the key tester (when it may). */
  function testing() {
    const results: KeyTestResult[] = [];
    const spike: Spike = {
      id: 'S10',
      title: '',
      question: '',
      checks: [
        {
          id: 'keys',
          title: '',
          run: async (context) => {
            if (context.interactive) results.push(await context.testKeys(TEST));
            return { status: 'pass' };
          },
        },
      ],
    };
    return { spike, results };
  }

  it('opens only in a run started from a spike row', async () => {
    const { spike, results } = testing();
    const { lab } = setup([spike]);
    await lab.runAll();
    expect(results).toEqual([]);
    expect(lab.keyTest.value).toBeNull();
  });

  it('records every key with its code, takes every Intent, and ends on Back twice in a row', async () => {
    const { spike, results } = testing();
    const { lab, target, clock, platform } = setup([spike]);
    const running = lab.runSpike('S10');
    await tick();
    expect(lab.nav.snapshot()).toMatchObject({ screen: KEYS_SCREEN, zone: 'keys', index: 0 });
    expect(lab.keyTest.value).toMatchObject({ test: TEST, presses: [], backs: 0 });
    clock.t += 250;
    press(lab, target, 38, 'ArrowUp');
    // An engine that gives no KeyboardEvent.key.
    target.dispatchEvent(Object.assign(new Event('keydown'), { keyCode: 999 }));
    // A key the adapter has no Intent for is recorded too.
    press(lab, target, 10182, 'XF86Exit');
    // Back once, another key, Back once: no two in a row yet.
    press(lab, target, 461, 'GoBack');
    expect(lab.keyTest.value?.backs).toBe(1);
    press(lab, target, 403, 'ColorF0Red');
    expect(lab.keyTest.value?.backs).toBe(0);
    press(lab, target, 461, 'GoBack');
    // No key moved the focus, opened the exit dialog or left.
    expect(lab.nav.snapshot()).toMatchObject({ screen: KEYS_SCREEN, depth: 2 });
    expect(platform.exitApp).not.toHaveBeenCalled();
    clock.t += 100;
    press(lab, target, 461, 'GoBack');
    await running;
    expect(results).toHaveLength(1);
    const result = results[0] as KeyTestResult;
    expect(result.ended).toBe('back');
    expect(result.presses).toEqual([
      { keyCode: 38, key: 'ArrowUp', intent: 'UP', ms: 250 },
      { keyCode: 999, key: '', intent: null, ms: 250 },
      { keyCode: 10182, key: 'XF86Exit', intent: null, ms: 250 },
      { keyCode: 461, key: 'GoBack', intent: 'BACK', ms: 250 },
      { keyCode: 403, key: 'ColorF0Red', intent: 'RED', ms: 250 },
      { keyCode: 461, key: 'GoBack', intent: 'BACK', ms: 250 },
      { keyCode: 461, key: 'GoBack', intent: 'BACK', ms: 350 },
    ]);
    expect(lab.keyTest.value).toBeNull();
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab', depth: 1 });
    // The second Back ended the tester and went no further: no exit dialog.
    expect(platform.exitApp).not.toHaveBeenCalled();
    // The listeners are gone.
    press(lab, target, 38, 'ArrowUp');
    expect(result.presses).toHaveLength(7);
    expect(lab.keyTest.value).toBeNull();
  });

  it('counts the pointer: the system shown and hidden, real moves, clicks, the wheel', async () => {
    const { spike, results } = testing();
    const { lab, target, listeners } = setup([spike]);
    const running = lab.runSpike('S10');
    await tick();
    const move = (x: number): void => void target.dispatchEvent(Object.assign(new Event('mousemove'), { screenX: x, screenY: 5 }));
    listeners.pointer.forEach((l) => l(true));
    move(1);
    move(1);
    move(2);
    target.dispatchEvent(new Event('click'));
    target.dispatchEvent(new Event('wheel'));
    target.dispatchEvent(new Event('wheel'));
    listeners.pointer.forEach((l) => l(false));
    expect(lab.keyTest.value?.pointer).toEqual({ shown: 1, hidden: 1, moves: 2, clicks: 1, wheel: 2 });
    press(lab, target, 461);
    press(lab, target, 461);
    await running;
    expect(results[0]?.pointer).toEqual({ shown: 1, hidden: 1, moves: 2, clicks: 1, wheel: 2 });
    // Stopped listening to the system's pointer too, and to the window's moves, clicks and wheel.
    expect(listeners.pointer).toHaveLength(0);
    for (const event of ['click', 'wheel']) {
      target.dispatchEvent(new Event(event));
      expect(lab.keyTest.value, event).toBeNull();
    }
    move(9);
    expect(lab.keyTest.value).toBeNull();
  });

  it('closes as timeout when nobody ends it', async () => {
    vi.useFakeTimers();
    try {
      const { spike, results } = testing();
      const { lab, target } = setup([spike]);
      const running = lab.runSpike('S10');
      await vi.advanceTimersByTimeAsync(0);
      press(lab, target, 461);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(lab.nav.snapshot().screen).toBe(KEYS_SCREEN);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(results[0]).toMatchObject({ ended: 'timeout', presses: [{ keyCode: 461, intent: 'BACK' }] });
      expect(lab.nav.snapshot().screen).toBe('lab');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("S10's keyboard test (RELAY step 15b3)", () => {
  const TEST: TextTest = { title: 'Type', prompt: 'Type both', timeoutMs: 60_000 };

  function typing() {
    const results: TextTestResult[] = [];
    const spike: Spike = {
      id: 'S10',
      title: '',
      question: '',
      checks: [
        {
          id: 'keyboard',
          title: '',
          run: async (context) => {
            if (context.interactive) results.push(await context.typeText(TEST));
            return { status: 'pass' };
          },
        },
      ],
    };
    return { spike, results };
  }

  /** A key the field's input gets while it has DOM focus. */
  const fieldKey = (lab: ReturnType<typeof setup>['lab'], keyCode: number, key = '') => {
    const event = { keyCode, key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    lab.textTest.value?.field.onEditKey(event);
    return event;
  };
  /** What the TextField does on each change of its input. */
  const type = (lab: ReturnType<typeof setup>['lab'], text: string): void => {
    lab.textTest.value?.field.onEditInput();
    lab.textTest.value?.onValue(text);
  };

  it('opens the field on OK, records its keys and text per edit, and takes GREEN as the answer', async () => {
    const { spike, results } = typing();
    const { lab, input, clock, target } = setup([spike]);
    const running = lab.runSpike('S10');
    await tick();
    expect(lab.nav.snapshot()).toMatchObject({ screen: TYPE_SCREEN, zone: 'field', index: 0 });
    expect(lab.textTest.value).toMatchObject({ test: TEST, text: '', edits: [], keyboard: [] });
    expect(lab.textTest.value?.field.editing).toBe(false);
    // GREEN while nobody typed is still an answer, but first: OK opens the field.
    press(lab, target, 13);
    expect(input.focus).toHaveBeenCalledTimes(1);
    expect(lab.textTest.value?.field.editing).toBe(true);
    clock.t += 1000;
    fieldKey(lab, 229, 'Process');
    type(lab, 'زوما Zoma');
    // The keyboard's Done (key 13 here) ends the edit; the field keeps the text.
    const done = fieldKey(lab, 13, 'Enter');
    expect(done.preventDefault).toHaveBeenCalled();
    expect(input.blur).toHaveBeenCalledTimes(1);
    expect(lab.textTest.value?.field.editing).toBe(false);
    expect(lab.textTest.value?.edits).toEqual([
      {
        how: 'done',
        keys: [
          { keyCode: 229, key: 'Process', intent: null, ms: 1000 },
          { keyCode: 13, key: 'Enter', intent: 'OK', ms: 1000 },
        ],
        inputs: 1,
        text: 'زوما Zoma',
      },
    ]);
    // The edit's DOWN hit the edge: still on the field.
    expect(lab.nav.snapshot()).toMatchObject({ screen: TYPE_SCREEN, zone: 'field' });
    // A second edit, ended by the keyboard's Back: its own keys and changes.
    press(lab, target, 13);
    clock.t += 50;
    type(lab, 'زوما Zoma!');
    type(lab, 'زوما Zoma!!');
    fieldKey(lab, 461, 'GoBack');
    expect(input.focus).toHaveBeenCalledTimes(2);
    press(lab, target, 404);
    await running;
    expect(results[0]).toMatchObject({ answer: 'yes', text: 'زوما Zoma!!', keyboard: [] });
    expect(results[0]?.edits.map((e) => [e.how, e.keys.map((k) => k.keyCode), e.inputs, e.text])).toEqual([
      ['done', [229, 13], 1, 'زوما Zoma'],
      ['close', [461], 2, 'زوما Zoma!!'],
    ]);
    expect(lab.textTest.value).toBeNull();
    expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab', depth: 1 });
  });

  it("records the system keyboard's events, and ends the edit when it hides", async () => {
    const { spike, results } = typing();
    const { lab, target, input, listeners } = setup([spike]);
    const running = lab.runSpike('S10');
    await tick();
    press(lab, target, 13);
    listeners.keyboard.forEach((l) => l(true));
    type(lab, 'abc');
    listeners.keyboard.forEach((l) => l(false));
    expect(input.blur).toHaveBeenCalledTimes(1);
    expect(lab.textTest.value?.keyboard).toEqual([true, false]);
    expect(lab.textTest.value?.edits.map((e) => [e.how, e.text, e.inputs])).toEqual([['close', 'abc', 1]]);
    press(lab, target, 403);
    await running;
    expect(results[0]).toMatchObject({ answer: 'no', text: 'abc', keyboard: [true, false] });
    expect(listeners.keyboard).toHaveLength(0);
  });

  it('takes Back as skip, and closes an open edit as close on timeout', async () => {
    {
      const { spike, results } = typing();
      const { lab, target, platform } = setup([spike]);
      const running = lab.runSpike('S10');
      await tick();
      press(lab, target, 461);
      await running;
      expect(results[0]).toMatchObject({ answer: 'skip', text: '', edits: [] });
      expect(platform.exitApp).not.toHaveBeenCalled();
      expect(lab.nav.snapshot()).toMatchObject({ screen: 'lab', depth: 1 });
    }
    vi.useFakeTimers();
    try {
      const { spike, results } = typing();
      const { lab, target, input } = setup([spike]);
      const running = lab.runSpike('S10');
      await vi.advanceTimersByTimeAsync(0);
      press(lab, target, 13);
      type(lab, 'x');
      await vi.advanceTimersByTimeAsync(59_999);
      expect(lab.nav.snapshot().screen).toBe(TYPE_SCREEN);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(results[0]).toMatchObject({ answer: 'timeout', text: 'x', edits: [{ how: 'close', text: 'x', inputs: 1 }] });
      expect(input.blur).toHaveBeenCalledTimes(1);
      expect(lab.nav.snapshot().screen).toBe('lab');
    } finally {
      vi.useRealTimers();
    }
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
