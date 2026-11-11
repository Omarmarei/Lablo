// The Lablo Lab's player batteries (RELAY step 15c, spikes S4, S5 and S8). The lab holds no test
// account, so the mock hands it the media URLs of its test account, one per row of the battery:
//
//   GET /__lab/media   JSON: `media` (`files` or `placeholder`, as /__mock/health says) and
//                      `items`, each a URL with what the generated media holds there (the
//                      codecs, the audio tracks and subtitles from the manifest; null with
//                      placeholder bytes, where nothing plays)
//
// The items are fixed catalog entries (fixtures/catalog.yaml): the bilingual live channel 104 as
// TS and HLS, the same through a chain of 302s and with a stall after a set number of bytes
// (each new request plays that much again, so a reopening player meets a stall at a steady
// rhythm), the 4K HEVC movie 205, the multi-audio MKV 206 (AAC ara/eng/spa, AC3 and E-AC3 5.1,
// SRT), and the episodes with SRT in MKV (3001) and mov_text in MP4 (3011). A catalog without
// one of them (`--catalog` with the scale fixtures) leaves it out.

import type { FastifyInstance } from 'fastify';
import type { Catalog } from './config';
import type { FileManifestEntry, LiveManifestEntry, MediaManifest } from './file-media';
import { labAccount } from './lab-source';
import type { MockState } from './state';
import { baseUrl } from './state';

const TEXT = 'text/plain; charset=utf-8';

/** Live channel 104: ara + eng audio (the `bilingual` profile). */
export const LAB_LIVE_CHANNEL = 104;
/** The redirect rows: as many 302s as the `redirect-chain` scenario sends. */
export const LAB_REDIRECT_HOPS = 3;
/**
 * The stall rows: bytes of each response before it stalls. Live TS runs about 200 KB per 6 s
 * segment, so a reopened stream plays about 18 s before the next stall; the VOD file (3011, about
 * 50 KB/s) about 20 s.
 */
export const LAB_STALL_TS_BYTES = 600_000;
export const LAB_STALL_VOD_BYTES = 1_000_000;

export type LabMediaId =
  | 'live-ts'
  | 'live-hls'
  | 'redirect-ts'
  | 'redirect-hls'
  | 'stall-ts'
  | 'stall-vod'
  | 'hevc-4k'
  | 'multi-audio'
  | 'subs-mkv'
  | 'subs-mp4';

export interface LabMediaItem {
  readonly url: string;
  readonly kind: 'live' | 'vod';
  readonly container: 'ts' | 'hls' | 'mp4' | 'mkv';
  /** What the URL's `mock_fault` adds: `redirect:hops=3`, `stall:after_bytes=600000`, or null. */
  readonly fault: string | null;
  /** From the manifest; null with placeholder bytes. */
  readonly video: { readonly codec: string; readonly width: number; readonly height: number; readonly fps: number } | null;
  readonly audio: ReadonlyArray<{ readonly lang: string; readonly codec: string; readonly channels: number }> | null;
  readonly subtitles: ReadonlyArray<{ readonly lang: string; readonly codec: string }> | null;
}

export interface LabMedia {
  readonly media: string;
  readonly items: Partial<Record<LabMediaId, LabMediaItem>>;
}

type VodRef = { readonly kind: 'movie' | 'episode'; readonly id: number };

const VOD: Readonly<Record<'hevc-4k' | 'multi-audio' | 'subs-mkv' | 'subs-mp4' | 'stall-vod', VodRef>> = {
  'hevc-4k': { kind: 'movie', id: 205 },
  'multi-audio': { kind: 'movie', id: 206 },
  'subs-mkv': { kind: 'episode', id: 3001 },
  'subs-mp4': { kind: 'episode', id: 3011 },
  'stall-vod': { kind: 'episode', id: 3011 },
};

/** The generated media's manifest, or null with placeholder bytes. */
function manifestOf(state: MockState): MediaManifest | null {
  // FileMedia carries its manifest; placeholder bytes have none.
  return (state.media as { readonly manifest?: MediaManifest }).manifest ?? null;
}

/** A catalog entry's extension, or null when the catalog has no such entry. */
function vodExt(catalog: Catalog, ref: VodRef): string | null {
  if (ref.kind === 'movie') return catalog.movies.find((m) => m.id === ref.id)?.ext ?? null;
  for (const series of catalog.series) for (const season of series.seasons) for (const e of season.episodes) if (e.id === ref.id) return e.ext;
  return null;
}

function withFault(url: string, fault: string | null): string {
  return fault === null ? url : `${url}?mock_fault=${fault}`;
}

function liveInfo(entry: LiveManifestEntry | undefined): Pick<LabMediaItem, 'video' | 'audio' | 'subtitles'> {
  if (entry === undefined) return { video: null, audio: null, subtitles: null };
  return { video: entry.video, audio: entry.audio, subtitles: [] };
}

function fileInfo(entry: FileManifestEntry | undefined): Pick<LabMediaItem, 'video' | 'audio' | 'subtitles'> {
  if (entry === undefined) return { video: null, audio: null, subtitles: null };
  return { video: entry.video, audio: entry.audio, subtitles: entry.subtitles };
}

/** What `/__lab/media` answers for a lab that reaches this mock at `base`; null without an active test account. */
export function labMedia(state: MockState, base: string): LabMedia | null {
  const account = labAccount(state.fixture.accounts);
  if (account === null) return null;
  const u = encodeURIComponent(account.username);
  const p = encodeURIComponent(account.password);
  const manifest = manifestOf(state);
  const items: Partial<Record<LabMediaId, LabMediaItem>> = {};

  if (state.catalog.live.some((c) => c.id === LAB_LIVE_CHANNEL)) {
    const info = manifest === null ? liveInfo(undefined) : liveInfo(manifest.live[String(LAB_LIVE_CHANNEL)] ?? manifest.live['generic']);
    const live = (container: 'ts' | 'hls', fault: string | null): LabMediaItem => ({
      url: withFault(`${base}/live/${u}/${p}/${LAB_LIVE_CHANNEL}.${container === 'hls' ? 'm3u8' : 'ts'}`, fault),
      kind: 'live',
      container,
      fault,
      ...info,
    });
    const redirect = `redirect:hops=${LAB_REDIRECT_HOPS}`;
    items['live-ts'] = live('ts', null);
    items['live-hls'] = live('hls', null);
    items['redirect-ts'] = live('ts', redirect);
    items['redirect-hls'] = live('hls', redirect);
    items['stall-ts'] = live('ts', `stall:after_bytes=${LAB_STALL_TS_BYTES}`);
  }

  for (const id of Object.keys(VOD) as Array<keyof typeof VOD>) {
    const ref = VOD[id];
    const ext = vodExt(state.catalog, ref);
    if (ext === null || (ext !== 'mp4' && ext !== 'mkv')) continue;
    const fault = id === 'stall-vod' ? `stall:after_bytes=${LAB_STALL_VOD_BYTES}` : null;
    const path = ref.kind === 'movie' ? 'movie' : 'series';
    items[id] = {
      url: withFault(`${base}/${path}/${u}/${p}/${ref.id}.${ext}`, fault),
      kind: 'vod',
      container: ext,
      fault,
      ...fileInfo(manifest === null ? undefined : manifest.files[`${ref.kind}:${ref.id}`]),
    };
  }
  return { media: state.media.kind, items };
}

export function registerLabMedia(app: FastifyInstance, state: MockState): void {
  app.get('/__lab/media', async (request, reply) => {
    const answer = labMedia(state, baseUrl(request));
    if (answer === null) return reply.code(503).type(TEXT).send('No active test account in server.yaml');
    return reply.header('cache-control', 'no-store').send(answer);
  });
}
