import { runInNewContext } from 'node:vm';
import { encodeQr } from '@lablo/core';
import { pairPayloadSchema } from '@lablo/protocol';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { FIXTURE_ORIGIN } from './fixture';
import type { WalkState } from './onboarding';
import type { StandInSession } from './pair-stand-in';
import { PairStandIn } from './pair-stand-in';
import type { Box, PairState, PairStepRecord, PairWalk, PairingRun } from './pairing';
import {
  FILE_FRAMES,
  PAIR_EXPRESSION,
  PAIR_ORIGIN,
  PAIR_PORT,
  PHONE_NAMES,
  PHONE_SENDS,
  QR_QUIET,
  drawnModules,
  evaluatePairWalk,
  evaluatePairing,
  heldFiles,
  outsideSafeArea,
  pairLink,
  pairSteps,
  pairingSummary,
  pairingUrl,
  phonePayload,
  qrFailures,
  qrSidePx,
} from './pairing';

/** The pairing walk on the old engines (RELAY step 31c2b): its steps, its probe and its checks. */

/** apps/tv's `qrPath`, written again here (tools/ may not import apps/): one run per dark stretch. */
function pathOf(rows: readonly string[]): string {
  let d = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row.charAt(x) !== '1') {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row.charAt(end) === '1') end += 1;
      d += `M${x + QR_QUIET} ${y + QR_QUIET}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return d;
}

const CODE = 'ABCD2345';
const TV_PK = 'q'.repeat(43);
const LINK = pairLink(CODE, TV_PK);
const QR = encodeQr(LINK)!;
const SIDE = qrSidePx(QR.size);

/** A pair screen drawn right in English: the code on the left, the QR code on the right. */
function drawn(over: Partial<PairState> = {}, qr: Partial<NonNullable<PairState['qr']>> = {}): PairState {
  return {
    view: 'code',
    code: CODE,
    sent: '',
    codeText: 'ABCD 2345',
    address: `127.0.0.1:${PAIR_PORT}/p`,
    qr: { size: QR.size, version: QR.version, d: pathOf(QR.rows), box: [1300, 200, SIDE, SIDE], transform: 'none', rendering: 'crispEdges', ...qr },
    boxes: [
      ['pair-title', [120, 80, 900, 60]],
      ['pair-code', [120, 400, 500, 90]],
      ['pair-qr', [1300, 200, SIDE, SIDE]],
      ['z-button', [120, 900, 300, 60]],
    ],
    ...over,
  };
}

const STATE = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36' } as WalkState;

function walk(over: Partial<PairWalk> = {}): PairWalk {
  const language = over.language ?? 'en';
  const sent = over.sent ?? PHONE_SENDS[language];
  const steps: PairStepRecord[] = pairSteps(language).map((step) => ({ id: step.id, label: step.label, expect: step.expect, met: true, state: STATE, ms: 100 }));
  return {
    language,
    sent,
    reset: 'ok',
    steps,
    pair: drawn(),
    codeMs: 1200,
    session: { code: CODE, tvPk: TV_PK },
    phoneError: null,
    addMs: 2300,
    progress: { state: 'done', status: 'ok' },
    blobs: 0,
    profile: { sources: [['s1', sent === 'file' ? 'm3u-file' : 'm3u', PHONE_NAMES[language]]], language, consent: true },
    screenshots: [],
    screenshotError: null,
    ...over,
  };
}

describe('the pairing walk', () => {
  it('opens the app with its API on the forwarded port of the device itself (a TV build takes ?api= only there)', () => {
    expect(PAIR_ORIGIN).toBe('http://127.0.0.1:8091');
    expect(pairingUrl('app', 'webos')).toBe('file:///app/app/webos/index.html?keyboard=native&api=http%3A%2F%2F127.0.0.1%3A8091');
  });

  it("expects the QR code to hold the TV's own link: the code, then the TV's key, in the fragment", () => {
    expect(pairLink('ABCD2345', 'key_-1')).toBe('http://127.0.0.1:8091/p#c=ABCD2345&k=key_-1');
  });

  it("sends the fixture's playlist by its link with its scheme, which the payload's schema takes", () => {
    for (const language of ['en', 'ar'] as const) {
      const payload = phonePayload({ file: 'list.m3u' }, language);
      expect(payload).toEqual({ v: 1, source: { type: 'm3u', url: `${FIXTURE_ORIGIN}/list.m3u` }, name: PHONE_NAMES[language] });
      expect(pairPayloadSchema.safeParse(payload).success).toBe(true);
    }
  });

  it('sends the link in the English walk and the playlist itself in the Arabic one, as a file of more than one frame (step 31d2b2a)', () => {
    expect(PHONE_SENDS).toEqual({ en: 'link', ar: 'file' });
    expect(FILE_FRAMES).toBe(3);
  });

  it('walks to the source screen\'s third row by keys and opens the pair screen, then waits for the done screen', () => {
    const steps = pairSteps('en');
    expect(steps.map((s) => s.id)).toEqual(['start', 'language', 'disclaimer', 'consent', 'to-phone', 'phone', 'added']);
    expect(steps[0]).toMatchObject({ navigate: true, wait: 'boot' });
    expect(steps.find((s) => s.id === 'to-phone')).toMatchObject({ keys: [{ key: 'ArrowDown' }, { key: 'ArrowDown' }], expect: { screen: 'source', zone: 'types', index: 2 } });
    expect(steps.find((s) => s.id === 'phone')).toMatchObject({ keys: [{ key: 'Enter' }], expect: { screen: 'pair', zone: 'actions', index: 0 } });
    expect(steps.find((s) => s.id === 'added')).toMatchObject({ expect: { screen: 'done', zone: 'actions', index: 0 }, wait: 'load' });
    expect(steps.find((s) => s.id === 'added')!.keys).toBeUndefined();
  });

  it('picks Arabic with ArrowRight and expects the screens right to left', () => {
    const steps = pairSteps('ar');
    expect(steps[1]).toMatchObject({ id: 'pick-arabic', keys: [{ key: 'ArrowRight' }], expect: { screen: 'language', index: 1 } });
    expect(steps.find((s) => s.id === 'language')!.expect).toMatchObject({ language: 'ar', dir: 'rtl' });
  });
});

describe('PAIR_EXPRESSION', () => {
  it('is plain ES5, so it runs on every engine', () => {
    expect(() => parse(PAIR_EXPRESSION, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  /** A fake element: attributes, text, a box and its children by selector. */
  const element = (attributes: Record<string, string>, box: Box, text = '', children: Record<string, unknown> = {}, all: unknown[] = []) => ({
    className: attributes['class'] ?? '',
    textContent: text,
    getAttribute: (name: string) => attributes[name] ?? null,
    getBoundingClientRect: () => ({ left: box[0], top: box[1], width: box[2], height: box[3] }),
    querySelector: (selector: string) => children[selector] ?? null,
    querySelectorAll: (selector: string) =>
      (all as Array<{ getAttribute(name: string): string | null; className: string }>).filter((el) =>
        selector.split(', ').some((part) =>
          part === '[data-testid^="pair-"]' ? (el.getAttribute('data-testid') ?? '').indexOf('pair-') === 0 : part === '.z-button' && el.className.split(' ').indexOf('z-button') !== -1,
        ),
      ),
  });

  it("reads the view, the code, the QR code's drawing and every part's box", () => {
    const path = element({ d: 'M4 4h1v1h-1z' }, [0, 0, 0, 0]);
    const svg = element({ 'data-testid': 'pair-qr', 'data-size': '21', 'data-version': '1', 'shape-rendering': 'crispEdges' }, [1300.4, 200, 435.4, 435], '', { path });
    const code = element({ 'data-testid': 'pair-code' }, [120, 400, 500, 90], 'ABCD 2345');
    const button = element({ class: 'z-button z-button--primary' }, [120, 900, 300, 60]);
    const other = element({ class: 'pair__steps' }, [0, 0, 2000, 2000]);
    const root = element({ 'data-view': 'code', 'data-code': CODE, 'data-sent': '' }, [0, 0, 1920, 1080], '', {
      '[data-testid="pair-qr"]': svg,
      '[data-testid="pair-code"]': code,
    }, [code, svg, other, button]);
    const document = { querySelector: (selector: string) => (selector === '[data-testid="pair"]' ? root : null) };
    const state = JSON.parse(runInNewContext(PAIR_EXPRESSION, { document, getComputedStyle: () => ({ transform: 'none' }), JSON, Math, Number }) as string) as PairState;
    expect(state).toEqual({
      view: 'code',
      code: CODE,
      sent: '',
      codeText: 'ABCD 2345',
      address: null,
      qr: { size: 21, version: 1, d: 'M4 4h1v1h-1z', box: [1300, 200, 435, 435], transform: 'none', rendering: 'crispEdges' },
      boxes: [
        ['pair-code', [120, 400, 500, 90]],
        ['pair-qr', [1300, 200, 435, 435]],
        ['z-button z-button--primary', [120, 900, 300, 60]],
      ],
    });
    expect(runInNewContext(PAIR_EXPRESSION, { document: { querySelector: () => null }, JSON })).toBe('null');
  });
});

describe('the QR code drawn', () => {
  it('reads the dark modules back from the path, the quiet zone taken off', () => {
    expect(drawnModules('M4 4h3v1h-3zM6 5h1v1h-1z')).toEqual(new Set(['0,0', '1,0', '2,0', '2,1']));
    expect(drawnModules('')).toEqual(new Set());
  });

  it('refuses a path with anything but those runs in it', () => {
    expect(drawnModules('M4 4h3v1h-3zL1 1')).toBe('the QR path ends with "L1 1"');
    expect(drawnModules('M4 4h3v1h-3z M5 4h1v1h-1z')).toBe('the QR path has " " between its runs');
    expect(drawnModules('M4 4h3v1h-2z')).toBe("the QR path's run at 4,4 goes 3 right and 2 back");
    expect(drawnModules('M4 4h2v1h-3z')).toBe("the QR path's run at 4,4 goes 2 right and 3 back");
  });

  it('draws whole pixels per module, at most 460 px', () => {
    expect(qrSidePx(37)).toBe(450);
    expect(qrSidePx(21)).toBe(435);
    expect(qrSidePx(57)).toBe(455);
    expect(qrSidePx(500)).toBe(508);
  });

  it("passes the TV's own drawing of the link", () => {
    expect(qrFailures(drawn().qr, LINK)).toEqual([]);
  });

  it('finds a module drawn wrong, a module outside the code, and a drawing of another link', () => {
    const flipped = QR.rows.map((row, y) => (y === 10 ? `${row.charAt(0) === '1' ? '0' : '1'}${row.slice(1)}` : row));
    expect(qrFailures(drawn({}, { d: pathOf(flipped) }).qr, LINK)).toEqual([`the QR code differs from ${LINK} at 1 modules (0,10 ${QR.rows[10]!.charAt(0) === '1' ? 'light' : 'dark'})`]);
    const extra = `${pathOf(QR.rows)}M${QR.size + QR_QUIET} ${QR_QUIET}h1v1h-1z`;
    expect(qrFailures(drawn({}, { d: extra }).qr, LINK)).toEqual([`the QR code differs from ${LINK} at 1 modules (1 outside the code)`]);
    const other = pairLink('ZZZZ9999', TV_PK);
    expect(qrFailures(drawn().qr, other)[0]).toMatch(/^the QR code differs from .*ZZZZ9999.* at \d+ modules/);
  });

  it("finds the wrong version, a size that isn't whole pixels, smoothing, a mirror and no drawing", () => {
    expect(qrFailures(drawn({}, { version: QR.version + 1 }).qr, LINK)[0]).toBe(`the QR code is version ${QR.version + 1} (${QR.size} modules a side), expected version ${QR.version} (${QR.size}) for ${LINK}`);
    expect(qrFailures(drawn({}, { box: [1300, 200, SIDE + 1, SIDE] }).qr, LINK)).toEqual([`the QR code is drawn ${SIDE + 1}x${SIDE} px, expected ${SIDE}x${SIDE} (whole pixels per module)`]);
    expect(qrFailures(drawn({}, { box: [1300, 200, SIDE, SIDE - 1] }).qr, LINK)).toEqual([`the QR code is drawn ${SIDE}x${SIDE - 1} px, expected ${SIDE}x${SIDE} (whole pixels per module)`]);
    expect(qrFailures(drawn({}, { rendering: 'auto' }).qr, LINK)).toEqual(["the QR code's shape-rendering is auto, expected crispEdges"]);
    expect(qrFailures(drawn({}, { transform: 'matrix(-1, 0, 0, 1, 0, 0)' }).qr, LINK)).toEqual(["the QR code is transformed (matrix(-1, 0, 0, 1, 0, 0)): a mirrored code doesn't scan"]);
    expect(qrFailures(drawn({}, { d: null }).qr, LINK)).toEqual(['the QR code has no path']);
    expect(qrFailures(null, LINK)).toEqual(['no QR code is drawn']);
    expect(qrFailures(drawn({}, { transform: '' }).qr, LINK)).toEqual([]);
  });

  it('finds a part outside the title-safe area, and skips what has no box', () => {
    expect(outsideSafeArea(drawn().boxes)).toEqual([]);
    expect(outsideSafeArea([['pair-note', [0, 0, 0, 0]], ['pair-qr', [1400, 600, 450, 450]], ['pair-title', [90, 80, 100, 60]]])).toEqual([
      'pair-qr at 1400,600 450x450',
      'pair-title at 90,80 100x60',
    ]);
  });
});

describe('evaluatePairWalk', () => {
  it('passes a walk that drew the code and added the phone\'s playlist, in both languages', () => {
    expect(evaluatePairWalk(walk())).toEqual([]);
    const arabic = drawn({ boxes: [['pair-code', [1300, 400, 500, 90]], ['pair-qr', [400, 200, SIDE, SIDE]]] }, { box: [400, 200, SIDE, SIDE] });
    expect(evaluatePairWalk(walk({ language: 'ar', pair: arabic }))).toEqual([]);
  });

  it('stops at the first step that did not land, or a database it could not reset', () => {
    const steps = walk().steps.slice(0, 5).concat([{ ...walk().steps[5]!, met: false, state: null }]);
    expect(evaluatePairWalk(walk({ steps }))).toEqual(['"OK on "Use your phone"" did not land: expected pair · actions 0, at nothing']);
    expect(evaluatePairWalk(walk({ reset: 'blocked' }))).toEqual(["the app's database could not be deleted before the walk (blocked)"]);
  });

  it('says what the pair screen showed instead of a code', () => {
    expect(evaluatePairWalk(walk({ pair: null }))).toEqual(['the pair screen was never drawn']);
    expect(evaluatePairWalk(walk({ pair: drawn({ view: 'unavailable', code: '' }) }))).toEqual(['the pair screen shows "unavailable", not a code']);
  });

  it('checks the code in two groups, the address, the safe area and the QR code on the end side', () => {
    expect(evaluatePairWalk(walk({ pair: drawn({ codeText: 'ABCD2345' }) }))).toEqual(['the code reads "ABCD2345", expected "ABCD 2345"']);
    expect(evaluatePairWalk(walk({ pair: drawn({ address: 'lablo.app/p' }) }))).toEqual([`the address reads "lablo.app/p", expected "127.0.0.1:${PAIR_PORT}/p"`]);
    expect(evaluatePairWalk(walk({ language: 'ar' }))).toEqual(['the QR code (x 1300) is not on the left of the code (x 120)']);
    const off = drawn({ boxes: drawn().boxes.concat([['pair-state', [120, 1000, 600, 40]]]) });
    expect(evaluatePairWalk(walk({ pair: off }))).toEqual(['outside the title-safe area: pair-state at 120,1000 600x40']);
  });

  it('checks the QR code against the link with the key the stand-in got', () => {
    expect(evaluatePairWalk(walk({ session: { code: CODE, tvPk: 'r'.repeat(43) } }))[0]).toMatch(/^the QR code differs from http:\/\/127\.0\.0\.1:8091\/p#c=ABCD2345&k=r{43} at/);
    expect(evaluatePairWalk(walk({ session: null, phoneError: "the stand-in's newest code is none, the TV shows ABCD2345" }))).toEqual([
      "the stand-in's newest code is none, the TV shows ABCD2345",
    ]);
  });

  it("checks the phone's send, its last read and the stored source", () => {
    const sent = walk().steps.slice(0, 6);
    expect(evaluatePairWalk(walk({ steps: sent, phoneError: "The TV's key for ABCD2345: HTTP 404" }))).toEqual(["the phone: The TV's key for ABCD2345: HTTP 404"]);
    expect(evaluatePairWalk(walk({ progress: { state: 'done', status: 'unreachable' } }))).toEqual(['the phone reads {"state":"done","status":"unreachable"}, expected done with ok']);
    expect(evaluatePairWalk(walk({ progress: { state: 'received' } }))).toEqual(['the phone reads {"state":"received"}, expected done with ok']);
    expect(evaluatePairWalk(walk({ profile: { sources: [['s1', 'm3u', '127.0.0.1']], language: 'en', consent: true } }))).toEqual([
      'the stored profile has the sources s1,m3u,127.0.0.1, expected s1,m3u,Phone list',
    ]);
    expect(evaluatePairWalk(walk({ profile: { sources: null, language: null, consent: null, error: 'VersionError' } }))).toEqual(['the stored profile could not be read: VersionError']);
    expect(evaluatePairWalk(walk({ profile: { sources: [['s1', 'm3u', 'Phone list']], language: 'ar', consent: true } }))).toEqual([
      'the stored answers are language ar, consent true, expected en and true',
    ]);
  });

  it('wants a file sent by phone stored as an M3U file, and the stand-in to hold no file after the status (step 31d2b2a)', () => {
    const arabic = drawn({ boxes: [['pair-code', [1300, 400, 500, 90]], ['pair-qr', [400, 200, SIDE, SIDE]]] }, { box: [400, 200, SIDE, SIDE] });
    expect(evaluatePairWalk(walk({ language: 'ar', pair: arabic }))).toEqual([]);
    expect(evaluatePairWalk(walk({ language: 'ar', pair: arabic, profile: { sources: [['s1', 'm3u', PHONE_NAMES.ar]], language: 'ar', consent: true } }))).toEqual([
      `the stored profile has the sources s1,m3u,${PHONE_NAMES.ar}, expected s1,m3u-file,${PHONE_NAMES.ar}`,
    ]);
    // A link sent stored as a file is as wrong.
    expect(evaluatePairWalk(walk({ profile: { sources: [['s1', 'm3u-file', 'Phone list']], language: 'en', consent: true } }))).toEqual([
      'the stored profile has the sources s1,m3u-file,Phone list, expected s1,m3u,Phone list',
    ]);
    expect(evaluatePairWalk(walk({ language: 'ar', pair: arabic, blobs: 1 }))).toEqual(["the stand-in still holds 1 file after the TV's status"]);
    expect(evaluatePairWalk(walk({ blobs: 2 }))).toEqual(["the stand-in still holds 2 files after the TV's status"]);
    // Not read: nothing to say about it.
    expect(evaluatePairWalk(walk({ blobs: null }))).toEqual([]);
  });
});

describe('heldFiles', () => {
  it("counts only the files of the walk's own session: an earlier walk's file left behind is not this one's (leg 100: Chromium 53's failed walks failed 68's)", () => {
    const standIn = new PairStandIn();
    const session = (sid: string, code: string): StandInSession => ({ sid, code, tvPk: '', pollToken: '', purpose: 'add', exp: 0, payload: null, posted: [], delivered: false, status: null, polls: 0, fileId: null, uploads: [] });
    standIn.sessions.push(session('old', 'AAAA2222'), session('new', 'BBBB3333'));
    standIn.blobs.set('pair/old/f1', new Uint8Array(1));
    expect(heldFiles({ standIn }, 'BBBB3333')).toBe(0);
    standIn.blobs.set('pair/new/f2', new Uint8Array(1));
    standIn.blobs.set('pair/newer/f3', new Uint8Array(1));
    expect(heldFiles({ standIn }, 'BBBB3333')).toBe(1);
    expect(heldFiles({ standIn }, 'AAAA2222')).toBe(1);
    expect(heldFiles({ standIn }, 'CCCC4444')).toBe(0);
  });
});

describe('evaluatePairing', () => {
  const run = (over: Partial<PairingRun> = {}): PairingRun => ({
    platform: 'tizen',
    url: pairingUrl('app', 'tizen'),
    walks: [walk(), walk({ language: 'ar', pair: drawn({ boxes: [['pair-code', [1300, 400, 500, 90]]] }, { box: [400, 200, SIDE, SIDE] }) })],
    cleanup: 'ok',
    exceptions: [],
    durationMs: 30_000,
    ...over,
  });

  it('passes both walks on the engine it expects', () => {
    expect(evaluatePairing(run(), { major: 53 })).toEqual([]);
  });

  it('names the engine, a missing or failing Arabic walk, the clean-up and uncaught errors', () => {
    expect(evaluatePairing(run(), { major: 68 })).toEqual([`the engine reports Chrome 53 ("${STATE.userAgent}"), expected 68`]);
    expect(evaluatePairing(run({ walks: [walk()] }), { major: 53 })).toEqual(['in Arabic: the walk did not run']);
    expect(evaluatePairing(run({ walks: [walk(), walk({ language: 'ar' })] }), { major: 53 })).toEqual(['in Arabic: the QR code (x 1300) is not on the left of the code (x 120)']);
    expect(evaluatePairing(run({ cleanup: 'pending', exceptions: ['TypeError: x'] }), { major: 53 })).toEqual([
      "the app's database could not be deleted after the walks (pending)",
      'uncaught: TypeError: x',
    ]);
    expect(evaluatePairing(run({ walks: [] }), { major: 53 })[0]).toBe('the page state could not be read at all');
  });

  it('sums each walk up: the time to the code, its QR version and the time to the done screen', () => {
    expect(pairingSummary(run())).toBe(`  en: code 1.2 s (QR v${QR.version}), link added 2.3 s; ar: code 1.2 s (QR v${QR.version}), file added 2.3 s`);
    expect(pairingSummary(run({ walks: [walk({ pair: null, codeMs: null, addMs: null })] }))).toBe('  en: code -, link added -');
  });
});
