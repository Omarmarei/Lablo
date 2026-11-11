/**
 * The app's live screen inside the lab, for S6 (RELAY step 15b): mounted over the lab screen on
 * the data engine S6 runs, so its key presses and its cold start are the app's own. The lab is
 * English only, so the screen shows in English; the TV's region keeps its formats.
 *
 * A press goes the way a remote key does (connectRemote: the screen's `activity`, then the
 * navigator), and is timed to the end of the first frame that draws the new focus: a
 * `requestAnimationFrame`, then a task after its paint (as e2e/remote-driver.ts times a key).
 */
import { render } from 'preact';
import type { Intent, Platform } from '@lablo/platform-api';
import { LiveApp } from '../live/LiveApp';
import type { Live, LiveEngine } from '../live/live-state';
import { createLive } from '../live/live-state';
import { focusPath } from '../test-hook';
import { afterFrameWhere, drawnFocus, showsRows } from './stage-probe';

export interface PressTiming {
  readonly intent: Intent;
  /** The focus the press moved to (`live/channels/3`). */
  readonly path: string;
  /** Key to the painted focus; `null` when the screen never drew it. */
  readonly ms: number | null;
}

export interface LiveStage {
  readonly live: Live;
  /** Resolves with the ms from the mount until the screen showed its rows, painted (or rejects). */
  painted(timeoutMs?: number): Promise<number>;
  /** Resolves with the ms from the mount until no data request is in flight (the focus wait too). */
  idle(timeoutMs?: number): Promise<number>;
  press(intent: Intent, timeoutMs?: number): Promise<PressTiming>;
  close(): void;
}

const now = (): number => performance.now();

export function mountLiveStage(platform: Platform, engine: LiveEngine, host: HTMLElement = document.body): LiveStage {
  const started = now();
  const lang = document.documentElement.lang;
  const dir = document.documentElement.dir;
  const element = document.createElement('div');
  element.className = 'lab-stage';
  element.setAttribute('data-testid', 'lab-stage');
  host.appendChild(element);
  const live = createLive({ platform, engine });
  render(<LiveApp platform={platform} live={live} language="en" />, element);

  const rows = (): boolean => showsRows(live.status.peek(), live.row(0), element);

  return {
    live,
    painted: (timeoutMs = 30_000) => afterFrameWhere(rows, started, timeoutMs, 'no rows painted'),
    idle: (timeoutMs = 30_000) => afterFrameWhere(() => rows() && live.pending.peek() === 0, started, timeoutMs, 'still busy'),
    press: (intent, timeoutMs = 10_000) => {
      const at = now();
      live.activity();
      live.nav.handle(intent);
      const path = focusPath(live.nav.snapshot());
      return afterFrameWhere(() => drawnFocus(element) === path, at, timeoutMs, `the focus never showed at ${path}`).then(
        (ms) => ({ intent, path, ms }),
        () => ({ intent, path, ms: null }),
      );
    },
    close: () => {
      live.dispose();
      render(null, element);
      if (element.parentNode !== null) element.parentNode.removeChild(element);
      document.documentElement.lang = lang;
      document.documentElement.dir = dir;
    },
  };
}
