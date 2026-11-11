// The lab's scale source (RELAY step 15b, spike S6): `/__lab/source` hands the lab the mock's
// test account as an M3U URL and a guide moved to the TV's days.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account } from '../src/config';
import { MAX_SHIFT_DAYS, RangeScanner, XmltvShifter, labAccount, shiftDaysFor, shiftXmltvDigits, xmltvDigitsMs } from '../src/lab-source';
import { NOW, P, U, mock } from './helpers';

const DAY = 86_400_000;

function programme(start: string, stop: string, channel = 'scale.1'): string {
  return `<programme start="${start} +0300" stop="${stop} +0300" channel="${channel}"><title>Évening &amp; نشرة</title></programme>\n`;
}

/** A guide from 2026-10-25 to 2026-11-08 (UTC digits), the shape of the scale fixture's 14 days. */
const GUIDE = [
  '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n<channel id="scale.1"><display-name>Scale 1</display-name></channel>\n',
  programme('20261025000000', '20261025060000'),
  programme('20261031220000', '20261101013000'),
  programme('20261107180000', '20261108000000'),
  '</tv>\n',
].join('');

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lablo-lab-source-'));
  writeFileSync(join(dir, 'guide.xml.gz'), gzipSync(GUIDE));
  writeFileSync(join(dir, 'guide.xml'), GUIDE);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('moving XMLTV times by whole days', () => {
  it('reads the digits as a UTC instant and rejects what is not a date', () => {
    expect(xmltvDigitsMs('20261101013000')).toBe(Date.UTC(2026, 10, 1, 1, 30, 0));
    expect(xmltvDigitsMs('20261301000000')).toBeNull();
    expect(xmltvDigitsMs('20261100000000')).toBeNull();
    expect(xmltvDigitsMs('20261101240000')).toBeNull();
  });

  it('crosses month and year ends, and back', () => {
    expect(shiftXmltvDigits('20261030120000', 3)).toBe('20261102120000');
    expect(shiftXmltvDigits('20261230235959', 2)).toBe('20270101235959');
    expect(shiftXmltvDigits('20280301000000', -1)).toBe('20280229000000');
    expect(shiftXmltvDigits('20261101000000', 0)).toBe('20261101000000');
    // Not a date: left as written.
    expect(shiftXmltvDigits('99999999999999', 5)).toBe('99999999999999');
  });

  it('moves every start and stop, keeps the offsets and the rest of the text, however the text is cut', () => {
    const whole = new XmltvShifter(4);
    const expected = whole.push(GUIDE) + whole.end();
    expect(expected).toContain('start="20261029000000 +0300" stop="20261029060000 +0300"');
    expect(expected).toContain('start="20261111180000 +0300" stop="20261112000000 +0300"');
    expect(expected.replace(/\d{14}/g, '')).toBe(GUIDE.replace(/\d{14}/g, ''));
    for (let size = 1; size <= 40; size += 1) {
      const shifter = new XmltvShifter(4);
      let out = '';
      for (let at = 0; at < GUIDE.length; at += size) out += shifter.push(GUIDE.slice(at, at + size));
      out += shifter.end();
      expect(out, `pieces of ${size}`).toBe(expected);
    }
  });

  it('finds the range however the text is cut, and the whole days that centre it on a day', () => {
    for (const size of [1, 7, 23, GUIDE.length]) {
      const scanner = new RangeScanner();
      for (let at = 0; at < GUIDE.length; at += size) scanner.push(GUIDE.slice(at, at + size));
      expect(scanner.result(), `pieces of ${size}`).toEqual({ from: Date.UTC(2026, 9, 25), to: Date.UTC(2026, 10, 8) });
    }
    expect(new RangeScanner().result()).toBeNull();
    const range = { from: Date.UTC(2026, 9, 25), to: Date.UTC(2026, 10, 8) };
    // The middle is 2026-11-01 00:00.
    expect(shiftDaysFor(range, Date.UTC(2026, 10, 1, 11))).toBe(0);
    expect(shiftDaysFor(range, Date.UTC(2026, 10, 4, 15))).toBe(4);
    expect(shiftDaysFor(range, Date.UTC(2026, 9, 20))).toBe(-12);
    expect(shiftDaysFor(range, Date.UTC(2126, 0, 1))).toBe(MAX_SHIFT_DAYS);
  });
});

describe('the account the lab uses', () => {
  const account = (over: Partial<Account>): Account => ({
    username: 'a',
    password: 'b',
    status: 'Active',
    expDays: null,
    createdDaysAgo: 1,
    isTrial: false,
    maxConnections: 1,
    activeCons: 0,
    overLimitStatus: 403,
    outputFormats: ['m3u8', 'ts'],
    message: '',
    ...over,
  });

  it('is the first active one that has not expired and may connect', () => {
    expect(labAccount([account({ username: 'x', status: 'Banned' }), account({ username: 'y', expDays: 0 }), account({ username: 'z', maxConnections: 0 }), account({ username: 'ok', expDays: 3 })])?.username).toBe('ok');
    expect(labAccount([account({ status: 'Expired' })])).toBeNull();
  });
});

describe('/__lab/source and /__lab/guide.xml.gz', () => {
  it("hands out the test account's M3U and the generated guide moved to the TV's day", async () => {
    const app = await mock();
    try {
      const around = NOW + 9 * DAY;
      const res = await app.inject({ method: 'GET', url: `/__lab/source?around=${around}`, headers: { host: 'lab.test:8080' } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['cache-control']).toBe('no-store');
      const source = res.json<{ m3u: string; items: number; live: number; guide: { url: string; static: boolean; bytes: number; gzBytes: number; shiftDays: number; from: string; to: string } }>();
      expect(source.m3u).toBe(`http://lab.test:8080/get.php?username=${U}&password=${P}&type=m3u_plus`);
      // The playlist lists exactly that many entries.
      const m3u = await app.inject({ method: 'GET', url: `/get.php?username=${U}&password=${P}&type=m3u_plus` });
      expect(m3u.body.split('\n').filter((l) => l.startsWith('#EXTINF')).length).toBe(source.items);
      expect(source.live).toBe(app.mockState.catalog.live.length);
      expect(source.guide).toMatchObject({ url: `http://lab.test:8080/__lab/guide.xml.gz?days=${source.guide.shiftDays}`, static: false });
      // The generated guide is built around the mock's clock; moved, around the TV's.
      expect(source.guide.shiftDays).toBe(9);
      const unmoved = await app.inject({ method: 'GET', url: '/__lab/source', headers: { host: 'lab.test:8080' } });
      const at = unmoved.json<{ guide: { shiftDays: number; from: string; to: string } }>().guide;
      expect(at.shiftDays).toBe(0);
      expect(Date.parse(source.guide.from) - Date.parse(at.from)).toBe(9 * DAY);
      expect(Date.parse(source.guide.to) - Date.parse(at.to)).toBe(9 * DAY);
      expect(Date.parse(at.from)).toBeLessThan(NOW);
      expect(Date.parse(at.to)).toBeGreaterThan(NOW);

      const guide = await app.inject({ method: 'GET', url: `/__lab/guide.xml.gz?days=${source.guide.shiftDays}`, headers: { host: 'lab.test:8080' } });
      expect(guide.statusCode).toBe(200);
      expect(guide.headers['content-type']).toBe('application/gzip');
      expect(guide.rawPayload.length).toBe(source.guide.gzBytes);
      const text = gunzipSync(guide.rawPayload).toString('utf8');
      expect(Buffer.byteLength(text, 'utf8')).toBe(source.guide.bytes);
      const original = await app.inject({ method: 'GET', url: '/epg/guide.xml', headers: { host: 'lab.test:8080' } });
      expect(text.replace(/\d{14}/g, '')).toBe(original.body.replace(/\d{14}/g, ''));
      expect(text).not.toBe(original.body);
    } finally {
      await app.close();
    }
  });

  it('moves the --xmltv guide (plain or gzipped) so its middle lands on the TV’s day, built before the answer', async () => {
    for (const file of ['guide.xml.gz', 'guide.xml']) {
      const app = await mock({ xmltvFile: join(dir, file) });
      try {
        const res = await app.inject({ method: 'GET', url: `/__lab/source?around=${Date.UTC(2026, 10, 4, 15)}` });
        const { guide } = res.json<{ guide: { url: string; static: boolean; bytes: number; gzBytes: number; shiftDays: number; from: string; to: string } }>();
        expect(guide).toMatchObject({ static: true, bytes: Buffer.byteLength(GUIDE, 'utf8'), shiftDays: 4, from: '2026-10-29T00:00:00.000Z', to: '2026-11-12T00:00:00.000Z' });
        const body = await app.inject({ method: 'GET', url: `/__lab/guide.xml.gz?days=4` });
        expect(body.rawPayload.length).toBe(guide.gzBytes);
        const text = gunzipSync(body.rawPayload).toString('utf8');
        const shifter = new XmltvShifter(4);
        expect(text).toBe(shifter.push(GUIDE) + shifter.end());
        // Another shift is built when asked for.
        const back = await app.inject({ method: 'GET', url: '/__lab/guide.xml.gz?days=-2' });
        expect(gunzipSync(back.rawPayload).toString('utf8')).toContain('start="20261023000000 +0300"');
      } finally {
        await app.close();
      }
    }
  });

  it('rejects bad parameters and answers without an active account', async () => {
    const app = await mock();
    try {
      expect((await app.inject({ method: 'GET', url: '/__lab/source?around=soon' })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: '/__lab/guide.xml.gz?days=1.5' })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: `/__lab/guide.xml.gz?days=${MAX_SHIFT_DAYS + 1}` })).statusCode).toBe(400);
      expect((await app.inject({ method: 'GET', url: `/__lab/guide.xml.gz?days=-${MAX_SHIFT_DAYS}` })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
    const none = await mock();
    try {
      for (const a of none.mockState.fixture.accounts) (a as { status: string }).status = 'Banned';
      const res = await none.inject({ method: 'GET', url: '/__lab/source' });
      expect([res.statusCode, res.body]).toEqual([503, 'No active test account in server.yaml']);
    } finally {
      await none.close();
    }
  });
});
