import { describe, expect, it } from 'vitest';
import type { LastChannel, ProfileDoc, SourceRecord } from './profile';
import { applyProfileEdit, emptyProfile } from './profile';
import { keySource, removeSourceFromProfile, sourceFavouriteCount } from './source-removal';

const source = (id: string): SourceRecord => ({ id, type: 'xtream', name: id.toUpperCase(), account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 7 });
const fav = (src: string, n: number): ProfileDoc['favourites'][number] => ({ key: `x:${src}:live:${n}`, src, kind: 'live', normName: `ch ${n}`, added: n, missingSince: null });
const last = (src: string, n: number): LastChannel =>
  ({ item: { key: `x:${src}:live:${n}`, src, kind: 'live', name: `Ch ${n}` }, number: n, category: { src, name: 'News' }, index: 0, started: n }) as unknown as LastChannel;
const pin = { epgSrc: 's2:xmltv', channel: 'abc' };
const watch = { positionMs: 5, lengthMs: 10, updated: 1 };
const choice = { audio: null, text: null, used: 1 };

/** Two sources; every part of the profile that can name a source names both. */
function full(): ProfileDoc {
  return {
    ...emptyProfile(),
    sources: [source('s1'), source('s2')],
    guides: [
      { id: 's1', url: 'http://g.test/s1.xml' },
      { id: 's2', url: 'http://g.test/s2.xml' },
      { id: 'g1', url: 'http://g.test/g1.xml' },
    ],
    favourites: [fav('s1', 1), fav('s2', 2), fav('s2', 3)],
    favouriteLists: [
      { id: 'a', name: null, keys: ['x:s1:live:1', 'x:s2:live:2'] },
      { id: 'b', name: 'Kids', keys: ['x:s2:live:3'] },
    ],
    hiddenGroups: [
      { src: 's1', name: 'News' },
      { src: 's2', name: 'Sport' },
    ],
    groupOrder: [{ src: 's2', name: 'Sport' }],
    channelEdits: [{ ...fav('s1', 1), kind: 'live', hidden: true }, { ...fav('s2', 2), kind: 'live', name: 'Two' }],
    parental: { salt: 'x', hash: 'y', groups: [{ src: 's2', kind: 'live', name: 'Adult', locked: true }, { src: 's1', kind: 'movie', name: 'Horror', locked: false }] },
    player: {
      last: last('s2', 2),
      containers: { s1: 'ts', s2: 'hls' },
      redirects: { s2: 'redirects' },
      tracks: { 'x:s1:movie:5': choice, 'x:s2:movie:6': choice },
      subtitleSize: 'm',
    },
    channels: [last('s2', 2), last('s1', 1)],
    progress: { 'x:s1:movie:5': watch, 'x:s2:movie:6': watch, 'x:s2:episode:90': watch },
    shows: { 'x:s2:series:8': { episode: 'x:s2:episode:90', watched: false, updated: 1 }, 'x:s1:series:9': { episode: 'x:s1:episode:91', watched: true, updated: 1 } },
    epgOffsets: { 's1:xmltv': 60, 's2:xmltv': 30, 's2:tvg1': -30, 'u~s2': 90, 'u~g1': 120 },
    epgOverrides: { 'x:s2:live:2': pin, 'x:s1:live:1': { epgSrc: 's2:xmltv', channel: 'q' }, 'x:s1:live:4': { epgSrc: 'u~g1', channel: 'z' }, 'x:s1:live:5': { epgSrc: '', channel: null } },
  };
}

describe('keySource', () => {
  it('names the source of Xtream and M3U keys, nothing else', () => {
    expect(keySource('x:s2:live:5')).toBe('s2');
    expect(keySource('m:s10:abc:0')).toBe('s10');
    expect(keySource('s2:live:5')).toBeNull();
    expect(keySource('x:s2')).toBeNull();
    expect(keySource('')).toBeNull();
    expect(keySource('y:s2:live:5')).toBeNull();
  });
});

describe('removeSourceFromProfile (step 40f)', () => {
  it("takes the source and every place that names it, and keeps the other source's", () => {
    const removed = removeSourceFromProfile(full(), 's2')!;
    expect(removed.sources.map((s) => s.id)).toEqual(['s1']);
    expect(removed.guides.map((g) => g.id)).toEqual(['s1', 'g1']);
    expect(removed.favourites.map((f) => f.key)).toEqual(['x:s1:live:1']);
    expect(removed.favouriteLists).toEqual([
      { id: 'a', name: null, keys: ['x:s1:live:1'] },
      { id: 'b', name: 'Kids', keys: [] },
    ]);
    expect(removed.hiddenGroups).toEqual([{ src: 's1', name: 'News' }]);
    expect(removed.groupOrder).toBeUndefined();
    expect(removed.channelEdits!.map((e) => e.key)).toEqual(['x:s1:live:1']);
    expect(removed.parental).toEqual({ salt: 'x', hash: 'y', groups: [{ src: 's1', kind: 'movie', name: 'Horror', locked: false }] });
    expect(removed.player.last).toBeNull();
    expect(removed.player.containers).toEqual({ s1: 'ts' });
    expect(removed.player.redirects).toEqual({});
    expect(Object.keys(removed.player.tracks)).toEqual(['x:s1:movie:5']);
    expect(removed.player.subtitleSize).toBe('m');
    expect(removed.channels.map((c) => c.item.key)).toEqual(['x:s1:live:1']);
    expect(Object.keys(removed.progress)).toEqual(['x:s1:movie:5']);
    expect(Object.keys(removed.shows)).toEqual(['x:s1:series:9']);
    expect(removed.epgOffsets).toEqual({ 's1:xmltv': 60, 'u~g1': 120 });
    expect(Object.keys(removed.epgOverrides!).sort()).toEqual(['x:s1:live:4', 'x:s1:live:5']);
  });

  it('keeps the last channel when it is the other source’s, and the user’s own guides and offsets', () => {
    const removed = removeSourceFromProfile(full(), 's1')!;
    expect(removed.player.last!.item.key).toBe('x:s2:live:2');
    expect(removed.guides.map((g) => g.id)).toEqual(['s2', 'g1']);
    expect(removed.epgOffsets).toEqual({ 's2:xmltv': 30, 's2:tvg1': -30, 'u~s2': 90, 'u~g1': 120 });
    expect(Object.keys(removed.epgOverrides!)).toEqual(['x:s2:live:2']);
  });

  it('is a source never in the profile: nothing changes, and the document is left alone', () => {
    const doc = full();
    const before = JSON.stringify(doc);
    expect(removeSourceFromProfile(doc, 's9')).toBeNull();
    expect(applyProfileEdit(doc, { kind: 'removeSource', id: 's9' })).toBeNull();
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('leaves a profile of one source with nothing optional behind, and does not touch the input', () => {
    const doc: ProfileDoc = { ...emptyProfile(), sources: [source('s1')], favourites: [fav('s1', 1)], hiddenGroups: [{ src: 's1', name: 'X' }], epgOffsets: { 's1:xmltv': 30 }, parental: { groups: [{ src: 's1', kind: 'live', name: 'A', locked: true }] } };
    const before = JSON.stringify(doc);
    const removed = applyProfileEdit(doc, { kind: 'removeSource', id: 's1' })!;
    expect(removed).toEqual({ ...emptyProfile() });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('keeps the PIN when its last group lock goes', () => {
    const doc: ProfileDoc = { ...emptyProfile(), sources: [source('s1')], parental: { salt: 'a', hash: 'b', groups: [{ src: 's1', kind: 'live', name: 'A', locked: true }] } };
    expect(removeSourceFromProfile(doc, 's1')!.parental).toEqual({ salt: 'a', hash: 'b' });
  });

  it('a source id that is the start of another one’s (s1, s10) takes only its own', () => {
    const doc: ProfileDoc = {
      ...emptyProfile(),
      sources: [source('s1'), source('s10')],
      favourites: [fav('s1', 1), fav('s10', 2)],
      epgOffsets: { 's1:xmltv': 30, 's10:xmltv': 60 },
      progress: { 'x:s1:movie:1': watch, 'x:s10:movie:2': watch },
      player: { ...emptyProfile().player, containers: { s1: 'ts', s10: 'hls' } },
    };
    const removed = removeSourceFromProfile(doc, 's1')!;
    expect(removed.favourites.map((f) => f.src)).toEqual(['s10']);
    expect(removed.epgOffsets).toEqual({ 's10:xmltv': 60 });
    expect(Object.keys(removed.progress)).toEqual(['x:s10:movie:2']);
    expect(removed.player.containers).toEqual({ s10: 'hls' });
  });
});

describe('sourceFavouriteCount', () => {
  it('counts the pool’s items of the source, each once; none for no profile', () => {
    expect(sourceFavouriteCount(full(), 's2')).toBe(2);
    expect(sourceFavouriteCount(full(), 's1')).toBe(1);
    expect(sourceFavouriteCount(full(), 's9')).toBe(0);
    expect(sourceFavouriteCount(null, 's2')).toBe(0);
  });
});
