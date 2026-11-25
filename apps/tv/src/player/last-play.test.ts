import type { PlaybackFailure, PlayerStatus } from '@lablo/player';
import { describe, expect, it } from 'vitest';
import { createLastPlay } from './last-play';

/** The run's last stream for "Check the connection" (RELAY step 40a): the newer of a first frame and a failure. */

const FAILURE: PlaybackFailure = { category: 'provider', code: 'PRV-HTTP-404', detail: 'HTTP_404', account: null };

function status(state: PlayerStatus['state'], failure: PlaybackFailure | null = null): PlayerStatus {
  return { state, session: 1, key: null, container: 'ts', attempt: 0, failure, tracks: { audio: [], text: [], audioSwitching: 'none' } } as unknown as PlayerStatus;
}

describe('createLastPlay (RELAY step 40a)', () => {
  it('starts with nothing, keeps a first frame, then a failure, then the next first frame', () => {
    const last = createLastPlay();
    expect(last.value()).toBeNull();
    last.report({ type: 'play', engine: 'html5', container: 'hls', mode: 'live', ttffMs: 830, error: null });
    expect(last.value()).toEqual({ state: 'played', container: 'hls', ttffMs: 830 });
    last.status(status('failed', FAILURE));
    expect(last.value()).toEqual({ state: 'failed', failure: FAILURE });
    last.report({ type: 'play', engine: 'avplay', container: 'ts', mode: 'vod', ttffMs: 0, error: null });
    expect(last.value()).toEqual({ state: 'played', container: 'ts', ttffMs: 0 });
  });

  it('ignores a give-up report (its failure comes as a status), stalls and other states', () => {
    const last = createLastPlay();
    last.report({ type: 'play', engine: 'html5', container: 'ts', mode: 'live', ttffMs: null, error: { kind: 'unsupported', code: 'X' } });
    last.report({ type: 'stall', recovered: false, attempts: 4 });
    last.status(status('playing'));
    last.status(status('opening'));
    expect(last.value()).toBeNull();
    // A failed status without its failure (never sent by the controller) changes nothing.
    last.status(status('failed'));
    expect(last.value()).toBeNull();
  });
});
