import type { ContentKind } from '@lablo/core';
import type { EpgRefreshResult, EpgStatus, IngestResult } from '@lablo/data';
import type { PlaybackError, PlayerReport } from '@lablo/player';
import type { TelemetryEvent } from '@lablo/protocol';
import { countBucket, rateBucket } from '@lablo/protocol/telemetry-buckets';
import type { RefreshDone } from '../data/engine';
import { eventMs } from './telemetry-events';

/**
 * The events of use (RELAY step 33b2, architecture.md §3.4): `play_result` and `stall` from the
 * player controller's reports, `ingest_done` and `epg_match` from the data engine's refreshes.
 * Plain objects in the shape `telemetryEventSchema` reads, as 33b1's start events: no URL, host,
 * name or login can be in them; their fields are kinds, buckets, times and short codes.
 */

/** A play's report (`PlayerReport` of type `play`). */
export type PlayReport = Extract<PlayerReport, { type: 'play' }>;
/** A stall's report. */
export type StallReport = Extract<PlayerReport, { type: 'stall' }>;

/** An error code's longest length (the protocol's `errorCode`). */
export const ERROR_CODE_MAX = 64;
/** What a code becomes when it isn't a plain token. */
export const OTHER_CODE = 'OTHER';
/** The most retries a stall reports (the schema's limit). */
export const STALL_ATTEMPTS_MAX = 100;

/** Whether `code` is a letter, a digit, `_` or `-`. */
function codeChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 45;
}

/**
 * An engine's or the watchdog's code as telemetry takes it: 1 to 64 letters, digits, `_` or `-`
 * (`MEDIA_ERR_NETWORK`, `PLAYER_ERROR_CONNECTION_FAILED`, `FROZEN`), anything else `OTHER`. No
 * `.`, although the protocol takes one: a dotted code could be a host. Nothing is replaced
 * character by character: what is left of a URL would still spell its host.
 */
export function errorCode(code: string): string {
  if (code.length === 0 || code.length > ERROR_CODE_MAX) return OTHER_CODE;
  for (let i = 0; i < code.length; i++) if (!codeChar(code.charCodeAt(i))) return OTHER_CODE;
  return code;
}

/** A play's error: its kind, its code as a token, and an `http` error's status. */
function playError(error: PlaybackError): { kind: PlaybackError['kind']; code: string; status?: number } {
  const out: { kind: PlaybackError['kind']; code: string; status?: number } = { kind: error.kind, code: errorCode(error.code) };
  const status = error.status ?? 0;
  if (error.kind === 'http' && status >= 100 && status <= 599 && Math.floor(status) === status) out.status = status;
  return out;
}

/** `play_result`: the engine, the container, the mode, the time to the first frame or the error given up on. */
export function playEvent(at: number, report: PlayReport): TelemetryEvent {
  return {
    kind: 'play_result',
    at,
    engine: report.engine,
    container: report.container,
    mode: report.mode,
    ttffMs: report.ttffMs === null ? null : eventMs(report.ttffMs),
    error: report.error === null ? null : playError(report.error),
  };
}

/** `stall`: recovered or given up, and its retries. */
export function stallEvent(at: number, report: StallReport): TelemetryEvent {
  return { kind: 'stall', at, recovered: report.recovered, attempts: Math.min(report.attempts, STALL_ATTEMPTS_MAX) };
}

/** The event of a player's report (`ControllerOptions.report`). */
export function playerEvent(at: number, report: PlayerReport): TelemetryEvent {
  return report.type === 'play' ? playEvent(at, report) : stallEvent(at, report);
}

/**
 * `ingest_done` of a catalog refresh: the source's type (the phone's file is an `m3u`), its time,
 * the download's bytes and the items stored, as buckets. `null` when nothing was downloaded (a
 * 304): the event measures a download and its parse.
 */
export function catalogIngestEvent(at: number, source: 'xtream' | 'm3u' | 'm3u-file', result: Pick<IngestResult, 'elapsedMs' | 'fetch' | 'counts'>): TelemetryEvent | null {
  const fetched = result.fetch;
  if (fetched === null) return null;
  let items = 0;
  for (const kind in result.counts) items += result.counts[kind as ContentKind] ?? 0;
  return { kind: 'ingest_done', at, source: source === 'xtream' ? 'xtream' : 'm3u', ms: eventMs(result.elapsedMs), bytes: countBucket(fetched.bytes), items: countBucket(items) };
}

/**
 * `ingest_done` of each guide an EPG refresh downloaded: its time, its bytes, and the programmes
 * it read for the channels it feeds. A guide that failed or answered 304 has none.
 */
export function epgIngestEvents(at: number, result: Pick<EpgRefreshResult, 'outcomes'>): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  result.outcomes.forEach((outcome) => {
    const read = outcome.result;
    if (read === null || read.fetch === null) return;
    const programmes = read.summary === null ? 0 : read.summary.programmes;
    events.push({ kind: 'ingest_done', at, source: 'epg', ms: eventMs(read.elapsedMs), bytes: countBucket(read.fetch.bytes), items: countBucket(programmes) });
  });
  return events;
}

/** Whether an EPG refresh changed which channels have a guide: a guide swapped in, deleted or moved. */
export function epgChanged(result: Pick<EpgRefreshResult, 'outcomes' | 'deleted' | 'reranked'>): boolean {
  return result.deleted.length > 0 || result.reranked.length > 0 || result.outcomes.some((outcome) => outcome.result !== null && outcome.result.status === 'committed');
}

/** `epg_match`: the share of `live` channels with a guide, `matched` of them (at most all: `rateBucket`). */
export function epgMatchEvent(at: number, live: number, matched: number): TelemetryEvent {
  return { kind: 'epg_match', at, rate: rateBucket(matched, live) };
}

/** What the guide match asks of the data engine (a `DataEngine` fits). */
export interface MatchEngine {
  epgStatus(): Promise<Pick<EpgStatus, 'sources' | 'matched'>>;
}

/**
 * The guide match now: the stored sources' live channels, and those the loaded guides give a
 * guide once combined (`EpgStatus.matched`). No chunk is walked: the query worker holds the
 * links, and the sources' records hold their counts. A link to a channel a newer catalog
 * dropped still counts until its guide is read again; the bucket stops at all. `null` with no
 * live channel.
 */
export async function epgMatch(engine: MatchEngine, at: number): Promise<TelemetryEvent | null> {
  const status = await engine.epgStatus();
  let live = 0;
  status.sources.forEach((source) => {
    live += source.counts.live ?? 0;
  });
  return live === 0 ? null : epgMatchEvent(at, live, status.matched);
}

/**
 * Records a refresh's events (`DataEngineOptions.onRefreshed`): a catalog's `ingest_done`; each
 * guide's, then `epg_match` when the refresh changed the match. Never throws: a count that fails
 * is logged and records nothing.
 */
export async function recordRefresh(done: RefreshDone, engine: MatchEngine, record: (event: TelemetryEvent) => void, now: () => number): Promise<void> {
  try {
    const at = now();
    if (done.kind === 'catalog') {
      const event = catalogIngestEvent(at, done.source, done.result);
      if (event !== null) record(event);
      return;
    }
    epgIngestEvents(at, done.result).forEach((event) => record(event));
    if (!epgChanged(done.result)) return;
    const match = await epgMatch(engine, at);
    if (match !== null) record(match);
  } catch (error) {
    console.warn('A refresh was not recorded', error);
  }
}
