// The user's manual EPG mappings (RELAY step 24d): which stored values are mappings, how a profile
// document's are read for the matcher, and the key a guide is matched under.

import type { EpgOverride } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import { NO_MAPPING, epgMappingKey, epgOverridesOf, isEpgPin } from './epg-overrides';

describe('isEpgPin', () => {
  it("takes a guide's channel, or no guide with no guide named", () => {
    expect(isEpgPin({ epgSrc: 'u~g1', channel: 'BBCOne.uk' })).toBe(true);
    expect(isEpgPin({ epgSrc: 's1:xmltv', channel: ' a ' })).toBe(true);
    expect(isEpgPin({ epgSrc: '', channel: null })).toBe(true);
  });

  it('refuses anything else', () => {
    for (const pin of [
      null,
      undefined,
      'u~g1',
      {},
      { epgSrc: 'u~g1', channel: null },
      { epgSrc: '', channel: 'a' },
      { epgSrc: 'u~g1', channel: '' },
      { epgSrc: 'u~g1', channel: '   ' },
      { epgSrc: 'u~g1' },
      { channel: 'a' },
      { epgSrc: 1, channel: 'a' },
      { epgSrc: 'u~g1', channel: 1 },
      { channel: null },
    ]) {
      expect(isEpgPin(pin), JSON.stringify(pin)).toBe(false);
    }
  });
});

describe('epgOverridesOf', () => {
  it("reads a document's mappings as the matcher takes them, skipping what isn't one", () => {
    const doc = {
      v: 4,
      epgOverrides: {
        'x:s1:live:1': { epgSrc: 'u~g1', channel: 'one.tv' },
        'x:s1:live:2': { epgSrc: '', channel: null },
        'x:s1:live:3': { epgSrc: 'u~g1', channel: '' },
        'x:s1:live:4': 'one.tv',
        'x:s1:live:5': null,
      },
    };
    expect(epgOverridesOf(doc)).toEqual([
      { key: 'x:s1:live:1', epgSrc: 'u~g1', channel: 'one.tv' },
      { key: 'x:s1:live:2', epgSrc: '', channel: null },
    ]);
  });

  it('has none for a document without them, or with something else there', () => {
    expect(epgOverridesOf({ v: 4 })).toEqual([]);
    expect(epgOverridesOf({ v: 4, epgOverrides: null })).toEqual([]);
    expect(epgOverridesOf({ v: 4, epgOverrides: 'x' })).toEqual([]);
    expect(epgOverridesOf(null)).toEqual([]);
    expect(epgOverridesOf(undefined)).toEqual([]);
    expect(epgOverridesOf(5)).toEqual([]);
    expect(epgOverridesOf('doc')).toEqual([]);
  });
});

describe('epgMappingKey', () => {
  const a: EpgOverride = { key: 'x:s1:live:1', epgSrc: 'u~g1', channel: 'one.tv' };
  const b: EpgOverride = { key: 'x:s1:live:2', epgSrc: 'u~g1', channel: 'two.tv' };
  const off: EpgOverride = { key: 'x:s1:live:3', epgSrc: '', channel: null };

  it('is NO_MAPPING for none, and the same in any order', () => {
    expect(NO_MAPPING).toBe('-');
    expect(epgMappingKey([])).toBe(NO_MAPPING);
    expect(epgMappingKey([a, b, off])).toBe(epgMappingKey([off, b, a]));
    expect(epgMappingKey([a])).toMatch(/^[0-9a-z]+$/);
    expect(epgMappingKey([a])).not.toBe(NO_MAPPING);
  });

  it('tells apart every channel, guide, key and a mapping to no guide', () => {
    const keys = [
      [a],
      [b],
      [a, b],
      [{ ...a, channel: 'One.tv' }],
      [{ ...a, epgSrc: 'u~g2' }],
      [{ ...a, key: 'x:s1:live:9' }],
      [{ ...a, channel: null }],
      [off],
      [a, off],
    ].map(epgMappingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the same for a mapping to no guide whichever guide it names', () => {
    expect(epgMappingKey([{ ...off, epgSrc: 'u~g1' }])).toBe(epgMappingKey([off]));
  });
});
