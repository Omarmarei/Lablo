import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { LoadedProfile, SourceProbe, StoredSource } from '@lablo/data';
import type { PlaybackFailure } from '@lablo/player';
import type { ItemBinding } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import type { LastPlay } from '../player/last-play';
import type { ConnectionState } from './connection-check';
import { CONNECTION_SCREEN, CONNECTION_SOURCES_MAX, accountVerdict, answersBadly, connectionVerdict, createConnectionCheck } from './connection-check';
import { ConnectionView, internetText, lastText, seconds, sourceText } from './ConnectionPage';

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
  return { online: true, failed: false, last: null, sources: probes.map((probe, i) => ({ id: `s${i}`, name: `S${i}`, probe })), ...extra };
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

function setup(options: { online?: () => boolean; last?: () => LastPlay | null } = {}) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.push({ id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 11, visible: 7 }] });
  const profile = held<LoadedProfile | null>();
  const check = held<SourceProbe[]>();
  const page = createConnectionCheck(nav, { profile: () => profile.fn() }, { online: options.online ?? (() => true), last: options.last ?? (() => null), checkSources: (s) => check.fn(s) });
  return { nav, page, profile, check };
}

afterEach(() => vi.restoreAllMocks());

describe('the connection check (RELAY step 40a)', () => {
  it('opens its page on the buttons, reads the profile, then asks every listed source at once', async () => {
    const { nav, page, profile, check } = setup({ last: () => ({ state: 'played', container: 'hls', ttffMs: 900 }) });
    page.open();
    expect(nav.snapshot()).toMatchObject({ screen: CONNECTION_SCREEN, zone: 'actions', index: 0 });
    expect(page.state.value).toEqual({ online: true, sources: null, failed: false, last: { state: 'played', container: 'hls', ttffMs: 900 } });
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
    expect(offline.page.state.value).toEqual({ online: false, sources: [], failed: false, last: null });
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
    expect(page.state.value).toEqual({ online: true, sources: null, failed: false, last: failure('provider', 'PRV-HTTP-404') });
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

describe('connectionVerdict', () => {
  const blockedAccount = (status: string): SourceProbe => ({ kind: 'answered', status: 200, ms: 1, account: { auth: true, status, expDate: null, activeCons: null, maxConnections: null }, playlist: null });

  it('says offline first, then the app, then waits for every line', () => {
    expect(connectionVerdict({ online: false, sources: null, failed: true, last: failure('device', 'TV-UNSUPPORTED') })).toBe('offline');
    expect(connectionVerdict({ online: true, sources: [], failed: true, last: null })).toBe('app');
    expect(connectionVerdict({ online: true, sources: null, failed: false, last: null })).toBeNull();
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
    expect(internetText(en, { online: false, sources: [], failed: false, last: null })).toEqual({ value: 'Not connected', detail: null, tone: 'warn' });
    expect(internetText(en, { online: true, sources: null, failed: false, last: null })).toMatchObject({ value: 'Checking…', tone: 'checking' });
    expect(internetText(en, stateOf([ACTIVE, null]))).toMatchObject({ tone: 'checking' });
    expect(internetText(en, stateOf([{ kind: 'unreachable' }, { kind: 'timeout' }]))).toEqual({ value: 'No server answered', detail: null, tone: 'warn' });
    expect(internetText(en, stateOf([{ kind: 'timeout' }, { kind: 'answered', status: 503, ms: 1, account: null, playlist: null }]))).toEqual({ value: 'Connected', detail: null, tone: 'ok' });
    expect(internetText(en, stateOf([{ kind: 'file' }]))).toMatchObject({ value: 'Connected', tone: 'ok' });
    expect(internetText(ar, { online: false, sources: [], failed: false, last: null }).value).toBe('غير متصل');
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

  it('says every verdict in its own words', () => {
    const verdicts: [ConnectionState, string][] = [
      [{ online: false, sources: [], failed: false, last: null }, "This TV isn't connected to the internet. Check its network settings, then check again."],
      [{ online: true, sources: [], failed: true, last: null }, 'Something went wrong in Lablo. If it keeps happening, send a report to support from Settings.'],
      [stateOf([]), 'Lablo has no playlist or login to check yet.'],
      [stateOf([{ kind: 'timeout' }]), "No server answered. Check the TV's internet connection. If other apps work, the problem is on your provider's side."],
      [stateOf([{ kind: 'answered', status: 200, ms: 1, account: { auth: false, status: '', expDate: null, activeCons: null, maxConnections: null }, playlist: null }]), "Your provider didn't accept the login. Check the username and password."],
      [stateOf([{ kind: 'answered', status: 200, ms: 1, account: { auth: true, status: 'Banned', expDate: null, activeCons: null, maxConnections: null }, playlist: null }]), 'Your provider has blocked or turned off this account.'],
      [stateOf([{ kind: 'answered', status: 200, ms: 1, account: { auth: true, status: 'Active', expDate: null, activeCons: 1, maxConnections: 1 }, playlist: null }]), 'Your account is already watching on other screens.'],
      [stateOf([{ kind: 'no-login' }]), 'A source has no login on this TV. Give it again in Settings › Sources.'],
      [stateOf([ACTIVE], { last: failure('device', 'TV-UNSUPPORTED') }), "Your internet and your provider answer, but this TV can't play the last stream's format. Other channels may play."],
      [stateOf([ACTIVE], { last: failure('provider', 'PRV-STALLED') }), "Your internet and your provider answer, but the provider didn't send the last stream. Ask your provider about that channel."],
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
