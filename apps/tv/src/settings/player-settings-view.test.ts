import { signal } from '@preact/signals';
import type { VNode } from 'preact';
import type { PictureMode } from '@lablo/player';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { PlayerSettings, PlayerValues } from './player-settings';
import { PlayerSettingsView, playerRowText } from './PlayerSettingsPage';

/**
 * Settings › "Player" as drawn (RELAY step 38d3): each row's name, its value beside it in the
 * track menu's and the info bar's words, and its line, in English and Arabic.
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
const propsOf = (node: VNode | undefined): Props => (node === undefined ? {} : (node.props as Props));

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA', { isolate: false });
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };
const focused: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };

function page(values: PlayerValues, modes: readonly PictureMode[] = ['fit', 'zoom', 'stretch', '4:3']): PlayerSettings {
  return {
    audio: signal(values.audio),
    subtitles: signal(values.subtitles),
    size: signal(values.size),
    picture: signal(values.picture),
    modes: signal(modes),
    open: () => undefined,
  };
}

const START: PlayerValues = { audio: null, subtitles: null, size: 'm', picture: 'fit' };

describe('Settings › "Player" as drawn (RELAY step 38d3)', () => {
  it('names each row with its value and line in English', () => {
    expect(playerRowText(en.t, 'audio', START)).toEqual({ name: 'Audio language', value: 'Same as the app', hint: 'Plays first when a channel or film has more than one' });
    expect(playerRowText(en.t, 'audio', { ...START, audio: 'ar' }).value).toBe('Arabic');
    expect(playerRowText(en.t, 'audio', { ...START, audio: 'en' }).value).toBe('English');
    expect(playerRowText(en.t, 'subtitles', START)).toEqual({ name: 'Subtitles', value: 'Off', hint: 'Turned on when a channel or film has them in this language' });
    expect(playerRowText(en.t, 'subtitles', { ...START, subtitles: 'ar' }).value).toBe('Arabic');
    expect(playerRowText(en.t, 'subtitles', { ...START, subtitles: 'en' }).value).toBe('English');
    expect(playerRowText(en.t, 'size', START)).toEqual({ name: 'Subtitle size', value: 'Medium', hint: 'How large subtitles are shown' });
    expect(playerRowText(en.t, 'size', { ...START, size: 's' }).value).toBe('Small');
    expect(playerRowText(en.t, 'size', { ...START, size: 'l' }).value).toBe('Large');
    expect(playerRowText(en.t, 'picture', START)).toEqual({ name: 'Picture', value: 'Fit', hint: 'How the picture fills the screen, on every channel' });
    expect(['zoom', 'stretch', '4:3'].map((picture) => playerRowText(en.t, 'picture', { ...START, picture: picture as PictureMode }).value)).toEqual(['Zoom', 'Stretch', '4:3']);
  });

  it('names each row with its value in Arabic', () => {
    expect(playerRowText(ar.t, 'audio', START)).toMatchObject({ name: 'لغة الصوت', value: 'مثل لغة التطبيق' });
    expect(playerRowText(ar.t, 'audio', { ...START, audio: 'en' }).value).toBe('الإنجليزية');
    expect(playerRowText(ar.t, 'subtitles', START)).toMatchObject({ name: 'الترجمة', value: 'إيقاف' });
    expect(playerRowText(ar.t, 'subtitles', { ...START, subtitles: 'ar' }).value).toBe('العربية');
    expect(playerRowText(ar.t, 'size', { ...START, size: 'l' })).toMatchObject({ name: 'حجم الترجمة', value: 'كبير' });
    expect(playerRowText(ar.t, 'picture', { ...START, picture: 'stretch' })).toMatchObject({ name: 'الصورة', value: 'تمديد' });
  });

  it('draws the four rows, each with its binding, its value as stored, and the modes offered', () => {
    const asked: number[] = [];
    const root = PlayerSettingsView({
      i18n: en,
      page: page({ audio: 'ar', subtitles: null, size: 'l', picture: '4:3' }, ['fit', 'stretch', '4:3']),
      item: (i) => (asked.push(i), i === 1 ? focused : idle),
    });
    expect(asked).toEqual([0, 1, 2, 3]);
    expect(propsOf(byTestId(root, 'player-settings')[0])['data-modes']).toBe('fit stretch 4:3');
    const rows = ['audio', 'subtitles', 'size', 'picture'].map((row) => propsOf(byTestId(root, `player-settings-${row}`)[0]));
    expect(rows.map((p) => p['data-value'])).toEqual(['ar', 'off', 'l', '4:3']);
    expect(rows.map((p) => p['data-state'])).toEqual(['idle', 'focused', 'idle', 'idle']);
    expect(rows[1]!['class']).toBe('settings__row settings__switch is-focused');
    expect(textOf(byTestId(root, 'player-settings-audio-value')[0])).toBe('Arabic');
    expect(textOf(byTestId(root, 'player-settings-picture')[0])).toBe('Picture4:3How the picture fills the screen, on every channel');
    expect(textOf(walk(root).find((v) => propsOf(v)['class'] === 'settings__title'))).toBe('Player');
    const app = PlayerSettingsView({ i18n: en, page: page(START), item: () => idle });
    expect(propsOf(byTestId(app, 'player-settings-audio')[0])['data-value']).toBe('app');
    expect(propsOf(byTestId(app, 'player-settings-subtitles')[0])['data-value']).toBe('off');
  });
});
