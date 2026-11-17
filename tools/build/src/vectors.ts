/**
 * The crypto vectors page (RELAY step 29b1): @lablo/crypto's shared vectors run through the TV
 * pipeline, so the old engines check the TV's crypto path (apps/tv/src/vectors). It is no app:
 * no manifest, no package, no CSS; one folder for both platforms (`dist/tv-vectors`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The vectors file the Node tests read too. */
export const VECTORS_JSON = 'packages/crypto/test/vectors.json';

/** The global the data script sets and vectors-main.ts reads. */
export const VECTORS_GLOBAL = 'LABLO_CRYPTO_VECTORS';

/**
 * `vectors.js`: the vectors as a classic script (the bundle takes no JSON imports). The file
 * is ASCII JSON (vectors.test.ts), so it parses as an ES2016 expression.
 */
export function vectorsDataScript(json: string): string {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 1) {
    throw new Error(`${VECTORS_JSON} is not version 1 of the crypto vectors`);
  }
  // The file's own text, not JSON.stringify's: that would turn its `\u` escapes back into raw
  // characters, which a file:// script may decode in the wrong charset.
  return `window.${VECTORS_GLOBAL} = ${json.trim()};\n`;
}

export function readVectorsJson(root: string): string {
  return readFileSync(path.join(root, VECTORS_JSON), 'utf8');
}

export function renderVectorsIndexHtml(): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=1920">',
    '<title>Lablo crypto vectors</title>',
    '<style>body{margin:48px 96px;background:#111;color:#eee;font:24px/1.4 monospace}pre{white-space:pre-wrap}</style>',
    '</head>',
    '<body>',
    '<pre id="out">loading</pre>',
    '<script src="vectors.js"></script>',
    '<script src="main.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
