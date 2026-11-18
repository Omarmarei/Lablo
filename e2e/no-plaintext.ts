/**
 * The search behind RELAY step 31e's "no plaintext" test: does any of a source's secrets (its
 * server, login, links, name, a file's lines) appear in what the web app received or keeps?
 *
 * A needle is looked for as UTF-8 bytes in each way a server or a client could write it down: as it
 * is; JSON-escaped (`\/` for a slash, `\uXXXX` in lower or upper case for each non-ASCII
 * character); percent-encoded (as a whole component, as a URI, and as a form with `+` for spaces).
 * Every base64 or base64url run of 16 characters or more in the haystack is decoded and searched
 * too, so a payload sent encoded but not sealed is caught.
 */

const BACKSLASH = String.fromCharCode(92);

/** The text as UTF-8 bytes read one byte per character, so a byte search is a string search. */
const bytesText = (text: string): string => Buffer.from(text, 'utf8').toString('latin1');

/** `text` with each character over 0x7f as a JSON `\uXXXX` escape (UTF-16 code units, as JSON writes them). */
function escapeNonAscii(text: string, upper: boolean): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      out += text.charAt(i);
      continue;
    }
    const hex = unit.toString(16).padStart(4, '0');
    out += `${BACKSLASH}u${upper ? hex.toUpperCase() : hex}`;
  }
  return out;
}

/** The ways `needle` may be written down, each once, as it is first. */
export function needleForms(needle: string): string[] {
  const json = JSON.stringify(needle).slice(1, -1);
  const forms = [
    needle,
    json,
    json.split('/').join(`${BACKSLASH}/`),
    escapeNonAscii(json, false),
    escapeNonAscii(json, true),
    escapeNonAscii(json, false).split('/').join(`${BACKSLASH}/`),
    encodeURIComponent(needle),
    encodeURIComponent(needle).split('%20').join('+'),
    encodeURI(needle),
  ];
  return forms.filter((form, i) => form !== '' && forms.indexOf(form) === i);
}

const BASE64_RUNS = [/[A-Za-z0-9_-]{16,}/g, /[A-Za-z0-9+/]{16,}={0,2}/g];

/** The haystack's text (one character per byte), then each base64 run in it decoded, the same way. */
function searchable(haystack: Uint8Array | string): string[] {
  const text = typeof haystack === 'string' ? bytesText(haystack) : Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).toString('latin1');
  const out = [text];
  for (const pattern of BASE64_RUNS) {
    for (const run of text.match(pattern) ?? []) out.push(Buffer.from(run, 'base64').toString('latin1'));
  }
  return out;
}

/** The needles found anywhere in the haystack, in any of their forms, in the order given. */
export function leaks(haystack: Uint8Array | string, needles: readonly string[]): string[] {
  const texts = searchable(haystack);
  return needles.filter((needle) => needleForms(needle).some((form) => texts.some((text) => text.indexOf(bytesText(form)) !== -1)));
}
