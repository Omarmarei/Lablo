/**
 * Logins and links in the profile (RELAY step 32d4a, architecture.md §3.3 B): what the backup
 * leaves out when "Include logins and links" is off (`backupLogins: false`), and how the app tells
 * a source or guide a backup without them brought back.
 *
 * - **A login** is an Xtream source's user name and password, an M3U source's link, whole, and each
 *   of the user's guide links, whole: a playlist or guide link carries its login in its path or its
 *   query as often as not, and nothing tells the two apart. The channels played last keep each
 *   channel's stream URL, which holds the login too, and its catch-up template: both go
 *   (`url: ''`, `catchup: null`; the start doesn't play a channel with no URL, and Home's "Recent
 *   channels" plays from the catalog by key).
 * - **Kept:** everything else: ids, names, order, favourites, places, offsets, mappings, an Xtream
 *   source's server (`base`, which `normalizeXtreamBase` keeps free of logins) and a link's origin
 *   (`scheme://host[:port]`; `''` when the link has none that is only a host and a port).
 * - **Stripping** works on the stored document as it is, field by field, and keeps each field's
 *   place: a document stripped twice, or stripped after a login was given back, gives the same
 *   JSON, so the backup's `same` holds.
 *
 * Pure, with no data module behind it: the backup worker strips with it, and the app's main
 * (`@lablo/data/client`) reads `lacksLogin`. Written in the TV's subset (no spread, no `for…of`,
 * no regex `.test`).
 */
import type { IngestSource } from './ingest';
import type { AnyProfile } from './profile';

/** A refresh's source without its login: what a `SourceWithoutLogin` gives the app (`ingestSourceOf`). */
export type LinkWithoutLogin = { type: 'xtream'; account: null; base: string } | { type: 'm3u'; url: null; origin: string };

/** What the app asks the data engine to refresh: a source with its login, or one without it (refused). */
export type RefreshSource = IngestSource | LinkWithoutLogin;

/** Whether a refresh's source lacks its login (step 32d4a): the data engine refuses it (`needs-login`). */
export function lacksLogin(source: RefreshSource): source is LinkWithoutLogin {
  if (source.type === 'xtream') return source.account === null;
  return source.type === 'm3u' && source.url === null;
}

const HTTP = /^https?$/i;
/** `host[:port]`, nothing else (no login, no path). */
const HOST_PORT = /^[^\s:/\\@?#]+(?::\d{1,5})?$/;
const AUTHORITY_ENDS = ['/', '?', '#', '\\'];

/**
 * A link's origin, `scheme://host[:port]` in lower case: what a backup without logins keeps of it.
 * `''` when the link isn't http(s), or its authority is more than a host and a port (a login in it).
 */
export function linkOrigin(url: string): string {
  const start = url.indexOf('://');
  if (start === -1 || HTTP.exec(url.slice(0, start)) === null) return '';
  let end = url.length;
  for (let i = 0; i < AUTHORITY_ENDS.length; i += 1) {
    const at = url.indexOf(AUTHORITY_ENDS[i]!, start + 3);
    if (at !== -1 && at < end) end = at;
  }
  return HOST_PORT.exec(url.slice(start + 3, end)) === null ? '' : url.slice(0, end).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A copy of `record`, field by field in its order (no object spread in TV code). */
function copyOf(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) out[keys[i]!] = record[keys[i]!];
  return out;
}

/** A source without its login: an Xtream source keeps its server, an M3U link its origin; anything else as it is. */
function sourceWithoutLogin(source: unknown): unknown {
  if (!isRecord(source)) return source;
  if (source['type'] === 'xtream') {
    const account = source['account'];
    if (account === null) return source;
    const out = copyOf(source);
    out['account'] = null;
    out['base'] = isRecord(account) && typeof account['base'] === 'string' ? account['base'] : '';
    return out;
  }
  if (source['type'] === 'm3u') {
    const url = source['url'];
    if (url === null) return source;
    const out = copyOf(source);
    out['url'] = null;
    out['origin'] = typeof url === 'string' ? linkOrigin(url) : '';
    return out;
  }
  return source;
}

/** A guide without its link: its origin kept. */
function guideWithoutLink(guide: unknown): unknown {
  if (!isRecord(guide) || guide['url'] === null) return guide;
  const url = guide['url'];
  const out = copyOf(guide);
  out['url'] = null;
  out['origin'] = typeof url === 'string' ? linkOrigin(url) : '';
  return out;
}

/** A channel played last without its stream URL and catch-up template. */
function channelWithoutLogin(channel: unknown): unknown {
  if (!isRecord(channel) || !isRecord(channel['item'])) return channel;
  const item = copyOf(channel['item']);
  item['url'] = '';
  item['catchup'] = null;
  const out = copyOf(channel);
  out['item'] = item;
  return out;
}

/** `doc[field]`, a list, with each entry through `strip`, in `out` (a new array); a field that isn't a list stays as it is. */
function each(doc: AnyProfile, out: AnyProfile, field: string, strip: (entry: unknown) => unknown): void {
  const list = doc[field];
  if (!Array.isArray(list)) return;
  const stripped: unknown[] = [];
  for (let i = 0; i < list.length; i += 1) stripped.push(strip(list[i]));
  out[field] = stripped;
}

/** `doc` without its logins and links (see the module's comment): a new document; `doc` is left alone. */
export function withoutLogins(doc: AnyProfile): AnyProfile {
  const out = copyOf(doc) as AnyProfile;
  each(doc, out, 'sources', sourceWithoutLogin);
  each(doc, out, 'guides', guideWithoutLink);
  each(doc, out, 'channels', channelWithoutLogin);
  const player = doc['player'];
  if (isRecord(player)) {
    const kept = copyOf(player);
    kept['last'] = channelWithoutLogin(player['last']);
    out['player'] = kept;
  }
  return out;
}

/** What a backup sends of `doc` (step 32d4a): the document, without its logins and links when it says so. */
export function backupDoc(doc: AnyProfile): AnyProfile {
  return doc['backupLogins'] === false ? withoutLogins(doc) : doc;
}
