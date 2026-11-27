import { expect, test } from '@playwright/test';
import { misfits } from './text-fit';

/**
 * The text-fit detector itself (RELAY step 58a), on a page made for it: each kind of misfit it
 * must find, and each fit it must leave alone. Its mutants die here (the app's walk,
 * text-fit.spec.ts, only shows the app fits).
 */
const PAGE = `<!doctype html>
<html><head><style>
  body { margin: 0; font: 20px/30px sans-serif; }
  .row { width: 400px; height: 60px; margin: 0 0 100px; background: #222; }
  .clip { overflow: hidden; }
  .one { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .two { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .plain { width: 400px; height: 30px; }
  .z-button { display: inline-block; width: 120px; height: 40px; background: #444; }
  .tight { font: 64px/76px sans-serif; }
  .bar { width: 300px; height: 60px; background: #333; white-space: nowrap; }
</style></head><body>
  <div class="row" data-testid="spills"><div>one line</div><div>two</div><div>three lines spill</div></div>
  <div class="row clip" data-testid="clipped"><div>one line</div><div>two</div><div>three lines cut</div></div>
  <div class="row" data-testid="fits"><div>one line</div><div>two lines fit</div></div>
  <div class="row"><span class="one" data-testid="own-cut">Our own words, far too many of them for one line of this row</span></div>
  <div class="row"><span class="one" translate="no">A provider's long channel name, cut on purpose with an ellipsis</span></div>
  <div class="row"><span class="two" translate="no">A provider's long programme title that wraps past its two lines and is cut on purpose there</span></div>
  <div class="row" style="height: 76px"><span class="one tight" data-testid="tight">Tall</span></div>
  <div class="plain"><div>A box with nothing drawn</div><div>holds no text: nothing to spill out of</div></div>
  <div class="bar" data-testid="bar"><span class="z-button">One</span><span class="z-button">Two</span><span class="z-button" aria-label="Edit"></span></div>
  <div class="row" style="visibility: hidden"><div>hidden</div><div>so</div><div>never counted</div></div>
  <div class="row"><div>&#x2068;&#x200f;isolated&#x2069;</div></div>
  <div class="keyed"><span class="z-button" data-testid="dot-on" style="position: relative; width: auto; padding: 0 10px; line-height: 40px">Guide<span class="z-button__key" style="position: absolute; top: 12px; right: 6px; width: 12px; height: 12px"></span></span></div>
  <div class="keyed"><span class="z-button" data-testid="dot-off" style="position: relative; width: auto; padding: 0 24px; line-height: 40px">Guide<span class="z-button__key" style="position: absolute; top: 2px; right: 6px; width: 12px; height: 12px"></span></span></div>
</body></html>`;

test('finds text over a box, cut by it, own words cut short and a button out of its bar; leaves fits, provider text, tight lines and boxes that draw nothing', async ({ page }) => {
  await page.setContent(PAGE);
  const found = await misfits(page);
  const by = (box: string) => found.filter((f) => f.box === box);
  expect(by('spills').map((f) => [f.text, f.how])).toEqual([['three lines spill', 'spills']]);
  // The glyphs of a loose line (20 px in 30): out by most of the line.
  expect(by('spills')[0]!.by).toBeGreaterThan(20);
  expect(by('clipped').map((f) => [f.text, f.how])).toEqual([['three lines cut', 'clipped']]);
  expect(by('fits')).toEqual([]);
  expect(by('own-cut').map((f) => f.how)).toEqual(['cut']);
  expect(by('bar').map((f) => [f.text, f.how, f.by])).toEqual([['button Edit', 'spills', 60]]);
  expect(by('dot-on').map((f) => [f.text, f.how])).toEqual([['Guide', 'covered']]);
  // Nothing else: the provider's cut text, the tight line, the bare box, the hidden row, the isolates, the dot clear of its words.
  expect(found).toHaveLength(5);
});

test('a root narrows the look; a misfit by one pixel or less is layout rounding', async ({ page }) => {
  await page.setContent(PAGE);
  expect(await misfits(page, '[data-testid=fits]')).toEqual([]);
  expect((await misfits(page, '[data-testid=spills]')).map((f) => f.text)).toEqual(['three lines spill']);
  // Tight lines (20 px in 20): the line box counts, 40 px for two.
  await page.setContent('<div style="width: 300px; height: 39px; background: #222; font: 20px/20px sans-serif"><div>a</div><div>b</div></div>');
  expect(await misfits(page)).toEqual([]);
  await page.setContent('<div style="width: 300px; height: 38px; background: #222; font: 20px/20px sans-serif"><div>a</div><div>b</div></div>');
  expect((await misfits(page)).map((f) => [f.text, f.by])).toEqual([['b', 2]]);
});
