import type { ProgrammeLine } from '@zoma/ui';
import type { MessageKey } from '../i18n';

/**
 * Made-up demo content for the gallery (RELAY step 11b). The names are the "provider's"
 * text, so they are not translated: Latin and Arabic channel names are mixed on purpose, to
 * show each in its own direction in both UIs. No real channel, brand or programme names
 * (CLAUDE.md legal guardrails). Times are fixed strings, so screenshots never change.
 */
export interface DemoChannel {
  readonly number: number;
  readonly name: string;
  readonly now?: ProgrammeLine;
  readonly next?: ProgrammeLine;
  /** Badges: `hd`/`4k` are marks, `live` and `catchUp` come from the catalog. */
  readonly marks: ReadonlyArray<'hd' | '4k' | 'live' | 'catchUp'>;
}

const FIRST: readonly DemoChannel[] = [
  { number: 101, name: 'Zoma News', now: { title: 'Morning Bulletin', time: '08:00', progress: 0.65 }, next: { title: 'Business Today', time: '09:00' }, marks: ['hd', 'live'] },
  { number: 102, name: 'قناة زوما', now: { title: 'نشرة الأخبار', time: '08:30', progress: 0.3 }, next: { title: 'برنامج الصباح', time: '09:30' }, marks: ['hd'] },
  { number: 103, name: 'Zoma Sports 1', now: { title: 'Football: Cup Final, second half', time: '07:45', progress: 0.82 }, next: { title: 'Match Highlights', time: '09:15' }, marks: ['4k', 'live', 'catchUp'] },
  { number: 104, name: 'Zoma Kids', now: { title: 'Cartoon Hour', time: '08:00', progress: 0.5 }, next: { title: 'Puppet Theatre', time: '09:00' }, marks: [] },
  { number: 105, name: 'Zoma Documentary Channel International Extra Long Name', now: { title: 'Nature: The Desert at Night', time: '08:10', progress: 0.12 }, next: { title: 'Oceans', time: '09:05' }, marks: ['hd', 'catchUp'] },
  { number: 106, name: 'زوما للأفلام', now: { title: 'فيلم السهرة: رحلة إلى الجنوب', time: '07:30', progress: 0.9 }, next: { title: 'أخبار السينما', time: '09:20' }, marks: [] },
  { number: 107, name: 'Zoma Test Pattern', marks: [] },
];

const SHOWS = ['Weather', 'World Report', 'Studio Live', 'Classic Film', 'Travel Diaries', 'Late News'];

/** 240 channels: the seven above, then numbered ones, enough to scroll and page. */
export const DEMO_CHANNELS: readonly DemoChannel[] = (() => {
  const out: DemoChannel[] = FIRST.slice();
  for (let i = FIRST.length; i < 240; i += 1) {
    const show = SHOWS[i % SHOWS.length] ?? 'Studio Live';
    const later = SHOWS[(i + 1) % SHOWS.length] ?? 'Late News';
    out.push({
      number: 101 + i,
      name: `Zoma Channel ${i + 1}`,
      now: { title: show, time: '08:00', progress: ((i * 37) % 100) / 100 },
      next: { title: later, time: '09:00' },
      marks: i % 3 === 0 ? ['hd'] : [],
    });
  }
  return out;
})();

/** The rail's categories, from our catalog (a provider's own names would be data). */
export const DEMO_CATEGORIES: readonly MessageKey[] = [
  'category.all',
  'category.favourites',
  'category.sports',
  'category.news',
  'category.movies',
  'category.kids',
  'category.documentaries',
  'category.music',
  'category.radio',
];

export interface DemoTile {
  readonly title: string;
  readonly subtitle: string;
  readonly progress?: number;
  readonly fresh?: boolean;
}

export const DEMO_TILES: readonly DemoTile[] = [
  { title: 'Desert Nights', subtitle: '2025', progress: 0.62, fresh: true },
  { title: 'الرحلة الطويلة', subtitle: '2024', progress: 0.25 },
  { title: 'Ocean Deep', subtitle: '2023' },
  { title: 'City Lights After Midnight: The Extended Cut', subtitle: '2022', progress: 0.9 },
  { title: 'Kids Club', subtitle: '2025', fresh: true },
  { title: 'Mountain Song', subtitle: '2021' },
];
