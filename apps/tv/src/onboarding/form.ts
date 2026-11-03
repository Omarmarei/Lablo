import type { XtreamAccount } from '@zoma/core';
import { normalizeXtreamBase } from '@zoma/core';

/**
 * The "add a source" form (RELAY step 13a): its fields per source type and the checks that run
 * on the TV before anything is fetched. What the provider says about the login is step 13b's.
 */

export type SourceType = 'xtream' | 'm3u';

export type FieldId = 'server' | 'username' | 'password' | 'playlist' | 'epg' | 'name';

export interface FieldSpec {
  readonly id: FieldId;
  /** `url` gets the TV keyboard's URL layout; `password` hides what is typed. */
  readonly kind: 'text' | 'url' | 'password';
  readonly required: boolean;
}

/** The fields in screen order. The guide link and the name are optional on both. */
export const FORM_FIELDS: Readonly<Record<SourceType, readonly FieldSpec[]>> = {
  xtream: [
    { id: 'server', kind: 'url', required: true },
    { id: 'username', kind: 'text', required: true },
    { id: 'password', kind: 'password', required: true },
    { id: 'epg', kind: 'url', required: false },
    { id: 'name', kind: 'text', required: false },
  ],
  m3u: [
    { id: 'playlist', kind: 'url', required: true },
    { id: 'epg', kind: 'url', required: false },
    { id: 'name', kind: 'text', required: false },
  ],
};

/** Why a field is refused: empty, not an http(s) address, or a link with spaces in it. */
export type FieldProblem = 'required' | 'url' | 'spaces';

export type FormValues = Partial<Record<FieldId, string>>;
export type FormProblems = Partial<Record<FieldId, FieldProblem>>;

/** A source as the form gives it; step 13b loads it through the data engine. */
export type SourceDraft =
  | { readonly type: 'xtream'; readonly name: string; readonly account: XtreamAccount; readonly epgUrl: string | null }
  | { readonly type: 'm3u'; readonly name: string; readonly url: string; readonly epgUrl: string | null };

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const HTTP = /^https?$/i;
const WHITESPACE = /\s/;
/** `host[:port]` with no login in it. */
const AUTHORITY = /^[^:/@?#]+(?::\d{1,5})?$/;

/**
 * A link from what was typed on a remote: trimmed, `http://` added when no scheme was given
 * (TV keyboards make `://` slow to type). `null` when it has spaces, another scheme, no host,
 * or a login in the address.
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

/** The host of a link `normalizeLink` or `normalizeXtreamBase` gave, for a default name. */
export function linkHost(link: string): string {
  const start = link.indexOf('://') + 3;
  let end = link.length;
  for (const mark of [':', '/', '?', '#']) {
    const at = link.indexOf(mark, start);
    if (at !== -1 && at < end) end = at;
  }
  return link.slice(start, end);
}

function linkProblem(text: string, normalized: string | null): FieldProblem | null {
  if (normalized !== null) return null;
  return WHITESPACE.test(text.trim()) ? 'spaces' : 'url';
}

export interface CheckedForm {
  /** Each refused field's problem; empty when the form is fine. */
  readonly problems: FormProblems;
  /** The source, when nothing was refused. */
  readonly draft: SourceDraft | null;
}

/**
 * Checks the form: required fields filled, links that are http(s) addresses. Usernames and
 * passwords are trimmed: TV keyboards can add a space after a word, and providers' logins have
 * none at the ends. A missing name becomes the server's host.
 */
export function checkForm(type: SourceType, values: FormValues): CheckedForm {
  const problems: FormProblems = {};
  const text = (id: FieldId): string => (values[id] ?? '').trim();
  for (const field of FORM_FIELDS[type]) {
    if (field.required && text(field.id) === '') problems[field.id] = 'required';
  }

  const link = (id: FieldId, normalize: (input: string) => string | null): string | null => {
    if (text(id) === '' || problems[id] !== undefined) return null;
    const normalized = normalize(text(id));
    const problem = linkProblem(text(id), normalized);
    if (problem !== null) problems[id] = problem;
    return normalized;
  };
  const epgUrl = link('epg', normalizeLink);

  if (type === 'xtream') {
    const base = link('server', normalizeXtreamBase);
    if (base === null || Object.keys(problems).length > 0) return { problems, draft: null };
    const account: XtreamAccount = { base, username: text('username'), password: text('password') };
    return { problems, draft: { type, name: text('name') || linkHost(base), account, epgUrl } };
  }
  const url = link('playlist', normalizeLink);
  if (url === null || Object.keys(problems).length > 0) return { problems, draft: null };
  return { problems, draft: { type, name: text('name') || linkHost(url), url, epgUrl } };
}

/** The first refused field in screen order, or -1. */
export function firstProblem(type: SourceType, problems: FormProblems): number {
  const fields = FORM_FIELDS[type];
  for (let i = 0; i < fields.length; i++) {
    if (problems[fields[i]!.id] !== undefined) return i;
  }
  return -1;
}
