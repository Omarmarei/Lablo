import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Platform } from '@lablo/platform-api';
import type { EditorBinding, Navigator, Screen, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { bindEditor, createTextEditor } from '@lablo/ui';
import type { Refusal } from '../gate/gate-state';
import type { FieldId, FormDraft, FormProblems, FormValues, SourceType } from '../onboarding/form';
import { FORM_FIELDS, checkForm, firstProblem } from '../onboarding/form';
import type { LoadErrorCode, LoadHandle, LoadProgress, LoadResult, SourceLoader } from '../onboarding/loader';
import { LoadError } from '../onboarding/loader';

/**
 * Adding a source on the TV itself (RELAY step 40f), a dialog over the sources screen: the same
 * form onboarding has (`FORM_FIELDS`, `checkForm`), typed with the settings' keyboard, loaded by the
 * same loader the phone's add uses (`createEngineLoader`), with its own words for the load:
 *
 *   form     (a kind: Xtream login or M3U playlist; its fields; "Add", "Cancel")
 *   loading  (what the load is doing; "Cancel" ends it and returns to the form)
 *   failed   (why; "Edit details" returns to the form, "Try again" loads the same source again)
 *   refused  (the signed config refuses new sources: its words; "Edit details")
 *   done     (the counts; "Done", or "Set a PIN" and "Later" when locked groups came in and no PIN is set)
 *
 * The refreshes are held while a load runs (`busy`), as for the phone's add. Back closes the
 * dialog from the form and the end views, and cancels the load from the loading view.
 */

export const ADD_SCREEN = 'source-add';

export type AddView = 'form' | 'loading' | 'failed' | 'refused' | 'done';

/** The form's two kinds, in screen order. */
export const ADD_TYPES: readonly SourceType[] = ['xtream', 'm3u'];

export type AddAction = 'add' | 'cancel' | 'edit' | 'retry' | 'done' | 'pin' | 'later';

/** The buttons of a view, in screen order (`pin`: the done view offers "Set a PIN"). */
export function addActions(view: AddView, pin = false): readonly AddAction[] {
  if (view === 'form') return ['add', 'cancel'];
  if (view === 'loading') return ['cancel'];
  if (view === 'failed') return ['edit', 'retry'];
  if (view === 'refused') return ['edit'];
  return pin ? ['pin', 'later'] : ['done'];
}

export interface AddFormOptions {
  readonly nav: Navigator;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds a field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  readonly now?: () => number;
  readonly loader: SourceLoader;
  /** The signed config's refusal of new sources (`null`: none); without it nothing is refused. */
  readonly refusal?: ReadonlySignal<Refusal | null>;
  /** Called with `true` while a load runs, `false` after: main holds the refreshes. */
  readonly busy?: (on: boolean) => void;
  /** The source is in: the screens read it. */
  readonly added?: () => void;
  /** The done view's "Set a PIN" (step 38c3): the pad, then `kept` once a PIN is. Without it the done view has no such button. */
  readonly setPin?: (kept: () => void) => void;
}

export interface AddForm {
  readonly view: ReadonlySignal<AddView>;
  readonly type: ReadonlySignal<SourceType>;
  readonly values: ReadonlySignal<FormValues>;
  readonly problems: ReadonlySignal<FormProblems>;
  readonly progress: ReadonlySignal<LoadProgress | null>;
  /** The source's name while it loads or failed (what the words say). */
  readonly name: ReadonlySignal<string>;
  readonly failure: ReadonlySignal<{ readonly code: LoadErrorCode; readonly status: number | null } | null>;
  readonly refusal: ReadonlySignal<Refusal | null>;
  readonly result: ReadonlySignal<LoadResult | null>;
  readonly editor: EditorBinding;
  /** The fields of the kind being added, in screen order. */
  fields(): readonly FieldId[];
  /** The buttons of the view now shown. */
  actions(): readonly AddAction[];
  /** Opens the dialog on an empty form. */
  open(): void;
  /** Whether the dialog is on the stack. */
  readonly shown: ReadonlySignal<boolean>;
  setType(type: SourceType): void;
  setValue(field: FieldId, value: string): void;
  dispose(): void;
}

/** The fields' kinds the form gives the keyboard. */
export function fieldKind(id: FieldId): 'text' | 'url' | 'password' {
  for (const type of ADD_TYPES) {
    const specs = FORM_FIELDS[type];
    for (let i = 0; i < specs.length; i += 1) if (specs[i]!.id === id) return specs[i]!.kind;
  }
  return 'text';
}

/** The DOM id of a field's input. */
export function addFieldId(id: FieldId): string {
  return 'source-add-' + id;
}

function valuesWith(values: FormValues, field: FieldId, value: string): FormValues {
  const next: FormValues = {};
  const keys = Object.keys(values) as FieldId[];
  for (let i = 0; i < keys.length; i += 1) next[keys[i]!] = values[keys[i]!];
  next[field] = value;
  return next;
}

function problemsWithout(problems: FormProblems, field: FieldId): FormProblems {
  const next: FormProblems = {};
  const keys = Object.keys(problems) as FieldId[];
  for (let i = 0; i < keys.length; i += 1) if (keys[i] !== field) next[keys[i]!] = problems[keys[i]!];
  return next;
}

export function createAddForm(options: AddFormOptions): AddForm {
  const { nav, loader } = options;
  const view = signal<AddView>('form');
  const type = signal<SourceType>('xtream');
  const values = signal<FormValues>({});
  const problems = signal<FormProblems>({});
  const progress = signal<LoadProgress | null>(null);
  const name = signal('');
  const failure = signal<{ readonly code: LoadErrorCode; readonly status: number | null } | null>(null);
  const refused = signal<Refusal | null>(null);
  const result = signal<LoadResult | null>(null);
  const shown = signal(false);
  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);
  let screen: Screen | null = null;
  /** The load running, if any: an older one's answer is dropped. */
  let current: { handle: LoadHandle | null } | null = null;
  /** The source of the last load, for "Try again". */
  let draft: FormDraft | null = null;

  const fields = (): readonly FieldId[] => FORM_FIELDS[type.peek()].map((spec) => spec.id);
  const asksPin = (): boolean => options.setPin !== undefined && view.peek() === 'done' && result.peek() !== null && result.peek()!.askPin === true;
  const actions = (): readonly AddAction[] => addActions(view.peek(), asksPin());

  /** The three zones always: the form fills the kind and the fields, the other views only the buttons (the others hold none). */
  const zones = (): ZoneSpec[] => {
    const form = view.peek() === 'form';
    return [
      { kind: 'list', id: 'type', axis: 'horizontal', count: form ? ADD_TYPES.length : 0, neighbours: { down: 'fields' } },
      { kind: 'list', id: 'fields', axis: 'vertical', count: form ? fields().length : 0, neighbours: { up: 'type', down: 'actions' } },
      { kind: 'list', id: 'actions', axis: 'horizontal', count: actions().length, neighbours: { up: 'fields' } },
    ];
  };

  /** Gives the open screen the zones of the view now shown. */
  const update = (): void => {
    const list = zones();
    for (let i = 0; i < list.length; i += 1) screen!.update(list[i]!);
  };

  /** Shows `next` (the zones follow it; the focus goes to its first button, or the form's first field). */
  const show = (next: AddView): void => {
    view.value = next;
    if (screen === null || !screen.open) return;
    update();
    if (next === 'form') screen.focus('fields', 0);
    else screen.focus('actions', 0);
  };

  const cancelLoad = (): void => {
    if (current === null) return;
    current.handle?.cancel();
    current = null;
    options.busy?.(false);
  };

  const close = (): void => {
    cancelLoad();
    textEditor.close();
    shown.value = false;
    const closing = screen;
    screen = null;
    if (closing !== null && nav.top === closing) nav.pop();
  };

  const load = (source: FormDraft): void => {
    draft = source;
    name.value = source.name;
    failure.value = null;
    progress.value = null;
    const refusal = options.refusal === undefined ? null : options.refusal.peek();
    if (refusal !== null) {
      refused.value = refusal;
      show('refused');
      return;
    }
    const mine: { handle: LoadHandle | null } = { handle: null };
    current = mine;
    options.busy?.(true);
    show('loading');
    const handle = loader.start(source, (next) => {
      if (current === mine) progress.value = next;
    });
    mine.handle = handle;
    handle.done.then(
      (done) => {
        if (current !== mine) return;
        current = null;
        options.busy?.(false);
        result.value = done;
        options.added?.();
        show('done');
      },
      (error: unknown) => {
        if (current !== mine) return;
        current = null;
        options.busy?.(false);
        const cause = error instanceof LoadError ? error : new LoadError('other');
        failure.value = { code: cause.code, status: cause.status };
        show('failed');
      },
    );
  };

  const submit = (): void => {
    const checked = checkForm(type.peek(), values.peek());
    problems.value = checked.problems;
    if (checked.draft === null) {
      nav.top.focus('fields', Math.max(0, firstProblem(type.peek(), checked.problems)));
      return;
    }
    load(checked.draft);
  };

  const act = (action: AddAction | undefined): void => {
    if (action === 'add') submit();
    else if (action === 'edit') show('form');
    else if (action === 'retry' && draft !== null) load(draft);
    else if (action === 'pin') {
      const mine = screen;
      options.setPin!(() => {
        if (mine !== null && screen === mine) close();
      });
    } else if (action === 'cancel') {
      // A load running is ended first; the form comes back with what was typed.
      if (view.peek() === 'loading') {
        cancelLoad();
        show('form');
      } else close();
    } else close();
  };

  return {
    view,
    type,
    values,
    problems,
    progress,
    name,
    failure,
    refusal: refused,
    result,
    editor,
    shown,
    fields,
    actions,
    open(): void {
      if (screen !== null) return;
      type.value = 'xtream';
      values.value = {};
      problems.value = {};
      progress.value = null;
      failure.value = null;
      result.value = null;
      draft = null;
      view.value = 'form';
      shown.value = true;
      const pushed = nav.push({
        id: ADD_SCREEN,
        zones: zones(),
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          // Back from the loading view ends the load and returns to the form; from the others it closes.
          if (view.peek() === 'loading') {
            cancelLoad();
            show('form');
          } else if (view.peek() === 'failed' || view.peek() === 'refused') show('form');
          else close();
          return true;
        },
        onSelect: (focus) => {
          if (focus.zone === 'type') {
            // (The kind's button: the fields change under it, the focus stays on the buttons.)
            const picked = ADD_TYPES[focus.index];
            if (picked !== undefined) setType(picked);
          } else if (focus.zone === 'fields') textEditor.open(addFieldId(fields()[focus.index]!));
          else act(actions()[focus.index]);
        },
      });
      screen = pushed;
      pushed.focus('fields', 0);
    },
    setType: (next: SourceType): void => setType(next),
    setValue(field: FieldId, value: string): void {
      values.value = valuesWith(values.peek(), field, value);
      if (problems.peek()[field] !== undefined) problems.value = problemsWithout(problems.peek(), field);
    },
    dispose(): void {
      cancelLoad();
      editor.dispose();
      textEditor.dispose();
    },
  };

  function setType(next: SourceType): void {
    if (type.peek() === next) return;
    textEditor.close();
    type.value = next;
    problems.value = {};
    if (screen !== null && screen.open) update();
  }
}
