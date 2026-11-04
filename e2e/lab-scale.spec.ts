import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loadCatalogFile } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { listen, mock } from '../apps/mock-provider/test/helpers';
import { S6_PRESSES } from '../apps/tv/src/lab/scale';
import { RemoteDriver } from './remote-driver';

/**
 * S6 at scale (RELAY step 15b): the lab in the desktop browser (`pnpm dev`) against the scale
 * fixtures, the 200k catalog and the 150 MB guide gzipped, served by an in-process mock, so every
 * S6 check is judged against architecture.md §5.
 *
 * Opt-in: `pnpm lab:scale` (Playwright project `lab-scale`). It needs `pnpm fixtures` first and
 * takes a minute or two. The numbers go to artifacts/lab-scale.json and the console; the desktop's
 * are a smoke check of the lab at scale, not the TV's (step 16 runs the lab on the TVs).
 */
const FIXTURES = path.resolve(import.meta.dirname, '../.cache/fixtures');
const CATALOG = path.join(FIXTURES, 'catalog.json');
const GUIDE = path.join(FIXTURES, 'xmltv-150mb.xml.gz');
const REPORT = path.resolve(import.meta.dirname, '../artifacts/lab-scale.json');
const STAGE_SHOT = path.resolve(import.meta.dirname, '../artifacts/lab-scale-stage.png');

interface Record {
  readonly type: string;
  readonly spike?: string;
  readonly check?: string;
  readonly status?: string;
  readonly note?: string;
  readonly value?: unknown;
}

let app: MockServer;
let base: string;
let logDir: string;

test.beforeAll(async () => {
  expect(existsSync(CATALOG) && existsSync(GUIDE), `${FIXTURES} has no scale fixtures: run pnpm fixtures first`).toBe(true);
  logDir = await mkdtemp(path.join(tmpdir(), 'zoma-lab-scale-'));
  // The real clock: the guide is moved to today, and the live screen asks now/next for today.
  app = await mock({ labLogDir: logDir, now: Date.now, catalog: loadCatalogFile(CATALOG), xmltvFile: GUIDE });
  base = await listen(app);
});
test.afterAll(async () => {
  await app.close();
  await rm(logDir, { recursive: true, force: true });
});

test('S6 on the scale fixtures, run by the remote, passes every criterion', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const remote = new RemoteDriver(page);
  await page.goto(`/lab.html?server=${base}&auto=0`);
  const lab = page.getByTestId('lab');
  await expect(lab).toHaveAttribute('data-ready', 'true');
  await remote.expectFocus('lab/actions/0');
  // Down the spikes to S6 (the last), and OK runs it alone.
  const spikes = await page.getByTestId('spikes').locator('li').count();
  for (let i = 0; i < spikes; i++) await remote.go('DOWN', `lab/spikes/${i}`);
  await expect(page.getByTestId(`spike-S6`)).toHaveClass(/is-focused/);
  await remote.press('OK');
  // The app's live screen over the lab while S6 presses keys on the 200k catalog.
  const stage = page.getByTestId('lab-stage');
  await expect(stage.getByTestId('live')).toHaveAttribute('data-status', 'ready', { timeout: 10 * 60_000 });
  await page.screenshot({ path: STAGE_SHOT });
  await expect(stage).toHaveCount(0, { timeout: 10 * 60_000 });
  await expect(lab).toHaveAttribute('data-runs', '1', { timeout: 18 * 60_000 });
  await expect(lab).toHaveAttribute('data-pending', '0', { timeout: 30_000 });
  const session = (await lab.getAttribute('data-session')) ?? '';
  const res = await fetch(`${base}/__lab/logs/${session}`);
  const records = (await res.text())
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record);
  const s6 = records.filter((r) => r.type === 'check' && r.spike === 'S6');

  await mkdir(path.dirname(REPORT), { recursive: true });
  await writeFile(REPORT, `${JSON.stringify({ at: new Date().toISOString(), session, checks: s6.map((r) => ({ check: r.check, status: r.status, note: r.note, value: r.value })) }, null, 2)}\n`);
  for (const r of s6) console.log(`[S6 ${r.check}] ${r.status}: ${r.note ?? ''}`);

  expect(s6.map((r) => [r.check, r.status])).toEqual([
    ['source', 'pass'],
    ['ingest', 'pass'],
    ['search', 'pass'],
    ['keys', 'pass'],
    ['guide', 'pass'],
    ['cold-start', 'pass'],
    ['cleanup', 'info'],
  ]);
  const value = (id: string): unknown => s6.find((r) => r.check === id)?.value;
  expect(value('ingest')).toMatchObject({ items: 200_000, expected: 200_000 });
  // Every press came while the refresh ran: this is the "during ingest" of the criterion.
  expect(value('keys')).toMatchObject({ count: S6_PRESSES.length, during: S6_PRESSES.length, refresh: { ended: 'cancelled' } });
  expect((value('guide') as { kept: number; matched: number }).matched).toBeGreaterThan(1000);
  expect((value('guide') as { kept: number }).kept).toBeGreaterThan(100_000);
});
