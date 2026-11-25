import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import type { PlaybackError } from '@lablo/player';
import { BLOCKED_CODE, classifyFailure } from '@lablo/player';
import type { ItemBinding } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { HELP_SCREEN, HELP_TOPIC_SCREEN, createHelpPage } from './help-page';
import { SETTINGS_VISIBLE } from './settings-window';
import { HelpListView, HelpTopicView, helpNames, topicText } from './HelpPage';
import type { HelpBlock, HelpTopic } from './help-text';
import { HELP_TOPICS, SUPPORT_EMAIL, helpTopic } from './help-text';

/**
 * Settings › "Help" (RELAY step 40c): the pages' state, the words in both languages (every code
 * the error card can show is explained; the names quoted are the screen's own) and the view.
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

const propsOf = (v: unknown): Props => ((v as VNode | undefined)?.props ?? {}) as Props;
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => propsOf(v)['data-testid'] === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf((node as VNode).props.children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA', { isolate: false });
const xa = appI18n('en-XA', { isolate: false });
/** Whether the text holds a letter of the Arabic block (U+0600 to U+06FF). */
function hasArabic(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x600 && c <= 0x6ff) return true;
  }
  return false;
}

const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined } as unknown as ItemBinding;

function setup(code: () => string | null = () => null) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.push({ id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 12, visible: 7 }] });
  return { nav, page: createHelpPage({ nav, supportCode: code }) };
}

describe('the help pages (RELAY step 40c)', () => {
  it('opens the list of topics, then a topic with one Close button; Back and OK on Close go back one page each', () => {
    const { nav, page } = setup();
    page.open();
    expect(nav.snapshot()).toMatchObject({ screen: HELP_SCREEN, zone: 'topics', index: 0 });
    expect(nav.top.zone('topics')).toMatchObject({ count: HELP_TOPICS.length });
    nav.top.focus('topics', 3);
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: HELP_TOPIC_SCREEN, zone: 'actions', index: 0 });
    expect(page.topic.value).toBe(HELP_TOPICS[3]);
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: HELP_SCREEN, zone: 'topics', index: 3 });
    nav.handle('OK');
    nav.handle('BACK');
    expect(nav.snapshot()).toMatchObject({ screen: HELP_SCREEN, index: 3 });
    nav.handle('BACK');
    expect(nav.snapshot().screen).toBe('settings');
  });

  it('lists the seven topics in this order, the support topic last', () => {
    expect(HELP_TOPICS).toEqual(['add', 'play', 'account', 'stream', 'other', 'keys', 'support']);
  });

  it('moves down the list with DOWN and back with UP', () => {
    const { nav, page } = setup();
    page.open();
    nav.handle('DOWN');
    expect(nav.snapshot()).toMatchObject({ screen: HELP_SCREEN, zone: 'topics', index: 1 });
    nav.handle('UP');
    expect(nav.snapshot()).toMatchObject({ index: 0 });
  });

  it('keeps every topic in view: the list has no window of its own', () => {
    expect(HELP_TOPICS.length).toBeLessThanOrEqual(SETTINGS_VISIBLE);
  });

  it('opens each topic by its own row', () => {
    for (let i = 0; i < HELP_TOPICS.length; i++) {
      const { nav, page } = setup();
      page.open();
      nav.top.focus('topics', i);
      nav.handle('OK');
      expect(page.topic.value).toBe(HELP_TOPICS[i]);
    }
  });

  it('gives the support code as the report row has it now', () => {
    const shown = signal<string | null>(null);
    const { page } = setup(() => shown.value);
    expect(page.supportCode()).toBeNull();
    shown.value = 'ABCD-1234';
    expect(page.supportCode()).toBe('ABCD-1234');
  });
});

describe('the help words', () => {
  const kinds = (blocks: readonly HelpBlock[]): string => blocks.map((b) => b.kind).join(',');

  it('has every topic in both languages with the same blocks in the same order', () => {
    for (const topic of HELP_TOPICS) {
      const e = helpTopic('en', helpNames(en), topic);
      const a = helpTopic('ar', helpNames(ar), topic);
      expect(e.title.length).toBeGreaterThan(0);
      expect(a.title.length).toBeGreaterThan(0);
      expect(kinds(a.blocks)).toBe(kinds(e.blocks));
      // Codes are never translated.
      const codes = (blocks: readonly HelpBlock[]): string[] => blocks.filter((b) => b.kind === 'item' && b.ltr).map((b) => (b as { term: string }).term);
      expect(codes(a.blocks)).toEqual(codes(e.blocks));
      expect(a.title).not.toBe(e.title);
      expect(a.hint).not.toBe(e.hint);
    }
  });

  it("gives Omar's support address, public on purpose", () => {
    expect(SUPPORT_EMAIL).toBe('lablo.iptv@gmail.com');
  });

  it('writes the Arabic in Arabic', () => {
    for (const topic of HELP_TOPICS) {
      const text = helpTopic('ar', helpNames(ar), topic);
      expect(hasArabic(text.title)).toBe(true);
      for (const b of text.blocks) if (b.kind === 'p') expect(hasArabic(b.text)).toBe(true);
    }
  });

  it('explains every code the error card can show', () => {
    const errors: PlaybackError[] = [
      { kind: 'network', code: 'X' },
      { kind: 'timeout', code: 'X' },
      { kind: 'stall', code: 'X' },
      { kind: 'unsupported', code: 'X' },
      { kind: 'decode', code: 'X' },
      { kind: 'app', code: 'X' },
      { kind: 'http', code: 'X' },
      { kind: 'http', code: 'X', status: 404 },
    ];
    const shown = new Set<string>([BLOCKED_CODE]);
    for (const error of errors) {
      shown.add(classifyFailure({ error, online: true }).code);
      shown.add(classifyFailure({ error, online: false }).code);
    }
    const account = { auth: true, status: 'Active', expDate: null, activeCons: 0, maxConnections: 1 };
    const problems = [{ ...account, auth: false }, { ...account, status: 'Expired' }, { ...account, status: 'Banned' }, { ...account, activeCons: 1 }];
    for (const a of problems) shown.add(classifyFailure({ error: errors[0]!, online: true, account: a }).code);
    const explained = new Set<string>();
    for (const topic of HELP_TOPICS) {
      for (const b of helpTopic('en', helpNames(en), topic).blocks) if (b.kind === 'item' && b.ltr) explained.add(b.term);
    }
    for (const code of shown) {
      // `PRV-HTTP-404` is explained with `PRV-HTTP`: the number after it is the server's answer.
      const term = code.indexOf('PRV-HTTP') === 0 ? 'PRV-HTTP' : code;
      expect(explained.has(term), code).toBe(true);
    }
    // ... and nothing else is explained that the app never shows.
    for (const term of explained) {
      const known = shown.has(term) || (term === 'PRV-HTTP' && shown.has('PRV-HTTP-404'));
      expect(known, term).toBe(true);
    }
  });

  it("quotes the screen's own words for the rows and buttons it names", () => {
    const names = helpNames(en);
    expect(names).toEqual({ sources: 'Sources', addPhone: 'Add from your phone', connection: 'Check the connection', report: 'Send a report to support' });
    const add = helpTopic('en', names, 'add').blocks.map((b) => (b.kind === 'p' ? b.text : '')).join(' ');
    expect(add).toContain('“Sources”');
    expect(add).toContain('“Add from your phone”');
    const arNames = helpNames(ar);
    const arAdd = helpTopic('ar', arNames, 'add').blocks.map((b) => (b.kind === 'p' ? b.text : '')).join(' ');
    expect(arAdd).toContain(`«${arNames.addPhone}»`);
    const support = helpTopic('en', names, 'support').blocks.map((b) => (b.kind === 'p' ? b.text : '')).join(' ');
    expect(support).toContain('“Send a report to support”');
  });
});

describe('the help view', () => {
  it('lists the topics with their lines', () => {
    const root = HelpListView({ i18n: en, item: () => idle });
    expect(textOf(byTestId(root, 'help-topic-add')[0])).toBe('Add a playlist or a loginYour provider’s link or login, from your phone');
    expect(textOf(walk(root).find((v) => v.type === 'h1'))).toBe('Help');
    expect(propsOf(walk(root).find((v) => propsOf(v)['role'] === 'menu'))).toMatchObject({ 'data-count': HELP_TOPICS.length });
    const arabic = HelpListView({ i18n: ar, item: () => idle });
    expect(textOf(walk(arabic).find((v) => v.type === 'h1'))).toBe('المساعدة');
  });

  it('draws the error codes left to right, each with its meaning', () => {
    const root = HelpTopicView({ i18n: ar, topic: 'account', code: null, button: () => idle });
    const items = walk(root).filter((v) => String(propsOf(v)['data-testid'] ?? '').indexOf('help-item-') === 0);
    expect(items).toHaveLength(4);
    const term = walk(items[0]).find((v) => String(propsOf(v)['class'] ?? '').indexOf('help__term') !== -1);
    expect(propsOf(term)['dir']).toBe('ltr');
    expect(textOf(term)).toBe('PRV-AUTH');
  });

  it('shows the address, and the support code when the report gave one', () => {
    const none = HelpTopicView({ i18n: en, topic: 'support', code: null, button: () => idle });
    expect(textOf(byTestId(none, 'help-mail')[0])).toBe(`Write to ${SUPPORT_EMAIL}`);
    expect(textOf(byTestId(none, 'help-code')[0])).toBe('No code yet.');
    expect(byTestId(none, 'help-code-value')).toHaveLength(0);
    const given = HelpTopicView({ i18n: en, topic: 'support', code: 'K7Q2-M9XA', button: () => idle });
    expect(textOf(byTestId(given, 'help-code')[0])).toBe('Your support code K7Q2-M9XA');
    expect(propsOf(byTestId(given, 'help-code-value')[0])['dir']).toBe('ltr');
    const arabic = HelpTopicView({ i18n: ar, topic: 'support', code: null, button: () => idle });
    expect(textOf(byTestId(arabic, 'help-mail')[0])).toBe(`راسلنا على ${SUPPORT_EMAIL}`);
    // The address is left to right in both languages, and the Arabic names the report row as the screen does.
    const address = walk(arabic).filter((v) => String(propsOf(v)['class'] ?? '') === 'help__address');
    expect(address).toHaveLength(1);
    expect(propsOf(address[0])['dir']).toBe('ltr');
    const sentence = helpTopic('ar', helpNames(ar), 'support').blocks.map((b) => (b.kind === 'p' ? b.text : '')).join(' ');
    expect(sentence).toContain(`«${helpNames(ar).report}»`);
  });

  it('puts the pseudo-locale through the same pseudo-localizer as the catalogs, but never a code', () => {
    const text = topicText(xa, 'account');
    expect(text.title.charAt(0)).toBe('[');
    const first = text.blocks[0]!;
    expect(first.kind === 'item' && first.term).toBe('PRV-AUTH');
    expect(first.kind === 'item' && first.text.charAt(0)).toBe('[');
    expect(topicText(en, 'account').title).toBe('Codes: your account');
  });

  it('closes with one primary button', () => {
    const asked: number[] = [];
    const root = HelpTopicView({ i18n: en, topic: 'keys', code: null, button: (i) => (asked.push(i), idle) });
    expect(asked).toEqual([0]);
    expect(propsOf(byTestId(root, 'help-page')[0])).toMatchObject({ 'data-topic': 'keys' });
    const topics: HelpTopic[] = HELP_TOPICS.slice();
    expect(topics).toContain('keys');
  });
});
