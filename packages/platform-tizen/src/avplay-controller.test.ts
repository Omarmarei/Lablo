import { describe, expect, it } from 'vitest';
import type { PlayRequest, PlayerStatus } from '@lablo/player';
import { PlayerController, streamCandidates } from '@lablo/player';
import { AvplayEngine } from './avplay-engine';
import { FakeAvplay, FakeClock, FakeXhr } from './fake-avplay';
import { MemoryRedirectMemory, createRedirectProbe } from './redirect-probe';

/**
 * The Tizen pieces together on the fakes (RELAY step 19): `PlayerController` over the
 * `AvplayEngine`, with the redirect probe as its `resolveUrl`. The panel at `panel.example`
 * redirects what `redirects` lists to an edge server.
 */

const PANEL = 'http://panel.example:8080';
const EDGE = 'http://edge.example/stream';

/** An XHR that gets the final answer's headers 30 ms after it is sent. */
class PanelXhr extends FakeXhr {
  private url = '';

  constructor(
    private readonly clock: FakeClock,
    private readonly redirects: (url: string) => boolean,
    private readonly sent: string[],
  ) {
    super();
  }

  override open(method: string, url: string, async: boolean): void {
    this.url = url;
    super.open(method, url, async);
  }

  override send(): void {
    super.send();
    this.sent.push(this.url);
    this.clock.setTimeout(() => this.headers(200, this.redirects(this.url) ? EDGE + this.url.slice(PANEL.length) : this.url), 30);
  }
}

function rig(redirects: (url: string) => boolean, autoPlay: (url: string) => number | null) {
  const clock = new FakeClock();
  const avplay = new FakeAvplay(clock);
  avplay.autoPlay = autoPlay;
  const probes: string[] = [];
  const memory = new MemoryRedirectMemory();
  const player = new PlayerController(new AvplayEngine(avplay, { clock }), {
    clock,
    resolveUrl: createRedirectProbe({ memory, createXhr: () => new PanelXhr(clock, redirects, probes) }),
  });
  const statuses: PlayerStatus[] = [];
  player.subscribe((s) => statuses.push(s));
  return { clock, avplay, player, probes, memory, statuses };
}

/** An M3U channel: one URL. */
function m3u(path: string): PlayRequest {
  return { key: 's1:live:' + path, src: 's1', mode: 'live', candidates: [{ url: PANEL + path, container: 'ts' }] };
}

describe('AvplayEngine under the PlayerController, with the redirect probe (RELAY step 19)', () => {
  it('gives AVPlay the URL a redirect leads to, and probes that source before every play', async () => {
    // AVPlay freezes on the panel's 302s, and plays the edge's URL.
    const r = rig(
      () => true,
      (url) => (url.indexOf(PANEL) === 0 ? null : 200),
    );
    void r.player.play(m3u('/live/1.ts'));
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('playing');
    expect(r.avplay.urls).toEqual([EDGE + '/live/1.ts']);
    expect(r.memory.mode('s1')).toBe('redirects');
    void r.player.play(m3u('/live/2.ts'));
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('playing');
    expect(r.probes).toEqual([PANEL + '/live/1.ts', PANEL + '/live/2.ts']);
    expect(r.avplay.urls).toEqual([EDGE + '/live/1.ts', EDGE + '/live/2.ts']);
    expect(r.avplay.connections).toBe(1);
  });

  it('skips the probe for a source that does not redirect', async () => {
    const r = rig(
      () => false,
      () => 200,
    );
    void r.player.play(m3u('/live/1.ts'));
    await r.clock.advance(1000);
    void r.player.play(m3u('/live/2.ts'));
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('playing');
    expect(r.probes).toEqual([PANEL + '/live/1.ts']);
    expect(r.avplay.urls).toEqual([PANEL + '/live/1.ts', PANEL + '/live/2.ts']);
  });

  it('re-probes when AVPlay freezes on a source that started redirecting, and plays the new URL', async () => {
    let redirecting = false;
    const r = rig(
      () => redirecting,
      (url) => (url.indexOf(PANEL) === 0 && redirecting ? null : 200),
    );
    void r.player.play(m3u('/live/1.ts'));
    await r.clock.advance(1000);
    expect(r.memory.mode('s1')).toBe('none');
    // The panel moves its streams behind a redirect: AVPlay's prepare freezes on the panel's URL.
    redirecting = true;
    void r.player.play(m3u('/live/2.ts'));
    await r.clock.advance(30_000);
    expect(r.player.status.state).toBe('playing');
    // Freeze (8 s), reopen without a probe (the source said none), freeze, then the re-probe rung.
    expect(r.avplay.urls).toEqual([PANEL + '/live/1.ts', PANEL + '/live/2.ts', PANEL + '/live/2.ts', EDGE + '/live/2.ts']);
    expect(r.probes).toEqual([PANEL + '/live/1.ts', PANEL + '/live/2.ts']);
    expect(r.memory.mode('s1')).toBe('redirects');
    expect(r.player.status.attempt).toBe(0);
    expect(r.avplay.connections).toBe(1);
  });

  it("blames the provider's HTTP error the probe saw, without opening AVPlay", async () => {
    const clock = new FakeClock();
    const avplay = new FakeAvplay(clock);
    avplay.autoPlay = () => 200;
    const xhr = (): FakeXhr => {
      const x = new FakeXhr();
      const send = x.send.bind(x);
      x.send = () => {
        send();
        clock.setTimeout(() => x.headers(404, ''), 30);
      };
      return x;
    };
    const player = new PlayerController(new AvplayEngine(avplay, { clock }), { clock, resolveUrl: createRedirectProbe({ createXhr: xhr }) });
    void player.play({ key: 's1:live:1', src: 's1', mode: 'live', candidates: streamCandidates(PANEL + '/live/u/p/1.ts', 'live') });
    await clock.advance(5000);
    expect(player.status.state).toBe('failed');
    expect(player.status.failure).toMatchObject({ category: 'provider', code: 'PRV-HTTP-404' });
    expect(avplay.urls).toEqual([]);
  });
});
