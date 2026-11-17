import type { PairPayload, PairStatus } from '@lablo/protocol';
import type { FormValues, SourceDraft } from '../onboarding/form';
import { checkForm, normalizeLink } from '../onboarding/form';
import type { LoadErrorCode } from '../onboarding/loader';

/**
 * The phone's payload as a source, and what the TV tells the phone (RELAY step 31c2a). Types
 * only from `@lablo/protocol`: its schemas run in the pair worker, never in main.js.
 */

/** Guide links a payload may bring (`PAIR_EPG_MAX`; the schema checked it in the worker). */
export const PAIR_GUIDES_MAX = 4;

/**
 * The source the phone sent, through the TV form's own checks (`checkForm`: the server or link
 * normalized, the login trimmed, the name or the host), its guide links through `normalizeLink`
 * (one given twice is kept once). `null` for a payload the form would refuse, a guide link it
 * would refuse, or an M3U file (step 31d): the phone page never sends one of those today.
 */
export function pairDraft(payload: PairPayload): SourceDraft | null {
  const source = payload.source;
  if (source.type === 'm3u-file') return null;
  const name = payload.name === undefined ? '' : payload.name;
  const values: FormValues =
    source.type === 'xtream' ? { server: source.server, username: source.username, password: source.password, name } : { playlist: source.url, name };
  const draft = checkForm(source.type, values).draft;
  if (draft === null) return null;
  const given = payload.epg === undefined ? [] : payload.epg;
  const urls: string[] = [];
  for (let i = 0; i < given.length && i < PAIR_GUIDES_MAX; i += 1) {
    const url = normalizeLink(given[i]!);
    if (url === null) return null;
    if (urls.indexOf(url) === -1) urls.push(url);
  }
  return draft.type === 'xtream'
    ? { type: 'xtream', name: draft.name, account: draft.account, epgUrls: urls }
    : { type: 'm3u', name: draft.name, url: draft.url, epgUrls: urls };
}

/**
 * The status the phone gets for a load that failed (`refused`: the config's `block-new-sources`):
 * a refused login; an account the panel says is expired, banned or turned off (both "contact your
 * provider"); a server Lablo refuses; anything else is "couldn't reach".
 */
export function statusFor(code: LoadErrorCode | 'refused'): PairStatus {
  if (code === 'auth') return 'auth_failed';
  if (code === 'expired' || code === 'blocked') return 'expired';
  if (code === 'blocklisted' || code === 'refused') return 'blocked';
  return 'unreachable';
}
