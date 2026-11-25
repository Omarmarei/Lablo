import type { CatalogItem } from '@lablo/core';
import type { LastChannel, LoadedProfile, ProfileDoc, ProfileEdit } from '@lablo/data';
import { MAX_CHANNELS, applyProfileEdit, emptyProfile } from '@lablo/data';
import { describe, expect, it, vi } from 'vitest';
import { RECENT_CHANNELS, TRACK_LANGS, createPlayerMemory, lastChannelOf, railRefOf, recentChannelsOf } from './player-memory';

/** What the player keeps in the profile (RELAY step 20c1). */

const item = (n: number, src = 's1'): CatalogItem => ({
  key: `${src}:live:${n}`,
  src,
  kind: 'live',
  name: `Channel ${n}`,
  normName: `channel ${n}`,
  group: 'News',
  url: `http://panel.test/live/u/p/${n}.ts`,
  logo: null,
  epgId: null,
  tvgName: null,
  matchName: `channel ${n}`,
  chno: n,
  tvgShift: 0,
  catchup: null,
  radio: false,
  hints: null,
});

const profile = (player: unknown): LoadedProfile => ({ doc: { v: 3, sources: [], player }, newer: false, migratedFrom: null });

function rig(fails = false): { memory: ReturnType<typeof createPlayerMemory>; edits: ProfileEdit[]; clock: { t: number } } {
  const edits: ProfileEdit[] = [];
  const clock = { t: 1000 };
  const memory = createPlayerMemory({
    edit: (edit) => {
      edits.push(edit);
      return fails ? Promise.reject(new Error('IndexedDB closed')) : Promise.resolve(true);
    },
    now: () => clock.t,
  });
  return { memory, edits, clock };
}

const changes = (edits: ProfileEdit[]): unknown[] => edits.map((e) => (e.kind === 'player' ? e.change : e));

describe('createPlayerMemory', () => {
  it('knows nothing before the profile, and nothing from a profile without a player section', () => {
    const { memory, edits } = rig();
    expect([memory.sources.preferred('s1'), memory.redirects.mode('s1'), memory.tracks.choice('s1:live:1'), memory.last(), memory.subtitleSize(), memory.picture()]).toEqual([null, 'unknown', null, null, null, null]);
    memory.load(null);
    memory.load({ doc: { v: 2, sources: [] }, newer: false, migratedFrom: null });
    expect([memory.sources.preferred('s1'), memory.redirects.mode('s1'), memory.tracks.choice('s1:live:1'), memory.last(), memory.subtitleSize(), memory.picture()]).toEqual([null, 'unknown', null, null, null, null]);
    expect(edits).toEqual([]);
  });

  it("reads what the profile kept, skipping entries this app can't use", () => {
    const { memory } = rig();
    const audio = { id: '2', lang: 'ar', label: 'AAC' };
    const last = { item: item(5), number: 5, category: { src: 's1', name: 'News' }, index: 4, started: 7 };
    memory.load(
      profile({
        last,
        containers: { s1: 'hls', s2: 'ts', s3: 'flv', toString: 'hls' },
        redirects: { s1: 'redirects', s2: 'none', s3: 'maybe' },
        tracks: {
          a: { audio, text: 'off', used: 1 },
          b: { audio: null, text: { id: 'ext:0', lang: 'en', label: '' }, delayMs: -750, used: 2 },
          c: { audio: { id: 1, lang: 'en', label: '' }, text: null, used: 3 },
          c2: { audio: { id: '1', lang: 'en' }, text: null, used: 3 },
          c3: { audio: { id: '1', label: '' }, text: null, used: 3 },
          c4: { audio: null, text: { lang: 'en', label: '' }, used: 3 },
          d: { audio: null, text: 'on', used: 4 },
          e: 'off',
          f: { audio: null, text: null, delayMs: 'late', used: 5 },
        },
        subtitleSize: 'l',
        picture: '4:3',
      }),
    );
    expect(['s1', 's2', 's3', 's4', 'hasOwnProperty'].map((s) => memory.sources.preferred(s))).toEqual(['hls', 'ts', null, null, null]);
    expect(memory.sources.preferred('toString')).toBe('hls');
    expect(['s1', 's2', 's3', 'constructor'].map((s) => memory.redirects.mode(s))).toEqual(['redirects', 'none', 'unknown', 'unknown']);
    // The choices come back without their `used` time.
    expect(memory.tracks.choice('a')).toEqual({ audio, text: 'off' });
    expect(memory.tracks.choice('b')).toEqual({ audio: null, text: { id: 'ext:0', lang: 'en', label: '' }, delayMs: -750 });
    expect(['c', 'c2', 'c3', 'c4', 'd', 'e', 'valueOf'].map((k) => memory.tracks.choice(k))).toEqual([null, null, null, null, null, null, null]);
    expect(memory.tracks.choice('f')).toEqual({ audio: null, text: null });
    expect(memory.subtitleSize()).toBe('l');
    expect(memory.picture()).toBe('4:3');
    expect(memory.last()).toEqual(last);
    // A second load replaces everything.
    memory.load(profile({ containers: {}, subtitleSize: 'xl', picture: '16:9' }));
    expect([memory.sources.preferred('s1'), memory.redirects.mode('s1'), memory.tracks.choice('a'), memory.last(), memory.subtitleSize(), memory.picture()]).toEqual([null, 'unknown', null, null, null, null]);
  });

  it('writes each change once, as a player edit; the same answer again writes nothing', () => {
    const { memory, edits, clock } = rig();
    memory.load(profile({ containers: { s1: 'ts' }, redirects: { s1: 'none' }, subtitleSize: 'm', picture: 'zoom' }));
    memory.sources.remember('s1', 'ts');
    memory.redirects.remember('s1', 'none');
    memory.setSubtitleSize('m');
    memory.setPicture('zoom');
    expect(edits).toEqual([]);
    memory.sources.remember('s1', 'hls');
    memory.sources.remember('s1', 'hls');
    memory.redirects.remember('s2', 'redirects');
    memory.redirects.remember('s2', 'redirects');
    memory.setSubtitleSize('s');
    memory.setSubtitleSize('s');
    memory.setPicture('stretch');
    memory.setPicture('stretch');
    clock.t = 2000;
    memory.tracks.remember('s1:live:5', { audio: { id: '1', lang: 'en', label: '' }, text: null });
    clock.t = 3000;
    memory.tracks.remember('s1:vod:7', { audio: null, text: 'off', delayMs: 250 });
    expect(changes(edits)).toEqual([
      { field: 'container', src: 's1', container: 'hls' },
      { field: 'redirect', src: 's2', mode: 'redirects' },
      { field: 'subtitleSize', size: 's' },
      { field: 'picture', mode: 'stretch' },
      { field: 'track', key: 's1:live:5', choice: { audio: { id: '1', lang: 'en', label: '' }, text: null, used: 2000 } },
      { field: 'track', key: 's1:vod:7', choice: { audio: null, text: 'off', delayMs: 250, used: 3000 } },
    ]);
    expect([memory.sources.preferred('s1'), memory.redirects.mode('s2'), memory.subtitleSize(), memory.picture()]).toEqual(['hls', 'redirects', 's', 'stretch']);
    expect(memory.tracks.choice('s1:vod:7')).toEqual({ audio: null, text: 'off', delayMs: 250 });
  });

  it('keeps the last channel: the same channel in the same place writes nothing', () => {
    const { memory, edits, clock } = rig();
    memory.tuned(item(5), 5, { src: 's1', name: 'News' }, 4);
    clock.t = 2000;
    memory.tuned(item(5), 5, { src: 's1', name: 'News' }, 4);
    memory.tuned(item(5), 5, { src: 's1', name: 'Sport' }, 4);
    memory.tuned(item(5), 5, null, 4);
    memory.tuned(item(5), 5, null, 40);
    memory.tuned(item(5), 6, null, 40);
    memory.tuned(item(6), 6, null, 40);
    memory.tuned(item(6), 6, { src: 's2', name: 'Sport' }, 40);
    memory.tuned(item(6), 6, { src: 's1', name: 'Sport' }, 40);
    const lasts = changes(edits).map((c) => {
      const l = (c as { last: { item: CatalogItem; number: number; category: unknown; index: number; started: number } }).last;
      return [l.item.key, l.number, l.category, l.index, l.started];
    });
    expect(lasts).toEqual([
      ['s1:live:5', 5, { src: 's1', name: 'News' }, 4, 1000],
      ['s1:live:5', 5, { src: 's1', name: 'Sport' }, 4, 2000],
      ['s1:live:5', 5, null, 4, 2000],
      ['s1:live:5', 5, null, 40, 2000],
      ['s1:live:5', 6, null, 40, 2000],
      ['s1:live:6', 6, null, 40, 2000],
      ['s1:live:6', 6, { src: 's2', name: 'Sport' }, 40, 2000],
      ['s1:live:6', 6, { src: 's1', name: 'Sport' }, 40, 2000],
    ]);
    expect(memory.last()).toEqual({ item: item(6), number: 6, category: { src: 's1', name: 'Sport' }, index: 40, started: 2000 });
  });

  it('keeps a favourites list as the rail entry by its id, with no category (step 35c)', () => {
    const { memory, edits, clock } = rig();
    memory.tuned(item(5), 1, { list: 'l1' }, 0);
    clock.t = 2000;
    memory.tuned(item(5), 1, { list: 'l1' }, 0);
    memory.tuned(item(5), 1, { list: 'l2' }, 0);
    memory.tuned(item(5), 1, null, 0);
    memory.tuned(item(5), 1, { list: 'l2' }, 0);
    memory.tuned(item(5), 1, { src: 's1', name: 'l2' }, 0);
    const lasts = changes(edits).map((c) => {
      const l = (c as { last: LastChannel }).last;
      return [l.category, l.list, l.started];
    });
    expect(lasts).toEqual([
      [null, 'l1', 1000],
      [null, 'l2', 2000],
      [null, undefined, 2000],
      [null, 'l2', 2000],
      [{ src: 's1', name: 'l2' }, undefined, 2000],
    ]);
    expect(railRefOf({ item: item(5), number: 1, category: null, list: 'l1', index: 0, started: 1 })).toEqual({ list: 'l1' });
    expect(railRefOf({ item: item(5), number: 1, category: { src: 's1', name: 'News' }, index: 0, started: 1 })).toEqual({ src: 's1', name: 'News' });
    expect(railRefOf({ item: item(5), number: 1, category: null, index: 0, started: 1 })).toBeNull();
  });

  it('keeps the channels played last: newest first, each once, at most RECENT_CHANNELS, as the profile does (step 28b2)', () => {
    expect(RECENT_CHANNELS).toBe(MAX_CHANNELS);
    const { memory, edits, clock } = rig();
    const kept = (n: number, index: number, started: number, category: LastChannel['category'] = { src: 's1', name: 'News' }): LastChannel => ({ item: item(n), number: n, category, index, started });
    expect(memory.recent()).toEqual([]);
    memory.load({ doc: { v: 7, sources: [], player: { last: kept(3, 2, 7) }, channels: [kept(3, 2, 7), kept(4, 3, 6)] }, newer: false, migratedFrom: null });
    expect(memory.recent()).toEqual([kept(3, 2, 7), kept(4, 3, 6)]);
    memory.tuned(item(5), 5, { src: 's1', name: 'News' }, 4);
    expect(memory.recent()).toEqual([kept(5, 4, 1000), kept(3, 2, 7), kept(4, 3, 6)]);
    // Played again, from another row: first, once.
    clock.t = 2000;
    memory.tuned(item(4), 4, null, 30);
    const after = memory.recent();
    expect(after).toEqual([kept(4, 30, 2000, null), kept(5, 4, 1000), kept(3, 2, 7)]);
    // The same channel in the same place: nothing changes, not even the array.
    memory.tuned(item(4), 4, null, 30);
    expect(memory.recent()).toBe(after);
    // The list the profile keeps after the same writes is the same list.
    let doc: ProfileDoc = { ...emptyProfile(), player: { ...emptyProfile().player, last: kept(3, 2, 7) }, channels: [kept(3, 2, 7), kept(4, 3, 6)] };
    for (const edit of edits) doc = applyProfileEdit(doc, edit) ?? doc;
    expect(doc.channels).toEqual(memory.recent());
    // Past RECENT_CHANNELS, the one played longest ago goes.
    for (let n = 10; n < 10 + RECENT_CHANNELS; n += 1) memory.tuned(item(n), n, null, n);
    expect(memory.recent()).toHaveLength(RECENT_CHANNELS);
    expect(memory.recent()[0]!.item.key).toBe(`s1:live:${9 + RECENT_CHANNELS}`);
    expect(memory.recent()[RECENT_CHANNELS - 1]!.item.key).toBe('s1:live:10');
    // A new profile replaces the list.
    memory.load(null);
    expect(memory.recent()).toEqual([]);
  });

  it('keeps the languages Settings › "Player" chose (step 38d3): Arabic or English, `null` taking the choice away', () => {
    const { memory, edits } = rig();
    expect(TRACK_LANGS).toEqual(['ar', 'en']);
    expect([memory.audioLang(), memory.subtitleLang()]).toEqual([null, null]);
    memory.load(profile({ audioLang: 'ar', subtitleLang: 'en' }));
    expect([memory.audioLang(), memory.subtitleLang()]).toEqual(['ar', 'en']);
    // What isn't one of the app's two languages is no choice.
    for (const stored of ['fr', 'off', 'AR', '', 1, null]) {
      memory.load(profile({ audioLang: stored, subtitleLang: stored }));
      expect([memory.audioLang(), memory.subtitleLang()]).toEqual([null, null]);
    }
    memory.load(profile({ subtitleLang: 'ar' }));
    expect([memory.audioLang(), memory.subtitleLang()]).toEqual([null, 'ar']);
    memory.setAudioLang(null);
    memory.setSubtitleLang('ar');
    expect(edits).toEqual([]);
    memory.setAudioLang('en');
    memory.setAudioLang('en');
    memory.setSubtitleLang(null);
    memory.setSubtitleLang(null);
    memory.setAudioLang(null);
    expect(changes(edits)).toEqual([
      { field: 'audioLang', lang: 'en' },
      { field: 'subtitleLang', lang: null },
      { field: 'audioLang', lang: null },
    ]);
    expect([memory.audioLang(), memory.subtitleLang()]).toEqual([null, null]);
    // The profile after the same writes reads back the same.
    let doc: ProfileDoc = { ...emptyProfile(), player: { ...emptyProfile().player, subtitleLang: 'ar' } };
    memory.setSubtitleLang('en');
    for (const edit of edits) doc = applyProfileEdit(doc, edit) ?? doc;
    expect(doc.player).toEqual({ ...emptyProfile().player, subtitleLang: 'en' });
    const again = rig().memory;
    again.load({ doc, newer: false, migratedFrom: null });
    expect([again.audioLang(), again.subtitleLang()]).toEqual([null, 'en']);
  });

  it('keeps "Clock while watching" (step 39a) in the profile\'s options: on as `clock: \'on\'`, off taken away', () => {
    const { memory, edits } = rig();
    expect(memory.clock()).toBe(false);
    memory.load(profile({ options: { clock: 'on', buffer: 'stable' } }));
    expect(memory.clock()).toBe(true);
    // Anything else is off: another value, no options, options that aren't a record, an inherited name.
    for (const options of [{ clock: 'off' }, { clock: true }, { clock: 'ON' }, {}, 'clock', null, undefined, Object.create({ clock: 'on' })]) {
      memory.load(profile({ options }));
      expect(memory.clock()).toBe(false);
    }
    memory.load(profile({ options: { clock: 'on' } }));
    memory.load(profile({}));
    expect(memory.clock()).toBe(false);
    memory.setClock(false);
    expect(edits).toEqual([]);
    memory.setClock(true);
    memory.setClock(true);
    memory.setClock(false);
    expect(changes(edits)).toEqual([
      { field: 'option', name: 'clock', value: 'on' },
      { field: 'option', name: 'clock', value: null },
    ]);
    // The profile after the writes reads back the same; another option is kept.
    let doc: ProfileDoc = { ...emptyProfile(), player: { ...emptyProfile().player, options: { buffer: 'stable' } } };
    memory.setClock(true);
    for (const edit of edits) doc = applyProfileEdit(doc, edit) ?? doc;
    expect(doc.player.options).toEqual({ buffer: 'stable', clock: 'on' });
    const again = rig().memory;
    again.load({ doc, newer: false, migratedFrom: null });
    expect(again.clock()).toBe(true);
  });

  it('keeps "Still watching?" (step 39c) in the profile\'s options: 4 hours with nothing stored, `off` for never, else its hours as text', () => {
    const { memory, edits } = rig();
    expect(memory.stillHours()).toBe(4);
    const read = (options: unknown): number | null => {
      memory.load(profile({ options }));
      return memory.stillHours();
    };
    expect([read({ stillWatching: 'off' }), read({ stillWatching: '2' }), read({ stillWatching: '4' }), read({ stillWatching: '6' })]).toEqual([null, 2, 4, 6]);
    // Anything else is the default: other hours, a number, no options, an inherited name.
    for (const options of [{ stillWatching: '3' }, { stillWatching: 6 }, { stillWatching: 'OFF' }, { stillWatching: null }, { clock: 'on' }, {}, null, undefined, Object.create({ stillWatching: 'off' })]) {
      expect(read(options)).toBe(4);
    }
    expect(read({ stillWatching: 'off' })).toBeNull();
    memory.load(profile({}));
    expect(memory.stillHours()).toBe(4);
    memory.setStillHours(4);
    expect(edits).toEqual([]);
    memory.setStillHours(2);
    memory.setStillHours(2);
    memory.setStillHours(null);
    memory.setStillHours(6);
    memory.setStillHours(4);
    expect(changes(edits)).toEqual([
      { field: 'option', name: 'stillWatching', value: '2' },
      { field: 'option', name: 'stillWatching', value: 'off' },
      { field: 'option', name: 'stillWatching', value: '6' },
      { field: 'option', name: 'stillWatching', value: null },
    ]);
    expect(memory.stillHours()).toBe(4);
    // The profile after the writes reads back the same; the clock's option is kept beside it.
    let doc: ProfileDoc = { ...emptyProfile(), player: { ...emptyProfile().player, options: { clock: 'on' } } };
    memory.setStillHours(null);
    for (const edit of edits) doc = applyProfileEdit(doc, edit) ?? doc;
    expect(doc.player.options).toEqual({ clock: 'on', stillWatching: 'off' });
    const again = rig().memory;
    again.load({ doc, newer: false, migratedFrom: null });
    expect([again.stillHours(), again.clock()]).toEqual([null, true]);
  });

  it('keeps the caption box and colour and "Larger text" (step 43) in the options: nothing for the defaults', () => {
    const { memory, edits } = rig();
    expect([memory.captionBackground(), memory.captionColor(), memory.largeText()]).toEqual(['dark', 'white', false]);
    memory.load(profile({ options: { captionBg: 'solid', captionColor: 'cyan', largeText: 'on' } }));
    expect([memory.captionBackground(), memory.captionColor(), memory.largeText()]).toEqual(['solid', 'cyan', true]);
    // Anything else is the default.
    memory.load(profile({ options: { captionBg: 'pink', captionColor: 'Cyan', largeText: 'yes' } }));
    expect([memory.captionBackground(), memory.captionColor(), memory.largeText()]).toEqual(['dark', 'white', false]);
    memory.setCaptionBackground('dark');
    memory.setCaptionColor('white');
    memory.setLargeText(false);
    expect(edits).toEqual([]);
    memory.setCaptionBackground('none');
    memory.setCaptionBackground('none');
    memory.setCaptionColor('green');
    memory.setLargeText(true);
    memory.setCaptionBackground('dark');
    memory.setLargeText(false);
    expect(changes(edits)).toEqual([
      { field: 'option', name: 'captionBg', value: 'none' },
      { field: 'option', name: 'captionColor', value: 'green' },
      { field: 'option', name: 'largeText', value: 'on' },
      { field: 'option', name: 'captionBg', value: null },
      { field: 'option', name: 'largeText', value: null },
    ]);
  });

  it('keeps "Buffering" (step 39d) in the profile\'s options: `stable` for Stable, nothing for Fast start', () => {
    const { memory, edits } = rig();
    expect(memory.bufferMode()).toBe('fast');
    const read = (options: unknown): string => {
      memory.load(profile({ options }));
      return memory.bufferMode();
    };
    expect(read({ buffer: 'stable' })).toBe('stable');
    // Anything else is Fast start: another word, no options, an inherited name.
    for (const options of [{ buffer: 'fast' }, { buffer: 'Stable' }, { buffer: true }, { clock: 'on' }, {}, null, undefined, Object.create({ buffer: 'stable' })]) {
      expect(read(options)).toBe('fast');
    }
    memory.setBufferMode('fast');
    expect(edits).toEqual([]);
    memory.setBufferMode('stable');
    memory.setBufferMode('stable');
    memory.setBufferMode('fast');
    expect(changes(edits)).toEqual([
      { field: 'option', name: 'buffer', value: 'stable' },
      { field: 'option', name: 'buffer', value: null },
    ]);
    expect(memory.bufferMode()).toBe('fast');
    // The profile after the writes reads back the same; another option is kept beside it.
    let doc: ProfileDoc = { ...emptyProfile(), player: { ...emptyProfile().player, options: { stillWatching: '2' } } };
    memory.setBufferMode('stable');
    for (const edit of edits) doc = applyProfileEdit(doc, edit) ?? doc;
    expect(doc.player.options).toEqual({ stillWatching: '2', buffer: 'stable' });
    const again = rig().memory;
    again.load({ doc, newer: false, migratedFrom: null });
    expect([again.bufferMode(), again.stillHours()]).toEqual(['stable', 2]);
  });

  it('keeps a change for the run when the write fails, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { memory } = rig(true);
    memory.sources.remember('s1', 'hls');
    await Promise.resolve();
    await Promise.resolve();
    expect(memory.sources.preferred('s1')).toBe('hls');
    expect(warn).toHaveBeenCalledWith('The player memory was not saved', expect.any(Error));
    warn.mockRestore();
  });
});

describe('lastChannelOf', () => {
  const last = { item: item(5), number: 5, category: { src: 's1', name: 'News' }, index: 4, started: 7 };
  it('reads a live channel with its key, source, URL and name, a number and a row', () => {
    expect(lastChannelOf(profile({ last }))).toEqual(last);
    expect(lastChannelOf(profile({ last: { ...last, category: null, started: undefined } }))).toEqual({ ...last, category: null, started: 0 });
    // A favourites list's id (step 35c), only beside no category; anything else is "All channels".
    expect(lastChannelOf(profile({ last: { ...last, category: null, list: 'l1' } }))).toEqual({ ...last, category: null, list: 'l1' });
    expect(lastChannelOf(profile({ last: { ...last, list: 'l1' } }))).toEqual(last);
    for (const list of ['', 5, null, { id: 'l1' }]) expect(lastChannelOf(profile({ last: { ...last, category: null, list } }))).toEqual({ ...last, category: null });
    expect(lastChannelOf(null)).toBeNull();
    expect(lastChannelOf(profile(undefined))).toBeNull();
    expect(lastChannelOf(profile({ last: null }))).toBeNull();
  });

  it('refuses anything else', () => {
    const bad: unknown[] = [
      { ...last, item: { ...item(5), kind: 'vod' } },
      { ...last, item: 'Channel 5' },
      ...['key', 'src', 'url', 'name'].map((field) => ({ ...last, item: { ...item(5), [field]: 5 } })),
      { ...last, number: '5' },
      { ...last, number: NaN },
      { ...last, index: -1 },
      { ...last, index: 1.5 },
      { ...last, index: '4' },
      { ...last, category: { src: 's1' } },
      { ...last, category: { name: 'News' } },
      { ...last, category: 'News' },
      [last],
    ];
    for (const value of bad) expect(lastChannelOf(profile({ last: value }))).toBeNull();
  });

  it('plays nothing for a channel a backup without logins brought back with no URL, which Home still lists (step 32d4a)', () => {
    const bare = { ...last, item: { ...item(5), url: '', catchup: null } };
    expect(lastChannelOf(profile({ last: bare }))).toBeNull();
    const doc = { v: 9, player: { last: bare }, channels: [bare, last] };
    expect(recentChannelsOf({ doc, newer: false, migratedFrom: null })).toEqual([bare, last]);
  });
});

describe('recentChannelsOf', () => {
  const kept = (n: number): LastChannel => ({ item: item(n), number: n, category: { src: 's1', name: 'News' }, index: n - 1, started: n });
  const doc = (channels: unknown): LoadedProfile => ({ doc: { v: 7, sources: [], channels }, newer: false, migratedFrom: null });

  it("reads the profile's channels in their order, skipping the ones this app can't play", () => {
    expect(recentChannelsOf(doc([kept(1), kept(2)]))).toEqual([kept(1), kept(2)]);
    expect(recentChannelsOf(doc([kept(1), { ...kept(2), item: { ...item(2), kind: 'vod' } }, null, 'x', { ...kept(3), started: undefined }]))).toEqual([kept(1), { ...kept(3), started: 0 }]);
  });

  it('reads at most RECENT_CHANNELS', () => {
    const many: LastChannel[] = [];
    for (let n = 1; n <= RECENT_CHANNELS + 2; n += 1) many.push(kept(n));
    expect(recentChannelsOf(doc(many))).toEqual(many.slice(0, RECENT_CHANNELS));
    // The ones it skips don't count.
    expect(recentChannelsOf(doc([null].concat(many as never[])))).toEqual(many.slice(0, RECENT_CHANNELS));
  });

  it('reads none from no profile, or from one without a list', () => {
    expect(recentChannelsOf(null)).toEqual([]);
    for (const none of [undefined, null, {}, 'x', { 0: kept(1), length: 1 }]) expect(recentChannelsOf(doc(none))).toEqual([]);
  });
});
