/**
 * The catalog the data workers ingest in each engine (RELAY step 8b, the data layer's part of
 * spike S1). The harness writes a deterministic playlist next to the staged apps, and
 * `serve-fixture.sh` serves it inside the container on 127.0.0.1:8090. Each app run is opened
 * with `?screen=hello&force=1&q=<query>&source=<playlist URL>` (the hello screen is a developer
 * screen since step 13a, when onboarding became the start screen), so its catalog panel:
 * 1. prunes at start and starts the query worker (both Blob workers, IndexedDB in each);
 * 2. refreshes the playlist in a fresh ingest worker: streamed fetch, gunzip, parse, 500-item
 *    chunks, generation swap (`force` makes every run commit, whatever an earlier run stored);
 * 3. makes the query worker reload, then searches it;
 * 4. refreshes the guide the playlist header names (`url-tvg`) in a fresh EPG worker (step 9b):
 *    every 8th live channel has hourly programmes from a day before the harness started to 3
 *    days after, so the panel shows an exact match count and a now/next read back from
 *    IndexedDB (typed-array columns written and read in the old engine).
 *
 * tizen runs ingest the plain playlist and search a Latin word; webos runs ingest the gzipped
 * one (fflate, since DecompressionStream needs Chromium 80) and search an Arabic word whose
 * hamza only matches through normalization. Each engine runs both apps, so each engine gets both.
 *
 * tizen runs read the plain guide, webos runs the gzipped one.
 *
 * Generated playlists and guides only: nothing here is shipped, and nothing points at a real
 * provider.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Rgb } from './poster';
import { posterPng } from './poster';
import type { TvPlatform } from './scenario';

/** Where serve-fixture.sh answers inside the container (started by run-chrome.sh). */
export const FIXTURE_ORIGIN = 'http://127.0.0.1:8090';
/** The fixtures' folder next to the staged variants (mounted at /app/fixtures). */
export const FIXTURE_DIR = 'fixtures';

export interface FixtureEntry {
  readonly name: string;
  readonly group: string;
  readonly kind: 'live' | 'movie';
  readonly url: string;
  /** A movie's poster (`tvg-logo`; none: the movie has no logo). */
  readonly poster?: string;
}

/** What one app run must show after its refresh and search. */
export interface DataCheck {
  /** Playlist file under FIXTURE_ORIGIN. */
  readonly file: string;
  readonly query: string;
  /** Items the refresh must commit. */
  readonly items: number;
  /** Of those, live channels and films (onboarding's done screen counts them, step 13c). */
  readonly live: number;
  readonly movies: number;
  /** Hits the search must count. */
  readonly total: number;
  /** The download is gzip, so the ingest worker gunzips it. */
  readonly gzip: boolean;
  /** Guide file under FIXTURE_ORIGIN that the playlist header names. */
  readonly guide: string;
  /** Live channels the guide must match, of `wanted`. */
  readonly epgMatched: number;
  readonly epgWanted: number;
}

export const FIXTURE_SIZE = 3000;
const LIVE_SHARE = 0.8;
const ARABIC_NEWS = 'أخبار';

/** The movies' two groups (RELAY step 26b): `Films`, then an Arabic one with Arabic names. */
export const FILMS = 'Films';
export const ARABIC_FILMS = 'أفلام عربية';

/**
 * The poster files staged next to the playlists (`stagePosters`): real PNGs at the grid's tile
 * size, one colour each. Each movie's `tvg-logo` names one with its own query (`?m=<n>`), so
 * every movie has a URL of its own, as a provider's posters do.
 */
export const POSTER_FILES: ReadonlyArray<{ readonly file: string; readonly top: Rgb; readonly bottom: Rgb }> = [
  { file: 'poster-0.png', top: [200, 90, 60], bottom: [60, 30, 20] },
  { file: 'poster-1.png', top: [60, 140, 210], bottom: [20, 40, 80] },
  { file: 'poster-2.png', top: [90, 180, 100], bottom: [20, 60, 30] },
];
/** The poster files' size: the poster tile's (packages/ui `LAYOUT.posterWidth` x `posterHeight`). */
export const POSTER_SIZE = { width: 184, height: 276 } as const;
/** A poster the fixture never stages: its download fails, and its tile shows the title. */
export const MISSING_POSTER = 'poster-missing.png';
/** Of every 50 movies (by their place among the movies, from 1), the 8th's poster fails and the 13th has none. */
const FAILS_AT = 8;
const NONE_AT = 13;

/** Movie `m`'s poster (its place among the movies, from 1), for playlist entry `i`. */
export function moviePoster(m: number, i: number): string | undefined {
  if (m % 50 === NONE_AT) return undefined;
  const file = m % 50 === FAILS_AT ? MISSING_POSTER : POSTER_FILES[m % POSTER_FILES.length]!.file;
  return `${FIXTURE_ORIGIN}/${file}?m=${i}`;
}

/**
 * 3,000 entries: 2,400 live channels then 600 movies. Every 10th channel is Arabic news
 * (`أخبار لابلو n`), every other 7th is Latin news (`Lablo News n`), the rest `Lablo Channel n`.
 * The first 300 movies are `Lablo Film n` in `Films`, the others `فيلم لابلو n` in `أفلام عربية`,
 * each with a poster (`moviePoster`).
 */
export function fixtureEntries(count = FIXTURE_SIZE): FixtureEntry[] {
  const entries: FixtureEntry[] = [];
  const live = Math.floor(count * LIVE_SHARE);
  const films = count - live;
  for (let i = 1; i <= count; i++) {
    if (i > live) {
      const m = i - live;
      const arabic = m > films / 2;
      const poster = moviePoster(m, i);
      entries.push({
        name: arabic ? `فيلم لابلو ${i}` : `Lablo Film ${i}`,
        group: arabic ? ARABIC_FILMS : FILMS,
        kind: 'movie',
        url: `${FIXTURE_ORIGIN}/movie/u/p/${i}.mp4`,
        ...(poster === undefined ? {} : { poster }),
      });
    } else if (i % 10 === 0) {
      entries.push({ name: `${ARABIC_NEWS} لابلو ${i}`, group: ARABIC_NEWS, kind: 'live', url: `${FIXTURE_ORIGIN}/live/u/p/${i}.ts` });
    } else if (i % 7 === 0) {
      entries.push({ name: `Lablo News ${i}`, group: 'News', kind: 'live', url: `${FIXTURE_ORIGIN}/live/u/p/${i}.ts` });
    } else {
      entries.push({ name: `Lablo Channel ${i}`, group: `Group ${i % 12}`, kind: 'live', url: `${FIXTURE_ORIGIN}/live/u/p/${i}.ts` });
    }
  }
  return entries;
}

/** Live channels with programmes in the fixture guide: every 8th, from the first. */
export const hasGuide = (index: number): boolean => index % 8 === 0;

/** Days of catch-up the fixture gives a channel (`catchup="shift"`, RELAY step 25c). */
export const FIXTURE_CATCHUP_DAYS = 7;

/**
 * Live channels with catch-up: every other one with a guide (every 16th), so the guide walk's
 * views mix guided rows with archive marks and without them.
 */
export const hasCatchup = (index: number): boolean => hasGuide(index) && index % 16 === 0;

/** A live channel as the live screen lists it (RELAY step 14c). */
export interface ListedChannel {
  readonly name: string;
  /** Its tvg-id: the guide's channel, and the start of each of its programme titles (`fixture.9 14h`). */
  readonly tvgId: string;
  /** It has programmes in the guide (`hasGuide`). */
  readonly guide: boolean;
  /** Its days of catch-up (`hasCatchup`; 0: none): the guide marks its programmes gone by within them. */
  readonly catchup: number;
}

/** A movie as the movies screen shows it (RELAY step 26b). */
export interface ListedMovie {
  readonly name: string;
  /** Its poster's URL (null: none, the tile shows the title). */
  readonly poster: string | null;
  /** The poster's file is never staged: its download fails, and the tile shows the title. */
  readonly fails: boolean;
}

/** A category of the movies screen's rail. */
export interface ListedFilmCategory {
  readonly name: string;
  readonly movies: readonly ListedMovie[];
}

/** The movies screen's categories: the fixture's movies grouped by `group-title`, in the order they first appear. */
export function movieCategories(entries: readonly FixtureEntry[]): ListedFilmCategory[] {
  const byName = new Map<string, ListedMovie[]>();
  for (const entry of entries) {
    if (entry.kind !== 'movie') continue;
    let movies = byName.get(entry.group);
    if (movies === undefined) {
      movies = [];
      byName.set(entry.group, movies);
    }
    const poster = entry.poster ?? null;
    movies.push({ name: entry.name, poster, fails: poster !== null && poster.indexOf(`/${MISSING_POSTER}?`) !== -1 });
  }
  const categories: ListedFilmCategory[] = [];
  for (const [name, movies] of byName) categories.push({ name, movies });
  return categories;
}

/** A category of the live screen's rail. */
export interface ListedCategory {
  /** The playlist's `group-title`. */
  readonly name: string;
  /** Where its channels start in "All channels": a channel without `tvg-chno` is numbered by its place there. */
  readonly allStart: number;
  readonly channels: readonly ListedChannel[];
}

/**
 * The live screen's categories for the fixture: its live channels grouped by `group-title`, the
 * groups in the order they first appear (the ingest's `catIdx`, packages/data `CatalogChunker`),
 * each in playlist order. "All channels" lists them one category after another.
 */
export function liveCategories(entries: readonly FixtureEntry[]): ListedCategory[] {
  const byName = new Map<string, ListedChannel[]>();
  entries.forEach((entry, i) => {
    if (entry.kind !== 'live') return;
    let channels = byName.get(entry.group);
    if (channels === undefined) {
      channels = [];
      byName.set(entry.group, channels);
    }
    channels.push({ name: entry.name, tvgId: `fixture.${i + 1}`, guide: hasGuide(i), catchup: hasCatchup(i) ? FIXTURE_CATCHUP_DAYS : 0 });
  });
  let at = 0;
  const categories: ListedCategory[] = [];
  for (const [name, channels] of byName) {
    categories.push({ name, allStart: at, channels });
    at += channels.length;
  }
  return categories;
}

export function fixtureM3u(entries: readonly FixtureEntry[], guide: string | null = null): string {
  const lines = [guide === null ? '#EXTM3U' : `#EXTM3U url-tvg="${FIXTURE_ORIGIN}/${guide}"`];
  entries.forEach((entry, i) => {
    const catchup = entry.kind === 'live' && hasCatchup(i) ? ` catchup="shift" catchup-days="${FIXTURE_CATCHUP_DAYS}"` : '';
    const logo = entry.poster === undefined ? '' : ` tvg-logo="${entry.poster}"`;
    lines.push(`#EXTINF:-1 tvg-id="fixture.${i + 1}"${logo}${catchup} group-title="${entry.group}",${entry.name}`, entry.url);
  });
  return `${lines.join('\n')}\n`;
}

const HOUR = 3_600_000;
const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
const xmltvTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}0000 +0000`;
};

/**
 * The guide: one XMLTV channel per live channel with `hasGuide` (by its tvg-id), plus one that
 * feeds nothing, with hourly programmes from a day before `nowMs` to 3 days after. The engine
 * reads it at its own clock, which is the harness machine's.
 */
export function fixtureXmltv(entries: readonly FixtureEntry[], nowMs: number): string {
  const ids: string[] = [];
  entries.forEach((e, i) => {
    if (e.kind === 'live' && hasGuide(i)) ids.push(`fixture.${i + 1}`);
  });
  ids.push('fixture.unused');
  const from = Math.floor(nowMs / HOUR) * HOUR - 24 * HOUR;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Lablo engines fixture">'];
  for (const id of ids) lines.push(`<channel id="${id}"><display-name>${id}</display-name></channel>`);
  for (const id of ids) {
    for (let t = from; t < from + 4 * 24 * HOUR; t += HOUR) {
      lines.push(`<programme start="${xmltvTime(t)}" stop="${xmltvTime(t + HOUR)}" channel="${id}"><title>${id} ${new Date(t).getUTCHours()}h</title></programme>`);
    }
  }
  lines.push('</tv>', '');
  return lines.join('\n');
}

/** The expected results, counted from the entries (test/engines-fixture.test.ts cross-checks them with core). */
export function dataChecks(entries: readonly FixtureEntry[]): Record<TvPlatform, DataCheck> {
  const live = entries.filter((e) => e.kind === 'live').length;
  const movies = entries.filter((e) => e.kind === 'movie').length;
  const matched = entries.filter((e, i) => e.kind === 'live' && hasGuide(i)).length;
  return {
    tizen: {
      file: 'playlist.m3u',
      query: 'news',
      items: entries.length,
      live,
      movies,
      total: entries.filter((e) => e.name.startsWith('Lablo News ')).length,
      gzip: false,
      guide: 'guide.xml',
      epgMatched: matched,
      epgWanted: live,
    },
    // The bare alef in the query matches the hamza form (أ) in the names only after normalization.
    webos: {
      file: 'playlist.m3u.gz',
      query: 'اخبار',
      items: entries.length,
      live,
      movies,
      total: entries.filter((e) => e.name.startsWith(ARABIC_NEWS)).length,
      gzip: true,
      guide: 'guide.xml.gz',
      epgMatched: matched,
      epgWanted: live,
    },
  };
}

/** Writes the poster files (`POSTER_FILES`) to `dir`. */
export function stagePosters(dir: string): void {
  for (const poster of POSTER_FILES) writeFileSync(path.join(dir, poster.file), posterPng(POSTER_SIZE.width, POSTER_SIZE.height, poster.top, poster.bottom));
}

/**
 * Writes both playlists, each naming its guide, both guides and the posters to
 * `<root>/fixtures`, and returns what each platform's run must show.
 */
export function stageFixtures(root: string, nowMs = Date.now()): Record<TvPlatform, DataCheck> {
  const entries = fixtureEntries();
  const checks = dataChecks(entries);
  const dir = path.join(root, FIXTURE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, checks.tizen.file), Buffer.from(fixtureM3u(entries, checks.tizen.guide), 'utf8'));
  writeFileSync(path.join(dir, checks.webos.file), gzipSync(Buffer.from(fixtureM3u(entries, checks.webos.guide), 'utf8')));
  const guide = Buffer.from(fixtureXmltv(entries, nowMs), 'utf8');
  writeFileSync(path.join(dir, checks.tizen.guide), guide);
  writeFileSync(path.join(dir, checks.webos.guide), gzipSync(guide));
  stagePosters(dir);
  return checks;
}

/** The app URL for one run: the catalog parameters, with `source` last (apps/tv/src/data/params.ts). */
export function appUrl(variant: string, platform: TvPlatform, check: DataCheck): string {
  const source = `${FIXTURE_ORIGIN}/${check.file}`;
  return `file:///app/${variant}/${platform}/index.html?screen=hello&force=1&q=${encodeURIComponent(check.query)}&source=${encodeURIComponent(source)}`;
}
