import { describe, expect, it } from 'vitest';
import { LAB_MEDIA_IDS, parseLabMedia } from './media';

const ITEM = {
  url: 'http://lab:8080/movie/lablo/lablo-test/206.mkv',
  kind: 'vod',
  container: 'mkv',
  fault: null,
  video: { codec: 'h264', width: 640, height: 360, fps: 25 },
  audio: [
    { lang: 'ara', codec: 'aac', channels: 2 },
    { lang: 'eng', codec: 'ac3', channels: 6 },
  ],
  subtitles: [{ lang: 'ara', codec: 'subrip' }],
};

describe("the lab server's media list", () => {
  it('reads every item it knows, keeping what the battery uses', () => {
    const media = parseLabMedia({ media: 'files', items: { 'multi-audio': ITEM, 'redirect-ts': { ...ITEM, kind: 'live', container: 'ts', fault: 'redirect:hops=3', video: null, audio: null, subtitles: null } } });
    expect(media).toEqual({
      media: 'files',
      items: {
        'multi-audio': {
          url: ITEM.url,
          kind: 'vod',
          container: 'mkv',
          fault: null,
          video: { codec: 'h264', width: 640, height: 360 },
          audio: [
            { lang: 'ara', codec: 'aac', channels: 2 },
            { lang: 'eng', codec: 'ac3', channels: 6 },
          ],
          subtitles: [{ lang: 'ara', codec: 'subrip' }],
        },
        'redirect-ts': { url: ITEM.url, kind: 'live', container: 'ts', fault: 'redirect:hops=3', video: null, audio: null, subtitles: null },
      },
    });
  });

  it('leaves out the items that are not one, and unknown ids', () => {
    const bad = [
      null,
      'x',
      { ...ITEM, url: 'file:///etc/passwd' },
      { ...ITEM, url: 42 },
      { ...ITEM, kind: 'radio' },
      { ...ITEM, container: 'avi' },
    ];
    for (const item of bad) expect(parseLabMedia({ media: 'files', items: { 'subs-mkv': item } })?.items).toEqual({});
    expect(parseLabMedia({ media: 'files', items: { 'other-thing': ITEM } })?.items).toEqual({});
    expect(LAB_MEDIA_IDS).toHaveLength(10);
  });

  it('drops a track list with a bad track, and a channel count it lacks reads as 0', () => {
    const media = parseLabMedia({ media: 'files', items: { 'subs-mkv': { ...ITEM, audio: [{ lang: 'eng', codec: 'aac' }], subtitles: [{ lang: 'ara' }], video: { codec: 'h264' } } } });
    expect(media?.items['subs-mkv']).toMatchObject({ audio: [{ lang: 'eng', codec: 'aac', channels: 0 }], subtitles: null, video: null });
    expect(parseLabMedia({ media: 'files', items: { 'subs-mkv': { ...ITEM, audio: 'eng' } } })?.items['subs-mkv']?.audio).toBeNull();
    expect(parseLabMedia({ media: 'files', items: { 'subs-mkv': { ...ITEM, fault: 3 } } })?.items['subs-mkv']?.fault).toBeNull();
  });

  it('is null for an answer that is no media list', () => {
    for (const value of [null, [], 'files', { media: 1, items: {} }, { media: 'files' }, { media: 'files', items: [] }]) expect(parseLabMedia(value)).toBeNull();
  });
});
