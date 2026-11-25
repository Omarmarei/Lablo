import type { CatalogItem, ContentKey } from '@lablo/core';
import type { LastChannel, LoadedProfile, PlayerChange, ProfileEdit, StoredTrackChoice, StoredTrackPick } from '@lablo/data';
import type { RedirectMemory, RedirectMode } from '@lablo/platform-api';
import type { Container, PictureMode, SourceMemory, TrackChoice, TrackMemory, TrackPick } from '@lablo/player';
import { asPictureMode } from '@lablo/player';
import type { RailRef } from '../live/live-state';
import type { CaptionBackground, CaptionColor } from './appearance';
import { asCaptionBackground, asCaptionColor } from './appearance';
import type { BufferMode } from './play-tuning';
import type { SubtitleSize } from './track-menu';
import { DEFAULT_STILL_HOURS, STILL_HOURS } from './watch-guard';

/**
 * What the player keeps across starts (RELAY step 20c1, architecture.md §2 "Built in step 20c1"):
 * the profile's `player` section (version 3), read once at the start and changed one field at a
 * time through the query worker (`editProfile`, a read-modify-write each, so no change loses
 * another). It hands each part to whoever uses it (ADR-008: the platform's work arrives as
 * callbacks):
 * - `sources` to the controller: the container that last played, per source (`SourceMemory`);
 * - `redirects` to the Tizen platform: what its redirect probe learned, per source;
 * - `tracks` to the controller: each content's track choice and subtitle timing (`TrackMemory`);
 * - the last channel (the start plays it), the subtitle size and the picture's mode (step
 *   20c2b), to the app;
 * - the audio and subtitle languages Settings › "Player" chose (step 38d3), to the player's
 *   preferences (`trackPreferences`);
 * - Settings › "Player"'s other rows, kept by name in the profile's `player.options` (step 39a:
 *   "Clock while watching", `clock: 'on'`, absent when off; step 39c: "Still watching?",
 *   `stillWatching: 'off'`, `'2'` or `'6'`, absent for its default 4 hours; step 39d:
 *   "Buffering", `buffer: 'stable'`, absent for Fast start), to the player;
 * - the channels played last (step 28b2, the profile's `channels`, version 7), to Home: the
 *   query worker puts each new last channel first in the same write, and `tuned` does the same
 *   here.
 *
 * Reads never wait: what the start's profile said, plus every change since. A change equal to
 * what is kept writes nothing. A write that fails is logged and kept for the app's run.
 */

export interface PlayerMemoryOptions {
  /** Applies a profile edit (the query worker's `editProfile`). */
  readonly edit: (edit: ProfileEdit) => Promise<boolean>;
  /** The wall clock (epoch ms). */
  readonly now?: () => number;
}

export interface PlayerMemory {
  readonly sources: SourceMemory;
  readonly redirects: RedirectMemory;
  readonly tracks: TrackMemory;
  /** Reads the profile's player section (the start's profile; `null`: nothing kept yet). */
  load(profile: LoadedProfile | null): void;
  /** The channel watched last (`null`: none). */
  last(): LastChannel | null;
  /** The channels played last, newest first, each once (step 28b2): a new array after each change. */
  recent(): readonly LastChannel[];
  /** A channel's stream opened from rail entry `ref` (a list: step 35c): it is the last channel now. */
  tuned(item: CatalogItem, number: number, ref: RailRef, index: number): void;
  /** The subtitles' size (`null`: never set). */
  subtitleSize(): SubtitleSize | null;
  setSubtitleSize(size: SubtitleSize): void;
  /** The picture's mode for every channel (`null`: never set). */
  picture(): PictureMode | null;
  setPicture(mode: PictureMode): void;
  /** The audio language chosen in Settings › "Player" (step 38d3; `null`: the app's). */
  audioLang(): TrackLang | null;
  setAudioLang(lang: TrackLang | null): void;
  /** The subtitles' language chosen there (`null`: none turned on). */
  subtitleLang(): TrackLang | null;
  setSubtitleLang(lang: TrackLang | null): void;
  /** "Clock while watching" (step 39a; off until set). */
  clock(): boolean;
  setClock(on: boolean): void;
  /** "Still watching?" (step 39c): the hours without a key before it asks (`null`: never; `DEFAULT_STILL_HOURS` until set). */
  stillHours(): number | null;
  setStillHours(hours: number | null): void;
  /** "Buffering" (step 39d): Fast start until set. */
  bufferMode(): BufferMode;
  setBufferMode(mode: BufferMode): void;
  /** "Larger text" (step 43; off until set). */
  largeText(): boolean;
  setLargeText(on: boolean): void;
  /** The captions' box and colour (step 43; dark and white until set). */
  captionBackground(): CaptionBackground;
  setCaptionBackground(value: CaptionBackground): void;
  captionColor(): CaptionColor;
  setCaptionColor(value: CaptionColor): void;
}

/** A track language Settings › "Player" offers (step 38d3): the app's two. */
export type TrackLang = 'ar' | 'en';
export const TRACK_LANGS: readonly TrackLang[] = ['ar', 'en'];

/** A stored value as a track language, or `null` when it isn't one. */
function asTrackLang(value: unknown): TrackLang | null {
  return TRACK_LANGS.indexOf(value as TrackLang) === -1 ? null : (value as TrackLang);
}

/**
 * A stored "Still watching?" (step 39c) as hours: `off` is never (`null`), one of `STILL_HOURS` as
 * text is itself, and anything else (absent too) is the default.
 */
function asStillHours(value: unknown): number | null {
  if (value === 'off') return null;
  for (let i = 0; i < STILL_HOURS.length; i += 1) if (String(STILL_HOURS[i]) === value) return STILL_HOURS[i]!;
  return DEFAULT_STILL_HOURS;
}

/** The channels played last that are kept (the profile's `MAX_CHANNELS`, step 28b2). */
export const RECENT_CHANNELS = 20;

const CONTAINERS: readonly Container[] = ['ts', 'hls', 'mp4', 'mkv', 'other'];
const SIZES: readonly SubtitleSize[] = ['s', 'm', 'l'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isPick(value: unknown): value is StoredTrackPick {
  return isRecord(value) && typeof value['id'] === 'string' && typeof value['lang'] === 'string' && typeof value['label'] === 'string';
}

/** A stored choice as the player's `TrackChoice`, or `null` when it isn't one. */
function readChoice(value: unknown): TrackChoice | null {
  if (!isRecord(value)) return null;
  const pick = (p: StoredTrackPick): TrackPick => ({ id: p.id, lang: p.lang, label: p.label });
  const storedAudio = value['audio'];
  const storedText = value['text'];
  const delay = value['delayMs'];
  let audio: TrackPick | null;
  if (storedAudio === null) audio = null;
  else if (isPick(storedAudio)) audio = pick(storedAudio);
  else return null;
  let text: TrackPick | 'off' | null;
  if (storedText === null || storedText === 'off') text = storedText;
  else if (isPick(storedText)) text = pick(storedText);
  else return null;
  return typeof delay === 'number' ? { audio, text, delayMs: delay } : { audio, text };
}

/**
 * The profile's last channel, or `null` when it has none or it isn't one this app can play: a
 * live item with its key, source, URL and name, a number and a row. A backup made without logins
 * (step 32d4a) brings it back with no URL: the start plays nothing.
 */
export function lastChannelOf(profile: LoadedProfile | null): LastChannel | null {
  const player = profile === null ? undefined : (profile.doc as { player?: unknown }).player;
  const last = readChannel(isRecord(player) ? player['last'] : undefined);
  return last !== null && last.item.url !== '' ? last : null;
}

/**
 * The profile's channels played last (step 28b2), newest first: the ones this app can play (as
 * `lastChannelOf`, a URL or none: Home plays them from the catalog by key), at most
 * `RECENT_CHANNELS` (none: `[]`).
 */
export function recentChannelsOf(profile: LoadedProfile | null): LastChannel[] {
  const stored = profile === null ? undefined : (profile.doc as { channels?: unknown }).channels;
  const out: LastChannel[] = [];
  if (!Array.isArray(stored)) return out;
  for (let i = 0; i < stored.length && out.length < RECENT_CHANNELS; i += 1) {
    const channel = readChannel(stored[i]);
    if (channel !== null) out.push(channel);
  }
  return out;
}

/** `value` as a channel this app can play, or `null` (see `lastChannelOf`). */
function readChannel(last: unknown): LastChannel | null {
  if (!isRecord(last)) return null;
  const item = last['item'];
  const category = last['category'];
  const list = last['list'];
  if (!isRecord(item) || item['kind'] !== 'live') return null;
  for (const field of ['key', 'src', 'url', 'name']) if (typeof item[field] !== 'string') return null;
  const number = last['number'];
  const index = last['index'];
  const started = last['started'];
  if (typeof number !== 'number' || !isFinite(number) || typeof index !== 'number' || !(index >= 0) || Math.floor(index) !== index) return null;
  if (category !== null && !(isRecord(category) && typeof category['src'] === 'string' && typeof category['name'] === 'string')) return null;
  const channel: LastChannel = {
    item: item as unknown as CatalogItem,
    number,
    category: category === null ? null : { src: category['src'] as string, name: category['name'] as string },
    index,
    started: typeof started === 'number' ? started : 0,
  };
  // A list's id (step 35c); one that isn't a string is "All channels".
  if (category === null && typeof list === 'string' && list !== '') channel.list = list;
  return channel;
}

/** The rail entry a kept channel played from (step 35c: a favourites list by its id). */
export function railRefOf(channel: LastChannel): RailRef {
  return channel.list !== undefined ? { list: channel.list } : channel.category;
}

/** `channels` with `last` first and its key's entry before taken out, at most `RECENT_CHANNELS` (a new array). */
function withChannel(channels: readonly LastChannel[], last: LastChannel): LastChannel[] {
  const next = [last];
  for (let i = 0; i < channels.length && next.length < RECENT_CHANNELS; i += 1) if (channels[i]!.item.key !== last.item.key) next.push(channels[i]!);
  return next;
}

/** Whether `a` and `b` name the same rail entry. */
function sameRef(a: RailRef, b: RailRef): boolean {
  if (a === null || b === null) return a === b;
  if ('list' in a || 'list' in b) return 'list' in a && 'list' in b && a.list === b.list;
  return a.src === b.src && a.name === b.name;
}

export function createPlayerMemory(options: PlayerMemoryOptions): PlayerMemory {
  const now = options.now ?? (() => Date.now());
  let containers: Record<string, Container> = {};
  let redirectModes: Record<string, 'none' | 'redirects'> = {};
  let choices: Record<string, TrackChoice> = {};
  let last: LastChannel | null = null;
  let channels: readonly LastChannel[] = [];
  let size: SubtitleSize | null = null;
  let picture: PictureMode | null = null;
  let audioLang: TrackLang | null = null;
  let subtitleLang: TrackLang | null = null;
  let clock = false;
  let stillHours: number | null = DEFAULT_STILL_HOURS;
  let bufferMode: BufferMode = 'fast';
  let largeText = false;
  let captionBackground: CaptionBackground = 'dark';
  let captionColor: CaptionColor = 'white';

  const write = (change: PlayerChange): void => {
    options.edit({ kind: 'player', change }).catch((error: unknown) => console.warn('The player memory was not saved', error));
  };

  const sources: SourceMemory = {
    preferred: (src) => {
      const kept = own(containers, src);
      return kept === undefined ? null : (kept as Container);
    },
    remember: (src, container) => {
      if (own(containers, src) === container) return;
      containers = { ...containers, [src]: container };
      write({ field: 'container', src, container });
    },
  };

  const redirects: RedirectMemory = {
    mode: (src): RedirectMode => {
      const kept = own(redirectModes, src);
      return kept === undefined ? 'unknown' : (kept as 'none' | 'redirects');
    },
    remember: (src, mode) => {
      if (own(redirectModes, src) === mode) return;
      redirectModes = { ...redirectModes, [src]: mode };
      write({ field: 'redirect', src, mode });
    },
  };

  const tracks: TrackMemory = {
    choice: (key) => {
      const kept = own(choices, key);
      return kept === undefined ? null : (kept as TrackChoice);
    },
    remember: (key: ContentKey, choice: TrackChoice) => {
      choices = { ...choices, [key]: choice };
      const stored: StoredTrackChoice = { ...choice, used: now() };
      write({ field: 'track', key, choice: stored });
    },
  };

  return {
    sources,
    redirects,
    tracks,
    load(profile: LoadedProfile | null): void {
      const player = profile === null ? undefined : (profile.doc as { player?: unknown }).player;
      const doc = isRecord(player) ? player : {};
      containers = {};
      redirectModes = {};
      choices = {};
      const storedContainers = doc['containers'];
      if (isRecord(storedContainers)) {
        for (const src of Object.keys(storedContainers)) {
          const c = storedContainers[src];
          if (CONTAINERS.indexOf(c as Container) !== -1) containers[src] = c as Container;
        }
      }
      const storedRedirects = doc['redirects'];
      if (isRecord(storedRedirects)) {
        for (const src of Object.keys(storedRedirects)) {
          const m = storedRedirects[src];
          if (m === 'none' || m === 'redirects') redirectModes[src] = m;
        }
      }
      const storedTracks = doc['tracks'];
      if (isRecord(storedTracks)) {
        for (const key of Object.keys(storedTracks)) {
          const choice = readChoice(storedTracks[key]);
          if (choice !== null) choices[key] = choice;
        }
      }
      const storedSize = doc['subtitleSize'];
      size = SIZES.indexOf(storedSize as SubtitleSize) !== -1 ? (storedSize as SubtitleSize) : null;
      picture = asPictureMode(doc['picture']);
      audioLang = asTrackLang(doc['audioLang']);
      subtitleLang = asTrackLang(doc['subtitleLang']);
      const storedOptions = doc['options'];
      clock = isRecord(storedOptions) && own(storedOptions, 'clock') === 'on';
      stillHours = asStillHours(isRecord(storedOptions) ? own(storedOptions, 'stillWatching') : undefined);
      // Anything but `stable` is Fast start.
      bufferMode = isRecord(storedOptions) && own(storedOptions, 'buffer') === 'stable' ? 'stable' : 'fast';
      largeText = isRecord(storedOptions) && own(storedOptions, 'largeText') === 'on';
      captionBackground = asCaptionBackground(isRecord(storedOptions) ? own(storedOptions, 'captionBg') : undefined);
      captionColor = asCaptionColor(isRecord(storedOptions) ? own(storedOptions, 'captionColor') : undefined);
      last = lastChannelOf(profile);
      channels = recentChannelsOf(profile);
    },
    last: () => last,
    recent: () => channels,
    tuned(item: CatalogItem, number: number, ref: RailRef, index: number): void {
      if (last !== null && last.item.key === item.key && last.number === number && last.index === index && sameRef(railRefOf(last), ref)) return;
      last = ref !== null && 'list' in ref ? { item, number, category: null, list: ref.list, index, started: now() } : { item, number, category: ref, index, started: now() };
      channels = withChannel(channels, last);
      write({ field: 'last', last });
    },
    subtitleSize: () => size,
    setSubtitleSize(next: SubtitleSize): void {
      if (next === size) return;
      size = next;
      write({ field: 'subtitleSize', size: next });
    },
    picture: () => picture,
    setPicture(next: PictureMode): void {
      if (next === picture) return;
      picture = next;
      write({ field: 'picture', mode: next });
    },
    audioLang: () => audioLang,
    setAudioLang(next: TrackLang | null): void {
      if (next === audioLang) return;
      audioLang = next;
      write({ field: 'audioLang', lang: next });
    },
    subtitleLang: () => subtitleLang,
    setSubtitleLang(next: TrackLang | null): void {
      if (next === subtitleLang) return;
      subtitleLang = next;
      write({ field: 'subtitleLang', lang: next });
    },
    clock: () => clock,
    setClock(on: boolean): void {
      if (on === clock) return;
      clock = on;
      write({ field: 'option', name: 'clock', value: on ? 'on' : null });
    },
    stillHours: () => stillHours,
    setStillHours(hours: number | null): void {
      if (hours === stillHours) return;
      stillHours = hours;
      // The default leaves nothing stored.
      write({ field: 'option', name: 'stillWatching', value: hours === null ? 'off' : hours === DEFAULT_STILL_HOURS ? null : String(hours) });
    },
    bufferMode: () => bufferMode,
    setBufferMode(mode: BufferMode): void {
      if (mode === bufferMode) return;
      bufferMode = mode;
      // Fast start, the default, leaves nothing stored.
      write({ field: 'option', name: 'buffer', value: mode === 'stable' ? 'stable' : null });
    },
    largeText: () => largeText,
    setLargeText(on: boolean): void {
      if (on === largeText) return;
      largeText = on;
      write({ field: 'option', name: 'largeText', value: on ? 'on' : null });
    },
    captionBackground: () => captionBackground,
    setCaptionBackground(value: CaptionBackground): void {
      if (value === captionBackground) return;
      captionBackground = value;
      // The default (dark) leaves nothing stored.
      write({ field: 'option', name: 'captionBg', value: value === 'dark' ? null : value });
    },
    captionColor: () => captionColor,
    setCaptionColor(value: CaptionColor): void {
      if (value === captionColor) return;
      captionColor = value;
      write({ field: 'option', name: 'captionColor', value: value === 'white' ? null : value });
    },
  };
}
