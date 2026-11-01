// XMLTV: `xmltv.php` (credentials, like a panel) plus a credential-free `/epg/guide.xml` and
// `/epg/guide.xml.gz`, the shape of a standalone EPG URL. The `timezone` fault changes how
// start/stop offsets are written; `gzip` serves the panel endpoint compressed.

import { gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { epgWindow, programmes } from './epg';
import { authorizeText } from './playlist';
import type { MockState } from './state';
import { baseUrl, imageUrl, requestTz } from './state';
import { formatXmltvTime } from './time';

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

export function buildXmltv(state: MockState, request: FastifyRequest): string {
  const tz = requestTz(state, request);
  const style = request.mock?.xmltv ?? 'utc';
  const now = state.now();
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
    `<tv generator-info-name="Zoma mock provider" generator-info-url="${escapeXml(baseUrl(request))}/">`,
  ];
  // Channels sharing an EPG id (duplicates in the playlist) appear once.
  const seen = new Set<string>();
  const channels = state.catalog.live.filter((c) => {
    const id = c.xmltvId ?? c.epgId;
    if (id === null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const c of channels) {
    const id = escapeXml(c.xmltvId ?? c.epgId ?? '');
    out.push(`  <channel id="${id}">`, `    <display-name>${escapeXml(c.name)}</display-name>`);
    if (c.logo) out.push(`    <icon src="${escapeXml(imageUrl(request, `channel-${c.id}`))}" />`);
    out.push('  </channel>');
  }
  for (const c of channels) {
    const id = escapeXml(c.xmltvId ?? c.epgId ?? '');
    const { from, to } = epgWindow(c, now, state.fixture.server.epgFutureDays);
    for (const p of programmes(c, from, to)) {
      out.push(
        `  <programme start="${formatXmltvTime(p.start, tz, style)}" stop="${formatXmltvTime(p.stop, tz, style)}" channel="${id}">`,
        `    <title lang="${p.lang}">${escapeXml(p.title)}</title>`,
        `    <desc lang="${p.lang}">${escapeXml(p.description)}</desc>`,
        `    <category lang="${p.lang}">${escapeXml(p.category)}</category>`,
        '  </programme>',
      );
    }
  }
  out.push('</tv>', '');
  return out.join('\n');
}

export function registerXmltv(app: FastifyInstance, state: MockState): void {
  app.get('/xmltv.php', async (request, reply) => {
    const account = authorizeText(state, request, reply);
    if (!account) return reply;
    return reply.type('application/xml; charset=utf-8').send(buildXmltv(state, request));
  });
  app.get('/epg/guide.xml', async (request, reply) => reply.type('application/xml; charset=utf-8').send(buildXmltv(state, request)));
  app.get('/epg/guide.xml.gz', async (request, reply) =>
    reply.type('application/gzip').send(gzipSync(Buffer.from(buildXmltv(state, request), 'utf8'))),
  );
}
