import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockServer } from '../src/server';
import { encode1256, srtToVtt } from '../src/subtitle-files';
import { P, U, mock } from './helpers';

/**
 * The mock's subtitle files beside a film or an episode (RELAY step 20b2b). The mock imports
 * nothing internal, so these check the text itself; test/subtitles-mock.test.ts parses it.
 */

let app: MockServer;
beforeAll(async () => {
  app = await mock();
});
afterAll(async () => {
  await app.close();
});

const get = (url: string) => app.inject({ method: 'GET', url });

describe('GET /subtitles/:u/:p/:file', () => {
  it("serves a film's English SRT, a cue every 5 s for its catalog duration (206: 120 s)", async () => {
    const res = await get(`/subtitles/${U}/${P}/206.eng.srt`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-subrip; charset=utf-8');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body.indexOf('1\n00:00:00,000 --> 00:00:04,000\nEnglish subtitle 00:00\n')).toBe(0);
    expect(res.body.endsWith('24\n00:01:55,000 --> 00:01:59,000\nEnglish subtitle 01:55\n')).toBe(true);
  });

  it("serves WebVTT, and an episode's file", async () => {
    const vtt = await get(`/subtitles/${U}/${P}/206.ara.vtt`);
    expect(vtt.headers['content-type']).toBe('text/vtt; charset=utf-8');
    expect(vtt.body.indexOf('WEBVTT\n\n1\n00:00:00.000 --> 00:00:04.000\n')).toBe(0);
    expect(vtt.body).toContain(`00:00:05.000 --> 00:00:09.000\nترجمة عربية ${String.fromCharCode(0x660, 0x660)}:${String.fromCharCode(0x660, 0x665)}\n`);
    const episode = await get(`/subtitles/${U}/${P}/3001.eng.srt`);
    expect(episode.statusCode).toBe(200);
  });

  it('sends an old Arabic file in Windows-1256 on request', async () => {
    const res = await get(`/subtitles/${U}/${P}/206.ara.srt?charset=windows-1256`);
    expect(res.headers['content-type']).toBe('text/plain; charset=windows-1256');
    const text = new TextDecoder('windows-1256').decode(res.rawPayload);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(res.rawPayload)).toThrow();
    expect(text).toContain('00:00:05,000 --> 00:00:09,000\nترجمة عربية 00:05\n');
  });

  it('refuses unknown accounts, items, languages and formats', async () => {
    expect((await get(`/subtitles/${U}/wrong/206.eng.srt`)).statusCode).toBe(401);
    expect((await get(`/subtitles/${U}/${P}/999.eng.srt`)).statusCode).toBe(404);
    expect((await get(`/subtitles/${U}/${P}/101.eng.srt`)).statusCode).toBe(404);
    expect((await get(`/subtitles/${U}/${P}/206.fra.srt`)).statusCode).toBe(404);
    expect((await get(`/subtitles/${U}/${P}/206.eng.ass`)).statusCode).toBe(404);
  });

  it('applies faults like any provider path', async () => {
    expect((await get(`/subtitles/${U}/${P}/206.eng.srt?mock_fault=status:404`)).statusCode).toBe(404);
  });
});

describe('encode1256 and srtToVtt', () => {
  it('writes Arabic letters in the code page, Arabic-Indic digits as ASCII, and ? for what it lacks', () => {
    const word = String.fromCharCode(0x627, 0x644, 0x633, 0x644, 0x627, 0x645);
    expect([...encode1256(`${word} ${String.fromCharCode(0x661, 0x669)} A`)]).toEqual([0xc7, 0xe1, 0xd3, 0xe1, 0xc7, 0xe3, 0x20, 0x31, 0x39, 0x20, 0x41]);
    expect([...encode1256(String.fromCharCode(0x4e2d))]).toEqual([0x3f]);
  });

  it('turns an SRT into WebVTT', () => {
    expect(srtToVtt('1\n00:00:01,500 --> 00:00:02,000\nHi\n')).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.000\nHi\n');
  });
});
