import { signal } from '@preact/signals';
import type { VNode } from 'preact';
import type { PictureMode } from '@lablo/player';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { SleepTimer } from '../player/watch-guard';
import type { PlayerSettings } from './player-settings';
import type { PlayerShown } from './PlayerSettingsPage';
import { PlayerSettingsView, playerRowText } from './PlayerSettingsPage';

/**
 * Settings › "Player" as drawn (RELAY step 38d3): each row's name, its value beside it in the
 * track menu's and the info bar's words, and its line, in English and Arabic. "Still watching?"
 * and the sleep timer (step 39c): the hours and the minutes in each language's plural forms, and
 * the sleep timer's line saying when playback stops while it runs.
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

function page(values: PlayerShown, modes: readonly PictureMode[] = ['fit', 'zoom', 'stretch', '4:3']): PlayerSettings {
  return {
    audio: signal(values.audio),
    subtitles: signal(values.subtitles),
    size: signal(values.size),
    picture: signal(values.picture),
    clock: signal(values.clock),
    still: signal(values.still),
    sleep: () => values.sleep,
    modes: signal(modes),
    open: () => undefined,
  };
}

const START: PlayerShown = { audio: null, subtitles: null, size: 'm', picture: 'fit', clock: false, still: 4, sleep: null };
/** 21:30 on 2026-11-24 in the test's zone (the catalogs' times are the locale's). */
const UNTIL = new Date(2026, 10, 24, 21, 30).getTime();
const SLEEPING: SleepTimer = { minutes: 60, until: UNTIL };

describe('Settings › "Player" as drawn (RELAY step 38d3)', () => {
  it('names each row with its value and line in English', () => {
    expect(playerRowText(en, 'audio', START)).toEqual({ name: 'Audio language', value: 'Same as the app', hint: 'Plays first when a channel or film has more than one' });
    expect(playerRowText(en, 'audio', { ...START, audio: 'ar' }).value).toBe('Arabic');
    expect(playerRowText(en, 'audio', { ...START, audio: 'en' }).value).toBe('English');
    expect(playerRowText(en, 'subtitles', START)).toEqual({ name: 'Subtitles', value: 'Off', hint: 'Turned on when a channel or film has them in this language' });
    expect(playerRowText(en, 'subtitles', { ...START, subtitles: 'ar' }).value).toBe('Arabic');
    expect(playerRowText(en, 'subtitles', { ...START, subtitles: 'en' }).value).toBe('English');
    expect(playerRowText(en, 'size', START)).toEqual({ name: 'Subtitle size', value: 'Medium', hint: 'How large subtitles are shown' });
    expect(playerRowText(en, 'size', { ...START, size: 's' }).value).toBe('Small');
    expect(playerRowText(en, 'size', { ...START, size: 'l' }).value).toBe('Large');
    expect(playerRowText(en, 'picture', START)).toEqual({ name: 'Picture', value: 'Fit', hint: 'How the picture fills the screen, on every channel' });
    expect(['zoom', 'stretch', '4:3'].map((picture) => playerRowText(en, 'picture', { ...START, picture: picture as PictureMode }).value)).toEqual(['Zoom', 'Stretch', '4:3']);
    expect(playerRowText(en, 'clock', START)).toEqual({ name: 'Clock while watching', value: 'Off', hint: 'The time in a corner of the picture while the info bar is hidden' });
    expect(playerRowText(en, 'clock', { ...START, clock: true }).value).toBe('On');
  });

  it('names "Still watching?" by its prompt\'s title, with its hours, and the sleep timer with its minutes and when it stops (step 39c)', () => {
    expect(playerRowText(en, 'still', START)).toEqual({ name: 'Still watching?', value: 'After 4 hours', hint: 'Asks after this long with no button pressed, then stops playback' });
    expect(playerRowText(en, 'still', START).name).toBe(en.t('player.still.title'));
    expect([2, 6, 1].map((still) => playerRowText(en, 'still', { ...START, still }).value)).toEqual(['After 2 hours', 'After 6 hours', 'After 1 hour']);
    expect(playerRowText(en, 'still', { ...START, still: null }).value).toBe('Never');
    expect(playerRowText(en, 'sleep', START)).toEqual({ name: 'Sleep timer', value: 'Off', hint: 'Stops playback after this long' });
    expect(playerRowText(en, 'sleep', { ...START, sleep: SLEEPING })).toEqual({ name: 'Sleep timer', value: '60 minutes', hint: `Stops playback at ${en.time(new Date(UNTIL))}` });
    expect(en.time(new Date(UNTIL))).toMatch(/9:30/);
    expect([30, 90, 120].map((minutes) => playerRowText(en, 'sleep', { ...START, sleep: { minutes, until: UNTIL } }).value)).toEqual(['30 minutes', '90 minutes', '120 minutes']);
    // Arabic: the dual for two hours, the plural for four and six; the minutes in their forms.
    expect(playerRowText(ar, 'still', START)).toEqual({ name: 'هل ما زلت تشاهد؟', value: `بعد ${ar.number(4)} ساعات`, hint: 'يسألك بعد هذه المدة دون ضغط أي زر، ثم يتوقف التشغيل' });
    expect(playerRowText(ar, 'still', { ...START, still: 2 }).value).toBe('بعد ساعتين');
    expect(playerRowText(ar, 'still', { ...START, still: 6 }).value).toBe(`بعد ${ar.number(6)} ساعات`);
    expect(playerRowText(ar, 'still', { ...START, still: null }).value).toBe('أبدًا');
    expect(playerRowText(ar, 'sleep', START)).toEqual({ name: 'مؤقّت النوم', value: 'متوقف', hint: 'يتوقف التشغيل بعد هذه المدة' });
    expect(playerRowText(ar, 'sleep', { ...START, sleep: SLEEPING })).toEqual({ name: 'مؤقّت النوم', value: `${ar.number(60)} دقيقةً`, hint: `يتوقف التشغيل الساعة ${ar.time(new Date(UNTIL))}` });
    // 120 ends in twenty: the same form as 30, 60 and 90.
    expect(playerRowText(ar, 'sleep', { ...START, sleep: { minutes: 120, until: UNTIL } }).value).toBe(`${ar.number(120)} دقيقةً`);
  });

  it('names each row with its value in Arabic', () => {
    expect(playerRowText(ar, 'audio', START)).toMatchObject({ name: 'لغة الصوت', value: 'مثل لغة التطبيق' });
    expect(playerRowText(ar, 'audio', { ...START, audio: 'en' }).value).toBe('الإنجليزية');
    expect(playerRowText(ar, 'subtitles', START)).toMatchObject({ name: 'الترجمة', value: 'إيقاف' });
    expect(playerRowText(ar, 'subtitles', { ...START, subtitles: 'ar' }).value).toBe('العربية');
    expect(playerRowText(ar, 'size', { ...START, size: 'l' })).toMatchObject({ name: 'حجم الترجمة', value: 'كبير' });
    expect(playerRowText(ar, 'picture', { ...START, picture: 'stretch' })).toMatchObject({ name: 'الصورة', value: 'تمديد' });
    expect(playerRowText(ar, 'clock', START)).toMatchObject({ name: 'الساعة أثناء المشاهدة', value: 'متوقفة' });
    expect(playerRowText(ar, 'clock', { ...START, clock: true }).value).toBe('مفعّلة');
  });

  it('draws the seven rows, each with its binding, its value as stored, and the modes offered', () => {
    const asked: number[] = [];
    const root = PlayerSettingsView({
      i18n: en,
      page: page({ audio: 'ar', subtitles: null, size: 'l', picture: '4:3', clock: true, still: 6, sleep: SLEEPING }, ['fit', 'stretch', '4:3']),
      item: (i) => (asked.push(i), i === 1 ? focused : idle),
    });
    expect(asked).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(propsOf(byTestId(root, 'player-settings')[0])['data-modes']).toBe('fit stretch 4:3');
    const rows = ['audio', 'subtitles', 'size', 'picture', 'clock', 'still', 'sleep'].map((row) => propsOf(byTestId(root, `player-settings-${row}`)[0]));
    expect(rows.map((p) => p['data-value'])).toEqual(['ar', 'off', 'l', '4:3', 'on', '6', '60']);
    expect(rows.map((p) => p['data-state'])).toEqual(['idle', 'focused', 'idle', 'idle', 'idle', 'idle', 'idle']);
    expect(textOf(byTestId(root, 'player-settings-still-value')[0])).toBe('After 6 hours');
    expect(textOf(byTestId(root, 'player-settings-sleep')[0])).toBe(`Sleep timer60 minutesStops playback at ${en.time(new Date(UNTIL))}`);
    expect(textOf(byTestId(root, 'player-settings-clock-value')[0])).toBe('On');
    expect(rows[1]!['class']).toBe('settings__row settings__switch is-focused');
    expect(textOf(byTestId(root, 'player-settings-audio-value')[0])).toBe('Arabic');
    expect(textOf(byTestId(root, 'player-settings-picture')[0])).toBe('Picture4:3How the picture fills the screen, on every channel');
    expect(textOf(walk(root).find((v) => propsOf(v)['class'] === 'settings__title'))).toBe('Player');
    const app = PlayerSettingsView({ i18n: en, page: page(START), item: () => idle });
    expect(propsOf(byTestId(app, 'player-settings-audio')[0])['data-value']).toBe('app');
    expect(propsOf(byTestId(app, 'player-settings-subtitles')[0])['data-value']).toBe('off');
    // Never, and the timer off: `off` as stored, with their own words.
    const none = PlayerSettingsView({ i18n: en, page: page({ ...START, still: null }), item: () => idle });
    expect(propsOf(byTestId(none, 'player-settings-still')[0])['data-value']).toBe('off');
    expect(propsOf(byTestId(none, 'player-settings-sleep')[0])['data-value']).toBe('off');
    expect(textOf(byTestId(none, 'player-settings-sleep')[0])).toBe('Sleep timerOffStops playback after this long');
    expect(propsOf(byTestId(app, 'player-settings-still')[0])['data-value']).toBe('4');
  });

  it('reads the sleep timer as it stands at each draw: a timer that ended shows Off (step 39c)', () => {
    let timer: SleepTimer | null = SLEEPING;
    const live: PlayerSettings = { ...page(START), sleep: () => timer };
    expect(textOf(byTestId(PlayerSettingsView({ i18n: en, page: live, item: () => idle }), 'player-settings-sleep-value')[0])).toBe('60 minutes');
    timer = null;
    expect(textOf(byTestId(PlayerSettingsView({ i18n: en, page: live, item: () => idle }), 'player-settings-sleep-value')[0])).toBe('Off');
  });
});
