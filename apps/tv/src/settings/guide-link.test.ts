import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import { stripIsolates } from '@lablo/core';
import type { EpgMeta } from '@lablo/data';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { GuideRow, Guides } from './guides-state';
import { AddFormView, GuideItem, addFormText, menuLabels } from './SettingsScreen';

/**
 * A guide's link given again (RELAY step 32d4c), as drawn: the row's mark, the menu's "Give its
 * link", and the add form in its link mode, called as functions (their components are not
 * expanded). The state's tests are in guides-state.test.ts; the e2e drives it against the real API.
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const item: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };

const FAILED: EpgMeta = { epgSrc: 'u~g1', gen: 0, building: null, nextGen: 1, updatedAt: null, checkedAt: 5, rank: 0, failure: { code: 'http', status: 404 }, failedAt: 5 } as unknown as EpgMeta;

function row(patch: Partial<GuideRow> = {}): GuideRow {
  return { kind: 'mine', epgSrc: 'u~g1', id: 'g1', link: 'guides.test', source: '', meta: null, offset: 0, blocked: false, needs: true, ...patch };
}

describe('a guide without its link, as drawn (RELAY step 32d4c)', () => {
  it('says it needs its link in the warning colour, in place of its status line', () => {
    const bare = GuideItem({ i18n: en, row: row(), index: 0, state: 'unread', item });
    expect((bare.props as Props)['data-needs']).toBe('true');
    const line = byTestId(bare, 'guide-0-needs')[0]!;
    expect((line.props as Props).class).toBe('guides__failure');
    expect(textOf(line)).toBe('Needs its link again');
    expect(byTestId(bare, 'guide-0-status')).toEqual([]);
    expect(textOf(byTestId(bare, 'guide-0-link')[0])).toBe('guides.test');
    expect(textOf(byTestId(GuideItem({ i18n: ar, row: row(), index: 1, state: 'unread', item }), 'guide-1-needs')[0])).toBe('يحتاج إلى رابطه مرة أخرى');
  });

  it('says a blocked server first, and no failure under the mark', () => {
    const blocked = GuideItem({ i18n: en, row: row({ blocked: true }), index: 0, state: 'unread', item });
    expect(byTestId(blocked, 'guide-0-blocked')).toHaveLength(1);
    expect(byTestId(blocked, 'guide-0-needs')).toEqual([]);
    const failed = GuideItem({ i18n: en, row: row({ meta: FAILED }), index: 0, state: 'failed', item });
    expect(byTestId(failed, 'guide-0-needs')).toHaveLength(1);
    expect(byTestId(failed, 'guide-0-failure')).toEqual([]);
  });

  it('draws a guide with its link as before: its status line, its failure', () => {
    const given = GuideItem({ i18n: en, row: row({ needs: false, meta: FAILED }), index: 2, state: 'failed', item });
    expect((given.props as Props)['data-needs']).toBe('false');
    expect(byTestId(given, 'guide-2-needs')).toEqual([]);
    expect(byTestId(given, 'guide-2-status')).toHaveLength(1);
    expect(textOf(byTestId(given, 'guide-2-failure')[0])).toBe("Couldn't read it: the server answered with error 404.");
  });

  it('names the menu’s new action, and keeps the others', () => {
    expect(menuLabels(en.t)).toEqual({ link: 'Give its link', up: 'Move up', down: 'Move down', offset: 'Time offset', matches: 'Matches', remove: 'Remove', cancel: 'Cancel' });
    expect(menuLabels(ar.t).link).toBe('أدخل رابطه');
  });
});

describe('the add form in its link mode, as drawn (RELAY step 32d4c)', () => {
  it('says what it gives: the guide’s link, the host it was on as the hint, and "Save"', () => {
    expect(addFormText(en.t, row())).toEqual({ title: "This guide's link", body: 'Its programmes come back once you save.', hint: 'It was on guides.test', confirm: 'Save' });
    const plain = addFormText(en.t, null);
    expect([plain.title, plain.confirm]).toEqual(['Add a guide', 'Add']);
    expect(stripIsolates(plain.body)).toBe("Type the link of an XMLTV guide. Its programmes come before your playlists' and panels' own.");
    // No host kept: the hint any link has.
    expect(addFormText(en.t, row({ link: '' })).hint).toBe(plain.hint);
    expect(stripIsolates(plain.hint)).toContain('http://');
    const arabic = addFormText(ar.t, row());
    expect([arabic.title, arabic.body, arabic.confirm]).toEqual(['رابط هذا الدليل', 'تعود برامجه بعد الحفظ.', 'حفظ']);
    expect(stripIsolates(arabic.hint)).toBe('كان على guides.test');
  });

  it('draws them, and marks which guide it gives its link to', () => {
    const fake = (linking: GuideRow | null): Guides =>
      ({ linking: signal(linking), text: signal('guides.test/a.xml'), problem: signal('listed'), editor: { field: () => ({}) }, setText: () => undefined }) as unknown as Guides;
    const view = AddFormView({ i18n: en, guides: fake(row()), field: item, action: () => idle });
    expect((view.props as Props).title).toBe("This guide's link");
    expect((view.props as Props).message).toBe('Its programmes come back once you save.');
    const form = walk(view).filter((v) => (v.props as Props).class === 'guides__form')[0]!;
    expect((form.props as Props)['data-linking']).toBe('u~g1');
    const field = byTestId(view, 'guide-add-link')[0]!.props as Props;
    expect([field.hint, field.value, field.error, field.state]).toEqual(['It was on guides.test', 'guides.test/a.xml', 'This guide is already in the list.', 'focused']);
    expect((byTestId(view, 'guide-add-confirm')[0]!.props as Props).label).toBe('Save');
    const add = AddFormView({ i18n: en, guides: fake(null), field: item, action: () => idle });
    expect((add.props as Props).title).toBe('Add a guide');
    expect(((walk(add).filter((v) => (v.props as Props).class === 'guides__form')[0]!.props as Props)['data-linking'])).toBe('');
    expect((byTestId(add, 'guide-add-confirm')[0]!.props as Props).label).toBe('Add');
  });
});
