import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { backupKeys, deriveBackupMaster, readBackupCode } from '@lablo/crypto';
import { parse } from 'acorn';
import { afterEach, describe, expect, it } from 'vitest';
import type { StartState } from './backup-walk';
import { WELCOME_TITLES, backupSteps } from './backup-walk';
import type { CodeRun, CodeState, CodeStep, CodeStepRecord, CodeView, CodeWalk } from './code-walk';
import {
  CLEAR_KEYS,
  CODE_ALPHABET,
  CODE_EXPRESSION,
  CODE_INPUT,
  CODE_KV,
  CODE_PLATFORM,
  CODE_READ_EXPRESSION,
  CODE_READ_RESULT,
  CODE_REQUESTS,
  CODE_ROW,
  CODE_TEXT,
  CODE_VIEW_FUNCTION,
  codeFirstSteps,
  codeGroups,
  codeLookupId,
  codeMatches,
  codeRestoreSteps,
  codeStepLanded,
  codeSummary,
  codeWalkUrl,
  describeCode,
  describeCodeExpectation,
  evaluateCodeRun,
  evaluateCodeWalk,
  mistyped,
  restartedUrl,
  tizenAppId,
  typedCode,
} from './code-walk';
import { LIVE_TEXT } from './live';
import { WALK_EXPRESSION } from './onboarding';
import type { WalkCheck, WalkLanguage, WalkState } from './onboarding';
import { PHONE_NAMES } from './pairing';

/** The backup code on the old engines (RELAY step 32d3d): the steps, the probes and the evaluation. */

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';
/** A code the TV could have made (26 characters of the alphabet, the first 0 to 7). */
const CODE = '3F7KQ9XM2HD8VBN4T6WCRY1PAG';
const LOOKUP = 'L'.repeat(43);
const MISTYPED_LOOKUP = 'M'.repeat(43);
const URL = 'file:///app/app/tizen/index.html?keyboard=native&api=http%3A%2F%2F127.0.0.1%3A8091';

/** A fixture of two channels, one category each, no guide. */
const CATEGORIES: WalkCheck['categories'] = [
  { name: 'News', allStart: 0, channels: [{ name: 'News', tvgId: 'news', guide: false, catchup: 0 }] },
  { name: 'Films', allStart: 1, channels: [{ name: 'Films', tvgId: 'films', guide: false, catchup: 0 }] },
];

/** The live screen as it shows after "Welcome back": "All channels", the first channel, its rows as `CATEGORIES` says. */
function liveState(over: Partial<WalkState> = {}, language: WalkLanguage = 'en'): WalkState {
  const ar = language === 'ar';
  const all = LIVE_TEXT[language].all;
  const noGuide = LIVE_TEXT[language].noGuide;
  return {
    userAgent: UA,
    live: true,
    liveIdle: true,
    screen: 'live',
    zone: 'channels',
    index: 0,
    language,
    dir: ar ? 'rtl' : 'ltr',
    category: 0,
    top: 0,
    heading: all,
    liveCount: 2,
    railSide: ar ? 'right' : 'left',
    chips: [
      { i: 0, label: all, count: '2', selected: true },
      { i: 1, label: 'News', count: '1', selected: false },
      { i: 2, label: 'Films', count: '1', selected: false },
    ],
    rows: [
      { i: 0, number: '1', name: 'News', now: null, nowText: noGuide, next: null },
      { i: 1, number: '2', name: 'Films', now: null, nowText: noGuide, next: null },
    ],
    clock: 0,
    ...over,
  } as WalkState;
}

function view(over: Partial<CodeView> = {}): CodeView {
  return { phase: 'typing', problem: '', notice: '', value: '', dir: 'ltr', direction: 'ltr', title: CODE_TEXT.en.title, noticeText: null, ...over };
}

/** A page on the code screen at `path`, measured, every font settled. */
function codeState(path: string, over: Partial<CodeState> = {}): CodeState {
  const [screen, zone, index] = path.split('/');
  return {
    href: URL,
    stale: false,
    userAgent: UA,
    bootError: '',
    onboarding: true,
    live: false,
    liveIdle: false,
    guide: false,
    movies: false,
    screen: screen!,
    zone: zone!,
    index: Number(index),
    editing: '',
    active: 'BODY',
    language: 'en',
    dir: 'ltr',
    hook: path,
    value: null,
    phase: null,
    error: null,
    viewport: [1920, 1080],
    scroll: [1920, 1080],
    outside: [],
    cut: [],
    fontsStatus: 'loaded',
    fonts: null,
    code: view(),
    ...over,
  } as CodeState;
}

function welcomeState(over: Partial<StartState> = {}): StartState {
  return {
    href: restartedUrl(URL),
    stale: false,
    bootError: '',
    screen: 'welcome',
    zone: 'actions',
    index: 0,
    language: 'en',
    dir: 'ltr',
    sources: 1,
    title: WELCOME_TITLES.en,
    onboarding: false,
    live: false,
    outside: [],
    cut: [],
    ...over,
  };
}

const record = (step: CodeStep, state: CodeState | null = codeState('restore-code/field/0')): CodeStepRecord => ({
  id: step.id,
  label: step.label,
  expect: step.expect,
  code: step.code ?? null,
  layout: step.layout ?? null,
  met: true,
  state,
  ms: 100,
});

function walk(over: Partial<CodeWalk> = {}): CodeWalk {
  const language = over.language ?? 'en';
  return {
    language,
    reset: 'ok',
    steps: codeFirstSteps(language).map((step) => record(step, codeState('live/channels/0', { code: null }))),
    phoneError: null,
    upload: 'sent',
    kept: { code: CODE },
    lookupIds: { code: LOOKUP, mistyped: MISTYPED_LOOKUP },
    wipe: 'ok',
    after: codeRestoreSteps(language, CODE).map((step) => record(step)),
    opening: view({ phase: 'restoring', value: null, dir: null, direction: null, title: CODE_TEXT[language].opening }),
    answer: null,
    welcome: welcomeState({ language, dir: language === 'ar' ? 'rtl' : 'ltr', title: WELCOME_TITLES[language] }),
    restored: liveState({}, language),
    noneMs: 1200,
    welcomeMs: 2100,
    liveMs: 7900,
    requests: [...CODE_REQUESTS],
    requestIds: [LOOKUP, LOOKUP, MISTYPED_LOOKUP, LOOKUP],
    profile: { sources: [['s1', 'm3u', PHONE_NAMES[language]]], language, consent: false },
    keptAfter: { code: CODE },
    screenshots: [],
    screenshotError: null,
    ...over,
  };
}

describe('the plain Tizen build', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function variant(config: string | null): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-code-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'tizen'), { recursive: true });
    if (config !== null) writeFileSync(path.join(dir, 'tizen', 'config.xml'), config);
    return dir;
  }

  it('opens the Tizen build with its API on the forwarded port of the device itself', () => {
    expect(CODE_PLATFORM).toBe('tizen');
    expect(codeWalkUrl('app')).toBe(URL);
  });

  it("knows where the app starts again after a restore: restored=1 first, the rest of the query after it", () => {
    expect(restartedUrl(URL)).toBe('file:///app/app/tizen/index.html?restored=1&keyboard=native&api=http%3A%2F%2F127.0.0.1%3A8091');
    expect(restartedUrl('file:///app/app/tizen/index.html')).toBe('file:///app/app/tizen/index.html?restored=1');
  });

  it("reads the app id from the staged config.xml (the salt's __APP_ID__)", () => {
    expect(tizenAppId(variant('<widget><tizen:application  id="Pkg1234567.App" package="Pkg1234567"/></widget>'))).toBe('Pkg1234567.App');
    expect(tizenAppId(variant('<widget>\n  <tizen:application\n    id="LabloIPTV1.Lablo" package="LabloIPTV1"/></widget>'))).toBe('LabloIPTV1.Lablo');
  });

  it('refuses a variant with no Tizen build, and a build with no app id', () => {
    expect(() => tizenAppId(variant(null))).toThrow(/tizen has no config\.xml: stage the variant first/);
    expect(() => tizenAppId(variant('<widget><tizen:application package="P"/></widget>'))).toThrow(/has no <tizen:application id="…">/);
    expect(() => tizenAppId(variant('<widget><tizen:application id="" package="P"/></widget>'))).toThrow(/has no <tizen:application id="…">/);
  });
});

describe('the code', () => {
  it('is a code the TV could have made', () => {
    expect(readBackupCode(CODE)).toBe(CODE);
  });

  it('draws in groups of four, which Backspace empties in at most CLEAR_KEYS presses', () => {
    expect(codeGroups(CODE)).toBe('3F7K Q9XM 2HD8 VBN4 T6WC RY1P AG');
    expect(codeGroups(CODE)).toHaveLength(CLEAR_KEYS);
    expect(codeGroups('ABCD')).toBe('ABCD');
    expect(codeGroups('ABCDE')).toBe('ABCD E');
  });

  it('is typed in lower case with spaces, which the app reads as the code', () => {
    expect(typedCode(CODE)).toBe('3f7k q9xm 2hd8 vbn4 t6wc ry1p ag');
    expect(readBackupCode(typedCode(CODE))).toBe(CODE);
  });

  it('is mistyped in its last character only, into another code', () => {
    const wrong = mistyped(CODE);
    expect(wrong).toBe('3F7KQ9XM2HD8VBN4T6WCRY1PAH');
    expect(readBackupCode(wrong)).toBe(wrong);
    // Past the alphabet's end: round to its start.
    expect(mistyped('3F7KQ9XM2HD8VBN4T6WCRY1PAZ')).toBe('3F7KQ9XM2HD8VBN4T6WCRY1PA0');
    // Over the letters a code has no place for (I, L, O, U).
    expect(mistyped('3F7KQ9XM2HD8VBN4T6WCRY1PAH')).toBe('3F7KQ9XM2HD8VBN4T6WCRY1PAJ');
    expect(mistyped('3F7KQ9XM2HD8VBN4T6WCRY1PAT')).toBe('3F7KQ9XM2HD8VBN4T6WCRY1PAV');
  });

  it("has Crockford's alphabet: every character a code's tail can hold, and nothing else", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    for (const char of CODE_ALPHABET) expect(readBackupCode(`0${char.repeat(25)}`), char).toBe(`0${char.repeat(25)}`);
    for (const char of 'ILOU') expect(CODE_ALPHABET).not.toContain(char);
  });

  it('derives the lookup ID the app derives from a code on the Tizen build', async () => {
    const want = backupKeys(await deriveBackupMaster(CODE, 'tizen', 'LabloIPTV1.Lablo')).lookupId;
    expect(await codeLookupId(CODE, 'LabloIPTV1.Lablo')).toBe(want);
    expect(await codeLookupId(mistyped(CODE), 'LabloIPTV1.Lablo')).not.toBe(want);
    expect(await codeLookupId(CODE, 'com.lablo.iptv')).not.toBe(want);
  });
});

describe('the steps', () => {
  const keys = (steps: readonly CodeStep[]): string[] =>
    steps.flatMap((s) => [...(s.navigate === true ? ['(start)'] : []), ...(s.keys ?? []).map((k) => k.key), ...(s.type === undefined ? [] : [`"${s.type}"`])]);

  it('walks onboarding by phone as the wipe walk does, with "Not now" for "Allow"', () => {
    for (const language of ['en', 'ar'] as const) {
      const steps = codeFirstSteps(language);
      const backup = backupSteps(language);
      const at = backup.findIndex((s) => s.id === 'consent');
      expect(steps.slice(0, at)).toEqual(backup.slice(0, at));
      expect(steps.slice(at + 2)).toEqual(backup.slice(at + 1));
      expect(steps.slice(at, at + 2)).toEqual([
        { id: 'not-now', label: `${language === 'ar' ? 'ArrowLeft' : 'ArrowRight'} to "Not now"`, keys: [{ key: language === 'ar' ? 'ArrowLeft' : 'ArrowRight', keyCode: language === 'ar' ? 37 : 39 }], expect: { screen: 'consent', zone: 'actions', index: 1 }, wait: 'key' },
        { id: 'consent', label: 'OK on "Not now"', keys: [{ key: 'Enter', keyCode: 13 }], expect: { screen: 'source', zone: 'types', index: 0 }, wait: 'key' },
      ]);
    }
    expect(keys(codeFirstSteps('en'))).toEqual(['(start)', 'Enter', 'Enter', 'ArrowRight', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter', 'Enter']);
    expect(keys(codeFirstSteps('ar'))).toEqual(['(start)', 'ArrowRight', 'Enter', 'Enter', 'ArrowLeft', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter', 'Enter']);
  });

  it('after the wipe: onboarding to "Use a backup code", the mistyped code, then the real one typed', () => {
    const wrong = '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH';
    const clear = Array<string>(CLEAR_KEYS).fill('Backspace');
    expect(keys(codeRestoreSteps('en', CODE))).toEqual([
      '(start)', 'Enter', 'Enter', 'ArrowRight', 'Enter',
      'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter',
      'Enter', `"${wrong}"`, 'Enter', 'Enter',
      'Enter', ...clear, '"3f7k q9xm 2hd8 vbn4 t6wc ry1p ag"', 'Enter',
    ]);
    expect(keys(codeRestoreSteps('ar', CODE))).toEqual([
      '(start)', 'ArrowRight', 'Enter', 'Enter', 'ArrowLeft', 'Enter',
      'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter',
      'Enter', `"${wrong}"`, 'Enter', 'Enter',
      'Enter', ...clear, '"3f7k q9xm 2hd8 vbn4 t6wc ry1p ag"', 'Enter',
    ]);
    expect(codeRestoreSteps('ar', CODE).map((s) => s.id)).toEqual([
      'restart', 'pick-arabic', 'language', 'disclaimer', 'not-now', 'consent', 'to-code', 'code', 'open-field', 'type-wrong', 'end-wrong', 'wrong', 'reopen', 'clear', 'type', 'end-edit',
    ]);
  });

  it('starts again at the language screen, then answers as before the wipe', () => {
    const steps = codeRestoreSteps('en', CODE);
    expect(steps[0]).toEqual({ ...codeFirstSteps('en')[0], id: 'restart', label: 'the start after the wipe' });
    expect(steps[0]!.expect).toEqual({ onboarding: true, screen: 'language', zone: 'languages', index: 0, language: 'en' });
    expect(steps.slice(1, 5)).toEqual(codeFirstSteps('en').slice(1, 5));
  });

  it('expects each place on the code screen, and what it draws', () => {
    for (const language of ['en', 'ar'] as const) {
      const steps = Object.fromEntries(codeRestoreSteps(language, CODE).map((s) => [s.id, s]));
      const editing = { screen: 'restore-code', zone: 'field', index: 0, editing: CODE_INPUT, active: CODE_INPUT };
      const onRestore = { screen: 'restore-code', zone: 'actions', index: 0, editing: '', active: 'BODY' };
      expect(steps['to-code']).toMatchObject({ expect: { screen: 'source', zone: 'types', index: CODE_ROW }, layout: 'source', wait: 'key' });
      expect(steps['code']).toMatchObject({ expect: { screen: 'restore-code', zone: 'field', index: 0, editing: '' }, code: { phase: 'typing', value: '', title: CODE_TEXT[language].title, dir: 'ltr' }, layout: 'restore-code' });
      expect(steps['open-field']).toMatchObject({ expect: editing });
      expect(steps['type-wrong']).toMatchObject({ type: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH', expect: editing, code: { value: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH' } });
      expect(steps['end-wrong']).toMatchObject({ expect: onRestore, code: { value: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH', problem: '' } });
      expect(steps['wrong']).toEqual({
        id: 'wrong',
        label: 'OK on "Restore" with the mistyped code',
        keys: [{ key: 'Enter', keyCode: 13 }],
        expect: { screen: 'restore-code', zone: 'field', index: 0, editing: '' },
        code: { phase: 'typing', problem: '', notice: 'none', noticeText: CODE_TEXT[language].none, value: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH' },
        layout: 'restore-code',
        shot: 'none',
        wait: 'load',
      });
      expect(steps['reopen']).toMatchObject({ expect: editing, code: { value: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH' } });
      expect(steps['clear']).toMatchObject({ label: 'Backspace 32 times', expect: editing, code: { value: '', notice: '' } });
      expect(steps['type']).toMatchObject({ expect: editing, code: { value: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AG' } });
      expect(steps['end-edit']).toEqual({
        id: 'end-edit',
        label: 'OK (key 13) in the field',
        keys: [{ key: 'Enter', keyCode: 13 }],
        expect: onRestore,
        code: { phase: 'typing', problem: '', notice: '', value: '3F7K Q9XM 2HD8 VBN4 T6WC RY1P AG', dir: 'ltr', direction: 'ltr', title: CODE_TEXT[language].title },
        layout: 'restore-code',
        shot: 'typed',
        wait: 'key',
      });
    }
  });

  it('waits a key for each step but the answer, which waits for scrypt and the look-up', () => {
    const steps = codeRestoreSteps('en', CODE);
    expect(steps.filter((s) => s.wait !== 'key').map((s) => `${s.id} ${s.wait}`)).toEqual(['restart boot', 'wrong load']);
    expect(steps.filter((s) => s.shot !== undefined).map((s) => s.shot)).toEqual(['none', 'typed']);
  });
});

describe('the probes', () => {
  it.each([
    ['CODE_EXPRESSION', CODE_EXPRESSION],
    ['CODE_READ_EXPRESSION', CODE_READ_EXPRESSION],
    ['CODE_READ_RESULT', CODE_READ_RESULT],
  ])('%s is plain ES5, so it runs on every engine', (_name, expression) => {
    expect(() => parse(expression, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it("reads the onboarding walk's state, with the code screen in it", () => {
    expect(CODE_EXPRESSION).toContain(`var state = JSON.parse(${WALK_EXPRESSION});`);
    expect(CODE_EXPRESSION).toContain('state.code = codeView();');
  });

  type Attrs = Record<string, string>;
  const el = (attributes: Attrs, text = '', extra: Record<string, unknown> = {}) => ({ textContent: text, getAttribute: (name: string) => attributes[name] ?? null, ...extra });

  /** `codeView()` on a page holding `parts` (by test id) and `input` (by its DOM id). */
  function codeView(page: { root?: ReturnType<typeof el>; title?: ReturnType<typeof el>; notice?: ReturnType<typeof el>; input?: { value: string; dir: string; direction: string } }): unknown {
    const root = page.root === undefined ? null : { ...page.root, querySelector: (selector: string) => (selector === '[data-testid="onboarding-title"]' ? (page.title ?? null) : selector === '[data-testid="restore-notice"]' ? (page.notice ?? null) : null) };
    const input = page.input === undefined ? null : { value: page.input.value, getAttribute: (name: string) => (name === 'dir' ? page.input!.dir : null), direction: page.input.direction };
    const document = {
      querySelector: (selector: string) => (selector === '[data-testid="restore-code"]' ? root : null),
      getElementById: (id: string) => (id === CODE_INPUT ? input : null),
    };
    const getComputedStyle = (target: { direction: string }) => ({ direction: target.direction });
    return JSON.parse(String(runInNewContext(`(function () { ${CODE_VIEW_FUNCTION} return JSON.stringify(codeView()); })()`, { document, getComputedStyle, JSON })));
  }

  it('reads the code screen: its phase, problem and answer, the field, its direction, the title and the answer text', () => {
    const state = codeView({
      root: el({ 'data-phase': 'typing', 'data-problem': 'length', 'data-notice': 'none' }),
      title: el({}, CODE_TEXT.ar.title),
      notice: el({}, CODE_TEXT.ar.none),
      // (Its computed direction, not its attribute: a stylesheet could turn it.)
      input: { value: 'ABCD EF', dir: 'ltr', direction: 'rtl' },
    });
    expect(state).toEqual({ phase: 'typing', problem: 'length', notice: 'none', value: 'ABCD EF', dir: 'ltr', direction: 'rtl', title: CODE_TEXT.ar.title, noticeText: CODE_TEXT.ar.none });
    // A field that lost its dir="ltr" says so.
    expect(codeView({ root: el({ 'data-phase': 'typing' }), input: { value: '', dir: 'rtl', direction: 'rtl' } })).toMatchObject({ dir: 'rtl', direction: 'rtl' });
  });

  it('reads the screen while restoring (no field, no answer), and nothing on a page without it', () => {
    expect(codeView({ root: el({ 'data-phase': 'restoring', 'data-problem': '', 'data-notice': '' }), title: el({}, CODE_TEXT.en.opening) })).toEqual({
      phase: 'restoring',
      problem: '',
      notice: '',
      value: null,
      dir: null,
      direction: null,
      title: CODE_TEXT.en.opening,
      noticeText: null,
    });
    expect(codeView({ input: { value: 'x', dir: 'ltr', direction: 'ltr' } })).toBeNull();
  });

  /** A database `lablo` whose `kv` holds `value` under `backup.code`; `fail` breaks one part. */
  async function readCode(value: unknown, fail: 'open' | 'transaction' | 'get' | null = null): Promise<{ result: unknown; asked: string[]; closed: boolean }> {
    const asked: string[] = [];
    let closed = false;
    const db = {
      transaction(store: string) {
        asked.push(`transaction ${store}`);
        if (fail === 'transaction') throw Object.assign(new Error('x'), { name: 'NotFoundError' });
        return {
          objectStore(name: string) {
            asked.push(`store ${name}`);
            return {
              get(key: string) {
                asked.push(`get ${key}`);
                const request: Record<string, unknown> = { result: value, error: fail === 'get' ? { name: 'DataError' } : null };
                setTimeout(() => (fail === 'get' ? (request['onerror'] as () => void)() : (request['onsuccess'] as () => void)()), 0);
                return request;
              },
            };
          },
        };
      },
      close() {
        closed = true;
      },
    };
    const indexedDB = {
      open(name: string) {
        asked.push(`open ${name}`);
        const request: Record<string, unknown> = { result: db, error: fail === 'open' ? { name: 'UnknownError' } : null };
        setTimeout(() => (fail === 'open' ? (request['onerror'] as () => void)() : (request['onsuccess'] as () => void)()), 0);
        return request;
      },
    };
    const window: Record<string, unknown> = {};
    expect(JSON.parse(String(runInNewContext(CODE_READ_EXPRESSION, { window, indexedDB, JSON, String })))).toBe('reading');
    // (Its answer comes two tasks on: the open's, then the read's.)
    for (let i = 0; i < 50 && window['__labloCode'] == null; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    return { result: JSON.parse(String(runInNewContext(CODE_READ_RESULT, { window }))), asked, closed };
  }

  it("reads the code from the app's own database, its kv store and key, and closes it", async () => {
    expect(CODE_KV).toEqual({ store: 'kv', key: 'backup.code' });
    expect(await readCode(CODE)).toEqual({ result: { code: CODE }, asked: ['open lablo', 'transaction kv', 'store kv', 'get backup.code'], closed: true });
  });

  it('says what the database holds when it is not a code, or what failed', async () => {
    expect((await readCode(undefined)).result).toEqual({ code: null, error: 'kv holds no code' });
    expect((await readCode(42)).result).toEqual({ code: null, error: 'kv holds number' });
    expect((await readCode(null)).result).toEqual({ code: null, error: 'kv holds object' });
    expect(await readCode(CODE, 'open')).toEqual({ result: { code: null, error: 'UnknownError' }, asked: ['open lablo'], closed: false });
    expect(await readCode(CODE, 'transaction')).toMatchObject({ result: { code: null, error: 'NotFoundError' }, closed: true });
    expect(await readCode(CODE, 'get')).toMatchObject({ result: { code: null, error: 'DataError' }, closed: true });
  });

  it('reads nothing before a read started', () => {
    expect(runInNewContext(CODE_READ_RESULT, { window: {} })).toBeNull();
  });
});

describe('a step landing', () => {
  const steps = Object.fromEntries(codeRestoreSteps('en', CODE).map((s) => [s.id, s]));

  it('matches every mark the step gives of the code screen, and only those', () => {
    expect(codeMatches(undefined, null)).toBe(true);
    expect(codeMatches({}, view())).toBe(true);
    expect(codeMatches({ value: '' }, null)).toBe(false);
    expect(codeMatches({ value: '', phase: 'typing' }, view())).toBe(true);
    expect(codeMatches({ value: '', phase: 'typing' }, view({ phase: 'restoring' }))).toBe(false);
    expect(codeMatches({ notice: 'none' }, view({ notice: '' }))).toBe(false);
  });

  it('lands where the focus, the edit and the code screen all are as the step says', () => {
    const wrong = steps['wrong']!;
    const answered = codeState('restore-code/field/0', { code: view({ notice: 'none', noticeText: CODE_TEXT.en.none, value: codeGroups(mistyped(CODE)) }) });
    expect(codeStepLanded(wrong, answered)).toBe(true);
    // Still restoring, on "Cancel".
    expect(codeStepLanded(wrong, codeState('restore-code/actions/0', { code: view({ phase: 'restoring' }) }))).toBe(false);
    // The focus back on the field, but the answer not drawn yet.
    expect(codeStepLanded(wrong, { ...answered, code: view({ value: codeGroups(mistyped(CODE)) }) })).toBe(false);
    // The focus engine elsewhere than the screen draws.
    expect(codeStepLanded(wrong, { ...answered, hook: 'restore-code/actions/0' })).toBe(false);
    // The fonts still loading on a measured screen.
    expect(codeStepLanded(wrong, { ...answered, fontsStatus: 'loading' })).toBe(false);
    // A step without code marks needs no code screen.
    expect(codeStepLanded(steps['to-code']!, codeState('source/types/3', { code: null }))).toBe(true);
  });

  it('says what the code screen shows and what a step wanted of it', () => {
    expect(describeCode(null)).toBe('no code screen');
    expect(describeCode(view({ notice: 'none', noticeText: 'No backup', value: 'ABCD' }))).toBe(
      `the code screen: phase typing, problem "", notice "none", the field "ABCD", dir="ltr" (ltr), title "${CODE_TEXT.en.title}", answer "No backup"`,
    );
    expect(describeCode(view({ phase: 'restoring', value: null, dir: null, direction: null, title: null }))).toBe('the code screen: phase restoring, problem "", notice "", the field -');
    expect(describeCode(view({ phase: null, problem: null, notice: null, direction: null }))).toBe(`the code screen: phase -, problem -, notice -, the field "", dir="ltr" (-), title "${CODE_TEXT.en.title}"`);
    expect(describeCodeExpectation(undefined)).toBe('');
    expect(describeCodeExpectation({ notice: 'none', value: 'AB' })).toBe('notice "none", value "AB"');
  });
});

describe('evaluateCodeWalk', () => {
  it('passes a walk whose code brought the sources back, in both languages', () => {
    expect(evaluateCodeWalk(walk(), CATEGORIES)).toEqual([]);
    expect(evaluateCodeWalk(walk({ language: 'ar' }), CATEGORIES)).toEqual([]);
    // "Opening your backup…" may be over before the probe reads it.
    expect(evaluateCodeWalk(walk({ opening: null }), CATEGORIES)).toEqual([]);
  });

  it('stops at a database it could not reset, the first step that did not land, or the phone', () => {
    expect(evaluateCodeWalk(walk({ reset: 'blocked' }), CATEGORIES)).toEqual(["the app's database could not be deleted before the walk (blocked)"]);
    const steps = walk().steps.map((s) => (s.id === 'not-now' ? { ...s, met: false, state: codeState('consent/actions/0', { code: null }) } : s));
    expect(evaluateCodeWalk(walk({ steps }), CATEGORIES)).toEqual(['"ArrowRight to "Not now"" did not land: expected consent · actions 1, at consent · actions 0, no DOM focus, language en, dir="ltr"']);
    const unread = walk().steps.map((s) => (s.id === 'watch' ? { ...s, met: false, state: null } : s));
    expect(evaluateCodeWalk(walk({ steps: unread }), CATEGORIES)).toEqual([
      '"OK on "Start watching"" did not land: expected the live screen, its data requests answered, live · channels 0, language en, dir="ltr", at nothing',
    ]);
    expect(evaluateCodeWalk(walk({ phoneError: 'the stand-in has no session' }), CATEGORIES)).toEqual(['the phone: the stand-in has no session']);
  });

  it('wants the upload sent, the code read and the wipe done', () => {
    expect(evaluateCodeWalk(walk({ upload: null }), CATEGORIES)).toEqual(['the walk stopped before the upload']);
    expect(evaluateCodeWalk(walk({ upload: 'held' }), CATEGORIES)).toEqual(['the upload answered "held", expected "sent"']);
    expect(evaluateCodeWalk(walk({ kept: null }), CATEGORIES)).toEqual(["the backup code could not be read from the app's database"]);
    expect(evaluateCodeWalk(walk({ kept: { code: null, error: 'kv holds no code' } }), CATEGORIES)).toEqual(["the backup code could not be read from the app's database (kv holds no code)"]);
    expect(evaluateCodeWalk(walk({ kept: { code: 'not a code' } }), CATEGORIES)).toEqual(['the app\'s database holds "not a code", not a backup code']);
    // As the TV made it, not merely readable as one.
    expect(evaluateCodeWalk(walk({ kept: { code: CODE.toLowerCase() } }), CATEGORIES)).toEqual([`the app's database holds "${CODE.toLowerCase()}", not a backup code`]);
    expect(evaluateCodeWalk(walk({ lookupIds: null }), CATEGORIES)).toEqual(['the walk stopped before deriving the lookup IDs']);
    expect(evaluateCodeWalk(walk({ wipe: 'blocked' }), CATEGORIES)).toEqual(["the wipe could not delete the app's database (blocked)"]);
    expect(evaluateCodeWalk(walk({ wipe: null }), CATEGORIES)).toEqual(["the wipe could not delete the app's database (not tried)"]);
  });

  it('says where the walk after the wipe stopped: onboarding where the code screen should be, or the mistyped code with no answer', () => {
    const onboarding = walk().after.map((s) => (s.id === 'restart' ? { ...s, met: false, state: codeState('live/channels/0', { onboarding: false, live: true, liveIdle: true, code: null }) } : s));
    expect(evaluateCodeWalk(walk({ after: onboarding }), CATEGORIES)).toEqual([
      'after the wipe: "the start after the wipe" did not land: expected language · languages 0, language en, at the live screen, live · channels 0, category -, rows from -, no DOM focus, language en, dir="ltr"',
    ]);
    const noAnswer = walk().after.map((s) => (s.id === 'wrong' ? { ...s, met: false, state: codeState('restore-code/actions/0', { code: view({ phase: 'restoring', value: null, dir: null, direction: null, title: CODE_TEXT.en.opening }) }) } : s));
    expect(evaluateCodeWalk(walk({ after: noAnswer }), CATEGORIES)).toEqual([
      `after the wipe: "OK on "Restore" with the mistyped code" did not land: expected restore-code · field 0, no edit; phase "typing", problem "", notice "none", noticeText "${CODE_TEXT.en.none}", value "3F7K Q9XM 2HD8 VBN4 T6WC RY1P AH", at restore-code · actions 0, no DOM focus, language en, dir="ltr"; the code screen: phase restoring, problem "", notice "", the field -, title "${CODE_TEXT.en.opening}"`,
    ]);
    // A step without code marks says nothing of the code screen.
    const toCode = walk().after.map((s) => (s.id === 'to-code' ? { ...s, met: false, state: codeState('source/types/2', { code: null }) } : s));
    expect(evaluateCodeWalk(walk({ after: toCode }), CATEGORIES)).toEqual(['after the wipe: "ArrowDown three times to "Use a backup code"" did not land: expected source · types 3, at source · types 2, no DOM focus, language en, dir="ltr"']);
  });

  it('measures each measured screen before and after the wipe', () => {
    const cutAfter = walk().after.map((s) => (s.id === 'end-edit' ? { ...s, state: codeState('restore-code/actions/0', { cut: ['z-button__label: Restore'] }) } : s));
    expect(evaluateCodeWalk(walk({ after: cutAfter }), CATEGORIES)).toEqual(['on the restore-code screen: labels cut: z-button__label: Restore']);
    const outside = walk().after.map((s) => (s.id === 'to-code' ? { ...s, state: codeState('source/types/3', { outside: ['z-button: Use a backup code'] }) } : s));
    expect(evaluateCodeWalk(walk({ after: outside }), CATEGORIES)).toEqual(['on the source screen: outside the safe area: z-button: Use a backup code']);
    // An unmeasured step's state isn't measured.
    const unmeasured = walk().after.map((s) => (s.id === 'clear' ? { ...s, state: codeState('restore-code/field/0', { cut: ['x: y'] }) } : s));
    expect(evaluateCodeWalk(walk({ after: unmeasured }), CATEGORIES)).toEqual([]);
    const before = walk().steps.map((s, i): CodeStepRecord => (i === 0 ? { ...s, layout: 'live', state: codeState('live/channels/0', { scroll: [1920, 1200], code: null }) } : s));
    expect(evaluateCodeWalk(walk({ steps: before }), CATEGORIES)).toEqual(['on the live screen: the page scrolls: it is 1920x1200']);
  });

  it('checks "Opening your backup…" when it showed', () => {
    expect(evaluateCodeWalk(walk({ opening: view({ phase: 'restoring', title: 'Restoring' }) }), CATEGORIES)).toEqual([`while restoring the title reads "Restoring", expected "${CODE_TEXT.en.opening}"`]);
    expect(evaluateCodeWalk(walk({ language: 'ar', opening: view({ phase: 'restoring', title: CODE_TEXT.en.opening }) }), CATEGORIES)).toEqual([`while restoring the title reads "${CODE_TEXT.en.opening}", expected "${CODE_TEXT.ar.opening}"`]);
    expect(evaluateCodeWalk(walk({ opening: view({ phase: 'restoring', title: null }) }), CATEGORIES)).toEqual([`while restoring the title reads -, expected "${CODE_TEXT.en.opening}"`]);
  });

  it('says why the app never started again after the real code', () => {
    const none = codeState('restore-code/field/0', { code: view({ notice: 'none', noticeText: CODE_TEXT.en.none, value: codeGroups(CODE) }) });
    expect(evaluateCodeWalk(walk({ welcome: null, answer: none, restored: null }), CATEGORIES)).toEqual([
      `after "Restore" with the code the app never started again: the code screen: phase typing, problem "", notice "none", the field "${codeGroups(CODE)}", dir="ltr" (ltr), title "${CODE_TEXT.en.title}", answer "${CODE_TEXT.en.none}"`,
    ]);
    expect(evaluateCodeWalk(walk({ welcome: null, answer: null, restored: null }), CATEGORIES)).toEqual(['after "Restore" with the code, the page could not be read']);
    // Measured screens still count when it stopped there.
    const cut = walk().after.map((s) => (s.id === 'end-edit' ? { ...s, state: codeState('restore-code/actions/0', { cut: ['a: b'] }) } : s));
    expect(evaluateCodeWalk(walk({ after: cut, welcome: null, answer: none, restored: null }), CATEGORIES)).toHaveLength(2);
  });

  it('says what the start showed instead of "Welcome back", and checks "Welcome back"', () => {
    // (As the probe reads a page without "Welcome back": none of its marks; the walk stopped there.)
    const off = { zone: null, index: null, language: null, sources: null, title: null };
    expect(evaluateCodeWalk(walk({ welcome: welcomeState({ ...off, screen: null, onboarding: true }), restored: null }), CATEGORIES)).toEqual(['after the code\'s restore the start showed onboarding, not "Welcome back"']);
    expect(evaluateCodeWalk(walk({ welcome: welcomeState({ ...off, screen: null, live: true }), restored: null }), CATEGORIES)).toEqual(['after the code\'s restore the start showed the live screen, not "Welcome back"']);
    expect(evaluateCodeWalk(walk({ welcome: welcomeState({ ...off, screen: 'looking' }), restored: null }), CATEGORIES)).toEqual(['after the code\'s restore the start showed "looking", not "Welcome back"']);
    expect(evaluateCodeWalk(walk({ welcome: welcomeState({ sources: 2 }) }), CATEGORIES)).toEqual(['"Welcome back" counts 2 sources, expected 1']);
    expect(evaluateCodeWalk(walk({ language: 'ar', welcome: welcomeState({ language: 'ar', dir: 'rtl', title: WELCOME_TITLES.en }) }), CATEGORIES)).toEqual([`"Welcome back"'s title reads "${WELCOME_TITLES.en}", expected "${WELCOME_TITLES.ar}"`]);
  });

  it('wants the live screen to fill by itself after "Welcome back", as the fixture says', () => {
    expect(evaluateCodeWalk(walk({ restored: null }), CATEGORIES)).toEqual(['after "Welcome back" the live screen never filled by itself: nothing']);
    const unfilled = evaluateCodeWalk(walk({ restored: liveState({ rows: [], editing: null, active: null, value: null, phase: null, error: null, bootError: '', onboarding: false, guide: false, movies: false, hook: 'live/channels/0', dialog: false, platformBack: 0 }) }), CATEGORIES);
    expect(unfilled).toHaveLength(1);
    expect(unfilled[0]).toMatch(/^after "Welcome back" the live screen never filled by itself: the live screen, /);
    const wrong = liveState({ rows: [liveState().rows[0]!, { i: 1, number: '7', name: 'Films', now: null, nowText: LIVE_TEXT.en.noGuide, next: null }] });
    expect(evaluateCodeWalk(walk({ restored: wrong }), CATEGORIES)).toEqual(['after the code\'s restore: 1 of 2 rows wrong: row 1 (Films): number "7", expected 2']);
  });

  it("checks the stand-in's requests: the first send, the mistyped code's look-up, the restore, each under its lookup ID", () => {
    expect(CODE_REQUESTS).toEqual(['GET 404', 'PUT 200', 'GET 404', 'GET 200']);
    expect(evaluateCodeWalk(walk({ requests: ['GET 404', 'PUT 200', 'GET 200'], requestIds: [LOOKUP, LOOKUP, LOOKUP] }), CATEGORIES)).toEqual([
      'the backup stand-in answered GET 404, PUT 200, GET 200, expected GET 404, PUT 200, GET 404, GET 200',
      "the requests went under the code's, the code's, the code's, expected the code's, the code's, the mistyped code's, the code's",
    ]);
    expect(evaluateCodeWalk(walk({ requests: [], requestIds: [] }), CATEGORIES)).toEqual([
      'the backup stand-in answered nothing, expected GET 404, PUT 200, GET 404, GET 200',
      "the requests went under no lookup ID, expected the code's, the code's, the mistyped code's, the code's",
    ]);
    // A look-up at the start after the wipe (there is no device ID to look up by).
    expect(evaluateCodeWalk(walk({ requests: ['GET 404', 'PUT 200', 'GET 404', 'GET 404', 'GET 200'], requestIds: [LOOKUP, LOOKUP, 'other', MISTYPED_LOOKUP, LOOKUP] }), CATEGORIES)).toEqual([
      'the backup stand-in answered GET 404, PUT 200, GET 404, GET 404, GET 200, expected GET 404, PUT 200, GET 404, GET 200',
      "the requests went under the code's, the code's, other, the mistyped code's, the code's, expected the code's, the code's, the mistyped code's, the code's",
    ]);
    // The real code's look-up found nothing.
    expect(evaluateCodeWalk(walk({ requests: ['GET 404', 'PUT 200', 'GET 404', 'GET 404'] }), CATEGORIES)).toEqual([
      'the backup stand-in answered GET 404, PUT 200, GET 404, GET 404, expected GET 404, PUT 200, GET 404, GET 200',
    ]);
    // The mistyped code looked up under the real one's.
    expect(evaluateCodeWalk(walk({ requestIds: [LOOKUP, LOOKUP, LOOKUP, LOOKUP] }), CATEGORIES)).toEqual([
      "the requests went under the code's, the code's, the code's, the code's, expected the code's, the code's, the mistyped code's, the code's",
    ]);
  });

  it("checks the restored profile: the phone's source, the language, and no consent", () => {
    expect(evaluateCodeWalk(walk({ profile: null }), CATEGORIES)).toEqual(['the restored profile could not be read']);
    expect(evaluateCodeWalk(walk({ profile: { sources: null, language: null, consent: null, error: 'NotFoundError' } }), CATEGORIES)).toEqual(['the restored profile could not be read: NotFoundError']);
    expect(evaluateCodeWalk(walk({ profile: { sources: null, language: 'en', consent: false } }), CATEGORIES)).toEqual(['the restored profile has the sources no profile, expected s1,m3u,Phone list']);
    expect(evaluateCodeWalk(walk({ profile: { sources: [], language: 'en', consent: false } }), CATEGORIES)).toEqual(['the restored profile has the sources none, expected s1,m3u,Phone list']);
    expect(evaluateCodeWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'en', consent: true } }), CATEGORIES)).toEqual(['the restored answers are language en, consent true, expected en and false']);
    expect(evaluateCodeWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'en', consent: null } }), CATEGORIES)).toEqual(['the restored answers are language en, consent null, expected en and false']);
    expect(evaluateCodeWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'ar', consent: false } }), CATEGORIES)).toEqual(['the restored answers are language ar, consent false, expected en and false']);
    expect(evaluateCodeWalk(walk({ language: 'ar', profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'ar', consent: false } }), CATEGORIES)).toEqual([`the restored profile has the sources s1,m3u,Phone list, expected s1,m3u,${PHONE_NAMES.ar}`]);
  });

  it('wants the typed code kept as the TV\'s own, and every screenshot taken', () => {
    expect(evaluateCodeWalk(walk({ keptAfter: null }), CATEGORIES)).toEqual([`after the restore the app keeps the code -, expected the one typed ("${CODE}")`]);
    expect(evaluateCodeWalk(walk({ keptAfter: { code: mistyped(CODE) } }), CATEGORIES)).toEqual([`after the restore the app keeps the code "${mistyped(CODE)}", expected the one typed ("${CODE}")`]);
    expect(evaluateCodeWalk(walk({ screenshotError: 'no image' }), CATEGORIES)).toEqual(['screenshot: no image']);
  });
});

describe('evaluateCodeRun', () => {
  const run = (over: Partial<CodeRun> = {}): CodeRun => ({
    url: URL,
    appId: 'LabloIPTV1.Lablo',
    walks: [walk(), walk({ language: 'ar' })],
    cleanup: 'ok',
    exceptions: [],
    durationMs: 40_000,
    ...over,
  });

  it('passes both walks on the engine it expects', () => {
    expect(evaluateCodeRun(run(), { major: 53 }, CATEGORIES)).toEqual([]);
  });

  it('names the engine, a missing or failing Arabic walk, the clean-up and uncaught errors', () => {
    expect(evaluateCodeRun(run(), { major: 68 }, CATEGORIES)).toEqual([`the engine reports Chrome 53 ("${UA}"), expected 68`]);
    expect(evaluateCodeRun(run({ walks: [walk()] }), { major: 53 }, CATEGORIES)).toEqual(['in Arabic: the walk did not run']);
    expect(evaluateCodeRun(run({ walks: [walk(), walk({ language: 'ar', profile: { sources: [['s1', 'm3u', PHONE_NAMES.ar]], language: 'ar', consent: true } })] }), { major: 53 }, CATEGORIES)).toEqual([
      'in Arabic: the restored answers are language ar, consent true, expected ar and false',
    ]);
    expect(evaluateCodeRun(run({ walks: [walk({ upload: 'held' }), walk({ language: 'ar' })] }), { major: 53 }, CATEGORIES)).toEqual(['the upload answered "held", expected "sent"']);
    expect(evaluateCodeRun(run({ cleanup: 'blocked' }), { major: 53 }, CATEGORIES)).toEqual(["the app's database could not be deleted after the walks (blocked)"]);
    expect(evaluateCodeRun(run({ exceptions: ['TypeError: x'] }), { major: 53 }, CATEGORIES)).toEqual(['uncaught: TypeError: x']);
    const unread = run({ walks: [walk({ steps: [] }), walk({ language: 'ar', steps: [] })] });
    expect(evaluateCodeRun(unread, { major: 53 }, CATEGORIES)).toEqual(['the page state could not be read at all']);
  });

  it('sums each walk up: from OK on "Restore" to the mistyped code\'s answer, "Welcome back" and the live screen', () => {
    expect(codeSummary(run())).toBe('  en: no backup 1.2 s, "Welcome back" 2.1 s, live 7.9 s; ar: no backup 1.2 s, "Welcome back" 2.1 s, live 7.9 s');
    expect(codeSummary(run({ walks: [walk({ noneMs: null, welcomeMs: null, liveMs: null })] }))).toBe('  en: no backup -, "Welcome back" -, live -');
    expect(codeSummary(run({ walks: [] }))).toBe('');
  });
});
