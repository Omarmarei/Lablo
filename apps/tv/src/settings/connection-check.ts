import type { ReadonlySignal } from '@preact/signals';
import { effect, signal } from '@preact/signals';
import type { LoadedProfile, SourceProbe, StoredSource } from '@lablo/data';
import type { Container, PlaybackFailure, PlayerStatus, PlayRequest } from '@lablo/player';
import { accountProblemCode, containerOf } from '@lablo/player';
import type { Navigator, Screen } from '@lablo/ui';
import { storedSources } from '../onboarding/engine-loader';
import type { LastPlay } from '../player/last-play';

/**
 * Settings › "Check the connection" (RELAY step 40a, PLAN.md §4 pillar 4: "Is it the app or my
 * provider?"): at each opening, and at "Check again", the page asks:
 *
 * - **the internet:** `online()` (the app gives `navigator.onLine`). Offline, no server is asked;
 * - **each source's server** (the profile's sources, the first `CONNECTION_SOURCES_MAX`), through
 *   main's `checkSources` (a fresh ingest worker's `probeSource`): the status, the time and the account;
 * - **the last stream** of the app's run (`last`: main keeps it, `player/last-play.ts`).
 *
 * Then `connectionVerdict` says whose problem it looks like. Each line shows "Checking…" until its
 * answer. A run's answers after a newer run started (or after the page was disposed) are dropped.
 * Its requests count in `pending` (the settings screen's `data-pending`).
 *
 * **Lablo's test stream** (step 40b): when the signed config names a link (`test.link()`), the page
 * has a "Test stream" button and line, and lists `CONNECTION_SOURCES_WITH_TEST` sources at most.
 * The button opens the test screen (`TEST_SCREEN`), which plays the link on the app's own player
 * (`test.player()`, as channels play) with the stage showing under the page (`test.playing`).
 * Its first frame makes the test "played" (kept even if the stream fails later: the question was
 * whether this TV plays video); a give-up before any frame makes it "failed". Close, Back or STOP
 * stop it and return to the page. The result stays until the page closes, and the verdict reads it.
 *
 * Main-safe as the settings are: no `trim`, `.sort(`, regex, `for…of` or object spread.
 */

export const CONNECTION_SCREEN = 'connection-check';
/** The test stream's screen (step 40b): the player's picture, a bar at the bottom. */
export const TEST_SCREEN = 'test-stream';

/** The most sources listed: their lines, the internet's and the last stream's fit the screen. */
export const CONNECTION_SOURCES_MAX = 6;
/** The most sources listed with the test stream's line (nine lines don't fit). */
export const CONNECTION_SOURCES_WITH_TEST = 5;

/** The test stream's source id: the player keeps nothing per source for one URL (one candidate). */
export const TEST_SOURCE = 'lablo-test';

/** The profile's reader (the settings' engine). */
export interface ConnectionEngine {
  profile(): Promise<LoadedProfile | null>;
}

/** The player's parts the test uses (main's one `PlayerController`). */
export interface TestPlayer {
  play(req: PlayRequest): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (status: PlayerStatus) => void): () => void;
}

/** Lablo's test stream (step 40b): what main gives. */
export interface TestStreamHost {
  /** The config's link; `null` without one, or while the config turns playback off. */
  readonly link: () => string | null;
  /** The app's player (made on the first call). */
  readonly player: () => TestPlayer;
  /**
   * The test screen shows (`true`) or goes: main shows the stage under a transparent page, and
   * keeps the test's plays out of "Last stream" and telemetry.
   */
  readonly playing: (on: boolean) => void;
  /** The clock for the time to the first frame (default `Date.now`). */
  readonly now?: () => number;
}

/** What main gives. */
export interface ConnectionOptions {
  /** Whether the TV says it is online (`navigator.onLine`). */
  readonly online: () => boolean;
  /** The app run's last stream (`null`: none played or failed yet). */
  readonly last: () => LastPlay | null;
  /** Asks the sources' servers (`DataEngine.checkSources`), in their order. */
  readonly checkSources: (sources: readonly StoredSource[]) => Promise<SourceProbe[]>;
  /** Lablo's test stream (step 40b); without it there is no "Test stream" button. */
  readonly test?: TestStreamHost;
}

/** One source's line: its name, and its server's answer (`null`: being checked). */
export interface SourceLine {
  readonly id: string;
  readonly name: string;
  readonly probe: SourceProbe | null;
}

/** The test stream's result (step 40b): its first frame (the container, the time to it), or the player's give-up. */
export type TestResult = { readonly state: 'played'; readonly container: Container; readonly ms: number } | { readonly state: 'failed'; readonly failure: PlaybackFailure };

export interface ConnectionState {
  readonly online: boolean;
  /** The sources' lines; `null` while the profile is read; empty offline (nothing is asked). */
  readonly sources: readonly SourceLine[] | null;
  /** The profile couldn't be read: nothing is known of the sources. */
  readonly failed: boolean;
  readonly last: LastPlay | null;
  /** The config names a test stream (at this check): the button and the line show. */
  readonly testable: boolean;
  /** The test stream's result since the page opened (`null`: not played). */
  readonly test: TestResult | null;
}

/**
 * The test screen's bar: the player's state as it says it, or `off`: the config turned playback off
 * while the test played (RELAY step 50c), so it stopped.
 */
export type TestPhase = 'opening' | 'playing' | 'reconnecting' | 'ended' | 'failed' | 'off';

export interface TestView {
  readonly phase: TestPhase;
  /** The give-up's failure (`failed` only). */
  readonly failure: PlaybackFailure | null;
}

/**
 * Whose problem it looks like, first rule first: the TV is offline; the app failed; the TV has no
 * source; no server answered (the provider's side once the test stream played); an account's own
 * problem (its login refused, expired, closed by the provider, every connection in use); a server
 * answering badly; a source without its login; the test stream didn't play; the last stream's
 * failure (a format the TV can't play; the provider's streams, once the test stream played; a
 * channel the provider didn't send; the app); else all is well.
 */
export type ConnectionVerdict = 'offline' | 'app' | 'none' | 'no-answer' | 'refused' | 'expired' | 'closed' | 'full' | 'provider' | 'login' | 'test' | 'device' | 'streams' | 'channel' | 'ok';

export interface ConnectionCheck {
  readonly state: ReadonlySignal<ConnectionState>;
  /** The profile read and the servers' check in flight (0: the page is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** The test screen's bar (step 40b). */
  readonly testView: ReadonlySignal<TestView>;
  /** Opens the page and checks. */
  open(): void;
  /** "Check again". */
  again(): void;
  /** "Test stream": opens the test screen and plays the config's link. */
  test(): void;
  /** The test screen's "Close": stops the test and returns to the page. */
  endTest(): void;
  dispose(): void;
}

/** The check of a source that failed (the worker): nothing is known. */
const CHECK_FAILED: SourceProbe = { kind: 'error' };

/** The account codes' verdicts (the player's `accountProblemCode`). */
const ACCOUNT_VERDICTS: Readonly<Record<string, ConnectionVerdict>> = {
  'PRV-AUTH': 'refused',
  'PRV-EXPIRED': 'expired',
  'PRV-BLOCKED': 'closed',
  'PRV-MAX-CONNECTIONS': 'full',
};

/** Whether a server's answer is a bad one: an error status, a playlist that isn't one, a panel without the account. */
export function answersBadly(probe: SourceProbe): boolean {
  if (probe.kind !== 'answered') return probe.kind === 'unreachable' || probe.kind === 'timeout';
  if (probe.status < 200 || probe.status >= 300) return true;
  return probe.playlist === null ? probe.account === null : !probe.playlist;
}

/** A source's own account problem's verdict (`null`: none, or no account read). */
export function accountVerdict(probe: SourceProbe): ConnectionVerdict | null {
  if (probe.kind !== 'answered' || probe.account === null) return null;
  const code = accountProblemCode(probe.account);
  return code === null ? null : ACCOUNT_VERDICTS[code]!;
}

/** The verdict once every line is in; `null` while any is still being checked. */
export function connectionVerdict(state: ConnectionState): ConnectionVerdict | null {
  if (!state.online) return 'offline';
  if (state.failed) return 'app';
  const lines = state.sources;
  if (lines === null) return null;
  const probes: SourceProbe[] = [];
  for (let i = 0; i < lines.length; i++) {
    const probe = lines[i]!.probe;
    if (probe === null) return null;
    probes.push(probe);
  }
  if (probes.length === 0) return 'none';
  const test = state.test;
  const played = test !== null && test.state === 'played';
  const asked = probes.filter((p) => p.kind === 'answered' || p.kind === 'unreachable' || p.kind === 'timeout');
  // Lablo's test stream reached the TV: the internet works, the providers' servers don't answer.
  if (asked.length > 0 && !asked.some((p) => p.kind === 'answered')) return played ? 'provider' : 'no-answer';
  for (let i = 0; i < probes.length; i++) {
    const account = accountVerdict(probes[i]!);
    if (account !== null) return account;
  }
  if (probes.some(answersBadly)) return 'provider';
  if (probes.some((p) => p.kind === 'error')) return 'app';
  if (probes.some((p) => p.kind === 'no-login')) return 'login';
  if (test !== null && test.state === 'failed') return 'test';
  const last = state.last;
  if (last !== null && last.state === 'failed') {
    const category = last.failure.category;
    if (category === 'device') return 'device';
    // This TV and Lablo play video: the provider's streams are the trouble.
    if (played && (category === 'provider' || category === 'internet')) return 'streams';
    if (category === 'provider') return 'channel';
    if (category === 'app') return 'app';
  }
  return 'ok';
}

/** The test stream's play: the link exactly as the config gives it, as a file (a live stream plays on). */
export function testRequest(url: string): PlayRequest {
  return { key: TEST_SOURCE, src: TEST_SOURCE, mode: 'vod', candidates: [{ url, container: containerOf(url) }] };
}

/** The page's buttons: "Check again", "Test stream" with a link, "Close". */
function actionsCount(testable: boolean): number {
  return testable ? 3 : 2;
}

export function createConnectionCheck(nav: Navigator, engine: ConnectionEngine, options: ConnectionOptions): ConnectionCheck {
  const state = signal<ConnectionState>({ online: true, sources: null, failed: false, last: null, testable: false, test: null });
  const pending = signal(0);
  const testView = signal<TestView>({ phase: 'opening', failure: null });
  let runs = 0;
  let disposed = false;
  let page: Screen | null = null;
  /** The test playing: its player, and the removal of its listener and of its watch on the config. */
  let testing: { readonly player: TestPlayer; readonly unsubscribe: () => void } | null = null;
  /** The test screen is open (its stream may have stopped: playback turned off, step 50c). */
  let onTestScreen = false;

  const testable = (): boolean => options.test !== undefined && options.test.link() !== null;

  /** A new state, keeping the test's result as it is now (a test may end while servers answer). */
  const put = (online: boolean, sources: readonly SourceLine[] | null, failed: boolean, last: LastPlay | null, canTest: boolean): void => {
    state.value = { online, sources, failed, last, testable: canTest, test: state.peek().test };
  };

  const setTest = (test: TestResult | null): void => {
    const now = state.peek();
    state.value = { online: now.online, sources: now.sources, failed: now.failed, last: now.last, testable: now.testable, test };
  };

  const check = (): void => {
    runs += 1;
    const run = runs;
    const current = (): boolean => !disposed && run === runs;
    const online = options.online();
    const last = options.last();
    const canTest = testable();
    if (page !== null && page.open) page.update({ kind: 'list', id: 'actions', axis: 'horizontal', count: actionsCount(canTest) });
    put(online, online ? null : [], false, last, canTest);
    if (!online) return;
    pending.value += 1;
    let listed: StoredSource[] = [];
    engine
      .profile()
      .then((profile) => {
        listed = storedSources(profile).slice(0, canTest ? CONNECTION_SOURCES_WITH_TEST : CONNECTION_SOURCES_MAX);
        if (!current()) return null;
        put(
          online,
          listed.map((s) => ({ id: s.id, name: s.name, probe: null })),
          false,
          last,
          canTest,
        );
        return listed.length === 0 ? [] : options.checkSources(listed);
      })
      .then(
        (probes) => {
          pending.value -= 1;
          if (probes === null || !current()) return;
          put(
            online,
            listed.map((s, i) => ({ id: s.id, name: s.name, probe: probes[i] ?? CHECK_FAILED })),
            false,
            last,
            canTest,
          );
        },
        (error: unknown) => {
          pending.value -= 1;
          console.warn('The connection check failed', error);
          if (!current()) return;
          const lines = state.peek().sources;
          // The profile read: each source's check failed. Else nothing is known of the sources.
          if (lines === null) put(online, [], true, last, canTest);
          else
            put(
              online,
              lines.map((l) => ({ id: l.id, name: l.name, probe: CHECK_FAILED })),
              false,
              last,
              canTest,
            );
        },
      );
  };

  /** Stops the test playing (its listener first: the stop's `idle` is none of its business). */
  const stopTest = (): void => {
    const playing = testing;
    if (playing === null) return;
    testing = null;
    playing.unsubscribe();
    void playing.player.stop();
    options.test!.playing(false);
  };

  /** The config took the test stream away (playback off, or no link): the page loses its button. */
  const dropTest = (): void => {
    const now = state.peek();
    if (!now.testable || testable()) return;
    state.value = { online: now.online, sources: now.sources, failed: now.failed, last: now.last, testable: false, test: now.test };
    if (page !== null && page.open) page.update({ kind: 'list', id: 'actions', axis: 'horizontal', count: actionsCount(false) });
  };

  const endTest = (): void => {
    if (!onTestScreen) return;
    onTestScreen = false;
    stopTest();
    nav.pop();
    dropTest();
  };

  const startTest = (): void => {
    const host = options.test;
    const url = host === undefined ? null : host.link();
    if (host === undefined || url === null || testing !== null || onTestScreen || disposed) return;
    const now = host.now ?? Date.now;
    const player = host.player();
    let session = -1;
    let played = false;
    testView.value = { phase: 'opening', failure: null };
    nav.push({
      id: TEST_SCREEN,
      zones: [{ kind: 'list', id: 'test', axis: 'horizontal', count: 1 }],
      onSelect: endTest,
      onIntent: (intent) => {
        if (intent !== 'BACK' && intent !== 'STOP') return false;
        endTest();
        return true;
      },
    });
    onTestScreen = true;
    host.playing(true);
    const started = now();
    const unsubscribe = player.subscribe((status) => {
      // The first status after the play is its own (`play` reports `opening` at once).
      if (session === -1) session = status.session;
      if (status.session !== session) return;
      const phase = status.state;
      if (phase === 'failed') {
        testView.value = { phase: 'failed', failure: status.failure };
        if (!played && status.failure !== null) setTest({ state: 'failed', failure: status.failure });
      } else if (phase === 'opening' || phase === 'reconnecting' || phase === 'ended') {
        testView.value = { phase, failure: null };
      } else if (phase !== 'idle') {
        testView.value = { phase: 'playing', failure: null };
        if (!played) {
          played = true;
          setTest({ state: 'played', container: status.container === null ? containerOf(url) : status.container, ms: now() - started });
        }
      }
    });
    let unwatch = (): void => undefined;
    testing = {
      player,
      unsubscribe: () => {
        unsubscribe();
        unwatch();
      },
    };
    // The config turning playback off (main's link() is null then) while the test plays (RELAY
    // step 50c): the stream stops as any other would, and the bar says so until Close.
    unwatch = effect(() => {
      if (host.link() !== null) return;
      stopTest();
      testView.value = { phase: 'off', failure: null };
    });
    void player.play(testRequest(url));
  };

  return {
    state,
    pending,
    testView,
    open(): void {
      setTest(null);
      const canTest = testable();
      page = nav.push({
        id: CONNECTION_SCREEN,
        zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: actionsCount(canTest) }],
        onSelect: (focus) => {
          if (focus.index === 0) check();
          else if (focus.index === 1 && state.peek().testable) startTest();
          else nav.pop();
        },
      });
      check();
    },
    again: check,
    test: startTest,
    endTest,
    dispose(): void {
      disposed = true;
      stopTest();
    },
  };
}
