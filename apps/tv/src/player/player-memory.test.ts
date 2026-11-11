import type { CatalogItem } from '@lablo/core';
import type { LoadedProfile, ProfileEdit } from '@lablo/data';
import { describe, expect, it, vi } from 'vitest';
import { createPlayerMemory, lastChannelOf } from './player-memory';

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
});
