import type { FileFeed, PairFileFailure } from '@lablo/data/client';
import type { PairPayload, PairStatus } from '@lablo/protocol';
import type { FormValues, SourceDraft } from '../onboarding/form';
import { checkForm, normalizeLink } from '../onboarding/form';
import type { LoadErrorCode } from '../onboarding/loader';
import { LoadError } from '../onboarding/loader';

/**
 * The phone's payload as a source, and what the TV tells the phone (RELAY step 31c2a). Types
 * only from `@lablo/protocol`: its schemas run in the pair worker, never in main.js.
 */

/** Guide links a payload may bring (`PAIR_EPG_MAX`; the schema checked it in the worker). */
export const PAIR_GUIDES_MAX = 4;

/** What a file's draft takes from the pairing screen (step 31d2b1). */
export interface FileParts {
  /** The name of a file sent without one (the catalog's `pair.fileName`). */
  readonly name: string;
  /** Fetches the file's frames on the session the payload came on (`PairSession.file`). */
  readonly file: () => Promise<FileFeed>;
}

/**
 * The source the phone sent, through the TV form's own checks (`checkForm`: the server or link
 * normalized, the login trimmed, the name or the host), its guide links through `normalizeLink`
 * (one given twice is kept once). An M3U file (step 31d2b1) has no link to check: its name
 * trimmed (none: `parts.name`) and `parts.file`. `null` for a payload the form would refuse, or a
 * guide link it would refuse.
 */
export function pairDraft(payload: PairPayload, parts: FileParts): SourceDraft | null {
  const source = payload.source;
  const given = payload.epg === undefined ? [] : payload.epg;
  const urls: string[] = [];
  for (let i = 0; i < given.length && i < PAIR_GUIDES_MAX; i += 1) {
    const url = normalizeLink(given[i]!);
    if (url === null) return null;
    if (urls.indexOf(url) === -1) urls.push(url);
  }
  const name = payload.name === undefined ? '' : payload.name;
  if (source.type === 'm3u-file') {
    const named = name.trim();
    return { type: 'm3u-file', name: named === '' ? parts.name : named, epgUrls: urls, file: parts.file };
  }
  const values: FormValues =
    source.type === 'xtream' ? { server: source.server, username: source.username, password: source.password, name } : { playlist: source.url, name };
  const draft = checkForm(source.type, values).draft;
  if (draft === null) return null;
  return draft.type === 'xtream'
    ? { type: 'xtream', name: draft.name, account: draft.account, epgUrls: urls }
    : { type: 'm3u', name: draft.name, url: draft.url, epgUrls: urls };
}

/**
 * Why the phone's file couldn't be fetched, as the load's error: not there any more (`gone`) or
 * not one this TV can open (`file`) is `file`; the connection, the server or its answer `network`.
 */
export function fileError(failure: PairFileFailure): LoadError {
  return new LoadError(failure === 'gone' || failure === 'file' ? 'file' : 'network');
}

/**
 * The status the phone gets for a load that failed (`refused`: the config's `block-new-sources`):
 * a refused login; an account the panel says is expired, banned or turned off (both "contact your
 * provider"); a server Lablo refuses; anything else is "couldn't reach", a file the TV couldn't
 * read too (the phone words `unreachable` after a file as such: step 31d2b2).
 */
export function statusFor(code: LoadErrorCode | 'refused'): PairStatus {
  if (code === 'auth') return 'auth_failed';
  if (code === 'expired' || code === 'blocked') return 'expired';
  if (code === 'blocklisted' || code === 'refused') return 'blocked';
  return 'unreachable';
}
