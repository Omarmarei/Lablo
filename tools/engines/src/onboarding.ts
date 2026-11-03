/**
 * Onboarding (RELAY step 13c) in an old engine: what a TV opens on its first start (no
 * `?screen=`), walked by the remote's keys from the built bundle on file://, once in English
 * and once in Arabic. e2e/onboarding.spec.ts walks the same flow in current Chromium; here it
 * runs in Chromium 53/56/68:
 * 1. A fresh start: the app's database is deleted from a blank page of the same file:// origin
 *    (`BLANK_URL`), so no earlier run's source skips onboarding. The start waits for the
 *    profile from the query worker (a spinner, `data-ready="false"`); the walk times it.
 * 2. Language (English, or ArrowRight to العربية: `<html dir="rtl">` after it), disclaimer,
 *    consent (the buttons' row is mirrored in Arabic: LEFT goes to "Not now" there), source
 *    type (ArrowDown to the M3U link), the form.
 * 3. OK on the playlist field gives its input DOM focus (what opens a TV's keyboard). The link
 *    to the harness's fixture playlist is typed without `http://` (the form adds it) as CDP
 *    `char` events: `Input.insertText` is missing in Chromium 53. Backspace deletes inside the
 *    field instead of going back, and OK (key 13) ends the edit.
 * 4. "Add source": loading, then done with the fixture's counts (`data-n`), through the real
 *    data workers. The profile read back from IndexedDB holds the source `s1` and the language.
 * 5. "Start watching" opens the live screen (RELAY step 14a) in the language picked, with the
 *    fixture's live channels, and a relaunch skips onboarding to it. The walk leaves the live
 *    screen only once its data requests have all answered (`data-pending="0"`): leaving while
 *    the workers were still in the database once left Chromium 53 (on CI) with a delete that
 *    never answered.
 * 6. The live screen by the TV's keys (RELAY step 14c, live.ts): ArrowDown, CH− (a window of 9
 *    rows further), CH+, to the rail (LEFT, or RIGHT in Arabic), down to the fifth category, OK
 *    (its channels), Back to the rail, and Back again: the exit dialog on Tizen ("Stay" closes
 *    it), `PalmSystem.platformBack()` on webOS. The rail, the rows and now/next are checked
 *    against the fixture and its guide.
 * Each screen on the way is measured as in the e2e test (1920x1080, the safe area, no label
 * cut), and the form, done, live, category and (Tizen) exit screens are saved as screenshots.
 * At every step the focus engine (`window.__ZOMA_TEST__`, step 14b) and the screen drawing it
 * must agree.
 *
 * The steps, the probes and the evaluation are unit-tested; `runOnboarding` drives a real
 * engine over CDP.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { chromeMajor } from './engines';
import type { DataCheck, ListedCategory } from './fixture';
import { FIXTURE_ORIGIN } from './fixture';
import { SAFE_AREA, VIEWPORT, list } from './gallery';
import type { LiveView } from './live';
import { CHANNELS_VISIBLE, LIVE_BOXES, LIVE_CATEGORY, LIVE_LABELS, LIVE_VIEW_FUNCTION, PLATFORM_BACK_STUB, TV_KEYS, listedEntry, railFailures, rowFailures, rowsFilled, unfilledRows } from './live';
import type { RunOptions, TvPlatform } from './scenario';
import { FONT_FACES_FUNCTION, delay, evaluateFonts, fontsSettled, pressKey, readProbe, waitForProbe, watchErrors } from './scenario';

export type WalkLanguage = 'en' | 'ar';
/** English first: the engine's own locale is English, so English is the language preselected. */
export const WALK_LANGUAGES: readonly WalkLanguage[] = ['en', 'ar'];

/** What a TV opens: no `?screen=`, so the start screen (apps/tv/src/data/params.ts `readScreen`). */
export function onboardingUrl(variant: string, platform: TvPlatform): string {
  return `file:///app/${variant}/${platform}/index.html`;
}

/** A page of the apps' file:// origin with no app on it, next to the staged variants. */
export const BLANK_PAGE = 'blank.html';
export const BLANK_URL = `file:///app/${BLANK_PAGE}`;

export function stageBlankPage(root: string): void {
  writeFileSync(path.join(root, BLANK_PAGE), '<!DOCTYPE html>\n<title>Zoma engines: a page with no app</title>\n');
}

/** The app's database (packages/data `DB_NAME`), its profile store and the profile's key. */
export const APP_DATABASE = { name: 'zoma', profileStore: 'profile', profileKey: 'current' } as const;

/** The playlist field's input (apps/tv onboarding `fieldDomId('playlist')`). */
export const PLAYLIST_INPUT = 'onboarding-playlist';

/** The fixture playlist's link as a user types it: no `http://`, the form adds it. */
export function playlistLink(check: Pick<DataCheck, 'file'>): string {
  return `${FIXTURE_ORIGIN.replace(/^http:\/\//, '')}/${check.file}`;
}

/** The name the form gives a source without one: the link's host. */
export const SOURCE_NAME = new URL(FIXTURE_ORIGIN).hostname;

/** The boxes and labels of `layout()` in e2e/onboarding.spec.ts (test/engines-onboarding.test.ts keeps them equal). */
export const LAYOUT_BOXES = '.z-button, .z-field, .z-progress, .z-spinner, .onboarding__title, .onboarding__text, .onboarding__note, .onboarding__counts';
export const LAYOUT_LABELS = '.z-button__label, .onboarding__title, .z-field__label, .z-field__note';

/** Onboarding and the live screen as the harness sees them. */
export interface WalkState extends LiveView {
  readonly href: string;
  /** The document the walk marked before navigating away (`STALE_MARK`): not the relaunched page yet. */
  readonly stale: boolean;
  readonly userAgent: string;
  readonly bootError: string;
  /** `[data-testid=onboarding][data-ready=true]`: the profile has been read and a screen shows. */
  readonly onboarding: boolean;
  /** `[data-testid=live][data-status=ready]`: the live screen shows its channels. */
  readonly live: boolean;
  /** The live screen has no data request in flight (`data-pending="0"`): its workers are done with the database. */
  readonly liveIdle: boolean;
  /** The live screen's channel count for the category on show (its header's `data-n`; null elsewhere). */
  readonly liveCount: number | null;
  /** `data-screen`, `data-zone`, `data-index` and `data-language` of onboarding or the live screen; onboarding's `data-editing`. */
  readonly screen: string | null;
  readonly zone: string | null;
  readonly index: number | null;
  readonly editing: string | null;
  readonly language: string | null;
  /** The focus engine's `screen/zone/index` (`window.__ZOMA_TEST__.focusPath()`; null without the hook or a screen). */
  readonly hook: string | null;
  /** `<html dir>`. */
  readonly dir: string;
  /** `document.activeElement`: its id, or its tag name without one. */
  readonly active: string | null;
  /** What the playlist field holds (null when it isn't on screen). */
  readonly value: string | null;
  /** The loading screen's `data-phase`, and the failed screen's `data-code`. */
  readonly phase: string | null;
  readonly error: string | null;
  /** The done screen's `data-n`: live, films, series (null elsewhere). */
  readonly counts: readonly [number, number, number] | null;
  readonly viewport: readonly [number, number];
  readonly scroll: readonly [number, number];
  readonly outside: readonly string[];
  readonly cut: readonly string[];
  readonly fontsStatus: string | null;
  readonly fonts: string | null;
}

/** Evaluated inside the page on every engine, so it is plain ES5 (a unit test parses it at ecmaVersion 5). */
export const WALK_EXPRESSION = `(function () {
  ${FONT_FACES_FUNCTION}
  ${LIVE_VIEW_FUNCTION}
  var SAFE = ${JSON.stringify(SAFE_AREA)};
  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }
  function name(el) {
    return el.getAttribute('class') + ': ' + (el.textContent || '').slice(0, 40);
  }
  function count(id) {
    var el = document.querySelector('[data-testid="' + id + '"]');
    return el ? Number(el.getAttribute('data-n')) : null;
  }
  var root = document.documentElement;
  var ob = document.querySelector('[data-testid="onboarding"]');
  var live = document.querySelector('[data-testid="live"]');
  var shown = ob || live;
  var outside = [];
  all(live ? '${LIVE_BOXES}' : '${LAYOUT_BOXES}').forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.left < SAFE.left || r.top < SAFE.top || r.right > SAFE.right + 0.5 || r.bottom > SAFE.bottom + 0.5) outside.push(name(el));
  });
  var cut = all(live ? '${LIVE_LABELS}' : '${LAYOUT_LABELS}')
    .filter(function (el) { return el.scrollWidth > el.clientWidth + 1; })
    .map(name);
  var view = liveView(live);
  var hook = window.__ZOMA_TEST__;
  var liveCount = live ? live.querySelector('[data-testid="live-meta"] [data-n]') : null;
  var input = document.getElementById('${PLAYLIST_INPUT}');
  var status = document.querySelector('[data-testid="load-status"]');
  var error = document.querySelector('[data-testid="load-error"]');
  var active = document.activeElement;
  var done = count('done-live');
  var boot = document.getElementById('boot-error');
  return JSON.stringify({
    href: location.href,
    stale: window.__zomaStale === true,
    userAgent: navigator.userAgent,
    bootError: boot ? boot.textContent : '',
    onboarding: ob !== null && ob.getAttribute('data-ready') === 'true',
    live: live !== null && live.getAttribute('data-status') === 'ready',
    liveIdle: live !== null && live.getAttribute('data-status') === 'ready' && live.getAttribute('data-pending') === '0',
    liveCount: liveCount ? Number(liveCount.getAttribute('data-n')) : null,
    screen: shown ? shown.getAttribute('data-screen') : null,
    zone: shown ? shown.getAttribute('data-zone') : null,
    index: shown && shown.hasAttribute('data-index') ? Number(shown.getAttribute('data-index')) : null,
    editing: ob ? ob.getAttribute('data-editing') : null,
    language: shown ? shown.getAttribute('data-language') : null,
    hook: hook && hook.focusPath ? hook.focusPath() : null,
    category: view.category,
    top: view.top,
    heading: view.heading,
    chips: view.chips,
    rows: view.rows,
    railSide: view.railSide,
    dialog: view.dialog,
    platformBack: view.platformBack,
    clock: view.clock,
    dir: root.getAttribute('dir') || '',
    active: active ? active.id || active.tagName : null,
    value: input ? input.value : null,
    phase: status ? status.getAttribute('data-phase') : null,
    error: error ? error.getAttribute('data-code') : null,
    counts: done === null ? null : [done, count('done-movies'), count('done-series')],
    viewport: [window.innerWidth, window.innerHeight],
    scroll: [root.scrollWidth, root.scrollHeight],
    outside: outside,
    cut: cut,
    fontsStatus: document.fonts ? document.fonts.status : null,
    fonts: fonts()
  });
})()`;

/** Marks the page before a relaunch: the same address loads again, and the old page must not count. */
export const STALE_MARK = `(function () { window.__zomaStale = true; return JSON.stringify(true); })()`;

/**
 * Deletes the app's database from the blank page, then (`RESET_RESULT`) reads how it went:
 * `ok`, `error: <name>`, or `blocked` while a connection is still open (then `ok` once it closes).
 */
export const RESET_EXPRESSION = `(function () {
  window.__zomaReset = 'pending';
  var request = indexedDB.deleteDatabase('${APP_DATABASE.name}');
  request.onsuccess = function () { window.__zomaReset = 'ok'; };
  request.onerror = function () { window.__zomaReset = 'error: ' + (request.error ? request.error.name : 'unknown'); };
  request.onblocked = function () { window.__zomaReset = 'blocked'; };
  return JSON.stringify(location.href);
})()`;
export const RESET_RESULT = `JSON.stringify({ href: location.href, reset: window.__zomaReset || 'none' })`;

/** Records each loading phase the screen shows (as `recordPhases` in the e2e test), from before "Add source". */
export const PHASES_EXPRESSION = `(function () {
  var seen = [];
  window.__zomaPhases = seen;
  new MutationObserver(function () {
    var el = document.querySelector('[data-testid="load-status"]');
    var phase = el ? el.getAttribute('data-phase') : null;
    if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
  return JSON.stringify(seen);
})()`;
export const PHASES_RESULT = `JSON.stringify(window.__zomaPhases || null)`;

/** The stored profile, as much of it as the walk checks (never the link or a login). */
export interface StoredProfile {
  /** `[id, type, name]` of each source; null when there is no profile at all. */
  readonly sources: ReadonlyArray<readonly [string, string, string]> | null;
  readonly language: string | null;
  readonly consent: boolean | null;
  /** What went wrong reading it. */
  readonly error?: string;
}

/**
 * Reads the profile from IndexedDB once the app has opened the database (an open without a
 * version before that would create an empty one). `PROFILE_RESULT` polls for the answer.
 */
export const PROFILE_EXPRESSION = `(function () {
  window.__zomaProfile = null;
  function done(value) { window.__zomaProfile = JSON.stringify(value); }
  function failed(error) { done({ sources: null, language: null, consent: null, error: String(error && error.name || error) }); }
  var open = indexedDB.open('${APP_DATABASE.name}');
  open.onerror = function () { failed(open.error); };
  open.onsuccess = function () {
    var db = open.result;
    try {
      var request = db.transaction('${APP_DATABASE.profileStore}').objectStore('${APP_DATABASE.profileStore}').get('${APP_DATABASE.profileKey}');
      request.onsuccess = function () {
        db.close();
        var doc = request.result ? request.result.doc : null;
        if (!doc) return done({ sources: null, language: null, consent: null });
        var onboarding = doc.onboarding || {};
        done({
          sources: (doc.sources || []).map(function (s) { return [s.id, s.type, s.name]; }),
          language: onboarding.language === undefined ? null : onboarding.language,
          consent: onboarding.consent === undefined ? null : onboarding.consent
        });
      };
      request.onerror = function () { db.close(); failed(request.error); };
    } catch (error) {
      db.close();
      failed(error);
    }
  };
  return JSON.stringify('reading');
})()`;
export const PROFILE_RESULT = `(function () { return window.__zomaProfile || null; })()`;

/** Where the walk must be after a step: every field given must match. */
export interface Expectation {
  readonly onboarding?: boolean;
  readonly live?: boolean;
  readonly liveIdle?: boolean;
  readonly screen?: string;
  readonly zone?: string;
  readonly index?: number;
  /** The field being edited (`''`: none). */
  readonly editing?: string;
  /** `document.activeElement`'s id (or tag name). */
  readonly active?: string;
  readonly value?: string;
  readonly language?: string;
  readonly dir?: string;
  /** The live screen: the rail entry on show, the list's first row, the exit dialog, the webOS exits. */
  readonly category?: number;
  readonly top?: number;
  readonly dialog?: boolean;
  readonly platformBack?: number;
}

export type Key = { readonly key: string; readonly keyCode: number };
/** The screens a walk saves: the typed form, the done screen, the live screen, a category, the exit dialog (Tizen). */
export type WalkShot = 'form' | 'done' | 'live' | 'category' | 'exit';
const KEY = {
  enter: { key: 'Enter', keyCode: 13 },
  up: { key: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', keyCode: 39 },
  backspace: { key: 'Backspace', keyCode: 8 },
} as const satisfies Record<string, Key>;

export type StepId =
  | 'start'
  | 'pick-arabic'
  | 'language'
  | 'disclaimer'
  | 'consent-other'
  | 'consent-back'
  | 'consent'
  | 'source-m3u'
  | 'source'
  | 'open-field'
  | 'type'
  | 'backspace'
  | 'end-edit'
  | 'to-add'
  | 'add'
  | 'start-watching'
  | 'relaunch'
  | 'live-down'
  | 'live-page-down'
  | 'live-page-up'
  | 'live-rail'
  | 'live-pick'
  | 'live-category'
  | 'live-back'
  | 'live-exit'
  | 'live-stay';

export interface WalkStep {
  readonly id: StepId;
  /** What the step does, for failure messages. */
  readonly label: string;
  /** Navigate to the app first (a start or a relaunch). */
  readonly navigate?: boolean;
  /** Evaluated in the page before the keys (a stand-in for a TV API). */
  readonly before?: string;
  /** Remote keys pressed, in order. */
  readonly keys?: readonly Key[];
  /** Typed into the input with DOM focus (CDP `char` events), after the keys. */
  readonly type?: string;
  readonly expect: Expectation;
  /** Measure the screen once there (and wait for its fonts): its name in failure messages. */
  readonly layout?: string;
  /** Check the live screen's rail and header against the fixture once there. */
  readonly rail?: boolean;
  /** Check the live screen's rows against the fixture once there (and wait for each to answer). */
  readonly rows?: boolean;
  /** Save a screenshot of the screen once there. */
  readonly shot?: WalkShot;
  /** Which timeout applies: a start, a key, the load, or a key on the live screen (which waits for its data). */
  readonly wait: 'boot' | 'key' | 'load' | 'live';
}

/**
 * The walk, by keys only. The engine's own locale is English, so English is preselected; in
 * Arabic the app is right to left after the pick, and LEFT/RIGHT swap along a row. The live
 * screen's CH+, CH− and Back keys are the platform's own.
 */
export function walkSteps(language: WalkLanguage, link: string, platform: TvPlatform): WalkStep[] {
  const ar = language === 'ar';
  const next = ar ? KEY.left : KEY.right;
  const back = ar ? KEY.right : KEY.left;
  /** The live screen in the language picked, on the first channel. */
  const onLive: Expectation = { screen: 'live', zone: 'channels', index: 0, language, dir: ar ? 'rtl' : 'ltr' };
  const steps: WalkStep[] = [
    {
      id: 'start',
      label: 'the first start',
      navigate: true,
      expect: { onboarding: true, screen: 'language', zone: 'languages', index: 0, language: 'en' },
      layout: 'language',
      wait: 'boot',
    },
  ];
  if (ar) {
    steps.push({ id: 'pick-arabic', label: 'ArrowRight to العربية', keys: [KEY.right], expect: { screen: 'language', index: 1 }, wait: 'key' });
  }
  steps.push(
    {
      id: 'language',
      label: ar ? 'OK on العربية' : 'OK on English',
      keys: [KEY.enter],
      expect: { screen: 'disclaimer', zone: 'actions', index: 0, language, dir: ar ? 'rtl' : 'ltr' },
      layout: 'disclaimer',
      wait: 'key',
    },
    { id: 'disclaimer', label: 'OK on "I understand"', keys: [KEY.enter], expect: { screen: 'consent', zone: 'actions', index: 0 }, layout: 'consent', wait: 'key' },
    { id: 'consent-other', label: `${next.key} to "Not now"`, keys: [next], expect: { screen: 'consent', index: 1 }, wait: 'key' },
    { id: 'consent-back', label: `${back.key} back to "Allow"`, keys: [back], expect: { screen: 'consent', index: 0 }, wait: 'key' },
    { id: 'consent', label: 'OK on "Allow"', keys: [KEY.enter], expect: { screen: 'source', zone: 'types', index: 0 }, layout: 'source', wait: 'key' },
    { id: 'source-m3u', label: 'ArrowDown to the M3U link', keys: [KEY.down], expect: { screen: 'source', index: 1 }, wait: 'key' },
    { id: 'source', label: 'OK on the M3U link', keys: [KEY.enter], expect: { screen: 'form', zone: 'fields', index: 0, value: '' }, wait: 'key' },
    {
      id: 'open-field',
      label: 'OK on the playlist field',
      keys: [KEY.enter],
      expect: { screen: 'form', editing: PLAYLIST_INPUT, active: PLAYLIST_INPUT },
      wait: 'key',
    },
    { id: 'type', label: `typing "${link}x"`, type: `${link}x`, expect: { editing: PLAYLIST_INPUT, value: `${link}x` }, wait: 'key' },
    {
      id: 'backspace',
      label: 'Backspace in the field',
      keys: [KEY.backspace],
      expect: { screen: 'form', editing: PLAYLIST_INPUT, active: PLAYLIST_INPUT, value: link },
      wait: 'key',
    },
    {
      id: 'end-edit',
      label: 'OK (key 13) in the field',
      keys: [KEY.enter],
      expect: { screen: 'form', zone: 'fields', index: 1, editing: '', active: 'BODY', value: link },
      layout: 'form',
      shot: 'form',
      wait: 'key',
    },
    { id: 'to-add', label: 'ArrowDown twice to "Add source"', keys: [KEY.down, KEY.down], expect: { screen: 'form', zone: 'actions', index: 0 }, wait: 'key' },
    { id: 'add', label: 'OK on "Add source"', keys: [KEY.enter], expect: { screen: 'done', zone: 'actions', index: 0 }, layout: 'done', shot: 'done', wait: 'load' },
    {
      id: 'start-watching',
      label: 'OK on "Start watching"',
      keys: [KEY.enter],
      expect: { ...onLive, live: true, liveIdle: true },
      shot: 'live',
      wait: 'boot',
    },
    {
      id: 'relaunch',
      label: 'the relaunch',
      navigate: true,
      expect: { ...onLive, live: true, liveIdle: true, onboarding: false, category: 0, top: 0 },
      layout: 'live',
      rail: true,
      rows: true,
      wait: 'boot',
    },
  );
  steps.push(...liveSteps(language, platform));
  return steps;
}

/**
 * The live screen by keys, from its first channel after the relaunch. Every step waits for the
 * screen's data requests to answer (`data-pending="0"`), so the walk never leaves it busy.
 */
export function liveSteps(language: WalkLanguage, platform: TvPlatform): WalkStep[] {
  const tv = TV_KEYS[platform];
  // The rail is at the inline start: LEFT of the list, or RIGHT of it in Arabic.
  const toRail = language === 'ar' ? KEY.right : KEY.left;
  const at = (zone: string, index: number, more: Expectation = {}): Expectation => ({ screen: 'live', zone, index, live: true, liveIdle: true, ...more });
  const steps: WalkStep[] = [
    { id: 'live-down', label: 'ArrowDown in the list', keys: [KEY.down], expect: at('channels', 1, { top: 0 }), wait: 'live' },
    {
      id: 'live-page-down',
      label: `CH− (key ${tv.chDown.keyCode})`,
      keys: [tv.chDown],
      expect: at('channels', 1 + CHANNELS_VISIBLE, { top: CHANNELS_VISIBLE }),
      layout: 'paged live',
      rows: true,
      wait: 'live',
    },
    { id: 'live-page-up', label: `CH+ (key ${tv.chUp.keyCode})`, keys: [tv.chUp], expect: at('channels', 1, { top: 0 }), wait: 'live' },
    { id: 'live-rail', label: `${toRail.key} to the rail`, keys: [toRail], expect: at('rail', 0, { category: 0 }), wait: 'live' },
    {
      id: 'live-pick',
      label: `ArrowDown ${LIVE_CATEGORY} times to category ${LIVE_CATEGORY}`,
      keys: Array.from({ length: LIVE_CATEGORY }, () => KEY.down),
      expect: at('rail', LIVE_CATEGORY, { category: 0 }),
      wait: 'live',
    },
    {
      id: 'live-category',
      label: `OK on category ${LIVE_CATEGORY}`,
      keys: [KEY.enter],
      expect: at('channels', 0, { category: LIVE_CATEGORY, top: 0 }),
      layout: 'category',
      rail: true,
      rows: true,
      shot: 'category',
      wait: 'live',
    },
    { id: 'live-back', label: `Back (key ${tv.back.keyCode}) to the rail`, keys: [tv.back], expect: at('rail', LIVE_CATEGORY, { category: LIVE_CATEGORY }), wait: 'live' },
  ];
  if (platform === 'tizen') {
    steps.push(
      {
        id: 'live-exit',
        label: `Back (key ${tv.back.keyCode}) on the rail`,
        keys: [tv.back],
        expect: { screen: 'exit', zone: 'buttons', index: 0, live: true, dialog: true },
        layout: 'exit dialog',
        shot: 'exit',
        wait: 'live',
      },
      { id: 'live-stay', label: 'OK on "Stay"', keys: [KEY.enter], expect: at('rail', LIVE_CATEGORY, { category: LIVE_CATEGORY, dialog: false }), wait: 'live' },
    );
  } else {
    steps.push({
      id: 'live-exit',
      label: `Back (key ${tv.back.keyCode}) on the rail`,
      before: PLATFORM_BACK_STUB,
      keys: [tv.back],
      expect: at('rail', LIVE_CATEGORY, { category: LIVE_CATEGORY, dialog: false, platformBack: 1 }),
      wait: 'live',
    });
  }
  return steps;
}

export function matches(state: WalkState, expect: Expectation): boolean {
  return (Object.keys(expect) as Array<keyof Expectation>).every((key) => expect[key] === state[key]);
}

/** The focus the screen on show draws, as a path (null: no screen draws one). */
export const drawnPath = (state: Pick<WalkState, 'screen' | 'zone' | 'index'>): string | null =>
  state.screen === null ? null : `${state.screen}/${state.zone ?? '-'}/${state.index ?? '-'}`;

/**
 * Why a step whose expectation holds has not landed yet (null: it has): the focus engine and the
 * screen disagree, a measured screen's fonts are still loading, or rows still wait for their data.
 */
export function settling(step: Pick<WalkStep, 'layout' | 'rows'>, state: WalkState): string | null {
  const drawn = drawnPath(state);
  if (drawn !== null && state.hook !== drawn) return `the screen draws ${drawn}, but the focus engine is at ${state.hook ?? 'nothing'}`;
  if (step.layout !== undefined && (state.fontsStatus === 'loading' || !fontsSettled(state.fonts))) {
    return `the fonts did not settle (${state.fontsStatus ?? '-'}: ${state.fonts ?? '-'})`;
  }
  if (step.rows === true && !rowsFilled(state)) return `the rows never filled in: ${unfilledRows(state)}`;
  return null;
}

/** `form · fields 0, editing onboarding-playlist, DOM focus on onboarding-playlist, link "…"`. */
export function describeState(state: WalkState): string {
  const parts: string[] = [];
  if (state.bootError.trim() !== '') parts.push(`boot error: ${state.bootError.trim().split('\n').join(' | ')}`);
  if (state.live) parts.push(state.liveIdle ? 'the live screen' : 'the live screen, its data requests still running');
  if (state.screen !== null) parts.push(`${state.screen} · ${state.zone ?? '-'} ${state.index ?? '-'}`);
  else if (!state.live) parts.push(state.onboarding ? 'onboarding' : 'no screen yet');
  if (state.screen !== null && !state.onboarding && !state.live) parts.push('not ready');
  const drawn = drawnPath(state);
  if (drawn !== null && state.hook !== drawn) parts.push(`the focus engine at ${state.hook ?? 'nothing'}`);
  if (state.live) parts.push(`category ${state.category ?? '-'}, rows from ${state.top ?? '-'}`);
  if (state.dialog) parts.push('the exit dialog');
  if (state.platformBack > 0) parts.push(`platformBack() called ${state.platformBack} time${state.platformBack === 1 ? '' : 's'}`);
  if (state.editing !== null && state.editing !== '') parts.push(`editing ${state.editing}`);
  if (state.active !== null && state.active !== 'BODY') parts.push(`DOM focus on ${state.active}`);
  else parts.push('no DOM focus');
  if (state.value !== null) parts.push(`link "${state.value}"`);
  if (state.language !== null) parts.push(`language ${state.language}, dir="${state.dir}"`);
  if (state.phase !== null) parts.push(`loading: ${state.phase}`);
  if (state.error !== null) parts.push(`the load failed: ${state.error}`);
  return parts.join(', ');
}

export function describeExpectation(expect: Expectation): string {
  const parts: string[] = [];
  if (expect.live === true) parts.push(expect.liveIdle === true ? 'the live screen, its data requests answered' : 'the live screen');
  if (expect.onboarding === false) parts.push('no onboarding');
  if (expect.screen !== undefined) parts.push(`${expect.screen} · ${expect.zone ?? '*'} ${expect.index ?? '*'}`);
  else if (expect.index !== undefined) parts.push(`item ${expect.index}`);
  if (expect.editing !== undefined) parts.push(expect.editing === '' ? 'no edit' : `editing ${expect.editing}`);
  if (expect.active !== undefined) parts.push(expect.active === 'BODY' ? 'no DOM focus' : `DOM focus on ${expect.active}`);
  if (expect.value !== undefined) parts.push(`link "${expect.value}"`);
  if (expect.language !== undefined) parts.push(`language ${expect.language}${expect.dir === undefined ? '' : `, dir="${expect.dir}"`}`);
  if (expect.category !== undefined || expect.top !== undefined) parts.push(`category ${expect.category ?? '*'}, rows from ${expect.top ?? '*'}`);
  if (expect.dialog !== undefined) parts.push(expect.dialog ? 'the exit dialog' : 'no exit dialog');
  if (expect.platformBack !== undefined) parts.push(`platformBack() called ${expect.platformBack} time${expect.platformBack === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/**
 * Has the step landed? Its expectation holds, the focus engine agrees with the screen, a
 * measured screen's fonts have settled, and checked rows have their data.
 */
export function stepLanded(step: Pick<WalkStep, 'expect' | 'layout' | 'rows'>, state: WalkState): boolean {
  return matches(state, step.expect) && settling(step, state) === null;
}

/**
 * A step can't land any more: the app failed at boot, the load failed, or the start has already
 * decided on onboarding where it had to skip it (a relaunch that lost the source).
 */
export const stepStuck = (step: Pick<WalkStep, 'expect'>, state: WalkState): boolean =>
  state.bootError.trim() !== '' || state.error !== null || (step.expect.onboarding === false && state.onboarding);

export interface StepRecord {
  readonly id: StepId;
  readonly label: string;
  readonly expect: Expectation;
  readonly layout: string | null;
  readonly met: boolean;
  /** The last state read (null if the page could never be read). */
  readonly state: WalkState | null;
  /** From the step's first key (or navigation) to the state that met it. */
  readonly ms: number;
}

export interface Walk {
  readonly language: WalkLanguage;
  /** The app walked: its live screen's keys and exit are the platform's. */
  readonly platform: TvPlatform;
  /** How deleting the app's database before the walk went: `ok`, or what stopped it. */
  readonly reset: string;
  /** The steps that ran, in order; the walk stops at the first one that didn't land. */
  readonly steps: readonly StepRecord[];
  /** The loading phases seen (null when the load never started). */
  readonly phases: readonly string[] | null;
  readonly profile: StoredProfile | null;
  readonly screenshots: readonly string[];
  readonly screenshotError: string | null;
}

export interface OnboardingRun {
  readonly platform: TvPlatform;
  readonly url: string;
  readonly walks: readonly Walk[];
  /** How deleting the database after the last walk went (`ok`): later runs in the engine start without the source. */
  readonly cleanup: string;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

/** What the fixture playlist gives the done screen: live channels, films, series. */
export function expectedCounts(check: Pick<DataCheck, 'live' | 'movies'>): readonly [number, number, number] {
  return [check.live, check.movies, 0];
}

/** The screen checks of one state: the TV's canvas, no scroll, the safe area, no label cut. */
function screenFailures(state: WalkState): string[] {
  const failures: string[] = [];
  const [width, height] = state.viewport;
  if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
    failures.push(`the viewport is ${width}x${height}, expected ${VIEWPORT.width}x${VIEWPORT.height}`);
  } else if (state.scroll[0] !== width || state.scroll[1] !== height) {
    failures.push(`the page scrolls: it is ${state.scroll[0]}x${state.scroll[1]}`);
  }
  if (state.outside.length > 0) failures.push(`outside the safe area: ${list(state.outside)}`);
  if (state.cut.length > 0) failures.push(`labels cut: ${list(state.cut)}`);
  return failures;
}

export const stepTime = (walk: Walk, id: StepId): number | null => {
  const step = walk.steps.find((s) => s.id === id);
  return step?.met === true ? step.ms : null;
};

/** What a walk must show: the done screen's counts, and the live screen's categories (fixture.ts `liveCategories`). */
export interface WalkCheck extends Pick<DataCheck, 'live' | 'movies'> {
  readonly categories: readonly ListedCategory[];
}

/** The live screen's rail and rows once a step is there: what the fixture says it must show. */
function liveFailures(step: WalkStep, state: WalkState, check: WalkCheck, language: WalkLanguage): string[] {
  const failures: string[] = [];
  if (step.rail === true) {
    failures.push(...railFailures(state, check.categories, language));
    const entry = state.category === null ? null : listedEntry(check.categories, state.category);
    if (entry !== null && state.liveCount !== entry.channels.length) {
      failures.push(`the header counts ${state.liveCount ?? 'no'} channels, expected ${entry.channels.length}`);
    }
  }
  if (step.rows === true) failures.push(...rowFailures(state, check.categories, language));
  return failures;
}

/** Everything wrong with one walk; empty means it passed. */
export function evaluateWalk(walk: Walk, check: WalkCheck): string[] {
  if (walk.reset !== 'ok') return [`the app's database could not be deleted before the walk (${walk.reset})`];
  const failures: string[] = [];
  const { language } = walk;
  const steps = walkSteps(language, '', walk.platform);
  const first = walk.steps[0];
  if (first?.state != null) failures.push(...evaluateFonts(first.state.fonts));
  for (const step of walk.steps) {
    const spec = steps.find((s) => s.id === step.id);
    if (!step.met) {
      const reason = step.state !== null && spec !== undefined && matches(step.state, step.expect) ? settling(spec, step.state) : null;
      const saw = step.state === null ? 'the page could not be read' : (reason ?? describeState(step.state));
      failures.push(`${step.label}: expected ${describeExpectation(step.expect)}; saw ${saw}`);
      return failures;
    }
    if (step.layout !== null && step.state !== null) failures.push(...screenFailures(step.state).map((f) => `on the ${step.layout} screen: ${f}`));
    if (spec !== undefined && step.state !== null) failures.push(...liveFailures(spec, step.state, check, language).map((f) => `${step.label}: ${f}`));
    if (step.id === 'add' && step.state !== null) {
      const want = expectedCounts(check);
      const got = step.state.counts;
      if (got === null || got.join() !== want.join()) {
        failures.push(`done: counts (live, films, series) ${got === null ? 'missing' : got.join(', ')}, expected ${want.join(', ')}`);
      }
      const phases = walk.phases ?? [];
      for (const phase of ['download', 'guide']) {
        if (!phases.includes(phase)) failures.push(`loading: the ${phase} phase never showed (saw ${phases.length === 0 ? 'none' : phases.join(', ')})`);
      }
      failures.push(...profileFailures(walk.profile, language));
    }
    if (step.id === 'start-watching' && step.state !== null && step.state.liveCount !== check.live) {
      failures.push(`${step.label}: the live screen lists ${step.state.liveCount ?? 'no'} channels, expected ${check.live}`);
    }
  }
  if (walk.steps.length < steps.length) failures.push(`only ${walk.steps.length} of ${steps.length} steps ran`);
  if (walk.screenshotError !== null) failures.push(`screenshot: ${walk.screenshotError}`);
  return failures;
}

/** The profile after the load: the one source, as `s1` with the host's name, and the answers given. */
export function profileFailures(profile: StoredProfile | null, language: WalkLanguage): string[] {
  if (profile === null) return ['the stored profile could not be read'];
  if (profile.error !== undefined) return [`the stored profile could not be read: ${profile.error}`];
  const failures: string[] = [];
  const want = `s1,m3u,${SOURCE_NAME}`;
  const sources = profile.sources === null ? 'no profile' : profile.sources.map((s) => s.join(',')).join('; ') || 'none';
  if (sources !== want) failures.push(`the stored profile has the sources ${sources}, expected ${want}`);
  if (profile.language !== language || profile.consent !== true) {
    failures.push(`the stored answers are language ${profile.language ?? '-'}, consent ${String(profile.consent)}, expected ${language} and true`);
  }
  return failures;
}

/** Everything wrong with one onboarding run; empty means it passed. The Arabic walk's failures say so. */
export function evaluateOnboarding(run: OnboardingRun, engine: Pick<Engine, 'major'>, check: WalkCheck): string[] {
  const failures: string[] = [];
  const userAgent = run.walks.flatMap((w) => w.steps).find((s) => s.state !== null)?.state?.userAgent ?? null;
  if (userAgent === null) failures.push('the page state could not be read at all');
  else {
    const major = chromeMajor(userAgent);
    if (major !== engine.major) failures.push(`the engine reports Chrome ${major ?? '?'} ("${userAgent}"), expected ${engine.major}`);
  }
  for (const language of WALK_LANGUAGES) {
    const walk = run.walks.find((w) => w.language === language);
    const prefix = language === 'ar' ? 'in Arabic: ' : '';
    if (walk === undefined) failures.push(`${prefix}the walk did not run`);
    else failures.push(...evaluateWalk(walk, check).map((f) => `${prefix}${f}`));
  }
  if (run.cleanup !== 'ok') failures.push(`the app's database could not be deleted after the walks (${run.cleanup})`);
  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

/** Long enough for the focus ring's transition (`--motion-fast`, 120 ms) to end before a screenshot. */
const SETTLE_MS = 400;
const RESET_TIMEOUT_MS = 20_000;

export interface OnboardingOptions extends RunOptions {
  readonly loadTimeoutMs: number;
  /** A key on the live screen: the focus moves, then its rows' data and the 600 ms focus wait answer. */
  readonly liveTimeoutMs: number;
  /** Where a walk's screenshot goes (null: none). */
  readonly screenshot: ((language: WalkLanguage, screen: WalkShot) => string) | null;
  readonly save: (file: string, png: Buffer) => void;
}

/** Deletes the app's database from the blank page (no app page open, or the delete would wait for it). */
export async function resetDatabase(client: CdpClient): Promise<string> {
  await client.send('Page.navigate', { url: BLANK_URL });
  const blank = await waitForProbe<string>(client, 'JSON.stringify(location.href)', (href) => href === BLANK_URL, 5_000);
  if (!blank.met) return `the blank page did not open (at ${blank.state ?? 'nothing'})`;
  await readProbe<string>(client, RESET_EXPRESSION);
  const done = await waitForProbe<{ href: string; reset: string }>(
    client,
    RESET_RESULT,
    (r) => r.href === BLANK_URL && (r.reset === 'ok' || r.reset.startsWith('error')),
    RESET_TIMEOUT_MS,
  );
  return done.state?.reset ?? 'no answer';
}

async function typeText(client: CdpClient, text: string): Promise<void> {
  for (const ch of text) await client.send('Input.dispatchKeyEvent', { type: 'char', text: ch, unmodifiedText: ch, key: ch });
}

/** One walk in one language: a fresh database, then the steps until one doesn't land. */
async function walkOnce(
  client: CdpClient,
  platform: TvPlatform,
  url: string,
  language: WalkLanguage,
  link: string,
  options: OnboardingOptions,
  watch: ReturnType<typeof watchErrors>,
): Promise<Walk> {
  const reset = await resetDatabase(client);
  const records: StepRecord[] = [];
  const screenshots: string[] = [];
  let screenshotError: string | null = null;
  let phases: string[] | null = null;
  let profile: StoredProfile | null = null;
  if (reset !== 'ok') return { language, platform, reset, steps: records, phases, profile, screenshots, screenshotError };

  const timeouts = { boot: options.bootTimeoutMs, key: options.keyTimeoutMs, load: options.loadTimeoutMs, live: options.liveTimeoutMs };
  for (const step of walkSteps(language, link, platform)) {
    const started = Date.now();
    if (step.id === 'add') await readProbe<string[]>(client, PHASES_EXPRESSION);
    if (step.navigate === true) {
      await readProbe<boolean>(client, STALE_MARK);
      await client.send('Page.navigate', { url });
    }
    if (step.before !== undefined) await readProbe<unknown>(client, step.before);
    for (const key of step.keys ?? []) await pressKey(client, key);
    if (step.type !== undefined) await typeText(client, step.type);
    const timeout = timeouts[step.wait];
    const landed = await waitForProbe<WalkState>(
      client,
      WALK_EXPRESSION,
      (state) => state.href === url && !state.stale && (stepLanded(step, state) || stepStuck(step, state) || watch.erroredOut()),
      timeout,
    );
    const met = landed.state !== null && landed.state.href === url && !landed.state.stale && stepLanded(step, landed.state);
    records.push({ id: step.id, label: step.label, expect: step.expect, layout: step.layout ?? null, met, state: landed.state, ms: Date.now() - started });
    if (step.id === 'add') phases = await readProbe<string[]>(client, PHASES_RESULT);
    if (!met) break;
    if (step.shot !== undefined && options.screenshot !== null) {
      const file = options.screenshot(language, step.shot);
      await delay(SETTLE_MS);
      try {
        const shot = await client.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' });
        if (shot.data === undefined || shot.data === '') throw new Error('the engine returned no image');
        options.save(file, Buffer.from(shot.data, 'base64'));
        screenshots.push(file);
      } catch (error) {
        screenshotError ??= error instanceof Error ? error.message : String(error);
      }
    }
    if (step.id === 'add') {
      await readProbe<string>(client, PROFILE_EXPRESSION);
      profile = (await waitForProbe<StoredProfile>(client, PROFILE_RESULT, () => true, options.keyTimeoutMs)).state;
    }
  }
  return { language, platform, reset, steps: records, phases, profile, screenshots, screenshotError };
}

/**
 * Walks onboarding at `url` in English, then in Arabic, each from a fresh database and on to
 * the live screen's keys, and deletes the database again at the end, so later runs in the engine
 * start without this source. The caller enables the Page and Runtime domains once per
 * connection, and starts the engine full screen (`TV_SCREEN_FLAGS`).
 */
export async function runOnboarding(
  client: CdpClient,
  platform: TvPlatform,
  url: string,
  check: Pick<DataCheck, 'file'>,
  options: OnboardingOptions,
): Promise<OnboardingRun> {
  const started = Date.now();
  const watch = watchErrors(client);
  const walks: Walk[] = [];
  try {
    for (const language of WALK_LANGUAGES) walks.push(await walkOnce(client, platform, url, language, playlistLink(check), options, watch));
    const cleanup = await resetDatabase(client);
    return { platform, url, walks, cleanup, exceptions: watch.errors(), durationMs: Date.now() - started };
  } finally {
    watch.stop();
  }
}
