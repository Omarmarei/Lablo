// MPEG-TS rewriting for looped live channels.
//
// A test channel is a short loop of pre-encoded 6 s segments (RELAY step 4). Played back to
// back, a loop would restart its timestamps and continuity counters every lap, which real
// players treat as a broken stream. `LoopChannel` shifts PTS/DTS/PCR and renumbers the
// continuity counters of each segment so that segment `seq` (epoch seconds seq × 6) carries
// timestamps for exactly that time, and any run of segments is one continuous stream. The
// same segment therefore has the same bytes whether it is served as HLS or inside the endless
// TS, and live, HLS and catch-up all agree on the timeline.

export const TS_PACKET_SIZE = 188;
export const TS_CLOCK = 90_000;
/** PTS/DTS/PCR base wrap: 2^33 ticks of 90 kHz (about 26.5 h). */
export const PTS_WRAP = 2 ** 33;
const NULL_PID = 0x1fff;

export class TsError extends Error {
  override name = 'TsError';
}

function readTimestamp(buf: Buffer, o: number): number {
  return (((buf[o]! >> 1) & 0x07) * 2 ** 30) + buf[o + 1]! * 2 ** 22 + (buf[o + 2]! >> 1) * 2 ** 15 + buf[o + 3]! * 2 ** 7 + (buf[o + 4]! >> 1);
}

function writeTimestamp(buf: Buffer, o: number, value: number): void {
  const v = ((value % PTS_WRAP) + PTS_WRAP) % PTS_WRAP;
  const hi = Math.floor(v / 2 ** 30);
  const lo = v % 2 ** 30;
  buf[o] = (buf[o]! & 0xf0) | (hi << 1) | 1;
  buf[o + 1] = (lo >>> 22) & 0xff;
  buf[o + 2] = (((lo >>> 15) & 0x7f) << 1) | 1;
  buf[o + 3] = (lo >>> 7) & 0xff;
  buf[o + 4] = ((lo & 0x7f) << 1) | 1;
}

function readPcrBase(buf: Buffer, o: number): number {
  return buf[o]! * 2 ** 25 + buf[o + 1]! * 2 ** 17 + buf[o + 2]! * 2 ** 9 + buf[o + 3]! * 2 + (buf[o + 4]! >> 7);
}

function writePcrBase(buf: Buffer, o: number, value: number): void {
  const v = ((value % PTS_WRAP) + PTS_WRAP) % PTS_WRAP;
  const top = Math.floor(v / 2); // bits 32..1
  buf[o] = Math.floor(top / 2 ** 24) & 0xff;
  buf[o + 1] = (top >>> 16) & 0xff;
  buf[o + 2] = (top >>> 8) & 0xff;
  buf[o + 3] = top & 0xff;
  buf[o + 4] = ((v % 2) << 7) | (buf[o + 4]! & 0x7f);
}

/** Stream ids whose PES packets have no optional header (and so no PTS/DTS). */
function pesHasHeader(streamId: number): boolean {
  return ![0xbc, 0xbe, 0xbf, 0xf0, 0xf1, 0xf2, 0xf8, 0xff].includes(streamId);
}

interface PacketView {
  pid: number;
  hasPayload: boolean;
  /** Offset of the PCR (6 bytes) in the buffer, if the packet carries one. */
  pcrAt?: number;
  /** Offsets of the PTS and DTS fields (5 bytes each), if this packet starts a PES with them. */
  ptsAt?: number;
  dtsAt?: number;
}

function inspect(buf: Buffer, o: number): PacketView {
  if (buf[o] !== 0x47) throw new TsError(`No sync byte at offset ${o}`);
  const pid = ((buf[o + 1]! & 0x1f) << 8) | buf[o + 2]!;
  const pusi = (buf[o + 1]! & 0x40) !== 0;
  const afc = (buf[o + 3]! >> 4) & 0x03;
  const view: PacketView = { pid, hasPayload: (afc & 0x01) !== 0 };
  let p = o + 4;
  const end = o + TS_PACKET_SIZE;
  if (afc & 0x02) {
    const afLength = buf[p]!;
    if (afLength > 0 && (buf[p + 1]! & 0x10) !== 0 && p + 8 <= end) view.pcrAt = p + 2;
    p += 1 + afLength;
  }
  if (view.hasPayload && pusi && p + 14 <= end && buf[p] === 0 && buf[p + 1] === 0 && buf[p + 2] === 1 && pesHasHeader(buf[p + 3]!)) {
    const flags = buf[p + 7]! >> 6;
    if (flags & 0x02) view.ptsAt = p + 9;
    if (flags === 0x03 && p + 19 <= end) view.dtsAt = p + 14;
  }
  return view;
}

/** Facts about one pre-encoded segment, gathered once at load time. */
export interface SegmentScan {
  packets: number;
  /** Packets that carry a payload, per PID (continuity counters advance only on those). */
  payloadPackets: Map<number, number>;
  /** Smallest PTS/DTS in the segment, or undefined when it has none. */
  minTimestamp: number | undefined;
}

export function scanSegment(buf: Buffer): SegmentScan {
  if (buf.length === 0 || buf.length % TS_PACKET_SIZE !== 0) {
    throw new TsError(`Segment length ${buf.length} is not a positive multiple of ${TS_PACKET_SIZE}`);
  }
  const payloadPackets = new Map<number, number>();
  let minTimestamp: number | undefined;
  for (let o = 0; o < buf.length; o += TS_PACKET_SIZE) {
    const v = inspect(buf, o);
    if (v.hasPayload && v.pid !== NULL_PID) payloadPackets.set(v.pid, (payloadPackets.get(v.pid) ?? 0) + 1);
    for (const at of [v.ptsAt, v.dtsAt]) {
      if (at !== undefined) {
        const t = readTimestamp(buf, at);
        if (minTimestamp === undefined || t < minTimestamp) minTimestamp = t;
      }
    }
  }
  return { packets: buf.length / TS_PACKET_SIZE, payloadPackets, minTimestamp };
}

/**
 * Copies `segment`, adding `offset` (90 kHz ticks, modulo 2^33) to every PTS, DTS and PCR, and
 * numbering continuity counters from `counters` (payload packets already sent per PID; updated).
 */
export function rewriteSegment(segment: Buffer, offset: number, counters: Map<number, number>): Buffer {
  const out = Buffer.from(segment);
  for (let o = 0; o < out.length; o += TS_PACKET_SIZE) {
    const v = inspect(out, o);
    if (v.pid !== NULL_PID) {
      const sent = counters.get(v.pid) ?? 0;
      // A packet without payload repeats the counter of the last payload packet on its PID.
      const cc = v.hasPayload ? sent : sent - 1;
      out[o + 3] = (out[o + 3]! & 0xf0) | (((cc % 16) + 16) % 16);
      if (v.hasPayload) counters.set(v.pid, sent + 1);
    }
    if (v.pcrAt !== undefined) writePcrBase(out, v.pcrAt, readPcrBase(out, v.pcrAt) + offset);
    if (v.ptsAt !== undefined) writeTimestamp(out, v.ptsAt, readTimestamp(out, v.ptsAt) + offset);
    if (v.dtsAt !== undefined) writeTimestamp(out, v.dtsAt, readTimestamp(out, v.dtsAt) + offset);
  }
  return out;
}

/** Every PTS in a TS buffer, in packet order, per PID (tests and diagnostics). */
export function listPts(buf: Buffer): { pid: number; pts: number; dts?: number }[] {
  const out: { pid: number; pts: number; dts?: number }[] = [];
  for (let o = 0; o + TS_PACKET_SIZE <= buf.length; o += TS_PACKET_SIZE) {
    const v = inspect(buf, o);
    if (v.ptsAt !== undefined) {
      out.push({ pid: v.pid, pts: readTimestamp(buf, v.ptsAt), ...(v.dtsAt !== undefined ? { dts: readTimestamp(buf, v.dtsAt) } : {}) });
    }
  }
  return out;
}

/** The continuity counter of every non-null packet, per PID, in order (tests). */
export function listContinuity(buf: Buffer): Map<number, { cc: number; payload: boolean }[]> {
  const out = new Map<number, { cc: number; payload: boolean }[]>();
  for (let o = 0; o + TS_PACKET_SIZE <= buf.length; o += TS_PACKET_SIZE) {
    const v = inspect(buf, o);
    if (v.pid === NULL_PID) continue;
    const list = out.get(v.pid) ?? [];
    list.push({ cc: buf[o + 3]! & 0x0f, payload: v.hasPayload });
    out.set(v.pid, list);
  }
  return out;
}

/**
 * A loop of equal-length segments placed on the epoch timeline: segment `seq` is loop segment
 * `seq mod n`, shifted so its first timestamp is (seq × segmentSeconds) × 90 kHz.
 */
export class LoopChannel {
  readonly segmentCount: number;
  private readonly scans: SegmentScan[];
  /** Earliest timestamp of the loop (segment 0), mapped to the start of each lap. */
  private readonly origin: number;
  /** Payload packets per PID in one full lap. */
  private readonly perLap = new Map<number, number>();
  /** Payload packets per PID before loop segment i, within a lap. */
  private readonly before: Map<number, number>[] = [];

  constructor(
    private readonly segments: readonly Buffer[],
    readonly segmentSeconds: number,
  ) {
    if (segments.length === 0) throw new TsError('A loop needs at least one segment');
    this.segmentCount = segments.length;
    this.scans = segments.map((s) => scanSegment(s));
    const first = this.scans[0]!.minTimestamp;
    if (first === undefined) throw new TsError('The first loop segment has no PTS');
    this.origin = first;
    for (const scan of this.scans) {
      this.before.push(new Map(this.perLap));
      for (const [pid, n] of scan.payloadPackets) this.perLap.set(pid, (this.perLap.get(pid) ?? 0) + n);
    }
  }

  /** Seconds in one lap. */
  get loopSeconds(): number {
    return this.segmentCount * this.segmentSeconds;
  }

  /** Continuity state (payload packets sent per PID) at the start of segment `seq`. */
  countersAt(seq: number): Map<number, number> {
    const lap = Math.floor(seq / this.segmentCount);
    const index = seq - lap * this.segmentCount;
    const counters = new Map<number, number>();
    for (const [pid, n] of this.perLap) counters.set(pid, lap * n + (this.before[index]!.get(pid) ?? 0));
    return counters;
  }

  /** Segment `seq` with its timestamps on the epoch timeline. `counters` continues a stream. */
  segment(seq: number, counters: Map<number, number> = this.countersAt(seq)): Buffer {
    const lap = Math.floor(seq / this.segmentCount);
    const index = seq - lap * this.segmentCount;
    const offset = lap * this.loopSeconds * TS_CLOCK - this.origin;
    return rewriteSegment(this.segments[index]!, offset, counters);
  }

  /** Bytes in segment `seq` (without rewriting it). */
  segmentSize(seq: number): number {
    const index = ((seq % this.segmentCount) + this.segmentCount) % this.segmentCount;
    return this.segments[index]!.length;
  }
}
