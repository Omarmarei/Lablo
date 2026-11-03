import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import type { GalleryRun, GalleryState } from './gallery';
import { GALLERY_EXPRESSION, GALLERY_ROWS, ROW_HEIGHT, SAFE_AREA, VIEWPORT, evaluateGallery, galleryUrl, isGallerySettled } from './gallery';

const URL = galleryUrl('app', 'tizen');
const UA56 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.0 Safari/537.36';
const SHOT = '/repo/artifacts/engines/gallery-chrome56-tizen.png';

function state(overrides: Partial<GalleryState> = {}): GalleryState {
  return {
    href: URL,
    userAgent: UA56,
    bootError: '',
    ready: true,
    viewport: [1920, 1080],
    scroll: [1920, 1080],
    rows: [88, 88, 88, 88, 88, 88, 88],
    outside: [],
    cut: [],
    squeezed: [],
    row1: 'idle',
    fontsStatus: 'loaded',
    fonts: 'la400:loaded la700:loaded ar400:loaded ar700:unloaded',
    ...overrides,
  };
}

function run(overrides: Partial<GalleryRun> = {}): GalleryRun {
  return {
    platform: 'tizen',
    url: URL,
    boot: state(),
    settled: true,
    afterKey: 'focused',
    screenshot: SHOT,
    screenshotError: null,
    exceptions: [],
    durationMs: 800,
    ...overrides,
  };
}

const engine56 = { major: 56 };

describe('the gallery probe', () => {
  it('is plain ES5, so it runs on every engine', () => {
    expect(() => parse(GALLERY_EXPRESSION, { ecmaVersion: 5 })).not.toThrow();
  });

  it('measures against the title-safe area of the 1920x1080 canvas', () => {
    expect(SAFE_AREA).toEqual({ left: 96, top: 54, right: VIEWPORT.width - 96, bottom: VIEWPORT.height - 54 });
    expect(GALLERY_EXPRESSION).toContain('var SAFE = {"left":96,"top":54,"right":1824,"bottom":1026};');
  });

  it('opens the gallery screen of the staged app', () => {
    expect(galleryUrl('seed-css-no-list-row', 'webos')).toBe('file:///app/seed-css-no-list-row/webos/index.html?screen=gallery');
  });
});

describe('isGallerySettled', () => {
  it('waits for this page, not the previous one', () => {
    expect(isGallerySettled(state({ href: 'about:blank' }), URL)).toBe(false);
    expect(isGallerySettled(state(), URL)).toBe(true);
  });

  it('waits for the gallery and for its fonts', () => {
    expect(isGallerySettled(state({ ready: false }), URL)).toBe(false);
    expect(isGallerySettled(state({ fontsStatus: 'loading' }), URL)).toBe(false);
    expect(isGallerySettled(state({ fonts: 'la400:loaded ar400:loading' }), URL)).toBe(false);
    // Laid out before the Arabic names asked for their face: not finished yet.
    expect(isGallerySettled(state({ fonts: 'la400:loaded ar400:unloaded' }), URL)).toBe(false);
    // A face that failed is final: evaluateGallery reports it.
    expect(isGallerySettled(state({ fonts: 'la400:loaded ar400:error' }), URL)).toBe(true);
    expect(isGallerySettled(state({ fonts: null, fontsStatus: null }), URL)).toBe(true);
  });

  it('settles at once on a boot error', () => {
    expect(isGallerySettled(state({ ready: false, fontsStatus: 'loading', bootError: 'Boot error: Uncaught SyntaxError' }), URL)).toBe(true);
  });
});

describe('evaluateGallery', () => {
  it('passes a clean run', () => {
    expect(evaluateGallery(run(), engine56, 20_000)).toEqual([]);
    expect(GALLERY_ROWS).toBe(7);
    expect(ROW_HEIGHT).toBe(88);
  });

  it('fails when the engine is not the expected version', () => {
    expect(evaluateGallery(run(), { major: 53 }, 20_000)).toEqual([expect.stringMatching(/reports Chrome 56 .*expected 53/)]);
  });

  it('reports a boot error without piling on follow-up failures', () => {
    const failed = run({
      boot: state({ bootError: 'Boot error: Uncaught SyntaxError: Unexpected token ...\n', ready: false, rows: [], fonts: '' }),
      afterKey: null,
      screenshot: null,
    });
    expect(evaluateGallery(failed, engine56, 20_000)).toEqual(['Boot error: Uncaught SyntaxError: Unexpected token ...']);
  });

  it('reports a boot that never finished', () => {
    const stuck = run({ boot: state({ fonts: 'la400:loaded ar400:unloaded' }), settled: false, afterKey: null, screenshot: null });
    expect(evaluateGallery(stuck, engine56, 20_000)).toEqual(['did not finish booting within 20 s (ready=true, fonts=loaded: la400:loaded ar400:unloaded)']);
  });

  it('needs the whole 1920x1080 screen, and nothing may scroll', () => {
    // A headed window's toolbar and the --no-sandbox bar took 106 px before TV_SCREEN_FLAGS.
    expect(evaluateGallery(run({ boot: state({ viewport: [1919, 974], scroll: [1919, 1080] }) }), engine56, 20_000)).toEqual([
      'the viewport is 1919x974, expected 1920x1080',
    ]);
    // --kiosk alone: the --no-sandbox bar still took 39 px.
    expect(evaluateGallery(run({ boot: state({ viewport: [1920, 1041], scroll: [1920, 1080] }) }), engine56, 20_000)).toEqual([
      'the viewport is 1920x1041, expected 1920x1080',
    ]);
    expect(evaluateGallery(run({ boot: state({ scroll: [1920, 1131] }) }), engine56, 20_000)).toEqual(['the page scrolls: it is 1920x1131']);
  });

  it('catches rows without their CSS, and a list that drew the wrong window', () => {
    // What seed-css-no-list-row measured on Chromium 53/56/68.
    const unstyled = run({ boot: state({ rows: [197, 196, 235, 114, 197, 235, 114] }) });
    expect(evaluateGallery(unstyled, engine56, 20_000)).toEqual(['channel rows 197 px; 196 px; 235 px; 114 px tall, expected 88 px']);
    expect(evaluateGallery(run({ boot: state({ rows: [88, 88, 88, 88, 88, 88] }) }), engine56, 20_000)).toEqual([
      'the channel list drew 6 rows, expected 7',
    ]);
    expect(evaluateGallery(run({ boot: state({ rows: [] }) }), engine56, 20_000)).toEqual(['the channel list drew 0 rows, expected 7']);
    expect(evaluateGallery(run({ boot: state({ rows: [88, 88, 88, 88.5, 88, 88, 88] }) }), engine56, 20_000)).toEqual([
      'channel rows 88.5 px tall, expected 88 px',
    ]);
  });

  it('reports boxes outside the safe area, cut labels and squeezed names', () => {
    const broken = run({
      boot: state({
        outside: ['gallery__title: Components', 'z-button is-focused: Play'],
        cut: ['z-badge: Catch-up'],
        squeezed: ['z-row__name: Zoma Documentary Channel International'],
      }),
    });
    expect(evaluateGallery(broken, engine56, 20_000)).toEqual([
      'outside the safe area: gallery__title: Components; z-button is-focused: Play',
      'labels cut: z-badge: Catch-up',
      'channel names squeezed: z-row__name: Zoma Documentary Channel International',
    ]);
    expect(evaluateGallery(run({ boot: state({ outside: ['z-tile: Desert Nights'] }) }), engine56, 20_000)).toEqual([
      'outside the safe area: z-tile: Desert Nights',
    ]);
    // Without its safe-area padding (seed-css-no-safe-area) every box is out: the first five are named.
    const edges = run({ boot: state({ outside: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }) });
    expect(evaluateGallery(edges, engine56, 20_000)).toEqual(['outside the safe area: a; b; c; d; e and 2 more']);
    const five = run({ boot: state({ outside: ['a', 'b', 'c', 'd', 'e'] }) });
    expect(evaluateGallery(five, engine56, 20_000)).toEqual(['outside the safe area: a; b; c; d; e']);
  });

  it('reports fonts that failed or did not load', () => {
    expect(evaluateGallery(run({ boot: state({ fonts: 'la400:loaded ar400:error' }) }), engine56, 20_000)).toEqual([
      'fonts: ar400:error failed to load',
      'fonts: no Arabic Zoma Sans face loaded (la400:loaded ar400:error)',
    ]);
    expect(evaluateGallery(run({ boot: state({ fonts: null, fontsStatus: null }) }), engine56, 20_000)).toEqual(['fonts: document.fonts is missing']);
  });

  it('reports a key the focus did not follow, and a screenshot that failed', () => {
    expect(evaluateGallery(run({ afterKey: 'idle' }), engine56, 20_000)).toEqual(['key ArrowDown: row 1 is "idle", expected "focused"']);
    expect(evaluateGallery(run({ afterKey: null }), engine56, 20_000)).toEqual(['key ArrowDown: row 1 is "nothing", expected "focused"']);
    const noShot = run({ screenshot: null, screenshotError: 'Page.captureScreenshot timed out after 15000 ms' });
    expect(evaluateGallery(noShot, engine56, 20_000)).toEqual(['screenshot: Page.captureScreenshot timed out after 15000 ms']);
    // No screenshot asked for (a seed's run) is fine.
    expect(evaluateGallery(run({ screenshot: null }), engine56, 20_000)).toEqual([]);
  });

  it('fails on an uncaught exception even when the screen looks fine', () => {
    const noisy = run({ exceptions: ['TypeError: x.padStart is not a function (main.js:1)'], afterKey: null, screenshot: null });
    expect(evaluateGallery(noisy, engine56, 20_000)).toEqual(['uncaught: TypeError: x.padStart is not a function (main.js:1)']);
  });

  it('fails when the page could not be read at all', () => {
    expect(evaluateGallery(run({ boot: null, exceptions: ['SyntaxError: x (main.js:1)'] }), engine56, 20_000)).toEqual([
      'the page state could not be read at all',
      'uncaught: SyntaxError: x (main.js:1)',
    ]);
  });
});
