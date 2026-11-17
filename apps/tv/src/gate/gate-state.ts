import type { ReadonlySignal } from '@preact/signals';
import { computed, signal } from '@preact/signals';
import type { ConfigPolicy, LoadedProfile } from '@lablo/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import { isRuleId, policyStops } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { FocusBinding, Navigator, ScreenSpec, ZoneSpec } from '@lablo/ui';
import { bindFocus, createNavigator, watchPointerMoves } from '@lablo/ui';

/**
 * The signed config's gate (RELAY step 30c2a, architecture.md §3.3 C): what the policy says
 * before the app may go on, over whatever screen shows.
 *
 * - **`disable-app`** (the policy's kill rule): a full-screen message, the doc's or the app's
 *   own, and "Close Lablo". The app stops under it (`stopped(true)`: the player closes, the
 *   catalog refreshes stop). The config schedule goes on, and a refresh that lifts the rule
 *   gives the app back where it was (`stopped(false)`).
 * - **An update** (`updateRequired`, below the platform's `minVersion`): the same screen asking
 *   for an update, with this version and the one needed.
 * - **A notice:** a dialog with the doc's message and "OK", once per rule id: closing it keeps
 *   its id (`shown`, into the profile), and the next notice not shown yet follows. A notice
 *   without a message never shows (there is nothing to say).
 *
 * `disable-app` comes first, then the update, then the notices in the doc's order.
 *
 * - **Keys:** while a view shows, the gate takes every key on a capture listener on the window,
 *   so the app's own remote wiring (a bubbling listener there) hears none, and a text field
 *   under it neither (its edit ends as the gate opens: `release`). OK or Back closes a notice;
 *   on the other two views they leave the app (`exitApp`). The wheel is swallowed too, and the
 *   Magic Remote's pointer works on the gate's own button.
 * - It starts with the profile's notices shown (`start`), as the config schedule does: the
 *   hello and gallery screens have neither.
 */

/** What the gate shows. */
export type GateView =
  /** `disable-app`: the doc's message (`null`: the app's own text). */
  | { readonly kind: 'disabled'; readonly id: string; readonly message: GateMessage | null }
  /** Below the platform's `minVersion`. */
  | { readonly kind: 'update'; readonly version: string; readonly minVersion: string }
  /** A notice not shown yet. */
  | { readonly kind: 'notice'; readonly id: string; readonly message: GateMessage };

/** A rule's own text in both languages. */
export interface GateMessage {
  readonly en: string;
  readonly ar: string;
}

/** The gate's screen ids (one per view kind) and its one zone. */
export const GATE_ZONE = 'buttons';

/** The view for `policy` with the notices `shown`, for this build's `version`; `null`: nothing to show. */
export function gateView(policy: ConfigPolicy, shown: readonly string[], version: string): GateView | null {
  const kill = policy.kill;
  if (kill !== null && policyStops(policy, 'disable-app')) return { kind: 'disabled', id: kill.id, message: kill.message };
  if (policy.updateRequired) return { kind: 'update', version, minVersion: policy.minVersion ?? '' };
  for (let i = 0; i < policy.notices.length; i++) {
    const rule = policy.notices[i]!;
    if (rule.message !== null && shown.indexOf(rule.id) === -1) return { kind: 'notice', id: rule.id, message: rule.message };
  }
  return null;
}

/** The app stops under the view: everything but a notice. */
export function stopsApp(view: GateView | null): boolean {
  return view !== null && view.kind !== 'notice';
}

/** A rule's text in the UI's language (English for any other, the pseudo-locale's included). */
export function messageIn(message: GateMessage, language: string): string {
  return language === 'ar' ? message.ar : message.en;
}

/** The notices a profile has shown (`noticesShown`, step 30c2a): rule ids only, in order. */
export function noticesShownOf(profile: LoadedProfile | null): string[] {
  const list = profile === null ? undefined : (profile.doc as { noticesShown?: unknown }).noticesShown;
  const ids: string[] = [];
  if (!Array.isArray(list)) return ids;
  for (let i = 0; i < list.length; i++) {
    const id: unknown = list[i];
    if (isRuleId(id)) ids.push(id);
  }
  return ids;
}

export interface GateOptions {
  /** The config schedule's policy. */
  readonly policy: ReadonlySignal<ConfigPolicy>;
  /** This build's version (the update view shows it). */
  readonly version: string;
  readonly platform: Pick<Platform, 'keyToIntent' | 'onPointer' | 'exitApp'>;
  /** Where keys, the wheel and pointer moves are heard: the window. */
  readonly target: EventTarget;
  /** A notice was closed: its id goes into the profile (best effort). */
  readonly shown: (id: string) => void;
  /** The app stops under the gate (`true`), or may go on (`false`, after a stop only). */
  readonly stopped: (on: boolean) => void;
  /** A view opened: the page's DOM focus leaves any text field (default: the active element blurs). */
  readonly release?: () => void;
}

export interface Gate {
  /** What shows (`null`: nothing, the app has the keys). */
  readonly view: ReadonlySignal<GateView | null>;
  /** The gate's own navigator and its focus. */
  readonly binding: FocusBinding;
  /** "Close Lablo" or Back was pressed (the browser can't close its tab: the e2e reads this). */
  readonly exitRequested: ReadonlySignal<boolean>;
  /** Follows the policy from now, with the notices the profile has shown. Only the first call counts. */
  start(shown: readonly string[]): void;
  /** Stops following the policy and gives the keys back. */
  dispose(): void;
}

const CAPTURE: AddEventListenerOptions = { capture: true };
const BUTTONS: readonly ZoneSpec[] = [{ kind: 'list', id: GATE_ZONE, axis: 'horizontal', count: 1 }];

/** Blurs the page's focused element (a text field being edited ends its edit on blur). */
function releaseFocus(): void {
  const active = typeof document === 'undefined' ? null : (document.activeElement as { blur?: () => void } | null);
  if (active !== null && typeof active.blur === 'function') active.blur();
}

export function createGate(options: GateOptions): Gate {
  const { platform, target } = options;
  const started = signal(false);
  const shown = signal<readonly string[]>([]);
  const exitRequested = signal(false);
  const view = computed(() => (started.value ? gateView(options.policy.value, shown.value, options.version) : null));

  const act = (): void => {
    const current = view.peek();
    if (current === null) return;
    if (current.kind === 'notice') {
      // (No `concat`: Babel would add core-js's by name.)
      const ids = shown.peek().slice();
      ids.push(current.id);
      shown.value = ids;
      options.shown(current.id);
      return;
    }
    exitRequested.value = true;
    platform.exitApp();
  };

  const screenFor = (kind: GateView['kind']): ScreenSpec => ({
    id: kind,
    zones: BUTTONS,
    onIntent: (intent) => {
      if (intent !== 'BACK') return false;
      act();
      return true;
    },
    onSelect: () => act(),
  });

  // The root never shows: the gate's screen replaces it while a view is up.
  const nav: Navigator = createNavigator({
    root: { id: 'none', zones: BUTTONS },
    rootBack: 'platform-back',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const binding = bindFocus(nav);

  const onKey = (event: Event): void => {
    // Nothing under the gate hears a key (immediate: not even a listener on the window itself).
    event.stopImmediatePropagation();
    const intent = platform.keyToIntent(event as KeyboardEvent);
    if (intent === null) return;
    event.preventDefault();
    nav.handle(intent);
  };
  const onWheel = (event: Event): void => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const wheelOptions: AddEventListenerOptions = { capture: true, passive: false };
  let disconnect: (() => void) | null = null;
  const connect = (): void => {
    target.addEventListener('keydown', onKey, CAPTURE);
    target.addEventListener('wheel', onWheel, wheelOptions);
    const stopMoves = watchPointerMoves(target, () => nav.pointer(true));
    const stopPointer = platform.onPointer((visible) => nav.pointer(visible));
    disconnect = () => {
      target.removeEventListener('keydown', onKey, CAPTURE);
      target.removeEventListener('wheel', onWheel, wheelOptions);
      stopMoves();
      stopPointer();
    };
  };

  let kind: GateView['kind'] | null = null;
  let stopping = false;
  const follow = (next: GateView | null): void => {
    const nextKind = next === null ? null : next.kind;
    if (nextKind !== kind) {
      if (kind === null) {
        connect();
        (options.release ?? releaseFocus)();
      }
      if (nextKind === null) {
        disconnect?.();
        disconnect = null;
      }
      // A new screen for each kind: its one button focused.
      nav.reset(nextKind === null ? { id: 'none', zones: BUTTONS } : screenFor(nextKind));
      kind = nextKind;
    }
    const stop = stopsApp(next);
    if (stop !== stopping) {
      stopping = stop;
      options.stopped(stop);
    }
  };
  const unsubscribe = view.subscribe(follow);

  return {
    view,
    binding,
    exitRequested,
    start(ids) {
      if (started.peek()) return;
      shown.value = ids;
      started.value = true;
    },
    dispose() {
      unsubscribe();
      disconnect?.();
      binding.dispose();
    },
  };
}
