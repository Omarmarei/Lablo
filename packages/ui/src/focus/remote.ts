import type { Intent, Platform } from '@lablo/platform-api';
import type { Navigator } from './navigator';
import { watchPointerMoves } from './pointer';

export interface RemoteOptions {
  readonly platform: Pick<Platform, 'keyToIntent' | 'onPointer'>;
  readonly nav: Navigator;
  /** Where keys, the wheel and pointer moves are heard: the window. */
  readonly target: EventTarget;
  /** Sees each Intent before the navigator does (activity tracking, a key log). */
  readonly onIntent?: (intent: Intent) => void;
}

/** The parts of a `WheelEvent` read here. */
interface WheelLike {
  readonly deltaY: number;
  preventDefault(): void;
}

/**
 * True for a text field (`<input>`, `<textarea>`, an editable element): while it has DOM focus
 * its keys are typing, and the field's own handler ends the edit (`TextEditor`, RELAY step 13a).
 */
export function isEditable(target: EventTarget | null): boolean {
  const element = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown } | null;
  if (element === null || typeof element !== 'object') return false;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable === true;
}

/**
 * Connects the remote to the focus engine (docs/architecture.md §1.2):
 * - keys: the platform's key map turns each into an Intent for `Navigator.handle` (and the
 *   browser's own action, such as scrolling, is cancelled). Keys aimed at a text field are
 *   left to it: Backspace deletes there, though it is Back on the desktop keyboard;
 * - the Magic Remote: the pointer shows itself by moving (`watchPointerMoves`) and, on webOS,
 *   through the system's own events (`Platform.onPointer`); keys that move the focus hide it;
 * - the wheel scrolls the focused zone one row per event, never the page (non-passive).
 *
 * Returns a function that disconnects everything.
 */
export function connectRemote({ platform, nav, target, onIntent }: RemoteOptions): () => void {
  const onKey = (event: Event): void => {
    if (isEditable(event.target)) return;
    const key = event as KeyboardEvent;
    const intent = platform.keyToIntent(key);
    if (intent === null) return;
    key.preventDefault();
    onIntent?.(intent);
    nav.handle(intent);
  };
  const onWheel = (event: Event): void => {
    const wheel = event as unknown as WheelLike;
    wheel.preventDefault();
    if (wheel.deltaY !== 0) nav.wheel(wheel.deltaY > 0 ? 1 : -1);
  };
  const wheelOptions: AddEventListenerOptions = { passive: false };
  target.addEventListener('keydown', onKey);
  target.addEventListener('wheel', onWheel, wheelOptions);
  const stopMoves = watchPointerMoves(target, () => nav.pointer(true));
  const stopPointer = platform.onPointer((visible) => nav.pointer(visible));
  return () => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('wheel', onWheel, wheelOptions);
    stopMoves();
    stopPointer();
  };
}
