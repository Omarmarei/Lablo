import { signal } from '@preact/signals';
import type { PairCode, PairOpenResult, PairPollResult, PairStatusResult } from '@lablo/data/client';
import { PAIR_POLL_MS } from '@lablo/data/client';
import type { LifecycleEvent } from '@lablo/platform-api';
import type { PairPayload, PairStatus } from '@lablo/protocol';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { PairSession } from '../data/engine';
import type { Refusal } from '../gate/gate-state';
import type { SourceDraft } from '../onboarding/form';
import type { LoadErrorCode, LoadProgress, LoadResult } from '../onboarding/loader';
import { LoadError } from '../onboarding/loader';
import type { PairView } from './pair-state';
import { PAIR_CODES, PAIR_SCREEN, STATUS_TRIES, createPairing, pairActions } from './pair-state';

/**
 * The pairing screen's state (RELAY step 31c2a) over a fake pair worker, a fake loader, held
 * timers and a real navigator: the poll and its waits, renewal and the cap, hidden and shown, each
 * poll answer, the add path and the status each outcome sends.
 */

const BASE = 'http://api.test:3100';

interface Held<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function held<T>(): Held<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function code(text: string): PairCode {
  return { code: text, exp: 1, link: `${BASE}/p#c=${text}&k=KEY`, typed: 'api.test:3100/p', qr: { size: 21, version: 1, level: 'M', mask: 0, rows: ['1'.repeat(21)] } };
}

const M3U_PAYLOAD: PairPayload = { v: 1, source: { type: 'm3u', url: 'Lists.Test/a.m3u' }, name: '  Phone list ', epg: ['lists.test/g.xml', 'http://lists.test/g.xml', 'https://more.test/h.xml'] };
const M3U_DRAFT: SourceDraft = { type: 'm3u', name: 'Phone list', url: 'http://lists.test/a.m3u', epgUrls: ['http://lists.test/g.xml', 'https://more.test/h.xml'] };
const XTREAM_PAYLOAD: PairPayload = { v: 1, source: { type: 'xtream', server: 'panel.test:8080/', username: ' u1 ', password: 'p1' } };
const RESULT: LoadResult = { live: 12, movies: 3, series: 1 };

/** One pair worker: each call held until the test answers it. */
class FakeSession implements PairSession {
  readonly opens: Array<{ base: string; answer: Held<PairOpenResult> }> = [];
  readonly polls: Array<Held<PairPollResult>> = [];
  readonly statuses: Array<{ status: PairStatus; answer: Held<PairStatusResult> }> = [];
  closed = 0;

  open(base: string): Promise<PairOpenResult> {
    const answer = held<PairOpenResult>();
    this.opens.push({ base, answer });
    return answer.promise;
  }
  poll(): Promise<PairPollResult> {
    const answer = held<PairPollResult>();
    this.polls.push(answer);
    return answer.promise;
  }
  status(status: PairStatus): Promise<PairStatusResult> {
    const answer = held<PairStatusResult>();
    this.statuses.push({ status, answer });
    return answer.promise;
  }
  close(): void {
    this.closed += 1;
  }
  /** Answers the last code asked for. */
  async gives(text: string): Promise<void> {
    this.opens[this.opens.length - 1]!.answer.resolve({ ok: true, code: code(text) });
    await flush();
  }
  /** Answers the last poll. */
  async polled(result: PairPollResult): Promise<void> {
    this.polls[this.polls.length - 1]!.resolve(result);
    await flush();
  }
}

interface Timer {
  readonly run: () => void;
  readonly ms: number;
  cleared: boolean;
}

interface Load {
  readonly draft: SourceDraft;
  readonly onProgress: (progress: LoadProgress) => void;
  readonly done: Held<LoadResult>;
  cancelled: boolean;
}

function setup(options: { refusal?: Refusal | null; failSession?: boolean } = {}) {
  const sessions: FakeSession[] = [];
  const timers: Timer[] = [];
  const loads: Load[] = [];
  const busy: boolean[] = [];
  const added: Array<{ draft: SourceDraft; result: LoadResult }> = [];
  let lifecycle: ((event: LifecycleEvent) => void) | null = null;
  let unsubscribed = 0;
  const refusal = signal<Refusal | null>(options.refusal ?? null);
  const nav = createNavigator({ root: { id: 'home', zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: 1 }] }, rootBack: 'platform-back', exit: () => undefined, exitDialog: () => undefined });
  const pairing = createPairing({
    nav,
    base: BASE,
    session: () => {
      if (options.failSession === true) throw new Error('no worker');
      const session = new FakeSession();
      sessions.push(session);
      return session;
    },
    loader: {
      start: (draft, onProgress) => {
        const load: Load = { draft, onProgress, done: held<LoadResult>(), cancelled: false };
        loads.push(load);
        return {
          done: load.done.promise,
          cancel: () => {
            load.cancelled = true;
          },
        };
      },
    },
    refusal,
    lifecycle: (listener) => {
      lifecycle = listener;
      return () => {
        unsubscribed += 1;
        lifecycle = null;
      };
    },
    timers: {
      set: (run, ms) => {
        const timer: Timer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear: (handle) => {
        (handle as Timer).cleared = true;
      },
    },
    busy: (on) => busy.push(on),
    added: (draft, result) => added.push({ draft, result }),
  });
  /** The timers set and not cleared or run. */
  const pending = (): number[] => timers.filter((t) => !t.cleared).map((t) => t.ms);
  /** Runs the one pending timer. */
  const tick = async (): Promise<void> => {
    const live = timers.filter((t) => !t.cleared);
    expect(live).toHaveLength(1);
    live[0]!.cleared = true;
    live[0]!.run();
    await flush();
  };
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const kind = (): PairView['kind'] => pairing.view.value.kind;
  const session = (): FakeSession => sessions[sessions.length - 1]!;
  /** Opens the screen and answers the first code: the poll waits. */
  const opened = async (text = 'ABCD2345'): Promise<FakeSession> => {
    pairing.open();
    await session().gives(text);
    return session();
  };
  /** A code on show, then the phone's payload. */
  const received = async (payload: PairPayload = M3U_PAYLOAD): Promise<FakeSession> => {
    const s = await opened();
    await tick();
    await s.polled({ state: 'ready', payload });
    return s;
  };
  return {
    nav,
    pairing,
    sessions,
    timers,
    loads,
    busy,
    added,
    refusal,
    pending,
    tick,
    at,
    kind,
    session,
    opened,
    received,
    lifecycle: (event: LifecycleEvent) => lifecycle?.(event),
    hasLifecycle: () => lifecycle !== null,
    unsubscribed: () => unsubscribed,
  };
}

describe('pairActions', () => {
  it('renews up to three codes, and tries a status three times', () => {
    expect(PAIR_CODES).toBe(3);
    expect(STATUS_TRIES).toBe(3);
  });

  it("gives each view its buttons, in screen order", () => {
    expect(pairActions('opening')).toEqual(['cancel']);
    expect(pairActions('code')).toEqual(['cancel']);
    expect(pairActions('loading')).toEqual(['cancel']);
    expect(pairActions('unavailable')).toEqual(['retry-code']);
    expect(pairActions('ended')).toEqual(['new-code']);
    expect(pairActions('failed')).toEqual(['new-code', 'retry-load']);
    expect(pairActions('refused')).toEqual(['new-code', 'retry-load']);
    expect(pairActions('done')).toEqual(['close']);
  });
});

describe('a code and its poll', () => {
  it('opens the pair screen with a worker of its own, asks for a code on the base, then polls every 2 s', async () => {
    const t = setup();
    t.pairing.open();
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 0`);
    expect(t.sessions).toHaveLength(1);
    expect(t.session().opens.map((o) => o.base)).toEqual([BASE]);
    expect(t.pairing.view.value).toEqual({ kind: 'opening', note: null });
    expect(t.pending()).toEqual([]);
    await t.session().gives('ABCD2345');
    expect(t.pairing.view.value).toEqual({ kind: 'code', code: code('ABCD2345'), trouble: false, note: null });
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    await t.tick();
    expect(t.session().polls).toHaveLength(1);
    expect(t.pending()).toEqual([]);
    await t.session().polled({ state: 'waiting' });
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    expect(t.kind()).toBe('code');
  });

  it("waits as long as the server's Retry-After says", async () => {
    const t = setup();
    const s = await t.opened();
    await t.tick();
    await s.polled({ state: 'wait', retryMs: 30_000 });
    expect(t.pending()).toEqual([30_000]);
    expect(t.kind()).toBe('code');
  });

  it('says "still trying" after a failed poll, asks again at the next tick, and clears it once one answers', async () => {
    const t = setup();
    const s = await t.opened();
    await t.tick();
    await s.polled({ state: 'failed', failure: 'network' });
    expect(t.pairing.view.value).toMatchObject({ kind: 'code', trouble: true });
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    await t.tick();
    await s.polled({ state: 'failed', failure: 'timeout' });
    expect(t.pairing.view.value).toMatchObject({ kind: 'code', trouble: true });
    await t.tick();
    await s.polled({ state: 'waiting' });
    expect(t.pairing.view.value).toEqual({ kind: 'code', code: code('ABCD2345'), trouble: false, note: null });
    // The code view's button keeps the focus throughout.
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 0`);
  });

  it('renews an ended code on the same worker, up to three codes, then waits for "Show a new code"', async () => {
    const t = setup();
    const s = await t.opened('AAAA1111');
    for (let i = 1; i < PAIR_CODES; i += 1) {
      await t.tick();
      await s.polled({ state: 'ended' });
      expect(t.kind()).toBe('opening');
      expect(s.opens).toHaveLength(i + 1);
      await s.gives(`BBBB000${i}`);
      expect(t.pairing.view.value).toMatchObject({ kind: 'code', code: { code: `BBBB000${i}` } });
    }
    await t.tick();
    await s.polled({ state: 'ended' });
    expect(t.pairing.view.value).toEqual({ kind: 'ended' });
    expect(s.opens).toHaveLength(PAIR_CODES);
    expect(t.pending()).toEqual([]);
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 0`);
    // "Show a new code": three more.
    t.nav.handle('OK');
    expect(t.kind()).toBe('opening');
    expect(s.opens).toHaveLength(PAIR_CODES + 1);
    await s.gives('CCCC2222');
    await t.tick();
    await s.polled({ state: 'ended' });
    expect(t.kind()).toBe('opening');
    expect(t.sessions).toHaveLength(1);
  });

  it('makes a new code with a note for a payload that could not be read, and sends no status', async () => {
    const t = setup();
    const s = await t.opened();
    await t.tick();
    await s.polled({ state: 'ended' });
    await s.gives('BBBB2222');
    await t.tick();
    await s.polled({ state: 'unreadable' });
    expect(t.pairing.view.value).toEqual({ kind: 'opening', note: 'unreadable' });
    await s.gives('CCCC3333');
    expect(t.pairing.view.value).toEqual({ kind: 'code', code: code('CCCC3333'), trouble: false, note: 'unreadable' });
    expect(s.statuses).toEqual([]);
    expect(t.loads).toEqual([]);
    // The count started again: two codes may still end before the cap.
    for (let i = 0; i < PAIR_CODES - 1; i += 1) {
      await t.tick();
      await s.polled({ state: 'ended' });
      expect(t.kind()).toBe('opening');
      await s.gives(`DDDD000${i}`);
      // A renewed code has no note.
      expect(t.pairing.view.value).toMatchObject({ kind: 'code', note: null });
    }
    await t.tick();
    await s.polled({ state: 'ended' });
    expect(t.kind()).toBe('ended');
  });

  it.each<[string, PairPayload]>([
    ['a server the form refuses', { v: 1, source: { type: 'xtream', server: 'ftp://panel.test', username: 'u', password: 'p' } }],
    ['an empty login', { v: 1, source: { type: 'xtream', server: 'panel.test', username: '  ', password: 'p' } }],
    ['a guide link the form refuses', { v: 1, source: { type: 'm3u', url: 'lists.test/a.m3u' }, epg: ['lists.test/g.xml', 'mailto:x@y'] }],
    ['an M3U file (step 31d)', { v: 1, source: { type: 'm3u-file', file: { key: 'k', fileKey: 'f', base: 'b', size: 10 } } }],
  ])('treats %s as unreadable: a new code with a note, no load, no status', async (_, payload) => {
    const t = setup();
    const s = await t.received(payload);
    expect(t.pairing.view.value).toEqual({ kind: 'opening', note: 'unreadable' });
    expect(s.opens).toHaveLength(2);
    expect(t.loads).toEqual([]);
    expect(s.statuses).toEqual([]);
    expect(t.pairing.draft.value).toBeNull();
  });

  it('shows "no code" when the server refuses or is out of reach, and asks again on "Try again"', async () => {
    const t = setup();
    t.pairing.open();
    const s = t.session();
    s.opens[0]!.answer.resolve({ ok: false, failure: 'rate', retryMs: 60_000 });
    await flush();
    expect(t.pairing.view.value).toEqual({ kind: 'unavailable', failure: 'rate' });
    expect(t.pending()).toEqual([]);
    t.nav.handle('OK');
    expect(t.kind()).toBe('opening');
    s.opens[1]!.answer.resolve({ ok: false, failure: 'network', retryMs: null });
    await flush();
    expect(t.pairing.view.value).toEqual({ kind: 'unavailable', failure: 'network' });
    t.nav.handle('OK');
    await s.gives('ABCD2345');
    expect(t.kind()).toBe('code');
    expect(t.sessions).toHaveLength(1);
  });

  it('ends a worker whose calls reject, and starts a new one on "Try again"', async () => {
    const t = setup();
    const first = await t.opened();
    await t.tick();
    first.polls[0]!.reject(new Error('worker died'));
    await flush();
    expect(t.pairing.view.value).toEqual({ kind: 'unavailable', failure: 'network' });
    expect(first.closed).toBe(1);
    t.nav.handle('OK');
    expect(t.sessions).toHaveLength(2);
    t.session().opens[0]!.answer.reject(new Error('worker died again'));
    await flush();
    expect(t.pairing.view.value).toEqual({ kind: 'unavailable', failure: 'network' });
    expect(t.session().closed).toBe(1);
    t.nav.handle('OK');
    expect(t.sessions).toHaveLength(3);
    await t.session().gives('ABCD2345');
    expect(t.kind()).toBe('code');
  });

  it("shows \"no code\" when the worker can't start", () => {
    const t = setup({ failSession: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.pairing.open();
    expect(t.pairing.view.value).toEqual({ kind: 'unavailable', failure: 'network' });
    warn.mockRestore();
  });

  it("drops the answer of a code asked for by an opening that was closed", async () => {
    const t = setup();
    t.pairing.open();
    const first = t.session();
    t.nav.handle('BACK');
    t.pairing.open();
    const second = t.session();
    expect(second).not.toBe(first);
    await first.gives('LATE0000');
    expect(t.kind()).toBe('opening');
    expect(t.pending()).toEqual([]);
    await second.gives('ABCD2345');
    expect(t.pairing.view.value).toMatchObject({ kind: 'code', code: { code: 'ABCD2345' } });
  });
});

describe('hidden and shown', () => {
  it("stops polling while the app is hidden and asks at once when it shows again", async () => {
    const t = setup();
    const s = await t.opened();
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    t.lifecycle('hidden');
    expect(t.pending()).toEqual([]);
    t.lifecycle('relaunch');
    expect(s.polls).toHaveLength(0);
    t.lifecycle('visible');
    expect(s.polls).toHaveLength(1);
    await s.polled({ state: 'waiting' });
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
  });

  it('a relaunch changes nothing, and shown while a poll is due asks nothing more', async () => {
    const t = setup();
    const s = await t.opened();
    t.lifecycle('relaunch');
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    t.lifecycle('visible');
    expect(s.polls).toHaveLength(0);
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
  });

  it('schedules nothing from a poll answered while hidden, and asks once when shown during a poll', async () => {
    const t = setup();
    const s = await t.opened();
    await t.tick();
    t.lifecycle('hidden');
    await s.polled({ state: 'waiting' });
    expect(t.pending()).toEqual([]);
    t.lifecycle('visible');
    expect(s.polls).toHaveLength(2);
    // Shown again while that poll runs: no second one.
    t.lifecycle('hidden');
    t.lifecycle('visible');
    expect(s.polls).toHaveLength(2);
  });

  it('starts polling a code that came while hidden once shown, and only a code view polls', async () => {
    const t = setup();
    t.pairing.open();
    t.lifecycle('hidden');
    await t.session().gives('ABCD2345');
    expect(t.pending()).toEqual([]);
    t.lifecycle('visible');
    expect(t.session().polls).toHaveLength(1);
    const u = setup();
    u.pairing.open();
    u.lifecycle('hidden');
    u.lifecycle('visible');
    expect(u.session().polls).toHaveLength(0);
  });
});

describe('the add path', () => {
  it("adds the phone's source through the loader, sends ok once its catalog is saved, then shows done", async () => {
    const t = setup();
    const s = await t.received();
    expect(t.loads).toHaveLength(1);
    expect(t.loads[0]!.draft).toEqual(M3U_DRAFT);
    expect(t.pairing.draft.value).toEqual(M3U_DRAFT);
    expect(t.pairing.view.value).toEqual({ kind: 'loading', progress: null });
    expect(t.busy).toEqual([true]);
    expect(t.pending()).toEqual([]);
    const download: LoadProgress = { phase: 'download', bytes: 10, total: 100, items: 4 };
    t.loads[0]!.onProgress(download);
    expect(t.pairing.view.value).toEqual({ kind: 'loading', progress: download });
    expect(s.statuses).toEqual([]);
    t.loads[0]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 16 });
    expect(s.statuses.map((x) => x.status)).toEqual(['ok']);
    expect(t.pairing.sent.value).toBe('ok');
    t.loads[0]!.onProgress({ phase: 'guide', bytes: 5, total: 10, items: 16 });
    t.loads[0]!.done.resolve(RESULT);
    await flush();
    expect(s.statuses.map((x) => x.status)).toEqual(['ok']);
    expect(t.pairing.view.value).toEqual({ kind: 'done', result: RESULT });
    expect(t.added).toEqual([{ draft: M3U_DRAFT, result: RESULT }]);
    expect(t.busy).toEqual([true, false]);
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 0`);
    // "Done" closes the screen: the worker ends once its status has answered.
    t.nav.handle('OK');
    expect(t.nav.snapshot().screen).toBe('home');
    expect(s.closed).toBe(0);
    s.statuses[0]!.answer.resolve({ ok: true });
    await flush();
    expect(s.closed).toBe(1);
  });

  it('sends ok at the end when the load never reached its guides, and an Xtream login goes through the form too', async () => {
    const t = setup();
    const s = await t.received(XTREAM_PAYLOAD);
    expect(t.loads[0]!.draft).toEqual({ type: 'xtream', name: 'panel.test', account: { base: 'http://panel.test:8080', username: 'u1', password: 'p1' }, epgUrls: [] });
    t.loads[0]!.done.resolve(RESULT);
    await flush();
    expect(s.statuses.map((x) => x.status)).toEqual(['ok']);
    expect(t.kind()).toBe('done');
  });

  it.each<[LoadErrorCode, PairStatus]>([
    ['auth', 'auth_failed'],
    ['expired', 'expired'],
    ['blocked', 'expired'],
    ['blocklisted', 'blocked'],
    ['network', 'unreachable'],
    ['http', 'unreachable'],
    ['format', 'unreachable'],
    ['empty', 'unreachable'],
    ['other', 'unreachable'],
  ])('a load that fails with %s sends %s, and offers a new code and Try again', async (failure, status) => {
    const t = setup();
    const s = await t.received(XTREAM_PAYLOAD);
    t.loads[0]!.done.reject(new LoadError(failure, failure === 'http' ? 503 : null));
    await flush();
    expect(s.statuses.map((x) => x.status)).toEqual([status]);
    expect(t.pairing.view.value).toEqual({ kind: 'failed', code: failure, httpStatus: failure === 'http' ? 503 : null });
    expect(t.busy).toEqual([true, false]);
    expect((t.nav.top.zone('actions') as { count: number }).count).toBe(2);
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 0`);
    expect(t.added).toEqual([]);
  });

  it('turns an error that is no LoadError into other (unreachable)', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.done.reject(new Error('boom'));
    await flush();
    expect(t.pairing.view.value).toEqual({ kind: 'failed', code: 'other', httpStatus: null });
    expect(s.statuses.map((x) => x.status)).toEqual(['unreachable']);
  });

  it('"Try again" loads the same source again and sends no second status', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.done.reject(new LoadError('network'));
    await flush();
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    expect(t.loads).toHaveLength(2);
    expect(t.loads[1]!.draft).toEqual(M3U_DRAFT);
    expect(t.kind()).toBe('loading');
    t.loads[1]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 1 });
    t.loads[1]!.done.resolve(RESULT);
    await flush();
    expect(s.statuses.map((x) => x.status)).toEqual(['unreachable']);
    expect(t.added).toEqual([{ draft: M3U_DRAFT, result: RESULT }]);
  });

  it('"Show a new code" after a failure asks for a code on the same worker, ready for the next payload', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.done.reject(new LoadError('auth'));
    await flush();
    t.nav.handle('OK');
    expect(t.kind()).toBe('opening');
    await s.gives('NEWC0DE0');
    await t.tick();
    await s.polled({ state: 'ready', payload: XTREAM_PAYLOAD });
    expect(t.loads).toHaveLength(2);
    t.loads[1]!.done.reject(new LoadError('expired'));
    await flush();
    // A new payload gets its own status.
    expect(s.statuses.map((x) => x.status)).toEqual(['auth_failed', 'expired']);
  });

  it('tries a status that failed again, 2 s then 4 s later, at most three times', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 1 });
    s.statuses[0]!.answer.resolve({ ok: false, failure: 'network' });
    await flush();
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    await t.tick();
    expect(s.statuses).toHaveLength(2);
    s.statuses[1]!.answer.resolve({ ok: false, failure: 'rate' });
    await flush();
    expect(t.pending()).toEqual([2 * PAIR_POLL_MS]);
    await t.tick();
    expect(s.statuses).toHaveLength(STATUS_TRIES);
    s.statuses[2]!.answer.resolve({ ok: false, failure: 'status' });
    await flush();
    expect(t.pending()).toEqual([]);
    expect(s.statuses.map((x) => x.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('stops trying once a status went, or the worker refused it', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 1 });
    s.statuses[0]!.answer.resolve({ ok: false, failure: 'network' });
    await flush();
    await t.tick();
    s.statuses[1]!.answer.resolve({ ok: true });
    await flush();
    expect(t.pending()).toEqual([]);
    const u = setup();
    const v = await u.received();
    u.loads[0]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 1 });
    v.statuses[0]!.answer.reject(new Error('No pairing payload was read'));
    await flush();
    expect(u.pending()).toEqual([]);
    expect(v.statuses).toHaveLength(1);
  });

  it('drops a status retry once the screen has closed', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 1 });
    s.statuses[0]!.answer.resolve({ ok: false, failure: 'network' });
    await flush();
    expect(t.pending()).toEqual([PAIR_POLL_MS]);
    t.nav.back();
    expect(t.pending()).toEqual([]);
    expect(s.closed).toBe(1);
  });
});

describe("the config's block-new-sources", () => {
  const RULE: Refusal = { id: 'kill-1', message: null };

  it('refuses the source before it loads and sends blocked; Try again reads the rule again', async () => {
    const t = setup({ refusal: RULE });
    const s = await t.received();
    expect(t.pairing.view.value).toEqual({ kind: 'refused', refusal: RULE });
    expect(t.loads).toEqual([]);
    expect(t.busy).toEqual([]);
    expect(s.statuses.map((x) => x.status)).toEqual(['blocked']);
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    expect(t.pairing.view.value).toEqual({ kind: 'refused', refusal: RULE });
    t.refusal.value = null;
    t.nav.handle('OK');
    expect(t.loads).toHaveLength(1);
    t.loads[0]!.done.resolve(RESULT);
    await flush();
    expect(t.kind()).toBe('done');
    expect(s.statuses.map((x) => x.status)).toEqual(['blocked']);
  });

  it('a rule that arrives after a failure refuses "Try again" with the focus back on the first button', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.done.reject(new LoadError('network'));
    await flush();
    t.nav.handle('RIGHT');
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 1`);
    t.refusal.value = RULE;
    t.nav.handle('OK');
    expect(t.pairing.view.value).toEqual({ kind: 'refused', refusal: RULE });
    expect(t.at()).toBe(`${PAIR_SCREEN} · actions 0`);
    expect(s.statuses.map((x) => x.status)).toEqual(['unreachable']);
  });

  it('lets a load already running finish when the rule arrives', async () => {
    const t = setup();
    const s = await t.received();
    t.refusal.value = RULE;
    t.loads[0]!.done.resolve(RESULT);
    await flush();
    expect(t.kind()).toBe('done');
    expect(s.statuses.map((x) => x.status)).toEqual(['ok']);
  });
});

describe('closing', () => {
  it('Back on a code closes the screen, ends the worker and stops the poll; late answers are dropped', async () => {
    const t = setup();
    const s = await t.opened();
    await t.tick();
    expect(t.hasLifecycle()).toBe(true);
    t.nav.handle('BACK');
    expect(t.nav.snapshot().screen).toBe('home');
    expect(s.closed).toBe(1);
    expect(t.unsubscribed()).toBe(1);
    expect(t.hasLifecycle()).toBe(false);
    await s.polled({ state: 'ready', payload: M3U_PAYLOAD });
    expect(t.loads).toEqual([]);
    expect(t.pending()).toEqual([]);
  });

  it('Cancel on a code does the same', async () => {
    const t = setup();
    const s = await t.opened();
    t.nav.handle('OK');
    expect(t.nav.snapshot().screen).toBe('home');
    expect(s.closed).toBe(1);
    expect(t.pending()).toEqual([]);
  });

  it('Back while the source loads cancels it, sends no status and lets the refreshes go', async () => {
    const t = setup();
    const s = await t.received();
    t.nav.handle('BACK');
    expect(t.loads[0]!.cancelled).toBe(true);
    expect(t.busy).toEqual([true, false]);
    t.loads[0]!.done.resolve(RESULT);
    await flush();
    expect(s.statuses).toEqual([]);
    expect(t.added).toEqual([]);
    expect(s.closed).toBe(1);
  });

  it('Cancel while the source loads does the same', async () => {
    const t = setup();
    const s = await t.received();
    t.nav.handle('OK');
    expect(t.loads[0]!.cancelled).toBe(true);
    expect(t.nav.snapshot().screen).toBe('home');
    expect(s.statuses).toEqual([]);
  });

  it('a screen replaced from outside (onboarding reset) ends the worker after its status', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.done.resolve(RESULT);
    await flush();
    t.nav.reset({ id: 'done', zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 1 }] });
    expect(s.closed).toBe(0);
    s.statuses[0]!.answer.resolve({ ok: false, failure: 'network' });
    await flush();
    expect(s.closed).toBe(1);
    // No retry once closed.
    expect(t.pending()).toEqual([]);
  });

  it('dispose stops everything, and a new opening starts fresh', async () => {
    const t = setup();
    const s = await t.received();
    t.loads[0]!.onProgress({ phase: 'guide', bytes: 0, total: null, items: 1 });
    t.pairing.dispose();
    expect(t.loads[0]!.cancelled).toBe(true);
    expect(s.closed).toBe(0);
    s.statuses[0]!.answer.resolve({ ok: true });
    await flush();
    expect(s.closed).toBe(1);
    t.pairing.open();
    expect(t.sessions).toHaveLength(2);
    expect(t.pairing.draft.value).toBeNull();
    expect(t.pairing.sent.value).toBeNull();
    expect(t.pairing.view.value).toEqual({ kind: 'opening', note: null });
  });
});
