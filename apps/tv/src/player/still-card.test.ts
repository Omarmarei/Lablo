import type { VNode } from 'preact';
import type { ItemBinding } from '@lablo/ui';
import { Button } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { StillCardView } from './PlayerScreen';

/**
 * "Still watching?" as drawn (RELAY step 39c): why it asks, the seconds left, "Keep watching"
 * first and the cards' way out second, in English and Arabic.
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA', { isolate: false });
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };

/** The card's two buttons, as the props the Button gets. */
const buttons = (root: unknown): Props[] => walk(root).filter((v) => v.type === Button).map((v) => v.props as Props);

describe('"Still watching?" as drawn (RELAY step 39c)', () => {
  it('says no button was pressed, counts the seconds, and offers "Keep watching" first, then "Channels"', () => {
    const asked: number[] = [];
    const root = StillCardView({ prompt: { reason: 'idle', seconds: 60 }, i18n: en, movie: false, item: (i) => (asked.push(i), i === 0 ? focused : idle) });
    expect(root.props as Props).toMatchObject({ class: 'player__card', role: 'alertdialog', 'data-testid': 'player-still', 'data-reason': 'idle' });
    expect(textOf(walk(root).find((v) => v.type === 'h2'))).toBe('Still watching?');
    expect(textOf(byTestId(root, 'player-still-text')[0])).toBe('No button has been pressed for a while.');
    expect(textOf(byTestId(root, 'player-still-countdown')[0])).toBe('Playback stops in 60 s');
    expect(asked).toEqual([0, 1]);
    expect(buttons(root)).toMatchObject([
      { label: 'Keep watching', variant: 'primary', state: 'focused', testId: 'player-still-keep' },
      { label: 'Channels', state: 'idle', testId: 'player-still-stop' },
    ]);
    // The way out is no second primary button.
    expect(buttons(root)[1]!['variant']).toBeUndefined();
  });

  it('says the sleep timer ended, with the seconds as they go; from a movie the way out is "Back"', () => {
    const root = StillCardView({ prompt: { reason: 'sleep', seconds: 7 }, i18n: en, movie: true, item: () => idle });
    expect((root.props as Props)['data-reason']).toBe('sleep');
    expect(textOf(byTestId(root, 'player-still-text')[0])).toBe('The sleep timer has ended.');
    expect(textOf(byTestId(root, 'player-still-countdown')[0])).toBe('Playback stops in 7 s');
    expect(buttons(root).map((b) => b['label'])).toEqual(['Keep watching', 'Back']);
  });

  it('reads in Arabic', () => {
    const idleCard = StillCardView({ prompt: { reason: 'idle', seconds: 60 }, i18n: ar, movie: false, item: () => idle });
    expect(textOf(walk(idleCard).find((v) => v.type === 'h2'))).toBe('هل ما زلت تشاهد؟');
    expect(textOf(byTestId(idleCard, 'player-still-text')[0])).toBe('لم يُضغط أي زر منذ مدة.');
    expect(textOf(byTestId(idleCard, 'player-still-countdown')[0])).toBe(`يتوقف التشغيل خلال ${ar.number(60)} ث`);
    expect(buttons(idleCard).map((b) => b['label'])).toEqual(['متابعة المشاهدة', ar.t('player.channels')]);
    const sleepCard = StillCardView({ prompt: { reason: 'sleep', seconds: 3 }, i18n: ar, movie: true, item: () => idle });
    expect(textOf(byTestId(sleepCard, 'player-still-text')[0])).toBe('انتهى مؤقّت النوم.');
    expect(buttons(sleepCard).map((b) => b['label'])).toEqual(['متابعة المشاهدة', ar.t('movie.back')]);
  });
});
