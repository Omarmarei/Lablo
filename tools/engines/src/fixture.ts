/**
 * The catalog the data workers ingest in each engine (RELAY step 8b, the data layer's part of
 * spike S1). The harness writes a deterministic playlist next to the staged apps, and
 * `serve-fixture.sh` serves it inside the container on 127.0.0.1:8090. Each app run is opened
 * with `?force=1&q=<query>&source=<playlist URL>`, so the hello screen's catalog panel:
 * 1. prunes at start and starts the query worker (both Blob workers, IndexedDB in each);
 * 2. refreshes the playlist in a fresh ingest worker: streamed fetch, gunzip, parse, 500-item
 *    chunks, generation swap (`force` makes every run commit, whatever an earlier run stored);
 * 3. makes the query worker reload, then searches it.
 *
 * tizen runs ingest the plain playlist and search a Latin word; webos runs ingest the gzipped
 * one (fflate, since DecompressionStream needs Chromium 80) and search an Arabic word whose
 * hamza only matches through normalization. Each engine runs both apps, so each engine gets both.
 *
 * Generated playlists only: nothing here is shipped, and nothing points at a real provider.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
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
}

/** What one app run must show after its refresh and search. */
export interface DataCheck {
  /** Playlist file under FIXTURE_ORIGIN. */
  readonly file: string;
  readonly query: string;
  /** Items the refresh must commit. */
  readonly items: number;
  /** Hits the search must count. */
  readonly total: number;
  /** The download is gzip, so the ingest worker gunzips it. */
  readonly gzip: boolean;
}

export const FIXTURE_SIZE = 3000;
const LIVE_SHARE = 0.8;
const ARABIC_NEWS = 'أخبار';

/**
 * 3,000 entries: 2,400 live channels then 600 movies. Every 10th channel is Arabic news
 * (`أخبار زوما n`), every other 7th is Latin news (`Zoma News n`), the rest `Zoma Channel n`.
 */
export function fixtureEntries(count = FIXTURE_SIZE): FixtureEntry[] {
  const entries: FixtureEntry[] = [];
  const live = Math.floor(count * LIVE_SHARE);
  for (let i = 1; i <= count; i++) {
    if (i > live) {
      entries.push({ name: `Zoma Film ${i}`, group: 'Films', kind: 'movie', url: `${FIXTURE_ORIGIN}/movie/u/p/${i}.mp4` });
    } else if (i % 10 === 0) {
      entries.push({ name: `${ARABIC_NEWS} زوما ${i}`, group: ARABIC_NEWS, kind: 'live', url: `${FIXTURE_ORIGIN}/live/u/p/${i}.ts` });
    } else if (i % 7 === 0) {
      entries.push({ name: `Zoma News ${i}`, group: 'News', kind: 'live', url: `${FIXTURE_ORIGIN}/live/u/p/${i}.ts` });
    } else {
      entries.push({ name: `Zoma Channel ${i}`, group: `Group ${i % 12}`, kind: 'live', url: `${FIXTURE_ORIGIN}/live/u/p/${i}.ts` });
    }
  }
  return entries;
}

export function fixtureM3u(entries: readonly FixtureEntry[]): string {
  const lines = ['#EXTM3U'];
  entries.forEach((entry, i) => {
    lines.push(`#EXTINF:-1 tvg-id="fixture.${i + 1}" group-title="${entry.group}",${entry.name}`, entry.url);
  });
  return `${lines.join('\n')}\n`;
}

/** The expected results, counted from the entries (test/engines-fixture.test.ts cross-checks them with core). */
export function dataChecks(entries: readonly FixtureEntry[]): Record<TvPlatform, DataCheck> {
  return {
    tizen: { file: 'playlist.m3u', query: 'news', items: entries.length, total: entries.filter((e) => e.name.startsWith('Zoma News ')).length, gzip: false },
    // The bare alef in the query matches the hamza form (أ) in the names only after normalization.
    webos: { file: 'playlist.m3u.gz', query: 'اخبار', items: entries.length, total: entries.filter((e) => e.name.startsWith(ARABIC_NEWS)).length, gzip: true },
  };
}

/** Writes both playlists to `<root>/fixtures` and returns what each platform's run must show. */
export function stageFixtures(root: string): Record<TvPlatform, DataCheck> {
  const entries = fixtureEntries();
  const m3u = Buffer.from(fixtureM3u(entries), 'utf8');
  const dir = path.join(root, FIXTURE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'playlist.m3u'), m3u);
  writeFileSync(path.join(dir, 'playlist.m3u.gz'), gzipSync(m3u));
  return dataChecks(entries);
}

/** The app URL for one run: the catalog parameters, with `source` last (apps/tv/src/data/params.ts). */
export function appUrl(variant: string, platform: TvPlatform, check: DataCheck): string {
  const source = `${FIXTURE_ORIGIN}/${check.file}`;
  return `file:///app/${variant}/${platform}/index.html?force=1&q=${encodeURIComponent(check.query)}&source=${encodeURIComponent(source)}`;
}
