import { describe, expect, it } from 'vitest';
import type { LabPlayerEvent } from './player';
import type { VideoEnv, VideoLike } from './video-player';
import { FRAME_POLL_MS, createVideoPlayer } from './video-player';

interface FakeAudioTrack {
  id: string;
  kind: string;
  label: string;
  language: string;
  enabled: boolean;
}

class FakeTextTrack extends EventTarget {
  mode: TextTrackMode = 'disabled';
  activeCues: Array<{ text: string }> | null = null;
  constructor(
    readonly id: string,
    readonly language: string,
    readonly label = '',
    readonly kind = 'subtitles',
  ) {
    super();
  }
  cue(text: string): void {
    this.activeCues = [{ text }];
    this.dispatchEvent(new Event('cuechange'));
  }
}

/** Just enough of an HTMLVideoElement: the test moves its clock and fires its events. */
class FakeVideo extends EventTarget {
  src = '';
  currentTime = 0;
  paused = true;
  readyState = 0;
  networkState = 0;
  videoWidth = 0;
  videoHeight = 0;
  error: { code: number; message: string } | null = null;
  muted = false;
  loads = 0;
  plays = 0;
  textTracks: FakeTextTrack[] = [];
  audioTracks?: FakeAudioTrack[];
  getVideoPlaybackQuality?: () => { totalVideoFrames: number };
  webkitDecodedFrameCount?: number;
  /** What `play()` answers, in order; then a resolved promise. */
  playAnswers: Array<Promise<void>> = [];
  canPlay: Record<string, string> = {};
  removed: string[] = [];
  canPlayType(mime: string): string {
    return this.canPlay[mime] ?? '';
  }
  play(): Promise<void> {
    this.plays += 1;
    this.paused = false;
    return this.playAnswers.shift() ?? Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {
    this.loads += 1;
  }
  removeAttribute(name: string): void {
    this.removed.push(name);
    if (name === 'src') this.src = '';
  }
  fire(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

/** Timers the test runs by hand. */
function handTimers() {
  const intervals = new Map<number, () => void>();
  let next = 1;
  return {
    timers: {
      setInterval: (handler: () => void) => {
        intervals.set(next, handler);
        return next++;
      },
      clearInterval: (id: number) => {
        intervals.delete(id);
      },
    },
    tick: () => {
      for (const handler of Array.from(intervals.values())) handler();
    },
    get count() {
      return intervals.size;
    },
  };
}

function setup(over: Partial<VideoEnv> = {}) {
  const video = new FakeVideo();
  const stage = { captions: [] as string[], removed: 0, caption: (text: string) => stage.captions.push(text), remove: () => (stage.removed += 1) };
  const clock = handTimers();
  const player = createVideoPlayer(video as unknown as VideoLike, stage, { timers: clock.timers, mediaSource: null, ...over });
  const events: LabPlayerEvent[] = [];
  player.on((event) => events.push(event));
  return { video, stage, clock, player, events };
}

/** The element starts showing a picture: metadata, `playing`, then the clock moves. */
function startPicture(video: FakeVideo, width = 960, height = 540): void {
  video.readyState = 4;
  video.fire('loadstart');
  video.fire('loadedmetadata');
  video.fire('playing');
  video.videoWidth = width;
  video.videoHeight = height;
  video.currentTime += 0.04;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the <video> player', () => {
  it('opens a URL and calls the first frame once the picture has a size and the clock moved after playing', () => {
    const { video, clock, player, events } = setup();
    player.open('http://lab/live.ts', { live: true });
    expect(video.src).toBe('http://lab/live.ts');
    expect(video.plays).toBe(1);
    expect(clock.count).toBe(1);
    clock.tick();
    video.fire('loadstart');
    video.fire('playing');
    clock.tick();
    expect(events).toEqual([]);
    // Sound alone: the clock moves, no picture.
    video.currentTime = 1.5;
    clock.tick();
    expect(events).toEqual([]);
    video.videoWidth = 960;
    video.videoHeight = 540;
    clock.tick();
    expect(events).toEqual([{ type: 'frame' }]);
    // Once per open: the poll stops.
    expect(clock.count).toBe(0);
    expect(player.snapshot()).toMatchObject({ positionMs: 1500, width: 960, height: 540, paused: false, muted: false, error: null });
    expect(FRAME_POLL_MS).toBe(50);
  });

  it('waits for `playing`: a size and a moving clock before it (a preroll) are no frame yet', () => {
    const { video, clock, player, events } = setup();
    player.open('http://lab/a.mp4', { live: false });
    video.videoWidth = 640;
    video.currentTime = 0.3;
    clock.tick();
    expect(events).toEqual([]);
    video.fire('playing');
    video.fire('playing');
    clock.tick();
    expect(events).toEqual([]);
    video.currentTime = 0.34;
    clock.tick();
    expect(events).toEqual([{ type: 'frame' }]);
  });

  it('times from the first `playing`: a later one (after a wait) does not start the count again', () => {
    const { video, clock, player, events } = setup();
    player.open('http://lab/a.ts', { live: true });
    video.fire('playing');
    video.currentTime = 0.5;
    video.fire('waiting');
    video.fire('playing');
    video.videoWidth = 960;
    clock.tick();
    expect(events).toEqual([{ type: 'waiting' }, { type: 'frame' }]);
  });

  it('needs the clock to move after `playing`: a picture size alone is not a frame on screen', () => {
    const { video, clock, player, events } = setup();
    player.open('http://lab/a.mp4', { live: false });
    video.videoWidth = 640;
    video.currentTime = 0.5;
    video.fire('playing');
    clock.tick();
    expect(events).toEqual([]);
    video.currentTime = 0.54;
    clock.tick();
    expect(events).toEqual([{ type: 'frame' }]);
  });

  it('closes the old stream before the next one, and stop() drops the source and loads nothing', () => {
    const { video, player } = setup();
    player.open('http://lab/1.ts', { live: true });
    expect(video.removed).toEqual(['src']);
    expect(video.loads).toBe(1);
    player.open('http://lab/2.ts', { live: true });
    expect(video.removed).toEqual(['src', 'src']);
    expect(video.loads).toBe(2);
    expect(video.src).toBe('http://lab/2.ts');
    player.stop();
    expect(video.src).toBe('');
    expect(video.paused).toBe(true);
    expect(video.loads).toBe(3);
  });

  it('starts a VOD file at its position once the metadata is in', () => {
    const { video, player } = setup();
    player.open('http://lab/a.mp4', { live: false, startMs: 12_500 });
    expect(video.currentTime).toBe(0);
    video.fire('loadedmetadata');
    expect(video.currentTime).toBe(12.5);
    // Only once: a later metadata event leaves the position alone.
    video.currentTime = 20;
    video.fire('loadedmetadata');
    expect(video.currentTime).toBe(20);
  });

  it('plays muted when the browser refuses sound before a key press, and says so', async () => {
    const { video, player } = setup();
    const refused = Object.assign(new Error('play() needs a gesture'), { name: 'NotAllowedError' });
    video.playAnswers = [Promise.reject(refused)];
    player.open('http://lab/a.m3u8', { live: true });
    await flush();
    expect(video.muted).toBe(true);
    expect(video.plays).toBe(2);
    expect(player.snapshot().muted).toBe(true);
  });

  it('leaves other play() failures alone', async () => {
    const { video, player } = setup();
    video.playAnswers = [Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))];
    player.open('http://lab/a.m3u8', { live: true });
    await flush();
    expect([video.muted, video.plays, player.snapshot().muted]).toEqual([false, 1, false]);
  });

  it('reports the element errors of an open stream, with code 4 as unsupported', () => {
    const { video, player, events } = setup();
    player.open('http://lab/a.ts', { live: true });
    video.error = { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' };
    video.fire('error');
    expect(events).toEqual([{ type: 'error', error: { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED: DEMUXER_ERROR_COULD_NOT_OPEN', unsupported: true } }]);
    video.error = { code: 2, message: '' };
    video.fire('error');
    expect(events[1]).toEqual({ type: 'error', error: { code: 2, message: 'MEDIA_ERR_NETWORK', unsupported: false } });
    video.error = { code: 3, message: 'PIPELINE_ERROR_DECODE' };
    expect(player.snapshot().error).toEqual({ code: 3, message: 'MEDIA_ERR_DECODE: PIPELINE_ERROR_DECODE', unsupported: false });
    video.error = { code: 7, message: '' };
    expect(player.snapshot().error).toEqual({ code: 7, message: 'code 7', unsupported: false });
    video.error = { code: 2, message: '' };
    expect(player.snapshot().error).toEqual({ code: 2, message: 'MEDIA_ERR_NETWORK', unsupported: false });
    // After stop, the element's own error (no source) isn't the battery's business.
    player.stop();
    video.fire('error');
    expect(events).toHaveLength(2);
  });

  it('passes on waiting and ended, and calls a second load after the first frame a restart', () => {
    const { video, clock, player, events } = setup();
    player.open('http://lab/a.mp4', { live: false });
    video.fire('loadstart');
    video.fire('loadstart');
    startPicture(video);
    clock.tick();
    video.fire('waiting');
    video.fire('ended');
    video.fire('loadstart');
    expect(events.map((e) => e.type)).toEqual(['frame', 'waiting', 'ended', 'restart']);
    // A new open starts counting again.
    player.open('http://lab/b.mp4', { live: false });
    video.fire('loadstart');
    expect(events.map((e) => e.type)).toEqual(['frame', 'waiting', 'ended', 'restart']);
  });

  it('lists the audio tracks and enables exactly the chosen one', () => {
    const { video, player } = setup();
    expect(player.audioTracks()).toBeNull();
    expect(player.selectAudio(0)).toBe(false);
    video.audioTracks = [
      { id: '2', kind: 'main', label: 'العربية', language: 'ara', enabled: true },
      { id: '3', kind: 'main', label: 'English', language: 'eng', enabled: false },
      { id: '4', kind: 'main', label: '', language: 'spa', enabled: false },
    ];
    expect(player.audioTracks()).toEqual([
      { index: 0, id: '2', lang: 'ara', label: 'العربية', kind: 'main', selected: true },
      { index: 1, id: '3', lang: 'eng', label: 'English', kind: 'main', selected: false },
      { index: 2, id: '4', lang: 'spa', label: '', kind: 'main', selected: false },
    ]);
    expect(player.selectAudio(2)).toBe(true);
    expect(video.audioTracks.map((t) => t.enabled)).toEqual([false, false, true]);
    expect(player.selectAudio(3)).toBe(false);
    expect(player.selectAudio(-1)).toBe(false);
    expect(video.audioTracks.map((t) => t.enabled)).toEqual([false, false, true]);
  });

  it('shows one text track and passes on its cues until another is shown or the stream stops', () => {
    const { video, player, events } = setup();
    const ara = new FakeTextTrack('1', 'ara', 'Arabic');
    const eng = new FakeTextTrack('2', 'eng');
    video.textTracks = [ara, eng];
    expect(player.textTracks()).toEqual([
      { index: 0, id: '1', lang: 'ara', label: 'Arabic', kind: 'subtitles', selected: false },
      { index: 1, id: '2', lang: 'eng', label: '', kind: 'subtitles', selected: false },
    ]);
    player.open('http://lab/a.mkv', { live: false });
    expect(player.showText(1)).toBe(true);
    expect([ara.mode, eng.mode]).toEqual(['disabled', 'showing']);
    expect(player.textTracks()?.map((t) => t.selected)).toEqual([false, true]);
    eng.cue('English subtitle 00:05');
    eng.activeCues = [];
    eng.dispatchEvent(new Event('cuechange'));
    ara.cue('not shown');
    expect(events).toEqual([{ type: 'cue', track: 1, text: 'English subtitle 00:05' }]);
    expect(player.showText(0)).toBe(true);
    eng.cue('no longer shown');
    ara.cue('ترجمة عربية');
    expect(events.slice(1)).toEqual([{ type: 'cue', track: 0, text: 'ترجمة عربية' }]);
    expect(player.showText(null)).toBe(true);
    expect([ara.mode, eng.mode]).toEqual(['disabled', 'disabled']);
    ara.cue('hidden');
    expect(player.showText(5)).toBe(false);
    player.showText(0);
    player.stop();
    ara.cue('after stop');
    expect(events).toHaveLength(2);
  });

  it('suspends by stopping, and resumes live at the live edge and VOD where it was', () => {
    const { video, player } = setup();
    player.open('http://lab/live.ts', { live: true });
    video.currentTime = 42;
    player.suspend();
    expect(video.src).toBe('');
    player.resume();
    expect(video.src).toBe('http://lab/live.ts');
    // Live comes back at the live edge: no position to seek to.
    video.currentTime = 0;
    video.fire('loadedmetadata');
    expect(video.currentTime).toBe(0);

    player.open('http://lab/a.mp4', { live: false });
    video.currentTime = 33.25;
    player.suspend();
    video.currentTime = 0;
    player.resume();
    expect(video.src).toBe('http://lab/a.mp4');
    video.fire('loadedmetadata');
    expect(video.currentTime).toBe(33.25);
    // Nothing open: nothing to resume.
    player.stop();
    player.suspend();
    player.resume();
    expect(video.src).toBe('');
  });

  it('counts decoded frames where the engine does, and describes the engine', () => {
    const { video, player } = setup({ mediaSource: { isTypeSupported: (type) => type.indexOf('avc1') !== -1 } });
    expect(player.snapshot().frames).toBeNull();
    video.webkitDecodedFrameCount = 12;
    expect(player.snapshot().frames).toBe(12);
    video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 30 });
    expect(player.snapshot().frames).toBe(30);
    video.canPlay = { 'video/mp4': 'maybe', 'application/vnd.apple.mpegurl': 'maybe' };
    expect(player.canPlay('video/mp4')).toBe('maybe');
    expect(player.canPlay('video/mp2t')).toBe('');
    const facts = player.describe() as { canPlayType: Record<string, string>; apis: Record<string, boolean>; mse: Record<string, boolean> | null };
    expect(facts.canPlayType['video/mp2t']).toBe('');
    expect(facts.canPlayType['application/vnd.apple.mpegurl']).toBe('maybe');
    expect(Object.keys(facts.canPlayType)).toHaveLength(12);
    expect(facts.apis).toEqual({ audioTracks: false, textTracks: true, getVideoPlaybackQuality: true, webkitDecodedFrameCount: true, MediaSource: true });
    expect(facts.mse).toEqual({ h264: true, hevc: false, ac3: false });
    expect(setup().player.describe()).toMatchObject({ mse: null, apis: { MediaSource: false } });
  });

  it('puts captions on its stage, and on dispose stops, unhooks and takes the stage away', () => {
    const { video, stage, clock, player, events } = setup();
    player.caption('S5: live TS');
    expect(stage.captions).toEqual(['S5: live TS']);
    player.open('http://lab/a.ts', { live: true });
    player.dispose();
    expect(stage.removed).toBe(1);
    expect(video.src).toBe('');
    expect(clock.count).toBe(0);
    video.fire('waiting');
    expect(events).toEqual([]);
  });

  it('stops listening when a listener unsubscribes', () => {
    const { video, player } = setup();
    const heard: string[] = [];
    const off = player.on((event) => heard.push(event.type));
    player.open('http://lab/a.ts', { live: true });
    video.fire('waiting');
    off();
    off();
    video.fire('waiting');
    expect(heard).toEqual(['waiting']);
  });
});
