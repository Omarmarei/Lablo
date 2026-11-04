/**
 * The Zoma Lab screen's state (RELAY step 15a): the focus engine's zones, the runs and every
 * check's outcome. Two zones:
 *
 *   actions  (Run all)
 *   spikes   (one row per spike: OK runs that spike alone; the focused row's checks show beside)
 *
 * Back on this root screen follows the platform, as in the app: an exit dialog on Tizen and in
 * the browser, the launcher on webOS. A check run from a spike's row may need a person, each on
 * a screen of its own pushed over the lab: a question answered with the colour keys (`ask`,
 * step 15b2), the key tester and the keyboard test (`testKeys`, `typeText`, step 15b3).
 */
import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { KeyLike, Platform } from '@zoma/platform-api';
import type { EditableLike, EditKeyEvent, FieldEditing, FocusBinding, Navigator, Screen, ScreenSpec } from '@zoma/ui';
import { bindFocus, createNavigator, createTextEditor, watchPointerMoves } from '@zoma/ui';
import type { Reporter } from './reporter';
import type { CheckOutcome } from './runner';
import { countStatuses, runSpikes } from './runner';
import type {
  KeyPress,
  KeyTest,
  KeyTestResult,
  LabAnswer,
  LabAnswerKind,
  LabBaseContext,
  LabQuestion,
  PointerLog,
  Spike,
  TextEdit,
  TextTest,
  TextTestResult,
} from './types';

export type LabPhase = 'ready' | 'running' | 'done';

/** The key tester on screen (`testKeys`). */
export interface KeyTestView {
  readonly test: KeyTest;
  readonly presses: readonly KeyPress[];
  readonly pointer: PointerLog;
  /** Backs in a row so far: the second ends the test. */
  readonly backs: number;
}

/** The keyboard test on screen (`typeText`). */
export interface TextTestView {
  readonly test: TextTest;
  readonly text: string;
  readonly edits: readonly TextEdit[];
  readonly keyboard: readonly boolean[];
  /** The field's handlers: the editor's, recording each key the field sees. */
  readonly field: FieldEditing;
  readonly onValue: (value: string) => void;
}

export interface Lab {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly home: Screen;
  readonly spikes: readonly Spike[];
  readonly context: LabBaseContext;
  readonly reporter: Reporter;
  readonly phase: ReadonlySignal<LabPhase>;
  /** Outcomes by `S1/blob-worker`, from the latest run of each check. */
  readonly outcomes: ReadonlySignal<Readonly<Record<string, CheckOutcome>>>;
  /** The check running now (`S1/blob-worker`), or null. */
  readonly current: ReadonlySignal<string | null>;
  /** Runs finished in this session. */
  readonly runs: ReadonlySignal<number>;
  /** The question on screen (`ask`), or null. */
  readonly question: ReadonlySignal<LabQuestion | null>;
  /** The key tester on screen, or null. */
  readonly keyTest: ReadonlySignal<KeyTestView | null>;
  /** The keyboard test on screen, or null. */
  readonly textTest: ReadonlySignal<TextTestView | null>;
  runAll(): Promise<void>;
  runSpike(id: string): Promise<void>;
}

export const outcomeKey = (spike: string, check: string): string => `${spike}/${check}`;

const BUTTONS: ScreenSpec['zones'] = [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }];

/** The question screen's id (`ask/items/0`). */
export const ASK_SCREEN = 'ask';
/** The key tester's screen (`keys/keys/0`): one item, since no key moves the focus there. */
export const KEYS_SCREEN = 'keys';
/** The keyboard test's screen (`type/field/0`) and its input's DOM id. */
export const TYPE_SCREEN = 'type';
export const TYPE_FIELD = 'lab-type-field';

/** The colour keys that answer a question, and Back. */
const ANSWERS: Readonly<Partial<Record<string, LabAnswerKind>>> = { GREEN: 'yes', RED: 'no', BACK: 'skip' };

/** Listeners on the window's capture phase: the key tester hears a key before the remote wiring. */
const CAPTURE = { capture: true };

const NO_POINTER: PointerLog = { shown: 0, hidden: 0, moves: 0, clicks: 0, wheel: 0 };

export function createLab(options: {
  readonly platform: Pick<Platform, 'rootBackPolicy' | 'exitApp' | 'keyToIntent' | 'onPointer' | 'textKey' | 'onSoftKeyboard'>;
  readonly spikes: readonly Spike[];
  /** Everything but what each run adds (`LabRunExtras`). */
  readonly context: LabBaseContext;
  readonly reporter: Reporter;
  /** Where the key tester hears keys, clicks, the wheel and pointer moves: the window. */
  readonly target: EventTarget;
  /** Finds the keyboard test's input by its id. Default `document.getElementById`. */
  readonly findInput?: (id: string) => EditableLike | null;
  /** A monotonic clock in ms. Default `performance.now`. */
  readonly now?: () => number;
}): Lab {
  const { platform, spikes, reporter, target } = options;
  const now = options.now ?? (() => performance.now());
  const phase = signal<LabPhase>('ready');
  const outcomes = signal<Readonly<Record<string, CheckOutcome>>>({});
  const current = signal<string | null>(null);
  const runs = signal(0);
  const question = signal<LabQuestion | null>(null);
  const keyTest = signal<KeyTestView | null>(null);
  const textTest = signal<TextTestView | null>(null);

  const ask = (q: LabQuestion): Promise<LabAnswer> =>
    new Promise((resolve) => {
      let moves = 0;
      let last = 0;
      let settled = false;
      const finish = (answer: LabAnswerKind): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (nav.top === screen) nav.pop();
        question.value = null;
        resolve({ answer, moves });
      };
      question.value = q;
      const screen = nav.push({
        id: ASK_SCREEN,
        zones: [{ kind: 'list', id: 'items', axis: 'horizontal', count: q.labels.length }],
        onIntent: (intent) => {
          const answer = ANSWERS[intent];
          if (answer === undefined) return false;
          finish(answer);
          return true;
        },
      });
      const unsubscribe = nav.subscribe((focus) => {
        if (focus.screen !== ASK_SCREEN || focus.index === last) return;
        last = focus.index;
        moves += 1;
      });
      const timer = setTimeout(() => finish('timeout'), q.timeoutMs);
    });

  /** A key as the page got it, timed from `since`. */
  const pressOf = (event: KeyLike, since: number): KeyPress => ({
    keyCode: event.keyCode,
    key: typeof event.key === 'string' ? event.key : '',
    intent: platform.keyToIntent(event),
    ms: Math.round(now() - since),
  });

  const testKeys = (test: KeyTest): Promise<KeyTestResult> =>
    new Promise((resolve) => {
      const started = now();
      let presses: KeyPress[] = [];
      let pointer = NO_POINTER;
      let backs = 0;
      let settled = false;
      const show = (): void => {
        keyTest.value = { test, presses, pointer, backs };
      };
      const count = (field: keyof PointerLog): void => {
        pointer = { ...pointer, [field]: pointer[field] + 1 };
        show();
      };
      // Every key, before the remote wiring turns it into an Intent (or drops it for having none).
      const onKey = (event: Event): void => {
        const press = pressOf(event as KeyboardEvent, started);
        presses = [...presses, press];
        backs = press.intent === 'BACK' ? backs + 1 : 0;
        show();
      };
      const onClick = (): void => count('clicks');
      const onWheel = (): void => count('wheel');
      const finish = (ended: KeyTestResult['ended']): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        target.removeEventListener('keydown', onKey, CAPTURE);
        target.removeEventListener('click', onClick, CAPTURE);
        target.removeEventListener('wheel', onWheel, CAPTURE);
        stopMoves();
        stopPointer();
        if (nav.top === screen) nav.pop();
        keyTest.value = null;
        resolve({ ended, presses, pointer });
      };
      target.addEventListener('keydown', onKey, CAPTURE);
      target.addEventListener('click', onClick, CAPTURE);
      target.addEventListener('wheel', onWheel, CAPTURE);
      const stopMoves = watchPointerMoves(target, () => count('moves'));
      const stopPointer = platform.onPointer((visible) => count(visible ? 'shown' : 'hidden'));
      show();
      const screen = nav.push({
        id: KEYS_SCREEN,
        zones: [{ kind: 'list', id: 'keys', axis: 'horizontal', count: 1 }],
        // Every key is under test: none moves the focus or leaves, but Back twice in a row ends it.
        onIntent: (intent) => {
          if (intent === 'BACK' && backs >= 2) finish('back');
          return true;
        },
      });
      const timer = setTimeout(() => finish('timeout'), test.timeoutMs);
    });

  const typeText = (test: TextTest): Promise<TextTestResult> =>
    new Promise((resolve) => {
      const started = now();
      let text = '';
      let edits: TextEdit[] = [];
      let keyboard: boolean[] = [];
      // The edit in progress.
      let keys: KeyPress[] = [];
      let inputs = 0;
      let settled = false;
      const editor = createTextEditor({
        platform,
        nav,
        find: options.findInput,
        now,
        onEnd: (_id, how) => {
          edits = [...edits, { how, keys, inputs, text }];
          keys = [];
          inputs = 0;
          show();
        },
      });
      const field = (): FieldEditing => {
        const inner = editor.field(TYPE_FIELD);
        return {
          ...inner,
          onEditKey: (event: EditKeyEvent): void => {
            keys = [...keys, pressOf(event, started)];
            inner.onEditKey(event);
          },
        };
      };
      const onValue = (value: string): void => {
        text = value;
        inputs += 1;
        show();
      };
      const show = (): void => {
        textTest.value = { test, text, edits, keyboard, field: field(), onValue };
      };
      const stopKeyboard = platform.onSoftKeyboard((visible) => {
        keyboard = [...keyboard, visible];
        show();
      });
      const unsubscribe = editor.subscribe(show);
      const finish = (answer: LabAnswerKind): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // An edit still open ends as `close`, and is recorded.
        editor.close();
        unsubscribe();
        editor.dispose();
        stopKeyboard();
        if (nav.top === screen) nav.pop();
        textTest.value = null;
        resolve({ answer, text, edits, keyboard });
      };
      show();
      const screen = nav.push({
        id: TYPE_SCREEN,
        zones: [{ kind: 'list', id: 'field', axis: 'vertical', count: 1 }],
        // OK on the field gives its input DOM focus, which opens the TV's keyboard.
        onSelect: () => {
          editor.open(TYPE_FIELD);
        },
        onIntent: (intent) => {
          const answer = ANSWERS[intent];
          if (answer === undefined) return false;
          finish(answer);
          return true;
        },
      });
      const timer = setTimeout(() => finish('timeout'), test.timeoutMs);
    });

  const run = async (chosen: readonly Spike[], label: string, interactive: boolean): Promise<void> => {
    if (phase.peek() === 'running') return;
    phase.value = 'running';
    const started = Date.now();
    const done = await runSpikes(
      chosen,
      { ...options.context, interactive, ask, testKeys, typeText },
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

  const runAll = (): Promise<void> => run(spikes, 'all spikes', false);
  const runSpike = (id: string): Promise<void> => {
    const spike = spikes.find((s) => s.id === id);
    return spike === undefined ? Promise.resolve() : run([spike], id, true);
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

  return {
    nav,
    binding: bindFocus(nav),
    home: nav.top,
    spikes,
    context: options.context,
    reporter,
    phase,
    outcomes,
    current,
    runs,
    question,
    keyTest,
    textTest,
    runAll,
    runSpike,
  };
}
