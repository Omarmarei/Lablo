import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { backupKeys, deriveBackupMaster } from '@lablo/crypto';
import { parse } from 'acorn';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackupRun, BackupStepRecord, BackupWalk, StartState } from './backup-walk';
import {
  DEVICE_ID_URI,
  LUNA_RESULT,
  SIM_LGUDID,
  SIM_PLATFORM,
  START_EXPRESSION,
  UPLOAD_EXPRESSION,
  UPLOAD_RESULT,
  WALK_REQUESTS,
  WEBOS_SIM,
  WEBOS_SIM_BRIDGE,
  WELCOME_TITLES,
  backupSteps,
  backupSummary,
  backupWalkUrl,
  evaluateBackupRun,
  evaluateBackupWalk,
  forgetBackup,
  restoredFailures,
  restoredLanded,
  simLookupId,
  stageWebosSim,
} from './backup-walk';
import { LIVE_TEXT } from './live';
import type { WalkCheck, WalkLanguage, WalkState } from './onboarding';
import { PHONE_NAMES, pairSteps } from './pairing';
import { SAFE_AREA } from './gallery';

/** The wipe walk on the simulated webOS (RELAY step 32d1): its bridge, staging, probes and checks. */

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36';
const LOOKUP = 'L'.repeat(43);

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

function welcomeState(over: Partial<StartState> = {}): StartState {
  return {
    href: 'file:///app/app/webos-sim/index.html',
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

function walk(over: Partial<BackupWalk> = {}): BackupWalk {
  const language = over.language ?? 'en';
  const steps: BackupStepRecord[] = backupSteps(language).map((step) => ({ id: step.id, label: step.label, expect: step.expect, met: true, state: { userAgent: UA } as WalkState, ms: 100 }));
  return {
    language,
    reset: 'ok',
    steps,
    phoneError: null,
    upload: 'sent',
    lunaBefore: [DEVICE_ID_URI, 'luna://com.webos.settingsservice/getSystemSettings', DEVICE_ID_URI],
    wipe: 'ok',
    welcome: welcomeState({ language, dir: language === 'ar' ? 'rtl' : 'ltr', title: WELCOME_TITLES[language] }),
    restored: liveState({}, language),
    welcomeMs: 2100,
    liveMs: 7900,
    lunaAfter: [DEVICE_ID_URI],
    requests: [...WALK_REQUESTS],
    lookupIds: [LOOKUP],
    profile: { sources: [['s1', 'm3u', PHONE_NAMES[language]]], language, consent: true },
    screenshots: [],
    screenshotError: null,
    ...over,
  };
}

describe('the simulated webOS', () => {
  it('opens the staged copy with its API on the forwarded port of the device itself', () => {
    expect(WEBOS_SIM).toBe('webos-sim');
    expect(backupWalkUrl('app')).toBe('file:///app/app/webos-sim/index.html?api=http%3A%2F%2F127.0.0.1%3A8091');
  });

  it('is plain ES5, so it runs before the bundle on every engine', () => {
    expect(() => parse(WEBOS_SIM_BRIDGE, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  /** The bridge run in a realm of its own, with the tasks it queues run on `flush`. */
  function realm() {
    const tasks: Array<() => void> = [];
    // (The realm's global object; not named `window`, which lint keeps for the platform adapters.)
    const page: Record<string, unknown> = {};
    runInNewContext(WEBOS_SIM_BRIDGE, { window: page, setTimeout: (run: () => void) => tasks.push(run) });
    const Bridge = page['PalmServiceBridge'] as new () => { onservicecallback: ((message: string) => void) | null; call(uri: string, params: string): void; cancel(): void };
    const flush = (): void => {
      while (tasks.length > 0) tasks.shift()!();
    };
    return { page, Bridge, flush };
  }

  it("answers the LGUDID's call with the simulated ID, on a later task, as a TV does", () => {
    const { Bridge, flush } = realm();
    const bridge = new Bridge();
    const answers: string[] = [];
    bridge.onservicecallback = (message) => answers.push(message);
    bridge.call(DEVICE_ID_URI, '{"idType":["LGUDID"]}');
    expect(answers).toEqual([]);
    flush();
    expect(answers.map((a) => JSON.parse(a) as unknown)).toEqual([{ returnValue: true, idList: [{ idType: 'LGUDID', idValue: SIM_LGUDID }] }]);
  });

  it('refuses every other call, and records each URI asked', () => {
    const { page, Bridge, flush } = realm();
    const bridge = new Bridge();
    const answers: string[] = [];
    bridge.onservicecallback = (message) => answers.push(message);
    bridge.call('luna://com.webos.settingsservice/getSystemSettings', '{}');
    flush();
    expect(JSON.parse(answers[0]!)).toMatchObject({ returnValue: false });
    new Bridge().call(DEVICE_ID_URI, '{}');
    expect(JSON.parse(String(runInNewContext(LUNA_RESULT, { window: page, JSON })))).toEqual(['luna://com.webos.settingsservice/getSystemSettings', DEVICE_ID_URI]);
  });

  it('answers nothing after a cancel', () => {
    const { Bridge, flush } = realm();
    const bridge = new Bridge();
    const answers: string[] = [];
    bridge.onservicecallback = (message) => answers.push(message);
    bridge.call(DEVICE_ID_URI, '{}');
    bridge.cancel();
    flush();
    expect(answers).toEqual([]);
  });

  it('reads no calls on a page without the bridge', () => {
    expect(runInNewContext(LUNA_RESULT, { window: {}, JSON })).toBe('null');
  });

  it("derives the lookup ID the app derives from the simulated LGUDID on webOS (the salt's platform and app id)", async () => {
    expect(SIM_PLATFORM).toBe('webos');
    expect(await simLookupId('com.lablo.iptv')).toBe(backupKeys(await deriveBackupMaster('lablo-sim-lgudid-32d1', 'webos', 'com.lablo.iptv')).lookupId);
  });
});

describe('stageWebosSim', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function variant(appinfo: string | null = '{"id":"com.example.tv","version":"1.0.0"}'): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-sim-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'webos', 'assets'), { recursive: true });
    writeFileSync(path.join(dir, 'webos', 'main.js'), 'var app = 1;');
    writeFileSync(path.join(dir, 'webos', 'index.html'), '<script src="main.js"></script>');
    writeFileSync(path.join(dir, 'webos', 'assets', 'font.woff2'), 'font');
    if (appinfo !== null) writeFileSync(path.join(dir, 'webos', 'appinfo.json'), appinfo);
    return dir;
  }

  it('copies the webOS build beside it with the bridge before its main.js, and answers its app id', () => {
    const dir = variant();
    expect(stageWebosSim(dir)).toBe('com.example.tv');
    expect(readFileSync(path.join(dir, WEBOS_SIM, 'main.js'), 'utf8')).toBe(`${WEBOS_SIM_BRIDGE}var app = 1;`);
    expect(readFileSync(path.join(dir, WEBOS_SIM, 'index.html'), 'utf8')).toBe('<script src="main.js"></script>');
    expect(readFileSync(path.join(dir, WEBOS_SIM, 'assets', 'font.woff2'), 'utf8')).toBe('font');
    // The build itself is untouched.
    expect(readFileSync(path.join(dir, 'webos', 'main.js'), 'utf8')).toBe('var app = 1;');
  });

  it('replaces an earlier copy whole', () => {
    const dir = variant();
    stageWebosSim(dir);
    writeFileSync(path.join(dir, WEBOS_SIM, 'stale.js'), 'old');
    stageWebosSim(dir);
    expect(existsSync(path.join(dir, WEBOS_SIM, 'stale.js'))).toBe(false);
    expect(readFileSync(path.join(dir, WEBOS_SIM, 'main.js'), 'utf8')).toBe(`${WEBOS_SIM_BRIDGE}var app = 1;`);
  });

  it('refuses a variant with no webOS build, and a build with no app id', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'lablo-sim-'));
    dirs.push(empty);
    expect(() => stageWebosSim(empty)).toThrow(/has no main\.js/);
    expect(() => stageWebosSim(variant('{"version":"1.0.0"}'))).toThrow(/has no id/);
    expect(() => stageWebosSim(variant('{"id":""}'))).toThrow(/has no id/);
  });
});

describe('the walk', () => {
  it('walks onboarding by phone, then "Start watching" to the live screen in the walk\'s language', () => {
    for (const language of ['en', 'ar'] as const) {
      const steps = backupSteps(language);
      expect(steps.slice(0, -1)).toEqual(pairSteps(language));
      expect(steps[steps.length - 1]).toEqual({
        id: 'watch',
        label: 'OK on "Start watching"',
        keys: [{ key: 'Enter', keyCode: 13 }],
        expect: { live: true, liveIdle: true, screen: 'live', zone: 'channels', index: 0, language, dir: language === 'ar' ? 'rtl' : 'ltr' },
        wait: 'boot',
      });
    }
  });

  it('forgets only its own backup on the stand-in', () => {
    const standIn = { blobs: new Map([[LOOKUP, '{}'], ['other', '{}']]), hashes: new Map([[LOOKUP, 'h'], ['other', 'h']]) };
    forgetBackup(standIn, LOOKUP);
    expect([...standIn.blobs.keys()]).toEqual(['other']);
    expect([...standIn.hashes.keys()]).toEqual(['other']);
  });

  it('expects the live screen in its language, on the first channel, its rows filled', () => {
    expect(restoredLanded(liveState(), 'en')).toBe(true);
    expect(restoredLanded(liveState({}, 'ar'), 'ar')).toBe(true);
    expect(restoredLanded(liveState({ live: false }), 'en')).toBe(false);
    expect(restoredLanded(liveState({ liveIdle: false }), 'en')).toBe(false);
    expect(restoredLanded(liveState({ screen: 'settings' }), 'en')).toBe(false);
    expect(restoredLanded(liveState({ zone: 'rail' }), 'en')).toBe(false);
    expect(restoredLanded(liveState({ index: 1 }), 'en')).toBe(false);
    expect(restoredLanded(liveState(), 'ar')).toBe(false);
    expect(restoredLanded(liveState({ rows: [] }), 'en')).toBe(false);
    expect(restoredLanded(liveState({ rows: [{ i: 0, number: '1', name: 'News', now: null, nowText: '', next: null }] }), 'en')).toBe(false);
  });

  it('checks the restored live screen against the fixture: the rail, the count, the rows', () => {
    expect(restoredFailures(liveState(), CATEGORIES, 'en')).toEqual([]);
    expect(restoredFailures(liveState({}, 'ar'), CATEGORIES, 'ar')).toEqual([]);
    expect(restoredFailures(liveState({ railSide: 'right' }), CATEGORIES, 'en')).toEqual(['the rail is on the right, expected on the left (the inline start)']);
    expect(restoredFailures(liveState({ liveCount: 1 }), CATEGORIES, 'en')).toEqual(['the header counts 1 channels, expected 2']);
    expect(restoredFailures(liveState({ liveCount: null }), CATEGORIES, 'en')).toEqual(['the header counts no channels, expected 2']);
    const swapped = liveState({ rows: [liveState().rows[0]!, { i: 1, number: '2', name: 'Sport', now: null, nowText: LIVE_TEXT.en.noGuide, next: null }] });
    expect(restoredFailures(swapped, CATEGORIES, 'en')).toEqual(['1 of 2 rows wrong: row 1 (Films): name "Sport"']);
    // In the other language's placeholder.
    expect(restoredFailures(liveState({}, 'ar'), CATEGORIES, 'en')).toHaveLength(4);
    // A category the fixture doesn't have: the rows can't be checked, and the count isn't either.
    expect(restoredFailures(liveState({ category: 9 }), CATEGORIES, 'en')).toContain('the list shows rail entry 9, which the fixture does not have');
  });

  it('makes the four requests of a look-up that finds nothing, a first send and a restore', () => {
    expect(WALK_REQUESTS).toEqual(['GET 404', 'GET 404', 'PUT 200', 'GET 200']);
  });
});

describe('START_EXPRESSION', () => {
  it('is plain ES5, so it runs on every engine', () => {
    expect(() => parse(START_EXPRESSION, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  type Box = readonly [number, number, number, number];
  const el = (attributes: Record<string, string>, text = '', box: Box = [200, 200, 100, 50], widths: [number, number] = [100, 100]) => ({
    textContent: text,
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
    getBoundingClientRect: () => ({ left: box[0], top: box[1], right: box[0] + box[2], bottom: box[1] + box[3] }),
    scrollWidth: widths[0],
    clientWidth: widths[1],
  });

  /** `onboarding`: the onboarding root's `data-ready` (`undefined`: none on the page). */
  function read(page: { start?: ReturnType<typeof el> | null; title?: ReturnType<typeof el>; boxes?: unknown[]; labels?: unknown[]; onboarding?: string; live?: boolean; boot?: string; dir?: string }): StartState {
    const start = page.start === undefined ? null : page.start;
    const roots: Record<string, unknown> = {
      '[data-testid="backup-start"]': start,
      '[data-testid="backup-title"]': page.title ?? null,
      '[data-testid="onboarding"]': page.onboarding === undefined ? null : el({ 'data-ready': page.onboarding }),
      '[data-testid="live"]': page.live === true ? el({ 'data-status': 'ready' }) : null,
    };
    const document = {
      documentElement: { getAttribute: (name: string) => (name === 'dir' ? (page.dir ?? 'ltr') : null) },
      getElementById: (id: string) => (id === 'boot-error' ? { textContent: page.boot ?? '' } : null),
      querySelector: (selector: string) => roots[selector] ?? null,
    };
    if (start !== null) {
      (start as unknown as { querySelectorAll(selector: string): unknown[] }).querySelectorAll = (selector: string) => (selector.indexOf('.z-button__label') !== -1 ? (page.labels ?? []) : (page.boxes ?? []));
    }
    const window = { __labloStale: false };
    return JSON.parse(String(runInNewContext(START_EXPRESSION, { window, document, location: { href: 'file:///x' }, JSON, Array, Number }))) as StartState;
  }

  it('reads "Welcome back": its screen, focus, language, sources and title', () => {
    const state = read({
      start: el({ 'data-screen': 'welcome', 'data-zone': 'actions', 'data-index': '0', 'data-language': 'ar', 'data-sources': '1', class: 'onboarding' }),
      title: el({}, WELCOME_TITLES.ar),
      dir: 'rtl',
    });
    expect(state).toEqual({
      href: 'file:///x',
      stale: false,
      bootError: '',
      screen: 'welcome',
      zone: 'actions',
      index: 0,
      language: 'ar',
      dir: 'rtl',
      sources: 1,
      title: WELCOME_TITLES.ar,
      onboarding: false,
      live: false,
      outside: [],
      cut: [],
    });
  });

  it('reads "Looking for your backup" with no count, and a page without the start\'s screens', () => {
    const looking = read({ start: el({ 'data-screen': 'looking', 'data-zone': 'actions', 'data-index': '0', 'data-language': 'en' }) });
    expect(looking).toMatchObject({ screen: 'looking', sources: null });
    expect(read({ start: el({ 'data-screen': 'welcome', 'data-sources': '' }) })).toMatchObject({ sources: null, index: null });
    expect(read({ onboarding: 'true', boot: 'Boot error: x' })).toMatchObject({ screen: null, zone: null, index: null, language: null, title: null, onboarding: true, live: false, bootError: 'Boot error: x' });
    expect(read({ live: true })).toMatchObject({ screen: null, live: true, onboarding: false });
  });

  it("doesn't take the boot's placeholder (a not-ready onboarding root) for onboarding (found on Chromium 53)", () => {
    expect(read({ onboarding: 'false' })).toMatchObject({ screen: null, onboarding: false, live: false });
    expect(read({ start: el({ 'data-screen': 'looking' }), onboarding: 'false' })).toMatchObject({ screen: 'looking', onboarding: false });
  });

  it('reads whether the page was marked before a relaunch', () => {
    const document = { documentElement: { getAttribute: () => null }, getElementById: () => null, querySelector: () => null };
    const state = JSON.parse(String(runInNewContext(START_EXPRESSION, { window: { __labloStale: true }, document, location: { href: 'file:///x' }, JSON, Array, Number }))) as StartState;
    expect(state).toMatchObject({ stale: true, bootError: '', dir: '' });
  });

  it('finds a part outside the title-safe area and a label cut short', () => {
    const inside = el({ class: 'z-button' }, 'Continue', [SAFE_AREA.left, SAFE_AREA.top, 100, 50]);
    const right = el({ class: 'onboarding__text' }, 'Too wide', [SAFE_AREA.right - 50, 300, 100, 50]);
    const label = el({ class: 'z-button__label' }, 'Continuer', undefined, [140, 100]);
    const fits = el({ class: 'onboarding__title' }, 'Welcome', undefined, [101, 100]);
    const state = read({ start: el({ 'data-screen': 'welcome' }), boxes: [inside, right], labels: [label, fits] });
    expect(state.outside).toEqual(['onboarding__text: Too wide']);
    expect(state.cut).toEqual(['z-button__label: Continuer']);
    for (const [box, out] of [
      [[SAFE_AREA.left - 1, 300, 10, 10], true],
      [[300, SAFE_AREA.top - 1, 10, 10], true],
      [[SAFE_AREA.right - 10, 300, 10.5, 10], false],
      [[300, SAFE_AREA.bottom - 10, 10, 10.5], false],
      [[300, SAFE_AREA.bottom - 10, 10, 11], true],
    ] as const) {
      expect(read({ start: el({ 'data-screen': 'welcome' }), boxes: [el({ class: 'x' }, '', box)] }).outside, String(box)).toHaveLength(out ? 1 : 0);
    }
  });
});

describe('UPLOAD_EXPRESSION', () => {
  it('is plain ES5, as are the results it is read back with', () => {
    for (const expression of [UPLOAD_EXPRESSION, UPLOAD_RESULT, LUNA_RESULT]) expect(() => parse(expression, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  async function upload(hook: unknown): Promise<[string, string]> {
    const window: Record<string, unknown> = hook === undefined ? {} : { __LABLO_TEST__: hook };
    const started = JSON.parse(String(runInNewContext(UPLOAD_EXPRESSION, { window, JSON, String }))) as string;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return [started, JSON.parse(String(runInNewContext(UPLOAD_RESULT, { window, JSON }))) as string];
  }

  it("starts the test hook's upload and reads its state once it settles", async () => {
    expect(await upload({ uploadBackup: () => Promise.resolve('sent') })).toEqual(['pending', 'sent']);
    expect(await upload({ uploadBackup: () => Promise.resolve('held') })).toEqual(['pending', 'held']);
    expect(await upload({ uploadBackup: () => Promise.resolve(null) })).toEqual(['pending', 'none ran']);
    expect(await upload({ uploadBackup: () => Promise.reject(new Error('worker died')) })).toEqual(['pending', 'error: worker died']);
    expect(await upload({ uploadBackup: () => Promise.reject('gone') })).toEqual(['pending', 'error: gone']);
  });

  it('says so when the page has no test hook to upload with', async () => {
    expect(await upload(undefined)).toEqual(['no test hook', 'no test hook']);
    expect(await upload({})).toEqual(['no test hook', 'no test hook']);
  });

  it('reads nothing before an upload started', () => {
    expect(runInNewContext(UPLOAD_RESULT, { window: {}, JSON })).toBe('null');
  });
});

describe('evaluateBackupWalk', () => {
  it('passes a walk whose wipe was restored with no key pressed, in both languages', () => {
    expect(evaluateBackupWalk(walk(), LOOKUP, CATEGORIES)).toEqual([]);
    expect(evaluateBackupWalk(walk({ language: 'ar' }), LOOKUP, CATEGORIES)).toEqual([]);
  });

  it('stops at a database it could not reset, the first step that did not land, or the phone', () => {
    expect(evaluateBackupWalk(walk({ reset: 'blocked' }), LOOKUP, CATEGORIES)).toEqual(["the app's database could not be deleted before the walk (blocked)"]);
    const steps = walk().steps.map((s) => (s.id === 'watch' ? { ...s, met: false, state: liveState({ live: false, liveIdle: false, screen: 'done', zone: 'actions', index: 0, onboarding: true, bootError: '', editing: null, active: null, value: null, phase: null, error: null, guide: false, movies: false, hook: 'done/actions/0' }) } : s));
    const failures = evaluateBackupWalk(walk({ steps }), LOOKUP, CATEGORIES);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^"OK on "Start watching"" did not land: expected the live screen, its data requests answered, live · channels 0, language en, dir="ltr", at /);
    expect(evaluateBackupWalk(walk({ phoneError: 'the stand-in has no session' }), LOOKUP, CATEGORIES)).toEqual(['the phone: the stand-in has no session']);
  });

  it('wants the upload sent and the wipe done', () => {
    expect(evaluateBackupWalk(walk({ upload: null }), LOOKUP, CATEGORIES)).toEqual(['the walk stopped before the upload']);
    expect(evaluateBackupWalk(walk({ upload: 'held' }), LOOKUP, CATEGORIES)).toEqual(['the upload answered "held", expected "sent"']);
    expect(evaluateBackupWalk(walk({ wipe: 'blocked' }), LOOKUP, CATEGORIES)).toEqual(["the wipe could not delete the app's database (blocked)"]);
    expect(evaluateBackupWalk(walk({ wipe: null }), LOOKUP, CATEGORIES)).toEqual(["the wipe could not delete the app's database (not tried)"]);
  });

  it('says what the start showed after the wipe instead of "Welcome back"', () => {
    expect(evaluateBackupWalk(walk({ welcome: null }), LOOKUP, CATEGORIES)).toEqual(['after the wipe, the page could not be read']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ screen: null, onboarding: true }) }), LOOKUP, CATEGORIES)).toEqual(['after the wipe the start showed onboarding, not "Welcome back"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ screen: null, live: true }) }), LOOKUP, CATEGORIES)).toEqual(['after the wipe the start showed the live screen, not "Welcome back"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ screen: 'looking' }) }), LOOKUP, CATEGORIES)).toEqual(['after the wipe the start showed "looking", not "Welcome back"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ screen: null }) }), LOOKUP, CATEGORIES)).toEqual(['after the wipe the start showed nothing, not "Welcome back"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ screen: null, onboarding: true, bootError: ' Boot error: x \n' }) }), LOOKUP, CATEGORIES)).toEqual(['after the wipe the start showed a boot error (Boot error: x), not "Welcome back"']);
  });

  it('checks "Welcome back": its language, title, count, focus and layout', () => {
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ language: 'ar' }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" is in ar (dir="ltr"), expected en (dir="ltr")']);
    expect(evaluateBackupWalk(walk({ language: 'ar', welcome: welcomeState({ language: 'ar', dir: 'ltr', title: WELCOME_TITLES.ar }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" is in ar (dir="ltr"), expected ar (dir="rtl")']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ language: null }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" is in - (dir="ltr"), expected en (dir="ltr")']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ title: 'Welcome' }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back"\'s title reads "Welcome", expected "Welcome back"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ title: null }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back"\'s title reads "", expected "Welcome back"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ sources: 0 }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" counts 0 sources, expected 1']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ sources: null }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" counts no sources, expected 1']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ zone: null, index: null }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back"\'s focus is at - -, expected "Continue"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ index: 1 }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back"\'s focus is at actions 1, expected "Continue"']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ outside: ['a: b', 'c: d'] }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" outside the title-safe area: a: b; c: d']);
    expect(evaluateBackupWalk(walk({ welcome: welcomeState({ cut: ['z-button__label: Continue'] }) }), LOOKUP, CATEGORIES)).toEqual(['"Welcome back" cuts a label: z-button__label: Continue']);
  });

  it('wants the live screen to fill by itself after "Welcome back"', () => {
    expect(evaluateBackupWalk(walk({ restored: null }), LOOKUP, CATEGORIES)).toEqual(['after "Welcome back" the live screen never filled by itself: nothing']);
    const unfilled = evaluateBackupWalk(walk({ restored: liveState({ rows: [], category: 0, top: 0, editing: null, active: null, value: null, phase: null, error: null, bootError: '', onboarding: false, guide: false, movies: false, hook: 'live/channels/0', dialog: false, platformBack: 0 }) }), LOOKUP, CATEGORIES);
    expect(unfilled).toHaveLength(1);
    expect(unfilled[0]).toMatch(/^after "Welcome back" the live screen never filled by itself: the live screen, .*; the list draws no rows$/);
    const off = evaluateBackupWalk(walk({ restored: liveState({ live: false, liveIdle: false, screen: null, onboarding: true, bootError: '', editing: null, active: null, value: null, phase: null, error: null, guide: false, movies: false, hook: null }) }), LOOKUP, CATEGORIES);
    expect(off[0]).toMatch(/^after "Welcome back" the live screen never filled by itself: onboarding, /);
    expect(off[0]).not.toMatch(/draws no rows/);
  });

  it('checks the restored live screen against the fixture, after the wipe', () => {
    const wrong = liveState({ rows: [liveState().rows[0]!, { i: 1, number: '7', name: 'Films', now: null, nowText: LIVE_TEXT.en.noGuide, next: null }] });
    expect(evaluateBackupWalk(walk({ restored: wrong }), LOOKUP, CATEGORIES)).toEqual(['after the wipe: 1 of 2 rows wrong: row 1 (Films): number "7", expected 2']);
    expect(evaluateBackupWalk(walk({ language: 'ar', restored: liveState({ liveCount: 3 }, 'ar') }), LOOKUP, CATEGORIES)).toEqual(['after the wipe: the header counts 3 channels, expected 2']);
  });

  it("checks the stand-in's requests, all under the simulated LGUDID's lookup ID", () => {
    expect(evaluateBackupWalk(walk({ requests: ['GET 404', 'GET 404', 'PUT 200', 'GET 404'] }), LOOKUP, CATEGORIES)).toEqual([
      'the backup stand-in answered GET 404, GET 404, PUT 200, GET 404, expected GET 404, GET 404, PUT 200, GET 200',
    ]);
    expect(evaluateBackupWalk(walk({ requests: [] }), LOOKUP, CATEGORIES)).toEqual(['the backup stand-in answered nothing, expected GET 404, GET 404, PUT 200, GET 200']);
    expect(evaluateBackupWalk(walk({ lookupIds: [LOOKUP, 'other'] }), LOOKUP, CATEGORIES)).toEqual([`the requests went under ${LOOKUP}, other, expected only the simulated LGUDID's (${LOOKUP})`]);
    expect(evaluateBackupWalk(walk({ lookupIds: ['other'] }), LOOKUP, CATEGORIES)).toEqual([`the requests went under other, expected only the simulated LGUDID's (${LOOKUP})`]);
    expect(evaluateBackupWalk(walk({ lookupIds: [] }), LOOKUP, CATEGORIES)).toEqual([`the requests went under no lookup ID, expected only the simulated LGUDID's (${LOOKUP})`]);
  });

  it('wants the LGUDID read at the look-up and the upload, and again after the wipe', () => {
    expect(evaluateBackupWalk(walk({ lunaBefore: [DEVICE_ID_URI, 'luna://x'] }), LOOKUP, CATEGORIES)).toEqual(['the first page read the LGUDID 1 times, expected at the look-up and at the upload']);
    expect(evaluateBackupWalk(walk({ lunaBefore: null }), LOOKUP, CATEGORIES)).toEqual(['the first page read the LGUDID 0 times, expected at the look-up and at the upload']);
    expect(evaluateBackupWalk(walk({ lunaAfter: ['luna://x'] }), LOOKUP, CATEGORIES)).toEqual(['the page after the wipe never read the LGUDID']);
    expect(evaluateBackupWalk(walk({ lunaAfter: null }), LOOKUP, CATEGORIES)).toEqual(['the page after the wipe never read the LGUDID']);
  });

  it("checks the restored profile: the phone's source, the language and the consent", () => {
    expect(evaluateBackupWalk(walk({ profile: null }), LOOKUP, CATEGORIES)).toEqual(['the restored profile could not be read']);
    expect(evaluateBackupWalk(walk({ profile: { sources: null, language: null, consent: null, error: 'NotFoundError' } }), LOOKUP, CATEGORIES)).toEqual(['the restored profile could not be read: NotFoundError']);
    expect(evaluateBackupWalk(walk({ profile: { sources: null, language: 'en', consent: true } }), LOOKUP, CATEGORIES)).toEqual(['the restored profile has the sources no profile, expected s1,m3u,Phone list']);
    expect(evaluateBackupWalk(walk({ profile: { sources: [], language: 'en', consent: true } }), LOOKUP, CATEGORIES)).toEqual(['the restored profile has the sources none, expected s1,m3u,Phone list']);
    expect(evaluateBackupWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list'], ['s2', 'm3u', 'x']], language: 'en', consent: true } }), LOOKUP, CATEGORIES)).toEqual([
      'the restored profile has the sources s1,m3u,Phone list; s2,m3u,x, expected s1,m3u,Phone list',
    ]);
    expect(evaluateBackupWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'ar', consent: true } }), LOOKUP, CATEGORIES)).toEqual(['the restored answers are language ar, consent true, expected en and true']);
    expect(evaluateBackupWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list']], language: null, consent: false } }), LOOKUP, CATEGORIES)).toEqual(['the restored answers are language -, consent false, expected en and true']);
    expect(evaluateBackupWalk(walk({ language: 'ar', profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'ar', consent: true } }), LOOKUP, CATEGORIES)).toEqual([`the restored profile has the sources s1,m3u,Phone list, expected s1,m3u,${PHONE_NAMES.ar}`]);
  });
});

describe('evaluateBackupRun', () => {
  const run = (over: Partial<BackupRun> = {}): BackupRun => ({
    url: 'file:///app/app/webos-sim/index.html',
    lookupId: LOOKUP,
    walks: [walk(), walk({ language: 'ar' })],
    cleanup: 'ok',
    exceptions: [],
    durationMs: 30_000,
    ...over,
  });

  it('passes both walks on the engine it expects', () => {
    expect(evaluateBackupRun(run(), { major: 53 }, CATEGORIES)).toEqual([]);
  });

  it('names the engine, a missing or failing Arabic walk, the clean-up and uncaught errors', () => {
    expect(evaluateBackupRun(run(), { major: 68 }, CATEGORIES)).toEqual([`the engine reports Chrome 53 ("${UA}"), expected 68`]);
    expect(evaluateBackupRun(run({ walks: [walk()] }), { major: 53 }, CATEGORIES)).toEqual(['in Arabic: the walk did not run']);
    expect(evaluateBackupRun(run({ walks: [walk(), walk({ language: 'ar', upload: 'failed' })] }), { major: 53 }, CATEGORIES)).toEqual(['in Arabic: the upload answered "failed", expected "sent"']);
    expect(evaluateBackupRun(run({ walks: [walk({ upload: 'held' }), walk({ language: 'ar' })] }), { major: 53 }, CATEGORIES)).toEqual(['the upload answered "held", expected "sent"']);
    expect(evaluateBackupRun(run({ cleanup: 'blocked' }), { major: 53 }, CATEGORIES)).toEqual(["the app's database could not be deleted after the walks (blocked)"]);
    expect(evaluateBackupRun(run({ exceptions: ['TypeError: x'] }), { major: 53 }, CATEGORIES)).toEqual(['uncaught: TypeError: x']);
    const unread = run({ walks: [walk({ steps: [] }), walk({ language: 'ar', steps: [] })] });
    expect(evaluateBackupRun(unread, { major: 53 }, CATEGORIES)).toEqual(['the page state could not be read at all']);
    const noAgent = walk({ steps: walk().steps.map((s) => ({ ...s, state: null })) });
    expect(evaluateBackupRun(run({ walks: [noAgent, walk({ language: 'ar' })] }), { major: 53 }, CATEGORIES)).toEqual([]);
  });

  it('sums each walk up: the time from the relaunch to "Welcome back" and to the live screen', () => {
    expect(backupSummary(run())).toBe('  en: "Welcome back" 2.1 s, live 7.9 s; ar: "Welcome back" 2.1 s, live 7.9 s');
    expect(backupSummary(run({ walks: [walk({ welcomeMs: null, liveMs: null })] }))).toBe('  en: "Welcome back" -, live -');
    expect(backupSummary(run({ walks: [] }))).toBe('');
  });
});
