import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile, SourceProbe, StoredSource } from '@lablo/data';
import { accountProblemCode } from '@lablo/player';
import type { Navigator } from '@lablo/ui';
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
 * Main-safe as the settings are: no `trim`, `.sort(`, regex, `for…of` or object spread.
 */

export const CONNECTION_SCREEN = 'connection-check';

/** The most sources listed: their lines, the internet's and the last stream's fit the screen. */
export const CONNECTION_SOURCES_MAX = 6;

/** The profile's reader (the settings' engine). */
export interface ConnectionEngine {
  profile(): Promise<LoadedProfile | null>;
}

/** What main gives. */
export interface ConnectionOptions {
  /** Whether the TV says it is online (`navigator.onLine`). */
  readonly online: () => boolean;
  /** The app run's last stream (`null`: none played or failed yet). */
  readonly last: () => LastPlay | null;
  /** Asks the sources' servers (`DataEngine.checkSources`), in their order. */
  readonly checkSources: (sources: readonly StoredSource[]) => Promise<SourceProbe[]>;
}

/** One source's line: its name, and its server's answer (`null`: being checked). */
export interface SourceLine {
  readonly id: string;
  readonly name: string;
  readonly probe: SourceProbe | null;
}

export interface ConnectionState {
  readonly online: boolean;
  /** The sources' lines; `null` while the profile is read; empty offline (nothing is asked). */
  readonly sources: readonly SourceLine[] | null;
  /** The profile couldn't be read: nothing is known of the sources. */
  readonly failed: boolean;
  readonly last: LastPlay | null;
}

/**
 * Whose problem it looks like, first rule first: the TV is offline; the app failed; the TV has no
 * source; no server answered; an account's own problem (its login refused, expired, closed by the
 * provider, every connection in use); a server answering badly; a source without its login; the
 * last stream's failure (a format the TV can't play, a channel the provider didn't send, the app);
 * else all is well.
 */
export type ConnectionVerdict = 'offline' | 'app' | 'none' | 'no-answer' | 'refused' | 'expired' | 'closed' | 'full' | 'provider' | 'login' | 'device' | 'channel' | 'ok';

export interface ConnectionCheck {
  readonly state: ReadonlySignal<ConnectionState>;
  /** The profile read and the servers' check in flight (0: the page is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** Opens the page and checks. */
  open(): void;
  /** "Check again". */
  again(): void;
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
  const asked = probes.filter((p) => p.kind === 'answered' || p.kind === 'unreachable' || p.kind === 'timeout');
  if (asked.length > 0 && !asked.some((p) => p.kind === 'answered')) return 'no-answer';
  for (let i = 0; i < probes.length; i++) {
    const account = accountVerdict(probes[i]!);
    if (account !== null) return account;
  }
  if (probes.some(answersBadly)) return 'provider';
  if (probes.some((p) => p.kind === 'error')) return 'app';
  if (probes.some((p) => p.kind === 'no-login')) return 'login';
  const last = state.last;
  if (last !== null && last.state === 'failed') {
    const category = last.failure.category;
    if (category === 'device') return 'device';
    if (category === 'provider') return 'channel';
    if (category === 'app') return 'app';
  }
  return 'ok';
}

export function createConnectionCheck(nav: Navigator, engine: ConnectionEngine, options: ConnectionOptions): ConnectionCheck {
  const state = signal<ConnectionState>({ online: true, sources: null, failed: false, last: null });
  const pending = signal(0);
  let runs = 0;
  let disposed = false;

  const check = (): void => {
    runs += 1;
    const run = runs;
    const current = (): boolean => !disposed && run === runs;
    const online = options.online();
    const last = options.last();
    state.value = { online, sources: online ? null : [], failed: false, last };
    if (!online) return;
    pending.value += 1;
    let listed: StoredSource[] = [];
    engine
      .profile()
      .then((profile) => {
        listed = storedSources(profile).slice(0, CONNECTION_SOURCES_MAX);
        if (!current()) return null;
        state.value = { online, sources: listed.map((s) => ({ id: s.id, name: s.name, probe: null })), failed: false, last };
        return listed.length === 0 ? [] : options.checkSources(listed);
      })
      .then(
        (probes) => {
          pending.value -= 1;
          if (probes === null || !current()) return;
          state.value = { online, sources: listed.map((s, i) => ({ id: s.id, name: s.name, probe: probes[i] ?? CHECK_FAILED })), failed: false, last };
        },
        (error: unknown) => {
          pending.value -= 1;
          console.warn('The connection check failed', error);
          if (!current()) return;
          const lines = state.peek().sources;
          // The profile read: each source's check failed. Else nothing is known of the sources.
          state.value = lines === null ? { online, sources: [], failed: true, last } : { online, sources: lines.map((l) => ({ id: l.id, name: l.name, probe: CHECK_FAILED })), failed: false, last };
        },
      );
  };

  return {
    state,
    pending,
    open(): void {
      nav.push({
        id: CONNECTION_SCREEN,
        zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }],
        onSelect: (focus) => {
          if (focus.index === 0) check();
          else nav.pop();
        },
      });
      check();
    },
    again: check,
    dispose(): void {
      disposed = true;
    },
  };
}
