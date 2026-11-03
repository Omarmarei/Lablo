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
 * 5. In Arabic (RELAY step 12b): the TV bundles take the engine's own locale (English), so the
 *    remote switches the language: ArrowUp x3 to the actions, ArrowRight x4 to the language
 *    button, Enter. Then `<html dir=rtl>` with the focus still on the button, the same layout
 *    checks (mirrored: the channel list on the right), the Arabic plural `240 قناةً`, and the
 *    bidi probe (`BIDI_EXPRESSION`): the runtime's isolation (core's `isolateText`) draws
 *    nothing and isolates. A second screenshot (`-ar.png`).
 *
 * The probe and the evaluation are unit-tested; `runGallery` drives a real engine over CDP.
 */
import { isolateText } from '@zoma/core';
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

/** From row 1: up past row 0 and the rail to the actions, right past Record to the language button, OK. */
export const SWITCH_KEYS: readonly { readonly key: string; readonly keyCode: number }[] = [
  ...[1, 2, 3].map(() => ({ key: 'ArrowUp', keyCode: 38 })),
  ...[1, 2, 3, 4].map(() => ({ key: 'ArrowRight', keyCode: 39 })),
  { key: 'Enter', keyCode: 13 },
];

/** The demo's channel count in Arabic: 240 takes the plural form `many` (apps/tv/src/i18n/ar.ts). */
export const ARABIC_COUNT = '240 قناةً';

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
  /** `<html dir>`, and the gallery's `data-language` and `data-zone`. */
  readonly dir: string;
  readonly language: string | null;
  readonly zone: string | null;
  /** The language button's `data-state`. */
  readonly switchState: string | null;
  /** The header's locale tag and channel count. */
  readonly meta: string;
  /** The left edges of the channel list and the first tile: the list is on the right in Arabic. */
  readonly columns: readonly [number, number] | null;
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
  var language = document.querySelector('[data-testid="language"]');
  var meta = document.querySelector('.gallery__meta');
  var channels = document.querySelector('[data-testid="channels"]');
  var tile = document.querySelector('[data-testid="tile-0"]');
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
    fonts: fonts(),
    dir: root.getAttribute('dir') || '',
    language: gallery ? gallery.getAttribute('data-language') : null,
    zone: gallery ? gallery.getAttribute('data-zone') : null,
    switchState: language ? language.getAttribute('data-state') : null,
    meta: meta ? meta.textContent : '',
    columns: channels && tile ? [Math.round(channels.getBoundingClientRect().left), Math.round(tile.getBoundingClientRect().left)] : null
  });
})()`;

/** Left edges in px of two parts of one RTL line: `first` comes first in the text. */
export interface BidiPair {
  readonly first: number;
  readonly second: number;
}

/** The bidi probe's answer (see `BIDI_EXPRESSION`). */
export interface BidiState {
  /** `Zoma 1`, and the same as `isolateText` gives it: equal when the isolation draws nothing. */
  readonly plain: number;
  readonly isolated: number;
  /** `MBC 1 · 240 قناة`: the name and the count, isolated and not (the control). */
  readonly trailing: BidiPair;
  readonly trailingControl: BidiPair;
  /** `1 Zoma قناة`: the digit and the name, isolated and not. */
  readonly leading: BidiPair;
  readonly leadingControl: BidiPair;
}

const BACKSLASH = String.fromCharCode(92);

/** A JS string literal of `text` with every non-ASCII code unit escaped: the probe's source stays ASCII. */
export function jsString(text: string): string {
  let out = "'";
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    out += c < 0x20 || c > 0x7e || c === 0x27 || c === 0x5c ? `${BACKSLASH}u${c.toString(16).padStart(4, '0')}` : text.charAt(i);
  }
  return `${out}'`;
}

/** An Arabic word ("channel") for the probe's lines. */
const WORD = 'قناة';

/** The probe's lines, isolated exactly as the i18n runtime isolates a text argument in an Arabic sentence. */
export const BIDI_LINES = {
  plain: 'Zoma 1',
  isolated: isolateText('Zoma 1', 'rtl'),
  trailing: `${isolateText('MBC 1', 'rtl')} · 240 ${WORD}`,
  trailingControl: `MBC 1 · 240 ${WORD}`,
  leading: `${isolateText('1 Zoma', 'rtl')} ${WORD}`,
  leadingControl: `1 Zoma ${WORD}`,
} as const;

/**
 * Evaluated once, in Arabic, in the gallery's own font: how the engine draws text arguments as
 * the i18n runtime isolates them (core's `isolateText`, ADR-011).
 * 1. Width: the isolated span is as wide as the plain one (no tofu, no gap).
 * 2. A Latin name ending in a digit, then a count, in an RTL line. Not isolated, the count joins
 *    the name's run (bidi rule W7) and `MBC 1 · 240` reads left to right with the name on the
 *    left; isolated, the name stays one unit at the line's start, on the right.
 * 3. A name starting with a digit: not isolated, the digit splits off to the name's right;
 *    isolated, `1 Zoma` reads left to right as one unit.
 * The controls (not isolated) prove each line can tell the two apart on the engine.
 * Plain ES5 with ASCII-only source (`jsString`).
 */
export const BIDI_EXPRESSION = `(function () {
  var host = document.querySelector('.gallery') || document.body;
  var box = document.createElement('div');
  box.setAttribute('style', 'position: absolute; left: 0; top: 0; visibility: hidden; white-space: nowrap; font-size: 32px;');
  host.appendChild(box);
  function width(text) {
    var span = document.createElement('span');
    span.textContent = text;
    box.appendChild(span);
    return Math.round(span.getBoundingClientRect().width * 10) / 10;
  }
  function left(node, at, length) {
    var range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + length);
    return Math.round(range.getBoundingClientRect().left * 10) / 10;
  }
  function pair(text, first, second) {
    var line = document.createElement('div');
    line.setAttribute('dir', 'rtl');
    line.textContent = text;
    box.appendChild(line);
    var node = line.firstChild;
    return { first: left(node, text.indexOf(first), first.length), second: left(node, text.indexOf(second), second.length) };
  }
  try {
    return JSON.stringify({
      plain: width(${jsString(BIDI_LINES.plain)}),
      isolated: width(${jsString(BIDI_LINES.isolated)}),
      trailing: pair(${jsString(BIDI_LINES.trailing)}, 'MBC', '240'),
      trailingControl: pair(${jsString(BIDI_LINES.trailingControl)}, 'MBC', '240'),
      leading: pair(${jsString(BIDI_LINES.leading)}, '1', 'Zoma'),
      leadingControl: pair(${jsString(BIDI_LINES.leadingControl)}, '1', 'Zoma')
    });
  } finally {
    host.removeChild(box);
  }
})()`;

/** How far the isolation may widen a span (sub-pixel rounding only). */
const ISOLATE_SLACK_PX = 0.5;

/** Everything wrong with the bidi probe's answer; empty when the isolation works on the engine. */
export function bidiFailures(bidi: BidiState): string[] {
  const failures: string[] = [];
  const extra = Math.round((bidi.isolated - bidi.plain) * 10) / 10;
  if (Math.abs(extra) > ISOLATE_SLACK_PX) failures.push(`the isolation is drawn: ${extra} px wider (${bidi.plain} to ${bidi.isolated}), expected no width`);
  const { trailing, trailingControl, leading, leadingControl } = bidi;
  if (trailing.first <= trailing.second) {
    failures.push(`a name ending in a digit: the count joined it (the name at x=${trailing.first}, left of the count at ${trailing.second})`);
  }
  if (trailingControl.first >= trailingControl.second) {
    failures.push(`the control for a name ending in a digit did not join (x=${trailingControl.first} vs ${trailingControl.second}): the line proves nothing`);
  }
  if (leading.first >= leading.second) {
    failures.push(`a name starting with a digit: the digit split off (at x=${leading.first}, right of the name at ${leading.second})`);
  }
  if (leadingControl.first <= leadingControl.second) {
    failures.push(`the control for a name starting with a digit did not split (x=${leadingControl.first} vs ${leadingControl.second}): the line proves nothing`);
  }
  return failures;
}

export interface GalleryRun {
  readonly platform: TvPlatform;
  readonly url: string;
  /** The state once booted, where the layout is measured (null if never read). */
  readonly boot: GalleryState | null;
  /** False when boot neither finished nor failed before the timeout. */
  readonly settled: boolean;
  /** Row 1's `data-state` after ArrowDown (null when the key was not pressed). */
  readonly afterKey: string | null;
  /** The state after the language switch (`SWITCH_KEYS`), null when the keys were not pressed. */
  readonly arabic: GalleryState | null;
  /** False when the switch never reached Arabic with its fonts loaded before the key timeout. */
  readonly switched: boolean;
  readonly bidi: BidiState | null;
  /** Where the screenshots went (null when none was asked for or it failed). */
  readonly screenshot: string | null;
  readonly arabicScreenshot: string | null;
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
export const list = (items: readonly string[]): string =>
  items.length <= LISTED ? items.join('; ') : `${items.slice(0, LISTED).join('; ')} and ${items.length - LISTED} more`;

/** The layout checks of one state: viewport, rows, safe area, labels, names, fonts. */
function layoutFailures(state: GalleryState): string[] {
  const failures: string[] = [];
  const [width, height] = state.viewport;
  if (width !== VIEWPORT.width || height !== VIEWPORT.height) {
    failures.push(`the viewport is ${width}x${height}, expected ${VIEWPORT.width}x${VIEWPORT.height}`);
  } else if (state.scroll[0] !== width || state.scroll[1] !== height) {
    failures.push(`the page scrolls: it is ${state.scroll[0]}x${state.scroll[1]}`);
  }
  if (state.rows.length !== GALLERY_ROWS) failures.push(`the channel list drew ${state.rows.length} rows, expected ${GALLERY_ROWS}`);
  const wrong = state.rows.filter((h) => h !== ROW_HEIGHT);
  if (wrong.length > 0) failures.push(`channel rows ${list([...new Set(wrong)].map((h) => `${h} px`))} tall, expected ${ROW_HEIGHT} px`);
  if (state.outside.length > 0) failures.push(`outside the safe area: ${list(state.outside)}`);
  if (state.cut.length > 0) failures.push(`labels cut: ${list(state.cut)}`);
  if (state.squeezed.length > 0) failures.push(`channel names squeezed: ${list(state.squeezed)}`);
  failures.push(...evaluateFonts(state.fonts));
  return failures;
}

/** The Arabic phase: the switch, the focus, the mirrored layout, the plural and the isolates. */
function arabicFailures(run: GalleryRun): string[] {
  const keys = 'ArrowUp x3, ArrowRight x4, Enter';
  const state = run.arabic;
  if (state === null) return [`language switch (${keys}): the page could not be read`];
  if (state.dir !== 'rtl' || state.language !== 'ar') {
    return [`language switch (${keys}): the page is dir="${state.dir}", language "${state.language ?? '-'}", expected "rtl", "ar"`];
  }
  const failures: string[] = [];
  if (!run.switched) failures.push(`in Arabic: the fonts did not settle (${state.fontsStatus ?? '-'}: ${state.fonts ?? '-'})`);
  if (state.zone !== 'language' || state.switchState !== 'focused') {
    failures.push(`in Arabic: the focus moved to ${state.zone ?? '-'} (language button "${state.switchState ?? '-'}"), expected it to stay on the language button`);
  }
  failures.push(...layoutFailures(state).map((f) => `in Arabic: ${f}`));
  if (state.columns === null || state.columns[0] <= state.columns[1]) {
    const where = state.columns === null ? 'missing' : `channels at x=${state.columns[0]}, tiles at x=${state.columns[1]}`;
    failures.push(`in Arabic: the layout did not mirror (${where})`);
  }
  if (state.meta.indexOf(ARABIC_COUNT) < 0) failures.push(`in Arabic: the header reads "${state.meta}", expected the count "${ARABIC_COUNT}"`);

  if (run.bidi !== null) failures.push(...bidiFailures(run.bidi).map((f) => `in Arabic: ${f}`));
  else if (run.switched) failures.push('in Arabic: the bidi probe could not be read');
  return failures;
}

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
    failures.push(...layoutFailures(boot));
    // After an uncaught error the keys are skipped; the error itself is the failure.
    if (run.exceptions.length === 0) {
      if (run.afterKey !== 'focused') failures.push(`key ${GALLERY_KEY.key}: row 1 is "${run.afterKey ?? 'nothing'}", expected "focused"`);
      else failures.push(...arabicFailures(run));
      if (run.screenshotError !== null) failures.push(`screenshot: ${run.screenshotError}`);
    }
  }

  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

/** Long enough for the focus ring's transition (`--motion-fast`, 120 ms) to end before the screenshot. */
const SETTLE_MS = 400;

/** Where the Arabic screenshot goes: next to the English one, `-ar` before `.png`. */
export function arabicScreenshot(file: string): string {
  return file.endsWith('.png') ? `${file.slice(0, -4)}-ar.png` : `${file}-ar.png`;
}

/** The switch has landed: Arabic, and its fonts have loaded (or failed). */
export function isArabicSettled(state: GalleryState): boolean {
  return state.dir === 'rtl' && state.language === 'ar' && state.fontsStatus !== 'loading' && fontsSettled(state.fonts);
}

/**
 * Loads the gallery at `url` and runs the checks above. With `screenshot`, it saves a PNG of
 * the screen after ArrowDown, and one in Arabic (`arabicScreenshot`), through `save`. The
 * caller enables the Page and Runtime domains once per connection, and starts the engine full
 * screen (`TV_SCREEN_FLAGS`).
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
    let arabic: GalleryState | null = null;
    let switched = false;
    let bidi: BidiState | null = null;
    let screenshot: string | null = null;
    let arabicShot: string | null = null;
    let screenshotError: string | null = null;
    const capture = async (file: string | null): Promise<string | null> => {
      if (file === null) return null;
      await delay(SETTLE_MS);
      try {
        const shot = await client.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' });
        if (shot.data === undefined || shot.data === '') throw new Error('the engine returned no image');
        options.save(file, Buffer.from(shot.data, 'base64'));
        return file;
      } catch (error) {
        screenshotError ??= error instanceof Error ? error.message : String(error);
        return null;
      }
    };
    if (booted.met && booted.state !== null && booted.state.bootError.trim() === '' && !watch.sawError()) {
      await pressKey(client, GALLERY_KEY);
      const after = await waitForProbe<GalleryState>(client, GALLERY_EXPRESSION, (state) => state.row1 === 'focused', options.keyTimeoutMs);
      afterKey = after.state?.row1 ?? null;
      screenshot = await capture(options.screenshot);
      if (afterKey === 'focused' && !watch.sawError()) {
        for (const key of SWITCH_KEYS) await pressKey(client, key);
        const landed = await waitForProbe<GalleryState>(client, GALLERY_EXPRESSION, isArabicSettled, options.keyTimeoutMs);
        arabic = landed.state;
        switched = landed.met;
        if (switched) {
          bidi = await readProbe<BidiState>(client, BIDI_EXPRESSION);
          arabicShot = await capture(options.screenshot === null ? null : arabicScreenshot(options.screenshot));
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
      arabic,
      switched,
      bidi,
      screenshot,
      arabicScreenshot: arabicShot,
      screenshotError,
      exceptions: watch.errors(),
      durationMs: Date.now() - started,
    };
  } finally {
    watch.stop();
  }
}
