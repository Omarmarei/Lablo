import type { RootBackPolicy } from '@zoma/platform-api';
import { LAYOUT, listHeight, pseudoLocalize } from '@zoma/ui';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_CATEGORIES, DEMO_CHANNELS, DEMO_TILES } from './gallery-data';
import { CHANNELS_VISIBLE, DISABLED_ACTION, GALLERY, RAIL_VISIBLE, createGallery } from './gallery-state';
import { TEXT_KEYS, galleryLanguage, galleryText } from './gallery-text';

function setup(rootBack: RootBackPolicy = 'exit-dialog') {
  const exitApp = vi.fn();
  const g = createGallery({ rootBackPolicy: () => rootBack, exitApp });
  const at = (): string => {
    const f = g.nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = (...keys: Parameters<typeof g.nav.handle>[0][]) => keys.map((k) => g.nav.handle(k));
  return { ...g, exitApp, at, press };
}

describe('the gallery’s layout numbers', () => {
  it('fits 7 channel rows and 6 chips in the 1920x1080 safe area', () => {
    expect(GALLERY.width).toBe(1728);
    expect(CHANNELS_VISIBLE).toBe(7);
    expect(listHeight(CHANNELS_VISIBLE, LAYOUT.rowHeight, GALLERY.rowGap)).toBeLessThanOrEqual(GALLERY.channelsHeight);
    expect(RAIL_VISIBLE).toBe(6);
    expect(listHeight(RAIL_VISIBLE, GALLERY.chipWidth, GALLERY.chipGap)).toBeLessThanOrEqual(GALLERY.width);
    // More categories than the rail shows, and many more channels than the list shows: both scroll.
    expect(DEMO_CATEGORIES.length).toBeGreaterThan(RAIL_VISIBLE);
    expect(DEMO_CHANNELS.length).toBe(240);
  });
});

describe('the gallery by remote', () => {
  it('starts on the channel list and reaches every zone with the arrows', () => {
    const g = setup();
    expect(g.at()).toBe('gallery · channels 0');
    g.press('UP');
    expect(g.at()).toBe('gallery · rail 0');
    g.press('UP');
    expect(g.at()).toBe('gallery · actions 0');
    g.press('RIGHT', 'RIGHT', 'RIGHT', 'RIGHT');
    expect(g.at()).toBe('gallery · actions 3');
    // Each zone comes back to its remembered item.
    g.press('DOWN', 'DOWN', 'DOWN');
    expect(g.at()).toBe('gallery · channels 1');
    g.press('RIGHT', 'RIGHT', 'DOWN');
    expect(g.at()).toBe('gallery · tiles 4');
    g.press('DOWN');
    expect(g.at()).toBe('gallery · tiles 4');
    g.press('LEFT', 'LEFT');
    expect(g.at()).toBe('gallery · channels 1');
    g.press('UP', 'UP', 'UP');
    expect(g.at()).toBe('gallery · actions 3');
  });

  it('mirrors LEFT and RIGHT in Arabic', () => {
    const g = setup();
    g.nav.setDir('rtl');
    expect(g.press('LEFT')).toEqual(['zone']);
    expect(g.at()).toBe('gallery · tiles 0');
    g.press('LEFT');
    expect(g.at()).toBe('gallery · tiles 1');
    g.press('RIGHT', 'RIGHT');
    expect(g.at()).toBe('gallery · channels 0');
  });

  it('scrolls the rail’s window towards its end', () => {
    const g = setup();
    g.press('UP');
    for (let i = 0; i < DEMO_CATEGORIES.length; i += 1) g.press('RIGHT');
    expect(g.at()).toBe(`gallery · rail ${DEMO_CATEGORIES.length - 1}`);
    expect(g.home.position('rail').top).toBe(DEMO_CATEGORIES.length - RAIL_VISIBLE);
  });

  it('selects a category on the rail, and counts every select', () => {
    const g = setup();
    g.press('UP', 'RIGHT', 'RIGHT', 'OK');
    expect(g.category.value).toBe(2);
    expect(g.selection.value).toEqual({ zone: 'rail', index: 2, count: 1 });
    g.press('DOWN', 'RIGHT', 'OK');
    expect(g.selection.value).toEqual({ zone: 'tiles', index: 0, count: 2 });
    expect(g.at()).toBe('gallery · tiles 0');
  });

  it('opens the play dialog from a channel; Back or Cancel closes it, Play confirms it', () => {
    const g = setup();
    g.press('DOWN', 'DOWN', 'OK');
    expect(g.at()).toBe('play · buttons 0');
    expect(g.playing.value).toBe(2);
    expect(g.press('BACK')).toEqual(['popped']);
    expect(g.at()).toBe('gallery · channels 2');
    g.press('OK', 'OK');
    expect(g.at()).toBe('gallery · channels 2');
    g.press('OK', 'RIGHT', 'OK');
    expect(g.at()).toBe('gallery · channels 2');
    expect(g.selection.value).toEqual({ zone: 'play', index: 2, count: 4 });
  });

  it('opens the play dialog from the Play button for the list’s channel, and ignores the disabled button', () => {
    const g = setup();
    g.press('DOWN', 'DOWN', 'DOWN');
    g.home.focus('actions', 0);
    g.press('OK');
    expect(g.at()).toBe('play · buttons 0');
    expect(g.playing.value).toBe(3);
    g.press('BACK', 'RIGHT', 'RIGHT', 'RIGHT');
    expect(g.at()).toBe(`gallery · actions ${DISABLED_ACTION}`);
    const before = g.selection.value;
    expect(g.press('OK')).toEqual(['select']);
    expect(g.selection.value).toBe(before);
    expect(g.nav.snapshot().depth).toBe(1);
  });

  it('follows the platform on Back at the root', () => {
    const tizen = setup('exit-dialog');
    tizen.press('BACK');
    expect(tizen.at()).toBe('exit · buttons 0');
    tizen.press('OK');
    expect(tizen.at()).toBe('gallery · channels 0');
    expect(tizen.exitApp).not.toHaveBeenCalled();
    tizen.press('BACK', 'RIGHT', 'OK');
    expect(tizen.exitApp).toHaveBeenCalledTimes(1);
    expect(tizen.exitRequested.value).toBe(true);
    const webos = setup('platform-back');
    expect(webos.press('BACK')).toEqual(['exit']);
    expect(webos.exitApp).toHaveBeenCalledTimes(1);
  });

  it('selects with a pointer click, once per Magic Remote press', () => {
    const g = setup();
    expect(g.home.click('tiles', 5)).toBe(true);
    expect(g.selection.value).toEqual({ zone: 'tiles', index: 5, count: 1 });
    // webOS sends key 13 too: the same press, dropped.
    expect(g.press('OK')).toEqual(['duplicate']);
    expect(g.selection.value?.count).toBe(1);
  });
});

describe('the gallery’s words', () => {
  it('has every text in English and Arabic, with the same placeholders', () => {
    const en = galleryText('en-US');
    const ar = galleryText('ar-SA');
    for (const key of TEXT_KEYS) {
      const english = en(key);
      const arabic = ar(key);
      expect(english, key).not.toBe('');
      expect(/[؀-ۿ]/.test(arabic), `${key}: ${arabic}`).toBe(true);
      expect((arabic.match(/\{\w+\}/g) ?? []).sort(), key).toEqual((english.match(/\{\w+\}/g) ?? []).sort());
    }
    // The badges and labels the components need are here.
    for (const key of DEMO_CATEGORIES) expect(TEXT_KEYS).toContain(key);
    expect(DEMO_TILES.length).toBe(6);
  });

  it('picks the language from the locale, with en-XA as the pseudo-locale', () => {
    expect(['en-US', 'en', 'fr-CA', 'ar-SA', 'ar', 'en-XA'].map(galleryLanguage)).toEqual(['en', 'en', 'en', 'ar', 'ar', 'pseudo']);
    expect(galleryText('en-XA')('play')).toBe(pseudoLocalize('Play'));
    expect(galleryText('en-XA')('channelCount', { n: 240 })).toBe(pseudoLocalize('{n} channels').replace('{n}', '240'));
  });

  it('fills placeholders and leaves unknown ones', () => {
    const en = galleryText('en-US');
    expect(en('playTitle', { name: 'Zoma News' })).toBe('Play Zoma News?');
    expect(en('playTitle')).toBe('Play {name}?');
    expect(en('playTitle', { other: 1 })).toBe('Play {name}?');
    expect(galleryText('ar-SA')('channelCount', { n: 240 })).toBe('القنوات: 240');
  });
});
