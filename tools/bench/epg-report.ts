// `pnpm epg:report --playlist <m3u> --xmltv <guide> [--xmltv <guide2>...] [--tier full|low]
//   [--now <ISO time>] [--languages ar,en] [--unmatched 20] [--json <file>]`
//
// The EPG match-rate report (architecture.md §1.5 step 4) for a playlist and one or more guides,
// read exactly as the TV reads them (core's EpgGuideReader): how many live channels each guide
// matches and by which method, the unmatched channels, what the window and filter dropped, and
// how long it took. Files or http(s) URLs; gzip is detected by its magic bytes. Several guides
// are combined in the order given (the stronger method wins, then the earlier guide).
// Nothing is stored. Never point it at a provider you don't own an account with.

import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { parseArgs } from 'node:util';
import { createGunzip } from 'node:zlib';
import type { CatalogItem, DeviceTier, EpgChannelMatch, EpgSourceReport } from '@lablo/core';
import { EpgGuideReader, EpgWantedSet, M3uCatalogParser, combineEpgMatches, formatEpgReport } from '@lablo/core';

const { values } = parseArgs({
  options: {
    playlist: { type: 'string' },
    xmltv: { type: 'string', multiple: true },
    tier: { type: 'string', default: 'full' },
    now: { type: 'string' },
    languages: { type: 'string', default: 'ar,en' },
    unmatched: { type: 'string', default: '20' },
    json: { type: 'string' },
  },
});

/** The bytes of a file or URL, gunzipped when they start with 1f 8b. */
async function* source(location: string): AsyncGenerator<Uint8Array> {
  let raw: AsyncIterable<Uint8Array>;
  if (/^https?:\/\//i.test(location)) {
    const response = await fetch(location);
    if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
    raw = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  } else {
    raw = createReadStream(resolve(location));
  }
  const iterator = raw[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;
  const rest = (async function* (): AsyncGenerator<Uint8Array> {
    yield first.value;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
  })();
  if (first.value[0] === 0x1f && first.value[1] === 0x8b) yield* Readable.from(rest).pipe(createGunzip());
  else yield* rest;
}

async function liveChannels(location: string): Promise<CatalogItem[]> {
  const decoder = new TextDecoder();
  const parser = new M3uCatalogParser('report');
  const live: CatalogItem[] = [];
  const keep = (items: CatalogItem[]): void => {
    for (const item of items) if (item.kind === 'live') live.push(item);
  };
  for await (const chunk of source(location)) keep(parser.push(decoder.decode(chunk, { stream: true })));
  keep(parser.push(decoder.decode()));
  keep(parser.end());
  return live;
}

async function readGuide(location: string, epgSrc: string, wanted: EpgWantedSet, tier: DeviceTier, nowMs: number, languages: string[]): Promise<EpgSourceReport & { matches: EpgChannelMatch[] }> {
  const decoder = new TextDecoder();
  const reader = new EpgGuideReader({ epgSrc, wanted, tier, nowMs, languages });
  for await (const chunk of source(location)) reader.push(decoder.decode(chunk, { stream: true }));
  reader.push(decoder.decode());
  reader.end();
  return { ...reader.report(), matches: reader.matcher.matches() };
}

if (!values.playlist || !values.xmltv || values.xmltv.length === 0) {
  console.error('usage: pnpm epg:report --playlist <m3u file or URL> --xmltv <guide file or URL> [--xmltv ...] [--tier full|low] [--now <ISO>] [--json <file>]');
  process.exit(2);
}
const tier: DeviceTier = values.tier === 'low' ? 'low' : 'full';
const nowMs = values.now ? Date.parse(values.now) : Date.now();
if (Number.isNaN(nowMs)) throw new Error(`--now: not a time: ${values.now}`);
const languages = values.languages.split(',').filter((l) => l.length > 0);

const t0 = performance.now();
const live = await liveChannels(values.playlist);
const wanted = EpgWantedSet.fromItems(live);
const tPlaylist = performance.now();
console.log(`playlist: ${live.length} live channels (${(tPlaylist - t0).toFixed(0)} ms)`);

const reports: (EpgSourceReport & { ms: number })[] = [];
const guides: { epgSrc: string; matches: EpgChannelMatch[] }[] = [];
let heapPeak = 0;
const timer = setInterval(() => (heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed)), 20);
for (const [i, location] of values.xmltv.entries()) {
  const started = performance.now();
  const { matches, ...report } = await readGuide(location, `guide${i + 1}`, wanted, tier, nowMs, languages);
  const ms = performance.now() - started;
  reports.push({ ...report, ms });
  guides.push({ epgSrc: report.epgSrc, matches });
  console.log(`${formatEpgReport(report, { unmatched: Number(values.unmatched) })}\n  read in ${ms.toFixed(0)} ms`);
}
clearInterval(timer);
const combined = combineEpgMatches(guides);
if (reports.length > 1) {
  const n = wanted.size;
  console.log(`all guides: ${combined.size} of ${n} live channels matched (${n > 0 ? ((100 * combined.size) / n).toFixed(1) : '-'}%)`);
}
console.log(`heap peak ${(heapPeak / 1e6).toFixed(0)} MB, total ${(performance.now() - t0).toFixed(0)} ms`);
if (values.json) {
  mkdirSync(dirname(resolve(values.json)), { recursive: true });
  writeFileSync(values.json, `${JSON.stringify({ tier, nowMs, live: live.length, matched: combined.size, guides: reports }, null, 2)}\n`);
}
