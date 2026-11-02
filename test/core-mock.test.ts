// RELAY step 6 "Done when": core's Xtream client, JSON splitter, XMLTV tokenizer, catch-up URL
// builders and get.php detection, run against the mock provider in-process over a real socket.
// The mock imports nothing from core, so its catalog, EPG schedule and X-Mock-Archive-* headers
// are an independent oracle. This file sits in the root test/ folder because core and the mock
// are separate boundary elements and only root tests may use both.

import { gunzipSync } from 'node:zlib';
import type { CatalogItem, CatchupWindow, TextResponse, TextTransport, XmltvChannel, XmltvProgramme, XtreamListItem, ZoneOffset } from '@zoma/core';
import {
  M3uCatalogParser,
  XmltvTokenizer,
  XtreamClient,
  XtreamError,
  m3uCatchupUrl,
  panelZone,
  parseXmltvTime,
  parseXtreamStreamUrl,
  xtreamCatchupUrl,
  xtreamFromM3uUrl,
  xtreamM3uUrl,
} from '@zoma/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LiveChannel } from '../apps/mock-provider/src/config';
import { loadCatalog, loadServerFixture } from '../apps/mock-provider/src/config';
import { epgWindow, programmes, upcoming } from '../apps/mock-provider/src/epg';
import type { Programme } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, listen, mock } from '../apps/mock-provider/test/helpers';

const catalog = loadCatalog();
const fixture = loadServerFixture();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let app: MockServer;
let base: string;

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});

const account = (username = 'zoma', password = 'zoma-test') => ({ base, username, password });

/** Appends `?mock_fault=` (one request's faults) to a URL. */
function withFault(url: string, fault: string | undefined): string {
  if (fault === undefined) return url;
  return `${url}${url.includes('?') ? '&' : '?'}mock_fault=${encodeURIComponent(fault)}`;
}

/**
 * The transport the data layer will build (step 8), over Node's fetch: streamed body,
 * TextDecoder in stream mode. `fault` is added to every request.
 */
function transport(fault?: string): TextTransport {
  return {
    async get(url: string): Promise<TextResponse> {
      const res = await fetch(withFault(url, fault));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let done = false;
      return {
        status: res.status,
        async read() {
          if (done) return null;
          const r = await reader.read();
          if (r.done) {
            done = true;
            const tail = decoder.decode();
            return tail.length > 0 ? tail : null;
          }
          return decoder.decode(r.value, { stream: true });
        },
        cancel() {
          done = true;
          reader.cancel().catch(() => undefined);
        },
      };
    },
  };
}

async function readAll(res: TextResponse): Promise<string> {
  let text = '';
  for (let chunk = await res.read(); chunk !== null; chunk = await res.read()) text += chunk;
  return text;
}

/** What an archive URL resolved to, from the mock's oracle headers. */
async function archive(url: string, fault?: string): Promise<{ status: number; channel: number; start: number; duration: number }> {
  const res = await fetch(withFault(url, fault));
  await res.body?.cancel();
  return {
    status: res.status,
    channel: Number(res.headers.get('x-mock-archive-channel')),
    start: Number(res.headers.get('x-mock-archive-start')),
    duration: Number(res.headers.get('x-mock-archive-duration')),
  };
}

const channel = (id: number): LiveChannel => catalog.live.find((c) => c.id === id)!;
const categoryName = (list: { id: number; name: string }[], id: number): string => list.find((c) => c.id === id)!.name;

/** A programme of `c` that ended at least an hour before NOW, starting `ago` before NOW or earlier. */
function pastProgramme(c: LiveChannel, ago: number): Programme {
  return programmes(c, NOW - ago, NOW).find((p) => p.stop <= NOW - HOUR)!;
}

const windowOf = (p: Programme): CatchupWindow => ({ startMs: p.start, endMs: p.stop, nowMs: NOW });

async function loadLists(client: XtreamClient): Promise<Record<'live' | 'movie' | 'series', XtreamListItem[]>> {
  const out = { live: [] as XtreamListItem[], movie: [] as XtreamListItem[], series: [] as XtreamListItem[] };
  for (const kind of ['live', 'movie', 'series'] as const) {
    const categories = new Map((await client.categories(kind)).map((c) => [c.id, c.name]));
    await client.list(kind, (items) => void out[kind].push(...items), { categories });
  }
  return out;
}

describe('Xtream client against the mock', () => {
  it('logs in and reads every list exactly as the mock catalog has it', async () => {
    const client = new XtreamClient(account(), transport(), 'mock');
    const login = await client.login();
    expect(login.user).toMatchObject({ auth: true, status: 'Active', maxConnections: 2, isTrial: false, outputFormats: ['m3u8', 'ts'] });
    expect(login.server).toMatchObject({ timezone: 'UTC', timestampNow: NOW / 1000 });
    expect(client.zone()).toMatchObject({ source: 'intl', name: 'UTC' });

    const lists = await loadLists(client);
    expect(lists.live.map((i) => i.item)).toEqual(
      catalog.live.map((c) =>
        expect.objectContaining<Partial<CatalogItem>>({
          key: `x:mock:live:${c.id}`,
          name: c.name,
          group: categoryName(catalog.liveCategories, c.categoryId),
          url: `${base}/live/zoma/zoma-test/${c.id}.ts`,
          epgId: c.epgId,
          chno: c.num,
          catchup: c.archiveDays > 0 ? { mode: 'xc', days: c.archiveDays, source: null } : null,
          radio: c.radio,
        }),
      ),
    );
    expect(lists.live.map((i) => i.adult)).toEqual(catalog.live.map((c) => c.adult));
    expect(lists.movie.map((i) => [i.item.key, i.item.name, i.item.group, i.item.url, i.year, i.rating])).toEqual(
      catalog.movies.map((m) => [`x:mock:movie:${m.id}`, m.name, categoryName(catalog.vodCategories, m.categoryId), `${base}/movie/zoma/zoma-test/${m.id}.${m.ext}`, m.year, m.rating || null]),
    );
    expect(lists.series.map((i) => [i.item.key, i.item.name, i.item.group])).toEqual(
      catalog.series.map((s) => [`x:mock:series:${s.id}`, s.name, categoryName(catalog.seriesCategories, s.categoryId)]),
    );
    // Every URL the client built plays (the mock answers 200 or 206 to a one-byte range).
    for (const item of [lists.live[0]!, lists.movie[0]!]) {
      const res = await fetch(item.item.url, { headers: { range: 'bytes=0-0' } });
      await res.body?.cancel();
      expect([200, 206]).toContain(res.status);
    }
  });

  it('gives identical items, keys and details when the panel flips JSON types (json-quirks)', async () => {
    const plain = new XtreamClient(account(), transport(), 'mock');
    const quirky = new XtreamClient(account(), transport('json-quirks'), 'mock');
    const loginPlain = await plain.login();
    const loginQuirky = await quirky.login();
    expect(loginQuirky.user).toEqual(loginPlain.user);
    expect(await loadLists(quirky)).toEqual(await loadLists(plain));
    for (const id of [301, 302]) expect(await quirky.seriesInfo(id)).toEqual(await plain.seriesInfo(id));
    expect(await quirky.vodInfo(206)).toEqual(await plain.vodInfo(206));
    expect(await quirky.shortEpg(103, 3)).toEqual(await plain.shortEpg(103, 3));
  });

  it('reads details fetched on demand', async () => {
    const client = new XtreamClient(account(), transport(), 'mock');
    expect(await client.vodInfo(202)).toMatchObject({ name: 'Sintel', durationSecs: 888, rating: 7.4, ext: 'mkv' });
    const info = (await client.seriesInfo(301))!;
    const series = catalog.series.find((s) => s.id === 301)!;
    expect(info.seasons.map((s) => s.number)).toEqual(series.seasons.map((s) => s.number));
    expect(info.episodes.map((e) => [e.key, e.season, e.episodeNum, e.title, e.durationSecs])).toEqual(
      series.seasons.flatMap((s) => s.episodes.map((e) => [`x:mock:episode:${e.id}`, s.number, e.episodeNum, e.title, e.durationSecs])),
    );
    const res = await fetch(info.episodes[0]!.url, { headers: { range: 'bytes=0-0' } });
    await res.body?.cancel();
    expect(res.status).toBe(206);
    expect(await client.seriesInfo(999)).toBeNull();
    expect(await client.vodInfo(999)).toBeNull();

    // Short EPG: base64 titles, epoch times, in the mock's own schedule.
    const epg = await client.shortEpg(104, 4);
    expect(epg.map((e) => [e.title, e.startMs, e.endMs])).toEqual(upcoming(channel(104), NOW, 4).map((p) => [p.title, p.start, p.stop]));
  });

  it('reports account states and refusals', async () => {
    const unknown = await new XtreamClient(account('nobody', 'nope'), transport(), 'mock').login().catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(XtreamError);
    expect(unknown).toMatchObject({ code: 'auth', status: null });

    const expired = new XtreamClient(account('expired', 'expired-test'), transport(), 'mock');
    expect((await expired.login()).user).toMatchObject({ auth: true, status: 'Expired' });
    expect((await loadLists(expired)).live).toEqual([]);

    const special = new XtreamClient(account('special+user@zoma.test', 'p@ss/w0rd&?# é'), transport(), 'mock');
    expect((await special.login()).user.status).toBe('Active');

    const busy = await new XtreamClient(account(), transport('status:509'), 'mock').login().catch((e: unknown) => e);
    expect(busy).toMatchObject({ code: 'http', status: 509 });
  });

  it('survives truncated, BOM-prefixed, gzipped and broken-UTF-8 list responses', async () => {
    const count = async (fault: string) => {
      const client = new XtreamClient(account(), transport(fault), 'mock');
      const items: XtreamListItem[] = [];
      const stats = await client.list('movie', (b) => void items.push(...b));
      return { items, stats };
    };
    const full = await count('bom');
    expect(full.items).toHaveLength(catalog.movies.length);
    expect((await count('gzip')).items).toEqual(full.items);
    const broken = await count('invalid-utf8');
    expect(broken.items.map((i) => i.id)).toEqual(full.items.map((i) => i.id));
    const cut = await count('truncate:fraction=0.5');
    expect(cut.stats.json.truncated).toBe(true);
    expect(cut.items.length).toBeGreaterThan(0);
    expect(cut.items.length).toBeLessThan(full.items.length);
    expect(cut.items).toEqual(full.items.slice(0, cut.items.length));
  });
});

describe('catch-up URLs against the mock', () => {
  const zones = ['UTC', 'Asia/Kathmandu', 'America/New_York', 'Asia/Riyadh'];

  it.each(zones)('Xtream /timeshift/ resolves to the programme in a %s panel', async (tz) => {
    const fault = `timezone:tz=${tz}`;
    const client = new XtreamClient(account(), transport(fault), 'mock');
    await client.login();
    expect(client.zone().source).toBe('intl');
    const c = channel(101);
    // Two hours ago, and six days ago (before New York left DST on 2026-11-01).
    for (const p of [pastProgramme(c, 3 * HOUR), pastProgramme(c, 6 * DAY)]) {
      const url = client.catchupUrl(c.id, windowOf(p));
      const minutes = Math.ceil((p.stop - p.start) / MINUTE);
      expect(await archive(url, fault)).toEqual({ status: 200, channel: c.id, start: p.start / 1000, duration: minutes * 60 });
    }
  });

  it('the panel-clock fallback is exact without DST and an hour off across a DST change (ADR-010)', async () => {
    for (const [tz, expectedError] of [['Asia/Kathmandu', 0], ['America/New_York', 3600]] as const) {
      const fault = `timezone:tz=${tz}`;
      const login = await new XtreamClient(account(), transport(fault), 'mock').login();
      // As on a TV whose Intl has no zone data: only time_now/timestamp_now are usable.
      const zone = panelZone({ ...login.server!, timezone: null });
      expect(zone.source).toBe('clock');
      const p = pastProgramme(channel(101), 6 * DAY);
      const got = await archive(xtreamCatchupUrl(account(), 101, windowOf(p), zone.offset), fault);
      expect(got.status).toBe(200);
      expect(p.start / 1000 - got.start).toBe(expectedError);
    }
  });

  it('every M3U catch-up mode in the mock playlist resolves to the programme', async () => {
    const res = await transport().get(xtreamM3uUrl(account()));
    const parser = new M3uCatalogParser('m3u');
    const items = [...parser.push(await readAll(res)), ...parser.end()];
    const byChannel = (id: number): CatalogItem => items.find((i) => i.kind === 'live' && new RegExp(`/${id}(?:\\.ts|/mpegts)$`).test(i.url))!;
    const nowSec = NOW / 1000;
    const checked: string[] = [];
    for (const c of catalog.live.filter((x) => x.archiveDays > 0)) {
      const item = byChannel(c.id);
      expect(item.catchup).toMatchObject({ mode: c.catchup, days: c.archiveDays });
      const p = pastProgramme(c, 3 * HOUR);
      const start = p.start / 1000;
      const length = (p.stop - p.start) / 1000;
      const expectations: [string | null, number][] = [];
      switch (c.catchup) {
        case 'xc':
          expectations.push([m3uCatchupUrl(item.url, item.catchup, windowOf(p)), Math.ceil(length / 60) * 60]);
          break;
        case 'default':
          expectations.push([m3uCatchupUrl(item.url, item.catchup, windowOf(p)), length]);
          break;
        case 'append':
        case 'shift':
          // The mock reads `lutc` as the end: the archive plays on to "now".
          expectations.push([m3uCatchupUrl(item.url, item.catchup, windowOf(p)), nowSec - start]);
          break;
        case 'flussonic':
          expectations.push([m3uCatchupUrl(item.url, item.catchup, windowOf(p)), nowSec - start]);
          expectations.push([m3uCatchupUrl(item.url, item.catchup, windowOf(p), { flussonic: 'hls' }), length]);
          expectations.push([m3uCatchupUrl(item.url, item.catchup, windowOf(p), { flussonic: 'archive' }), length]);
          break;
        default:
          throw new Error(`untested mode ${c.catchup}`);
      }
      for (const [url, duration] of expectations) {
        expect(url).not.toBeNull();
        expect(await archive(url!)).toEqual({ status: 200, channel: c.id, start, duration });
        checked.push(`${c.id}:${c.catchup}`);
      }
    }
    expect(new Set(checked.map((k) => k.split(':')[1]))).toEqual(new Set(['xc', 'default', 'append', 'shift', 'flussonic']));
  });

  it('an M3U xc channel on a non-UTC panel resolves once the get.php link is upgraded to Xtream', async () => {
    const fault = 'timezone:tz=Asia/Kathmandu';
    const playlistUrl = xtreamM3uUrl(account());
    const upgraded = xtreamFromM3uUrl(playlistUrl)!;
    const client = new XtreamClient(upgraded, transport(fault), 'mock');
    await client.login();
    const res = await transport(fault).get(playlistUrl);
    const parser = new M3uCatalogParser('m3u');
    const item = [...parser.push(await readAll(res)), ...parser.end()].find((i) => i.url.endsWith('/112.ts'))!;
    const p = pastProgramme(channel(112), 5 * DAY);
    const url = m3uCatchupUrl(item.url, item.catchup, windowOf(p), { zone: client.zone().offset });
    expect(await archive(url!, fault)).toMatchObject({ status: 200, channel: 112, start: p.start / 1000 });
    // Without the panel zone, the UTC wall time is read as Kathmandu time: 5 h 45 min early.
    const naive = await archive(m3uCatchupUrl(item.url, item.catchup, windowOf(p))!, fault);
    expect(p.start / 1000 - naive.start).toBe(5 * 3600 + 45 * 60);
  });
});

describe('get.php detection against the mock', () => {
  it('upgrades the playlist link of every test account, including one with special characters', async () => {
    for (const [username, password] of [['zoma', 'zoma-test'], ['special+user@zoma.test', 'p@ss/w0rd&?# é']]) {
      const link = xtreamM3uUrl(account(username, password));
      const detected = xtreamFromM3uUrl(link);
      expect(detected).toEqual({ base, username, password });
      expect((await new XtreamClient(detected!, transport(), 'mock').login()).user.status).toBe('Active');
      // The playlist's own stream URLs carry the same account.
      const text = await readAll(await transport().get(link));
      const url = text.split('\n').find((l) => l.includes('/live/'))!;
      expect(parseXtreamStreamUrl(url)).toMatchObject({ base, username, password, kind: 'live' });
    }
  });
});

describe('XMLTV tokenizer against the mock', () => {
  /** The mock's guide as [channel, title, startMs, stopMs]: its own schedule, independent of core. */
  function expectedGuide(): [string, string, number, number][] {
    const seen = new Set<string>();
    const out: [string, string, number, number][] = [];
    for (const c of catalog.live) {
      const id = c.xmltvId ?? c.epgId;
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      const { from, to } = epgWindow(c, NOW, fixture.server.epgFutureDays);
      for (const p of programmes(c, from, to)) out.push([id, p.title, p.start, p.stop]);
    }
    return out;
  }

  async function tokenize(url: string, fault?: string, options = {}): Promise<{ channels: XmltvChannel[]; progs: XmltvProgramme[]; tokenizer: XmltvTokenizer }> {
    const res = await transport(fault).get(url);
    const tokenizer = new XmltvTokenizer(options);
    const items = [];
    for (let chunk = await res.read(); chunk !== null; chunk = await res.read()) items.push(...tokenizer.push(chunk));
    items.push(...tokenizer.end());
    return {
      channels: items.filter((i): i is XmltvChannel => i.type === 'channel'),
      progs: items.filter((i): i is XmltvProgramme => i.type === 'programme'),
      tokenizer,
    };
  }

  const xmltvUrl = (): string => `${base}/xmltv.php?username=zoma&password=zoma-test`;

  /** The panel's zone (from its login, as an Xtream source has it) and its guide, under `fault`. */
  async function guideFor(fault: string | undefined): Promise<{ zone: ZoneOffset; channels: XmltvChannel[]; progs: XmltvProgramme[]; tokenizer: XmltvTokenizer }> {
    const client = new XtreamClient(account(), transport(fault), 'mock');
    await client.login();
    return { zone: client.zone().offset, ...(await tokenize(xmltvUrl(), fault)) };
  }

  it.each([
    ['UTC times', undefined],
    ['+0545 offsets', 'timezone:tz=Asia/Kathmandu'],
    ['+05:45 offsets', 'timezone:tz=Asia/Kathmandu:xmltv=colon'],
    ['no offsets (the panel zone fills in)', 'timezone:tz=Asia/Kathmandu:xmltv=none'],
    ['DST offsets', 'timezone:tz=America/New_York:xmltv=local'],
  ])('reads every programme with %s', async (_label, fault) => {
    const { zone, channels, progs, tokenizer } = await guideFor(fault);
    expect(tokenizer.stats).toMatchObject({ lateChannels: 0, invalid: 0, malformed: 0, truncated: false });
    expect(channels.map((c) => [c.id, c.name])).toEqual(
      catalog.live
        .filter((c, i, all) => (c.xmltvId ?? c.epgId) !== null && all.findIndex((d) => (d.xmltvId ?? d.epgId) === (c.xmltvId ?? c.epgId)) === i)
        .map((c) => [c.xmltvId ?? c.epgId, c.name]),
    );
    expect(progs.map((p) => [p.channel, p.title, parseXmltvTime(p.start, zone), parseXmltvTime(p.stop!, zone)])).toEqual(expectedGuide());
  });

  it('without offsets in a DST zone, only the repeated hour is ambiguous (the earlier instant wins)', async () => {
    const { zone, progs } = await guideFor('timezone:tz=America/New_York:xmltv=none');
    const got = progs.flatMap((p) => [parseXmltvTime(p.start, zone), parseXmltvTime(p.stop!, zone)]);
    const expected = expectedGuide().flatMap((p) => [p[2], p[3]]);
    expect(got).toHaveLength(expected.length);
    // New York repeated 01:00-02:00 on 2026-11-01 (05:00-07:00 UTC). Wall times in the second
    // pass (06:00-07:00 UTC) read as the first pass, an hour early. Step 9 can repair these from
    // per-channel ordering; everything else is exact.
    const second = [Date.UTC(2026, 10, 1, 6), Date.UTC(2026, 10, 1, 7)];
    const off = expected.flatMap((ms, i) => (got[i] === ms ? [] : [[ms, got[i]]]));
    expect(off.length).toBeGreaterThan(0);
    for (const [ms, value] of off) {
      expect(ms! >= second[0]! && ms! < second[1]!).toBe(true);
      expect(value).toBe(ms! - HOUR);
    }
  });

  it('reads the gzipped standalone guide, and skips unwanted channels', async () => {
    const res = await fetch(`${base}/epg/guide.xml.gz`);
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    const tokenizer = new XmltvTokenizer({ wantChannel: (id) => id.toLowerCase() === 'zoma.test1' });
    const items = [];
    for (let i = 0; i < text.length; i += 4093) items.push(...tokenizer.push(text.slice(i, i + 4093)));
    items.push(...tokenizer.end());
    const progs = items.filter((i): i is XmltvProgramme => i.type === 'programme');
    const all = expectedGuide();
    expect(progs.map((p) => [p.channel, p.title, parseXmltvTime(p.start), parseXmltvTime(p.stop!)])).toEqual(all.filter((p) => p[0] === 'zoma.test1'));
    expect(tokenizer.stats.filtered).toBe(all.length - progs.length);
  });
});
