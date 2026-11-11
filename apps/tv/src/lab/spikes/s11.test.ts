import type { PlatformCall, PlatformId, ScreenReaderState } from '@lablo/platform-api';
import { describe, expect, it } from 'vitest';
import type { Check, CheckResult, LabAnswer, LabContext, LabQuestion } from '../types';
import { ASK_TIMEOUT_MS, S11, SPOKEN, answerResult } from './s11';

type Answer<T> = T | Error;

function context(
  platform: PlatformId,
  over: {
    saver?: Answer<PlatformCall>;
    speak?: Answer<PlatformCall>;
    reader?: Answer<ScreenReaderState>;
    interactive?: boolean;
    answer?: LabAnswer;
  } = {},
) {
  const calls: string[] = [];
  const asked: LabQuestion[] = [];
  const settle = <T,>(value: Answer<T>): Promise<T> => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  const ctx = {
    info: { platform },
    lifecycle: { entries: [{ event: 'hidden', ms: 1000, at: '', visibility: 'hidden' }] },
    interactive: over.interactive ?? false,
    platform: {
      setScreenSaver: (allowed: boolean) => {
        calls.push(`saver ${String(allowed)}`);
        return settle(over.saver ?? 'unsupported');
      },
      speak: (text: string) => {
        calls.push(`speak ${text}`);
        return settle(over.speak ?? 'unsupported');
      },
      screenReader: () => settle(over.reader ?? { on: null, detail: 'none' }),
    },
    ask: (question: LabQuestion) => {
      asked.push(question);
      return Promise.resolve(over.answer ?? { answer: 'yes', moves: 2 });
    },
  } as unknown as LabContext;
  return { ctx, calls, asked };
}

const check = (id: string): Check => {
  const found = S11.checks.find((c) => c.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

const run = (id: string, ...args: Parameters<typeof context>): Promise<CheckResult> => check(id).run(context(...args).ctx);

describe('S11, lifecycle and accessibility (RELAY step 15b2)', () => {
  it('has its checks in order, the by-ear ones last with room for the answer', () => {
    expect(S11.checks.map((c) => c.id)).toEqual(['lifecycle', 'screensaver', 'screen-reader', 'speech', 'focus-reading', 'live-reading']);
    expect(check('focus-reading').timeoutMs).toBeGreaterThan(ASK_TIMEOUT_MS);
    expect(check('live-reading').timeoutMs).toBeGreaterThan(ASK_TIMEOUT_MS);
  });

  it('reports the lifecycle log so far', async () => {
    const result = await run('lifecycle', 'webos');
    expect(result).toMatchObject({ status: 'info', note: 'hidden at 1.0 s' });
    expect((result.value as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('turns the screensaver off: a pass where the TV takes it, and per platform where it has no API', async () => {
    const { ctx, calls } = context('tizen', { saver: 'done' });
    expect(await check('screensaver').run(ctx)).toMatchObject({ status: 'pass', value: { answer: 'done' } });
    expect(calls).toEqual(['saver false']);
    expect(await run('screensaver', 'browser')).toMatchObject({ status: 'skip', note: 'a desktop browser has no screensaver' });
    expect(await run('screensaver', 'webos')).toMatchObject({ status: 'info', note: expect.stringMatching(/^webOS has no screensaver API/) });
    expect(await run('screensaver', 'tizen')).toMatchObject({ status: 'fail', note: 'webapis.appcommon.setScreenSaver is missing' });
    expect(await run('screensaver', 'tizen', { saver: new Error('setScreenSaver failed: busy') })).toEqual({ status: 'fail', note: 'setScreenSaver failed: busy' });
  });

  it("reports the screen reader's state, skipping the desktop", async () => {
    expect(await run('screen-reader', 'webos', { reader: { on: true, detail: 'audioGuidance = on' } })).toMatchObject({ status: 'info', note: 'on' });
    expect(await run('screen-reader', 'tizen', { reader: { on: false, detail: 'x' } })).toMatchObject({ status: 'info', note: 'off' });
    expect(await run('screen-reader', 'tizen', { reader: { on: null, detail: 'no webapis.tvinfo' } })).toMatchObject({ status: 'info', note: 'unknown: no webapis.tvinfo' });
    expect(await run('screen-reader', 'browser', { reader: { on: null, detail: 'a desktop browser has no screen reader setting' } })).toMatchObject({
      status: 'skip',
      note: 'a desktop browser has no screen reader setting',
    });
  });

  it("asks the TV's speech to say the sentence", async () => {
    const { ctx, calls } = context('webos', { speak: 'done' });
    expect(await check('speech').run(ctx)).toMatchObject({ status: 'pass', note: `taken: the TV should have said "${SPOKEN}"` });
    expect(calls).toEqual([`speak ${SPOKEN}`]);
    expect(await run('speech', 'webos', { speak: new Error('luna://com.webos.service.tts/speak failed: Unknown service') })).toEqual({
      status: 'fail',
      note: 'luna://com.webos.service.tts/speak failed: Unknown service',
    });
    expect(await run('speech', 'browser')).toMatchObject({ status: 'skip' });
    expect(await run('speech', 'tizen')).toMatchObject({ status: 'info', note: expect.stringMatching(/^Tizen has no speech API/) });
    expect(await run('speech', 'webos')).toMatchObject({ status: 'info', note: 'no luna bridge here (only on a webOS TV)' });
  });

  it('asks by ear only when a person started S11, once in each mode', async () => {
    for (const id of ['focus-reading', 'live-reading']) {
      const quiet = context('webos');
      expect(await check(id).run(quiet.ctx)).toEqual({ status: 'skip', note: 'run S11 alone (OK on its row) and answer by ear' });
      expect(quiet.asked).toEqual([]);
    }
    const focus = context('tizen', { interactive: true, reader: { on: true, detail: 'x' } });
    expect(await check('focus-reading').run(focus.ctx)).toEqual({
      status: 'pass',
      value: { answer: 'yes', moves: 2, screenReader: { on: true, detail: 'x' } },
      note: 'read (answered after 2 moves)',
    });
    expect(focus.asked[0]).toMatchObject({ mode: 'focus', timeoutMs: ASK_TIMEOUT_MS, labels: ['Lablo Lab first button', 'Lablo Lab second button', 'Lablo Lab third button'] });
    const live = context('webos', { interactive: true, answer: { answer: 'no', moves: 1 }, reader: new Error('x') });
    expect(await check('live-reading').run(live.ctx)).toMatchObject({ status: 'fail', value: { screenReader: null } });
    expect(live.asked[0]?.mode).toBe('live');
  });

  it('turns each answer into a result', () => {
    expect(answerResult({ answer: 'yes', moves: 4 }, null)).toMatchObject({ status: 'pass', note: 'read (answered after 4 moves)' });
    expect(answerResult({ answer: 'yes', moves: 1 }, null).note).toBe('read (answered after 1 move)');
    expect(answerResult({ answer: 'no', moves: 0 }, null)).toMatchObject({ status: 'fail', note: 'not read (answered after 0 moves)' });
    expect(answerResult({ answer: 'skip', moves: 0 }, null)).toMatchObject({ status: 'skip', note: 'skipped with Back' });
    expect(answerResult({ answer: 'timeout', moves: 0 }, null)).toMatchObject({ status: 'skip', note: 'nobody answered within 5 minutes' });
  });
});
