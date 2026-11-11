import { describe, expect, it } from 'vitest';
import { PlayerController } from './controller';
import type { EngineEvent, EngineSource, PlaybackError } from './engine';
import { NO_STATS } from './engine';
import { FakeClock, settle } from './fake-engine';
import { FakeAudioTrack, FakeTextTrack, FakeVideo, audioTrackList, textTrackList } from './fake-video';
import type { Html5EngineOptions } from './html5-engine';
import {
  CONTAINER_MIME,
  FRAME_POLL_MS,
  Html5Engine,
  MEDIA_ERR_ABORTED,
  MEDIA_ERR_DECODE,
  MEDIA_ERR_NETWORK,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  NO_PICTURE_MS,
  createStageVideo,
  mediaError,
} from './html5-engine';
import { streamCandidates } from './request';

const TS: EngineSource = { url: 'http://panel.example/live/u/p/1.ts', container: 'ts', live: true };
const HLS: EngineSource = { url: 'http://panel.example/live/u/p/1.m3u8', container: 'hls', live: true };
const MP4: EngineSource = { url: 'http://panel.example/movie/u/p/7.mp4', container: 'mp4', live: false };
const MKV: EngineSource = { url: 'http://panel.example/movie/u/p/8.mkv', container: 'mkv', live: false };

type Seen = EngineEvent & { readonly token: number };

interface Rig {
  clock: FakeClock;
  video: FakeVideo;
  engine: Html5Engine;
  events: Seen[];
  /** `type token`, and the error's `kind/code`. */
  seen(): string[];
}

function rig(options: Html5EngineOptions = {}, setup?: (video: FakeVideo) => void): Rig {
  const clock = new FakeClock();
  const video = new FakeVideo(clock);
  setup?.(video);
  const engine = new Html5Engine(video, { clock, ...options });
  const events: Seen[] = [];
  engine.on((e) => events.push(e));
  return {
    clock,
    video,
    engine,
    events,
    seen: () => events.map((e) => (e.type === 'error' ? `error ${e.token} ${e.error.kind}/${e.error.code}` : `${e.type} ${e.token}`)),
  };
}

/** A load whose result the test doesn't need (a later stop rejects it). */
function quiet(p: Promise<void>): void {
  p.catch(() => undefined);
}

/** What a load's promise did so far. */
function track(p: Promise<void>): { state: string; error: PlaybackError | null } {
  const out: { state: string; error: PlaybackError | null } = { state: 'pending', error: null };
  p.then(
    () => {
      out.state = 'resolved';
    },
    (error: PlaybackError) => {
      out.state = 'rejected';
      out.error = error;
    },
  );
  return out;
}

/** The element starts playing as a browser would: the clock moves and the picture is known, then `playing` fires 10 ms later. */
async function startPlaying(r: Rig, picture = true): Promise<void> {
  r.video.move();
  if (picture) r.video.showPicture();
  await r.clock.advance(10);
  r.video.fire('playing');
}

describe('mediaError', () => {
  it('maps each MediaError code to a kind, keeping its name as the code', () => {
    expect(mediaError(MEDIA_ERR_ABORTED, 'maybe')).toEqual({ kind: 'network', code: 'MEDIA_ERR_ABORTED' });
    expect(mediaError(MEDIA_ERR_NETWORK, 'maybe')).toEqual({ kind: 'network', code: 'MEDIA_ERR_NETWORK' });
    expect(mediaError(MEDIA_ERR_DECODE, 'maybe')).toEqual({ kind: 'decode', code: 'MEDIA_ERR_DECODE' });
    expect(mediaError(7, null)).toEqual({ kind: 'network', code: 'MEDIA_ERR_7' });
  });

  it('calls "not supported" unsupported only when the element says it can\'t play the container', () => {
    expect(mediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, '')).toEqual({ kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
    // An HTTP error or a panel's error page looks the same: retried.
    expect(mediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, 'maybe')).toEqual({ kind: 'network', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
    expect(mediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, null)).toEqual({ kind: 'network', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
    // A decode error is a decode error whatever the element says.
    expect(mediaError(MEDIA_ERR_DECODE, '')).toEqual({ kind: 'decode', code: 'MEDIA_ERR_DECODE' });
  });

  it('trusts canPlayType for TS, HLS and MP4, never for MKV (the LG TV answers "" and plays it)', () => {
    expect(CONTAINER_MIME).toEqual({ ts: 'video/mp2t', hls: 'application/vnd.apple.mpegurl', mp4: 'video/mp4' });
  });
});

describe('Html5Engine: load and the first frame', () => {
  it('points the element at the URL, plays, and resolves at `playing`, not before', async () => {
    const r = rig();
    const load = track(r.engine.load(MP4, 1));
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play']);
    r.video.fire('loadedmetadata');
    await r.clock.advance(500);
    expect(load.state).toBe('pending');
    await startPlaying(r);
    await settle();
    expect(load.state).toBe('resolved');
  });

  it('sends firstFrame once the clock moved and the picture is known, once, with the load token', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 7));
    // `playing` before the clock moves: no frame yet.
    r.video.fire('playing');
    await r.clock.advance(200);
    expect(r.seen()).toEqual([]);
    r.video.move();
    await r.clock.advance(FRAME_POLL_MS);
    // The clock moves but there is no picture yet.
    expect(r.seen()).toEqual([]);
    r.video.showPicture();
    await r.clock.advance(FRAME_POLL_MS - 1);
    expect(r.seen()).toEqual([]);
    await r.clock.advance(1);
    expect(r.seen()).toEqual(['firstFrame 7']);
    expect(r.clock.pending).toBe(0);
    // Another `playing` (after a pause) sends nothing.
    r.video.fire('playing');
    await r.clock.advance(1000);
    expect(r.seen()).toEqual(['firstFrame 7']);
  });

  it('a picture with a clock that never moves is no frame', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 1));
    r.video.showPicture();
    r.video.fire('playing');
    await r.clock.advance(9000);
    expect(r.seen()).toEqual([]);
  });

  it('sound with no picture for 5 s of media is unsupported (NO_PICTURE), not a timeout', async () => {
    const r = rig();
    const load = track(r.engine.load(MP4, 3));
    await startPlaying(r, false);
    await r.clock.advance(NO_PICTURE_MS - FRAME_POLL_MS);
    expect(r.seen()).toEqual([]);
    await r.clock.advance(FRAME_POLL_MS);
    expect(load.state).toBe('resolved');
    expect(r.seen()).toEqual(['error 3 unsupported/NO_PICTURE']);
    expect(r.clock.pending).toBe(0);
    // The load is over: nothing more from it.
    r.video.showPicture();
    r.video.fire('playing');
    r.video.fire('ended');
    await r.clock.advance(1000);
    expect(r.seen()).toEqual(['error 3 unsupported/NO_PICTURE']);
  });

  it('takes the no-picture limit from the options', async () => {
    const r = rig({ noPictureMs: 1000 });
    quiet(r.engine.load(MP4, 1));
    await startPlaying(r, false);
    await r.clock.advance(1000);
    expect(r.seen()).toEqual(['error 1 unsupported/NO_PICTURE']);
  });

  it('starts VOD at `startMs` once the metadata is in, once; live ignores it', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 1, { startMs: 30_000 }));
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play']);
    r.video.fire('loadedmetadata');
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play', 'seek 30']);
    r.video.fire('loadedmetadata');
    expect(r.video.log.filter((l) => l.indexOf('seek') === 0)).toEqual(['seek 30']);
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    expect(r.engine.positionMs()).toBeCloseTo(30_060, 6);

    const live = rig();
    quiet(live.engine.load(HLS, 1, { startMs: 30_000 }));
    live.video.fire('loadedmetadata');
    expect(live.video.log).toEqual([`src ${HLS.url}`, 'play']);
    const zero = rig();
    quiet(zero.engine.load(MP4, 1, { startMs: 0 }));
    zero.video.fire('loadedmetadata');
    expect(zero.video.log).toEqual([`src ${MP4.url}`, 'play']);
  });

  it('says the tracks may have changed when the metadata arrives', () => {
    const r = rig();
    quiet(r.engine.load(MP4, 4));
    r.video.fire('loadedmetadata');
    expect(r.seen()).toEqual(['tracks 4']);
  });
});

describe('Html5Engine: errors', () => {
  it('rejects the load with the error before `playing`, and sends no event', async () => {
    const r = rig();
    const load = track(r.engine.load(MP4, 1));
    r.video.failWith(MEDIA_ERR_NETWORK);
    await r.clock.advance(20);
    r.video.fire('error');
    await settle();
    expect(load).toEqual({ state: 'rejected', error: { kind: 'network', code: 'MEDIA_ERR_NETWORK' } });
    expect(r.seen()).toEqual([]);
  });

  it('sends an error event after `playing`, once', async () => {
    const r = rig();
    const load = track(r.engine.load(MP4, 2));
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    r.video.failWith(MEDIA_ERR_DECODE);
    r.video.fire('error');
    r.video.fire('error');
    await settle();
    expect(load.state).toBe('resolved');
    expect(r.seen()).toEqual(['firstFrame 2', 'error 2 decode/MEDIA_ERR_DECODE']);
  });

  it('asks canPlayType for the container: TS the desktop can\'t play is unsupported, HLS it says it can is a network error', async () => {
    const r = rig();
    r.video.canPlay = { 'application/vnd.apple.mpegurl': 'maybe' };
    const ts = track(r.engine.load(TS, 1));
    r.video.failWith(MEDIA_ERR_SRC_NOT_SUPPORTED);
    r.video.fire('error');
    await settle();
    expect(ts.error).toEqual({ kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
    await r.engine.stop();
    const hls = track(r.engine.load(HLS, 2));
    r.video.failWith(MEDIA_ERR_SRC_NOT_SUPPORTED);
    r.video.fire('error');
    await settle();
    expect(hls.error).toEqual({ kind: 'network', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
  });

  it('never trusts canPlayType for MKV', async () => {
    const r = rig();
    const mkv = track(r.engine.load(MKV, 1));
    r.video.failWith(MEDIA_ERR_SRC_NOT_SUPPORTED);
    r.video.fire('error');
    await settle();
    expect(mkv.error).toEqual({ kind: 'network', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
  });

  it('ignores an error event with no error on the element', async () => {
    const r = rig();
    const load = track(r.engine.load(MP4, 1));
    r.video.fire('error');
    await settle();
    expect(load.state).toBe('pending');
  });
});

describe('Html5Engine: buffering and the end', () => {
  it('sends buffering and playing around a wait, only after the first frame', async () => {
    const r = rig();
    quiet(r.engine.load(HLS, 5));
    // A wait before the first frame is the open, not a stall.
    r.video.fire('waiting');
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    r.video.freeze();
    await r.clock.advance(30);
    r.video.fire('waiting');
    r.video.fire('waiting');
    r.video.move();
    await r.clock.advance(30);
    r.video.fire('playing');
    r.video.fire('playing');
    expect(r.seen()).toEqual(['firstFrame 5', 'buffering 5', 'playing 5']);
  });

  it('sends ended', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 6));
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    r.video.freeze();
    r.video.fire('ended');
    expect(r.seen()).toEqual(['firstFrame 6', 'ended 6']);
  });
});

describe('Html5Engine: stop', () => {
  it('closes the connection: pause, drop src, load nothing; a pending load rejects ABORTED', async () => {
    const r = rig();
    const load = track(r.engine.load(HLS, 1));
    r.video.log.length = 0;
    await r.engine.stop();
    expect(r.video.log).toEqual(['pause', 'removeAttribute src', 'load']);
    expect(r.video.src).toBe('');
    expect(load).toEqual({ state: 'rejected', error: { kind: 'app', code: 'ABORTED' } });
  });

  it('touches nothing when nothing is loaded, and closes only once', async () => {
    const r = rig();
    await r.engine.stop();
    expect(r.video.log).toEqual([]);
    quiet(r.engine.load(HLS, 1));
    await r.engine.stop();
    await r.engine.stop();
    expect(r.video.log).toEqual([`src ${HLS.url}`, 'play', 'pause', 'removeAttribute src', 'load']);
  });

  it('drops every event of a stopped load, and its first-frame poll', async () => {
    const r = rig();
    quiet(r.engine.load(HLS, 1));
    await startPlaying(r);
    await r.engine.stop();
    expect(r.clock.pending).toBe(0);
    r.video.move();
    r.video.showPicture();
    for (const type of ['loadedmetadata', 'playing', 'waiting', 'ended']) r.video.fire(type);
    r.video.failWith(MEDIA_ERR_NETWORK);
    r.video.fire('error');
    await r.clock.advance(1000);
    expect(r.seen()).toEqual([]);
  });

  it('a load without a stop replaces the old one: it rejects ABORTED and its poll stops', async () => {
    const r = rig();
    const first = track(r.engine.load(MP4, 1));
    const second = track(r.engine.load(HLS, 2));
    await settle();
    expect(first).toEqual({ state: 'rejected', error: { kind: 'app', code: 'ABORTED' } });
    expect(second.state).toBe('pending');
    r.video.fire('playing');
    expect(r.clock.pending).toBe(1);
    quiet(r.engine.load(MP4, 3));
    expect(r.clock.pending).toBe(0);
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    expect(second.state).toBe('resolved');
    expect(r.seen()).toEqual(['firstFrame 3']);
  });
});

describe('Html5Engine: autoplay', () => {
  it('plays muted when the browser refuses sound before a key press', async () => {
    const r = rig();
    let calls = 0;
    r.video.playResult = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' })) : Promise.resolve();
    };
    quiet(r.engine.load(HLS, 1));
    await settle();
    expect(r.video.muted).toBe(true);
    expect(r.video.log).toEqual([`src ${HLS.url}`, 'play', 'play']);
  });

  it('does not retry when already muted, or for other refusals', async () => {
    const muted = rig();
    muted.video.muted = true;
    muted.video.playResult = () => Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
    quiet(muted.engine.load(HLS, 1));
    await settle();
    expect(muted.video.log).toEqual([`src ${HLS.url}`, 'play']);

    for (const name of ['AbortError', 'NotSupportedError']) {
      const other = rig();
      other.video.playResult = () => Promise.reject(Object.assign(new Error('refused'), { name }));
      quiet(other.engine.load(HLS, 1));
      await settle();
      expect(other.video.muted).toBe(false);
      expect(other.video.log).toEqual([`src ${HLS.url}`, 'play']);
    }
  });

  it('copes with an old engine whose play() returns nothing, and a muted retry that is refused', async () => {
    const r = rig();
    r.video.playResult = () => undefined;
    const load = track(r.engine.load(HLS, 1));
    await settle();
    expect(r.video.log).toEqual([`src ${HLS.url}`, 'play']);
    expect(load.state).toBe('pending');
    const twice = rig();
    twice.video.playResult = () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    quiet(twice.engine.load(HLS, 1));
    await settle();
    await settle();
    expect(twice.video.log).toEqual([`src ${HLS.url}`, 'play', 'play']);
  });
});

describe('Html5Engine: play, pause, seek, rect, stats, position', () => {
  it('play() plays only with a load, pause() pauses, seek() sets the clock', async () => {
    const r = rig();
    r.engine.play();
    expect(r.video.log).toEqual([]);
    quiet(r.engine.load(MP4, 1));
    r.engine.pause();
    r.engine.play();
    await r.engine.seek(12_500);
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play', 'pause', 'play', 'seek 12.5']);
    expect(r.engine.positionMs()).toBe(12_500);
  });

  it("gives the element's duration in ms (RELAY step 26c), and 0 before the metadata and for a live stream", () => {
    const r = rig();
    expect(r.engine.durationMs()).toBe(0);
    r.video.duration = 5400.5;
    expect(r.engine.durationMs()).toBe(5_400_500);
    r.video.duration = Infinity;
    expect(r.engine.durationMs()).toBe(0);
    r.video.duration = 0;
    expect(r.engine.durationMs()).toBe(0);
  });

  it('places the picture in pixels, or fills the stage', () => {
    const r = rig();
    r.engine.setRect({ x: 1200.4, y: 80, width: 640, height: 360.6 });
    expect(r.video.style).toEqual({ left: '1200px', top: '80px', width: '640px', height: '361px', objectFit: '' });
    r.engine.setRect('full');
    expect(r.video.style).toEqual({ left: '0', top: '0', width: '100%', height: '100%', objectFit: '' });
  });

  it('does every fit through object-fit, and keeps it across loads', async () => {
    const r = rig();
    expect(r.engine.caps.fits).toEqual(['contain', 'fill', 'cover']);
    r.engine.setFit('cover');
    expect(r.video.style.objectFit).toBe('cover');
    quiet(r.engine.load(MP4, 1));
    await r.engine.stop();
    expect(r.video.style.objectFit).toBe('cover');
    r.engine.setFit('fill');
    expect(r.video.style.objectFit).toBe('fill');
    r.engine.setFit('contain');
    expect(r.video.style.objectFit).toBe('contain');
  });

  it('reports the picture size, and the frames and bytes where the element counts them', () => {
    const r = rig();
    r.video.showPicture(960, 540);
    // An element with no counters: the size only, and no codec or declared bitrate ever.
    expect(r.engine.stats()).toEqual({ ...NO_STATS, width: 960, height: 540 });
    // Chromium's own counters (old engines have no getVideoPlaybackQuality).
    r.video.webkitDecodedFrameCount = 250;
    r.video.webkitDroppedFrameCount = 2;
    r.video.webkitVideoDecodedByteCount = 900_000;
    expect(r.engine.stats()).toEqual({ ...NO_STATS, width: 960, height: 540, droppedFrames: 2, decodedFrames: 250, decodedBytes: 900_000 });
    r.video.webkitAudioDecodedByteCount = 100_000;
    expect(r.engine.stats().decodedBytes).toBe(1_000_000);
    r.video.webkitVideoDecodedByteCount = undefined;
    expect(r.engine.stats().decodedBytes).toBe(100_000);
    // getVideoPlaybackQuality wins where it exists; an old one without totalVideoFrames leaves the frames to Chromium's counter.
    r.video.getVideoPlaybackQuality = () => ({ droppedVideoFrames: 3 });
    expect(r.engine.stats()).toMatchObject({ droppedFrames: 3, decodedFrames: 250 });
    r.video.getVideoPlaybackQuality = () => ({ droppedVideoFrames: 4, totalVideoFrames: 300 });
    expect(r.engine.stats()).toMatchObject({ droppedFrames: 4, decodedFrames: 300 });
  });

  it('declares one engine of kind html5 with no preload and one rate', () => {
    const r = rig({ maxHeight: 1080 });
    expect(r.engine.kind).toBe('html5');
    expect(r.engine.caps).toEqual({ maxHeight: 1080, trackSwitch: 'none', deliversSubtitleText: false, preloadSlots: 0, rates: [1], fits: ['contain', 'fill', 'cover'] });
    expect(rig().engine.caps.maxHeight).toBe(2160);
  });
});

/** ara, eng and spa, ara on. */
function threeTracks(stuck = false): FakeAudioTrack[] {
  return [new FakeAudioTrack('ara', 'Arabic', true, stuck), new FakeAudioTrack('eng', 'English', false, stuck), new FakeAudioTrack('spa', '', false, stuck)];
}

describe('Html5Engine: tracks (S5: audioTracks first, then the platform service)', () => {
  it('says how it switches audio: the element\'s list, the platform service, or not at all', () => {
    expect(rig({}, (v) => (v.audioTracks = audioTrackList(threeTracks()))).engine.caps.trackSwitch).toBe('reliable');
    expect(rig({ selectAudioTrack: () => Promise.resolve() }).engine.caps.trackSwitch).toBe('unreliable');
    expect(rig({ selectAudioTrack: null }).engine.caps.trackSwitch).toBe('none');
  });

  it('lists the audio and text tracks by their place in the element\'s lists', () => {
    const r = rig({}, (v) => {
      v.audioTracks = audioTrackList(threeTracks());
      v.textTracks = textTrackList([new FakeTextTrack('ar', 'عربي', 'showing'), new FakeTextTrack('en', 'English')]);
    });
    expect(r.engine.getTracks()).toEqual({
      audio: [
        { id: '0', lang: 'ara', label: 'Arabic', selected: true },
        { id: '1', lang: 'eng', label: 'English', selected: false },
        { id: '2', lang: 'spa', label: '', selected: false },
      ],
      text: [
        { id: '0', lang: 'ar', label: 'عربي', selected: true },
        { id: '1', lang: 'en', label: 'English', selected: false },
      ],
    });
    expect(rig().engine.getTracks()).toEqual({ audio: [], text: [] });
  });

  it('switches audio with the new track on before the others go off', async () => {
    const list = audioTrackList(threeTracks());
    const r = rig({}, (v) => (v.audioTracks = list));
    expect(await r.engine.selectAudio('1')).toBe(true);
    expect(list.writes).toEqual(['eng=true', 'ara=false', 'spa=false']);
    expect(r.engine.getTracks().audio.map((t) => t.selected)).toEqual([false, true, false]);
    for (const bad of ['3', '-1', '1.5', '', 'x']) expect(await r.engine.selectAudio(bad)).toBe(false);
  });

  it('falls back to the platform service by mediaId when the element ignores the switch', async () => {
    const calls: string[] = [];
    const service = (mediaId: string, index: number): Promise<unknown> => {
      calls.push(`${mediaId} ${index}`);
      return Promise.resolve({ returnValue: true });
    };
    const r = rig({ selectAudioTrack: service }, (v) => {
      v.audioTracks = audioTrackList(threeTracks(true));
      v.mediaId = '_abc';
    });
    expect(await r.engine.selectAudio('2')).toBe(true);
    expect(calls).toEqual(['_abc 2']);
    // A switch the element takes never reaches the service.
    const ok = rig({ selectAudioTrack: service }, (v) => {
      v.audioTracks = audioTrackList(threeTracks());
      v.mediaId = '_abc';
    });
    expect(await ok.engine.selectAudio('1')).toBe(true);
    expect(calls).toEqual(['_abc 2']);
  });

  it('uses the service when the element has no list; false when it refuses, or with no mediaId or service', async () => {
    const calls: number[] = [];
    const service = (_id: string, index: number): Promise<unknown> => {
      calls.push(index);
      return Promise.resolve();
    };
    const r = rig({ selectAudioTrack: service }, (v) => (v.mediaId = '_m'));
    expect(await r.engine.selectAudio('4')).toBe(true);
    expect(calls).toEqual([4]);
    // A bad id never reaches the service.
    for (const bad of ['-1', '1.5', 'x', '']) expect(await r.engine.selectAudio(bad)).toBe(false);
    expect(calls).toEqual([4]);
    const refused = rig({ selectAudioTrack: () => Promise.reject(new Error('denied')) }, (v) => (v.mediaId = '_m'));
    expect(await refused.engine.selectAudio('1')).toBe(false);
    const noId = rig({ selectAudioTrack: () => Promise.resolve() });
    expect(await noId.engine.selectAudio('1')).toBe(false);
    const emptyId = rig({ selectAudioTrack: () => Promise.resolve() }, (v) => (v.mediaId = ''));
    expect(await emptyId.engine.selectAudio('1')).toBe(false);
    const stuckNoService = rig({}, (v) => {
      v.audioTracks = audioTrackList(threeTracks(true));
      v.mediaId = '_m';
    });
    expect(await stuckNoService.engine.selectAudio('1')).toBe(false);
  });

  it('shows one text track, or none', async () => {
    const tracks = [new FakeTextTrack('ar', 'Arabic'), new FakeTextTrack('en', 'English', 'showing')];
    const r = rig({}, (v) => (v.textTracks = textTrackList(tracks)));
    expect(await r.engine.selectText('0')).toBe(true);
    expect(tracks.map((t) => t.mode)).toEqual(['showing', 'disabled']);
    expect(await r.engine.selectText(null)).toBe(true);
    expect(tracks.map((t) => t.mode)).toEqual(['disabled', 'disabled']);
    expect(await r.engine.selectText('5')).toBe(false);
    expect(await r.engine.selectText('x')).toBe(false);
    expect(await rig().engine.selectText('0')).toBe(false);
    expect(await rig().engine.selectText(null)).toBe(true);
  });

  it('says the tracks changed when the element\'s audio list changes, while a load is on', () => {
    const list = audioTrackList(threeTracks());
    const r = rig({}, (v) => (v.audioTracks = list));
    list.fire('addtrack');
    expect(r.seen()).toEqual([]);
    quiet(r.engine.load(MP4, 9));
    list.fire('addtrack');
    list.fire('removetrack');
    list.fire('change');
    expect(r.seen()).toEqual(['tracks 9', 'tracks 9', 'tracks 9']);
  });
});

describe('Html5Engine: suspend and resume (webOS stops a hidden app\'s media)', () => {
  it('closes VOD and reopens it where it was, with a new first frame', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 1, { startMs: 10_000 }));
    r.video.fire('loadedmetadata');
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS + 1940);
    r.video.log.length = 0;
    r.engine.suspend();
    r.engine.suspend();
    expect(r.video.log).toEqual(['pause', 'removeAttribute src', 'load']);
    // Nothing plays while suspended.
    r.engine.play();
    expect(r.video.log).toEqual(['pause', 'removeAttribute src', 'load']);
    r.engine.resume();
    r.engine.resume();
    expect(r.video.log).toEqual(['pause', 'removeAttribute src', 'load', `src ${MP4.url}`, 'play']);
    r.video.fire('loadedmetadata');
    expect(r.video.log[r.video.log.length - 1]).toBe('seek 12');
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    expect(r.seen()).toEqual(['tracks 1', 'firstFrame 1', 'tracks 1', 'firstFrame 1']);
  });

  it('keeps the requested start when suspended before anything played', () => {
    const r = rig();
    quiet(r.engine.load(MP4, 1, { startMs: 10_000 }));
    r.engine.suspend();
    r.engine.resume();
    r.video.fire('loadedmetadata');
    expect(r.video.log[r.video.log.length - 1]).toBe('seek 10');
  });

  it('reopens live at the live edge', async () => {
    const r = rig();
    quiet(r.engine.load(HLS, 1));
    await startPlaying(r);
    await r.clock.advance(3000);
    r.engine.suspend();
    r.engine.resume();
    r.video.fire('loadedmetadata');
    expect(r.video.log.filter((l) => l.indexOf('seek') === 0)).toEqual([]);
  });

  it('does nothing with no load, a failed one, or when not suspended', async () => {
    const r = rig();
    r.engine.suspend();
    r.engine.resume();
    expect(r.video.log).toEqual([]);
    quiet(r.engine.load(MP4, 1));
    r.engine.resume();
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play']);
    r.video.failWith(MEDIA_ERR_NETWORK);
    r.video.fire('error');
    await settle();
    r.engine.suspend();
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play']);
  });

  it('stops the first-frame poll while suspended', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 1));
    r.video.fire('playing');
    r.engine.suspend();
    expect(r.clock.pending).toBe(0);
  });
});

describe('Html5Engine: listeners and destroy', () => {
  it('removes a listener', async () => {
    const r = rig();
    const other: string[] = [];
    const off = r.engine.on((e) => other.push(e.type));
    quiet(r.engine.load(MP4, 1));
    r.video.fire('loadedmetadata');
    off();
    r.video.fire('loadedmetadata');
    expect(other).toEqual(['tracks']);
    await settle();
  });

  it('lets go of the element and refuses later loads', async () => {
    const list = audioTrackList(threeTracks());
    const r = rig({}, (v) => (v.audioTracks = list));
    expect(r.video.listenerCount).toBe(5);
    expect(Object.keys(list.listeners).map((type) => `${type} ${list.listeners[type]!.length}`)).toEqual(['addtrack 1', 'removetrack 1', 'change 1']);
    const load = track(r.engine.load(MP4, 1));
    r.engine.destroy();
    await settle();
    expect(load.state).toBe('rejected');
    expect(r.video.log).toEqual([`src ${MP4.url}`, 'play', 'pause', 'removeAttribute src', 'load']);
    expect(r.video.listenerCount).toBe(0);
    expect(Object.keys(list.listeners).map((type) => `${type} ${list.listeners[type]!.length}`)).toEqual(['addtrack 0', 'removetrack 0', 'change 0']);
    await expect(r.engine.load(MP4, 2)).rejects.toEqual({ kind: 'app', code: 'DESTROYED' });
    expect(r.video.log).toHaveLength(5);
  });
});

describe('Html5Engine with the PlayerController (the desktop flow)', () => {
  it('a live .ts URL the browser can\'t play moves to .m3u8 at once, which plays and is remembered', async () => {
    const clock = new FakeClock();
    const video = new FakeVideo(clock);
    video.canPlay = { 'application/vnd.apple.mpegurl': 'maybe', 'video/mp4': 'maybe' };
    const engine = new Html5Engine(video, { clock });
    const player = new PlayerController(engine, { clock });
    const states: string[] = [];
    player.subscribe((s) => states.push(`${s.state} ${s.container ?? '-'}`));
    const req = { key: 's1:live:1', src: 's1', mode: 'live' as const, candidates: streamCandidates('http://panel.example/live/u/p/1.ts', 'live') };
    void player.play(req);
    await settle();
    expect(video.src).toBe('http://panel.example/live/u/p/1.ts');
    video.failWith(MEDIA_ERR_SRC_NOT_SUPPORTED);
    video.fire('error');
    await settle();
    await settle();
    expect(video.src).toBe('http://panel.example/live/u/p/1.m3u8');
    video.move();
    video.showPicture();
    video.fire('playing');
    await clock.advance(FRAME_POLL_MS);
    expect(states).toEqual(['opening ts', 'opening hls', 'playing hls']);
    expect(player.status.attempt).toBe(0);
    // The next play of the source starts with HLS.
    await player.stop();
    void player.play(req);
    await settle();
    expect(video.src).toBe('http://panel.example/live/u/p/1.m3u8');
  });
});

describe('createStageVideo', () => {
  it('puts one inline <video> filling the stage', () => {
    const made: Array<{ tag: string; attrs: Record<string, string>; style: Record<string, string> }> = [];
    const children: unknown[] = [];
    const stage = {
      ownerDocument: {
        createElement(tag: string) {
          const el = { tag, attrs: {} as Record<string, string>, style: {} as Record<string, string>, setAttribute: (k: string, v: string) => (el.attrs[k] = v) };
          made.push(el);
          return el;
        },
      },
      appendChild: (child: unknown) => children.push(child),
    } as unknown as HTMLElement;
    const video = createStageVideo(stage);
    expect(children).toEqual([video]);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      tag: 'video',
      attrs: { playsinline: '', 'data-testid': 'player-video' },
      style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' },
    });
  });
});

describe('Html5Engine: a failed load stays failed', () => {
  it('a `playing` after an error before it starts no first-frame poll', async () => {
    const r = rig();
    const load = track(r.engine.load(MP4, 1));
    r.video.failWith(MEDIA_ERR_NETWORK);
    r.video.fire('error');
    await settle();
    expect(load.state).toBe('rejected');
    await startPlaying(r);
    expect(r.clock.pending).toBe(0);
    await r.clock.advance(1000);
    expect(r.seen()).toEqual([]);
  });

  it('an error between `playing` and the first frame stops the poll', async () => {
    const r = rig();
    quiet(r.engine.load(MP4, 2));
    await startPlaying(r, false);
    expect(r.clock.pending).toBe(1);
    r.video.failWith(MEDIA_ERR_DECODE);
    r.video.fire('error');
    expect(r.clock.pending).toBe(0);
    r.video.showPicture();
    await r.clock.advance(1000);
    expect(r.seen()).toEqual(['error 2 decode/MEDIA_ERR_DECODE']);
  });

  it('a wait right after resume (before the new first frame) is the open, not a stall', async () => {
    const r = rig();
    quiet(r.engine.load(HLS, 1));
    await startPlaying(r);
    await r.clock.advance(FRAME_POLL_MS);
    r.engine.suspend();
    r.engine.resume();
    r.video.fire('waiting');
    expect(r.seen()).toEqual(['firstFrame 1']);
  });

  it('a muted retry whose play() returns nothing is fine', async () => {
    const r = rig();
    let calls = 0;
    r.video.playResult = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' })) : undefined;
    };
    quiet(r.engine.load(HLS, 1));
    await settle();
    expect(r.video.muted).toBe(true);
    expect(r.video.log).toEqual([`src ${HLS.url}`, 'play', 'play']);
  });
});
