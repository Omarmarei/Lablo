import type { Intent, RootBackPolicy } from '@zoma/platform-api';
import type { Direction, TextDirection, ZonePosition, ZoneSpec } from './types';
import { moveDirection } from './types';
import { clampPosition, initialPosition, page, pages, scroll, step, zoneCount } from './zones';

/** What has the focus: a zone of the top screen, and the item in it. */
export interface Focus {
  readonly screen: string;
  readonly zone: string;
  /** The focused item (EPG: row), or -1 while the zone is empty. */
  readonly index: number;
  /** EPG zones: the cursor in UTC minutes; `null` in other zones. */
  readonly time: number | null;
  /** Screens on the back stack, the top one included. */
  readonly depth: number;
  /** Whether the Magic Remote pointer is in use (hover focuses only then). */
  readonly pointer: boolean;
  readonly dir: TextDirection;
}

export interface ScreenSpec {
  /** The route name, e.g. `home` or `exit`. */
  readonly id: string;
  /** At least one zone; ids unique within the screen. */
  readonly zones: readonly ZoneSpec[];
  /** The zone focused first. Default: the first zone. */
  readonly initial?: string;
  /**
   * Sees every Intent first (digits, colour keys, BACK to close an open menu). Returns true
   * when it handled the Intent, which then goes no further.
   */
  readonly onIntent?: (intent: Intent, focus: Focus) => boolean;
  /** OK on the focused item. */
  readonly onSelect?: (focus: Focus) => void;
}

/** A screen on the back stack. Its zones keep their positions while it is covered. */
export interface Screen {
  readonly id: string;
  /** The focused zone. */
  readonly active: string;
  /** False once the screen has left the stack; it then ignores updates. */
  readonly open: boolean;
  position(zone: string): ZonePosition;
  /** Replaces a zone's spec (new count, rects…), keeping its position where it still fits. */
  update(zone: ZoneSpec): void;
  /** Focuses an item from code (e.g. the last channel watched) and makes its zone active. */
  focus(zone: string, index: number, time?: number): void;
  /** Forgets a zone's position (e.g. a new category): back to its first item. */
  reset(zone: string): void;
  /**
   * The pointer is over an item: focuses it when this is the top screen and the pointer is
   * in use. Returns whether it was taken.
   */
  hover(zone: string, index: number, time?: number): boolean;
}

/** What Back did: popped a screen, or at the root followed the platform's `rootBackPolicy`. */
export type BackOutcome = 'popped' | 'exit' | 'exit-dialog';

export type HandleResult =
  /** The screen's `onIntent` took it. */
  | 'screen'
  /** The focus moved inside its zone. */
  | 'moved'
  /** The focus moved to a neighbour zone. */
  | 'zone'
  /** Nothing in that direction. */
  | 'edge'
  /** OK went to the screen's `onSelect`. */
  | 'select'
  | BackOutcome
  /** Not a navigation Intent, or nothing to do with it here. */
  | 'ignored';

export interface NavigatorOptions {
  /** The first screen; the stack is never empty. */
  readonly root: ScreenSpec;
  readonly dir?: TextDirection;
  /** `Platform.rootBackPolicy()`: what Back does on the root screen. */
  readonly rootBack: RootBackPolicy;
  /** `platform-back`: leave the app (`Platform.exitApp()`). */
  readonly exit: () => void;
  /** `exit-dialog`: show the exit dialog, normally by pushing its screen. */
  readonly exitDialog: () => void;
}

export interface Navigator {
  readonly dir: TextDirection;
  /** The screen on top of the back stack (the one that gets the keys). */
  readonly top: Screen;
  snapshot(): Focus;
  /** Called once after each change of focus, screen, pointer or direction. */
  subscribe(listener: (focus: Focus) => void): () => void;
  /** A remote key. Hides the pointer (keys take over from it, and the focus stays put). */
  handle(intent: Intent): HandleResult;
  back(): BackOutcome;
  push(spec: ScreenSpec): Screen;
  /** Swaps the top screen for a new one. */
  replace(spec: ScreenSpec): Screen;
  /** Clears the stack: `spec` becomes the root (after onboarding, say). */
  reset(spec: ScreenSpec): Screen;
  /** Closes the top screen; false on the root, which is never popped. */
  pop(): boolean;
  setDir(dir: TextDirection): void;
  /** The Magic Remote pointer appeared or disappeared. Hiding it keeps the focus where it is. */
  pointer(visible: boolean): void;
  /** The wheel: scrolls the focused zone by `steps` rows (positive: down / towards the end). */
  wheel(steps: number): boolean;
}

function samePosition(a: ZonePosition | undefined, b: ZonePosition): boolean {
  return a !== undefined && a.index === b.index && a.top === b.top && a.time === b.time && a.view === b.view;
}

class ScreenState implements Screen {
  readonly id: string;
  open = true;
  active: string;
  private readonly zones = new Map<string, ZoneSpec>();
  private readonly positions = new Map<string, ZonePosition>();

  constructor(
    readonly spec: ScreenSpec,
    private readonly nav: FocusNavigator,
  ) {
    this.id = spec.id;
    if (spec.zones.length === 0) throw new Error(`screen ${spec.id}: no zones`);
    for (const zone of spec.zones) {
      if (this.zones.has(zone.id)) throw new Error(`screen ${spec.id}: zone ${zone.id} twice`);
      this.zones.set(zone.id, zone);
      this.positions.set(zone.id, initialPosition(zone));
    }
    for (const zone of spec.zones) this.checkNeighbours(zone);
    this.active = spec.initial ?? spec.zones[0]!.id;
    this.zone(this.active);
  }

  zone(id: string): ZoneSpec {
    const zone = this.zones.get(id);
    if (zone === undefined) throw new Error(`screen ${this.id}: no zone ${id}`);
    return zone;
  }

  position(id: string): ZonePosition {
    this.zone(id);
    return this.positions.get(id)!;
  }

  set(id: string, pos: ZonePosition): void {
    if (samePosition(this.positions.get(id), pos)) return;
    this.positions.set(id, pos);
    this.nav.changed();
  }

  enter(id: string): void {
    if (this.active === id) return;
    this.active = id;
    this.nav.changed();
  }

  update(zone: ZoneSpec): void {
    if (!this.open) return;
    this.zone(zone.id);
    this.checkNeighbours(zone);
    this.zones.set(zone.id, zone);
    this.nav.batch(() => this.set(zone.id, clampPosition(zone, this.positions.get(zone.id)!)));
  }

  focus(id: string, index: number, time?: number): void {
    if (!this.open) return;
    this.place(id, index, time);
  }

  reset(id: string): void {
    if (!this.open) return;
    const zone = this.zone(id);
    this.nav.batch(() => this.set(id, initialPosition(zone)));
  }

  hover(id: string, index: number, time?: number): boolean {
    if (!this.open || !this.nav.pointerShown || this.nav.top !== this) return false;
    const zone = this.zones.get(id);
    if (zone === undefined || !(index >= 0 && index < zoneCount(zone))) return false;
    this.place(id, index, time);
    return true;
  }

  private place(id: string, index: number, time: number | undefined): void {
    const zone = this.zone(id);
    const pos = this.positions.get(id)!;
    this.nav.batch(() => {
      this.set(id, clampPosition(zone, { ...pos, index, time: time ?? pos.time }));
      this.enter(id);
    });
  }

  private checkNeighbours(zone: ZoneSpec): void {
    const neighbours = zone.neighbours ?? {};
    for (const direction of ['up', 'down', 'start', 'end'] as const) {
      const id = neighbours[direction];
      if (id !== undefined && !this.zones.has(id)) {
        throw new Error(`screen ${this.id}: zone ${zone.id} has an unknown ${direction} neighbour ${id}`);
      }
    }
  }
}

class FocusNavigator implements Navigator {
  dir: TextDirection;
  pointerShown = false;
  private readonly stack: ScreenState[] = [];
  private readonly listeners: Array<(focus: Focus) => void> = [];
  private batching = 0;
  private dirty = false;

  constructor(private readonly options: NavigatorOptions) {
    this.dir = options.dir ?? 'ltr';
    this.stack.push(new ScreenState(options.root, this));
  }

  get top(): ScreenState {
    return this.stack[this.stack.length - 1]!;
  }

  changed(): void {
    this.dirty = true;
  }

  /** Runs `fn`, then tells the listeners once if anything changed. */
  batch<T>(fn: () => T): T {
    this.batching += 1;
    try {
      return fn();
    } finally {
      this.batching -= 1;
      if (this.batching === 0 && this.dirty) {
        this.dirty = false;
        const focus = this.snapshot();
        for (const listener of this.listeners.slice()) listener(focus);
      }
    }
  }

  snapshot(): Focus {
    const screen = this.top;
    const pos = screen.position(screen.active);
    return {
      screen: screen.id,
      zone: screen.active,
      index: pos.index,
      time: screen.zone(screen.active).kind === 'epg' ? pos.time : null,
      depth: this.stack.length,
      pointer: this.pointerShown,
      dir: this.dir,
    };
  }

  subscribe(listener: (focus: Focus) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  handle(intent: Intent): HandleResult {
    return this.batch((): HandleResult => {
      this.pointer(false);
      const screen = this.top;
      if (screen.spec.onIntent?.(intent, this.snapshot()) === true) return 'screen';
      if (intent === 'BACK') return this.back();
      if (intent === 'OK') {
        const focus = this.snapshot();
        if (focus.index < 0 || screen.spec.onSelect === undefined) return 'ignored';
        screen.spec.onSelect(focus);
        return 'select';
      }
      if (intent === 'CH_UP' || intent === 'CH_DOWN') return this.page(screen, intent === 'CH_UP' ? -1 : 1);
      const direction = moveDirection(intent, this.dir);
      return direction === null ? 'ignored' : this.move(screen, direction);
    });
  }

  private move(screen: ScreenState, direction: Direction): HandleResult {
    const from = screen.active;
    const next = step(screen.zone(from), screen.position(from), direction);
    if (next !== null) {
      screen.set(from, next);
      return 'moved';
    }
    // Leave the zone: the neighbour that way, skipping empty ones in the same direction.
    const seen = [from];
    let id = screen.zone(from).neighbours?.[direction];
    while (id !== undefined && seen.indexOf(id) < 0) {
      const zone = screen.zone(id);
      if (zoneCount(zone) > 0) {
        screen.enter(id);
        return 'zone';
      }
      seen.push(id);
      id = zone.neighbours?.[direction];
    }
    return 'edge';
  }

  private page(screen: ScreenState, sign: 1 | -1): HandleResult {
    const zone = screen.zone(screen.active);
    if (!pages(zone)) return 'ignored';
    const next = page(zone, screen.position(screen.active), sign);
    if (next === null) return 'edge';
    screen.set(screen.active, next);
    return 'moved';
  }

  back(): BackOutcome {
    return this.batch((): BackOutcome => {
      if (this.pop()) return 'popped';
      if (this.options.rootBack === 'platform-back') {
        this.options.exit();
        return 'exit';
      }
      this.options.exitDialog();
      return 'exit-dialog';
    });
  }

  push(spec: ScreenSpec): Screen {
    return this.batch(() => {
      const screen = new ScreenState(spec, this);
      this.stack.push(screen);
      this.changed();
      return screen;
    });
  }

  replace(spec: ScreenSpec): Screen {
    return this.batch(() => {
      const screen = new ScreenState(spec, this);
      this.stack.pop()!.open = false;
      this.stack.push(screen);
      this.changed();
      return screen;
    });
  }

  reset(spec: ScreenSpec): Screen {
    return this.batch(() => {
      const screen = new ScreenState(spec, this);
      for (const old of this.stack) old.open = false;
      this.stack.length = 0;
      this.stack.push(screen);
      this.changed();
      return screen;
    });
  }

  pop(): boolean {
    if (this.stack.length < 2) return false;
    this.batch(() => {
      this.stack.pop()!.open = false;
      this.changed();
    });
    return true;
  }

  setDir(dir: TextDirection): void {
    if (this.dir === dir) return;
    this.batch(() => {
      this.dir = dir;
      this.changed();
    });
  }

  pointer(visible: boolean): void {
    if (this.pointerShown === visible) return;
    this.batch(() => {
      this.pointerShown = visible;
      this.changed();
    });
  }

  wheel(steps: number): boolean {
    return this.batch(() => {
      const screen = this.top;
      const next = scroll(screen.zone(screen.active), screen.position(screen.active), Math.trunc(steps));
      if (next === null) return false;
      screen.set(screen.active, next);
      return true;
    });
  }
}

/**
 * The focus engine (docs/architecture.md §1.2): screens on a back stack, each made of
 * zones that keep their own position. Pure TypeScript with no DOM: components render from
 * `snapshot()` and `Screen.position()`, and re-render on `subscribe`.
 */
export function createNavigator(options: NavigatorOptions): Navigator {
  return new FocusNavigator(options);
}
