// Subtitle files beside a film or an episode (RELAY step 20b2b): what a request's
// `externalSubs` point at, for the player's overlay. Panels have no standard path for them, so
// this one is the mock's own, with the account in it like a stream URL:
//
//   /subtitles/<u>/<p>/<id>.<lang>.<srt|vtt>[?charset=windows-1256]
//
// `lang` is `eng` or `ara`; the cues are the media generator's `srtText` (a cue every 5 s naming
// its own start) for the item's catalog duration. `charset=windows-1256` sends an old Arabic
// file in that code page (digits as ASCII: the code page has no Arabic-Indic ones), for the
// app's charset fallback. Faults apply as on any provider path.

import type { FastifyInstance } from 'fastify';
import { srtText } from './media-plan';
import type { MockState } from './state';
import { findAccount } from './state';

const TEXT = 'text/plain; charset=utf-8';

/** A Windows-1256 byte for each character the code page has above ASCII. */
let code1256: Map<string, number> | null = null;

function windows1256(): Map<string, number> {
  if (code1256 === null) {
    const decoder = new TextDecoder('windows-1256');
    code1256 = new Map();
    for (let b = 0x80; b <= 0xff; b++) code1256.set(decoder.decode(Uint8Array.of(b)), b);
  }
  return code1256;
}

/** `text` in Windows-1256: Arabic-Indic digits as ASCII ones, anything else it lacks as `?`. */
export function encode1256(text: string): Buffer {
  const map = windows1256();
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code >= 0x660 && code <= 0x669) out.push(0x30 + code - 0x660);
    else out.push(map.get(ch) ?? 0x3f);
  }
  return Buffer.from(out);
}

/** The SRT as WebVTT: the header, and `.` before the milliseconds. */
export function srtToVtt(srt: string): string {
  return `WEBVTT\n\n${srt.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2')}`;
}

const FILE = /^(\d+)\.(eng|ara)\.(srt|vtt)$/;

export function registerSubtitleFiles(app: FastifyInstance, state: MockState): void {
  app.get<{ Params: { u: string; p: string; file: string }; Querystring: { charset?: string } }>('/subtitles/:u/:p/:file', async (request, reply) => {
    const { u, p, file } = request.params;
    if (!findAccount(state, u, p)) return reply.code(401).type(TEXT).send('Unauthorized');
    const m = FILE.exec(file);
    const id = m === null ? NaN : Number(m[1]);
    const movie = state.catalog.movies.find((item) => item.id === id);
    const episode = state.catalog.series.flatMap((s) => s.seasons.flatMap((season) => season.episodes)).find((e) => e.id === id);
    const durationSecs = movie?.durationSecs ?? episode?.durationSecs;
    if (m === null || durationSecs === undefined) return reply.code(404).type(TEXT).send('No such subtitle file');
    const lang = m[2] as 'eng' | 'ara';
    const srt = srtText(lang, durationSecs);
    const text = m[3] === 'vtt' ? srtToVtt(srt) : srt;
    if (request.query.charset === 'windows-1256') return reply.type(`text/plain; charset=windows-1256`).send(encode1256(text));
    return reply.type(m[3] === 'vtt' ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8').send(text);
  });
}
