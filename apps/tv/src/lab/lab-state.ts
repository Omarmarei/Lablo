/**
 * The Zoma Lab screen's state (RELAY step 15a): the focus engine's zones, the runs and every
 * check's outcome. Two zones:
 *
 *   actions  (Run all)
 *   spikes   (one row per spike: OK runs that spike alone; the focused row's checks show beside)
 *
 * Back on this root screen follows the platform, as in the app: an exit dialog on Tizen and in
 * the browser, the launcher on webOS.
 */
import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Platform } from '@zoma/platform-api';
import type { FocusBinding, Navigator, Screen, ScreenSpec } from '@zoma/ui';
import { bindFocus, createNavigator } from '@zoma/ui';
import type { Reporter } from './reporter';
import type { CheckOutcome } from './runner';
import { countStatuses, runSpikes } from './runner';
import type { LabContext, Spike } from './types';

export type LabPhase = 'ready' | 'running' | 'done';

export interface Lab {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly home: Screen;
  readonly spikes: readonly Spike[];
  readonly context: LabContext;
  readonly reporter: Reporter;
  readonly phase: ReadonlySignal<LabPhase>;
  /** Outcomes by `S1/blob-worker`, from the latest run of each check. */
  readonly outcomes: ReadonlySignal<Readonly<Record<string, CheckOutcome>>>;
  /** The check running now (`S1/blob-worker`), or null. */
  readonly current: ReadonlySignal<string | null>;
  /** Runs finished in this session. */
  readonly runs: ReadonlySignal<number>;
  runAll(): Promise<void>;
  runSpike(id: string): Promise<void>;
}

export const outcomeKey = (spike: string, check: string): string => `${spike}/${check}`;

const BUTTONS: ScreenSpec['zones'] = [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }];

export function createLab(options: {
  readonly platform: Pick<Platform, 'rootBackPolicy' | 'exitApp'>;
  readonly spikes: readonly Spike[];
  readonly context: LabContext;
  readonly reporter: Reporter;
}): Lab {
  const { platform, spikes, context, reporter } = options;
  const phase = signal<LabPhase>('ready');
  const outcomes = signal<Readonly<Record<string, CheckOutcome>>>({});
  const current = signal<string | null>(null);
  const runs = signal(0);

  const run = async (chosen: readonly Spike[], label: string): Promise<void> => {
    if (phase.peek() === 'running') return;
    phase.value = 'running';
    const started = Date.now();
    const done = await runSpikes(
      chosen,
      context,
      (outcome) => {
        outcomes.value = { ...outcomes.peek(), [outcomeKey(outcome.spike, outcome.check)]: outcome };
        const { result } = outcome;
        reporter.add({ type: 'check', spike: outcome.spike, check: outcome.check, status: result.status, value: result.value, note: result.note, ms: outcome.ms });
      },
      (spike, check) => {
        current.value = outcomeKey(spike, check);
      },
    );
    current.value = null;
    runs.value += 1;
    reporter.add({ type: 'end', value: { run: runs.peek(), spikes: chosen.map((s) => s.id), counts: countStatuses(done), ms: Date.now() - started }, note: label });
    phase.value = 'done';
  };

  const runAll = (): Promise<void> => run(spikes, 'all spikes');
  const runSpike = (id: string): Promise<void> => {
    const spike = spikes.find((s) => s.id === id);
    return spike === undefined ? Promise.resolve() : run([spike], id);
  };

  const nav = createNavigator({
    root: {
      id: 'lab',
      zones: [
        { kind: 'list', id: 'actions', axis: 'horizontal', count: 1, neighbours: { down: 'spikes' } },
        { kind: 'list', id: 'spikes', axis: 'vertical', count: spikes.length, neighbours: { up: 'actions' } },
      ],
      initial: 'actions',
      onSelect: (focus) => {
        if (focus.zone === 'actions') void runAll();
        else {
          const spike = spikes[focus.index];
          if (spike !== undefined) void runSpike(spike.id);
        }
      },
    },
    rootBack: platform.rootBackPolicy(),
    exit: () => platform.exitApp(),
    exitDialog: () => {
      nav.push({
        id: 'exit',
        zones: BUTTONS,
        onSelect: (focus) => {
          nav.pop();
          if (focus.index === 1) platform.exitApp();
        },
      });
    },
  });

  return { nav, binding: bindFocus(nav), home: nav.top, spikes, context, reporter, phase, outcomes, current, runs, runAll, runSpike };
}
