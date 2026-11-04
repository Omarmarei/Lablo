// RELAY step 20b2a: core's subtitle parser against the mock provider's own SRT writer
// (apps/mock-provider/src/media-plan.ts `srtText`, the subtitles muxed into the VOD fixtures and,
// from step 20b2b, served as external files). The mock imports nothing from core, so what its
// cues say is an independent oracle: a cue every 5 s, 4 s long, naming its own start ("English
// subtitle 01:05", or the Arabic with Arabic-Indic digits). This file sits in the root test/
// folder because core and the mock are separate boundary elements.

import { SubtitleParser, SubtitleTrack, parseSubtitles } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import { srtText } from '../apps/mock-provider/src/media-plan';

const ARABIC_INDIC_ZERO = 0x660;

/** The start, in seconds, that a mock cue's text names; -1 when the text isn't one. */
function namedStart(text: string, lang: 'ara' | 'eng'): number {
  const prefix = lang === 'ara' ? 'ترجمة عربية ' : 'English subtitle ';
  if (text.slice(0, prefix.length) !== prefix) return -1;
  let clock = '';
  for (const ch of text.slice(prefix.length)) {
    const code = ch.charCodeAt(0);
    clock += lang === 'ara' && code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9 ? String(code - ARABIC_INDIC_ZERO) : ch;
  }
  const match = /^(\d\d):(\d\d)$/.exec(clock);
  return match === null ? -1 : Number(match[1]) * 60 + Number(match[2]);
}

describe('the subtitle parser on the mock provider’s SRT', () => {
  for (const lang of ['eng', 'ara'] as const) {
    for (const durationSecs of [1, 63, 300]) {
      it(`reads every cue of a ${durationSecs} s ${lang} file, each naming its own start`, () => {
        const parsed = parseSubtitles(srtText(lang, durationSecs));
        expect(parsed.format).toBe('srt');
        expect(parsed.stats).toMatchObject({ badTimings: 0, junk: 0, emptyCues: 0, overlongLines: 0, droppedCues: 0 });
        expect(parsed.cues).toHaveLength(Math.ceil(durationSecs / 5));
        parsed.cues.forEach((cue, i) => {
          expect(cue.startMs).toBe(i * 5000);
          expect(cue.endMs).toBe(Math.min(i * 5000 + 4000, durationSecs * 1000));
          expect(namedStart(cue.text, lang)).toBe(i * 5);
        });
      });
    }

    it(`shows the ${lang} cue for the first 4 s of every 5, read in 7-character chunks`, () => {
      const text = srtText(lang, 63);
      const parser = new SubtitleParser();
      const cues = [];
      for (let i = 0; i < text.length; i += 7) cues.push(...parser.push(text.slice(i, i + 7)));
      cues.push(...parser.end());
      const track = new SubtitleTrack(cues);
      for (let ms = 0; ms < 63_000; ms += 250) {
        const shown = track.cuesAt(ms);
        const inCue = ms % 5000 < 4000;
        expect(shown.length).toBe(inCue ? 1 : 0);
        if (inCue) expect(namedStart(shown[0]!.text, lang)).toBe(Math.floor(ms / 5000) * 5);
      }
    });
  }
});
