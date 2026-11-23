import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { SourceRecord, StoredSource } from '@lablo/data';
import type { Platform } from '@lablo/platform-api';
import type { EditorBinding, Navigator, TextEditorOptions } from '@lablo/ui';
import { bindEditor, createTextEditor } from '@lablo/ui';
import type { FieldId, FormProblems, FormValues, SourceDraft } from '../onboarding/form';
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
 *
 * **The PIN's check** (RELAY step 38c2, `check`): the same form for a source with its login, its
 * values empty but for an Xtream server; "Check" compares what was typed (after onboarding's
 * checks and normalising) with the stored login (`matchesLogin`). The same: the form closes and
 * `matched` goes on. Another: the form stays, says so, and the focus goes back to the first field
 * the user had to type. When the app can pair (step 38c4) the check's actions are "Check", "Use
 * your phone" (the login sent from the phone instead: `phone`) and "Cancel".
 */

export const LOGIN_SCREEN = 'source-login';

/** The actions' buttons ("Check" is `LOGIN_SAVE`'s place). */
export const LOGIN_SAVE = 0;
export const LOGIN_CANCEL = 1;
/** The check's "Use your phone" (step 38c4), between "Check" and "Cancel" when the app can pair. */
export const LOGIN_PHONE = 1;

/** A source the form gives a login: an Xtream source or an M3U playlist (a phone's file has none). */
export type LoginSource = Exclude<StoredSource, { type: 'm3u-file' }>;

/** A source whose login the PIN's check can compare (step 38c2): one with its login, not a phone's file. */
export type CheckSource = Exclude<SourceRecord, { type: 'm3u-file' }>;

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

/** What the PIN's check shows when it opens (step 38c2): an Xtream source's server, nothing else. */
export function checkValues(source: CheckSource): FormValues {
  return source.type === 'xtream' ? { server: source.account.base, username: '', password: '' } : { playlist: '' };
}

/** The sources whose login the PIN's check can compare (step 38c2): with their login, in the profile's order. */
export function checkSources(sources: readonly StoredSource[]): CheckSource[] {
  const usable: CheckSource[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]!;
    if (source.type === 'xtream' ? source.account !== null : source.type === 'm3u' && source.url !== null) usable.push(source as CheckSource);
  }
  return usable;
}

/** Whether `record` (the form's, checked and normalised) holds `source`'s stored login, to the letter (step 38c2). */
export function matchesLogin(source: CheckSource, record: SourceRecord): boolean {
  if (source.type === 'xtream') {
    if (record.type !== 'xtream') return false;
    const a = source.account;
    const b = record.account;
    return a.base === b.base && a.username === b.username && a.password === b.password;
  }
  return record.type === 'm3u' && record.url === source.url;
}

/**
 * Whether the phone's source (the PIN's check by phone, step 38c4: `pairDraft`'s, through the
 * same form checks as the typed one) holds the stored login of any of `sources`. A phone's file
 * has no login.
 */
export function loginOnTv(sources: readonly CheckSource[], draft: SourceDraft): boolean {
  if (draft.type === 'm3u-file') return false;
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]!;
    const record: SourceRecord =
      draft.type === 'xtream'
        ? { id: source.id, type: 'xtream', name: source.name, account: draft.account, added: source.added }
        : { id: source.id, type: 'm3u', name: source.name, url: draft.url, added: source.added };
    if (matchesLogin(source, record)) return true;
  }
  return false;
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
  /** The form's screen id (default `LOGIN_SCREEN`; the PIN's check has its own, step 38c2). */
  readonly id?: string;
  /** "Save", the checks passed: the source with its login (none for the PIN's check alone). */
  readonly save?: (record: SourceRecord) => void;
}

export interface LoginForm {
  readonly editor: EditorBinding;
  /** The source the form is for while it shows (`null`: closed). */
  readonly source: ReadonlySignal<LoginSource | null>;
  readonly values: ReadonlySignal<FormValues>;
  /** The fields the last "Save" refused; a field's problem clears when it changes. */
  readonly problems: ReadonlySignal<FormProblems>;
  /** The form was last opened for the PIN's check (step 38c2). */
  readonly checking: ReadonlySignal<boolean>;
  /** The check's last login wasn't the stored one; clears when a field changes. */
  readonly mismatch: ReadonlySignal<boolean>;
  /** The check offers "Use your phone" (step 38c4). */
  readonly phone: ReadonlySignal<boolean>;
  /** Opens the form for `source`, the focus on its first empty field. */
  open(source: LoginSource): void;
  /** Opens it for the PIN's check of `source`'s login: `matched` once it is the stored one; `phone`: "Use your phone" (step 38c4). */
  check(source: CheckSource, matched: () => void, phone?: () => void): void;
  /** Closes the form when it shows (on top). */
  close(): void;
  setValue(field: LoginField, value: string): void;
  dispose(): void;
}

export function createLoginForm(options: LoginFormOptions): LoginForm {
  const { nav } = options;
  const source = signal<LoginSource | null>(null);
  const values = signal<FormValues>({});
  const problems = signal<FormProblems>({});
  const checking = signal(false);
  const mismatch = signal(false);
  const phone = signal(false);
  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);
  /** The PIN's check while the form is open for it: the source and what goes on after a match. */
  let against: { readonly source: CheckSource; readonly matched: () => void; readonly phone?: () => void } | null = null;
  /** The first field the user had to type when the form opened. */
  let first = 0;

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
    const check = against;
    if (check !== null) {
      if (!matchesLogin(check.source, checked.record)) {
        mismatch.value = true;
        nav.top.focus('fields', first);
        return;
      }
      close();
      check.matched();
      return;
    }
    close();
    options.save?.(checked.record);
  };

  const show = (from: LoginSource, shown: FormValues): void => {
    const fields = LOGIN_FIELDS[from.type];
    source.value = from;
    values.value = shown;
    problems.value = {};
    mismatch.value = false;
    const screen = nav.push({
      id: options.id ?? LOGIN_SCREEN,
      zones: [
        { kind: 'list', id: 'fields', axis: 'vertical', count: fields.length, neighbours: { down: 'actions' } },
        { kind: 'list', id: 'actions', axis: 'horizontal', count: phone.value ? 3 : 2, neighbours: { up: 'fields' } },
      ],
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        close();
        return true;
      },
      onSelect: (focus) => {
        if (focus.zone === 'fields') textEditor.open(loginFieldId(fields[focus.index]!));
        else if (focus.index === LOGIN_SAVE) submit(from);
        else if (focus.index === LOGIN_PHONE && phone.value && against !== null && against.phone !== undefined) {
          // The form stays under the pairing screen: Back there returns to it.
          textEditor.close();
          against.phone();
        } else close();
      },
    });
    // The first empty field: an Xtream source's server is filled in (the check's form always has one).
    for (let i = 0; i < fields.length; i += 1) {
      if (shown[fields[i]!] === '') {
        first = i;
        screen.focus('fields', i);
        return;
      }
    }
  };

  return {
    editor,
    source,
    values,
    problems,
    checking,
    mismatch,
    phone,
    open(from: LoginSource): void {
      against = null;
      checking.value = false;
      phone.value = false;
      show(from, loginValues(from));
    },
    check(from: CheckSource, matched: () => void, byPhone?: () => void): void {
      against = byPhone === undefined ? { source: from, matched } : { source: from, matched, phone: byPhone };
      checking.value = true;
      phone.value = byPhone !== undefined;
      show(from, checkValues(from));
    },
    close(): void {
      if (source.value !== null) close();
    },
    setValue(field: LoginField, value: string): void {
      values.value = withValue(values.value, field, value);
      if (problems.value[field] !== undefined) problems.value = without(problems.value, field);
      mismatch.value = false;
    },
    dispose(): void {
      editor.dispose();
      textEditor.dispose();
    },
  };
}
