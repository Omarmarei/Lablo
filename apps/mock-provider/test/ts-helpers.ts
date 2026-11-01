// A tiny MPEG-TS writer for tests, written independently of src/ts-rewrite.ts so it can act as
// the oracle: PES packets with PTS/DTS, PCR-only adaptation packets and PSI-like packets.

export const PACKET = 188;

function timestampBytes(prefix: number, value: number): number[] {
  const hi = Math.floor(value / 2 ** 30) & 0x07;
  const lo = value % 2 ** 30;
  return [(prefix << 4) | (hi << 1) | 1, (lo >> 22) & 0xff, (((lo >> 15) & 0x7f) << 1) | 1, (lo >> 7) & 0xff, ((lo & 0x7f) << 1) | 1];
}

export interface PacketSpec {
  pid: number;
  cc?: number;
  /** PES start with these timestamps (90 kHz). */
  pts?: number;
  dts?: number;
  /** PCR base (90 kHz); the packet gets an adaptation field. */
  pcr?: number;
  /** false: adaptation field only (no payload, so the continuity counter must not advance). */
  payload?: boolean;
  /** Payload start without a PES header (a PSI section such as the PAT). */
  psi?: boolean;
}

export function packet(spec: PacketSpec): Buffer {
  const buf = Buffer.alloc(PACKET, 0xff);
  const hasPayload = spec.payload ?? true;
  const pusi = spec.pts !== undefined || spec.psi === true;
  const hasAf = spec.pcr !== undefined || !hasPayload;
  buf[0] = 0x47;
  buf[1] = (pusi ? 0x40 : 0) | ((spec.pid >> 8) & 0x1f);
  buf[2] = spec.pid & 0xff;
  buf[3] = ((hasAf ? 2 : 0) | (hasPayload ? 1 : 0)) << 4 | ((spec.cc ?? 0) & 0x0f);
  let p = 4;
  if (hasAf) {
    const afLength = hasPayload ? (spec.pcr !== undefined ? 7 : 1) : PACKET - 5;
    buf[p] = afLength;
    buf[p + 1] = spec.pcr !== undefined ? 0x10 : 0x00;
    if (spec.pcr !== undefined) {
      const base = spec.pcr;
      const top = Math.floor(base / 2);
      buf[p + 2] = Math.floor(top / 2 ** 24) & 0xff;
      buf[p + 3] = (top >> 16) & 0xff;
      buf[p + 4] = (top >> 8) & 0xff;
      buf[p + 5] = top & 0xff;
      buf[p + 6] = ((base % 2) << 7) | 0x7e;
      buf[p + 7] = 0x00;
    }
    p += 1 + afLength;
  }
  if (hasPayload && spec.psi) {
    buf.set([0x00, 0x00, 0xb0, 0x0d], p); // pointer field + PAT table id: not a PES start code
  } else if (hasPayload && spec.pts !== undefined) {
    const withDts = spec.dts !== undefined;
    buf.set([0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x80, withDts ? 0xc0 : 0x80, withDts ? 10 : 5], p);
    buf.set(timestampBytes(withDts ? 0x3 : 0x2, spec.pts), p + 9);
    if (withDts) buf.set(timestampBytes(0x1, spec.dts!), p + 14);
  }
  return buf;
}

export const VIDEO_PID = 0x100;
export const AUDIO_PID = 0x101;

/**
 * A synthetic 6 s segment `index` of a loop whose clock starts at `origin`: a PAT-like packet, a
 * PCR-only packet, then video (PTS/DTS every 1 s) and audio (PTS) packets with plain continuation
 * packets between them. Continuity counters restart at 0 in every segment, as a naive loop would.
 */
export function syntheticSegment(index: number, origin = 126_000): Buffer {
  const t0 = origin + index * 6 * 90_000;
  const packets: Buffer[] = [packet({ pid: 0, psi: true }), packet({ pid: VIDEO_PID, pcr: t0, payload: false })];
  for (let s = 0; s < 6; s++) {
    const t = t0 + s * 90_000;
    packets.push(packet({ pid: VIDEO_PID, pts: t + 3600, dts: t, pcr: t }));
    packets.push(packet({ pid: VIDEO_PID }));
    packets.push(packet({ pid: AUDIO_PID, pts: t + 1800 }));
    packets.push(packet({ pid: AUDIO_PID }));
  }
  return Buffer.concat(packets);
}

/** PTS/DTS/PCR of every packet that has them, decoded independently of ts-rewrite.ts. */
export function timestamps(buf: Buffer): { pid: number; pts?: number; dts?: number; pcr?: number }[] {
  const read = (o: number): number =>
    ((buf[o]! >> 1) & 7) * 2 ** 30 + buf[o + 1]! * 2 ** 22 + (buf[o + 2]! >> 1) * 2 ** 15 + buf[o + 3]! * 2 ** 7 + (buf[o + 4]! >> 1);
  const out: { pid: number; pts?: number; dts?: number; pcr?: number }[] = [];
  for (let o = 0; o < buf.length; o += PACKET) {
    const pid = ((buf[o + 1]! & 0x1f) << 8) | buf[o + 2]!;
    const afc = (buf[o + 3]! >> 4) & 3;
    const entry: { pid: number; pts?: number; dts?: number; pcr?: number } = { pid };
    let p = o + 4;
    if (afc & 2) {
      if (buf[p]! > 0 && buf[p + 1]! & 0x10) {
        entry.pcr = buf[p + 2]! * 2 ** 25 + buf[p + 3]! * 2 ** 17 + buf[p + 4]! * 2 ** 9 + buf[p + 5]! * 2 + (buf[p + 6]! >> 7);
      }
      p += 1 + buf[p]!;
    }
    if (afc & 1 && buf[o + 1]! & 0x40 && buf[p] === 0 && buf[p + 1] === 0 && buf[p + 2] === 1) {
      entry.pts = read(p + 9);
      if (buf[p + 7]! >> 6 === 3) entry.dts = read(p + 14);
    }
    if (entry.pts !== undefined || entry.pcr !== undefined) out.push(entry);
  }
  return out;
}
