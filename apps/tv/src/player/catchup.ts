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
 * - **Seeking** (step 25d): LEFT and RIGHT move `SEEK_STEP_MS`, FF and RW `JUMP_STEP_MS`, further
 *   while a key is held (`seekStep`). A stream that can't seek inside itself plays again from the
 *   new start, cut to the minute (`catchupRequest`'s `from`).
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A programme from a channel's archive, as the guide shows it (UTC minutes) with its title. */
export interface ArchiveProgramme {
  readonly start: number;
  readonly end: number;
  readonly title: string;
}

function windowOf(programme: Pick<ArchiveProgramme, 'start' | 'end'>, nowMs: number, fromMs?: number): CatchupWindow {
  return { startMs: fromMs === undefined ? programme.start * MINUTE_MS : fromMs, endMs: programme.end * MINUTE_MS, nowMs };
}

/** A press of LEFT or RIGHT moves a catch-up this far (step 25d)… */
export const SEEK_STEP_MS = 60_000;
/** …and a press of FF or RW this far. */
export const JUMP_STEP_MS = 300_000;
/** A held key's presses after this many move further: LEFT/RIGHT five minutes, FF/RW ten. */
export const HELD_PRESSES = 8;

/** How far press `run` (0: the first) of a run of LEFT/RIGHT presses (`step`) or FF/RW presses (`jump`) moves. */
export function seekStep(kind: 'step' | 'jump', run: number): number {
  if (run < HELD_PRESSES) return kind === 'step' ? SEEK_STEP_MS : JUMP_STEP_MS;
  return kind === 'step' ? 5 * SEEK_STEP_MS : 2 * JUMP_STEP_MS;
}

/** Any programme's window: whether a URL can carry catch-up doesn't depend on the programme. */
const PROBE: CatchupWindow = { startMs: 0, endMs: MINUTE_MS, nowMs: MINUTE_MS };

/**
 * The days `row`'s archive holds (`Infinity`: the channel states none, so as far back as the
 * guide reaches), or `null` when its URL can carry no catch-up. The guide keeps it per row
 * (step 25c): the grid's marks and the details ask it for every programme.
 */
export function archiveDays(row: LiveRow): number | null {
  const info = row.item.catchup;
  if (info === null || catchupCandidates(row.item.url, info, PROBE).length === 0) return null;
  return info.days === null ? Infinity : info.days;
}

/** The first minute (UTC) a programme may start at to be in an archive of `days` at `nowMs`. */
export function archiveFrom(days: number, nowMs: number): number {
  return days === Infinity ? -Infinity : Math.ceil((nowMs - days * DAY_MS) / MINUTE_MS);
}

/** Whether `programme` is in an archive starting at minute `from` (`archiveFrom`) at `nowMs`: it has ended, and it started then or later. */
export function inArchive(from: number, programme: Pick<ArchiveProgramme, 'start' | 'end'>, nowMs: number): boolean {
  return programme.end * MINUTE_MS <= nowMs && programme.start >= from;
}

/** Whether `programme` on `row`'s channel can be watched from the start at `nowMs`. */
export function canWatchFromStart(row: LiveRow, programme: Pick<ArchiveProgramme, 'start' | 'end'>, nowMs: number): boolean {
  const days = archiveDays(row);
  return days !== null && inArchive(archiveFrom(days, nowMs), programme, nowMs);
}

/**
 * How many days are left to watch `programme` from an archive of `days` at `nowMs`: the local
 * calendar days from today to the day it leaves the archive (0: it leaves today). `null` when
 * the channel states no days.
 */
export function archiveDaysLeft(days: number, programme: Pick<ArchiveProgramme, 'start'>, nowMs: number): number | null {
  if (days === Infinity) return null;
  const leaves = new Date(programme.start * MINUTE_MS + days * DAY_MS);
  const today = new Date(nowMs);
  // Local midnights as UTC dates: whole days, whatever daylight saving time does between them.
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const to = Date.UTC(leaves.getFullYear(), leaves.getMonth(), leaves.getDate());
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/**
 * The request that plays `programme` from `row`'s archive (`null`: the channel's URL can't carry
 * one), from its start or from `fromMs` (epoch ms; step 25d's seek by URL) to its end.
 */
export function catchupRequest(row: LiveRow, programme: Pick<ArchiveProgramme, 'start' | 'end'>, facts: SourceFacts | undefined, nowMs: number, fromMs?: number): PlayRequest | null {
  const candidates = catchupCandidates(row.item.url, row.item.catchup, windowOf(programme, nowMs, fromMs), facts === undefined ? {} : { zone: facts.zone, outputFormats: facts.outputFormats });
  if (candidates.length === 0) return null;
  return { key: row.item.key, src: row.item.src, mode: 'catchup', candidates };
}
