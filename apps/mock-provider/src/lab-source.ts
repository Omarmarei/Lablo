// The Zoma Lab's scale source (RELAY step 15b, spike S6). The lab holds no test account, so the
// mock hands it one, with a guide whose dates are moved to the TV's:
//
//   GET /__lab/source?around=MS     JSON: the M3U URL of the mock's test account, how many
//                                   entries it lists, and the guide (below) for a TV whose clock
//                                   reads MS (epoch ms; default the mock's clock)
//   GET /__lab/guide.xml.gz?days=D  the guide (the `--xmltv` file, or the generated one) with
//                                   every start and stop moved D whole days, gzipped
//
// An EPG ingest keeps only the days around the TV's clock, and the scale guide is dated around
// 2026-11-01 (tools/fixtures), so the `--xmltv` guide is moved by the whole days that put its
// middle on the TV's day (the generated guide, built around the mock's clock, by the days from
// the mock's day to the TV's). Whole days keep every programme at its time of day, and an offset (`+0300`)
// stays as written. `/__lab/source` builds the moved scale guide before it answers, so the
// lab's guide timing never includes the mock's own work.

import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, createGzip, gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Account } from './config';
import type { MockState } from './state';
import { baseUrl } from './state';
import { buildXmltv } from './xmltv';

const DAY_MS = 86_400_000;
const TEXT = 'text/plain; charset=utf-8';
/** At most ten years either way. */
export const MAX_SHIFT_DAYS = 3650;

/** `start="20261025000000` and `stop="…`: the 14 digits of an XMLTV time. */
const TIME = /((?:start|stop)=")(\d{14})/g;

/** The UTC instant the 14 digits name, offset ignored (`null`: not a date). */
export function xmltvDigitsMs(digits: string): number | null {
  const n = (from: number, to: number): number => Number(digits.slice(from, to));
  const [y, mo, d, h, mi, s] = [n(0, 4), n(4, 6), n(6, 8), n(8, 10), n(10, 12), n(12, 14)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function digitsOf(ms: number): string {
  const t = new Date(ms);
  const p = (v: number, w = 2): string => String(v).padStart(w, '0');
  return `${p(t.getUTCFullYear(), 4)}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/** The 14 digits of an XMLTV time moved `days` whole days (month and year ends included). */
export function shiftXmltvDigits(digits: string, days: number): string {
  const ms = xmltvDigitsMs(digits);
  return ms === null ? digits : digitsOf(ms + days * DAY_MS);
}

/**
 * Moves every start and stop of an XMLTV text that arrives in pieces. A piece is processed up
 * to its last `>`: the attributes of an unfinished tag wait for the next piece, so a time cut in
 * two is still found.
 */
export class XmltvShifter {
  private carry = '';

  constructor(private readonly days: number) {}

  push(text: string): string {
    const all = this.carry + text;
    const cut = all.lastIndexOf('>') + 1;
    this.carry = all.slice(cut);
    return this.shift(all.slice(0, cut));
  }

  end(): string {
    const rest = this.carry;
    this.carry = '';
    return this.shift(rest);
  }

  private shift(text: string): string {
    if (this.days === 0) return text;
    return text.replace(TIME, (_m, attr: string, digits: string) => attr + shiftXmltvDigits(digits, this.days));
  }
}

/** The first start and the last stop seen (UTC from the digits). */
export interface GuideRange {
  readonly from: number;
  readonly to: number;
}

/** Collects a guide's range from pieces (a time cut in two is found, as in `XmltvShifter`). */
export class RangeScanner {
  private carry = '';
  private min = Infinity;
  private max = -Infinity;

  push(text: string): void {
    const all = this.carry + text;
    const cut = all.lastIndexOf('>') + 1;
    this.carry = all.slice(cut);
    this.scan(all.slice(0, cut));
  }

  result(): GuideRange | null {
    this.scan(this.carry);
    this.carry = '';
    return this.min === Infinity ? null : { from: this.min, to: this.max };
  }

  private scan(text: string): void {
    TIME.lastIndex = 0;
    for (let m = TIME.exec(text); m !== null; m = TIME.exec(text)) {
      const ms = xmltvDigitsMs(m[2]!);
      if (ms === null) continue;
      if (ms < this.min) this.min = ms;
      if (ms > this.max) this.max = ms;
    }
  }
}

const clampDays = (days: number): number => Math.max(-MAX_SHIFT_DAYS, Math.min(MAX_SHIFT_DAYS, days));

/** Whole days that put the middle of `range` on the day of `around`. */
export function shiftDaysFor(range: GuideRange, around: number): number {
  const middle = (range.from + range.to) / 2;
  return clampDays(Math.round((around - middle) / DAY_MS));
}

function xmltvStream(path: string): Readable {
  const file = createReadStream(path);
  return path.toLowerCase().endsWith('.gz') ? file.pipe(createGunzip()) : file;
}

/** Reads the decoded text of a static guide in pieces. */
async function eachPiece(path: string, use: (text: string) => void): Promise<number> {
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  for await (const chunk of xmltvStream(path)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    use(decoder.write(buffer));
  }
  use(decoder.end());
  return bytes;
}

/** A prepared guide: the moved text, gzipped. */
export interface LabGuide {
  readonly shiftDays: number;
  /** The moved text's size (the same as the original's: the digits keep their length). */
  readonly bytes: number;
  readonly gz: Buffer;
  /** Its programmes' range after the move. */
  readonly range: GuideRange | null;
  /** The `--xmltv` file (the scale guide), or the guide generated from the catalog. */
  readonly static: boolean;
}

/** The static guide's range, read once per file. */
const ranges = new Map<string, Promise<{ range: GuideRange | null; bytes: number }>>();
/** The last static guide prepared (one at a time: the 150 MB guide is about 10 MB gzipped). */
let prepared: { key: string; guide: Promise<LabGuide> } | null = null;

function staticRange(path: string): Promise<{ range: GuideRange | null; bytes: number }> {
  let known = ranges.get(path);
  if (known === undefined) {
    const scanner = new RangeScanner();
    known = eachPiece(path, (text) => scanner.push(text)).then((bytes) => ({ range: scanner.result(), bytes }));
    known.catch(() => ranges.delete(path));
    ranges.set(path, known);
  }
  return known;
}

function moved(range: GuideRange | null, days: number): GuideRange | null {
  return range === null ? null : { from: range.from + days * DAY_MS, to: range.to + days * DAY_MS };
}

async function buildStatic(path: string, days: number): Promise<LabGuide> {
  const { range, bytes } = await staticRange(path);
  const shifter = new XmltvShifter(days);
  // Gzipped as it is read: the moved 150 MB text is never held whole.
  const zip = createGzip();
  const out: Buffer[] = [];
  zip.on('data', (chunk: Buffer) => out.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    zip.on('end', resolve);
    zip.on('error', reject);
  });
  await eachPiece(path, (text) => {
    const piece = shifter.push(text);
    if (piece !== '') zip.write(piece, 'utf8');
  });
  zip.end(shifter.end(), 'utf8');
  await ended;
  return { shiftDays: days, bytes, gz: Buffer.concat(out), range: moved(range, days), static: true };
}

/** The static guide moved `days` (built once, kept until another shift is asked for). */
function staticGuide(path: string, days: number): Promise<LabGuide> {
  const key = `${path}\n${days}`;
  if (prepared === null || prepared.key !== key) {
    const guide = buildStatic(path, days);
    const entry = { key, guide };
    guide.catch(() => {
      if (prepared === entry) prepared = null;
    });
    prepared = entry;
  }
  return prepared.guide;
}

function generatedGuide(state: MockState, request: FastifyRequest, days: number | 'around', around: number): LabGuide {
  const text = buildXmltv(state, request);
  const scanner = new RangeScanner();
  scanner.push(text);
  const range = scanner.result();
  // The generated guide is built around the mock's clock: the mock's day becomes the TV's.
  const shift = days === 'around' ? clampDays(Math.round((around - state.now()) / DAY_MS)) : days;
  const shifter = new XmltvShifter(shift);
  const out = shifter.push(text) + shifter.end();
  return { shiftDays: shift, bytes: Buffer.byteLength(out, 'utf8'), gz: gzipSync(Buffer.from(out, 'utf8')), range: moved(range, shift), static: false };
}

/** The guide for a TV whose clock reads `around`. */
async function guideAround(state: MockState, request: FastifyRequest, around: number): Promise<LabGuide> {
  if (state.xmltvFile === null) return generatedGuide(state, request, 'around', around);
  const { range } = await staticRange(state.xmltvFile);
  return staticGuide(state.xmltvFile, range === null ? 0 : shiftDaysFor(range, around));
}

/** The account the lab's source uses: the first active one that never expires or hasn't yet. */
export function labAccount(accounts: readonly Account[]): Account | null {
  return accounts.find((a) => a.status === 'Active' && (a.expDays === null || a.expDays > 0) && a.maxConnections > 0) ?? null;
}

/** Entries `get.php` lists: live channels, movies and episodes. */
export function playlistEntries(state: MockState): { items: number; live: number } {
  let episodes = 0;
  for (const s of state.catalog.series) for (const season of s.seasons) episodes += season.episodes.length;
  return { items: state.catalog.live.length + state.catalog.movies.length + episodes, live: state.catalog.live.length };
}

function intParam(value: string | undefined, min: number, max: number): number | null | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

const iso = (ms: number | undefined): string | null => (ms === undefined ? null : new Date(ms).toISOString());

export function registerLabSource(app: FastifyInstance, state: MockState): void {
  app.get<{ Querystring: { around?: string } }>('/__lab/source', async (request, reply) => {
    const around = intParam(request.query.around, 0, 8.64e15);
    if (around === null) return reply.code(400).type(TEXT).send('around: epoch milliseconds');
    const account = labAccount(state.fixture.accounts);
    if (account === null) return reply.code(503).type(TEXT).send('No active test account in server.yaml');
    const base = baseUrl(request);
    const guide = await guideAround(state, request, around ?? state.now());
    const u = encodeURIComponent(account.username);
    const p = encodeURIComponent(account.password);
    return reply.header('cache-control', 'no-store').send({
      m3u: `${base}/get.php?username=${u}&password=${p}&type=m3u_plus`,
      ...playlistEntries(state),
      guide: {
        url: `${base}/__lab/guide.xml.gz?days=${guide.shiftDays}`,
        static: guide.static,
        bytes: guide.bytes,
        gzBytes: guide.gz.length,
        shiftDays: guide.shiftDays,
        from: iso(guide.range?.from),
        to: iso(guide.range?.to),
      },
    });
  });

  app.get<{ Querystring: { days?: string } }>('/__lab/guide.xml.gz', async (request, reply) => {
    const days = intParam(request.query.days, -MAX_SHIFT_DAYS, MAX_SHIFT_DAYS);
    if (days === null) return reply.code(400).type(TEXT).send(`days: a whole number from -${MAX_SHIFT_DAYS} to ${MAX_SHIFT_DAYS}`);
    const guide = state.xmltvFile === null ? generatedGuide(state, request, days ?? 0, 0) : await staticGuide(state.xmltvFile, days ?? 0);
    return reply.type('application/gzip').header('cache-control', 'no-store').send(guide.gz);
  });
}
