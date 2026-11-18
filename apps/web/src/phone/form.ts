/**
 * The phone page's forms (RELAY steps 31b and 31d1, architecture.md §3.3 A): an Xtream login, an
 * M3U link or an M3U file, up to four guide links and an optional name, checked as the TV's own
 * form checks them and then by the protocol's `pairPayloadSchema`: what passes is exactly what gets
 * sealed for the TV.
 */
import type { PairFile, PairPayload, PairSource } from '@lablo/protocol';
import { PAIR_EPG_MAX, PAIR_FILE_MAX_BYTES, pairPayloadSchema } from '@lablo/protocol';

/** An Xtream login, an M3U link, or an M3U file (step 31d1). */
export type SourceType = 'xtream' | 'm3u' | 'file';

/** The file chosen for the M3U file form: its name and size (the bytes are read when it is sent). */
export interface FileInfo {
  readonly name: string;
  readonly size: number;
}

/** A chosen file: its name and size, and its bytes read when it is sent (the browser's `File.slice`). */
export interface PickedFile extends FileInfo {
  /** The bytes from `start` to `end`; rejects when the file can't be read any more. */
  read(start: number, end: number): Promise<Uint8Array>;
}

/** The largest file the form takes: its 40 frames and their 16-byte tags just fit `PAIR_FILE_MAX_BYTES` (`fileCipherLength`). */
export const FILE_MAX_BYTES = PAIR_FILE_MAX_BYTES - 40 * 16;

/** What the person typed, field by field. The guide links are one to four fields. */
export interface FormValues {
  readonly server: string;
  readonly username: string;
  readonly password: string;
  readonly playlist: string;
  readonly epg: readonly string[];
  readonly name: string;
}

export const EMPTY_VALUES: FormValues = { server: '', username: '', password: '', playlist: '', epg: [''], name: '' };

/** A field: the guide links are `epg0` to `epg3`; `file` is the M3U file. */
export type FieldKey = 'server' | 'username' | 'password' | 'playlist' | 'file' | 'name' | `epg${number}`;

/**
 * Why a field is refused: empty, not an http(s) address, a link with spaces, or too long; for the
 * file, none chosen, an empty one, one over `FILE_MAX_BYTES`, or one that couldn't be read.
 */
export type FieldProblem = 'required' | 'url' | 'spaces' | 'long' | 'noFile' | 'empty' | 'large' | 'unreadable';

export type FormProblems = Partial<Record<FieldKey, FieldProblem>>;

type RequiredKey = 'server' | 'username' | 'password' | 'playlist';

/** The text fields each source type requires, in screen order (the file form's file is checked on its own). */
export const REQUIRED: Readonly<Record<SourceType, readonly RequiredKey[]>> = {
  xtream: ['server', 'username', 'password'],
  m3u: ['playlist'],
  file: [],
};

/**
 * Stands in for the file in the check before sending: the upload's key and the file's keys come
 * after the upload (`withFile`). Zero bytes, in base64url.
 */
const FILE_PENDING: Omit<PairFile, 'size'> = { key: 'A'.repeat(22), fileKey: 'A'.repeat(43), base: 'A'.repeat(32) };

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const HTTP = /^https?$/i;
const WHITESPACE = /\s/;
/** `host[:port]` with no login in it. */
const AUTHORITY = /^[^:/@?#]+(?::\d{1,5})?$/;

/**
 * A link as the TV's own form reads it (`apps/tv/src/onboarding/form.ts`, `normalizeLink`;
 * `test/phone-link.test.ts` holds the two to the same answers): trimmed, `http://` added when no
 * scheme was typed, then null when it has spaces, another scheme, no host, or a login.
 */
export function normalizeLink(input: string): string | null {
  let text = input.trim();
  if (text === '' || WHITESPACE.test(text)) return null;
  const scheme = SCHEME.exec(text);
  if (scheme === null) text = `http://${text}`;
  else if (!HTTP.test(scheme[1] ?? '')) return null;
  const start = text.indexOf('://') + 3;
  let end = text.length;
  for (const mark of ['/', '?', '#']) {
    const at = text.indexOf(mark, start);
    if (at !== -1 && at < end) end = at;
  }
  const authority = text.slice(start, end);
  if (!AUTHORITY.test(authority)) return null;
  return `${text.slice(0, start).toLowerCase()}${authority.toLowerCase()}${text.slice(end)}`;
}

export interface CheckedForm {
  /** Each refused field's problem; empty when the form is fine. */
  readonly problems: FormProblems;
  /** The payload to seal, when nothing was refused (a file's: once `withFile` has its keys). */
  readonly payload: PairPayload | null;
}

/** The file's problem: none chosen, empty, or too large. */
export function fileProblem(file: FileInfo | null): FieldProblem | null {
  if (file === null) return 'noFile';
  if (file.size === 0) return 'empty';
  return file.size > FILE_MAX_BYTES ? 'large' : null;
}

/**
 * The name a file gives its source when none was typed: the file's name without `.m3u` or `.m3u8`,
 * trimmed and cut to 80 (never in the middle of a surrogate pair). Empty when nothing is left.
 */
export function nameFromFile(fileName: string): string {
  let name = fileName.replace(/\.m3u8?$/i, '').trim().slice(0, 80);
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) name = name.slice(0, -1);
  return name.trim();
}

/** Which field a schema issue's path names (the lengths are the schema's to check). */
function fieldOf(path: readonly PropertyKey[], epgIndex: readonly number[]): FieldKey | null {
  const [first, second] = path;
  if (first === 'source') return second === 'url' ? 'playlist' : second === 'server' || second === 'username' || second === 'password' ? second : null;
  if (first === 'name') return 'name';
  if (first === 'epg' && typeof second === 'number') return `epg${epgIndex[second] ?? second}`;
  return null;
}

/**
 * Checks the form: the type's required fields filled (for a file: one chosen, not empty, not too
 * large), links that are http(s) addresses, then the protocol's lengths. Logins and the name are
 * trimmed (as on the TV); empty guide fields are dropped and an empty name left out (the TV names
 * a source by its host), except a file's, which takes the file's name (`nameFromFile`).
 */
export function checkForm(type: SourceType, values: FormValues, file: FileInfo | null = null): CheckedForm {
  const problems: FormProblems = {};
  const field = (key: RequiredKey | 'name'): string => values[key].trim();
  for (const key of REQUIRED[type]) {
    if (field(key) === '') problems[key] = 'required';
  }
  const link = (key: FieldKey, typed: string): string | null => {
    const text = typed.trim();
    // An empty field is either optional or already refused as required.
    if (text === '') return null;
    const normalized = normalizeLink(text);
    if (normalized === null) problems[key] = WHITESPACE.test(text) ? 'spaces' : 'url';
    return normalized;
  };

  const epg: string[] = [];
  /** Which field each kept guide link came from. */
  const epgIndex: number[] = [];
  values.epg.slice(0, PAIR_EPG_MAX).forEach((typed, i) => {
    const normalized = link(`epg${i}`, typed);
    if (normalized !== null) {
      epg.push(normalized);
      epgIndex.push(i);
    }
  });

  let source: PairSource | null = null;
  if (type === 'xtream') {
    const server = link('server', values.server);
    if (server !== null) source = { type, server, username: field('username'), password: field('password') };
  } else if (type === 'm3u') {
    const url = link('playlist', values.playlist);
    if (url !== null) source = { type, url };
  } else {
    const problem = fileProblem(file);
    if (problem === null) source = { type: 'm3u-file', file: { ...FILE_PENDING, size: file!.size } };
    else problems.file = problem;
  }
  if (source === null || Object.keys(problems).length > 0) return { problems, payload: null };

  const typed = field('name');
  const name = typed === '' && type === 'file' ? nameFromFile(file!.name) : typed;
  const parsed = pairPayloadSchema.safeParse({
    v: 1,
    source,
    ...(name === '' ? {} : { name }),
    ...(epg.length === 0 ? {} : { epg }),
  });
  if (parsed.success) return { problems, payload: parsed.data };
  for (const issue of parsed.error.issues) {
    const key = fieldOf(issue.path, epgIndex);
    if (key !== null) problems[key] ??= 'long';
  }
  return { problems, payload: null };
}

/** A checked file payload with the file's real keys: the upload's object key, the frames' key and nonce base. */
export function withFile(payload: PairPayload, file: PairFile): PairPayload {
  return pairPayloadSchema.parse({ ...payload, source: { type: 'm3u-file', file } });
}

/** The first refused field in screen order, for the focus. */
export function firstProblem(type: SourceType, values: FormValues, problems: FormProblems): FieldKey | null {
  const order: FieldKey[] = [...REQUIRED[type], 'file', ...values.epg.map((_, i): FieldKey => `epg${i}`), 'name'];
  return order.find((key) => problems[key] !== undefined) ?? null;
}
