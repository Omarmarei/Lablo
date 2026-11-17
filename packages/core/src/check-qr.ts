/**
 * The QR encoder's checks for the old engines (RELAY step 31c1): one function that Node and the
 * vectors page (`dist/tv-vectors`, in a page and in a Blob worker on Chromium 53, 56 and 68) both
 * run, so `encodeQr` is proved to draw the same modules there.
 *
 * Each case's version, mask and hash (`hash53Base36` of the rows joined by `|`) came from `uqr`,
 * the unit tests' oracle (`artifacts/qr-goldens31c1.ts`), and `qr.test.ts` checks them against it
 * again. Its own entry point (`@lablo/core/check-qr`): the app never imports it. Plain ES2017
 * loops; it runs on Chromium 53.
 */
import { hash53Base36 } from './hash';
import { encodeQr } from './qr';

/** One case: the text, and what the oracle drew for it. */
export interface QrCase {
  readonly name: string;
  readonly text: string;
  readonly version: number;
  readonly mask: number;
  readonly hash: string;
}

/** One check's result, in the shape of `@lablo/crypto`'s `VectorResult`. */
export interface QrResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

function repeated(text: string, times: number): string {
  let out = '';
  for (let i = 0; i < times; i++) out += text;
  return out;
}

const KEY = 'q3mWr0Zt9xYbK2LhVd8sNfPeAj6cGu4oTy1iRk7wBzA';

export const QR_CASES: readonly QrCase[] = [
  { name: 'one letter (1-H)', text: 'A', version: 1, mask: 7, hash: '28bk3coaaji' },
  { name: 'the production link (5-M)', text: 'https://lablo.app/p#c=7K3MZ9QX&k=' + KEY, version: 5, mask: 2, hash: '17sg142a0r5' },
  { name: 'the development link (5-M)', text: 'http://127.0.0.1:3100/p#c=0123ABCD&k=' + KEY, version: 5, mask: 4, hash: '3hsu0e1yjj' },
  { name: 'Arabic (UTF-8)', text: 'لابلو: أضف مصدرًا من هاتفك', version: 4, mask: 6, hash: '1p1nwmv69tb' },
  { name: 'version 7 (version bits)', text: 'v7:' + repeated('abcdefghij', 11) + 'abcdefghi', version: 7, mask: 2, hash: '21ai3x6fni7' },
  { name: 'version 10 (16-bit count, 5 blocks)', text: 'v10:' + repeated('0123456789ABCDEFGHIJ', 10) + '012345678', version: 10, mask: 2, hash: 'uws6pcs5bc' },
];

/** The rows' hash, as the cases keep it. */
export function qrHash(rows: readonly string[]): string {
  return hash53Base36(rows.join('|'));
}

/** Every case (default `QR_CASES`) encoded and compared with what the oracle drew. */
export function checkQr(cases: readonly QrCase[] = QR_CASES): QrResult[] {
  const results: QrResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    const started = Date.now();
    let detail = '';
    try {
      const qr = encodeQr(c.text);
      if (qr === null) detail = 'did not fit';
      else if (qr.version !== c.version || qr.mask !== c.mask) detail = 'version ' + qr.version + ' mask ' + qr.mask + ', expected ' + c.version + ' and ' + c.mask;
      else if (qrHash(qr.rows) !== c.hash) detail = 'modules hash ' + qrHash(qr.rows) + ', expected ' + c.hash;
    } catch (error) {
      detail = 'threw ' + String(error);
    }
    results.push({ name: 'qr: ' + c.name, ok: detail === '', detail, ms: Date.now() - started });
  }
  return results;
}
