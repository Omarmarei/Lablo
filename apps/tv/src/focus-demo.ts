import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Platform } from '@lablo/platform-api';
import type { Focus, Navigator, Screen, ScreenSpec } from '@lablo/ui';
import { bindFocus, createNavigator } from '@lablo/ui';

/**
 * The focus engine on the hello screen (relay step 10): a rail of tiles, a list showing a
 * window of 4 rows, and a 3-column grid. OK opens a details screen, Back closes it, and Back
 * on the root follows the platform (an exit dialog on Tizen and in the browser, the
 * launcher on webOS). The browse screens of steps 13–14 replace it.
 */
export const RAIL_ITEMS = 5;
export const LIST_ITEMS = 12;
export const LIST_VISIBLE = 4;
export const GRID_ITEMS = 8;
export const GRID_COLUMNS = 3;

export interface FocusDemo {
  readonly nav: Navigator;
  /** The root screen: its zones' positions, and pointer hovers. */
  readonly home: Screen;
  /** The focus, updated on every change. */
  readonly focus: ReadonlySignal<Focus>;
  /** What each open details screen was opened on: index 0 is the screen at depth 2. */
  readonly opened: ReadonlySignal<readonly string[]>;
  /** The app asked the platform to exit. */
  readonly exitRequested: ReadonlySignal<boolean>;
}

const HOME_ZONES: ScreenSpec['zones'] = [
  { kind: 'list', id: 'rail', axis: 'horizontal', count: RAIL_ITEMS, neighbours: { down: 'list' } },
  {
    kind: 'list',
    id: 'list',
    axis: 'vertical',
    count: LIST_ITEMS,
    visible: LIST_VISIBLE,
    neighbours: { up: 'rail', end: 'grid' },
  },
  { kind: 'grid', id: 'grid', columns: GRID_COLUMNS, count: GRID_ITEMS, neighbours: { up: 'rail', start: 'list' } },
];

/** Two buttons in a row: the details screen's Close and More, the exit dialog's Stay and Exit. */
const BUTTONS: ScreenSpec['zones'] = [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }];

export function createFocusDemo(platform: Pick<Platform, 'rootBackPolicy' | 'exitApp'>): FocusDemo {
  const exitRequested = signal(false);
  const opened = signal<readonly string[]>([]);
  const leave = (): void => {
    exitRequested.value = true;
    platform.exitApp();
  };

  const openDetails = (label: string): void => {
    opened.value = opened.value.slice(0, nav.snapshot().depth - 1).concat(label);
    nav.push({
      id: 'details',
      zones: BUTTONS,
      onSelect: (focus) => {
        if (focus.index === 0) nav.pop();
        else openDetails(`${label} › more`);
      },
    });
  };

  const nav = createNavigator({
    root: {
      id: 'home',
      zones: HOME_ZONES,
      initial: 'list',
      onSelect: (focus) => openDetails(`${focus.zone} ${focus.index + 1}`),
    },
    rootBack: platform.rootBackPolicy(),
    exit: leave,
    exitDialog: () => {
      nav.push({
        id: 'exit',
        zones: BUTTONS,
        onSelect: (focus) => {
          // The browser can't close its tab, so the dialog closes either way.
          if (focus.index === 1) leave();
          nav.pop();
        },
      });
    },
  });
  return { nav, home: nav.top, focus: bindFocus(nav).focus, opened, exitRequested };
}
