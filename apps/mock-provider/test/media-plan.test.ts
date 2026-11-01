import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/config';
import { FixtureError, loadCatalog, parseCatalog } from '../src/config';
import type { FileAsset, LiveAsset } from '../src/media-plan';
import {
  assetHash,
  asciiLabel,
  fileClipArgs,
  fileMuxArgs,
  filterPath,
  labelTexts,
  liveArgs,
  planMedia,
  srtText,
} from '../src/media-plan';

const catalog = loadCatalog();
const plan = planMedia(catalog);
const live = (key: string): LiveAsset => plan.find((a): a is LiveAsset => a.kind === 'live' && a.key === key)!;
const file = (key: string): FileAsset => plan.find((a): a is FileAsset => a.kind === 'file' && a.key === key)!;
const after = (args: string[], flag: string): string[] => args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []));

describe('media plan for the shipped catalog', () => {
  it('has a loop per channel, a file per movie and episode, plus the generic fallbacks', () => {
    const keys = plan.map((a) => a.key);
    expect(keys.filter((k) => /^\d+$/.test(k) && plan.find((a) => a.key === k)!.kind === 'live')).toHaveLength(catalog.live.length);
    expect(keys).toEqual(expect.arrayContaining(['generic', 'generic:mp4', 'generic:mkv', 'movie:201', 'movie:206', 'episode:3001', 'episode:3022']));
    expect(plan.filter((a) => a.kind === 'file')).toHaveLength(2 + 6 + 7);
  });

  it('maps profiles to streams: bilingual live audio, radio without video, 4K HEVC, multi-audio with 5.1', () => {
    expect(live('104').audio.map((a) => a.lang)).toEqual(['ara', 'eng']);
    expect(live('108').video).toBeNull();
    expect(live('108').audio[0]!.codec).toBe('mp3');
    expect(live('106').video).toMatchObject({ width: 1280, height: 720, fps: 50 });
    expect(file('movie:205').video).toMatchObject({ codec: 'hevc', width: 3840, height: 2160 });
    const multi = file('movie:206');
    expect(multi.audio.map((a) => `${a.lang}:${a.codec}:${a.channels}`)).toEqual(['ara:aac:2', 'eng:aac:2', 'spa:aac:2', 'eng:ac3:6', 'eng:eac3:6']);
    expect(multi.subtitles.map((s) => s.lang)).toEqual(['ara', 'eng']);
    expect(file('movie:201').openMovie).toBe('big-buck-bunny');
    expect(file('movie:201').clipSecs).toBeLessThan(file('movie:201').durationSecs);
    expect(file('episode:3001').clipSecs).toBe(300); // encoded in full: the burned-in time is real
  });

  it('builds live args: one lavfi input per track, 6 s HLS segments, audio cut short of the lap', () => {
    const args = liveArgs(live('104'), 'C:/Fonts/a.ttf');
    expect(after(args, '-i')).toHaveLength(3);
    expect(after(args, '-hls_time')).toEqual(['6']);
    expect(after(args, '-t')).toEqual(['59.9', '59.9', '60']);
    expect(args.at(-1)).toBe('index.m3u8');
    expect(args.join(' ')).toContain("fontfile='C\\:/Fonts/a.ttf'");
    expect(after(args, '-metadata:s:a:0')).toContain('language=ara');
    // Radio: no video, so the audio fills the whole loop.
    expect(after(liveArgs(live('108'), null), '-t')).toEqual(['60']);
    expect(liveArgs(live('108'), null)).toContain('libmp3lame');
  });

  it('builds file args: subtitles as SRT in MKV and mov_text in MP4, hvc1 for HEVC in MP4, looping when short', () => {
    const mkv = fileMuxArgs(file('episode:3001'), 'out.mkv');
    expect(after(mkv, '-c:s')).toEqual(['srt']);
    expect(mkv).not.toContain('-stream_loop');
    expect(after(fileMuxArgs(file('episode:3011'), 'out.mp4'), '-c:s')).toEqual(['mov_text']);
    const hevc = fileMuxArgs(file('movie:205'), 'out.mp4');
    expect(after(hevc, '-tag:v')).toEqual(['hvc1']);
    expect(after(hevc, '-stream_loop')).toEqual(['-1']);
    expect(after(hevc, '-t')).toEqual(['60']);
    expect(fileClipArgs(file('movie:205'), null)).toContain('libx265');
    expect(fileClipArgs(file('movie:205'), null)).not.toContain('-filter_complex'); // no font: no text
  });

  it('hashes assets stably and changes the hash with the content or the font', () => {
    const a = live('101');
    expect(assetHash(a, null)).toBe(assetHash({ ...a }, null));
    expect(assetHash(a, null)).not.toBe(assetHash({ ...a, label: ['other'] }, null));
    expect(assetHash(a, null)).not.toBe(assetHash(a, '/fonts/x.ttf'));
    expect(new Set(plan.map((p) => assetHash(p, null))).size).toBe(plan.length);
  });

  it('writes labels and a clock line, ASCII only', () => {
    expect(labelTexts(live('103'))).toEqual(['CH 3  #103  clock', 'Channel 3 (non-Latin name)', 'sec %{pts:gmtime:0:%S}.%{eif:mod(n,25):d:2}']);
    expect(labelTexts(live('108'))).toEqual([]);
    expect(asciiLabel('Zoma Test', 'x')).toBe('Zoma Test');
    expect(asciiLabel('زوما', 'x')).toBe('x');
    expect(filterPath("C:\\a b\\it's.ttf")).toBe("'C\\:/a b/it\\'s.ttf'");
  });

  it('writes a subtitle cue every 5 s in both languages', () => {
    const eng = srtText('eng', 12);
    expect(eng.split('\n\n')).toHaveLength(3);
    expect(eng).toContain('1\n00:00:00,000 --> 00:00:04,000\nEnglish subtitle 00:00');
    expect(eng).toContain('3\n00:00:10,000 --> 00:00:12,000\nEnglish subtitle 00:10');
    expect(srtText('ara', 65)).toContain('ترجمة عربية ٠١:٠٠');
  });

  it('uses only the generic assets for scale catalogs', () => {
    const big: Catalog = { ...catalog, live: Array.from({ length: 300 }, (_, i) => ({ ...catalog.live[0]!, id: 10_000 + i })) };
    const keys = planMedia(big).map((a) => a.key);
    expect(keys).not.toContain('10000');
    expect(keys).toContain('generic');
    expect(keys).toContain('movie:206');
  });
});

describe('catalog media hints', () => {
  const base = { live_categories: [{ id: 1, name: 'A' }], vod_categories: [{ id: 2, name: 'B' }], series_categories: [], series: [] };
  it('defaults to clock/radio/vod and rejects unknown profiles', () => {
    const c = parseCatalog({
      ...base,
      live: [{ id: 1, name: 'a', category: 1 }, { id: 2, name: 'r', category: 1, radio: true }],
      movies: [{ id: 3, name: 'm', category: 2, year: 2026, duration_secs: 10 }],
    });
    expect(c.live.map((l) => l.media)).toEqual(['clock', 'radio']);
    expect(c.movies[0]!.media).toBe('vod');
    expect(() => parseCatalog({ ...base, live: [{ id: 1, name: 'a', category: 1, media: 'cinema' }], movies: [] })).toThrow(FixtureError);
    expect(() =>
      parseCatalog({ ...base, live: [], movies: [{ id: 3, name: 'm', category: 2, year: 2026, duration_secs: 10, media: 'open-movie:nope' }] }),
    ).toThrow(/one of/);
  });
});
