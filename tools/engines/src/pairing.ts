/**
 * The pairing screen on the old engines (RELAY step 31c2b): onboarding's "Use your phone", in
 * English and then in Arabic, each from a fresh database, against the stand-in pairing API on
 * the host (`startPairServer`), which the container reaches as its own 127.0.0.1:`PAIR_PORT`
 * (`forwardToHost`; a TV build takes `?api=` only for a host on the device). A scripted phone in
 * this process (`pair-phone.ts`) takes the typed-code path with the fixture's playlist link.
 *
 * Each walk:
 * 1. the language, the disclaimer, the consent ("Allow"), then DOWN twice to the source screen's
 *    third row and OK: the pair screen, its code shown (the pair worker started, the key pair
 *    made, the code asked for);
 * 2. the code checked: the text in two groups of four, the address to type, and the QR code
 *    module by module against `encodeQr` of the link the TV must hold (`<api>/p#c=<code>&k=<tvPk>`,
 *    the TV's key as the stand-in got it), at whole pixels per module, unmirrored, on the end
 *    side (right in English, left in Arabic), everything inside the title-safe area;
 * 3. the phone sends the playlist; the TV adds it (the payload opened in the pair worker, the
 *    form's checks, the engine loader) and onboarding's done screen follows; the phone reads
 *    `done` with `ok`; the profile holds the one source under the phone's name. In English the
 *    phone sends the playlist's link; in Arabic (step 31d2b2a) the playlist itself as an M3U
 *    file, padded to three frames: the pair worker fetches and opens it frame by frame and hands
 *    each frame to the ingest worker over one `MessageChannel`. The source is then `m3u-file`,
 *    and the stand-in holds no file after the TV's status.
 * The code and done views are saved as screenshots. The database is deleted after the walks.
 *
 * The steps, the probe and the evaluation are unit-tested; `runPairing` drives a real engine.
 */
import { encodeQr } from '@lablo/core';
import type { PairPayload, PairProgressResponse } from '@lablo/protocol';
import type { CdpClient } from './cdp';
import type { Engine } from './engines';
import { chromeMajor } from './engines';
import type { DataCheck } from './fixture';
import { FIXTURE_ORIGIN } from './fixture';
import { SAFE_AREA } from './gallery';
import type { Expectation, Key, StoredProfile, WalkLanguage, WalkState } from './onboarding';
import {
  KEY,
  PROFILE_EXPRESSION,
  PROFILE_RESULT,
  STALE_MARK,
  WALK_EXPRESSION,
  WALK_LANGUAGES,
  describeExpectation,
  describeState,
  resetDatabase,
  stepLanded,
  stepStuck,
  untilConfigIdle,
} from './onboarding';
import { phonePadded, phoneSees, phoneSends, phoneSendsFile } from './pair-phone';
import type { PairServer } from './pair-server';
import type { RunOptions, TvPlatform } from './scenario';
import { delay, pressKey, readProbe, waitForProbe, watchErrors } from './scenario';

/** The container's own port forwarded to the host's stand-in. */
export const PAIR_PORT = 8091;
/** The app's API origin in the walk (`?api=`): the config and the pairing routes. */
export const PAIR_ORIGIN = `http://127.0.0.1:${PAIR_PORT}`;
/** The QR code's light margin in modules (apps/tv's `QR_QUIET`; tools/ may not import apps/). */
export const QR_QUIET = 4;
/** The QR code's largest side in px (apps/tv's `QR_MAX_PX`). */
export const QR_MAX_PX = 460;

/** The app at `variant`/`platform` with its API on the forwarded port. */
export function pairingUrl(variant: string, platform: TvPlatform): string {
  return `file:///app/${variant}/${platform}/index.html?keyboard=native&api=${encodeURIComponent(PAIR_ORIGIN)}`;
}

/** The name the phone gives the source in each walk. */
export const PHONE_NAMES: Readonly<Record<WalkLanguage, string>> = { en: 'Phone list', ar: 'قائمة الهاتف' };

/** How the phone sends the playlist in each walk (step 31d2b2a): its link in English, the file itself in Arabic. */
export const PHONE_SENDS: Readonly<Record<WalkLanguage, 'link' | 'file'>> = { en: 'link', ar: 'file' };
/** The Arabic walk's file: the staged playlist padded to this many frames, so more than one crosses the channel. */
export const FILE_FRAMES = 3;

/** What the scripted phone sends by link: the fixture's playlist (with its scheme), and a name. */
export function phonePayload(check: Pick<DataCheck, 'file'>, language: WalkLanguage): PairPayload {
  return { v: 1, source: { type: 'm3u', url: `${FIXTURE_ORIGIN}/${check.file}` }, name: PHONE_NAMES[language] };
}

/** The link the TV's QR code must hold for `code` and the TV's key. */
export const pairLink = (code: string, tvPk: string): string => `${PAIR_ORIGIN}/p#c=${code}&k=${tvPk}`;

export type PairStepId = 'start' | 'pick-arabic' | 'language' | 'disclaimer' | 'consent' | 'to-phone' | 'phone' | 'added';

export interface PairStep {
  readonly id: PairStepId;
  readonly label: string;
  readonly navigate?: true;
  readonly keys?: readonly Key[];
  readonly expect: Expectation;
  /** `boot`: a page load; `key`: a key; `load`: the phone's source added. */
  readonly wait: 'boot' | 'key' | 'load';
}

/** The steps of one walk; the phone sends its payload right before `added`. */
export function pairSteps(language: WalkLanguage): PairStep[] {
  const ar = language === 'ar';
  const steps: PairStep[] = [
    { id: 'start', label: 'the first start', navigate: true, expect: { onboarding: true, screen: 'language', zone: 'languages', index: 0, language: 'en' }, wait: 'boot' },
  ];
  if (ar) steps.push({ id: 'pick-arabic', label: 'ArrowRight to العربية', keys: [KEY.right], expect: { screen: 'language', index: 1 }, wait: 'key' });
  steps.push(
    {
      id: 'language',
      label: ar ? 'OK on العربية' : 'OK on English',
      keys: [KEY.enter],
      expect: { screen: 'disclaimer', zone: 'actions', index: 0, language, dir: ar ? 'rtl' : 'ltr' },
      wait: 'key',
    },
    { id: 'disclaimer', label: 'OK on "I understand"', keys: [KEY.enter], expect: { screen: 'consent', zone: 'actions', index: 0 }, wait: 'key' },
    { id: 'consent', label: 'OK on "Allow"', keys: [KEY.enter], expect: { screen: 'source', zone: 'types', index: 0 }, wait: 'key' },
    { id: 'to-phone', label: 'ArrowDown twice to "Use your phone"', keys: [KEY.down, KEY.down], expect: { screen: 'source', zone: 'types', index: 2 }, wait: 'key' },
    { id: 'phone', label: 'OK on "Use your phone"', keys: [KEY.enter], expect: { screen: 'pair', zone: 'actions', index: 0 }, wait: 'key' },
    { id: 'added', label: "the phone's playlist added", expect: { screen: 'done', zone: 'actions', index: 0 }, wait: 'load' },
  );
  return steps;
}

/** `[left, top, width, height]`, rounded. */
export type Box = readonly [number, number, number, number];

/** The pair screen as drawn (`PAIR_EXPRESSION`). */
export interface PairState {
  readonly view: string | null;
  readonly code: string | null;
  readonly sent: string | null;
  readonly codeText: string | null;
  readonly address: string | null;
  readonly qr: {
    readonly size: number;
    readonly version: number;
    readonly d: string | null;
    readonly box: Box;
    readonly transform: string;
    readonly rendering: string | null;
  } | null;
  /** Each `[data-testid^="pair-"]` and button inside the screen: its test id (or class) and box. */
  readonly boxes: ReadonlyArray<readonly [string, Box]>;
}

/** Evaluated inside the page on every engine, so it is plain ES5 (a unit test parses it at ecmaVersion 5). */
export const PAIR_EXPRESSION = `(function () {
  var root = document.querySelector('[data-testid="pair"]');
  if (!root) return JSON.stringify(null);
  function box(el) {
    var r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  }
  function text(id) {
    var el = root.querySelector('[data-testid="' + id + '"]');
    return el ? el.textContent : null;
  }
  var svg = root.querySelector('[data-testid="pair-qr"]');
  var path = svg ? svg.querySelector('path') : null;
  var boxes = [];
  var parts = root.querySelectorAll('[data-testid^="pair-"], .z-button');
  for (var i = 0; i < parts.length; i++) {
    boxes.push([parts[i].getAttribute('data-testid') || parts[i].className, box(parts[i])]);
  }
  return JSON.stringify({
    view: root.getAttribute('data-view'),
    code: root.getAttribute('data-code'),
    sent: root.getAttribute('data-sent'),
    codeText: text('pair-code'),
    address: text('pair-address'),
    qr: svg ? {
      size: Number(svg.getAttribute('data-size')),
      version: Number(svg.getAttribute('data-version')),
      d: path ? path.getAttribute('d') : null,
      box: box(svg),
      transform: getComputedStyle(svg).transform || '',
      rendering: svg.getAttribute('shape-rendering')
    } : null,
    boxes: boxes
  });
})()`;

/** One dark run of the path (pair-qr.ts's `qrPath`): `M<x> <y>h<run>v1h-<run>z`, quiet zone included. */
const RUN = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;

/**
 * The dark modules the path draws, as `x,y` without the quiet zone; a string when the path holds
 * anything but `qrPath`'s runs.
 */
export function drawnModules(d: string): Set<string> | string {
  const dark = new Set<string>();
  let consumed = 0;
  RUN.lastIndex = 0;
  for (let match = RUN.exec(d); match !== null; match = RUN.exec(d)) {
    if (match.index !== consumed) return `the QR path has "${d.slice(consumed, match.index).slice(0, 20)}" between its runs`;
    consumed = match.index + match[0].length;
    const x = Number(match[1]) - QR_QUIET;
    const y = Number(match[2]) - QR_QUIET;
    const run = Number(match[3]);
    if (Number(match[4]) !== run) return `the QR path's run at ${match[1]},${match[2]} goes ${run} right and ${match[4]} back`;
    for (let i = 0; i < run; i += 1) dark.add(`${x + i},${y}`);
  }
  if (consumed !== d.length) return `the QR path ends with "${d.slice(consumed).slice(0, 20)}"`;
  return dark;
}

/** The QR code's side on screen: whole pixels per module, at most `QR_MAX_PX` (apps/tv's `qrModulePx`). */
export function qrSidePx(size: number): number {
  const side = size + 2 * QR_QUIET;
  return side * Math.max(1, Math.floor(QR_MAX_PX / side));
}

/** Everything wrong with the QR code drawn for `link`. */
export function qrFailures(qr: PairState['qr'], link: string): string[] {
  if (qr === null) return ['no QR code is drawn'];
  const want = encodeQr(link);
  if (want === null) return [`${link} does not fit a QR code`];
  const failures: string[] = [];
  if (qr.size !== want.size || qr.version !== want.version) {
    failures.push(`the QR code is version ${qr.version} (${qr.size} modules a side), expected version ${want.version} (${want.size}) for ${link}`);
  }
  if (qr.d === null) failures.push('the QR code has no path');
  else {
    const drawn = drawnModules(qr.d);
    if (typeof drawn === 'string') failures.push(drawn);
    else {
      const wrong: string[] = [];
      let count = 0;
      for (let y = 0; y < want.size; y += 1) {
        const row = want.rows[y]!;
        for (let x = 0; x < want.size; x += 1) {
          const dark = row.charAt(x) === '1';
          if (dark) count += 1;
          if (dark !== drawn.has(`${x},${y}`)) wrong.push(`${x},${y} ${dark ? 'light' : 'dark'}`);
        }
      }
      if (drawn.size !== count && wrong.length === 0) wrong.push(`${drawn.size - count} outside the code`);
      if (wrong.length > 0) failures.push(`the QR code differs from ${link} at ${wrong.length} modules (${wrong.slice(0, 4).join('; ')})`);
    }
  }
  const px = qrSidePx(want.size);
  if (qr.box[2] !== px || qr.box[3] !== px) failures.push(`the QR code is drawn ${qr.box[2]}x${qr.box[3]} px, expected ${px}x${px} (whole pixels per module)`);
  if (qr.rendering !== 'crispEdges') failures.push(`the QR code's shape-rendering is ${qr.rendering ?? 'unset'}, expected crispEdges`);
  if (qr.transform !== '' && qr.transform !== 'none') failures.push(`the QR code is transformed (${qr.transform}): a mirrored code doesn't scan`);
  return failures;
}

/** The parts of the screen outside the title-safe area. */
export function outsideSafeArea(boxes: PairState['boxes']): string[] {
  const outside: string[] = [];
  for (const [name, [left, top, width, height]] of boxes) {
    if (width === 0 && height === 0) continue;
    if (left < SAFE_AREA.left || top < SAFE_AREA.top || left + width > SAFE_AREA.right || top + height > SAFE_AREA.bottom) {
      outside.push(`${name} at ${left},${top} ${width}x${height}`);
    }
  }
  return outside;
}

export interface PairStepRecord {
  readonly id: PairStepId;
  readonly label: string;
  readonly expect: Expectation;
  readonly met: boolean;
  readonly state: WalkState | null;
  readonly ms: number;
}

export interface PairWalk {
  readonly language: WalkLanguage;
  /** How the phone sent the playlist (`PHONE_SENDS`). */
  readonly sent: 'link' | 'file';
  readonly reset: string;
  readonly steps: readonly PairStepRecord[];
  /** The pair screen once its code showed (or what it showed instead). */
  readonly pair: PairState | null;
  /** OK on "Use your phone" to the code on screen, ms. */
  readonly codeMs: number | null;
  /** The stand-in's session for that code: the TV's key as it was posted. */
  readonly session: { readonly code: string; readonly tvPk: string } | null;
  /** The phone's request failing, or the stand-in having no session for the code. */
  readonly phoneError: string | null;
  /** The phone's send to the done screen, ms. */
  readonly addMs: number | null;
  /** What the phone read at the end: the answer, an HTTP status, or why the read failed. */
  readonly progress: PairProgressResponse | number | string | null;
  /**
   * The files the stand-in still held for this walk's session once the phone read the end (null:
   * not read). Its own only: the server lives through every engine, and an earlier walk that
   * failed may have left its file.
   */
  readonly blobs: number | null;
  readonly profile: StoredProfile | null;
  readonly screenshots: readonly string[];
  readonly screenshotError: string | null;
}

export interface PairingRun {
  readonly platform: TvPlatform;
  readonly url: string;
  readonly walks: readonly PairWalk[];
  readonly cleanup: string;
  readonly exceptions: readonly string[];
  readonly durationMs: number;
}

export interface PairingOptions extends RunOptions {
  readonly loadTimeoutMs: number;
  readonly screenshot: ((language: WalkLanguage, view: 'code' | 'done') => string) | null;
  readonly save: (file: string, png: Buffer) => void;
  /** The staged playlist's text (the plain one): what the phone sends as a file. */
  readonly playlist: string;
}

/** The focus ring's transition (`--motion-fast`, 120 ms) ends before a screenshot. */
const SETTLE_MS = 400;
/** The phone's status read until the TV's `ok` is in (it is posted beside the load's end). */
const STATUS_WAIT_MS = 5_000;

async function shoot(client: CdpClient, options: PairingOptions, language: WalkLanguage, view: 'code' | 'done', into: string[]): Promise<string | null> {
  if (options.screenshot === null) return null;
  const file = options.screenshot(language, view);
  await delay(SETTLE_MS);
  try {
    const shot = await client.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' });
    if (shot.data === undefined || shot.data === '') throw new Error('the engine returned no image');
    options.save(file, Buffer.from(shot.data, 'base64'));
    into.push(file);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The files the stand-in holds for the session of `code` (`pair/<sid>/…`). */
export function heldFiles(server: Pick<PairServer, 'standIn'>, code: string): number {
  const session = server.standIn.sessions.find((s) => s.code === code);
  if (session === undefined) return 0;
  let held = 0;
  for (const key of server.standIn.blobs.keys()) if (key.startsWith(`pair/${session.sid}/`)) held += 1;
  return held;
}

/** One walk in one language, from a fresh database, until a step doesn't land. */
async function pairOnce(
  client: CdpClient,
  url: string,
  language: WalkLanguage,
  check: Pick<DataCheck, 'file'>,
  server: PairServer,
  options: PairingOptions,
  watch: ReturnType<typeof watchErrors>,
): Promise<PairWalk> {
  const reset = await resetDatabase(client);
  const steps: PairStepRecord[] = [];
  const screenshots: string[] = [];
  let screenshotError: string | null = null;
  let pair: PairState | null = null;
  let codeMs: number | null = null;
  let session: { code: string; tvPk: string } | null = null;
  let phoneError: string | null = null;
  let addMs: number | null = null;
  let progress: PairProgressResponse | number | string | null = null;
  let blobs: number | null = null;
  let profile: StoredProfile | null = null;
  const sent = PHONE_SENDS[language];
  const result = (): PairWalk => ({ language, sent, reset, steps, pair, codeMs, session, phoneError, addMs, progress, blobs, profile, screenshots, screenshotError });
  if (reset !== 'ok') return result();

  const timeouts = { boot: options.bootTimeoutMs, key: options.keyTimeoutMs, load: options.loadTimeoutMs };
  for (const step of pairSteps(language)) {
    const started = Date.now();
    if (step.navigate === true) {
      await untilConfigIdle(client);
      await readProbe<boolean>(client, STALE_MARK);
      await client.send('Page.navigate', { url });
    }
    if (step.id === 'added') {
      try {
        if (sent === 'file') await phoneSendsFile(server.origin, session!.code, phonePadded(options.playlist, FILE_FRAMES), { name: PHONE_NAMES[language] });
        else await phoneSends(server.origin, session!.code, phonePayload(check, language));
      } catch (error) {
        phoneError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    for (const key of step.keys ?? []) await pressKey(client, key);
    const landed = await waitForProbe<WalkState>(
      client,
      WALK_EXPRESSION,
      (state) => state.href === url && !state.stale && (stepLanded(step, state) || stepStuck(step, state) || watch.erroredOut()),
      timeouts[step.wait],
    );
    const met = landed.state !== null && landed.state.href === url && !landed.state.stale && stepLanded(step, landed.state);
    steps.push({ id: step.id, label: step.label, expect: step.expect, met, state: landed.state, ms: Date.now() - started });
    if (!met) break;
    if (step.id === 'phone') {
      // The pair worker starts, makes its key pair and asks for a code.
      const shown = await waitForProbe<PairState | null>(client, PAIR_EXPRESSION, (s) => s !== null && (s.view === 'code' || s.view === 'unavailable'), options.bootTimeoutMs);
      pair = shown.state;
      codeMs = Date.now() - started;
      if (pair === null || pair.view !== 'code' || pair.code === null) break;
      const held = server.standIn.latest();
      if (held === undefined || held.code !== pair.code) {
        phoneError = `the stand-in's newest code is ${held?.code ?? 'none'}, the TV shows ${pair.code}`;
        break;
      }
      session = { code: held.code, tvPk: held.tvPk };
      screenshotError ??= await shoot(client, options, language, 'code', screenshots);
    }
    if (step.id === 'added') {
      addMs = Date.now() - started;
      const code = session!.code;
      const deadline = Date.now() + STATUS_WAIT_MS;
      do {
        progress = await phoneSees(server.origin, code).catch((error: unknown): string => (error instanceof Error ? error.message : String(error)));
        if (typeof progress === 'object' && progress.state === 'done') break;
        await delay(200);
      } while (Date.now() < deadline);
      blobs = heldFiles(server, code);
      screenshotError ??= await shoot(client, options, language, 'done', screenshots);
      await readProbe<string>(client, PROFILE_EXPRESSION);
      profile = (await waitForProbe<StoredProfile>(client, PROFILE_RESULT, () => true, options.keyTimeoutMs)).state;
    }
  }
  return result();
}

/**
 * Walks onboarding by phone at `url` in English, then in Arabic, and deletes the database at the
 * end. The caller enables the Page and Runtime domains, starts the engine full screen and forwards
 * `PAIR_PORT` to `server` (`forwardToHost`).
 */
export async function runPairing(
  client: CdpClient,
  platform: TvPlatform,
  url: string,
  check: Pick<DataCheck, 'file'>,
  server: PairServer,
  options: PairingOptions,
): Promise<PairingRun> {
  const started = Date.now();
  const watch = watchErrors(client);
  const walks: PairWalk[] = [];
  try {
    for (const language of WALK_LANGUAGES) walks.push(await pairOnce(client, url, language, check, server, options, watch));
    const cleanup = await resetDatabase(client);
    return { platform, url, walks, cleanup, exceptions: watch.errors(), durationMs: Date.now() - started };
  } finally {
    watch.stop();
  }
}

/** Everything wrong with one walk; empty means it passed. */
export function evaluatePairWalk(walk: PairWalk): string[] {
  if (walk.reset !== 'ok') return [`the app's database could not be deleted before the walk (${walk.reset})`];
  const failures: string[] = [];
  const missed = walk.steps.find((s) => !s.met);
  if (missed !== undefined) {
    failures.push(`"${missed.label}" did not land: expected ${describeExpectation(missed.expect)}, at ${missed.state === null ? 'nothing' : describeState(missed.state)}`);
    return failures;
  }
  const pair = walk.pair;
  if (walk.steps.some((s) => s.id === 'phone')) {
    if (pair === null) return ['the pair screen was never drawn'];
    if (pair.view !== 'code' || pair.code === null) return [`the pair screen shows "${pair.view ?? '-'}", not a code`];
    const code = pair.code;
    if (pair.codeText !== `${code.slice(0, 4)} ${code.slice(4)}`) failures.push(`the code reads "${pair.codeText ?? ''}", expected "${code.slice(0, 4)} ${code.slice(4)}"`);
    const address = `${PAIR_ORIGIN.replace(/^http:\/\//, '')}/p`;
    if (pair.address !== address) failures.push(`the address reads "${pair.address ?? ''}", expected "${address}"`);
    const outside = outsideSafeArea(pair.boxes);
    if (outside.length > 0) failures.push(`outside the title-safe area: ${outside.join('; ')}`);
    const codeBox = pair.boxes.find(([name]) => name === 'pair-code')?.[1] ?? null;
    if (pair.qr !== null && codeBox !== null) {
      const qr = pair.qr.box;
      const endSide = walk.language === 'ar' ? qr[0] + qr[2] <= codeBox[0] : qr[0] >= codeBox[0] + codeBox[2];
      if (!endSide) failures.push(`the QR code (x ${qr[0]}) is not on the ${walk.language === 'ar' ? 'left' : 'right'} of the code (x ${codeBox[0]})`);
    }
    if (walk.session === null) failures.push(walk.phoneError ?? 'the stand-in has no session for the code');
    else failures.push(...qrFailures(pair.qr, pairLink(walk.session.code, walk.session.tvPk)));
  }
  if (walk.phoneError !== null && walk.session !== null) failures.push(`the phone: ${walk.phoneError}`);
  if (failures.length > 0) return failures;
  const progress = walk.progress;
  if (typeof progress !== 'object' || progress === null || progress.state !== 'done' || progress.status !== 'ok') {
    failures.push(`the phone reads ${JSON.stringify(progress)}, expected done with ok`);
  }
  if (walk.blobs !== null && walk.blobs > 0) failures.push(`the stand-in still holds ${walk.blobs} file${walk.blobs === 1 ? '' : 's'} after the TV's status`);
  const profile = walk.profile;
  const want = `s1,${walk.sent === 'file' ? 'm3u-file' : 'm3u'},${PHONE_NAMES[walk.language]}`;
  if (profile === null || profile.error !== undefined) failures.push(`the stored profile could not be read${profile?.error === undefined ? '' : `: ${profile.error}`}`);
  else {
    const sources = profile.sources === null ? 'no profile' : profile.sources.map((s) => s.join(',')).join('; ') || 'none';
    if (sources !== want) failures.push(`the stored profile has the sources ${sources}, expected ${want}`);
    if (profile.language !== walk.language || profile.consent !== true) {
      failures.push(`the stored answers are language ${profile.language ?? '-'}, consent ${String(profile.consent)}, expected ${walk.language} and true`);
    }
  }
  return failures;
}

/** Everything wrong with one run; empty means it passed. The Arabic walk's failures say so. */
export function evaluatePairing(run: PairingRun, engine: Pick<Engine, 'major'>): string[] {
  const failures: string[] = [];
  const userAgent = run.walks.flatMap((w) => w.steps).find((s) => s.state !== null)?.state?.userAgent ?? null;
  if (userAgent === null) failures.push('the page state could not be read at all');
  else {
    const major = chromeMajor(userAgent);
    if (major !== engine.major) failures.push(`the engine reports Chrome ${major ?? '?'} ("${userAgent}"), expected ${engine.major}`);
  }
  for (const language of WALK_LANGUAGES) {
    const walk = run.walks.find((w) => w.language === language);
    const prefix = language === 'ar' ? 'in Arabic: ' : '';
    if (walk === undefined) failures.push(`${prefix}the walk did not run`);
    else failures.push(...evaluatePairWalk(walk).map((f) => `${prefix}${f}`));
  }
  if (run.cleanup !== 'ok') failures.push(`the app's database could not be deleted after the walks (${run.cleanup})`);
  for (const exception of run.exceptions) failures.push(`uncaught: ${exception}`);
  return failures;
}

/** `  en: code 1.2 s (QR v4), link added 2.3 s; ar: …`. */
export function pairingSummary(run: PairingRun): string {
  const seconds = (ms: number | null): string => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);
  const parts = run.walks.map((w) => `${w.language}: code ${seconds(w.codeMs)}${w.pair?.qr ? ` (QR v${w.pair.qr.version})` : ''}, ${w.sent} added ${seconds(w.addMs)}`);
  return parts.length === 0 ? '' : `  ${parts.join('; ')}`;
}
