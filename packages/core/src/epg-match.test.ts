import { describe, expect, it } from 'vitest';
import type { EpgOverride } from './epg-match';
import { EpgMatcher, EpgWantedSet, combineEpgMatches, epgMethodRank, epgWantedChannel, xmltvIdStem } from './epg-match';
import type { CatalogItem } from './model';
import { matchName, normalizeName } from './normalize';
import type { XmltvChannel } from './xmltv';

let serial = 0;
function liveItem(name: string, over: Partial<CatalogItem> = {}): CatalogItem {
  serial++;
  return {
    key: `m:tv:${serial.toString(36)}:0`,
    src: 'tv',
    kind: 'live',
    name,
    normName: normalizeName(name),
    group: 'News',
    url: `http://127.0.0.1/live/${serial}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: matchName(name),
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
    ...over,
  };
}

const channel = (id: string, ...names: string[]): XmltvChannel => ({ type: 'channel', id, name: names[0] ?? id, names, icon: null });

function matcherFor(items: CatalogItem[], channels: XmltvChannel[], overrides: EpgOverride[] = [], epgSrc = 'g1'): EpgMatcher {
  const m = new EpgMatcher(epgSrc, EpgWantedSet.fromItems(items, overrides));
  for (const c of channels) m.addChannel(c);
  return m;
}

const byKey = (m: EpgMatcher): Record<string, string> => Object.fromEntries(m.matches().map((x) => [x.key, `${x.channel} ${x.method}${x.ambiguous ? ' ambiguous' : ''}`]));

describe('epgWantedChannel', () => {
  it('takes live items only, with both names, the Xtream flag, catch-up days and tvg-shift', () => {
    const m3u = liveItem('AR: MBC 1 HD', { epgId: ' mbc1.ae ', tvgName: 'MBC One', catchup: { mode: 'shift', days: 3, source: null }, tvgShift: -2 });
    const c = epgWantedChannel(m3u)!;
    expect(c).toEqual({
      key: m3u.key,
      name: 'AR: MBC 1 HD',
      epgId: 'mbc1.ae',
      xtream: false,
      names: ['ar mbc 1 hd', 'mbc one'],
      matchNames: ['mbc1', 'mbcone'],
      catchupDays: 3,
      shiftHours: -2,
    });
    expect(epgWantedChannel(liveItem('X', { key: 'x:tv:live:7' }))!.xtream).toBe(true);
    expect(epgWantedChannel(liveItem('X', { epgId: '   ' }))!.epgId).toBeNull();
    expect(epgWantedChannel(liveItem('Movie', { kind: 'movie', matchName: null }))).toBeNull();
    // The same name and tvg-name collapse to one entry.
    expect(epgWantedChannel(liveItem('Zoma', { tvgName: 'ZOMA' }))!.names).toEqual(['zoma']);
  });
});

describe('xmltvIdStem', () => {
  it('drops an @variant and a 2-3 letter country suffix, or gives null', () => {
    expect(xmltvIdStem('BBCOne.uk@HD')).toBe('BBCOne');
    expect(xmltvIdStem('BBCOne.uk')).toBe('BBCOne');
    expect(xmltvIdStem('mbc1.ae')).toBe('mbc1');
    expect(xmltvIdStem('Channel@SD')).toBe('Channel');
    expect(xmltvIdStem('epg1.zoma.test')).toBeNull();
    expect(xmltvIdStem('plain')).toBeNull();
    expect(xmltvIdStem('.uk')).toBeNull();
  });
});

describe('EpgMatcher: the cascade', () => {
  it('matches the id case-insensitively, as xtream-id for Xtream channels', () => {
    const a = liveItem('Zoma Kids', { epgId: 'Zoma.Kids' });
    const b = liveItem('Zoma Kids', { key: 'x:tv:live:5', epgId: 'ZOMA.KIDS' });
    const m = matcherFor([a, b], [channel('zoma.kids', 'Something Else')]);
    expect(byKey(m)).toEqual({ [a.key]: 'zoma.kids id', [b.key]: 'zoma.kids xtream-id' });
  });

  it('matches the normalized display name, then the match name, then the id stem', () => {
    const byName = liveItem('Al Jazéera  News', { epgId: 'nowhere' });
    const byTvgName = liveItem('Channel 9', { tvgName: 'قناة الأخبار' });
    const byMatch = liveItem('AR: MBC 1 HD');
    const byStem = liveItem('UK | BBC One FHD');
    const none = liveItem('Nothing Like It');
    const m = matcherFor(
      [byName, byTvgName, byMatch, byStem, none],
      [channel('aj', 'AL JAZEERA NEWS'), channel('news.ar', 'قناه الاخبار'), channel('mbc', 'MBC1'), channel('BBCOne.uk@HD')],
    );
    expect(byKey(m)).toEqual({
      [byName.key]: 'aj name',
      [byTvgName.key]: 'news.ar name',
      [byMatch.key]: 'mbc match-name',
      [byStem.key]: 'BBCOne.uk@HD match-name',
    });
    expect(m.unmatched().map((c) => c.key)).toEqual([none.key]);
  });

  it('lets a stronger method win over an earlier channel, and frees the earlier one', () => {
    const a = liveItem('Zoma One', { epgId: 'z1' });
    const m = new EpgMatcher('g1', EpgWantedSet.fromItems([a]));
    m.addChannel(channel('first', 'Zoma One'));
    expect(m.isUsed('first')).toBe(true);
    m.addChannel(channel('z1', 'Different'));
    expect(byKey(m)).toEqual({ [a.key]: 'z1 id' });
    expect(m.isUsed('first')).toBe(false);
    expect(m.isUsed('z1')).toBe(true);
    expect(m.usedChannels().map((c) => c.id)).toEqual(['z1']);
    expect(m.stats()).toMatchObject({ declared: 2, used: 1, matched: 1, wanted: 1 });
  });

  it('keeps the first channel at the same level, flags name ties as ambiguous, never id ties', () => {
    const named = liveItem('Zoma One');
    const ided = liveItem('Other', { epgId: 'dup' });
    const m = matcherFor([named, ided], [channel('a', 'Zoma One'), channel('b', 'ZOMA ONE'), channel('dup'), channel('DUP')]);
    expect(byKey(m)).toEqual({ [named.key]: 'a name ambiguous', [ided.key]: 'dup id' });
    expect(m.stats().ambiguous).toBe(1);
    // The same channel offering the same name twice is not a tie.
    const once = matcherFor([liveItem('Zoma One')], [channel('a', 'Zoma One', 'zoma one')]);
    expect(once.stats().ambiguous).toBe(0);
  });

  it('adds the names of a repeated channel id to the first declaration', () => {
    const a = liveItem('Second Name');
    const m = matcherFor([a], [channel('c1', 'First Name'), channel('c1', 'Second Name')]);
    expect(byKey(m)).toEqual({ [a.key]: 'c1 name' });
    expect(m.usedChannels()).toEqual([{ type: 'channel', id: 'c1', name: 'First Name', names: ['First Name', 'Second Name'], icon: null }]);
  });

  it('declares programme-only ids that match by id or override, nothing else', () => {
    const a = liveItem('A', { epgId: 'only.programmes' });
    const m = matcherFor([a], []);
    expect(m.declareById('nobody')).toBe(false);
    expect(m.isDeclared('nobody')).toBe(false);
    expect(m.declareById('ONLY.programmes')).toBe(true);
    expect(byKey(m)).toEqual({ [a.key]: 'ONLY.programmes id' });
    expect(m.declareById('ONLY.programmes')).toBe(true);
  });

  it('lists every declared channel, used or not, in declaration order (step 24d)', () => {
    const a = liveItem('Zoma One', { epgId: 'only.programmes' });
    const m = matcherFor([a], [channel('c2', 'Second'), channel('c1', 'First', 'Premier'), channel('c2', 'Deuxième'), channel('Zoma1', 'Zoma One')]);
    m.declareById('nobody');
    m.declareById('only.programmes');
    expect(m.declaredChannels()).toEqual([
      { type: 'channel', id: 'c2', name: 'Second', names: ['Second', 'Deuxième'], icon: null },
      { type: 'channel', id: 'c1', name: 'First', names: ['First', 'Premier'], icon: null },
      { type: 'channel', id: 'Zoma1', name: 'Zoma One', names: ['Zoma One'], icon: null },
      { type: 'channel', id: 'only.programmes', name: 'only.programmes', names: [], icon: null },
    ]);
    expect(m.usedChannels().map((c) => c.id)).toEqual(['only.programmes']);
  });

  it('reports catch-up days and tvg-shift of matched channels only', () => {
    const matched = liveItem('A', { epgId: 'a', catchup: { mode: null, days: 4, source: null }, tvgShift: -3 });
    const other = liveItem('B', { epgId: 'b', catchup: { mode: null, days: 7, source: null }, tvgShift: 5 });
    const m = matcherFor([matched, other], [channel('a')]);
    expect(m.maxCatchupDays()).toBe(4);
    expect(m.maxShiftHours()).toBe(3);
    expect(matcherFor([other], []).maxCatchupDays()).toBe(0);
  });
});

describe('EpgMatcher: overrides', () => {
  it('pins a channel to one XMLTV channel of one guide, and blocks it everywhere else', () => {
    const pinned = liveItem('Zoma One', { epgId: 'z1' });
    const free = liveItem('Zoma Two', { epgId: 'z2' });
    const overrides: EpgOverride[] = [{ key: pinned.key, epgSrc: 'g2', channel: 'Manual.Pick' }];
    const g1 = matcherFor([pinned, free], [channel('z1', 'Zoma One'), channel('z2')], overrides, 'g1');
    expect(byKey(g1)).toEqual({ [free.key]: 'z2 id' });
    expect(g1.stats().wanted).toBe(1);
    const g2 = matcherFor([pinned, free], [channel('z1', 'Zoma One'), channel('manual.pick', 'Whatever')], overrides, 'g2');
    expect(byKey(g2)).toEqual({ [pinned.key]: 'manual.pick override' });
    // Before the pinned channel is declared, nothing else may take it.
    const early = matcherFor([pinned], [channel('z1', 'Zoma One')], overrides, 'g2');
    expect(early.matches()).toEqual([]);
    expect(early.declareById('MANUAL.PICK')).toBe(true);
  });

  it('pins a channel to no EPG at all', () => {
    const off = liveItem('Zoma One', { epgId: 'z1' });
    const m = matcherFor([off], [channel('z1', 'Zoma One')], [{ key: off.key, epgSrc: 'g1', channel: null }]);
    expect(m.matches()).toEqual([]);
    expect(m.unmatched()).toEqual([]);
    expect(m.stats()).toMatchObject({ wanted: 0, matched: 0 });
  });

  it('ignores overrides for keys that are not in the wanted set', () => {
    const a = liveItem('A', { epgId: 'a' });
    const m = matcherFor([a], [channel('a')], [{ key: 'm:tv:gone:0', epgSrc: 'g1', channel: 'a' }]);
    expect(byKey(m)).toEqual({ [a.key]: 'a id' });
  });
});

describe('combineEpgMatches', () => {
  it('takes the stronger method first, then the guide listed first', () => {
    const one = { key: 'k1', channel: 'n1', method: 'name' as const, ambiguous: false };
    const result = combineEpgMatches([
      { epgSrc: 'first', matches: [one, { key: 'k2', channel: 'i2', method: 'id', ambiguous: false }] },
      {
        epgSrc: 'second',
        matches: [
          { key: 'k1', channel: 'i1', method: 'id', ambiguous: false },
          { key: 'k2', channel: 'x2', method: 'id', ambiguous: false },
          { key: 'k3', channel: 'm3', method: 'match-name', ambiguous: true },
        ],
      },
    ]);
    expect(Object.fromEntries([...result].map(([k, v]) => [k, `${v.epgSrc} ${v.channel} ${v.method}`]))).toEqual({
      k1: 'second i1 id',
      k2: 'first i2 id',
      k3: 'second m3 match-name',
    });
    expect(epgMethodRank('override')).toBeLessThan(epgMethodRank('id'));
    expect(epgMethodRank('xtream-id')).toBeLessThan(epgMethodRank('name'));
  });
});
