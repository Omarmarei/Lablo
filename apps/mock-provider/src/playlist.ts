// `get.php`: the Xtream M3U export. `type=m3u_plus` carries tvg-* attributes, group-title and
// catch-up attributes; `type=m3u` is the bare form. Each channel advertises catch-up in the mode
// set in the catalog, so one playlist covers every M3U catch-up flavour.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Account, LiveChannel } from './config';
import type { MockState } from './state';
import { baseUrl, enc, findAccount, imageUrl, requestParams } from './state';

export type LiveOutput = 'ts' | 'm3u8';

/** Live stream URL as the playlist gives it (Flussonic-style channels use their own paths). */
export function liveUrl(base: string, account: Account, c: LiveChannel, output: LiveOutput): string {
  const u = enc(account.username);
  const p = enc(account.password);
  if (c.catchup === 'flussonic') return `${base}/flussonic/${u}/${p}/${c.id}/${output === 'ts' ? 'mpegts' : 'index.m3u8'}`;
  return `${base}/live/${u}/${p}/${c.id}.${output}`;
}

function catchupAttrs(base: string, account: Account, c: LiveChannel): string {
  if (c.catchup === null) return '';
  const days = ` catchup-days="${c.archiveDays}"`;
  switch (c.catchup) {
    case 'default':
      return ` catchup="default"${days} catchup-source="${base}/catchup/${enc(account.username)}/${enc(account.password)}/${c.id}.ts?start={utc}&end={utcend}"`;
    case 'append':
      return ` catchup="append"${days} catchup-source="?utc={utc}&lutc={lutc}"`;
    default:
      return ` catchup="${c.catchup}"${days}`;
  }
}

/** Authenticates a credential-protected text resource; replies 401/403 itself on failure. */
export function authorizeText(state: MockState, request: FastifyRequest, reply: FastifyReply): Account | undefined {
  const p = requestParams(request);
  const account = findAccount(state, p['username'], p['password']);
  if (!account) {
    void reply.code(401).type('text/plain; charset=utf-8').send('Unauthorized');
    return undefined;
  }
  if (account.status !== 'Active') {
    void reply.code(403).type('text/plain; charset=utf-8').send(`Account ${account.status}`);
    return undefined;
  }
  return account;
}

export function buildPlaylist(state: MockState, request: FastifyRequest, account: Account, plus: boolean, output: LiveOutput): string {
  const base = baseUrl(request);
  const { catalog } = state;
  const u = enc(account.username);
  const p = enc(account.password);
  const groups = new Map(
    [...catalog.liveCategories, ...catalog.vodCategories, ...catalog.seriesCategories].map((c) => [c.id, c.name]),
  );
  const lines: string[] = [];
  const epgUrl = `${base}/xmltv.php?username=${u}&password=${p}`;
  lines.push(plus ? `#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"` : '#EXTM3U');

  const entry = (attrs: string, name: string, url: string): void => {
    lines.push(plus ? `#EXTINF:-1${attrs},${name}` : `#EXTINF:-1,${name}`, url);
  };

  for (const c of catalog.live) {
    const attrs =
      ` tvg-id="${c.epgId ?? ''}" tvg-name="${c.name}" tvg-logo="${c.logo ? imageUrl(request, `channel-${c.id}`) : ''}"` +
      ` group-title="${groups.get(c.categoryId) ?? ''}"${c.radio ? ' radio="true"' : ''}${catchupAttrs(base, account, c)}`;
    entry(attrs, c.name, liveUrl(base, account, c, output));
  }
  for (const m of catalog.movies) {
    const attrs = ` tvg-id="" tvg-name="${m.name}" tvg-logo="${imageUrl(request, `movie-${m.id}`)}" group-title="${groups.get(m.categoryId) ?? ''}"`;
    entry(attrs, m.name, `${base}/movie/${u}/${p}/${m.id}.${m.ext}`);
  }
  for (const s of catalog.series) {
    for (const season of s.seasons) {
      for (const e of season.episodes) {
        const name = `${s.name} S${String(season.number).padStart(2, '0')} E${String(e.episodeNum).padStart(2, '0')}`;
        const attrs = ` tvg-id="" tvg-name="${name}" tvg-logo="${imageUrl(request, `series-${s.id}`)}" group-title="${groups.get(s.categoryId) ?? ''}"`;
        entry(attrs, name, `${base}/series/${u}/${p}/${e.id}.${e.ext}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export function registerPlaylist(app: FastifyInstance, state: MockState): void {
  app.get('/get.php', async (request, reply) => {
    const account = authorizeText(state, request, reply);
    if (!account) return reply;
    const p = requestParams(request);
    const type = p['type'] ?? 'm3u_plus';
    if (type !== 'm3u_plus' && type !== 'm3u') return reply.code(400).type('text/plain; charset=utf-8').send(`Unsupported type ${type}`);
    const output: LiveOutput = p['output'] === 'm3u8' || p['output'] === 'hls' ? 'm3u8' : 'ts';
    return reply
      .type('audio/x-mpegurl; charset=utf-8')
      .header('content-disposition', `attachment; filename="tv_channels_${type}.m3u"`)
      .send(buildPlaylist(state, request, account, type === 'm3u_plus', output));
  });
}
