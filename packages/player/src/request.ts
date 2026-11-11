/**
 * What the app asks the player to play, and the URL strategy (architecture.md §2): which URLs
 * to try in which order, and the container that last worked, remembered per source.
 *
 * Xtream live streams can be served as MPEG-TS (`.ts`, faster to start: 1.1–1.8 s on the LG
 * TV against 1.6–2.5 s for HLS, docs/spikes/results.md) or HLS (`.m3u8`). The player tries
 * `.ts` first, then `.m3u8`, unless the account's `allowed_output_formats` rules one out, and
 * a source whose `.m3u8` played puts `.m3u8` first from then on.
 */

import type { CatchupInfo, CatchupWindow, ContentKey, ZoneOffset } from '@lablo/core';
import { UTC_ZONE, catchupMode, m3uCatchupUrl, parseXtreamStreamUrl, xtreamCatchupUrl, xtreamStreamUrl } from '@lablo/core';
import type { Container, PlayMode } from './engine';

/**
 * A subtitle file beside the stream (RELAY step 20b2b): fetched and parsed by the app
 * (`ControllerOptions.loadSubtitles`), listed in the menu after the stream's own subtitles.
 * `lang` is as the provider wrote it; `url` may hold credentials (never log it).
 */
export interface ExternalSub {
  readonly lang: string;
  readonly url: string;
  readonly fmt: 'srt' | 'vtt';
}

/** One URL to try. Holds credentials: never log it. */
export interface PlayCandidate {
  readonly url: string;
  readonly container: Container;
}

export interface PlayRequest {
  readonly key: ContentKey;
  /** The source's id (the URL strategy is remembered per source). */
  readonly src: string;
  readonly mode: PlayMode;
  /** The URLs to try, in order (`streamCandidates`). */
  readonly candidates: readonly PlayCandidate[];
  readonly externalSubs?: readonly ExternalSub[];
  readonly hints?: { readonly uhd?: boolean };
}

/** The container a URL's path names: `.m3u8` is HLS, `.ts` (or Flussonic's `/mpegts`) MPEG-TS. */
export function containerOf(url: string): Container {
  let end = url.length;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    // `?` or `#` ends the path.
    if (c === 63 || c === 35) {
      end = i;
      break;
    }
  }
  const path = url.slice(0, end).toLowerCase();
  const slash = path.lastIndexOf('/');
  const file = path.slice(slash + 1);
  if (file === 'mpegts') return 'ts';
  const dot = file.lastIndexOf('.');
  if (dot === -1) return 'other';
  const ext = file.slice(dot + 1);
  if (ext === 'm3u8') return 'hls';
  if (ext === 'ts') return 'ts';
  if (ext === 'mkv') return 'mkv';
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') return 'mp4';
  return 'other';
}

/**
 * The URLs to try for a catalog item's stream URL. An Xtream live URL (`/live/u/p/123.ts`, the
 * `.m3u8` form, or the short `/u/p/123`) gives the `.ts` form, then the `.m3u8` form, keeping
 * only the ones `outputFormats` (the account's `allowed_output_formats`) allows when it names
 * either. Anything else is played as it is.
 */
export function streamCandidates(url: string, mode: PlayMode, outputFormats?: readonly string[] | null): PlayCandidate[] {
  const own: PlayCandidate = { url, container: containerOf(url) };
  if (mode !== 'live') return [own];
  const parsed = parseXtreamStreamUrl(url);
  if (parsed === null || parsed.kind !== 'live' || (parsed.ext !== null && parsed.ext !== 'ts' && parsed.ext !== 'm3u8')) return [own];
  // The short form (no extension) serves MPEG-TS.
  const ts: PlayCandidate = parsed.ext === 'm3u8' ? { url: xtreamStreamUrl(parsed, 'live', parsed.id, 'ts'), container: 'ts' } : { url, container: 'ts' };
  const hls: PlayCandidate = parsed.ext === 'm3u8' ? { url, container: 'hls' } : { url: xtreamStreamUrl(parsed, 'live', parsed.id, 'm3u8'), container: 'hls' };
  return allowedForms(ts, hls, outputFormats);
}

/** `.ts` then `.m3u8`, keeping only the one `outputFormats` allows when it names one and not the other. */
function allowedForms(ts: PlayCandidate, hls: PlayCandidate, outputFormats: readonly string[] | null | undefined): PlayCandidate[] {
  const formats = outputFormats ?? [];
  const allowsTs = formats.indexOf('ts') !== -1;
  const allowsHls = formats.indexOf('m3u8') !== -1;
  if (allowsTs && !allowsHls) return [ts];
  if (allowsHls && !allowsTs) return [hls];
  return [ts, hls];
}

export interface CatchupCandidateOptions {
  /** The panel's zone (`panelZone` of the source's `server_info`): Xtream starts are wall time there. Default UTC. */
  readonly zone?: ZoneOffset;
  /** The account's `allowed_output_formats` (`null`: not known, both forms are tried). */
  readonly outputFormats?: readonly string[] | null;
}

/**
 * The URLs to try for a programme from a live channel's archive (RELAY step 25a, ADR-010), or
 * none when the channel has no catch-up its URL can carry:
 * - an `xc` channel (every Xtream source's channel, and an M3U channel with an Xtream-shaped
 *   URL) gives the `/timeshift/` URL as `.ts`, then as `.m3u8`, keeping to `outputFormats` as live
 *   does; the start is written as wall time in `zone`;
 * - every other M3U mode gives the one URL its template or rewrite makes (`m3uCatchupUrl`).
 */
export function catchupCandidates(url: string, info: CatchupInfo | null, window: CatchupWindow, options: CatchupCandidateOptions = {}): PlayCandidate[] {
  if (info === null) return [];
  const zone = options.zone ?? UTC_ZONE;
  if (catchupMode(info, url) === 'xc') {
    const parsed = parseXtreamStreamUrl(url);
    if (parsed === null || parsed.kind !== 'live') return [];
    const ts: PlayCandidate = { url: xtreamCatchupUrl(parsed, parsed.id, window, zone, 'ts'), container: 'ts' };
    const hls: PlayCandidate = { url: xtreamCatchupUrl(parsed, parsed.id, window, zone, 'm3u8'), container: 'hls' };
    return allowedForms(ts, hls, options.outputFormats);
  }
  const one = m3uCatchupUrl(url, info, window, { zone });
  return one === null ? [] : [{ url: one, container: containerOf(one) }];
}

/** `candidates` with those of the `preferred` container first, the rest in their order. */
export function orderCandidates(candidates: readonly PlayCandidate[], preferred: Container | null): PlayCandidate[] {
  if (preferred === null) return candidates.slice();
  const first: PlayCandidate[] = [];
  const rest: PlayCandidate[] = [];
  for (const c of candidates) (c.container === preferred ? first : rest).push(c);
  return first.concat(rest);
}

/**
 * Where the player keeps the container that last played for each source. `MemorySourceMemory`
 * keeps it for the app's run; the app can back it with the profile (step 20).
 */
export interface SourceMemory {
  preferred(src: string): Container | null;
  remember(src: string, container: Container): void;
}

export class MemorySourceMemory implements SourceMemory {
  private readonly bySource: Record<string, Container> = {};

  preferred(src: string): Container | null {
    return Object.prototype.hasOwnProperty.call(this.bySource, src) ? this.bySource[src]! : null;
  }

  remember(src: string, container: Container): void {
    this.bySource[src] = container;
  }
}
