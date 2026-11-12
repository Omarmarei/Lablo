import { effect } from '@preact/signals';
import type { LoadedProfile, ProfileEdit } from '@lablo/data';
import { describe, expect, it, vi } from 'vitest';
import { MIN_RESUME_MS, SAVE_EVERY_MS, WATCHED_SHARE, WATCHED_TAIL_MS, createMovieProgress, isWatched, keptPoint } from './movie-progress';

const MIN = 60_000;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** A loaded profile whose `progress` is `progress` (any version: the reader takes what it can). */
function profile(progress: unknown, v = 5): LoadedProfile {
  return { doc: { v, progress }, newer: false, migratedFrom: null };
}

function setup(answer: () => Promise<boolean> = () => Promise.resolve(true)) {
  const edits: ProfileEdit[] = [];
  let clock = 1_000;
  const progress = createMovieProgress({
    edit: (edit) => {
      edits.push(edit);
      return answer();
    },
    now: () => clock,
  });
  return { progress, edits, tick: (ms: number) => (clock += ms) };
}

describe('the watched rule (RELAY step 26d)', () => {
  it('is the last two minutes, or past 95 %, of a known length', () => {
    expect(SAVE_EVERY_MS).toBe(10_000);
    expect(WATCHED_TAIL_MS).toBe(2 * MIN);
    expect(WATCHED_SHARE).toBe(0.95);
    expect(MIN_RESUME_MS).toBe(10_000);
    // Whichever comes first. A 90-minute film: 95 % is 85:30, before its last two minutes (88:00).
    expect(isWatched(85.5 * MIN - 1, 90 * MIN)).toBe(false);
    expect(isWatched(85.5 * MIN, 90 * MIN)).toBe(true);
    expect(isWatched(90 * MIN, 90 * MIN)).toBe(true);
    // A 10-minute short: its last two minutes (8:00) before 95 % (9:30).
    expect(isWatched(8 * MIN - 1, 10 * MIN)).toBe(false);
    expect(isWatched(8 * MIN, 10 * MIN)).toBe(true);
    // 40 minutes: both at 38:00.
    expect(isWatched(38 * MIN - 1, 40 * MIN)).toBe(false);
    expect(isWatched(38 * MIN, 40 * MIN)).toBe(true);
    // Shorter than two minutes: watched anywhere.
    expect(isWatched(0, 90_000)).toBe(true);
    // No length: never by the rule.
    expect(isWatched(10 * 60 * MIN, null)).toBe(false);
  });

  it('keeps a point only past the first seconds and before the end, rounded to the millisecond', () => {
    expect(keptPoint(754_000.4, 888_000.6, false)).toEqual({ positionMs: 754_000, lengthMs: 888_001 });
    expect(keptPoint(MIN_RESUME_MS, null, false)).toEqual({ positionMs: MIN_RESUME_MS, lengthMs: null });
    expect(keptPoint(MIN_RESUME_MS - 1, null, false)).toBeNull();
    expect(keptPoint(0, 90 * MIN, false)).toBeNull();
    // Watched, or ended (even with no length known).
    expect(keptPoint(88 * MIN, 90 * MIN, false)).toBeNull();
    expect(keptPoint(30 * MIN, 90 * MIN, true)).toBeNull();
    expect(keptPoint(30 * MIN, null, true)).toBeNull();
    // A length that isn't one is no length.
    for (const length of [0, -5, NaN, Infinity]) expect(keptPoint(30 * MIN, length, false)).toEqual({ positionMs: 30 * MIN, lengthMs: null });
    // A position that isn't one keeps nothing.
    for (const position of [NaN, Infinity, -1]) {
      expect(keptPoint(position, 90 * MIN, false)).toBeNull();
      expect(keptPoint(position, null, false)).toBeNull();
    }
  });
});

describe('movie progress (RELAY step 26d)', () => {
  it('reads the start profile, keeping only what is a position', () => {
    const { progress } = setup();
    expect(progress.point('x:s1:movie:201')).toBeNull();
    progress.load(
      profile({
        'x:s1:movie:201': { positionMs: 300_000, lengthMs: 596_000, updated: 5 },
        'x:s1:movie:202': { positionMs: 60_000, lengthMs: null, updated: 6 },
        'x:s1:movie:203': { positionMs: -1, lengthMs: 600_000, updated: 7 },
        'x:s1:movie:204': { positionMs: 60_000, lengthMs: 0, updated: 7 },
        'x:s1:movie:205': { positionMs: '60', lengthMs: null, updated: 7 },
        'x:s1:movie:206': { positionMs: 60_000, lengthMs: '600000', updated: 7 },
        'x:s1:movie:207': { positionMs: Infinity, lengthMs: null, updated: 7 },
        'x:s1:movie:208': { positionMs: 60_000, lengthMs: Infinity, updated: 7 },
        'x:s1:movie:209': null,
        'x:s1:movie:210': { lengthMs: null },
        'x:s1:movie:211': undefined,
        // A place this app never saves, but one that is a place: its start, and past its length.
        'x:s1:movie:212': { positionMs: 0, lengthMs: 600_000, updated: 7 },
        'x:s1:movie:213': { positionMs: 700_000, lengthMs: 600_000, updated: 7 },
      }),
    );
    expect(progress.point('x:s1:movie:211')).toBeNull();
    expect(progress.point('x:s1:movie:212')).toEqual({ positionMs: 0, lengthMs: 600_000 });
    expect(progress.share('x:s1:movie:212')).toBe(0);
    expect(progress.share('x:s1:movie:213')).toBe(1);
    expect(progress.point('x:s1:movie:201')).toEqual({ positionMs: 300_000, lengthMs: 596_000 });
    expect(progress.point('x:s1:movie:202')).toEqual({ positionMs: 60_000, lengthMs: null });
    for (let id = 203; id <= 210; id += 1) expect(progress.point(`x:s1:movie:${id}`)).toBeNull();
    // A tile's share: with a length only.
    expect(progress.share('x:s1:movie:201')).toBeCloseTo(300 / 596, 10);
    expect(progress.share('x:s1:movie:202')).toBeUndefined();
    expect(progress.share('x:s1:movie:203')).toBeUndefined();
    // Inherited names are no positions; a later load replaces what was read.
    expect(progress.point('toString')).toBeNull();
    progress.load(profile({ 'x:s1:movie:202': { positionMs: 70_000, lengthMs: 600_000, updated: 1 } }));
    expect(progress.point('x:s1:movie:201')).toBeNull();
    expect(progress.share('x:s1:movie:202')).toBeCloseTo(70 / 600, 10);
    // No profile, an older one, or no positions in it: nothing.
    for (const none of [null, profile(undefined, 4), profile('x'), profile(null)]) {
      progress.load(none);
      expect(progress.point('x:s1:movie:202')).toBeNull();
    }
  });

  it('saves a movie left part way, moves it, and takes it away once watched; the same place writes nothing', async () => {
    const t = setup();
    const key = 'x:s1:movie:201';
    t.progress.save(key, 300_000.6, 596_000, false);
    expect(t.progress.point(key)).toEqual({ positionMs: 300_001, lengthMs: 596_000 });
    expect(t.edits).toEqual([{ kind: 'progress', key, progress: { positionMs: 300_001, lengthMs: 596_000, updated: 1_000 } }]);
    // The same place again (the player saves on Back after a save at the interval): nothing.
    t.tick(5_000);
    t.progress.save(key, 300_001, 596_000, false);
    expect(t.edits).toHaveLength(1);
    // Further on, and the length the engine learnt: written, with the time of the save.
    t.progress.save(key, 310_000, 596_458, false);
    expect(t.edits[1]).toEqual({ kind: 'progress', key, progress: { positionMs: 310_000, lengthMs: 596_458, updated: 6_000 } });
    // A play that doesn't know the length (resumed before the details' read came back) keeps the
    // one known: the same place writes nothing, a new one keeps the length.
    t.progress.save(key, 310_000, null, false);
    expect(t.edits).toHaveLength(2);
    t.progress.save(key, 320_000, null, false);
    expect(t.edits[2]).toEqual({ kind: 'progress', key, progress: { positionMs: 320_000, lengthMs: 596_458, updated: 6_000 } });
    expect(t.progress.share(key)).toBeCloseTo(320_000 / 596_458, 10);
    // The same place with another length: written.
    t.progress.save(key, 320_000, 600_000, false);
    expect(t.edits[3]).toEqual({ kind: 'progress', key, progress: { positionMs: 320_000, lengthMs: 600_000, updated: 6_000 } });
    // Watched (the end, the last two minutes, or past 95 %): taken away once; by the known length too.
    t.progress.save(key, 590_000, null, false);
    expect(t.progress.point(key)).toBeNull();
    expect(t.edits[4]).toEqual({ kind: 'progress', key, progress: null });
    t.progress.save(key, 596_000, 596_000, true);
    expect(t.edits).toHaveLength(5);
    // Started over and left at once: taken away; never kept: nothing written.
    t.progress.save(key, 200_000, 596_000, false);
    t.progress.save(key, 4_000, 596_000, false);
    expect(t.edits[6]).toEqual({ kind: 'progress', key, progress: null });
    t.progress.save('x:s1:movie:999', 0, null, false);
    t.progress.save('x:s1:movie:999', 30 * MIN, 31 * MIN, true);
    expect(t.edits).toHaveLength(7);
    // A length never known stays unknown.
    t.progress.save('x:s1:movie:998', 30 * MIN, null, false);
    expect(t.edits[7]).toEqual({ kind: 'progress', key: 'x:s1:movie:998', progress: { positionMs: 30 * MIN, lengthMs: null, updated: 6_000 } });
    await flush();
  });

  it('bumps its version on a load and on every change, so the tiles draw again', () => {
    const t = setup();
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(t.progress.version.value);
    });
    t.progress.load(null);
    t.progress.save('k', 60_000, 600_000, false);
    t.progress.save('k', 60_000, 600_000, false);
    t.progress.save('k', 70_000, 600_000, false);
    t.progress.save('k', 0, 600_000, true);
    t.progress.save('k', 0, 600_000, true);
    stop();
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it("reads each show's last episode from the start profile, keeping only what is one (RELAY step 27c1)", () => {
    const { progress } = setup();
    const show = (id: number): string => `x:s1:series:${id}`;
    expect(progress.lastEpisode(show(301))).toBeNull();
    progress.load({
      doc: {
        v: 6,
        progress: {},
        shows: {
          [show(301)]: { episode: 'x:s1:episode:3002', watched: false, updated: 5 },
          [show(302)]: { episode: 'x:s1:episode:3021', watched: true, updated: 6 },
          [show(303)]: { episode: '', watched: false, updated: 7 },
          [show(304)]: { episode: 3031, watched: false, updated: 7 },
          [show(305)]: { episode: 'x:s1:episode:3041', watched: 'yes', updated: 7 },
          [show(306)]: { episode: 'x:s1:episode:3051', updated: 7 },
          [show(307)]: null,
          [show(308)]: 'x:s1:episode:3071',
        },
      },
      newer: false,
      migratedFrom: null,
    });
    expect(progress.lastEpisode(show(301))).toEqual({ episode: 'x:s1:episode:3002', watched: false });
    expect(progress.lastEpisode(show(302))).toEqual({ episode: 'x:s1:episode:3021', watched: true });
    for (let id = 303; id <= 308; id += 1) expect(progress.lastEpisode(show(id))).toBeNull();
    expect(progress.lastEpisode('toString')).toBeNull();
    // A later load replaces what was read; a version 5 profile has none.
    progress.load({ doc: { v: 6, progress: {}, shows: { [show(302)]: { episode: 'x:s1:episode:3022', watched: false, updated: 8 } } }, newer: false, migratedFrom: null });
    expect(progress.lastEpisode(show(301))).toBeNull();
    expect(progress.lastEpisode(show(302))).toEqual({ episode: 'x:s1:episode:3022', watched: false });
    for (const none of [null, profile({}, 5), { doc: { v: 6, progress: {}, shows: 'x' }, newer: false, migratedFrom: null }]) {
      progress.load(none);
      expect(progress.lastEpisode(show(302))).toBeNull();
    }
  });

  it("saves an episode's place and its show's last episode in one write (RELAY step 27c1)", async () => {
    const t = setup();
    const show = 'x:s1:series:301';
    const e1 = 'x:s1:episode:3001';
    const e2 = 'x:s1:episode:3002';
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(t.progress.version.value);
    });
    // Played and left at once: no place, but the show's last episode.
    t.progress.save(e1, 4_000, 300_000, false, show);
    expect(t.progress.point(e1)).toBeNull();
    expect(t.progress.lastEpisode(show)).toEqual({ episode: e1, watched: false });
    expect(t.edits).toEqual([{ kind: 'episode', show, last: { episode: e1, watched: false, updated: 1_000 }, progress: null }]);
    // The same again: nothing.
    t.progress.save(e1, 0, 300_000, false, show);
    expect(t.edits).toHaveLength(1);
    // Left part way: its place, with the show's last episode.
    t.tick(1_000);
    t.progress.save(e1, 40_000, 300_000, false, show);
    expect(t.progress.point(e1)).toEqual({ positionMs: 40_000, lengthMs: 300_000 });
    expect(t.edits[1]).toEqual({ kind: 'episode', show, last: { episode: e1, watched: false, updated: 2_000 }, progress: { positionMs: 40_000, lengthMs: 300_000, updated: 2_000 } });
    t.progress.save(e1, 40_000, 300_000, false, show);
    expect(t.edits).toHaveLength(2);
    // Further on: written (the show's entry is the same).
    t.progress.save(e1, 50_000, null, false, show);
    expect(t.edits[2]).toEqual({ kind: 'episode', show, last: { episode: e1, watched: false, updated: 2_000 }, progress: { positionMs: 50_000, lengthMs: 300_000, updated: 2_000 } });
    // Past the watched point by the length kept with its place (none given): watched, its place taken away.
    t.progress.save(e1, 290_000, null, false, show);
    expect(t.progress.point(e1)).toBeNull();
    expect(t.progress.lastEpisode(show)).toEqual({ episode: e1, watched: true });
    expect(t.edits[3]).toEqual({ kind: 'episode', show, last: { episode: e1, watched: true, updated: 2_000 }, progress: null });
    // It ends: the same, nothing written.
    t.progress.save(e1, 300_000, 300_000, true, show);
    expect(t.edits).toHaveLength(4);
    // The next one: the show's last episode moves, not watched yet.
    t.progress.save(e2, 0, 300_000, false, show);
    expect(t.progress.lastEpisode(show)).toEqual({ episode: e2, watched: false });
    expect(t.edits[4]).toMatchObject({ kind: 'episode', show, last: { episode: e2, watched: false }, progress: null });
    // Ended with no length known: watched.
    t.progress.save(e2, 10_000, null, true, show);
    expect(t.progress.lastEpisode(show)).toEqual({ episode: e2, watched: true });
    // A place that isn't one is never watched, and keeps nothing.
    t.progress.save('x:s1:episode:3011', Infinity, 240_000, false, 'x:s1:series:302');
    expect(t.progress.lastEpisode('x:s1:series:302')).toEqual({ episode: 'x:s1:episode:3011', watched: false });
    expect(t.progress.point('x:s1:episode:3011')).toBeNull();
    // Another episode of a show left at once after one left at once: the show's last moves.
    t.progress.save('x:s1:episode:3021', 0, 180_000, false, 'x:s1:series:303');
    t.progress.save('x:s1:episode:3022', 0, 180_000, false, 'x:s1:series:303');
    expect(t.progress.lastEpisode('x:s1:series:303')).toEqual({ episode: 'x:s1:episode:3022', watched: false });
    // A movie is no show's.
    t.progress.save('x:s1:movie:201', 60_000, 600_000, false);
    expect(t.edits[t.edits.length - 1]).toEqual({ kind: 'progress', key: 'x:s1:movie:201', progress: { positionMs: 60_000, lengthMs: 600_000, updated: 2_000 } });
    expect(t.progress.lastEpisode('x:s1:movie:201')).toBeNull();
    stop();
    // Every write bumped the version once.
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await flush();
  });

  it('keeps a position for the run when the write fails, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup(() => Promise.reject(new Error('quota')));
    t.progress.save('k', 60_000, 600_000, false);
    await flush();
    expect(t.progress.point('k')).toEqual({ positionMs: 60_000, lengthMs: 600_000 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
