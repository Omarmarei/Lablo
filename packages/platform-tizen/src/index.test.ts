import { describe, expect, it } from 'vitest';
import type { TizenKey } from './index';
import { FakeAvplay, FakeClock, settle } from './fake-avplay';
import { TIZEN_IME_CANCEL, TIZEN_IME_DONE, buildTizenKeyMap, createTizenEngines, createTizenPlatform, registerTizenKeys, tizenChromiumVersion, tizenKeysToRegister, tizenModelYear, tizenTextKey } from './index';

describe('Tizen key registration', () => {
  it('registers every non-mandatory key when the supported-key list is unavailable', () => {
    const names = tizenKeysToRegister(null);
    expect(names).toEqual(expect.arrayContaining(['ChannelUp', 'ChannelDown', 'ColorF0Red', '0', '9', 'PreviousChannel', 'MTS', 'Caption']));
    // Arrows, Enter and Back always reach the app and cannot be registered.
    expect(names).not.toContain('ArrowUp');
    expect(names).not.toContain('Enter');
    expect(names).not.toContain('Back');
  });

  it('registers only keys the TV supports', () => {
    const supported = [
      { name: 'ChannelUp', code: 427 },
      { name: 'ColorF0Red', code: 403 },
      { name: 'Exit', code: 10182 },
    ];
    expect(tizenKeysToRegister(supported)).toEqual(['ChannelUp', 'ColorF0Red']);
  });
});

describe('registerTizenKeys (what spike S10 records)', () => {
  /** A fake `tizen.tvinputdevice`: the keys it lists, the ones it refuses, the calls it got. */
  function device(supported: TizenKey[] | Error, refuse: Record<string, unknown> = {}) {
    const calls: string[] = [];
    return {
      calls,
      input: {
        getSupportedKeys: (): TizenKey[] => {
          if (supported instanceof Error) throw supported;
          return supported;
        },
        registerKey: (name: string): void => {
          calls.push(name);
          if (name in refuse) throw refuse[name];
        },
      },
    };
  }

  it('registers each supported key, one call each, and names ours the TV lacks', () => {
    // A TV's key objects may keep their fields on a prototype (host objects): the report copies them out.
    const hostKey = (name: string, code: number): TizenKey => Object.create({ name, code }) as TizenKey;
    const { input, calls } = device([hostKey('ChannelUp', 427), hostKey('ColorF0Red', 403), hostKey('Exit', 10182)]);
    const report = registerTizenKeys(input);
    expect(calls).toEqual(['ChannelUp', 'ColorF0Red']);
    expect(report).toMatchObject({ skipped: null, registered: ['ChannelUp', 'ColorF0Red'], refused: [] });
    expect(report.supported).toEqual([
      { name: 'ChannelUp', code: 427 },
      { name: 'ColorF0Red', code: 403 },
      { name: 'Exit', code: 10182 },
    ]);
    expect(report.unsupported).toEqual(tizenKeysToRegister(null).filter((n) => n !== 'ChannelUp' && n !== 'ColorF0Red'));
    expect(report.unsupported).toContain('PreviousChannel');
  });

  it('keeps going past a refused key, with the reason of a WebAPIException or an Error', () => {
    const { input, calls } = device([], {});
    // No supported list: every key is tried, and none is called unsupported.
    const unknown = device(new Error('SecurityError'), { Guide: { name: 'NotSupportedError', message: 'no Guide' }, Info: new Error('busy'), '0': 'plain' });
    const report = registerTizenKeys(unknown.input);
    expect(unknown.calls).toEqual(tizenKeysToRegister(null));
    expect(report.supported).toBeNull();
    expect(report.unsupported).toEqual([]);
    expect(report.refused).toEqual([
      { name: '0', error: 'plain' },
      { name: 'Info', error: 'Error: busy' },
      { name: 'Guide', error: 'NotSupportedError: no Guide' },
    ]);
    expect(report.registered).toHaveLength(tizenKeysToRegister(null).length - 3);
    expect(report.registered).not.toContain('Guide');
    // An empty list means the TV has none of them.
    expect(registerTizenKeys(input)).toMatchObject({ supported: [], registered: [], unsupported: tizenKeysToRegister(null) });
    expect(calls).toEqual([]);
  });

  it('says so when the key API is missing', () => {
    expect(registerTizenKeys(undefined)).toEqual({ skipped: 'no tizen.tvinputdevice', supported: null, registered: [], unsupported: [], refused: [] });
  });

  it('keeps a message that has no name', () => {
    const { input } = device(new Error('x'), { Guide: { message: 'just a message' } });
    expect(registerTizenKeys(input).refused).toEqual([{ name: 'Guide', error: 'just a message' }]);
  });
});

describe('Tizen key map', () => {
  it.each([
    [38, 'UP'],
    [13, 'OK'],
    [10009, 'BACK'],
    [427, 'CH_UP'],
    [428, 'CH_DOWN'],
    [48, 'DIGIT_0'],
    [57, 'DIGIT_9'],
    [10252, 'PLAY_PAUSE'],
    [415, 'PLAY_PAUSE'],
    [19, 'PLAY_PAUSE'],
    [413, 'STOP'],
    [417, 'FF'],
    [412, 'RW'],
    [457, 'INFO'],
    [458, 'GUIDE'],
    [403, 'RED'],
    [406, 'BLUE'],
    [10190, 'PREV_CH'],
    [10195, 'AUDIO'],
    [10221, 'SUBTITLES'],
  ])('default code %i -> %s', (code, intent) => {
    expect(buildTizenKeyMap(null).get(code)).toBe(intent);
  });

  it('prefers the codes the TV reports', () => {
    const map = buildTizenKeyMap([{ name: 'ColorF0Red', code: 9403 }]);
    expect(map.get(9403)).toBe('RED');
    expect(map.get(403)).toBeUndefined();
    expect(map.get(404)).toBe('GREEN');
  });
});

describe('Tizen version tables', () => {
  it.each([
    ['4.0', 2018, 56],
    ['4.0.0.3', 2018, 56],
    ['5.5', 2020, 69],
    ['7.0', 2023, 94],
    ['9.0', 2025, 120],
  ])('%s -> %i, Chromium %i', (version, year, chromium) => {
    expect(tizenModelYear(version)).toBe(year);
    expect(tizenChromiumVersion(version)).toBe(chromium);
  });

  it.each(['unknown', '', '42.0'])('unknown version %j -> null', (version) => {
    expect(tizenModelYear(version)).toBeNull();
    expect(tizenChromiumVersion(version)).toBeNull();
  });
});

describe('tizenTextKey (a text field being edited, RELAY step 13a)', () => {
  const code = (keyCode: number) => ({ keyCode });

  it.each([
    [13, 'done'],
    [TIZEN_IME_DONE, 'done'],
    [TIZEN_IME_CANCEL, 'close'],
    [10009, 'close'],
    [38, 'up'],
    [40, 'down'],
  ] as const)('key %i ends the edit as %s', (keyCode, textKey) => {
    expect(tizenTextKey(code(keyCode))).toBe(textKey);
  });

  it("uses the IME codes from Samsung's guide", () => {
    expect([TIZEN_IME_DONE, TIZEN_IME_CANCEL]).toEqual([65376, 65385]);
  });

  it.each([37, 39, 8, 46, 48, 65, 427, 403])('leaves key %i to the field', (keyCode) => {
    expect(tizenTextKey(code(keyCode))).toBeNull();
  });

  it('no remote key is an Intent and a different text key by accident', () => {
    // Back is BACK as an Intent and close in a field; OK is OK and done.
    const intents = buildTizenKeyMap(null);
    expect(intents.get(10009)).toBe('BACK');
    expect(intents.get(13)).toBe('OK');
    expect(intents.has(TIZEN_IME_DONE)).toBe(false);
    expect(intents.has(TIZEN_IME_CANCEL)).toBe(false);
  });
});

/** A stage whose document makes elements with what `createStageVideo` and `Html5Engine` touch. */
function fakeStage(mediaId?: string): { stage: HTMLElement; made: Array<{ tag: string; style: Record<string, string> }> } {
  const made: Array<{ tag: string; style: Record<string, string> }> = [];
  const stage = {
    ownerDocument: {
      createElement: (tag: string) => {
        const el = { tag, mediaId, style: {} as Record<string, string>, setAttribute: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
        made.push(el);
        return el;
      },
    },
    appendChild: () => undefined,
  } as unknown as HTMLElement;
  return { stage, made };
}

describe('createEngines (RELAY steps 18 and 19)', () => {
  it('gives AVPlay with the <video> engine as its HLS fallback, the <video> hidden while AVPlay plays', async () => {
    const { stage, made } = fakeStage();
    const avplay = new FakeAvplay(new FakeClock());
    const engines = createTizenEngines(stage, avplay);
    expect(engines.map((e) => e.kind)).toEqual(['avplay']);
    expect(made.map((el) => el.tag)).toEqual(['video', 'object']);
    const video = made[0]!;
    expect(video.style.display).toBe('none');
    // AVPlay refuses an HLS stream: the <video> engine takes it, and shows.
    const engine = engines[0]!;
    void engine.load({ url: 'http://panel.example/live/u/p/1.m3u8', container: 'hls', live: true }, 1).then(undefined, () => undefined);
    avplay.failPrepare({ name: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT' });
    await settle();
    expect(engine.kind).toBe('html5');
    expect(video.style.display).toBe('');
    expect(avplay.connections).toBe(0);
  });

  it('gives the <video> engine alone where there is no AVPlay (a desktop browser, the old-engine harness)', () => {
    const { stage, made } = fakeStage();
    const engines = createTizenPlatform().createEngines(stage);
    expect(engines.map((e) => e.kind)).toEqual(['html5']);
    expect(made.map((el) => el.tag)).toEqual(['video']);
    expect(made[0]!.style.display).toBeUndefined();
  });

  it('gives the controller the redirect probe', () => {
    expect(typeof createTizenPlatform().resolveUrl).toBe('function');
  });
});
