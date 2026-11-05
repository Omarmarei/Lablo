import type { CatchupWindow } from '@zoma/core';
import type { PlayRequest } from '@zoma/player';
import { catchupCandidates } from '@zoma/player';
import type { SourceFacts } from '../data/engine';
import type { LiveRow } from '../live/live-state';

/**
 * Catch-up from the guide (RELAY step 25a, ADR-010): a programme gone by, played from the start
 * out of the channel's archive.
 *
 * - **Which programmes:** the channel states catch-up its stream URL can carry (an Xtream
 *   channel's `tv_archive`, or an M3U channel's `catchup` attributes), the programme has ended,
 *   and it started within the channel's archive days. A channel that states no days (an Xtream
 *   `tv_archive` with no `tv_archive_duration`, or M3U attributes without `catchup-days`) is
 *   taken as far back as the guide reaches: the provider's answer decides.
 * - **Its times** are the ones the guide shows: the tvg-shift and the guide's time offset (step
 *   24b) included, because the offset is there to make the guide match what the channel aired,
 *   and the archive holds what aired (ADR-010, amended in step 24b).
 * - **The URLs** (`catchupCandidates`): an Xtream channel's `/timeshift/` URL in the panel's zone,
 *   `.ts` then `.m3u8` as the account allows; an M3U mode's one URL.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A programme from a channel's archive, as the guide shows it (UTC minutes) with its title. */
export interface ArchiveProgramme {
  readonly start: number;
  readonly end: number;
  readonly title: string;
}

function windowOf(programme: Pick<ArchiveProgramme, 'start' | 'end'>, nowMs: number): CatchupWindow {
  return { startMs: programme.start * MINUTE_MS, endMs: programme.end * MINUTE_MS, nowMs };
}

/** Whether `programme` on `row`'s channel can be watched from the start at `nowMs`. */
export function canWatchFromStart(row: LiveRow, programme: Pick<ArchiveProgramme, 'start' | 'end'>, nowMs: number): boolean {
  const info = row.item.catchup;
  if (info === null || programme.end * MINUTE_MS > nowMs) return false;
  if (info.days !== null && programme.start * MINUTE_MS < nowMs - info.days * DAY_MS) return false;
  return catchupCandidates(row.item.url, info, windowOf(programme, nowMs)).length > 0;
}

/** The request that plays `programme` from `row`'s archive (`null`: the channel's URL can't carry one). */
export function catchupRequest(row: LiveRow, programme: Pick<ArchiveProgramme, 'start' | 'end'>, facts: SourceFacts | undefined, nowMs: number): PlayRequest | null {
  const candidates = catchupCandidates(row.item.url, row.item.catchup, windowOf(programme, nowMs), facts === undefined ? {} : { zone: facts.zone, outputFormats: facts.outputFormats });
  if (candidates.length === 0) return null;
  return { key: row.item.key, src: row.item.src, mode: 'catchup', candidates };
}
