import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CryptoVectors } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import { checkQr } from '@lablo/core/check-qr';
import { checkSamples } from '@lablo/protocol/check-samples';
import { BACKUP_CHECK_NAMES } from '@lablo/data/check-backup';
import { expect, test } from '@playwright/test';

/**
 * The vectors page (RELAY steps 29b1, 29b2a and 31c1; `dist/tv-vectors` from pnpm build:tv) from
 * file:// in current Chromium: every shared crypto vector, protocol sample and QR case passes in the page
 * and in its Blob worker, under the names Node's run gives; and (step 32b) the backup worker's checks
 * pass in a worker of their own, with the page's IndexedDB. The old engines run the same page in
 * `pnpm verify:engines`.
 */
const INDEX = path.resolve(import.meta.dirname, '../dist/tv-vectors/index.html');
const VECTORS = path.resolve(import.meta.dirname, '../packages/crypto/test/vectors.json');

/** The page's report global (apps/tv/src/vectors/vectors-protocol.ts). */
type VectorsWindow = Window & { __LABLO_VECTORS__?: { page: Run; worker: Run; backup: Run } };

interface Run {
  readonly results: ReadonlyArray<{ readonly name: string; readonly ok: boolean; readonly detail: string }> | null;
  readonly error: string | null;
  readonly where: string;
}

test('the crypto vectors and protocol samples pass from file:// in the page and in a Blob worker, and the backup worker checks in another', async ({ page }) => {
  expect(existsSync(INDEX), `${INDEX} is missing: run pnpm build:tv before pnpm e2e`).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  const crypto = await checkVectors(JSON.parse(readFileSync(VECTORS, 'utf8')) as CryptoVectors);
  const samples = checkSamples();
  expect(samples.length).toBeGreaterThan(0);
  const qr = checkQr();
  expect(qr.filter((r) => !r.ok)).toEqual([]);
  const expected = [...crypto, ...samples, ...qr].map((r) => r.name);

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
  // The backup worker's checks (step 32b): its master and code kept in IndexedDB, then deleted.
  expect(report.backup.error).toBeNull();
  expect(report.backup.where).toBe('worker');
  expect(report.backup.results?.filter((r) => !r.ok)).toEqual([]);
  expect(report.backup.results?.map((r) => r.name)).toEqual(BACKUP_CHECK_NAMES);
  await expect(page.locator('#out')).toContainText(`backup worker: ${BACKUP_CHECK_NAMES.length}/${BACKUP_CHECK_NAMES.length} passed`);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('lablo-backup-check');
  expect(errors).toEqual([]);
});
