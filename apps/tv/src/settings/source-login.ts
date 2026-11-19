import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { SourceRecord, StoredSource } from '@lablo/data';
import type { Platform } from '@lablo/platform-api';
import type { EditorBinding, Navigator, TextEditorOptions } from '@lablo/ui';
import { bindEditor, createTextEditor } from '@lablo/ui';
import type { FieldId, FormProblems, FormValues } from '../onboarding/form';
import { checkForm, firstProblem } from '../onboarding/form';

/**
 * The form that gives a source its login or link again (RELAY step 32d4b, architecture.md §3.3 B),
 * a dialog over the sources screen, for a source a backup made without logins brought back, or
 * one whose last save didn't work:
 *
 *   fields   (an Xtream source: its server, filled in with the one it kept, the user name and the
 *             password; an M3U playlist: its link, with the host it was on as the hint)
 *   actions  ("Save", "Cancel")
 *
 * The checks are onboarding's (`checkForm`: required, `normalizeXtreamBase`, `normalizeLink`, no
 * spaces); a refused field gets the focus. "Save" closes the form and gives the source with its
 * login to `save`, under its own id, name and `added`. Back and "Cancel" close it.
 */

export const LOGIN_SCREEN = 'source-login';

/** The actions' buttons. */
export const LOGIN_SAVE = 0;
export const LOGIN_CANCEL = 1;

/** A source the form gives a login: an Xtream source or an M3U playlist (a phone's file has none). */
export type LoginSource = Exclude<StoredSource, { type: 'm3u-file' }>;

/** The form's fields: onboarding's, without the guide link and the name. */
export type LoginField = Extract<FieldId, 'server' | 'username' | 'password' | 'playlist'>;

export const LOGIN_FIELDS: Readonly<Record<LoginSource['type'], readonly LoginField[]>> = {
  xtream: ['server', 'username', 'password'],
  m3u: ['playlist'],
};

/** The DOM id of a field's input (the text editor finds it by this). */
export function loginFieldId(field: LoginField): string {
  return 'source-login-' + field;
}

/** What the form shows when it opens: the server the source kept, or the login it was given last. */
export function loginValues(source: LoginSource): FormValues {
  if (source.type === 'xtream') {
    const account = source.account;
    return account === null ? { server: source.base, username: '', password: '' } : { server: account.base, username: account.username, password: account.password };
  }
  return { playlist: source.url === null ? '' : source.url };
}

/** The form's check: onboarding's, for its own fields; the source with its login when nothing is refused. */
export function checkLogin(source: LoginSource, values: FormValues): { readonly problems: FormProblems; readonly record: SourceRecord | null } {
  const fields = LOGIN_FIELDS[source.type];
  const own: FormValues = {};
  for (let i = 0; i < fields.length; i += 1) own[fields[i]!] = values[fields[i]!] ?? '';
  const checked = checkForm(source.type, own);
  const draft = checked.draft;
  if (draft === null) return { problems: checked.problems, record: null };
  const record: SourceRecord =
    draft.type === 'xtream'
      ? { id: source.id, type: 'xtream', name: source.name, account: draft.account, added: source.added }
      : { id: source.id, type: 'm3u', name: source.name, url: draft.url, added: source.added };
  return { problems: checked.problems, record };
}

/** `values` with `field` set to `value` (a new object: no spread in TV code). */
function withValue(values: FormValues, field: LoginField, value: string): FormValues {
  const next: FormValues = {};
  const keys = Object.keys(values) as FieldId[];
  for (let i = 0; i < keys.length; i += 1) next[keys[i]!] = values[keys[i]!];
  next[field] = value;
  return next;
}

/** `problems` without `field`'s. */
function without(problems: FormProblems, field: LoginField): FormProblems {
  const next: FormProblems = {};
  const keys = Object.keys(problems) as FieldId[];
  for (let i = 0; i < keys.length; i += 1) if (keys[i] !== field) next[keys[i]!] = problems[keys[i]!];
  return next;
}

export interface LoginFormOptions {
  readonly nav: Navigator;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds a field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
  /** "Save", the checks passed: the source with its login. */
  readonly save: (record: SourceRecord) => void;
}

export interface LoginForm {
  readonly editor: EditorBinding;
  /** The source the form is for while it shows (`null`: closed). */
  readonly source: ReadonlySignal<LoginSource | null>;
  readonly values: ReadonlySignal<FormValues>;
  /** The fields the last "Save" refused; a field's problem clears when it changes. */
  readonly problems: ReadonlySignal<FormProblems>;
  /** Opens the form for `source`, the focus on its first empty field. */
  open(source: LoginSource): void;
  setValue(field: LoginField, value: string): void;
  dispose(): void;
}

export function createLoginForm(options: LoginFormOptions): LoginForm {
  const { nav } = options;
  const source = signal<LoginSource | null>(null);
  const values = signal<FormValues>({});
  const problems = signal<FormProblems>({});
  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  /** Closes the form (it is on top: only its own keys call this), ending the edit first. */
  const close = (): void => {
    textEditor.close();
    source.value = null;
    nav.pop();
  };

  const submit = (from: LoginSource): void => {
    const checked = checkLogin(from, values.value);
    problems.value = checked.problems;
    if (checked.record === null) {
      // (The form's fields are onboarding's first ones, in its order.)
      nav.top.focus('fields', firstProblem(from.type, checked.problems));
      return;
    }
    close();
    options.save(checked.record);
  };

  return {
    editor,
    source,
    values,
    problems,
    open(from: LoginSource): void {
      const fields = LOGIN_FIELDS[from.type];
      const shown = loginValues(from);
      source.value = from;
      values.value = shown;
      problems.value = {};
      const screen = nav.push({
        id: LOGIN_SCREEN,
        zones: [
          { kind: 'list', id: 'fields', axis: 'vertical', count: fields.length, neighbours: { down: 'actions' } },
          { kind: 'list', id: 'actions', axis: 'horizontal', count: 2, neighbours: { up: 'fields' } },
        ],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect: (focus) => {
          if (focus.zone === 'fields') textEditor.open(loginFieldId(fields[focus.index]!));
          else if (focus.index === LOGIN_SAVE) submit(from);
          else close();
        },
      });
      // The first empty field: an Xtream source's server is filled in.
      for (let i = 0; i < fields.length; i += 1) {
        if (shown[fields[i]!] === '') {
          screen.focus('fields', i);
          return;
        }
      }
    },
    setValue(field: LoginField, value: string): void {
      values.value = withValue(values.value, field, value);
      if (problems.value[field] !== undefined) problems.value = without(problems.value, field);
    },
    dispose(): void {
      editor.dispose();
      textEditor.dispose();
    },
  };
}
