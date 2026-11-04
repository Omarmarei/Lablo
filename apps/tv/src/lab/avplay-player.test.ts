import type { AvplayError } from '@zoma/platform-tizen';
import { describe, expect, it } from 'vitest';
import type { AvplayLabPlayer } from './avplay-player';
import { AVPLAY_PAGE_CLASS, createAvplayPlayer, mountAvplayStage } from './avplay-player';
import { openAndWait } from './battery';
import type { AvplayPlan } from './fakes';
import { FIVE_AUDIO, FakeAvplay, FakeClock, fakeAvplayStage } from './fakes';
import type { LabPlayerEvent } from './player';

const LIVE = 'http://lab:8080/live/zoma/zoma-test/104.ts';
const VOD = 'http://lab:8080/movie/zoma/zoma-test/206.mkv';

function setup(script: (url: string, n: number) => AvplayPlan = () => ({ prepareAfterMs: 100 })) {
  const clock = new FakeClock();
  const api = new FakeAvplay(clock, script);
  const stage = fakeAvplayStage();
  const player = createAvplayPlayer(api, stage, { timers: clock.timers, now: clock.now });
  const events: LabPlayerEvent[] = [];
  player.on((event) => events.push(event));
  return { clock, api, stage, player, events };
}

/** Waits `ms` on the fake clock in the battery's 50 ms steps. */
async function wait(clock: FakeClock, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 50) await clock.sleep(Math.min(50, left));
}

describe('the AVPlay player (RELAY step 15c2)', () => {
  it('opens, shows on the stage, prepares, then plays; a frame is the clock moving while PLAYING', async () => {
    const { clock, api, player, events } = setup();
    const r = await openAndWait(player, LIVE, { live: true }, 10_000, clock);
    // A close first (stop refused in NONE, close fine), then the open's calls in order.
    expect(api.calls).toEqual(['stop', 'close', 'open', 'setListener', 'setDisplayRect 1112,556,768,432', 'prepareAsync', 'play']);
    expect(api.urls).toEqual([LIVE]);
    // Prepared at 100 ms, playing, the clock moves at 200 ms: seen on the next look.
    expect(r).toEqual({ played: true, ms: 250, width: 1920, height: 1080, positionMs: 50, error: null, muted: false });
    expect(events).toEqual([{ type: 'frame' }]);
    // The look stops with the frame.
    expect(clock.running).toBe(0);
    await wait(clock, 1000);
    expect(player.snapshot()).toMatchObject({ positionMs: 1050, paused: false, frames: null, state: 'PLAYING', error: null });
    expect(player.readiness()).toEqual({ prepared: true, ms: 100, error: null });
  });

  it("counts AVPlay's own time calls too, and needs two readings that differ", async () => {
    const { clock, api, player, events } = setup();
    player.open(LIVE, { live: true });
    await wait(clock, 150);
    expect(events).toEqual([]);
    // The time callback alone: the first is a reading, the second (moved) a frame.
    api.fire('oncurrentplaytime', 0);
    expect(events).toEqual([]);
    api.fire('oncurrentplaytime', 0);
    expect(events).toEqual([]);
    api.fire('oncurrentplaytime', 40);
    expect(events).toEqual([{ type: 'frame' }]);
    api.fire('oncurrentplaytime', 80);
    expect(events).toEqual([{ type: 'frame' }]);
  });

  it('never calls a stream that is not PLAYING a frame, nor a clock that stands still', async () => {
    const stuck = setup(() => ({ prepareAfterMs: 100, startAfterMs: null }));
    const r = await openAndWait(stuck.player, LIVE, { live: true }, 3000, stuck.clock);
    expect(r).toMatchObject({ played: false, width: 0, height: 0 });
    // Paused by someone: its clock may still read differently, but nothing plays.
    const paused = setup();
    paused.player.open(LIVE, { live: true });
    await wait(paused.clock, 120);
    paused.api.pause();
    await wait(paused.clock, 1000);
    expect(paused.events).toEqual([]);
    expect(paused.player.snapshot()).toMatchObject({ paused: true, state: 'PAUSED' });
  });

  it("is AVPlay's 302 freeze when the prepare never answers", async () => {
    const { clock, player } = setup(() => ({ prepareAfterMs: null }));
    const r = await openAndWait(player, LIVE, { live: true }, 10_000, clock);
    expect(r).toMatchObject({ played: false, ms: 10_000, error: null });
    expect(player.snapshot().state).toBe('IDLE, buffering, preparing');
    expect(player.readiness()).toEqual({ prepared: false, ms: null, error: null });
  });

  it("reports the prepare's error callback, and whether it means the TV can't play the file", async () => {
    const connection: AvplayError = { name: 'PLAYER_ERROR_CONNECTION_FAILED', message: 'PLAYER_ERROR_CONNECTION_FAILED' };
    const failing = setup(() => ({ prepareAfterMs: 300, prepareError: connection }));
    const r = await openAndWait(failing.player, LIVE, { live: true }, 10_000, failing.clock);
    expect(r).toMatchObject({ played: false, ms: 300, error: { code: null, message: 'prepareAsync: PLAYER_ERROR_CONNECTION_FAILED', unsupported: false } });
    expect(failing.player.readiness().error?.message).toBe('prepareAsync: PLAYER_ERROR_CONNECTION_FAILED');
    const format = setup(() => ({ prepareAfterMs: 300, prepareError: { name: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', message: 'not supported' } }));
    const f = await openAndWait(format.player, LIVE, { live: true }, 10_000, format.clock);
    expect(f.error).toEqual({ code: null, message: 'prepareAsync: PLAYER_ERROR_NOT_SUPPORTED_FORMAT, not supported', unsupported: true });
    expect(format.player.snapshot().error).toEqual(f.error);
  });

  it("reports AVPlay's error callback while playing", async () => {
    const { clock, player, events } = setup(() => ({ prepareAfterMs: 100, error: { afterMs: 600, name: 'PLAYER_ERROR_NOT_SUPPORTED_FILE' } }));
    player.open(LIVE, { live: true });
    await wait(clock, 1000);
    expect(events).toEqual([{ type: 'frame' }, { type: 'error', error: { code: null, message: 'PLAYER_ERROR_NOT_SUPPORTED_FILE', unsupported: true } }]);
  });

  it('reports a call AVPlay refuses as an error at once', async () => {
    const opening = setup();
    opening.api.throws['open'] = 'InvalidValuesError';
    const r = await openAndWait(opening.player, LIVE, { live: true }, 10_000, opening.clock);
    expect(r).toMatchObject({ played: false, ms: 0, error: { message: 'open: InvalidValuesError, open refused' } });
    expect(opening.api.calls).not.toContain('prepareAsync');
    const preparing = setup();
    preparing.api.throws['prepareAsync'] = 'InvalidStateError';
    expect((await openAndWait(preparing.player, LIVE, { live: true }, 10_000, preparing.clock)).error?.message).toBe('prepareAsync: InvalidStateError, prepareAsync refused');
    const playing = setup();
    playing.api.throws['play'] = 'InvalidStateError';
    expect((await openAndWait(playing.player, LIVE, { live: true }, 10_000, playing.clock)).error?.message).toBe('play: InvalidStateError, play refused');
    // A display rect or listener refused is no reason to stop.
    const rect = setup();
    rect.api.throws['setDisplayRect'] = 'InvalidValuesError';
    expect((await openAndWait(rect.player, LIVE, { live: true }, 10_000, rect.clock)).played).toBe(true);
  });

  it('drops the callbacks of an earlier open', async () => {
    const { clock, api, player, events } = setup();
    const kept: Array<{ ok?: () => void; error?: (e: AvplayError) => void }> = [];
    const prepare = api.prepareAsync.bind(api);
    api.prepareAsync = (ok, error) => {
      kept.push({ ok, error });
      prepare(ok, error);
    };
    const listeners: Array<Parameters<FakeAvplay['setListener']>[0]> = [];
    const setListener = api.setListener.bind(api);
    api.setListener = (l) => {
      listeners.push(l);
      setListener(l);
    };
    player.open(LIVE, { live: true });
    player.open(VOD, { live: false });
    const plays = api.calls.filter((c) => c === 'play').length;
    kept[0]?.ok?.();
    kept[0]?.error?.({ name: 'PLAYER_ERROR_CONNECTION_FAILED' });
    listeners[0]?.onerror?.('PLAYER_ERROR_CONNECTION_FAILED');
    listeners[0]?.oncurrentplaytime?.(5000);
    listeners[0]?.onstreamcompleted?.();
    listeners[0]?.onbufferingstart?.();
    listeners[0]?.onsubtitlechange?.('1', 'old', '0');
    expect(api.calls.filter((c) => c === 'play').length).toBe(plays);
    expect(events).toEqual([]);
    expect(player.readiness()).toEqual({ prepared: false, ms: null, error: null });
    // The newer open goes on as usual.
    await wait(clock, 400);
    expect(events).toEqual([{ type: 'frame' }]);
    expect(api.urls).toEqual([LIVE, VOD]);
  });

  it('says when it waits again, and when a file ends', async () => {
    const { clock, api, player, events } = setup(() => ({ prepareAfterMs: 100, endAfterMs: 2000 }));
    player.open(VOD, { live: false });
    // Buffering before the first frame is the prepare's: no `waiting` for it.
    api.fire('onbufferingstart');
    expect(player.snapshot().state).toBe('IDLE, buffering, preparing');
    await wait(clock, 400);
    expect(player.snapshot().state).toBe('PLAYING');
    api.fire('onbufferingstart');
    expect(player.snapshot().state).toBe('PLAYING, buffering');
    api.fire('onbufferingcomplete');
    api.fire('onevent', 'PLAYER_MSG_BITRATE_CHANGE', '4000000');
    expect(player.snapshot().state).toBe('PLAYING, PLAYER_MSG_BITRATE_CHANGE 4000000');
    api.fire('onevent', 'PLAYER_MSG_RESOLUTION_CHANGED', '');
    expect(player.snapshot().state).toBe('PLAYING, PLAYER_MSG_RESOLUTION_CHANGED');
    await wait(clock, 2500);
    expect(events).toEqual([{ type: 'frame' }, { type: 'waiting' }, { type: 'ended' }]);
  });

  it("starts a VOD file at its position once the jump landed, without calling the jump a frame", async () => {
    const { clock, api, player } = setup();
    const r = await openAndWait(player, VOD, { live: false, startMs: 30_000 }, 10_000, clock);
    expect(api.calls.slice(-2)).toEqual(['play', 'seekTo 30000']);
    // Prepared at 100, the jump lands at 150 (as the clock starts at 200): the frame at 250.
    expect(r).toMatchObject({ played: true, ms: 250 });
    expect(r.positionMs).toBeGreaterThanOrEqual(30_000);
    // A refused jump plays from the start rather than not at all.
    const refused = setup();
    refused.api.throws['seekTo'] = 'InvalidStateError';
    expect((await openAndWait(refused.player, VOD, { live: false, startMs: 30_000 }, 10_000, refused.clock)).played).toBe(true);
    // Live, or a VOD from 0: no jump.
    const live = setup();
    await openAndWait(live.player, LIVE, { live: true, startMs: 0 }, 10_000, live.clock);
    expect(live.api.calls).not.toContain('seekTo 0');
  });

  it("lists the file's audio tracks and switches with setSelectTrack", async () => {
    const { clock, api, player } = setup(() => ({ prepareAfterMs: 100, audio: FIVE_AUDIO }));
    // Not prepared yet: AVPlay has no track info, and no list is not "no API".
    player.open(VOD, { live: false });
    expect(player.audioTracks()).toEqual([]);
    expect(player.selectAudio(1)).toBe(false);
    await wait(clock, 400);
    const tracks = player.audioTracks();
    expect(tracks?.map((t) => [t.index, t.id, t.lang, t.label, t.kind, t.selected])).toEqual([
      [0, '1', 'ara', 'AAC 2ch', 'audio', true],
      [1, '2', 'eng', 'AAC 2ch', 'audio', false],
      [2, '3', 'spa', 'AAC 2ch', 'audio', false],
      [3, '4', 'eng', 'AC3 6ch', 'audio', false],
      [4, '5', 'eng', 'EAC3 6ch', 'audio', false],
    ]);
    // By its place in the list, as the battery asks: AVPlay gets the stream's index.
    expect(player.selectAudio(3)).toBe(true);
    expect(api.calls).toContain('setSelectTrack AUDIO 4');
    expect(player.audioTracks()?.map((t) => t.selected)).toEqual([false, false, false, true, false]);
    expect(player.selectAudio(5)).toBe(false);
    api.throws['setSelectTrack'] = 'InvalidValuesError';
    expect(player.selectAudio(1)).toBe(false);
    // No second route on AVPlay.
    expect(player.audioService()).toBeNull();
  });

  it("shows a text track and reports AVPlay's subtitle callback as cues", async () => {
    const { clock, api, player, events } = setup(() => ({ prepareAfterMs: 100, text: [{ lang: 'eng', codec: 'srt' }], cueEveryMs: 1000 }));
    player.open(VOD, { live: false });
    expect(player.textTracks()).toEqual([]);
    expect(player.showText(0)).toBe(false);
    await wait(clock, 400);
    expect(player.textTracks()?.map((t) => [t.index, t.lang, t.kind, t.selected])).toEqual([[0, 'eng', 'text', false]]);
    // Callbacks before a track is shown are no cues.
    api.fire('onsubtitlechange', '1000', 'too early', '0');
    expect(player.showText(0)).toBe(true);
    // Streams: video 0, audio 1, text 2.
    expect(api.calls.slice(-2)).toEqual(['setSelectTrack TEXT 2', 'setSilentSubtitle false']);
    expect(player.textTracks()?.map((t) => t.selected)).toEqual([true]);
    await wait(clock, 1000);
    // An empty text (the cue's end) is no cue either.
    api.fire('onsubtitlechange', '0', '', '0');
    expect(events.filter((e) => e.type === 'cue')).toEqual([{ type: 'cue', track: 0, text: 'English subtitle 00:05' }]);
    expect(player.showText(null)).toBe(true);
    expect(api.calls[api.calls.length - 1]).toBe('setSilentSubtitle true');
    expect(player.textTracks()?.map((t) => t.selected)).toEqual([false]);
    api.fire('onsubtitlechange', '1000', 'after', '0');
    expect(events.filter((e) => e.type === 'cue')).toHaveLength(1);
    expect(player.showText(4)).toBe(false);
    api.throws['setSelectTrack'] = 'InvalidValuesError';
    expect(player.showText(0)).toBe(false);
  });

  it('suspends and restores: live with no resume time, VOD at its position, playing again after', async () => {
    const live = setup();
    await openAndWait(live.player, LIVE, { live: true }, 10_000, live.clock);
    await wait(live.clock, 1000);
    live.player.suspend();
    expect(live.api.calls[live.api.calls.length - 1]).toBe('suspend');
    await wait(live.clock, 3000);
    const back = await new Promise<number>((resolve) => {
      const started = live.clock.t;
      const off = live.player.on((e) => {
        if (e.type === 'frame') {
          off();
          resolve(live.clock.t - started);
        }
      });
      live.player.resume();
      void wait(live.clock, 2000);
    });
    expect(live.api.calls[live.api.calls.length - 1]).toBe('restore');
    expect(back).toBe(350);

    const vod = setup();
    await openAndWait(vod.player, VOD, { live: false }, 10_000, vod.clock);
    await wait(vod.clock, 2000);
    vod.player.suspend();
    vod.player.resume();
    expect(vod.api.calls[vod.api.calls.length - 1]).toBe('restore null 2050');
    // A VOD file still at 0 (prepared, not yet playing): no resume time, never 0.
    const held = setup();
    held.player.prepare(VOD, { live: false });
    await wait(held.clock, 200);
    held.player.suspend();
    held.player.resume();
    expect(held.api.calls[held.api.calls.length - 1]).toBe('restore');
  });

  it('reports a refused suspend or restore, and does nothing before an open', async () => {
    const { clock, api, player, events } = setup();
    player.suspend();
    player.resume();
    expect(api.calls).toEqual([]);
    await openAndWait(player, LIVE, { live: true }, 10_000, clock);
    api.throws['suspend'] = 'InvalidStateError';
    player.suspend();
    api.throws['restore'] = 'InvalidStateError';
    player.resume();
    expect(events.slice(1)).toEqual([
      { type: 'error', error: { code: null, message: 'suspend: InvalidStateError, suspend refused', unsupported: false } },
      { type: 'error', error: { code: null, message: 'restore: InvalidStateError, restore refused', unsupported: false } },
    ]);
    // A refused restore watches for no frame.
    expect(clock.running).toBe(0);
  });

  it('closes the connection on stop, and on dispose also leaves the stage and its listeners', async () => {
    const { clock, api, stage, player, events } = setup();
    await openAndWait(player, LIVE, { live: true }, 10_000, clock);
    player.stop();
    expect(api.calls.slice(-2)).toEqual(['stop', 'close']);
    expect(api.state).toBe('NONE');
    // Stopped: Home and back no longer touch it.
    player.suspend();
    expect(api.calls.slice(-1)).toEqual(['close']);
    player.open(LIVE, { live: true });
    player.dispose();
    expect(api.calls.slice(-2)).toEqual(['stop', 'close']);
    expect(stage.removed).toBe(1);
    await wait(clock, 1000);
    expect(events).toEqual([{ type: 'frame' }]);
    expect(clock.running).toBe(0);
    // A stop refused (wrong state) still closes.
    const refused = setup();
    refused.api.throws['stop'] = 'InvalidStateError';
    refused.player.stop();
    expect(refused.api.calls).toEqual(['stop', 'close']);
  });

  it('prepares without playing (S8), and plays on start: now, or once prepared', async () => {
    const held = setup();
    const p: AvplayLabPlayer = held.player;
    p.prepare(LIVE, { live: true });
    await wait(held.clock, 500);
    expect(p.readiness()).toEqual({ prepared: true, ms: 100, error: null });
    expect(held.api.calls).not.toContain('play');
    expect(held.events).toEqual([]);
    const r = await new Promise<number>((resolve) => {
      const started = held.clock.t;
      p.on((e) => e.type === 'frame' && resolve(held.clock.t - started));
      p.start();
      void wait(held.clock, 1000);
    });
    expect(r).toBe(150);
    // A second start changes nothing.
    p.start();
    expect(held.api.calls.filter((c) => c === 'play')).toHaveLength(1);

    const early = setup(() => ({ prepareAfterMs: 400 }));
    early.player.prepare(LIVE, { live: true });
    early.player.start();
    expect(early.api.calls).not.toContain('play');
    await wait(early.clock, 600);
    expect(early.events).toEqual([{ type: 'frame' }]);
  });

  it('describes the engine, has no canPlayType, and captions on its stage', () => {
    const { api, stage, player } = setup();
    expect(player.kind).toBe('avplay');
    expect(player.canPlay('video/mp2t')).toBeNull();
    expect(player.describe()).toEqual({ engine: 'avplay', version: 'fake-avplay 1.0', state: 'NONE', apis: { seekTo: true, setSilentSubtitle: true, getVersion: true, restore: true } });
    const bare = createAvplayPlayer({ ...api, getVersion: undefined, seekTo: undefined, setSilentSubtitle: undefined, getState: () => 'NONE', restore: api.restore.bind(api) } as unknown as FakeAvplay, fakeAvplayStage());
    expect(bare.describe()).toMatchObject({ version: null, apis: { seekTo: false, setSilentSubtitle: false, getVersion: false } });
    player.caption('S4: live TS');
    expect(stage.captions).toEqual(['S4: live TS']);
  });
});

describe("AVPlay's stage", () => {
  /** Just enough of a document for the stage. */
  function fakeDocument(innerWidth: number) {
    const appended: Array<{ className: string; children: unknown[] }> = [];
    const element = (tag: string) => {
      const el = {
        tag,
        className: '',
        textContent: '',
        attributes: {} as Record<string, string>,
        children: [] as unknown[],
        parentNode: null as null | { removeChild(child: unknown): void },
        setAttribute: (name: string, value: string) => {
          el.attributes[name] = value;
        },
        appendChild: (child: { parentNode: unknown }) => {
          el.children.push(child);
          child.parentNode = el;
        },
        removeChild: (child: unknown) => {
          el.children = el.children.filter((c) => c !== child);
        },
        getBoundingClientRect: () => ({ left: 556, top: 278, width: 384, height: 216 }),
      };
      return el;
    };
    const body = element('body');
    const doc = {
      createElement: element,
      body: {
        appendChild: (child: { parentNode: unknown; className: string; children: unknown[] }) => {
          appended.push(child);
          body.appendChild(child);
        },
      },
      documentElement: { className: 'tv' },
      defaultView: { innerWidth },
    };
    return { doc: doc as unknown as Document, appended, body };
  }

  it('makes a hole with the AVPlay object, the page transparent, and a rect in 1920×1080', () => {
    const { doc, appended, body } = fakeDocument(960);
    const stage = mountAvplayStage(doc);
    const box = appended[0] as { className: string; children: Array<{ tag: string; attributes: Record<string, string>; className: string; textContent: string }> };
    expect(box.className).toBe('lab__player lab__player--avplay');
    expect(box.children[0]).toMatchObject({ tag: 'object', attributes: { type: 'application/avplayer' }, className: 'lab__video lab__avplay' });
    expect(doc.documentElement.className).toBe(`tv ${AVPLAY_PAGE_CLASS}`);
    // A 960-wide page is half of AVPlay's 1920.
    expect(stage.rect()).toEqual({ x: 1112, y: 556, width: 768, height: 432 });
    stage.caption('S4: live TS');
    expect(box.children[1]?.textContent).toBe('S4: live TS');
    stage.remove();
    expect(body.children).toEqual([]);
    expect(doc.documentElement.className).toBe('tv');
    // Twice is harmless.
    stage.remove();
  });

  it('keeps the scale at 1 without a window size', () => {
    const { doc } = fakeDocument(0);
    expect(mountAvplayStage(doc).rect()).toEqual({ x: 556, y: 278, width: 384, height: 216 });
  });
});
