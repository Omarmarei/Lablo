import type { CatalogItem, ContentKey } from '@zoma/core';
import type { LastChannel, LoadedProfile, PlayerChange, ProfileEdit, StoredTrackChoice, StoredTrackPick } from '@zoma/data';
import type { RedirectMemory, RedirectMode } from '@zoma/platform-api';
import type { Container, SourceMemory, TrackChoice, TrackMemory, TrackPick } from '@zoma/player';
import type { SubtitleSize } from './track-menu';

/**
 * What the player keeps across starts (RELAY step 20c1, architecture.md §2 "Built in step 20c1"):
 * the profile's `player` section (version 3), read once at the start and changed one field at a
 * time through the query worker (`editProfile`, a read-modify-write each, so no change loses
 * another). It hands each part to whoever uses it (ADR-008: the platform's work arrives as
 * callbacks):
 * - `sources` to the controller: the container that last played, per source (`SourceMemory`);
 * - `redirects` to the Tizen platform: what its redirect probe learned, per source;
 * - `tracks` to the controller: each content's track choice and subtitle timing (`TrackMemory`);
 * - the last channel (the start plays it) and the subtitle size, to the app.
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
  /** A channel's stream opened: it is the last channel now. */
  tuned(item: CatalogItem, number: number, category: LastChannel['category'], index: number): void;
  /** The subtitles' size (`null`: never set). */
  subtitleSize(): SubtitleSize | null;
  setSubtitleSize(size: SubtitleSize): void;
}

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
 * live item with its key, source, URL and name, a number and a row.
 */
export function lastChannelOf(profile: LoadedProfile | null): LastChannel | null {
  const player = profile === null ? undefined : (profile.doc as { player?: unknown }).player;
  const last = isRecord(player) ? player['last'] : undefined;
  if (!isRecord(last)) return null;
  const item = last['item'];
  const category = last['category'];
  if (!isRecord(item) || item['kind'] !== 'live') return null;
  for (const field of ['key', 'src', 'url', 'name']) if (typeof item[field] !== 'string') return null;
  const number = last['number'];
  const index = last['index'];
  const started = last['started'];
  if (typeof number !== 'number' || !isFinite(number) || typeof index !== 'number' || !(index >= 0) || Math.floor(index) !== index) return null;
  if (category !== null && !(isRecord(category) && typeof category['src'] === 'string' && typeof category['name'] === 'string')) return null;
  return {
    item: item as unknown as CatalogItem,
    number,
    category: category === null ? null : { src: category['src'] as string, name: category['name'] as string },
    index,
    started: typeof started === 'number' ? started : 0,
  };
}

function sameCategory(a: LastChannel['category'], b: LastChannel['category']): boolean {
  return a === null || b === null ? a === b : a.src === b.src && a.name === b.name;
}

export function createPlayerMemory(options: PlayerMemoryOptions): PlayerMemory {
  const now = options.now ?? (() => Date.now());
  let containers: Record<string, Container> = {};
  let redirectModes: Record<string, 'none' | 'redirects'> = {};
  let choices: Record<string, TrackChoice> = {};
  let last: LastChannel | null = null;
  let size: SubtitleSize | null = null;

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
      last = lastChannelOf(profile);
    },
    last: () => last,
    tuned(item: CatalogItem, number: number, category: LastChannel['category'], index: number): void {
      if (last !== null && last.item.key === item.key && last.number === number && last.index === index && sameCategory(last.category, category)) return;
      last = { item, number, category, index, started: now() };
      write({ field: 'last', last });
    },
    subtitleSize: () => size,
    setSubtitleSize(next: SubtitleSize): void {
      if (next === size) return;
      size = next;
      write({ field: 'subtitleSize', size: next });
    },
  };
}
