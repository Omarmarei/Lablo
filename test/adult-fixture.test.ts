// RELAY step 38: core's `adultName` against the big fixture's categories (tools/fixtures), whose
// generator says which ones are adult ("XXX Test", "18+ Test", "للكبار فقط") and writes every other
// name in four languages with country tags, accents and Arabic spellings: none of those may read
// as adult.

import { adultName } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import { fixtureCategories } from '../tools/fixtures/src/catalog';

describe("adultName against the fixture's categories (step 38)", () => {
  const all = fixtureCategories();

  it('finds exactly the adult ones, in every kind', () => {
    for (const kind of ['live', 'movie', 'series'] as const) {
      for (const cat of all[kind]) expect(adultName(cat.name), `${kind}: ${cat.name}`).toBe(cat.adult);
    }
  });

  it('has adult live groups to find, and a few hundred others', () => {
    expect(all.live.filter((c) => c.adult).map((c) => c.name)).toEqual(['XXX Test', '18+ Test', 'للكبار فقط']);
    expect(all.live.length + all.movie.length + all.series.length).toBeGreaterThan(300);
  });
});
