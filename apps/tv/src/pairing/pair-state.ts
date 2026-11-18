import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { PairCode, PairFailure, PairPollResult } from '@lablo/data/client';
import { PAIR_POLL_MS } from '@lablo/data/client';
import type { LifecycleEvent } from '@lablo/platform-api';
import type { PairStatus } from '@lablo/protocol';
import type { Navigator, Screen, ZoneSpec } from '@lablo/ui';
import type { PairSession } from '../data/engine';
import type { Refusal } from '../gate/gate-state';
import type { SourceDraft } from '../onboarding/form';
import type { LoadErrorCode, LoadHandle, LoadProgress, LoadResult, SourceLoader } from '../onboarding/loader';
import { LoadError } from '../onboarding/loader';
import { pairDraft, statusFor } from './pair-draft';

/**
 * The pairing screen (RELAY step 31c2a, architecture.md §3.3 A): a code and its QR code for the
 * phone page, the source the phone sends, added the way onboarding adds one, and the outcome's
 * category back to the phone.
 *
 * - **A session per opening:** `open()` pushes the `pair` screen and starts a pair worker
 *   (`DataEngine.pairing()`), which holds the secret key. The worker ends when the screen leaves
 *   the stack or the state is disposed (after a status still being sent).
 * - **The poll:** every `PAIR_POLL_MS` while a code shows; `wait` as `Retry-After` says; a
 *   `failed` poll at the next tick, the view "still trying" until one answers. Stopped while the
 *   app is hidden, and asked at once when it shows again.
 * - **New codes:** the TV's clock can't be held against the server's, so a code is renewed when
 *   the poll says it ended; after `PAIR_CODES` codes ended unused, the screen waits for "Show a
 *   new code". A payload that can't be read, or that the form would refuse, gives a new code with
 *   a note and sends no status (only a payload not from the phone page can be one).
 * - **The add path:** the config's `block-new-sources` first (refused: `blocked`), then the
 *   source loader (the data engine's blocklist, the provider's answer). `ok` goes once the
 *   catalog is saved (the loader's `guide` phase, or its end); a failure's category as
 *   `statusFor` says; a load cancelled on the TV sends nothing. One status per payload ("Try
 *   again" sends no second one), tried up to `STATUS_TRIES` times.
 */

/** Codes made one after another while nothing was sent; then "Show a new code". */
export const PAIR_CODES = 3;
/** Tries of one status (2 s, then 4 s apart). */
export const STATUS_TRIES = 3;
export const PAIR_SCREEN = 'pair';

/** A note over a new code. */
export type PairNote = 'unreadable' | null;

export type PairView =
  /** Asking the server for a code. */
  | { readonly kind: 'opening'; readonly note: PairNote }
  /** A code on show, polled. `trouble`: the last poll failed (no connection, the server). */
  | { readonly kind: 'code'; readonly code: PairCode; readonly trouble: boolean; readonly note: PairNote }
  /** No code was given (`rate`: too many asked for). "Try again". */
  | { readonly kind: 'unavailable'; readonly failure: PairFailure }
  /** `PAIR_CODES` codes ended unused. "Show a new code". */
  | { readonly kind: 'ended' }
  /** The phone's source loads. */
  | { readonly kind: 'loading'; readonly progress: LoadProgress | null }
  | { readonly kind: 'failed'; readonly code: LoadErrorCode; readonly httpStatus: number | null }
  /** The config refuses new sources (step 30c2b). */
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'done'; readonly result: LoadResult };

export type PairViewKind = PairView['kind'];

/** The buttons of each view, in screen order. */
export type PairAction = 'cancel' | 'retry-code' | 'new-code' | 'retry-load' | 'close';

export function pairActions(kind: PairViewKind): readonly PairAction[] {
  if (kind === 'unavailable') return ['retry-code'];
  if (kind === 'ended') return ['new-code'];
  if (kind === 'failed' || kind === 'refused') return ['new-code', 'retry-load'];
  if (kind === 'done') return ['close'];
  return ['cancel'];
}

export interface PairTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: PairTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface PairingOptions {
  readonly nav: Navigator;
  /** A new pairing session in its own worker (`DataEngine.pairing`). */
  readonly session: () => PairSession;
  /** The API's origin: the code's link and the address to type are on it. */
  readonly base: string;
  readonly loader: SourceLoader;
  /** The config's rule refusing new sources (step 30c2b): read when the payload comes and at "Try again". */
  readonly refusal?: ReadonlySignal<Refusal | null>;
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  readonly timers?: PairTimers;
  /** A load starts (`true`) or ends either way (`false`): Settings holds the background refreshes meanwhile. */
  readonly busy?: (on: boolean) => void;
  /** The source was added (after its status went). Onboarding shows its done screen. */
  readonly added?: (draft: SourceDraft, result: LoadResult) => void;
}

export interface Pairing {
  readonly view: ReadonlySignal<PairView>;
  /** The source being added (its name in the titles). */
  readonly draft: ReadonlySignal<SourceDraft | null>;
  /** The status sent for the last payload (tests and the e2e read it), `null` before one. */
  readonly sent: ReadonlySignal<PairStatus | null>;
  /** Pushes the pairing screen and asks for a code. */
  open(): void;
  dispose(): void;
}

function actionsZone(kind: PairViewKind): ZoneSpec {
  return { kind: 'list', id: 'actions', axis: 'horizontal', count: pairActions(kind).length };
}

export function createPairing(options: PairingOptions): Pairing {
  const { nav, loader } = options;
  const timers = options.timers ?? REAL_TIMERS;
  const view = signal<PairView>({ kind: 'opening', note: null });
  const draft = signal<SourceDraft | null>(null);
  const sent = signal<PairStatus | null>(null);

  let screen: Screen | null = null;
  let session: PairSession | null = null;
  /** Bumps on each code asked for, and on close: an older request's answer is dropped. */
  let seq = 0;
  /** Codes that ended unused since the last press (or payload). */
  let codes = 0;
  let pollTimer: unknown = null;
  let polling = false;
  let hidden = false;
  /** The load running, if any: answers from an older one are dropped. */
  let current: { handle: LoadHandle | null } | null = null;
  /** A status went for the payload being added (once per payload). */
  let statusDone = true;
  /** A status request in flight: the worker ends after it. */
  let statusRunning: Promise<unknown> | null = null;
  let statusTimer: unknown = null;
  let stopLifecycle: (() => void) | null = null;
  let stopNav: (() => void) | null = null;

  const show = (next: PairView): void => {
    const before = view.peek().kind;
    view.value = next;
    if (screen !== null && screen.open && before !== next.kind) {
      screen.update(actionsZone(next.kind));
      screen.focus('actions', 0);
    }
  };

  const clearPoll = (): void => {
    if (pollTimer !== null) timers.clear(pollTimer);
    pollTimer = null;
  };

  /** Ends the worker: at once, or after the status being sent. */
  const endSession = (): void => {
    const ending = session;
    session = null;
    if (ending === null) return;
    if (statusRunning === null) ending.close();
    else statusRunning.then(() => ending.close());
  };

  /** A worker whose calls reject is done: the next code starts another. */
  const broken = (): void => {
    const ending = session;
    session = null;
    ending?.close();
  };

  const cancelLoad = (): void => {
    if (current === null) return;
    current.handle?.cancel();
    current = null;
    options.busy?.(false);
  };

  const sendStatus = (status: PairStatus, attempt: number): void => {
    statusTimer = null;
    const to = session;
    if (to === null) return;
    sent.value = status;
    const running = to.status(status).then(
      (result) => {
        if (result.ok || attempt >= STATUS_TRIES || session !== to) return;
        statusTimer = timers.set(() => sendStatus(status, attempt + 1), PAIR_POLL_MS * attempt);
      },
      () => undefined,
    );
    statusRunning = running;
    void running.then(() => {
      if (statusRunning === running) statusRunning = null;
    });
  };

  /** The payload's one status. */
  const report = (status: PairStatus): void => {
    if (statusDone) return;
    statusDone = true;
    sendStatus(status, 1);
  };

  const schedulePoll = (ms: number): void => {
    clearPoll();
    if (hidden || screen === null || !screen.open) return;
    pollTimer = timers.set(poll, ms);
  };

  /** A new code: the session before it is forgotten in the worker. */
  const openCode = (note: PairNote): void => {
    clearPoll();
    seq += 1;
    const mine = seq;
    show({ kind: 'opening', note });
    if (session === null) {
      try {
        session = options.session();
      } catch (error) {
        console.warn('The pairing worker did not start', error);
        show({ kind: 'unavailable', failure: 'network' });
        return;
      }
    }
    const asked = session;
    asked.open(options.base).then(
      (result) => {
        if (mine !== seq) return;
        if (!result.ok) {
          show({ kind: 'unavailable', failure: result.failure });
          return;
        }
        show({ kind: 'code', code: result.code, trouble: false, note });
        schedulePoll(PAIR_POLL_MS);
      },
      (error: unknown) => {
        if (mine !== seq) return;
        console.warn('The pairing code was not made', error);
        broken();
        show({ kind: 'unavailable', failure: 'network' });
      },
    );
  };

  const added = (payloadDraft: SourceDraft, result: LoadResult): void => {
    show({ kind: 'done', result });
    options.added?.(payloadDraft, result);
  };

  const startLoad = (source: SourceDraft): void => {
    const mine: { handle: LoadHandle | null } = { handle: null };
    current = mine;
    options.busy?.(true);
    show({ kind: 'loading', progress: null });
    // A loader may report progress before start() returns: `mine` is current already.
    const handle = loader.start(source, (progress) => {
      if (current !== mine) return;
      view.value = { kind: 'loading', progress };
      // The catalog is saved: the source works, whatever its guides do.
      if (progress.phase === 'guide') report('ok');
    });
    mine.handle = handle;
    handle.done.then(
      (result) => {
        if (current !== mine) return;
        current = null;
        options.busy?.(false);
        report('ok');
        added(source, result);
      },
      (error: unknown) => {
        if (current !== mine) return;
        current = null;
        options.busy?.(false);
        const failure = error instanceof LoadError ? error : new LoadError('other');
        report(statusFor(failure.code));
        show({ kind: 'failed', code: failure.code, httpStatus: failure.status });
      },
    );
  };

  /** The source, unless the config refuses new sources. */
  const begin = (source: SourceDraft): void => {
    const refusal = options.refusal === undefined ? null : options.refusal.peek();
    if (refusal !== null) {
      report(statusFor('refused'));
      show({ kind: 'refused', refusal });
      return;
    }
    startLoad(source);
  };

  const answered = (result: PairPollResult): void => {
    const shown = view.peek();
    if (result.state === 'waiting') {
      if (shown.kind === 'code' && shown.trouble) show({ kind: 'code', code: shown.code, trouble: false, note: shown.note });
      schedulePoll(PAIR_POLL_MS);
    } else if (result.state === 'wait') {
      schedulePoll(result.retryMs);
    } else if (result.state === 'failed') {
      if (shown.kind === 'code' && !shown.trouble) show({ kind: 'code', code: shown.code, trouble: true, note: shown.note });
      schedulePoll(PAIR_POLL_MS);
    } else if (result.state === 'ended') {
      codes += 1;
      if (codes < PAIR_CODES) openCode(null);
      else show({ kind: 'ended' });
    } else if (result.state === 'unreadable') {
      codes = 0;
      openCode('unreadable');
    } else {
      const source = pairDraft(result.payload);
      codes = 0;
      if (source === null) {
        openCode('unreadable');
        return;
      }
      draft.value = source;
      statusDone = false;
      begin(source);
    }
  };

  function poll(): void {
    pollTimer = null;
    const asked = session;
    if (asked === null || view.peek().kind !== 'code') return;
    const mine = seq;
    polling = true;
    asked.poll().then(
      (result) => {
        polling = false;
        if (mine === seq) answered(result);
      },
      (error: unknown) => {
        polling = false;
        if (mine !== seq) return;
        console.warn('The pairing poll failed', error);
        broken();
        show({ kind: 'unavailable', failure: 'network' });
      },
    );
  }

  /** Everything stops: the poll, the load (no status), the worker (after a status being sent). */
  const close = (): void => {
    seq += 1;
    clearPoll();
    if (statusTimer !== null) timers.clear(statusTimer);
    statusTimer = null;
    cancelLoad();
    endSession();
    stopLifecycle?.();
    stopLifecycle = null;
    stopNav?.();
    stopNav = null;
    screen = null;
  };

  const select = (index: number): void => {
    const action = pairActions(view.peek().kind)[index];
    if (action === 'cancel' || action === 'close') {
      cancelLoad();
      nav.pop();
    } else if (action === 'retry-code') {
      openCode(null);
    } else if (action === 'new-code') {
      codes = 0;
      openCode(null);
    } else if (action === 'retry-load' && draft.peek() !== null) {
      begin(draft.peek()!);
    }
  };

  return {
    view,
    draft,
    sent,
    open(): void {
      close();
      codes = 0;
      hidden = false;
      draft.value = null;
      sent.value = null;
      statusDone = true;
      view.value = { kind: 'opening', note: null };
      const pushed = nav.push({
        id: PAIR_SCREEN,
        zones: [actionsZone('opening')],
        onIntent: (intent) => {
          // Back closes the screen: a load running is cancelled first (no status goes).
          if (intent === 'BACK') cancelLoad();
          return false;
        },
        onSelect: (focus) => select(focus.index),
      });
      screen = pushed;
      // The screen left the stack (Back, Cancel, Done, or onboarding's done screen): the worker ends.
      stopNav = nav.subscribe(() => {
        if (!pushed.open && screen === pushed) close();
      });
      if (options.lifecycle !== undefined) {
        stopLifecycle = options.lifecycle((event) => {
          if (event === 'hidden') {
            hidden = true;
            clearPoll();
          } else if (event === 'visible') {
            hidden = false;
            if (view.peek().kind === 'code' && !polling && pollTimer === null) poll();
          }
        });
      }
      openCode(null);
    },
    dispose(): void {
      close();
    },
  };
}
