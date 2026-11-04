import { describe, expect, it } from 'vitest';
import { MemorySourceMemory, containerOf, orderCandidates, streamCandidates } from './request';

const BASE = 'http://panel.example:8080';

describe('containerOf', () => {
  it('reads the container from the path only', () => {
    expect(containerOf(`${BASE}/live/u/p/1.ts`)).toBe('ts');
    expect(containerOf(`${BASE}/live/u/p/1.M3U8`)).toBe('hls');
    expect(containerOf(`${BASE}/movie/u/p/2.mkv?token=a.ts`)).toBe('mkv');
    expect(containerOf(`${BASE}/movie/u/p/2.mp4#t=1.m3u8`)).toBe('mp4');
    expect(containerOf(`${BASE}/movie/u/p/2.m4v`)).toBe('mp4');
    expect(containerOf(`${BASE}/movie/u/p/2.mov`)).toBe('mp4');
    expect(containerOf('http://cdn.example/channel/mpegts?token=x')).toBe('ts');
    expect(containerOf(`${BASE}/u/p/3`)).toBe('other');
    expect(containerOf(`${BASE}/movie/u/p/4.avi`)).toBe('other');
    // A dot in the host or an earlier segment is not an extension.
    expect(containerOf('http://cdn.example.ts/stream')).toBe('other');
  });
});

describe('streamCandidates (the URL strategy)', () => {
  it('tries .ts first, then .m3u8, for an Xtream live URL', () => {
    expect(streamCandidates(`${BASE}/live/u/p/1.ts`, 'live')).toEqual([
      { url: `${BASE}/live/u/p/1.ts`, container: 'ts' },
      { url: `${BASE}/live/u/p/1.m3u8`, container: 'hls' },
    ]);
    // The playlist's URL keeps its own spelling; the other form is built (and encoded) from it.
    expect(streamCandidates(`${BASE}/live/u@x/p/1.m3u8`, 'live')).toEqual([
      { url: `${BASE}/live/u%40x/p/1.ts`, container: 'ts' },
      { url: `${BASE}/live/u@x/p/1.m3u8`, container: 'hls' },
    ]);
    expect(streamCandidates(`${BASE}/live/u@x/p/1.ts`, 'live')).toEqual([
      { url: `${BASE}/live/u@x/p/1.ts`, container: 'ts' },
      { url: `${BASE}/live/u%40x/p/1.m3u8`, container: 'hls' },
    ]);
  });

  it('plays the short live form as MPEG-TS and adds the /live/ .m3u8 form', () => {
    expect(streamCandidates(`${BASE}/u/p/77`, 'live')).toEqual([
      { url: `${BASE}/u/p/77`, container: 'ts' },
      { url: `${BASE}/live/u/p/77.m3u8`, container: 'hls' },
    ]);
  });

  it("keeps only what the account's allowed_output_formats allow", () => {
    const url = `${BASE}/live/u/p/1.ts`;
    expect(streamCandidates(url, 'live', ['m3u8'])).toEqual([{ url: `${BASE}/live/u/p/1.m3u8`, container: 'hls' }]);
    expect(streamCandidates(url, 'live', ['ts', 'rtmp'])).toEqual([{ url, container: 'ts' }]);
    expect(streamCandidates(url, 'live', ['m3u8', 'ts'])).toHaveLength(2);
    // A list naming neither (or none at all) rules nothing out.
    expect(streamCandidates(url, 'live', ['rtmp'])).toHaveLength(2);
    expect(streamCandidates(url, 'live', [])).toHaveLength(2);
    expect(streamCandidates(url, 'live', null)).toHaveLength(2);
  });

  it('plays anything else as it is', () => {
    const movie = `${BASE}/movie/u/p/5.mp4`;
    expect(streamCandidates(movie, 'vod')).toEqual([{ url: movie, container: 'mp4' }]);
    // Not live mode, even for a live-shaped URL (catch-up).
    expect(streamCandidates(`${BASE}/live/u/p/1.ts`, 'catchup')).toEqual([{ url: `${BASE}/live/u/p/1.ts`, container: 'ts' }]);
    // A live URL that isn't Xtream-shaped, or has another extension.
    expect(streamCandidates('http://cdn.example/channel/index.m3u8', 'live')).toEqual([{ url: 'http://cdn.example/channel/index.m3u8', container: 'hls' }]);
    expect(streamCandidates(`${BASE}/live/u/p/1.mp4`, 'live')).toEqual([{ url: `${BASE}/live/u/p/1.mp4`, container: 'mp4' }]);
    expect(streamCandidates(`${BASE}/movie/u/p/5.ts`, 'live')).toEqual([{ url: `${BASE}/movie/u/p/5.ts`, container: 'ts' }]);
  });
});

describe('orderCandidates and the per-source memory', () => {
  const ts = { url: 'a.ts', container: 'ts' as const };
  const hls = { url: 'a.m3u8', container: 'hls' as const };

  it('puts the remembered container first and keeps the rest in order', () => {
    expect(orderCandidates([ts, hls], 'hls')).toEqual([hls, ts]);
    expect(orderCandidates([ts, hls], 'ts')).toEqual([ts, hls]);
    expect(orderCandidates([ts, hls], 'mp4')).toEqual([ts, hls]);
    const list = [ts, hls];
    const same = orderCandidates(list, null);
    expect(same).toEqual(list);
    expect(same).not.toBe(list);
  });

  it('remembers per source', () => {
    const memory = new MemorySourceMemory();
    expect(memory.preferred('s1')).toBeNull();
    memory.remember('s1', 'hls');
    memory.remember('s2', 'ts');
    expect(memory.preferred('s1')).toBe('hls');
    expect(memory.preferred('s2')).toBe('ts');
    // Not fooled by inherited names.
    expect(memory.preferred('constructor')).toBeNull();
  });
});
