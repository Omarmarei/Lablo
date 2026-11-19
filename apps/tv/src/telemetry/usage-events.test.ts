import type { EpgOutcome, EpgRefreshResult, IngestResult } from '@lablo/data';
import type { Container, PlayMode, PlaybackError, PlaybackErrorKind, PlayerEngine } from '@lablo/player';
import { PLAYBACK_ERROR_KINDS } from '@lablo/player';
import type { TelemetryEvent } from '@lablo/protocol';
import { readTelemetryEvents } from '@lablo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefreshDone } from '../data/engine';
import type { MatchEngine, PlayReport } from './usage-events';
import {
  ERROR_CODE_MAX,
  OTHER_CODE,
  STALL_ATTEMPTS_MAX,
  catalogIngestEvent,
  epgChanged,
  epgIngestEvents,
  epgMatch,
  epgMatchEvent,
  errorCode,
  playEvent,
  playerEvent,
  recordRefresh,
  stallEvent,
} from './usage-events';

// RELAY step 33b2: the events of use, in the shape the server's schema reads.

const AT = Date.UTC(2026, 10, 19, 12, 0, 0);

/** Every event the server keeps, and none dropped. */
function serverReads(event: unknown): boolean {
  const read = readTelemetryEvents([event]);
  return read.dropped === 0 && JSON.stringify(read.events[0]) === JSON.stringify(event);
}

/** The player's lists are the protocol's, both ways (a compile error otherwise). */
type ProtocolPlay = Extract<TelemetryEvent, { kind: 'play_result' }>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const SAME_LISTS: [
  Same<NonNullable<ProtocolPlay['error']>['kind'], PlaybackErrorKind>,
  Same<ProtocolPlay['container'], Container>,
  Same<ProtocolPlay['mode'], PlayMode>,
  Same<ProtocolPlay['engine'], PlayerEngine['kind']>,
] = [true, true, true, true];

function play(fields: Partial<PlayReport> = {}): PlayReport {
  return { type: 'play', engine: 'html5', container: 'ts', mode: 'live', ttffMs: 800, error: null, ...fields };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playEvent', () => {
  it('gives the engine, the container, the mode and the time to the first frame, rounded', () => {
    expect(SAME_LISTS).toEqual([true, true, true, true]);
    const event = playEvent(AT, play({ engine: 'avplay', container: 'hls', mode: 'catchup', ttffMs: 1234.6 }));
    expect(event).toEqual({ kind: 'play_result', at: AT, engine: 'avplay', container: 'hls', mode: 'catchup', ttffMs: 1235, error: null });
    expect(serverReads(event)).toBe(true);
    expect(playEvent(AT, play({ engine: 'mse', container: 'mp4', mode: 'vod', ttffMs: 9e9 }))).toMatchObject({ engine: 'mse', container: 'mp4', mode: 'vod', ttffMs: 3_600_000 });
    expect(playEvent(AT, play({ container: 'mkv', ttffMs: -3 }))).toMatchObject({ container: 'mkv', ttffMs: 0 });
  });

  it('gives a failed play no time, and its error: every kind the engines have', () => {
    for (const kind of PLAYBACK_ERROR_KINDS) {
      const event = playEvent(AT, play({ container: 'other', ttffMs: null, error: { kind, code: 'SOME_CODE-1' } }));
      expect(event).toEqual({ kind: 'play_result', at: AT, engine: 'html5', container: 'other', mode: 'live', ttffMs: null, error: { kind, code: 'SOME_CODE-1' } });
      expect(serverReads(event)).toBe(true);
    }
  });

  it("keeps an http error's status, a whole number from 100 to 599, and no other error's", () => {
    const statusOf = (error: PlaybackError): unknown => {
      const event = playEvent(AT, play({ ttffMs: null, error }));
      expect(serverReads(event)).toBe(true);
      return (event as ProtocolPlay).error!.status;
    };
    expect(statusOf({ kind: 'http', code: 'PROBE_HTTP', status: 404 })).toBe(404);
    expect(statusOf({ kind: 'http', code: 'PROBE_HTTP', status: 100 })).toBe(100);
    expect(statusOf({ kind: 'http', code: 'PROBE_HTTP', status: 599 })).toBe(599);
    for (const status of [99, 600, 404.5, Number.NaN]) expect(statusOf({ kind: 'http', code: 'PROBE_HTTP', status })).toBeUndefined();
    expect(statusOf({ kind: 'http', code: 'PROBE_HTTP' })).toBeUndefined();
    expect(statusOf({ kind: 'network', code: 'MEDIA_ERR_NETWORK', status: 404 })).toBeUndefined();
    expect(Object.keys((playEvent(AT, play({ error: { kind: 'http', code: 'X' } })) as ProtocolPlay).error!)).toEqual(['kind', 'code']);
  });
});

describe('errorCode', () => {
  it("keeps an engine's or the watchdog's token", () => {
    for (const code of ['MEDIA_ERR_NETWORK', 'PLAYER_ERROR_CONNECTION_FAILED', 'FROZEN', 'InvalidStateError', 'a-b_C9', '0', '9', 'A', 'Z', 'a', 'z', '_', '-', 'A'.repeat(ERROR_CODE_MAX)]) {
      expect(errorCode(code)).toBe(code);
    }
  });

  it('makes anything else OTHER: a URL, a dotted host, an empty or a long code, other characters', () => {
    expect(OTHER_CODE).toBe('OTHER');
    expect(ERROR_CODE_MAX).toBe(64);
    for (const code of ['http://panel.example:8080/live/u/p/1.ts', 'panel.example.com', '', 'A'.repeat(65), 'with space', 'خطأ', 'a/b', 'a:b', 'a@b', 'a[b', 'a`b', 'a{b', 'a.b', '/ab', 'ab/']) {
      expect(errorCode(code)).toBe('OTHER');
      expect(serverReads(playEvent(AT, play({ ttffMs: null, error: { kind: 'network', code } })))).toBe(true);
    }
  });
});

describe('stallEvent and playerEvent', () => {
  it('gives a stall its end and its retries, at most 100', () => {
    const event = stallEvent(AT, { type: 'stall', recovered: true, attempts: 3 });
    expect(event).toEqual({ kind: 'stall', at: AT, recovered: true, attempts: 3 });
    expect(serverReads(event)).toBe(true);
    expect(STALL_ATTEMPTS_MAX).toBe(100);
    expect(stallEvent(AT, { type: 'stall', recovered: false, attempts: 100 })).toEqual({ kind: 'stall', at: AT, recovered: false, attempts: 100 });
    expect(stallEvent(AT, { type: 'stall', recovered: false, attempts: 101 })).toMatchObject({ attempts: 100 });
  });

  it('makes each report its event', () => {
    expect(playerEvent(AT, play())).toEqual(playEvent(AT, play()));
    expect(playerEvent(AT, { type: 'stall', recovered: false, attempts: 0 })).toEqual({ kind: 'stall', at: AT, recovered: false, attempts: 0 });
  });
});

/** A refresh's result, with only the fields the events read. */
function ingestResult(fields: Partial<IngestResult>): IngestResult {
  return { status: 'committed', counts: {}, fetch: null, elapsedMs: 0, ...fields } as IngestResult;
}

const fetched = (bytes: number): IngestResult['fetch'] => ({ v: 1, hash: 'h', bytes, etag: null, lastModified: null });

describe('catalogIngestEvent', () => {
  it("gives the source's type, the time, and the bytes and every kind's items as buckets", () => {
    const result = ingestResult({ elapsedMs: 2500.4, fetch: fetched(12_345), counts: { live: 900, movie: 50, series: 60 } });
    const event = catalogIngestEvent(AT, 'xtream', result);
    expect(event).toEqual({ kind: 'ingest_done', at: AT, source: 'xtream', ms: 2500, bytes: '10k+', items: '1k+' });
    expect(serverReads(event)).toBe(true);
    expect(catalogIngestEvent(AT, 'm3u', ingestResult({ elapsedMs: 9e9, fetch: fetched(0), counts: {} }))).toEqual({ kind: 'ingest_done', at: AT, source: 'm3u', ms: 3_600_000, bytes: '0', items: '0' });
    // The phone's file is a playlist too.
    expect(catalogIngestEvent(AT, 'm3u-file', ingestResult({ fetch: fetched(5), counts: { live: 2 } }))).toMatchObject({ source: 'm3u', bytes: '1+', items: '1+' });
  });

  it('gives nothing when nothing was downloaded (a 304)', () => {
    expect(catalogIngestEvent(AT, 'm3u', ingestResult({ status: 'unchanged', elapsedMs: 80, fetch: null, counts: { live: 40 } }))).toBeNull();
  });
});

function outcome(result: Partial<NonNullable<EpgOutcome['result']>> | null): EpgOutcome {
  if (result === null) return { epgSrc: 'g', result: null, error: { code: 'http', status: 404, message: 'HTTP 404' } };
  return { epgSrc: 'g', result: { status: 'committed', summary: null, fetch: null, elapsedMs: 0, ...result } as NonNullable<EpgOutcome['result']>, error: null };
}

const summary = (programmes: number): NonNullable<NonNullable<EpgOutcome['result']>['summary']> =>
  ({ wanted: 10, matched: 5, programmes, kept: 1 }) as NonNullable<NonNullable<EpgOutcome['result']>['summary']>;

describe('epgIngestEvents', () => {
  it('gives each guide downloaded its time, its bytes and the programmes it read; none for a failed one or a 304', () => {
    const events = epgIngestEvents(AT, {
      outcomes: [
        outcome({ elapsedMs: 41_000.5, fetch: fetched(300_000_000), summary: summary(50_000) }),
        outcome(null),
        outcome({ status: 'unchanged', elapsedMs: 60, fetch: null, summary: summary(9) }),
        outcome({ status: 'unchanged', elapsedMs: 7, fetch: fetched(70), summary: null }),
      ],
    });
    expect(events).toEqual([
      { kind: 'ingest_done', at: AT, source: 'epg', ms: 41_001, bytes: '1M+', items: '10k+' },
      { kind: 'ingest_done', at: AT, source: 'epg', ms: 7, bytes: '10+', items: '0' },
    ]);
    for (const event of events) expect(serverReads(event)).toBe(true);
    expect(epgIngestEvents(AT, { outcomes: [] })).toEqual([]);
  });
});

describe('epgChanged and epgMatchEvent', () => {
  const quiet = { outcomes: [], deleted: [], reranked: [] };

  it('counts a guide swapped in, deleted or moved as a change, and nothing else', () => {
    expect(epgChanged(quiet)).toBe(false);
    expect(epgChanged({ ...quiet, deleted: ['g1'] })).toBe(true);
    expect(epgChanged({ ...quiet, reranked: ['g1'] })).toBe(true);
    expect(epgChanged({ ...quiet, outcomes: [outcome(null), outcome({ status: 'unchanged' })] })).toBe(false);
    expect(epgChanged({ ...quiet, outcomes: [outcome(null), outcome({ status: 'committed' })] })).toBe(true);
  });

  it('gives the share of live channels with a guide as its bucket, at most all', () => {
    const event = epgMatchEvent(AT, 8, 6);
    expect(event).toEqual({ kind: 'epg_match', at: AT, rate: '75-99' });
    expect(serverReads(event)).toBe(true);
    expect(epgMatchEvent(AT, 9, 6)).toMatchObject({ rate: '50-74' });
    expect(epgMatchEvent(AT, 4, 4)).toMatchObject({ rate: '100' });
    expect(epgMatchEvent(AT, 4, 5)).toMatchObject({ rate: '100' });
    expect(epgMatchEvent(AT, 4, 0)).toMatchObject({ rate: '0' });
  });
});

/** A data engine that answers the match's status (or fails it), and counts its calls. */
function matchEngine(sources: { src: string; counts: Partial<Record<'live' | 'movie' | 'series', number>> }[], matched: number | Error): MatchEngine & { asked: number } {
  const engine = {
    asked: 0,
    epgStatus: () => {
      engine.asked++;
      return matched instanceof Error ? Promise.reject(matched) : Promise.resolve({ sources: sources as never, matched });
    },
  };
  return engine;
}

describe('epgMatch', () => {
  it("counts every stored source's live channels, and those the guides give a guide", async () => {
    const engine = matchEngine(
      [
        { src: 'a', counts: { live: 5, movie: 100 } },
        { src: 'b', counts: {} },
        { src: 'c', counts: { live: 3 } },
      ],
      6,
    );
    expect(await epgMatch(engine, AT)).toEqual({ kind: 'epg_match', at: AT, rate: '75-99' });
    expect(engine.asked).toBe(1);
  });

  it('gives nothing with no live channel', async () => {
    expect(await epgMatch(matchEngine([{ src: 'a', counts: { movie: 10 } }], 0), AT)).toBeNull();
    expect(await epgMatch(matchEngine([], 0), AT)).toBeNull();
  });
});

function epgResult(fields: Partial<EpgRefreshResult>): EpgRefreshResult {
  return { outcomes: [], deleted: [], reranked: [], wanted: 0, ...fields };
}

describe('recordRefresh', () => {
  const now = (): number => AT;

  it("records a catalog's event, and nothing for a 304", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recorded: TelemetryEvent[] = [];
    const engine = matchEngine([], 0);
    const done: RefreshDone = { kind: 'catalog', source: 'xtream', result: ingestResult({ elapsedMs: 10, fetch: fetched(10), counts: { live: 1 } }) };
    await recordRefresh(done, engine, (event) => recorded.push(event), now);
    expect(recorded).toEqual([{ kind: 'ingest_done', at: AT, source: 'xtream', ms: 10, bytes: '10+', items: '1+' }]);
    await recordRefresh({ kind: 'catalog', source: 'm3u', result: ingestResult({ fetch: null }) }, engine, (event) => recorded.push(event), now);
    expect(recorded).toHaveLength(1);
    expect(engine.asked).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("records each guide's event, then the match when the refresh changed it", async () => {
    const recorded: TelemetryEvent[] = [];
    const engine = matchEngine([{ src: 'a', counts: { live: 4 } }], 3);
    const result = epgResult({ outcomes: [outcome({ elapsedMs: 5, fetch: fetched(100), summary: summary(10) })] });
    await recordRefresh({ kind: 'epg', result }, engine, (event) => recorded.push(event), now);
    expect(recorded).toEqual([
      { kind: 'ingest_done', at: AT, source: 'epg', ms: 5, bytes: '100+', items: '10+' },
      { kind: 'epg_match', at: AT, rate: '75-99' },
    ]);
    // No change: no match, nothing asked.
    const quiet = matchEngine([{ src: 'a', counts: { live: 4 } }], 3);
    const unchanged = epgResult({ outcomes: [outcome({ status: 'unchanged', elapsedMs: 5, fetch: fetched(100) })] });
    const later: TelemetryEvent[] = [];
    await recordRefresh({ kind: 'epg', result: unchanged }, quiet, (event) => later.push(event), now);
    expect(later.map((e) => e.kind)).toEqual(['ingest_done']);
    expect(quiet.asked).toBe(0);
    // A change with no live channel: no match.
    const empty: TelemetryEvent[] = [];
    await recordRefresh({ kind: 'epg', result: epgResult({ deleted: ['g'] }) }, matchEngine([], 0), (event) => empty.push(event), now);
    expect(empty).toEqual([]);
  });

  it("never throws: a count that fails or a record that throws is logged, and what came before stays", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recorded: TelemetryEvent[] = [];
    const broken = matchEngine([{ src: 'a', counts: { live: 4 } }], new Error('the query worker died'));
    const result = epgResult({ outcomes: [outcome({ elapsedMs: 5, fetch: fetched(100), summary: summary(10) })] });
    await expect(recordRefresh({ kind: 'epg', result }, broken, (event) => recorded.push(event), now)).resolves.toBeUndefined();
    expect(recorded.map((e) => e.kind)).toEqual(['ingest_done']);
    expect(warn).toHaveBeenCalledTimes(1);
    const throwing = (): void => {
      throw new Error('the memory is full');
    };
    await expect(recordRefresh({ kind: 'catalog', source: 'm3u', result: ingestResult({ fetch: fetched(1) }) }, broken, throwing, now)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
