import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKey } from '@lablo/core';
import type { LoadedProfile, ProfileEdit } from '@lablo/data';

/**
 * Where each movie was left (RELAY step 26d, architecture.md §1.3): the profile's `progress`
 * (version 5, the latest 500), read once at the start and changed one movie at a time through the
 * query worker (`editProfile`, a read-modify-write each).
 *
 * - **The player saves** a movie's position every `SAVE_EVERY_MS` while it plays, and when it
 *   stops, ends, is left or the app hides (player-state.ts).
 * - **Watched:** a movie that ended, or was left within its last `WATCHED_TAIL_MS` or past
 *   `WATCHED_SHARE` of its length, keeps no position; nor does one left before `MIN_RESUME_MS`
 *   (it starts over).
 * - **The screens:** the details offer "Resume from 12:34" (`point`), a tile draws its bar
 *   (`share`, when the length is known). `version` bumps on every change.
 *
 * Reads never wait: what the start's profile said, plus every change since. A save equal to what
 * is kept writes nothing. A write that fails is logged and kept for the app's run.
 */

/** A playing movie's position is saved this often. */
export const SAVE_EVERY_MS = 10_000;
/** A movie left within this much of its end is watched. */
export const WATCHED_TAIL_MS = 2 * 60_000;
/** A movie left past this share of its length is watched. */
export const WATCHED_SHARE = 0.95;
/** A movie left before this point starts over (no "Resume from 0:04"). */
export const MIN_RESUME_MS = 10_000;

/** Where a movie was left. */
export interface ResumePoint {
  /** Its media time (ms). */
  readonly positionMs: number;
  /** Its length (ms; `null`: not known). */
  readonly lengthMs: number | null;
}

/** Whether a movie at `positionMs` is watched: within its last two minutes, or past 95 % (a length that isn't known: never). */
export function isWatched(positionMs: number, lengthMs: number | null): boolean {
  return lengthMs !== null && (positionMs >= lengthMs - WATCHED_TAIL_MS || positionMs >= lengthMs * WATCHED_SHARE);
}

/** The point to keep for a movie left at `positionMs` (`null`: none: it ended, is watched, or barely started). */
export function keptPoint(positionMs: number, lengthMs: number | null, ended: boolean): ResumePoint | null {
  const length = lengthMs !== null && lengthMs > 0 && isFinite(lengthMs) ? Math.round(lengthMs) : null;
  if (ended || !(positionMs >= MIN_RESUME_MS) || !isFinite(positionMs) || isWatched(positionMs, length)) return null;
  return { positionMs: Math.round(positionMs), lengthMs: length };
}

export interface MovieProgressOptions {
  /** Applies a profile edit (the query worker's `editProfile`). */
  readonly edit: (edit: ProfileEdit) => Promise<boolean>;
  /** The wall clock (epoch ms): when a position was saved. */
  readonly now?: () => number;
}

/** What the screens read: the details' "Resume", the tiles' bars. */
export interface MovieShares {
  /** Bumps on every change: tiles read `share` again. */
  readonly version: ReadonlySignal<number>;
  /** Where movie `key` was left (`null`: never, or watched). */
  point(key: ContentKey): ResumePoint | null;
  /** The share of movie `key` watched, 0–1, for its tile's bar (`undefined`: no position, or no length). */
  share(key: ContentKey): number | undefined;
}

export interface MovieProgress extends MovieShares {
  /** Reads the profile's `progress` (the start's profile; `null`: nothing kept yet). */
  load(profile: LoadedProfile | null): void;
  /** Movie `key` is at `positionMs` of `lengthMs`, or `ended`: keeps the point, or takes it away. */
  save(key: ContentKey, positionMs: number, lengthMs: number | null, ended: boolean): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A stored position, or `null` when it isn't one this app reads. */
function readPoint(value: unknown): ResumePoint | null {
  if (!isRecord(value)) return null;
  const position = value['positionMs'];
  const length = value['lengthMs'];
  if (typeof position !== 'number' || !(position >= 0) || !isFinite(position)) return null;
  if (length === null) return { positionMs: position, lengthMs: null };
  return typeof length === 'number' && length > 0 && isFinite(length) ? { positionMs: position, lengthMs: length } : null;
}

export function createMovieProgress(options: MovieProgressOptions): MovieProgress {
  const now = options.now ?? (() => Date.now());
  const version = signal(0);
  let points: Record<string, ResumePoint> = {};

  const own = (key: ContentKey): ResumePoint | null => (Object.prototype.hasOwnProperty.call(points, key) ? points[key]! : null);

  return {
    version,
    load(profile: LoadedProfile | null): void {
      const stored = profile === null ? undefined : (profile.doc as { progress?: unknown }).progress;
      points = {};
      if (isRecord(stored)) {
        const keys = Object.keys(stored);
        for (let i = 0; i < keys.length; i += 1) {
          const point = readPoint(stored[keys[i]!]);
          if (point !== null) points[keys[i]!] = point;
        }
      }
      version.value += 1;
    },
    point: own,
    share(key: ContentKey): number | undefined {
      const point = own(key);
      return point === null || point.lengthMs === null ? undefined : Math.min(1, point.positionMs / point.lengthMs);
    },
    save(key: ContentKey, positionMs: number, lengthMs: number | null, ended: boolean): void {
      const before = own(key);
      // A play that doesn't know the length (played before the details' read came back, no
      // picture yet) keeps the one known: a movie's length doesn't change.
      const next = keptPoint(positionMs, lengthMs === null && before !== null ? before.lengthMs : lengthMs, ended);
      if (next === null ? before === null : before !== null && before.positionMs === next.positionMs && before.lengthMs === next.lengthMs) return;
      const kept: Record<string, ResumePoint> = { ...points };
      if (next === null) delete kept[key];
      else kept[key] = next;
      points = kept;
      version.value += 1;
      const edit: ProfileEdit = { kind: 'progress', key, progress: next === null ? null : { positionMs: next.positionMs, lengthMs: next.lengthMs, updated: now() } };
      options.edit(edit).catch((error: unknown) => console.warn("The movie's position was not saved", error));
    },
  };
}
