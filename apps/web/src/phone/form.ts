/**
 * The phone page's forms (RELAY step 31b, architecture.md §3.3 A): an Xtream login or an M3U link,
 * up to four guide links and an optional name, checked as the TV's own form checks them and then
 * by the protocol's `pairPayloadSchema`: what passes is exactly what gets sealed for the TV.
 */
import type { PairPayload, PairSource } from '@lablo/protocol';
import { PAIR_EPG_MAX, pairPayloadSchema } from '@lablo/protocol';

/** The forms this step builds: the M3U file comes with step 31d. */
export type SourceType = 'xtream' | 'm3u';

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

/** A field: the guide links are `epg0` to `epg3`. */
export type FieldKey = 'server' | 'username' | 'password' | 'playlist' | 'name' | `epg${number}`;

/** Why a field is refused: empty, not an http(s) address, a link with spaces, or too long. */
export type FieldProblem = 'required' | 'url' | 'spaces' | 'long';

export type FormProblems = Partial<Record<FieldKey, FieldProblem>>;

type RequiredKey = 'server' | 'username' | 'password' | 'playlist';

/** The fields each source type requires, in screen order. */
export const REQUIRED: Readonly<Record<SourceType, readonly RequiredKey[]>> = {
  xtream: ['server', 'username', 'password'],
  m3u: ['playlist'],
};

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
  /** The payload to seal, when nothing was refused. */
  readonly payload: PairPayload | null;
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
 * Checks the form: the type's required fields filled, links that are http(s) addresses, then the
 * protocol's lengths. Logins and the name are trimmed (as on the TV); empty guide fields are
 * dropped and an empty name left out (the TV names a source by its host).
 */
export function checkForm(type: SourceType, values: FormValues): CheckedForm {
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
  } else {
    const url = link('playlist', values.playlist);
    if (url !== null) source = { type, url };
  }
  if (source === null || Object.keys(problems).length > 0) return { problems, payload: null };

  const name = field('name');
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

/** The first refused field in screen order, for the focus. */
export function firstProblem(type: SourceType, values: FormValues, problems: FormProblems): FieldKey | null {
  const order: FieldKey[] = [...REQUIRED[type], ...values.epg.map((_, i): FieldKey => `epg${i}`), 'name'];
  return order.find((key) => problems[key] !== undefined) ?? null;
}
