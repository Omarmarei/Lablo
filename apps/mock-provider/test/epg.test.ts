import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/config';
import { epgWindow, hasArchive, programmes, upcoming } from '../src/epg';
import type { MockServer } from '../src/server';
import {
  formatDuration,
  formatSqlTime,
  formatXmltvTime,
  parseTimeshiftStart,
  zonedParts,
  zonedToEpoch,
} from '../src/time';
import { escapeXml } from '../src/xmltv';
import { NOW, mock } from './helpers';

let app: MockServer | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const HOUR = 3_600_000;
const channel = (id: number) => loadCatalog().live.find((c) => c.id === id)!;

describe('xmltv.php and /epg/guide.xml', () => {
  it('lists each EPG channel once, then contiguous programmes for the whole window', async () => {
    app = await mock();
    const res = await app.inject({ url: '/xmltv.php?username=zoma&password=zoma-test', headers: { host: 'tv-lab.local:8080' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
    const xml = res.body;
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv ')).toBe(true);
    expect(xml.trimEnd().endsWith('</tv>')).toBe(true);
    const ids = [...xml.matchAll(/<channel id="([^"]+)">/g)].map((m) => m[1]);
    // 101 and 112 share zoma.test1; 107 and 109 have no EPG; 105 uses its xmltv_id.
    expect(ids).toEqual(['zoma.test1', 'zoma.test2', 'zoma.ar3', 'zoma.ar4', 'zoma.kids', 'zoma.sports', 'zoma.radio', 'zoma.fr', 'zoma.es']);
    expect(xml).toContain('<display-name>زوما تجريبي ٣</display-name>');
    expect(xml).toContain('<icon src="http://tv-lab.local:8080/images/channel-101.png" />');
    expect(xml).not.toContain('channel-108.png');

    const test1 = [...xml.matchAll(/<programme start="(\d{14}) \+0000" stop="(\d{14}) \+0000" channel="zoma\.test1">/g)];
    expect(test1).toHaveLength(240);
    expect(test1[0]?.[1]).toBe('20261026120000');
    expect(test1.at(-1)?.[2]).toBe('20261105120000');
    for (let i = 1; i < test1.length; i++) expect(test1[i]?.[1]).toBe(test1[i - 1]?.[2]);
    expect(xml).toMatch(/<title lang="ar">[^<]+<\/title>/);
    expect(xml).toMatch(/<desc lang="en">Test programme \d+ on Zoma Test 1 SMPTE\.<\/desc>/);
  });

  it('serves the same guide without credentials, plain and gzipped', async () => {
    app = await mock();
    const panel = (await app.inject({ url: '/xmltv.php?username=zoma&password=zoma-test' })).body;
    const plain = await app.inject({ url: '/epg/guide.xml' });
    expect(plain.statusCode).toBe(200);
    expect(plain.body).toBe(panel);
    const gz = await app.inject({ url: '/epg/guide.xml.gz' });
    expect(gz.statusCode).toBe(200);
    expect(gz.headers['content-type']).toBe('application/gzip');
    expect(gz.headers['content-encoding']).toBeUndefined();
    expect(gunzipSync(gz.rawPayload).toString('utf8')).toBe(panel);
  });

  it('rejects bad credentials and inactive accounts', async () => {
    app = await mock();
    expect((await app.inject({ url: '/xmltv.php?username=zoma&password=x' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/xmltv.php?username=disabled&password=disabled-test' })).statusCode).toBe(403);
  });

  it('escapes XML special characters', () => {
    expect(escapeXml(`Tom & Jerry <"live"> 'HD'`)).toBe('Tom &amp; Jerry &lt;&quot;live&quot;&gt; &apos;HD&apos;');
  });
});

describe('programme schedule', () => {
  it('is deterministic: the same slot gives the same programme for any "now"', () => {
    const c = channel(102); // 45-minute slots
    const a = programmes(c, NOW - 6 * HOUR, NOW);
    const b = programmes(c, NOW - 3 * HOUR, NOW + 3 * HOUR);
    const shared = a.filter((p) => b.some((q) => q.index === p.index));
    expect(shared.length).toBeGreaterThan(2);
    for (const p of shared) expect(b.find((q) => q.index === p.index)).toEqual(p);
    expect(a.every((p) => p.stop - p.start === 45 * 60_000)).toBe(true);
  });

  it('starts upcoming() with the programme on air', () => {
    const c = channel(103); // 90-minute slots
    const [current, next] = upcoming(c, NOW, 2);
    expect(current!.start).toBeLessThanOrEqual(NOW);
    expect(current!.stop).toBeGreaterThan(NOW);
    expect(next!.start).toBe(current!.stop);
  });

  it('has no programmes for a channel without an EPG id', () => {
    expect(programmes(channel(107), NOW - HOUR, NOW + HOUR)).toEqual([]);
    expect(upcoming(channel(107), NOW, 4)).toEqual([]);
  });

  it('marks only finished programmes inside the archive as replayable', () => {
    const c = channel(105); // 1 archive day
    const { from, to } = epgWindow(c, NOW, 3);
    const list = programmes(c, from, to);
    const replayable = list.filter((p) => hasArchive(c, p, NOW));
    expect(replayable.length).toBe(24);
    expect(replayable.every((p) => p.stop <= NOW && p.start >= NOW - 24 * HOUR)).toBe(true);
  });
});

describe('time zones', () => {
  it('reports wall time and offset in any zone', () => {
    expect(zonedParts(NOW, 'Asia/Kathmandu')).toMatchObject({ hour: 17, minute: 45, offsetMinutes: 345 });
    expect(zonedParts(NOW, 'America/St_Johns')).toMatchObject({ hour: 8, minute: 30, offsetMinutes: -210 });
    expect(formatSqlTime(NOW, 'Asia/Riyadh')).toBe('2026-11-02 15:00:00');
  });

  it('writes XMLTV times in every offset style', () => {
    expect(formatXmltvTime(NOW, 'Asia/Kathmandu', 'utc')).toBe('20261102120000 +0000');
    expect(formatXmltvTime(NOW, 'Asia/Kathmandu', 'local')).toBe('20261102174500 +0545');
    expect(formatXmltvTime(NOW, 'Asia/Kathmandu', 'none')).toBe('20261102174500');
    expect(formatXmltvTime(NOW, 'America/St_Johns', 'colon')).toBe('20261102083000 -03:30');
  });

  it('converts wall time back to an instant, across a DST change', () => {
    // New York left DST on 2026-11-01 at 02:00 local.
    expect(zonedToEpoch(2026, 10, 31, 12, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 9, 31, 16, 0, 0));
    expect(zonedToEpoch(2026, 11, 2, 12, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 10, 2, 17, 0, 0));
    expect(zonedToEpoch(2026, 11, 2, 17, 45, 0, 'Asia/Kathmandu')).toBe(NOW);
  });

  it('parses Xtream timeshift starts and rejects malformed ones', () => {
    expect(parseTimeshiftStart('2026-11-02:12-00', 'UTC')).toBe(NOW);
    expect(parseTimeshiftStart('2026-11-02:15-00', 'Asia/Riyadh')).toBe(NOW);
    for (const bad of ['2026-11-02 12:00', '2026-11-02:12:00', '2026-13-02:12-00', '2026-11-02:24-00', '']) {
      expect(parseTimeshiftStart(bad, 'UTC'), bad).toBeNull();
    }
  });

  it('formats durations', () => {
    expect(formatDuration(596)).toBe('00:09:56');
    expect(formatDuration(3 * 3600 + 5)).toBe('03:00:05');
  });
});
