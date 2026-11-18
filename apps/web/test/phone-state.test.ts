import type { PairProgressResponse } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import type { ApiResult } from '../src/phone/api';
import type { PickedFile } from '../src/phone/form';
import { EMPTY_VALUES } from '../src/phone/form';
import type { PageEvent, PageState, View } from '../src/phone/state';
import { CODE_VIEW, initialState, reduce } from '../src/phone/state';

/** The phone page's state (RELAY step 31b): every view and what moves it. */

const KEY = 'A'.repeat(42) + 'E';
const TARGET = { code: '7K3MQ9XD', tvPk: KEY };
const OTHER = { code: 'ABCDEFGH', tvPk: KEY };

function run(state: PageState, ...events: PageEvent[]): PageState {
  return events.reduce(reduce, state);
}

const start = initialState('en');
const formState = run(start, { type: 'qr', target: TARGET }, { type: 'progressAnswer', code: TARGET.code, result: { ok: true, value: { state: 'open', exp: 1 } } });
const filled = run(formState, { type: 'field', key: 'server', value: 'example.com' }, { type: 'field', key: 'username', value: 'u' }, { type: 'field', key: 'password', value: 'p' });
const sending = run(filled, { type: 'send' });
const ok = <const T,>(value: T): ApiResult<T> => ({ ok: true, value });
const fail = (error: 'gone' | 'conflict' | 'network'): ApiResult<never> => ({ ok: false, error });
const limited: ApiResult<never> = { ok: false, error: 'limited', retryAfterS: 90 };
const FILE: PickedFile = { name: 'list.m3u', size: 10, read: () => Promise.resolve(new Uint8Array(10)) };
const OTHER_FILE: PickedFile = { name: 'other.m3u', size: 20, read: () => Promise.resolve(new Uint8Array(20)) };

describe('the start', () => {
  it('waits for the page to read its address', () => {
    expect(start).toEqual({ lang: 'en', view: { kind: 'starting' }, type: 'xtream', values: EMPTY_VALUES, file: null, problems: {}, showProblems: false });
    expect(reduce(start, { type: 'start' }).view).toEqual(CODE_VIEW);
    expect(reduce(start, { type: 'qr', target: TARGET }).view).toEqual({ kind: 'checking', target: TARGET });
  });

  it('starts once', () => {
    const code = reduce(start, { type: 'start' });
    expect(reduce(code, { type: 'start' })).toBe(code);
    expect(reduce(code, { type: 'qr', target: TARGET })).toBe(code);
    expect(reduce(formState, { type: 'start' })).toBe(formState);
  });

  it('ignores the form, the send and "again" before a view shows', () => {
    for (const event of [{ type: 'again', keep: false }, { type: 'send' }, { type: 'field', key: 'name', value: 'x' }, { type: 'codeSubmit' }, { type: 'pickFile', file: FILE }] as PageEvent[]) {
      expect(reduce(start, event)).toBe(start);
    }
  });
});

describe('the typed code', () => {
  const code = reduce(start, { type: 'start' });

  it('takes input and clears an old message', () => {
    const typed = run(code, { type: 'codeInput', input: 'abc' }, { type: 'codeSubmit' });
    expect(typed.view).toEqual({ ...CODE_VIEW, input: 'abc', error: 'format' });
    expect(reduce(typed, { type: 'codeInput', input: 'abcd' }).view).toEqual({ ...CODE_VIEW, input: 'abcd', error: null });
  });

  it('asks the server for a well-formed code, and holds the input meanwhile', () => {
    const asking = run(code, { type: 'codeInput', input: '7k3m-q9xd' }, { type: 'codeSubmit' });
    expect(asking.view).toEqual({ ...CODE_VIEW, input: '7k3m-q9xd', busy: true });
    expect(reduce(asking, { type: 'codeInput', input: 'x' })).toBe(asking);
    expect(reduce(asking, { type: 'codeSubmit' })).toBe(asking);
    expect(reduce(asking, { type: 'again', keep: true })).toBe(asking);
  });

  const asking = run(code, { type: 'codeInput', input: '7k3m-q9xd' }, { type: 'codeSubmit' });

  it('shows the form with the server’s key', () => {
    expect(reduce(asking, { type: 'codeAnswer', code: TARGET.code, result: ok({ tvPk: KEY, exp: 5 }) }).view).toEqual({ kind: 'form', target: TARGET, busy: false, error: null, retryAfterS: 0 });
  });

  it.each([
    [fail('gone'), { error: 'unknown', retryAfterS: 0 }],
    [limited, { error: 'limited', retryAfterS: 90 }],
    [fail('network'), { error: 'network', retryAfterS: 0 }],
    [fail('conflict'), { error: 'network', retryAfterS: 0 }],
  ] as const)('shows a refusal: %j', (result, shown) => {
    expect(reduce(asking, { type: 'codeAnswer', code: TARGET.code, result }).view).toEqual({ ...CODE_VIEW, input: '7k3m-q9xd', ...shown });
  });

  it('ignores an answer for another code, or when nothing was asked', () => {
    expect(reduce(asking, { type: 'codeAnswer', code: OTHER.code, result: ok({ tvPk: KEY, exp: 5 }) })).toBe(asking);
    const idle = run(code, { type: 'codeInput', input: '7k3m-q9xd' });
    expect(reduce(idle, { type: 'codeAnswer', code: TARGET.code, result: ok({ tvPk: KEY, exp: 5 }) })).toBe(idle);
  });
});

describe('the QR link', () => {
  const checking = reduce(start, { type: 'qr', target: TARGET });
  const answer = (event: PageEvent & { type: 'progressAnswer' }): View => reduce(checking, event).view;

  it('shows the form while the code is open, or when the progress can’t be read', () => {
    const form: View = { kind: 'form', target: TARGET, busy: false, error: null, retryAfterS: 0 };
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: ok({ state: 'open', exp: 1 }) })).toEqual(form);
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: fail('network') })).toEqual(form);
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: limited })).toEqual(form);
  });

  it('shows how far an earlier payload got', () => {
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: ok({ state: 'sent' }) })).toEqual({ kind: 'progress', code: TARGET.code, state: 'sent' });
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: ok({ state: 'received' }) })).toEqual({ kind: 'progress', code: TARGET.code, state: 'received' });
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: ok({ state: 'done', status: 'expired' }) })).toEqual({ kind: 'done', code: TARGET.code, status: 'expired' });
  });

  it('says an ended code has ended', () => {
    expect(answer({ type: 'progressAnswer', code: TARGET.code, result: fail('gone') })).toEqual({ ...CODE_VIEW, error: 'ended' });
  });

  it('ignores another code’s answer, and "again" while checking', () => {
    expect(reduce(checking, { type: 'progressAnswer', code: OTHER.code, result: fail('gone') })).toBe(checking);
    expect(reduce(checking, { type: 'again', keep: true })).toBe(checking);
  });
});

describe('the form', () => {
  it('keeps what is typed', () => {
    const typed = run(formState, { type: 'field', key: 'name', value: 'Salon' }, { type: 'sourceType', sourceType: 'm3u' }, { type: 'field', key: 'playlist', value: 'x' });
    expect(typed.type).toBe('m3u');
    expect(typed.values).toEqual({ ...EMPTY_VALUES, name: 'Salon', playlist: 'x' });
    expect(typed.problems).toEqual({});
  });

  it('adds, edits and removes guide links: one to four fields', () => {
    let s = run(formState, { type: 'epg', index: 0, value: 'a' }, { type: 'addEpg' }, { type: 'epg', index: 1, value: 'b' }, { type: 'addEpg' }, { type: 'addEpg' });
    expect(s.values.epg).toEqual(['a', 'b', '', '']);
    expect(reduce(s, { type: 'addEpg' })).toBe(s);
    expect(reduce(s, { type: 'epg', index: 4, value: 'x' })).toBe(s);
    expect(reduce(s, { type: 'epg', index: -1, value: 'x' })).toBe(s);
    expect(reduce(s, { type: 'removeEpg', index: 4 })).toBe(s);
    expect(reduce(s, { type: 'removeEpg', index: -1 })).toBe(s);
    s = run(s, { type: 'removeEpg', index: 0 }, { type: 'removeEpg', index: 1 });
    expect(s.values.epg).toEqual(['b', '']);
    s = run(s, { type: 'removeEpg', index: 0 }, { type: 'removeEpg', index: 0 });
    expect(s.values.epg).toEqual(['']);
  });

  it('shows the problems a send finds, and keeps them current', () => {
    const refused = run(formState, { type: 'field', key: 'server', value: 'example.com' }, { type: 'send' });
    expect(refused.showProblems).toBe(true);
    expect(refused.problems).toEqual({ username: 'required', password: 'required' });
    expect(refused.view).toEqual({ kind: 'form', target: TARGET, busy: false, error: null, retryAfterS: 0 });
    const fixing = reduce(refused, { type: 'field', key: 'username', value: 'u' });
    expect(fixing.problems).toEqual({ password: 'required' });
    expect(reduce(fixing, { type: 'sourceType', sourceType: 'm3u' }).problems).toEqual({ playlist: 'required' });
    expect(reduce(fixing, { type: 'addEpg' }).problems).toEqual({ password: 'required' });
    expect(run(fixing, { type: 'epg', index: 0, value: 'bad link' }).problems).toEqual({ password: 'required', epg0: 'spaces' });
  });

  it('sends a good form: busy, the problems gone, the fields held', () => {
    expect(sending.view).toEqual({ kind: 'form', target: TARGET, busy: true, error: null, retryAfterS: 0 });
    expect(sending.showProblems).toBe(false);
    for (const event of [{ type: 'send' }, { type: 'field', key: 'name', value: 'x' }, { type: 'epg', index: 0, value: 'x' }, { type: 'addEpg' }, { type: 'removeEpg', index: 0 }, { type: 'sourceType', sourceType: 'm3u' }, { type: 'again', keep: true }, { type: 'pickFile', file: FILE }] as PageEvent[]) {
      expect(reduce(sending, event)).toBe(sending);
    }
  });

  it('clears the problems once a send goes', () => {
    const refused = run(formState, { type: 'send' });
    const fixed = run(refused, { type: 'field', key: 'server', value: 'example.com' }, { type: 'field', key: 'username', value: 'u' }, { type: 'field', key: 'password', value: 'p' }, { type: 'send' });
    expect(fixed.problems).toEqual({});
    expect(fixed.showProblems).toBe(false);
    expect(fixed.view).toMatchObject({ kind: 'form', busy: true });
  });
});

describe('the file (RELAY step 31d1)', () => {
  const fileForm = run(formState, { type: 'sourceType', sourceType: 'file' });

  it('is chosen on the form, and a second choice replaces the first', () => {
    const chosen = reduce(fileForm, { type: 'pickFile', file: FILE });
    expect(chosen).toEqual({ ...fileForm, file: FILE });
    expect(reduce(chosen, { type: 'pickFile', file: OTHER_FILE }).file).toBe(OTHER_FILE);
    // Kept when another type is picked, and there when it comes back.
    expect(run(chosen, { type: 'sourceType', sourceType: 'm3u' }, { type: 'sourceType', sourceType: 'file' }).file).toBe(FILE);
  });

  it('shows its problems on a send, and keeps them current', () => {
    const refused = reduce(fileForm, { type: 'send' });
    expect(refused).toMatchObject({ showProblems: true, problems: { file: 'noFile' }, view: { busy: false } });
    const empty: PickedFile = { name: 'empty.m3u', size: 0, read: () => Promise.resolve(new Uint8Array(0)) };
    expect(reduce(refused, { type: 'pickFile', file: empty }).problems).toEqual({ file: 'empty' });
    expect(reduce(refused, { type: 'pickFile', file: FILE }).problems).toEqual({});
    expect(run(fileForm, { type: 'pickFile', file: FILE }, { type: 'send' })).toMatchObject({ problems: {}, view: { busy: true } });
  });

  it('is held while sending', () => {
    const busy = run(fileForm, { type: 'pickFile', file: FILE }, { type: 'send' });
    expect(reduce(busy, { type: 'pickFile', file: OTHER_FILE })).toBe(busy);
  });

  it('has to be chosen again when it couldn’t be read', () => {
    const busy = run(fileForm, { type: 'pickFile', file: FILE }, { type: 'send' });
    const unreadable = reduce(busy, { type: 'fileUnreadable', code: TARGET.code });
    expect(unreadable).toEqual({ ...busy, file: null, problems: { file: 'unreadable' }, showProblems: true, view: { ...busy.view, busy: false } });
    // Another code's, or one with nothing being sent: nothing changes.
    expect(reduce(busy, { type: 'fileUnreadable', code: OTHER.code })).toBe(busy);
    expect(reduce(fileForm, { type: 'fileUnreadable', code: TARGET.code })).toBe(fileForm);
    expect(reduce(unreadable, { type: 'pickFile', file: FILE }).problems).toEqual({});
  });

  it('stays to send again, and goes with "Add another source"', () => {
    const sent = run(fileForm, { type: 'pickFile', file: FILE }, { type: 'send' }, { type: 'sendAnswer', code: TARGET.code, result: ok({ state: 'done', status: 'unreachable' }) });
    expect(reduce(sent, { type: 'again', keep: true }).file).toBe(FILE);
    expect(reduce(sent, { type: 'again', keep: false }).file).toBeNull();
  });
});

describe('the send’s answer', () => {
  const answered = (result: ApiResult<PairProgressResponse>, code = TARGET.code): PageState => reduce(sending, { type: 'sendAnswer', code, result });

  it('shows the progress: sent now, or already sent', () => {
    expect(answered(ok({ state: 'sent' })).view).toEqual({ kind: 'progress', code: TARGET.code, state: 'sent' });
    expect(answered(fail('conflict')).view).toEqual({ kind: 'progress', code: TARGET.code, state: 'sent' });
    expect(answered(ok({ state: 'open', exp: 1 })).view).toEqual({ kind: 'progress', code: TARGET.code, state: 'sent' });
  });

  it('asks for a new code when this one ended, keeping the typed values', () => {
    const ended = answered(fail('gone'));
    expect(ended.view).toEqual({ ...CODE_VIEW, error: 'ended' });
    expect(ended.values).toEqual(filled.values);
  });

  it('shows a refusal on the form, ready to send again', () => {
    expect(answered(limited).view).toEqual({ kind: 'form', target: TARGET, busy: false, error: 'limited', retryAfterS: 90 });
    expect(answered(fail('network')).view).toEqual({ kind: 'form', target: TARGET, busy: false, error: 'network', retryAfterS: 0 });
    expect(run(answered(fail('network')), { type: 'send' }).view).toEqual({ kind: 'form', target: TARGET, busy: true, error: null, retryAfterS: 0 });
  });

  it('ignores an answer for another code, or when nothing was sent', () => {
    expect(answered(ok({ state: 'sent' }), OTHER.code)).toBe(sending);
    expect(reduce(filled, { type: 'sendAnswer', code: TARGET.code, result: ok({ state: 'sent' }) })).toBe(filled);
  });
});

describe('the progress', () => {
  const sent = reduce(sending, { type: 'sendAnswer', code: TARGET.code, result: ok({ state: 'sent' }) });
  const progress = (result: ApiResult<PairProgressResponse>, code = TARGET.code): PageState => reduce(sent, { type: 'progressAnswer', code, result });

  it('follows each state to the TV’s status', () => {
    expect(progress(ok({ state: 'received' })).view).toEqual({ kind: 'progress', code: TARGET.code, state: 'received' });
    for (const status of ['ok', 'auth_failed', 'expired', 'unreachable', 'blocked'] as const) {
      expect(progress(ok({ state: 'done', status })).view).toEqual({ kind: 'done', code: TARGET.code, status });
    }
  });

  it('keeps showing on an open answer or a failed read', () => {
    expect(progress(ok({ state: 'open', exp: 1 }))).toEqual(sent);
    expect(progress(fail('network'))).toBe(sent);
    expect(progress(limited)).toBe(sent);
  });

  it('says to check the TV when the code’s row is gone', () => {
    expect(progress(fail('gone')).view).toEqual({ kind: 'lost', code: TARGET.code });
  });

  it('ignores another code’s answer, and answers after the result', () => {
    expect(progress(ok({ state: 'received' }), OTHER.code)).toBe(sent);
    const done = progress(ok({ state: 'done', status: 'ok' }));
    expect(reduce(done, { type: 'progressAnswer', code: TARGET.code, result: fail('gone') })).toBe(done);
  });

  it('goes back to the code: values kept to fix them, or cleared for another source', () => {
    const done = run(progress(ok({ state: 'done', status: 'auth_failed' })), { type: 'lang', lang: 'ar' });
    const fix = reduce(done, { type: 'again', keep: true });
    expect(fix).toEqual({ ...done, view: CODE_VIEW, problems: {}, showProblems: false });
    const typedM3u = run(formState, { type: 'sourceType', sourceType: 'm3u' }, { type: 'field', key: 'playlist', value: 'a.example' }, { type: 'send' });
    const another = run(typedM3u, { type: 'sendAnswer', code: TARGET.code, result: ok({ state: 'done', status: 'ok' }) }, { type: 'again', keep: false });
    expect(another).toEqual({ ...initialState('en'), view: CODE_VIEW });
    expect(reduce(progress(fail('gone')), { type: 'again', keep: true }).view).toEqual(CODE_VIEW);
  });
});

describe('the language', () => {
  it('changes in any view and keeps everything else', () => {
    for (const state of [start, formState, filled, sending]) {
      expect(reduce(state, { type: 'lang', lang: 'ar' })).toEqual({ ...state, lang: 'ar' });
    }
  });
});
