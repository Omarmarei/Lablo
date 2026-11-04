/**
 * Audio and subtitle tracks as the player hands them to the app (architecture.md §2 "Tracks",
 * RELAY step 20b): the engine's tracks with their language normalized (`normalizeLang`), the
 * user's preferred languages, and each channel's own choice.
 *
 * When a stream's tracks appear, the controller picks:
 * 1. the channel's remembered choice (`TrackMemory`), when the stream still has that track;
 * 2. else the first preferred language the stream has (`TrackPreferences`, e.g. `['ar', 'en']`);
 * 3. else the stream's own default.
 * A remembered "subtitles off" wins over the subtitle preferences.
 *
 * Subtitle files beside the stream (`PlayRequest.externalSubs`, step 20b2b) are subtitle tracks
 * too, after the stream's own: `ext:0`, `ext:1`…, remembered and preferred like the others.
 */

import type { ContentKey } from '@zoma/core';
import { normalizeLang } from '@zoma/core';
import type { EngineCaps, Track } from './engine';
import type { ExternalSub } from './request';

export interface PlayerTrack {
  readonly id: string;
  /** Normalized (`ar`, `en`, `kur`), or `''` when the stream doesn't say. */
  readonly lang: string;
  /** The language as the stream wrote it (`ara`, `Arabic`), for a language the app has no name for. */
  readonly streamLang: string;
  /** The stream's or engine's label (a title, or AVPlay's codec and channels). Provider text. */
  readonly label: string;
  readonly selected: boolean;
}

export interface PlayerTracks {
  readonly audio: readonly PlayerTrack[];
  readonly text: readonly PlayerTrack[];
  /** The engine's audio switching (`caps.trackSwitch`): `none` means the menu says the TV can't. */
  readonly switching: EngineCaps['trackSwitch'];
}

export const NO_TRACKS: PlayerTracks = { audio: [], text: [], switching: 'none' };

/** Preferred languages, normalized codes in order (`['ar', 'en']`). An empty `text` list: no subtitles. */
export interface TrackPreferences {
  readonly audio: readonly string[];
  readonly text: readonly string[];
}

export const NO_PREFERENCES: TrackPreferences = { audio: [], text: [] };

/** A track a user picked, as it can be found again in a later stream of the channel. */
export interface TrackPick {
  readonly id: string;
  readonly lang: string;
  readonly label: string;
}

/** A channel's choice: a track, `off` (subtitles only), or `null` (never chosen). */
export interface TrackChoice {
  readonly audio: TrackPick | null;
  readonly text: TrackPick | 'off' | null;
}

/**
 * Where the player keeps each channel's choice. `MemoryTrackMemory` keeps it for the app's run;
 * the profile keeps it later (step 20c).
 */
export interface TrackMemory {
  choice(key: ContentKey): TrackChoice | null;
  remember(key: ContentKey, choice: TrackChoice): void;
}

export class MemoryTrackMemory implements TrackMemory {
  private readonly byKey: Record<string, TrackChoice> = {};

  choice(key: ContentKey): TrackChoice | null {
    return Object.prototype.hasOwnProperty.call(this.byKey, key) ? this.byKey[key]! : null;
  }

  remember(key: ContentKey, choice: TrackChoice): void {
    this.byKey[key] = choice;
  }
}

/** The engine's tracks with their languages normalized. */
export function playerTracks(list: readonly Track[]): PlayerTrack[] {
  return list.map((t) => ({ id: t.id, lang: normalizeLang(t.lang), streamLang: t.lang, label: t.label, selected: t.selected }));
}

/** Subtitle files (`PlayRequest.externalSubs`) follow the stream's own subtitles as `ext:0`, `ext:1`… */
export const FILE_TRACK = 'ext:';

/** The file a subtitle id names (`ext:2` is 2), or -1 for one of the stream's own tracks. */
export function fileIndex(id: string): number {
  if (id.indexOf(FILE_TRACK) !== 0) return -1;
  const digits = id.slice(FILE_TRACK.length);
  const n = Number(digits);
  return String(n) === digits && n >= 0 && Math.floor(n) === n ? n : -1;
}

/** A request's subtitle files as subtitle tracks; file `shown` is the one on (-1: none). */
export function fileTracks(subs: readonly ExternalSub[], shown: number): PlayerTrack[] {
  return subs.map((sub, i) => ({ id: FILE_TRACK + String(i), lang: normalizeLang(sub.lang), streamLang: sub.lang, label: '', selected: i === shown }));
}

export function trackPick(track: PlayerTrack): TrackPick {
  return { id: track.id, lang: track.lang, label: track.label };
}

/**
 * The track of `tracks` that `pick` was: the same id, language and label; else the same language
 * and label; else the first one in the same language (a stream that moved its tracks around).
 * `null` when the stream has no track in that language, or the pick had none and its id is gone.
 */
export function findPick(tracks: readonly PlayerTrack[], pick: TrackPick): PlayerTrack | null {
  let sameLabel: PlayerTrack | null = null;
  let sameLang: PlayerTrack | null = null;
  for (const t of tracks) {
    if (t.lang !== pick.lang) continue;
    if (t.label === pick.label) {
      if (t.id === pick.id) return t;
      if (sameLabel === null) sameLabel = t;
    }
    if (sameLang === null && pick.lang !== '') sameLang = t;
  }
  return sameLabel ?? sameLang;
}

/** The first track in the first of `langs` the stream has, or `null`. */
export function preferredTrack(tracks: readonly PlayerTrack[], langs: readonly string[]): PlayerTrack | null {
  for (const lang of langs) {
    if (lang === '') continue;
    for (const t of tracks) if (t.lang === lang) return t;
  }
  return null;
}
