import { shownRows } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { CAPTION_BACKGROUNDS, CAPTION_COLORS, asCaptionBackground, asCaptionColor, createAppearance, setLargeTextAttribute } from './appearance';

/** "Larger text" and the captions' look (RELAY step 43). */
describe('appearance', () => {
  it('lists the boxes and colours with the defaults first, and reads an unknown word as the default', () => {
    expect(CAPTION_BACKGROUNDS[0]).toBe('dark');
    expect(CAPTION_COLORS[0]).toBe('white');
    expect(asCaptionBackground('solid')).toBe('solid');
    expect([asCaptionBackground('x'), asCaptionBackground(undefined), asCaptionBackground(3)]).toEqual(['dark', 'dark', 'dark']);
    expect(asCaptionColor('green')).toBe('green');
    expect([asCaptionColor('Green'), asCaptionColor(null)]).toEqual(['white', 'white']);
  });

  it('holds the values as signals and tells large text\'s change', () => {
    const told = vi.fn();
    const look = createAppearance(told);
    expect([look.largeText.value, look.captionBackground.value, look.captionColor.value]).toEqual([false, 'dark', 'white']);
    look.setLargeText(true);
    look.setCaptionBackground('none');
    look.setCaptionColor('cyan');
    expect([look.largeText.value, look.captionBackground.value, look.captionColor.value]).toEqual([true, 'none', 'cyan']);
    expect(told).toHaveBeenCalledWith(true);
  });

  it('larger text makes list rows taller (fewer in a list) and off puts them back (step 58a)', () => {
    const look = createAppearance(() => undefined);
    look.setLargeText(true);
    expect(shownRows(7)).toBe(5);
    look.setLargeText(false);
    expect(shownRows(7)).toBe(7);
  });

  it('puts data-large-text on the root while on, and removes it when off', () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => (attrs[k] = v), removeAttribute: (k: string) => delete attrs[k] } as unknown as Element;
    setLargeTextAttribute(root, true);
    expect(attrs).toEqual({ 'data-large-text': 'on' });
    setLargeTextAttribute(root, false);
    expect(attrs).toEqual({});
  });
});
