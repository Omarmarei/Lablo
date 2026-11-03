import type { FieldEditing } from '../focus/text-editor';
import type { FocusableProps } from './focusable';
import { focusClass } from './focusable';
import './TextField.css';

export type TextFieldKind = 'text' | 'url' | 'password';

export interface TextFieldProps extends FocusableProps {
  /** The input's DOM id: the text editor finds the input by it to give it DOM focus. */
  readonly id: string;
  /** From the catalogs. */
  readonly label: string;
  /** What is typed: the user's own text. */
  readonly value: string;
  /** `url` gets the TV keyboard's URL layout; `password` hides what is typed. */
  readonly kind?: TextFieldKind;
  /** The line under the box: what to type. An error takes its place. */
  readonly hint?: string;
  readonly error?: string | null;
  /**
   * Links, logins and passwords read left to right in both languages (the default for `url` and
   * `password`); a name is `auto`, so an Arabic name reads right to left.
   */
  readonly dir?: 'ltr' | 'auto';
  /** Each change of the text. */
  readonly onValue?: (value: string) => void;
  /** The editor's handlers for this field (`EditorBinding.field(id)`). */
  readonly edit?: FieldEditing;
}

/** The parts of an input event read here. */
interface InputTarget {
  readonly currentTarget: { readonly value: string };
}

/**
 * A text field (RELAY step 13a): a label, a native `<input>` and a line for the hint or the
 * error. The focus engine focuses the field with a class like any item; OK opens the editor,
 * which gives the input DOM focus, so the TV's on-screen keyboard opens (`createTextEditor`).
 * The input is kept out of Tab (`tabIndex -1`): the focus engine decides where the focus goes.
 *
 * The box is aligned to the label's side in both directions (its text-align is mirrored), while
 * a link inside it still reads left to right.
 */
export function TextField({ id, label, value, kind = 'text', hint, error, dir, onValue, edit, state, onHover, onPress, testId }: TextFieldProps) {
  const editing = edit?.editing === true;
  const invalid = error !== undefined && error !== null && error !== '';
  const note = invalid ? error : (hint ?? '');
  const base = `z-field${editing ? ' is-editing' : ''}${invalid ? ' is-invalid' : ''}`;
  const onInput = (event: InputTarget): void => {
    edit?.onEditInput();
    onValue?.(event.currentTarget.value);
  };
  return (
    <div
      class={focusClass(base, state)}
      data-testid={testId}
      data-state={state ?? 'idle'}
      data-editing={editing ? 'true' : 'false'}
      onMouseMove={onHover}
      onClick={onPress}
    >
      <label class="z-field__label" for={id}>
        {label}
      </label>
      <div class="z-field__box">
        <input
          id={id}
          class="z-field__input"
          type={kind}
          value={value}
          dir={dir ?? (kind === 'text' ? 'auto' : 'ltr')}
          tabIndex={-1}
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={`${id}-note`}
          onInput={onInput}
          onKeyDown={edit?.onEditKey}
          onFocus={edit?.onEditFocus}
          onBlur={edit?.onEditBlur}
        />
      </div>
      <p class="z-field__note" id={`${id}-note`} role={invalid ? 'alert' : undefined}>
        {note}
      </p>
    </div>
  );
}
