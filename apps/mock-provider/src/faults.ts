// Fault injection. A scenario (fixtures/scenarios/*.yaml) is a list of rules; each rule matches
// requests (path glob, method, Xtream action, username, stream id) and applies faults, optionally
// only after the first `after` matches and for `times` matches. `?mock_fault=` adds faults to a
// single request: `mock_fault=status:509`, `mock_fault=redirect:hops=3,stall:after_bytes=4096`.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { createGzip, gzipSync } from 'node:zlib';
import { DEFAULT_FIXTURES_DIR, Fields, FixtureError, readYaml } from './config';
import { XMLTV_OFFSET_STYLES, isValidTimeZone } from './time';
import type { XmltvOffsetStyle } from './time';

export const DEFAULT_SCENARIOS_DIR = join(DEFAULT_FIXTURES_DIR, 'scenarios');

export const FAULT_TYPES = [
  'status',
  'redirect',
  'slow-headers',
  'stall',
  'reset',
  'bom',
  'crlf',
  'invalid-utf8',
  'malformed-m3u',
  'truncate',
  'gzip',
  'timezone',
  'json-quirks',
  'no-cors',
] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

export const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;

export type Fault =
  | { type: 'status'; status: number; body: string | undefined; contentType: string }
  | { type: 'redirect'; hops: number; status: number; host: string | undefined; relative: boolean }
  | { type: 'slow-headers'; delayMs: number }
  | { type: 'stall'; afterBytes: number | undefined; afterMs: number | undefined; holdMs: number }
  | { type: 'reset'; afterBytes: number | undefined }
  | { type: 'truncate'; bytes: number | undefined; fraction: number | undefined }
  | { type: 'gzip'; mode: 'encoding' | 'raw' }
  | { type: 'timezone'; tz: string; xmltv: XmltvOffsetStyle }
  | { type: 'bom' | 'crlf' | 'invalid-utf8' | 'malformed-m3u' | 'json-quirks' | 'no-cors' };

export type FaultOf<T extends FaultType> = Extract<Fault, { type: T }>;

/** The argument a positional query value (`status:509`) sets. */
const PRIMARY: Partial<Record<FaultType, string>> = {
  status: 'status',
  redirect: 'hops',
  'slow-headers': 'delay_ms',
  stall: 'after_bytes',
  reset: 'after_bytes',
  truncate: 'bytes',
  gzip: 'mode',
  timezone: 'tz',
};

export function parseFault(f: Fields): Fault {
  const type = f.oneOf('type', FAULT_TYPES);
  switch (type) {
    case 'status': {
      f.only(['type', 'status', 'body', 'content_type']);
      const status = f.int('status', undefined, 200);
      if (status > 599) throw new FixtureError(`${f.where}.status: expected an HTTP status`);
      return {
        type,
        status,
        body: f.has('body') ? f.str('body') : undefined,
        contentType: f.str('content_type', 'text/plain; charset=utf-8'),
      };
    }
    case 'redirect': {
      f.only(['type', 'hops', 'status', 'host', 'relative']);
      const status = f.int('status', 302);
      if (!(REDIRECT_STATUSES as readonly number[]).includes(status)) {
        throw new FixtureError(`${f.where}.status: expected one of ${REDIRECT_STATUSES.join(', ')}`);
      }
      return { type, hops: f.int('hops', 1, 1), status, host: f.has('host') ? f.str('host') : undefined, relative: f.bool('relative', false) };
    }
    case 'slow-headers':
      f.only(['type', 'delay_ms']);
      return { type, delayMs: f.int('delay_ms') };
    case 'stall': {
      f.only(['type', 'after_bytes', 'after_ms', 'hold_ms']);
      const afterMs = f.optInt('after_ms');
      const afterBytes = f.optInt('after_bytes') ?? (afterMs === undefined ? 0 : undefined);
      return { type, afterBytes, afterMs, holdMs: f.int('hold_ms', 120_000, 1) };
    }
    case 'reset':
      f.only(['type', 'after_bytes']);
      return { type, afterBytes: f.optInt('after_bytes') };
    case 'truncate': {
      f.only(['type', 'bytes', 'fraction']);
      const bytes = f.optInt('bytes');
      const fraction = f.has('fraction') ? f.num('fraction') : bytes === undefined ? 0.5 : undefined;
      if (fraction !== undefined && (fraction < 0 || fraction > 1)) throw new FixtureError(`${f.where}.fraction: expected 0..1`);
      return { type, bytes, fraction };
    }
    case 'gzip':
      f.only(['type', 'mode']);
      return { type, mode: f.oneOf('mode', ['encoding', 'raw'] as const, 'encoding') };
    case 'timezone': {
      f.only(['type', 'tz', 'xmltv']);
      const tz = f.str('tz');
      if (!isValidTimeZone(tz)) throw new FixtureError(`${f.where}.tz: unknown time zone ${tz}`);
      return { type, tz, xmltv: f.oneOf('xmltv', XMLTV_OFFSET_STYLES, 'local') };
    }
    default:
      f.only(['type']);
      return { type };
  }
}

/** `?mock_fault=` value: faults separated by `,`, arguments by `:` (`key=value`, or one positional value). */
export function parseFaultFlags(value: string): Fault[] {
  return value
    .split(',')
    .filter((spec) => spec.trim() !== '')
    .map((spec, i) => {
      const [type = '', ...args] = spec.trim().split(':');
      const obj: Record<string, unknown> = { type };
      for (const arg of args) {
        const eq = arg.indexOf('=');
        if (eq >= 0) {
          obj[arg.slice(0, eq)] = arg.slice(eq + 1);
        } else {
          const key = PRIMARY[type as FaultType];
          if (key === undefined) throw new FixtureError(`mock_fault[${i}]: ${type} takes no positional argument`);
          obj[key] = arg;
        }
      }
      return parseFault(Fields.of(obj, `mock_fault[${i}]`));
    });
}

export interface RuleMatch {
  paths: RegExp[] | undefined;
  methods: string[] | undefined;
  actions: string[] | undefined;
  usernames: string[] | undefined;
  streamIds: number[] | undefined;
}

export interface FaultRule {
  match: RuleMatch;
  faults: Fault[];
  /** Skip this many matching requests first. */
  after: number;
  /** Apply to this many matching requests (after `after`); always when undefined. */
  times: number | undefined;
  hits: number;
}

export interface Scenario {
  name: string;
  description: string;
  rules: FaultRule[];
}

/** `*` matches within one path segment, `**` across segments. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? '';
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function parseScenario(value: unknown, name: string): Scenario {
  const root = Fields.of(value ?? {}, name).only(['description', 'rules']);
  const rules = root.list('rules', true).map((r): FaultRule => {
    r.only(['match', 'faults', 'after', 'times']);
    const m = Fields.of(r.obj['match'] ?? {}, `${r.where}.match`).only(['path', 'method', 'action', 'username', 'stream_id']);
    const streamIds = m.strings('stream_id')?.map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new FixtureError(`${m.where}.stream_id: expected integers`);
      return n;
    });
    const faults = r.list('faults').map(parseFault);
    if (faults.length === 0) throw new FixtureError(`${r.where}.faults: at least one fault is required`);
    return {
      match: {
        paths: m.strings('path')?.map(globToRegExp),
        methods: m.strings('method')?.map((s) => s.toUpperCase()),
        actions: m.strings('action'),
        usernames: m.strings('username'),
        streamIds,
      },
      faults,
      after: r.int('after', 0),
      times: r.optInt('times', 1),
      hits: 0,
    };
  });
  return { name, description: root.str('description', ''), rules };
}

export function scenarioPath(nameOrPath: string, dir = DEFAULT_SCENARIOS_DIR): string {
  const isPath = /[\\/]/.test(nameOrPath) || /\.ya?ml$/i.test(nameOrPath);
  return isPath ? nameOrPath : join(dir, `${nameOrPath}.yaml`);
}

export function loadScenario(nameOrPath: string, dir = DEFAULT_SCENARIOS_DIR): Scenario {
  const path = scenarioPath(nameOrPath, dir);
  if (!existsSync(path)) throw new FixtureError(`unknown scenario "${nameOrPath}" (no ${path})`);
  const name = (path.split(/[\\/]/).pop() ?? path).replace(/\.ya?ml$/i, '');
  return parseScenario(readYaml(path), name);
}

export function listScenarios(dir = DEFAULT_SCENARIOS_DIR): { name: string; description: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
    .map((file) => {
      const scenario = loadScenario(join(dir, file));
      return { name: scenario.name, description: scenario.description };
    });
}

export interface MatchContext {
  /** Path without the query string. */
  path: string;
  method: string;
  /** Query and form parameters. */
  params: Record<string, string>;
  username: string | undefined;
  streamId: number | undefined;
}

export function ruleMatches(rule: FaultRule, ctx: MatchContext): boolean {
  const { paths, methods, actions, usernames, streamIds } = rule.match;
  if (paths && !paths.some((re) => re.test(ctx.path))) return false;
  if (methods && !methods.includes(ctx.method)) return false;
  if (actions && !actions.includes(ctx.params['action'] ?? '')) return false;
  if (usernames && (ctx.username === undefined || !usernames.includes(ctx.username))) return false;
  if (streamIds && (ctx.streamId === undefined || !streamIds.includes(ctx.streamId))) return false;
  return true;
}

/** Faults of the matching rules, counting the hit on each matching rule. */
export function scenarioFaults(scenario: Scenario | null, ctx: MatchContext): Fault[] {
  if (!scenario) return [];
  const out: Fault[] = [];
  for (const rule of scenario.rules) {
    if (!ruleMatches(rule, ctx)) continue;
    rule.hits++;
    const n = rule.hits - rule.after;
    if (n >= 1 && (rule.times === undefined || n <= rule.times)) out.push(...rule.faults);
  }
  return out;
}

/** Per-request view of the faults: the last fault of each type wins (query flags come last). */
export interface FaultPlan {
  status?: FaultOf<'status'>;
  redirect?: FaultOf<'redirect'>;
  slowHeaders?: FaultOf<'slow-headers'>;
  stall?: FaultOf<'stall'>;
  reset?: FaultOf<'reset'>;
  truncate?: FaultOf<'truncate'>;
  gzip?: FaultOf<'gzip'>;
  timezone?: FaultOf<'timezone'>;
  bom: boolean;
  crlf: boolean;
  invalidUtf8: boolean;
  malformedM3u: boolean;
  jsonQuirks: boolean;
  noCors: boolean;
}

export function planFaults(faults: readonly Fault[]): FaultPlan {
  const plan: FaultPlan = { bom: false, crlf: false, invalidUtf8: false, malformedM3u: false, jsonQuirks: false, noCors: false };
  for (const f of faults) {
    switch (f.type) {
      case 'status':
        plan.status = f;
        break;
      case 'redirect':
        plan.redirect = f;
        break;
      case 'slow-headers':
        plan.slowHeaders = f;
        break;
      case 'stall':
        plan.stall = f;
        break;
      case 'reset':
        plan.reset = f;
        break;
      case 'truncate':
        plan.truncate = f;
        break;
      case 'gzip':
        plan.gzip = f;
        break;
      case 'timezone':
        plan.timezone = f;
        break;
      case 'bom':
        plan.bom = true;
        break;
      case 'crlf':
        plan.crlf = true;
        break;
      case 'invalid-utf8':
        plan.invalidUtf8 = true;
        break;
      case 'malformed-m3u':
        plan.malformedM3u = true;
        break;
      case 'json-quirks':
        plan.jsonQuirks = true;
        break;
      case 'no-cors':
        plan.noCors = true;
        break;
    }
  }
  return plan;
}

export function hasBodyTransforms(plan: FaultPlan): boolean {
  return plan.bom || plan.crlf || plan.invalidUtf8 || plan.malformedM3u || plan.jsonQuirks || plan.truncate !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Body transforms (text payloads: M3U, XMLTV, JSON)

/**
 * JSON type quirks seen across panels: numbers and numeric strings swap types, `null` becomes
 * `""`, and series `episodes` turns from an object keyed by season into an array of arrays.
 */
export function jsonQuirks(value: unknown, key?: string): unknown {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  if (Array.isArray(value)) return value.map((v) => jsonQuirks(v));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (key === 'episodes') return entries.map(([, v]) => jsonQuirks(v));
    return Object.fromEntries(entries.map(([k, v]) => [k, jsonQuirks(v, k)]));
  }
  return value;
}

const LONG_NAME = `Malformed: very long name ${'x'.repeat(5000)}`;

/** Broken entries the M3U parser must survive; inserted after the header (or at the top). */
export const MALFORMED_M3U_BLOCK = [
  '#EXTINF:-1 tvg-id="broken.quote" tvg-name="Unbalanced quote group-title="Malformed",Malformed: unbalanced quote',
  'http://mock.invalid/live/x/y/900001.ts',
  '#EXTINF:-1,Malformed: entry without a URL',
  '#EXTINF:-1 tvg-id=unquoted.attr group-title=Malformed,Malformed: unquoted attributes',
  'http://mock.invalid/live/x/y/900002.ts',
  'http://mock.invalid/live/x/y/900003.ts',
  '#EXTINF:abc tvg-id="bad.duration" group-title="Malformed",Malformed: non-numeric duration',
  'http://mock.invalid/live/x/y/900004.ts',
  '#EXTVLCOPT:http-user-agent=ZomaMock/1.0',
  '#EXTGRP:Malformed',
  '#EXTINF:-1 tvg-id="dup.one" tvg-id="dup.two" group-title="Malformed",Malformed: duplicate attribute',
  'http://mock.invalid/live/x/y/900005.ts',
  '',
  '   ',
  '#EXTINF:-1 tvg-name="Comma, in name" group-title="Malformed",Malformed: comma, in title',
  'http://mock.invalid/live/x/y/900006.ts',
  `#EXTINF:-1 group-title="Malformed",${LONG_NAME}`,
  'http://mock.invalid/live/x/y/900007.ts',
  '#EXTINF:-1 tvg-id="" tvg-logo="" group-title="",',
  'http://mock.invalid/live/x/y/900008.ts',
];
export const MALFORMED_M3U_TAIL = '#EXTINF:-1 group-title="Malformed",Malformed: last entry cut off';

function malformM3u(text: string): string {
  const lines = text.split('\n');
  const at = lines[0]?.startsWith('#EXTM3U') ? 1 : 0;
  lines.splice(at, 0, ...MALFORMED_M3U_BLOCK);
  // Drop the final newline and end on an entry with no URL, like a cut-off download.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.push(MALFORMED_M3U_TAIL);
  return lines.join('\n');
}

/**
 * Invalid UTF-8: a lone 0xC3, 0xFF, an overlong '/', a UTF-16 surrogate and a bare Latin-1 'é'
 * (a playlist saved as Windows-1252). Inserted where a channel name starts.
 */
export const INVALID_UTF8 = Buffer.from([0xc3, 0x28, 0xff, 0xc0, 0xaf, 0xed, 0xa0, 0x80, 0x45, 0xe9]);

function insertInvalidUtf8(body: Buffer): Buffer {
  const text = body.toString('latin1');
  let at = -1;
  const extinf = text.indexOf('#EXTINF');
  if (extinf >= 0) {
    const eol = text.indexOf('\n', extinf);
    const comma = text.lastIndexOf(',', eol < 0 ? text.length : eol);
    at = comma > extinf ? comma + 1 : -1;
  }
  for (const marker of ['<display-name>', '"name":"']) {
    if (at >= 0) break;
    const i = text.indexOf(marker);
    if (i >= 0) at = i + marker.length;
  }
  if (at < 0) at = body.length;
  return Buffer.concat([body.subarray(0, at), INVALID_UTF8, body.subarray(at)]);
}

function toCrlf(body: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const b = body[i]!;
    if (b === 0x0a && (i === 0 || body[i - 1] !== 0x0d)) out.push(0x0d);
    out.push(b);
  }
  return Buffer.from(out);
}

export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function transformBody(body: Buffer, contentType: string, plan: FaultPlan): Buffer {
  let out = body;
  if (plan.jsonQuirks && /json/i.test(contentType)) {
    try {
      out = Buffer.from(JSON.stringify(jsonQuirks(JSON.parse(out.toString('utf8')))));
    } catch {
      // Not JSON after all: leave it.
    }
  }
  if (plan.malformedM3u) {
    const text = out.toString('utf8');
    if (text.includes('#EXTM3U') || text.includes('#EXTINF')) out = Buffer.from(malformM3u(text), 'utf8');
  }
  if (plan.invalidUtf8) out = insertInvalidUtf8(out);
  if (plan.crlf) out = toCrlf(out);
  if (plan.bom) out = Buffer.concat([UTF8_BOM, out]);
  if (plan.truncate) {
    const { bytes, fraction } = plan.truncate;
    const keep = bytes !== undefined ? bytes : Math.floor(out.length * (fraction ?? 0.5));
    out = out.subarray(0, Math.min(keep, out.length));
  }
  return out;
}

export function gzipBody(payload: Buffer | Readable): Buffer | Readable {
  return Buffer.isBuffer(payload) ? gzipSync(payload) : payload.pipe(createGzip());
}

// ---------------------------------------------------------------------------------------------
// Stalls and resets mid-body

export interface GateOptions {
  afterBytes: number | undefined;
  afterMs: number | undefined;
  /** Called once when the limit is reached; the source is already stopped. */
  onTrigger: () => void;
}

/**
 * Passes the payload through until `afterBytes` bytes or `afterMs` milliseconds, then stops the
 * source and calls `onTrigger` (which holds the socket open or resets it). A payload that ends
 * before the limit ends normally.
 */
export function gate(payload: Buffer | Readable, options: GateOptions): PassThrough {
  const source = Buffer.isBuffer(payload) ? Readable.from([payload], { objectMode: false }) : payload;
  const out = new PassThrough();
  const limit = options.afterBytes;
  let passed = 0;
  let fired = false;
  let timer: NodeJS.Timeout | undefined;

  const fire = (): void => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    source.removeAllListeners('data');
    source.destroy();
    options.onTrigger();
  };

  if (options.afterMs !== undefined) timer = setTimeout(fire, options.afterMs);
  if (limit === 0) setImmediate(fire);

  source.on('data', (chunk: Buffer) => {
    if (fired) return;
    if (limit === undefined || passed + chunk.length < limit) {
      passed += chunk.length;
      if (!out.write(chunk)) {
        source.pause();
        out.once('drain', () => source.resume());
      }
      return;
    }
    const rest = limit - passed;
    if (rest > 0) out.write(chunk.subarray(0, rest));
    passed = limit;
    fire();
  });
  source.once('end', () => {
    if (!fired) {
      clearTimeout(timer);
      out.end();
    }
  });
  source.once('error', (error) => out.destroy(error));
  out.once('close', () => {
    clearTimeout(timer);
    source.destroy();
  });
  return out;
}
