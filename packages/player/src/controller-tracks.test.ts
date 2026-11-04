import { describe, expect, it } from 'vitest';
import type { ControllerOptions, PlayerStatus } from './controller';
import { PlayerController } from './controller';
import type { EngineSource, Track } from './engine';
import type { FakeScript } from './fake-engine';
import { FakeClock, FakeEngine } from './fake-engine';
import type { PlayRequest } from './request';
import { streamCandidates } from './request';
import type { PlayerTrack, TrackChoice } from './tracks';
import { MemoryTrackMemory, findPick, playerTracks, preferredTrack } from './tracks';

/**
 * The controller's tracks (RELAY step 20b): the engine's lists in the status, the preferred
 * languages and each channel's remembered choice applied when a stream's tracks appear, and the
 * menu's switches.
 */

const BASE = 'http://panel.example:8080';

function live(id: number): PlayRequest {
  return { key: `s1:live:${id}`, src: 's1', mode: 'live', candidates: streamCandidates(`${BASE}/live/u/p/${id}.m3u8`, 'live') };
}

const track = (id: string, lang: string, selected = false, label = ''): Track => ({ id, lang, label, selected });

/** A stream with Arabic (its default), English and Spanish sound, and English and Arabic subtitles (off). */
function bilingual(engine: FakeEngine): void {
  engine.audio = [track('0', 'ara', true, 'Arabic'), track('1', 'eng', false, 'English'), track('2', 'spa', false, 'Spanish')];
  engine.text = [track('3', 'eng', false, 'English SDH'), track('4', 'ara', false, 'Arabic')];
}

interface Rig {
  clock: FakeClock;
  engine: FakeEngine;
  player: PlayerController;
  memory: MemoryTrackMemory;
  statuses: PlayerStatus[];
  /** The engine's switch calls, in order. */
  switches(): string[];
}

/** Every load lists its tracks 200 ms in, before its first frame (500 ms). */
function rig(options: ControllerOptions = {}, script: (source: EngineSource, n: number) => FakeScript = () => ({ tracksMs: 200 })): Rig {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock, script);
  bilingual(engine);
  const memory = new MemoryTrackMemory();
  const player = new PlayerController(engine, { clock, trackMemory: memory, ...options });
  const statuses: PlayerStatus[] = [];
  player.subscribe((s) => statuses.push(s));
  return { clock, engine, player, memory, statuses, switches: () => engine.log.filter((e) => e.indexOf('select') === 0) };
}

const selected = (tracks: readonly PlayerTrack[]): string[] => tracks.filter((t) => t.selected).map((t) => t.lang);

const PREFER_EN = { audio: ['en', 'ar'], text: [] };

describe('PlayerController: the tracks in the status', () => {
  it('lists the engine tracks once they appear, with their languages normalized and as the stream wrote them', async () => {
    const r = rig();
    void r.player.play(live(1));
    expect(r.player.status.tracks).toEqual({ audio: [], text: [], switching: 'reliable' });
    await r.clock.advance(200);
    const { tracks } = r.player.status;
    expect(tracks.audio.map((t) => `${t.id} ${t.lang} ${t.streamLang} ${t.label} ${String(t.selected)}`)).toEqual(['0 ar ara Arabic true', '1 en eng English false', '2 es spa Spanish false']);
    expect(tracks.text.map((t) => `${t.id} ${t.lang}`)).toEqual(['3 en', '4 ar']);
    expect(tracks.switching).toBe('reliable');
    // The list came with its own status (the state didn't change).
    expect(r.statuses.map((s) => `${s.state} ${s.tracks.audio.length}`)).toEqual(['opening 0', 'opening 3']);
    // No preferences: the stream's own tracks stay.
    expect(r.switches()).toEqual([]);
  });

  it("says the engine can't switch where its caps say so", async () => {
    const r = rig();
    r.engine.trackSwitch = 'none';
    void r.player.play(live(1));
    expect(r.player.status.tracks.switching).toBe('none');
    await r.clock.advance(200);
    expect(r.player.status.tracks.switching).toBe('none');
  });

  it('reads the tracks at the first frame when the engine sent no event', async () => {
    const r = rig({ preferences: () => PREFER_EN }, () => ({}));
    void r.player.play(live(1));
    await r.clock.advance(499);
    expect(r.player.status.tracks.audio).toEqual([]);
    await r.clock.advance(1);
    expect(r.player.status.state).toBe('playing');
    expect(r.switches()).toEqual(['selectAudio 1']);
    expect(selected(r.player.status.tracks.audio)).toEqual(['en']);
  });

  it('shows no tracks once nothing plays, and none while it reconnects until the new load lists them', async () => {
    const r = rig({}, (_s, n) => (n === 1 ? { tracksMs: 200, error: { atMs: 1000, error: { kind: 'network', code: 'X' } } } : { tracksMs: 200 }));
    void r.player.play(live(1));
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('reconnecting');
    expect(r.player.status.tracks.audio).toEqual([]);
    // The reopen (after the 50 ms stop) lists them again.
    await r.clock.advance(250);
    expect(r.player.status.tracks.audio).toHaveLength(3);
    void r.player.stop();
    expect(r.player.status.tracks).toEqual({ audio: [], text: [], switching: 'none' });
  });

  it('keeps empty lists when the engine fails to list its tracks', async () => {
    const r = rig();
    r.engine.getTracks = () => {
      throw new Error('AVPlay is not ready');
    };
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.player.status).toMatchObject({ state: 'playing', tracks: { audio: [], text: [] } });
  });
});

describe('PlayerController: the preferred languages', () => {
  it('switches to the first preferred language the stream has when its tracks appear, without remembering it', async () => {
    const r = rig({ preferences: () => PREFER_EN });
    void r.player.play(live(1));
    await r.clock.advance(200);
    expect(r.switches()).toEqual(['selectAudio 1']);
    expect(selected(r.player.status.tracks.audio)).toEqual(['en']);
    // Subtitles: no preferred language, so they stay off.
    expect(selected(r.player.status.tracks.text)).toEqual([]);
    expect(r.memory.choice('s1:live:1')).toBeNull();
  });

  it('goes down the list to a language the stream has, and leaves the default when it has none', async () => {
    const later = rig({ preferences: () => ({ audio: ['fr', 'es', 'en'], text: [] }) });
    void later.player.play(live(1));
    await later.clock.advance(200);
    expect(later.switches()).toEqual(['selectAudio 2']);
    const none = rig({ preferences: () => ({ audio: ['fr', 'de'], text: [] }) });
    void none.player.play(live(1));
    await none.clock.advance(600);
    expect(none.switches()).toEqual([]);
    expect(selected(none.player.status.tracks.audio)).toEqual(['ar']);
    // Already on the preferred one: no call.
    const already = rig({ preferences: () => ({ audio: ['ar'], text: [] }) });
    void already.player.play(live(1));
    await already.clock.advance(600);
    expect(already.switches()).toEqual([]);
  });

  it('turns on subtitles in a preferred language', async () => {
    const r = rig({ preferences: () => ({ audio: [], text: ['ar', 'en'] }) });
    void r.player.play(live(1));
    await r.clock.advance(200);
    expect(r.switches()).toEqual(['selectText 4']);
    expect(selected(r.player.status.tracks.text)).toEqual(['ar']);
  });

  it('reads the preferences each time tracks appear (a settings change counts from the next stream)', async () => {
    let prefs = PREFER_EN;
    const r = rig({ preferences: () => prefs });
    void r.player.play(live(1));
    await r.clock.advance(600);
    prefs = { audio: ['es'], text: [] };
    bilingual(r.engine);
    void r.player.play(live(2));
    await r.clock.advance(300);
    expect(r.switches()).toEqual(['selectAudio 1', 'selectAudio 2']);
  });

  it('chooses once per load: a later list of the same load leaves the tracks alone', async () => {
    const r = rig({ preferences: () => PREFER_EN });
    void r.player.play(live(1));
    await r.clock.advance(600);
    // The stream went back to Arabic by itself (an HLS rendition change), and listed again.
    bilingual(r.engine);
    r.engine.emit(r.engine.loads[0]!.token, { type: 'tracks' });
    await r.clock.advance(0);
    expect(r.switches()).toEqual(['selectAudio 1']);
    expect(selected(r.player.status.tracks.audio)).toEqual(['ar']);
  });

  it('chooses again for each new load of the stream (a retry starts from its defaults)', async () => {
    const r = rig({ preferences: () => PREFER_EN }, (_s, n) => (n === 1 ? { tracksMs: 200, error: { atMs: 1000, error: { kind: 'network', code: 'X' } } } : { tracksMs: 200 }));
    void r.player.play(live(1));
    await r.clock.advance(1000);
    bilingual(r.engine);
    await r.clock.advance(300);
    expect(r.switches()).toEqual(['selectAudio 1', 'selectAudio 1']);
  });

  it('chooses again after the app comes back (webOS reopens the stream with its defaults)', async () => {
    const r = rig({ preferences: () => PREFER_EN });
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.player.hide();
    r.player.show();
    bilingual(r.engine);
    r.engine.emit(r.engine.loads[0]!.token, { type: 'tracks' });
    await r.clock.advance(0);
    expect(r.switches()).toEqual(['selectAudio 1', 'selectAudio 1']);
  });

  it("drops an automatic switch's answer once the stream changed", async () => {
    const r = rig({ preferences: () => PREFER_EN });
    r.engine.switchMs = 300;
    void r.player.play(live(1));
    await r.clock.advance(200);
    void r.player.play(live(2));
    await r.clock.advance(100);
    const before = r.statuses.length;
    // The first stream's switch settles: the second stream's status doesn't change.
    await r.clock.advance(200);
    expect(r.statuses.slice(before).every((s) => s.key === 's1:live:2')).toBe(true);
    expect(r.statuses.slice(before).every((s) => s.tracks.audio.length === 0 || s.tracks.audio.some((t) => t.selected))).toBe(true);
  });
});

describe('PlayerController: the menu and the channel memory', () => {
  it('switches the audio from the menu and remembers it for the channel', async () => {
    const r = rig({ preferences: () => PREFER_EN });
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(await r.player.selectAudio('2')).toBe(true);
    expect(selected(r.player.status.tracks.audio)).toEqual(['es']);
    expect(r.memory.choice('s1:live:1')).toEqual({ audio: { id: '2', lang: 'es', label: 'Spanish' }, text: null });
    // The status said so at once.
    expect(selected(r.statuses[r.statuses.length - 1]!.tracks.audio)).toEqual(['es']);
  });

  it("puts the channel's choice before the preferences, and keeps the preferences for other channels", async () => {
    const r = rig({ preferences: () => PREFER_EN });
    void r.player.play(live(1));
    await r.clock.advance(600);
    await r.player.selectAudio('2');
    bilingual(r.engine);
    void r.player.play(live(2));
    await r.clock.advance(600);
    expect(selected(r.player.status.tracks.audio)).toEqual(['en']);
    bilingual(r.engine);
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(selected(r.player.status.tracks.audio)).toEqual(['es']);
    expect(r.switches()).toEqual(['selectAudio 1', 'selectAudio 2', 'selectAudio 1', 'selectAudio 2']);
  });

  it('keeps the audio choice when subtitles are chosen, and the other way round', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    await r.player.selectAudio('1');
    await r.player.selectText('4');
    await r.player.selectAudio('2');
    expect(r.memory.choice('s1:live:1')).toEqual({ audio: { id: '2', lang: 'es', label: 'Spanish' }, text: { id: '4', lang: 'ar', label: 'Arabic' } });
    expect(await r.player.selectText(null)).toBe(true);
    expect(r.memory.choice('s1:live:1')).toEqual({ audio: { id: '2', lang: 'es', label: 'Spanish' }, text: 'off' });
    expect(selected(r.player.status.tracks.text)).toEqual([]);
  });

  it('turns subtitles off on a channel remembered "off", whatever the preferences and the stream say', async () => {
    const r = rig({ preferences: () => ({ audio: [], text: ['ar'] }) });
    r.memory.remember('s1:live:1', { audio: null, text: 'off' });
    // This stream shows its English subtitles by default.
    r.engine.text = [track('3', 'eng', true), track('4', 'ara')];
    void r.player.play(live(1));
    await r.clock.advance(200);
    expect(r.switches()).toEqual(['selectText null']);
    expect(selected(r.player.status.tracks.text)).toEqual([]);
    // Nothing shown: nothing to turn off.
    const quiet = rig({ preferences: () => ({ audio: [], text: ['ar'] }) });
    quiet.memory.remember('s1:live:1', { audio: null, text: 'off' });
    void quiet.player.play(live(1));
    await quiet.clock.advance(600);
    expect(quiet.switches()).toEqual([]);
  });

  it('falls back to the preferences when the remembered track is gone from the stream', async () => {
    const r = rig({ preferences: () => PREFER_EN });
    r.memory.remember('s1:live:1', { audio: { id: '7', lang: 'fr', label: 'French' }, text: { id: '9', lang: 'de', label: '' } });
    void r.player.play(live(1));
    await r.clock.advance(200);
    expect(r.switches()).toEqual(['selectAudio 1']);
  });

  it("doesn't let a later list of the same load undo the menu's choice", async () => {
    const r = rig({ preferences: () => PREFER_EN }, () => ({ tracksMs: 700 }));
    void r.player.play(live(1));
    // The first frame listed the tracks and switched to English; the user picks Arabic.
    await r.clock.advance(500);
    await r.player.selectAudio('0');
    // Late tracks event (HLS): the choice stays.
    await r.clock.advance(200);
    expect(selected(r.player.status.tracks.audio)).toEqual(['ar']);
    expect(r.switches()).toEqual(['selectAudio 1', 'selectAudio 0']);
  });

  it("is false, remembers nothing and shows what plays when the engine refuses", async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.engine.switchOk = false;
    expect(await r.player.selectAudio('1')).toBe(false);
    expect(await r.player.selectText('3')).toBe(false);
    expect(r.memory.choice('s1:live:1')).toBeNull();
    expect(selected(r.player.status.tracks.audio)).toEqual(['ar']);
    // An engine that throws is a refusal too.
    r.engine.selectAudio = () => Promise.reject(new Error('luna said no'));
    expect(await r.player.selectAudio('1')).toBe(false);
  });

  it('is false for a track that is not listed, or with nothing playing', async () => {
    const r = rig();
    expect(await r.player.selectAudio('0')).toBe(false);
    expect(await r.player.selectText(null)).toBe(false);
    void r.player.play(live(1));
    expect(await r.player.selectAudio('0')).toBe(false);
    await r.clock.advance(600);
    expect(await r.player.selectAudio('9')).toBe(false);
    expect(await r.player.selectText('0')).toBe(false);
    expect(r.switches()).toEqual([]);
  });

  it('forgets a switch whose stream was left before it settled', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.engine.switchMs = 300;
    const switched = r.player.selectAudio('1');
    void r.player.play(live(2));
    await r.clock.advance(300);
    expect(await switched).toBe(false);
    expect(r.memory.choice('s1:live:1')).toBeNull();
    expect(r.player.status.key).toBe('s1:live:2');
  });
});

describe('tracks.ts', () => {
  const tracks = playerTracks([track('0', 'ara', true, 'Arabic'), track('1', 'eng', false, 'English'), track('2', 'eng', false, 'Commentary'), track('3', '', false, 'Director')]);

  it('finds a pick by id, language and label, then language and label, then language', () => {
    expect(findPick(tracks, { id: '2', lang: 'en', label: 'Commentary' })?.id).toBe('2');
    // The stream moved its tracks: the same label wins over the first English one.
    expect(findPick(tracks, { id: '5', lang: 'en', label: 'Commentary' })?.id).toBe('2');
    expect(findPick(tracks, { id: '1', lang: 'en', label: 'Commentary' })?.id).toBe('2');
    expect(findPick(tracks, { id: '5', lang: 'en', label: 'Other' })?.id).toBe('1');
    expect(findPick(tracks, { id: '0', lang: 'fr', label: 'Arabic' })).toBeNull();
  });

  it('finds a pick with no language only by its label', () => {
    expect(findPick(tracks, { id: '9', lang: '', label: 'Director' })?.id).toBe('3');
    expect(findPick(tracks, { id: '3', lang: '', label: 'Other' })).toBeNull();
  });

  it('prefers the first language in order, skipping empty codes', () => {
    expect(preferredTrack(tracks, ['', 'fr', 'en', 'ar'])?.id).toBe('1');
    expect(preferredTrack(tracks, [])).toBeNull();
    // A track with no language never matches.
    expect(preferredTrack(tracks, [''])).toBeNull();
  });

  it('remembers per channel', () => {
    const memory = new MemoryTrackMemory();
    const choice: TrackChoice = { audio: null, text: 'off' };
    memory.remember('a', choice);
    expect(memory.choice('a')).toBe(choice);
    expect(memory.choice('b')).toBeNull();
    expect(memory.choice('constructor')).toBeNull();
  });
});
