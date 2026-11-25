import { signal } from '@preact/signals';
import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { LoadedProfile, SourceProbe, StoredSource } from '@lablo/data';
import type { PlaybackFailure, PlayerState, PlayerStatus, PlayRequest } from '@lablo/player';
import { NO_TRACKS } from '@lablo/player';
import type { ItemBinding } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import type { LastPlay } from '../player/last-play';
import type { ConnectionState, TestPlayer, TestResult, TestStreamHost } from './connection-check';
import {
  CONNECTION_SCREEN,
  CONNECTION_SOURCES_MAX,
  CONNECTION_SOURCES_WITH_TEST,
  TEST_SCREEN,
  TEST_SOURCE,
  accountVerdict,
  answersBadly,
  connectionVerdict,
  createConnectionCheck,
  testRequest,
} from './connection-check';
import { ConnectionView, TestStreamView, internetText, lastText, seconds, sourceText, testText, testViewText } from './ConnectionPage';

/**
 * Settings › "Check the connection" (RELAY step 40a): the page's state (the profile read, the
 * servers asked, stale answers dropped), its verdict's rules, and its lines in words in English
 * and Arabic (components called as functions); the e2e drives it in the app against the mock.
 */

type Props = Record<string, unknown> & { children?: unknown };

function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return out;
  const v = node as VNode;
  out.push(v);
  walk((v.props as Props).children, out);
  return out;
}
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };

const ACTIVE: SourceProbe = { kind: 'answered', status: 200, ms: 420, account: { auth: true, status: 'Active', expDate: 1_800_000_000, activeCons: 1, maxConnections: 2 }, playlist: null };
const LIST_OK: SourceProbe = { kind: 'answered', status: 200, ms: 80, account: null, playlist: true };

function source(id: string, name = `Source ${id}`): StoredSource {
  return { id, type: 'xtream', name, account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 1 };
}

function profileOf(sources: StoredSource[]): LoadedProfile {
  return { doc: { v: 12, sources } as unknown as LoadedProfile['doc'], newer: false, migratedFrom: null };
}

function failure(category: PlaybackFailure['category'], code: string): LastPlay {
  return { state: 'failed', failure: { category, code, detail: 'X', account: null } };
}

function stateOf(probes: (SourceProbe | null)[], extra: Partial<ConnectionState> = {}): ConnectionState {
  return { online: true, failed: false, last: null, testable: false, test: null, sources: probes.map((probe, i) => ({ id: `s${i}`, name: `S${i}`, probe })), ...extra };
}

/** Promises the test settles. */
function held<T>() {
  const calls: { arg: unknown; resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const fn = (arg?: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      calls.push({ arg, resolve, reject });
    });
  return { fn, calls };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** The app's player as the test sees it: its plays and stops, and the statuses the test sends. */
function fakePlayer() {
  let listeners: ((status: PlayerStatus) => void)[] = [];
  let session = 0;
  const plays: PlayRequest[] = [];
  let stops = 0;
  const emit = (state: PlayerState, extra: Partial<PlayerStatus> = {}): void => {
    const status: PlayerStatus = { state, session, key: TEST_SOURCE, container: 'hls', attempt: 0, failure: null, tracks: NO_TRACKS, ...extra };
    for (const listener of listeners.slice()) listener(status);
  };
  const player: TestPlayer = {
    play: (req) => {
      session += 1;
      plays.push(req);
      emit('opening');
      return Promise.resolve();
    },
    stop: () => {
      session += 1;
      stops += 1;
      emit('idle');
      return Promise.resolve();
    },
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
  };
  return { player, plays, emit, stops: () => stops, listening: () => listeners.length, session: () => session };
}

const LINK = 'https://media.lablo.example/test/pattern.m3u8';

/**
 * A test stream host: its link (changeable, and a signal, as main's reads the config's: step 50c),
 * the fake player, its clock and what it was told.
 */
function testHost(link: string | null = LINK) {
  const fake = fakePlayer();
  const told: boolean[] = [];
  let at = 1000;
  const current = signal<string | null>(link);
  const control = {
    get link(): string | null {
      return current.value;
    },
    set link(value: string | null) {
      current.value = value;
    },
    made: 0,
  };
  const host: TestStreamHost = {
    link: () => control.link,
    player: () => {
      control.made += 1;
      return fake.player;
    },
    playing: (on) => told.push(on),
    now: () => at,
  };
  return { host, fake, told, control, setNow: (ms: number) => (at = ms) };
}

function setup(options: { online?: () => boolean; last?: () => LastPlay | null; test?: TestStreamHost } = {}) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.push({ id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 11, visible: 7 }] });
  const profile = held<LoadedProfile | null>();
  const check = held<SourceProbe[]>();
  const page = createConnectionCheck(nav, { profile: () => profile.fn() }, { online: options.online ?? (() => true), last: options.last ?? (() => null), checkSources: (s) => check.fn(s), ...(options.test === undefined ? {} : { test: options.test }) });
  return { nav, page, profile, check };
}

afterEach(() => vi.restoreAllMocks());

describe('the connection check (RELAY step 40a)', () => {
  it('opens its page on the buttons, reads the profile, then asks every listed source at once', async () => {
    const { nav, page, profile, check } = setup({ last: () => ({ state: 'played', container: 'hls', ttffMs: 900 }) });
    page.open();
    expect(nav.snapshot()).toMatchObject({ screen: CONNECTION_SCREEN, zone: 'actions', index: 0 });
    expect(page.state.value).toEqual({ online: true, sources: null, failed: false, last: { state: 'played', container: 'hls', ttffMs: 900 }, testable: false, test: null });
    expect(page.pending.value).toBe(1);
    const sources = [source('a'), source('b')];
    profile.calls[0]!.resolve(profileOf(sources));
    await flush();
    expect(check.calls.map((c) => c.arg)).toEqual([sources]);
    expect(page.state.value.sources).toEqual([
      { id: 'a', name: 'Source a', probe: null },
      { id: 'b', name: 'Source b', probe: null },
    ]);
    check.calls[0]!.resolve([ACTIVE, LIST_OK]);
    await flush();
    expect(page.state.value.sources).toEqual([
      { id: 'a', name: 'Source a', probe: ACTIVE },
      { id: 'b', name: 'Source b', probe: LIST_OK },
    ]);
    expect(page.pending.value).toBe(0);
  });

  it(`lists the first ${CONNECTION_SOURCES_MAX} sources only`, async () => {
    const { page, profile, check } = setup();
    page.open();
    const sources = ['1', '2', '3', '4', '5', '6', '7'].map((id) => source(id));
    profile.calls[0]!.resolve(profileOf(sources));
    await flush();
    expect(check.calls[0]!.arg).toEqual(sources.slice(0, CONNECTION_SOURCES_MAX));
    expect(page.state.value.sources).toHaveLength(CONNECTION_SOURCES_MAX);
  });

  it('asks nothing offline, and nothing for a profile without sources', async () => {
    const offline = setup({ online: () => false });
    offline.page.open();
    expect(offline.page.state.value).toEqual({ online: false, sources: [], failed: false, last: null, testable: false, test: null });
    expect(offline.profile.calls).toHaveLength(0);
    expect(offline.page.pending.value).toBe(0);
    const empty = setup();
    empty.page.open();
    empty.profile.calls[0]!.resolve(null);
    await flush();
    expect(empty.check.calls).toHaveLength(0);
    expect(empty.page.state.value.sources).toEqual([]);
    expect(empty.page.pending.value).toBe(0);
  });

  it("marks each source's check failed when the servers' check fails, and the page failed when the profile can't be read", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = setup();
    a.page.open();
    a.profile.calls[0]!.resolve(profileOf([source('a')]));
    await flush();
    a.check.calls[0]!.reject(new Error('worker'));
    await flush();
    expect(a.page.state.value).toMatchObject({ failed: false, sources: [{ id: 'a', probe: { kind: 'error' } }] });
    expect(a.page.pending.value).toBe(0);
    const b = setup();
    b.page.open();
    b.profile.calls[0]!.reject(new Error('idb'));
    await flush();
    expect(b.page.state.value).toMatchObject({ failed: true, sources: [] });
    expect(b.page.pending.value).toBe(0);
  });

  it('gives a source with no answer in the list a failed check', async () => {
    const { page, profile, check } = setup();
    page.open();
    profile.calls[0]!.resolve(profileOf([source('a'), source('b')]));
    await flush();
    check.calls[0]!.resolve([ACTIVE]);
    await flush();
    expect(page.state.value.sources!.map((l) => l.probe)).toEqual([ACTIVE, { kind: 'error' }]);
  });

  it('"Check again" starts over, reads the online flag and the last stream again, and drops the older run\'s answers', async () => {
    let online = true;
    let last: LastPlay | null = null;
    const { nav, page, profile, check } = setup({ online: () => online, last: () => last });
    page.open();
    profile.calls[0]!.resolve(profileOf([source('a')]));
    await flush();
    last = failure('provider', 'PRV-HTTP-404');
    nav.top.focus('actions', 0);
    nav.handle('OK');
    expect(page.state.value).toEqual({ online: true, sources: null, failed: false, last: failure('provider', 'PRV-HTTP-404'), testable: false, test: null });
    expect(page.pending.value).toBe(2);
    // The first run's answer comes after the second started: dropped.
    check.calls[0]!.resolve([ACTIVE]);
    await flush();
    expect(page.state.value.sources).toBeNull();
    profile.calls[1]!.resolve(profileOf([source('a')]));
    await flush();
    check.calls[1]!.resolve([LIST_OK]);
    await flush();
    expect(page.state.value.sources!.map((l) => l.probe)).toEqual([LIST_OK]);
    expect(page.pending.value).toBe(0);
    // Offline at the next check: nothing asked, the lines gone.
    online = false;
    page.again();
    expect(page.state.value).toMatchObject({ online: false, sources: [] });
    expect(profile.calls).toHaveLength(2);
  });

  it("drops a stale profile read and a stale failure", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { page, profile, check } = setup();
    page.open();
    page.again();
    profile.calls[0]!.resolve(profileOf([source('old')]));
    await flush();
    expect(page.state.value.sources).toBeNull();
    expect(check.calls).toHaveLength(0);
    profile.calls[1]!.reject(new Error('later'));
    page.again();
    await flush();
    expect(page.state.value).toMatchObject({ failed: false, sources: null });
    expect(page.pending.value).toBe(1);
  });

  it('closes on "Close" and Back, and drops answers after dispose', async () => {
    const { nav, page, profile } = setup();
    page.open();
    nav.top.focus('actions', 1);
    nav.handle('OK');
    expect(nav.snapshot().screen).toBe('settings');
    page.open();
    nav.handle('BACK');
    expect(nav.snapshot().screen).toBe('settings');
    page.dispose();
    profile.calls[1]!.resolve(profileOf([source('a')]));
    await flush();
    expect(page.state.value.sources).toBeNull();
    expect(page.pending.value).toBe(1);
    profile.calls[0]!.resolve(profileOf([source('a')]));
    await flush();
    expect(page.state.value.sources).toBeNull();
  });
});

describe('the test stream (RELAY step 40b)', () => {
  const PLAYED: TestResult = { state: 'played', container: 'hls', ms: 1200 };
  const NET: PlaybackFailure = { category: 'internet', code: 'NET-HTTP', detail: 'MEDIA_ERR_NETWORK', account: null };

  it('stops when the config turns playback off while it plays, says so until Close, and the page loses its button (step 50c)', () => {
    const test = testHost();
    const { nav, page } = setup({ test: test.host });
    page.open();
    nav.top.focus('actions', 1);
    nav.handle('OK');
    test.setNow(2200);
    test.fake.emit('playing');
    expect(test.fake.stops()).toBe(0);
    // main's link() is null once the config's disable-playback is in.
    test.control.link = null;
    expect(test.fake.stops()).toBe(1);
    expect(test.fake.listening()).toBe(0);
    expect(test.told).toEqual([true, false]);
    expect(page.testView.value).toEqual({ phase: 'off', failure: null });
    // The played result stays: the question was answered before.
    expect(page.state.value.test).toEqual(PLAYED);
    // The screen stays, saying why, until Close: a test asked for meanwhile starts nothing, even
    // with playback back on; then the page has no "Test stream" any more.
    expect(nav.snapshot().screen).toBe(TEST_SCREEN);
    test.control.link = LINK;
    page.test();
    expect(test.fake.plays).toHaveLength(1);
    expect(nav.snapshot().depth).toBe(4);
    test.control.link = null;
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: CONNECTION_SCREEN, zone: 'actions', index: 1 });
    expect(page.state.value.testable).toBe(false);
    expect(nav.top.zone('actions')).toMatchObject({ count: 2 });
    // Nothing follows the link afterwards: no play, no stop.
    test.control.link = LINK;
    test.control.link = null;
    expect([test.fake.plays.length, test.fake.stops()]).toEqual([1, 1]);
  });

  it('stops watching the config once the test ends or the page goes', () => {
    const test = testHost();
    const { nav, page } = setup({ test: test.host });
    page.open();
    nav.top.focus('actions', 1);
    nav.handle('OK');
    nav.handle('BACK');
    expect(test.fake.stops()).toBe(1);
    test.control.link = null;
    expect(test.fake.stops()).toBe(1);
    expect(test.told).toEqual([true, false]);
    test.control.link = LINK;
    nav.handle('OK');
    expect(test.fake.plays).toHaveLength(2);
    page.dispose();
    expect(test.fake.stops()).toBe(2);
    test.control.link = null;
    expect(test.fake.stops()).toBe(2);
    expect(page.testView.value.phase).not.toBe('off');
  });

  it('has no button or line without a link, and three buttons and five sources with one', async () => {
    const none = setup({ test: testHost(null).host });
    none.page.open();
    expect(none.page.state.value.testable).toBe(false);
    expect(none.nav.top.zone('actions')).toMatchObject({ count: 2 });
    const absent = setup();
    absent.page.open();
    expect(absent.page.state.value.testable).toBe(false);
    const { nav, page, profile, check } = setup({ test: testHost().host });
    page.open();
    expect(page.state.value).toMatchObject({ testable: true, test: null });
    expect(nav.top.zone('actions')).toMatchObject({ count: 3 });
    const sources = ['1', '2', '3', '4', '5', '6', '7'].map((id) => source(id));
    profile.calls[0]!.resolve(profileOf(sources));
    await flush();
    expect(CONNECTION_SOURCES_WITH_TEST).toBe(5);
    expect(check.calls[0]!.arg).toEqual(sources.slice(0, CONNECTION_SOURCES_WITH_TEST));
    expect(page.state.value.sources).toHaveLength(CONNECTION_SOURCES_WITH_TEST);
  });

  it('"Check again" reads the link again: the button comes and goes', () => {
    const test = testHost(null);
    const { nav, page } = setup({ test: test.host });
    page.open();
    nav.top.focus('actions', 1);
    test.control.link = LINK;
    page.again();
    expect(page.state.value.testable).toBe(true);
    expect(nav.top.zone('actions')).toMatchObject({ count: 3 });
    nav.top.focus('actions', 2);
    test.control.link = null;
    page.again();
    expect(page.state.value.testable).toBe(false);
    expect(nav.snapshot()).toMatchObject({ screen: CONNECTION_SCREEN, zone: 'actions', index: 1 });
    // "Close" is then the second button.
    nav.handle('OK');
    expect(nav.snapshot().screen).toBe('settings');
  });

  it("plays the link on the app's player over the stage, and keeps its first frame as played", () => {
    const test = testHost();
    const { nav, page } = setup({ test: test.host });
    page.open();
    nav.top.focus('actions', 1);
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: TEST_SCREEN, zone: 'test', index: 0 });
    expect(test.told).toEqual([true]);
    expect(test.control.made).toBe(1);
    expect(test.fake.plays).toEqual([testRequest(LINK)]);
    expect(testRequest(LINK)).toEqual({ key: 'lablo-test', src: 'lablo-test', mode: 'vod', candidates: [{ url: LINK, container: 'hls' }] });
    expect(testRequest('https://media.lablo.example/test/pattern.mp4').candidates).toEqual([{ url: 'https://media.lablo.example/test/pattern.mp4', container: 'mp4' }]);
    expect(page.testView.value).toEqual({ phase: 'opening', failure: null });
    expect(page.state.value.test).toBeNull();
    test.setNow(2200);
    test.fake.emit('playing');
    expect(page.testView.value).toEqual({ phase: 'playing', failure: null });
    expect(page.state.value.test).toEqual(PLAYED);
    // A later failure shows, but the TV did play video.
    test.setNow(9000);
    test.fake.emit('buffering');
    expect(page.state.value.test).toEqual(PLAYED);
    test.fake.emit('failed', { failure: NET });
    expect(page.testView.value).toEqual({ phase: 'failed', failure: NET });
    expect(page.state.value.test).toEqual(PLAYED);
    // "Close": the player stops, the stage goes, the page is back with the result.
    nav.handle('OK');
    expect(test.fake.stops()).toBe(1);
    expect(test.told).toEqual([true, false]);
    expect(test.fake.listening()).toBe(0);
    expect(nav.snapshot()).toMatchObject({ screen: CONNECTION_SCREEN, zone: 'actions', index: 1 });
    expect(page.state.value.test).toEqual(PLAYED);
  });

  it("says a give-up before any frame failed, with the player's code; Back and STOP close it", () => {
    const test = testHost();
    const { nav, page } = setup({ test: test.host });
    page.open();
    page.test();
    test.fake.emit('failed', { failure: NET });
    expect(page.state.value.test).toEqual({ state: 'failed', failure: NET });
    expect(nav.handle('BACK')).toBe('screen');
    expect(nav.snapshot().screen).toBe(CONNECTION_SCREEN);
    expect(test.told).toEqual([true, false]);
    page.test();
    expect(nav.snapshot().screen).toBe(TEST_SCREEN);
    // Other keys do nothing there.
    expect(nav.handle('INFO')).not.toBe('screen');
    expect(nav.handle('STOP')).toBe('screen');
    expect(nav.snapshot().screen).toBe(CONNECTION_SCREEN);
    expect(test.fake.stops()).toBe(2);
    expect(test.told).toEqual([true, false, true, false]);
    // A failure with no details changes nothing kept.
    page.test();
    test.fake.emit('failed');
    expect(page.testView.value).toEqual({ phase: 'failed', failure: null });
    expect(page.state.value.test).toEqual({ state: 'failed', failure: NET });
    page.endTest();
    expect(nav.snapshot().screen).toBe(CONNECTION_SCREEN);
    page.endTest();
    expect(nav.snapshot().screen).toBe(CONNECTION_SCREEN);
  });

  it("follows only its own play's statuses, and says each state", () => {
    const test = testHost('https://media.lablo.example/test/pattern.mp4');
    const { page } = setup({ test: test.host });
    page.open();
    page.test();
    const own = test.fake.session();
    test.fake.emit('playing', { session: own + 1 });
    test.fake.emit('failed', { session: own - 1, failure: NET });
    expect(page.state.value.test).toBeNull();
    expect(page.testView.value.phase).toBe('opening');
    test.fake.emit('idle');
    expect(page.testView.value.phase).toBe('opening');
    test.fake.emit('paused', { container: null });
    expect(page.testView.value.phase).toBe('playing');
    // No container on the status: the link's own.
    expect(page.state.value.test).toEqual({ state: 'played', container: 'mp4', ms: 0 });
    test.fake.emit('reconnecting');
    expect(page.testView.value.phase).toBe('reconnecting');
    test.fake.emit('ended');
    expect(page.testView.value.phase).toBe('ended');
    test.fake.emit('opening');
    expect(page.testView.value.phase).toBe('opening');
  });

  it('starts nothing without a link at the time, twice, or after dispose', () => {
    const test = testHost();
    const { nav, page } = setup({ test: test.host });
    page.open();
    test.control.link = null;
    nav.top.focus('actions', 1);
    nav.handle('OK');
    expect(nav.snapshot().screen).toBe(CONNECTION_SCREEN);
    expect(test.fake.plays).toHaveLength(0);
    test.control.link = LINK;
    page.test();
    page.test();
    expect(test.fake.plays).toHaveLength(1);
    expect(test.told).toEqual([true]);
    page.dispose();
    expect(test.fake.stops()).toBe(1);
    expect(test.told).toEqual([true, false]);
    page.test();
    expect(test.fake.plays).toHaveLength(1);
    expect(setup().page.test).not.toThrow();
  });

  it('clears the result at each opening and keeps it through "Check again" and late answers', async () => {
    const test = testHost();
    const { nav, page, profile, check } = setup({ test: test.host });
    page.open();
    page.test();
    test.fake.emit('playing');
    page.endTest();
    page.again();
    expect(page.state.value.test).toEqual({ state: 'played', container: 'hls', ms: 0 });
    // A new test's result replaces the last; a check's answers coming meanwhile keep it.
    page.test();
    profile.calls[1]!.resolve(profileOf([source('a')]));
    await flush();
    test.fake.emit('failed', { failure: NET });
    expect(page.state.value.test).toEqual({ state: 'failed', failure: NET });
    check.calls[0]!.resolve([ACTIVE]);
    await flush();
    expect(page.state.value.test).toEqual({ state: 'failed', failure: NET });
    expect(page.state.value.sources!.map((l) => l.probe)).toEqual([ACTIVE]);
    page.endTest();
    nav.handle('BACK');
    page.open();
    expect(page.state.value.test).toBeNull();
  });
});

describe('connectionVerdict', () => {
  const blockedAccount = (status: string): SourceProbe => ({ kind: 'answered', status: 200, ms: 1, account: { auth: true, status, expDate: null, activeCons: null, maxConnections: null }, playlist: null });

  it('says offline first, then the app, then waits for every line', () => {
    expect(connectionVerdict({ online: false, sources: null, failed: true, last: failure('device', 'TV-UNSUPPORTED'), testable: false, test: null })).toBe('offline');
    expect(connectionVerdict({ online: true, sources: [], failed: true, last: null, testable: false, test: null })).toBe('app');
    expect(connectionVerdict({ online: true, sources: null, failed: false, last: null, testable: false, test: null })).toBeNull();
    expect(connectionVerdict(stateOf([ACTIVE, null]))).toBeNull();
    expect(connectionVerdict(stateOf([]))).toBe('none');
  });

  it('says no server answered only when every asked server failed', () => {
    expect(connectionVerdict(stateOf([{ kind: 'unreachable' }, { kind: 'timeout' }]))).toBe('no-answer');
    expect(connectionVerdict(stateOf([{ kind: 'unreachable' }, { kind: 'file' }]))).toBe('no-answer');
    expect(connectionVerdict(stateOf([{ kind: 'unreachable' }, ACTIVE]))).toBe('provider');
    expect(connectionVerdict(stateOf([{ kind: 'file' }]))).toBe('ok');
  });

  it("puts an account's own problem before a bad answer, in the order of the sources", () => {
    expect(connectionVerdict(stateOf([{ kind: 'unreachable' }, { kind: 'answered', status: 401, ms: 1, account: { auth: false, status: '', expDate: null, activeCons: null, maxConnections: null }, playlist: null }]))).toBe('refused');
    expect(connectionVerdict(stateOf([ACTIVE, blockedAccount('Expired'), blockedAccount('Banned')]))).toBe('expired');
    expect(connectionVerdict(stateOf([blockedAccount('Disabled'), blockedAccount('Expired')]))).toBe('closed');
    const full: SourceProbe = { kind: 'answered', status: 200, ms: 1, account: { auth: true, status: 'Active', expDate: null, activeCons: 2, maxConnections: 2 }, playlist: null };
    expect(connectionVerdict(stateOf([full]))).toBe('full');
  });

  it('then a bad answer, a failed check, a missing login, in that order', () => {
    expect(connectionVerdict(stateOf([{ kind: 'no-login' }, { kind: 'error' }, { kind: 'answered', status: 503, ms: 1, account: null, playlist: null }]))).toBe('provider');
    expect(connectionVerdict(stateOf([{ kind: 'no-login' }, { kind: 'error' }, ACTIVE]))).toBe('app');
    expect(connectionVerdict(stateOf([{ kind: 'no-login' }, ACTIVE], { last: failure('device', 'TV-UNSUPPORTED') }))).toBe('login');
    expect(connectionVerdict(stateOf([{ kind: 'blocked' }, ACTIVE]))).toBe('ok');
  });

  it("then the last stream's failure: the TV's format, the provider's channel, the app", () => {
    expect(connectionVerdict(stateOf([ACTIVE], { last: failure('device', 'TV-UNSUPPORTED') }))).toBe('device');
    expect(connectionVerdict(stateOf([ACTIVE], { last: failure('provider', 'PRV-HTTP-404') }))).toBe('channel');
    expect(connectionVerdict(stateOf([ACTIVE], { last: failure('app', 'APP-ERROR') }))).toBe('app');
    expect(connectionVerdict(stateOf([ACTIVE], { last: failure('internet', 'NET-OFFLINE') }))).toBe('ok');
    expect(connectionVerdict(stateOf([ACTIVE], { last: failure('blocked', 'CFG-BLOCKLIST') }))).toBe('ok');
    expect(connectionVerdict(stateOf([ACTIVE], { last: { state: 'played', container: 'ts', ttffMs: 1 } }))).toBe('ok');
  });

  it('reads the test stream (step 40b): failed after the login rule, played with the last stream and no answer', () => {
    const played: Partial<ConnectionState> = { test: { state: 'played', container: 'hls', ms: 1 } };
    const failed: Partial<ConnectionState> = { test: { state: 'failed', failure: { category: 'device', code: 'TV-UNSUPPORTED', detail: 'X', account: null } } };
    expect(connectionVerdict(stateOf([ACTIVE], failed))).toBe('test');
    expect(connectionVerdict(stateOf([ACTIVE], { ...failed, last: failure('device', 'TV-UNSUPPORTED') }))).toBe('test');
    expect(connectionVerdict(stateOf([{ kind: 'no-login' }], failed))).toBe('login');
    expect(connectionVerdict(stateOf([{ kind: 'timeout' }], failed))).toBe('no-answer');
    expect(connectionVerdict(stateOf([{ kind: 'timeout' }, { kind: 'file' }], played))).toBe('provider');
    expect(connectionVerdict(stateOf([ACTIVE], { ...played, last: failure('provider', 'PRV-HTTP-404') }))).toBe('streams');
    expect(connectionVerdict(stateOf([ACTIVE], { ...played, last: failure('internet', 'NET-HTTP') }))).toBe('streams');
    expect(connectionVerdict(stateOf([ACTIVE], { ...played, last: failure('device', 'TV-UNSUPPORTED') }))).toBe('device');
    expect(connectionVerdict(stateOf([ACTIVE], { ...played, last: failure('app', 'APP-ERROR') }))).toBe('app');
    expect(connectionVerdict(stateOf([ACTIVE], { ...played, last: failure('blocked', 'CFG-BLOCKLIST') }))).toBe('ok');
    expect(connectionVerdict(stateOf([ACTIVE], played))).toBe('ok');
    expect(connectionVerdict(stateOf([], failed))).toBe('none');
  });

  it('reads a bad answer: an error status, a playlist that is not one, a panel without its account', () => {
    expect(answersBadly({ kind: 'answered', status: 199, ms: 1, account: null, playlist: true })).toBe(true);
    expect(answersBadly({ kind: 'answered', status: 200, ms: 1, account: null, playlist: true })).toBe(false);
    expect(answersBadly({ kind: 'answered', status: 299, ms: 1, account: null, playlist: true })).toBe(false);
    expect(answersBadly({ kind: 'answered', status: 300, ms: 1, account: null, playlist: true })).toBe(true);
    expect(answersBadly({ kind: 'answered', status: 200, ms: 1, account: null, playlist: false })).toBe(true);
    expect(answersBadly({ kind: 'answered', status: 200, ms: 1, account: null, playlist: null })).toBe(true);
    expect(answersBadly(ACTIVE)).toBe(false);
    expect(answersBadly({ kind: 'unreachable' })).toBe(true);
    expect(answersBadly({ kind: 'timeout' })).toBe(true);
    for (const kind of ['file', 'no-login', 'blocked', 'error'] as const) expect(answersBadly({ kind })).toBe(false);
    expect(accountVerdict({ kind: 'file' })).toBeNull();
    expect(accountVerdict(LIST_OK)).toBeNull();
    expect(accountVerdict(ACTIVE)).toBeNull();
  });
});

describe('the page in words', () => {
  it('rounds the time to a tenth of a second, never under 0.1', () => {
    expect([0, 49, 50, 149, 150, 420, 2960].map(seconds)).toEqual([0.1, 0.1, 0.1, 0.1, 0.2, 0.4, 3]);
  });

  it("says the internet's state from the TV's flag and the servers' answers", () => {
    expect(internetText(en, { online: false, sources: [], failed: false, last: null, testable: false, test: null })).toEqual({ value: 'Not connected', detail: null, tone: 'warn' });
    expect(internetText(en, { online: true, sources: null, failed: false, last: null, testable: false, test: null })).toMatchObject({ value: 'Checking…', tone: 'checking' });
    expect(internetText(en, stateOf([ACTIVE, null]))).toMatchObject({ tone: 'checking' });
    expect(internetText(en, stateOf([{ kind: 'unreachable' }, { kind: 'timeout' }]))).toEqual({ value: 'No server answered', detail: null, tone: 'warn' });
    expect(internetText(en, stateOf([{ kind: 'timeout' }, { kind: 'answered', status: 503, ms: 1, account: null, playlist: null }]))).toEqual({ value: 'Connected', detail: null, tone: 'ok' });
    expect(internetText(en, stateOf([{ kind: 'file' }]))).toMatchObject({ value: 'Connected', tone: 'ok' });
    expect(internetText(ar, { online: false, sources: [], failed: false, last: null, testable: false, test: null }).value).toBe('غير متصل');
  });

  it("says each source's answer, with its account under it", () => {
    expect(sourceText(en, null)).toEqual({ value: 'Checking…', detail: null, tone: 'checking' });
    expect(sourceText(en, ACTIVE)).toEqual({ value: 'Answered in 0.4 s', detail: `Account active until ${en.date(new Date(1_800_000_000_000), 'full')} · Connections in use: 1 of 2`, tone: 'ok' });
    const noLimit: SourceProbe = { kind: 'answered', status: 200, ms: 1200, account: { auth: true, status: 'Active', expDate: null, activeCons: 0, maxConnections: 0 }, playlist: null };
    expect(sourceText(en, noLimit)).toEqual({ value: 'Answered in 1.2 s', detail: 'Account active', tone: 'ok' });
    const noCount: SourceProbe = { kind: 'answered', status: 200, ms: 100, account: { auth: true, status: 'Active', expDate: null, activeCons: null, maxConnections: 3 }, playlist: null };
    expect(sourceText(en, noCount).detail).toBe('Account active');
    const expired: SourceProbe = { kind: 'answered', status: 200, ms: 100, account: { auth: true, status: 'Expired', expDate: 1, activeCons: 0, maxConnections: 1 }, playlist: null };
    expect(sourceText(en, expired)).toEqual({ value: 'Answered in 0.1 s', detail: 'Your subscription with this provider has expired.', tone: 'warn' });
    expect(sourceText(en, { kind: 'answered', status: 200, ms: 100, account: null, playlist: null })).toEqual({ value: 'Answered in 0.1 s', detail: "The answer didn't give the account's details", tone: 'warn' });
    expect(sourceText(en, LIST_OK)).toEqual({ value: 'Answered in 0.1 s', detail: null, tone: 'ok' });
    expect(sourceText(en, { kind: 'answered', status: 200, ms: 100, account: null, playlist: false })).toEqual({ value: 'Answered in 0.1 s', detail: "It didn't answer with a playlist", tone: 'warn' });
    expect(sourceText(en, { kind: 'answered', status: 403, ms: 100, account: { auth: false, status: '', expDate: null, activeCons: null, maxConnections: null }, playlist: null })).toEqual({
      value: 'Answered with error 403',
      detail: "Your provider didn't accept the login. Check the username and password.",
      tone: 'warn',
    });
    expect(sourceText(en, { kind: 'answered', status: 503, ms: 100, account: null, playlist: null })).toEqual({ value: 'Answered with error 503', detail: null, tone: 'warn' });
    expect(sourceText(en, { kind: 'answered', status: 199, ms: 100, account: null, playlist: true }).tone).toBe('warn');
    expect(sourceText(en, { kind: 'answered', status: 300, ms: 100, account: null, playlist: true }).tone).toBe('warn');
    expect(sourceText(en, { kind: 'answered', status: 299, ms: 100, account: null, playlist: true }).tone).toBe('ok');
    expect(sourceText(en, { kind: 'unreachable' })).toEqual({ value: "Couldn't reach the server", detail: null, tone: 'warn' });
    expect(sourceText(en, { kind: 'timeout' })).toEqual({ value: 'No answer within 10 seconds', detail: null, tone: 'warn' });
    expect(sourceText(en, { kind: 'file' })).toEqual({ value: 'Sent from your phone: no server to check', detail: null, tone: 'info' });
    expect(sourceText(en, { kind: 'no-login' })).toEqual({ value: 'Its login is missing on this TV', detail: null, tone: 'warn' });
    expect(sourceText(en, { kind: 'blocked' })).toEqual({ value: "This server can't be used with Lablo.", detail: null, tone: 'warn' });
    expect(sourceText(en, { kind: 'error' })).toEqual({ value: "Couldn't check it", detail: null, tone: 'warn' });
  });

  it('says them in Arabic', () => {
    expect(stripIsolates(sourceText(ar, { kind: 'timeout' }).value)).toBe('لا إجابة خلال 10 ثوانٍ');
    expect(sourceText(ar, { kind: 'unreachable' }).value).toBe('تعذّر الوصول إلى الخادم');
    expect(stripIsolates(sourceText(ar, { kind: 'answered', status: 503, ms: 1, account: null, playlist: null }).value)).toBe('أجاب بالخطأ 503');
    expect(stripIsolates(sourceText(ar, LIST_OK).value)).toBe(`أجاب خلال ${ar.number(0.1)} ث`);
  });

  it('says the last stream: none, played, or the error card\'s title and code', () => {
    expect(lastText(en, null)).toEqual({ value: 'Nothing played since Lablo started', detail: null, tone: 'info' });
    expect(lastText(en, { state: 'played', container: 'hls', ttffMs: 1260 })).toEqual({ value: 'Played (HLS): the picture after 1.3 s', detail: null, tone: 'ok' });
    expect(lastText(en, failure('provider', 'PRV-HTTP-404'))).toEqual({ value: "Your provider isn't sending this channel", detail: 'Code PRV-HTTP-404', tone: 'warn' });
    expect(lastText(en, failure('device', 'TV-UNSUPPORTED')).value).toBe("This TV can't play this channel");
    expect(stripIsolates(lastText(ar, failure('provider', 'PRV-TIMEOUT')).detail!)).toBe('الرمز PRV-TIMEOUT');
  });

  it('draws the verdict, a line per check and the two buttons', async () => {
    const { page, profile, check } = setup({ last: () => ({ state: 'played', container: 'ts', ttffMs: 700 }) });
    page.open();
    const view = (i18n = en): unknown => ConnectionView({ i18n, check: page, button: () => idle });
    const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id);
    let drawn = view();
    expect(textOf(byTestId(drawn, 'connection-verdict'))).toBe('Checking…');
    expect((byTestId(drawn, 'connection')[0]!.props as Props)['data-verdict']).toBe('');
    profile.calls[0]!.resolve(profileOf([source('a', 'My provider'), source('b', 'قائمتي')]));
    await flush();
    check.calls[0]!.resolve([ACTIVE, { kind: 'unreachable' }]);
    await flush();
    drawn = view();
    expect((byTestId(drawn, 'connection')[0]!.props as Props)['data-verdict']).toBe('provider');
    expect(textOf(byTestId(drawn, 'connection-verdict'))).toBe("Your provider's server isn't answering properly. The problem is on the provider's side: try again later, or contact your provider.");
    expect(textOf(byTestId(drawn, 'connection-internet-value'))).toBe('Connected');
    expect(textOf(byTestId(drawn, 'connection-source-0-value'))).toBe('Answered in 0.4 s');
    expect(textOf(byTestId(drawn, 'connection-source-1-value'))).toBe("Couldn't reach the server");
    expect(byTestId(drawn, 'connection-source-1-detail')).toHaveLength(0);
    expect(textOf(byTestId(drawn, 'connection-last-value'))).toBe('Played (MPEG-TS): the picture after 0.7 s');
    // The sources' names are the provider's words, in their own direction, never translated.
    const names = walk(drawn).filter((v) => (v.props as Props)['class'] === 'connection__name' && (v.props as Props)['dir'] === 'auto');
    expect(names.map((v) => [textOf(v), (v.props as Props)['translate']])).toEqual([
      ['My provider', false],
      ['قائمتي', false],
    ]);
    expect(walk(drawn).filter((v) => (v.props as Props)['data-tone'] !== undefined).map((v) => (v.props as Props)['data-tone'])).toEqual(['ok', 'ok', 'warn', 'ok']);
    const buttons = walk(drawn).filter((v) => typeof (v.props as Props)['testId'] === 'string');
    expect(buttons.map((v) => [(v.props as Props)['testId'], (v.props as Props)['label']])).toEqual([
      ['connection-again', 'Check again'],
      ['connection-close', 'Close'],
    ]);
    expect(textOf(byTestId(view(ar), 'connection-verdict'))).toBe('خادم مزوّد الخدمة لا يجيب كما ينبغي. المشكلة لدى مزوّد الخدمة: حاول لاحقًا، أو تواصل معه.');
  });

  it("says the test stream's line and its screen's state (step 40b)", () => {
    expect(testText(en, null)).toEqual({ value: 'Not played yet', detail: null, tone: 'info' });
    expect(testText(en, { state: 'played', container: 'hls', ms: 1260 })).toEqual({ value: 'Played (HLS): the picture after 1.3 s', detail: null, tone: 'ok' });
    expect(testText(en, { state: 'failed', failure: { category: 'internet', code: 'NET-HTTP', detail: 'X', account: null } })).toEqual({ value: "Didn't play", detail: 'Code NET-HTTP', tone: 'warn' });
    expect(testText(ar, null).value).toBe('لم يُشغَّل بعد');
    expect(testViewText(en, { phase: 'opening', failure: null })).toEqual({ value: 'Connecting…', detail: null, tone: 'checking' });
    expect(testViewText(en, { phase: 'reconnecting', failure: null })).toEqual({ value: 'Reconnecting…', detail: null, tone: 'checking' });
    expect(testViewText(en, { phase: 'playing', failure: null })).toEqual({ value: 'If you see the picture and hear the sound, this TV and Lablo play video.', detail: null, tone: 'ok' });
    expect(testViewText(en, { phase: 'ended', failure: null })).toEqual({ value: 'The test stream has ended.', detail: null, tone: 'info' });
    expect(testViewText(en, { phase: 'failed', failure: { category: 'provider', code: 'PRV-HTTP-404', detail: 'X', account: null } })).toEqual({ value: "Didn't play", detail: 'Code PRV-HTTP-404', tone: 'warn' });
    expect(testViewText(en, { phase: 'failed', failure: null })).toEqual({ value: "Didn't play", detail: null, tone: 'warn' });
    expect(testViewText(en, { phase: 'off', failure: null })).toEqual({ value: 'Playback is turned off', detail: null, tone: 'warn' });
    expect(testViewText(ar, { phase: 'playing', failure: null }).value).toBe('إذا رأيت الصورة وسمعت الصوت، فهذا التلفاز ولابلو يشغّلان الفيديو.');
  });

  it('draws the test stream\'s line and button with a link, and its screen', async () => {
    const test = testHost();
    const { page, profile, check } = setup({ test: test.host });
    page.open();
    profile.calls[0]!.resolve(profileOf([source('a')]));
    await flush();
    check.calls[0]!.resolve([ACTIVE]);
    await flush();
    const asked: number[] = [];
    const drawn = ConnectionView({
      i18n: en,
      check: page,
      button: (i) => {
        asked.push(i);
        return idle;
      },
    });
    const ids = walk(drawn)
      .map((v) => (v.props as Props)['data-testid'])
      .filter((id) => typeof id === 'string' && /^connection-(internet|source-\d|last|test)$/.test(id));
    expect(ids).toEqual(['connection-internet', 'connection-source-0', 'connection-last', 'connection-test']);
    expect(textOf(walk(drawn).filter((v) => (v.props as Props)['data-testid'] === 'connection-test-value'))).toBe('Not played yet');
    const buttons = walk(drawn).filter((v) => typeof (v.props as Props)['testId'] === 'string');
    expect(buttons.map((v) => [(v.props as Props)['testId'], (v.props as Props)['label']])).toEqual([
      ['connection-again', 'Check again'],
      ['connection-test-play', 'Test stream'],
      ['connection-close', 'Close'],
    ]);
    expect(asked).toEqual([0, 1, 2]);

    page.test();
    const screen = (i18n = en): unknown => TestStreamView({ i18n, check: page, button: () => idle });
    const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id);
    let shown = screen();
    expect((byTestId(shown, 'test-stream')[0]!.props as Props)['data-phase']).toBe('opening');
    expect(textOf(byTestId(shown, 'test-stream-state'))).toBe('Connecting…');
    expect(byTestId(shown, 'test-stream-detail')).toHaveLength(0);
    expect(walk(shown).filter((v) => (v.props as Props)['class'] === 'test-stream__bar is-checking')).toHaveLength(1);
    expect(walk(shown).filter((v) => (v.props as Props)['class'] === 'test-stream__name').map(textOf)).toEqual(['Test stream']);
    expect(walk(shown).filter((v) => typeof (v.props as Props)['testId'] === 'string').map((v) => [(v.props as Props)['testId'], (v.props as Props)['label']])).toEqual([['test-stream-close', 'Close']]);
    test.fake.emit('failed', { failure: { category: 'internet', code: 'NET-HTTP', detail: 'X', account: null } });
    shown = screen();
    expect((byTestId(shown, 'test-stream')[0]!.props as Props)['data-phase']).toBe('failed');
    expect(textOf(byTestId(shown, 'test-stream-detail'))).toBe('Code NET-HTTP');
    expect(stripIsolates(textOf(byTestId(screen(ar), 'test-stream-state')))).toBe('لم يعمل');
    page.endTest();
    const back = ConnectionView({ i18n: en, check: page, button: () => idle });
    expect(textOf(walk(back).filter((v) => (v.props as Props)['data-testid'] === 'connection-test-value'))).toBe("Didn't play");
    expect(textOf(walk(back).filter((v) => (v.props as Props)['data-testid'] === 'connection-test-detail'))).toBe('Code NET-HTTP');
  });

  it('says every verdict in its own words', () => {
    const verdicts: [ConnectionState, string][] = [
      [{ online: false, sources: [], failed: false, last: null, testable: false, test: null }, "This TV isn't connected to the internet. Check its network settings, then check again."],
      [{ online: true, sources: [], failed: true, last: null, testable: false, test: null }, 'Something went wrong in Lablo. If it keeps happening, send a report to support from Settings.'],
      [stateOf([]), 'Lablo has no playlist or login to check yet.'],
      [stateOf([{ kind: 'timeout' }]), "No server answered. Check the TV's internet connection. If other apps work, the problem is on your provider's side."],
      [stateOf([{ kind: 'answered', status: 200, ms: 1, account: { auth: false, status: '', expDate: null, activeCons: null, maxConnections: null }, playlist: null }]), "Your provider didn't accept the login. Check the username and password."],
      [stateOf([{ kind: 'answered', status: 200, ms: 1, account: { auth: true, status: 'Banned', expDate: null, activeCons: null, maxConnections: null }, playlist: null }]), 'Your provider has blocked or turned off this account.'],
      [stateOf([{ kind: 'answered', status: 200, ms: 1, account: { auth: true, status: 'Active', expDate: null, activeCons: 1, maxConnections: 1 }, playlist: null }]), 'Your account is already watching on other screens.'],
      [stateOf([{ kind: 'no-login' }]), 'A source has no login on this TV. Give it again in Settings › Sources.'],
      [stateOf([ACTIVE], { last: failure('device', 'TV-UNSUPPORTED') }), "Your internet and your provider answer, but this TV can't play the last stream's format. Other channels may play."],
      [stateOf([ACTIVE], { last: failure('provider', 'PRV-STALLED') }), "Your internet and your provider answer, but the provider didn't send the last stream. Ask your provider about that channel."],
      [stateOf([ACTIVE], { test: { state: 'failed', failure: { category: 'internet', code: 'NET-HTTP', detail: 'X', account: null } } }), "Lablo's test stream didn't play on this TV. Restart the TV, then try again. If it still doesn't play, send a report to support from Settings."],
      [stateOf([ACTIVE], { test: { state: 'played', container: 'hls', ms: 1 }, last: failure('provider', 'PRV-STALLED') }), "This TV and Lablo play video: the problem is with your provider's streams. Ask your provider about the channels that don't play."],
      [stateOf([ACTIVE]), "Your internet and your provider answer. If a channel doesn't play, try it again, or send a report to support from Settings."],
    ];
    for (const [state, words] of verdicts) {
      const page = { state: { value: state }, pending: { value: 0 } } as unknown as Parameters<typeof ConnectionView>[0]['check'];
      const drawn = ConnectionView({ i18n: en, check: page, button: () => idle });
      const verdict = walk(drawn).filter((v) => (v.props as Props)['data-testid'] === 'connection-verdict');
      expect(textOf(verdict)).toBe(words);
      expect(String((verdict[0]!.props as Props)['class'])).toBe(words.startsWith('Your internet and your provider answer. If') ? 'connection__verdict is-ok' : 'connection__verdict is-warn');
    }
  });
});
