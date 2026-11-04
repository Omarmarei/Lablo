import type { Intent, KeyRegistration, PlatformId } from '@zoma/platform-api';
import { INTENTS } from '@zoma/platform-api';
import { describe, expect, it } from 'vitest';
import type { Check, KeyPress, KeyTest, KeyTestResult, LabContext, PointerLog, TextTest, TextTestResult } from '../types';
import { INPUT_TIMEOUT_MS, createS10, distinctKeys, keyboardResult, keysResult, pointerResult, registrationResult, scriptsOf } from './s10';

const REGISTERED: KeyRegistration = { skipped: null, supported: [{ name: 'ChannelUp', code: 427 }], registered: ['ChannelUp', 'ColorF0Red'], unsupported: [], refused: [] };
const NONE: PointerLog = { shown: 0, hidden: 0, moves: 0, clicks: 0, wheel: 0 };

const press = (keyCode: number, intent: Intent | null, key = ''): KeyPress => ({ keyCode, key, intent, ms: 0 });

describe('S10 registration', () => {
  it('passes on Tizen when the TV took every key, naming the ones it lacks', () => {
    expect(registrationResult('tizen', REGISTERED)).toEqual({ status: 'pass', value: REGISTERED, note: 'registered 2 keys' });
    const lacking = { ...REGISTERED, unsupported: ['PreviousChannel', 'Guide'] };
    expect(registrationResult('tizen', lacking).note).toBe('registered 2 keys; not on this TV: PreviousChannel, Guide');
    const noList = { ...REGISTERED, supported: null };
    expect(registrationResult('tizen', noList)).toMatchObject({ status: 'pass', note: 'registered 2 keys; the TV gave no key list, so every key was tried' });
  });

  it('fails on Tizen without the key API, or when the TV refuses a key', () => {
    const missing: KeyRegistration = { skipped: 'no tizen.tvinputdevice', supported: null, registered: [], unsupported: [], refused: [] };
    expect(registrationResult('tizen', missing)).toMatchObject({ status: 'fail', note: 'no tizen.tvinputdevice' });
    const refused = { ...REGISTERED, refused: [{ name: 'Guide', error: 'NotSupportedError: no' }] };
    expect(registrationResult('tizen', refused)).toMatchObject({ status: 'fail', note: 'the TV refused Guide (NotSupportedError: no)' });
  });

  it('has nothing to judge on webOS (info) or in the desktop browser (skip)', () => {
    const webos: KeyRegistration = { skipped: 'webOS delivers every key', supported: null, registered: [], unsupported: [], refused: [] };
    expect(registrationResult('webos', webos)).toEqual({ status: 'info', value: webos, note: 'webOS delivers every key' });
    expect(registrationResult('browser', { ...webos, skipped: null })).toMatchObject({ status: 'skip', note: 'nothing to register' });
  });
});

describe('S10 key tester verdict', () => {
  const INTENTS3: Intent[] = ['UP', 'PREV_CH', 'BACK'];

  it('counts each distinct key once, in the order it first came', () => {
    expect(distinctKeys([press(38, 'UP', 'ArrowUp'), press(10182, null, 'XF86Exit'), press(38, 'UP', 'ArrowUp'), press(38, 'UP', 'Up')])).toEqual([
      { keyCode: 38, key: 'ArrowUp', intent: 'UP', count: 2 },
      { keyCode: 10182, key: 'XF86Exit', intent: null, count: 1 },
      { keyCode: 38, key: 'Up', intent: 'UP', count: 1 },
    ]);
  });

  it('passes when every Intent came, listing the keys with no action', () => {
    const result: KeyTestResult = { ended: 'back', presses: [press(38, 'UP'), press(10190, 'PREV_CH'), press(10182, null, 'XF86Exit'), press(461, 'BACK'), press(461, 'BACK')], pointer: NONE };
    const verdict = keysResult(result, INTENTS3);
    expect(verdict.status).toBe('pass');
    expect(verdict.note).toBe('every key came (3); keys with no action: 10182 XF86Exit');
    expect(verdict.value).toMatchObject({ ended: 'back', presses: 5, codes: { UP: [38], PREV_CH: [10190], BACK: [461] }, missing: [], others: [{ keyCode: 10182, count: 1 }] });
  });

  it('fails naming the Intents no key came for, and keeps every code of an Intent', () => {
    const result: KeyTestResult = { ended: 'back', presses: [press(415, 'UP'), press(19, 'UP'), press(461, 'BACK'), press(461, 'BACK')], pointer: NONE };
    const verdict = keysResult(result, INTENTS3);
    expect(verdict).toMatchObject({ status: 'fail', note: 'no key for PREV_CH', value: { codes: { UP: [415, 19] }, missing: ['PREV_CH'] } });
  });

  it('skips when nothing but Back came', () => {
    expect(keysResult({ ended: 'back', presses: [press(461, 'BACK'), press(461, 'BACK')], pointer: NONE }, INTENTS3)).toMatchObject({ status: 'skip', note: 'skipped with Back' });
    expect(keysResult({ ended: 'timeout', presses: [], pointer: NONE }, INTENTS3)).toMatchObject({ status: 'skip', note: 'no key within 5 minutes' });
    // One other key is a test, not a skip.
    expect(keysResult({ ended: 'timeout', presses: [press(10182, null)], pointer: NONE }, INTENTS3).status).toBe('fail');
  });
});

describe('S10 pointer verdict', () => {
  it('passes when the pointer moved and clicked; any other use is info; none is a skip', () => {
    expect(pointerResult({ ...NONE, shown: 1, moves: 3, clicks: 1 })).toEqual({
      status: 'pass',
      value: { ...NONE, shown: 1, moves: 3, clicks: 1 },
      note: 'shown 1, hidden 0, moves 3, clicks 1, wheel 0',
    });
    expect(pointerResult({ ...NONE, moves: 3 }).status).toBe('info');
    expect(pointerResult({ ...NONE, clicks: 1 }).status).toBe('info');
    for (const field of ['shown', 'hidden', 'wheel'] as const) expect(pointerResult({ ...NONE, [field]: 1 }).status).toBe('info');
    expect(pointerResult(NONE)).toMatchObject({ status: 'skip', note: 'no pointer in the key tester (no Magic Remote, or it stayed still)' });
  });
});

describe('S10 keyboard verdict', () => {
  const result = (answer: TextTestResult['answer'], text: string): TextTestResult => ({ answer, text, edits: [{ how: 'done', keys: [], inputs: 3, text }], keyboard: [true, false] });

  it('finds Arabic and Latin letters', () => {
    expect(scriptsOf('زوما Zoma')).toEqual({ arabic: true, latin: true });
    expect(scriptsOf('زوما')).toEqual({ arabic: true, latin: false });
    expect(scriptsOf('Zoma 123')).toEqual({ arabic: false, latin: true });
    // Digits, punctuation, Arabic-Indic digits and the tatweel are no letters.
    expect(scriptsOf('123 ،؟ ' + String.fromCharCode(0x0660, 0x0640))).toEqual({ arabic: false, latin: false });
    // The edges of each range.
    for (const code of [0x0620, 0x063f, 0x0641, 0x064a, 0x0671, 0x06d3, 0x0750, 0x077f, 0xfb50, 0xfdff, 0xfe70, 0xfefc]) expect(scriptsOf(String.fromCharCode(code)).arabic).toBe(true);
    for (const code of [0x061f, 0x064b, 0x0670, 0x06d4, 0x074f, 0x0780, 0xfb4f, 0xfe00, 0xfe6f, 0xfefd]) expect(scriptsOf(String.fromCharCode(code)).arabic).toBe(false);
    for (const letter of ['A', 'Z', 'a', 'z']) expect(scriptsOf(letter).latin).toBe(true);
    for (const other of ['@', '[', '`', '{']) expect(scriptsOf(other).latin).toBe(false);
  });

  it('passes on GREEN with both languages typed, and fails without one of them', () => {
    expect(keyboardResult(result('yes', 'زوما Zoma'))).toMatchObject({ status: 'pass', note: 'typed "زوما Zoma" in Arabic and English (1 edits)', value: { scripts: { arabic: true, latin: true }, keyboard: [true, false] } });
    expect(keyboardResult(result('yes', 'Zoma'))).toMatchObject({ status: 'fail', note: 'answered yes, but typed "Zoma" has no Arabic letters' });
    expect(keyboardResult(result('yes', 'زوما'))).toMatchObject({ status: 'fail', note: 'answered yes, but typed "زوما" has no English letters' });
  });

  it('fails on RED, skips on Back or no answer', () => {
    expect(keyboardResult(result('no', ''))).toMatchObject({ status: 'fail', note: 'the keyboard did not work: nothing typed' });
    expect(keyboardResult(result('skip', 'x'))).toMatchObject({ status: 'skip', note: 'skipped with Back' });
    expect(keyboardResult(result('timeout', 'x'))).toMatchObject({ status: 'skip', note: 'nobody answered within 5 minutes' });
  });
});

describe('S10 checks', () => {
  function context(platform: PlatformId, interactive: boolean, keys: KeyTestResult, text: TextTestResult) {
    const asked: Array<KeyTest | TextTest> = [];
    const ctx = {
      info: { platform },
      keys: REGISTERED,
      interactive,
      testKeys: (test: KeyTest) => {
        asked.push(test);
        return Promise.resolve(keys);
      },
      typeText: (test: TextTest) => {
        asked.push(test);
        return Promise.resolve(text);
      },
    } as unknown as LabContext;
    return { ctx, asked };
  }
  const ALL: KeyTestResult = { ended: 'back', presses: INTENTS.map((intent, i) => press(i, intent)), pointer: { ...NONE, moves: 4, clicks: 2 } };
  const TYPED: TextTestResult = { answer: 'yes', text: 'زوما Zoma', edits: [], keyboard: [] };

  it('has the four checks, the waits longer than their screens', () => {
    const spike = createS10();
    expect(spike.checks.map((c) => c.id)).toEqual(['registration', 'keys', 'pointer', 'keyboard']);
    expect(spike.checks.map((c) => c.timeoutMs)).toEqual([undefined, INPUT_TIMEOUT_MS + 10_000, undefined, INPUT_TIMEOUT_MS + 10_000]);
  });

  it('runs only the registration unattended', async () => {
    const [registration, keys, pointer, keyboard] = createS10().checks as [Check, Check, Check, Check];
    const { ctx, asked } = context('tizen', false, ALL, TYPED);
    expect(await registration.run(ctx)).toMatchObject({ status: 'pass', note: 'registered 2 keys' });
    expect(await keys.run(ctx)).toEqual({ status: 'skip', note: 'run S10 alone (OK on its row) and press every key' });
    expect(await pointer.run(ctx)).toEqual({ status: 'skip', note: 'run S10 alone (OK on its row): measured in the key tester' });
    expect(await keyboard.run(ctx)).toEqual({ status: 'skip', note: "run S10 alone (OK on its row) and type with the TV's keyboard" });
    expect(asked).toEqual([]);
  });

  it('asks for every Intent, and judges the pointer from the same key tester', async () => {
    const spike = createS10();
    const [, keys, pointer, keyboard] = spike.checks as [Check, Check, Check, Check];
    const { ctx, asked } = context('webos', true, ALL, TYPED);
    expect(await keys.run(ctx)).toMatchObject({ status: 'pass', note: `every key came (${INTENTS.length})` });
    expect(await pointer.run(ctx)).toMatchObject({ status: 'pass', value: { moves: 4, clicks: 2 } });
    expect(await keyboard.run(ctx)).toMatchObject({ status: 'pass' });
    expect(asked.map((a) => a.timeoutMs)).toEqual([INPUT_TIMEOUT_MS, INPUT_TIMEOUT_MS]);
    expect((asked[0] as KeyTest).intents).toEqual(INTENTS);
    // The prompt asks for both languages.
    expect(asked[1]?.prompt).toMatch(/زوما.*Zoma/);
  });

  it("forgets the last key tester when the next run's keys check skips", async () => {
    const spike = createS10();
    const [, keys, pointer] = spike.checks as [Check, Check, Check];
    await keys.run(context('webos', true, ALL, TYPED).ctx);
    const unattended = context('webos', false, ALL, TYPED).ctx;
    await keys.run(unattended);
    // Even if a run were marked interactive here, there is no tester result to read.
    expect(await pointer.run({ ...unattended, interactive: true } as LabContext)).toMatchObject({ status: 'skip' });
  });
});
