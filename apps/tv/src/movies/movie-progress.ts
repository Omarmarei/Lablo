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
 * - **Episodes** (step 27c1) keep their place by their own key, under the same rules, and their
 *   show keeps its last episode (`lastEpisode`; the profile's `shows`, version 6): the one played
 *   last, and whether it was watched. One save of an episode is one write (`editProfile`
 *   `{ kind: 'episode' }`): its place and its show's last episode together.
 * - **"Continue watching"** (step 27d, `unfinished`): what was left part way, newest first by the
 *   save times kept with the places and the shows. A show goes by its last episode: not watched
 *   (resume it, or start it: a next episode left at once still counts), or watched with an episode
 *   after it (`more`, which the player says with each save). A show's tile draws its last
 *   episode's bar (`share`: a watched one keeps no place, so none then).
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

/** A show's last episode (step 27c1): the one played last, and whether it was watched (its show goes on with the next one). */
export interface LastEpisode {
  readonly episode: ContentKey;
  readonly watched: boolean;
}

/** A show's last episode as kept (step 27d): with whether an episode came after it, and its save time. */
interface ShowEntry {
  readonly last: LastEpisode;
  /** `undefined`: not said (saved before step 27d). */
  readonly more: boolean | undefined;
  readonly updated: number;
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
  /**
   * The share of movie `key` watched, 0–1, for its tile's bar (`undefined`: no position, or no
   * length); a show's (step 27d), its last episode's.
   */
  share(key: ContentKey): number | undefined;
  /** Show `show`'s last episode (step 27c1; `null`: none played yet). */
  lastEpisode(show: ContentKey): LastEpisode | null;
  /**
   * What was left part way (step 27d, "Continue watching"), newest first: every place kept (a
   * movie's, a playlist's episode's, and a show's episodes', which no catalog lists), and every
   * show whose last episode isn't watched, or is with an episode after it. On an equal time, by key.
   */
  unfinished(): ContentKey[];
}

export interface MovieProgress extends MovieShares {
  /** Reads the profile's `progress` (the start's profile; `null`: nothing kept yet). */
  load(profile: LoadedProfile | null): void;
  /**
   * Movie `key` is at `positionMs` of `lengthMs`, or `ended`: keeps the point, or takes it away.
   * An episode of `show` (step 27c1) is also its show's last episode, watched once it ended or is
   * past the watched point; `more` (step 27d): whether an episode comes after it.
   */
  save(key: ContentKey, positionMs: number, lengthMs: number | null, ended: boolean, show?: ContentKey, more?: boolean): void;
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

/** A stored save time (one that isn't: 0, the oldest). */
function readTime(value: Record<string, unknown>): number {
  const updated = value['updated'];
  return typeof updated === 'number' && isFinite(updated) ? updated : 0;
}

/** A stored show's last episode, or `null` when it isn't one this app reads. */
function readLast(value: unknown): ShowEntry | null {
  if (!isRecord(value)) return null;
  const episode = value['episode'];
  const watched = value['watched'];
  const more = value['more'];
  if (typeof episode !== 'string' || episode === '' || typeof watched !== 'boolean') return null;
  return { last: { episode: episode as ContentKey, watched }, more: typeof more === 'boolean' ? more : undefined, updated: readTime(value) };
}

/** Something saved, and when. */
interface Saved {
  readonly key: ContentKey;
  readonly updated: number;
}

/**
 * `items` newest first, by key on an equal time: a merge sort (no `Array.prototype.sort` in the TV
 * bundle: Babel would add core-js's for it, and Chromium 53-68's isn't stable anyway).
 */
function newestFirst(items: readonly Saved[]): readonly Saved[] {
  if (items.length < 2) return items;
  const half = items.length >> 1;
  const a = newestFirst(items.slice(0, half));
  const b = newestFirst(items.slice(half));
  const out: Saved[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    if (y.updated > x.updated || (y.updated === x.updated && y.key < x.key)) {
      out.push(y);
      j += 1;
    } else {
      out.push(x);
      i += 1;
    }
  }
  while (i < a.length) out.push(a[i++]!);
  while (j < b.length) out.push(b[j++]!);
  return out;
}

export function createMovieProgress(options: MovieProgressOptions): MovieProgress {
  const now = options.now ?? (() => Date.now());
  const version = signal(0);
  let points: Record<string, ResumePoint> = {};
  /** When each place was saved (step 27d). */
  let times: Record<string, number> = {};
  let shows: Record<string, ShowEntry> = {};

  const own = (key: ContentKey): ResumePoint | null => (Object.prototype.hasOwnProperty.call(points, key) ? points[key]! : null);
  const entry = (show: ContentKey): ShowEntry | null => (Object.prototype.hasOwnProperty.call(shows, show) ? shows[show]! : null);
  const last = (show: ContentKey): LastEpisode | null => {
    const kept = entry(show);
    return kept === null ? null : kept.last;
  };
  /** The place a tile's bar draws: the item's own, else a show's last episode's (step 27d; a watched one keeps none). */
  const barPoint = (key: ContentKey): ResumePoint | null => {
    const point = own(key);
    if (point !== null) return point;
    const kept = entry(key);
    return kept === null ? null : own(kept.last.episode);
  };

  return {
    version,
    load(profile: LoadedProfile | null): void {
      const doc = profile === null ? undefined : (profile.doc as { progress?: unknown; shows?: unknown });
      const stored = doc === undefined ? undefined : doc.progress;
      points = {};
      times = {};
      if (isRecord(stored)) {
        const keys = Object.keys(stored);
        for (let i = 0; i < keys.length; i += 1) {
          const value = stored[keys[i]!];
          const point = readPoint(value);
          if (point === null) continue;
          points[keys[i]!] = point;
          times[keys[i]!] = readTime(value as Record<string, unknown>);
        }
      }
      const lasts = doc === undefined ? undefined : doc.shows;
      shows = {};
      if (isRecord(lasts)) {
        const keys = Object.keys(lasts);
        for (let i = 0; i < keys.length; i += 1) {
          const kept = readLast(lasts[keys[i]!]);
          if (kept !== null) shows[keys[i]!] = kept;
        }
      }
      version.value += 1;
    },
    point: own,
    share(key: ContentKey): number | undefined {
      const point = barPoint(key);
      return point === null || point.lengthMs === null ? undefined : Math.min(1, point.positionMs / point.lengthMs);
    },
    lastEpisode: last,
    unfinished(): ContentKey[] {
      const found: Saved[] = [];
      const placed = Object.keys(points);
      for (let i = 0; i < placed.length; i += 1) found.push({ key: placed[i]!, updated: times[placed[i]!] ?? 0 });
      const kept = Object.keys(shows);
      for (let i = 0; i < kept.length; i += 1) {
        const show = shows[kept[i]!]!;
        if (!show.last.watched || show.more === true) found.push({ key: kept[i]!, updated: show.updated });
      }
      const ordered = newestFirst(found);
      const keys: ContentKey[] = [];
      for (let i = 0; i < ordered.length; i += 1) keys.push(ordered[i]!.key);
      return keys;
    },
    save(key: ContentKey, positionMs: number, lengthMs: number | null, ended: boolean, show?: ContentKey, more?: boolean): void {
      const before = own(key);
      // A play that doesn't know the length (played before the details' read came back, no
      // picture yet) keeps the one known: a movie's length doesn't change.
      const length = lengthMs === null && before !== null ? before.lengthMs : lengthMs;
      const next = keptPoint(positionMs, length, ended);
      const samePoint = next === null ? before === null : before !== null && before.positionMs === next.positionMs && before.lengthMs === next.lengthMs;
      // An episode (step 27c1): its show's last episode, watched once it ended or is past the watched point.
      const watched = ended || (isFinite(positionMs) && isWatched(positionMs, length));
      const shown = show === undefined ? null : entry(show);
      const sameShow = show === undefined || (shown !== null && shown.last.episode === key && shown.last.watched === watched && shown.more === more);
      if (samePoint && sameShow) return;
      const at = now();
      if (!samePoint) {
        const kept: Record<string, ResumePoint> = { ...points };
        if (next === null) delete kept[key];
        else {
          kept[key] = next;
          // (A time whose place went is never read: `unfinished` goes by the places.)
          const saved: Record<string, number> = { ...times };
          saved[key] = at;
          times = saved;
        }
        points = kept;
      }
      const progress = next === null ? null : { positionMs: next.positionMs, lengthMs: next.lengthMs, updated: at };
      let edit: ProfileEdit = { kind: 'progress', key, progress };
      if (show !== undefined) {
        const lasts: Record<string, ShowEntry> = { ...shows };
        // (Its time follows every write: the profile renews the entry's with the episode's place.)
        lasts[show] = { last: { episode: key, watched }, more, updated: at };
        shows = lasts;
        edit = { kind: 'episode', show, last: more === undefined ? { episode: key, watched, updated: at } : { episode: key, watched, more, updated: at }, progress };
      }
      version.value += 1;
      options.edit(edit).catch((error: unknown) => console.warn("The movie's position was not saved", error));
    },
  };
}
