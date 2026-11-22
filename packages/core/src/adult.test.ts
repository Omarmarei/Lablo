// Adult categories by name (RELAY step 38): whole words of the name's search form.

import { describe, expect, it } from 'vitest';
import { ADULT_WORDS, adultName } from './adult';
import { normalizeName } from './normalize';

describe('adultName (step 38)', () => {
  it('lists each word in its search form, once', () => {
    for (const word of ADULT_WORDS) expect(normalizeName(word)).toBe(word);
    expect(new Set(ADULT_WORDS).size).toBe(ADULT_WORDS.length);
  });

  it('finds each word alone, in any case', () => {
    for (const word of ADULT_WORDS) {
      expect(adultName(word)).toBe(true);
      expect(adultName(word.toUpperCase())).toBe(true);
    }
  });

  it('finds the providers\' adult groups', () => {
    for (const name of [
      'XXX',
      'XXX Test',
      'VIP | XXX',
      'xxx: Movies',
      '18+ Test (lock check)',
      'Movies 18+',
      '+18 Movies',
      '(18+)',
      'Adult',
      'ADULTS ONLY',
      'For Adults',
      'FR - Adulte',
      'Films pour adultes',
      'Canali per adulti',
      'Adulto',
      'Películas para adultos',
      'Porn',
      'PORNO HD',
      'Erotic Movies',
      'Érotica',
      'Erotik Kanäle',
      'SEX',
      'للكبار فقط',
      'أفلام للكبار',
      'للبالغين',
      '١٨+',
      'AR | للكبار',
    ]) {
      expect(adultName(name), name).toBe(true);
    }
  });

  it('finds nothing in other names, nor inside other words', () => {
    for (const name of [
      '',
      'News',
      'Test News',
      'Kids Test | أطفال',
      'Sports Test',
      'Radio Test',
      'Essex Radio',
      'Sussex',
      'Adultery Drama',
      'Sexy Beats',
      'XXXL Sports',
      'Pornography Documentaries',
      'Canal+',
      'beIN Sports 18',
      '18 +',
      '118+',
      'R18',
      'الكبار',
      'كبار',
      'أخبار',
      'UK | Movies',
    ]) {
      expect(adultName(name), name).toBe(false);
    }
  });
});
