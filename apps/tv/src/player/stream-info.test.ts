import type { StreamStats } from '@zoma/player';
import { NO_STATS } from '@zoma/player';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { Timers } from '../live/live-state';
import type { Reading, StreamInfo } from './stream-info';
import { RATE_READINGS, STATS_MS, audioText, bitrateUnits, containerName, createStreamInfo, engineName, pictureSize, streamInfo } from './stream-info';
import { streamInfoRows } from './StreamInfoPanel';

const STATS: StreamStats = { ...NO_STATS, width: 960, height: 540, decodedFrames: 0, decodedBytes: 0, container: 'hls', engine: 'html5', load: 1 };

const reading = (time: number, frames: number | null, bytes: number | null): Reading => ({ time, frames, bytes });

function clock() {
  let now = 0;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    now: () => now,
    pending: () => queue.length,
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

/** A panel over a stream whose counters the test moves: 25 frames and 125,000 bytes (1 Mb/s) a second by default. */
function rig() {
  const c = clock();
  let stats: StreamStats | null = STATS;
  let reads = 0;
  const panel = createStreamInfo({
    stats: () => {
      reads += 1;
      return stats;
    },
    timers: c.timers,
    now: c.now,
  });
  return {
    clock: c,
    panel,
    reads: () => reads,
    set(next: Partial<StreamStats> | null): void {
      stats = next === null ? null : { ...(stats ?? STATS), ...next };
    },
    /** One second of playback at `fps` frames and `bps` bits a second. */
    play(fps = 25, bps = 1_000_000): void {
      const s = stats ?? STATS;
      stats = { ...s, decodedFrames: (s.decodedFrames ?? 0) + fps, decodedBytes: (s.decodedBytes ?? 0) + bps / 8 };
      c.advance(STATS_MS);
    },
  };
}

describe('the stream info: its figures (RELAY step 20c2a)', () => {
  it('measures the frame rate and the bitrate between the first and the last reading', () => {
    const info = streamInfo(STATS, [reading(1000, 100, 200_000), reading(2000, 120, 300_000), reading(5000, 225, 825_000)]);
    expect(info).toEqual({ width: 960, height: 540, fps: 31.25, bitrate: 1_250_000, videoCodec: '', audioCodec: '', audioChannels: null, droppedFrames: null, engine: 'html5' });
  });

  it('has no rate from one reading, from readings at one time, or from a counter the engine lacks', () => {
    expect(streamInfo(STATS, [])).toMatchObject({ fps: null, bitrate: null });
    expect(streamInfo(STATS, [reading(1000, 25, 1000)])).toMatchObject({ fps: null, bitrate: null });
    expect(streamInfo(STATS, [reading(1000, 25, 1000), reading(1000, 50, 2000)])).toMatchObject({ fps: null, bitrate: null });
    expect(streamInfo(STATS, [reading(1000, null, 1000), reading(2000, 25, 2000)])).toMatchObject({ fps: null, bitrate: 8000 });
    expect(streamInfo(STATS, [reading(1000, 25, 1000), reading(2000, 50, null)])).toMatchObject({ fps: 25, bitrate: null });
  });

  it("takes the bitrate the stream declares over a measured one, and the engine's names as they are", () => {
    const avplay: StreamStats = { ...STATS, bitrate: 4_500_000, videoCodec: 'H264', audioCodec: 'AC3', audioChannels: 6, droppedFrames: 3, engine: 'avplay' };
    expect(streamInfo(avplay, [reading(0, 0, 0), reading(1000, 25, 1000)])).toEqual({
      width: 960,
      height: 540,
      fps: 25,
      bitrate: 4_500_000,
      videoCodec: 'H264',
      audioCodec: 'AC3',
      audioChannels: 6,
      droppedFrames: 3,
      engine: 'avplay',
    });
  });

  it('writes the size, the audio, the bitrate and the names for the panel', () => {
    const info: StreamInfo = streamInfo({ ...STATS, audioCodec: 'AAC', audioChannels: 2 }, []);
    expect(pictureSize(info)).toBe('960×540');
    expect(pictureSize({ ...info, height: 0 })).toBe('');
    expect(pictureSize({ ...info, width: 0 })).toBe('');
    expect(audioText(info)).toBe('AAC · 2.0');
    expect([1, 6, 8].map((n) => audioText({ ...info, audioChannels: n }))).toEqual(['AAC · 1.0', 'AAC · 5.1', 'AAC · 7.1']);
    expect(audioText({ ...info, audioChannels: null })).toBe('AAC');
    expect(audioText({ ...info, audioCodec: '', audioChannels: 6 })).toBe('5.1');
    expect(audioText({ ...info, audioCodec: '', audioChannels: null })).toBe('');
    expect([999_499, 999_500, 1_000_000, 4_449_999, 4_450_000].map(bitrateUnits)).toEqual([
      { unit: 'kbps', value: 999 },
      { unit: 'kbps', value: 1000 },
      { unit: 'mbps', value: 1 },
      { unit: 'mbps', value: 4.4 },
      { unit: 'mbps', value: 4.5 },
    ]);
    expect([null, 'ts', 'hls', 'mp4', 'mkv', 'other'].map((c) => containerName(c as never))).toEqual(['', 'MPEG-TS', 'HLS', 'MP4', 'MKV', '']);
    expect(['avplay', 'html5', 'mse'].map((e) => engineName(e as never))).toEqual(['AVPlay', 'HTML5', 'MSE']);
  });
});

describe('the stream info: reading the player (RELAY step 20c2a)', () => {
  it('reads at once when it opens, then every second, and stops when it closes', () => {
    const r = rig();
    expect(r.reads()).toBe(0);
    expect(r.clock.pending()).toBe(0);
    r.panel.toggle();
    expect(r.panel.shown.value).toBe(true);
    expect(r.reads()).toBe(1);
    expect(r.panel.info.value).toMatchObject({ width: 960, fps: null, bitrate: null });
    r.clock.advance(STATS_MS - 1);
    expect(r.reads()).toBe(1);
    r.play();
    expect(r.reads()).toBe(2);
    expect(r.panel.info.value).toMatchObject({ fps: 25, bitrate: 1_000_000 });
    r.panel.toggle();
    expect(r.panel.shown.value).toBe(false);
    expect(r.panel.info.value).toBeNull();
    expect(r.clock.pending()).toBe(0);
    r.clock.advance(10 * STATS_MS);
    expect(r.reads()).toBe(2);
    r.panel.hide();
    expect(r.clock.pending()).toBe(0);
  });

  it('measures over the last readings only', () => {
    const r = rig();
    r.panel.toggle();
    // A slow first second, then steady: once the first reading has gone, the rate is the steady one.
    r.play(5, 200_000);
    for (let i = 1; i < RATE_READINGS - 1; i++) r.play(25, 1_000_000);
    expect(r.panel.info.value!.fps).toBe((5 + 25 * (RATE_READINGS - 2)) / (RATE_READINGS - 1));
    r.play(25, 1_000_000);
    expect(r.panel.info.value).toMatchObject({ fps: 25, bitrate: 1_000_000 });
  });

  it('starts measuring again on a new load, after counters that went back, and after a moment with no picture', () => {
    const r = rig();
    r.panel.toggle();
    r.play(25, 1_000_000);
    r.play(25, 1_000_000);
    // A retry: a new load whose counters start again, read before any time passed in it.
    r.set({ load: 2, decodedFrames: 200, decodedBytes: 0 });
    r.clock.advance(STATS_MS);
    expect(r.panel.info.value).toMatchObject({ fps: null, bitrate: null });
    r.play(50, 2_000_000);
    expect(r.panel.info.value).toMatchObject({ fps: 50, bitrate: 2_000_000 });
    // The engine opened the stream again within the load: its counters went back.
    r.set({ decodedFrames: 10 });
    r.clock.advance(STATS_MS);
    expect(r.panel.info.value!.fps).toBeNull();
    r.play(30, 2_000_000);
    expect(r.panel.info.value!.fps).toBe(30);
    r.set({ decodedBytes: 1000 });
    r.clock.advance(STATS_MS);
    expect(r.panel.info.value!.bitrate).toBeNull();
    // No picture (reconnecting): nothing to show, and the measure starts again after it.
    r.set(null);
    r.clock.advance(STATS_MS);
    expect(r.panel.info.value).toBeNull();
    r.set({ ...STATS, load: 2, decodedFrames: 500, decodedBytes: 500_000 });
    r.clock.advance(STATS_MS);
    expect(r.panel.info.value).toMatchObject({ fps: null, bitrate: null });
    r.play(25, 1_000_000);
    expect(r.panel.info.value).toMatchObject({ fps: 25, bitrate: 1_000_000 });
  });
});

describe('the stream info: its rows (RELAY step 20c2a)', () => {
  const en = appI18n('en-US', { isolate: false });
  const ar = appI18n('ar-SA', { isolate: false });

  it('lists the figures it has, technical names as they are, and the format while the stream opens', () => {
    expect(streamInfoRows(null, 'hls', en)).toEqual([{ id: 'format', label: 'player.info.format', value: 'HLS', technical: true }]);
    expect(streamInfoRows(null, null, en)).toEqual([]);
    const avplay = streamInfo({ ...STATS, bitrate: 4_500_000, videoCodec: 'HEVC', audioCodec: 'E-AC3', audioChannels: 6, droppedFrames: null, engine: 'avplay' }, []);
    expect(streamInfoRows(avplay, 'ts', en).map((r) => [r.id, r.value, r.technical])).toEqual([
      ['resolution', '960×540', true],
      ['bitrate', '4.5 Mb/s', false],
      ['video', 'HEVC', true],
      ['audio', 'E-AC3 · 5.1', true],
      ['format', 'MPEG-TS', true],
      ['engine', 'AVPlay', true],
    ]);
    const html5 = streamInfo({ ...STATS, droppedFrames: 1200 }, [reading(0, 0, 0), reading(2000, 50, 50_000)]);
    expect(streamInfoRows(html5, 'other', en).map((r) => [r.id, r.value])).toEqual([
      ['resolution', '960×540'],
      ['fps', '25 fps'],
      ['bitrate', '200 kb/s'],
      ['engine', 'HTML5'],
      ['dropped', '1,200'],
    ]);
  });

  it('writes the units in Arabic', () => {
    const info = streamInfo({ ...STATS, bitrate: 2_500_000 }, [reading(0, 0, 0), reading(1000, 25, 0)]);
    const rows = streamInfoRows(info, 'hls', ar);
    expect(rows.find((r) => r.id === 'fps')!.value).toBe('25 إطار/ث');
    expect(rows.find((r) => r.id === 'bitrate')!.value).toBe('2.5 ميغابت/ث');
    expect(streamInfoRows({ ...info, bitrate: 640_000 }, 'hls', ar).find((r) => r.id === 'bitrate')!.value).toBe('640 كيلوبت/ث');
  });
});
