/**
 * The playback harness (RELAY step 18): a dev-only page (`pnpm dev`, `/playback.html`) that hands
 * the platform's engines (`Platform.createEngines`) to a `PlayerController`, for the desktop
 * playback e2e (e2e/playback.spec.ts, e2e/playback-media.spec.ts). It has no UI of its own (the
 * player UI is step 20) and no TV build includes it: the app and the lab are the only TV entries.
 *
 * `window.__ZOMA_PLAYBACK__` (`PlaybackHarness`) plays and reports. The root element carries the
 * state for Playwright's waits: `data-state`, `data-container`, `data-session` and, once it gave
 * up, `data-failure` (the diagnostic code).
 *
 * Subtitle files (step 20b2b): the app's loader (`createSubtitleLoader`) and the app's overlay
 * (`SubtitleOverlay` with player.css on the design tokens), drawn over the stage as in the player;
 * `data-subtitles` says where they come from.
 */
import { h, render } from 'preact';
import type { PlayerEngine, PlayRequest, SubtitleView } from '@zoma/player';
import { PlayerController, isPlaybackError, streamCandidates } from '@zoma/player';
// The design tokens and fonts (the package's styles) and the player's own CSS, for the overlay.
import '@zoma/ui';
import '../player/player.css';
import { SubtitleOverlay } from '../player/SubtitleOverlay';
import { createSubtitleLoader } from '../player/subtitle-loader';
import type { SubtitleSize } from '../player/track-menu';
import { createPlatform } from '../platform';
import type { PlaybackHarness, PlaybackInput, PlaybackSnapshot, PlaybackTarget } from './harness';

const root = document.getElementById('playback');
const stage = document.getElementById('stage');
const bottom = document.getElementById('bottom');
if (root === null || stage === null || bottom === null) throw new Error('#playback, #stage or #bottom missing from playback.html');

const platform = createPlatform();
const engines = platform.createEngines(stage);
const engine: PlayerEngine | undefined = engines[0];
if (engine === undefined) throw new Error(`the ${platform.id} platform built no engine`);

const trace: string[] = [];
const history: string[] = [];

// The engine's side of each attempt, for the e2e: what it was asked to load and how that ended.
const load = engine.load.bind(engine);
engine.load = (source, token, opts) => {
  trace.push(`load ${token} ${source.container}`);
  const result = load(source, token, opts);
  result.then(
    () => trace.push(`loaded ${token}`),
    (error: unknown) => trace.push(`rejected ${token} ${isPlaybackError(error) ? `${error.kind}/${error.code}` : 'other'}`),
  );
  return result;
};
engine.on((e) => trace.push(e.type === 'error' ? `error ${e.token} ${e.error.kind}/${e.error.code}` : `${e.type} ${e.token}`));

const controller = new PlayerController(engine, { online: () => navigator.onLine, loadSubtitles: createSubtitleLoader() });

let size: SubtitleSize = 'm';
const drawSubtitles = (view: SubtitleView): void => {
  root.setAttribute('data-subtitles', view.feed ?? '');
  render(view.cues.length > 0 ? h(SubtitleOverlay, { cues: view.cues, size }) : null, bottom);
};
controller.subscribeSubtitles(drawSubtitles);
/** The last status's own facts: a status that only brings new track lists (step 20b) isn't history. */
let last = '';
controller.subscribe((s) => {
  const facts = `${s.session} ${s.state} ${s.container ?? '-'} ${s.attempt} ${s.failure === null ? '' : s.failure.code}`;
  if (facts !== last) history.push(`${s.state} ${s.container ?? '-'}`);
  last = facts;
  root.setAttribute('data-state', s.state);
  root.setAttribute('data-container', s.container ?? '');
  root.setAttribute('data-session', String(s.session));
  if (s.failure === null) root.removeAttribute('data-failure');
  else root.setAttribute('data-failure', s.failure.code);
});

const harness: PlaybackHarness = {
  play(input: PlaybackInput): void {
    const url = input.url ?? '';
    const candidates = input.candidates ?? streamCandidates(url, input.mode);
    const req: PlayRequest = { key: `${input.mode}:${url}`, src: input.src ?? 'mock', mode: input.mode, candidates, ...(input.externalSubs === undefined ? {} : { externalSubs: input.externalSubs }) };
    void controller.play(req, input.startMs === undefined ? {} : { startMs: input.startMs });
  },
  stop: () => controller.stop(),
  snapshot(): PlaybackSnapshot {
    const status = controller.status;
    return {
      state: status.state,
      session: status.session,
      container: status.container,
      attempt: status.attempt,
      failure: status.failure,
      positionMs: engine.positionMs(),
      history: history.slice(),
      trace: trace.slice(),
      tracks: engine.getTracks(),
      stats: engine.stats(),
      engines: engines.map((e) => e.kind),
      trackSwitch: engine.caps.trackSwitch,
      textTracks: status.tracks.text,
      subtitles: controller.subtitles,
    };
  },
  selectAudio: (id) => engine.selectAudio(id),
  selectText: (id) => controller.selectText(id),
  setSubtitleDelay: (ms) => controller.setSubtitleDelay(ms),
  setSubtitleSize(next) {
    size = next;
    drawSubtitles(controller.subtitles);
  },
  canPlayType: (mime) => {
    const video = stage.querySelector('video');
    return video === null ? '' : video.canPlayType(mime);
  },
};
(window as PlaybackTarget).__ZOMA_PLAYBACK__ = harness;
root.setAttribute('data-ready', 'true');
