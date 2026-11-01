import { describe, expect, it } from 'vitest';
import { LoopChannel, PTS_WRAP, TsError, listContinuity, rewriteSegment, scanSegment } from '../src/ts-rewrite';
import { AUDIO_PID, PACKET, VIDEO_PID, packet, syntheticSegment, timestamps } from './ts-helpers';

const SEG = 6 * 90_000;
const loop = (n = 3, origin = 126_000): LoopChannel => new LoopChannel(Array.from({ length: n }, (_, i) => syntheticSegment(i, origin)), 6);

describe('scanSegment', () => {
  it('counts payload packets per PID and finds the earliest timestamp', () => {
    const scan = scanSegment(syntheticSegment(0));
    expect(scan.packets).toBe(2 + 6 * 4);
    expect(scan.payloadPackets.get(0)).toBe(1);
    expect(scan.payloadPackets.get(VIDEO_PID)).toBe(12); // the PCR-only packet has no payload
    expect(scan.payloadPackets.get(AUDIO_PID)).toBe(12);
    expect(scan.minTimestamp).toBe(126_000);
  });

  it('rejects broken input', () => {
    expect(() => scanSegment(Buffer.alloc(0))).toThrow(TsError);
    expect(() => scanSegment(Buffer.alloc(PACKET + 1, 0x47))).toThrow(/multiple of 188/);
    const bad = syntheticSegment(0);
    bad[PACKET] = 0x00;
    expect(() => scanSegment(bad)).toThrow(/No sync byte at offset 188/);
    expect(() => new LoopChannel([], 6)).toThrow(/at least one segment/);
    expect(() => new LoopChannel([packet({ pid: 0, psi: true })], 6)).toThrow(/no PTS/);
  });
});

describe('rewriteSegment', () => {
  it('shifts PTS, DTS and PCR by the offset and leaves the input untouched', () => {
    const seg = syntheticSegment(0);
    const copy = Buffer.from(seg);
    const out = rewriteSegment(seg, 1_000_000, new Map());
    expect(seg.equals(copy)).toBe(true);
    const before = timestamps(seg);
    const after = timestamps(out);
    expect(after).toHaveLength(before.length);
    before.forEach((b, i) => {
      const a = after[i]!;
      if (b.pts !== undefined) expect(a.pts).toBe(b.pts + 1_000_000);
      if (b.dts !== undefined) expect(a.dts).toBe(b.dts + 1_000_000);
      if (b.pcr !== undefined) expect(a.pcr).toBe(b.pcr + 1_000_000);
    });
  });

  it('wraps at 2^33 and handles negative offsets', () => {
    const seg = syntheticSegment(0);
    const wrapped = timestamps(rewriteSegment(seg, PTS_WRAP - 126_000, new Map()));
    expect(wrapped[0]!.pcr).toBe(0);
    expect(wrapped.find((t) => t.dts !== undefined)!.dts).toBe(0);
    const back = timestamps(rewriteSegment(seg, -126_000 - 1, new Map()));
    expect(back[0]!.pcr).toBe(PTS_WRAP - 1);
  });

  it('numbers continuity counters from the given state; packets without payload repeat the last', () => {
    const counters = new Map([[VIDEO_PID, 30]]);
    const out = rewriteSegment(syntheticSegment(0), 0, counters);
    const video = listContinuity(out).get(VIDEO_PID)!;
    expect(video[0]).toEqual({ cc: 29 % 16, payload: false });
    expect(video.slice(1, 4).map((v) => v.cc)).toEqual([14, 15, 0]);
    expect(counters.get(VIDEO_PID)).toBe(42);
    expect(counters.get(AUDIO_PID)).toBe(12);
  });
});

describe('LoopChannel', () => {
  it('places segment seq at epoch second seq × 6 (modulo 2^33)', () => {
    const l = loop();
    for (const seq of [0, 1, 2, 3, 7, 295_999_999, 296_000_000]) {
      const first = timestamps(l.segment(seq))[0]!;
      expect(first.pcr, `seq ${seq}`).toBe((seq * SEG) % PTS_WRAP);
    }
    expect(l.loopSeconds).toBe(18);
  });

  it('is one continuous stream across segments and laps: monotonic timestamps, gapless counters', () => {
    const l = loop();
    const start = 296_000_000 - 4; // crosses a lap boundary (3-segment loop)
    const stream = Buffer.concat(Array.from({ length: 8 }, (_, i) => l.segment(start + i)));
    const ts = timestamps(stream);
    for (const pid of [VIDEO_PID, AUDIO_PID]) {
      const pts = ts.filter((t) => t.pid === pid && t.pts !== undefined).map((t) => t.pts!);
      expect(pts).toHaveLength(8 * 6);
      for (let i = 1; i < pts.length; i++) expect(pts[i]! - pts[i - 1]!, `${pid} #${i}`).toBe(90_000);
    }
    for (const [pid, list] of listContinuity(stream)) {
      for (let i = 1; i < list.length; i++) {
        const expected = list[i]!.payload ? (list[i - 1]!.cc + 1) % 16 : list[i - 1]!.cc;
        expect(list[i]!.cc, `pid ${pid} packet ${i}`).toBe(expected);
      }
    }
  });

  it('gives the same bytes for a segment whether fetched alone or inside a stream', () => {
    const l = loop();
    const counters = l.countersAt(100);
    const streamed = [100, 101, 102, 103].map((seq) => l.segment(seq, counters));
    [100, 101, 102, 103].forEach((seq, i) => expect(l.segment(seq).equals(streamed[i]!)).toBe(true));
    expect(l.segmentSize(-1)).toBe(syntheticSegment(2).length);
  });
});
