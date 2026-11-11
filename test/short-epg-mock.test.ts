// RELAY step 9c: the short-EPG fallback end to end. The app's DataEngine (apps/tv) runs the real
// query, ingest and EPG services over message channels (the way workers serve them), with the
// real fetch transport against the in-process mock provider over a socket. The mock imports
// nothing from core or data, so its programme schedule is the oracle. "Done when": an unmatched
// mock channel gets now/next from get_short_epg after 600 ms of focus and not before, and a
// second focus within 30 minutes makes no request.
//
// Only setTimeout/clearTimeout are faked, and only around a focus: message channels, promises,
// fake-indexeddb (setImmediate) and the sockets keep real time.

import type { ContentKind, XtreamAccount } from '@lablo/core';
import type { ByteTransport, IngestSource, RpcHandlers, ShortEpgNowNext } from '@lablo/data';
import { EpgService, IngestService, QueryService, SHORT_EPG_TTL_MS, fetchTransport, openDatabase, serveRpc } from '@lablo/data';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FocusedChannel, WorkerLike } from '../apps/tv/src/data/engine';
import { DataEngine, FOCUS_MS } from '../apps/tv/src/data/engine';
import { loadCatalog } from '../apps/mock-provider/src/config';
import { upcoming } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { freshFactory } from '../packages/data/src/test-support';

const catalog = loadCatalog();
const MINUTE = 60_000;

const opened: MessagePort[] = [];
const engines: DataEngine[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const engine of engines.splice(0)) engine.dispose();
  for (const port of opened.splice(0)) port.close();
});

let full: MockServer;
let noGuide: MockServer;
let fullBase: string;
let noGuideBase: string;
beforeAll(async () => {
  full = await mock();
  fullBase = await listen(full);
  noGuide = await mock({ scenario: 'no-xmltv' });
  noGuideBase = await listen(noGuide);
});
afterAll(async () => {
  await full.close();
  await noGuide.close();
});

/** A stand-in Worker: the handlers are served on one end of a channel, the engine gets the other. */
function worker(handlers: RpcHandlers, dbs: IDBDatabase[]): WorkerLike {
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  const server = serveRpc(port1 as unknown as Parameters<typeof serveRpc>[0], handlers);
  return {
    onerror: null,
    postMessage: (message, transfer) => port2.postMessage(message, transfer ?? []),
    addEventListener: (type, listener) => port2.addEventListener(type, listener as (event: Event) => void),
    removeEventListener: (type, listener) => port2.removeEventListener(type, listener as (event: Event) => void),
    start: () => port2.start(),
    terminate: () => {
      server.close();
      for (const db of dbs) db.close();
      port1.close();
      port2.close();
    },
  };
}

interface Setup {
  engine: DataEngine;
  /** The clock of the query worker (now/next and the 30-minute cache). */
  clock: { now: number };
  /** The `get_short_epg` requests the query worker made, as stream ids. */
  asked: string[];
}

function setup(): Setup {
  const factory = freshFactory();
  const clock = { now: NOW + MINUTE };
  const asked: string[] = [];
  const net = fetchTransport();
  const counting: ByteTransport = {
    get: (url, request) => {
      const m = /[?&]action=get_short_epg&stream_id=([^&]+)/.exec(url);
      if (m) asked.push(m[1]!);
      return net.get(url, request);
    },
  };
  const opener = (dbs: IDBDatabase[]) => async () => {
    const db = await openDatabase(factory);
    dbs.push(db);
    return db;
  };
  const engine = new DataEngine({
    now: () => clock.now,
    startQueryWorker: () => {
      const dbs: IDBDatabase[] = [];
      return worker(new QueryService({ openDb: opener(dbs), transport: counting, now: () => clock.now }).handlers(), dbs);
    },
    startIngestWorker: () => {
      const dbs: IDBDatabase[] = [];
      return worker(new IngestService({ openDb: opener(dbs), transport: net }).handlers(), dbs);
    },
    startEpgWorker: () => {
      const dbs: IDBDatabase[] = [];
      return worker(new EpgService({ openDb: opener(dbs), transport: net, now: () => NOW }).handlers(), dbs);
    },
  });
  engines.push(engine);
  return { engine, clock, asked };
}

/** Lets message channels, fake-indexeddb and sockets run (they keep real time). */
async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** The live channel named `name` in the stored catalog, focused from `source`. */
async function channel(engine: DataEngine, src: string, name: string, source: IngestSource): Promise<FocusedChannel> {
  for (const cat of await engine.query.call('categories', { src, kind: 'live' as ContentKind })) {
    for (let n = 0; n < cat.chunks.length; n++) {
      const hit = (await engine.query.call('chunk', { src, kind: 'live', catIdx: cat.catIdx, chunk: n })).find((i) => i.name === name);
      if (hit) return { key: hit.key, url: hit.url, source };
    }
  }
  throw new Error(`No live channel ${name}`);
}

/**
 * Focuses `ch` with fake timers: nothing is asked for `FOCUS_MS - 1` ms (checked with `asked`),
 * then the answer comes with real time.
 */
async function focusFor(s: Setup, ch: FocusedChannel): Promise<ShortEpgNowNext | null> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const before = s.asked.length;
  let settled = false;
  const answer = s.engine.focusChannel(ch);
  void answer.then(
    () => (settled = true),
    () => (settled = true),
  );
  vi.advanceTimersByTime(FOCUS_MS - 1);
  await settle();
  expect(s.asked.length, 'no request before 600 ms of focus').toBe(before);
  expect(settled, 'no answer before 600 ms of focus').toBe(false);
  vi.advanceTimersByTime(1);
  vi.useRealTimers();
  return answer;
}

/** The mock's own programmes for a stream: the one on air at `at`, then the next. */
function oracle(streamId: number, at: number): { now: string; next: string } {
  const c = catalog.live.find((l) => l.id === streamId)!;
  const [now, next] = upcoming(c, at, 2);
  const show = (p: { start: number; stop: number; title: string }): string => `${p.start / MINUTE}-${p.stop / MINUTE} ${p.title}`;
  return { now: show(now!), next: show(next!) };
}

const show = (p: { start: number; end: number; title: string } | null): string | null => (p === null ? null : `${p.start}-${p.end} ${p.title}`);

describe('the short-EPG fallback through the DataEngine and the mock provider', () => {
  it("gives an unmatched channel its panel's now/next after 600 ms of focus, then keeps it 30 minutes", async () => {
    // A panel whose xmltv.php is off: the guide refresh fails, so no live channel has a guide.
    const s = setup();
    const account: XtreamAccount = { base: noGuideBase, username: U, password: P };
    const source: IngestSource = { type: 'xtream', account };
    await s.engine.refresh({ src: 'xt', source });
    const epg = await s.engine.refreshEpg([{ src: 'xt', type: 'xtream', account }], { tier: 'full' });
    expect(epg.outcomes.map((o) => [o.epgSrc, o.error?.code])).toEqual([['xt:xmltv', 'http']]);
    expect((await s.engine.epgStatus()).matched).toBe(0);

    const smpte = await channel(s.engine, 'xt', 'Lablo Test 1 SMPTE', source);
    expect(smpte.key).toBe('x:xt:live:101');
    const first = await focusFor(s, smpte);
    expect(s.asked).toEqual(['101']);
    expect(first).toMatchObject({ key: smpte.key, epgSrc: null, method: null, from: 'panel', cached: false });
    expect({ now: show(first!.now), next: show(first!.next) }).toEqual(oracle(101, s.clock.now));

    // Focused again within 30 minutes: no request, and now/next moves on with the clock.
    s.clock.now = NOW + SHORT_EPG_TTL_MS - MINUTE;
    const again = await focusFor(s, smpte);
    expect(s.asked).toEqual(['101']);
    expect(again).toMatchObject({ from: 'panel', cached: true });
    expect(show(again!.now)).toBe(oracle(101, s.clock.now).now);

    // A focus that moves on before 600 ms asks nothing; the channel it moved to is asked.
    const kids = await channel(s.engine, 'xt', 'Lablo Kids Test', source);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const left = s.engine.focusChannel(await channel(s.engine, 'xt', 'Lablo Test 2 Clock', source));
    vi.advanceTimersByTime(FOCUS_MS / 2);
    const moved = s.engine.focusChannel(kids);
    expect(await left).toBeNull();
    vi.advanceTimersByTime(FOCUS_MS);
    vi.useRealTimers();
    expect((await moved)?.from).toBe('panel');
    expect(s.asked).toEqual(['101', '105']);

    // An answer that comes after the focus moved on is dropped (and still kept for next time).
    const clock2 = await channel(s.engine, 'xt', 'Lablo Test 2 Clock', source);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stale = s.engine.focusChannel(clock2);
    vi.advanceTimersByTime(FOCUS_MS);
    vi.useRealTimers();
    // The request has been sent when the focus leaves.
    void s.engine.focusChannel(null);
    expect(await stale).toBeNull();
    expect(s.asked).toEqual(['101', '105', '102']);
    expect(await focusFor(s, clock2)).toMatchObject({ from: 'panel', cached: true });

    // 30 minutes after the first answer, the panel is asked again.
    s.clock.now = NOW + MINUTE + SHORT_EPG_TTL_MS;
    const later = await focusFor(s, smpte);
    expect(later).toMatchObject({ from: 'panel', cached: false });
    expect(s.asked).toEqual(['101', '105', '102', '101']);
  }, 30_000);

  it('asks nothing for a channel its guide matches, and caches the empty answer of one it has no programmes for', async () => {
    // The get.php playlist with its url-tvg guide: 11 of 12 live channels are matched.
    const s = setup();
    const url = `${fullBase}/get.php?username=${U}&password=${P}&type=m3u_plus`;
    const source: IngestSource = { type: 'm3u', url };
    await s.engine.refresh({ src: 'pl', source });
    await s.engine.refreshEpg([{ src: 'pl', type: 'm3u' }], { tier: 'full' });
    expect((await s.engine.epgStatus()).matched).toBe(11);

    const matched = await focusFor(s, await channel(s.engine, 'pl', 'Lablo Test 1 SMPTE', source));
    expect(matched).toMatchObject({ epgSrc: 'pl:tvg0', from: 'guide', cached: false });
    expect({ now: show(matched!.now), next: show(matched!.next) }).toEqual(oracle(101, s.clock.now));
    expect(s.asked).toEqual([]);

    // The one unmatched channel has no EPG id, so the panel has no programmes for it either.
    const adult = await channel(s.engine, 'pl', '18+ Test Pattern', source);
    expect(await focusFor(s, adult)).toMatchObject({ epgSrc: null, from: 'panel', cached: false, now: null, next: null });
    expect(await focusFor(s, adult)).toMatchObject({ from: 'panel', cached: true });
    expect(s.asked).toEqual(['109']);

    // `null` (the focus left the live channels) and dispose settle a waiting focus.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const waiting = s.engine.focusChannel(adult);
    expect(await s.engine.focusChannel(null)).toBeNull();
    expect(await waiting).toBeNull();
    const disposed = s.engine.focusChannel(adult);
    s.engine.dispose();
    expect(await disposed).toBeNull();
    vi.advanceTimersByTime(FOCUS_MS);
    vi.useRealTimers();
    expect(s.asked).toEqual(['109']);
  }, 30_000);
});
