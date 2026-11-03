import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import type { StepRecord, StoredProfile, Walk, WalkLanguage, WalkState, WalkStep } from './onboarding';
import {
  BLANK_URL,
  PHASES_EXPRESSION,
  PHASES_RESULT,
  PLAYLIST_INPUT,
  PROFILE_EXPRESSION,
  PROFILE_RESULT,
  RESET_EXPRESSION,
  RESET_RESULT,
  SOURCE_NAME,
  STALE_MARK,
  WALK_EXPRESSION,
  WALK_LANGUAGES,
  describeExpectation,
  describeState,
  evaluateOnboarding,
  evaluateWalk,
  matches,
  onboardingUrl,
  playlistLink,
  profileFailures,
  stepLanded,
  stepStuck,
  stepTime,
  walkSteps,
} from './onboarding';

const URL = onboardingUrl('app', 'tizen');
const LINK = playlistLink({ file: 'playlist.m3u' });
const CHECK = { live: 2400, movies: 600 };
const UA53 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';

function state(overrides: Partial<WalkState> = {}): WalkState {
  return {
    href: URL,
    stale: false,
    userAgent: UA53,
    bootError: '',
    onboarding: true,
    hello: false,
    helloIdle: false,
    screen: 'language',
    zone: 'languages',
    index: 0,
    editing: '',
    language: 'en',
    dir: 'ltr',
    active: 'BODY',
    value: null,
    phase: null,
    error: null,
    counts: null,
    viewport: [1920, 1080],
    scroll: [1920, 1080],
    outside: [],
    cut: [],
    fontsStatus: 'loaded',
    fonts: 'la400:loaded la700:loaded ar400:loaded ar700:loaded',
    ...overrides,
  };
}

/** The state a step leaves when it lands: its expectation, the done screen's counts after "Add source". */
function landed(step: WalkStep): WalkState {
  const base = state({ ...step.expect });
  if (step.id === 'add') return { ...base, counts: [2400, 600, 0] };
  if (step.expect.hello === true) return { ...base, screen: null, zone: null, index: null, editing: null, language: null, onboarding: step.expect.onboarding ?? false };
  return base;
}

function record(step: WalkStep, at: WalkState = landed(step), met = true): StepRecord {
  return { id: step.id, label: step.label, expect: step.expect, layout: step.layout ?? null, met, state: at, ms: step.id === 'add' ? 2000 : 150 };
}

const PROFILE: Record<WalkLanguage, StoredProfile> = {
  en: { sources: [['s1', 'm3u', SOURCE_NAME]], language: 'en', consent: true },
  ar: { sources: [['s1', 'm3u', SOURCE_NAME]], language: 'ar', consent: true },
};

/** A walk where every step landed. */
function walk(language: WalkLanguage, overrides: Partial<Walk> = {}): Walk {
  return {
    language,
    reset: 'ok',
    steps: walkSteps(language, LINK).map((step) => record(step)),
    phases: ['checking', 'download', 'saving', 'guide'],
    profile: PROFILE[language],
    screenshots: ['form.png', 'done.png'],
    screenshotError: null,
    ...overrides,
  };
}

const run = (walks: Walk[] = WALK_LANGUAGES.map((l) => walk(l)), exceptions: string[] = [], cleanup = 'ok') => ({
  platform: 'tizen' as const,
  url: URL,
  walks,
  cleanup,
  exceptions,
  durationMs: 8000,
});

/** The walk with one step replaced by what the engine showed instead, and the steps after it gone. */
function stoppedAt(language: WalkLanguage, id: string, at: Partial<WalkState>): Walk {
  const steps = walkSteps(language, LINK);
  const i = steps.findIndex((s) => s.id === id);
  const step = steps[i]!;
  return walk(language, { steps: [...steps.slice(0, i).map((s) => record(s)), record(step, { ...landed(step), ...at }, false)] });
}

describe('the onboarding probes', () => {
  it.each([
    ['WALK_EXPRESSION', WALK_EXPRESSION],
    ['RESET_EXPRESSION', RESET_EXPRESSION],
    ['RESET_RESULT', RESET_RESULT],
    ['PHASES_EXPRESSION', PHASES_EXPRESSION],
    ['PHASES_RESULT', PHASES_RESULT],
    ['PROFILE_EXPRESSION', PROFILE_EXPRESSION],
    ['PROFILE_RESULT', PROFILE_RESULT],
    ['STALE_MARK', STALE_MARK],
  ])('%s is plain ES5, so it runs on every engine', (_name, expression) => {
    expect(() => parse(expression, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it('opens what a TV opens (no ?screen=), and deletes the database from a page of the same file:// origin', () => {
    expect(URL).toBe('file:///app/app/tizen/index.html');
    expect(new globalThis.URL(BLANK_URL).protocol).toBe('file:');
    expect(RESET_EXPRESSION).toContain("indexedDB.deleteDatabase('zoma')");
  });

  it('types the fixture playlist without http://, so the form adds it', () => {
    expect(LINK).toBe('127.0.0.1:8090/playlist.m3u');
    expect(playlistLink({ file: 'playlist.m3u.gz' })).toBe('127.0.0.1:8090/playlist.m3u.gz');
    expect(SOURCE_NAME).toBe('127.0.0.1');
  });

  it('reads only the ids, types and names of the stored sources, never a link or a login', () => {
    expect(PROFILE_EXPRESSION).toContain('[s.id, s.type, s.name]');
    expect(PROFILE_EXPRESSION).not.toMatch(/s\.url|account|password/);
  });
});

describe('walkSteps', () => {
  const keys = (steps: WalkStep[]): string[] => steps.flatMap((s) => [...(s.navigate === true ? ['(start)'] : []), ...(s.keys ?? []).map((k) => k.key), ...(s.type === undefined ? [] : [`"${s.type}"`])]);

  it('walks the English flow by keys only, the M3U link typed into its field', () => {
    expect(keys(walkSteps('en', LINK))).toEqual([
      '(start)',
      'Enter',
      'Enter',
      'ArrowRight',
      'ArrowLeft',
      'Enter',
      'ArrowDown',
      'Enter',
      'Enter',
      `"${LINK}x"`,
      'Backspace',
      'Enter',
      'ArrowDown',
      'ArrowDown',
      'Enter',
      'Enter',
      '(start)',
    ]);
  });

  it('picks Arabic with ArrowRight, and swaps LEFT and RIGHT along a row once it is right to left', () => {
    const steps = walkSteps('ar', LINK);
    expect(keys(steps).slice(0, 6)).toEqual(['(start)', 'ArrowRight', 'Enter', 'Enter', 'ArrowLeft', 'ArrowRight']);
    expect(steps.find((s) => s.id === 'language')?.expect).toMatchObject({ language: 'ar', dir: 'rtl' });
    expect(steps.find((s) => s.id === 'consent-other')?.expect).toEqual({ screen: 'consent', index: 1 });
  });

  it('expects DOM focus on the input while it is edited, and none after OK ends the edit', () => {
    const steps = walkSteps('en', LINK);
    expect(steps.find((s) => s.id === 'open-field')?.expect).toMatchObject({ editing: PLAYLIST_INPUT, active: PLAYLIST_INPUT });
    expect(steps.find((s) => s.id === 'backspace')?.expect).toMatchObject({ editing: PLAYLIST_INPUT, value: LINK });
    expect(steps.find((s) => s.id === 'end-edit')?.expect).toMatchObject({ editing: '', active: 'BODY', value: LINK, index: 1 });
  });

  it('ends on the hello screen, then relaunches into it with no onboarding, leaving each only once its data rows have answered', () => {
    const steps = walkSteps('en', LINK);
    expect(steps.at(-2)?.expect).toEqual({ hello: true, helloIdle: true });
    expect(steps.at(-1)).toMatchObject({ id: 'relaunch', navigate: true, expect: { hello: true, helloIdle: true, onboarding: false }, wait: 'boot' });
    expect(steps.find((s) => s.id === 'add')).toMatchObject({ wait: 'load', shot: 'done', layout: 'done' });
  });

  it('measures the six screens of the e2e test on the way', () => {
    expect(walkSteps('ar', LINK).flatMap((s) => (s.layout === undefined ? [] : [s.layout]))).toEqual(['language', 'disclaimer', 'consent', 'source', 'form', 'done']);
  });
});

describe('stepLanded', () => {
  const [start] = walkSteps('en', LINK);
  const toAdd = walkSteps('en', LINK).find((s) => s.id === 'to-add')!;

  it('needs every expected field', () => {
    expect(matches(state(), start!.expect)).toBe(true);
    expect(stepLanded(start!, state({ index: 1 }))).toBe(false);
    expect(stepLanded(start!, state({ onboarding: false }))).toBe(false);
  });

  it('waits for the fonts on a measured screen only', () => {
    expect(stepLanded(start!, state({ fontsStatus: 'loading' }))).toBe(false);
    expect(stepLanded(start!, state({ fonts: 'la400:loaded ar400:loading' }))).toBe(false);
    expect(stepLanded(toAdd, state({ screen: 'form', zone: 'actions', index: 0, fontsStatus: 'loading' }))).toBe(true);
  });

  it('gives up at once on a boot error or a failed load', () => {
    expect(stepStuck(start!, state())).toBe(false);
    expect(stepStuck(start!, state({ bootError: 'SyntaxError' }))).toBe(true);
    expect(stepStuck(start!, state({ screen: 'loading', error: 'network' }))).toBe(true);
  });

  it('gives up on a relaunch as soon as onboarding is ready: the start has decided', () => {
    const relaunch = walkSteps('en', LINK).at(-1)!;
    expect(stepStuck(relaunch, state({ onboarding: false, screen: null }))).toBe(false);
    expect(stepStuck(relaunch, state())).toBe(true);
    // Elsewhere a ready onboarding is where the walk is.
    expect(stepStuck(toAdd, state())).toBe(false);
  });
});

describe('describeState and describeExpectation', () => {
  it('say where the focus and the edit are', () => {
    expect(describeState(state({ screen: 'form', zone: 'fields', index: 0, editing: PLAYLIST_INPUT, value: '' }))).toBe(
      'form · fields 0, editing onboarding-playlist, no DOM focus, link "", language en, dir="ltr"',
    );
    expect(describeExpectation({ screen: 'form', editing: PLAYLIST_INPUT, active: PLAYLIST_INPUT })).toBe('form · * *, editing onboarding-playlist, DOM focus on onboarding-playlist');
    expect(describeExpectation({ screen: 'consent', index: 1 })).toBe('consent · * 1');
  });

  it('name the hello screen, a boot error and a failed load', () => {
    expect(describeState(state({ hello: true, helloIdle: true, onboarding: false, screen: null, language: null }))).toBe('the hello screen, no DOM focus');
    expect(describeState(state({ hello: true, onboarding: false, screen: null, language: null }))).toBe('the hello screen, its data rows still busy, no DOM focus');
    expect(describeState(state({ onboarding: false, screen: null, language: null, bootError: 'SyntaxError: x\nat y' }))).toBe('boot error: SyntaxError: x | at y, no screen yet, no DOM focus');
    expect(describeState(state({ screen: 'loading', zone: 'actions', index: 0, error: 'network' }))).toContain('the load failed: network');
    expect(describeExpectation({ hello: true, onboarding: false })).toBe('the hello screen, no onboarding');
    expect(describeExpectation({ hello: true, helloIdle: true, onboarding: false })).toBe('the hello screen, its data rows answered, no onboarding');
  });
});

describe('evaluateWalk', () => {
  it('passes a clean walk in both languages', () => {
    expect(evaluateWalk(walk('en'), CHECK)).toEqual([]);
    expect(evaluateWalk(walk('ar'), CHECK)).toEqual([]);
  });

  it('stops at a database that could not be deleted', () => {
    expect(evaluateWalk(walk('en', { reset: 'blocked', steps: [] }), CHECK)).toEqual(["the app's database could not be deleted before the walk (blocked)"]);
  });

  it('reports an input that never took DOM focus, and nothing after it', () => {
    const failures = evaluateWalk(stoppedAt('en', 'open-field', { active: 'BODY', zone: 'fields' }), CHECK);
    expect(failures).toEqual([
      'OK on the playlist field: expected form · * *, editing onboarding-playlist, DOM focus on onboarding-playlist; saw form · fields 0, editing onboarding-playlist, no DOM focus, language en, dir="ltr"',
    ]);
  });

  it('reports typing that never reached the field, and a Backspace that went back instead of deleting', () => {
    expect(evaluateWalk(stoppedAt('en', 'type', { value: '' }), CHECK)[0]).toMatch(/^typing "127\.0\.0\.1:8090\/playlist\.m3ux": expected .*link "127\.0\.0\.1:8090\/playlist\.m3ux"; saw .*link ""/);
    expect(evaluateWalk(stoppedAt('en', 'backspace', { screen: 'source', zone: 'types', index: 1, editing: '', value: null }), CHECK)[0]).toMatch(
      /^Backspace in the field: expected form .*; saw source · types 1/,
    );
  });

  it('reports a relaunch that showed onboarding again: the source was not kept', () => {
    const failures = evaluateWalk(stoppedAt('ar', 'relaunch', { hello: false, onboarding: true, screen: 'language', zone: 'languages', index: 0, language: 'en' }), CHECK);
    expect(failures).toEqual(['the relaunch: expected the hello screen, its data rows answered, no onboarding; saw language · languages 0, no DOM focus, language en, dir="ltr"']);
  });

  it('reports a failed load with its code, and a language that did not switch', () => {
    expect(evaluateWalk(stoppedAt('en', 'add', { screen: 'loading', error: 'network' }), CHECK)[0]).toMatch(/^OK on "Add source": expected done · actions 0; saw .*the load failed: network/);
    expect(evaluateWalk(stoppedAt('ar', 'language', { language: 'en', dir: 'ltr' }), CHECK)[0]).toMatch(/^OK on العربية: expected disclaimer · actions 0, language ar, dir="rtl"; saw disclaimer/);
  });

  it('says when only the fonts kept a measured screen from settling', () => {
    expect(evaluateWalk(stoppedAt('en', 'disclaimer', { fontsStatus: 'loading' }), CHECK)).toEqual([
      'OK on "I understand": expected consent · actions 0; saw the fonts did not settle (loading: la400:loaded la700:loaded ar400:loaded ar700:loaded)',
    ]);
  });

  it('checks the done screen: the counts, the phases and the stored profile', () => {
    const steps = walkSteps('en', LINK).map((s) => (s.id === 'add' ? record(s, { ...landed(s), counts: [2399, 600, 0] }) : record(s)));
    expect(evaluateWalk(walk('en', { steps }), CHECK)).toEqual(['done: counts (live, films, series) 2399, 600, 0, expected 2400, 600, 0']);
    expect(evaluateWalk(walk('en', { phases: ['checking', 'saving'] }), CHECK)).toEqual([
      'loading: the download phase never showed (saw checking, saving)',
      'loading: the guide phase never showed (saw checking, saving)',
    ]);
    expect(evaluateWalk(walk('en', { profile: null }), CHECK)).toEqual(['the stored profile could not be read']);
  });

  it('measures each screen: the canvas, the scroll, the safe area and cut labels', () => {
    const steps = walkSteps('en', LINK).map((s) => {
      if (s.id === 'start') return record(s, { ...landed(s), viewport: [1919, 974] });
      if (s.id === 'disclaimer') return record(s, { ...landed(s), scroll: [1920, 1200] });
      if (s.id === 'end-edit') return record(s, { ...landed(s), outside: ['z-field: a', 'z-field: b', 'z-field: c', 'z-field: d', 'z-field: e', 'z-field: f'], cut: ['z-field__label: Playlist link'] });
      return record(s);
    });
    expect(evaluateWalk(walk('en', { steps }), CHECK)).toEqual([
      'on the language screen: the viewport is 1919x974, expected 1920x1080',
      'on the consent screen: the page scrolls: it is 1920x1200',
      'on the form screen: outside the safe area: z-field: a; z-field: b; z-field: c; z-field: d; z-field: e and 1 more',
      'on the form screen: labels cut: z-field__label: Playlist link',
    ]);
  });

  it('needs a Latin and an Arabic face on the first screen, which shows both languages', () => {
    const steps = walkSteps('en', LINK).map((s) => (s.id === 'start' ? record(s, { ...landed(s), fonts: 'la400:loaded ar400:error' }) : record(s)));
    expect(evaluateWalk(walk('en', { steps }), CHECK)).toEqual(['fonts: ar400:error failed to load', 'fonts: no Arabic Zoma Sans face loaded (la400:loaded ar400:error)']);
  });

  it('reports a walk cut short and a screenshot that failed', () => {
    const steps = walk('en').steps.slice(0, -1);
    expect(evaluateWalk(walk('en', { steps }), CHECK)).toEqual([`only ${steps.length} of ${steps.length + 1} steps ran`]);
    expect(evaluateWalk(walk('en', { screenshotError: 'the engine returned no image' }), CHECK)).toEqual(['screenshot: the engine returned no image']);
  });

  it('times the first screen, the load and the relaunch, only for steps that landed', () => {
    expect(stepTime(walk('en'), 'start')).toBe(150);
    expect(stepTime(walk('en'), 'add')).toBe(2000);
    expect(stepTime(stoppedAt('en', 'add', { error: 'network' }), 'add')).toBeNull();
    expect(stepTime(stoppedAt('en', 'add', { error: 'network' }), 'relaunch')).toBeNull();
  });
});

describe('profileFailures', () => {
  it('wants the one source as s1, named after the host, and the answers given', () => {
    expect(profileFailures(PROFILE.ar, 'ar')).toEqual([]);
    expect(profileFailures(PROFILE.en, 'ar')).toEqual(['the stored answers are language en, consent true, expected ar and true']);
    expect(profileFailures({ ...PROFILE.en, consent: false }, 'en')).toEqual(['the stored answers are language en, consent false, expected en and true']);
    expect(profileFailures({ ...PROFILE.en, sources: [['s2', 'm3u', SOURCE_NAME]] }, 'en')).toEqual(['the stored profile has the sources s2,m3u,127.0.0.1, expected s1,m3u,127.0.0.1']);
    expect(profileFailures({ ...PROFILE.en, sources: [] }, 'en')).toEqual(['the stored profile has the sources none, expected s1,m3u,127.0.0.1']);
    expect(profileFailures({ sources: null, language: null, consent: null }, 'en')[0]).toBe('the stored profile has the sources no profile, expected s1,m3u,127.0.0.1');
    expect(profileFailures({ sources: null, language: null, consent: null, error: 'NotFoundError' }, 'en')).toEqual(['the stored profile could not be read: NotFoundError']);
  });
});

describe('evaluateOnboarding', () => {
  it('passes a clean run', () => {
    expect(evaluateOnboarding(run(), { major: 53 }, CHECK)).toEqual([]);
  });

  it('fails when the engine is not the expected version', () => {
    expect(evaluateOnboarding(run(), { major: 56 }, CHECK)).toEqual([`the engine reports Chrome 53 ("${UA53}"), expected 56`]);
  });

  it("marks the Arabic walk's failures, and reports a walk that did not run", () => {
    const failures = evaluateOnboarding(run([walk('en'), stoppedAt('ar', 'pick-arabic', { index: 0 })]), { major: 53 }, CHECK);
    expect(failures).toEqual(['in Arabic: ArrowRight to العربية: expected language · * 1; saw language · languages 0, no DOM focus, language en, dir="ltr"']);
    expect(evaluateOnboarding(run([walk('ar')]), { major: 53 }, CHECK)).toEqual(['the walk did not run']);
  });

  it('fails when the database could not be deleted after the walks: later runs would find the source', () => {
    expect(evaluateOnboarding(run(undefined, [], 'pending'), { major: 53 }, CHECK)).toEqual(["the app's database could not be deleted after the walks (pending)"]);
  });

  it('fails on an uncaught exception even when every step landed', () => {
    expect(evaluateOnboarding(run(undefined, ['TypeError: x (main.js:1)']), { major: 53 }, CHECK)).toEqual(['uncaught: TypeError: x (main.js:1)']);
  });

  it('fails when the page could not be read at all', () => {
    const blind = walk('en', { steps: [record(walkSteps('en', LINK)[0]!, landed(walkSteps('en', LINK)[0]!), false)].map((s) => ({ ...s, state: null })) });
    const failures = evaluateOnboarding(run([blind, { ...blind, language: 'ar' }]), { major: 53 }, CHECK);
    expect(failures[0]).toBe('the page state could not be read at all');
    expect(failures).toContain('the first start: expected language · languages 0, language en; saw the page could not be read');
  });
});
