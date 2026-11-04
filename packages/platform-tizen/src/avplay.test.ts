import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AvplayManager, AvplayStore } from './avplay';
import { avplayErrorText, avplayExtraInfo, avplayTracks, avplayUnsupported, tizenAvplay, tizenAvplayStore } from './avplay';

afterEach(() => {
  vi.unstubAllGlobals();
});

const manager = (): AvplayManager => ({ open: () => undefined }) as unknown as AvplayManager;

describe('finding AVPlay (RELAY step 15c2)', () => {
  it('gives webapis.avplay and webapis.avplaystore where they exist', () => {
    const avplay = manager();
    const avplaystore: AvplayStore = { getPlayer: manager };
    expect(tizenAvplay({ avplay })).toBe(avplay);
    expect(tizenAvplayStore({ avplaystore })).toBe(avplaystore);
  });

  it('gives null without webapis, without the object, or with something that is not one', () => {
    expect(tizenAvplay(undefined)).toBeNull();
    expect(tizenAvplay({})).toBeNull();
    expect(tizenAvplay({ avplay: null as unknown as AvplayManager })).toBeNull();
    expect(tizenAvplay({ avplay: { open: 'no' } as unknown as AvplayManager })).toBeNull();
    expect(tizenAvplayStore(undefined)).toBeNull();
    expect(tizenAvplayStore({ avplaystore: null as unknown as AvplayStore })).toBeNull();
    expect(tizenAvplayStore({ avplaystore: {} as AvplayStore })).toBeNull();
  });

  it("reads the page's webapis by default", () => {
    // No window at all (Node): nothing.
    expect(tizenAvplay()).toBeNull();
    const avplay = manager();
    const avplaystore: AvplayStore = { getPlayer: manager };
    vi.stubGlobal('window', { webapis: { avplay, avplaystore } });
    expect(tizenAvplay()).toBe(avplay);
    expect(tizenAvplayStore()).toBe(avplaystore);
    vi.stubGlobal('window', {});
    expect(tizenAvplay()).toBeNull();
    expect(tizenAvplayStore()).toBeNull();
  });
});

describe("AVPlay's answers", () => {
  it('describes an error by whatever it has', () => {
    expect(avplayErrorText({ name: 'InvalidStateError', code: 11, message: 'not prepared' })).toBe('InvalidStateError, code 11, not prepared');
    expect(avplayErrorText({ name: 'PLAYER_ERROR_CONNECTION_FAILED', message: 'PLAYER_ERROR_CONNECTION_FAILED' })).toBe('PLAYER_ERROR_CONNECTION_FAILED');
    expect(avplayErrorText({ message: 'boom' })).toBe('boom');
    expect(avplayErrorText({ name: '', message: '' })).toBe('no details');
    expect(avplayErrorText('PLAYER_ERROR_INVALID_URI')).toBe('PLAYER_ERROR_INVALID_URI');
    expect(avplayErrorText('')).toBe('no details');
    expect(avplayErrorText(null)).toBe('null');
    expect(avplayErrorText(42)).toBe('42');
  });

  it('knows the errors that mean the TV cannot play the file', () => {
    expect(['PLAYER_ERROR_NOT_SUPPORTED_FILE', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', 'PLAYER_ERROR_NOT_SUPPORTED_AUDIO_CODEC', 'PLAYER_ERROR_NOT_SUPPORTED_VIDEO_CODEC'].map(avplayUnsupported)).toEqual([true, true, true, true]);
    expect(['PLAYER_ERROR_CONNECTION_FAILED', 'PLAYER_ERROR_INVALID_URI', 'PLAYER_ERROR_GENEREIC', ''].map(avplayUnsupported)).toEqual([false, false, false, false]);
  });

  it("reads extra_info's fields as text", () => {
    expect(avplayExtraInfo('{"fourCC":"H264","Width":"1920","Height":1080,"interlaced":false}')).toEqual({ fourCC: 'H264', Width: '1920', Height: '1080', interlaced: 'false' });
    // Nested values are dropped; what isn't a JSON object gives nothing.
    expect(avplayExtraInfo('{"a":{"b":1},"c":null,"d":"x"}')).toEqual({ d: 'x' });
    expect(avplayExtraInfo('[1,2]')).toEqual({});
    expect(avplayExtraInfo('null')).toEqual({});
    expect(avplayExtraInfo('not json')).toEqual({});
    expect(avplayExtraInfo(undefined)).toEqual({});
  });

  it('reads the streams of getTotalTrackInfo', () => {
    const tracks = avplayTracks([
      { index: 0, type: 'VIDEO', extra_info: '{"fourCC":"HEVC","Width":"3840","Height":"2160","Bit_rate":"8000000"}' },
      { index: 1, type: 'AUDIO', extra_info: '{"language":"ara","channels":"2","sample_rate":"48000","bit_rate":"128000","fourCC":"AAC"}' },
      { index: '2', type: 'AUDIO', extra_info: '{"language":"eng","channels":"6","fourCC":"AC3"}' },
      { index: 3, type: 'TEXT', extra_info: '{"track_num":"0","track_lang":"eng","subtitle_type":"0","fourCC":"SRT"}' },
      { index: 4, type: 'AUDIO', extra_info: 'garbage' },
    ]);
    expect(tracks.map((t) => [t.index, t.type, t.lang, t.codec, t.channels, t.width, t.height])).toEqual([
      [0, 'VIDEO', '', 'HEVC', null, 3840, 2160],
      [1, 'AUDIO', 'ara', 'AAC', 2, null, null],
      [2, 'AUDIO', 'eng', 'AC3', 6, null, null],
      [3, 'TEXT', 'eng', 'SRT', null, null, null],
      [4, 'AUDIO', '', '', null, null, null],
    ]);
    expect(tracks[1]?.extra).toEqual({ language: 'ara', channels: '2', sample_rate: '48000', bit_rate: '128000', fourCC: 'AAC' });
  });

  it('leaves out what is not a stream, and takes any list', () => {
    expect(avplayTracks([null, 7, { type: 'AUDIO' }, { index: 'x', type: 'AUDIO' }, { index: 2 }, { index: 1, type: 'TEXT', extra_info: '{}' }]).map((t) => [t.index, t.type])).toEqual([[1, 'TEXT']]);
    expect(avplayTracks({ length: 1, 0: { index: 0, type: 'VIDEO', extra_info: '{"Width":"x1"}' } })).toMatchObject([{ index: 0, width: null }]);
    expect(avplayTracks(null)).toEqual([]);
    expect(avplayTracks('VIDEO')).toEqual([]);
    expect(avplayTracks({})).toEqual([]);
  });
});
