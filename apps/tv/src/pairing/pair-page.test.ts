import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { PairCode } from '@lablo/data/client';
import { encodeQr } from '@lablo/core';
import type { ItemState, ZoneView } from '@lablo/ui';
import { Button, ProgressBar, Spinner } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { PairContentProps } from './PairPage';
import { CodeView, Message, PairContent, QrCode, groupedCode } from './PairPage';
import { qrPath } from './pair-qr';
import type { LoadErrorCode } from '../onboarding/loader';
import type { PairView } from './pair-state';

/**
 * The pairing screen as drawn (RELAY step 31c2a), its components called as functions (their own
 * components are not expanded). The e2e draws it in English and Arabic.
 */

type Props = Record<string, unknown> & { children?: unknown };

function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return out;
  const v = node as VNode;
  out.push(v);
  walk((v.props as Props).children, out);
  return out;
}
const props = (v: VNode): Props => v.props as Props;
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => props(v)['data-testid'] === id || props(v).testId === id);
const byType = (root: unknown, type: unknown): VNode[] => walk(root).filter((v) => v.type === type);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(props(node as VNode).children);
};
/** A component child expanded once (CodeView, Message, QrCode). */
const expand = (v: VNode): unknown => (v.type as (p: unknown) => unknown)(v.props);

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');

const LINK = 'http://127.0.0.1:3100/p#c=ABCD2345&k=Xq3gjdcm0Jtm6P8oRu5WlQZb5Am2nYc7Vw7d8QZb3Aw';
const QR = encodeQr(LINK)!;
const CODE: PairCode = { code: 'ABCD2345', exp: 1, link: LINK, typed: '127.0.0.1:3100/p', qr: QR };

function zone(focused = 0): ZoneView {
  const state = (i: number): ItemState => (i === focused ? 'focused' : 'idle');
  return {
    spec: { kind: 'list', id: 'actions', axis: 'horizontal', count: 2 },
    position: { index: focused, offset: 0 },
    active: true,
    state,
    item: (i: number) => ({ state: state(i), onHover: () => undefined, onPress: () => undefined }),
  } as unknown as ZoneView;
}

function draw(view: PairView, extra: Partial<PairContentProps> = {}): VNode {
  return PairContent({ i18n: en, view, name: 'Phone list', sent: null, zone: zone(), ...extra }) as VNode;
}

const buttons = (page: VNode): Props[] => byType(page, Button).map(props);

describe('the page', () => {
  it("marks the view, the code, the trouble and the status sent for the e2e", () => {
    const page = draw({ kind: 'code', code: CODE, trouble: true, note: null }, { sent: 'ok' });
    expect(props(page)).toMatchObject({ class: 'pair', 'data-testid': 'pair', 'data-view': 'code', 'data-code': 'ABCD2345', 'data-trouble': 'true', 'data-sent': 'ok' });
    expect(props(draw({ kind: 'opening', note: null }))).toMatchObject({ 'data-view': 'opening', 'data-code': '', 'data-trouble': 'false', 'data-sent': '' });
    expect(props(draw({ kind: 'code', code: CODE, trouble: false, note: null }))).toMatchObject({ 'data-view': 'code', 'data-trouble': 'false' });
  });

  it('gives each view its title and buttons, the last one primary unless it cancels', () => {
    const cases: Array<[PairView, string, string[]]> = [
      [{ kind: 'opening', note: null }, 'Add a source from your phone', ['Cancel']],
      [{ kind: 'code', code: CODE, trouble: false, note: null }, 'Add a source from your phone', ['Cancel']],
      [{ kind: 'unavailable', failure: 'network' }, 'Add a source from your phone', ['Try again']],
      [{ kind: 'ended' }, 'Add a source from your phone', ['Show a new code']],
      [{ kind: 'loading', progress: null }, 'Adding Phone list', ['Cancel']],
      [{ kind: 'failed', code: 'auth', httpStatus: null }, "Couldn't add Phone list", ['Show a new code', 'Try again']],
      [{ kind: 'refused', refusal: { id: 'k', message: null } }, "Couldn't add Phone list", ['Show a new code', 'Try again']],
      [{ kind: 'done', result: { live: 1, movies: 0, series: 2 } }, "You're all set", ['Done']],
    ];
    for (const [view, title, labels] of cases) {
      const page = draw(view);
      expect(textOf(byTestId(page, 'pair-title'))).toBe(title);
      const drawn = buttons(page);
      expect(drawn.map((b) => b.label)).toEqual(labels);
      expect(drawn.map((b) => b.testId)).toEqual(labels.map((_, i) => `pair-action-${i}`));
      expect(drawn[drawn.length - 1]!.variant).toBe(labels[labels.length - 1] === 'Cancel' ? undefined : 'primary');
      if (labels.length === 2) expect(drawn[0]!.variant).toBeUndefined();
    }
  });

  it("gives a file's failure and refusal one button, Show a new code (step 31d2b1)", () => {
    for (const view of [{ kind: 'failed', code: 'file', httpStatus: null }, { kind: 'refused', refusal: { id: 'k', message: null } }] as PairView[]) {
      const drawn = buttons(draw(view, { file: true }));
      expect(drawn.map((b) => b.label)).toEqual(['Show a new code']);
      expect(drawn[0]!.variant).toBe('primary');
    }
    // The other views are as for a link.
    expect(buttons(draw({ kind: 'loading', progress: null }, { file: true })).map((b) => b.label)).toEqual(['Cancel']);
    expect(buttons(draw({ kind: 'done', result: { live: 1, movies: 0, series: 0 } }, { file: true })).map((b) => b.label)).toEqual(['Done']);
  });

  it('binds each button to its place in the actions zone', () => {
    const page = PairContent({ i18n: en, view: { kind: 'failed', code: 'network', httpStatus: null }, name: 'x', sent: null, zone: zone(1) }) as VNode;
    expect(buttons(page).map((b) => b.state)).toEqual(['idle', 'focused']);
  });
});

describe('the code view', () => {
  it('shows the steps, the address and the code in groups of four, left to right, never translated', () => {
    const view = expand(byType(draw({ kind: 'code', code: CODE, trouble: false, note: null }), CodeView)[0]!);
    const address = byTestId(view, 'pair-address')[0]!;
    expect(props(address)).toMatchObject({ dir: 'ltr', translate: false });
    expect(textOf(address)).toBe('127.0.0.1:3100/p');
    const code = byTestId(view, 'pair-code')[0]!;
    expect(props(code)).toMatchObject({ dir: 'ltr', translate: false });
    expect(textOf(code)).toBe('ABCD 2345');
    const text = textOf(view);
    expect(text).toContain("Scan the QR code with your phone's camera.");
    expect(text).toContain("Or open this address in your phone's browser:");
    expect(text).toContain('Then type this code:');
    expect(text).toContain('Your details are encrypted on your phone. Only this TV can read them.');
    expect(textOf(byTestId(view, 'pair-state'))).toBe('Waiting for your phone…');
    expect(props(byTestId(view, 'pair-state')[0]!)).toMatchObject({ role: 'status', class: 'pair__state' });
    expect(byTestId(view, 'pair-note')).toEqual([]);
  });

  it('says it is still trying after a failed poll, and notes a payload that could not be read', () => {
    const view = expand(byType(draw({ kind: 'code', code: CODE, trouble: true, note: 'unreadable' }), CodeView)[0]!);
    expect(textOf(byTestId(view, 'pair-state'))).toBe("Can't reach Lablo's server. Still trying…");
    expect(props(byTestId(view, 'pair-state')[0]!).class).toBe('pair__state pair__state--trouble');
    expect(textOf(byTestId(view, 'pair-note'))).toBe("What your phone sent couldn't be read. Send it again with this new code.");
  });

  it('draws the QR code as one path of its modules, in whole pixels, crisp', () => {
    const svg = expand(byType(CodeView({ i18n: en, view: { kind: 'code', code: CODE, trouble: false, note: null } }) as VNode, QrCode)[0]!) as VNode;
    const size = QR.size + 8;
    expect(props(svg)).toMatchObject({ viewBox: `0 0 ${size} ${size}`, width: size * 10, height: size * 10, 'shape-rendering': 'crispEdges', 'data-size': QR.size, 'data-version': 5 });
    const [light, dark] = walk(svg).slice(1);
    expect(props(light!)).toMatchObject({ width: size, height: size, fill: '#fff' });
    expect(props(dark!)).toMatchObject({ d: qrPath(QR.rows), fill: '#000' });
  });

  it('isolates the QR name in Arabic and keeps the code and address as they are', () => {
    const view = expand(byType(PairContent({ i18n: ar, view: { kind: 'code', code: CODE, trouble: false, note: null }, name: '', sent: null, zone: zone() }) as VNode, CodeView)[0]!);
    const scan = walk(view).find((v) => v.type === 'p' && textOf(v).indexOf('امسح') === 0)!;
    expect(textOf(scan)).toContain('⁨QR⁩');
    expect(stripIsolates(textOf(scan))).toBe('امسح رمز QR بكاميرا هاتفك.');
    expect(textOf(byTestId(view, 'pair-code'))).toBe('ABCD 2345');
  });
});

describe('the other views', () => {
  const message = (view: PairView, name = 'Phone list'): unknown => expand(byType(draw(view, { name }), Message)[0]!);

  it('opening: a spinner and its words, with the note of a payload that could not be read', () => {
    const opening = message({ kind: 'opening', note: 'unreadable' });
    expect(byType(opening, Spinner).map((s) => props(s).label)).toEqual(['Getting a code…']);
    expect(textOf(byTestId(opening, 'pair-note'))).toContain("couldn't be read");
    expect(byTestId(message({ kind: 'opening', note: null }), 'pair-note')).toEqual([]);
  });

  it('unavailable: "too many" for a rate limit, the connection otherwise', () => {
    expect(textOf(message({ kind: 'unavailable', failure: 'rate' }))).toBe('Too many codes were asked for. Try again in a few minutes.');
    for (const failure of ['network', 'timeout', 'status', 'malformed', 'too-large'] as const) {
      const shown = message({ kind: 'unavailable', failure });
      expect(textOf(shown)).toBe("Couldn't get a code. Check your internet connection and try again.");
      expect(props(byTestId(shown, 'pair-error')[0]!)).toMatchObject({ role: 'alert', 'data-failure': failure });
    }
  });

  it('ended: says the code ended', () => {
    expect(textOf(message({ kind: 'ended' }))).toBe('The code ended before anything was sent. Show a new code when your phone is ready.');
  });

  it("loading: the phase in words and the bytes' share", () => {
    const loading = message({ kind: 'loading', progress: { phase: 'download', bytes: 25, total: 100, items: 7 } });
    expect(props(byTestId(loading, 'pair-load')[0]!)).toMatchObject({ 'data-phase': 'download' });
    expect(textOf(byTestId(loading, 'pair-load'))).toBe('Loading: 7 items');
    expect(props(byType(loading, ProgressBar)[0]!)).toMatchObject({ value: 0.25, label: 'Loading: 7 items' });
    const start = message({ kind: 'loading', progress: null });
    expect(textOf(byTestId(start, 'pair-load'))).toBe('Checking the details');
    expect(props(byType(start, ProgressBar)[0]!).value).toBe(0);
    expect(textOf(byTestId(message({ kind: 'loading', progress: { phase: 'saving', bytes: 1, total: 1, items: 3 } }), 'pair-load'))).toBe('Saving');
    const unknown = message({ kind: 'loading', progress: { phase: 'guide', bytes: 5, total: null, items: 3 } });
    expect(textOf(byTestId(unknown, 'pair-load'))).toBe('Loading the guide');
    expect(props(byType(unknown, ProgressBar)[0]!).value).toBe(0);
  });

  it("failed and refused: the load's words, the config's rule in the UI's language", () => {
    const failed = message({ kind: 'failed', code: 'http', httpStatus: 503 });
    expect(props(byTestId(failed, 'pair-error')[0]!)).toMatchObject({ role: 'alert', 'data-code': 'http' });
    expect(textOf(failed)).toBe('The server answered with error 503.');
    expect(textOf(message({ kind: 'failed', code: 'auth', httpStatus: null }))).toBe("The provider didn't accept this username and password.");
    const words: Array<[LoadErrorCode, string]> = [
      ['auth', "The provider didn't accept this username and password."],
      ['expired', 'This account has expired. Contact your provider.'],
      ['blocked', 'Your provider has blocked or turned off this account. Contact your provider.'],
      ['blocklisted', "This server can't be used with Lablo."],
      ['network', "Couldn't reach the server. Check the address and your internet connection."],
      ['format', "This link didn't give a playlist."],
      ['empty', 'The playlist has no channels.'],
      ['other', 'Something went wrong. Try again.'],
    ];
    for (const [code, text] of words) expect(textOf(message({ kind: 'failed', code, httpStatus: null }))).toBe(text);
    const refused = message({ kind: 'refused', refusal: { id: 'k', message: { en: 'Paused for maintenance.', ar: 'متوقف للصيانة.' } } });
    expect(props(byTestId(refused, 'pair-error')[0]!)).toMatchObject({ 'data-code': 'refused' });
    expect(textOf(refused)).toBe('Paused for maintenance.');
    expect(textOf(message({ kind: 'refused', refusal: { id: 'k', message: null } }))).toBe("Lablo isn't adding new sources right now. Try again later.");
  });

  it("words a file's failures as a file's (step 31d2b1); a link's file code too", () => {
    const fileMessage = (view: PairView): unknown => expand(byType(draw(view, { file: true }), Message)[0]!);
    const words: Array<[LoadErrorCode, string]> = [
      ['file', "The file from your phone couldn't be read. Send it again."],
      ['format', "This file isn't a playlist."],
      ['network', "Couldn't get the file from your phone. Check your internet connection and send it again."],
      ['empty', 'The playlist has no channels.'],
      ['other', 'Something went wrong. Try again.'],
    ];
    for (const [code, text] of words) expect(textOf(fileMessage({ kind: 'failed', code, httpStatus: null }))).toBe(text);
    expect(textOf(message({ kind: 'failed', code: 'file', httpStatus: null }))).toBe("The file from your phone couldn't be read. Send it again.");
    const arabic = expand(byType(PairContent({ i18n: ar, view: { kind: 'failed', code: 'file', httpStatus: null }, name: 'x', sent: null, zone: zone(), file: true }) as VNode, Message)[0]!);
    expect(textOf(arabic)).toBe('تعذّرت قراءة الملف المُرسَل من هاتفك. أرسله مرة أخرى.');
  });

  it('done: the name and the counts', () => {
    const done = message({ kind: 'done', result: { live: 1, movies: 2, series: 0 } });
    expect(textOf(done)).toContain('Phone list is ready.');
    expect(props(byTestId(done, 'pair-live')[0]!)).toMatchObject({ 'data-n': 1 });
    expect(textOf(byTestId(done, 'pair-live'))).toBe('1 channel');
    expect(textOf(byTestId(done, 'pair-movies'))).toBe('2 films');
    expect(textOf(byTestId(done, 'pair-series'))).toBe('0 series');
  });
});

describe('groupedCode', () => {
  it('splits the eight characters in two groups of four', () => {
    expect(groupedCode('ABCD2345')).toBe('ABCD 2345');
  });
});
