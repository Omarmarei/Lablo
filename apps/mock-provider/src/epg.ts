// Deterministic programme schedule. Every channel with an EPG id gets fixed-length slots
// aligned to the epoch, so any "now" gives the same programmes for the same slot. Slot lengths
// differ per channel (30/60/45/90 min) so that boundaries fall at odd times too.

import type { LiveChannel } from './config';
import { DAY_MS } from './time';

export interface Programme {
  /** Slot index: start = index * slotMs. Unique per channel. */
  index: number;
  channelId: number;
  start: number;
  stop: number;
  title: string;
  description: string;
  lang: 'en' | 'ar' | 'fr' | 'es';
  category: string;
}

const SLOT_MINUTES = [30, 60, 45, 90] as const;

interface TitleSeed {
  lang: Programme['lang'];
  title: string;
  category: string;
}

// Our own test-signal programme names (no real shows), in all four catalog languages.
const TITLES: readonly TitleSeed[] = [
  { lang: 'en', title: 'Colour Bars Hour', category: 'Test' },
  { lang: 'ar', title: 'ساعة أشرطة الألوان', category: 'اختبار' },
  { lang: 'en', title: 'Clock and Tone', category: 'Test' },
  { lang: 'ar', title: 'نشرة الاختبار المسائية', category: 'أخبار' },
  { lang: 'fr', title: 'La Mire du Matin', category: 'Essai' },
  { lang: 'es', title: 'Carta de Ajuste en Vivo', category: 'Prueba' },
  { lang: 'en', title: 'Lip Sync Check', category: 'Test' },
  { lang: 'ar', title: 'فحص تزامن الصوت', category: 'اختبار' },
];

export function slotMinutes(channel: LiveChannel): number {
  return SLOT_MINUTES[channel.id % SLOT_MINUTES.length] ?? 60;
}

function programmeAt(channel: LiveChannel, index: number): Programme {
  const slotMs = slotMinutes(channel) * 60_000;
  const seed = TITLES[(index + channel.id) % TITLES.length] ?? TITLES[0]!;
  const episode = (index % 997) + 1;
  const description =
    seed.lang === 'ar'
      ? `برنامج تجريبي رقم ${episode} على ${channel.name}.`
      : `Test programme ${episode} on ${channel.name}.`;
  return {
    index,
    channelId: channel.id,
    start: index * slotMs,
    stop: (index + 1) * slotMs,
    title: `${seed.title} ${episode}`,
    description,
    lang: seed.lang,
    category: seed.category,
  };
}

/** The window the EPG covers: the archive (at least one day) behind "now", `futureDays` ahead. */
export function epgWindow(channel: LiveChannel, now: number, futureDays: number): { from: number; to: number } {
  return { from: now - Math.max(channel.archiveDays, 1) * DAY_MS, to: now + futureDays * DAY_MS };
}

/** Programmes overlapping [from, to). */
export function programmes(channel: LiveChannel, from: number, to: number): Programme[] {
  if (channel.epgId === null) return [];
  const slotMs = slotMinutes(channel) * 60_000;
  const out: Programme[] = [];
  for (let i = Math.floor(from / slotMs); i * slotMs < to; i++) out.push(programmeAt(channel, i));
  return out;
}

/** The programme on air at `now` followed by the next ones, `limit` in total. */
export function upcoming(channel: LiveChannel, now: number, limit: number): Programme[] {
  if (channel.epgId === null) return [];
  const slotMs = slotMinutes(channel) * 60_000;
  const first = Math.floor(now / slotMs);
  return Array.from({ length: limit }, (_, k) => programmeAt(channel, first + k));
}

export function hasArchive(channel: LiveChannel, programme: Programme, now: number): boolean {
  return channel.archiveDays > 0 && programme.stop <= now && programme.start >= now - channel.archiveDays * DAY_MS;
}
