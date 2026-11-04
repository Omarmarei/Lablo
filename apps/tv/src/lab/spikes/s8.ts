/**
 * S8 from docs/architecture.md §5: AVPlay pre-buffering through `webapis.avplaystore` (RELAY step
 * 15c2, investigational). Can a second player prepare the next channel while the first plays, and
 * how fast is the switch to it? Pre-buffered zapping (v1.2) ships only if it passes and the
 * provider allows two connections:
 *
 * - `store`: `avplaystore.getPlayer()` gives two players;
 * - `prebuffer`: both prepare the live TS at once;
 * - `switch`: one plays, the other is prepared; the switch (stop the one, play the other) to the
 *   other's first frame, three times, each ≤ 700 ms on a 2020+ TV (older ones: measured only).
 *
 * Without `avplaystore` (the desktop, a webOS TV, older Samsungs) every row skips. Only the Tizen
 * build reaches it (`avplay-deps.ts`); the others drop it.
 */
import type { AvplayLabPlayer, AvplayStage } from '../avplay-player';
import { tizenS8Deps } from '../avplay-deps';
import type { BatteryClock } from '../battery';
import { BATTERY, PLACEHOLDER_NOTE, openAndWait } from '../battery';
import type { LabMedia, LabMediaItem } from '../media';
import { parseLabMedia } from '../media';
import type { PlayerError } from '../player';
import type { Check, CheckResult, Spike } from '../types';
import { guarded } from './guarded';

export interface S8Deps {
  /** Why there is no `avplaystore` here, or null when there is. */
  missing(): string | null;
  /** The box the players show in (one for both). */
  mountStage(): AvplayStage;
  /** A new player from `avplaystore.getPlayer()` on `stage`; throws past the TV's limit. */
  createPlayer(stage: AvplayStage): AvplayLabPlayer;
  getJson(url: string): Promise<unknown>;
  readonly clock: BatteryClock;
}

export const S8_NOT_TIZEN = 'no avplaystore: this is not the Tizen build';

export const S8_LIMITS = {
  /** The switch to a prepared player, on a 2020+ TV. */
  switchMs: 700,
  /** From this model year on, the switch is judged. */
  judgedFrom: 2020,
  switches: 3,
  prepareWaitMs: 10_000,
} as const;

function platformDeps(): S8Deps | null {
  return __PLATFORM__ === 'tizen' ? tizenS8Deps() : null;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Waits until every player has prepared, or one failed, or `timeoutMs`. */
export async function preparedAll(players: readonly AvplayLabPlayer[], clock: BatteryClock, timeoutMs: number): Promise<{ readonly ok: boolean; readonly ms: ReadonlyArray<number | null>; readonly error: PlayerError | null }> {
  const started = clock.now();
  const state = () => players.map((p) => p.readiness());
  let now = state();
  while (!now.every((r) => r.prepared) && now.every((r) => r.error === null) && clock.now() - started < timeoutMs) {
    await clock.sleep(BATTERY.pollMs);
    now = state();
  }
  const error = now.map((r) => r.error).filter((e): e is PlayerError => e !== null)[0] ?? null;
  return { ok: now.every((r) => r.prepared) && error === null, ms: now.map((r) => r.ms), error };
}

/** Runs `action` and waits for `player`'s first frame after it; ms, or null (with the error, if one came). */
export async function frameAfter(player: AvplayLabPlayer, action: () => void, clock: BatteryClock, timeoutMs: number): Promise<{ readonly ms: number | null; readonly error: PlayerError | null }> {
  const seen: { frameAt: number | null; error: PlayerError | null } = { frameAt: null, error: null };
  const off = player.on((event) => {
    if (event.type === 'frame' && seen.frameAt === null) seen.frameAt = clock.now();
    else if (event.type === 'error' && seen.error === null) seen.error = event.error;
  });
  const started = clock.now();
  try {
    action();
    while (seen.frameAt === null && seen.error === null && clock.now() - started < timeoutMs) await clock.sleep(BATTERY.pollMs);
  } finally {
    off();
  }
  return { ms: seen.frameAt === null ? null : Math.round(seen.frameAt - started), error: seen.error };
}

export function createS8(resolve: () => S8Deps | null = platformDeps): Spike {
  const checks = (deps: () => S8Deps): Check[] => {
    let media: LabMedia | null = null;

    /** The live TS, or why the row skips. */
    const liveTs = (): LabMediaItem | CheckResult => {
      if (media === null) return { status: 'skip', note: "needs the lab server's media list (the first check)" };
      if (media.media !== 'files') return { status: 'skip', note: PLACEHOLDER_NOTE };
      return media.items['live-ts'] ?? { status: 'skip', note: "the lab server's catalog has no live-ts item" };
    };
    const isItem = (x: LabMediaItem | CheckResult): x is LabMediaItem => typeof (x as LabMediaItem).url === 'string';

    /** Two players on one stage, always disposed with it. */
    const withPair = async (caption: string, body: (a: AvplayLabPlayer, b: AvplayLabPlayer) => Promise<CheckResult>): Promise<CheckResult> => {
      const stage = deps().mountStage();
      // Both players show in the same box: theirs is removed once, after both.
      const shared: AvplayStage = { rect: () => stage.rect(), caption: (text) => stage.caption(text), remove: () => undefined };
      const players: AvplayLabPlayer[] = [];
      try {
        players.push(deps().createPlayer(shared));
        players.push(deps().createPlayer(shared));
        stage.caption(caption);
        return await body(players[0] as AvplayLabPlayer, players[1] as AvplayLabPlayer);
      } finally {
        for (const p of players) p.dispose();
        stage.remove();
      }
    };

    const store: Check = {
      id: 'store',
      title: 'avplaystore gives two players',
      run: async (context) => {
        media = null;
        const found = parseLabMedia(await deps().getJson(`${context.server}/__lab/media`));
        if (found === null) return { status: 'fail', note: 'the lab server answered something else than a media list' };
        media = found;
        try {
          return await withPair('S8: two AVPlay players', (a, b) => Promise.resolve({ status: 'pass', value: { players: 2, engines: [a.describe(), b.describe()], media: found.media }, note: 'avplaystore.getPlayer() gave two players' }));
        } catch (error) {
          return { status: 'fail', value: { media: found.media }, note: `avplaystore.getPlayer() failed: ${message(error)}` };
        }
      },
    };

    const prebuffer: Check = {
      id: 'prebuffer',
      title: 'Both prepare the live TS at once',
      run: async () => {
        const item = liveTs();
        if (!isItem(item)) return item;
        return withPair('S8: two players preparing the live TS', async (a, b) => {
          a.prepare(item.url, { live: true });
          b.prepare(item.url, { live: true });
          const r = await preparedAll([a, b], deps().clock, S8_LIMITS.prepareWaitMs);
          const value = { prepareMs: r.ms, error: r.error };
          if (r.ok) return { status: 'pass', value, note: `both prepared, in ${r.ms.map((ms) => `${ms} ms`).join(' and ')}` };
          if (r.error !== null) return { status: 'fail', value, note: `a prepare failed: ${r.error.message}` };
          return { status: 'fail', value, note: `not both prepared within ${S8_LIMITS.prepareWaitMs} ms (${r.ms.map((ms) => (ms === null ? 'no' : `${ms} ms`)).join(', ')})` };
        });
      },
    };

    const switchRow: Check = {
      id: 'switch',
      title: 'Switch to the prepared player ≤ 700 ms (2020+)',
      timeoutMs: 120_000,
      run: async (context) => {
        const item = liveTs();
        if (!isItem(item)) return item;
        const { clock } = deps();
        return withPair('S8: switching between two players', async (a, b) => {
          const first = await openAndWait(a, item.url, { live: true }, BATTERY.frameWaitMs, clock);
          if (!first.played) return { status: 'fail', value: { first }, note: `the first player never played: ${first.error?.message ?? 'no answer'}` };
          const switches: Array<{ ms: number | null; prepareMs: number | null; error: string | null }> = [];
          let on = a;
          let next = b;
          for (let i = 0; i < S8_LIMITS.switches; i += 1) {
            next.prepare(item.url, { live: true });
            const ready = await preparedAll([next], clock, S8_LIMITS.prepareWaitMs);
            if (!ready.ok) {
              switches.push({ ms: null, prepareMs: null, error: ready.error?.message ?? 'not prepared in time' });
              break;
            }
            const playing = on;
            const target = next;
            const r = await frameAfter(
              target,
              () => {
                playing.stop();
                target.start();
              },
              clock,
              BATTERY.frameWaitMs,
            );
            switches.push({ ms: r.ms, prepareMs: ready.ms[0] ?? null, error: r.error?.message ?? null });
            if (r.ms === null) break;
            on = target;
            next = playing;
          }
          const times = switches.map((s) => s.ms).filter((ms): ms is number => ms !== null);
          const worst = times.length === 0 ? null : Math.max(...times);
          const year = context.info.modelYear;
          const judged = year !== null && year >= S8_LIMITS.judgedFrom;
          const value = { switches, worstMs: worst, limitMs: S8_LIMITS.switchMs, modelYear: year, judged };
          const broken = switches.filter((s) => s.ms === null)[0];
          if (broken !== undefined) return { status: 'fail', value, note: `switch ${switches.length} of ${S8_LIMITS.switches} failed: ${broken.error ?? 'no frame'}` };
          const list = times.map((ms) => `${ms} ms`).join(', ');
          if (!judged) return { status: 'info', value, note: `${list}; only 2020+ TVs are held to ${S8_LIMITS.switchMs} ms` };
          if (worst !== null && worst <= S8_LIMITS.switchMs) return { status: 'pass', value, note: `${list}, each ≤ ${S8_LIMITS.switchMs} ms` };
          return { status: 'fail', value, note: `${list}: the slowest over ${S8_LIMITS.switchMs} ms` };
        });
      },
    };

    return [store, prebuffer, switchRow];
  };
  return {
    id: 'S8',
    title: 'AVPlay pre-buffering',
    question: 'avplaystore: a second player prepared while one plays, the switch ≤ 700 ms',
    checks: guarded(checks, resolve, (deps) => deps.missing(), S8_NOT_TIZEN),
  };
}

export const S8 = createS8();
