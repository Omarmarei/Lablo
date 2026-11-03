import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Focus, Navigator, Screen } from './navigator';
import type { FieldEditing, TextEditor } from './text-editor';
import type { ZonePosition, ZoneSpec } from './types';

/**
 * The focus engine as a signal, for Preact (RELAY step 11b). The engine itself stays
 * framework-free (docs/architecture.md §1.2): this binding is the one place that turns its
 * `subscribe` into a signal, and components read it through `useFocus` and `useZone`.
 */
export interface FocusBinding {
  readonly nav: Navigator;
  /** The focus: a new value after every change in the engine, zone positions included. */
  readonly focus: ReadonlySignal<Focus>;
  /** Stops following the engine. */
  dispose(): void;
}

export function bindFocus(nav: Navigator): FocusBinding {
  const focus = signal(nav.snapshot());
  const stop = nav.subscribe((next) => {
    focus.value = next;
  });
  return { nav, focus, dispose: stop };
}

/** The focus, read from the signal: the component that calls it re-renders on every change. */
export function useFocus(binding: FocusBinding): Focus {
  return binding.focus.value;
}

/**
 * How an item looks to the focus engine:
 * - `focused`: the focus is on it (its zone is active and its screen is on top);
 * - `memory`: its zone's remembered item while the focus is elsewhere, or under a screen
 *   pushed on top (where Back returns to);
 * - `idle`: anything else.
 */
export type ItemState = 'focused' | 'memory' | 'idle';

/** What a focusable component takes from its zone: its look and its pointer handlers. */
export interface ItemBinding {
  readonly state: ItemState;
  /** The pointer moved over the item (`mousemove`): `Screen.hover`. */
  readonly onHover: () => void;
  /** A pointer click on the item: `Screen.click`. */
  readonly onPress: () => void;
}

export interface ZoneView {
  readonly spec: ZoneSpec;
  readonly position: ZonePosition;
  /** The focus is in this zone, on the top screen. */
  readonly active: boolean;
  state(index: number): ItemState;
  /** The binding for item `index` (EPG: row `index`, the cell at `time`). */
  item(index: number, time?: number): ItemBinding;
}

/**
 * One zone of a screen, read for rendering. It reads the focus signal, so the calling
 * component re-renders on every change of the engine.
 */
export function useZone(binding: FocusBinding, screen: Screen, zone: string): ZoneView {
  useFocus(binding);
  const spec = screen.zone(zone);
  const position = screen.position(zone);
  const active = binding.nav.top === screen && screen.active === zone;
  const state = (index: number): ItemState =>
    index !== position.index ? 'idle' : active ? 'focused' : 'memory';
  return {
    spec,
    position,
    active,
    state,
    item: (index, time) => ({
      state: state(index),
      onHover: () => {
        screen.hover(zone, index, time);
      },
      onPress: () => {
        screen.click(zone, index, time);
      },
    }),
  };
}

/**
 * The text editor as a signal (RELAY step 13a): `field(id)` reads it, so the component that
 * calls it re-renders when an edit starts or ends.
 */
export interface EditorBinding {
  readonly editor: TextEditor;
  /** The field being edited, or `null`. */
  readonly editing: ReadonlySignal<string | null>;
  /** What a `TextField` takes for field `id` (its `edit` prop). */
  field(id: string): FieldEditing;
  /** Stops following the editor. */
  dispose(): void;
}

export function bindEditor(editor: TextEditor): EditorBinding {
  const editing = signal(editor.editing);
  const stop = editor.subscribe((next) => {
    editing.value = next;
  });
  return {
    editor,
    editing,
    field(id: string): FieldEditing {
      const handlers = editor.field(id);
      return { ...handlers, editing: editing.value === id };
    },
    dispose: stop,
  };
}
