// Checks core's streaming XMLTV tokenizer against the fixture generator's guide structure: every
// channel in order with its two display names and icon, then each channel's programmes as one
// contiguous schedule from the guide's first instant to past its last. Each channel writes its
// times with its own offset (-0800 … +0530), so a misread offset breaks the schedule. Streaming:
// it keeps per-channel state only, so the 300 MB guide checks in constant memory.

import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { XmltvItem, XmltvStats } from '@lablo/core';
import { XmltvTokenizer, parseXmltvTime } from '@lablo/core';
import { expect } from 'vitest';
import { epgId } from '../src/catalog';
import type { XmltvSpec } from '../src/xmltv';
import { XMLTV_ANCHOR_MS, XMLTV_DAYS, programmeCount } from '../src/xmltv';

const FROM = XMLTV_ANCHOR_MS - 7 * 86_400_000;
const TO = FROM + XMLTV_DAYS * 86_400_000;

export interface XmltvCheck {
  stats: XmltvStats;
  ms: number;
  /** Programmes whose English second title won (languages: ['en']). */
  englishTitles: number;
  cdataDescs: number;
  subTitles: number;
}

class GuideChecker {
  private nextChannel = 0;
  private programmeChannel = -1;
  private expectedStart = FROM;
  private slotMs = 0;
  private lastStop = 0;
  englishTitles = 0;
  cdataDescs = 0;
  subTitles = 0;

  constructor(private readonly spec: XmltvSpec) {}

  add(item: XmltvItem): void {
    if (item.type === 'channel') {
      const k = this.nextChannel++;
      if (item.id !== epgId(k) || item.names.length !== 2 || item.names[1] !== `CH ${k}` || item.icon !== `http://127.0.0.1:8080/images/channel-${k}.png`) {
        expect({ k, item }).toEqual({ k, item: { id: epgId(k), names: ['…', `CH ${k}`] } });
      }
      return;
    }
    const start = parseXmltvTime(item.start);
    const stop = item.stop === null ? null : parseXmltvTime(item.stop);
    if (item.channel !== epgId(this.programmeChannel)) {
      this.endChannel();
      this.programmeChannel++;
      this.expectedStart = FROM;
      this.slotMs = stop !== null && start !== null ? stop - start : 0;
    }
    const ok =
      item.channel === epgId(this.programmeChannel) &&
      start === this.expectedStart &&
      stop === start + this.slotMs &&
      this.slotMs > 0 &&
      /^.+ \d+$/.test(item.title) &&
      (item.desc === null || item.desc.indexOf('&amp;') === -1) &&
      (item.subTitle === null || /^"\d+" & more$/.test(item.subTitle));
    if (!ok) expect({ channel: this.programmeChannel, item, start, stop }).toEqual({ channel: this.programmeChannel, item, start: this.expectedStart, stop: this.expectedStart + this.slotMs });
    if (/^[\x20-\x7e]+$/.test(item.title) && this.programmeChannel % 4 !== 0) this.englishTitles++;
    if (item.desc !== null && item.desc.indexOf('<b>bold</b>') !== -1) this.cdataDescs++;
    if (item.subTitle !== null) this.subTitles++;
    this.expectedStart = stop!;
    this.lastStop = stop!;
  }

  private endChannel(): void {
    if (this.programmeChannel < 0) return;
    // The schedule covers the whole guide: the last programme runs past its end.
    if (!(this.lastStop >= TO && this.lastStop - this.slotMs < TO)) expect({ channel: this.programmeChannel, lastStop: this.lastStop }).toEqual({ channel: this.programmeChannel, lastStop: TO });
  }

  finish(): void {
    this.endChannel();
    expect(this.nextChannel).toBe(this.spec.channels);
    expect(this.programmeChannel + 1).toBe(this.spec.channels);
  }
}

/** Streams a generated guide (.xml or .xml.gz) through the tokenizer and checks it. */
export async function checkXmltvFixture(path: string, spec: XmltvSpec, chunkBytes = 64 * 1024): Promise<XmltvCheck> {
  const t0 = performance.now();
  const checker = new GuideChecker(spec);
  const tokenizer = new XmltvTokenizer({ languages: ['en'] });
  const decoder = new TextDecoder();
  const file = createReadStream(path, { highWaterMark: chunkBytes });
  const stream = path.endsWith('.gz') ? file.pipe(createGunzip({ chunkSize: chunkBytes })) : file;
  for await (const chunk of stream) for (const item of tokenizer.push(decoder.decode(chunk as Buffer, { stream: true }))) checker.add(item);
  for (const item of tokenizer.push(decoder.decode())) checker.add(item);
  for (const item of tokenizer.end()) checker.add(item);
  checker.finish();
  expect(tokenizer.stats).toEqual({
    channels: spec.channels,
    programmes: programmeCount(spec),
    filtered: 0,
    invalid: 0,
    lateChannels: 0,
    cutTexts: tokenizer.stats.cutTexts,
    malformed: 0,
    truncated: false,
  });
  return { stats: tokenizer.stats, ms: performance.now() - t0, englishTitles: checker.englishTitles, cdataDescs: checker.cdataDescs, subTitles: checker.subTitles };
}
