import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Platform } from '@zoma/platform-api';
import type { FocusBinding, Navigator, Screen, ScreenSpec } from '@zoma/ui';
import { LAYOUT, SCREEN, bindFocus, createNavigator, fits } from '@zoma/ui';
import { DEMO_CATEGORIES, DEMO_CHANNELS, DEMO_TILES } from './gallery-data';

/**
 * The component gallery (`?screen=gallery`, RELAY step 11b): every base component on one
 * 1920x1080 screen, driven by the remote. Its zones:
 *
 *   actions  (4 buttons; Record is disabled)
 *   rail     (categories, a horizontal virtual list)
 *   channels (240 rows, a virtual list)   tiles (3 columns)
 *
 * OK on Play or a channel opens a dialog; Back closes it, and on this root screen follows the
 * platform (an exit dialog on Tizen and in the browser, the launcher on webOS).
 */

/** Sizes, all layout constants (no DOM measuring). gallery.css uses the same numbers. */
export const GALLERY = {
  /** The content box inside the title-safe margins. */
  width: SCREEN.width - 2 * SCREEN.safeX,
  channelsHeight: 700,
  rowGap: 8,
  chipWidth: 264,
  chipGap: 8,
  tileColumns: 3,
} as const;

export const CHANNELS_VISIBLE = fits(GALLERY.channelsHeight, LAYOUT.rowHeight, GALLERY.rowGap);
export const RAIL_VISIBLE = fits(GALLERY.width, GALLERY.chipWidth, GALLERY.chipGap);

export const ACTIONS = ['play', 'favourite', 'remove', 'record'] as const;
/** Record is shown disabled: it takes the focus, and OK does nothing. */
export const DISABLED_ACTION = 3;

/** What OK last selected, and how many selects there were (the e2e checks count them). */
export interface Selection {
  readonly zone: string;
  readonly index: number;
  readonly count: number;
}

export interface Gallery {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly home: Screen;
  /** The category on show (the rail's selected chip). */
  readonly category: ReadonlySignal<number>;
  readonly selection: ReadonlySignal<Selection | null>;
  /** The channel the play dialog is about. */
  readonly playing: ReadonlySignal<number>;
  readonly exitRequested: ReadonlySignal<boolean>;
}

const ZONES: ScreenSpec['zones'] = [
  { kind: 'list', id: 'actions', axis: 'horizontal', count: ACTIONS.length, neighbours: { down: 'rail' } },
  {
    kind: 'list',
    id: 'rail',
    axis: 'horizontal',
    count: DEMO_CATEGORIES.length,
    visible: RAIL_VISIBLE,
    neighbours: { up: 'actions', down: 'channels' },
  },
  {
    kind: 'list',
    id: 'channels',
    axis: 'vertical',
    count: DEMO_CHANNELS.length,
    visible: CHANNELS_VISIBLE,
    neighbours: { up: 'rail', end: 'tiles' },
  },
  { kind: 'grid', id: 'tiles', columns: GALLERY.tileColumns, count: DEMO_TILES.length, neighbours: { up: 'rail', start: 'channels' } },
];

const BUTTONS: ScreenSpec['zones'] = [{ kind: 'list', id: 'buttons', axis: 'horizontal', count: 2 }];

export function createGallery(platform: Pick<Platform, 'rootBackPolicy' | 'exitApp'>): Gallery {
  const category = signal(0);
  const selection = signal<Selection | null>(null);
  const playing = signal(0);
  const exitRequested = signal(false);

  const note = (zone: string, index: number): void => {
    selection.value = { zone, index, count: (selection.value?.count ?? 0) + 1 };
  };

  const openPlay = (channel: number): void => {
    playing.value = channel;
    nav.push({
      id: 'play',
      zones: BUTTONS,
      onSelect: (focus) => {
        nav.pop();
        if (focus.index === 1) note('play', channel);
      },
    });
  };

  const nav = createNavigator({
    root: {
      id: 'gallery',
      zones: ZONES,
      initial: 'channels',
      onSelect: (focus) => {
        if (focus.zone === 'actions' && focus.index === DISABLED_ACTION) return;
        note(focus.zone, focus.index);
        if (focus.zone === 'rail') category.value = focus.index;
        else if (focus.zone === 'channels') openPlay(focus.index);
        else if (focus.zone === 'actions' && focus.index === 0) openPlay(Math.max(0, nav.top.position('channels').index));
      },
    },
    rootBack: platform.rootBackPolicy(),
    exit: () => {
      exitRequested.value = true;
      platform.exitApp();
    },
    exitDialog: () => {
      nav.push({
        id: 'exit',
        zones: BUTTONS,
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
  return { nav, binding: bindFocus(nav), home: nav.top, category, selection, playing, exitRequested };
}
