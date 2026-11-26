import { signal } from '@preact/signals';
import type { VNode } from 'preact';
import type { PictureMode } from '@lablo/player';
import type { ItemBinding } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { SleepTimer } from '../player/watch-guard';
import type { PlayerSettings } from './player-settings';
import type { PlayerShown } from './PlayerSettingsPage';
import { PlayerAccessView, PlayerSettingsView, playerRowText } from './PlayerSettingsPage';

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
    buffer: signal(values.buffer),
    captionBg: signal(values.captionBg),
    captionColor: signal(values.captionColor),
    largeText: signal(values.largeText),
    sleep: () => values.sleep,
    modes: signal(modes),
    open: () => undefined,
  };
}

const START: PlayerShown = { audio: null, subtitles: null, size: 'm', picture: 'fit', clock: false, still: 4, sleep: null, buffer: 'fast', captionBg: 'dark', captionColor: 'white', largeText: false };
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

  it('names "Buffering" with its value, and a line that says what the value does (step 39d)', () => {
    expect(playerRowText(en, 'buffer', START)).toEqual({ name: 'Buffering', value: 'Fast start', hint: 'Playback starts sooner, and a stalled stream reconnects quickly' });
    expect(playerRowText(en, 'buffer', { ...START, buffer: 'stable' })).toEqual({ name: 'Buffering', value: 'Stable', hint: 'For slow providers: waits longer before it reconnects, and may start later' });
    expect(playerRowText(ar, 'buffer', START)).toEqual({ name: 'التخزين المؤقت', value: 'بدء سريع', hint: 'يبدأ التشغيل أسرع، ويُعاد الاتصال بسرعة حين يتوقف البث' });
    expect(playerRowText(ar, 'buffer', { ...START, buffer: 'stable' })).toEqual({ name: 'التخزين المؤقت', value: 'ثابت', hint: 'للمزوّدين البطيئين: ينتظر مدة أطول قبل إعادة الاتصال، وقد يتأخر بدء التشغيل' });
  });

  it('names the caption box and colour and "Larger text" (step 43), in English and Arabic', () => {
    expect(playerRowText(en, 'captionBg', START)).toMatchObject({ name: 'Caption background', value: 'Dark' });
    expect(playerRowText(en, 'captionBg', { ...START, captionBg: 'solid' }).value).toBe('Solid');
    expect(playerRowText(en, 'captionBg', { ...START, captionBg: 'none' }).value).toBe('None');
    expect(playerRowText(en, 'captionColor', { ...START, captionColor: 'yellow' })).toMatchObject({ name: 'Caption colour', value: 'Yellow' });
    expect(playerRowText(en, 'largeText', START)).toMatchObject({ name: 'Larger text', value: 'Off' });
    expect(playerRowText(en, 'largeText', { ...START, largeText: true }).value).toBe('On');
    expect(playerRowText(ar, 'captionBg', START).name).toBe('خلفية الترجمة');
    expect(playerRowText(ar, 'captionColor', { ...START, captionColor: 'green' }).value).toBe('أخضر');
    expect(playerRowText(ar, 'largeText', { ...START, largeText: true })).toMatchObject({ name: 'نص أكبر', value: 'مفعّلة' });
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

  it('draws the first seven rows, each with its binding, its value as stored, and the modes offered', () => {
    const asked: number[] = [];
    const root = PlayerSettingsView({
      i18n: en,
      page: page({ audio: 'ar', subtitles: null, size: 'l', picture: '4:3', clock: true, still: 6, sleep: SLEEPING, buffer: 'stable', captionBg: 'dark', captionColor: 'white', largeText: false }, ['fit', 'stretch', '4:3']),
      item: (i) => (asked.push(i), i === 1 ? focused : idle),
    });
    expect(asked).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(walk(root).find((v) => propsOf(v)['role'] === 'menu')?.props).toMatchObject({ 'data-top': 0, 'data-count': 9 });
    expect(byTestId(root, 'player-settings-buffer')).toEqual([]);
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

  it('draws the window from its top: the eighth row, "Buffering", once the list scrolled (step 39d)', () => {
    const asked: number[] = [];
    const root = PlayerSettingsView({ i18n: ar, page: page({ ...START, buffer: 'stable' }), item: (i) => (asked.push(i), i === 7 ? focused : idle), top: 1 });
    expect(asked).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(walk(root).find((v) => propsOf(v)['role'] === 'menu')?.props).toMatchObject({ 'data-top': 1, 'data-count': 9 });
    expect(byTestId(root, 'player-settings-audio')).toEqual([]);
    const row = propsOf(byTestId(root, 'player-settings-buffer')[0]);
    expect(row).toMatchObject({ 'data-value': 'stable', 'data-state': 'focused' });
    expect(textOf(byTestId(root, 'player-settings-buffer-value')[0])).toBe('ثابت');
    const fast = PlayerSettingsView({ i18n: en, page: page(START), item: () => idle, top: 1 });
    expect(propsOf(byTestId(fast, 'player-settings-buffer')[0])['data-value']).toBe('fast');
    expect(textOf(byTestId(fast, 'player-settings-buffer')[0])).toBe('BufferingFast startPlayback starts sooner, and a stalled stream reconnects quickly');
  });

  it('draws "Accessibility" last as the settings list draws its rows: its name and what its page holds, no value (step 55)', () => {
    const asked: number[] = [];
    const root = PlayerSettingsView({ i18n: en, page: page(START), item: (i) => (asked.push(i), i === 8 ? focused : idle), top: 2 });
    expect(asked).toEqual([2, 3, 4, 5, 6, 7, 8]);
    const row = byTestId(root, 'player-settings-access')[0];
    expect(propsOf(row)).toMatchObject({ class: 'settings__row is-focused', role: 'menuitem', 'data-state': 'focused' });
    expect(propsOf(row)['data-value']).toBeUndefined();
    expect(textOf(row)).toBe('AccessibilityCaption background and colour, and larger text');
    // Step 43's rows are not on this page any more.
    for (const name of ['captionBg', 'captionColor', 'largeText']) expect(byTestId(root, `player-settings-${name}`)).toEqual([]);
    const arabic = PlayerSettingsView({ i18n: ar, page: page(START), item: () => idle, top: 2 });
    expect(textOf(byTestId(arabic, 'player-settings-access')[0])).toBe('إمكانية الوصولخلفية الترجمة ولونها، والنص الأكبر');
  });

  it('draws "Accessibility"\'s page: its title and step 43\'s three rows with their values, in English and Arabic (step 55)', () => {
    const asked: number[] = [];
    const root = PlayerAccessView({ i18n: en, page: page({ ...START, captionBg: 'solid', captionColor: 'cyan', largeText: true }), item: (i) => (asked.push(i), i === 1 ? focused : idle) });
    expect(asked).toEqual([0, 1, 2]);
    expect(byTestId(root, 'player-access')).toHaveLength(1);
    expect(byTestId(root, 'player-settings')).toEqual([]);
    expect(textOf(walk(root).find((v) => propsOf(v)['class'] === 'settings__title'))).toBe('Accessibility');
    expect(walk(root).find((v) => propsOf(v)['role'] === 'menu')?.props).toMatchObject({ 'data-top': 0, 'data-count': 3 });
    const rows = ['captionBg', 'captionColor', 'largeText'].map((name) => byTestId(root, `player-settings-${name}`)[0]);
    expect(rows.map((r) => propsOf(r)['data-value'])).toEqual(['solid', 'cyan', 'on']);
    expect(rows.map((r) => propsOf(r)['data-state'])).toEqual(['idle', 'focused', 'idle']);
    expect(propsOf(rows[1])['class']).toBe('settings__row settings__switch is-focused');
    expect(rows.map((r) => textOf(r))).toEqual([
      'Caption backgroundSolidThe box behind subtitles: a dark tint, none, or solid black',
      'Caption colourCyanThe colour of the subtitle text',
      'Larger textOnMakes every text about a quarter bigger, in the whole app',
    ]);
    expect(textOf(byTestId(root, 'player-settings-captionColor-value')[0])).toBe('Cyan');
    const arabic = PlayerAccessView({ i18n: ar, page: page(START), item: () => idle });
    expect(textOf(walk(arabic).find((v) => propsOf(v)['class'] === 'settings__title'))).toBe('إمكانية الوصول');
    expect(['captionBg', 'captionColor', 'largeText'].map((name) => propsOf(byTestId(arabic, `player-settings-${name}`)[0])['data-value'])).toEqual(['dark', 'white', 'off']);
    expect(textOf(byTestId(arabic, 'player-settings-largeText-value')[0])).toBe('متوقفة');
  });

  it('reads the sleep timer as it stands at each draw: a timer that ended shows Off (step 39c)', () => {
    let timer: SleepTimer | null = SLEEPING;
    const live: PlayerSettings = { ...page(START), sleep: () => timer };
    expect(textOf(byTestId(PlayerSettingsView({ i18n: en, page: live, item: () => idle }), 'player-settings-sleep-value')[0])).toBe('60 minutes');
    timer = null;
    expect(textOf(byTestId(PlayerSettingsView({ i18n: en, page: live, item: () => idle }), 'player-settings-sleep-value')[0])).toBe('Off');
  });
});
