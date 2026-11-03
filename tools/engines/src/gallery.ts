/**
 * The component gallery (`?screen=gallery`, RELAY steps 11b and 11c) in an old engine. The
 * e2e tests check it in current Chromium; here every component must lay out the same way in
 * Chromium 53/56/68, from the built bundle on file://:
 * 1. Boot: no error, `[data-testid=gallery][data-ready=true]`, and the fonts in use loaded (a
 *    Latin and an Arabic Zoma Sans face: the demo channels have Arabic names).
 * 2. Layout, as `layout()` in e2e/gallery.spec.ts: a 1920x1080 viewport that doesn't scroll,
 *    every component box inside the title-safe area (96/54 px), no label of ours cut and no
 *    channel name squeezed by its badges.
 * 3. The channel list's window: 7 rows, each 88 px tall (each component's CSS reached
 *    app.css and the engine applied it).
 * 4. ArrowDown (key code 40) focuses row 1.
 * Then a CDP `Page.captureScreenshot` of the screen, for people to look at.
 *
 * The probe and the evaluation are unit-tested; `runGallery` drives a real engine over CDP.
 */
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { chromeMajor } from './engines';
import type { RunOptions, TvPlatform } from './scenario';
import { FONT_FACES_FUNCTION, blankPage, delay, evaluateFonts, fontsSettled, pressKey, readProbe, waitForProbe, watchErrors } from './scenario';

/** The TV's screen: the gallery is drawn for exactly this canvas (tokens `--screen-*`), and the engine shows it full screen. */
export const VIEWPORT = { width: 1920, height: 1080 } as const;
/** The canvas less its 5% title-safe margins (tokens `--safe-x`/`--safe-y`). */
export const SAFE_AREA = { left: 96, top: 54, right: 1824, bottom: 1026 } as const;
/** The channel list's window at 1080p (`CHANNELS_VISIBLE`) and its rows (`--row-height`). */
export const GALLERY_ROWS = 7;
export const ROW_HEIGHT = 88;
/** Down from the first channel row, where the gallery starts. */
export const GALLERY_KEY = { key: 'ArrowDown', keyCode: 40 } as const;

/** The gallery of one staged app (apps/tv/src/data/params.ts `readScreen`). */
export function galleryUrl(variant: string, platform: TvPlatform): string {
  return `file:///app/${variant}/${platform}/index.html?screen=gallery`;
}

/** The gallery as the harness sees it. */
export interface GalleryState {
  readonly href: string;
  readonly userAgent: string;
  readonly bootError: string;
  readonly ready: boolean;
  /** `innerWidth`, `innerHeight`. */
  readonly viewport: readonly [number, number];
  /** The document's `scrollWidth`, `scrollHeight`: the viewport when nothing scrolls. */
  readonly scroll: readonly [number, number];
  /** The height in px of each row the channel list drew. */
  readonly rows: readonly number[];
  /** Component boxes outside the safe area (badges hidden by their container count too). */
  readonly outside: readonly string[];
  /** Labels of ours whose text is cut. */
  readonly cut: readonly string[];
  /** Channel names squeezed by their badges: cut while narrower than half their line. */
  readonly squeezed: readonly string[];
  /** Row 1's `data-state` (`focused` after ArrowDown). */
  readonly row1: string | null;
  readonly fontsStatus: string | null;
  readonly fonts: string | null;
}

/**
 * Evaluated inside the page on every engine, so it is plain ES5 (a unit test parses it at
 * ecmaVersion 5). The selectors are those of `layout()` in e2e/gallery.spec.ts.
 */
export const GALLERY_EXPRESSION = `(function () {
  ${FONT_FACES_FUNCTION}
  var SAFE = ${JSON.stringify(SAFE_AREA)};
  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }
  function name(el) {
    return el.getAttribute('class') + ': ' + (el.textContent || '').slice(0, 40);
  }
  function cut(el) {
    return el.scrollWidth > el.clientWidth + 1;
  }
  var outside = [];
  all('.z-button, .z-chip, .z-row, .z-tile, .z-progress, .z-spinner, .gallery__badges > .z-badge, .gallery__header > *, .gallery__section').forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.left < SAFE.left || r.top < SAFE.top || r.right > SAFE.right + 0.5 || r.bottom > SAFE.bottom + 0.5) outside.push(name(el));
  });
  var badges = document.querySelector('.gallery__badges');
  if (badges) {
    var bottom = badges.getBoundingClientRect().bottom;
    all('.gallery__badges > .z-badge').forEach(function (el) {
      if (el.getBoundingClientRect().bottom > bottom + 0.5) outside.push(name(el));
    });
  }
  var labels = all('.z-button__label, .z-dialog__title, .gallery__title, .gallery__section, .gallery__meter-head > span, .z-badge, .z-row__next-head, .gallery__meta')
    .filter(function (el) { return !el.closest('.z-row__badges') && cut(el); })
    .map(name);
  var squeezed = all('.z-row__name')
    .filter(function (el) { return cut(el) && el.clientWidth < (el.parentElement ? el.parentElement.clientWidth : 0) / 2; })
    .map(name);
  var rows = all('[data-testid="channels"] .z-row').map(function (el) {
    return Math.round(el.getBoundingClientRect().height * 10) / 10;
  });
  var gallery = document.querySelector('[data-testid="gallery"]');
  var row1 = document.querySelector('[data-testid="row-1"]');
  var boot = document.getElementById('boot-error');
  var root = document.documentElement;
  return JSON.stringify({
    href: location.href,
    userAgent: navigator.userAgent,
    bootError: boot ? boot.textContent : '',
    ready: gallery !== null && gallery.getAttribute('data-ready') === 'true',
    viewport: [window.innerWidth, window.innerHeight],
    scroll: [root.scrollWidth, root.scrollHeight],
    rows: rows,
    outside: outside,
    cut: labels,
    squeezed: squeezed,
    row1: row1 ? row1.getAttribute('data-state') : null,
    fontsStatus: document.fonts ? document.fonts.status : null,
    fonts: fonts()
  });
})()`;

export interface GalleryRun {
  readonly platform: TvPlatform;
  readonly url: string;
  /** The state once booted, where the layout is measured (null if never read). */
  readonly boot: GalleryState | null;
  /** False when boot neither finished nor failed before the timeout. */
  readonly settled: boolean;
  /** Row 1's `data-state` after ArrowDown (null when the key was not pressed). */
  readonly afterKey: string | null;
  /** Where the screenshot went (null when none was asked for or it failed). */
  readonly screenshot: string | null;
  readonly screenshotError: string | null;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

/** Boot is over when it failed visibly, or the gallery is up and its fonts have loaded (or failed). */
export function isGallerySettled(state: GalleryState, url: string): boolean {
  if (state.href !== url) return false;
  if (state.bootError.trim() !== '') return true;
  return state.ready && state.fontsStatus !== 'loading' && fontsSettled(state.fonts);
}

const LISTED = 5;

/** The first few, then a count: a broken layout can put every box outside. */
const list = (items: readonly string[]): string =>
  items.length <= LISTED ? items.join('; ') : `${items.slice(0, LISTED).join('; ')} and ${items.length - LISTED} more`;

/** Everything wrong with one gallery run; empty means it passed. */
export function evaluateGallery(run: GalleryRun, engine: Pick<Engine, 'major'>, bootTimeoutMs: number): string[] {
  const boot = run.boot;
  if (boot === null) return ['the page state could not be read at all', ...run.exceptions.map((e) => `uncaught: ${e}`)];

  const failures: string[] = [];
  const major = chromeMajor(boot.userAgent);
  if (major !== engine.major) failures.push(`the engine reports Chrome ${major ?? '?'} ("${boot.userAgent}"), expected ${engine.major}`);
  if (boot.bootError.trim() !== '') failures.push(boot.bootError.trim().split('\n').join(' | '));
  else if (!run.settled) {
    failures.push(`did not finish booting within ${bootTimeoutMs / 1000} s (ready=${boot.ready}, fonts=${boot.fontsStatus ?? '-'}: ${boot.fonts ?? '-'})`);
  }

  if (boot.bootError.trim() === '' && run.settled) {
    const [width, height] = boot.viewport;
    if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
      failures.push(`the viewport is ${width}x${height}, expected ${VIEWPORT.width}x${VIEWPORT.height}`);
    } else if (boot.scroll[0] !== width || boot.scroll[1] !== height) {
      failures.push(`the page scrolls: it is ${boot.scroll[0]}x${boot.scroll[1]}`);
    }
    if (boot.rows.length !== GALLERY_ROWS) failures.push(`the channel list drew ${boot.rows.length} rows, expected ${GALLERY_ROWS}`);
    const wrong = boot.rows.filter((h) => h !== ROW_HEIGHT);
    if (wrong.length > 0) failures.push(`channel rows ${list([...new Set(wrong)].map((h) => `${h} px`))} tall, expected ${ROW_HEIGHT} px`);
    if (boot.outside.length > 0) failures.push(`outside the safe area: ${list(boot.outside)}`);
    if (boot.cut.length > 0) failures.push(`labels cut: ${list(boot.cut)}`);
    if (boot.squeezed.length > 0) failures.push(`channel names squeezed: ${list(boot.squeezed)}`);
    failures.push(...evaluateFonts(boot.fonts));
    // After an uncaught error the key is skipped; the error itself is the failure.
    if (run.exceptions.length === 0) {
      if (run.afterKey !== 'focused') failures.push(`key ${GALLERY_KEY.key}: row 1 is "${run.afterKey ?? 'nothing'}", expected "focused"`);
      if (run.screenshotError !== null) failures.push(`screenshot: ${run.screenshotError}`);
    }
  }

  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

/** Long enough for the focus ring's transition (`--motion-fast`, 120 ms) to end before the screenshot. */
const SETTLE_MS = 400;

/**
 * Loads the gallery at `url` and runs the checks above. With `screenshot`, it saves a PNG of
 * the screen after ArrowDown through `save`. The caller enables the Page and Runtime domains
 * once per connection, and starts the engine full screen (`TV_SCREEN_FLAGS`).
 */
export async function runGallery(
  client: CdpClient,
  platform: TvPlatform,
  url: string,
  options: RunOptions & { readonly screenshot: string | null; readonly save: (file: string, png: Buffer) => void },
): Promise<GalleryRun> {
  const started = Date.now();
  await blankPage(client);

  const watch = watchErrors(client);
  try {
    await client.send('Page.navigate', { url });
    const booted = await waitForProbe<GalleryState>(
      client,
      GALLERY_EXPRESSION,
      (state) => isGallerySettled(state, url) || watch.erroredOut(),
      options.bootTimeoutMs,
    );

    let afterKey: string | null = null;
    let screenshot: string | null = null;
    let screenshotError: string | null = null;
    if (booted.met && booted.state !== null && booted.state.bootError.trim() === '' && !watch.sawError()) {
      await pressKey(client, GALLERY_KEY);
      const after = await waitForProbe<GalleryState>(client, GALLERY_EXPRESSION, (state) => state.row1 === 'focused', options.keyTimeoutMs);
      afterKey = after.state?.row1 ?? null;
      if (options.screenshot !== null) {
        await delay(SETTLE_MS);
        try {
          const shot = await client.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' });
          if (shot.data === undefined || shot.data === '') throw new Error('the engine returned no image');
          options.save(options.screenshot, Buffer.from(shot.data, 'base64'));
          screenshot = options.screenshot;
        } catch (error) {
          screenshotError = error instanceof Error ? error.message : String(error);
        }
      }
      // Late errors land in #boot-error too.
      const final = await readProbe<GalleryState>(client, GALLERY_EXPRESSION);
      if (final !== null && final.bootError.trim() !== '') booted.state = final;
    }

    return {
      platform,
      url,
      boot: booted.state,
      settled: booted.met,
      afterKey,
      screenshot,
      screenshotError,
      exceptions: watch.errors(),
      durationMs: Date.now() - started,
    };
  } finally {
    watch.stop();
  }
}
