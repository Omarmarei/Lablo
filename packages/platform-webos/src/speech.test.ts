import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceBridge } from './luna';
import { jsonText } from './luna';
import { AUDIO_GUIDANCE_URI, TTS_URI, audioGuidanceFrom, readAudioGuidance, webosSpeak } from './speech';
import { createWebosPlatform } from './index';

/** A bridge that answers `reply` at once (or never), recording its calls. */
function fakeBridge(reply: string | null) {
  const calls: Array<{ uri: string; params: string }> = [];
  const bridge: ServiceBridge = {
    onservicecallback: null,
    call(uri, params) {
      calls.push({ uri, params });
      if (reply !== null) setTimeout(() => bridge.onservicecallback?.(reply), 0);
    },
  };
  return { factory: () => bridge, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('jsonText (luna params without JSON.stringify)', () => {
  it('writes what JSON.parse reads back, for any text', () => {
    const BACKSLASH = String.fromCharCode(92);
    for (const text of ['Lablo Lab', 'لابلو', 'say "hi"', `a${BACKSLASH}b`, 'line\nbreak\ttab', String.fromCharCode(0, 31, 127, 0x2028), '']) {
      expect(JSON.parse(jsonText(text))).toBe(text);
    }
    expect(jsonText('a"b')).toBe(`"a${BACKSLASH}"b"`);
    expect(jsonText(String.fromCharCode(1))).toBe(`"${BACKSLASH}u0001"`);
    expect(jsonText(String.fromCharCode(0x1f))).toBe(`"${BACKSLASH}u001f"`);
  });
});

describe('Audio Guidance (screenReader on webOS, RELAY step 15b2)', () => {
  it('asks the settings service for option/audioGuidance', async () => {
    const fake = fakeBridge(JSON.stringify({ returnValue: true, category: 'option', settings: { audioGuidance: 'on' } }));
    expect(await readAudioGuidance(fake.factory)).toEqual({ on: true, detail: 'audioGuidance = on' });
    expect(fake.calls).toEqual([{ uri: AUDIO_GUIDANCE_URI, params: '{"category":"option","keys":["audioGuidance"]}' }]);
    expect(JSON.parse(fake.calls[0]?.params ?? '')).toEqual({ category: 'option', keys: ['audioGuidance'] });
  });

  it('reads on, off, and anything else as unknown', () => {
    expect(audioGuidanceFrom({ settings: { audioGuidance: 'on' } })).toBe(true);
    expect(audioGuidanceFrom({ settings: { audioGuidance: 'off' } })).toBe(false);
    expect(audioGuidanceFrom({ settings: { audioGuidance: true } })).toBeNull();
    expect(audioGuidanceFrom({ settings: null })).toBeNull();
    expect(audioGuidanceFrom({})).toBeNull();
  });

  it('says why there is no answer: off, a refusal, no bridge', async () => {
    expect(await readAudioGuidance(fakeBridge(JSON.stringify({ returnValue: true, settings: { audioGuidance: 'off' } })).factory)).toEqual({ on: false, detail: 'audioGuidance = off' });
    expect(await readAudioGuidance(fakeBridge(JSON.stringify({ returnValue: false, errorText: 'Denied' })).factory)).toEqual({ on: null, detail: `${AUDIO_GUIDANCE_URI} failed: Denied` });
    expect(await readAudioGuidance(() => null)).toEqual({ on: null, detail: `no PalmServiceBridge for ${AUDIO_GUIDANCE_URI}` });
    expect(await readAudioGuidance(fakeBridge(null).factory, 10)).toEqual({ on: null, detail: `${AUDIO_GUIDANCE_URI} did not answer within 10 ms` });
  });
});

describe('speech (speak on webOS)', () => {
  it('asks the TTS service to say the text, clearing what it was saying', async () => {
    const fake = fakeBridge('{"returnValue":true}');
    expect(await webosSpeak('Lablo Lab: "S11"', fake.factory)).toBe('done');
    expect(fake.calls[0]?.uri).toBe(TTS_URI);
    expect(JSON.parse(fake.calls[0]?.params ?? '')).toEqual({ text: 'Lablo Lab: "S11"', clear: true });
  });

  it('is unsupported without the bridge, and rejects with the TV refusal', async () => {
    expect(await webosSpeak('x', () => null)).toBe('unsupported');
    await expect(webosSpeak('x', fakeBridge('{"returnValue":false,"errorText":"Unknown service"}').factory)).rejects.toThrow(`${TTS_URI} failed: Unknown service`);
  });

  it('is what the adapter uses, with no screensaver API on webOS', async () => {
    vi.stubGlobal('window', {});
    const platform = createWebosPlatform();
    expect(await platform.setScreenSaver(false)).toBe('unsupported');
    expect(await platform.speak('x')).toBe('unsupported');
    expect(await platform.screenReader()).toEqual({ on: null, detail: `no PalmServiceBridge for ${AUDIO_GUIDANCE_URI}` });
  });
});
