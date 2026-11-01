// Stream endpoints: live (TS and HLS), VOD and episodes (with Range), and catch-up in every
// shape the plan supports: Xtream `/timeshift` and `timeshift.php`, and the M3U modes
// `default` (/catchup), `append`/`shift` (`?utc=&lutc=` on the live URL) and `flussonic`.
// Archive responses carry X-Mock-Archive-* headers so tests can check what a URL resolved to.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Account, LiveChannel } from './config';
import { HLS_SEGMENT_SECONDS } from './media';
import type { MockState } from './state';
import { baseUrl, enc, findAccount, requestParams, requestTz } from './state';
import { parseTimeshiftStart } from './time';

const TEXT = 'text/plain; charset=utf-8';
const HLS = 'application/vnd.apple.mpegurl';
/** Live HLS window: the last 6 complete segments. */
const LIVE_WINDOW = 6;

/** A 1x1 PNG for every logo and poster URL. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

type StreamParams = { u: string; p: string };

/** Authenticates a stream request: 401 unknown credentials, 403 inactive account. */
function authorize(state: MockState, reply: FastifyReply, username: string | undefined, password: string | undefined): Account | undefined {
  const account = findAccount(state, username, password);
  if (!account) {
    void reply.code(401).type(TEXT).send('Unauthorized');
    return undefined;
  }
  if (account.status !== 'Active') {
    void reply.code(403).type(TEXT).send(`Account ${account.status}`);
    return undefined;
  }
  return account;
}

/** Counts the stream against `max_connections`; replies with the account's over-limit status when full. */
function hold(state: MockState, reply: FastifyReply, account: Account): boolean {
  if (reply.request.method === 'HEAD') return true;
  const used = account.activeCons + state.connections.count(account.username);
  if (used >= account.maxConnections) {
    void reply.code(account.overLimitStatus).type(TEXT).send(`Max connections reached (${used}/${account.maxConnections})`);
    return false;
  }
  state.connections.hold(account.username, reply);
  return true;
}

function splitFile(file: string): { id: number; ext: string } | undefined {
  const m = /^(\d+)(?:\.([A-Za-z0-9]+))?$/.exec(file);
  return m ? { id: Number(m[1]), ext: (m[2] ?? '').toLowerCase() } : undefined;
}

function liveChannel(state: MockState, id: number): LiveChannel | undefined {
  return state.catalog.live.find((c) => c.id === id);
}

function notFound(reply: FastifyReply, what: string): FastifyReply {
  return reply.code(404).type(TEXT).send(`${what} not found`);
}

function hlsPlaylist(base: string, u: string, p: string, channelId: number, firstSeq: number, count: number, ended: boolean): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
    `#EXT-X-MEDIA-SEQUENCE:${firstSeq}`,
  ];
  if (ended) lines.push('#EXT-X-PLAYLIST-TYPE:VOD');
  for (let seq = firstSeq; seq < firstSeq + count; seq++) {
    lines.push(`#EXTINF:${HLS_SEGMENT_SECONDS.toFixed(3)},`, `${base}/hls/${enc(u)}/${enc(p)}/${channelId}/${seq}.ts`);
  }
  if (ended) lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

function sendLiveTs(state: MockState, reply: FastifyReply, account: Account, channel: LiveChannel): FastifyReply {
  if (!hold(state, reply, account)) return reply;
  return reply.type('video/mp2t').send(state.media.liveTs(channel.id));
}

function sendLiveHls(state: MockState, request: FastifyRequest, reply: FastifyReply, account: Account, channel: LiveChannel): FastifyReply {
  const nowSeq = Math.floor(state.now() / 1000 / HLS_SEGMENT_SECONDS);
  return reply
    .type(HLS)
    .send(hlsPlaylist(baseUrl(request), account.username, account.password, channel.id, nowSeq - LIVE_WINDOW, LIVE_WINDOW, false));
}

/** Serves a catch-up window, or 404 when the channel has no archive for it. */
function sendArchive(
  state: MockState,
  request: FastifyRequest,
  reply: FastifyReply,
  account: Account,
  channel: LiveChannel,
  startSec: number,
  durationSec: number,
  format: 'ts' | 'm3u8',
): FastifyReply {
  if (!Number.isFinite(startSec) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return reply.code(400).type(TEXT).send('Bad catch-up start or duration');
  }
  if (channel.archiveDays <= 0) return reply.code(404).type(TEXT).send('No archive for this channel');
  const nowSec = Math.floor(state.now() / 1000);
  if (startSec < nowSec - channel.archiveDays * 86_400 || startSec >= nowSec) {
    return reply.code(404).type(TEXT).send('Outside the archive window');
  }
  void reply
    .header('x-mock-archive-channel', String(channel.id))
    .header('x-mock-archive-start', String(startSec))
    .header('x-mock-archive-duration', String(durationSec));
  if (format === 'm3u8') {
    const first = Math.floor(startSec / HLS_SEGMENT_SECONDS);
    const count = Math.max(1, Math.ceil((startSec + durationSec) / HLS_SEGMENT_SECONDS) - first);
    return reply.type(HLS).send(hlsPlaylist(baseUrl(request), account.username, account.password, channel.id, first, count, true));
  }
  if (!hold(state, reply, account)) return reply;
  return reply.type('video/mp2t').send(state.media.archiveTs(channel.id, startSec, durationSec));
}

type Range = { start: number; end: number } | 'unsatisfiable' | undefined;

/** Single `bytes=` ranges; multi-range requests get the whole file. */
export function parseRange(header: string | undefined, size: number): Range {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined;
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return undefined;
  let start: number;
  let end: number;
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

function sendFile(state: MockState, request: FastifyRequest, reply: FastifyReply, kind: 'movie' | 'episode', params: StreamParams & { file: string }): FastifyReply {
  const account = authorize(state, reply, params.u, params.p);
  if (!account) return reply;
  const parsed = splitFile(params.file);
  const exists =
    parsed !== undefined &&
    (kind === 'movie'
      ? state.catalog.movies.some((m) => m.id === parsed.id)
      : state.catalog.series.some((s) => s.seasons.some((season) => season.episodes.some((e) => e.id === parsed.id))));
  const media = exists ? state.media.file(kind, parsed.id, parsed.ext) : undefined;
  if (!parsed || !media) return notFound(reply, kind === 'movie' ? 'Movie' : 'Episode');
  void reply.header('accept-ranges', 'bytes').type(media.contentType);
  const range = parseRange(request.headers.range, media.size);
  if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${media.size}`).send();
  if (!hold(state, reply, account)) return reply;
  if (range === undefined) {
    return reply.header('content-length', String(media.size)).send(media.read(0, media.size - 1));
  }
  return reply
    .code(206)
    .header('content-range', `bytes ${range.start}-${range.end}/${media.size}`)
    .header('content-length', String(range.end - range.start + 1))
    .send(media.read(range.start, range.end));
}

export function registerStreams(app: FastifyInstance, state: MockState): void {
  // Live: /live/u/p/101.ts, /live/u/p/101.m3u8, /live/u/p/101 (TS). `?utc=&lutc=` = M3U append/shift catch-up.
  app.get<{ Params: StreamParams & { file: string } }>('/live/:u/:p/:file', async (request, reply) => {
    const account = authorize(state, reply, request.params.u, request.params.p);
    if (!account) return reply;
    const parsed = splitFile(request.params.file);
    const channel = parsed && liveChannel(state, parsed.id);
    if (!parsed || !channel || !['', 'ts', 'm3u8'].includes(parsed.ext)) return notFound(reply, 'Channel');
    const q = requestParams(request);
    if (q['utc'] !== undefined) {
      const utc = Number(q['utc']);
      const end = q['lutc'] !== undefined ? Number(q['lutc']) : Math.floor(state.now() / 1000);
      return sendArchive(state, request, reply, account, channel, utc, end - utc, parsed.ext === 'm3u8' ? 'm3u8' : 'ts');
    }
    return parsed.ext === 'm3u8' ? sendLiveHls(state, request, reply, account, channel) : sendLiveTs(state, reply, account, channel);
  });

  // Short live form some M3U exports use: /u/p/101 (TS, no extension).
  app.get<{ Params: StreamParams & { id: string } }>('/:u/:p/:id(^\\d+$)', async (request, reply) => {
    const account = authorize(state, reply, request.params.u, request.params.p);
    if (!account) return reply;
    const channel = liveChannel(state, Number(request.params.id));
    return channel ? sendLiveTs(state, reply, account, channel) : notFound(reply, 'Channel');
  });

  // HLS segments for live and archive playlists: seq * 6 = epoch seconds of the segment start.
  app.get<{ Params: StreamParams & { id: string; seg: string } }>('/hls/:u/:p/:id/:seg', async (request, reply) => {
    const account = authorize(state, reply, request.params.u, request.params.p);
    if (!account) return reply;
    const channel = liveChannel(state, Number(request.params.id));
    const m = /^(\d+)\.ts$/.exec(request.params.seg);
    if (!channel || !m) return notFound(reply, 'Segment');
    const seq = Number(m[1]);
    if (seq * HLS_SEGMENT_SECONDS > state.now() / 1000) return notFound(reply, 'Segment');
    return reply.type('video/mp2t').send(state.media.hlsSegment(channel.id, seq));
  });

  app.get<{ Params: StreamParams & { file: string } }>('/movie/:u/:p/:file', async (request, reply) =>
    sendFile(state, request, reply, 'movie', request.params),
  );
  app.get<{ Params: StreamParams & { file: string } }>('/series/:u/:p/:file', async (request, reply) =>
    sendFile(state, request, reply, 'episode', request.params),
  );

  // Xtream catch-up: /timeshift/u/p/{minutes}/{YYYY-MM-DD:HH-MM}/{id}.ts, start in the panel's zone.
  app.get<{ Params: StreamParams & { duration: string; start: string; file: string } }>(
    '/timeshift/:u/:p/:duration/:start/:file',
    async (request, reply) => {
      const { u, p, duration, start, file } = request.params;
      const account = authorize(state, reply, u, p);
      if (!account) return reply;
      const parsed = splitFile(file);
      const channel = parsed && liveChannel(state, parsed.id);
      if (!channel) return notFound(reply, 'Channel');
      const startMs = parseTimeshiftStart(start, requestTz(state, request));
      if (startMs === null || !/^\d+$/.test(duration)) return reply.code(400).type(TEXT).send('Bad timeshift start or duration');
      return sendArchive(state, request, reply, account, channel, startMs / 1000, Number(duration) * 60, parsed?.ext === 'm3u8' ? 'm3u8' : 'ts');
    },
  );

  app.get('/streaming/timeshift.php', async (request, reply) => {
    const q = requestParams(request);
    const account = authorize(state, reply, q['username'], q['password']);
    if (!account) return reply;
    const channel = liveChannel(state, Number(q['stream']));
    if (!channel) return notFound(reply, 'Channel');
    const startMs = parseTimeshiftStart(q['start'] ?? '', requestTz(state, request));
    if (startMs === null || !/^\d+$/.test(q['duration'] ?? '')) return reply.code(400).type(TEXT).send('Bad timeshift start or duration');
    return sendArchive(state, request, reply, account, channel, startMs / 1000, Number(q['duration']) * 60, 'ts');
  });

  // M3U `catchup="default"`: the playlist's catchup-source template resolves to this.
  app.get<{ Params: StreamParams & { file: string } }>('/catchup/:u/:p/:file', async (request, reply) => {
    const account = authorize(state, reply, request.params.u, request.params.p);
    if (!account) return reply;
    const parsed = splitFile(request.params.file);
    const channel = parsed && liveChannel(state, parsed.id);
    if (!channel) return notFound(reply, 'Channel');
    const q = requestParams(request);
    const start = Number(q['start']);
    return sendArchive(state, request, reply, account, channel, start, Number(q['end']) - start, 'ts');
  });

  // Flussonic-style channels: index.m3u8 / mpegts live; index-{start}-{dur}.m3u8,
  // archive-{start}-{dur}.ts and timeshift_abs-{start}.ts for catch-up (epoch seconds).
  app.get<{ Params: StreamParams & { id: string; file: string } }>('/flussonic/:u/:p/:id/:file', async (request, reply) => {
    const account = authorize(state, reply, request.params.u, request.params.p);
    if (!account) return reply;
    const channel = liveChannel(state, Number(request.params.id));
    if (!channel) return notFound(reply, 'Channel');
    const file = request.params.file;
    if (file === 'index.m3u8') return sendLiveHls(state, request, reply, account, channel);
    if (file === 'mpegts') return sendLiveTs(state, reply, account, channel);
    let m = /^(index|archive)-(\d+)-(\d+)\.(m3u8|ts)$/.exec(file);
    if (m) return sendArchive(state, request, reply, account, channel, Number(m[2]), Number(m[3]), m[4] === 'm3u8' ? 'm3u8' : 'ts');
    m = /^timeshift_abs-(\d+)\.ts$/.exec(file);
    if (m) {
      const start = Number(m[1]);
      return sendArchive(state, request, reply, account, channel, start, Math.floor(state.now() / 1000) - start, 'ts');
    }
    return notFound(reply, 'Flussonic resource');
  });

  // Logos and posters referenced by the catalog.
  app.get<{ Params: { file: string } }>('/images/:file', async (request, reply) => {
    if (!/^[a-z]+-\d+\.png$/.test(request.params.file)) return notFound(reply, 'Image');
    return reply.type('image/png').header('cache-control', 'max-age=86400').send(PNG_1X1);
  });
}
