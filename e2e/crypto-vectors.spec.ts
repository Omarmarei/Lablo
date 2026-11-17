import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import { expect, test } from '@playwright/test';

/**
 * The crypto vectors page (RELAY step 29b1; `dist/tv-vectors` from pnpm build:tv) from file://
 * in current Chromium: every shared vector passes in the page and in its Blob worker, under the
 * names Node's run gives. The old engines run the same page in `pnpm verify:engines`.
 */
const INDEX = path.resolve(import.meta.dirname, '../dist/tv-vectors/index.html');
const VECTORS = path.resolve(import.meta.dirname, '../packages/crypto/test/vectors.json');

/** The page's report global (apps/tv/src/vectors/vectors-protocol.ts). */
type VectorsWindow = Window & { __LABLO_VECTORS__?: { page: Run; worker: Run } };

interface Run {
  readonly results: ReadonlyArray<{ readonly name: string; readonly ok: boolean; readonly detail: string }> | null;
  readonly error: string | null;
  readonly where: string;
}

test('the crypto vectors pass from file:// in the page and in a Blob worker', async ({ page }) => {
  expect(existsSync(INDEX), `${INDEX} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  const expected = (await checkVectors(JSON.parse(readFileSync(VECTORS, 'utf8')) as CryptoVectors)).map((r) => r.name);

  await page.goto(pathToFileURL(INDEX).href);
  await page.waitForFunction(() => (window as VectorsWindow).__LABLO_VECTORS__ !== undefined, undefined, { timeout: 60_000 });
  const report = (await page.evaluate(() => (window as VectorsWindow).__LABLO_VECTORS__))!;
  for (const [label, run] of [
    ['page', report.page],
    ['worker', report.worker],
  ] as const) {
    expect(run.error, label).toBeNull();
    expect(run.where, label).toBe(label);
    expect(run.results?.filter((r) => !r.ok), label).toEqual([]);
    expect(run.results?.map((r) => r.name), label).toEqual(expected);
  }
  await expect(page.locator('#out')).toContainText(`page: ${expected.length}/${expected.length} passed`);
  await expect(page.locator('#out')).toContainText(`worker: ${expected.length}/${expected.length} passed`);
  expect(errors).toEqual([]);
});
