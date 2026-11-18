/**
 * The profile document (architecture.md §1.3): the only data that can't be rebuilt from the
 * provider. It lives in the `profile` store as `current`, plus 3 rolling snapshots for rollback,
 * and (from step 32) in the encrypted cloud backup.
 *
 * The backup (step 32c1) sends the stored document whole (`storedProfileDoc`), and a restore puts
 * one back only where there is none (`putProfileIfNone`).
 *
 * Its shape is versioned separately from the database. Older documents are upgraded on load by
 * `PROFILE_MIGRATIONS`, pure functions that never drop data; the document from before the
 * upgrade is kept as a snapshot. A document from a newer app version is returned as it is and
 * never overwritten by this version.
 *
 * Version 1 (RELAY step 7) holds the favourites. Version 2 (step 13b) adds the sources the user
 * added and the onboarding answers. Version 3 (step 20c1) adds what the player keeps
 * (`PlayerMemoryDoc`). Version 4 (step 22b) keeps the user's guides as one list (`guides`),
 * moved from each source's `epgUrl`. Version 5 (step 26d) keeps where each movie was left
 * (`progress`, the latest `MAX_PROGRESS`). Version 6 (step 27c1) keeps each show's last episode
 * (`shows`, the latest `MAX_SHOWS`). Version 7 (step 28b2) keeps the channels played last
 * (`channels`, the latest `MAX_CHANNELS`). Later steps add fields with a migration each, or as
 * optional fields that need none (`PlayerMemoryDoc.picture`, step 20c2b; `epgOffsets`, step 24b;
 * `epgOverrides`, step 24d; `ShowProgress.more`, step 27d; `noticesShown`, step 30c2a).
 */

import type { CatalogItem, ContentKey, ContentKind, EpgOverride, XtreamAccount } from '@lablo/core';
import type { EpgPin } from './epg-overrides';
import { epgOverridesOf, isEpgPin } from './epg-overrides';
import type { UserGuide } from './epg-sources';
import { epgOffsetsOf, isEpgOffset } from './epg-sources';
import { MAX_NOTICES, isRuleId } from './config-constants';
import { onSuccess, transact } from './idb';
import { STORE } from './schema';

/**
 * A favourite item. When its key disappears from a refresh, `normName` (narrowed by `epgId` and
 * `group`) re-matches it to the renumbered or renamed item (favourites.ts, step 8).
 */
export interface FavouriteRef {
  key: ContentKey;
  src: string;
  kind: ContentKind;
  normName: string;
  /** The item's group when it was added or last re-matched (tells apart same-name items). */
  group?: string;
  /** The item's tvg-id / `epg_channel_id` (re-matches a renamed M3U channel). */
  epgId?: string | null;
  /** Epoch ms when it was added. */
  added: number;
  /** Epoch ms since its key has been missing from the catalog (`null`: present). */
  missingSince: number | null;
}

// A type alias (not an interface) so that it is assignable to `AnyProfile`.
export type ProfileV1 = {
  v: 1;
  favourites: FavouriteRef[];
};

/**
 * A source the user added (step 13b). `id` scopes its ContentKeys and catalog records (ADR-009),
 * so it never changes and is never reused for another source.
 *
 * The login (an Xtream account, or an M3U link, which often holds one) is stored in IndexedDB
 * only, in plain text for now. Step 32 encrypts it with the TV's `localKey` before the profile is
 * written, and the cloud backup leaves it out when the user turns that off (architecture.md §3.3).
 */
export type SourceRecord =
  | { id: string; type: 'xtream'; name: string; account: XtreamAccount; added: number }
  | { id: string; type: 'm3u'; name: string; url: string; added: number }
  /**
   * An M3U file sent from the phone (step 31d2b1): no link, so never refreshed by itself. Sent
   * again under the same name, it loads under this id again (favourites and places carry over).
   */
  | { id: string; type: 'm3u-file'; name: string; added: number };

/** A source as versions 4 to 7 stored it: a login or a link (version 8 added the phone's file). */
export type SourceRecordV7 = Exclude<SourceRecord, { type: 'm3u-file' }>;

/**
 * A source as versions 2 and 3 stored it: with the guide link typed in onboarding (`null`: none).
 * Version 4 moved the links to the profile's `guides`.
 */
export type SourceRecordV3 = SourceRecordV7 & { epgUrl: string | null };

/** What the user answered during onboarding. */
export type OnboardingAnswers = {
  /** The language picked on the first screen (`en`, `ar`); `null`: none yet, the TV's shows. */
  language: string | null;
  /** When the disclaimer was accepted (epoch ms); `null`: not yet. */
  disclaimerAt: number | null;
  /** The device-ID consent: allowed, "not now", or not asked yet (`null`). Step 32 reads it. */
  consent: boolean | null;
};

export type ProfileV2 = {
  v: 2;
  favourites: FavouriteRef[];
  sources: SourceRecordV3[];
  onboarding: OnboardingAnswers;
};

/**
 * A track picked for a content (the player's `TrackPick`; `data` doesn't import `player`, so the
 * shape is repeated here).
 */
export type StoredTrackPick = { id: string; lang: string; label: string };

/** A content's track choice (the player's `TrackChoice`) and when it was last made. */
export type StoredTrackChoice = {
  audio: StoredTrackPick | null;
  text: StoredTrackPick | 'off' | null;
  /** A subtitle file's timing for this content, in ms (negative: earlier). Absent: none. */
  delayMs?: number;
  /** When it was last changed (epoch ms): past `MAX_TRACK_CHOICES`, the oldest go. */
  used: number;
};

/**
 * The channel watched last (start-on-last-channel, architecture.md §2): the start plays it before
 * the catalog loads, so the item itself is kept. Its `url` holds credentials, like the source's
 * login: step 32 encrypts it with them.
 */
export type LastChannel = {
  item: CatalogItem;
  /** The number the info bar showed. */
  number: number;
  /** The live screen's rail entry it played from: a source's category (by name), or `null` for "All channels". */
  category: { src: string; name: string } | null;
  /** Its row in that list then (where the start looks for it first). */
  index: number;
  /** When it started (epoch ms). Not `at`: a member named like `Array.prototype.at` pulls core-js's polyfill into the TV bundle. */
  started: number;
};

/** What the player keeps across starts (step 20c1). */
export type PlayerMemoryDoc = {
  last: LastChannel | null;
  /** The container (`ts`, `hls`…) that last played, per source: the player's `SourceMemory`. */
  containers: Record<string, string>;
  /** What the redirect probe (Tizen) learned, per source. */
  redirects: Record<string, 'none' | 'redirects'>;
  /** Each content's track choice, by ContentKey: the player's `TrackMemory`. */
  tracks: Record<string, StoredTrackChoice>;
  /** The subtitles' size (`s`, `m`, `l`); `null`: never set. */
  subtitleSize: string | null;
  /**
   * The picture's mode for every channel (`fit`, `zoom`, `stretch`, `4:3`; step 20c2b). Absent:
   * never set. Optional, so version 3 documents written before it need no migration.
   */
  picture?: string;
};

export type ProfileV3 = {
  v: 3;
  favourites: FavouriteRef[];
  sources: SourceRecordV3[];
  onboarding: OnboardingAnswers;
  player: PlayerMemoryDoc;
};

export type ProfileV4 = {
  v: 4;
  favourites: FavouriteRef[];
  sources: SourceRecordV7[];
  onboarding: OnboardingAnswers;
  player: PlayerMemoryDoc;
  /**
   * The XMLTV guides the user added (step 22b), in the user's order: they come before every
   * source's own guide (epg-sources.ts). An id names the guide's stored records (`u~<id>`), so it
   * never changes; a guide moved from a source (version 3) or typed in onboarding has its
   * source's id, one added on the guides screen `g<n>`.
   */
  guides: UserGuide[];
  /**
   * The user's time offset per guide (step 24b), in minutes by guide id (`u~<id>`, `<src>:xmltv`,
   * `<src>:tvg<n>`): a whole number of half hours up to 12 h either way, never 0 (a guide without
   * one has no entry). Optional, so version 4 documents written before it need no migration. The
   * query worker reads it (`epgOffsetsOf`).
   */
  epgOffsets?: Record<string, number>;
  /**
   * The user's manual EPG mappings (step 24d), by live channel's ContentKey: a guide's XMLTV
   * channel, or no guide (epg-overrides.ts). A channel without one has no entry, and is matched as
   * the guides say. Optional, so version 4 documents written before it need no migration. The EPG
   * worker reads it at each refresh, the query worker at each reload (`epgOverridesOf`).
   */
  epgOverrides?: Record<string, EpgPin>;
};

/**
 * Where a movie was left (step 26d): its media time, its length when known, and when it was saved
 * (the cap drops the oldest). A watched movie has none.
 */
export type WatchProgress = {
  positionMs: number;
  /** The engine's length, else the panel's (ms; `null`: neither knew it). */
  lengthMs: number | null;
  /** When it was saved (epoch ms). */
  updated: number;
};

export type ProfileV5 = Omit<ProfileV4, 'v'> & {
  v: 5;
  /** Where each movie was left (step 26d), by ContentKey: the latest `MAX_PROGRESS`. */
  progress: Record<string, WatchProgress>;
};

/**
 * A show's last episode (step 27c1): the one played last, whether it was watched (it ended, or
 * was left near its end: the show goes on with the next one), and when it was saved (the cap drops
 * the oldest). The episode's own place is in `progress`, by its key, as a movie's is.
 */
export type ShowProgress = {
  /** The episode's ContentKey (`x:<src>:episode:<id>`). */
  episode: string;
  watched: boolean;
  /**
   * Whether the panel listed an episode after it when it was saved (step 27d): a watched show goes
   * on in "Continue watching" only then. Optional, so version 6 entries written before it need no
   * migration (one without it is taken as the show's last episode).
   */
  more?: boolean;
  /** When it was saved (epoch ms). */
  updated: number;
};

export type ProfileV6 = Omit<ProfileV5, 'v'> & {
  v: 6;
  /** Each show's last episode (step 27c1), by the show's ContentKey: the latest `MAX_SHOWS`. */
  shows: Record<string, ShowProgress>;
};

export type ProfileV7 = Omit<ProfileV6, 'v'> & {
  v: 7;
  /**
   * The channels played last (step 28b2), newest first, each once (by its item's key): the latest
   * `MAX_CHANNELS`. The first is `player.last`; Home's "Recent channels" lists them.
   */
  channels: LastChannel[];
  /**
   * The signed config's notices already shown (step 30c2a), by rule id, oldest first: the latest
   * `MAX_NOTICES`. A notice shows once. Optional, so version 7 documents written before it need
   * no migration (one without it has shown none).
   */
  noticesShown?: string[];
};

export type ProfileV8 = Omit<ProfileV7, 'v' | 'sources'> & {
  v: 8;
  /** The sources, an M3U file from the phone among them now (step 31d2b1). */
  sources: SourceRecord[];
};

/** The current profile shape. */
export type ProfileDoc = ProfileV8;

/** Track choices kept; a new content past this drops the one changed longest ago. */
export const MAX_TRACK_CHOICES = 300;

/** Movies and episodes whose position is kept (architecture.md §1.3); a new one past this drops the one saved longest ago. */
export const MAX_PROGRESS = 500;

/** Shows whose last episode is kept (step 27c1); a new one past this drops the one saved longest ago. */
export const MAX_SHOWS = 200;

/** Channels played last that are kept (step 28b2); a new one past this drops the one played longest ago. */
export const MAX_CHANNELS = 20;

/** A stored document of any version (older ones are migrated on load). */
export interface AnyProfile {
  v: number;
  [field: string]: unknown;
}

/** `PROFILE_MIGRATIONS[i]` upgrades a version `i + 1` document to version `i + 2`. Append only. */
export type ProfileMigration = (doc: AnyProfile) => AnyProfile;

export const PROFILE_MIGRATIONS: readonly ProfileMigration[] = [
  // 1 → 2 (step 13b): no sources and no answers yet.
  (doc) => ({ ...doc, v: 2, sources: [], onboarding: noAnswers() }),
  // 2 → 3 (step 20c1): nothing kept for the player yet.
  (doc) => ({ ...doc, v: 3, player: noPlayerMemory() }),
  // 3 → 4 (step 22b): each source's guide link moves to the guide list.
  (doc) => ({ ...doc, ...guidesFromSources(doc.sources), v: 4 }),
  // 4 → 5 (step 26d): no movie left part way yet.
  (doc) => ({ ...doc, v: 5, progress: {} }),
  // 5 → 6 (step 27c1): no show's episode played yet.
  (doc) => ({ ...doc, v: 6, shows: {} }),
  // 6 → 7 (step 28b2): the channel played last, when there is one, is the first channel played last.
  (doc) => ({ ...doc, v: 7, channels: lastOf(doc.player) }),
  // 7 → 8 (step 31d2b1): no file from the phone yet. Only the version: an older app must not read
  // a file source as a link with no URL, and never saves over a newer document.
  (doc) => ({ ...doc, v: 8 }),
];

export const PROFILE_VERSION = PROFILE_MIGRATIONS.length + 1;

/** Snapshot slots kept for rollback. */
export const SNAPSHOT_SLOTS = 3;
/** A save snapshots the previous document when the newest snapshot is older than this. */
export const SNAPSHOT_EVERY_MS = 24 * 60 * 60 * 1000;

export type SnapshotReason = 'daily' | 'migration' | 'restore';

interface ProfileRecord {
  id: string;
  savedAt: number;
  doc: AnyProfile;
}

export interface ProfileSnapshot extends ProfileRecord {
  reason: SnapshotReason;
}

const CURRENT = 'current';
const SNAPSHOTS = (): IDBKeyRange => IDBKeyRange.bound('snap:', 'snap:~');

function noAnswers(): OnboardingAnswers {
  return { language: null, disclaimerAt: null, consent: null };
}

export function noPlayerMemory(): PlayerMemoryDoc {
  return { last: null, containers: {}, redirects: {}, tracks: {}, subtitleSize: null };
}

export function emptyProfile(): ProfileDoc {
  return { v: 8, favourites: [], sources: [], onboarding: noAnswers(), player: noPlayerMemory(), guides: [], progress: {}, shows: {}, channels: [] };
}

/** Version 6's last channel as the list of channels played last: itself, or none (step 28b2). */
function lastOf(player: unknown): unknown[] {
  const last = typeof player === 'object' && player !== null ? (player as { last?: unknown }).last : undefined;
  return typeof last === 'object' && last !== null ? [last] : [];
}

/**
 * Version 3's sources without their `epgUrl`, and the links as guides, in source order. Each guide
 * keeps its source's id, so its stored records (`u~<id>`) stay and nothing is downloaded again. A
 * link two sources share is listed once, under the first (the one the refresh kept). Sources that
 * aren't a list are left as they are (never dropped).
 */
function guidesFromSources(stored: unknown): { sources?: unknown[]; guides: UserGuide[] } {
  const guides: UserGuide[] = [];
  if (!Array.isArray(stored)) return { guides };
  const sources = stored.map((source: unknown) => {
    if (typeof source !== 'object' || source === null) return source;
    // Copied field by field: an object rest would bring Babel's helper into the TV workers.
    const record = source as Record<string, unknown>;
    const rest: Record<string, unknown> = {};
    for (const field of Object.keys(record)) if (field !== 'epgUrl') rest[field] = record[field];
    const { id, epgUrl } = record;
    if (typeof epgUrl === 'string' && epgUrl !== '' && typeof id === 'string' && !guides.some((g) => g.url === epgUrl)) guides.push({ id, url: epgUrl });
    return rest;
  });
  return { sources, guides };
}

/** One thing the player keeps (step 20c1). */
export type PlayerChange =
  | { field: 'last'; last: LastChannel }
  | { field: 'container'; src: string; container: string }
  | { field: 'redirect'; src: string; mode: 'none' | 'redirects' }
  | { field: 'track'; key: ContentKey; choice: StoredTrackChoice }
  | { field: 'subtitleSize'; size: string }
  | { field: 'picture'; mode: string };

/** A change to the user's guide list (step 22b). */
export type GuideChange =
  /** Adds the guide at the end; an id or a link already listed changes nothing. */
  | { op: 'add'; guide: UserGuide }
  | { op: 'remove'; id: string }
  /** Moves the guide to place `to` in the list (clamped to it). */
  | { op: 'move'; id: string; to: number };

/** A change the app makes to the profile through the query worker (step 13b). */
export type ProfileEdit =
  | { kind: 'answers'; answers: Partial<OnboardingAnswers> }
  /** Adds the source, or replaces the one with its id (in place). */
  | { kind: 'source'; source: SourceRecord }
  /** One thing the player keeps (step 20c1). */
  | { kind: 'player'; change: PlayerChange }
  /** The user's guide list (step 22b). */
  | { kind: 'guide'; change: GuideChange }
  /** A guide's time offset in minutes (step 24b): 0 takes it away; one that isn't an offset changes nothing. */
  | { kind: 'epgOffset'; epgSrc: string; minutes: number }
  /**
   * A live channel's manual EPG mapping (step 24d): a guide's XMLTV channel, or no guide
   * (`channel: null`, whatever `epgSrc` says); `null` takes it away (the guides match it again).
   * One that isn't a mapping changes nothing.
   */
  | { kind: 'epgOverride'; key: ContentKey; pin: EpgPin | null }
  /**
   * Where a movie was left (step 26d); `null` takes it away (watched, or started over). One that
   * isn't a position changes nothing.
   */
  | { kind: 'progress'; key: ContentKey; progress: WatchProgress | null }
  /**
   * An episode of `show` played (step 27c1): the show's last episode (`last`), and that episode's
   * place in `progress` (`null` takes it away), in one write. One that isn't both changes nothing.
   */
  | { kind: 'episode'; show: ContentKey; last: ShowProgress; progress: WatchProgress | null }
  /** A config notice was shown (step 30c2a): its rule id joins `noticesShown`. One that isn't a rule id, or is there already, changes nothing. */
  | { kind: 'notice'; id: string };

const USER_GUIDE = 'u~';

/** `offsets` with `epgSrc`'s offset set to `minutes` (0: taken out), or `null` when it holds that already. */
function withOffset(offsets: Record<string, number> | undefined, epgSrc: string, minutes: number): Record<string, number> | null {
  // (Guide ids hold `:` or `~`: never a name an object inherits.)
  const before = offsets === undefined ? 0 : (offsets[epgSrc] ?? 0);
  if (before === minutes) return null;
  const next: Record<string, number> = { ...offsets };
  if (minutes === 0) delete next[epgSrc];
  else next[epgSrc] = minutes;
  return next;
}

/** `overrides` with `key`'s mapping set to `pin` (`null`: taken out), or `null` when it holds that already. */
function withPin(overrides: Record<string, EpgPin> | undefined, key: ContentKey, pin: EpgPin | null): Record<string, EpgPin> | null {
  // (ContentKeys hold `:`: never a name an object inherits.)
  const before = overrides === undefined ? undefined : overrides[key];
  if (before === undefined ? pin === null : pin !== null && before.epgSrc === pin.epgSrc && before.channel === pin.channel) return null;
  const next: Record<string, EpgPin> = { ...overrides };
  if (pin === null) delete next[key];
  else next[key] = { epgSrc: pin.epgSrc, channel: pin.channel };
  return next;
}

/** `overrides` without the mappings into guide `epgSrc`, or `null` when it has none. */
function withoutGuide(overrides: Record<string, EpgPin> | undefined, epgSrc: string): Record<string, EpgPin> | null {
  if (overrides === undefined) return null;
  let next: Record<string, EpgPin> | null = null;
  const keys = Object.keys(overrides);
  for (let i = 0; i < keys.length; i += 1) {
    const pin = overrides[keys[i]!]!;
    // (A mapping to no guide names none: `epgSrc` is ''.)
    if (pin.epgSrc !== epgSrc) continue;
    if (next === null) next = { ...overrides };
    delete next[keys[i]!];
  }
  return next;
}

/** The guide list with `change` applied (a new array), or `null` when it changes nothing. */
function applyGuideChange(guides: readonly UserGuide[], change: GuideChange): UserGuide[] | null {
  let at = -1;
  for (let i = 0; i < guides.length; i += 1) if (guides[i]!.id === (change.op === 'add' ? change.guide.id : change.id)) at = i;
  if (change.op === 'add') {
    if (at !== -1 || guides.some((g) => g.url === change.guide.url)) return null;
    return guides.concat([change.guide]);
  }
  if (at === -1) return null;
  const next = guides.slice();
  const guide = next.splice(at, 1)[0]!;
  if (change.op === 'remove') return next;
  const to = Math.max(0, Math.min(next.length, Math.floor(change.to)));
  if (to === at) return null;
  next.splice(to, 0, guide);
  return next;
}

/** `record` with `key` set to `value` (a new object), or `null` when it holds that already. */
function withEntry<T>(record: Record<string, T>, key: string, value: T): Record<string, T> | null {
  if (record[key] === value) return null;
  const next: Record<string, T> = { ...record };
  next[key] = value;
  return next;
}

/** `tracks` with `key`'s choice set, dropping the one changed longest ago past `MAX_TRACK_CHOICES`. */
function withTrack(tracks: Record<string, StoredTrackChoice>, key: string, choice: StoredTrackChoice): Record<string, StoredTrackChoice> {
  const next: Record<string, StoredTrackChoice> = { ...tracks };
  next[key] = choice;
  const keys = Object.keys(next);
  if (keys.length <= MAX_TRACK_CHOICES) return next;
  let oldest: string | null = null;
  for (const k of keys) if (k !== key && (oldest === null || next[k]!.used < next[oldest]!.used)) oldest = k;
  if (oldest !== null) delete next[oldest];
  return next;
}

/** A position this version keeps: a media time, a length when known, and a save time. */
export function isWatchProgress(value: unknown): value is WatchProgress {
  if (typeof value !== 'object' || value === null) return false;
  const { positionMs, lengthMs, updated } = value as Record<string, unknown>;
  return typeof positionMs === 'number' && positionMs >= 0 && isFinite(positionMs) && typeof updated === 'number' && isFinite(updated) && (lengthMs === null || (typeof lengthMs === 'number' && lengthMs > 0 && isFinite(lengthMs)));
}

/**
 * A show's last episode this version keeps: an episode's key, whether it was watched, and a save
 * time (step 27c1); whether an episode came after it, when it says (step 27d).
 */
export function isShowProgress(value: unknown): value is ShowProgress {
  if (typeof value !== 'object' || value === null) return false;
  const { episode, watched, more, updated } = value as Record<string, unknown>;
  return typeof episode === 'string' && episode !== '' && typeof watched === 'boolean' && (more === undefined || typeof more === 'boolean') && typeof updated === 'number' && isFinite(updated);
}

/** Drops the entries of `next` saved longest ago, never `key`'s, until it holds `cap` (in place). */
function dropOldest(next: Record<string, { updated: number }>, key: string, cap: number): void {
  const keys = Object.keys(next);
  for (let over = keys.length - cap; over > 0; over -= 1) {
    let oldest: string | null = null;
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i]!;
      if (k !== key && next[k] !== undefined && (oldest === null || next[k]!.updated < next[oldest]!.updated)) oldest = k;
    }
    if (oldest === null) break;
    delete next[oldest];
  }
}

/**
 * `progress` with `key`'s position set (`null`: taken out), dropping the ones saved longest ago
 * past `MAX_PROGRESS`; `null` when it holds that already.
 */
function withProgress(progress: Record<string, WatchProgress>, key: string, entry: WatchProgress | null): Record<string, WatchProgress> | null {
  // (ContentKeys hold `:`: never a name an object inherits.)
  const before = progress[key];
  if (entry === null ? before === undefined : before !== undefined && before.positionMs === entry.positionMs && before.lengthMs === entry.lengthMs) return null;
  const next: Record<string, WatchProgress> = { ...progress };
  if (entry === null) {
    delete next[key];
    return next;
  }
  next[key] = { positionMs: entry.positionMs, lengthMs: entry.lengthMs, updated: entry.updated };
  dropOldest(next, key, MAX_PROGRESS);
  return next;
}

/**
 * `shows` with `show`'s last episode set, dropping the ones saved longest ago past `MAX_SHOWS`;
 * `null` when it holds that episode, watched or not, and what came after it already, unless its
 * save time is to be `renewed` (the episode's place was written: the show was watched then).
 */
function withShow(shows: Record<string, ShowProgress>, show: string, last: ShowProgress, renewed: boolean): Record<string, ShowProgress> | null {
  // (ContentKeys hold `:`: never a name an object inherits.)
  const before = shows[show];
  if (!renewed && before !== undefined && before.episode === last.episode && before.watched === last.watched && before.more === last.more) return null;
  const next: Record<string, ShowProgress> = { ...shows };
  next[show] = last.more === undefined ? { episode: last.episode, watched: last.watched, updated: last.updated } : { episode: last.episode, watched: last.watched, more: last.more, updated: last.updated };
  dropOldest(next, show, MAX_SHOWS);
  return next;
}

/** `channels` with `last` first and its key's entry before taken out, at most `MAX_CHANNELS` (a new array). */
function withChannel(channels: readonly LastChannel[], last: LastChannel): LastChannel[] {
  const next = [last];
  for (let i = 0; i < channels.length && next.length < MAX_CHANNELS; i += 1) if (channels[i]!.item.key !== last.item.key) next.push(channels[i]!);
  return next;
}

/** The player section with `change` applied (new objects), or `null` when it changes nothing. */
function applyPlayerChange(player: PlayerMemoryDoc, change: PlayerChange): PlayerMemoryDoc | null {
  switch (change.field) {
    case 'last':
      return { ...player, last: change.last };
    case 'container': {
      const containers = withEntry(player.containers, change.src, change.container);
      return containers === null ? null : { ...player, containers };
    }
    case 'redirect': {
      const redirects = withEntry(player.redirects, change.src, change.mode);
      return redirects === null ? null : { ...player, redirects };
    }
    case 'track':
      return { ...player, tracks: withTrack(player.tracks, change.key, change.choice) };
    case 'subtitleSize':
      return change.size === player.subtitleSize ? null : { ...player, subtitleSize: change.size };
    case 'picture':
      return change.mode === player.picture ? null : { ...player, picture: change.mode };
  }
}

/** `doc` with `edit` applied (new objects), or `null` when it changes nothing. */
export function applyProfileEdit(doc: ProfileDoc, edit: ProfileEdit): ProfileDoc | null {
  if (edit.kind === 'answers') {
    const onboarding: OnboardingAnswers = { ...doc.onboarding };
    let changed = false;
    for (const field of ['language', 'disclaimerAt', 'consent'] as const) {
      const value = edit.answers[field];
      if (value === undefined || value === onboarding[field]) continue;
      (onboarding as Record<string, unknown>)[field] = value;
      changed = true;
    }
    return changed ? { ...doc, onboarding } : null;
  }
  if (edit.kind === 'player') {
    const player = applyPlayerChange(doc.player, edit.change);
    if (player === null) return null;
    // The channel played last leads the channels played last (step 28b2), in the same write.
    return edit.change.field === 'last' ? { ...doc, player, channels: withChannel(doc.channels, edit.change.last) } : { ...doc, player };
  }
  if (edit.kind === 'guide') {
    const guides = applyGuideChange(doc.guides, edit.change);
    if (guides === null) return null;
    if (edit.change.op !== 'remove') return { ...doc, guides };
    // A removed guide's offset and the mappings into it go with it: its id may be given to a new
    // guide later, and a channel mapped to a guide that is gone would never get one again.
    const next: ProfileDoc = { ...doc, guides };
    const epgSrc = `${USER_GUIDE}${edit.change.id}`;
    const offsets = withOffset(doc.epgOffsets, epgSrc, 0);
    if (offsets !== null) next.epgOffsets = offsets;
    const overrides = withoutGuide(doc.epgOverrides, epgSrc);
    if (overrides !== null) next.epgOverrides = overrides;
    return next;
  }
  if (edit.kind === 'epgOverride') {
    // A mapping to no guide is kept as `{ epgSrc: '', channel: null }`, whichever guide it names.
    const pin = edit.pin === null ? null : edit.pin.channel === null ? { epgSrc: '', channel: null } : edit.pin;
    if (pin !== null && !isEpgPin(pin)) return null;
    const overrides = withPin(doc.epgOverrides, edit.key, pin);
    return overrides === null ? null : { ...doc, epgOverrides: overrides };
  }
  if (edit.kind === 'progress') {
    if (edit.progress !== null && !isWatchProgress(edit.progress)) return null;
    const progress = withProgress(doc.progress, edit.key, edit.progress);
    return progress === null ? null : { ...doc, progress };
  }
  if (edit.kind === 'episode') {
    if ((edit.progress !== null && !isWatchProgress(edit.progress)) || !isShowProgress(edit.last)) return null;
    const progress = withProgress(doc.progress, edit.last.episode, edit.progress);
    const shows = withShow(doc.shows, edit.show, edit.last, progress !== null);
    if (progress === null && shows === null) return null;
    return { ...doc, progress: progress ?? doc.progress, shows: shows ?? doc.shows };
  }
  if (edit.kind === 'notice') {
    const shown = doc.noticesShown ?? [];
    if (!isRuleId(edit.id) || shown.indexOf(edit.id) !== -1) return null;
    // The latest `MAX_NOTICES`: the one shown longest ago goes first.
    const noticesShown = shown.slice(Math.max(0, shown.length - MAX_NOTICES + 1));
    noticesShown.push(edit.id);
    return { ...doc, noticesShown };
  }
  if (edit.kind === 'epgOffset') {
    if (!isEpgOffset(edit.minutes)) return null;
    // (-0 is 0 there: no entry.)
    const offsets = withOffset(doc.epgOffsets, edit.epgSrc, edit.minutes);
    return offsets === null ? null : { ...doc, epgOffsets: offsets };
  }
  const at = doc.sources.findIndex((s) => s.id === edit.source.id);
  const sources = doc.sources.slice();
  if (at === -1) sources.push(edit.source);
  else sources[at] = edit.source;
  return { ...doc, sources };
}

/** Thrown for a stored document that is not a profile, or a migration that fails. */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

function checkVersion(doc: unknown): AnyProfile {
  const v = (doc as AnyProfile | null)?.v;
  if (typeof doc !== 'object' || doc === null || typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    throw new ProfileError('Stored profile has no valid version');
  }
  return doc as AnyProfile;
}

/**
 * Upgrades `doc` to the latest version. Pure: returns new objects, leaves `doc` alone.
 * `migrated` is false when it was already current (or newer: `newer` is then true).
 */
export function migrateProfile(
  doc: unknown,
  migrations: readonly ProfileMigration[] = PROFILE_MIGRATIONS,
): { doc: AnyProfile; from: number; migrated: boolean; newer: boolean } {
  const start = checkVersion(doc);
  const latest = migrations.length + 1;
  if (start.v >= latest) return { doc: start, from: start.v, migrated: false, newer: start.v > latest };
  let out: AnyProfile = JSON.parse(JSON.stringify(start)) as AnyProfile;
  for (let v = start.v; v < latest; v++) {
    out = migrations[v - 1]!(out);
    if (out.v !== v + 1) throw new ProfileError(`Profile migration ${v} → ${v + 1} returned version ${String(out.v)}`);
  }
  return { doc: out, from: start.v, migrated: true, newer: false };
}

/** Picks the slot to write: an empty one, else the oldest snapshot (never `keep`). */
function snapshotSlot(snapshots: ProfileSnapshot[], keep?: string): string {
  for (let i = 0; i < SNAPSHOT_SLOTS; i++) {
    const id = `snap:${i}`;
    if (id !== keep && !snapshots.some((s) => s.id === id)) return id;
  }
  let oldest: ProfileSnapshot | null = null;
  for (const s of snapshots) if (s.id !== keep && (!oldest || s.savedAt < oldest.savedAt)) oldest = s;
  return oldest!.id;
}

export interface LoadedProfile {
  doc: AnyProfile;
  /** The document came from a newer app version: show it, but never save over it. */
  newer: boolean;
  /** The stored document was upgraded (and the old one snapshotted) by this load. */
  migratedFrom: number | null;
}

export interface ProfileOptions {
  now?: number;
  migrations?: readonly ProfileMigration[];
}

/**
 * Loads the current profile, upgrading it in place if it is older than this app version (the old
 * document goes to a snapshot slot in the same transaction). `null` when there is none: a fresh
 * install, or a webOS wipe (step 32 restores it from the cloud).
 */
export function loadProfile(db: IDBDatabase, options: ProfileOptions = {}): Promise<LoadedProfile | null> {
  const now = options.now ?? Date.now();
  return transact<LoadedProfile | null>(db, STORE.profile, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.profile);
    onSuccess(store.get(CURRENT), (value) => {
      const record = value as ProfileRecord | undefined;
      if (!record) {
        done(null);
        return;
      }
      const result = migrateProfile(record.doc, options.migrations);
      done({ doc: result.doc, newer: result.newer, migratedFrom: result.migrated ? result.from : null });
      if (!result.migrated) return;
      onSuccess(store.getAll(SNAPSHOTS()), (snaps) => {
        const snapshot: ProfileSnapshot = { id: snapshotSlot(snaps as ProfileSnapshot[]), savedAt: now, doc: record.doc, reason: 'migration' };
        store.put(snapshot);
        store.put({ id: CURRENT, savedAt: now, doc: result.doc } satisfies ProfileRecord);
      });
    });
  });
}

/**
 * Saves `doc` as the current profile. When the newest snapshot is older than a day (or there is
 * none), the document being replaced is snapshotted first, in the same transaction.
 */
export function saveProfile(db: IDBDatabase, doc: ProfileDoc, options: { now?: number; snapshotEveryMs?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  const every = options.snapshotEveryMs ?? SNAPSHOT_EVERY_MS;
  checkVersion(doc);
  if (doc.v !== PROFILE_VERSION) throw new ProfileError(`Can't save a version ${doc.v} profile (this app writes ${PROFILE_VERSION})`);
  return transact<void>(db, STORE.profile, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.profile);
    onSuccess(store.get(CURRENT), (value) => {
      const previous = value as ProfileRecord | undefined;
      if (previous && checkVersion(previous.doc).v > PROFILE_VERSION) {
        throw new ProfileError('The stored profile is from a newer app version');
      }
      writeCurrent(store, previous, doc, now, every, 'daily');
    });
  });
}

/**
 * Puts `doc` as the current profile inside a running transaction. The replaced document is
 * snapshotted first when the newest snapshot is older than `every` (always for a migration).
 */
function writeCurrent(store: IDBObjectStore, previous: ProfileRecord | undefined, doc: AnyProfile, now: number, every: number, reason: 'daily' | 'migration'): void {
  onSuccess(store.getAll(SNAPSHOTS()), (value) => {
    const snaps = value as ProfileSnapshot[];
    const newest = snaps.reduce((m, s) => Math.max(m, s.savedAt), -Infinity);
    if (previous && (reason === 'migration' || now - newest >= every)) {
      store.put({ id: snapshotSlot(snaps), savedAt: now, doc: previous.doc, reason } satisfies ProfileSnapshot);
    }
    store.put({ id: CURRENT, savedAt: now, doc } satisfies ProfileRecord);
  });
}

/**
 * Read-modify-write of the current profile in one transaction, so an edit saved by the UI in
 * the meantime is never lost (the ingest worker's favourites update uses it). `update` gets the
 * stored document upgraded to this version and returns the new one, or `null` to leave it; it
 * runs inside the transaction, so it must be synchronous. Snapshots like `saveProfile`.
 * Resolves `true` if it wrote. Nothing is written when the stored document comes from a newer app
 * version, or when there is none, unless `create` is set: `update` then gets `emptyProfile()`
 * (onboarding's first answers create the profile; a refresh never does).
 */
export function updateProfile(
  db: IDBDatabase,
  update: (doc: ProfileDoc) => ProfileDoc | null,
  options: ProfileOptions & { snapshotEveryMs?: number; create?: boolean } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const every = options.snapshotEveryMs ?? SNAPSHOT_EVERY_MS;
  return transact<boolean>(db, STORE.profile, 'readwrite', (tx, done) => {
    const store = tx.objectStore(STORE.profile);
    done(false);
    onSuccess(store.get(CURRENT), (value) => {
      const record = value as ProfileRecord | undefined;
      if (!record && !options.create) return;
      const migrated = record ? migrateProfile(record.doc, options.migrations) : { doc: emptyProfile(), migrated: false, newer: false };
      if (migrated.newer) return;
      const next = update(migrated.doc as ProfileDoc);
      if (next === null) return;
      const latest = (options.migrations ?? PROFILE_MIGRATIONS).length + 1;
      if (checkVersion(next).v !== latest) throw new ProfileError(`Can't save a version ${next.v} profile (this app writes ${latest})`);
      writeCurrent(store, record, next, now, every, migrated.migrated ? 'migration' : 'daily');
      done(true);
    });
  });
}

/**
 * The stored current document as it is (not upgraded, nothing written), or `undefined` when there
 * is none (step 32c1: the backup reads it to send it, and a restore never writes over one).
 */
export function storedProfileDoc(db: IDBDatabase): Promise<unknown> {
  return transact<unknown>(db, STORE.profile, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.profile).get(CURRENT), (value) => {
      const record = value as ProfileRecord | undefined;
      done(record === undefined ? undefined : record.doc);
    });
  });
}

/**
 * Puts `doc` as the current profile in a running transaction over the profile store, only when
 * there is none (a restore, step 32c1); `then` says whether it was put. A profile there already
 * is left as it is.
 */
export function putProfileIfNone(store: IDBObjectStore, doc: AnyProfile, now: number, then: (put: boolean) => void): void {
  onSuccess(store.get(CURRENT), (value) => {
    if (value !== undefined) {
      then(false);
      return;
    }
    store.put({ id: CURRENT, savedAt: now, doc } satisfies ProfileRecord);
    then(true);
  });
}

/**
 * Whether a typed backup code's restore may write over `stored`, the stored current document as it
 * is (step 32d3b): none (`undefined`), or one from this app version or an older one with no source
 * yet (onboarding's answers). A document that can't be read, or one from a newer app, is never
 * written over.
 */
export function codeRestoreMayWrite(stored: unknown): boolean {
  if (stored === undefined) return true;
  if (typeof stored !== 'object' || stored === null) return false;
  const { v, sources } = stored as { v?: unknown; sources?: unknown };
  return typeof v === 'number' && v <= PROFILE_VERSION && !(Array.isArray(sources) && sources.length > 0);
}

/**
 * Puts `doc` as the current profile in a running transaction over the profile store where
 * `codeRestoreMayWrite` allows it (a typed backup code's restore, step 32d3b), with no snapshot:
 * onboarding's answers, all a sourceless profile holds, come back with the backup. `then` says
 * whether it was put.
 */
export function putProfileFromCode(store: IDBObjectStore, doc: AnyProfile, now: number, then: (put: boolean) => void): void {
  onSuccess(store.get(CURRENT), (value) => {
    const record = value as ProfileRecord | undefined;
    if (!codeRestoreMayWrite(record === undefined ? undefined : record.doc)) {
      then(false);
      return;
    }
    store.put({ id: CURRENT, savedAt: now, doc } satisfies ProfileRecord);
    then(true);
  });
}

/**
 * Puts `doc` as the current profile in a running transaction over the profile store, over the one
 * there (a held backup restored from Settings, step 32d2a): the document it replaces goes to a
 * snapshot slot first (`restore`). `then` says whether it was put: a document from a newer app
 * version is never written over.
 */
export function putProfileOver(store: IDBObjectStore, doc: AnyProfile, now: number, then: (put: boolean) => void): void {
  onSuccess(store.get(CURRENT), (value) => {
    const previous = value as ProfileRecord | undefined;
    // (A broken document, with no version, is written over: it is kept in the snapshot.)
    const old: unknown = previous === undefined ? null : previous.doc;
    const v = typeof old === 'object' && old !== null ? (old as { v?: unknown }).v : null;
    if (typeof v === 'number' && v > PROFILE_VERSION) {
      then(false);
      return;
    }
    onSuccess(store.getAll(SNAPSHOTS()), (snaps) => {
      if (previous !== undefined) store.put({ id: snapshotSlot(snaps as ProfileSnapshot[]), savedAt: now, doc: previous.doc, reason: 'restore' } satisfies ProfileSnapshot);
      store.put({ id: CURRENT, savedAt: now, doc } satisfies ProfileRecord);
      then(true);
    });
  });
}

/**
 * The guides' time offsets in the current profile (step 24b; `epgOffsetsOf`), read without
 * upgrading or writing it: `{}` when there is no profile. The query worker reads them at each
 * reload.
 */
export function readEpgOffsets(db: IDBDatabase): Promise<Record<string, number>> {
  return transact<Record<string, number>>(db, STORE.profile, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.profile).get(CURRENT), (value) => {
      const record = value as ProfileRecord | undefined;
      done(epgOffsetsOf(record === undefined ? null : record.doc));
    });
  });
}

/**
 * The user's manual EPG mappings in the current profile (step 24d; `epgOverridesOf`), read without
 * upgrading or writing it: `[]` when there is no profile. The EPG worker reads them at each
 * refresh, the query worker at each reload.
 */
export function readEpgOverrides(db: IDBDatabase): Promise<EpgOverride[]> {
  return transact<EpgOverride[]>(db, STORE.profile, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.profile).get(CURRENT), (value) => {
      const record = value as ProfileRecord | undefined;
      done(epgOverridesOf(record === undefined ? null : record.doc));
    });
  });
}

/** The snapshots, newest first. */
export function listSnapshots(db: IDBDatabase): Promise<ProfileSnapshot[]> {
  return transact<ProfileSnapshot[]>(db, STORE.profile, 'readonly', (tx, done) => {
    onSuccess(tx.objectStore(STORE.profile).getAll(SNAPSHOTS()), (snaps) => {
      done((snaps as ProfileSnapshot[]).sort((a, b) => b.savedAt - a.savedAt));
    });
  });
}

/**
 * Makes snapshot `id` the current profile (rollback). The document it replaces is snapshotted
 * into the oldest other slot, so a rollback can itself be undone.
 */
export function restoreSnapshot(db: IDBDatabase, id: string, options: { now?: number } = {}): Promise<void> {
  const now = options.now ?? Date.now();
  return transact<void>(db, STORE.profile, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE.profile);
    onSuccess(store.getAll(SNAPSHOTS()), (value) => {
      const snaps = value as ProfileSnapshot[];
      const chosen = snaps.find((s) => s.id === id);
      if (!chosen) throw new ProfileError(`No profile snapshot ${id}`);
      onSuccess(store.get(CURRENT), (cur) => {
        const current = cur as ProfileRecord | undefined;
        if (current) {
          store.put({ id: snapshotSlot(snaps, id), savedAt: now, doc: current.doc, reason: 'restore' } satisfies ProfileSnapshot);
        }
        store.put({ id: CURRENT, savedAt: now, doc: chosen.doc } satisfies ProfileRecord);
      });
    });
  });
}
