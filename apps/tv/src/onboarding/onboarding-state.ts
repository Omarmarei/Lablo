import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Platform } from '@lablo/platform-api';
import type { EditorBinding, FocusBinding, Language, Navigator, Screen, ScreenSpec, TextEditorOptions } from '@lablo/ui';
import { bindEditor, bindFocus, createNavigator, createTextEditor } from '@lablo/ui';
import type { FieldId, FormProblems, FormValues, SourceDraft, SourceType } from './form';
import { FORM_FIELDS, checkForm, firstProblem } from './form';
import type { LoadErrorCode, LoadHandle, LoadProgress, LoadResult, SourceLoader } from './loader';
import { LoadError } from './loader';

/**
 * Onboarding (RELAY step 13a, PLAN 4.4): the first start, on the router's back stack. Back goes
 * one screen back; on the first screen it follows the platform (an exit dialog on Tizen and in
 * the browser, the launcher on webOS).
 *
 *   language  (English / العربية: picking one switches the app to it)
 *   disclaimer (Lablo provides no content)
 *   consent   (the TV's device ID for the encrypted backup: allow / not now)
 *   source    (an Xtream login or an M3U link)
 *   form      (the fields, then "Add source": checked on the TV first)
 *   loading   (progress; on failure "Edit details" / "Try again")
 *   done      (the counts; the new root: Back no longer goes into onboarding)
 *
 * Each answer is handed to `answer` as it is given (step 13b saves it in the profile), so a
 * relaunch before the source is added starts again in the language picked (`initial`).
 */

/** The languages in the order the language screen shows them. */
export const LANGUAGES: readonly Language[] = ['en', 'ar'];
export const SOURCE_TYPES: readonly SourceType[] = ['xtream', 'm3u'];

/** The DOM id of a field's input (the text editor finds it by this). */
export function fieldDomId(id: FieldId): string {
  return `onboarding-${id}`;
}

export type LoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly progress: LoadProgress | null }
  | { readonly status: 'failed'; readonly code: LoadErrorCode; readonly httpStatus: number | null }
  | { readonly status: 'done'; readonly result: LoadResult };

export interface Onboarding {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly editor: EditorBinding;
  /** The language screen (the root until the source is added). */
  readonly home: Screen;
  /** The root screen: the language screen, then the done screen once the source is added. */
  readonly root: ReadonlySignal<Screen>;
  /** The language picked on the first screen (or saved by an earlier start); `null`: the TV's shows. */
  readonly language: ReadonlySignal<Language | null>;
  /** The answer on the device-ID screen; `null` until then. */
  readonly consent: ReadonlySignal<boolean | null>;
  readonly type: ReadonlySignal<SourceType>;
  readonly values: ReadonlySignal<FormValues>;
  /** The fields the last "Add source" refused. A field's problem clears when it changes. */
  readonly problems: ReadonlySignal<FormProblems>;
  /** The source being added. */
  readonly draft: ReadonlySignal<SourceDraft | null>;
  readonly load: ReadonlySignal<LoadState>;
  /** "Start watching" was pressed on the last screen. */
  readonly finished: ReadonlySignal<boolean>;
  readonly exitRequested: ReadonlySignal<boolean>;
  setValue(id: FieldId, value: string): void;
  /** Focuses the TV's language on the first screen (the device info arrives after the first render). */
  preselect(language: Language): void;
  dispose(): void;
}

/** An answer as it is given: the language, when the disclaimer was accepted, the consent. */
export interface OnboardingAnswer {
  readonly language?: Language;
  readonly disclaimerAt?: number;
  readonly consent?: boolean;
}

export interface OnboardingOptions {
  readonly platform: Pick<Platform, 'rootBackPolicy' | 'exitApp' | 'textKey' | 'onSoftKeyboard'>;
  readonly loader: SourceLoader;
  /** Called with each answer as it is given (the app saves it in the profile). */
  readonly answer?: (answer: OnboardingAnswer) => void;
  /** The answers saved by an earlier start that didn't finish: the language is shown and focused. */
  readonly initial?: { readonly language: Language | null };
  /** Finds a field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing, in the navigator and the editor). */
  readonly now?: () => number;
}

const ONE: ScreenSpec['zones'] = [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 1 }];
const TWO: ScreenSpec['zones'] = [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }];

function formZones(type: SourceType): ScreenSpec['zones'] {
  return [
    { kind: 'list', id: 'fields', axis: 'vertical', count: FORM_FIELDS[type].length, neighbours: { down: 'actions' } },
    { kind: 'list', id: 'actions', axis: 'horizontal', count: 1, neighbours: { up: 'fields' } },
  ];
}

export function createOnboarding(options: OnboardingOptions): Onboarding {
  const { platform, loader } = options;
  const answer = options.answer ?? ((): void => undefined);
  const clock = options.now ?? (() => Date.now());
  const saved = options.initial?.language ?? null;
  const language = signal<Language | null>(saved !== null && LANGUAGES.indexOf(saved) !== -1 ? saved : null);
  const consent = signal<boolean | null>(null);
  const type = signal<SourceType>('xtream');
  const values = signal<FormValues>({});
  const problems = signal<FormProblems>({});
  const draft = signal<SourceDraft | null>(null);
  const load = signal<LoadState>({ status: 'idle' });
  const finished = signal(false);
  const exitRequested = signal(false);

  /** The load running, if any: answers from an older one are dropped. */
  let current: { handle: LoadHandle | null } | null = null;
  let loading: Screen | null = null;

  /** Stops the running load, if any; its answer will never land. */
  const cancelLoad = (): void => {
    if (current === null) return;
    current.handle?.cancel();
    current = null;
    load.value = { status: 'idle' };
  };

  const startLoad = (source: SourceDraft): void => {
    cancelLoad();
    const mine: { handle: LoadHandle | null } = { handle: null };
    current = mine;
    load.value = { status: 'running', progress: null };
    // A loader may report progress before start() returns: `mine` is current already.
    const handle = loader.start(source, (progress) => {
      if (current === mine) load.value = { status: 'running', progress };
    });
    mine.handle = handle;
    handle.done.then(
      (result) => {
        if (current !== mine) return;
        current = null;
        load.value = { status: 'done', result };
        // The source is added: onboarding leaves the back stack.
        root.value = nav.reset(doneSpec);
      },
      (error: unknown) => {
        if (current !== mine) return;
        current = null;
        const failure = error instanceof LoadError ? error : new LoadError('other');
        load.value = { status: 'failed', code: failure.code, httpStatus: failure.status };
        loading?.update(TWO[0]!);
        loading?.focus('actions', 0);
      },
    );
  };

  const loadingSpec: ScreenSpec = {
    id: 'loading',
    zones: ONE,
    onIntent: (intent) => {
      if (intent === 'BACK') cancelLoad();
      return false;
    },
    onSelect: (focus) => {
      const state = load.value;
      if (state.status === 'failed') {
        if (focus.index === 1 && draft.value !== null) {
          loading?.update(ONE[0]!);
          startLoad(draft.value);
          return;
        }
        nav.pop();
        return;
      }
      // Cancel.
      cancelLoad();
      nav.pop();
    },
  };

  const doneSpec: ScreenSpec = {
    id: 'done',
    zones: ONE,
    onSelect: () => {
      finished.value = true;
    },
  };

  const submit = (): void => {
    const checked = checkForm(type.value, values.value);
    problems.value = checked.problems;
    if (checked.draft === null) {
      const first = firstProblem(type.value, checked.problems);
      if (first >= 0) nav.top.focus('fields', first);
      return;
    }
    draft.value = checked.draft;
    textEditor.close();
    loading = nav.push(loadingSpec);
    startLoad(checked.draft);
  };

  const formSpec = (source: SourceType): ScreenSpec => ({
    id: 'form',
    zones: formZones(source),
    onSelect: (focus) => {
      if (focus.zone === 'actions') {
        submit();
        return;
      }
      const field = FORM_FIELDS[source][focus.index];
      if (field !== undefined) textEditor.open(fieldDomId(field.id));
    },
  });

  const sourceSpec: ScreenSpec = {
    id: 'source',
    zones: [{ kind: 'list', id: 'types', axis: 'vertical', count: SOURCE_TYPES.length }],
    onSelect: (focus) => {
      const picked = SOURCE_TYPES[focus.index] ?? 'xtream';
      type.value = picked;
      problems.value = {};
      nav.push(formSpec(picked));
    },
  };

  const consentSpec: ScreenSpec = {
    id: 'consent',
    zones: TWO,
    onSelect: (focus) => {
      const allowed = focus.index === 0;
      consent.value = allowed;
      answer({ consent: allowed });
      nav.push(sourceSpec);
    },
  };

  const disclaimerSpec: ScreenSpec = {
    id: 'disclaimer',
    zones: ONE,
    onSelect: () => {
      answer({ disclaimerAt: clock() });
      nav.push(consentSpec);
    },
  };

  const nav = createNavigator({
    root: {
      id: 'language',
      zones: [{ kind: 'list', id: 'languages', axis: 'horizontal', count: LANGUAGES.length }],
      onSelect: (focus) => {
        const picked = LANGUAGES[focus.index] ?? 'en';
        language.value = picked;
        answer({ language: picked });
        nav.push(disclaimerSpec);
      },
    },
    rootBack: platform.rootBackPolicy(),
    now: options.now,
    exit: () => {
      exitRequested.value = true;
      platform.exitApp();
    },
    exitDialog: () => {
      nav.push({
        id: 'exit',
        zones: TWO,
        onSelect: (focus) => {
          // The browser can't close its tab, so the dialog closes either way.
          if (focus.index === 1) {
            exitRequested.value = true;
            platform.exitApp();
          }
          nav.pop();
        },
      });
    },
  });

  const textEditor = createTextEditor({ platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);
  const binding = bindFocus(nav);
  const home = nav.top;
  const root = signal<Screen>(home);
  if (language.value !== null) home.focus('languages', LANGUAGES.indexOf(language.value));

  return {
    nav,
    binding,
    editor,
    home,
    root,
    language,
    consent,
    type,
    values,
    problems,
    draft,
    load,
    finished,
    exitRequested,
    setValue(id: FieldId, value: string): void {
      values.value = { ...values.value, [id]: value };
      if (problems.value[id] !== undefined) {
        const rest: FormProblems = { ...problems.value };
        delete rest[id];
        problems.value = rest;
      }
    },
    preselect(device: Language): void {
      if (nav.top !== home || language.value !== null) return;
      home.focus('languages', Math.max(0, LANGUAGES.indexOf(device)));
    },
    dispose(): void {
      cancelLoad();
      editor.dispose();
      textEditor.dispose();
      binding.dispose();
    },
  };
}
