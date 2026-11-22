/**
 * Adult categories by name (RELAY step 38: "groups detected as adult are locked by default").
 *
 * A category (a live group, a movie or series category) is adult when one of the words of its
 * name, in the search form (`normalizeName`: lower case, accents and Arabic marks gone,
 * Arabic-Indic digits as ASCII, punctuation a space but `+` kept), is one of `ADULT_WORDS`. Whole
 * words only: "Essex" and "Adultery" aren't adult. The query worker reads the names at each load,
 * so a changed list needs no new ingest; the Xtream panel's own flag (`is_adult`) is kept by the
 * ingest per category (`CategoryInfo.adult`).
 *
 * Single channels aren't checked by name (too noisy: "Hot", "Private", film titles); the user
 * locks one by hand.
 */

import { normalizeName } from './normalize';

/** The adult words, in the search form (each is its own `normalizeName`). */
export const ADULT_WORDS: readonly string[] = [
  'xxx',
  'adult',
  'adults',
  'adulte',
  'adultes',
  'adulti',
  'adulto',
  'adultos',
  'porn',
  'porno',
  'erotic',
  'erotica',
  'erotik',
  'sex',
  '18+',
  '+18',
  'للكبار',
  'للبالغين',
];

/** Whether category name `name` holds an adult word (see the module comment). */
export function adultName(name: string): boolean {
  const words = normalizeName(name).split(' ');
  for (let i = 0; i < words.length; i += 1) if (ADULT_WORDS.indexOf(words[i]!) !== -1) return true;
  return false;
}
