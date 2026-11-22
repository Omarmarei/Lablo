/**
 * The URL and credential scrubber (architecture.md §3.4; RELAY step 33a): the free text that
 * telemetry carries (a crash's message and stack) goes through it on the TV, with the user's own
 * logins, links and hosts, and again on the server, without them.
 *
 * Telemetry never collects URLs, hosts, logins or IP addresses. The scrubber over-redacts rather
 * than under-redacts: a stack that reads `[host]` where `item.tv` was is still worth having; a
 * panel's host that leaks breaks the promise. A channel or programme name has no shape to find:
 * the app's own errors never put one in their message (step 33c).
 *
 * The rules, in order (each sees the text the ones before it left):
 * 1. URLs (`scheme://` up to the next space, quote or bracket) become `[url]`, except the app's
 *    own script frames: a `file://` URL keeps only its file's name and position (`main.js:1:2345`),
 *    and a Blob worker's (`blob:file:///<uuid>:1:2`, `blob:null/<uuid>:1:2`) reads `worker:1:2`.
 * 2. The `known` strings (the TV's own logins, links and hosts), exactly, longest first. Those
 *    shorter than `KNOWN_MIN_CHARS` are skipped: a 3-character password would take every match of
 *    it with it, and the rules below still catch it inside a URL or a pair.
 * 3. Credential pairs (`password=…` and the like, and their JSON form `"password":"…"`) keep the
 *    key and read `[x]`.
 * 4. An Xtream path without its URL (`/live/<user>/<password>/…`) loses its two login segments.
 * 5. `x@y` becomes `[email]`.
 * 6. IPv4 addresses (with a port), then IPv6 ones (the full form, or any with `::`), become `[ip]`.
 * 7. Dotted names whose last label counts as a top-level domain (`isTld`: the common generic ones,
 *    and every two-letter label but `js`, a superset of the country codes) and with a letter before
 *    it become `[host]`.
 *
 * Then the text is cut to `SCRUB_MAX_CHARS`. A longer input is cut to `SCRUB_INPUT_MAX_CHARS`
 * first, with the token at the cut dropped, so a cut never leaves part of a login behind.
 *
 * Schema-free and import-free (the `@lablo/protocol/scrub` entry point): the TV's workers import
 * it without zod. ES2017 with no regex feature Chromium 53 lacks (no lookbehind, named groups or
 * `s` flag), and no `new RegExp`.
 */

/** The longest text the scrubber gives: the `crash` event's `stack` (telemetry.ts). */
export const SCRUB_MAX_CHARS = 4000;

/** The longest text it reads; past it the rest is dropped before any rule runs. */
export const SCRUB_INPUT_MAX_CHARS = 16000;

/** A known string shorter than this is not looked for. */
export const KNOWN_MIN_CHARS = 4;

/** The common generic top-level domains; every two-letter label but `js` counts as well (`isTld`). */
export const TLDS: readonly string[] = [
  'com', 'net', 'org', 'info', 'biz', 'xyz', 'top', 'online', 'site', 'live', 'stream', 'club', 'pro', 'app', 'dev',
  'cloud', 'tech', 'store', 'shop', 'link', 'click', 'space', 'website', 'host', 'icu', 'vip', 'fun', 'one', 'work',
  'world', 'today', 'life', 'media', 'network', 'digital', 'global', 'plus', 'best', 'cam', 'lol', 'buzz', 'monster',
  'rest', 'sbs', 'cyou', 'cfd', 'quest', 'bond', 'win', 'mobi', 'name', 'asia', 'tel', 'travel', 'edu', 'gov', 'mil',
  'int', 'arpa', 'local', 'lan', 'home', 'internal', 'video', 'movie', 'watch', 'film', 'show', 'news', 'tube', 'box',
  'zone', 'center', 'systems', 'services', 'solutions', 'company', 'group', 'email', 'rocks', 'ninja', 'guru', 'studio',
  'cool', 'city', 'land', 'run', 'tools', 'support', 'football', 'sport', 'games', 'onion',
];

const TLD_SET: { [tld: string]: true } = {};
for (let i = 0; i < TLDS.length; i++) TLD_SET[TLDS[i]!] = true;

/** Whether a dotted name's last label counts as a top-level domain. */
export function isTld(label: string): boolean {
  const lower = label.toLowerCase();
  if (lower.length === 2) return lower !== 'js';
  return TLD_SET[lower] === true;
}

const URL_PATTERN = /(blob:)?[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>()[\]{}]*/g;
const BLOB_NULL = /blob:null\/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const FRAME_FILE = /^[A-Za-z0-9_.-]{1,80}(:\d{1,9}){0,2}$/;
const UUID_FRAME = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}((:\d{1,9}){0,2})$/;
// A value already scrubbed (`[x]`) is taken whole: `]` ends a value, so `[x` alone would leave a `]` at each pass.
const PAIR_PATTERN =
  /\b(user|username|uname|login|pass|passwd|password|pwd|token|auth|apikey|api_key|key|secret|session|sessionid|sid|sig|signature)=(?:\[x\]|[^&\s"'`<>,;)\]}]*)/gi;
const JSON_PAIR_PATTERN =
  /("(?:user|username|uname|login|pass|passwd|password|pwd|token|auth|apikey|api_key|key|secret|session|sessionid|sid|sig|signature)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
const XTREAM_PATH = /\/(live|movie|series|timeshift)\/[^/\s"'`<>]+\/[^/\s"'`<>]+\//gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*/g;
const IPV4_PATTERN = /\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?/g;
const IPV6_PATTERN = /\[?(([0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|[0-9A-Fa-f:]*::[0-9A-Fa-f:]*)(%[A-Za-z0-9]+)?\]?(:\d{1,5})?/g;
const HOST_PATTERN = /([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,24})(?![A-Za-z0-9-])/g;
const LETTER = /[A-Za-z]/;
const TRAILING_TOKEN = /\S*$/;

/** A URL as the scrubber gives it back: the app's own script frame cut to its file, else `[url]`. */
function scrubUrl(url: string): string {
  const bare = url.slice(0, 5) === 'blob:' ? url.slice(5) : url;
  if (bare.slice(0, 7) !== 'file://') return '[url]';
  const last = bare.slice(bare.lastIndexOf('/') + 1);
  const uuid = UUID_FRAME.exec(last);
  if (uuid !== null) return 'worker' + uuid[1]!;
  return FRAME_FILE.exec(last) !== null ? last : '[url]';
}

/** The known strings worth looking for, longest first (an insertion sort: a handful of them). */
function knownOrder(known: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < known.length; i++) {
    const s = known[i];
    if (typeof s !== 'string' || s.length < KNOWN_MIN_CHARS) continue;
    let at = kept.length;
    while (at > 0 && kept[at - 1]!.length < s.length) at--;
    kept.splice(at, 0, s);
  }
  return kept;
}

/** A dotted name as `[host]` when its last label counts as a top-level domain and a letter comes before it. */
function scrubHost(name: string, _label: string, tld: string): string {
  return isTld(tld) && LETTER.exec(name.slice(0, name.length - tld.length)) !== null ? '[host]' : name;
}

/** The text with URLs, logins, addresses and hosts taken out (the rules above). */
export function scrubText(text: string, known: readonly string[] = []): string {
  let out = String(text);
  if (out.length > SCRUB_INPUT_MAX_CHARS) out = out.slice(0, SCRUB_INPUT_MAX_CHARS).replace(TRAILING_TOKEN, '');
  out = out.replace(URL_PATTERN, scrubUrl).replace(BLOB_NULL, 'worker');
  const order = knownOrder(known);
  for (let i = 0; i < order.length; i++) out = out.split(order[i]!).join('[login]');
  out = out
    .replace(PAIR_PATTERN, '$1=[x]')
    .replace(JSON_PAIR_PATTERN, '$1"[x]"')
    .replace(XTREAM_PATH, '/$1/[x]/[x]/')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(IPV4_PATTERN, '[ip]')
    .replace(IPV6_PATTERN, '[ip]')
    .replace(HOST_PATTERN, scrubHost);
  return out.length > SCRUB_MAX_CHARS ? out.slice(0, SCRUB_MAX_CHARS) : out;
}
