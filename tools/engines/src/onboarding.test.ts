import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { fixtureEntries, liveCategories } from './fixture';
import type { LiveView } from './live';
import { CHANNELS_VISIBLE, LIVE_CATEGORY, LIVE_TEXT, PLATFORM_BACK_STUB, listedEntry, programmeTitle } from './live';
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
  drawnPath,
  evaluateOnboarding,
  evaluateWalk,
  liveSteps,
  matches,
  onboardingUrl,
  playlistLink,
  profileFailures,
  settling,
  stepLanded,
  stepStuck,
  stepTime,
  walkSteps,
} from './onboarding';
import type { TvPlatform } from './scenario';

const URL = onboardingUrl('app', 'tizen');
const LINK = playlistLink({ file: 'playlist.m3u' });
const CATEGORIES = liveCategories(fixtureEntries());
const CHECK = { live: 2400, movies: 600, categories: CATEGORIES };
const UA53 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';
/** 14:30 UTC: the fixture guide's `… 14h` programmes are on now, `… 15h` next. */
const CLOCK = Date.UTC(2026, 10, 4, 14, 30);
/** The category the walk opens (Group 5), for the messages. */
const SHOWN = CATEGORIES[LIVE_CATEGORY - 1]!;

/** The live screen as the app draws it for rail entry `category` from row `top`, at CLOCK. */
function drawn(language: WalkLanguage, category: number, top: number): Pick<LiveView, 'heading' | 'chips' | 'rows' | 'railSide'> {
  const entry = listedEntry(CATEGORIES, category)!;
  const rows = entry.channels.slice(top, top + CHANNELS_VISIBLE).map((channel, n) => ({
    i: top + n,
    number: String(entry.allStart + top + n + 1),
    name: channel.name,
    now: channel.guide ? programmeTitle(channel, 14) : null,
    nowText: channel.guide ? `2:00 PM${programmeTitle(channel, 14)}` : LIVE_TEXT[language].noGuide,
    next: channel.guide ? programmeTitle(channel, 15) : null,
  }));
  const chips = Array.from({ length: 12 }, (_v, i) => {
    const at = listedEntry(CATEGORIES, i)!;
    return { i, label: at.name ?? LIVE_TEXT[language].all, count: at.channels.length.toLocaleString('en-US'), selected: i === category };
  });
  return { heading: entry.name ?? LIVE_TEXT[language].all, chips, rows, railSide: language === 'ar' ? 'right' : 'left' };
}

const BASE: WalkState = {
  href: URL,
  stale: false,
  userAgent: UA53,
  bootError: '',
  onboarding: true,
  live: false,
  liveIdle: false,
  liveCount: null,
  screen: 'language',
  zone: 'languages',
  index: 0,
  editing: '',
  language: 'en',
  hook: 'language/languages/0',
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
  category: null,
  top: null,
  heading: null,
  chips: [],
  rows: [],
  railSide: null,
  dialog: false,
  platformBack: 0,
  clock: CLOCK,
};

/** `base` with `overrides`, the focus engine agreeing with the screen unless `overrides` names its own. */
function patch(base: WalkState, overrides: Partial<WalkState>): WalkState {
  const next = { ...base, ...overrides };
  return { ...next, hook: 'hook' in overrides ? (overrides.hook ?? null) : drawnPath(next) };
}

const state = (overrides: Partial<WalkState> = {}): WalkState => patch(BASE, overrides);

/**
 * The state a step leaves when it lands: its expectation, the done screen's counts after "Add
 * source", and the live screen drawn for its category and window.
 */
function landed(step: WalkStep, language: WalkLanguage = 'en'): WalkState {
  const base = state({ ...step.expect });
  if (step.id === 'add') return { ...base, counts: [2400, 600, 0] };
  if (step.expect.live === true) {
    const category = step.expect.category ?? 0;
    const top = step.expect.top ?? 0;
    const count = listedEntry(CATEGORIES, category)!.channels.length;
    return patch(base, { editing: null, onboarding: step.expect.onboarding ?? false, liveCount: count, category, top, ...drawn(language, category, top) });
  }
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
function walk(language: WalkLanguage, overrides: Partial<Walk> = {}, platform: TvPlatform = 'tizen'): Walk {
  return {
    language,
    platform,
    reset: 'ok',
    steps: walkSteps(language, LINK, platform).map((step) => record(step, landed(step, language))),
    phases: ['checking', 'download', 'saving', 'guide'],
    profile: PROFILE[language],
    screenshots: ['form.png', 'done.png', 'live.png', 'category.png', 'exit.png'],
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
function stoppedAt(language: WalkLanguage, id: string, at: Partial<WalkState>, platform: TvPlatform = 'tizen'): Walk {
  const steps = walkSteps(language, LINK, platform);
  const i = steps.findIndex((s) => s.id === id);
  const step = steps[i]!;
  const before = steps.slice(0, i).map((s) => record(s, landed(s, language)));
  return walk(language, { steps: [...before, record(step, patch(landed(step, language), at), false)] }, platform);
}

/** A clean walk, but step `id` landed on a state changed by `at`. */
function changedAt(language: WalkLanguage, id: string, at: (landed: WalkState) => Partial<WalkState>, platform: TvPlatform = 'tizen'): Walk {
  const steps = walkSteps(language, LINK, platform).map((s) => {
    const there = landed(s, language);
    return record(s, s.id === id ? patch(there, at(there)) : there);
  });
  return walk(language, { steps }, platform);
}

const stepOf = (id: string, platform: TvPlatform = 'tizen', language: WalkLanguage = 'en'): WalkStep => walkSteps(language, LINK, platform).find((s) => s.id === id)!;

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

  it("reads the focus engine's path, and measures the live screen by its own boxes and labels", () => {
    expect(WALK_EXPRESSION).toContain('hook.focusPath()');
    expect(WALK_EXPRESSION).toContain("all(live ? '.z-chip, .z-row,");
    expect(WALK_EXPRESSION).toContain('var view = liveView(live);');
  });
});

describe('walkSteps', () => {
  const keys = (steps: WalkStep[]): string[] => steps.flatMap((s) => [...(s.navigate === true ? ['(start)'] : []), ...(s.keys ?? []).map((k) => k.key), ...(s.type === undefined ? [] : [`"${s.type}"`])]);

  it('walks the English flow by keys only, the M3U link typed into its field, then the live screen', () => {
    expect(keys(walkSteps('en', LINK, 'tizen'))).toEqual([
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
      'ArrowDown',
      'ChannelDown',
      'ChannelUp',
      'ArrowLeft',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'Enter',
      'Back',
      'Back',
      'Enter',
    ]);
    expect(walkSteps('en', LINK, 'webos').slice(-liveSteps('en', 'webos').length)).toEqual(liveSteps('en', 'webos'));
  });

  it('picks Arabic with ArrowRight, and swaps LEFT and RIGHT along a row once it is right to left', () => {
    const steps = walkSteps('ar', LINK, 'tizen');
    expect(keys(steps).slice(0, 6)).toEqual(['(start)', 'ArrowRight', 'Enter', 'Enter', 'ArrowLeft', 'ArrowRight']);
    expect(steps.find((s) => s.id === 'language')?.expect).toMatchObject({ language: 'ar', dir: 'rtl' });
    expect(steps.find((s) => s.id === 'consent-other')?.expect).toEqual({ screen: 'consent', index: 1 });
  });

  it('expects DOM focus on the input while it is edited, and none after OK ends the edit', () => {
    const steps = walkSteps('en', LINK, 'tizen');
    expect(steps.find((s) => s.id === 'open-field')?.expect).toMatchObject({ editing: PLAYLIST_INPUT, active: PLAYLIST_INPUT });
    expect(steps.find((s) => s.id === 'backspace')?.expect).toMatchObject({ editing: PLAYLIST_INPUT, value: LINK });
    expect(steps.find((s) => s.id === 'end-edit')?.expect).toMatchObject({ editing: '', active: 'BODY', value: LINK, index: 1 });
  });

  it('ends onboarding on the live screen in the language picked, then relaunches into it with no onboarding, leaving each only once its data requests have answered', () => {
    const live = { screen: 'live', zone: 'channels', index: 0, live: true, liveIdle: true };
    expect(stepOf('start-watching')).toMatchObject({ shot: 'live', wait: 'boot' });
    expect(stepOf('start-watching').expect).toEqual({ ...live, language: 'en', dir: 'ltr' });
    expect(stepOf('start-watching', 'tizen', 'ar').expect).toEqual({ ...live, language: 'ar', dir: 'rtl' });
    expect(stepOf('relaunch', 'webos', 'ar')).toMatchObject({
      navigate: true,
      expect: { ...live, language: 'ar', dir: 'rtl', onboarding: false, category: 0, top: 0 },
      layout: 'live',
      rail: true,
      rows: true,
      wait: 'boot',
    });
    expect(stepOf('add')).toMatchObject({ wait: 'load', shot: 'done', layout: 'done' });
  });

  it('measures the six screens of the e2e test on the way, then the live screen, its next window, a category and (Tizen) the exit dialog', () => {
    const six = ['language', 'disclaimer', 'consent', 'source', 'form', 'done'];
    expect(walkSteps('ar', LINK, 'tizen').flatMap((s) => (s.layout === undefined ? [] : [s.layout]))).toEqual([...six, 'live', 'paged live', 'category', 'exit dialog']);
    expect(walkSteps('en', LINK, 'webos').flatMap((s) => (s.layout === undefined ? [] : [s.layout]))).toEqual([...six, 'live', 'paged live', 'category']);
    expect(walkSteps('en', LINK, 'tizen').flatMap((s) => (s.shot === undefined ? [] : [s.shot]))).toEqual(['form', 'done', 'live', 'category', 'exit']);
    expect(walkSteps('en', LINK, 'webos').flatMap((s) => (s.shot === undefined ? [] : [s.shot]))).toEqual(['form', 'done', 'live', 'category']);
  });
});

describe('liveSteps', () => {
  const codes = (platform: TvPlatform, language: WalkLanguage = 'en'): number[] => liveSteps(language, platform).flatMap((s) => (s.keys ?? []).map((k) => k.keyCode));

  it("presses each TV's own CH−, CH+ and Back key codes", () => {
    expect(codes('tizen')).toEqual([40, 428, 427, 37, 40, 40, 40, 40, 40, 13, 10009, 10009, 13]);
    expect(codes('webos')).toEqual([40, 34, 33, 37, 40, 40, 40, 40, 40, 13, 461, 461]);
  });

  it('goes to the rail with RIGHT in Arabic, where the rail is on the right', () => {
    expect(codes('webos', 'ar')).toEqual([40, 34, 33, 39, 40, 40, 40, 40, 40, 13, 461, 461]);
    expect(liveSteps('ar', 'tizen').find((s) => s.id === 'live-rail')?.label).toBe('ArrowRight to the rail');
  });

  it('pages by a window of 9 rows, and opens the fifth category on its first channel', () => {
    const steps = liveSteps('en', 'tizen');
    expect(steps.find((s) => s.id === 'live-page-down')?.expect).toMatchObject({ zone: 'channels', index: 10, top: 9 });
    expect(steps.find((s) => s.id === 'live-page-up')?.expect).toMatchObject({ zone: 'channels', index: 1, top: 0 });
    expect(steps.find((s) => s.id === 'live-pick')?.expect).toMatchObject({ zone: 'rail', index: 5, category: 0 });
    expect(steps.find((s) => s.id === 'live-category')?.expect).toMatchObject({ zone: 'channels', index: 0, category: 5, top: 0 });
    expect(steps.find((s) => s.id === 'live-back')?.expect).toMatchObject({ zone: 'rail', index: 5, category: 5 });
  });

  it('leaves Tizen through its exit dialog ("Stay" closes it), and webOS through PalmSystem.platformBack()', () => {
    expect(liveSteps('en', 'tizen').slice(-2).map((s) => [s.id, s.expect])).toEqual([
      ['live-exit', { screen: 'exit', zone: 'buttons', index: 0, live: true, dialog: true }],
      ['live-stay', { screen: 'live', zone: 'rail', index: 5, live: true, liveIdle: true, category: 5, dialog: false }],
    ]);
    const exit = liveSteps('en', 'webos').at(-1)!;
    expect(exit).toMatchObject({ id: 'live-exit', before: PLATFORM_BACK_STUB, expect: { screen: 'live', zone: 'rail', index: 5, dialog: false, platformBack: 1 } });
    expect(liveSteps('en', 'tizen').some((s) => s.before !== undefined)).toBe(false);
  });

  it("waits for the screen's data at every step, the dialog aside, so the walk never leaves it busy", () => {
    for (const platform of ['tizen', 'webos'] as const) {
      const steps = liveSteps('en', platform);
      expect(steps.every((s) => s.wait === 'live')).toBe(true);
      expect(steps.filter((s) => s.expect.liveIdle !== true).map((s) => s.id)).toEqual(platform === 'tizen' ? ['live-exit'] : []);
      expect(steps.at(-1)?.expect.liveIdle).toBe(true);
    }
  });

  it('checks the rows where the window or the category changes, and the rail where the category does', () => {
    const steps = walkSteps('en', LINK, 'tizen');
    expect(steps.filter((s) => s.rows === true).map((s) => s.id)).toEqual(['relaunch', 'live-page-down', 'live-category']);
    expect(steps.filter((s) => s.rail === true).map((s) => s.id)).toEqual(['relaunch', 'live-category']);
  });
});

describe('stepLanded', () => {
  const start = stepOf('start');
  const toAdd = stepOf('to-add');

  it('needs every expected field', () => {
    expect(matches(state(), start.expect)).toBe(true);
    expect(stepLanded(start, state({ index: 1 }))).toBe(false);
    expect(stepLanded(start, state({ onboarding: false }))).toBe(false);
  });

  it('waits for the fonts on a measured screen only', () => {
    expect(stepLanded(start, state({ fontsStatus: 'loading' }))).toBe(false);
    expect(stepLanded(start, state({ fonts: 'la400:loaded ar400:loading' }))).toBe(false);
    expect(stepLanded(toAdd, state({ screen: 'form', zone: 'actions', index: 0, fontsStatus: 'loading' }))).toBe(true);
  });

  it('waits for the focus engine to agree with the screen it draws', () => {
    const down = stepOf('live-down');
    expect(stepLanded(down, landed(down))).toBe(true);
    expect(stepLanded(down, patch(landed(down), { hook: 'live/channels/0' }))).toBe(false);
    expect(settling(down, patch(landed(down), { hook: 'live/channels/0' }))).toBe('the screen draws live/channels/1, but the focus engine is at live/channels/0');
    expect(settling(start, state({ hook: null }))).toBe('the screen draws language/languages/0, but the focus engine is at nothing');
    // Before a screen shows there is nothing to agree on.
    expect(settling(toAdd, state({ screen: null, zone: null, index: null, hook: null }))).toBeNull();
  });

  it('waits for every row of a checked step to answer: a programme or the placeholder', () => {
    const relaunch = stepOf('relaunch');
    const there = landed(relaunch);
    const rows = there.rows.map((row) => (row.i === 2 || row.i === 3 ? { ...row, now: null, nowText: '', next: null } : row));
    expect(stepLanded(relaunch, there)).toBe(true);
    expect(stepLanded(relaunch, patch(there, { rows }))).toBe(false);
    expect(settling(relaunch, patch(there, { rows }))).toBe('the rows never filled in: rows 2–3 show neither a programme nor the placeholder');
    expect(settling(relaunch, patch(there, { rows: [] }))).toBe('the rows never filled in: the list draws no rows');
    // A step that checks no rows doesn't wait for them.
    expect(stepLanded(stepOf('live-down'), patch(landed(stepOf('live-down')), { rows }))).toBe(true);
  });

  it('gives up at once on a boot error or a failed load', () => {
    expect(stepStuck(start, state())).toBe(false);
    expect(stepStuck(start, state({ bootError: 'SyntaxError' }))).toBe(true);
    expect(stepStuck(start, state({ screen: 'loading', error: 'network' }))).toBe(true);
  });

  it('gives up on a relaunch as soon as onboarding is ready: the start has decided', () => {
    const relaunch = stepOf('relaunch');
    expect(stepStuck(relaunch, state({ onboarding: false, screen: null }))).toBe(false);
    expect(stepStuck(relaunch, state({ onboarding: false, live: true, screen: 'live', zone: 'channels', index: 0 }))).toBe(false);
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

  it('name the live screen, a boot error and a failed load', () => {
    const onLive = { live: true, onboarding: false, screen: 'live', zone: 'channels', index: 0, editing: null, language: 'ar', dir: 'rtl', category: 0, top: 0 };
    expect(describeState(state({ ...onLive, liveIdle: true }))).toBe('the live screen, live · channels 0, category 0, rows from 0, no DOM focus, language ar, dir="rtl"');
    expect(describeState(state(onLive))).toBe('the live screen, its data requests still running, live · channels 0, category 0, rows from 0, no DOM focus, language ar, dir="rtl"');
    expect(describeState(state({ onboarding: false, screen: 'language', zone: 'languages', index: 0 }))).toBe('language · languages 0, not ready, no DOM focus, language en, dir="ltr"');
    expect(describeState(state({ onboarding: false, screen: null, language: null, bootError: 'SyntaxError: x\nat y' }))).toBe('boot error: SyntaxError: x | at y, no screen yet, no DOM focus');
    expect(describeState(state({ screen: 'loading', zone: 'actions', index: 0, error: 'network' }))).toContain('the load failed: network');
    expect(describeExpectation({ live: true, onboarding: false })).toBe('the live screen, no onboarding');
    expect(describeExpectation({ live: true, liveIdle: true, onboarding: false, screen: 'live', zone: 'channels', index: 0 })).toBe(
      'the live screen, its data requests answered, no onboarding, live · channels 0',
    );
  });

  it("name the focus engine when it disagrees, the category and window, the exit dialog and webOS's exits", () => {
    const onLive = { live: true, liveIdle: true, onboarding: false, screen: 'live', zone: 'rail', index: 1, editing: null, category: 1, top: 0 };
    expect(describeState(state({ ...onLive, hook: 'live/channels/0' }))).toBe('the live screen, live · rail 1, the focus engine at live/channels/0, category 1, rows from 0, no DOM focus, language en, dir="ltr"');
    expect(describeState(state({ ...onLive, screen: 'exit', zone: 'buttons', index: 0, dialog: true }))).toContain('exit · buttons 0, category 1, rows from 0, the exit dialog');
    expect(describeState(state({ ...onLive, platformBack: 2 }))).toContain('platformBack() called 2 times');
    expect(describeExpectation({ screen: 'live', zone: 'channels', index: 10, top: 9 })).toBe('live · channels 10, category *, rows from 9');
    expect(describeExpectation({ screen: 'exit', dialog: true })).toBe('exit · * *, the exit dialog');
    expect(describeExpectation({ dialog: false, platformBack: 1 })).toBe('no exit dialog, platformBack() called 1 time');
  });
});

describe('evaluateWalk', () => {
  it('passes a clean walk in both languages on both platforms', () => {
    for (const platform of ['tizen', 'webos'] as const) {
      expect(evaluateWalk(walk('en', {}, platform), CHECK)).toEqual([]);
      expect(evaluateWalk(walk('ar', {}, platform), CHECK)).toEqual([]);
    }
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
    const failures = evaluateWalk(
      stoppedAt('ar', 'relaunch', { live: false, liveIdle: false, liveCount: null, onboarding: true, screen: 'language', zone: 'languages', index: 0, editing: '', language: 'en', dir: 'ltr' }),
      CHECK,
    );
    expect(failures).toEqual([
      'the relaunch: expected the live screen, its data requests answered, no onboarding, live · channels 0, language ar, dir="rtl", category 0, rows from 0; saw language · languages 0, no DOM focus, language en, dir="ltr"',
    ]);
  });

  it('reports a live screen in the wrong language, one still busy, and one with the wrong channel count', () => {
    expect(evaluateWalk(stoppedAt('ar', 'start-watching', { language: 'en', dir: 'ltr' }), CHECK)[0]).toMatch(
      /^OK on "Start watching": expected the live screen, its data requests answered, live · channels 0, language ar, dir="rtl"; saw the live screen, live · channels 0, .*language en, dir="ltr"$/,
    );
    expect(evaluateWalk(stoppedAt('en', 'relaunch', { liveIdle: false }), CHECK)[0]).toMatch(/^the relaunch: .*; saw the live screen, its data requests still running, live · channels 0/);
    expect(evaluateWalk(changedAt('en', 'start-watching', () => ({ liveCount: 2399 })), CHECK)).toEqual(['OK on "Start watching": the live screen lists 2399 channels, expected 2400']);
    expect(evaluateWalk(changedAt('en', 'relaunch', () => ({ liveCount: 2399 })), CHECK)).toEqual(['the relaunch: the header counts 2399 channels, expected 2400']);
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
    expect(evaluateWalk(changedAt('en', 'add', () => ({ counts: [2399, 600, 0] })), CHECK)).toEqual(['done: counts (live, films, series) 2399, 600, 0, expected 2400, 600, 0']);
    expect(evaluateWalk(walk('en', { phases: ['checking', 'saving'] }), CHECK)).toEqual([
      'loading: the download phase never showed (saw checking, saving)',
      'loading: the guide phase never showed (saw checking, saving)',
    ]);
    expect(evaluateWalk(walk('en', { profile: null }), CHECK)).toEqual(['the stored profile could not be read']);
  });

  it('measures each screen: the canvas, the scroll, the safe area and cut labels', () => {
    const steps = walkSteps('en', LINK, 'tizen').map((s) => {
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
    expect(evaluateWalk(changedAt('en', 'start', () => ({ fonts: 'la400:loaded ar400:error' })), CHECK)).toEqual([
      'fonts: ar400:error failed to load',
      'fonts: no Arabic Zoma Sans face loaded (la400:loaded ar400:error)',
    ]);
  });

  it('reports a walk cut short and a screenshot that failed', () => {
    const steps = walk('en').steps.slice(0, -1);
    expect(evaluateWalk(walk('en', { steps }), CHECK)).toEqual([`only ${steps.length} of ${steps.length + 1} steps ran`]);
    expect(evaluateWalk(walk('en', { screenshotError: 'the engine returned no image' }), CHECK)).toEqual(['screenshot: the engine returned no image']);
  });

  it('times the first screen, the load, the relaunch and the live keys, only for steps that landed', () => {
    expect(stepTime(walk('en'), 'start')).toBe(150);
    expect(stepTime(walk('en'), 'add')).toBe(2000);
    expect(stepTime(walk('en'), 'live-page-down')).toBe(150);
    expect(stepTime(stoppedAt('en', 'add', { error: 'network' }), 'add')).toBeNull();
    expect(stepTime(stoppedAt('en', 'add', { error: 'network' }), 'relaunch')).toBeNull();
  });
});

describe('evaluateWalk on the live screen', () => {
  it("reports a Back key that never reached the app: the list didn't go back to the rail", () => {
    expect(evaluateWalk(stoppedAt('en', 'live-back', { zone: 'channels', index: 0 }), CHECK)).toEqual([
      'Back (key 10009) to the rail: expected the live screen, its data requests answered, live · rail 5, category 5, rows from *; saw the live screen, live · channels 0, category 5, rows from 0, no DOM focus, language en, dir="ltr"',
    ]);
    expect(evaluateWalk(stoppedAt('ar', 'live-back', { zone: 'channels', index: 0 }, 'webos'), CHECK)[0]).toMatch(/^Back \(key 461\) to the rail: expected/);
  });

  it('reports a focus engine that disagrees with the screen it draws', () => {
    expect(evaluateWalk(stoppedAt('en', 'live-down', { hook: 'live/channels/0' }), CHECK)).toEqual([
      'ArrowDown in the list: expected the live screen, its data requests answered, live · channels 1, category *, rows from 0; saw the screen draws live/channels/1, but the focus engine is at live/channels/0',
    ]);
  });

  it('reports a CH− that never paged, and rows that never filled in', () => {
    expect(evaluateWalk(stoppedAt('en', 'live-page-down', { index: 1, top: 0 }), CHECK)[0]).toMatch(
      /^CH− \(key 428\): expected the live screen, its data requests answered, live · channels 10, category \*, rows from 9; saw the live screen, live · channels 1, category 0, rows from 0,/,
    );
    const page = landed(stepOf('live-page-down', 'webos'));
    const rows = page.rows.map((row) => (row.i === 12 ? { ...row, now: null, nowText: null, next: null } : row));
    expect(evaluateWalk(stoppedAt('en', 'live-page-down', { rows }, 'webos'), CHECK)).toEqual([
      'CH− (key 34): expected the live screen, its data requests answered, live · channels 10, category *, rows from 9; saw the rows never filled in: rows 12 show neither a programme nor the placeholder',
    ]);
  });

  it("reports a Tizen Back on the rail that showed no exit dialog, and a webOS one that never called PalmSystem.platformBack()", () => {
    expect(evaluateWalk(stoppedAt('en', 'live-exit', { screen: 'live', zone: 'rail', index: 5, dialog: false, category: 5, liveIdle: true }), CHECK)).toEqual([
      'Back (key 10009) on the rail: expected the live screen, exit · buttons 0, the exit dialog; saw the live screen, live · rail 5, category 5, rows from 0, no DOM focus, language en, dir="ltr"',
    ]);
    expect(evaluateWalk(stoppedAt('en', 'live-exit', { platformBack: 0 }, 'webos'), CHECK)).toEqual([
      'Back (key 461) on the rail: expected the live screen, its data requests answered, live · rail 5, category 5, rows from *, no exit dialog, platformBack() called 1 time; saw the live screen, live · rail 5, category 5, rows from 0, no DOM focus, language en, dir="ltr"',
    ]);
  });

  it('checks the rows against the fixture: the numbers, the names, now/next and the placeholder', () => {
    const walked = changedAt('en', 'relaunch', (there) => ({
      rows: there.rows.map((row) => {
        if (row.i === 0) return { ...row, number: '2', name: 'Zoma Channel 2' };
        if (row.i === 2) return { ...row, next: 'fixture.25 16h' };
        if (row.i === 3) return { ...row, now: 'fixture.37 14h' };
        return row;
      }),
    }));
    expect(evaluateWalk(walked, CHECK)).toEqual([
      'the relaunch: 3 of 9 rows wrong: row 0 (Zoma Channel 1): number "2", expected 1, name "Zoma Channel 2"; row 2 (Zoma Channel 25): next "fixture.25 16h", expected "fixture.25 15h"; row 3 (Zoma Channel 37): a programme "fixture.37 14h" on a channel without a guide',
    ]);
  });

  it('checks the window CH− paged to, and a category numbered by its place in "All channels"', () => {
    expect(evaluateWalk(changedAt('en', 'live-page-down', () => ({ rows: drawn('en', 0, 0).rows })), CHECK)).toEqual(['CH− (key 428): the list draws rows 0–8, expected 9–17']);
    // Numbered from 1 within the category instead of by its place in "All channels".
    const own = changedAt('en', 'live-category', (there) => ({ rows: there.rows.map((row) => ({ ...row, number: String(row.i + 1) })) }));
    expect(evaluateWalk(own, CHECK)).toEqual([
      `OK on category 5: 9 of 9 rows wrong: ${SHOWN.channels
        .slice(0, 5)
        .map((channel, i) => `row ${i} (${channel.name}): number "${i + 1}", expected ${SHOWN.allStart + i + 1}`)
        .join('; ')} and 4 more`,
    ]);
  });

  it('checks the rail: its side, its chips and counts, the one selected, and the header', () => {
    expect(evaluateWalk(changedAt('ar', 'relaunch', () => ({ railSide: 'left' })), CHECK)).toEqual(['the relaunch: the rail is on the left, expected on the right (the inline start)']);
    expect(evaluateWalk(changedAt('en', 'relaunch', () => ({ railSide: 'overlap' })), CHECK)).toEqual(['the relaunch: the rail is over the list, expected on the left (the inline start)']);
    const category = (at: (there: WalkState) => Partial<WalkState>): string[] => evaluateWalk(changedAt('en', 'live-category', at), CHECK);
    expect(category((there) => ({ chips: there.chips.map((chip) => ({ ...chip, selected: chip.i === 0 })) }))).toEqual(['OK on category 5: rail: chips 0 selected, expected 5']);
    expect(category((there) => ({ chips: there.chips.map((chip) => ({ ...chip, selected: chip.i === 0 || chip.i === 5 })) }))).toEqual(['OK on category 5: rail: chips 0, 5 selected, expected 5']);
    expect(category((there) => ({ chips: there.chips.map((chip) => (chip.i === 5 ? { ...chip, count: '17' } : chip)) }))).toEqual([
      `OK on category 5: rail: chip 5: count "17", expected ${SHOWN.channels.length}`,
    ]);
    expect(category((there) => ({ chips: there.chips.map((chip) => (chip.i === 2 ? { ...chip, label: ' Group 2 ' } : chip.i === 3 ? { ...chip, label: 'Group 9' } : chip)) }))).toEqual([
      'OK on category 5: rail: chip 3: "Group 9", expected "Group 3"',
    ]);
    expect(category((there) => ({ chips: there.chips.slice(1) }))[0]).toBe('OK on category 5: the rail draws chips 1–11, expected 0 onwards');
    expect(category(() => ({ heading: 'Group 2' }))).toEqual(['OK on category 5: the header names "Group 2", expected "Group 5"']);
    expect(category(() => ({ liveCount: 2400 }))).toEqual([`OK on category 5: the header counts 2400 channels, expected ${SHOWN.channels.length}`]);
  });

  it('measures the live screen, its next window, a category and the exit dialog', () => {
    expect(evaluateWalk(changedAt('en', 'relaunch', () => ({ outside: ['z-chip: All channels'] })), CHECK)).toEqual(['on the live screen: outside the safe area: z-chip: All channels']);
    expect(evaluateWalk(changedAt('ar', 'live-exit', () => ({ cut: ['z-button__label: البقاء'] })), CHECK)).toEqual(['on the exit dialog screen: labels cut: z-button__label: البقاء']);
    expect(evaluateWalk(changedAt('en', 'live-page-down', () => ({ scroll: [1920, 1100] })), CHECK)).toEqual(['on the paged live screen: the page scrolls: it is 1920x1100']);
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
    const first = stepOf('start');
    const blind = walk('en', { steps: [{ ...record(first, landed(first), false), state: null }] });
    const failures = evaluateOnboarding(run([blind, { ...blind, language: 'ar' }]), { major: 53 }, CHECK);
    expect(failures[0]).toBe('the page state could not be read at all');
    expect(failures).toContain('the first start: expected language · languages 0, language en; saw the page could not be read');
  });
});
