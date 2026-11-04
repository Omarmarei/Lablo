// The player batteries' media (RELAY step 15c, spikes S4, S5 and S8): `/__lab/media` hands the
// lab one URL per row of the battery, with what the generated media holds there.

import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/config';
import { loadCatalog } from '../src/config';
import type { MediaManifest } from '../src/file-media';
import type { LabMedia } from '../src/lab-media';
import { LAB_LIVE_CHANNEL, LAB_REDIRECT_HOPS, LAB_STALL_TS_BYTES, LAB_STALL_VOD_BYTES } from '../src/lab-media';
import type { MediaSource } from '../src/media';
import { PlaceholderMedia } from '../src/media';
import { P, U, mock } from './helpers';

const VIDEO = { codec: 'h264', width: 960, height: 540, fps: 25 };
const FILE_VIDEO = { codec: 'h264', width: 640, height: 360, fps: 25 };
const AAC = (lang: string): { lang: string; codec: string; channels: number } => ({ lang, codec: 'aac', channels: 2 });

/** A manifest shaped like `pnpm mock:media`'s, for the entries the lab asks for. */
const MANIFEST: MediaManifest = {
  version: 1,
  generatedAt: '2026-11-04T00:00:00.000Z',
  ffmpeg: 'test',
  font: null,
  live: {
    '104': { dir: 'live/104', segments: 10, segmentSeconds: 6, video: VIDEO, audio: [AAC('ara'), AAC('eng')] },
    generic: { dir: 'live/generic', segments: 10, segmentSeconds: 6, video: VIDEO, audio: [AAC('eng')] },
  },
  files: {
    'movie:205': { path: 'files/205.mp4', ext: 'mp4', durationSecs: 60, video: { codec: 'hevc', width: 3840, height: 2160, fps: 25 }, audio: [AAC('eng')], subtitles: [] },
    'movie:206': {
      path: 'files/206.mkv',
      ext: 'mkv',
      durationSecs: 120,
      video: FILE_VIDEO,
      audio: [AAC('ara'), AAC('eng'), AAC('spa'), { lang: 'eng', codec: 'ac3', channels: 6 }, { lang: 'eng', codec: 'eac3', channels: 6 }],
      subtitles: [
        { lang: 'ara', codec: 'subrip' },
        { lang: 'eng', codec: 'subrip' },
      ],
    },
    'episode:3001': { path: 'files/3001.mkv', ext: 'mkv', durationSecs: 300, video: FILE_VIDEO, audio: [AAC('eng')], subtitles: [{ lang: 'ara', codec: 'subrip' }] },
    'episode:3011': { path: 'files/3011.mp4', ext: 'mp4', durationSecs: 240, video: FILE_VIDEO, audio: [AAC('eng')], subtitles: [{ lang: 'eng', codec: 'mov_text' }] },
  },
};

/** Placeholder bytes that call themselves generated media, with a manifest (what `/__lab/media` reads). */
function filesMedia(manifest: MediaManifest): MediaSource & { readonly manifest: MediaManifest } {
  const inner = new PlaceholderMedia({ liveLimitBytes: 4096, liveIntervalMs: 5 });
  return {
    kind: 'files',
    manifest,
    liveTs: (id) => inner.liveTs(id),
    hlsSegment: (id, seq) => inner.hlsSegment(id, seq),
    archiveTs: (id, start, duration) => inner.archiveTs(id, start, duration),
    file: (kind, id, ext) => inner.file(kind, id, ext),
  };
}

async function labMediaOf(options: Parameters<typeof mock>[0] = {}): Promise<{ status: number; body: LabMedia }> {
  const app = await mock(options);
  try {
    const res = await app.inject({ method: 'GET', url: '/__lab/media', headers: { host: 'tv-lab.test:8080' } });
    expect(res.headers['cache-control']).toBe('no-store');
    return { status: res.statusCode, body: res.json<LabMedia>() };
  } finally {
    await app.close();
  }
}

const BASE = 'http://tv-lab.test:8080';
const ACCOUNT = `${U}/${P}`;

describe('/__lab/media', () => {
  it('hands out one URL per row of the battery, on the host the lab used, with the test account', async () => {
    const { status, body } = await labMediaOf();
    expect(status).toBe(200);
    expect(body.media).toBe('placeholder');
    const urls = Object.fromEntries(Object.entries(body.items).map(([id, item]) => [id, item.url]));
    expect(urls).toEqual({
      'live-ts': `${BASE}/live/${ACCOUNT}/${LAB_LIVE_CHANNEL}.ts`,
      'live-hls': `${BASE}/live/${ACCOUNT}/${LAB_LIVE_CHANNEL}.m3u8`,
      'redirect-ts': `${BASE}/live/${ACCOUNT}/${LAB_LIVE_CHANNEL}.ts?mock_fault=redirect:hops=${LAB_REDIRECT_HOPS}`,
      'redirect-hls': `${BASE}/live/${ACCOUNT}/${LAB_LIVE_CHANNEL}.m3u8?mock_fault=redirect:hops=${LAB_REDIRECT_HOPS}`,
      'stall-ts': `${BASE}/live/${ACCOUNT}/${LAB_LIVE_CHANNEL}.ts?mock_fault=stall:after_bytes=${LAB_STALL_TS_BYTES}`,
      'hevc-4k': `${BASE}/movie/${ACCOUNT}/205.mp4`,
      'multi-audio': `${BASE}/movie/${ACCOUNT}/206.mkv`,
      'subs-mkv': `${BASE}/series/${ACCOUNT}/3001.mkv`,
      'subs-mp4': `${BASE}/series/${ACCOUNT}/3011.mp4`,
      'stall-vod': `${BASE}/series/${ACCOUNT}/3011.mp4?mock_fault=stall:after_bytes=${LAB_STALL_VOD_BYTES}`,
    });
    expect(body.items['redirect-hls']).toMatchObject({ kind: 'live', container: 'hls', fault: `redirect:hops=${LAB_REDIRECT_HOPS}` });
    expect(body.items['subs-mkv']).toMatchObject({ kind: 'vod', container: 'mkv', fault: null });
    // Placeholder bytes: nothing to say about codecs or tracks.
    for (const item of Object.values(body.items)) expect([item.video, item.audio, item.subtitles]).toEqual([null, null, null]);
  });

  it("describes each item from the generated media's manifest", async () => {
    const { body } = await labMediaOf({ media: filesMedia(MANIFEST) });
    expect(body.media).toBe('files');
    expect(body.items['live-ts']).toMatchObject({ video: VIDEO, audio: [AAC('ara'), AAC('eng')], subtitles: [] });
    expect(body.items['stall-ts']?.audio).toEqual([AAC('ara'), AAC('eng')]);
    expect(body.items['hevc-4k']?.video).toEqual({ codec: 'hevc', width: 3840, height: 2160, fps: 25 });
    expect(body.items['multi-audio']?.audio?.map((a) => `${a.lang}:${a.codec}:${a.channels}`)).toEqual(['ara:aac:2', 'eng:aac:2', 'spa:aac:2', 'eng:ac3:6', 'eng:eac3:6']);
    expect(body.items['subs-mkv']?.subtitles).toEqual([{ lang: 'ara', codec: 'subrip' }]);
    expect(body.items['subs-mp4']?.subtitles).toEqual([{ lang: 'eng', codec: 'mov_text' }]);
    expect(body.items['stall-vod']?.subtitles).toEqual([{ lang: 'eng', codec: 'mov_text' }]);
  });

  it("falls back to the generic loop for a channel without its own, and leaves out a file the manifest lacks", async () => {
    const live: MediaManifest['live'] = { generic: MANIFEST.live['generic']! };
    const files: MediaManifest['files'] = { ...MANIFEST.files };
    delete files['movie:205'];
    const { body } = await labMediaOf({ media: filesMedia({ ...MANIFEST, live, files }) });
    expect(body.items['live-hls']?.audio).toEqual([AAC('eng')]);
    expect(body.items['hevc-4k']).toMatchObject({ url: `${BASE}/movie/${ACCOUNT}/205.mp4`, video: null, audio: null, subtitles: null });
  });

  it("leaves out the items a catalog doesn't have (the scale fixtures' catalog)", async () => {
    const catalog: Catalog = loadCatalog();
    const smaller: Catalog = {
      ...catalog,
      live: catalog.live.filter((c) => c.id !== LAB_LIVE_CHANNEL),
      movies: catalog.movies.filter((m) => m.id !== 206),
      series: catalog.series.map((s) => ({ ...s, seasons: s.seasons.map((season) => ({ ...season, episodes: season.episodes.filter((e) => e.id !== 3011) })) })),
    };
    const { body } = await labMediaOf({ catalog: smaller });
    expect(Object.keys(body.items).sort()).toEqual(['hevc-4k', 'subs-mkv']);
  });

  it('answers 503 without an active test account', async () => {
    const app = await mock();
    try {
      const fixture = app.mockState.fixture;
      app.mockState.fixture = { ...fixture, accounts: fixture.accounts.filter((a) => a.status !== 'Active') };
      const res = await app.inject({ method: 'GET', url: '/__lab/media' });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('serves every URL it hands out: the redirect rows through their 302s, the rest at once', async () => {
    const app = await mock();
    try {
      const body = (await app.inject({ method: 'GET', url: '/__lab/media' })).json<LabMedia>();
      const path = (url: string): string => url.replace(/^http:\/\/[^/]+/, '');
      for (const [id, item] of Object.entries(body.items)) {
        // A stall holds its socket for minutes: its fault is tested in faults.test.ts.
        if (item.fault?.startsWith('stall') === true) continue;
        let res = await app.inject({ method: 'GET', url: path(item.url) });
        let hops = 0;
        while (res.statusCode === 302 && hops < 10) {
          hops += 1;
          res = await app.inject({ method: 'GET', url: path(String(res.headers.location)) });
        }
        expect([id, res.statusCode, hops]).toEqual([id, 200, item.fault === null ? 0 : LAB_REDIRECT_HOPS]);
      }
    } finally {
      await app.close();
    }
  });
});
